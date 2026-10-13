# Template Studio: project rules for Claude Code

The full brief is in `MASTER_PROMPT.md`. These rules apply in every session.

## Golden rules
1. Static site only. No backend, database, accounts, analytics or paid services. Deploy to GitHub Pages.
2. User files never leave the browser. No network requests after the app has loaded (bundle everything; no CDNs, no web fonts).
3. Generated Python (`fill_pptx.py`) and `pptx_kit.py` use the Python standard library only (3.8+). The generated file must run in a Dify Code node: input `content_json` (String); outputs `pptx_base64`, `file_name`, `status`, `message` (String).
4. `engine.ts` and `python/engine.py` must give byte-identical slide XML. Change both together and keep the parity test green.
5. Every .pptx the app writes must open in PowerPoint. CI validates with python-pptx + LibreOffice (CI-only tools).
6. Generated outputs (example JSON, JSON Schema, LLM prompt, Python) must equal the prototype's in `reference/` for the same input.
7. Design: Keynote-like, neutral, one accent `#0071E3`. Type scale 11/12/13/15/20 px; control heights 28/24 px. No gradients, tinted page backgrounds, rainbow icons or emoji.

## Reference
- Working prototype: `reference/built/template-studio.html` (open it in a browser).
- Source of truth for behaviour: `reference/src/*`. Rebuild with `python reference/build_app.py` and `python reference/build_kit.py`.

## Commands (fill in once scaffolded)
- `npm run dev`, `npm run build`, `npm test`, `npm run test:e2e`, `npm run test:py`

## Working style
- Plan in `docs/PLAN.md`; get approval before large changes.
- Small commits per milestone; never weaken a test to make it pass.
- Ask before adding a runtime dependency.
