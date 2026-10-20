// The panel on the right: format whatever is selected on the slide.
import { scanPlaceholders } from "../engine/engine";
import { cfgKeyOf } from "../model/fields";
import { readFlip, toggleFlip, replacePicture, readAltText, setAltText, readTableLook, setTableLook, isLine, readArrows, setArrows, readRadius, setRadius, readOpacity, readShadow, setOpacity, setShadow, alignObj, alignObjs, copyObjs, deleteObjs, distributeObjs, groupObjs, pasteObjs, ungroupObj, deleteObj, readGeom, readOutline, readRotation, setGeom, setOutline, setRotation, duplicateObj, inches, IN, readBox, readStyle, selTextNode, setBox, setSlideBackground, setStyle, setText, slideBackground, tableOp, zOrder, type Align, type FieldPayload, type Sel, type ListKind, type TableOp, type TextStyle } from "../ooxml/edit";
import { SHAPES } from "../ooxml/shapes";
import { collectEditables, collectObjects, paraText } from "../ooxml/render";
import { A_NS, dig, esc, kid, kids, nodeXml, parseXml } from "../ooxml/xml";
import { $, ICON, debounce, el, toast } from "./dom";
import { fieldEditor } from "./fields";
import { doPlaceField, prepareImage } from "./stage";
import { S, clearSel, selected, setSel, ui } from "./state";

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
    const size = el("input", { class: "inp", type: "number", min: "6", max: "200", step: "1", value: String(Math.round(st.sz)), "aria-label": "Font size", style: "width:60px;flex:none" });
    size.addEventListener("change", () => apply({ sz: Math.min(200, Math.max(6, +size.value || st.sz)) }));
    // PowerPoint's grow / shrink font steps
    const STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
    const step = (dir: 1 | -1) => apply({ sz: dir > 0 ? STEPS.find(v => v > st.sz) ?? Math.min(200, st.sz + 8) : [...STEPS].reverse().find(v => v < st.sz) ?? Math.max(6, st.sz - 1) });
    const grow = el("div", { class: "seg", role: "group", "aria-label": "Grow or shrink text" },
      '<button type="button" data-d="-1" aria-label="Smaller text" title="Smaller">A<sup>-</sup></button><button type="button" data-d="1" aria-label="Bigger text" title="Bigger">A<sup>+</sup></button>');
    grow.addEventListener("click", e => { const b = (e.target as Element).closest<HTMLElement>("[data-d]"); if (b) step(+b.dataset.d! as 1 | -1); });
    const r1 = el("div", { class: "row tight" });
    r1.append(font, size, grow);
    const emph = el("div", { class: "seg", role: "group", "aria-label": "Emphasis" },
      `<button type="button" data-k="b" aria-pressed="${st.b}" aria-label="Bold" title="Bold (Ctrl+B)"><b>B</b></button><button type="button" data-k="i" aria-pressed="${st.i}" aria-label="Italic" title="Italic (Ctrl+I)"><i>I</i></button>` +
      `<button type="button" data-k="u" aria-pressed="${st.u}" aria-label="Underline" title="Underline (Ctrl+U)"><u>U</u></button><button type="button" data-k="strike" aria-pressed="${st.strike}" aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>` +
      `<button type="button" data-k="caps" aria-pressed="${st.caps}" aria-label="All capitals" title="All capitals">AA</button>`);
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
    r2.append(emph);
    const r3 = el("div", { class: "row" });
    const list = el("div", { class: "seg", role: "group", "aria-label": "List" },
      ([["none", "No list", ICON.listNone], ["bullet", "Bullets", ICON.listBullet], ["number", "Numbers", ICON.listNumber]] as const)
        .map(([k, name, icon]) => `<button type="button" data-l="${k}" aria-pressed="${st.list === k}" aria-label="${name}" title="${name}">${icon}</button>`).join(""));
    list.addEventListener("click", e => { const b = (e.target as Element).closest<HTMLElement>("[data-l]"); if (b) apply({ list: b.dataset.l as ListKind }); });
    r3.append(algn, list);
    sec.append(r1, r2, r3);
    if (node.localName === "sp") {
      const r4 = el("div", { class: "row" });
      const va = el("div", { class: "seg", role: "group", "aria-label": "Vertical position" },
        ([["t", "Top", ICON.alignT], ["ctr", "Middle", ICON.alignM], ["b", "Bottom", ICON.alignB]] as const)
          .map(([a, name, icon]) => `<button type="button" data-v="${a}" aria-pressed="${st.anchor === a}" aria-label="Text at the ${name.toLowerCase()}" title="Text at the ${name.toLowerCase()}">${icon}</button>`).join(""));
      va.addEventListener("click", e => { const b = (e.target as Element).closest<HTMLElement>("[data-v]"); if (b) apply({ anchor: b.dataset.v as "t" | "ctr" | "b" }); });
      const line = el("select", { class: "inp", "aria-label": "Line spacing", title: "Line spacing", style: "width:auto;flex:1" },
        [1, 1.15, 1.5, 2].map(v => `<option value="${v}">Line spacing ${v}</option>`).join(""));
      line.value = String([1, 1.15, 1.5, 2].reduce((a, b) => Math.abs(b - st.line) < Math.abs(a - st.line) ? b : a));
      line.addEventListener("change", () => apply({ line: +line.value }));
      r4.append(va, line);
      sec.appendChild(r4);
    }
    sec.appendChild(colourControl("Text colour", st.color, hex => { if (hex) apply({ color: hex }); }));
  }
  sec.appendChild(colourControl(node.localName === "tc" ? "Cell fill" : "Fill", st.noFill ? null : st.fill, hex => apply({ fill: hex }), true));
  return sec;
}

