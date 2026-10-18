import {
  MODES,
  MODE_OPTIONS,
  classifyPromptList,
  isImageMode,
  isSourceMediaMode,
  isVideoMode,
} from "../../shared/prompt-classifier.js";
import {
  attachAnchorReference,
  buildBatchPlan,
  formatBatchSummary,
  normalizeCharacters,
  normalizeSettings,
  preparePayloadsForSend,
  summarizeBatch,
} from "../../shared/mixed-batch.js";

const SETTINGS_KEY = "flow_automation_settings";
const PREFS_KEY = "flow_automation_mixed_prefs";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 6;
const MESSAGE_CHUNK_SIZE = 1024 * 1024;
const FLOW_URL_PATTERN = /^https:\/\/flow\.google\.com(?:\/|$)/;

const state = {
  prompts: [],
  settings: normalizeSettings(),
  prefs: {
    defaultMode: MODES.TEXT_TO_VIDEO,
    reviewAmbiguous: false,
    useCharacters: false,
    characters: [],
    characterAnchor: "",
    applyCharacterAnchor: true,
    continuityChain: false,
    firstImageGate: false,
  },
  gate: {
    active: false,
    awaiting: false,
    sending: false,
    downloadComplete: false,
    image: null,
  },
  lockedResults: [],
  batchId: "",
  characterScan: {
    available: [],
    scanning: false,
    error: "",
  },
  sharedReferenceImages: [],
  plan: null,
  groupId: null,
  running: false,
  starting: false,
  cancelling: false,
  backgroundMode: false,
  backgroundCloseTimer: null,
  mixedActive: false,
  groupStatus: "idle",
  results: [],
  groupInfo: null,
  progressByPrompt: new Map(),
  retryCounts: {},
  downloadRetryCounts: {},
  summary: null,
  lastBatchError: "",
  lastPromptText: "",
  logs: [],
};

const elements = {};
let ensureScheduled = false;
let refreshTimer = null;

function modeLabel(mode) {
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Unassigned";
}

function outputLabel(mode) {
  if (!mode) return "Unassigned";
  return isVideoMode(mode) ? "Video" : "Image";
}

function appendLog(message, level = "info") {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return;
  state.logs.push({ level, text: text.slice(0, 500) });
  if (state.logs.length > 60) state.logs.shift();

  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  writer("[Mixed]", text);

  if (!elements.log) return;
  elements.log.replaceChildren();
  for (const entry of state.logs.slice(-8)) {
    const row = document.createElement("div");
    row.className = `fa-mixed-log-row is-${entry.level}`;
    row.textContent = entry.text;
    elements.log.appendChild(row);
  }
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setError(message) {
  if (!elements.error) return;
  elements.error.textContent = message || "";
  elements.error.hidden = !message;
}

function findControlPanel() {
  const panels = [...document.querySelectorAll(".p-tabpanel-active")];
  return panels.find((panel) =>
    [...panel.querySelectorAll("button")].some((button) => button.innerText.trim() === "Text to Video"),
  ) ?? null;
}

function findModeButton(control, label) {
  if (!control) return null;
  return [...control.querySelectorAll("button")].find((button) => button.innerText.trim() === label) ?? null;
}

function findModeGrid(control) {
  const modeButton = findModeButton(control, "Text to Video");
  return modeButton?.closest(".grid") ?? null;
}

function findPromptTextarea(control) {
  if (!control) return null;
  const textareas = [...control.querySelectorAll("textarea.p-textarea")].filter((textarea) => textarea.offsetParent !== null);
  return textareas.find((textarea) => textarea.placeholder.includes("Second prompt starts after a blank line"))
    ?? textareas[0]
    ?? null;
}

function findPromptCard(textarea) {
  return textarea?.closest("div.rounded-lg") ?? null;
}

function findRunButton(control) {
  if (!control) return null;
  const runContainer = [...control.querySelectorAll(".relative.w-full.h-full")]
    .find((container) => container.querySelector("button") && container.offsetParent !== null);
  if (runContainer) return runContainer.querySelector("button");

  return [...control.querySelectorAll("button")]
    .find((button) => button.offsetParent !== null && /^Run\b/i.test(button.innerText.trim()))
    ?? null;
}

function createBackgroundButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "p-button p-component p-button-secondary p-button-outlined p-button-sm fa-mixed-background-button";
  button.hidden = true;
  button.title = "Start the mixed batch and let it continue after this side panel closes";
  button.innerHTML = `
    <span class="p-button-icon p-button-icon-left pi pi-window-minimize" aria-hidden="true"></span>
    <span class="p-button-label">Background</span>
  `;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.running || state.starting) return;
    startBatch({ background: true });
  });
  elements.backgroundButton = button;
}

function ensureBackgroundButton(control) {
  const runButton = findRunButton(control);
  if (!runButton) return;
  if (!elements.backgroundButton) createBackgroundButton();
  const container = runButton.parentElement;
  if (!container) return;
  container.classList.add("fa-mixed-run-group");
  if (elements.backgroundButton.parentElement !== container) container.appendChild(elements.backgroundButton);
  elements.backgroundButton.hidden = !state.mixedActive;
  elements.backgroundButton.disabled = state.running || state.starting || runButton.disabled;
}

function createMixedModeButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "p-button p-component p-button-secondary p-button-outlined p-button-sm w-full fa-mixed-mode-button";
  button.dataset.pSeverity = "secondary";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("title", "Classify and submit image and video prompts from the same list");
  button.innerHTML = `
    <span class="p-button-icon p-button-icon-left pi pi-arrows-h" aria-hidden="true"></span>
    <span class="p-button-label">Mixed Image + Video</span>
  `;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.mixedActive) deactivateMixed();
    else activateMixed();
  });
  elements.mixedButton = button;
}

function setMixedButtonActive(active) {
  const button = elements.mixedButton;
  if (!button) return;
  button.classList.remove("p-button-primary");
  button.classList.add("p-button-secondary", "p-button-outlined");
  button.classList.toggle("fa-mixed-mode-active", active);
  button.dataset.pSeverity = "secondary";
  button.setAttribute("aria-pressed", String(active));
}

