# System Prompt Editor Rules

These rules apply whenever you edit `CLAUDE.md` or any file that Claude Code loads as instructions.

## Size limits

- `CLAUDE.md` must stay **under 250 lines**. Count after every edit. If it is at or over the limit, move detail out before adding anything.
- Aim for about 100 to 150 lines. Headroom is for future additions, not for filling up.
- Keep each line short. A bullet should state one rule or one fact.

## What belongs in CLAUDE.md

Only things Claude needs on every task:
- What the project is, in two or three sentences.
- Hard rules and limits (for example, no model downloads without confirmation, never commit raw pages).
- Where to find things (pointers, see below).
- How to delegate (for example, coding goes to the `coder` agent).

## What does not belong in CLAUDE.md

Move it to the right place instead:
- **Step-by-step procedures** go in `workflows/`. CLAUDE.md points to them.
- **Implementation detail** (selector names, schema columns, thresholds) lives in the code. Do not copy it into CLAUDE.md, because it goes stale. Point to the file.
- **Background that only matters for one task** goes in the plan file or the relevant workflow.
- **Personal preferences about how to work with you** go in the memory directory, not in CLAUDE.md.
- **Secrets** never go in any instruction file. They belong in `.env`.

## Pointers over copies

- Refer to a file by its path and say what it is for. Example: `extension/src/analysis/attribution.ts`: how content-driven vs publisher-driven verdicts are computed.
- Do not paste file contents, long lists, or full schemas.
- Every path in CLAUDE.md must exist. Check it before you save.

## Style

- Plain language, direct instructions, no filler.
- Use headings and short bullets. Avoid tables unless the content is genuinely tabular.
- Write the rule and its reason when the reason is not obvious.
- Use the same terms as the code and the workflows. Do not invent new names for existing things.

## Checklist before saving

1. Line count is under 250.
2. Every pointer path exists.
3. No procedure, schema, or secret has been copied in.
4. The newest instruction does not contradict an older one. Remove the older one.
5. Nothing personal to the user is stored here.
