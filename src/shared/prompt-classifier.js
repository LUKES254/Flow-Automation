export const MODES = Object.freeze({
  TEXT_TO_IMAGE: "textToImage",
  TEXT_TO_VIDEO: "textToVideo",
  IMAGE_TO_VIDEO: "imageToVideo",
  IMAGE_TO_IMAGE: "imageToImage",
  COMPONENTS_TO_VIDEO: "componentsToVideo",
});

export const MODE_OPTIONS = Object.freeze([
  { value: MODES.TEXT_TO_IMAGE, label: "Text to Image", output: "image" },
  { value: MODES.TEXT_TO_VIDEO, label: "Text to Video", output: "video" },
  { value: MODES.IMAGE_TO_VIDEO, label: "Image to Video", output: "video" },
  { value: MODES.IMAGE_TO_IMAGE, label: "Image to Image", output: "image" },
  { value: MODES.COMPONENTS_TO_VIDEO, label: "Components to Video", output: "video" },
]);

export function isVideoMode(mode) {
  return mode === MODES.TEXT_TO_VIDEO || mode === MODES.IMAGE_TO_VIDEO || mode === MODES.COMPONENTS_TO_VIDEO;
}

export function isImageMode(mode) {
  return mode === MODES.TEXT_TO_IMAGE || mode === MODES.IMAGE_TO_IMAGE;
}

export function isSourceMediaMode(mode) {
  return mode === MODES.IMAGE_TO_VIDEO || mode === MODES.IMAGE_TO_IMAGE || mode === MODES.COMPONENTS_TO_VIDEO;
}

export function outputTypeForMode(mode) {
  return isVideoMode(mode) ? "video" : "image";
}

const LABEL_DEFINITIONS = [
  { key: "image to video", mode: MODES.IMAGE_TO_VIDEO, label: "IMAGE TO VIDEO" },
  { key: "frame to video", mode: MODES.IMAGE_TO_VIDEO, label: "FRAME TO VIDEO" },
  { key: "image to image", mode: MODES.IMAGE_TO_IMAGE, label: "IMAGE TO IMAGE" },
  { key: "components to video", mode: MODES.COMPONENTS_TO_VIDEO, label: "COMPONENTS TO VIDEO" },
  { key: "ingredients to video", mode: MODES.COMPONENTS_TO_VIDEO, label: "INGREDIENTS TO VIDEO" },
  { key: "still image", mode: MODES.TEXT_TO_IMAGE, label: "STILL IMAGE" },
  { key: "still photo", mode: MODES.TEXT_TO_IMAGE, label: "STILL PHOTO" },
  { key: "still frame", mode: MODES.TEXT_TO_IMAGE, label: "STILL FRAME" },
  { key: "still shot", mode: MODES.TEXT_TO_IMAGE, label: "STILL SHOT" },
  { key: "static image", mode: MODES.TEXT_TO_IMAGE, label: "STATIC IMAGE" },
  { key: "static photo", mode: MODES.TEXT_TO_IMAGE, label: "STATIC PHOTO" },
  { key: "static frame", mode: MODES.TEXT_TO_IMAGE, label: "STATIC FRAME" },
  { key: "single frame", mode: MODES.TEXT_TO_IMAGE, label: "SINGLE FRAME" },
  { key: "image prompt", mode: MODES.TEXT_TO_IMAGE, label: "IMAGE PROMPT" },
  { key: "video prompt", mode: MODES.TEXT_TO_VIDEO, label: "VIDEO PROMPT" },
  { key: "text to image", mode: MODES.TEXT_TO_IMAGE, label: "TEXT TO IMAGE" },
  { key: "text to video", mode: MODES.TEXT_TO_VIDEO, label: "TEXT TO VIDEO" },
  { key: "image edit", mode: MODES.IMAGE_TO_IMAGE, label: "IMAGE EDIT" },
  { key: "animate image", mode: MODES.IMAGE_TO_VIDEO, label: "ANIMATE IMAGE" },
  { key: "image generation", mode: MODES.TEXT_TO_IMAGE, label: "IMAGE GENERATION" },
  { key: "video generation", mode: MODES.TEXT_TO_VIDEO, label: "VIDEO GENERATION" },
  { key: "photo prompt", mode: MODES.TEXT_TO_IMAGE, label: "PHOTO PROMPT" },
  { key: "picture prompt", mode: MODES.TEXT_TO_IMAGE, label: "PICTURE PROMPT" },
  { key: "clip prompt", mode: MODES.TEXT_TO_VIDEO, label: "CLIP PROMPT" },
  { key: "img2img", mode: MODES.IMAGE_TO_IMAGE, label: "IMG2IMG" },
  { key: "image", mode: MODES.TEXT_TO_IMAGE, label: "IMAGE" },
  { key: "photo", mode: MODES.TEXT_TO_IMAGE, label: "PHOTO" },
  { key: "picture", mode: MODES.TEXT_TO_IMAGE, label: "PICTURE" },
  { key: "still", mode: MODES.TEXT_TO_IMAGE, label: "STILL" },
  { key: "video", mode: MODES.TEXT_TO_VIDEO, label: "VIDEO" },
  { key: "clip", mode: MODES.TEXT_TO_VIDEO, label: "CLIP" },
  { key: "animation", mode: MODES.TEXT_TO_VIDEO, label: "ANIMATION" },
  { key: "t2i", mode: MODES.TEXT_TO_IMAGE, label: "T2I" },
  { key: "t2v", mode: MODES.TEXT_TO_VIDEO, label: "T2V" },
  { key: "i2v", mode: MODES.IMAGE_TO_VIDEO, label: "I2V" },
  { key: "i2i", mode: MODES.IMAGE_TO_IMAGE, label: "I2I" },
  { key: "img", mode: MODES.TEXT_TO_IMAGE, label: "IMG" },
  { key: "vid", mode: MODES.TEXT_TO_VIDEO, label: "VID" },
].sort((left, right) => right.key.length - left.key.length);