function createPanel() {
  const panel = document.createElement("div");
  panel.className = "fa-mixed-inline rounded-lg border border-border/60 bg-background/70 p-3 space-y-2 text-foreground";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <i class="pi pi-arrows-h text-primary text-sm" aria-hidden="true"></i>
        <span class="text-xs sm:text-sm font-semibold">Mixed Image + Video</span>
      </div>
      <span class="text-[10px] text-muted-foreground" id="fa-mixed-count">0 prompts</span>
    </div>
    <p class="text-[10px] text-muted-foreground leading-relaxed">
      Use the existing Prompts field above. Labels are removed before submission; blank lines or one labeled prompt per line are supported.
      Select Flow characters and/or add an identity anchor below to keep the same character across prompts.
    </p>
    <div class="grid grid-cols-2 gap-2">
      <label class="text-[10px] text-muted-foreground">
        <span>Default for ambiguous prompts</span>
        <select id="fa-mixed-default-mode" class="fa-mixed-select w-full mt-1">
          <option value="${MODES.TEXT_TO_IMAGE}">Image</option>
          <option value="${MODES.TEXT_TO_VIDEO}">Video</option>
        </select>
      </label>
      <label class="flex items-center gap-2 min-h-[30px] text-[10px] text-muted-foreground">
        <input type="checkbox" id="fa-mixed-review" class="fa-mixed-checkbox" />
        <span>Mark ambiguous prompts for review</span>
      </label>
    </div>
    <details class="fa-mixed-consistency" open>
      <summary class="text-[10px] font-semibold cursor-pointer">Character consistency</summary>
      <div class="fa-mixed-consistency-body">
        <div class="fa-mixed-consistency-head">
          <label class="flex items-center gap-2 text-[10px] text-muted-foreground">
            <input type="checkbox" id="fa-mixed-use-characters" class="fa-mixed-checkbox" />
            <span>Attach Flow characters</span>
          </label>
          <button type="button" id="fa-mixed-scan-characters" class="p-button p-component p-button-secondary p-button-outlined p-button-sm fa-mixed-scan-button">Scan Characters</button>
        </div>
        <select id="fa-mixed-characters" class="fa-mixed-select fa-mixed-character-list" multiple size="4" aria-label="Flow characters to attach to every prompt"></select>
        <p class="fa-mixed-consistency-hint" id="fa-mixed-character-hint">Open a Flow project and scan to list its characters. Selected characters are attached to every prompt unless a row overrides them.</p>
        <label class="fa-mixed-consistency-label">
          <span>Identity anchor (optional)</span>
          <textarea id="fa-mixed-character-anchor" class="fa-mixed-textarea" rows="2" maxlength="600" placeholder="Mara: 30-year-old woman, oval face, dark curly shoulder-length hair, brown eyes, freckles, red wool coat."></textarea>
        </label>
        <label class="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input type="checkbox" id="fa-mixed-apply-anchor" class="fa-mixed-checkbox" />
          <span>Prepend the anchor to text and ingredients prompts</span>
        </label>
        <div class="fa-mixed-shared-media">
          <div class="fa-mixed-consistency-head">
            <span class="text-[10px] font-semibold">Shared reference images</span>
            <span class="fa-mixed-consistency-hint">Used by I2V / I2I / ingredients prompts without their own image</span>
          </div>
          <input type="file" id="fa-mixed-shared-images" accept="image/*" multiple aria-label="Shared character reference images" />
          <div class="fa-mixed-shared-list" id="fa-mixed-shared-list"></div>
        </div>
        <label class="fa-mixed-continuity-option">
          <input type="checkbox" id="fa-mixed-continuity" class="fa-mixed-checkbox" />
          <span>
            <strong>Chain prompts</strong> — each prompt waits for the previous one and uses its output as the reference
            (previous image edit or last video frame). Forces 1 concurrent prompt and 1 output per prompt. Works best
            when consecutive prompts produce the same output type.
          </span>
        </label>
        <label class="fa-mixed-continuity-option">
          <input type="checkbox" id="fa-mixed-first-image-gate" class="fa-mixed-checkbox" />
          <span>
            <strong>First-image gate</strong> — pause after prompt #1 so you can upload its downloaded image, then run
            the remaining prompts with that image attached as a reference. Prompt #1 must be an image.
          </span>
        </label>
      </div>
    </details>
    <div class="text-[10px] text-muted-foreground" id="fa-mixed-settings"></div>
    <div class="fa-mixed-preview" id="fa-mixed-preview"></div>
    <div class="fa-mixed-gate" id="fa-mixed-gate" hidden>
      <strong class="fa-mixed-gate-title">First image ready</strong>
      <p class="fa-mixed-consistency-hint" id="fa-mixed-gate-hint"></p>
      <div class="fa-mixed-gate-row">
        <input type="file" id="fa-mixed-gate-file" accept="image/*" aria-label="Upload the downloaded first image" />
        <img id="fa-mixed-gate-preview" class="fa-mixed-gate-preview" alt="First image reference preview" hidden />
      </div>
      <span class="fa-mixed-gate-name" id="fa-mixed-gate-name">No image uploaded</span>
      <div class="fa-mixed-gate-actions">
        <button type="button" id="fa-mixed-gate-continue" class="p-button p-component p-button-sm" disabled>Continue batch</button>
        <button type="button" id="fa-mixed-gate-cancel" class="p-button p-component p-button-secondary p-button-outlined p-button-sm">Cancel batch</button>
      </div>
    </div>
    <div class="fa-mixed-error" id="fa-mixed-error" hidden></div>
    <div class="fa-mixed-progress-block">
      <div class="flex items-center justify-between gap-2 text-[10px]">
        <strong class="text-xs" id="fa-mixed-status" aria-live="polite">Ready</strong>
        <span class="text-muted-foreground" id="fa-mixed-counts"></span>
      </div>
      <div class="fa-mixed-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="fa-mixed-progress">
        <div class="fa-mixed-progress-bar" id="fa-mixed-progress-bar"></div>
      </div>
      <div class="fa-mixed-progress-detail" id="fa-mixed-progress-detail"></div>
      <button type="button" class="p-button p-component p-button-danger p-button-text p-button-sm fa-mixed-cancel" id="fa-mixed-cancel" hidden>Cancel mixed batch</button>
    </div>
    <details class="fa-mixed-log-wrap">
      <summary class="text-[10px] font-semibold cursor-pointer">Batch log</summary>
      <div class="fa-mixed-log" id="fa-mixed-log" aria-live="polite"></div>
    </details>
    <div class="fa-mixed-summary" id="fa-mixed-summary" aria-live="polite" hidden></div>
  `;

  elements.panel = panel;
  elements.count = panel.querySelector("#fa-mixed-count");
  elements.defaultMode = panel.querySelector("#fa-mixed-default-mode");
  elements.review = panel.querySelector("#fa-mixed-review");
  elements.useCharacters = panel.querySelector("#fa-mixed-use-characters");
  elements.characters = panel.querySelector("#fa-mixed-characters");
  elements.characterHint = panel.querySelector("#fa-mixed-character-hint");
  elements.scanCharacters = panel.querySelector("#fa-mixed-scan-characters");
  elements.characterAnchor = panel.querySelector("#fa-mixed-character-anchor");
  elements.applyAnchor = panel.querySelector("#fa-mixed-apply-anchor");
  elements.sharedImages = panel.querySelector("#fa-mixed-shared-images");
  elements.sharedList = panel.querySelector("#fa-mixed-shared-list");
  elements.continuity = panel.querySelector("#fa-mixed-continuity");
  elements.firstImageGate = panel.querySelector("#fa-mixed-first-image-gate");
  elements.gate = panel.querySelector("#fa-mixed-gate");
  elements.gateFile = panel.querySelector("#fa-mixed-gate-file");
  elements.gatePreview = panel.querySelector("#fa-mixed-gate-preview");
  elements.gateName = panel.querySelector("#fa-mixed-gate-name");
  elements.gateHint = panel.querySelector("#fa-mixed-gate-hint");
  elements.gateContinue = panel.querySelector("#fa-mixed-gate-continue");
  elements.gateCancel = panel.querySelector("#fa-mixed-gate-cancel");
  elements.settingsSummary = panel.querySelector("#fa-mixed-settings");
  elements.preview = panel.querySelector("#fa-mixed-preview");
  elements.error = panel.querySelector("#fa-mixed-error");
  elements.status = panel.querySelector("#fa-mixed-status");
  elements.counts = panel.querySelector("#fa-mixed-counts");
  elements.progress = panel.querySelector("#fa-mixed-progress");
  elements.progressBar = panel.querySelector("#fa-mixed-progress-bar");
  elements.progressDetail = panel.querySelector("#fa-mixed-progress-detail");
  elements.cancel = panel.querySelector("#fa-mixed-cancel");
  elements.log = panel.querySelector("#fa-mixed-log");
  elements.summary = panel.querySelector("#fa-mixed-summary");

  elements.defaultMode.value = state.prefs.defaultMode;
  elements.review.checked = state.prefs.reviewAmbiguous;
  elements.defaultMode.addEventListener("change", () => {
    state.prefs.defaultMode = elements.defaultMode.value === MODES.TEXT_TO_IMAGE
      ? MODES.TEXT_TO_IMAGE
      : MODES.TEXT_TO_VIDEO;
    savePrefs();
    refreshFromTextarea({ force: true });
  });
  elements.review.addEventListener("change", () => {
    state.prefs.reviewAmbiguous = elements.review.checked;
    savePrefs();
    refreshFromTextarea({ force: true });
  });

  elements.useCharacters.checked = state.prefs.useCharacters;
  elements.useCharacters.addEventListener("change", () => {
    state.prefs.useCharacters = elements.useCharacters.checked;
    savePrefs();
    renderCharacterControls();
    renderPreview();
    updateStartState();
  });

  elements.characters.addEventListener("change", () => {
    state.prefs.characters = [...elements.characters.selectedOptions].map((option) => option.value);
    savePrefs();
    renderCharacterHint();
    renderPreview();
    updateStartState();
  });

  elements.scanCharacters.addEventListener("click", () => {
    scanCharacters();
  });

  elements.characterAnchor.value = state.prefs.characterAnchor;
  elements.characterAnchor.addEventListener("input", () => {
    state.prefs.characterAnchor = elements.characterAnchor.value.slice(0, 600);
    savePrefs();
    updateSettingsSummary();
  });

  elements.applyAnchor.checked = state.prefs.applyCharacterAnchor;
  elements.applyAnchor.addEventListener("change", () => {
    state.prefs.applyCharacterAnchor = elements.applyAnchor.checked;
    savePrefs();
    updateSettingsSummary();
  });

  elements.sharedImages.addEventListener("change", () => {
    addSharedImages(elements.sharedImages.files);
  });

  elements.continuity.checked = state.prefs.continuityChain;
  elements.continuity.addEventListener("change", () => {
    state.prefs.continuityChain = elements.continuity.checked;
    savePrefs();
    resetFinishedBatch();
    updateSettingsSummary();
    updateStartState();
  });

  elements.firstImageGate.checked = state.prefs.firstImageGate;
  elements.firstImageGate.addEventListener("change", () => {
    state.prefs.firstImageGate = elements.firstImageGate.checked;
    savePrefs();
    resetFinishedBatch();
    updateSettingsSummary();
    updateStartState();
  });

  elements.gateFile.addEventListener("change", async () => {
    const file = elements.gateFile.files?.[0];
    elements.gateFile.value = "";
    if (!file) return;
    try {
      const image = await readImageFile(file);
      state.gate.image = image;
      setError("");
      renderGate();
      appendLog(`First-image gate: reference image "${image.name}" uploaded.`);
    } catch (error) {
      setError(`First-image gate: ${error.message || error}`);
    }
  });

  elements.gateContinue.addEventListener("click", () => {
    continueAfterReference();
  });
  elements.gateCancel.addEventListener("click", cancelBatch);
  renderGate();

  elements.cancel.addEventListener("click", cancelBatch);
  renderCharacterControls();
  renderSharedImages();
}

function renderCharacterHint() {
  if (!elements.characterHint) return;
  const available = state.characterScan.available;
  const selected = state.prefs.characters;

  if (state.characterScan.scanning) {
    elements.characterHint.textContent = "Scanning the current Flow project for characters…";
    return;
  }
  if (state.characterScan.error) {
    elements.characterHint.textContent = state.characterScan.error;
    return;
  }
  if (available.length === 0) {
    elements.characterHint.textContent = "No characters scanned yet. Open a Flow project and press Scan Characters.";
    return;
  }
  if (!state.prefs.useCharacters) {
    elements.characterHint.textContent = `${available.length} character${available.length === 1 ? "" : "s"} available. Enable "Attach Flow characters" to use them.`;
    return;
  }
  elements.characterHint.textContent = selected.length > 0
    ? `Attaching ${selected.join(", ")} via Flow character mentions. Mention the same names in each prompt for inline placement.`
    : "Select one or more characters. They are attached to every prompt unless a row overrides them.";
}

function renderCharacterControls() {
  if (!elements.characters || !elements.useCharacters) return;

  const names = [...new Set([
    ...state.characterScan.available,
    ...state.prefs.characters,
  ])].sort((left, right) => left.localeCompare(right));

  elements.characters.replaceChildren();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = state.prefs.characters.includes(name);
    elements.characters.appendChild(option);
  }

  const disabled = state.running || state.starting || state.characterScan.scanning;
  elements.useCharacters.checked = state.prefs.useCharacters;
  elements.useCharacters.disabled = disabled;
  elements.characters.hidden = names.length === 0;
  elements.characters.disabled = disabled || !state.prefs.useCharacters;
  elements.scanCharacters.disabled = disabled;
  elements.scanCharacters.textContent = state.characterScan.scanning ? "Scanning…" : "Scan Characters";
  elements.characterAnchor.disabled = state.running;
  elements.applyAnchor.disabled = state.running;
  elements.sharedImages.disabled = state.running;
  elements.continuity.disabled = state.running;
  elements.firstImageGate.disabled = state.running;
  renderCharacterHint();
}

async function scanCharacters() {
  if (state.running || state.starting || state.characterScan.scanning) return;
  state.characterScan.scanning = true;
  state.characterScan.error = "";
  renderCharacterControls();
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !FLOW_URL_PATTERN.test(String(tab.url || ""))) {
      throw new Error("Open a Google Flow project tab before scanning characters.");
    }
    const response = await sendTabMessage(tab.id, { type: "SCAN_CHARACTERS" });
    const characters = [...new Set(
      (Array.isArray(response?.characters) ? response.characters : [])
        .map((name) => String(name ?? "").trim())
        .filter(Boolean),
    )];
    state.characterScan.available = characters;

    if (characters.length === 0) {
      state.characterScan.error = "No Flow characters found in this project. Create characters in Flow first.";
    } else {
      const storedDefaults = normalizeCharacters(state.settings.characters);
      const preferred = state.prefs.characters.length > 0 ? state.prefs.characters : storedDefaults;
      state.prefs.characters = preferred.filter((name) => characters.includes(name));
      if (state.prefs.characters.length === 0 && storedDefaults.length > 0) {
        state.prefs.characters = storedDefaults.filter((name) => characters.includes(name));
      }
      if (state.prefs.characters.length > 0) state.prefs.useCharacters = true;
      appendLog(`Scanned ${characters.length} Flow character${characters.length === 1 ? "" : "s"}: ${characters.join(", ")}.`);
    }
  } catch (error) {
    state.characterScan.error = error.message || String(error);
    appendLog(`Character scan failed: ${state.characterScan.error}`, "warn");
  } finally {
    state.characterScan.scanning = false;
    savePrefs();
    renderCharacterControls();
    renderPreview();
    updateStartState();
  }
}

function promptReferenceImages(item) {
  if (Array.isArray(item.referenceImages) && item.referenceImages.length > 0) return item.referenceImages;
  return item.referenceImage ? [item.referenceImage] : [];
}

function effectiveReferenceImages(item) {
  const own = promptReferenceImages(item);
  if (own.length > 0) return own;
  return isSourceMediaMode(item.mode) ? state.sharedReferenceImages : [];
}

async function readImageFile(file) {
  if (!file) throw new Error("No file selected.");
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Image is larger than 50 MB.");
  return { base64: await readFileAsDataUrl(file), name: file.name };
}

async function addSharedImages(fileList) {
  if (state.running || state.starting || !elements.sharedImages) return;
  const files = [...(fileList || [])];
  elements.sharedImages.value = "";
  if (files.length === 0) return;

  const remaining = MAX_REFERENCE_IMAGES - state.sharedReferenceImages.length;
  if (remaining <= 0) {
    setError(`Shared reference images are limited to ${MAX_REFERENCE_IMAGES}.`);
    return;
  }

  try {
    for (const file of files.slice(0, remaining)) {
      const image = await readImageFile(file);
      const duplicate = state.sharedReferenceImages.some(
        (existing) => existing.name === image.name && existing.base64 === image.base64,
      );
      if (!duplicate) state.sharedReferenceImages.push(image);
    }
    setError("");
    resetFinishedBatch();
    renderSharedImages();
    renderPreview();
    updateStartState();
    appendLog(`Shared reference images: ${state.sharedReferenceImages.length} ready.`);
  } catch (error) {
    setError(`Shared reference image: ${error.message || error}`);
  }
}

function renderSharedImages() {
  if (!elements.sharedList) return;
  elements.sharedList.replaceChildren();

  if (state.sharedReferenceImages.length === 0) {
    const empty = document.createElement("span");
    empty.className = "fa-mixed-consistency-hint";
    empty.textContent = "No shared images. Source-media rows still need their own image.";
    elements.sharedList.appendChild(empty);
    return;
  }

  state.sharedReferenceImages.forEach((image, index) => {
    const chip = document.createElement("span");
    chip.className = "fa-mixed-shared-chip";

    const name = document.createElement("span");
    name.textContent = image.name;

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "fa-mixed-clear-media";
    clear.textContent = "×";
    clear.setAttribute("aria-label", `Remove shared reference image ${image.name}`);
    clear.disabled = state.running;
    clear.addEventListener("click", () => {
      state.sharedReferenceImages.splice(index, 1);
      resetFinishedBatch();
      renderSharedImages();
      renderPreview();
      updateStartState();
    });

    chip.append(name, clear);
    elements.sharedList.appendChild(chip);
  });
}

function renderGate() {
  if (!elements.gate) return;
  const visible = state.gate.active && state.gate.awaiting;
  elements.gate.hidden = !visible;
  if (!visible) {
    elements.gatePreview.hidden = true;
    elements.gatePreview.removeAttribute("src");
    elements.gateName.textContent = "No image uploaded";
    return;
  }

  const image = state.gate.image;
  elements.gateFile.disabled = state.gate.sending;
  elements.gateContinue.disabled = state.gate.sending || !image;
  elements.gateContinue.textContent = state.gate.sending ? "Starting…" : "Continue batch";
  elements.gateCancel.disabled = state.gate.sending;
  elements.gateName.textContent = image ? image.name : "No image uploaded";
  if (image) {
    elements.gatePreview.src = image.base64;
    elements.gatePreview.hidden = false;
  } else {
    elements.gatePreview.hidden = true;
    elements.gatePreview.removeAttribute("src");
  }
  const firstResult = state.lockedResults.find((result) => Number(result.promptIndex) === 1);
  const downloadFailed = firstResult && !firstResult.success;
  elements.gateHint.textContent = downloadFailed
    ? "Prompt #1 generated, but its automatic download failed. Download it from Flow, then upload it here to continue."
    : state.gate.downloadComplete
      ? "Prompt #1 downloaded. Upload that downloaded image, then continue. Remaining text prompts switch to Image-to-Image or Ingredients to Video so the image is used as a reference."
      : "Prompt #1 finished. Wait for its download to complete, upload the downloaded image, then continue.";
}

async function submitGroup(tab, groupId, planForSend, payloads, imageMap) {
  for (const [id, image] of Object.entries(imageMap)) {
    if (state.cancelling) return { cancelled: true };
    if (!state.running) return { cancelled: true };
    await sendImage(tab.id, id, image);
  }
  if (state.cancelling) return { cancelled: true };
  appendLog(`Reference media prepared: ${Object.keys(imageMap).length} image(s).`);

  return sendTabMessage(tab.id, {
    type: "AUTO_FILL_FLOW",
    payloads,
    groupId,
    concurrentPrompts: planForSend.settings.concurrentPrompts,
    promptDelaySecondsMin: planForSend.settings.promptDelaySecondsMin,
    promptDelaySecondsMax: planForSend.settings.promptDelaySecondsMax,
  });
}

async function continueAfterReference() {
  if (!state.running || !state.gate.active || !state.gate.awaiting || state.gate.sending) return;
  if (!state.gate.image) {
    setError("Upload the downloaded first image before continuing.");
    return;
  }

  state.gate.sending = true;
  renderGate();

  const previousPlan = state.plan;
  try {
    const sources = attachAnchorReference(sourcesForPlan(), state.gate.image, 1);
    const plan = buildBatchPlan(sources, settingsForPlan());

    if (plan.items.some((item) => item.blockedReason)) {
      const blocked = plan.items.find((item) => item.blockedReason);
      throw new Error(`Prompt #${blocked.promptIndex} is blocked: ${blocked.blockedReason}`);
    }

    const { payloads, imageMap } = preparePayloadsForSend(plan.items.slice(1));
    if (payloads.length === 0) throw new Error("No remaining prompts are ready to submit.");

    const tab = await getActiveTab();
    if (!tab?.id || !FLOW_URL_PATTERN.test(String(tab.url || ""))) {
      throw new Error("Open a Google Flow project tab before continuing.");
    }

    state.plan = plan;
    state.groupId = `${state.batchId}-rest`;
    state.gate.active = false;
    state.gate.awaiting = false;
    state.results = [...state.lockedResults];
    state.retryCounts = {};
    state.downloadRetryCounts = {};
    state.groupStatus = "running";
    state.summary = null;
    state.groupInfo = null;

    renderGate();
    renderPreview();
    renderProgress();
    updateStartState();
    appendLog(`First-image gate: continuing with ${payloads.length} prompt(s); "${state.gate.image.name}" attached as a reference.`);

    const response = await submitGroup(tab, state.groupId, plan, payloads, imageMap);
    if (!state.running) return;
    if (response?.cancelled) {
      finalizeBatch("cancelled");
      return;
    }
    if (response?.success === false) {
      finalizeBatch("error", response?.error || "The Flow content script rejected the remaining mixed prompts.");
      return;
    }
    await recordDailyPromptUsage(payloads.length);
  } catch (error) {
    state.plan = previousPlan;
    state.groupId = state.batchId;
    state.groupStatus = "paused";
    state.results = [...state.lockedResults];
    state.gate.active = true;
    state.gate.awaiting = true;
    state.gate.sending = false;
    renderGate();
    renderProgress();
    setError(`First-image gate: ${error.message || error}`);
    appendLog(`First-image gate: ${error.message || error}`, "error");
  }
}