const ROUND = [{ geom: "roundRect", label: "Rounded", icon: '<svg viewBox="-4 -4 108 108" aria-hidden="true"><rect width="100" height="100" rx="18" fill="currentColor"/></svg>' },
  { geom: "ellipse", label: "Circle", icon: '<svg viewBox="-4 -4 108 108" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="currentColor"/></svg>' }];
/** Replace the image and describe it for screen readers. */
function pictureSection(node: Element): HTMLElement | null {
  if (node.localName !== "pic") return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Picture"));
  const rep = el("button", { class: "btn small", type: "button", style: "width:100%" }, "Replace picture\u2026");
  const file = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
  rep.addEventListener("click", () => file.click());
  const obj = S.sel.obj, slide = S.cur;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    const img = f ? await prepareImage(f) : null;
    if (img && replacePicture(S.deck, slide, obj, img.data, img.ext, img.w, img.h)) { ui.refresh(); toast("Picture replaced"); }
  });
  const alt = el("textarea", { class: "inp", rows: "2", id: "altText", placeholder: "e.g. Bank logo", spellcheck: "true" });
  alt.value = readAltText(node);
  alt.addEventListener("change", () => { if (setAltText(S.deck, S.cur, S.sel.obj, alt.value)) ui.save(); });
  sec.append(rep, file, el("label", { class: "lbl", for: "altText", style: "margin-top:10px" }, "Alt text"), alt,
    el("span", { class: "hint" }, "What a screen reader says for this picture. Leave empty if it is only decoration."));
  return sec;
}

/** Header colour, banded rows and borders, like PowerPoint's Table Design tab. */
function tableDesignSection(node: Element): HTMLElement | null {
  const look = readTableLook(node);
  if (!look) return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Table design"));
  const apply = (l: Partial<typeof look>) => { if (setTableLook(S.deck, S.cur, S.sel.obj, l)) ui.refresh(); };
  sec.appendChild(colourControl("Header row", look.head, hex => apply({ head: hex }), true));
  for (const [k, label] of [["band", "Banded rows"], ["borders", "Cell borders"]] as const) {
    const lab = el("label", { class: "check" });
    const box = el("input", { type: "checkbox", checked: look[k] });
    box.addEventListener("change", () => apply({ [k]: box.checked }));
    lab.append(box, document.createTextNode(` ${label}`));
    sec.appendChild(lab);
  }
  return sec;
}

