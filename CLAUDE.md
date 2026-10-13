# Template Studio: project rules for Claude Code

The original brief is in `docs/brief/MASTER_PROMPT.md`. How the code is organised: `docs/ARCHITECTURE.md`.

## Golden rules
1. Static site only. No backend, database, accounts, analytics or paid services. Deployed to GitHub Pages by CI.
2. User files never leave the browser. No network requests after the app has loaded (bundle everything; no CDNs). A browser test enforces this.
3. Generated Python (`fill_pptx.py`) and `pptx_kit.py` use the Python standard library only (3.8+). The generated file must run in a Dify Code node: input `content_json` (String); outputs `pptx_base64`, `file_name`, `status`, `message` (String).
4. `src/engine/engine.ts` and `python/engine.py` must give byte-identical slide XML. Change both together and keep `tests/unit/parity.test.ts` green.
5. Every .pptx the app writes must open in PowerPoint. CI validates with python-pptx + LibreOffice (CI-only tools).
6. Example JSON, JSON Schema, LLM prompt and the Python header must equal the prototype's in `reference/` for the same input (golden test). Do not edit `reference/`.
7. No runtime dependencies. Ask before adding one.

## Design
Canva-like editor: dark tool rail, white panels, cool grey workspace. Tokens are at the top of `src/styles.css`.
Two colours carry meaning: cobalt `#2B50ED` = selected / primary action; marigold `#F2A300` = a field the LLM fills.
Type scale 12/13/14/16/22 px (Figtree, bundled). Control heights 32/26 px. No gradients, no emoji.
The owner replaced the brief's Keynote look with this direction on 2026-10-13.

## Commands
- `npm run dev`, `npm run build`, `npm run typecheck`
- `npm test` (unit, parity, golden, Python; needs `python3`)
- `npm run test:e2e` (Playwright against the production build), `npm run test:py`
- `node scripts/docs-shots.mjs` regenerates README screenshots (needs `npm run preview` running)

## Working style
- Small commits; never weaken a test to make it pass.
- Gallery designs: fonts must exist in PowerPoint on Windows and macOS.