const LABEL_BY_KEY = new Map(LABEL_DEFINITIONS.map((definition) => [definition.key, definition]));

const LIST_MARKER = /^\s*(?:[-*•]+|\d+[.)])\s+/;
const BULLET_OR_NUMBERED_LINE = /^\s*(?:[-*•]+|\d+[.)])\s+\S/;
const RULE_LINE = /^\s*[-=_]{3,}\s*$/;

const SOURCE_MEDIA_REFERENCE =
  /\b(?:(?:(?:this|the|my|attached|provided|uploaded|reference|source)\s+){1,2}(?:image|photo|picture)|(?:image|photo|picture)\s+(?:attached|provided|uploaded))\b/i;

function normalizeMediaReferences(text) {
  return text
    .replace(/\b(?:the|this|my|your)\s+(?:attached|provided|uploaded|reference|source)\s+(image|photo|picture)\b/gi, "the $1")
    .replace(/\b(?:attached|provided|uploaded|reference|source)\s+(image|photo|picture)\b/gi, "the $1");
}

const IMAGE_TO_VIDEO_PATTERNS = [
  /\b(?:image|photo|picture)\s*(?:to|-)\s*(?:video|clip|animation)\b/i,
  /\b(?:frame\s*(?:to|-)\s*video|i2v|img2vid)\b/i,
  /\b(?:animate|animating|bring\s+to\s+life)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\b/i,
  /\b(?:make|have|let|set)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\s+(?:move|animate|come\s+to\s+life)\b/i,
  /\b(?:turn|convert|transform|make)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\s+into\s+(?:a|an)?\s*(?:video|clip|animation|sequence|movie|footage)\b/i,
  /\b(?:use|using|from|based\s+on)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\b[\s\S]{0,100}\b(?:video|clip|animation|sequence|footage|animate|motion)\b/i,
  /\b(?:video|clip|animation|sequence|footage)\b[\s\S]{0,100}\b(?:use|using|from|based\s+on)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\b/i,
];

const IMAGE_TO_IMAGE_PATTERNS = [
  /\b(?:image|photo|picture)\s*(?:to|-)\s*(?:image|photo|picture)\b/i,
  /\b(?:i2i|img2img)\b/i,
  /\b(?:edit|transform|restyle|modify|enhance|rework|redesign|retouch|colorize|upscale)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\b/i,
  /\b(?:make|turn|convert)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\s+(?:look|appear)\s+(?:like|as)\b/i,
  /\b(?:turn|convert|transform|make)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\s+into\s+(?:a|an)?\s*(?:painting|illustration|drawing|sketch|cartoon|anime|watercolor|oil\s+painting|vector|poster|logo|render)\b/i,
  /\b(?:use|using|from|based\s+on)\s+(?:this|the|my|attached|provided|uploaded|reference|source)?\s*(?:image|photo|picture)\b[\s\S]{0,100}\b(?:image|picture|photo|illustration|painting|edit|restyle|transform)\b/i,
];

