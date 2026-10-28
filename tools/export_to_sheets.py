"""Push a Marketing Listener JSON export to a Google Sheet (Trends, Posts, Accounts tabs).

Usage:
    python tools/export_to_sheets.py .tmp/exports/listener-export-<timestamp>.json
    python tools/export_to_sheets.py <export.json> --dry-run      # prints what would be written, no network

Configuration (in .env at the project root; values are filled in by the user):
    GOOGLE_SHEET_ID           ID of the target spreadsheet (the long token in its URL)
    GOOGLE_CREDENTIALS_PATH   OAuth client file, default credentials.json
The first real run opens a browser for Google sign-in and stores token.json next to the
credentials file. Both files are gitignored. This script is the only thing that sends
data off the machine; the extension itself never uploads anything.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SUPPORTED_VERSIONS = (1, 2)

# Sheet tab name -> bundle key, per schema version. v2 renamed `clusters` to `posts` and made it carry post content.
TABS_BY_VERSION = {
    1: {"Trends": "trends", "Clusters": "clusters", "Accounts": "accounts"},
    2: {"Trends": "trends", "Posts": "posts", "Accounts": "accounts"},
}
LIST_SEPARATOR = " | "


class ExportError(Exception):
    """The export file is missing, malformed, or from an unsupported version."""


def load_bundle(path: Path) -> dict:
    try:
        bundle = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ExportError(f"Export file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ExportError(f"Export file is not valid JSON: {exc}") from exc
    version = bundle.get("schemaVersion")
    if version not in SUPPORTED_VERSIONS:
        supported = " and ".join(str(v) for v in SUPPORTED_VERSIONS)
        raise ExportError(f"Unsupported schemaVersion {version!r}; this tool reads versions {supported}.")
    for key in TABS_BY_VERSION[version].values():
        if not isinstance(bundle.get(key), list):
            raise ExportError(f"Export is missing the '{key}' list.")
    return bundle


def cell_value(value):
    """Sheets cells hold scalars: lists (hashtags, media and post URLs) are joined into one cell."""
    if isinstance(value, list):
        return LIST_SEPARATOR.join(str(v) for v in value)
    return "" if value is None else value


def rows_to_table(rows: list[dict]) -> list[list]:
    """Header row plus one row per record; columns are the union of all records' keys, first-seen order."""
    if not rows:
        return [["(no rows)"]]
    columns = list(dict.fromkeys(key for row in rows for key in row))
    return [columns] + [[cell_value(row.get(c, "")) for c in columns] for row in rows]


def build_tabs(bundle: dict) -> dict[str, list[list]]:
    tabs = {name: rows_to_table(bundle[key]) for name, key in TABS_BY_VERSION[bundle["schemaVersion"]].items()}
    notes = [["generatedAt", bundle.get("generatedAt", "")]] + [["note", n] for n in bundle.get("notes", [])]
    tabs["Notes"] = notes
    return tabs


def summarize(tabs: dict[str, list[list]]) -> str:
    return "\n".join(f"  {name}: {max(len(rows) - 1, 0)} rows x {len(rows[0])} columns" for name, rows in tabs.items())


def resolve_path(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else PROJECT_ROOT / p


def push(tabs: dict[str, list[list]], sheet_id: str, credentials: Path) -> None:
    import gspread  # imported late so --dry-run works without the dependency installed

    token = credentials.with_name("token.json")
    client = gspread.oauth(credentials_filename=str(credentials), authorized_user_filename=str(token))
    sheet = client.open_by_key(sheet_id)
    existing = {ws.title: ws for ws in sheet.worksheets()}
    for name, rows in tabs.items():
        ws = existing.get(name) or sheet.add_worksheet(title=name, rows=max(len(rows), 2), cols=max(len(rows[0]), 2))
        ws.clear()
        if ws.row_count < len(rows) or ws.col_count < len(rows[0]):
            ws.resize(rows=max(len(rows), 2), cols=max(len(rows[0]), 2))
        # raw=True (explicit): cell text is stored as-is, so a caption starting with "=" is never evaluated as a formula.
        ws.update(values=rows, range_name="A1", raw=True)
        print(f"wrote {name}: {len(rows) - 1} rows")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path, help="JSON file downloaded from the dashboard Export tab")
    ap.add_argument("--dry-run", action="store_true", help="validate and summarize only; contact nothing")
    args = ap.parse_args(argv)

    try:
        bundle = load_bundle(args.export)
    except ExportError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    tabs = build_tabs(bundle)
    print(f"Export generated {bundle.get('generatedAt')}:\n{summarize(tabs)}")
    if args.dry_run:
        print("Dry run: nothing was sent.")
        return 0

    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "").strip()
    credentials = resolve_path(os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json").strip() or "credentials.json")
    if not sheet_id:
        print("ERROR: GOOGLE_SHEET_ID is not set in .env.", file=sys.stderr)
        return 2
    if not credentials.exists():
        print(f"ERROR: Google OAuth credentials not found at {credentials}. See workflows/export_trends_to_sheets.md.", file=sys.stderr)
        return 2
    push(tabs, sheet_id, credentials)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