/** Colour, weight and arrowheads for lines and arrows. */
function lineSection(node: Element): HTMLElement | null {
  if (!isLine(node)) return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Line"));
  const out = readOutline(node);
  sec.appendChild(colourControl("Colour", out.color, hex => { if (hex && setOutline(S.deck, S.cur, S.sel.obj, hex)) ui.refresh(); }));
  const row = el("div", { class: "row", style: "margin-top:8px" });
  const w = el("select", { class: "inp", "aria-label": "Line weight", style: "width:auto;flex:1" },
    [[0.75, "Hairline"], [1.5, "Thin"], [2, "Regular"], [3, "Medium"], [6, "Thick"]].map(([v, n]) => `<option value="${v}">${n}</option>`).join(""));
  const pt = out.w / 12700;
  w.value = String([0.75, 1.5, 2, 3, 6].reduce((a, b) => Math.abs(b - pt) < Math.abs(a - pt) ? b : a));
  w.addEventListener("change", () => { if (setOutline(S.deck, S.cur, S.sel.obj, out.color ?? "000000", +w.value)) ui.refresh(); });
  const ar = readArrows(node);
  const cur = ar.head && ar.tail ? "both" : ar.tail ? "end" : ar.head ? "start" : "none";
  const ends = el("div", { class: "seg", role: "group", "aria-label": "Arrowheads" },
    ([["none", "No arrowheads", "\u2014"], ["end", "Arrow at the end", "\u2192"], ["start", "Arrow at the start", "\u2190"], ["both", "Arrows at both ends", "\u2194"]] as const)
      .map(([k, name, glyph]) => `<button type="button" data-e="${k}" aria-pressed="${cur === k}" aria-label="${name}" title="${name}">${glyph}</button>`).join(""));
  ends.addEventListener("click", e => {
    const k = (e.target as Element).closest<HTMLElement>("[data-e]")?.dataset.e;
    if (k && setArrows(S.deck, S.cur, S.sel.obj, k === "start" || k === "both", k === "end" || k === "both")) ui.refresh();
  });
  row.append(w, ends);
  sec.appendChild(row);
  return sec;
}