const VIDEO_INSTRUCTION_PATTERNS = [
  /\b(?:generate|create|make|render|produce|film|shoot)\s+(?:me\s+)?(?:an?|the)?\s*(?:(?:short|cinematic|slow[- ]motion|animated|hd|4k|vertical|horizontal|loop(?:ing)?|\d+(?:\.\d+)?[- ](?:second|sec|s))\s+)*(?:video|clip|animation|sequence|footage|movie|film)\b/i,
  /\b(?:animate|bring\s+to\s+life)\b/i,
  /\b(?:a|an|the)\s+(?:(?:short|cinematic|slow[- ]motion|animated|\d+(?:\.\d+)?[- ](?:second|sec|s))\s+)*(?:video|clip|animation|sequence|footage)\s+(?:of|showing|depicting|where|with|featuring)\b/i,
];

const IMAGE_INSTRUCTION_PATTERNS = [
  /\b(?:generate|create|make|render|draw|paint|illustrate|produce|design|depict)\s+(?:me\s+)?(?:an?|the)?\s*(?:(?:high[- ]quality|detailed|cinematic|photorealistic|ultra[- ]detailed|minimalist|8k|4k)\s+)*(?:image|picture|photo|photograph|illustration|artwork|painting|drawing|sketch|portrait|poster|logo|still|render)\b/i,
  /\b(?:image|picture|photo|photograph|illustration|artwork|painting|drawing|portrait|poster|logo)\s+(?:of|showing|depicting|featuring|with)\b/i,
  /\b(?:a|an)\s+(?:photorealistic|hyperrealistic|cinematic|studio|close-up|wide-angle|macro|portrait|landscape|product|fashion)\s+(?:photo|photograph|shot|portrait|image|picture)\b/i,
];

const VIDEO_MOTION_PATTERN =
  /\b(?:walks?|walking|runs?|running|sprints?|moves?|moving|turns?|turning|enters?|entering|leaving|sits?\s+down|sitting\s+down|stands?\s+up|standing\s+up|opens|opening|closes|closing|reaches?|grabs?|throws?|jumps?|flying|drives?|dancing|dances?|swims?|rising|approaches?|gestures?|waving|crawls?|climbs?|explodes?|spins?|rotates?|camera\s+(?:pans?|zooms?|dollies?|tracks?|orbits?|tilts?|moves?|follows?))\b|\bleaves\b(?=\s+(?:the|a|an|for|to|through|toward|towards|behind|from)\b)|\bflies\b(?=\s+(?:up|away|over|through|into|toward|towards|across|above|past|off|out|down)\b)|\bwaves?\b(?=\s+(?:at|to|goodbye|hello|back|his|her|their|its)\b)|\bfalls\b(?=\s+(?:down|off|into|onto|to|from|over|asleep|back|apart)\b)/i;

const VIDEO_DURATION_PATTERN = /\b\d+(?:\.\d+)?\s*[- ]?\s*(?:second|seconds|sec|secs|s)\b/i;
const VIDEO_SEQUENCE_PATTERN = /\b(?:cinematic\s+sequence|motion\s+sequence|slow[- ]motion|tracking\s+shot|dolly\s+shot)\b/i;

const IMAGE_STYLE_PATTERN =
  /\b(?:photorealistic|hyperrealistic|ultra[- ]detailed|high[- ]resolution|8k|4k|studio\s+lighting|cinematic\s+lighting|soft\s+lighting|watercolor|oil\s+painting|vector\s+art|flat\s+design|minimalist|isometric|pixel\s+art|line\s+art|anime\s+style|concept\s+art|product\s+shot|close-up|headshot|portrait|landscape|still\s+life|illustration|painting|drawing|sketch|logo|poster)\b/i;

const IMAGE_MEDIA_PATTERN =
  /\b(?:photo|photograph|image|picture|illustration|painting|drawing|sketch|artwork|portrait|poster|logo|still\s+life)\b/i;

