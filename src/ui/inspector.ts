// The panel on the right: format whatever is selected on the slide.
import { scanPlaceholders } from "../engine/engine";
import { cfgKeyOf } from "../model/fields";
import { alignObj, deleteObj, readGeom, readOutline, readRotation, setGeom, setOutline, setRotation, duplicateObj, inches, IN, readBox, readStyle, selTextNode, setBox, setSlideBackground, setStyle, setText, slideBackground, tableOp, zOrder, type Align, type FieldPayload, type Sel, type TableOp, type TextStyle } from "../ooxml/edit";
import { SHAPES } from "../ooxml/shapes";
import { collectEditables, collectObjects, paraText } from "../ooxml/render";
import { A_NS, esc, kid, kids, nodeXml, parseXml } from "../ooxml/xml";
import { $, ICON, debounce, el, toast } from "./dom";
import { fieldEditor } from "./fields";
import { doPlaceField } from "./stage";
import { S, clearSel, ui } from "./state";

const FONTS = ["Arial", "Arial Black", "Calibri", "Cambria", "Century Gothic", "Courier New", "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];

/** The colours the template already uses, most frequent first: the natural palette to offer. */
function templateColours(): string[] {
  const count = new Map<string, number>();
  for (const s of S.deck.slides) {
    for (const m of S.deck.texts[s.path]!.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)) {
      const c = m[1]!.toUpperCase();
      count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(e => e[0]); // seven fit on one row beside the picker
}

function colourControl(label: string, value: string | null, onPick: (hex: string | null) => void, allowNone = false): HTMLElement {
  const w = el("div");
  w.appendChild(el("span", { class: "lbl" }, label));
  const row = el("div", { class: "colour" });
  const input = el("input", { type: "color", value: "#" + (value || "FFFFFF"), "aria-label": label });
  input.addEventListener("change", () => onPick(input.value.slice(1).toUpperCase()));
  row.appendChild(input);
  if (allowNone) {
    const none = el("button", { class: "sw none", type: "button", title: "No fill", "aria-label": `${label}: none`, "aria-pressed": String(value === null) });
    none.addEventListener("click", () => onPick(null));
    row.appendChild(none);
  }
  for (const c of templateColours()) {
    const b = el("button", { class: "sw", type: "button", style: `background:#${c}`, title: `#${c}`, "aria-label": `${label}: #${c}`, "aria-pressed": String(value === c) });
    b.addEventListener("click", () => onPick(c));
    row.appendChild(b);
  }
  w.appendChild(row);
  return w;
}

/** Fields a box or cell can take, for people who would rather pick than drag. */
function placeableOptions(): { label: string; payload: FieldPayload }[] {
  const out: { label: string; payload: FieldPayload }[] = [];
  for (const e of S.model.entries) {
    if (e.kind === "field") out.push({ label: e.name, payload: { key: e.path } });
    else if (e.kind === "object") e.children.forEach(c => out.push({ label: c.path, payload: { key: c.path } }));
    else {
      if (e.scalar) out.push({ label: `${e.name} (item)`, payload: { list: e.name, sub: "" } });
      e.children.forEach(sub => out.push({ label: `${e.name}: ${sub}`, payload: { list: e.name, sub } }));
      out.push({ label: `Number of ${e.name}`, payload: { key: `count:${e.name}` } });
    }
  }
  (S.project.pending ?? []).forEach(p => out.push({ label: `${p} (new)`, payload: { key: p } }));
  return out;
}

function textSection(doc: Document, node: Element, isCell: boolean): HTMLElement {
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("label", { class: "sect-title", for: "inspText" }, isCell ? "Cell text" : "Text"));
  const ta = el("textarea", { class: "inp", rows: "3", spellcheck: "false", id: "inspText" });
  ta.value = kids(kid(node, "txBody"), "p").map(paraText).join("\n");
  // Typing applies after a pause; the selection is captured now so a late apply cannot hit another box.
  const sel: Sel = { ...S.sel }, slide = S.cur;
  const apply = () => {
    if (!setText(S.deck, slide, sel, ta.value)) return;
    ui.refresh();
  };
  const later = debounce(() => { if (document.activeElement === ta) apply(); }, 400);
  ta.addEventListener("input", later);
  ta.addEventListener("blur", apply);
  sec.appendChild(ta);

  const eds = collectEditables(doc, false);
  const editIdx = S.sel.cell ?? eds.findIndex(x => x.node === node);
  const opts = placeableOptions();
  const pick = el("select", { class: "inp", "aria-label": "Use a field" },
    '<option value="">Use a field…</option>' + opts.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join("") + '<option value="new">New field…</option>');
  pick.addEventListener("change", () => {
    if (pick.value === "new") { ui.setSide("fields"); $("#newField").focus(); toast("Name the new field, then drag it onto the box."); pick.value = ""; return; }
    if (pick.value !== "" && editIdx >= 0) doPlaceField(editIdx, opts[+pick.value]!.payload);
  });
  sec.append(pick, el("span", { class: "hint" }, "One line per paragraph. Type <code>{{name}}</code> to add a field by hand."));
  return sec;
}

function fieldsSection(doc: Document): HTMLElement | null {
  const node = selTextNode(doc, S.sel) ?? (S.sel.obj !== null ? collectObjects(doc)[S.sel.obj] : null);
  if (!node) return null;
  const keys = scanPlaceholders(nodeXml(node)).map(f => cfgKeyOf(f.key)).filter((k): k is string => !!k);
  const cfgKeys = [...new Set(keys)];
  if (!cfgKeys.length) return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, cfgKeys.length === 1 ? "Field here" : "Fields here"));
  const lists = [...new Set(cfgKeys.filter(k => k.includes("[]")).map(k => k.split("[]")[0] + "[]"))];
  lists.forEach(a => { if (!cfgKeys.includes(a)) sec.appendChild(fieldEditor(a)); });
  cfgKeys.forEach(k => sec.appendChild(fieldEditor(k)));
  return sec;
}

