# Project status

Last updated: 2026-10-28. Read this first when resuming. Design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Working now

- **Extension builds and passes its checks:** typecheck clean, 287 of 287 tests passing across 26 files (re-run 2026-10-28).
- **X:** passive capture works. Engagement is read for most posts.
- **Instagram home feed and Reels:** the user confirmed captures work after the rebuild from real captures. Captions, likes, comments, reposts and sound are read. Views are not shown by Instagram, so they are always empty.
- **Snapshot button:** saves the page through `chrome.downloads` with the optional permission. The user has saved and moved Instagram snapshots.
- **Export v2** (JSON) carries captions, hashtags, counts, media links and sound per post.
- **Dashboard:** thumbnails, captions, trend lists, lifecycle and attribution views.
- **Project skills and tools:** the diagnostic script, the page probe, the attribution scorer and the sanitizer all run.

## Known gaps

- **Facebook** is the weakest platform. The author bug is fixed (`groups` and similar words are no longer stored as authors). Engagement still reads as zero on every post in the last export. The reader has not been rebuilt from real pages, because no Facebook snapshots exist yet.
- **Instagram Reels:** the reel ID comes from the address bar, so a quick swipe could file a reel under the previous ID. Not yet checked on live pages.
- **Instagram** "Share" has no count, so the shares column holds the repost count.
- **Attribution:** most verdicts are "insufficient evidence" because account baselines and follower counts are missing. Shared audio is shown as evidence but does not change the score. The small-account rule is strict.
- **Thresholds** for semantic matching (0.88 images, 0.80 text) are untuned. Embedding models are off and nothing has been downloaded.
- **Google Sheets:** `.env` is empty and there are no credentials. Only dry-runs have been done.

## Next steps, in order

1. **Facebook captures.** The user saves the Facebook home feed and one group feed with the snapshot button, and moves them into `.tmp/raw_pages/`. Then rebuild the Facebook reader from those pages, following `workflows/update_platform_selectors.md` and `workflows/capture_fixture.md`.
2. **Live check of Instagram Reels.** Watch about 15 reels, including some skipped quickly, export, and open a sample of links to confirm each one opens the reel whose caption is listed.
3. **Sample baselines** on the accounts the user cares about, so attribution has data to work with.
4. **Decide on shared audio** in attribution. It may deserve the same weight as independent adoption.
5. **Sheets setup** when the user is ready: credentials, `.env`, dry-run, then a real push, following `workflows/export_trends_to_sheets.md`.
6. **Embeddings** only after the user confirms the model download. Then tune thresholds on a real image and caption set.

## Where things are

- Procedures: `workflows/`. Coding: the `coder` agent (`.claude/agents/coder.md`, Sonnet).
- Current exports: `.tmp/exports/`. These are the only copies of the user's data, so keep them until told otherwise.
- Raw captures: `.tmp/raw_pages/` is empty. Sanitized fixtures for Instagram are in `extension/tests/fixtures/instagram/`.
- GitHub: a local git repository exists on `main` with `README.md` and an MIT `LICENSE`. It has not been pushed; the user pushes it. The LinkedIn post draft is `docs/linkedin-post.md` and the full prompt list is `docs/prompts-to-recreate.md`.
- Idea not built yet: picking out each post's hook (opening line) and content structure. The extension stores captions, hashtags, thumbnails and counts but does not analyze them for this.
