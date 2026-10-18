import {
  MODES,
  isImageMode,
  isSourceMediaMode,
  isVideoMode,
  outputTypeForMode,
} from "./prompt-classifier.js";

export const DEFAULT_SETTINGS = Object.freeze({
  defaultMode: MODES.TEXT_TO_VIDEO,
  aspectRatio: "16:9",
  concurrentPrompts: 1,
  outputCount: 2,
  promptDelaySecondsMin: 0,
  promptDelaySecondsMax: 20,
  model: "Veo 3.1 - Lite",
  defaultVideoOption: "8s",
  defaultImageOption: "new-image",
  imageModel: "🍌 Nano Banana 2",
  autoDownloadVideoQuality: "720",
  autoDownloadImageQuality: "1k",
  maxRetries: 2,
  autoChangeFileName: true,
  folderName: "veo-folder-1",
  enableCharacterControl: false,
  characters: [],
  identityAnchor: "",
  applyIdentityAnchor: true,
  sharedReferenceImages: [],
  continuityChain: false,
});

const MAX_CHARACTERS = 8;
const MAX_CHARACTER_NAME_LENGTH = 80;
const MAX_IDENTITY_ANCHOR_LENGTH = 600;
const MAX_REFERENCE_IMAGES = 6;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerInRange(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(finiteNumber(value, fallback))));
}

function stringValue(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeCharacters(value) {
  if (!value) return [];
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : typeof value === "object"
        ? Object.values(value)
        : [];

  const seen = new Set();
  const characters = [];
  for (const entry of source) {
    const name = String(entry ?? "").trim();
    if (!name || name.length > MAX_CHARACTER_NAME_LENGTH) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    characters.push(name);
    if (characters.length >= MAX_CHARACTERS) break;
  }
  return characters;
}

function normalizeIdentityAnchor(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_IDENTITY_ANCHOR_LENGTH);
}

export function normalizeVideoOption(value) {
  const option = stringValue(value, DEFAULT_SETTINGS.defaultVideoOption);
  return option.endsWith("-concat") ? option.slice(0, -"-concat".length) : option;
}

