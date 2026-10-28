# Update platform selectors after a DOM change

## Objective
Restore extraction when X, Instagram or Facebook changes its markup: find which field broke, reproduce it in a fixture, fix the selector, and prove the fix.

## Required inputs
- The loaded extension with some collected posts.
- A logged-in tab on the affected platform.

## Steps
1. Diagnose. Dashboard > **Settings > Extraction health** lists, per adapter and selector version, the share of posts where each field resolved (author, text, timestamp, url, metrics, media). A value under 90% is highlighted. A sudden drop for one platform means its markup changed. Zero new posts at all usually means the post root selector broke.
   A JSON export is a faster second opinion and catches wrong values that health counts as "resolved". Move it to `.tmp/exports/` and run, from the project root in PowerShell:
   ```
   $j = Get-Content .tmp/exports/<file>.json -Raw | ConvertFrom-Json
   $j.posts | Group-Object platform | ForEach-Object { "$($_.Name): $($_.Count) posts, zero engagement $(($_.Group | Where-Object { -not $_.likes -and -not $_.comments }).Count), authors $(($_.Group.author | Sort-Object -Unique) -join ', ')" }
   ```
   Or, with Python, `python .claude/skills/platform-dom-adapter/scripts/diagnose_export.py .tmp/exports/<file>.json` (exit 1 means red flags). To count structural elements in a saved page, use `probe_capture.py` in the same folder.
   (For a v1 export use `$j.clusters` and `engagement -eq 0`.) Red flags: a platform with 0 posts; every post with zero engagement; one author repeated across unrelated posts, or an author that is a path word (`groups`, `photo`, `watch`); only one URL shape (e.g. only `/reel/`) when you browsed several surfaces.
2. Capture the broken page with `workflows/capture_fixture.md`. Name it so it is clearly a regression, for example `feed_2025_06_layout`.
3. Write the expected JSON for the fixture from what the page actually shows, add it to `extraction.test.ts`, and run `npm test`. The new test should fail on the broken field. If it does not, the problem is elsewhere (permissions, blocked-surface detection, content script not attached).
4. Fix the selector in `extension/src/adapters/<platform>/selectors.ts` (or the adapter logic if the structure changed). Prefer stable hooks: X `data-testid`, Instagram semantic tags, aria labels and URL shapes, Facebook `role`/`aria-*` and permalink URL patterns. Avoid generated class names.
5. Bump `VERSION` in that `selectors.ts` (for example `x-2025.1` to `x-2025.2`). Health is tracked per version, so the dashboard shows whether the new version actually recovered.
6. Run `npm run typecheck`, `npm test` and `npm run build`; reload the extension and the platform tab (see `workflows/build_and_load_extension.md`).
7. Browse a feed for a minute and confirm in Settings > Extraction health that the new version shows 90% or better for every field.
8. Record what changed under Lessons learned below.

## Expected outputs
- A fixture and test that fail before the fix and pass after.
- A bumped selector version, and recovered health numbers in the dashboard.

## Edge cases
- Facebook is the most fragile adapter. If posts exist but the author or permalink fails, check `PERMALINK_ANCHOR` and the author link selectors first; Facebook rotates URL parameters (`__cft__`, `__tn__`), which the adapter strips on purpose.
- Instagram profile grids do not expose likes or comments, so "Sample baseline" on an Instagram profile records the follower count but 0 posts. Instagram baselines therefore build up only from posts seen in the feed. This is a known limit, not a regression.
- Hidden counts are expected: X hides zero counts (read as 0), Instagram can hide likes (stored as unknown, not 0).
- Never "fix" a failing extraction test by loosening its expectation. Fix the selector or the fixture.

## Lessons learned
- Initial adapters were written against documented conventions and synthetic fixtures, not live captures. They passed every test and still failed live: Instagram produced 0 feed posts and 0 engagement, Facebook 0 engagement on all 65 posts. Only real captures (step 2) reveal this; do not trust a green test run on synthetic fixtures alone.
- Fix order that worked: inspect the user's export → count structural elements in the raw captures (`<article>`, `<header>`, `<video>`, `aria-label="Like"`, `href="/p/`, `/reels/audio/`) to see which assumption is false → rebuild against sanitized real fixtures → user verifies live.
- Platforms change *how* counts are shown, not only where. Instagram moved from "1,234 likes" text to a bare number beside the icon. Prefer `countNearIcon` (shared.ts), anchored on the icon's `aria-label`, over matching words next to numbers.

