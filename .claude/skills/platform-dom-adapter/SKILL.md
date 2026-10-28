---
name: platform-dom-adapter
description: >-
  Design, debug and repair per-site DOM extractors ("platform adapters") that read posts, authors, captions,
  timestamps and engagement counts from X/Twitter, Instagram, Facebook or similar sites without their APIs.
  Use when an extension captures nothing, captures posts with zero engagement or a wrong author, after a site
  redesign, or when adding a new platform. Includes scripts that diagnose an export and probe saved pages.
  Triggers on: selectors broke, extraction health, zero engagement, wrong author, adapter, scraper DOM
  changed, Instagram reels not captured, Facebook author is groups.
---

# Platform DOM adapters

Companion skills: `chrome-extension-passive-listener` (the host extension), `dom-fixture-pipeline` (real-page tests).

## Adapter contract (Open/Closed: a new site is a new folder plus one registry line)

```
id, selectorVersion
matches(url) -> bool
surface(url) -> feed | explore | search | profile | post | blocked | other
findPostRoots(node, url?) -> Element[]
extractPost(el) -> RawPost | null     // records which fields resolved
extractProfile(doc, url) -> { handle, followers, verified } | null
isChallengePage(doc, url) -> bool
rescansOnUrlChange?: boolean          // viewers that swap content in place
```

Every extracted post carries `resolved{author,text,timestamp,url,metrics,media}` and `selectorVersion`, so the
dashboard can show **extraction health** per site and version. A value under 90% on a field means the markup changed.

## Rules that prevented bugs

1. **Anchor on stable hooks, in this order**: URL shapes, `aria-label` on action icons, `time[datetime]`, `data-testid`
   (X), `role`, `dir="auto"`. Never use generated class names (`x1abc...`).
2. **Do not require structure you have not seen in a real capture.** The Instagram adapter required a `<header>` inside
   every `<article>`; live pages have none, so it found zero posts while all synthetic tests passed.
3. **Read counts by icon, not by words.** Platforms move from "1,234 likes" to a bare number beside the icon. Use a
   helper such as `countNearIcon(root, ['Like','Comment','Repost'])`: find `svg[aria-label=...]`, climb to its button,
   read the next element's pure-count text; skip neighbours that contain another control.
4. **IDs from URLs**: post ID from `/p/<id>/`, `/reel(s)/<id>/`, `/status/<id>`, permalink patterns. Exclude sound pages
   (`/reels/audio/<id>/`) from shortcode matching. Viewer pages may have no ID in the DOM; take it from
   `location.pathname` and assign it only to the item whose centre is in the viewport.
5. **Author guard**: reject path words (`groups`, `photo`, `watch`, `p`, `reel`, `explore`, `status`) as handles. If no valid
   author is found, set `resolved.author = false` and store `unknown`; never store a path segment as a person.
6. **Strip tracking parameters** from URLs (`__cft__`, `__tn__`, `?igsh=`) before using them as keys.
7. **Block private surfaces** (DMs, notifications, settings, checkout) in `surface()`; extraction returns nothing there.
8. **Grid tiles** (explore, search, profile) usually carry an ID and thumbnail but no author or counts. Do not store
   them as posts: ingest keeps the first sighting, so a count-less tile would hide the real numbers from a later feed
   sighting. Revisit only if ingest can upgrade missing metrics.
9. Hidden counts are `null`; abbreviated counts are ranges.
10. Bump `VERSION` in `selectors.ts` on every selector change.

## Diagnosis procedure (deterministic)

1. Get the user's JSON export. Run
   `python scripts/diagnose_export.py EXPORT.json` (exit 1 = red flags). It prints per-platform post count, zero-engagement
   count, caption count, URL shapes and top authors, and flags: platform with ~0 posts, all-zero engagement, a path-word
   author, one author on most posts, a single URL shape.
2. Have the user capture the failing surfaces (home feed, viewer, search, profile) with the extension's snapshot button
   or Ctrl+S "Webpage, Complete" (see `dom-fixture-pipeline`).
3. Run `python scripts/probe_capture.py PAGE.html ... [--pattern NAME=REGEX]`. Compare counts with what the adapter
   assumes. A required element with count 0 (`header=0`, `article=0`) is the false assumption. Examples of useful probes:
   `aria-Like`, `time`, `video`, `href=/p/`, `href=/reel(s)/`, `audio=/reels/audio/`.
4. Sanitize captures into fixtures, hand-write `expected.json`, write the failing test, then fix selectors.
5. Typecheck/test/build, reload extension and tabs, user browses ~2 minutes, re-export, re-run step 1.

## Observations (verified against real captures, 2026-10; sites change, re-verify)

- **X**: `data-testid` hooks are stable; the easiest adapter. Zero counts are hidden (read as 0). A repost banner shows
  the original post, so store `repostedBy` and keep the original author independent.
- **Instagram feed**: `<article>` without `<header>`; author is the first `a[href="/<handle>/"]`; ID and time from the
  `a[href="/p/<id>/"]` around `<time>`; counts are bare numbers beside `svg[aria-label=Like|Comment|Repost]`; no
  play/view count is rendered anywhere; sponsored posts have no post link (skipped).
- **Instagram reels viewer** (`/reels/<id>/`): no `<article>`; a reel is the highest ancestor of a `<video>` that holds
  only that video and its action bar; caption and sound link are inside the overlay; sound link is
  `a[href*="/reels/audio/<id>/"]` ("Artist · Song" or "Original audio", sometimes image-only so title is empty);
  URL changes in place when swiping.
- **Instagram profile**: follower count is text in `main > header` ("9,119 followers") because `og:description`
  disappears after hydration; grid tiles have no likes.
- **Facebook**: class names obfuscated and rotating; rely on `role`, `aria-*`, permalink URL shapes. First live run
  recorded every author as `groups` and zero engagement on all posts: author fell back to a URL segment and counts
  were not read. Facebook is the most fragile adapter; capture real feed and group pages before rewriting it.

## Done when

The adapter passes on a sanitized real capture of every surface it claims (>=95% roots, author/url correct on >=95%,
>=90% of posts with a non-zero metric where the page shows one) and a live export no longer trips `diagnose_export.py`.
