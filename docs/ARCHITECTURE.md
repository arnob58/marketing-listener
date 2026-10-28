# Architecture

Marketing Listener is a Chrome MV3 extension. It observes X, Instagram and Facebook through the user's own logged-in session, groups related posts into trends, and estimates whether popularity is content-driven or publisher-driven. Output is an explainable label with a confidence score, evidence and missing-data notes. Analysis stays local. Only the opt-in Google Sheets export leaves the machine.

Current progress is in [STATUS.md](../STATUS.md). This document describes the design.

**Editing CLAUDE.md:** before recreating or editing `CLAUDE.md`, read `.claude/system_prompt_editor.md`. It sets the size limit and the rules for what belongs in that file.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Collection | Passive observation, plus a user-started bounded scan, plus "Sample baseline" on profile pages | No platform APIs. Scrolling only on the user's click, with caps. |
| Similarity | Perceptual hash and text matching, plus local CLIP and MiniLM embeddings | Memes need image similarity, since captions differ. |
| Platforms | X, Instagram and Facebook in v1, behind one adapter interface | Each site's markup differs and changes often. |
| Analysis location | All local. Opt-in JSON/CSV export, then a Python tool pushes to Google Sheets | Privacy. Sheets is the only external step. |
| Model delivery | Downloaded once after the user opts in, cached, then offline | Keeps the install small, and the download is the one external request. |
| Language | English text model (MiniLM) | Smaller and faster. A multilingual model is a later option. |
| Testing | Sanitized real page captures per surface, plus analysis tests with injected vectors | Synthetic pages gave false passes. Real captures are the acceptance bar. |

## Limitations the product must show

1. **Sampling bias.** "Trending" means trending in what this user's feeds showed. Every metric shows its sample size.
2. **Baselines** need at least 5 other posts from the same account. Most accounts have none, so the verdict is "insufficient evidence" until the user samples a profile.
3. **Rounded counts** ("12K") are stored as ranges. Instagram can hide likes. X is the only platform with view counts in the feed.
4. **"Independent accounts"** is approximated: distinct authors, not reposts or quotes, not obviously the same brand family. Coordinated networks can look independent.
5. **Fragile markup,** especially Facebook. Adapters record extraction health per field and version.
6. **Terms of service and account risk.** Collection is low-intensity and visible, but not undetectable. No evasion: no human-like jitter, no fingerprint spoofing, no CAPTCHA handling. A scan stops on a challenge page.

## Stack

WXT (MV3 build), TypeScript, Preact (UI), Dexie (IndexedDB), transformers.js on ONNX/WASM for the models, Vitest with happy-dom for tests. Versions are pinned exactly in `extension/package.json`.

## Runtime layout

```
content script (per tab)                 service worker                  offscreen document
+--------------------------+   msg   +-----------------------+  msg  +----------------------+
| platform adapter         | ------> | ingest, normalize,    | ----> | image hash, thumbs,  |
| observer (mutation +     |         | store (Dexie),        |       | CLIP and MiniLM      |
|   visibility)            |         | clustering, analysis, | <---- | embeddings (idle)    |
| bounded scanner          |         | scheduler             |       +----------------------+
| baseline sampler         |         +-----------------------+
| page snapshot            |                    ^
+--------------------------+                    |
                      side panel (live, current tab), dashboard page (history, detail, settings, export)
```

Key rules:
- **Passive first.** An observer extracts a post once it is at least half visible. A post seen again records only a new metrics observation, which feeds velocity.
- **Bounded scan** is the only auto-scroll. It starts on a click and stops at the post cap, the time cap, the user's input, a hidden tab, a challenge or login page, a blocked surface, or the end of the feed.
- **Adapters** implement one interface (`matches`, `surface`, `findPostRoots`, `extractPost`, `extractProfile`, `isChallengePage`). Adding a platform means adding a folder and one registry line.
- **Private surfaces** (DMs, notifications, settings, checkout) are never read, including by the diagnostic snapshot.
- **Heavy work** (hashing, thumbnails, models) runs in the offscreen document, only after opt-in. Models unload after about 2 minutes idle.
- **Clustering** runs in stages, cheapest first: exact ID, near-duplicate (perceptual hash or MinHash), shared audio, then semantic centroid matching. Trend scores count distinct independent accounts, so duplicates never inflate them.
- **Attribution** combines weighted signals into a score from 0 to 1 and a confidence value. Labels: Likely content-driven, Likely publisher-driven, Mixed, Insufficient evidence. Details are in `.claude/skills/social-trend-attribution/`.
- **Lifecycle** (Emerging, Accelerating, Established, Declining) comes from daily snapshots per cluster. Earlier days are never overwritten.
- **Privacy.** Required permissions are `storage`, `unlimitedStorage`, `sidePanel`, `offscreen` and `alarms`. `downloads` is optional and requested on first use. One allowlist (`extension/src/net/allowlist.ts`) names every host the extension may contact.

