# Capture a page as a test fixture

## Objective
Turn a live X, Instagram or Facebook page into a sanitized HTML fixture so the platform adapters can be tested against real markup without leaking real people's identities.

## Required inputs
- A logged-in Chrome window with the extension loaded, on the page to capture (feed, profile, or a private surface to prove it is blocked).
- Python 3.10+ with `pip install -r tools/requirements.txt` (needs `beautifulsoup4`).
- The platform id (`x`, `instagram` or `facebook`), the page URL, and a fixture name such as `feed` or `profile_verified`.

## Steps
1. Save the rendered page with the extension's own button (preferred; no DevTools needed):
   - Reload the extension at `chrome://extensions` and reload the page you want to capture, so the content script attaches.
   - Scroll a little so several posts are rendered, then open the side panel and press **Save page snapshot** (Diagnostics card). It is disabled on private surfaces, which are never read.
   - The first time, Chrome asks for permission to manage downloads (an optional permission). Allow it once. The panel says "Saved" only after Chrome reports the download complete.
   - The file lands in `Downloads/marketing-listener-snapshots/<platform>-<surface>-<timestamp>.html`. If the permission was blocked, a dashboard tab opens and saves it to plain `Downloads/` instead. Move it to `.tmp/raw_pages/`. `.tmp/` is gitignored and disposable.
   - The surface in the file name is the adapter's surface, not the page type: the Instagram Reels viewer is named `instagram-feed-...`. Rename it (for example `instagram-reels-...`) when you move it, or you will mix it up with the home feed.
   - The snapshot is the rendered DOM with `<script>`, `<style>`, stylesheet links, SVG path data and inline `data:` images removed. `aria-label`s, roles and text are kept because the selectors use them. It contains whatever is on screen (names, posts), stays on your machine, and must be sanitized before it goes into the repo.
   - Fallbacks if the button is unavailable:
     - **Ctrl+S**, save as type **Webpage, Complete** into `.tmp/raw_pages/`. Chrome serializes the live DOM in this mode. **HTML only** saves the original server HTML, before Instagram/Facebook render any posts, and is useless here. Delete the `_files` folder Chrome creates next to it.
     - DevTools (F12) > Elements, right-click `<html>` > **Copy** > **Copy outerHTML**, paste into `.tmp/raw_pages/<platform>_<name>.html`.
   - Capture only pages you are allowed to look at yourself.
2. Sanitize:
   ```
   python tools/sanitize_fixture.py .tmp/raw_pages/x_feed.html --platform x --url https://x.com/home --name feed
   ```
   Newer snapshots record the page URL in a `fixture-url` meta, so `--url` can be left out. Add `--redact-post-text` if post text may identify someone. Add `--fake-text` (recommended for real Instagram captures) to replace every word that is not UI chrome, a count or a time stamp (captions, bios, sound titles, alt text, location slugs) with stable filler; aria-labels, counts and URL shapes are kept, so the expected file can still be written from the sanitized page. The tool replaces handles, display names, numeric and short-code IDs, avatars and media URLs with stable fakes (the same input always gives the same fake), drops scripts and styles, and records the page URL in a `fixture-url` meta tag. It refuses to write the file if an original handle or name survives.
   Output goes to `extension/tests/fixtures/<platform>/<name>.html`.
3. Review the output by eye. Search it for names, places, phone numbers and anything else personal in the free text. Sanitizing does not understand meaning.
4. Write `extension/tests/fixtures/<platform>/<name>.expected.json` by hand from what the page visibly shows: `rootCount`, a `now` timestamp (ms) for relative times, and one entry per post with `postId`, `authorHandle`, `text`, `postedAt`, `url`, `likes`, `comments`, `shares`, `views` (use `null` where the page hides a count). Use the existing `feed.expected.json` files as the template. The IDs and handles in the expected file must be the sanitized ones.
5. Add or extend a test in `extension/tests/adapters/extraction.test.ts` (blocked surfaces go in `blocked.test.ts`) and run `npm test` from `extension/`.
6. Delete the raw page from `.tmp/raw_pages/`.

## Expected outputs
- A sanitized fixture plus expected JSON committed under `extension/tests/fixtures/`.
- A passing test, or a failing one that documents a real selector gap (continue with `workflows/update_platform_selectors.md`).

## Edge cases
- Attribute order differs after sanitizing (`content` before `name` on the meta tag). The test helper handles either order.
- Instagram display names are only visible in image alt text ("Photo by Name on ..."). The tool picks those up; if a name still shows, add it to the page by hand and rerun.
- Relative timestamps ("3h") are resolved against `now` in the expected file, so keep `now` consistent with when you captured.
- Never commit anything from `.tmp/raw_pages/`.

## Lessons learned
- Real Instagram captures live in `extension/tests/fixtures/instagram/real-{feed,reels,search,profile}.html` with hand-checked `*.expected.json`. The reels page did not record its URL (taken before snapshots did), so its fixture URL and the second reel's shortcode are made up; the test drives the URL by hand.
- Handle replacement matches whole tokens only (a handle `sea` must not damage `search`), and the leak check does too.
- The fixtures that ship with the project were authored synthetically from each platform's documented DOM conventions, because no saved pages existed yet. Replace them with real captures as soon as possible; the real DOM will differ.
- **Synthetic fixtures gave a false green.** All extraction tests passed while live Instagram produced zero feed posts: the fixtures encoded our assumption (a `<header>` per post), not Instagram's markup. An adapter is not considered working until it passes on a real, sanitized capture of every surface it claims to read.
- The first version of the snapshot button clicked a hidden `<a download>` link. That works on the dashboard tab but Chrome's side panel silently ignores it, and the panel still said "Saved". The button now uses `chrome.downloads` and reports success only on `complete`. Never report a save the browser has not confirmed.
- Useful captures per platform: home feed, the short-video viewer (Instagram `/reels/`), search/explore results, and one profile. Scroll so 3+ posts are rendered before capturing; a viewer page usually holds only 1–2 items, so capture it twice on different reels if counts matter.
