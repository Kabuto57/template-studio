// Every change the editor can make to a template. Each function edits the deck through
// Deck.mutate / Deck.transaction (so it is undoable) and returns what the UI needs to know.
//
// OOXML is strict about child order. The rules these edits rely on:
//   a:p     -> a:pPr first, runs, then a:endParaRPr last
//   p:spPr  -> a:xfrm, geometry, fill, a:ln
//   a:rPr   -> a:ln, fill, then fonts
//   a:tcPr  -> borders (lnL, lnR, lnT, lnB), then fill
import { rewritePlaceholders, isSlidePart, scanPlaceholders, visibleText, xmlEscape } from "../engine/engine";
import { rootOf, type Project } from "../model/fields";
import type { Deck, SlideInfo } from "./deck";
import { collectEditables, collectObjects, findPh, paraText, phOf, xfrmOf, type Editable } from "./render";
import { SHAPES } from "./shapes";
import { A_NS, CT_NS, P_NS, PR_NS, R_NS, XML_DECL, dig, kid, kids, nodeXml, num, parseXml, relTarget, relsPathOf, resolvePath, serializeXml } from "./xml";

export const IN = 914400;      // EMU per inch
export const GRID = 45720;     // 0.05 in snap grid
export const MIN = 182880;     // smallest box: 0.2 in
export const snap = (v: number): number => Math.round(v / GRID) * GRID;
export const inches = (emu: number): string => (emu / IN).toFixed(2);

export interface Rect { x: number; y: number; cx: number; cy: number }
export interface Sel { obj: number | null; cell: number | null }

