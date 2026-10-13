# Master prompt: build "Template Studio" as a free, public web app

> Paste everything below the line into Claude Code, run from the root of this folder
> (the folder that contains `MASTER_PROMPT.md`, `CLAUDE.md` and `reference/`).

---

You are building **Template Studio**, a public web app that turns a PowerPoint template into everything needed to generate filled-in decks from an LLM. A working single-file prototype already exists in `reference/`. Your job is to turn it into a clean, tested, maintainable project and deploy it for free so it can be opened from any browser, any time.

Read `CLAUDE.md` first, then `reference/` (instructions below), then plan before writing code.

## 1. What the product does

People write reports (for example internal audit highlights) as PowerPoint decks. They want an LLM (in Dify or elsewhere) to write the content and a script to pour it into their company template.

Template Studio lets a user:

1. **Design a template**: start from a blank slide, open their own `.pptx`, or load the audit sample. Insert blocks (Title, Text, Bullet list, Number tile, Table, Label, Box) by dragging them from the toolbar onto the slide. Move and resize anything, including shapes from their own PowerPoint. Drag *fields* (`{{report_title}}`, `{{findings.1.risk}}`, …) onto text boxes and table cells. Describe each field for the LLM (description, max words, examples, allowed values).
2. **Test it**: paste the JSON an LLM returned and see the slides filled in; download the filled `.pptx`.
3. **Get code**: copy three things into Dify: an LLM system prompt, the JSON shape (example and JSON Schema), and a **standard-library-only Python** "fill" script with the template embedded. Download everything as a kit (`.zip`).

Two delivery targets must keep working:

- **Online:** this web app.
- **Restricted computers:** `pptx_kit.py`, a pure-Python (standard library only, no installs, no internet) command-line tool that builds the same outputs from a `.pptx` plus `fields.json`, and has a `watch` mode that rebuilds whenever the template is saved. The web app offers it as a download.

## 2. Non-negotiable constraints

1. **Free to run, forever.** Static site only. No server, no database, no paid API, no sign-up, no analytics. Host on **GitHub Pages** (public repo, deployed by GitHub Actions). Make it equally deployable to Cloudflare Pages or Netlify (just `npm run build` → `dist/`). Do not add anything that needs a backend.
2. **Private by design.** Every file stays in the user's browser. Nothing is uploaded anywhere. State this on the page and in the README; it is a key selling point because the templates and data are confidential audit material.
3. **Works offline after first load.** Bundle every dependency (no CDN links, no Google Fonts; use the system font stack). Add a small service worker / PWA manifest so the app installs and runs offline.
4. **Generated Python must stay standard-library only** (Python 3.8+). It must run inside a **Dify Code node**: no file system, no network, input `content_json` (String), outputs `pptx_base64`, `file_name`, `status`, `message` (all String). It must also run on a laptop: `python fill_pptx.py data.json out.pptx`.
5. **One fill engine, two languages, identical output.** `engine.js` (browser preview/test) and `engine.py` (generated code + `pptx_kit.py`) must produce byte-identical slide XML for the same template and data. Enforce this with an automated parity test in CI.
6. **Never corrupt a .pptx.** Every file the app writes (template, filled deck, kit) must open in PowerPoint. Validate in CI (see §7).
7. **No regressions** against the prototype's behaviour listed in §4 and the pitfalls in §8.

## 3. Use the reference implementation

`reference/` contains a working, tested prototype. Port it; do not reinvent it.

