---
name: dom-fixture-pipeline
description: >-
  Turn live, logged-in web pages into sanitized HTML test fixtures and hand-checked expected-value files so DOM
  extractors can be tested against real markup without leaking real people. Use when writing or repairing
  scraper/extractor tests, capturing Instagram, Facebook or X pages, replacing synthetic fixtures, or when tests
  pass but the live site fails. Bundles a BeautifulSoup sanitizer. Triggers on: fixture, saved page, snapshot,
  sanitize HTML, extractor test, synthetic fixture false green.
---

# DOM fixture pipeline

Companion skills: `platform-dom-adapter` (what to fix), `chrome-extension-passive-listener` (the snapshot button).

## Core lesson

Synthetic fixtures written from documented conventions encode your assumptions, not the site's markup. Every test
passed while live Instagram produced zero posts. **An adapter is working only when it passes on a sanitized real
capture of each surface it claims to read.** Use synthetic fixtures only for edge cases and as a fallback until real
captures exist.

## Capture (the user does this in their own browser session)

Surfaces to capture per platform: home feed, the short-video viewer (Instagram `/reels/`), search/explore results, one
profile. Scroll until 3+ posts are rendered first. A viewer holds only 1-2 items, so capture it on two different items
when counts matter.

Preferred: the extension's **Save page snapshot** button. It writes the rendered DOM with scripts, styles, stylesheet
links, SVG path data and inline images removed, but `aria-label`s, roles and text kept, and records the URL in a
`fixture-url` meta. Files land in `Downloads/<folder>/<platform>-<surface>-<iso>.html`; the surface in the name is the
adapter's, so a reels capture is called `...-feed-...`. **Rename it** when moving to `.tmp/raw_pages/`.

Fallbacks: Ctrl+S, "Save as type: **Webpage, Complete**" (never "HTML only", which saves the pre-render server HTML),
then delete the `_files` folder; or DevTools > Elements > right-click `<html>` > Copy > Copy outerHTML.

Raw captures contain real names and posts: keep them in a gitignored `.tmp/raw_pages/`, never commit, never paste
their contents into reports.

## Sanitize

```
pip install -r tools/requirements.txt
python tools/sanitize_fixture.py .tmp/raw_pages/NAME.html --platform instagram --name real-feed --fake-text
```

Run it from the project root. The project's `tools/sanitize_fixture.py` is the only copy; output goes to `extension/tests/fixtures/<platform>/<name>.html`.

- Replaces handles, display names, numeric/short-code IDs, avatars and media URLs with stable fakes (same input, same
  fake), drops scripts/styles/tracking attributes, and **refuses to write if an original handle or name survives**.
- `--fake-text` replaces every non-UI word (captions, bios, sound titles, alt text, location slugs) with filler while
  keeping aria-labels, counts and URL shapes. `--redact-post-text` is the lighter option.
- Handle replacement matches whole tokens (a handle `sea` must not corrupt `search`).
- Platform reserved-word sets live in the script (`RESERVED`); add a platform there to support it.
- Review the output by eye for places, phone numbers, emails. Sanitizing does not understand meaning.

## Expected values and tests

1. Write `NAME.expected.json` **by hand from what the page visibly shows**: `rootCount`, a `now` timestamp (for relative
   times like "3h"), and per post `postId`, `authorHandle`, `text`, `postedAt`, `url`, `likes`, `comments`, `shares`,
   `views` (`null` where the page hides a count). Use the sanitized IDs and handles.
2. The test runs the real adapter over the fixture and compares. Write it first and watch it fail on the broken field;
   if it does not fail, the problem is elsewhere (permissions, blocked-surface logic, content script not attached).
3. Acceptance on real fixtures: >=95% root detection; author/url correct on >=95%; >=90% of posts with a non-zero metric
   where the page shows one; viewer pages: ID, caption, counts and sound correct on >=90%.
4. Never loosen an expectation to make a test pass. Fix the selector or the fixture.
5. Delete the raw page afterwards. Record what the DOM looked like in the repo's selector-update workflow.

## Edge cases

- The meta tag attribute order (`content` before `name`) differs after sanitizing; make the test helper accept either.
- A capture taken before the snapshot recorded URLs has no `fixture-url`; supply `--url` and note any invented IDs.
- Use `platform-dom-adapter/scripts/probe_capture.py` on a raw page first to see which elements exist before writing
  the expected file.