function ensurePanelAttached(control) {
  if (!elements.panel) createPanel();
  const textarea = findPromptTextarea(control);
  const card = findPromptCard(textarea);
  if (!card) {
    elements.panel.hidden = true;
    return false;
  }

  const alreadyPlaced = elements.panel.parentElement === card.parentElement
    && elements.panel.previousElementSibling === card;
  if (!alreadyPlaced) card.insertAdjacentElement("afterend", elements.panel);
  elements.panel.hidden = !state.mixedActive;
  return true;
}

function activateMixed() {
  const control = findControlPanel();
  if (!control) return;
  state.mixedActive = true;
  setMixedButtonActive(true);
  ensureUi();
  if (state.running) {
    renderProgress();
    return;
  }
  refreshFromTextarea({ force: true });
  appendLog("Mixed mode selected. The existing Prompts field and Run button are now used for the mixed batch.");
}

function deactivateMixed() {
  state.mixedActive = false;
  setMixedButtonActive(false);
  if (elements.panel) elements.panel.hidden = true;
  updateRunVisual();
}

function ensureUi() {
  const control = findControlPanel();
  if (!control) return;
  const grid = findModeGrid(control);
  if (grid) {
    if (!elements.mixedButton) createMixedModeButton();
    if (elements.mixedButton.parentElement !== grid) grid.appendChild(elements.mixedButton);
  }
  setMixedButtonActive(state.mixedActive);

  if (state.mixedActive) {
    ensureBackgroundButton(control);
    const attached = ensurePanelAttached(control);
    if (attached) {
      updateStartState();
      renderProgress();
    }
  } else {
    if (elements.panel) elements.panel.hidden = true;
    if (elements.backgroundButton) elements.backgroundButton.hidden = true;
  }
  updateRunVisual();
}