const attrEsc = (s: string): string => xmlEscape(s).replace(/"/g, "&quot;");

/* ---------------------------------------------------------------- geometry */
function xfrmHolder(node: Element): Element | null {
  if (node.localName === "graphicFrame") return node;
  return kid(node, node.localName === "grpSp" ? "grpSpPr" : "spPr");
}

/** A shape's box; placeholders without their own position inherit it from the layout or master. */
export function readBox(deck: Deck, node: Element, info: SlideInfo): Rect | null {
  let b = xfrmOf(xfrmHolder(node));
  const ph = node.localName === "sp" ? phOf(node) : null;
  if (!b && ph) {
    const docOf = (p: string | null) => (p && deck.texts[p] ? parseXml(deck.texts[p]!) : null);
    b = xfrmOf(kid(findPh(docOf(info.layout), ph), "spPr")) || xfrmOf(kid(findPh(docOf(info.master), { type: ph.type, idx: null }), "spPr"));
  }
  return b;
}

function writeBox(node: Element, b: Rect, old?: Rect | null): void {
  const holder = xfrmHolder(node);
  if (!holder) return;
  const doc = node.ownerDocument;
  let x = kid(holder, "xfrm");
  if (!x) {
    const frame = node.localName === "graphicFrame";
    x = frame ? doc.createElementNS(P_NS, "p:xfrm") : doc.createElementNS(A_NS, "a:xfrm");
    x.appendChild(doc.createElementNS(A_NS, "a:off"));
    x.appendChild(doc.createElementNS(A_NS, "a:ext"));
    holder.insertBefore(x, frame ? kid(holder, "graphic") : holder.firstElementChild);
  }
  const off = kid(x, "off")!, ext = kid(x, "ext")!;
  off.setAttribute("x", String(Math.round(b.x)));
  off.setAttribute("y", String(Math.round(b.y)));
  ext.setAttribute("cx", String(Math.round(Math.max(b.cx, 9525))));
  ext.setAttribute("cy", String(Math.round(Math.max(b.cy, 9525))));
  if (node.localName === "graphicFrame" && old) {
    const tbl = node.getElementsByTagNameNS(A_NS, "tbl")[0];
    if (tbl && Math.abs(b.cx - old.cx) > 1) fitColumns(tbl, b.cx);
    if (tbl && Math.abs(b.cy - old.cy) > 1 && old.cy > 0) {
      const f = b.cy / old.cy;
      for (const tr of kids(tbl, "tr")) tr.setAttribute("h", String(Math.max(GRID * 4, Math.round(num(tr.getAttribute("h")) * f))));
    }
  }
}

function fitColumns(tbl: Element, cx: number): void {
  const cols = kids(kid(tbl, "tblGrid"), "gridCol");
  const sum = cols.reduce((a, c) => a + num(c.getAttribute("w")), 0) || 1;
  cols.forEach(c => c.setAttribute("w", String(Math.round(num(c.getAttribute("w")) * cx / sum))));
}

export function resizeBox(b: Rect, h: string, dx: number, dy: number): Rect {
  let { x, y, cx, cy } = b;
  if (h.includes("e")) cx = b.cx + dx;
  if (h.includes("s")) cy = b.cy + dy;
  if (h.includes("w")) { x = b.x + dx; cx = b.cx - dx; }
  if (h.includes("n")) { y = b.y + dy; cy = b.cy - dy; }
  // Clamp only the sides being dragged, so a thin divider keeps its height when widened.
  if (cx < MIN && /[ew]/.test(h)) { if (h.includes("w")) x -= MIN - cx; cx = MIN; }
  if (cy < MIN && /[ns]/.test(h)) { if (h.includes("n")) y -= MIN - cy; cy = MIN; }
  return { x, y, cx, cy };
}

/* ---------------------------------------------------------------- shape XML */
export interface ParaSpec { text: string; sz?: number; b?: boolean; i?: boolean; color?: string; font?: string; algn?: "l" | "ctr" | "r"; bullet?: boolean; spc?: number; after?: number; line?: number }
export interface ShapeSpec {
  id: number; name: string; box: Rect; paras?: ParaSpec[]; fill?: string | null; line?: string | null; lineW?: number;
  geom?: string; radius?: number; anchor?: "t" | "ctr" | "b"; ins?: number; txBox?: boolean;
}
export interface CellStyle { sz?: number; b?: boolean; color?: string; fill?: string | null; anchor?: string; font?: string; border?: string | null; algn?: "l" | "ctr" | "r" }
export interface TableSpec {
  id: number; name: string; box: Rect; list: string; cols: { key: string; label: string; w?: number }[]; rows: number;
  head?: CellStyle; body?: CellStyle; band?: string | null; headH?: number; rowH?: number;
}

const DEFAULT_INK = "1F2933";

function rPrXml({ sz = 16, b = false, i = false, color = DEFAULT_INK, font, spc }: ParaSpec | CellStyle & { i?: boolean; spc?: number }): string {
  return `<a:rPr lang="en-US" sz="${Math.round(sz * 100)}"${b ? ' b="1"' : ""}${i ? ' i="1"' : ""}${spc ? ` spc="${Math.round(spc * 100)}"` : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${font ? `<a:latin typeface="${attrEsc(font)}"/><a:cs typeface="${attrEsc(font)}"/>` : ""}</a:rPr>`;
}
function paraXml(p: ParaSpec): string {
  const spacing = (p.line ? `<a:lnSpc><a:spcPct val="${Math.round(p.line * 100000)}"/></a:lnSpc>` : "") +
    (p.after ?? (p.bullet ? 6 : 0) ? `<a:spcAft><a:spcPts val="${Math.round((p.after ?? 6) * 100)}"/></a:spcAft>` : "");
  const bullet = p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : "<a:buNone/>";
  const ind = p.bullet ? ' marL="285750" indent="-285750"' : "";
  return `<a:p><a:pPr${p.algn ? ` algn="${p.algn}"` : ""}${ind}>${spacing}${bullet}</a:pPr><a:r>${rPrXml(p)}<a:t>${xmlEscape(p.text)}</a:t></a:r></a:p>`;
}
export function shapeXml({ id, name, box, paras, fill = null, geom = "rect", radius = 8000, anchor = "t", ins = 0, txBox = true, line = null, lineW = 9525 }: ShapeSpec): string {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>";
  const lnXml = line ? `<a:ln w="${lineW}"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  const geomXml = geom === "roundRect"
    ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${radius}"/></a:avLst></a:prstGeom>`
    : `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>`;
  const body = paras
    ? `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras.map(paraXml).join("")}</p:txBody>`
    : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${attrEsc(name)}"/><p:cNvSpPr${txBox && paras ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${Math.round(box.cx)}" cy="${Math.round(box.cy)}"/></a:xfrm>${geomXml}${fillXml}${lnXml}</p:spPr>${body}</p:sp>`;
}
function cellXml(text: string, { sz = 12, b = false, color = DEFAULT_INK, fill = null, anchor = "ctr", font, border = "D9DFE6", algn }: CellStyle): string {
  const side = (s: string) => border ? `<a:${s} w="9525"><a:solidFill><a:srgbClr val="${border}"/></a:solidFill></a:${s}>` : `<a:${s} w="0"><a:noFill/></a:${s}>`;
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${algn ? `<a:pPr algn="${algn}"/>` : ""}<a:r>${rPrXml({ sz, b, color, font })}<a:t>${xmlEscape(text)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="${anchor}">${side("lnL")}${side("lnR")}${side("lnT")}${side("lnB")}` +
    `${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr></a:tc>`;
}
export function tableXml({ id, name, box, list, cols, rows, head = {}, body = {}, band = "F3F5F8", headH = 0.42, rowH = 0.48 }: TableSpec): string {
  const weights = cols.map(c => c.w ?? 1), total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => Math.round(box.cx * w / total));
  const hh = Math.round(headH * IN), rh = Math.round(rowH * IN);
  const headStyle: CellStyle = { sz: 12, b: true, color: "FFFFFF", fill: "16253D", ...head };
  let xml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${attrEsc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${widths.reduce((a, b) => a + b, 0)}" cy="${hh + rh * rows}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>` +
    widths.map(w => `<a:gridCol w="${w}"/>`).join("") + "</a:tblGrid>";
  xml += `<a:tr h="${hh}">` + cols.map(c => cellXml(c.label, headStyle)).join("") + "</a:tr>";
  for (let r = 1; r <= rows; r++) {
    xml += `<a:tr h="${rh}">` + cols.map(c => cellXml(`{{${list}.${r}.${c.key}}}`, { sz: 12, ...body, fill: r % 2 ? body.fill ?? null : band ?? body.fill ?? null })).join("") + "</a:tr>";
  }
  return xml + "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
}

/* ---------------------------------------------------------------- blocks */
export type BlockType = "title" | "subtitle" | "text" | "bullets" | "quote" | "callout" | "number" | "table" | "label" | "tag" | "box" | "frame" | "circle" | "line" | `shape:${string}`;
export interface BlockDef { type: BlockType; label: string; w: number; h: number; base?: string; hint: string }
export const BLOCKS: BlockDef[] = [
  { type: "title", label: "Title", w: 8, h: 0.9, base: "title", hint: "A heading with its own field" },
  { type: "subtitle", label: "Subtitle", w: 8, h: 0.6, base: "subtitle", hint: "A line under a title" },
  { type: "text", label: "Text", w: 5, h: 1.4, base: "text", hint: "A paragraph the LLM writes" },
  { type: "bullets", label: "Bullet list", w: 5, h: 2.2, base: "points", hint: "One bullet per list item" },
  { type: "quote", label: "Quote", w: 7, h: 1.4, base: "quote", hint: "A pull quote in large italics" },
  { type: "callout", label: "Callout", w: 4, h: 1.6, base: "callout", hint: "A message in a coloured panel" },
  { type: "number", label: "Number tile", w: 2.4, h: 1.5, base: "number", hint: "A big figure with a label" },
  { type: "table", label: "Table", w: 8, h: 1.86, base: "rows", hint: "One row per list item" },
  { type: "label", label: "Label", w: 3, h: 0.45, hint: "Fixed text, such as a heading" },
  { type: "tag", label: "Tag", w: 1.4, h: 0.4, hint: "A small coloured pill with fixed text" },
  { type: "box", label: "Box", w: 3, h: 2, hint: "A rounded panel" },
  { type: "frame", label: "Frame", w: 3, h: 2, hint: "An outline with no fill" },
  { type: "circle", label: "Circle", w: 1.6, h: 1.6, hint: "A round accent" },
  { type: "line", label: "Divider", w: 4, h: 0.04, hint: "A thin rule" },
];
/** Every preset shape is a block too, so it can be clicked or dragged in like the others. */
export const SHAPE_BLOCKS: BlockDef[] = SHAPES.map(s => ({ type: `shape:${s.geom}`, label: s.label, w: s.w, h: s.h, hint: "A shape" }));
export const blockDef = (t: string): BlockDef | undefined => BLOCKS.find(b => b.type === t) ?? SHAPE_BLOCKS.find(b => b.type === t);

/** The template's own look, read from its slides, so new elements fit in. */
export interface Look { accent: string; ink: string; muted: string; panel: string; font?: string }
export function lookOf(deck: Deck): Look {
  const count = new Map<string, number>(), fonts = new Map<string, number>();
  for (const sl of deck.slides) {
    const xml = deck.texts[sl.path] ?? "";
    for (const m of xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)) { const c = m[1]!.toUpperCase(); count.set(c, (count.get(c) ?? 0) + 1); }
    for (const m of xml.matchAll(/<a:latin typeface="([^"+][^"]*)"/g)) fonts.set(m[1]!, (fonts.get(m[1]!) ?? 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const rgb = (c: string) => [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
  const sat = (c: string) => { const v = rgb(c); return Math.max(...v) - Math.min(...v); };
  const lum = (c: string) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const pick = (ok: (c: string) => boolean, fallback: string) => ranked.find(ok) ?? fallback;
  return {
    accent: pick(c => sat(c) > 60, "2B6CB0"),
    ink: pick(c => lum(c) < 0.3, "16253D"),
    muted: pick(c => lum(c) >= 0.3 && lum(c) < 0.6 && sat(c) < 40, "5F6B7A"),
    panel: pick(c => lum(c) > 0.88 && lum(c) < 0.99, "EEF2F5"),
    font: [...fonts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
  };
}
export const accentOf = (deck: Deck): string => lookOf(deck).accent;
export function blockSize(deck: Deck, def: BlockDef): { cx: number; cy: number } {
  return { cx: snap(Math.min(def.w * IN, deck.W - 0.4 * IN)), cy: Math.max(GRID, snap(Math.min(def.h * IN, deck.H - 0.4 * IN))) };
}

/** Root names already used by the template or waiting to be placed. */
export function usedRoots(deck: Deck, project: Project): Set<string> {
  const set = new Set(deck.scan().map(f => rootOf(f.key)));
  for (const p of project.pending ?? []) set.add(p);
  return set;
}
function uniqueKey(deck: Deck, project: Project, base: string): string {
  const used = usedRoots(deck, project);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function nextShapeId(doc: Document): number {
  let mx = 1;
  for (const e of doc.getElementsByTagName("*")) if (e.localName === "cNvPr") mx = Math.max(mx, num(e.getAttribute("id")));
  return mx + 1;
}
function importXml(doc: Document, xml: string): Element {
  const w = parseXml(`<w xmlns:a="${A_NS}" xmlns:p="${P_NS}" xmlns:r="${R_NS}">${xml}</w>`);
  if (w.getElementsByTagName("parsererror").length) throw new Error("Couldn't build that block.");
  return doc.importNode(w.documentElement.firstElementChild!, true);
}

function blockXml(deck: Deck, project: Project, type: BlockType, id: number, box: Rect): { xml: string; note: string } {
  const def = blockDef(type)!;
  const key = def.base ? uniqueKey(deck, project, def.base) : "";
  const field = `{{${key}}}`;
  const look = lookOf(deck), NAVY = look.ink, ACC = look.accent, MUTED = look.muted, font = look.font;
  if (type.startsWith("shape:")) return { note: "", xml: shapeXml({ id, name: `${def.label} ${id}`, box, fill: ACC, geom: type.slice(6) }) };
  switch (type) {
    case "title": return { note: field, xml: shapeXml({ id, name: `Title ${id}`, box, paras: [{ text: field, sz: 32, b: true, color: NAVY, font }] }) };
    case "subtitle": return { note: field, xml: shapeXml({ id, name: `Subtitle ${id}`, box, paras: [{ text: field, sz: 20, color: MUTED, font }] }) };
    case "text": return { note: field, xml: shapeXml({ id, name: `Text ${id}`, box, paras: [{ text: field, sz: 16, color: NAVY, font }] }) };
    case "quote": return { note: field, xml: shapeXml({ id, name: `Quote ${id}`, box, paras: [{ text: `\u201C${field}\u201D`, sz: 24, i: true, color: NAVY, font }] }) };
    case "callout": return { note: field, xml: shapeXml({ id, name: `Callout ${id}`, box, fill: ACC, geom: "roundRect", radius: 6000, ins: 182880, anchor: "ctr", txBox: false,
      paras: [{ text: field, sz: 16, b: true, color: "FFFFFF" }] }) };
    case "tag": return { note: "", xml: shapeXml({ id, name: `Tag ${id}`, box, fill: ACC, geom: "roundRect", radius: 50000, anchor: "ctr", txBox: false,
      paras: [{ text: "Tag", sz: 12, b: true, color: "FFFFFF", algn: "ctr" }] }) };
    case "frame": return { note: "", xml: shapeXml({ id, name: `Frame ${id}`, box, line: ACC, lineW: 19050 }) };
    case "bullets":
      (project.fields[key] ??= {}).type = "list";
      return { note: field, xml: shapeXml({ id, name: `Bullets ${id}`, box, paras: [{ text: field, sz: 16, bullet: true, color: NAVY, font }] }) };
    case "number":
      return { note: field, xml: shapeXml({ id, name: `Number ${id}`, box, geom: "roundRect", fill: look.panel, ins: 137160, anchor: "ctr", txBox: false,
        paras: [{ text: field, sz: 36, b: true, color: ACC, font }, { text: "Label", sz: 12, color: MUTED, font }] }) };
    case "table":
      return { note: `a list called ${key} (3 rows)`, xml: tableXml({ id, name: `Table ${id}`, box, list: key, rows: 3,
        head: { fill: NAVY, color: "FFFFFF", font, sz: 12, b: true }, body: { font, color: NAVY },
        cols: [{ key: "name", label: "Name" }, { key: "detail", label: "Detail" }, { key: "status", label: "Status" }] }) };
    case "label": return { note: "", xml: shapeXml({ id, name: `Label ${id}`, box, paras: [{ text: "Label", sz: 14, b: true, color: NAVY, font }] }) };
    case "circle": return { note: "", xml: shapeXml({ id, name: `Circle ${id}`, box, fill: "D7E3F4", geom: "ellipse" }) };
    case "line": return { note: "", xml: shapeXml({ id, name: `Divider ${id}`, box, fill: "C5CCD6" }) };
    default: return { note: "", xml: shapeXml({ id, name: `Box ${id}`, box, fill: look.panel, geom: "roundRect" }) };
  }
}

/** Insert a block centred on `centre` (EMU), or in the middle of the slide. Returns the new object's index. */
export function insertBlock(deck: Deck, project: Project, slide: number, type: BlockType, centre?: { x: number; y: number }): { obj: number; note: string; label: string } | null {
  const info = deck.slides[slide], def = blockDef(type);
  if (!info || !def) return null;
  const size = blockSize(deck, def);
  const c = centre ?? { x: deck.W / 2, y: deck.H / 2 };
  const box = {
    cx: size.cx, cy: size.cy,
    x: snap(Math.min(Math.max(c.x - size.cx / 2, 0), deck.W - size.cx)),
    y: snap(Math.min(Math.max(c.y - size.cy / 2, 0), deck.H - size.cy)),
  };
  let note = "", obj = 0;
  const ok = deck.mutate(info.path, doc => {
    const made = blockXml(deck, project, type, nextShapeId(doc), box);
    dig(doc.documentElement, "cSld", "spTree")!.appendChild(importXml(doc, made.xml));
    note = made.note;
    obj = collectObjects(doc).length - 1;
  });
  return ok ? { obj, note, label: def.label } : null;
}

/* ---------------------------------------------------------------- slides */
function nextPart(deck: Deck, prefix: string): string {
  let n = 1;
  while (deck.texts[`${prefix}${n}.xml`] !== undefined || deck.zip.has(`${prefix}${n}.xml`)) n++;
  return `${prefix}${n}.xml`;
}
const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const REL_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

export function blankSlideXml(inner = "", bg?: string): string {
  const bgXml = bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : "";
  return `${XML_DECL}<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld>${bgXml}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
export const layoutRelsXml = (layout: string): string =>
  `${XML_DECL}<Relationships xmlns="${PR_NS}"><Relationship Id="rId1" Type="${REL_LAYOUT}" Target="${relTarget("ppt/slides/slideX.xml", layout)}"/></Relationships>`;

/**
 * A new slide needs five things: the part, its rels, a [Content_Types] Override, a relationship
 * from the presentation, and a p:sldId (id >= 256). Miss one and PowerPoint asks to repair the file.
 */
export function addSlideAt(deck: Deck, pos: number, slideXml: string, relsXml: string): void {
  deck.transaction(put => {
    const path = nextPart(deck, "ppt/slides/slide");
    put(path, slideXml);
    put(relsPathOf(path), relsXml);
    const ct = parseXml(deck.texts["[Content_Types].xml"]!);
    const ov = ct.createElementNS(CT_NS, "Override");
    ov.setAttribute("PartName", "/" + path);
    ov.setAttribute("ContentType", SLIDE_CT);
    ct.documentElement.appendChild(ov);
    put("[Content_Types].xml", serializeXml(ct));
    const prPath = "ppt/_rels/presentation.xml.rels";
    const pr = parseXml(deck.texts[prPath]!);
    const ids = new Set([...pr.documentElement.children].map(r => r.getAttribute("Id")));
    let n = 1;
    while (ids.has(`rId${n}`)) n++;
    const rel = pr.createElementNS(PR_NS, "Relationship");
    rel.setAttribute("Id", `rId${n}`);
    rel.setAttribute("Type", REL_SLIDE);
    rel.setAttribute("Target", relTarget("ppt/presentation.xml", path));
    pr.documentElement.appendChild(rel);
    put(prPath, serializeXml(pr));
    const pres = parseXml(deck.texts["ppt/presentation.xml"]!);
    let lst = kid(pres.documentElement, "sldIdLst");
    if (!lst) {
      lst = pres.createElementNS(P_NS, "p:sldIdLst");
      const master = kid(pres.documentElement, "sldMasterIdLst");
      pres.documentElement.insertBefore(lst, master ? master.nextSibling : pres.documentElement.firstChild);
    }
    const sids = kids(lst, "sldId");
    const sid = pres.createElementNS(P_NS, "p:sldId");
    sid.setAttribute("id", String(Math.max(255, ...sids.map(s => num(s.getAttribute("id")))) + 1));
    sid.setAttributeNS(R_NS, "r:id", `rId${n}`);
    lst.insertBefore(sid, sids[pos] ?? null);
    put("ppt/presentation.xml", serializeXml(pres));
  });
}

export function addBlankSlide(deck: Deck, after: number): number {
  const layout = deck.slides[after]?.layout ?? Object.keys(deck.texts).find(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));
  if (!layout) throw new Error("This template has no slide layout to base a new slide on.");
  addSlideAt(deck, after + 1, blankSlideXml(), layoutRelsXml(layout));
  return after + 1;
}

/** Ready-made slide layouts, as blocks placed on a 13.333 x 7.5 in slide (scaled to other sizes). */
export interface LayoutDef { id: string; label: string; parts: [BlockType, number, number, number, number][] }
const TITLE: LayoutDef["parts"][number] = ["title", 0.9, 0.6, 11.5, 0.9];
export const LAYOUTS: LayoutDef[] = [
  { id: "blank", label: "Blank", parts: [] },
  { id: "cover", label: "Title slide", parts: [["title", 0.9, 2.5, 11.5, 1.3], ["subtitle", 0.9, 3.95, 11.5, 0.6]] },
  { id: "text", label: "Title and text", parts: [TITLE, ["text", 0.9, 1.8, 11.5, 4.8]] },
  { id: "bullets", label: "Title and bullets", parts: [TITLE, ["bullets", 0.9, 1.8, 11.5, 4.8]] },
  { id: "two", label: "Two columns", parts: [TITLE, ["label", 0.9, 1.8, 5.5, 0.45], ["text", 0.9, 2.4, 5.5, 4.2], ["label", 6.9, 1.8, 5.5, 0.45], ["text", 6.9, 2.4, 5.5, 4.2]] },
  { id: "table", label: "Title and table", parts: [TITLE, ["table", 0.9, 1.8, 11.5, 2.4]] },
  { id: "numbers", label: "Three numbers", parts: [TITLE, ["number", 0.9, 1.9, 3.6, 1.8], ["number", 4.85, 1.9, 3.6, 1.8], ["number", 8.8, 1.9, 3.6, 1.8], ["text", 0.9, 4.2, 11.5, 2.3]] },
  { id: "picture", label: "Text and picture", parts: [TITLE, ["text", 0.9, 1.8, 5.5, 4.8], ["box", 6.9, 1.8, 5.5, 4.8]] },
  { id: "section", label: "Section", parts: [["title", 0.9, 2.9, 11.5, 1.2], ["line", 0.9, 4.3, 2, 0.06]] },
  { id: "quote", label: "Quote", parts: [["quote", 1.5, 2.3, 10.3, 2.2], ["subtitle", 1.5, 4.7, 10.3, 0.6]] },
];
/** Add a slide after `after` built from a layout, as one undo step. Returns its index. */
export function addLayoutSlide(deck: Deck, project: Project, after: number, layoutId: string): number {
  const def = LAYOUTS.find(l => l.id === layoutId);
  const layout = deck.slides[after]?.layout ?? Object.keys(deck.texts).find(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));
  if (!layout) throw new Error("This template has no slide layout to base a new slide on.");
  const kx = deck.W / (13.333 * IN), ky = deck.H / (7.5 * IN);
  const pending = project.pending ? [...project.pending] : undefined;
  const xml = (def?.parts ?? []).map(([type, x, y, w, h], i) => {
    const made = blockXml(deck, project, type, i + 2, { x: snap(x * IN * kx), y: snap(y * IN * ky), cx: snap(w * IN * kx), cy: Math.max(GRID, snap(h * IN * ky)) });
    // keep field names unique within the new slide too: park each one until the slide exists
    for (const m of made.xml.matchAll(/\{\{\s*([A-Za-z0-9_-]+)/g)) (project.pending ??= []).push(m[1]!);
    return made.xml;
  }).join("");
  if (pending) project.pending = pending; else delete project.pending;
  addSlideAt(deck, after + 1, blankSlideXml(xml), layoutRelsXml(layout));
  return after + 1;
}

export function duplicateSlide(deck: Deck, i: number): number {
  const info = deck.slides[i]!;
  // The copy shares the layout and pictures but not the speaker notes: a notes slide belongs to one slide.
  const rels = (deck.texts[relsPathOf(info.path)] ?? layoutRelsXml(info.layout ?? "")).replace(/<Relationship\b[^>]*notesSlide"[^>]*\/>/g, "");
  addSlideAt(deck, i + 1, deck.texts[info.path]!, rels);
  return i + 1;
}

export function moveSlide(deck: Deck, from: number, to: number): boolean {
  if (from === to || !deck.slides[from] || to < 0 || to >= deck.slides.length) return false;
  return deck.transaction(put => {
    const pres = parseXml(deck.texts["ppt/presentation.xml"]!);
    const lst = kid(pres.documentElement, "sldIdLst")!;
    const prels = deck.relsOf("ppt/presentation.xml");
    const ridOf = (s: Element) => s.getAttributeNS(R_NS, "id") || s.getAttribute("r:id") || "";
    // Only ids that resolve to a real slide are in deck.slides, so index against the same filtered list.
    const live = kids(lst, "sldId").filter(s => { const t = prels[ridOf(s)]?.target; return !!t && !!deck.texts[t]; });
    const node = live[from]!;
    const rest = live.filter(s => s !== node);
    lst.insertBefore(node, rest[to] ?? null);
    put("ppt/presentation.xml", serializeXml(pres));
  });
}

export function deleteSlide(deck: Deck, i: number): boolean {
  const info = deck.slides[i];
  if (!info || deck.slides.length <= 1) return false;
  return deck.transaction(put => {
    const pres = parseXml(deck.texts["ppt/presentation.xml"]!);
    const prPath = "ppt/_rels/presentation.xml.rels";
    const pr = parseXml(deck.texts[prPath]!);
    const rel = [...pr.documentElement.children].find(r => resolvePath("ppt/presentation.xml", r.getAttribute("Target") ?? "") === info.path);
    if (rel) {
      const rid = rel.getAttribute("Id");
      for (const s of kids(kid(pres.documentElement, "sldIdLst"), "sldId")) if ((s.getAttributeNS(R_NS, "id") || s.getAttribute("r:id")) === rid) s.remove();
      rel.remove();
      put("ppt/presentation.xml", serializeXml(pres));
      put(prPath, serializeXml(pr));
    }
    const gone = [info.path, relsPathOf(info.path)];
    if (info.notes) gone.push(info.notes, relsPathOf(info.notes));
    const ct = parseXml(deck.texts["[Content_Types].xml"]!);
    for (const o of [...ct.documentElement.children]) if (gone.includes((o.getAttribute("PartName") ?? "").slice(1))) o.remove();
    put("[Content_Types].xml", serializeXml(ct));
    for (const p of gone) if (deck.texts[p] !== undefined) put(p, null);
  });
}

/** The slide's own solid background colour (hex), or null when it inherits from the layout. */
export function slideBackground(deck: Deck, slide: number): string | null {
  const info = deck.slides[slide];
  if (!info) return null;
  return dig(parseXml(deck.texts[info.path]!).documentElement, "cSld", "bg", "bgPr", "solidFill", "srgbClr")?.getAttribute("val")?.toUpperCase() ?? null;
}

/** Set a solid slide background, or pass null to go back to the layout's background. p:bg must be the first child of p:cSld. */
export function setSlideBackground(deck: Deck, slide: number, hex: string | null): boolean {
  const info = deck.slides[slide];
  if (!info) return false;
  return deck.mutate(info.path, doc => {
    const cSld = kid(doc.documentElement, "cSld");
    if (!cSld) return false;
    kid(cSld, "bg")?.remove();
    if (hex === null) return;
    const bg = doc.createElementNS(P_NS, "p:bg"), bgPr = doc.createElementNS(P_NS, "p:bgPr");
    const fill = doc.createElementNS(A_NS, "a:solidFill"), clr = doc.createElementNS(A_NS, "a:srgbClr");
    clr.setAttribute("val", hex);
    fill.appendChild(clr);
    bgPr.append(fill, doc.createElementNS(A_NS, "a:effectLst"));
    bg.appendChild(bgPr);
    cSld.insertBefore(bg, cSld.firstChild);
  }, "slide-bg");
}

/* ---------------------------------------------------------------- object edits */
function editObj(deck: Deck, slide: number, obj: number | null, fn: (node: Element, doc: Document) => boolean | void, mergeKey?: string): boolean {
  const info = deck.slides[slide];
  if (!info || obj === null) return false;
  return deck.mutate(info.path, doc => {
    const node = collectObjects(doc)[obj];
    return node ? fn(node, doc) : false;
  }, mergeKey);
}

export const deleteObj = (deck: Deck, slide: number, obj: number | null): boolean => editObj(deck, slide, obj, node => { node.remove(); });

export function duplicateObj(deck: Deck, slide: number, obj: number | null): number | null {
  let idx: number | null = null;
  const ok = editObj(deck, slide, obj, (node, doc) => {
    const c = node.cloneNode(true) as Element;
    const cnv = [...c.getElementsByTagName("*")].find(e => e.localName === "cNvPr");
    if (cnv) cnv.setAttribute("id", String(nextShapeId(doc)));
    node.after(c);
    const b = readBox(deck, c, deck.slides[slide]!);
    if (b) writeBox(c, { ...b, x: b.x + GRID * 4, y: b.y + GRID * 4 });
    idx = collectObjects(doc).indexOf(c);
  });
  return ok ? idx : null;
}

/* ---------------------------------------------------------------- pictures */
/** Add a picture to a slide, fitted inside 6 x 4 in and centred. Returns the new object's index. */
export function insertImage(deck: Deck, slide: number, data: Uint8Array, ext: "png" | "jpeg", w: number, h: number): number | null {
  const info = deck.slides[slide];
  if (!info || !w || !h) return null;
  let n = 1;
  while (deck.zip.has(`ppt/media/image${n}.png`) || deck.zip.has(`ppt/media/image${n}.jpeg`)) n++;
  const media = `ppt/media/image${n}.${ext}`;
  // ponytail: the image bytes sit outside undo; undoing leaves an unused image in the file, which PowerPoint ignores
  deck.zip.set(media, data);
  try { deck.media[media] = URL.createObjectURL(new Blob([data as BlobPart], { type: `image/${ext}` })); } catch { /* no preview; the file still has the picture */ }
  const k = Math.min(6 * IN / w, 4 * IN / h);
  const cx = snap(w * k), cy = snap(h * k);
  const box = { cx, cy, x: snap((deck.W - cx) / 2), y: snap((deck.H - cy) / 2) };
  let obj: number | null = null;
  deck.transaction(put => {
    const ct = deck.texts["[Content_Types].xml"]!;
    if (!new RegExp(`Extension="${ext}"`, "i").test(ct)) put("[Content_Types].xml", ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="image/${ext}"/>`));
    const rid = addRel(deck, info.path, put, media);
    const doc = parseXml(deck.texts[info.path]!);
    const id = nextShapeId(doc);
    dig(doc.documentElement, "cSld", "spTree")!.appendChild(importXml(doc, picXml(id, rid, box)));
    obj = collectObjects(doc).length - 1;
    put(info.path, serializeXml(doc));
  });
  return obj;
}
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
/** Point the slide at a media part, reusing an existing relationship if there is one. Returns its id. */
function addRel(deck: Deck, part: string, put: (p: string, x: string) => void, target: string): string {
  const existing = Object.entries(deck.relsOf(part)).find(([, r]) => r.target === target);
  if (existing) return existing[0];
  const path = relsPathOf(part), xml = deck.texts[path] ?? `${XML_DECL}<Relationships xmlns="${PR_NS}"></Relationships>`;
  let i = 1;
  while (xml.includes(`Id="rIdImg${i}"`)) i++;
  put(path, xml.replace("</Relationships>", `<Relationship Id="rIdImg${i}" Type="${REL_IMAGE}" Target="${relTarget(part, target)}"/></Relationships>`));
  return `rIdImg${i}`;
}
const picXml = (id: number, rid: string, b: Rect): string =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr><a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.cx}" cy="${b.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

/* ---------------------------------------------------------------- copy and paste */
/** Copied objects: their XML, plus the media their pictures point at, keyed by relationship id. */
export interface Clip { xmls: string[]; media: Record<string, string> }
const embedsOf = (node: Element): Element[] => [...node.getElementsByTagNameNS(A_NS, "blip")];
export function copyObjs(deck: Deck, slide: number, objs: number[]): Clip | null {
  const info = deck.slides[slide];
  if (!info) return null;
  const all = collectObjects(parseXml(deck.texts[info.path]!));
  const nodes = [...new Set(objs)].sort((a, b) => a - b).map(i => all[i]).filter((n): n is Element => !!n);
  if (!nodes.length) return null;
  const rels = deck.relsOf(info.path), media: Record<string, string> = {};
  for (const n of nodes) for (const b of embedsOf(n)) {
    const rid = b.getAttributeNS(R_NS, "embed") ?? "", t = rels[rid]?.target;
    if (t) media[rid] = t;
  }
  return { xmls: nodes.map(nodeXml), media };
}
/** Paste copied objects onto a slide, nudged so they don't sit exactly on the originals. Returns their indices. */
export function pasteObjs(deck: Deck, slide: number, clip: Clip): number[] {
  const info = deck.slides[slide];
  if (!info) return [];
  let out: number[] = [];
  deck.transaction(put => {
    const doc = parseXml(deck.texts[info.path]!);
    const tree = dig(doc.documentElement, "cSld", "spTree")!;
    const added: Element[] = [];
    for (const xml of clip.xmls) {
      const node = importXml(doc, xml);
      for (const b of embedsOf(node)) {
        const t = clip.media[b.getAttributeNS(R_NS, "embed") ?? ""];
        if (t && deck.zip.has(t)) b.setAttributeNS(R_NS, "r:embed", addRel(deck, info.path, put, t));
      }
      let id = nextShapeId(doc);
      for (const c of node.getElementsByTagName("*")) if (c.localName === "cNvPr") c.setAttribute("id", String(id++));
      tree.appendChild(node);
      const b = readBox(deck, node, info);
      if (b) writeBox(node, { ...b, x: Math.min(b.x + GRID * 4, deck.W - b.cx), y: Math.min(b.y + GRID * 4, deck.H - b.cy) });
      added.push(node);
    }
    const all = collectObjects(doc);
    out = added.map(n => all.indexOf(n));
    put(info.path, serializeXml(doc));
  });
  return out;
}

/* ---------------------------------------------------------------- several objects at once */
function editObjs(deck: Deck, slide: number, objs: number[], fn: (nodes: Element[], doc: Document, info: SlideInfo) => boolean | void, mergeKey?: string): boolean {
  const info = deck.slides[slide];
  if (!info || !objs.length) return false;
  return deck.mutate(info.path, doc => {
    const all = collectObjects(doc);
    const nodes = [...new Set(objs)].sort((a, b) => a - b).map(i => all[i]).filter((n): n is Element => !!n);
    return nodes.length ? fn(nodes, doc, info) : false;
  }, mergeKey);
}
const unionOf = (boxes: Rect[]): Rect => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, cx: Math.max(...boxes.map(b => b.x + b.cx)) - x, cy: Math.max(...boxes.map(b => b.y + b.cy)) - y };
};
/** The box around several objects. */
export function boundsOf(deck: Deck, slide: number, objs: number[]): Rect | null {
  const info = deck.slides[slide];
  if (!info) return null;
  const all = collectObjects(parseXml(deck.texts[info.path]!));
  const boxes = objs.map(i => all[i] && readBox(deck, all[i]!, info)).filter((b): b is Rect => !!b);
  return boxes.length ? unionOf(boxes) : null;
}
export function moveObjs(deck: Deck, slide: number, objs: number[], dx: number, dy: number, mergeKey?: string): boolean {
  return editObjs(deck, slide, objs, (nodes, _d, info) => {
    for (const n of nodes) { const b = readBox(deck, n, info); if (b) writeBox(n, { ...b, x: b.x + dx, y: b.y + dy }, b); }
  }, mergeKey);
}
export const deleteObjs = (deck: Deck, slide: number, objs: number[]): boolean =>
  editObjs(deck, slide, objs, nodes => { nodes.forEach(n => n.remove()); });
/** Line up several objects with the box around them, like PowerPoint's Align Selected Objects. */
export function alignObjs(deck: Deck, slide: number, objs: number[], how: Align): boolean {
  return editObjs(deck, slide, objs, (nodes, _d, info) => {
    const boxes = nodes.map(n => readBox(deck, n, info));
    const u = unionOf(boxes.filter((b): b is Rect => !!b));
    nodes.forEach((n, i) => {
      const b = boxes[i];
      if (!b) return;
      const x = how === "left" ? u.x : how === "centre" ? u.x + (u.cx - b.cx) / 2 : how === "right" ? u.x + u.cx - b.cx : b.x;
      const y = how === "top" ? u.y : how === "middle" ? u.y + (u.cy - b.cy) / 2 : how === "bottom" ? u.y + u.cy - b.cy : b.y;
      writeBox(n, { ...b, x: Math.round(x), y: Math.round(y) }, b);
    });
  });
}
/** Equal gaps between three or more objects, across or down. */
export function distributeObjs(deck: Deck, slide: number, objs: number[], axis: "h" | "v"): boolean {
  if (objs.length < 3) return false;
  return editObjs(deck, slide, objs, (nodes, _d, info) => {
    const items = nodes.map(n => ({ n, b: readBox(deck, n, info)! })).filter(t => t.b);
    const [p, s] = axis === "h" ? ["x", "cx"] as const : ["y", "cy"] as const;
    items.sort((a, b) => a.b[p] - b.b[p]);
    const first = items[0]!.b, last = items[items.length - 1]!.b;
    const gap = (last[p] + last[s] - first[p] - items.reduce((a, t) => a + t.b[s], 0)) / (items.length - 1);
    let at = first[p];
    for (const t of items) { writeBox(t.n, { ...t.b, [p]: Math.round(at) }, t.b); at += t.b[s] + gap; }
  });
}
/** Put several objects into one group (Ctrl+G). Returns the group's index. */
export function groupObjs(deck: Deck, slide: number, objs: number[]): number | null {
  if (objs.length < 2) return null;
  let idx: number | null = null;
  const ok = editObjs(deck, slide, objs, (nodes, doc, info) => {
    if (nodes.length < 2) return false;
    const boxes = nodes.map(n => readBox(deck, n, info)).filter((b): b is Rect => !!b);
    const u = unionOf(boxes), id = nextShapeId(doc);
    const off = `<a:off x="${u.x}" y="${u.y}"/><a:ext cx="${u.cx}" cy="${u.cy}"/>`;
    const g = importXml(doc, `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm>${off}<a:chOff x="${u.x}" y="${u.y}"/><a:chExt cx="${u.cx}" cy="${u.cy}"/></a:xfrm></p:grpSpPr></p:grpSp>`);
    nodes[nodes.length - 1]!.after(g);
    for (const n of nodes) g.appendChild(n);
    idx = collectObjects(doc).indexOf(g);
  });
  return ok ? idx : null;
}
/** Break a group back into its parts, keeping where they appear. Returns their indices. */
export function ungroupObj(deck: Deck, slide: number, obj: number | null): number[] {
  let out: number[] = [];
  editObj(deck, slide, obj, (g, doc) => {
    if (g.localName !== "grpSp") return false;
    const x = dig(g, "grpSpPr", "xfrm");
    const n = (tag: string, a: string) => num(kid(x, tag)?.getAttribute(a));
    const [ox, oy, ex, ey] = [n("off", "x"), n("off", "y"), n("ext", "cx"), n("ext", "cy")];
    const [cx0, cy0, cw, ch] = [n("chOff", "x"), n("chOff", "y"), n("chExt", "cx") || ex, n("chExt", "cy") || ey];
    const sx = cw ? ex / cw : 1, sy = ch ? ey / ch : 1;
    // ponytail: a rotated or flipped group loses its rotation here; children keep their own
    const kidsOut = [...g.children].filter(c => OBJ_TYPES_EDIT.has(c.localName));
    for (const c of kidsOut) {
      const b = xfrmOf(xfrmHolder(c));
      if (b) writeBox(c, { x: ox + (b.x - cx0) * sx, y: oy + (b.y - cy0) * sy, cx: b.cx * sx, cy: b.cy * sy }, b);
      g.before(c);
    }
    g.remove();
    const all = collectObjects(doc);
    out = kidsOut.map(c => all.indexOf(c));
  });
  return out;
}
const OBJ_TYPES_EDIT = new Set(["sp", "pic", "graphicFrame", "grpSp", "cxnSp"]);

/* ---------------------------------------------------------------- shape look */
/** How see-through the fill (or picture) is, 0 to 100. */
export function readOpacity(node: Element): number {
  if (node.localName === "pic") return num(dig(node, "blipFill", "blip", "alphaModFix")?.getAttribute("amt"), 100000) / 1000;
  return num(dig(node, "spPr", "solidFill", "srgbClr", "alpha")?.getAttribute("val"), 100000) / 1000;
}
export function setOpacity(deck: Deck, slide: number, obj: number | null, pct: number): boolean {
  const v = String(Math.round(Math.min(100, Math.max(0, pct)) * 1000));
  return editObj(deck, slide, obj, (node, doc) => {
    if (node.localName === "pic") {
      const blip = dig(node, "blipFill", "blip");
      if (!blip) return false;
      kid(blip, "alphaModFix")?.remove();
      if (v !== "100000") { const a = doc.createElementNS(A_NS, "a:alphaModFix"); a.setAttribute("amt", v); blip.insertBefore(a, blip.firstElementChild); }
      return;
    }
    const clr = dig(node, "spPr", "solidFill", "srgbClr");
    if (!clr) return false;
    kid(clr, "alpha")?.remove();
    if (v !== "100000") { const a = doc.createElementNS(A_NS, "a:alpha"); a.setAttribute("val", v); clr.appendChild(a); }
  }, "opacity");
}
export const readShadow = (node: Element): boolean => !!dig(node, node.localName === "grpSp" ? "grpSpPr" : "spPr", "effectLst", "outerShdw");
/** A soft drop shadow below the object, like PowerPoint's "Offset: Bottom". */
export function setShadow(deck: Deck, slide: number, obj: number | null, on: boolean): boolean {
  return editObj(deck, slide, obj, node => {
    const spPr = kid(node, "spPr");
    if (!spPr) return false;
    kid(spPr, "effectLst")?.remove();
    if (!on) return;
    const fx = importXml(node.ownerDocument, '<a:effectLst><a:outerShdw blurRad="152400" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>');
    spPr.insertBefore(fx, [...spPr.children].find(c => ["scene3d", "sp3d", "extLst"].includes(c.localName)) ?? null);
  });
}
export function readGeom(node: Element): string | null {
  return node.localName === "sp" ? dig(node, "spPr", "prstGeom")?.getAttribute("prst") ?? (dig(node, "spPr", "custGeom") ? null : "rect") : null;
}
/** Swap a shape's outline for another preset, keeping its size, fill and text. */
export function setGeom(deck: Deck, slide: number, obj: number | null, geom: string): boolean {
  return editObj(deck, slide, obj, (node, doc) => {
    const spPr = kid(node, "spPr");
    if (node.localName !== "sp" || !spPr) return false;
    kid(spPr, "custGeom")?.remove();
    let pg = kid(spPr, "prstGeom");
    if (!pg) { pg = doc.createElementNS(A_NS, "a:prstGeom"); spPr.insertBefore(pg, kid(spPr, "xfrm")?.nextSibling ?? spPr.firstChild); }
    pg.setAttribute("prst", geom);
    pg.replaceChildren(doc.createElementNS(A_NS, "a:avLst"));
  });
}
export function readOutline(node: Element): { color: string | null; w: number } {
  const ln = dig(node, "spPr", "ln");
  return { color: ln ? dig(ln, "solidFill", "srgbClr")?.getAttribute("val") ?? null : null, w: num(ln?.getAttribute("w"), 12700) };
}
/** Outline colour (null removes it) and width in points. */
export function setOutline(deck: Deck, slide: number, obj: number | null, color: string | null, pt?: number): boolean {
  return editObj(deck, slide, obj, (node, doc) => {
    const spPr = kid(node, "spPr");
    if (!spPr) return false;
    let ln = kid(spPr, "ln");
    if (!ln) { ln = doc.createElementNS(A_NS, "a:ln"); spPr.insertBefore(ln, [...spPr.children].find(c => ["effectLst", "effectDag", "scene3d", "sp3d", "extLst"].includes(c.localName)) ?? null); }
    if (color === null) ln.removeAttribute("w");
    else ln.setAttribute("w", String(Math.round((pt ?? (num(ln.getAttribute("w"), 0) / 12700 || 1.5)) * 12700)));
    setSolid(ln, color, ["prstDash", "custDash", "round", "bevel", "miter", "headEnd", "tailEnd", "extLst"]);
  }, "outline");
}
/** Rotation in degrees, for shapes and pictures. */
export function setRotation(deck: Deck, slide: number, obj: number | null, deg: number): boolean {
  return editObj(deck, slide, obj, node => {
    const x = dig(node, "spPr", "xfrm");
    if (!x) return false;
    const r = Math.round((((deg % 360) + 360) % 360) * 60000);
    if (r) x.setAttribute("rot", String(r)); else x.removeAttribute("rot");
  }, "rotate");
}
export const readRotation = (node: Element): number | null => {
  const x = dig(node, "spPr", "xfrm");
  return x ? Math.round(num(x.getAttribute("rot")) / 60000) : null;
};

export function zOrder(deck: Deck, slide: number, obj: number | null, where: "front" | "back"): number | null {
  let idx: number | null = null;
  const ok = editObj(deck, slide, obj, (node, doc) => {
    const tree = node.parentNode as Element;
    if (where === "front") tree.appendChild(node);
    else tree.insertBefore(node, kid(tree, "grpSpPr")?.nextSibling ?? tree.firstChild);
    idx = collectObjects(doc).indexOf(node);
  });
  return ok ? idx : null;
}

export function setBox(deck: Deck, slide: number, obj: number | null, change: (cur: Rect) => Rect, mergeKey?: string): boolean {
  return editObj(deck, slide, obj, node => {
    const cur = readBox(deck, node, deck.slides[slide]!);
    if (!cur) return false;
    writeBox(node, change(cur), cur);
  }, mergeKey);
}

export type Align = "left" | "centre" | "right" | "top" | "middle" | "bottom";
export function alignObj(deck: Deck, slide: number, obj: number | null, how: Align): boolean {
  return setBox(deck, slide, obj, b => ({
    ...b,
    x: how === "left" ? 0 : how === "centre" ? snap((deck.W - b.cx) / 2) : how === "right" ? deck.W - b.cx : b.x,
    y: how === "top" ? 0 : how === "middle" ? snap((deck.H - b.cy) / 2) : how === "bottom" ? deck.H - b.cy : b.y,
  }));
}

/* ---------------------------------------------------------------- text and style */
function setParaText(p: Element, text: string): void {
  const doc = p.ownerDocument;
  const first = [...p.children].find(c => c.localName === "r" || c.localName === "fld");
  const run = doc.createElementNS(A_NS, "a:r");
  const srcRPr = first ? kid(first, "rPr") : kid(p, "endParaRPr");
  const rPr = doc.createElementNS(A_NS, "a:rPr");
  if (srcRPr) {
    for (const at of srcRPr.attributes) rPr.setAttribute(at.name, at.value);
    for (const c of srcRPr.children) rPr.appendChild(c.cloneNode(true));
  }
  run.appendChild(rPr);
  const t = doc.createElementNS(A_NS, "a:t");
  t.textContent = text;
  run.appendChild(t);
  [...p.children].filter(c => ["r", "br", "fld"].includes(c.localName)).forEach(c => c.remove());
  if (text !== "") p.insertBefore(run, kid(p, "endParaRPr"));
}

function setBodyText(txBody: Element, text: string): void {
  const paras = kids(txBody, "p");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    if (i < paras.length) { if (paraText(paras[i]!) !== line) setParaText(paras[i]!, line); }
    else {
      const last = kids(txBody, "p").pop()!;
      const c = last.cloneNode(true) as Element;
      setParaText(c, line);
      last.after(c);
    }
  });
  kids(txBody, "p").slice(Math.max(lines.length, 1)).forEach(p => p.remove());
}

/** The selected text box or table cell, in a freshly parsed copy of the slide. */
export function selTextNode(doc: Document, sel: Sel): Element | null {
  if (sel.cell !== null) return collectEditables(doc, false)[sel.cell]?.node ?? null;
  if (sel.obj === null) return null;
  const n = collectObjects(doc)[sel.obj];
  return n && kid(n, "txBody") ? n : null;
}

function editText(deck: Deck, slide: number, sel: Sel, fn: (node: Element) => boolean | void, mergeKey?: string): boolean {
  const info = deck.slides[slide];
  if (!info) return false;
  return deck.mutate(info.path, doc => {
    const n = selTextNode(doc, sel);
    return n ? fn(n) : false;
  }, mergeKey);
}

export const setText = (deck: Deck, slide: number, sel: Sel, text: string): boolean =>
  editText(deck, slide, sel, n => setBodyText(kid(n, "txBody")!, text), `text:${slide}:${sel.obj}:${sel.cell}`);

function runPrs(txBody: Element, create: boolean): Element[] {
  const out: Element[] = [];
  for (const p of kids(txBody, "p")) {
    for (const r of kids(p, "r")) {
      let rp = kid(r, "rPr");
      if (!rp && create) { rp = r.ownerDocument.createElementNS(A_NS, "a:rPr"); r.insertBefore(rp, r.firstElementChild); }
      if (rp) out.push(rp);
    }
    const e = kid(p, "endParaRPr");
    if (e) out.push(e);
  }
  return out;
}

const FILL_NAMES = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];
function setSolid(el: Element, hex: string | null, beforeNames: string[]): void {
  for (const c of [...el.children]) if (FILL_NAMES.includes(c.localName)) c.remove();
  const doc = el.ownerDocument;
  const f = doc.createElementNS(A_NS, hex === null ? "a:noFill" : "a:solidFill");
  if (hex !== null) { const c = doc.createElementNS(A_NS, "a:srgbClr"); c.setAttribute("val", hex); f.appendChild(c); }
  el.insertBefore(f, [...el.children].find(c => beforeNames.includes(c.localName)) ?? null);
}

export type ListKind = "none" | "bullet" | "number";
export interface TextStyle {
  sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; caps?: boolean; color?: string; algn?: string; font?: string;
  list?: ListKind; anchor?: "t" | "ctr" | "b"; line?: number;
}
/** Paragraph property children that come after bullets, so new bullet elements go before them. */
const PPR_AFTER_BULLETS = ["tabLst", "defRPr", "extLst"];
const BULLET_NAMES = ["buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip"];
function pPrOf(p: Element): Element {
  let pPr = kid(p, "pPr");
  if (!pPr) { pPr = p.ownerDocument.createElementNS(A_NS, "a:pPr"); p.insertBefore(pPr, p.firstElementChild); }
  return pPr;
}
function setList(pPr: Element, kind: ListKind): void {
  for (const c of [...pPr.children]) if (BULLET_NAMES.includes(c.localName)) c.remove();
  const doc = pPr.ownerDocument, before = [...pPr.children].find(c => PPR_AFTER_BULLETS.includes(c.localName)) ?? null;
  const add = (name: string, attrs: Record<string, string>) => {
    const e = doc.createElementNS(A_NS, `a:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    pPr.insertBefore(e, before);
  };
  if (kind === "none") { add("buNone", {}); pPr.removeAttribute("marL"); pPr.removeAttribute("indent"); return; }
  const ind = kind === "number" ? 342900 : 285750;
  pPr.setAttribute("marL", String(ind)); pPr.setAttribute("indent", String(-ind));
  add("buFont", { typeface: kind === "number" ? "+mj-lt" : "Arial" });
  add(kind === "number" ? "buAutoNum" : "buChar", kind === "number" ? { type: "arabicPeriod" } : { char: "\u2022" });
}
function applyTextStyle(node: Element, st: TextStyle): void {
  const txBody = kid(node, "txBody");
  if (!txBody) return;
  for (const rp of runPrs(txBody, true)) {
    if (st.sz) rp.setAttribute("sz", String(Math.round(st.sz * 100)));
    if (st.b !== undefined) rp.setAttribute("b", st.b ? "1" : "0");
    if (st.i !== undefined) rp.setAttribute("i", st.i ? "1" : "0");
    if (st.u !== undefined) rp.setAttribute("u", st.u ? "sng" : "none");
    if (st.strike !== undefined) rp.setAttribute("strike", st.strike ? "sngStrike" : "noStrike");
    if (st.caps !== undefined) rp.setAttribute("cap", st.caps ? "all" : "none");
    if (st.color) {
      for (const c of [...rp.children]) if (FILL_NAMES.includes(c.localName)) c.remove();
      const f = rp.ownerDocument.createElementNS(A_NS, "a:solidFill");
      const c = rp.ownerDocument.createElementNS(A_NS, "a:srgbClr");
      c.setAttribute("val", st.color);
      f.appendChild(c);
      const ln = kid(rp, "ln");
      rp.insertBefore(f, ln ? ln.nextSibling : rp.firstElementChild);
    }
    if (st.font !== undefined) {
      for (const name of ["latin", "cs"]) kid(rp, name)?.remove();
      if (st.font) {
        // Fonts follow fills, effects and highlights, and come before sym / hyperlinks.
        const before = [...rp.children].find(c => ["ea", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"].includes(c.localName)) ?? null;
        const latin = rp.ownerDocument.createElementNS(A_NS, "a:latin");
        latin.setAttribute("typeface", st.font);
        rp.insertBefore(latin, before);
        const cs = rp.ownerDocument.createElementNS(A_NS, "a:cs");
        cs.setAttribute("typeface", st.font);
        const afterEa = kid(rp, "ea")?.nextSibling ?? before;
        rp.insertBefore(cs, afterEa);
      }
    }
  }
  for (const p of kids(txBody, "p")) {
    if (!st.algn && !st.list && !st.line) break;
    const pPr = pPrOf(p);
    if (st.algn) pPr.setAttribute("algn", st.algn);
    if (st.list) setList(pPr, st.list);
    if (st.line) {
      kid(pPr, "lnSpc")?.remove();
      const ls = p.ownerDocument.createElementNS(A_NS, "a:lnSpc"), pct = p.ownerDocument.createElementNS(A_NS, "a:spcPct");
      pct.setAttribute("val", String(Math.round(st.line * 100000)));
      ls.appendChild(pct);
      pPr.insertBefore(ls, pPr.firstElementChild);
    }
  }
  if (st.anchor) kid(txBody, "bodyPr")?.setAttribute("anchor", st.anchor);
}
function applyBoxFill(node: Element, hex: string | null): void {
  if (node.localName === "tc") {
    let tcPr = kid(node, "tcPr");
    if (!tcPr) { tcPr = node.ownerDocument.createElementNS(A_NS, "a:tcPr"); node.appendChild(tcPr); }
    setSolid(tcPr, hex, ["headers", "extLst"]);
  } else {
    const spPr = kid(node, "spPr");
    if (spPr) setSolid(spPr, hex, ["ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"]);
  }
}

/** Style the selected text box / cell, or (for a shape without text) the shape itself. */
export function setStyle(deck: Deck, slide: number, sel: Sel, st: TextStyle & { fill?: string | null }): boolean {
  const apply = (n: Element) => {
    applyTextStyle(n, st);
    if (st.fill !== undefined) applyBoxFill(n, st.fill);
  };
  return editText(deck, slide, sel, apply, "style") || editObj(deck, slide, sel.obj, apply, "style");
}

export interface StyleInfo { sz: number; b: boolean; i: boolean; u: boolean; strike: boolean; caps: boolean; color: string; fill: string | null; noFill: boolean; algn: string; font: string; list: ListKind; anchor: string; line: number }
export function readStyle(node: Element): StyleInfo {
  const txBody = kid(node, "txBody");
  const rp = txBody ? runPrs(txBody, false)[0] : null;
  const hexIn = (el: Element | null | undefined) => dig(el, "solidFill", "srgbClr")?.getAttribute("val") ?? null;
  const fillHost = kid(node, node.localName === "tc" ? "tcPr" : "spPr");
  const p0 = txBody ? kid(kids(txBody, "p")[0], "pPr") : null;
  return {
    sz: rp?.getAttribute("sz") ? num(rp.getAttribute("sz")) / 100 : 18,
    b: rp?.getAttribute("b") === "1",
    i: rp?.getAttribute("i") === "1",
    color: hexIn(rp) || "000000",
    fill: hexIn(fillHost),
    noFill: !!kid(fillHost, "noFill"),
    algn: p0?.getAttribute("algn") || "l",
    font: kid(rp, "latin")?.getAttribute("typeface") ?? "",
    u: !!rp?.getAttribute("u") && rp.getAttribute("u") !== "none",
    strike: !!rp?.getAttribute("strike") && rp.getAttribute("strike") !== "noStrike",
    caps: rp?.getAttribute("cap") === "all",
    list: kid(p0, "buAutoNum") ? "number" : kid(p0, "buChar") ? "bullet" : "none",
    anchor: kid(txBody, "bodyPr")?.getAttribute("anchor") || "t",
    line: num(dig(p0, "lnSpc", "spcPct")?.getAttribute("val"), 100000) / 100000,
  };
}

/* ---------------------------------------------------------------- tables */
/** Re-number list rows in a table (findings.1, findings.2, ...) to match row order. */
function renumberTable(tbl: Element): void {
  const rowText = (tr: Element) => [...tr.getElementsByTagNameNS(A_NS, "t")].map(t => t.textContent).join("");
  const counters: Record<string, number> = {};
  for (const tr of kids(tbl, "tr")) {
    const map: Record<string, { from: number; to: number }> = {};
    for (const m of rowText(tr).matchAll(/\{\{\s*((?:[A-Za-z0-9_-]+\.)*?[A-Za-z0-9_-]+)\.(\d+)(?=[.\s}])/g)) {
      const name = m[1]!;
      if (map[name] === undefined) { counters[name] = (counters[name] ?? 0) + 1; map[name] = { from: +m[2]!, to: counters[name]! }; }
    }
    const changes = Object.entries(map).filter(([, v]) => v.from !== v.to);
    if (!changes.length) continue;
    for (const tc of kids(tr, "tc")) {
      for (const p of kids(kid(tc, "txBody"), "p")) {
        const before = paraText(p);
        let t = before;
        for (const [name, v] of changes) {
          const nameRe = name.replace(/[.-]/g, "\\$&");
          t = t.replace(new RegExp(`(\\{\\{\\s*${nameRe}\\.)${v.from}(?=[.\\s}])`, "g"), `$1${v.to}`);
        }
        const only = changes[0]![1];
        if (changes.length === 1 && before.trim() === String(only.from)) t = before.replace(String(only.from), String(only.to));
        if (t !== before) setParaText(p, t);
      }
    }
  }
}

export type TableOp = "addRow" | "delRow" | "addCol" | "delCol";
export function tableOp(deck: Deck, slide: number, sel: Sel, op: TableOp): string | null {
  const info = deck.slides[slide];
  if (!info || sel.obj === null) return null;
  let msg = "";
  const ok = deck.mutate(info.path, doc => {
    const frame = collectObjects(doc)[sel.obj!];
    const tbl = frame?.localName === "graphicFrame" ? frame.getElementsByTagNameNS(A_NS, "tbl")[0] : undefined;
    if (!frame || !tbl) return false;
    const rows = kids(tbl, "tr");
    const ed = sel.cell !== null ? collectEditables(doc, false)[sel.cell] : undefined;
    const pos = ed?.kind === "cell" && ed.tbl === tbl ? { tr: ed.tr!, col: kids(ed.tr!, "tc").indexOf(ed.node) } : null;
    const ext = dig(frame, "xfrm", "ext");
    const width = ext ? num(ext.getAttribute("cx")) : deck.W / 2;
    if (op === "addRow") {
      const tr = pos ? pos.tr : rows[rows.length - 1]!;
      tr.after(tr.cloneNode(true));
      if (ext) ext.setAttribute("cy", String(num(ext.getAttribute("cy")) + num(tr.getAttribute("h"))));
      msg = "Row added. List rows renumbered.";
    } else if (op === "delRow") {
      if (!pos || rows.length <= 1) return false;
      if (ext) ext.setAttribute("cy", String(Math.max(MIN, num(ext.getAttribute("cy")) - num(pos.tr.getAttribute("h")))));
      pos.tr.remove();
      msg = "Row deleted. List rows renumbered.";
    } else if (op === "addCol") {
      const grid = kid(tbl, "tblGrid")!;
      grid.appendChild(kids(grid, "gridCol").pop()!.cloneNode(true));
      const used = new Set(deck.scan().map(f => f.key.split(".").pop()));
      let k = "column", n = 2;
      if (used.has(k)) { while (used.has(`column_${n}`)) n++; k = `column_${n}`; }
      for (const tr of rows) {
        const last = kids(tr, "tc").pop()!;
        const c = last.cloneNode(true) as Element;
        const m = /\{\{\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*?)\.(\d+)\./.exec(visibleText(nodeXml(tr)));
        setBodyText(kid(c, "txBody")!, m ? `{{${m[1]}.${m[2]}.${k}}}` : "New column");
        last.after(c);
      }
      fitColumns(tbl, width);
      msg = "Column added";
    } else {
      const cols = kids(kid(tbl, "tblGrid"), "gridCol");
      if (!pos || cols.length <= 1) return false;
      cols[pos.col]?.remove();
      for (const tr of rows) kids(tr, "tc")[pos.col]?.remove();
      fitColumns(tbl, width);
      msg = "Column deleted";
    }
    renumberTable(tbl);
  });
  return ok ? msg : null;
}

/* ---------------------------------------------------------------- fields */
/** What a dragged field carries: a plain key, or a list (+ column) to be numbered by table row. */
export interface FieldPayload { key?: string; list?: string; sub?: string }

const rowHasList = (tr: Element): boolean =>
  /\{\{\s*[A-Za-z0-9_\-.]+\.\d+[.}\s]/.test([...tr.getElementsByTagNameNS(A_NS, "t")].map(t => t.textContent).join(""));

function resolvePayload(payload: FieldPayload, ed: Editable): string {
  if (!payload.list) return payload.key ?? "";
  let n = 1;
  if (ed.kind === "cell") {
    const rows = kids(ed.tbl!, "tr"), ri = rows.indexOf(ed.tr!);
    n = Math.max(1, rowHasList(rows[0]!) ? ri + 1 : ri); // a header row does not count as an item
  }
  return payload.sub ? `${payload.list}.${n}.${payload.sub}` : `${payload.list}.${n}`;
}

/**
 * Put a field into a text box or cell. If a paragraph already holds a field, only that paragraph
 * is replaced, so a number tile keeps its "Label" line.
 */
export function placeField(deck: Deck, slide: number, editIdx: number, payload: FieldPayload): { key: string; sel: Sel } | null {
  const info = deck.slides[slide];
  if (!info) return null;
  let key = "";
  const ok = deck.mutate(info.path, doc => {
    const ed = collectEditables(doc, false)[editIdx];
    if (!ed) return false;
    key = resolvePayload(payload, ed);
    const txBody = kid(ed.node, "txBody")!;
    const withField = kids(txBody, "p").find(p => /\{\{[^{}]+\}\}/.test(paraText(p)));
    if (withField) setParaText(withField, `{{${key}}}`);
    else setBodyText(txBody, `{{${key}}}`);
  });
  if (!ok) return null;
  const doc = parseXml(deck.texts[info.path]!);
  const ed = collectEditables(doc, false)[editIdx];
  const obj = ed ? collectObjects(doc).findIndex(o => o === ed.node || o.contains(ed.node)) : -1;
  return { key, sel: { obj: obj < 0 ? null : obj, cell: ed?.kind === "cell" ? editIdx : null } };
}

export type RenameScope =
  | { type: "plain" | "array" | "object"; from: string }
  | { type: "array-child" | "object-child"; from: string; name: string; sub: string };

/** Rename a field everywhere it appears in the template, and move its settings to the new name. */
export function renameField(deck: Deck, project: Project, to: string, scope: RenameScope): boolean {
  const { from } = scope;
  const reEsc = (s: string) => s.replace(/[.\-]/g, "\\$&");
  const map = (key: string): string | null => {
    const isCount = key.startsWith("count:");
    const k = isCount ? key.slice(6).trim() : key;
    let out: string | null = null;
    if (scope.type === "array-child") {
      const re = new RegExp(`^(${reEsc(scope.name)}\\.(?:\\d+\\.)?)${reEsc(scope.sub)}(?=$|[.=\\s])`);
      if (re.test(k)) out = k.replace(re, `$1${to}`);
    } else if (scope.type === "object-child") {
      if (k === `${scope.name}.${scope.sub}`) out = `${scope.name}.${to}`;
    } else if (k === from) out = to;
    else if (k.startsWith(from + ".") || k.startsWith(from + "=")) out = to + k.slice(from.length);
    return out === null ? null : `{{${isCount ? "count:" + out : out}}}`;
  };
  const changed = deck.transaction(put => {
    for (const name of Object.keys(deck.texts)) {
      if (!isSlidePart(name)) continue;
      const nx = rewritePlaceholders(deck.texts[name]!, map);
      if (nx !== deck.texts[name]) put(name, nx);
    }
  });
  if (!changed) return false;
  const F = project.fields;
  const moveKey = (a: string, b: string) => { if (F[a]) { F[b] = F[a]!; delete F[a]; } };
  if (scope.type === "plain") moveKey(from, to);
  else if (scope.type === "array") {
    for (const k of Object.keys(F)) if (k.startsWith(from + "[]")) { F[to + k.slice(from.length)] = F[k]!; delete F[k]; }
  } else if (scope.type === "array-child") moveKey(`${scope.name}[].${scope.sub}`, `${scope.name}[].${to}`);
  else if (scope.type === "object-child") moveKey(`${scope.name}.${scope.sub}`, `${scope.name}.${to}`);
  if (project.settings.file_name_field === from && scope.type === "plain") project.settings.file_name_field = to;
  return true;
}

/** Slides (0-based) on which a field root appears. */
export function fieldUsage(deck: Deck, root: string): number[] {
  return deck.slides.flatMap((s, i) => scanPlaceholders(deck.texts[s.path] ?? "").some(f => rootOf(f.key) === root) ? [i] : []);
}