function styleSection(node: Element, title: string): HTMLElement {
  const st = readStyle(node);
  const hasText = !!kid(node, "txBody");
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, title));
  const apply = (change: TextStyle & { fill?: string | null }) => { if (setStyle(S.deck, S.cur, S.sel, change)) ui.refresh(); };
  if (hasText) {
    const font = el("select", { class: "inp", "aria-label": "Font" },
      '<option value="">Template font</option>' + [...new Set([...(st.font ? [st.font] : []), ...FONTS])].map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join(""));
    font.value = st.font;
    font.addEventListener("change", () => apply({ font: font.value }));
    const size = el("input", { class: "inp", type: "number", min: "6", max: "200", step: "1", value: String(Math.round(st.sz)), "aria-label": "Font size", style: "width:76px;flex:none" });
    size.addEventListener("change", () => apply({ sz: Math.min(200, Math.max(6, +size.value || st.sz)) }));
    const r1 = el("div", { class: "row tight" });
    r1.append(font, size);
    const emph = el("div", { class: "seg", role: "group", "aria-label": "Emphasis" },
      `<button type="button" data-k="b" aria-pressed="${st.b}" aria-label="Bold"><b>B</b></button><button type="button" data-k="i" aria-pressed="${st.i}" aria-label="Italic"><i>I</i></button>`);
    emph.addEventListener("click", e => {
      const b = (e.target as Element).closest<HTMLElement>("[data-k]");
      if (b) apply({ [b.dataset.k!]: b.getAttribute("aria-pressed") !== "true" });
    });
    const algn = el("div", { class: "seg", role: "group", "aria-label": "Text alignment" },
      ([["l", "Left", ICON.textL], ["ctr", "Centre", ICON.textC], ["r", "Right", ICON.textR]] as const)
        .map(([a, name, icon]) => `<button type="button" data-a="${a}" aria-pressed="${st.algn === a}" aria-label="Align text ${name.toLowerCase()}" title="${name}">${icon}</button>`).join(""));
    algn.addEventListener("click", e => {
      const b = (e.target as Element).closest<HTMLElement>("[data-a]");
      if (b) apply({ algn: b.dataset.a });
    });
    const r2 = el("div", { class: "row" });
    r2.append(emph, algn);
    sec.append(r1, r2, colourControl("Text colour", st.color, hex => { if (hex) apply({ color: hex }); }));
  }
  sec.appendChild(colourControl(node.localName === "tc" ? "Cell fill" : "Fill", st.noFill ? null : st.fill, hex => apply({ fill: hex }), true));
  return sec;
}

const ROUND = [{ geom: "roundRect", label: "Rounded", icon: '<svg viewBox="-4 -4 108 108" aria-hidden="true"><rect width="100" height="100" rx="18" fill="currentColor"/></svg>' },
  { geom: "ellipse", label: "Circle", icon: '<svg viewBox="-4 -4 108 108" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="currentColor"/></svg>' }];