/** Swap the shape's outline and set its border, like PowerPoint's Shape Format tab. */
function shapeSection(node: Element): HTMLElement | null {
  const geom = readGeom(node);
  if (geom === null || isLine(node) || kid(kid(node, "nvSpPr"), "cNvSpPr")?.getAttribute("txBox") === "1") return null; // plain text boxes don't need it
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Shape"));
  const grid = el("div", { class: "shape-grid small", role: "group", "aria-label": "Change shape" });
  for (const s of [...ROUND, ...SHAPES.map(x => ({ geom: x.geom, label: x.label, icon: `<svg viewBox="-4 -4 108 108" aria-hidden="true"><polygon points="${x.poly}" fill="currentColor"/></svg>` }))]) {
    const b = el("button", { class: "shape-btn", type: "button", title: s.label, "aria-label": `Change to ${s.label.toLowerCase()}`, "aria-pressed": String(geom === s.geom) }, s.icon);
    b.addEventListener("click", () => { if (setGeom(S.deck, S.cur, S.sel.obj, s.geom)) ui.refresh(); });
    grid.appendChild(b);
  }
  sec.appendChild(grid);
  const rad = readRadius(node);
  if (rad !== null) {
    const row = el("div", { class: "row tight", style: "margin-bottom:10px" });
    const range = el("input", { type: "range", min: "0", max: "50", step: "1", value: String(rad), "aria-label": "Corner roundness", style: "flex:1" });
    range.addEventListener("change", () => { if (setRadius(S.deck, S.cur, S.sel.obj, +range.value)) ui.refresh(); });
    row.appendChild(range);
    sec.append(el("span", { class: "lbl" }, "Corners"), row);
  }
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

/** Transparency and shadow, for shapes and pictures. */
function effectsSection(node: Element): HTMLElement | null {
  if (node.localName !== "sp" && node.localName !== "pic") return null;
  const isPic = node.localName === "pic";
  if (!isPic && !dig(node, "spPr", "solidFill", "srgbClr") && !readShadow(node) && kid(kid(node, "nvSpPr"), "cNvSpPr")?.getAttribute("txBox") === "1") return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Effects"));
  if (isPic || dig(node, "spPr", "solidFill", "srgbClr")) {
    const op = readOpacity(node);
    const row = el("div", { class: "row tight" });
    const range = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(100 - op), "aria-label": "Transparency", style: "flex:1" });
    const out = el("span", { class: "hint", style: "width:40px;text-align:right" }, `${Math.round(100 - op)}%`);
    range.addEventListener("input", () => { out.textContent = `${range.value}%`; });
    range.addEventListener("change", () => { if (setOpacity(S.deck, S.cur, S.sel.obj, 100 - +range.value)) ui.refresh(); });
    row.append(range, out);
    sec.append(el("span", { class: "lbl" }, "Transparency"), row);
  }
  const sh = el("label", { class: "check" });
  const box = el("input", { type: "checkbox", checked: readShadow(node) });
  box.addEventListener("change", () => { if (setShadow(S.deck, S.cur, S.sel.obj, box.checked)) ui.refresh(); });
  sh.append(box, document.createTextNode(" Shadow"));
  sec.appendChild(sh);
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
    const fl = readFlip(node);
    if (fl) {
      const flips = el("div", { class: "seg", role: "group", "aria-label": "Flip" },
        `<button type="button" data-f="h" aria-pressed="${fl.h}" aria-label="Flip horizontally" title="Flip horizontally">\u21C4</button><button type="button" data-f="v" aria-pressed="${fl.v}" aria-label="Flip vertically" title="Flip vertically">\u21C5</button>`);
      flips.addEventListener("click", e => { const f = (e.target as Element).closest<HTMLElement>("[data-f]")?.dataset.f; if (f && toggleFlip(S.deck, S.cur, S.sel.obj, f as "h" | "v")) ui.refresh(); });
      r.appendChild(flips);
    }
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
  if (S.multi.length) { multiPanel(host); host.scrollTop = scroll; return; }
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

  if (node.localName === "grpSp") {
    const sec = el("div", { class: "sect" });
    const ug = el("button", { class: "btn small", type: "button", style: "width:100%" }, "Ungroup (Ctrl+Shift+G)");
    ug.addEventListener("click", ungroupSelected);
    sec.appendChild(ug);
    host.appendChild(sec);
  }
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
  const td = tableDesignSection(node); if (td) host.appendChild(td);
  if (!cell) {
    const pc = pictureSection(node); if (pc) host.appendChild(pc);
    const ls = lineSection(node); if (ls) host.appendChild(ls);
    const sh = shapeSection(node); if (sh) host.appendChild(sh);
    const fx = effectsSection(node); if (fx) host.appendChild(fx);
  }
  const arrange = arrangeSection(node);
  if (arrange) host.appendChild(arrange);
  host.scrollTop = scroll;
  if (keep) {
    const t = document.getElementById("inspText") as HTMLTextAreaElement | null;
    if (t) { t.focus(); t.setSelectionRange(keep[0], keep[1]); }
  }
}

export function deleteSelected(): void {
  const n = selected().length;
  if (!(n > 1 ? deleteObjs(S.deck, S.cur, selected()) : deleteObj(S.deck, S.cur, S.sel.obj))) return;
  clearSel();
  ui.refresh();
  toast(n > 1 ? `Deleted ${n} items` : "Deleted");
}
export function duplicateSelected(): void {
  if (S.multi.length) {
    const c = copyObjs(S.deck, S.cur, selected());
    const got = c ? pasteObjs(S.deck, S.cur, c) : [];
    if (!got.length) return;
    setSel(got[0]!, got.slice(1));
    ui.refresh();
    toast("Duplicated");
    return;
  }
  const idx = duplicateObj(S.deck, S.cur, S.sel.obj);
  if (idx === null) return;
  setSel(idx);
  ui.refresh();
  toast("Duplicated");
}
function reorder(where: "front" | "back"): void {
  const idx = zOrder(S.deck, S.cur, S.sel.obj, where);
  if (idx === null) return;
  setSel(idx);
  ui.refresh();
}

