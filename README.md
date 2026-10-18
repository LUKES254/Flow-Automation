<div align="center">

# Flow Automation

Batch prompt automation and media downloader Chrome extension for Google Flow.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/Version-1.0-4F46E5.svg)](https://github.com/Yeamin-Sheikh/Flow-Automation/releases/tag/v1.0)
[![Platform](https://img.shields.io/badge/Platform-Chrome-4285F4.svg)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

Flow Automation is a Chrome extension for batch prompt automation and automatic media downloading on Google Flow (flow.google.com). It runs inside Chrome's native side panel, allowing you to queue multi-line prompts, upload prompt files, configure randomized intervals, and save generated video and image files directly to local storage.

The extension operates with full offline autonomy. All 58 DOM automation selectors run locally in the browser with no external server dependencies, user accounts, or prompt limits.

---

## Supported automation modes

| Mode | Input | Google Flow target | Output |
|---|---|---|---|
| Text to Video | Written prompt list | Veo video models | MP4 video files |
| Image to Video | Reference image + prompt | Keyframe animation | MP4 video files |
| Components to Video | Character, scene, ingredients + prompt | Multi-ingredient video pipeline | MP4 video files |
| Text to Image | Written prompt list | Imagen models | WebP / PNG image files |
| Image to Image | Reference images + prompt | Image variation pipeline | WebP / PNG image files |
| Agent Automation | Multi-turn directorial prompts | Flow Agent creative engine | Full project outputs |
| Mixed Image + Video | One mixed prompt list | Per-prompt image or video mode | Mixed image and video files |

---

## Capabilities

- Batch prompt input: Enter prompts manually, upload `.txt` files, or import `.xlsx` and `.csv` spreadsheets.
- Mixed-mode batches: Use the Mixed Image + Video mode, paste both prompt types into the existing Prompts field, and let the local classifier assign each prompt's Flow mode.
- Execution controls: Configure prompt concurrency and random delay intervals to avoid rate limits.
- Automated media extraction: Detects finished generation tiles on the canvas and triggers background downloads automatically.
- Resolution selection: Supports 1080p, 2K, and 4K downloads when available in Google Flow.
- Custom file routing: Define download folder names and filename prefixes for structured media organization.
- Local selector engine: Bundles all 58 Google Flow DOM selectors locally, eliminating external configuration dependencies.
- English interface: Stripped of secondary language dictionaries to reduce bundle size to 1.1 MB.
- Streamlined layout: Control tabs start directly at the top of the side panel without header clutter.

---

## Installation

### Option 1: Load from release archive

1. Download `Flow-Automation-v1.0.zip` from the [Releases page](https://github.com/Yeamin-Sheikh/Flow-Automation/releases/tag/v1.0).
2. Extract the zip archive to a local folder on your computer.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Turn on the Developer mode toggle in the top-right corner.
5. Click the "Load unpacked" button in the top-left menu.
6. Select the extracted folder containing `manifest.json`.

### Option 2: Clone from source

1. Clone the repository locally:
   ```bash
   git clone https://github.com/Yeamin-Sheikh/Flow-Automation.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable Developer mode.
4. Click "Load unpacked" and select the cloned directory.

---

## How to use

1. Navigate to [flow.google.com](https://flow.google.com) and sign in to your Google account.
2. Click the Flow Automation icon in the Chrome toolbar or open the Chrome side panel.
3. Select your desired generation mode under the Control tab (such as Text to Video or Components to Video).
4. Set execution parameters:
   - Concurrency: Number of prompts processed simultaneously.
   - Random delay: Minimum and maximum pause between consecutive submissions in seconds.
   - Resolution: Choose preferred download quality (1080p, 2K, or 4K).
5. Add prompts in the Prompts field, or upload a `.txt` or `.xlsx` file.
6. Click Start. The extension interacts with Google Flow, submits each prompt, waits for generation, and saves the resulting files into your configured folder.

---

## Mixed image and video prompts

When one list contains both image and video requests, use the **Mixed Image + Video** mode button added to the existing mode selector row.

1. Open a Google Flow project tab, then open the Flow Automation side panel.
2. Click **Mixed Image + Video** in the existing mode selector. The existing Prompts field, concurrency and delay controls, prompt queue, and Run button remain in place. Mixed mode is independent of the base mode tabs: you can keep Text to Video or Text to Image selected at the same time. Per-prompt modes still come from the preview.
3. Paste the full list into the existing **Prompts** field. Prompts can be separated by blank lines, or each labeled prompt can be placed on its own line.
4. Review the inline preview below the Prompts field. Change any prompt's inferred mode, attach reference images for source-media modes, and choose the default mode for ambiguous prompts. Turn on **Mark ambiguous prompts for review** if you want to decide every ambiguous prompt manually.
5. Press the existing **Run** button. The extension intercepts that Run action, builds one mixed group, and submits it through the existing queue. There is no second Start button or separate mixed-batch dialog.
6. Watch the existing prompt queue and the inline mixed summary. Use the inline **Cancel mixed batch** action or the existing queue Stop action to cancel.
7. To leave the panel, use **Background** next to the existing Run button. It registers the mixed group first, then attempts to close the side panel. The Flow tab continues generation, retries, and downloads in the background.
8. The final summary separates successful images, successful videos, failures, blocked prompts, and confirmed downloads.

### Where the controls live

- **Prompts** — the existing multiline Prompts field.
- **Mixed options** — the inline panel below the existing Prompts controls.
- **Start** — the existing Run button in the prompt queue card.
- **Background** — the button added next to Run; it starts the mixed batch and lets it continue after the side panel closes.
- **Cancel** — the inline Cancel mixed batch action or the existing queue Stop action.
- **Progress** — the existing prompt queue plus the inline mixed summary.
- **Character consistency** — the inline panel below the mixed options: attach scanned Flow characters, edit the identity anchor, add shared reference images, enable the continuity chain, and use the first-image gate.
- **Settings** — the existing Setting tab and the concurrency/delay fields on the Control tab. Character, voice, image-mode, and concat controls in the active Control form are not applied to mixed batches; character attachment and identity anchoring come from the inline Character consistency panel, and mode selection comes from the preview.

### Classification rules

The classifier runs locally and never calls an AI API. It recognizes:

- Explicit labels such as `IMAGE:`, `IMAGE PROMPT -`, `TEXT TO IMAGE`, `STILL IMAGE`, `STILL PHOTO`, `STILL FRAME`, `STILL SHOT`, `STATIC IMAGE`, `SINGLE FRAME`, `VIDEO:`, `VIDEO PROMPT`, `TEXT TO VIDEO`, `IMAGE TO VIDEO`, `FRAME TO VIDEO`, `IMAGE TO IMAGE`, `COMPONENTS TO VIDEO`, `INGREDIENTS TO VIDEO`, `I2I`, `I2V`, `T2I`, `T2V`, and `IMG2IMG`.
- Case, markdown, brackets, numbering, and punctuation variations.
- Clear instructions such as `Generate an image of...`, `Create a 5-second video...`, `Animate a stickman...`, `Animate this image...`, and `Transform this photo...`.
- Unlabelled image descriptions and motion-based video descriptions.

Recognized labels are removed before submission. The rest of the creative prompt, punctuation, line breaks, and details are preserved. Bare mentions such as a television playing a video inside an image description do not override a clear image instruction, and an image mentioned inside a video prompt does not override a clear video instruction.

### Source-media prompts

Prompts classified as **Image to Video**, **Image to Image**, or **Components to Video** need a source image:

- Attach a reference image in that prompt's row before starting.
- If no image is attached, the prompt is reported as blocked and is not submitted in the wrong mode.
- Image-to-video, image-to-image, and components-to-video use the existing upload, mode-switching, generation, and download paths.
- **Components to Video** can be selected manually in any row and uses the attached reference images. Character, speaker, and multi-ingredient controls remain available in the original Control tab.
- Agent Automation remains in the original Control tab because it uses multi-turn directorial settings rather than a single mixed prompt.

### Character consistency

Mixed batches no longer drop the character settings. Use the **Character consistency** panel to keep the same subject across independently generated prompts:

- **Attach Flow characters** — press **Scan Characters** to list the characters saved in the current Flow project, then select one or more. Selected characters are submitted with every prompt through Flow's native `@`-mention character attachment. The prompt text should mention the same character names so Flow places the mentions inline; otherwise Flow mentions the characters at the start of the prompt.
- **Per-row override** — a row's character field overrides the global selection for that prompt only. Leave it blank to use the global characters. Use the exact names returned by the scan.
- **Identity anchor** — optional prose that describes the character's immutable appearance. When **Prepend the anchor** is enabled, the anchor is added once to text-to-image, text-to-video, and ingredients prompts. It is not added to image-to-image or image-to-video prompts because the source image already defines the identity.
- **Shared reference images** — attach up to six character-sheet or keyframe images. They are used by image-to-video, image-to-image, and ingredients prompts that do not have their own row image. Row images always take priority.
- **Multiple row images** — each source-media row accepts up to six images (character sheet, outfit, scene) and sends them together as ingredients.
- If a source-media prompt has neither its own image nor a shared image, it is still blocked instead of being submitted in the wrong mode.

For the strongest continuity, create or save the character in Flow first, attach it with **Attach Flow characters**, and mention that character by name in every prompt. Use the identity anchor as a fallback when no Flow character is available. Use shared keyframes when the batch includes image-to-video or ingredients shots.

Character scanning switches the Flow tab to the Characters view; the content script returns to the project when the batch starts.

### Continuity chain

Enable **Chain prompts** in the Character consistency panel to make each prompt wait for the previous one and use its output as the reference:

- Consecutive image prompts edit the previous image, so shots 2, 3, 4, and so on stay visually anchored to shot 1 through the chain.
- Consecutive video prompts start from the last frame of the previous video.
- The chain is applied only between consecutive prompts of the same output type. A video-to-image boundary is left unchained so the image prompt is not converted into a video prompt.
- Chaining forces **1 concurrent prompt** and **1 output per prompt**, because each output depends on the previous result.
- Image-to-video boundaries cannot use Flow's native image-edit handoff; use Flow characters or shared reference images for those shots.
- If a chained prompt fails, the following prompt runs without a reference. Retry the failed prompt or rerun the batch.

### First-image gate

Enable **First-image gate** when you want to inspect the first result and use it as the reference for every remaining prompt:

1. Prompt #1 must be an image prompt, and image downloads must be enabled.
2. The batch submits only prompt #1 with one output and one concurrent prompt.
3. After prompt #1 finishes, the batch pauses and shows an upload control. Wait for the downloaded image, then upload that downloaded file in the panel.
4. Press **Continue batch**. The uploaded image is attached as the first reference image to every remaining prompt:
   - Text-to-image prompts become Image-to-Image.
   - Text-to-video prompts become Ingredients to Video.
   - Prompts already using Image-to-Image, Frame to Video, or Ingredients to Video keep their mode and receive the image in addition to their existing references.
5. Press **Cancel batch** while paused to stop without submitting the remaining prompts.

The gate is incompatible with background mode and with chains that include blocked prompts. It can be combined with the continuity chain; the chain then applies among the remaining prompts.

### Shared settings

Mixed batches read the existing **Setting** tab values for aspect ratio, output count, video/image models, default video duration, retry count, automatic download quality, filename behavior, folder, concurrency, and prompt delays. Concatenation defaults are converted to their non-concat duration because mixed prompts are independent.

### Background running

The **Background** button next to Run sends the mixed group to the Flow content script and then attempts to close the side panel. The content script, downloads, retries, and queue recovery continue in the Flow tab even when the panel is closed.

- Keep the Flow tab open. Closing or navigating the Flow tab stops that page's automation.
- Reopening the side panel starts a fresh mixed panel. If the group is still running, later status messages repopulate the existing prompt queue; groups that finish while the panel is closed are not replayed. Confirm those in the download folder; Debug Logs only shows events received while the side panel is open.
- Background mode uses the same existing queue and cancellation messages; it does not add a second automation engine.

### Concurrency and reliability

The content queue processes one prompt group at a time, and the existing click mutex serializes mode-switching actions. Mixed batches therefore switch Google Flow's mode safely between prompts. Retries re-use the original prompt payload, including its assigned mode. A failed prompt is recorded and the batch continues.

### Verification

```bash
npm test
npm run check
```

The repository contains compiled extension assets rather than the original TypeScript source. The mixed workflow is implemented as readable companion modules loaded by the existing side panel, so no rebuild step is required. Live Google Flow generation and selector behavior must be verified manually with a signed-in Flow session.

---

## Project structure

```text
Flow-Automation/
├── manifest.json              Manifest V3 configuration, permissions, and icons
├── service-worker-loader.js   Entry point for background service worker
├── package.json               Test and syntax-check scripts (no runtime dependencies)
├── logo.png                   Extension icon asset
├── assets/
│   ├── catchUploadFile.*.js   File input interceptor for Flow uploads
│   ├── index-*.css            Tailwind CSS styling and PrimeVue tokens
│   ├── index.html-*.js        Compiled Vue side panel application logic and UI
│   ├── index.ts-*.js          Content scripts and background service worker logic
│   ├── primeicons-*           Icon font assets (woff2, eot, svg, ttf, woff)
│   ├── remoteConfig-*.js      Local selector registry with 58 Google Flow selectors
│   └── utils-*.js             DOM query utilities and helper routines
├── src/
│   ├── assets/                Source icon assets
│   ├── shared/
│   │   ├── prompt-classifier.js   Local parsing and image/video classification
│   │   └── mixed-batch.js         Payload building, retry, and summary helpers
│   └── ui/
│       └── side-panel/
│           ├── index.html         Side panel entry HTML
│           ├── mixed-mode.js      Inline mixed mode button/panel and existing-queue wiring
│           └── mixed-mode.css     Inline mixed mode styling
└── tests/
    ├── prompt-classifier.test.js  Classification and parsing tests
    ├── mixed-batch.test.js        Payload, retry, and batch-summary tests
    └── integration-contract.test.js  Existing queue/protocol contract checks
```