function scheduleEnsure() {
  if (ensureScheduled) return;
  ensureScheduled = true;
  requestAnimationFrame(() => {
    ensureScheduled = false;
    ensureUi();
  });
}

function updateRunVisual() {
  const control = findControlPanel();
  const runButton = findRunButton(control);
  if (!runButton) return;
  const blocked = state.running || state.starting;
  runButton.classList.toggle("fa-mixed-run-blocked", blocked);
  runButton.setAttribute("aria-disabled", blocked ? "true" : "false");
  if (elements.backgroundButton) {
    elements.backgroundButton.hidden = !state.mixedActive;
    elements.backgroundButton.disabled = blocked || runButton.disabled;
  }
}

function resetFinishedBatch() {
  if (state.running) return;
  state.plan = null;
  state.summary = null;
  state.backgroundMode = false;
  clearTimeout(state.backgroundCloseTimer);
  state.backgroundCloseTimer = null;
  state.groupStatus = "idle";
  state.results = [];
  state.groupInfo = null;
  state.progressByPrompt.clear();
  state.retryCounts = {};
  state.downloadRetryCounts = {};
  state.lastBatchError = "";
  if (elements.summary) {
    elements.summary.hidden = true;
    elements.summary.replaceChildren();
  }
}

function currentRowState(item) {
  if (state.summary) {
    const row = state.summary.rows.find((candidate) => candidate.promptIndex === item.index + 1);
    if (row) return { label: row.status, kind: row.status };
  }
  if (item.emptyAfterLabel || !String(item.prompt || "").trim()) {
    return { label: "Empty prompt", kind: "blocked" };
  }
  if (item.mode && isSourceMediaMode(item.mode) && effectiveReferenceImages(item).length === 0) {
    return { label: "Needs source image", kind: "blocked" };
  }
  if (item.needsReview && !item.mode) return { label: "Review needed", kind: "review" };
  if (!item.mode) return { label: "Choose mode", kind: "blocked" };
  return { label: "Ready", kind: "ready" };
}