/** Swap the shape's outline and set its border, like PowerPoint's Shape Format tab. */
function shapeSection(node: Element): HTMLElement | null {
  const geom = readGeom(node);
  if (geom === null || kid(kid(node, "nvSpPr"), "cNvSpPr")?.getAttribute("txBox") === "1") return null; // plain text boxes don't need it
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Shape"));
  const grid = el("div", { class: "shape-grid small", role: "group", "aria-label": "Change shape" });
  for (const s of [...ROUND, ...SHAPES.map(x => ({ geom: x.geom, label: x.label, icon: `<svg viewBox="-4 -4 108 108" aria-hidden="true"><polygon points="${x.poly}" fill="currentColor"/></svg>` }))]) {
    const b = el("button", { class: "shape-btn", type: "button", title: s.label, "aria-label": `Change to ${s.label.toLowerCase()}`, "aria-pressed": String(geom === s.geom) }, s.icon);
    b.addEventListener("click", () => { if (setGeom(S.deck, S.cur, S.sel.obj, s.geom)) ui.refresh(); });
    grid.appendChild(b);
  }
  sec.appendChild(grid);
  const out = readOutline(node);
  sec.appendChild(colourControl("Outline", out.color, hex => { if (setOutline(S.deck, S.cur, S.sel.obj, hex)) ui.refresh(); }, true));
  if (out.color) {
    const w = el("select", { class: "inp", "aria-label": "Outline width" },
      [[0.75, "Hairline"], [1.5, "Thin"], [3, "Medium"], [6, "Thick"]].map(([v, n]) => `<option value="${v}">${n}</option>`).join(""));
    const pt = out.w / 12700;
    w.value = String([0.75, 1.5, 3, 6].reduce((a, b) => Math.abs(b - pt) < Math.abs(a - pt) ? b : a));
    w.addEventListener("change", () => { if (setOutline(S.deck, S.cur, S.sel.obj, out.color, +w.value)) ui.refresh(); });
    sec.appendChild(w);
  }
  return sec;
}

function arrangeSection(node: Element): HTMLElement | null {
  const info = S.deck.slides[S.cur]!;
  const b = readBox(S.deck, node, info);
  if (!b) return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, 'Arrange <span class="hint">inches</span>'));
  const al = el("div", { class: "align-grid", role: "group", "aria-label": "Align on the slide" });
  for (const [how, name, icon] of [["left", "left", ICON.alignL], ["centre", "centre", ICON.alignC], ["right", "right", ICON.alignR], ["top", "top", ICON.alignT], ["middle", "middle", ICON.alignM], ["bottom", "bottom", ICON.alignB]] as [Align, string, string][]) {
    const btn = el("button", { class: "icon-btn small", type: "button", title: `Align ${name} on the slide`, "aria-label": `Align ${name} on the slide` }, icon);
    btn.addEventListener("click", () => { if (alignObj(S.deck, S.cur, S.sel.obj, how)) ui.refresh(); });
    al.appendChild(btn);
  }
  sec.appendChild(al);
  const g = el("div", { class: "cols-4" });
  for (const [k, lab] of [["x", "Left"], ["y", "Top"], ["cx", "Width"], ["cy", "Height"]] as const) {
    const id = `pos-${k}`;
    const i = el("input", { class: "inp", id, type: "number", step: "0.05", value: inches(b[k]), style: "padding:0 6px" });
    i.addEventListener("change", () => {
      const v = Math.round(parseFloat(i.value) * IN);
      if (!isNaN(v) && setBox(S.deck, S.cur, S.sel.obj, cur => ({ ...cur, [k]: v }))) ui.refresh();
    });
    const w = el("div");
    w.append(el("label", { class: "lbl", for: id }, lab), i);
    g.appendChild(w);
  }
  sec.appendChild(g);
  const rot = readRotation(node);
  if (rot !== null) {
    const r = el("div", { class: "row tight" });
    const i = el("input", { class: "inp", id: "pos-rot", type: "number", step: "15", value: String(rot), style: "width:90px;flex:none" });
    i.addEventListener("change", () => { if (setRotation(S.deck, S.cur, S.sel.obj, parseFloat(i.value) || 0)) ui.refresh(); });
    const turn = el("button", { class: "btn small", type: "button" }, "Rotate 90\u00B0");
    turn.addEventListener("click", () => { if (setRotation(S.deck, S.cur, S.sel.obj, rot + 90)) ui.refresh(); });
    r.append(i, turn);
    sec.append(el("label", { class: "lbl", for: "pos-rot" }, "Rotation (degrees)"), r);
  }
  return sec;
}

function slideSection(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "empty-note" }, "<b>Nothing selected</b>Click something on the slide to format it, or drag an element in from the left."));
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, `Slide ${S.cur + 1}`));
  sec.appendChild(colourControl("Background", slideBackground(S.deck, S.cur), hex => { if (setSlideBackground(S.deck, S.cur, hex)) ui.refresh(); }, true));
  wrap.appendChild(sec);
  return wrap;
}