export function groupSelected(): void {
  const idx = groupObjs(S.deck, S.cur, selected());
  if (idx === null) return;
  setSel(idx);
  ui.refresh();
  toast("Grouped. Ctrl+Shift+G breaks it apart.");
}
export function ungroupSelected(): void {
  const got = ungroupObj(S.deck, S.cur, S.sel.obj);
  if (!got.length) return;
  setSel(got[0]!, got.slice(1));
  ui.refresh();
  toast("Ungrouped");
}

const ALIGNS: [Align, string, string][] = [["left", "left", ICON.alignL], ["centre", "centre", ICON.alignC], ["right", "right", ICON.alignR], ["top", "top", ICON.alignT], ["middle", "middle", ICON.alignM], ["bottom", "bottom", ICON.alignB]];
/** The panel when several things are selected: align, distribute, group. */
function multiPanel(host: HTMLElement): void {
  const objs = selected();
  const top = el("div", { class: "sect" });
  const head = el("div", { class: "insp-head" });
  head.appendChild(el("h2", {}, `${objs.length} items`));
  const tools = el("div", { class: "tools" });
  for (const [label, icon, fn, danger] of [["Duplicate (Ctrl+D)", ICON.duplicate, duplicateSelected, false], ["Delete (Del)", ICON.trash, deleteSelected, true]] as const) {
    const b = el("button", { class: "icon-btn small" + (danger ? " danger" : ""), type: "button", title: label, "aria-label": label }, icon);
    b.addEventListener("click", fn);
    tools.appendChild(b);
  }
  head.appendChild(tools);
  top.appendChild(head);
  const grp = el("button", { class: "btn small", type: "button", style: "width:100%" }, "Group (Ctrl+G)");
  grp.addEventListener("click", groupSelected);
  top.appendChild(grp);
  host.appendChild(top);

  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Align to each other"));
  const al = el("div", { class: "align-grid", role: "group", "aria-label": "Align selected items" });
  for (const [how, name, icon] of ALIGNS) {
    const btn = el("button", { class: "icon-btn small", type: "button", title: `Align ${name}`, "aria-label": `Align ${name}` }, icon);
    btn.addEventListener("click", () => { if (alignObjs(S.deck, S.cur, objs, how)) ui.refresh(); });
    al.appendChild(btn);
  }
  sec.appendChild(al);
  const dist = el("div", { class: "cols-2", style: "margin-top:8px" });
  for (const [axis, label] of [["h", "Space across"], ["v", "Space down"]] as const) {
    const b = el("button", { class: "btn small", type: "button", disabled: objs.length < 3, title: objs.length < 3 ? "Select three or more" : `Equal gaps ${axis === "h" ? "left to right" : "top to bottom"}` }, label);
    b.addEventListener("click", () => { if (distributeObjs(S.deck, S.cur, objs, axis)) ui.refresh(); });
    dist.appendChild(b);
  }
  sec.append(dist, el("span", { class: "hint" }, "Shift+click to add or remove items. Drag on an empty part of the slide to select by area."));
  host.appendChild(sec);
}

/** Ctrl+B / Ctrl+I / Ctrl+U on the selected text box or cell. */
export function toggleStyle(k: "b" | "i" | "u"): boolean {
  const info = S.deck.slides[S.cur];
  if (!info || S.sel.obj === null || S.multi.length) return false;
  const doc = parseXml(S.deck.texts[info.path]!);
  const node = selTextNode(doc, S.sel);
  if (!node) return false;
  if (setStyle(S.deck, S.cur, S.sel, { [k]: !readStyle(node)[k] })) ui.refresh();
  return true;
}