function renderRow(item, index) {
  const row = document.createElement("article");
  row.className = "fa-mixed-row";
  row.dataset.promptIndex = String(index + 1);

  const header = document.createElement("div");
  header.className = "fa-mixed-row-head";

  const number = document.createElement("span");
  number.className = "fa-mixed-row-index";
  number.textContent = String(index + 1);

  const select = document.createElement("select");
  select.className = "fa-mixed-row-mode";
  select.setAttribute("aria-label", `Generation mode for prompt ${index + 1}`);
  select.disabled = state.running;
  if (!item.mode) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose mode…";
    select.appendChild(placeholder);
  }
  for (const optionInfo of MODE_OPTIONS) {
    const option = document.createElement("option");
    option.value = optionInfo.value;
    option.textContent = optionInfo.label;
    option.selected = optionInfo.value === item.mode;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    if (state.running) return;
    item.mode = select.value || null;
    item.manualMode = Boolean(item.mode);
    item.needsReview = !item.mode;
    item.needsSourceMedia = item.mode ? isSourceMediaMode(item.mode) : false;
    item.reason = item.mode ? "Mode corrected manually." : "Choose a mode before starting.";
    resetFinishedBatch();
    renderPreview();
    updateStartState();
  });

  const output = document.createElement("span");
  output.className = `fa-mixed-row-output is-${item.mode ? outputLabel(item.mode).toLowerCase() : "unassigned"}`;
  output.textContent = outputLabel(item.mode);

  const status = currentRowState(item);
  const statusNode = document.createElement("span");
  statusNode.className = `fa-mixed-row-status is-${status.kind}`;
  statusNode.textContent = status.label;

  header.append(number, select, output, statusNode);

  const promptText = String(item.prompt || item.cleanedPrompt || "");
  const promptWrap = document.createElement("div");
  promptWrap.className = "fa-mixed-row-prompt-wrap";

  const prompt = document.createElement("div");
  prompt.className = "fa-mixed-row-prompt";
  prompt.textContent = promptText;
  promptWrap.appendChild(prompt);

  const isLongPrompt = promptText.length > 220 || promptText.split("\n").length > 4;
  if (isLongPrompt) {
    promptWrap.classList.toggle("is-expanded", Boolean(item.promptExpanded));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "fa-mixed-prompt-toggle";
    toggle.textContent = item.promptExpanded ? "Show less" : "Show full prompt";
    toggle.setAttribute("aria-expanded", String(Boolean(item.promptExpanded)));
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      item.promptExpanded = !item.promptExpanded;
      promptWrap.classList.toggle("is-expanded", item.promptExpanded);
      toggle.textContent = item.promptExpanded ? "Show less" : "Show full prompt";
      toggle.setAttribute("aria-expanded", String(item.promptExpanded));
    });
    promptWrap.appendChild(toggle);
  }

  const meta = document.createElement("div");
  meta.className = "fa-mixed-row-meta";
  const reason = document.createElement("span");
  reason.textContent = item.reason || item.classification?.reason || "";
  const source = document.createElement("span");
  source.className = "fa-mixed-row-source";
  source.textContent = item.manualMode ? "manual mode" : item.classification?.confidence || "";
  meta.append(reason, source);

  row.append(header, promptWrap, meta);

  const hasCharacterOverride = Array.isArray(item.charactersOverride) && item.charactersOverride.length > 0;
  if (state.prefs.characters.length > 0 || hasCharacterOverride) {
    const characters = document.createElement("input");
    characters.type = "text";
    characters.className = "fa-mixed-row-characters";
    characters.disabled = state.running;
    characters.setAttribute("aria-label", `Characters for prompt ${index + 1}`);
    characters.placeholder = state.prefs.characters.length > 0
      ? `Characters (global: ${state.prefs.characters.join(", ")})`
      : "Characters (comma-separated)";
    characters.value = (item.charactersOverride || []).join(", ");
    characters.addEventListener("change", () => {
      if (state.running) return;
      const parsed = normalizeCharacters(characters.value);
      item.charactersOverride = parsed.length > 0 ? parsed : null;
      resetFinishedBatch();
      renderPreview();
      updateStartState();
    });
    row.appendChild(characters);
  }

  if (item.mode && isSourceMediaMode(item.mode)) {
    const media = document.createElement("div");
    media.className = "fa-mixed-row-media";

    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.multiple = true;
    file.disabled = state.running;
    file.setAttribute("aria-label", `Reference images for prompt ${index + 1}`);
    file.addEventListener("change", async () => {
      const selectedFiles = [...(file.files || [])];
      if (selectedFiles.length === 0) return;

      const own = promptReferenceImages(item);
      const remaining = MAX_REFERENCE_IMAGES - own.length;
      if (remaining <= 0) {
        setError(`Prompt #${index + 1}: reference images are limited to ${MAX_REFERENCE_IMAGES}.`);
        file.value = "";
        return;
      }

      const added = [];
      for (const selected of selectedFiles.slice(0, remaining)) {
        try {
          const image = await readImageFile(selected);
          const duplicate = own.some(
            (existing) => existing.name === image.name && existing.base64 === image.base64,
          );
          if (!duplicate) added.push(image);
        } catch (error) {
          setError(`Prompt #${index + 1}: ${error.message || error}`);
        }
      }

      file.value = "";
      if (added.length === 0) return;

      item.referenceImages = [...promptReferenceImages(item), ...added];
      item.referenceImage = item.referenceImages[0];
      resetFinishedBatch();
      renderPreview();
      updateStartState();
      appendLog(`Prompt #${index + 1}: ${item.referenceImages.length} reference image(s) attached for ${modeLabel(item.mode)}.`);
    });

    const name = document.createElement("span");
    name.className = "fa-mixed-row-media-name";
    const own = promptReferenceImages(item);
    if (own.length > 0) {
      name.textContent = `${own.length} image${own.length === 1 ? "" : "s"}: ${own.map((image) => image.name).join(", ")}`;
    } else if (state.sharedReferenceImages.length > 0) {
      name.textContent = `Using ${state.sharedReferenceImages.length} shared reference image${state.sharedReferenceImages.length === 1 ? "" : "s"}`;
    } else {
      name.textContent = "Reference image required";
    }
    media.append(file, name);

    if (own.length > 0) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "fa-mixed-clear-media";
      clear.textContent = "Clear";
      clear.disabled = state.running;
      clear.addEventListener("click", () => {
        item.referenceImage = null;
        item.referenceImages = [];
        resetFinishedBatch();
        renderPreview();
        updateStartState();
      });
      media.appendChild(clear);
    }

    row.appendChild(media);
  }

  return row;
}

function renderPreview() {
  if (!elements.preview) return;
  elements.preview.replaceChildren();

  if (state.prompts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "fa-mixed-empty";
    empty.textContent = "Paste prompts above to preview their image or video mode.";
    elements.preview.appendChild(empty);
  } else {
    for (let index = 0; index < state.prompts.length; index += 1) {
      elements.preview.appendChild(renderRow(state.prompts[index], index));
    }
  }

  const imageCount = state.prompts.filter((item) => item.mode && !isVideoMode(item.mode)).length;
  const videoCount = state.prompts.filter((item) => item.mode && isVideoMode(item.mode)).length;
  const reviewCount = state.prompts.filter((item) => !item.mode).length;
  if (elements.count) {
    elements.count.textContent = `${state.prompts.length} prompt${state.prompts.length === 1 ? "" : "s"} · ${imageCount} image · ${videoCount} video${reviewCount ? ` · ${reviewCount} need review` : ""}`;
  }
  updateSettingsSummary();
  renderProgress();
}

function updateSettingsSummary() {
  if (!elements.settingsSummary) return;
  const settings = state.settings;
  const effectiveOutputs = state.prefs.continuityChain ? 1 : settings.outputCount;
  const consistency = [];
  if (state.prefs.useCharacters && state.prefs.characters.length > 0) {
    consistency.push(`characters ${state.prefs.characters.join(", ")}`);
  }
  if (state.prefs.applyCharacterAnchor && state.prefs.characterAnchor.trim()) consistency.push("identity anchor");
  if (state.sharedReferenceImages.length > 0) consistency.push(`${state.sharedReferenceImages.length} shared image${state.sharedReferenceImages.length === 1 ? "" : "s"}`);
  if (state.prefs.continuityChain) consistency.push("continuity chain (1 at a time, 1 output)");
  if (state.prefs.firstImageGate) consistency.push("first-image gate");
  elements.settingsSummary.textContent = `Uses Settings: aspect ${settings.aspectRatio} · ${effectiveOutputs} output${effectiveOutputs === 1 ? "" : "s"} · retries ${settings.maxRetries} · downloads ${settings.autoDownloadVideoQuality}/${settings.autoDownloadImageQuality}${consistency.length ? ` · consistency: ${consistency.join(", ")}` : ""}`;
}

function settingsForPlan(overrides = {}) {
  return {
    ...state.settings,
    characters: state.prefs.useCharacters ? state.prefs.characters : [],
    identityAnchor: state.prefs.applyCharacterAnchor ? state.prefs.characterAnchor : "",
    sharedReferenceImages: state.sharedReferenceImages,
    continuityChain: state.prefs.continuityChain,
    ...overrides,
  };
}

function sourcesForPlan(items = state.prompts) {
  return items.map((item) => ({
    ...item,
    characters: Array.isArray(item.charactersOverride) && item.charactersOverride.length > 0
      ? item.charactersOverride
      : undefined,
    referenceImages: promptReferenceImages(item),
  }));
}

function planFromState() {
  return buildBatchPlan(sourcesForPlan(), settingsForPlan());
}