export function normalizePromptText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function stripListMarker(text) {
  return normalizePromptText(text).replace(LIST_MARKER, "").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelBodyPattern(key) {
  return key
    .split(" ")
    .map(escapeRegExp)
    .join("(?:\\s+|\\s*[-–—_]\\s*)");
}

function buildLabelPatterns(key) {
  const body = labelBodyPattern(key);
  const wrappers = "(?:\\*\\*|__)?\\s*";
  const separator = `(?:(?:\\*\\*|__)?\\s*[:\\-–—=|]\\s*(?:\\*\\*|__)?\\s*)`;
  const separatorWithNumber = `(?:(?:\\*\\*|__)?\\s*#?\\d*\\s*[:\\-–—=|]\\s*(?:\\*\\*|__)?\\s*)`;
  const patterns = [
    new RegExp(`^${wrappers}${body}${wrappers}${separatorWithNumber}`, "i"),
    new RegExp(`^${wrappers}${body}${wrappers}${separator}`, "i"),
  ];
  if (key.endsWith(" prompt") || key.includes(" to ") || key.startsWith("animate ")) {
    patterns.push(new RegExp(`^${wrappers}${body}${wrappers}\\s+`, "i"));
  } else if ([
    "image", "video", "t2i", "t2v", "i2v", "i2i", "img2img", "img", "vid",
    "still image", "still photo", "still frame", "still shot",
    "static image", "static photo", "static frame", "single frame",
  ].includes(key)) {
    patterns.push(new RegExp(`^${wrappers}${body}${wrappers}\\s+(?=(?:a|an|the)\\b)`, "i"));
  }
  return patterns;
}

const LABEL_PATTERNS = LABEL_DEFINITIONS.flatMap((definition) =>
  buildLabelPatterns(definition.key).map((pattern) => ({ definition, pattern })),
);

const BRACKET_LABEL_PATTERN = /^\s*(?:\[|\(|\{)\s*([A-Za-z0-9][A-Za-z0-9\s/_-]*?)\s*(?:\]|\)|\})\s*(?:[:\-–—=|]\s*)?/;

export function hasExplicitLabel(text) {
  return extractLabel(text) !== null;
}

function extractLabel(value) {
  const text = stripListMarker(value);
  if (!text) return null;

  const bracketMatch = text.match(BRACKET_LABEL_PATTERN);
  if (bracketMatch) {
    const key = bracketMatch[1].toLowerCase().replace(/[_\s-]+/g, " ").trim();
    const definition = LABEL_BY_KEY.get(key);
    if (definition) {
      return { ...definition, rest: text.slice(bracketMatch[0].length).trim() };
    }
  }

  for (const { definition, pattern } of LABEL_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    return { ...definition, rest: text.slice(match[0].length).trim() };
  }

  return null;
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function chooseMode(mode, confidence, reason, extras = {}) {
  return {
    mode,
    kind: isVideoMode(mode) ? "video" : "image",
    confidence,
    reason,
    needsSourceMedia: isSourceMediaMode(mode),
    ambiguous: false,
    emptyAfterLabel: false,
    explicitLabel: null,
    ...extras,
  };
}

export function classifyPrompt(value) {
  const originalPrompt = normalizePromptText(value);
  const label = extractLabel(originalPrompt);
  const promptText = label ? label.rest : stripListMarker(originalPrompt);

  if (!promptText) {
    return {
      originalPrompt,
      cleanedPrompt: originalPrompt,
      mode: null,
      kind: "ambiguous",
      confidence: "ambiguous",
      reason: "The prompt is empty or only contains a mode label.",
      needsSourceMedia: false,
      ambiguous: true,
      emptyAfterLabel: Boolean(label),
      explicitLabel: label?.label ?? null,
    };
  }

  if (label) {
    return {
      originalPrompt,
      cleanedPrompt: promptText,
      mode: label.mode,
      kind: isVideoMode(label.mode) ? "video" : "image",
      confidence: "explicit-label",
      reason: `Explicit ${label.label} label.`,
      needsSourceMedia: isSourceMediaMode(label.mode),
      ambiguous: false,
      emptyAfterLabel: false,
      explicitLabel: label.label,
    };
  }

  const matchingText = normalizeMediaReferences(promptText);

  if (matchesAny(matchingText, IMAGE_TO_VIDEO_PATTERNS)) {
    return {
      ...chooseMode(MODES.IMAGE_TO_VIDEO, "media-instruction", "Prompt asks to animate or turn a referenced image into a video."),
      originalPrompt,
      cleanedPrompt: promptText,
      needsSourceMedia: true,
    };
  }

  if (matchesAny(matchingText, IMAGE_TO_IMAGE_PATTERNS)) {
    return {
      ...chooseMode(MODES.IMAGE_TO_IMAGE, "media-instruction", "Prompt asks to edit or transform a referenced image."),
      originalPrompt,
      cleanedPrompt: promptText,
      needsSourceMedia: true,
    };
  }

  const hasSourceMedia = SOURCE_MEDIA_REFERENCE.test(matchingText);
  const hasVideoInstruction = matchesAny(matchingText, VIDEO_INSTRUCTION_PATTERNS);
  const hasImageInstruction = matchesAny(matchingText, IMAGE_INSTRUCTION_PATTERNS);

  if (hasVideoInstruction && hasSourceMedia) {
    return {
      ...chooseMode(MODES.IMAGE_TO_VIDEO, "media-instruction", "Video instruction references supplied source media."),
      originalPrompt,
      cleanedPrompt: promptText,
      needsSourceMedia: true,
    };
  }

  if (hasImageInstruction && hasSourceMedia) {
    return {
      ...chooseMode(MODES.IMAGE_TO_IMAGE, "media-instruction", "Image instruction references supplied source media."),
      originalPrompt,
      cleanedPrompt: promptText,
      needsSourceMedia: true,
    };
  }

  if (hasVideoInstruction) {
    return {
      ...chooseMode(MODES.TEXT_TO_VIDEO, "explicit-instruction", "Prompt contains an explicit video-generation instruction."),
      originalPrompt,
      cleanedPrompt: promptText,
    };
  }

  if (hasImageInstruction) {
    return {
      ...chooseMode(MODES.TEXT_TO_IMAGE, "explicit-instruction", "Prompt contains an explicit image-generation instruction."),
      originalPrompt,
      cleanedPrompt: promptText,
    };
  }

  const hasVideoMotion = VIDEO_MOTION_PATTERN.test(promptText);
  const hasVideoDuration = VIDEO_DURATION_PATTERN.test(promptText);
  const hasVideoSequence = VIDEO_SEQUENCE_PATTERN.test(promptText);
  const hasImageStyle = IMAGE_STYLE_PATTERN.test(promptText);
  const hasImageMedia = IMAGE_MEDIA_PATTERN.test(promptText);

  if (hasVideoMotion || hasVideoDuration || hasVideoSequence) {
    return {
      ...chooseMode(MODES.TEXT_TO_VIDEO, "heuristic", "Prompt describes motion, camera movement, or a timed sequence."),
      originalPrompt,
      cleanedPrompt: promptText,
    };
  }

  if (hasImageStyle || hasImageMedia) {
    return {
      ...chooseMode(MODES.TEXT_TO_IMAGE, "heuristic", "Prompt uses static visual or image-style language."),
      originalPrompt,
      cleanedPrompt: promptText,
    };
  }

  return {
    originalPrompt,
    cleanedPrompt: promptText,
    mode: null,
    kind: "ambiguous",
    confidence: "ambiguous",
    reason: "No clear image or video generation intent was found.",
    needsSourceMedia: false,
    ambiguous: true,
    emptyAfterLabel: false,
    explicitLabel: null,
  };
}

export function resolvePromptMode(classification, options = {}) {
  const defaultMode = options.defaultMode === MODES.TEXT_TO_IMAGE ? MODES.TEXT_TO_IMAGE : MODES.TEXT_TO_VIDEO;
  const reviewAmbiguous = Boolean(options.reviewAmbiguous);

  if (!classification.ambiguous && classification.mode) {
    return {
      ...classification,
      mode: classification.mode,
      needsReview: false,
      selectedBy: classification.confidence,
    };
  }

  if (reviewAmbiguous) {
    return {
      ...classification,
      mode: null,
      needsReview: true,
      selectedBy: "review",
      reason: `${classification.reason} Marked for review.`,
    };
  }

  return {
    ...classification,
    mode: defaultMode,
    kind: isVideoMode(defaultMode) ? "video" : "image",
    needsReview: false,
    selectedBy: "default",
    reason: `${classification.reason} Default mode applied.`,
  };
}

export function classifyPromptList(value, options = {}) {
  return parsePromptList(value).map((prompt, index) => ({
    ...resolvePromptMode(classifyPrompt(prompt), options),
    index,
  }));
}

export function parsePromptList(value) {
  const text = normalizePromptText(value)
    .split("\n")
    .map((line) => (RULE_LINE.test(line) ? "" : line))
    .join("\n");

  if (!text) return [];

  const blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const prompts = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length <= 1) {
      prompts.push(stripListMarker(block));
      continue;
    }

    if (lines.some((line) => hasExplicitLabel(line))) {
      let current = [];
      for (const line of lines) {
        if (hasExplicitLabel(line) && current.length > 0) {
          prompts.push(stripListMarker(current.join("\n")));
          current = [];
        }
        current.push(stripListMarker(line));
      }
      if (current.length > 0) prompts.push(current.join("\n").trim());
      continue;
    }

    if (lines.every((line) => BULLET_OR_NUMBERED_LINE.test(line))) {
      prompts.push(...lines.map(stripListMarker));
      continue;
    }

    prompts.push(stripListMarker(block));
  }

  return prompts.filter(Boolean);
}