export function normalizeSettings(raw = {}) {
  const settings = raw && typeof raw === "object" ? raw : {};
  const minDelay = Math.max(0, finiteNumber(settings.promptDelaySecondsMin, DEFAULT_SETTINGS.promptDelaySecondsMin));
  const maxDelay = Math.max(minDelay, finiteNumber(settings.promptDelaySecondsMax, DEFAULT_SETTINGS.promptDelaySecondsMax));
  const defaultMode = settings.defaultMode === MODES.TEXT_TO_IMAGE ? MODES.TEXT_TO_IMAGE : MODES.TEXT_TO_VIDEO;
  const continuityChain = booleanValue(settings.continuityChain, DEFAULT_SETTINGS.continuityChain);

  return {
    defaultMode,
    aspectRatio: stringValue(settings.aspectRatio, DEFAULT_SETTINGS.aspectRatio).trim() || DEFAULT_SETTINGS.aspectRatio,
    concurrentPrompts: continuityChain
      ? 1
      : integerInRange(settings.concurrentPrompts, DEFAULT_SETTINGS.concurrentPrompts, 1, 6),
    outputCount: continuityChain
      ? 1
      : integerInRange(settings.outputCount, DEFAULT_SETTINGS.outputCount, 1, 4),
    promptDelaySecondsMin: minDelay,
    promptDelaySecondsMax: maxDelay,
    model: stringValue(settings.model, DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
    defaultVideoOption: normalizeVideoOption(settings.defaultVideoOption),
    defaultImageOption: stringValue(settings.defaultImageOption, DEFAULT_SETTINGS.defaultImageOption),
    imageModel: stringValue(settings.imageModel, DEFAULT_SETTINGS.imageModel).trim() || DEFAULT_SETTINGS.imageModel,
    autoDownloadVideoQuality: stringValue(settings.autoDownloadVideoQuality, DEFAULT_SETTINGS.autoDownloadVideoQuality),
    autoDownloadImageQuality: stringValue(settings.autoDownloadImageQuality, DEFAULT_SETTINGS.autoDownloadImageQuality),
    maxRetries: integerInRange(settings.maxRetries, DEFAULT_SETTINGS.maxRetries, 0, 10),
    autoChangeFileName: booleanValue(settings.autoChangeFileName, DEFAULT_SETTINGS.autoChangeFileName),
    folderName: stringValue(settings.folderName, DEFAULT_SETTINGS.folderName).trim(),
    enableCharacterControl: booleanValue(settings.enableCharacterControl, DEFAULT_SETTINGS.enableCharacterControl),
    characters: normalizeCharacters(
      settings.characters ?? (settings.enableCharacterControl ? settings.defaultCharacters : []),
    ),
    identityAnchor: normalizeIdentityAnchor(settings.identityAnchor),
    applyIdentityAnchor: booleanValue(settings.applyIdentityAnchor, DEFAULT_SETTINGS.applyIdentityAnchor),
    sharedReferenceImages: normalizeReferenceImages(settings.sharedReferenceImages),
    continuityChain,
  };
}

export function normalizeReferenceImage(referenceImage) {
  if (!referenceImage || typeof referenceImage !== "object") return null;
  const base64 = typeof referenceImage.base64 === "string" ? referenceImage.base64 : "";
  const name = typeof referenceImage.name === "string" ? referenceImage.name.trim() : "";
  if (!base64 || !name) return null;
  return { base64, name };
}

export function normalizeReferenceImages(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const images = [];
  for (const candidate of source) {
    const image = normalizeReferenceImage(candidate);
    if (!image) continue;
    const key = `${image.name}\u0000${image.base64.slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push(image);
    if (images.length >= MAX_REFERENCE_IMAGES) break;
  }
  return images;
}

function referenceImagesFor(item, settings) {
  const own = normalizeReferenceImages(item.referenceImages?.length ? item.referenceImages : item.referenceImage);
  if (own.length > 0) return { images: own, shared: false };
  if (isSourceMediaMode(item.mode)) {
    const shared = normalizeReferenceImages(settings.sharedReferenceImages);
    if (shared.length > 0) return { images: shared, shared: true };
  }
  return { images: [], shared: false };
}

export function resolveCharacters(item, settings) {
  const override = normalizeCharacters(item.characters);
  if (override.length > 0) return override;
  return normalizeCharacters(settings.characters);
}

function supportsIdentityAnchor(mode) {
  return mode === MODES.TEXT_TO_IMAGE
    || mode === MODES.TEXT_TO_VIDEO
    || mode === MODES.COMPONENTS_TO_VIDEO;
}

export function applyIdentityAnchor(prompt, anchor, mode) {
  const text = String(prompt ?? "").trim();
  const reference = normalizeIdentityAnchor(anchor);
  if (!text || !reference || !supportsIdentityAnchor(mode)) return text;
  if (text.toLowerCase().includes(reference.toLowerCase())) return text;
  return `Character reference: ${reference.replace(/[.\s]+$/, "")}. ${text}`;
}

export function attachAnchorReference(prompts, anchorImage, fromIndex = 1) {
  const reference = normalizeReferenceImage(anchorImage);
  if (!reference || !Array.isArray(prompts)) return prompts;

  return prompts.map((prompt, index) => {
    if (index < fromIndex) return prompt;

    let mode = prompt.mode ?? null;
    if (mode === MODES.TEXT_TO_VIDEO) mode = MODES.COMPONENTS_TO_VIDEO;
    else if (mode === MODES.TEXT_TO_IMAGE) mode = MODES.IMAGE_TO_IMAGE;

    const existing = normalizeReferenceImages(
      prompt.referenceImages?.length ? prompt.referenceImages : prompt.referenceImage,
    );
    const referenceImages = normalizeReferenceImages([reference, ...existing]);

    return {
      ...prompt,
      mode,
      referenceImage: referenceImages[0] ?? reference,
      referenceImages,
      needsSourceMedia: isSourceMediaMode(mode),
    };
  });
}

export function buildPayloadForPrompt(item, settings, promptIndex) {
  const mode = item.mode;
  const video = isVideoMode(mode);
  const { images } = referenceImagesFor(item, settings);
  const characters = resolveCharacters(item, settings);
  const identityAnchor = normalizeIdentityAnchor(item.identityAnchor ?? settings.identityAnchor);
  const payload = {
    prompt: applyIdentityAnchor(item.prompt, settings.applyIdentityAnchor ? identityAnchor : "", mode),
    mode,
    characters: characters.length > 0 ? characters : null,
    speaker: null,
    aspectRatio: settings.aspectRatio,
    outputCount: settings.outputCount,
    model: video ? settings.model : settings.imageModel,
    promptIndex,
    autoDownloadResourceQuality: video
      ? settings.autoDownloadVideoQuality
      : settings.autoDownloadImageQuality,
    concurrentPrompts: settings.concurrentPrompts,
    promptDelaySecondsMin: settings.promptDelaySecondsMin,
    promptDelaySecondsMax: settings.promptDelaySecondsMax,
    isConcat: Boolean(item.isConcat),
    maxRetries: settings.maxRetries,
    autoChangeFileName: settings.autoChangeFileName,
    folderName: settings.folderName,
  };

  if (video) payload.videoOption = settings.defaultVideoOption;
  if (isSourceMediaMode(mode)) payload.images = images;
  return payload;
}

export function buildBatchPlan(prompts, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const items = prompts.map((prompt, index) => {
    const mode = prompt.mode ?? null;
    const { images: referenceImages, shared } = referenceImagesFor({ ...prompt, mode }, settings);
    const characters = resolveCharacters(prompt, settings);
    const identityAnchor = normalizeIdentityAnchor(prompt.identityAnchor ?? settings.identityAnchor);
    const nextPrompt = prompts[index + 1];
    const chainToNext = Boolean(
      settings.continuityChain
      && mode
      && nextPrompt?.mode
      && isVideoMode(mode) === isVideoMode(nextPrompt.mode),
    );
    const base = {
      index,
      promptIndex: index + 1,
      prompt: String(prompt.cleanedPrompt ?? prompt.prompt ?? "").trim(),
      mode,
      outputType: mode ? outputTypeForMode(mode) : prompt.kind === "video" ? "video" : "image",
      needsSourceMedia: mode ? isSourceMediaMode(mode) : Boolean(prompt.needsSourceMedia),
      needsReview: Boolean(prompt.needsReview),
      referenceImage: referenceImages[0] ?? null,
      referenceImages,
      usesSharedReference: shared,
      characters,
      identityAnchor,
      chainToNext,
      isConcat: chainToNext,
      originalPrompt: prompt.originalPrompt ?? prompt.prompt ?? "",
      classification: prompt,
      blockedReason: null,
      payload: null,
    };

    if (!mode) {
      base.blockedReason = base.needsReview
        ? "Ambiguous prompt marked for review. Choose an image or video mode before starting."
        : "No generation mode could be assigned.";
      return base;
    }

    if (base.needsReview) {
      base.blockedReason = "Ambiguous prompt marked for review. Choose an image or video mode before starting.";
      return base;
    }

    if (base.needsSourceMedia && referenceImages.length === 0) {
      base.blockedReason = `Reference image required for ${mode}. Attach an image or switch the prompt mode.`;
      return base;
    }

    if (prompt.emptyAfterLabel || !base.prompt) {
      base.blockedReason = "Prompt text is empty after removing its mode label.";
      return base;
    }

    base.payload = buildPayloadForPrompt(base, settings, base.promptIndex);
    return base;
  });

  const payloads = items.filter((item) => item.payload).map((item) => item.payload);
  return { settings, items, payloads };
}

export function preparePayloadsForSend(items) {
  const imageMap = {};
  const payloads = [];

  for (const item of items) {
    if (!item.payload) continue;
    const payload = { ...item.payload };

    if (Array.isArray(payload.images) && payload.images.length > 0) {
      payload.imageIds = payload.images.map((image, imageIndex) => {
        const safeName = image.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const id = `mixed-${item.promptIndex}-${imageIndex}-${safeName}`;
        imageMap[id] = { base64: image.base64, name: image.name };
        return id;
      });
      delete payload.images;
    }

    payloads.push(payload);
  }

  return { payloads, imageMap };
}

export function clonePayloadForRetry(payload) {
  return {
    ...payload,
    mode: payload.mode,
    characters: Array.isArray(payload.characters) ? [...payload.characters] : payload.characters,
    images: Array.isArray(payload.images) ? payload.images.map((image) => ({ ...image })) : payload.images,
    imageIds: Array.isArray(payload.imageIds) ? [...payload.imageIds] : payload.imageIds,
  };
}

function resultForItem(item, results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  return (
    results.find((result) => result && result.promptIndex === item.promptIndex) ??
    results.find((result) => result && result.index === item.index) ??
    null
  );
}

export function summarizeBatch(items, results = [], groupStatus = "running") {
  const rows = items.map((item) => {
    if (item.blockedReason) {
      return {
        ...item,
        status: "failed",
        success: false,
        downloadComplete: false,
        error: item.blockedReason,
      };
    }

    const result = resultForItem(item, results);
    if (!result) {
      return { ...item, status: "pending", success: false, downloadComplete: false, error: null };
    }

    return {
      ...item,
      status: result.success ? "completed" : "failed",
      success: Boolean(result.success),
      downloadComplete: Boolean(result.downloadComplete),
      error: result.error ?? null,
    };
  });

  const succeeded = rows.filter((row) => row.status === "completed");
  const failed = rows.filter((row) => row.status === "failed");
  const pending = rows.filter((row) => row.status === "pending");
  const imageSucceeded = succeeded.filter((row) => isImageMode(row.mode)).length;
  const videoSucceeded = succeeded.filter((row) => isVideoMode(row.mode)).length;
  const downloadsConfirmed = succeeded.filter((row) => row.downloadComplete).length;
  const downloadsPending = succeeded.filter((row) => !row.downloadComplete).length;

  return {
    status: groupStatus,
    total: rows.length,
    completed: rows.length - pending.length,
    pending: pending.length,
    failed: failed.length,
    succeeded: succeeded.length,
    imageSucceeded,
    videoSucceeded,
    downloadsConfirmed,
    downloadsPending,
    blocked: items.filter((item) => Boolean(item.blockedReason)).length,
    rows,
    errors: failed.map((row) => ({
      promptIndex: row.promptIndex,
      mode: row.mode,
      error: row.error,
    })),
  };
}

export function formatBatchSummary(summary) {
  const parts = [
    `${summary.imageSucceeded} image${summary.imageSucceeded === 1 ? "" : "s"} succeeded`,
    `${summary.videoSucceeded} video${summary.videoSucceeded === 1 ? "" : "s"} succeeded`,
    `${summary.failed} failed`,
  ];

  if (summary.downloadsConfirmed > 0) {
    parts.push(`${summary.downloadsConfirmed} download${summary.downloadsConfirmed === 1 ? "" : "s"} confirmed`);
  }
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked before submission`);

  return parts.join(" · ");
}
