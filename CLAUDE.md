# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools): reason up front, run deterministic code for execution.

This file must stay under 250 lines. Before creating or editing it, read `.claude/system_prompt_editor.md`.

## Project

Marketing Listener is a Chrome MV3 extension. It watches X, Instagram and Facebook through the user's own logged-in session, groups related posts into trends, and estimates whether popularity is content-driven or publisher-driven. All analysis is local. Only the opt-in Sheets export leaves the machine.

- **Resuming work: read `STATUS.md` first** (current state, known gaps, next steps).
- Design: `docs/ARCHITECTURE.md`.
- Extension source and tests: `extension/` (its own `package.json`).

## Key Files and Folders

Read these before working in an area. Do not copy their contents into this file.

**Extension (`extension/src/`)**
- `manifest.ts`: permissions. Required list is fixed; `downloads` is optional.
- `adapters/<platform>/selectors.ts` and `adapter.ts`: how each site is read. Bump `VERSION` on any selector change.
- `adapters/shared.ts`: `countNearIcon` and other helpers shared by adapters.
- `content/`: observer, bounded scan, baseline sampling, page snapshot.
- `storage/db.ts`: Dexie schema and migrations. Bump the version for any schema change.
- `clustering/`: duplicate detection and grouping. `analysis/attribution.ts`: how verdicts and scores are computed.
- `export/export.ts`: export schema. Current version is 2.
- `ui/`: side panel (`sidepanel/`) and dashboard (`dashboard/`).
- `net/allowlist.ts`: the only hosts the extension may contact.

**Tests and tools**
- `extension/tests/`: adapter tests run against sanitized real captures in `tests/fixtures/`.
- `tools/sanitize_fixture.py`: turns a raw page into a fixture.
- `tools/export_to_sheets.py`: pushes an export to Google Sheets. Dry-run first.

**Project skills (`.claude/skills/`): reusable know-how for this project**
- `platform-dom-adapter/`: diagnosing and fixing site readers. Scripts: `diagnose_export.py` (red flags in an export), `probe_capture.py` (element counts in a saved page).
- `dom-fixture-pipeline/`: capturing and sanitizing real pages into test fixtures.
- `social-trend-attribution/`: content- vs publisher-driven scoring. Script: `score_attribution.py --selftest`.
- `social-post-clustering/`: duplicate and semantic grouping of posts.

**Workflows (`workflows/`): step-by-step procedures**
- `build_and_load_extension.md`: install, check, build, load.
- `capture_fixture.md`: save a live page and sanitize it.
- `update_platform_selectors.md`: diagnose and fix extraction; read its Lessons learned.
- `export_trends_to_sheets.md`: export and push to Sheets.

**Agents and editing rules (`.claude/`)**
- `agents/coder.md`: the coding subagent (Sonnet).
- `system_prompt_editor.md`: rules for creating or editing this file.

**Local data (`.tmp/`, `.env`)**
- `.tmp/exports/`: JSON exports. The only copies of the user's data, so keep them until told otherwise.
- `.tmp/raw_pages/`: unsanitized saved pages with real names and posts. Never commit them, never paste their contents anywhere.
- `.env`: secrets. The extension needs none.
- `credentials.json`, `token.json`: Google OAuth, gitignored. Created during Sheets setup, so absent until then.

## Working With Agents

- **Coding goes to a Sonnet agent.** Implementation, bug fixes and test work go to the `coder` agent. Use another model only when the user says so.
- Planning, diagnosis, reviewing reports and talking to the user stay in the main session.
- Give a coding agent what it needs: the goal, the files involved, the hard limits, and what to report back.

## Hard Limits

- No model downloads, external API calls, or Sheets pushes without the user's confirmation.
- No anti-detection, fingerprint spoofing, CAPTCHA handling, or other evasion. A scan stops on a challenge page.
- No private surfaces are read: DMs, notifications, settings, checkout.
- No `git` commit, push, or `git init` unless the user asks.
- Never report a save or export as successful until the browser or tool confirms it.
- Never weaken a test to make it pass. Fix the selector or the fixture.
- **Do not open files in `.tmp/` unless the user asks.** They hold raw pages and exports, which are large and private. Work from the sanitized fixtures and `STATUS.md` instead.

## Working Rules

**1. Look for existing tools first.** Check `tools/` before writing anything new.

**2. Learn and adapt when things fail.** Read the full error, fix the cause, retest. If something costs money or credits, ask first. Record what you learned in the relevant workflow's Lessons learned section.

**3. Keep workflows current.** Refine them when you find better methods or constraints. Do not create or overwrite a workflow without asking, unless the user says to.

**4. Verify against live captures, not only synthetic tests.** Synthetic fixtures passed while live Instagram produced nothing. An adapter counts as working only when it passes on a sanitized real capture.

**5. Keep STATUS.md current.** Update it when something starts or stops working, or when the next step changes.

## Bottom Line

Read the instructions, pick the right tool, recover from errors, and keep the system improving. Stay pragmatic.
