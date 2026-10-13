# Template Studio: handoff to Claude Code

1. Unzip this folder somewhere on your computer, e.g. `Documents/template-studio`.
2. Open a terminal in that folder and start Claude Code (`claude`).
3. Paste the whole of `MASTER_PROMPT.md` (everything below the line) as your first message.
4. Claude Code will read the reference code and write a plan (`docs/PLAN.md`). Read it, then reply "go".
5. When it reaches the deploy step you'll need a free GitHub account; Claude Code will walk you through
   creating the repo and turning on GitHub Pages. The app then lives at
   `https://<your-username>.github.io/template-studio/`.

What's in here
- `MASTER_PROMPT.md`  the brief for Claude Code
- `CLAUDE.md`         rules Claude Code keeps between sessions
- `reference/`        the working prototype (open `reference/built/template-studio.html` in a browser),
                      its source, sample files and the restricted-computer tool `pptx_kit.py`