/* ---------------------------------------------------------------- right-click menu */
let menu: HTMLElement | null = null;
const closeMenu = (): void => { menu?.remove(); menu = null; };
/** Cut, copy, paste, arrange and group from a right-click on the slide. */
export function openContextMenu(x: number, y: number, actions: { copy: () => boolean; paste: () => boolean; canPaste: boolean }): void {
  closeMenu();
  const has = S.sel.obj !== null, many = S.multi.length > 0;
  const info = S.deck.slides[S.cur];
  const node = has && info ? collectObjects(parseXml(S.deck.texts[info.path]!))[S.sel.obj!] : undefined;
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl+";
  const items: ([string, string, () => void, boolean] | null)[] = [
    ["Cut", `${mod}X`, () => { if (actions.copy()) deleteSelected(); }, has],
    ["Copy", `${mod}C`, () => { actions.copy(); }, has],
    ["Paste", `${mod}V`, () => { actions.paste(); }, actions.canPaste],
    ["Duplicate", `${mod}D`, duplicateSelected, has],
    ["Copy style", `${mod}\u2325C`.replace("Ctrl+\u2325", "Ctrl+Alt+"), () => { copyStyle(); }, has && !many],
    ["Paste style", `${mod}\u2325V`.replace("Ctrl+\u2325", "Ctrl+Alt+"), () => { pasteStyle(); }, has && !!styleClip],
    ["Delete", "Del", deleteSelected, has],
    null,
    ["Bring to front", "", () => reorder("front"), has && !many],
    ["Send to back", "", () => reorder("back"), has && !many],
    null,
    ["Group", `${mod}G`, groupSelected, many],
    ["Ungroup", `${mod}\u21E7G`, ungroupSelected, node?.localName === "grpSp" && !many],
  ];
  menu = el("div", { class: "ctx-menu", role: "menu" });
  for (const it of items) {
    if (!it) { menu.appendChild(el("div", { class: "ctx-sep", role: "separator" })); continue; }
    const [label, keys, fn, on] = it;
    const b = el("button", { type: "button", role: "menuitem", disabled: !on }, `<span>${label}</span><kbd>${keys}</kbd>`);
    b.addEventListener("click", () => { closeMenu(); fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  (menu.querySelector("button:not([disabled])") as HTMLElement | null)?.focus();
  menu.addEventListener("keydown", e => {
    const btns = [...menu!.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus(); }
    if (e.key === "Escape") { e.stopPropagation(); closeMenu(); }
  });
}
document.addEventListener("pointerdown", e => { if (menu && !(e.target as Element).closest(".ctx-menu")) closeMenu(); });
window.addEventListener("blur", closeMenu);

/* ---------------------------------------------------------------- copy and paste style */
let styleClip: (TextStyle & { fill?: string | null }) | null = null;
/** Remember the selected item's text style and fill (Ctrl+Alt+C). */
export function copyStyle(): boolean {
  const info = S.deck.slides[S.cur];
  if (!info || S.sel.obj === null) return false;
  const doc = parseXml(S.deck.texts[info.path]!);
  const node = selTextNode(doc, S.sel) ?? collectObjects(doc)[S.sel.obj];
  if (!node) return false;
  const st = readStyle(node);
  styleClip = { sz: st.sz, b: st.b, i: st.i, u: st.u, strike: st.strike, caps: st.caps, color: st.color, font: st.font, algn: st.algn, fill: st.noFill ? null : st.fill ?? undefined };
  toast("Style copied. Select something and paste it with Ctrl+Alt+V.");
  return true;
}
/** Apply the remembered style to everything selected (Ctrl+Alt+V). */
export function pasteStyle(): boolean {
  if (!styleClip || S.sel.obj === null) return false;
  let any = false;
  for (const obj of selected()) any = setStyle(S.deck, S.cur, obj === S.sel.obj ? S.sel : { obj, cell: null }, styleClip) || any;
  if (any) ui.refresh();
  return any;
}
export const hasStyleClip = (): boolean => !!styleClip;