function updateStartState() {
  if (!elements.status) return;
  const hasPrompts = state.prompts.length > 0;
  const reviewBlocked = state.prompts.some((item) => !item.mode);
  const ready = state.prompts.filter(
    (item) => !item.emptyAfterLabel && String(item.prompt || "").trim() && item.mode
      && (!isSourceMediaMode(item.mode) || effectiveReferenceImages(item).length > 0),
  ).length;

  elements.defaultMode.disabled = state.running;
  elements.review.disabled = state.running;
  elements.cancel.hidden = !state.running;
  elements.cancel.disabled = !state.running;

  if (state.running) {
    setError(state.lastBatchError);
  } else if (reviewBlocked) {
    setError("Choose a mode for every prompt marked for review before pressing Run.");
  } else if (hasPrompts && ready === 0) {
    setError("No prompts are ready. Attach the required reference images or switch those prompts to a text mode.");
  } else if (state.lastBatchError) {
    setError(state.lastBatchError);
  } else {
    setError("");
  }

  if (elements.progressDetail && !state.running && !state.summary) {
    elements.progressDetail.textContent = hasPrompts
      ? `Press the existing Run button to submit ${ready} ready prompt${ready === 1 ? "" : "s"}.`
      : "Paste prompts in the existing Prompts field above.";
  }
  updateRunVisual();
}

function renderProgress() {
  if (!elements.status) return;
  const plan = state.plan ?? planFromState();
  const summary = state.summary ?? summarizeBatch(plan.items, state.results, state.groupStatus);
  const total = summary.total;
  const completed = summary.completed;
  const active = state.running || Boolean(state.summary) || state.groupStatus !== "idle";

  if (!active) {
    elements.progressBar.style.width = "0%";
    elements.progress.setAttribute("aria-valuenow", "0");
    elements.counts.textContent = total === 0 ? "" : `${total} prompt${total === 1 ? "" : "s"}`;
    elements.status.textContent = "Ready";
    elements.cancel.hidden = true;
    updateRowStatuses(summary);
    return;
  }

  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  elements.progressBar.style.width = `${percentage}%`;
  elements.progress.setAttribute("aria-valuenow", String(percentage));
  elements.counts.textContent = total === 0
    ? ""
    : `${completed}/${total} completed · ${summary.failed} failed · ${summary.pending} pending`;
  elements.cancel.hidden = !state.running;
  elements.cancel.disabled = !state.running;

  if (state.running) {
    elements.status.textContent = state.gate.active && state.gate.awaiting
      ? "Waiting for reference image…"
      : state.cancelling
        ? "Cancelling…"
        : state.groupStatus === "queued"
          ? "Queued…"
          : state.backgroundMode
            ? "Running in background…"
            : "Running mixed batch…";
  } else if (state.groupStatus === "cancelled") {
    elements.status.textContent = "Cancelled";
  } else {
    elements.status.textContent = "Finished";
  }

  const latestProgress = [...state.progressByPrompt.values()].at(-1);
  if (state.gate.active && state.gate.awaiting) {
    elements.progressDetail.textContent = state.gate.downloadComplete
      ? "Prompt #1 downloaded. Upload that image below to run the remaining prompts."
      : "Prompt #1 finished. Wait for the download, then upload that image below.";
  } else if (state.running && latestProgress) {
    elements.progressDetail.textContent = `Prompt #${latestProgress.promptIndex}: ${latestProgress.status}${typeof latestProgress.percentage === "number" ? ` · ${latestProgress.percentage}%` : ""}`;
  } else if (state.running && state.groupInfo?.currentPromptIndex != null) {
    const queueIndex = state.groupInfo.currentPromptIndex;
    const promptIndex = state.groupInfo.promptIndices?.[queueIndex] ?? queueIndex + 1;
    elements.progressDetail.textContent = `Processing prompt #${promptIndex}`;
  } else if (state.summary) {
    elements.progressDetail.textContent = formatBatchSummary(state.summary);
  }

  updateRowStatuses(summary);
}

function updateRowStatuses(summary) {
  if (!elements.preview) return;
  const useSummary = state.running || Boolean(state.summary) || state.groupStatus !== "idle";
  const summaryRows = new Map(summary.rows.map((row) => [row.promptIndex, row]));
  for (const row of elements.preview.querySelectorAll(".fa-mixed-row")) {
    const promptIndex = Number(row.dataset.promptIndex);
    const item = state.prompts[promptIndex - 1];
    if (!item) continue;
    const status = row.querySelector(".fa-mixed-row-status");
    if (!status) continue;
    const summaryRow = useSummary ? summaryRows.get(promptIndex) : null;
    let label = "Ready";
    let kind = "ready";
    if (summaryRow) {
      label = summaryRow.status;
      kind = summaryRow.status;
    } else if (item.emptyAfterLabel || !String(item.prompt || "").trim()) {
      label = "Empty prompt";
      kind = "blocked";
    } else if (item.mode && isSourceMediaMode(item.mode) && effectiveReferenceImages(item).length === 0) {
      label = "Needs source image";
      kind = "blocked";
    } else if (!item.mode) {
      label = "Choose mode";
      kind = "blocked";
    }
    status.textContent = label;
    status.className = `fa-mixed-row-status is-${kind}`;
  }
}

function showSummary(summary) {
  if (!elements.summary) return;
  elements.summary.replaceChildren();
  elements.summary.hidden = false;

  const title = document.createElement("strong");
  title.className = "fa-mixed-summary-title";
  title.textContent = summary.status === "cancelled" ? "Mixed batch cancelled" : "Mixed batch summary";
  elements.summary.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "fa-mixed-summary-grid";
  for (const [label, value] of [
    ["Images", summary.imageSucceeded],
    ["Videos", summary.videoSucceeded],
    ["Failed", summary.failed],
    ["Downloads", summary.downloadsConfirmed],
    ["Pending", summary.pending],
  ]) {
    const item = document.createElement("div");
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);
    item.append(labelNode, valueNode);
    grid.appendChild(item);
  }
  elements.summary.appendChild(grid);

  const line = document.createElement("p");
  line.className = "fa-mixed-summary-line";
  line.textContent = formatBatchSummary(summary);
  elements.summary.appendChild(line);

  if (summary.errors.length > 0) {
    const list = document.createElement("ul");
    list.className = "fa-mixed-summary-errors";
    for (const error of summary.errors) {
      const item = document.createElement("li");
      item.textContent = `#${error.promptIndex} · ${modeLabel(error.mode)} · ${error.error || "Failed"}`;
      list.appendChild(item);
    }
    elements.summary.appendChild(list);
  }
}

function refreshFromTextarea(options = {}) {
  if (state.running) return;
  const textarea = findPromptTextarea(findControlPanel());
  if (!textarea) return;
  const text = textarea.value;
  if (!options.force && text === state.lastPromptText) return;
  state.lastPromptText = text;

  const previous = state.prompts;
  const classified = classifyPromptList(text, {
    defaultMode: state.prefs.defaultMode,
    reviewAmbiguous: state.prefs.reviewAmbiguous,
  });

  state.prompts = classified.map((prompt, index) => {
    const old = previous[index];
    const next = {
      ...prompt,
      prompt: prompt.cleanedPrompt,
      referenceImage: null,
      referenceImages: [],
      charactersOverride: null,
      promptExpanded: false,
      manualMode: false,
    };

    if (old && old.originalPrompt === prompt.originalPrompt) {
      next.referenceImage = old.referenceImage ?? null;
      next.referenceImages = promptReferenceImages(old);
      next.charactersOverride = Array.isArray(old.charactersOverride) ? [...old.charactersOverride] : null;
      next.promptExpanded = Boolean(old.promptExpanded);
      if (old.manualMode && old.mode) {
        next.mode = old.mode;
        next.needsReview = false;
        next.needsSourceMedia = isSourceMediaMode(old.mode);
        next.reason = "Mode corrected manually.";
        next.manualMode = true;
      }
    }

    return next;
  });

  resetFinishedBatch();
  renderPreview();
  updateStartState();

  if (state.prompts.length > 0) {
    const imageCount = state.prompts.filter((item) => item.mode && !isVideoMode(item.mode)).length;
    const videoCount = state.prompts.filter((item) => item.mode && isVideoMode(item.mode)).length;
    const ambiguous = state.prompts.filter((item) => !item.mode).length;
    appendLog(`Parsed ${state.prompts.length} prompt(s): ${imageCount} image, ${videoCount} video, ${ambiguous} needing a decision.`);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshFromTextarea(), 200);
}

function pollPromptText() {
  if (!state.mixedActive || state.running) return;
  const textarea = findPromptTextarea(findControlPanel());
  if (!textarea) return;
  if (textarea.value !== state.lastPromptText) refreshFromTextarea();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.query) {
      resolve(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] ?? null);
    });
  });
}

function sendTabMessageOnce(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function isMissingReceiverError(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error));
}

async function injectContentScript(tabId) {
  if (!chrome?.scripting?.executeScript) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/index.ts-loader-DxDJLJ1v.js"],
    });
    appendLog("Flow content script was not loaded; injected it into the active Flow tab.", "warn");
    return true;
  } catch (error) {
    appendLog(`Could not inject the Flow content script: ${error.message || error}`, "warn");
    return false;
  }
}