| File | What it is | How to treat it |
|---|---|---|
| `reference/built/template-studio.html` | The complete working app in one file. **Open it in a browser first** to see the target behaviour and look. | Behaviour and visual reference. |
| `reference/src/engine.py` | Python fill engine: placeholder rules, table-row removal, colour rules, Dify `main()`, CLI. | Keep logic as-is. It is embedded verbatim into generated code. |
| `reference/src/engine.js` | Line-for-line JS port of `engine.py`. | Port to a TypeScript module; keep it line-for-line with the Python. |
| `reference/src/minizip.js` | Zip reader/writer using the browser's `CompressionStream`/`DecompressionStream` + CRC32. | Keep (no zip library needed). Add tests. |
| `reference/src/core.js` | Template loading, OOXML slide renderer (shapes, text styles, theme colours, tables, pictures, groups, layouts/masters), editing helpers, field model, example/schema/prompt/Python generators. | Split into modules (see §5). Keep generator output identical. |
| `reference/src/ui.js` | Drag-and-drop editor: blocks, slide ops, move/resize, field drops, inspector, test & code views, persistence, kit download. | Rebuild as components; same behaviour. |
| `reference/src/page.html` | Markup + CSS (design tokens, type scale). | Source of the design system (§6). |
| `reference/src/kit_src.py` | Source of `pptx_kit.py` (engine is spliced in between markers). | Keep the build step. |
| `reference/built/pptx_kit.py` | Built restricted-computer tool. | Must stay generated from `engine.py` + `kit_src.py`. |
| `reference/assets/` | `sample_template.pptx` (audit sample), `blank.pptx` (16:9 blank), `sample_project.json` (field settings), `sample_test_data.json`. | Ship as app assets and test fixtures. |
| `reference/build_app.py`, `build_kit.py` | Rebuild the reference outputs (stdlib Python). | Use to confirm you understand how pieces fit. |

## 4. Functional specification (must match the prototype)

### Placeholder rules (the contract between template, LLM JSON and code)

| In the template | Meaning |
|---|---|
| `{{report_title}}` | Text. Replaced in place, keeping the run's formatting, even if PowerPoint split it across runs. |
| `{{key_highlights}}` alone in a paragraph + a JSON list | One paragraph (bullet) per item, cloning the paragraph format. |
| `{{client.name}}` | Group: `{"client": {"name": …}}`. |
| `{{findings.2.title}}` | Item 2 (1-based) of a list: `{"findings": [{…}, {"title": …}]}`. Used one row per item in tables. |
| `{{count:findings}}`, `{{count:findings.risk=High}}` | Calculated counts; never part of the LLM JSON. |
| Table row whose placeholders all end up empty | Row is removed. |
| Colour rules | A table cell whose whole text equals a rule (e.g. High/Medium/Low) gets that fill and text colour. |

Missing keys become blank and are reported (except unused list rows). The field model is derived by scanning all slide and notes XML in presentation order.

### Views

