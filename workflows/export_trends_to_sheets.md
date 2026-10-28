# Export trends to Google Sheets

## Objective
Move the extension's local trend data into a Google Sheet (tabs: Trends, Posts, Accounts, plus Notes) for sharing and review. This is the only step that sends data off the machine, and it happens only when you run it.

## Required inputs
- A JSON export from the dashboard (**Export > JSON**), saved to Downloads.
- Python 3.10+ and `pip install -r tools/requirements.txt`.
- Google access, configured once (below).
- `.env` keys (fill in the values yourself; this workflow never writes them):
  - `GOOGLE_SHEET_ID`: the long token in the sheet URL, `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
  - `GOOGLE_CREDENTIALS_PATH`: path to the OAuth client file, `credentials.json` by default (relative paths resolve from the project root).
  Both `credentials.json` and the generated `token.json` are gitignored.

## One-time Google setup
1. In Google Cloud Console create a project and enable the **Google Sheets API** and **Google Drive API**.
2. Configure the OAuth consent screen (External, Testing) and add your own Google account as a test user.
3. Create an **OAuth client ID** of type **Desktop app** and download the JSON. Save it as `credentials.json` in the project root.
4. Create an empty Google Sheet and copy its ID into `.env` as `GOOGLE_SHEET_ID`.

## Steps
1. In the dashboard open **Export** and click **JSON (for Sheets tool)**.
2. Move the downloaded `listener-export-<timestamp>.json` into `.tmp/exports/`.
3. Dry run first. It validates the file and prints row counts, and contacts nothing:
   ```
   python tools/export_to_sheets.py .tmp/exports/listener-export-<timestamp>.json --dry-run
   ```
4. Push (only after you have decided the data may leave your machine):
   ```
   python tools/export_to_sheets.py .tmp/exports/listener-export-<timestamp>.json
   ```
   The first run opens a browser for Google sign-in and stores `token.json`.
5. Open the sheet and check: one row per cluster in Trends (with attribution, confidence, evidence and missing-data columns, plus the lead post's caption, top hashtags, sound and every post link), one row per post in Posts (caption, hashtags, post time, per-metric counts, media URLs, sound, link), one per account in Accounts, and the sampling-bias notes in Notes.

## Expected outputs
- The three data tabs and the Notes tab replaced with the export's contents (each run clears and rewrites them, so it is safe to rerun).

## Edge cases
- `ERROR: GOOGLE_SHEET_ID is not set`: fill in `.env`.
- `credentials not found`: check `GOOGLE_CREDENTIALS_PATH` and the file location.
- Sign-in loop or `invalid_grant`: delete `token.json` and run again.
- Unsupported `schemaVersion`: the tool reads versions 1 and 2. Export again from the current extension build.
- Schema v2 (current) names the post tab `Posts`. A v1 file still works and writes the old `Clusters` tab with its original columns, so an old sheet is not silently mixed with new columns.
- List fields (hashtags, media URLs, post URLs) are joined with ` | ` in one cell. A count's `...Low`/`...High` columns are filled only when the platform showed an abbreviated value ("12K").
- Media URLs from Instagram and Facebook expire after a while; post URLs are stable. Thumbnails stay in the extension's local storage and are not exported.
- Cells are written as raw text, so a caption beginning with `=` is shown as text and never evaluated as a formula.
- Counts reflect only what appeared in your own feeds; the Notes tab repeats this so readers of the sheet see it.
- Attribution columns are estimates with a confidence value. Do not present "Likely content-driven" as a fact.

## Lessons learned
(Add API limits, quota messages and formatting quirks here as they come up.)
