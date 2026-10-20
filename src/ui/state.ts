import type { Deck } from "../ooxml/deck";
import type { Sel } from "../ooxml/edit";
import type { Model, Project } from "../model/fields";

export type View = "design" | "test" | "code";
export type SideTab = "templates" | "elements" | "fields" | "settings";

/** The one open template and what the editor is showing. */
export const S = {
  deck: null as unknown as Deck,
  project: null as unknown as Project,
  model: { entries: [], calc: [] } as Model,
  docId: "",
  /** Gallery design this template started from (highlights the card), if any. */
  designId: null as string | null,
  testText: "",
  /** False while the test data is still the generated example, so it keeps following field changes. */
  testEdited: false,
  view: "design" as View,
  side: "templates" as SideTab,
  cur: 0,
  sel: { obj: null, cell: null } as Sel,
  /** Other objects selected along with sel.obj (Shift+click or drag a box around them). */
  multi: [] as number[],
  selField: null as string | null,
  jsonView: "example" as "example" | "schema",
  py: { key: "", code: "", b64: "" },
};

/** Hooks the modules call on each other; filled in by app.ts to avoid import cycles. */
export const ui = {
  /** Re-derive the model and redraw everything, then autosave. Call after any template change. */
  refresh: (): void => {},
  /** Redraw the slide, filmstrip and selection only. */
  renderStage: (): void => {},
  renderSide: (): void => {},
  renderInspector: (): void => {},
  drawOverlay: (): void => {},
  /** Settings changed (not the template): regenerate example data and autosave. */
  settingsChanged: (): void => {},
  save: (): void => {},
  select: (_sel: Sel, _opts?: { field?: string | null; multi?: number[] }): void => {},
  setView: (_v: View): void => {},
  setSide: (_s: SideTab): void => {},
};

export const clearSel = (): void => { S.sel = { obj: null, cell: null }; S.multi = []; };
/** Select one object, plus optionally others with it. */
export const setSel = (obj: number | null, multi: number[] = []): void => { S.sel = { obj, cell: null }; S.multi = multi.filter(i => i !== obj); };
/** Every selected object, the main one first. */
export const selected = (): number[] => (S.sel.obj === null ? [] : [S.sel.obj, ...S.multi]);
