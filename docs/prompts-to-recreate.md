Written for: developers and non-developers who want to build a similar tool with Claude Code.

# Recreate this project with Claude Code: the prompts

These are the prompts used to build the Marketing Listener Chrome extension, in order. Run them in a Claude Code session in an empty project folder. Replace anything in [brackets] with your own details.

**What you need:** Claude Code, Node.js 20 or later, Python 3.10 or later, and Chrome. The prompts create the project files themselves. Your own data, credentials and tokens are never part of this, and you shouldn't share them.

**Important:** this tool reads pages you are logged into. Check each platform's terms before using anything like it.

---

## 1. Set up the operating rules

> Save the following as CLAUDE.md in this project: [paste your operating instructions here]

Tip: ask Claude to keep the file under 250 lines and to point to other files rather than copy them. Long instruction files waste context in every session.

## 2. Define the product

Use a spec prompt like this. Be specific about goals, constraints and examples.

> **Goal:** Develop a cross-platform social listening Chrome extension that finds trending content on [platforms] and distinguishes genuine content-driven virality from popularity driven by an established account's existing audience.
>
> **Scope:** [platforms]. Passive observation plus a user-started bounded scan. Duplicate and semantic clustering across accounts. A local trend history and a dashboard.
>
> **Constraints:** No platform APIs. Minimal automation. Local-only storage by default. No anti-detection or CAPTCHA bypass. Explainable verdicts with confidence scores. Don't claim that inferred causes are facts.
>
> **Examples:** [three or four concrete scenarios with numbers, such as "a meme shared by three unrelated accounts" and "a brand post with high likes that matches its usual performance"].
>
> **Instructions before implementation:** Do not start coding. Critically evaluate this proposal, list the technical limitations and risks, and ask me targeted questions. Do not proceed until you are at least 95% confident you understand the intended behaviour, constraints and success criteria. Then propose an architecture and measurable acceptance criteria before writing any code.

## 3. Answer the clarifying questions

Claude will ask questions. Answer them plainly, and say when you don't know, so Claude can recommend a default. In this project the questions covered collection depth, similarity methods, platform order, how the project fits the operating rules, who the tool is for, where AI models are downloaded, and how to test.

## 4. Save the plan

> Write the plan to [path]. Include: context, the decisions we agreed, known limitations, architecture, directory layout, build order, measurable acceptance criteria, and how to verify each one end to end.

Approve the plan in plan mode before building. Approving the plan is the point where Claude can start writing code.

## 5. Have Claude build, with a coding subagent

> Implement the approved plan, following its build order. Use a coding subagent set to Sonnet for implementation. Hard limits: no model downloads, no external network calls, no git commits. Run typecheck, tests and the build until they all pass. Report the exact counts and list anything you could not verify.

Read the report critically. In this project the first report said "all tests pass", and that was true, but live sites hadn't been tested yet. Ask for a list of what wasn't verified.

## 6. Test on the real thing and report back

This is where the project actually improved. Test in your own browser and send Claude what happened, with evidence:

> I tested [platform, surface]. [What you saw, in one sentence.] Here is the export: [file]. Diagnose from the data first, and don't guess.

If Claude is guessing, ask for real data:

> Add a button that saves the page as it currently renders, so I can send you the real markup.

**Lesson:** tests on pages Claude wrote passed while the live site returned nothing. Real saved pages are the only evidence that counts.

## 7. Turn real pages into safe test files

> Sanitize these saved pages into test fixtures. Replace names, handles, IDs and media URLs with stable fakes. Keep the structure, aria labels and URL shapes. Refuse to write the file if any original handle survives. Save the output under the test fixtures folder.

Then ask for a hand-written expected-values file for each fixture, based on what the page visibly shows.

## 8. Fix a reader from the real pages

> Rebuild the [platform] reader against these fixtures. The expected values are hand-checked, so don't loosen them. Bump the selector version. Show me which surfaces now produce posts and which still produce none.

## 9. Write the lessons down

> Update the workflow files with what we learned, under Lessons learned. Don't rewrite the procedures themselves without asking me first.

## 10. Keep future sessions cheap

> Scan the project. Will a new session need to read a lot to get started? Create a STATUS file with current state and next steps, and an architecture document that points to the design rules. Keep CLAUDE.md short and pointing to files. Don't open raw data files unless I ask.

Starting a new session should cost a few thousand tokens of reading, not a re-analysis of everything.

## 11. Separate reusable knowledge from project knowledge

> Review the skills we've written. Keep generic knowledge in a global skill, with any scripts bundled and tested. Move project-specific skills into the project's skills folder.

## What I'd do differently

- **Ask for the confidence check on purpose.** A spec that Claude has questioned saves rework later.
- **Treat synthetic tests as weak evidence about live sites.** Use real captures as the acceptance bar from the start.
- **Keep data out of the repo and out of default context.** Raw pages and exports are large and personal. Keep them out of the project's default reading.
- **Ask for evidence, not explanations.** An exported file or a saved page diagnoses faster than a description.
- **Review every "done" claim.** Ask what wasn't verified.
