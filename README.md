# Marketing Listener

A Chrome extension that watches X, Instagram and Facebook while you browse your own logged-in feed, groups posts that share the same idea, and estimates whether a post is popular because of its content or because of the account that posted it.

It uses no platform APIs and no paid services. Everything is analyzed and stored on your own machine. The only thing that can leave it is an export you choose to push to Google Sheets.

It was built with [Claude Code](https://claude.com/claude-code). The prompts used are in [docs/prompts-to-recreate.md](docs/prompts-to-recreate.md).

## Status

- **X:** works.
- **Instagram:** feed and Reels work. Reel accuracy under fast swiping is still being checked. Instagram shows no view counts.
- **Facebook:** captures posts, but engagement counts are not read yet. The reader is being rebuilt.
- **Verdicts:** most say "insufficient evidence" until the extension has seen enough posts from an account to know its usual engagement. Use **Sample baseline** on a profile page to help.
- **Stored per post:** caption, hashtags, post time, likes, comments, reposts, sound (Reels), thumbnail and a link. It does not yet pick out a post's hook or content structure.

See [STATUS.md](STATUS.md) for details and next steps.

## Install (unpacked)

You need Node.js 20 or later and Chrome.

1. Download this repository (green **Code** button, then **Download ZIP**) and unzip it.
2. In a terminal, run:
   ```
   cd extension
   npm install
   npm run build
   ```
3. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension/.output/chrome-mv3` folder.
5. Pin the extension and click its icon to open the side panel. The dashboard link is in the panel.
6. After you change the code or rebuild, click the reload arrow on the extension card, then reload any open X, Instagram or Facebook tabs.

## Use

1. Open X, Instagram or Facebook and scroll your feed normally. Posts are recorded as they pass on screen.
2. Optional: press **Start scan** in the side panel for a bounded, slow auto-scroll. It stops at a post or time limit, when you touch the page, when the tab is hidden, or at any login or challenge page.
3. Open the dashboard to see trends, the evidence behind each verdict, and what data is missing.
4. **Export** in the dashboard saves JSON or CSV to your Downloads folder.

## Privacy and limits

- Posts are read only from pages you already have open. Private pages such as messages, notifications and settings are never read.
- The extension does not try to avoid detection. It does not bypass logins or challenge pages, and it stops when one appears. Automated collection can still be noticed by a platform.
- It only sees what your own feed shows you, so "trending" means trending in your sample.
- Using it may go against a platform's terms of service. Check them, and use it only on your own account, at your own risk.
- Optional AI models for finding similar images are not downloaded unless you turn them on in Settings.

## For contributors

- Read [CLAUDE.md](CLAUDE.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.
- Run checks from `extension/`: `npm run typecheck`, `npm test`, `npm run build`.
- Test pages are sanitized captures in `extension/tests/fixtures/`. Procedures live in `workflows/`.
