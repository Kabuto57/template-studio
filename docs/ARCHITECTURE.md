# Architecture

Template Studio is a static web app with no runtime dependencies: Vite, strict TypeScript and
hand-written CSS. The only bundled third-party asset is the Figtree font.

## Modules

```
src/
  zip/minizip.ts        Zip reader/writer on CompressionStream. Deterministic output.
  engine/engine.ts      The fill engine. Mirrors python/engine.py line for line.
  ooxml/
    xml.ts              Namespaces, DOM helpers, base64, path helpers.
    deck.ts             Deck: an open .pptx (parts as text, slide order, theme) + undo/redo.
    render.ts           Slide -> HTML. Used by the editor, the filmstrip and the gallery.
    edit.ts             Every edit: blocks, slides, move/resize, text, style, tables, fields.
  model/
    fields.ts           Field model, example JSON, JSON Schema, LLM prompt.
    python.ts           Assembles fill_pptx.py; reads one back.
  templates/            The gallery: a small builder and the five designs.
  persist/db.ts         Autosave and recent templates in IndexedDB.
  ui/                   The shell. Plain DOM, no framework.
python/
  engine.py             The fill engine. Embedded verbatim in every fill_pptx.py.
  kit_src.py            pptx_kit.py minus the engine (spliced in at build time).
reference/              The original single-file prototype, kept as the golden reference.
```

Everything outside `ui/` is free of app state: functions take a `Deck` and a `Project` and return a
result, which is why they can be tested without a browser.

### Why no React

The brief suggested React or Preact. The slide canvas is drawn from OOXML by `render.ts` and
manipulated directly during a drag, which a virtual DOM would not own; what remains is a handful of
panels that re-render from state on each change. Plain DOM keeps the bundle at about 55 kB gzipped with
zero runtime dependencies, which matters for an app whose promise is "nothing but your browser".

## The engine parity rule

The browser preview and the generated Python must agree, or the Test view lies. So the fill engine
exists twice, `src/engine/engine.ts` and `python/engine.py`, written to match line for line.

- **Change both together.** Same regular expressions, same order of operations.
- `tests/unit/parity.test.ts` runs both on about sixty fixtures (the audit sample, every gallery design,
  and hand-made edge cases) and compares the slide XML byte for byte, plus the replaced/missing reports.
- `tests/unit/kit.test.ts` runs a generated `fill_pptx.py` the way Dify does and compares the slides
  inside the resulting `.pptx` with the browser's output.

Three differences in the prototype were found this way and fixed in both engines:

| Case | Prototype | Now |
|---|---|---|
| `{{count:findings=High}}` (no field name) | Python raised and the whole deck failed; JS left it blank | Blank and reported in both |
| A multi-line string used as a list | Python split on more characters than JS | Both split on `\r\n`, `\n`, `\r` |
| Numbers such as `1e21` or `0.0000001` | Different text in each language | Plain digits in both |

`fill_pptx.py` is assembled the same way in both places (the web app and `pptx_kit.py`): a docstring
header, `engine.py` up to its command-line marker, the generated constants, then the rest of `engine.py`.
The web app imports the real `python/engine.py` as text at build time (`?raw`), so there is no second
copy to drift.

## Placeholder spec

See the table in the [README](../README.md#placeholder-rules). Details that matter when changing code:

- PowerPoint splits `{{field}}` across runs whenever it likes. The engine joins the run text of each
  paragraph, finds placeholders in the joined text, and maps character ranges back onto the runs. The
  first run touched receives the value; formatting is never rebuilt.
- A paragraph that is exactly one placeholder, with a list value, is cloned once per item.
- In a table, a row is removed only if it contained placeholders and all of them came out empty.
- Colour rules compare a cell's whole visible text, trimmed and case-insensitive.
- Only `ppt/slides/slideN.xml` and `ppt/notesSlides/notesSlideN.xml` are filled.

## OOXML rules the editor relies on

PowerPoint repairs or rejects files that break these, so `edit.ts` encodes them and the tests check them:

- Edit with the DOM on the original namespace prefixes; never rebuild a part from scratch.
- `XMLSerializer` may emit an XML declaration: strip any, then add exactly one.
- Child order: `a:pPr` first in `a:p`, runs before `a:endParaRPr`; `p:spPr` is xfrm, geometry, fill,
  line; `a:rPr` is line, fill, fonts; `a:tcPr` is borders, then fill; `p:bg` is first in `p:cSld`.
- Table cell borders contain their own `solidFill`. Set borders aside before replacing the cell fill.
- A new slide needs five things: the part, its rels, a `[Content_Types]` Override, a relationship from
  the presentation, and a `p:sldId` with an id of 256 or more. Deleting removes all five and the notes.

## Undo

`Deck.mutate` (one part) and `Deck.transaction` (several parts) record the previous XML of each part
they touch. Undo restores those and records the inverse for redo. Typing and nudging pass a merge key,
so a burst of edits is one step.

## Adding a block type

1. Add an entry to `BLOCKS` in `src/ooxml/edit.ts` (type, label, default size, the base name for its
   field if it has one).
2. Return its XML from `blockXml`, using `shapeXml` or `tableXml`.
3. Add a small illustration to `BLOCK_ART` in `src/ui/side.ts`.

The "inserts every block type" test picks it up automatically and checks the resulting deck.

## Adding a gallery design

Add a `Design` to `src/templates/designs.ts`: slides built with `shape`, `text` and `table` (positions in
inches), field settings, and realistic test data. The tests fail if a field on a slide has no settings,
if the test data leaves anything blank, if text runs off a slide, or if the deck is too large for Dify.
Use fonts that PowerPoint has on both Windows and macOS.

## Tests

| Layer | Where | What it proves |
|---|---|---|
| Unit | `tests/unit/zip.test.ts`, `engine.test.ts` | Zip round trips, CRC, every placeholder rule |
| Parity | `tests/unit/parity.test.ts` | TypeScript and Python engines give identical XML |
| Golden | `tests/unit/kit.test.ts` | Example, schema, prompt and code header equal the prototype's; the whole Python file equals this repo's `pptx_kit.py` output |
| Python | `tests/py/dify_run.py` | The generated file runs like a Dify Code node under `python -I -S` (no site-packages), on 3.8 and 3.12 |
| Validity | `tests/py/check_pptx.py` | Every `.pptx` written by any test: zip integrity, well-formed XML, consistent relationships and slide list; in CI also python-pptx and a LibreOffice PDF conversion |
| Browser | `tests/e2e/app.spec.ts` | The full flow in Chromium against the production build, the kit it downloads, reload, offline, no requests after load, keyboard, phone width |

python-pptx and LibreOffice are installed in CI only, to check the product's output. The product never
depends on them.