## Repository layout

```
CLAUDE.md                  agent instructions (loaded every session)
STATUS.md                  current state and next steps
docs/ARCHITECTURE.md       this file
.env                       secrets; empty for the extension. Sheets keys go here.
.gitignore                 ignores .env, credentials.json, token.json, .tmp/, build output
extension/                 Chrome extension (TypeScript, own package.json)
  src/                     adapters/, content/, background/, storage/, features/, clustering/,
                           analysis/, export/, ui/, net/, core/, entrypoints/
  tests/                   unit and fixture tests; tests/fixtures/ holds sanitized captures
tools/                     Python steps run outside the browser
  sanitize_fixture.py      raw page -> sanitized fixture
  export_to_sheets.py      JSON export -> Google Sheets (dry-run first)
workflows/                 step-by-step procedures (build, capture, fix selectors, export)
.claude/
  agents/coder.md          coding subagent (Sonnet)
  skills/                  project skills: platform-dom-adapter, dom-fixture-pipeline,
                           social-trend-attribution, social-post-clustering
  system_prompt_editor.md  rules for editing CLAUDE.md
.tmp/                      disposable working files; exports/ and raw_pages/ live here
```

## Build order (as executed)

1. Scaffold, core types, count parsing, storage schema.
2. Adapters for X, Instagram and Facebook, each with fixtures and extractor tests.
3. Observer, ingest, seen-set and observations, bounded scanner, baseline sampler.
4. Offscreen feature pipeline: hash first, then embeddings behind opt-in.
5. Clustering.
6. Baseline, attribution, trend score, lifecycle, explanations.
7. Side panel and dashboard.
8. Export and Sheets tool, workflows.
9. Fix round 1: real Instagram captures, export content, snapshot button, `chrome.downloads`.

Steps 1 to 8 were built against synthetic fixtures. Step 9 showed that they were not enough: live Instagram produced no posts until the readers were rebuilt from real captures. Facebook is still pending that rebuild.

## Acceptance criteria

- **Extraction** on sanitized real captures: at least 95% of post roots found; author and URL correct on at least 95%; at least 90% of posts with a non-zero metric where the page shows one. Viewer pages: ID, caption, counts and sound correct on at least 90%.
- **Blocked surfaces:** zero posts extracted from DMs, notifications, settings and checkout.
- **No reprocessing:** a post seen N times is analyzed once, with N-1 observations.
- **Dedup:** on a procedural image set, precision at least 0.95 and recall at least 0.90. Repeat posts from the same account add nothing to the independent-account count.
- **Scenarios** (analysis tests with synthetic inputs): one meme across three unrelated accounts gives one content-driven cluster; a brand post at its usual level gives publisher-driven; a small account far above its usual gives content-driven; a missing baseline lowers confidence and is listed as missing; the same meme on three platforms gives one cluster with a per-platform breakdown; accounts spreading over days move from Emerging to Accelerating with snapshots kept.
- **Scan safety:** never exceeds its caps; stops within about a second of user input, a hidden tab or a challenge page.
- **Privacy:** every fetch target is on the allowlist; the built manifest has only the listed permissions.
- **Explainability:** every classification carries at least one evidence item, a confidence value, sample sizes and a missing-data list.

## Verification

- `npm run typecheck`, `npm test` and `npm run build` in `extension/`.
- Load `extension/.output/chrome-mv3` unpacked. Reload the extension and each platform tab after every change.
- Live: browse each surface for a few minutes, export JSON, run `python .claude/skills/platform-dom-adapter/scripts/diagnose_export.py <export>`, then open a sample of exported post links to confirm each one matches its caption.
- Sheets: dry-run `tools/export_to_sheets.py` before any real push, and only after the user confirms.