async function sendTabMessage(tabId, message) {
  try {
    return await sendTabMessageOnce(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;

    const injected = await injectContentScript(tabId);
    if (!injected) {
      throw new Error("The Flow content script is not loaded. Reload the Flow tab once, then try again.");
    }

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        return await sendTabMessageOnce(tabId, message);
      } catch (retryError) {
        if (!isMissingReceiverError(retryError)) throw retryError;
      }
    }

    throw new Error("The Flow tab did not respond. Reload the Flow tab once after updating the extension.");
  }
}

async function sendImage(tabId, id, image) {
  const json = JSON.stringify(image);
  const totalChunks = Math.ceil(json.length / MESSAGE_CHUNK_SIZE);
  if (totalChunks <= 1) {
    const response = await sendTabMessage(tabId, { type: "PREPARE_IMAGE", id, data: image });
    if (!response?.success) throw new Error(response?.error || "Could not prepare reference image");
    return response;
  }

  let response = null;
  for (let index = 0; index < totalChunks; index += 1) {
    response = await sendTabMessage(tabId, {
      type: "PREPARE_IMAGE_CHUNK",
      id,
      chunk: json.slice(index * MESSAGE_CHUNK_SIZE, (index + 1) * MESSAGE_CHUNK_SIZE),
      chunkIndex: index,
      totalChunks,
    });
  }
  if (!response?.success) throw new Error(response?.error || "Could not prepare chunked reference image");
  return response;
}

async function recordDailyPromptUsage(count) {
  if (!chrome?.storage?.local || count <= 0) return;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const values = await chrome.storage.local.get(["daily-prompt-count", "daily-prompt-date"]);
    const used = values?.["daily-prompt-date"] === date ? Number(values?.["daily-prompt-count"]) || 0 : 0;
    await chrome.storage.local.set({
      "daily-prompt-count": used + count,
      "daily-prompt-date": date,
    });
  } catch {}
}

async function cancelBatch() {
  if (!state.running || !state.groupId) return;
  if (state.gate.active && state.gate.awaiting) {
    appendLog("First-image gate cancelled. The remaining prompts were not submitted.", "warn");
    finalizeBatch("cancelled");
    return;
  }
  state.cancelling = true;
  renderProgress();
  appendLog("Cancellation requested through the existing prompt-group mechanism.", "warn");
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("No active Flow tab");
    const response = await sendTabMessage(tab.id, { type: "CANCEL_PROMPT_GROUP", groupId: state.groupId });
    if (!response?.success) {
      appendLog("The prompt group is still being prepared; cancellation will stop it before submission.", "warn");
    }
  } catch (error) {
    appendLog(`Cancellation did not reach a submitted group yet; the batch will stop before submission. ${error.message || error}`, "warn");
  }
}

async function startBatch(options = {}) {
  if (state.running || state.starting) return;
  state.starting = true;
  updateRunVisual();
  try {
    await runBatch(options);
  } catch (error) {
    state.lastBatchError = `Mixed batch failed: ${error.message || error}`;
    setError(state.lastBatchError);
    appendLog(state.lastBatchError, "error");
  } finally {
    state.starting = false;
    updateRunVisual();
  }
}

function finalizeBatch(terminalStatus, errorMessage = "") {
  if (!state.running) return;
  clearTimeout(state.backgroundCloseTimer);
  state.backgroundCloseTimer = null;
  state.running = false;
  state.starting = false;
  state.cancelling = false;
  state.backgroundMode = false;
  state.groupStatus = terminalStatus;
  state.summary = summarizeBatch(state.plan?.items || [], state.results, terminalStatus);
  state.lastBatchError = terminalStatus === "error" ? (errorMessage || "Mixed batch failed.") : "";
  state.gate = {
    active: false,
    awaiting: false,
    sending: false,
    downloadComplete: false,
    image: null,
  };
  state.lockedResults = [];
  state.batchId = "";
  if (elements.gateFile) elements.gateFile.value = "";
  renderGate();
  renderCharacterControls();
  renderSharedImages();
  renderPreview();
  renderProgress();
  showSummary(state.summary);
  updateStartState();
  if (state.lastBatchError) setError(state.lastBatchError);
  updateRunVisual();
  const label = terminalStatus === "completed" ? "finished" : terminalStatus;
  appendLog(`Mixed batch ${label}: ${formatBatchSummary(state.summary)}`, terminalStatus === "completed" ? "info" : "warn");
}

function closeSidePanelSoon() {
  clearTimeout(state.backgroundCloseTimer);
  state.backgroundCloseTimer = setTimeout(() => {
    state.backgroundCloseTimer = null;
    try {
      window.close();
    } catch {}
  }, 400);
}

async function runBatch(options = {}) {
  if (state.running) return;
  await loadSettingsAndPrefs();
  refreshFromTextarea({ force: true });
  if (state.running) return;

  const plan = planFromState();
  state.plan = plan;

  if (plan.items.length === 0) {
    state.lastBatchError = "Add at least one prompt in the existing Prompts field.";
    setError(state.lastBatchError);
    return;
  }

  if (plan.items.some((item) => item.needsReview)) {
    state.lastBatchError = "Choose a mode for every prompt marked for review before pressing Run.";
    setError(state.lastBatchError);
    return;
  }

  if (plan.settings.continuityChain && plan.items.some((item) => item.blockedReason)) {
    state.lastBatchError = "Chain prompts requires every prompt to be ready. Fix the blocked prompts or turn off Chain prompts.";
    setError(state.lastBatchError);
    return;
  }

  const gateEnabled = state.prefs.firstImageGate && plan.items.length > 1;
  if (gateEnabled && !isImageMode(plan.items[0].mode)) {
    state.lastBatchError = "First-image gate requires prompt #1 to be an image prompt.";
    setError(state.lastBatchError);
    return;
  }
  if (gateEnabled && plan.items.some((item) => item.blockedReason)) {
    state.lastBatchError = "First-image gate requires every prompt to be ready. Fix the blocked prompts or turn off the gate.";
    setError(state.lastBatchError);
    return;
  }
  if (gateEnabled && options.background) {
    state.lastBatchError = "First-image gate needs the side panel to stay open so you can upload the downloaded image.";
    setError(state.lastBatchError);
    return;
  }
  if (gateEnabled && plan.settings.autoDownloadImageQuality === "no-download") {
    state.lastBatchError = "First-image gate needs image downloads enabled so you can upload the first image.";
    setError(state.lastBatchError);
    return;
  }

  const { payloads, imageMap } = preparePayloadsForSend(plan.items);
  if (payloads.length === 0) {
    state.lastBatchError = "No prompts are ready to submit. Attach reference images or switch those prompts to a text mode.";
    setError(state.lastBatchError);
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id || !FLOW_URL_PATTERN.test(String(tab.url || ""))) {
    state.lastBatchError = "Open a Google Flow project tab before starting the mixed batch.";
    setError(state.lastBatchError);
    return;
  }

  state.batchId = `mixed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.groupId = state.batchId;
  state.running = true;
  state.cancelling = false;
  state.backgroundMode = Boolean(options.background);
  state.groupStatus = "running";
  state.results = [];
  state.lockedResults = [];
  state.groupInfo = null;
  state.progressByPrompt.clear();
  state.retryCounts = {};
  state.downloadRetryCounts = {};
  state.summary = null;
  state.lastBatchError = "";
  state.plan = plan;
  state.gate = {
    active: gateEnabled,
    awaiting: false,
    sending: false,
    downloadComplete: false,
    image: null,
  };
  renderGate();

  renderCharacterControls();
  renderSharedImages();

  elements.summary.hidden = true;
  elements.summary.replaceChildren();
  updateStartState();
  renderPreview();
  renderProgress();
  updateRunVisual();
  appendLog(`Mixed batch ${state.groupId}: ${payloads.length} prompt(s) ready, ${plan.items.length - payloads.length} blocked before submission.`);
  for (const item of plan.items) {
    if (item.payload) {
      const selectedBy = item.manualMode ? "manual" : item.classification?.confidence || "unknown";
      appendLog(`Prompt #${item.promptIndex}: ${modeLabel(item.mode)} selected (${selectedBy}).`);
    } else {
      appendLog(`Prompt #${item.promptIndex}: blocked — ${item.blockedReason}`, "warn");
    }
  }

  try {
    if (gateEnabled) {
      const firstSource = sourcesForPlan([state.prompts[0]])[0];
      const phaseOnePlan = buildBatchPlan([firstSource], settingsForPlan({
        outputCount: 1,
        concurrentPrompts: 1,
        continuityChain: false,
      }));
      const phaseOne = preparePayloadsForSend(phaseOnePlan.items);
      if (phaseOne.payloads.length === 0) {
        throw new Error("Prompt #1 is not ready to generate the first image.");
      }

      appendLog("First-image gate: running prompt #1 only. The batch will pause after its download.");
      const response = await submitGroup(tab, state.groupId, phaseOnePlan, phaseOne.payloads, phaseOne.imageMap);
      if (!state.running) return;
      if (response?.cancelled) {
        finalizeBatch("cancelled");
        return;
      }
      if (response?.success === false) {
        finalizeBatch("error", response?.error || "The Flow content script rejected the first prompt.");
        return;
      }
      await recordDailyPromptUsage(phaseOne.payloads.length);
      appendLog("Prompt #1 registered. Waiting for generation and download before pausing.");
      return;
    }

    const response = await submitGroup(tab, state.groupId, plan, payloads, imageMap);
    if (!state.running) return;
    if (response?.cancelled) {
      finalizeBatch("cancelled");
      return;
    }
    if (response?.success === false) {
      finalizeBatch("error", response?.error || "The Flow content script rejected the mixed batch.");
      return;
    }

    await recordDailyPromptUsage(payloads.length);
    appendLog("Mixed group registered with the Flow content script; waiting for generation and download statuses.");
    if (options.background) {
      appendLog("Background mode: the group will continue in the Flow tab if this side panel closes.", "info");
      if (elements.status) elements.status.textContent = "Running in background";
      if (elements.progressDetail) {
        elements.progressDetail.textContent = "Background batch started. Closing this side panel will not stop it.";
      }
      closeSidePanelSoon();
    }
  } catch (error) {
    if (!state.running) return;
    finalizeBatch("error", `Mixed batch failed: ${error.message || error}`);
  }
}