- **Design**: Keynote-style window: toolbar with insert buttons (icon + small label; drag onto slide or click to insert centred), slide navigator on the left (numbered thumbnails, hover reveals Duplicate/Delete, "Add slide"), canvas in the middle, inspector on the right with tabs **Format · Fields · Document**.
  - Select by click; move by dragging; 8 resize handles; 0.05" snap grid; arrow-key nudge (Shift = 10×); Delete; Ctrl/Cmd+D duplicate; Ctrl/Cmd+Z undo; Esc deselect. Front/back ordering. Position inputs in inches.
  - Table: click a cell to select it; add row/column, delete row/column; list placeholders renumber automatically by row; header row stays static.
  - Dropping a field on a box replaces the paragraph that already holds a field (so a tile's "Label" line survives), otherwise the whole text.
  - Format tab: text (one line per paragraph, `{{name}}` allowed), "Use a field…" picker (keyboard/touch alternative to dragging), field settings for fields in the box, style (size, weight, alignment, text colour, fill / no fill), position.
  - Fields tab: Finder-style list (text, list, group, list children, count shortcuts incl. one per allowed value), "Add" new field (shown as "Not placed" until dropped), settings for the selected field/list, rename (renames in the template too).
  - Document tab: file-name source field, table colour rules (+ High/Medium/Low preset), short how-to.
  - In the editor only, fields render as subtle blue tokens with **short labels** (`report_title`, `# High`, `title`), full code on hover; text that overflows a box is shrunk to fit but never below 40%. The real template text is never changed by this.
- **Test**: slide navigator + filled slide + right panel with the test JSON (tolerates ```json fences), status (filled count, missing keys, keys not in template), "Download filled deck", "Reset to example".
- **Get code**: (1) LLM system prompt with optional extra instructions, (2) example JSON / JSON Schema toggle, (3) Python code with the Dify input/output table, Copy buttons, and "Download kit". The displayed code collapses the embedded base64; Copy copies everything. Also offer **"Download pptx_kit.py"** for restricted computers.

### Files in and out

- Open: `.pptx`; a `fill_pptx.py` made by the app (restores template + field settings from its `PROJECT` and `TEMPLATE_B64`); drag a file onto the canvas.
- Kit zip: `fill_pptx.py`, `template.pptx`, `example_body.json`, `json_schema.json`, `llm_prompt.txt`, `fields.json` (readable by `pptx_kit.py`), `README.txt`.
- Downloads use normal browser downloads (Blob + `<a download>`); the prototype's `window.claude` download capability is claude.ai-specific. Remove it.
- Persistence: autosave the current project (template bytes + settings + test data) to **IndexedDB**; restore on load; first visit opens the audit sample. Add "Recent templates" (last 5) on the New/Open menu.

### Generated outputs must stay identical to the prototype

Example JSON, JSON Schema, LLM prompt text and the Python file (apart from the embedded template bytes and date) must equal the prototype's for the same template + settings. `pptx_kit.py` produces the same four outputs; keep the two in sync from one shared spec (golden-file tests).

## 5. Architecture

- **Vite + TypeScript + React** (or Preact). Strict TypeScript. No UI kit; hand-written CSS using the tokens in §6.
- Framework-free modules (pure, unit-testable): `zip/` (minizip), `engine/` (fill engine), `ooxml/` (load, rels, theme, styles, renderer, edit ops: blocks, slide add/duplicate/delete, move/resize, table ops, text/style ops), `model/` (field model, example, schema, prompt, python generation), `persist/` (IndexedDB).
- React only for the shell, panels and inspector; the slide canvas renders from the OOXML model (keep the prototype's container-query `cqw` approach so slides scale with width).
- Keep `engine.py` and `kit_src.py` as real files in `python/`, embedded into the bundle at build time (Vite `?raw` import) so the generated code always comes from the same source.
- Undo: snapshot-based like the prototype (part → previous XML; structural edits record created/deleted parts).

## 6. Design system (keep this look; it was iterated with the user)

Apple Keynote-like, quiet, white. **No gradients, no tinted backgrounds, no rainbow icon tiles, no emoji.** One accent colour, used only for selection and the primary button.

- Colours: window `#FFFFFF`, sidebar `#F6F6F8`, canvas `#E9E9EC`, hairline `rgba(0,0,0,.09)` / strong `rgba(0,0,0,.14)`, ink `#1D1D1F`, secondary ink `#424245`, muted `#86868B`, fill `rgba(0,0,0,.045)`, accent `#0071E3` (pressed `#0062C4`), danger `#D70015`, ok `#248A3D`, warn `#B25000`.
- Fonts: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Arial`; mono `"SF Mono", ui-monospace, Menlo, Consolas`.
- **Type scale (only these):** 11 / 12 / 13 / 15 / 20 px. 13 = body and controls, 12 = labels and hints, 11 = captions, 15 = panel headings, 20 = page heading.
- **Control heights (only these):** 28 px (buttons, inputs, selects, segmented controls, colour inputs), 24 px compact. Radius 6 px (controls), 8–10 px (menus).
- Toolbar: full width, frosted (`backdrop-filter: saturate(180%) blur(20px)`), insert buttons = 20 px line icons (1.5 stroke) with 11 px labels. Segmented controls: grey track, white selected pill.
- Inspector: sections separated by hairlines, 16 px padding, 13 px semibold section titles. Field list rows 24 px with 14 px monochrome glyphs.
- Selection: 1 px accent outline, white round 9 px handles, dark size tag below.
- Light theme is the default. A dark theme is optional; only add it if it can match this quality.
- Responsive: usable on a tablet; at phone width panels stack and nothing scrolls sideways.
- Accessibility: keyboard-reachable everything, visible focus ring, labels on all inputs, `prefers-reduced-motion` respected, WCAG AA contrast.

## 7. Quality bar and tests (CI on every push, GitHub Actions, free for public repos)

1. **Unit (Vitest):** zip round-trip (CRC, stored/deflated, delete), engine cases (split runs, list expansion, nested, list items, counts with conditions, row removal, colour rules incl. tables with border fills, XML escaping, `&#x…;` entities, ```json fences), field model, generators.
2. **Parity:** run `engine.py` (CI Python) and `engine.ts` on the same fixtures; assert identical XML. Assert web-generated example/schema/prompt/python == `pptx_kit.py` output for the sample.
3. **Python:** run the generated `fill_pptx.py` exactly like Dify (`exec` then `main(json_string)`) under `python -I -S` (no site-packages) and on Python 3.8 and 3.12; check `status`, `file_name`, `message`, error path on invalid JSON.
4. **.pptx validity:** open every produced file with `python-pptx` in CI (CI may install it; the product may not depend on it), check `zipfile.testzip()`, and convert to PDF with LibreOffice headless as a smoke test.
5. **E2E (Playwright):** blank → drag Title/Text/Number/Table → move → resize → drop field onto text box and onto number tile (label survives) → table add row/column → add/duplicate/delete slide → undo → Test view fills → Get code shows prompt/JSON/code → kit downloads → reload restores project. Also: open the sample, open a `.py` round trip, no console errors, **no network requests after load**.
6. Lighthouse ≥ 90 for performance, accessibility, best practices.

## 8. Pitfalls already found (do not reintroduce)

- PowerPoint splits `{{field}}` across runs; always join run text per paragraph and map character offsets back to runs.
- `XMLSerializer` already emits the `<?xml …?>` declaration; adding another breaks the file. Strip, then prepend once.
- Table cell borders (`a:lnL` etc.) contain their own `solidFill`; when recolouring a cell, set borders aside before replacing the cell fill. `a:tcPr` child order matters.
- Never round-trip OOXML through a serializer that rewrites namespace prefixes; edit with DOM on the original prefixes or with careful string edits.
- Insert `a:r` before `a:endParaRPr`; `a:pPr` must be the first child of `a:p`; `spPr` order is xfrm → geometry → fill → ln.
- New slides need: part, rels, `[Content_Types].xml` Override, presentation rels entry, `p:sldId` (id ≥ 256). Deleting must remove all of them (and the notes slide).
- A CSS class named `ghost` was used for both a button style and the drop preview; clearing the preview deleted the Undo button. Namespace utility classes.
- Dify Code nodes cannot read files or return files; the template is embedded as base64 and the deck comes back as base64.
- Placeholder-fit shrinking is editor-only; never change real font sizes.

## 9. Deployment (free)

1. Create a **public** GitHub repo `template-studio`; push.
2. GitHub Actions: on push to `main` run tests, `npm run build`, deploy `dist/` to **GitHub Pages** (`actions/deploy-pages`). Set Vite `base` for the repo path.
3. Document one-click alternatives: Cloudflare Pages and Netlify (build `npm run build`, output `dist`).
4. Optional custom domain instructions in the README.
5. Release `pptx_kit.py` as a GitHub Release asset too, so restricted users can download just that file.

## 10. Make it presentable (it will be shown to a supervisor)

- First load opens the audit sample in Design view, ready to demo.
- `README.md`: one-paragraph pitch, screenshot/GIF of each view, "How it works" diagram (Mermaid: Template → Fields → LLM JSON → fill_pptx.py → deck), privacy statement, Dify setup steps, restricted-computer steps, local dev commands.
- `docs/DEMO.md`: a 3-minute demo script (open sample → drop a field → Test with sample JSON → Get code → paste into Dify → filled deck).
- `docs/ARCHITECTURE.md`: modules, the engine parity rule, the placeholder spec, how to add a block type.
- An in-app "About" dialog: what it does, privacy, version, link to the repo.

## 11. How to work

1. Read `CLAUDE.md` and every file in `reference/src/`. Open `reference/built/template-studio.html` in a browser.
2. Write `docs/PLAN.md` (milestones below) and wait for my OK before building.
3. Milestones, each ending with green tests and a short summary:
   1. Scaffold (Vite/TS/React, lint, Vitest, Playwright, CI) + port `zip` and `engine` with parity tests.
   2. Port loader + renderer + generators; golden tests against the prototype outputs.
   3. Design view (canvas, selection, move/resize, blocks, slide ops, table ops, inspector tabs, undo).
   4. Test and Get code views, kit + `pptx_kit.py` downloads, `.py` import, IndexedDB persistence, PWA/offline.
   5. Visual polish to §6, accessibility, Lighthouse, README/docs/demo, GitHub Pages deploy.
4. Commit after each milestone with a clear message. Never skip or weaken a test to make it pass; fix the cause.
5. Ask me before adding any dependency that is not dev-only, and never add one that needs a server or an account.

**Definition of done:** the public GitHub Pages URL loads the app, works offline after first visit, passes all CI checks, matches the prototype's behaviour and outputs, and the README is ready to show a supervisor.
