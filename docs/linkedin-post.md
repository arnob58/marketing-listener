So I was tinkering with Claude Code to see how far it can go, and I wondered: could I build a social listening Chrome extension with no paid APIs, and without bypassing logins or CAPTCHAs?

I also wanted it to answer a harder question: is a post trending because the idea is spreading, or just because a big brand posted it?

The result is Marketing Listener, built with Claude Code. It reads X, Instagram and Facebook in your own logged-in browser, groups similar posts, and stores each creative (caption, hashtags, thumbnail, counts) with a verdict and a confidence score.

The prompts I used, in order:

1. "Save these operating rules as CLAUDE.md." (kept short, pointing to files)
2. "Build a social listening Chrome extension that separates content-driven virality from brand-driven popularity. No platform APIs, local storage, no evasion tricks. Don't code yet. Ask me questions until you're 95% confident."
3. "Write the plan to a file, with measurable acceptance criteria."
4. "Implement the plan with a coding subagent. Run the tests until they pass, then tell me what you could not verify."
5. "I tested it on Instagram and it captured nothing. Here is my export. Diagnose from the data."
6. "Add a button that saves the page as it renders, so you can see the real markup."
7. "Write what we learned into workflow files, and create status and architecture files so a new session starts cheap."

Full prompts, in order: [GitHub link]/docs/prompts-to-recreate.md

You can download it here: [GitHub link]

How to use it (unpacked extension):
1. Download the ZIP from GitHub and unzip it
2. In a terminal: cd extension, then npm install, then npm run build
3. In Chrome, open chrome://extensions and turn on Developer mode
4. Click Load unpacked and choose extension/.output/chrome-mv3
5. Open X or Instagram, scroll as usual, and click the extension icon to open the side panel

Honest status: X and Instagram work. Facebook is still being rebuilt. It doesn't pick out hooks or content structure yet.

One caution: this reads pages you're logged into, so check each platform's terms first.

If you try it, tell me what breaks.