function handleRuntimeMessage(message) {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "PROMPT_GROUP_STATUS" && state.groupId && message.data?.id === state.groupId) {
    state.groupInfo = message.data;
    state.groupStatus = message.data.status || state.groupStatus;
    const incomingResults = Array.isArray(message.data.results) ? message.data.results : [];
    if (incomingResults.length > 0) {
      state.results = state.gate.active || state.lockedResults.length > 0
        ? [...state.lockedResults, ...incomingResults]
        : incomingResults;
    }

    const promptIndices = Array.isArray(message.data.promptIndices) ? message.data.promptIndices : [];
    const retryCounts = message.data.retryCountByIndex || {};
    for (const [queueIndex, count] of Object.entries(retryCounts)) {
      const previous = state.retryCounts[queueIndex] || 0;
      if (Number(count) > previous) {
        const promptIndex = promptIndices[Number(queueIndex)] ?? Number(queueIndex) + 1;
        appendLog(`Retry ${count} for prompt #${promptIndex}.`, "warn");
      }
    }
    state.retryCounts = { ...retryCounts };

    const downloadRetryCounts = message.data.downloadRetryCountByIndex || {};
    for (const [queueIndex, count] of Object.entries(downloadRetryCounts)) {
      const previous = state.downloadRetryCounts[queueIndex] || 0;
      if (Number(count) > previous) {
        const promptIndex = promptIndices[Number(queueIndex)] ?? Number(queueIndex) + 1;
        appendLog(`Download retry ${count} for prompt #${promptIndex}.`, "warn");
      }
    }
    state.downloadRetryCounts = { ...downloadRetryCounts };

    const status = message.data.status || state.groupStatus;
    if (state.gate.active) {
      const firstResult = incomingResults.find((result) => Number(result.promptIndex) === 1);
      if (state.gate.awaiting) {
        if (incomingResults.length > 0) state.lockedResults = incomingResults;
        state.results = [...state.lockedResults];
        if (firstResult) state.gate.downloadComplete = Boolean(firstResult.success && firstResult.downloadComplete);
        renderGate();
        renderProgress();
        return false;
      }
      if (firstResult?.success) {
        if (state.cancelling) {
          finalizeBatch("cancelled");
          return false;
        }
        state.lockedResults = incomingResults;
        state.results = [...incomingResults];
        state.gate.downloadComplete = Boolean(firstResult.downloadComplete);
        if (!state.gate.awaiting) {
          state.gate.awaiting = true;
          state.groupStatus = "paused";
          appendLog(
            firstResult.downloadComplete
              ? "First-image gate: prompt #1 generated and downloaded. Upload that image to continue."
              : "First-image gate: prompt #1 generated. Wait for its download, then upload that image to continue.",
            "info",
          );
        }
        state.summary = null;
        renderGate();
        renderProgress();
        updateStartState();
        return false;
      }

      if ((status === "completed" || status === "cancelled" || status === "error") && state.running) {
        finalizeBatch(
          status,
          status === "error" ? "The first prompt failed before the reference gate." : "",
        );
        return false;
      }
    }

    if (status === "completed" || status === "cancelled" || status === "error") {
      if (state.running) {
        const errorMessage = status === "error"
          ? "Mixed batch failed in the Flow content script. Check the batch log and Debug Logs."
          : "";
        finalizeBatch(status, errorMessage);
      }
      return false;
    }

    state.summary = null;
    renderProgress();
    return false;
  }

  if (message.type === "VIDEO_GENERATION_PROGRESS" && state.groupId && message.data?.groupId === state.groupId) {
    state.progressByPrompt.set(message.data.promptIndex, message.data);
    renderProgress();
    return false;
  }

  return false;
}

async function loadSettingsAndPrefs() {
  let stored = {};
  let prefs = {};
  try {
    if (chrome?.storage?.local) {
      const values = await chrome.storage.local.get([SETTINGS_KEY, PREFS_KEY]);
      stored = values?.[SETTINGS_KEY] || {};
      prefs = values?.[PREFS_KEY] || {};
    }
  } catch (error) {
    appendLog(`Could not read extension settings: ${error.message || error}`, "warn");
  }

  state.settings = normalizeSettings(stored);
  state.prefs.defaultMode = prefs.defaultMode === MODES.TEXT_TO_IMAGE
    ? MODES.TEXT_TO_IMAGE
    : prefs.defaultMode === MODES.TEXT_TO_VIDEO
      ? MODES.TEXT_TO_VIDEO
      : state.settings.defaultMode;
  state.prefs.reviewAmbiguous = Boolean(prefs.reviewAmbiguous);
  state.prefs.useCharacters = Boolean(prefs.useCharacters);
  state.prefs.characters = normalizeCharacters(prefs.characters);
  state.prefs.characterAnchor = typeof prefs.characterAnchor === "string"
    ? prefs.characterAnchor.slice(0, 600)
    : "";
  state.prefs.applyCharacterAnchor = prefs.applyCharacterAnchor !== false;
  state.prefs.continuityChain = Boolean(prefs.continuityChain);
  state.prefs.firstImageGate = Boolean(prefs.firstImageGate);

  if (elements.defaultMode) elements.defaultMode.value = state.prefs.defaultMode;
  if (elements.review) elements.review.checked = state.prefs.reviewAmbiguous;
  if (elements.characterAnchor) elements.characterAnchor.value = state.prefs.characterAnchor;
  if (elements.applyAnchor) elements.applyAnchor.checked = state.prefs.applyCharacterAnchor;
  if (elements.continuity) elements.continuity.checked = state.prefs.continuityChain;
  if (elements.firstImageGate) elements.firstImageGate.checked = state.prefs.firstImageGate;
  renderCharacterControls();
  updateSettingsSummary();
}

function savePrefs() {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.set({
    [PREFS_KEY]: {
      defaultMode: state.prefs.defaultMode,
      reviewAmbiguous: state.prefs.reviewAmbiguous,
      useCharacters: state.prefs.useCharacters,
      characters: state.prefs.characters,
      characterAnchor: state.prefs.characterAnchor,
      applyCharacterAnchor: state.prefs.applyCharacterAnchor,
      continuityChain: state.prefs.continuityChain,
      firstImageGate: state.prefs.firstImageGate,
    },
  }).catch(() => {});
}

function handleDocumentClick(event) {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button) return;
  const control = findControlPanel();
  if (!control) return;

  if (state.mixedActive && button === findRunButton(control)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!state.running && !state.starting) startBatch();
  }
}

function installUiHooks() {
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("input", (event) => {
    if (!state.mixedActive || state.running) return;
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("textarea.p-textarea")) {
      scheduleRefresh();
    }
  }, true);

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(() => {
    ensureUi();
    pollPromptText();
  }, 800);
}

async function init() {
  if (document.querySelector(".fa-mixed-mode-button")) return;
  if (chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  installUiHooks();
  ensureUi();
  await loadSettingsAndPrefs();
  ensureUi();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
