# Build and load the extension

## Objective
Install dependencies, run the checks, build the Chrome MV3 extension and load it unpacked in Chrome, then reload it after code changes.

## Required inputs
- Node.js 20+ and npm (developed on Node 24 / npm 11).
- Chrome 116+ (side panel and offscreen documents).
- Nothing in `.env`: the extension itself needs no secrets.

## Steps
1. Install (once, and after `package.json` changes). From the project root:
   ```
   cd extension
   npm install
   ```
   `postinstall` runs `wxt prepare`, which generates `.wxt/` types. Versions are pinned exactly in `package.json`.
2. Check:
   ```
   npm run typecheck
   npm test
   ```
   Both must pass before a build is worth loading. Tests never download a model and never touch the network.
3. Build:
   ```
   npm run build
   ```
   `prebuild` copies the onnxruntime wasm files from `node_modules` into `src/public/ort/` so the model runtime is served from the extension itself. Output: `extension/.output/chrome-mv3/`.
4. Load: open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select
   the `extension/.output/chrome-mv3` folder inside this project.
5. Use: pin the extension and click its icon to open the side panel. Open the dashboard from the link in the panel.
6. After changing code: run `npm run build`, click the reload arrow on the extension card in `chrome://extensions`, then reload any open X, Instagram or Facebook tabs (already-open tabs keep the old content script until reloaded).
   For a faster loop use `npm run dev`; WXT opens a dev browser profile and rebuilds on save.

## Expected outputs
- `extension/.output/chrome-mv3/manifest.json` with exactly these required permissions: `storage`, `unlimitedStorage`, `sidePanel`, `offscreen`, `alarms`, and one optional permission, `downloads` (asked for only when the snapshot button is first used). The test `tests/privacy/privacy.test.ts` compares the built manifest against the source of truth once a build exists.
- The extension card shows no errors; the side panel opens.

## Edge cases and known behaviour
- "Reload the page once so the extension can attach": the side panel could not reach a content script. Reload the tab.
- The service worker sleeps when idle. Feature work is queued in IndexedDB (`featureState: pending`) and drained by a one-minute alarm, so nothing is lost. Inspect it via the **service worker** link on the extension card.
- Embedding models are off until the user ticks **Settings > Embedding models**. That grants the Hugging Face host permission and downloads roughly 100 MB once. Do not enable it in automated runs; confirm with the user first.
- The wasm runtime adds about 35 MB to the build. That is expected.
- Chrome warns about chunks over 500 kB during build (the transformers.js bundle). It is only loaded in the offscreen document, and only after opt-in.
- Data lives in the extension's IndexedDB. "Purge all data" in Settings, or removing the extension, deletes it.

## Lessons learned
- **Passive capture vs scan.** Passive capture runs on every open X/Instagram/Facebook tab without any button; **Start scan** is only the bounded auto-scroll. If nothing appears unless you press Start, passive capture is failing on that platform's markup (the scan merely makes more posts render). Diagnose with `workflows/update_platform_selectors.md`; it is not a missing setting.
- **Always reload the platform tabs after reloading the extension.** An open tab keeps the old content script, so new selectors appear not to work.
- Schema upgrades are automatic: reloading a build with a new database version migrates existing posts in place. Fields added by the upgrade (for example thumbnails, audio) fill in only for posts seen afterwards.
- Downloads started from the side panel need `chrome.downloads`; a plain `<a download>` link is silently ignored there. Dashboard-tab downloads (exports) work with the plain link.
- After adding a file under `.claude/agents/`, restart Claude Code before delegating to that agent; definitions load at startup.