export function renderInspector(): void {
  const host = $("#insp");
  if (S.view !== "design") return;
  const active = document.activeElement as HTMLTextAreaElement | null;
  const keep = active?.id === "inspText" ? [active.selectionStart, active.selectionEnd] as const : null;
  const scroll = host.scrollTop;
  host.replaceChildren();
  const doc = parseXml(S.deck.texts[S.deck.slides[S.cur]!.path]!);
  const node = S.sel.obj !== null ? collectObjects(doc)[S.sel.obj] : undefined;
  if (!node) { clearSel(); host.appendChild(slideSection()); return; }
  const isTable = node.localName === "graphicFrame" && !!node.getElementsByTagNameNS(A_NS, "tbl")[0];
  const kind = isTable ? "Table" : node.localName === "graphicFrame" ? "Object" : node.localName === "pic" ? "Picture"
    : node.localName === "grpSp" ? "Group" : node.localName === "cxnSp" ? "Line" : kid(node, "txBody") ? "Text box" : "Shape";
  const cell = S.sel.cell !== null;

  const top = el("div", { class: "sect" });
  const head = el("div", { class: "insp-head" });
  head.appendChild(el("h2", {}, cell ? "Table cell" : kind));
  const tools = el("div", { class: "tools" });
  const tool = (label: string, icon: string, fn: () => void, danger = false) => {
    const b = el("button", { class: "icon-btn small" + (danger ? " danger" : ""), type: "button", title: label, "aria-label": label }, icon);
    b.addEventListener("click", fn);
    tools.appendChild(b);
  };
  tool("Duplicate (Ctrl+D)", ICON.duplicate, duplicateSelected);
  tool("Bring to front", ICON.front, () => reorder("front"));
  tool("Send to back", ICON.back, () => reorder("back"));
  tool("Delete (Del)", ICON.trash, deleteSelected, true);
  head.appendChild(tools);
  top.appendChild(head);
  host.appendChild(top);

  if (isTable) {
    const sec = el("div", { class: "sect" });
    sec.appendChild(el("div", { class: "sect-title" }, "Rows and columns"));
    const row = el("div", { class: "cols-2" });
    for (const [label, op] of [["Add row", "addRow"], ["Add column", "addCol"], ["Delete row", "delRow"], ["Delete column", "delCol"]] as [string, TableOp][]) {
      const del = op.startsWith("del");
      const b = el("button", { class: "btn small" + (del ? " danger" : ""), type: "button", disabled: del && !cell, title: del && !cell ? "Click a cell first" : null }, label);
      b.addEventListener("click", () => {
        const msg = tableOp(S.deck, S.cur, S.sel, op);
        if (!msg) return;
        if (del) S.sel = { obj: S.sel.obj, cell: null };
        ui.refresh();
        toast(msg);
      });
      row.appendChild(b);
    }
    sec.append(row, el("span", { class: "hint" }, cell ? "Rows renumber themselves, so each list item lands in its own row." : "Click a cell to edit it, or drag a field onto it."));
    host.appendChild(sec);
  }
  const textNode = selTextNode(doc, S.sel);
  if (textNode) host.appendChild(textSection(doc, textNode, cell));
  const fs = fieldsSection(doc);
  if (fs) host.appendChild(fs);
  if (textNode) host.appendChild(styleSection(textNode, cell ? "Cell style" : "Style"));
  else if (node.localName === "sp") host.appendChild(styleSection(node, "Style"));
  if (!cell) { const sh = shapeSection(node); if (sh) host.appendChild(sh); }
  const arrange = arrangeSection(node);
  if (arrange) host.appendChild(arrange);
  host.scrollTop = scroll;
  if (keep) {
    const t = document.getElementById("inspText") as HTMLTextAreaElement | null;
    if (t) { t.focus(); t.setSelectionRange(keep[0], keep[1]); }
  }
}

export function deleteSelected(): void {
  if (!deleteObj(S.deck, S.cur, S.sel.obj)) return;
  clearSel();
  ui.refresh();
  toast("Deleted");
}
export function duplicateSelected(): void {
  const idx = duplicateObj(S.deck, S.cur, S.sel.obj);
  if (idx === null) return;
  S.sel = { obj: idx, cell: null };
  ui.refresh();
  toast("Duplicated");
}
function reorder(where: "front" | "back"): void {
  const idx = zOrder(S.deck, S.cur, S.sel.obj, where);
  if (idx === null) return;
  S.sel = { obj: idx, cell: null };
  ui.refresh();
}