### Facebook (status as of 2026-10-28)
- The first live export recorded every author as `groups`: author resolution fell back to a URL path segment. Reserved path words (`groups`, `photo`, `watch`, …) are now rejected; an unresolved author is stored as `unknown` with `resolved.author = false` rather than a bogus handle.
- Engagement was 0 on every Facebook post in that export. The real-capture rewrite of the Facebook adapter (plan step B3) has not been done yet; capture a home feed and a group feed with the snapshot button and follow this workflow when it is picked up.

### Instagram, `ig-2026.1` (first adapter built from real captures: home feed, reels viewer, explore/search grid, profile)
What the DOM looks like now, and which anchors held up:
- **Feed posts are `<article>` elements with no `<header>`.** The old adapter required a header and found zero posts. Roots are now every outermost `article` that contains a post link (`/p/<code>/`, `/reel(s)/<code>/`); a sponsored article has no such link, so it drops out (no id, nothing to dedupe on).
- **The author is the first `a[href="/<handle>/"]`** in the post (the avatar is a `span[role=link]`, not an anchor). The handle link may carry tracking query strings (`?enable_persistent_cta=...`); the reels viewer uses `/<handle>/reels/` with `aria-label="<handle> reels"`.
- **Shortcode and time** come from the `a[href="/p/<code>/"]` that wraps `<time datetime>`. Reel posts in the feed also have a sibling `a[href="/reels/<same code>/"]` around the video, so `/reels/` (plural) must be accepted, but `/reels/audio/<id>/` is the sound page and must not be read as a shortcode.
- **Counts are bare numbers beside icons**: `svg[aria-label=Like|Comment|Repost|Share]` inside a `div/span[role=button]`, with the number in the next sibling (`10.5K`, `2,773`). `countNearIcon` reads them; likes/comments never appear as "N likes" text any more. The Repost icon carries a count and is stored as `shares`; Share has none. A hidden like count simply leaves no number, so likes stay `null`.
- **No play/view count is rendered** on the feed or in the reels viewer (checked for "plays"/"views" in all captures). `views` stays `null` for Instagram.
- **Captions** are `span[dir=auto]` / `div[dir=auto]` text after the action bar (feed) or inside the player overlay (reels). The "more" control is a `[role=button]` or a trailing "... more" span and is stripped. Wrappers that also hold the author line, `time`, an `svg`, the sound link or a location link are not the caption. Captionless posts exist (text is empty, not a failure).
- **Sound** is `a[href*="/reels/audio/<id>/"]`; its text is "Artist · Song" or "Original audio". Some links have no text (image only), so a title can be empty while the id is known.
- **The reels viewer (`/reels/<code>/`) has no `<article>`.** Each reel is the highest ancestor of a `<video>` that holds only that video and the action bar (`svg[aria-label=Like]`). The reel's shortcode is **not in the DOM**: it is the URL's `/reels/<code>/` for the reel in view, so the adapter only assigns it to the container whose centre is inside the viewport. The viewer swaps reels in place, so `PostObserver` polls the URL (1 s, only for adapters with `rescansOnUrlChange`) and on mutations/visibility callbacks, and re-observes its roots when the URL changes.
- **Explore/search grids** (`/explore/search/...`): ~24 `a[href="/p/<code>/"]` tiles (reels are marked `svg[aria-label=Reel]`, their `<video>` has a CDN `src`). Tiles carry no author and no counts, so nothing is emitted.
- **Profiles**: `main > header` holds the handle in an `h2`, and "9,119 followers" as `<a><span>9,119</span> followers</a>`; the `og:description` meta is gone after hydration, so the follower count is read from the header text. Grid tiles are `a[href="/<handle>/p|reel/<code>/"]` with the caption in the image `alt` (sometimes suffixed "view all N comments"). They are not emitted as posts: they have an author and id but no likes, and ingest keeps the first sighting of a post for 30 minutes, so a count-less tile would hide the real numbers from a later feed sighting. Revisit if ingest learns to upgrade a post's missing metrics.
- Stable anchors, in order of trust: URL shapes, `svg[aria-label]` action icons, `time[datetime]`, `role`/`dir=auto`. Class names (`x1...`) are generated and never used.
- Known live-verification gaps: whether the URL can lag the visible reel (a quickly skipped reel could be recorded under the previous code); `video.paused` is not used to pick the active reel.

