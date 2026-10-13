/* ====================================================================== drag-and-drop editor */
const LOCAL = null;
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const IN = 914400, GRID = 45720, MIN = 182880;
const INK = "1F2933", NAVY = "16253D", TEAL = "2A7F8F", MUTED_HEX = "5F6B7A", TILE = "EEF2F5", LINE_HEX = "D9DFE6";
Object.assign(S, { view: "design", cur: 0, selObj: null, selCell: null, selField: null, rtab: "format" });

const OBJ_TYPES = new Set(["sp", "pic", "graphicFrame", "grpSp", "cxnSp"]);
function collectObjects(doc) {
  const tree = dig(doc.documentElement, "cSld", "spTree");
  return tree ? [...tree.children].filter(c => OBJ_TYPES.has(c.localName)) : [];
}
const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const snap = v => Math.round(v / GRID) * GRID;
const inches = emu => (emu / IN).toFixed(2);
const curInfo = () => S.slides[S.cur];

/* ---------------------------------------------------------------- geometry */
function xfrmHolder(node) {
  const n = node.localName;
  if (n === "graphicFrame") return node;
  if (n === "grpSp") return kid(node, "grpSpPr");
  return kid(node, "spPr");
}
function readBox(node, info) {
  let b = xfrmOf(xfrmHolder(node));
  if (!b && node.localName === "sp" && phOf(node)) {
    const ph = phOf(node);
    const layoutDoc = info.layout && S.texts[info.layout] ? parseXml(S.texts[info.layout]) : null;
    const masterDoc = info.master && S.texts[info.master] ? parseXml(S.texts[info.master]) : null;
    b = xfrmOf(kid(findPh(layoutDoc, ph), "spPr")) || xfrmOf(kid(findPh(masterDoc, { type: ph.type, idx: null }), "spPr"));
  }
  return b;
}
function writeBox(node, b, old) {
  const holder = xfrmHolder(node);
  if (!holder) return;
  const doc = node.ownerDocument;
  let x = kid(holder, "xfrm");
  if (!x) {
    x = node.localName === "graphicFrame" ? doc.createElementNS(P_NS, "p:xfrm") : doc.createElementNS(A_NS, "a:xfrm");
    x.appendChild(doc.createElementNS(A_NS, "a:off")); x.appendChild(doc.createElementNS(A_NS, "a:ext"));
    if (node.localName === "graphicFrame") holder.insertBefore(x, kid(holder, "graphic"));
    else holder.insertBefore(x, holder.firstElementChild);
  }
  const off = kid(x, "off"), ext = kid(x, "ext");
  off.setAttribute("x", Math.round(b.x)); off.setAttribute("y", Math.round(b.y));
  ext.setAttribute("cx", Math.round(Math.max(b.cx, MIN))); ext.setAttribute("cy", Math.round(Math.max(b.cy, MIN)));
  if (node.localName === "graphicFrame" && old) {
    const tbl = node.getElementsByTagNameNS(A_NS, "tbl")[0];
    if (tbl && Math.abs(b.cx - old.cx) > 1) fitColumns(tbl, b.cx);
    if (tbl && Math.abs(b.cy - old.cy) > 1 && old.cy > 0) {
      const f = b.cy / old.cy;
      for (const tr of kids(tbl, "tr")) tr.setAttribute("h", Math.max(GRID * 4, Math.round(num(tr.getAttribute("h")) * f)));
    }
  }
}
function fitColumns(tbl, cx) {
  const cols = kids(kid(tbl, "tblGrid"), "gridCol");
  const sum = cols.reduce((a, c) => a + num(c.getAttribute("w")), 0) || 1;
  cols.forEach(c => c.setAttribute("w", Math.round(num(c.getAttribute("w")) * cx / sum)));
}

/* ---------------------------------------------------------------- block XML */
function rPrXml({ sz = 16, b = false, color = INK }) {
  return `<a:rPr lang="en-US" sz="${Math.round(sz * 100)}"${b ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr>`;
}
function paraXml(p) {
  const bullet = p.bullet ? '<a:spcAft><a:spcPts val="600"/></a:spcAft><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : "<a:buNone/>";
  const ind = p.bullet ? ' marL="285750" indent="-285750"' : "";
  return `<a:p><a:pPr${p.algn ? ` algn="${p.algn}"` : ""}${ind}>${bullet}</a:pPr><a:r>${rPrXml(p)}<a:t>${xmlEsc(p.text)}</a:t></a:r></a:p>`;
}
function shapeXml({ id, name, box, paras, fill = null, geom = "rect", anchor = "t", ins = 0, txBox = true, line = null }) {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>";
  const lnXml = line ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  const geomXml = geom === "roundRect" ? '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom>' : `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>`;
  const body = paras ? `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras.map(paraXml).join("")}</p:txBody>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr${txBox && paras ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${Math.round(box.cx)}" cy="${Math.round(box.cy)}"/></a:xfrm>${geomXml}${fillXml}${lnXml}</p:spPr>${body}</p:sp>`;
}
function cellXml(text, { sz = 12, b = false, color = INK, fill = null, anchor = "ctr" }) {
  const border = side => `<a:${side} w="9525"><a:solidFill><a:srgbClr val="${LINE_HEX}"/></a:solidFill></a:${side}>`;
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>${rPrXml({ sz, b, color })}<a:t>${xmlEsc(text)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="${anchor}">${border("lnL")}${border("lnR")}${border("lnT")}${border("lnB")}` +
    `${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr></a:tc>`;
}
function tableXml({ id, name, box, list, cols, rows }) {
  const colW = Math.round(box.cx / cols.length);
  const headH = Math.round(0.42 * IN), rowH = Math.round(0.48 * IN);
  let xml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${colW * cols.length}" cy="${headH + rowH * rows}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>` +
    cols.map(() => `<a:gridCol w="${colW}"/>`).join("") + "</a:tblGrid>";
  xml += `<a:tr h="${headH}">` + cols.map(c => cellXml(c.label, { sz: 12, b: true, color: "FFFFFF", fill: NAVY })).join("") + "</a:tr>";
  for (let r = 1; r <= rows; r++) {
    xml += `<a:tr h="${rowH}">` + cols.map(c => cellXml(`{{${list}.${r}.${c.key}}}`, { sz: 12, fill: r % 2 ? null : "F3F5F8" })).join("") + "</a:tr>";
  }
  return xml + "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
}

const ICONS = {
  title: '<path d="M5 6h12M11 6v11" />',
  text: '<path d="M4 6h14M4 10h14M4 14h10M4 18h7" />',
  bullets: '<circle cx="5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/><path d="M9 6.5h9M9 11h9M9 15.5h6" />',
  number: '<rect x="3" y="4.5" width="16" height="13" rx="2.5" /><path d="M8.5 9 10.5 7.8V14.5M14 9.2a1.6 1.6 0 1 1 1.6 2.4L13.4 14.5h3.2" />',
  table: '<rect x="3" y="4.5" width="16" height="13" rx="1.8" /><path d="M3 8.8h16M3 13.1h16M8.4 4.5v13M13.6 4.5v13" />',
  label: '<path d="M4.5 16 8.4 6h.6l3.9 10M5.9 12.6h5.6M15 9.8v6.2M15 9.8c0-1 .8-1.6 1.8-1.6" />',
  box: '<rect x="3.5" y="5" width="15" height="12" rx="2.5" />',
};
const BLOCKS = [
  { type: "title", label: "Title", w: 8, h: 0.9, base: "title" },
  { type: "text", label: "Text", w: 5, h: 1.4, base: "text" },
  { type: "bullets", label: "Bullet list", w: 5, h: 2.2, base: "points" },
  { type: "number", label: "Number tile", w: 2.4, h: 1.5, base: "number" },
  { type: "table", label: "Table", w: 8, h: 1.86, base: "rows" },
  { type: "label", label: "Label", w: 3, h: 0.45 },
  { type: "box", label: "Box", w: 3, h: 2 },
];
const blockDef = t => BLOCKS.find(b => b.type === t);
function blockSize(def) {
  const w = Math.min(def.w * IN, S.W - 0.4 * IN), h = Math.min(def.h * IN, S.H - 0.4 * IN);
  return { cx: snap(w), cy: snap(h) };
}
function existingRoots() {
  const set = new Set();
  for (const f of scanAll()) set.add(f.key.replace(/^count:/, "").split(/[.=]/)[0]);
  for (const p of S.project.pending || []) set.add(p);
  return set;
}
function uniqueKey(base) {
  const used = existingRoots();
  if (!used.has(base)) return base;
  let n = 2; while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function nextShapeId(doc) {
  let mx = 1;
  for (const e of doc.getElementsByTagName("*")) if (e.localName === "cNvPr") mx = Math.max(mx, num(e.getAttribute("id")));
  return mx + 1;
}
function importXml(doc, xml) {
  const w = parseXml(`<w xmlns:a="${A_NS}" xmlns:p="${P_NS}" xmlns:r="${R_NS}">${xml}</w>`);
  if (w.getElementsByTagName("parsererror").length) throw new Error("Couldn't build that block.");
  return doc.importNode(w.documentElement.firstElementChild, true);
}
function blockXml(type, id, box) {
  const def = blockDef(type);
  const key = def.base ? uniqueKey(def.base) : null;
  let xml, note = key ? `{{${key}}}` : "";
  if (type === "title") xml = shapeXml({ id, name: `Title ${id}`, box, paras: [{ text: `{{${key}}}`, sz: 32, b: true, color: NAVY }] });
  else if (type === "text") xml = shapeXml({ id, name: `Text ${id}`, box, paras: [{ text: `{{${key}}}`, sz: 16, color: INK }] });
  else if (type === "bullets") {
    xml = shapeXml({ id, name: `Bullets ${id}`, box, paras: [{ text: `{{${key}}}`, sz: 16, color: INK, bullet: true }] });
    cfg(key).type = "list";
  } else if (type === "number") {
    xml = shapeXml({ id, name: `Number ${id}`, box, geom: "roundRect", fill: TILE, ins: 137160, anchor: "ctr", txBox: false,
      paras: [{ text: `{{${key}}}`, sz: 36, b: true, color: TEAL }, { text: "Label", sz: 12, color: MUTED_HEX }] });
  } else if (type === "table") {
    const cols = [{ key: "name", label: "Name" }, { key: "detail", label: "Detail" }, { key: "status", label: "Status" }];
    xml = tableXml({ id, name: `Table ${id}`, box, list: key, cols, rows: 3 });
    note = `a list called ${key} (3 rows)`;
  } else if (type === "label") xml = shapeXml({ id, name: `Label ${id}`, box, paras: [{ text: "Label", sz: 14, b: true, color: NAVY }] });
  else xml = shapeXml({ id, name: `Box ${id}`, box, fill: "E8EEF4", geom: "roundRect" });
  return { xml, key, note };
}
function insertBlock(type, centre) {
  const info = curInfo(); if (!info) return;
  const def = blockDef(type); if (!def) return;
  const size = blockSize(def);
  const c = centre || { x: S.W / 2, y: S.H / 2 };
  const box = { cx: size.cx, cy: size.cy,
    x: snap(Math.min(Math.max(c.x - size.cx / 2, 0), S.W - size.cx)),
    y: snap(Math.min(Math.max(c.y - size.cy / 2, 0), S.H - size.cy)) };
  let made = null, idx = 0;
  const ok = mutatePart(info.path, doc => {
    made = blockXml(type, nextShapeId(doc), box);
    dig(doc.documentElement, "cSld", "spTree").appendChild(importXml(doc, made.xml));
    idx = collectObjects(doc).length - 1;
  });
  if (!ok) return;
  S.selObj = idx; S.selCell = null; S.rtab = "format";
  refresh();
  toast(made.note ? `Added ${def.label.toLowerCase()} with ${made.note}` : `Added ${def.label.toLowerCase()}`);
}

/* ---------------------------------------------------------------- slides */
function nextPart(prefix) {
  let n = 1; while (S.texts[`${prefix}${n}.xml`] !== undefined || S.zip.has(`${prefix}${n}.xml`)) n++;
  return `${prefix}${n}.xml`;
}
const relsPathOf = part => part.replace(/([^/]+)$/, "_rels/$1.rels");
function relTarget(from, to) {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  let i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}
function structuralChange(fn) {
  const changes = {};
  const put = (p, v) => { if (!(p in changes)) changes[p] = S.texts[p] ?? null; setPart(p, v); };
  fn(put);
  S.undo.push(changes);
  indexStructure();
}
function addSlideAt(pos, slideXml, relsXml) {
  structuralChange(put => {
    const path = nextPart("ppt/slides/slide");
    put(path, slideXml);
    put(relsPathOf(path), relsXml);
    const ct = parseXml(S.texts["[Content_Types].xml"]);
    const ov = ct.createElementNS(CT_NS, "Override");
    ov.setAttribute("PartName", "/" + path);
    ov.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    ct.documentElement.appendChild(ov);
    put("[Content_Types].xml", serializeXml(ct));
    const prPath = "ppt/_rels/presentation.xml.rels";
    const pr = parseXml(S.texts[prPath]);
    let n = 1; const ids = new Set([...pr.documentElement.children].map(r => r.getAttribute("Id")));
    while (ids.has(`rId${n}`)) n++;
    const rel = pr.createElementNS(PR_NS, "Relationship");
    rel.setAttribute("Id", `rId${n}`);
    rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide");
    rel.setAttribute("Target", relTarget("ppt/presentation.xml", path));
    pr.documentElement.appendChild(rel);
    put(prPath, serializeXml(pr));
    const pres = parseXml(S.texts["ppt/presentation.xml"]);
    const lst = kid(pres.documentElement, "sldIdLst");
    const sids = kids(lst, "sldId");
    const sid = pres.createElementNS(P_NS, "p:sldId");
    sid.setAttribute("id", String(Math.max(255, ...sids.map(s => num(s.getAttribute("id")))) + 1));
    sid.setAttributeNS(R_NS, "r:id", `rId${n}`);
    lst.insertBefore(sid, sids[pos] || null);
    put("ppt/presentation.xml", serializeXml(pres));
  });
  S.cur = pos; S.selObj = null; S.selCell = null;
  refresh();
}
function blankSlideXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function addBlankSlide() {
  const info = curInfo();
  const layout = info?.layout || Object.keys(S.texts).find(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="${PR_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${relTarget("ppt/slides/slideX.xml", layout)}"/></Relationships>`;
  addSlideAt(S.cur + 1, blankSlideXml(), rels);
  toast("Slide added");
}
function duplicateSlide(i) {
  const info = S.slides[i];
  let rels = S.texts[relsPathOf(info.path)] || "";
  rels = rels.replace(/<Relationship\b[^>]*notesSlide"[^>]*\/>/g, "");
  addSlideAt(i + 1, S.texts[info.path], rels);
  toast("Slide duplicated");
}
function deleteSlide(i) {
  if (S.slides.length <= 1) { toast("A template needs at least one slide."); return; }
  const info = S.slides[i];
  structuralChange(put => {
    const pres = parseXml(S.texts["ppt/presentation.xml"]);
    const prPath = "ppt/_rels/presentation.xml.rels";
    const pr = parseXml(S.texts[prPath]);
    const rel = [...pr.documentElement.children].find(r => resolvePath("ppt/presentation.xml", r.getAttribute("Target") || "") === info.path);
    if (rel) {
      const rid = rel.getAttribute("Id");
      for (const s of kids(kid(pres.documentElement, "sldIdLst"), "sldId")) if ((s.getAttributeNS(R_NS, "id") || s.getAttribute("r:id")) === rid) s.remove();
      rel.remove();
      put("ppt/presentation.xml", serializeXml(pres));
      put(prPath, serializeXml(pr));
    }
    const gone = [info.path, relsPathOf(info.path)];
    if (info.notes) gone.push(info.notes, relsPathOf(info.notes));
    const ct = parseXml(S.texts["[Content_Types].xml"]);
    for (const o of [...ct.documentElement.children]) if (gone.includes((o.getAttribute("PartName") || "").slice(1))) o.remove();
    put("[Content_Types].xml", serializeXml(ct));
    for (const p of gone) if (S.texts[p] !== undefined) put(p, null);
  });
  S.cur = Math.min(i, S.slides.length - 1); S.selObj = null; S.selCell = null;
  refresh();
  toast("Slide deleted");
}

/* ---------------------------------------------------------------- object edits */
function editObj(fn, mergeKey) {
  const info = curInfo();
  return mutatePart(info.path, doc => {
    const node = collectObjects(doc)[S.selObj];
    if (!node) return false;
    return fn(node, doc);
  }, mergeKey);
}
function deleteObj() {
  if (S.selObj === null) return;
  if (editObj(node => { node.remove(); })) { S.selObj = null; S.selCell = null; refresh(); toast("Deleted"); }
}
function duplicateObj() {
  let newIdx = null;
  const ok = editObj((node, doc) => {
    const c = node.cloneNode(true);
    const id = nextShapeId(doc);
    const cnv = [...c.getElementsByTagName("*")].find(e => e.localName === "cNvPr");
    if (cnv) cnv.setAttribute("id", id);
    node.after(c);
    const b = readBox(c, curInfo());
    if (b) writeBox(c, { ...b, x: b.x + 2 * GRID * 2, y: b.y + 2 * GRID * 2 });
    newIdx = collectObjects(doc).indexOf(c);
  });
  if (ok) { S.selObj = newIdx; S.selCell = null; refresh(); toast("Duplicated"); }
}
function zOrder(where) {
  let newIdx = null;
  const ok = editObj((node, doc) => {
    const tree = node.parentNode;
    if (where === "front") tree.appendChild(node);
    else tree.insertBefore(node, kid(tree, "grpSpPr")?.nextSibling || null);
    newIdx = collectObjects(doc).indexOf(node);
  });
  if (ok) { S.selObj = newIdx; refresh(); }
}
function nudge(dx, dy) {
  const ok = editObj(node => {
    const b = readBox(node, curInfo()); if (!b) return false;
    writeBox(node, { ...b, x: b.x + dx, y: b.y + dy });
  }, "nudge");
  if (ok) refresh();
}

/* text + style helpers (work on a text box or a table cell) */
function selTextNode(doc) {
  if (S.selCell !== null) return collectEditables(doc, false)[S.selCell]?.node || null;
  const n = collectObjects(doc)[S.selObj];
  return n && kid(n, "txBody") ? n : null;
}
function editText(fn, mergeKey) {
  const info = curInfo();
  return mutatePart(info.path, doc => {
    const n = selTextNode(doc); if (!n) return false;
    return fn(n, doc);
  }, mergeKey);
}
function runPrs(txBody, create) {
  const out = [];
  for (const p of kids(txBody, "p")) {
    for (const r of kids(p, "r")) {
      let rp = kid(r, "rPr");
      if (!rp && create) { rp = r.ownerDocument.createElementNS(A_NS, "a:rPr"); r.insertBefore(rp, r.firstElementChild); }
      if (rp) out.push(rp);
    }
    const e = kid(p, "endParaRPr"); if (e) out.push(e);
  }
  return out;
}
const FILL_NAMES = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];
function setSolid(el, hex, beforeNames) {
  for (const c of [...el.children]) if (FILL_NAMES.includes(c.localName)) c.remove();
  if (hex === undefined) return;
  const doc = el.ownerDocument;
  const f = doc.createElementNS(A_NS, hex === null ? "a:noFill" : "a:solidFill");
  if (hex !== null) { const c = doc.createElementNS(A_NS, "a:srgbClr"); c.setAttribute("val", hex); f.appendChild(c); }
  const before = [...el.children].find(c => beforeNames.includes(c.localName));
  el.insertBefore(f, before || null);
}
function setTextStyle(node, st) {
  const txBody = kid(node, "txBody"); if (!txBody) return;
  for (const rp of runPrs(txBody, true)) {
    if (st.sz) rp.setAttribute("sz", Math.round(st.sz * 100));
    if (st.b !== undefined) rp.setAttribute("b", st.b ? "1" : "0");
    if (st.color) {
      for (const c of [...rp.children]) if (FILL_NAMES.includes(c.localName)) c.remove();
      const f = rp.ownerDocument.createElementNS(A_NS, "a:solidFill");
      const c = rp.ownerDocument.createElementNS(A_NS, "a:srgbClr"); c.setAttribute("val", st.color); f.appendChild(c);
      const ln = kid(rp, "ln");
      rp.insertBefore(f, ln ? ln.nextSibling : rp.firstElementChild);
    }
  }
  if (st.algn) for (const p of kids(txBody, "p")) {
    let pPr = kid(p, "pPr");
    if (!pPr) { pPr = p.ownerDocument.createElementNS(A_NS, "a:pPr"); p.insertBefore(pPr, p.firstElementChild); }
    pPr.setAttribute("algn", st.algn);
  }
}
function setBoxFill(node, hex) {
  if (node.localName === "tc") {
    let tcPr = kid(node, "tcPr");
    if (!tcPr) { tcPr = node.ownerDocument.createElementNS(A_NS, "a:tcPr"); node.appendChild(tcPr); }
    setSolid(tcPr, hex, ["headers", "extLst"]);
  } else {
    const spPr = kid(node, "spPr"); if (!spPr) return;
    setSolid(spPr, hex, ["ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"]);
  }
}
function readStyle(node) {
  const txBody = kid(node, "txBody");
  const rp = txBody ? runPrs(txBody, false)[0] : null;
  const hexIn = el => { const s = el ? kid(el, "solidFill") : null; return s ? kid(s, "srgbClr")?.getAttribute("val") : null; };
  const fillHost = node.localName === "tc" ? kid(node, "tcPr") : kid(node, "spPr");
  const p0 = txBody ? kid(kids(txBody, "p")[0], "pPr") : null;
  return {
    sz: rp?.getAttribute("sz") ? num(rp.getAttribute("sz")) / 100 : 18,
    b: rp?.getAttribute("b") === "1",
    color: hexIn(rp) || "000000",
    fill: hexIn(fillHost),
    noFill: !!(fillHost && kid(fillHost, "noFill")),
    algn: p0?.getAttribute("algn") || "l",
  };
}

/* table edits */
function selTable(doc) {
  const n = collectObjects(doc)[S.selObj];
  return n && n.localName === "graphicFrame" ? { frame: n, tbl: n.getElementsByTagNameNS(A_NS, "tbl")[0] } : null;
}
function selCellPos(doc) {
  if (S.selCell === null) return null;
  const ed = collectEditables(doc, false)[S.selCell];
  if (!ed || ed.kind !== "cell") return null;
  return { ...ed, row: kids(ed.tbl, "tr").indexOf(ed.tr), col: kids(ed.tr, "tc").indexOf(ed.node) };
}
function tableOp(op) {
  const info = curInfo();
  let msg = "";
  const ok = mutatePart(info.path, doc => {
    const t = selTable(doc); if (!t || !t.tbl) return false;
    const rows = kids(t.tbl, "tr");
    const pos = selCellPos(doc);
    const ext = dig(t.frame, "xfrm", "ext");
    if (op === "addRow") {
      const tr = pos ? pos.tr : rows[rows.length - 1];
      tr.after(tr.cloneNode(true));
      if (ext) ext.setAttribute("cy", num(ext.getAttribute("cy")) + num(tr.getAttribute("h")));
      msg = "Row added";
    } else if (op === "delRow") {
      if (!pos || rows.length <= 1) return false;
      if (ext) ext.setAttribute("cy", Math.max(MIN, num(ext.getAttribute("cy")) - num(pos.tr.getAttribute("h"))));
      pos.tr.remove(); msg = "Row deleted";
    } else if (op === "addCol") {
      const grid = kid(t.tbl, "tblGrid");
      grid.appendChild(kids(grid, "gridCol").pop().cloneNode(true));
      const used = new Set(scanAll().map(f => f.key.split(".").pop()));
      let k = "column", n = 2; if (used.has(k)) { while (used.has(`column_${n}`)) n++; k = `column_${n}`; }
      for (const tr of rows) {
        const last = kids(tr, "tc").pop(); const c = last.cloneNode(true);
        const m = Engine.visibleText(new XMLSerializer().serializeToString(tr)).match(/\{\{\s*([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*?)\.(\d+)\./);
        setBodyText(kid(c, "txBody"), m ? `{{${m[1]}.${m[2]}.${k}}}` : "New column");
        last.after(c);
      }
      fitColumns(t.tbl, ext ? num(ext.getAttribute("cx")) : S.W / 2);
      msg = "Column added";
    } else if (op === "delCol") {
      if (!pos) return false;
      const cols = kids(kid(t.tbl, "tblGrid"), "gridCol");
      if (cols.length <= 1) return false;
      cols[pos.col].remove();
      for (const tr of rows) kids(tr, "tc")[pos.col]?.remove();
      fitColumns(t.tbl, ext ? num(ext.getAttribute("cx")) : S.W / 2);
      msg = "Column deleted";
    }
    renumberTable(t.tbl);
  });
  if (ok) { if (op === "delRow" || op === "delCol") S.selCell = null; refresh(); toast(msg + (op.endsWith("Row") ? ". List rows renumbered." : "")); }
}

/* put a field into a text box or cell */
function rowHasList(tr) { return /\{\{\s*[A-Za-z0-9_\-.]+\.\d+[.}\s]/.test([...tr.getElementsByTagNameNS(A_NS, "t")].map(t => t.textContent).join("")); }
function resolvePayload(payload, ed) {
  if (!payload.list) return payload.key;
  let n = 1;
  if (ed && ed.kind === "cell") {
    const rows = kids(ed.tbl, "tr"), ri = rows.indexOf(ed.tr);
    n = rowHasList(rows[0]) ? ri + 1 : ri;
    if (n < 1) n = 1;
  }
  return payload.sub ? `${payload.list}.${n}.${payload.sub}` : `${payload.list}.${n}`;
}
function placeField(editIdx, payload) {
  const info = curInfo();
  let key = null;
  const ok = mutatePart(info.path, doc => {
    const ed = collectEditables(doc, false)[editIdx]; if (!ed) return false;
    key = resolvePayload(payload, ed);
    const txBody = kid(ed.node, "txBody");
    const withField = kids(txBody, "p").find(p => /\{\{[^{}]+\}\}/.test(paraText(p)));
    if (withField) setParaText(withField, `{{${key}}}`);   // keep labels and other lines
    else setBodyText(txBody, `{{${key}}}`);
  });
  if (!ok) return;
  const root = key.replace(/^count:/, "").split(/[.=]/)[0];
  S.project.pending = (S.project.pending || []).filter(p => p !== root);
  const doc = parseXml(S.texts[info.path]);
  const ed = collectEditables(doc, false)[editIdx];
  if (ed) {
    S.selObj = collectObjects(doc).findIndex(o => o === ed.node || o.contains(ed.node));
    S.selCell = ed.kind === "cell" ? editIdx : null;
  }
  S.rtab = "format";
  refresh();
  toast(`Placed {{${key}}}`);
}

/* ---------------------------------------------------------------- field references */
function cfgKeyOf(key) {
  if (key.startsWith("count:")) return null;
  const parts = key.split(".");
  const ni = parts.findIndex((p, i) => i > 0 && /^\d+$/.test(p));
  if (ni > 0) { const name = parts.slice(0, ni).join("."), sub = parts.slice(ni + 1).join("."); return sub ? `${name}[].${sub}` : `${name}[]`; }
  return key;
}
function scopeOf(cfgKey) {
  let m = cfgKey.match(/^(.+)\[\]\.(.+)$/);
  if (m) return { label: m[2], scope: { type: "array-child", from: m[2], name: m[1], sub: m[2] } };
  m = cfgKey.match(/^(.+)\[\]$/);
  if (m) return { label: m[1], scope: { type: "array", from: m[1] } };
  const e = S.model.entries.find(x => x.kind === "object" && cfgKey.startsWith(x.name + "."));
  if (e) { const sub = cfgKey.slice(e.name.length + 1); return { label: sub, scope: { type: "object-child", from: sub, name: e.name, sub } }; }
  return { label: cfgKey, scope: { type: "plain", from: cfgKey } };
}
function fieldUsage(root) {
  const out = [];
  S.slides.forEach((s, i) => {
    const keys = Engine.scanPlaceholders(S.texts[s.path] || "").map(f => f.key.replace(/^count:/, "").split(/[.=]/)[0]);
    if (keys.includes(root)) out.push(i);
  });
  return out;
}

/* ---------------------------------------------------------------- canvas rendering */
function fitPlaceholderBoxes(root) {
  for (const box of root.querySelectorAll(".txt")) {
    if (!box.querySelector(".ph") || !box.clientWidth) continue;
    const inCell = !!box.closest("td");
    const cs = getComputedStyle(box);
    const fits = () => {
      const paras = [...box.children];
      if (paras.some(p => p.scrollWidth > p.clientWidth + 1)) return false;
      if (inCell) return true;
      const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let used = 0;
      for (const p of paras) { const ps = getComputedStyle(p); used += p.offsetHeight + parseFloat(ps.marginTop) + parseFloat(ps.marginBottom); }
      return used <= avail + 1;
    };
    if (fits()) continue;
    let lo = 0.4, hi = 1;
    for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; box.style.setProperty("--fit", mid); if (fits()) lo = mid; else hi = mid; }
    box.style.setProperty("--fit", lo);
  }
}
function filledTexts() {
  const t = parseTest();
  if (t.error) return { error: t.error };
  return { out: fillAllTexts(t.data).out };
}
function renderCanvas() {
  const host = $("#slideHost");
  host.innerHTML = "";
  if (!S.slides.length) { host.innerHTML = '<div class="callout">This file has no slides.</div>'; return; }
  const info = curInfo();
  let filled = null;
  if (S.view === "test") {
    const f = filledTexts();
    if (f.error) { const c = document.createElement("div"); c.className = "callout bad"; c.textContent = "The test data isn't valid JSON yet, so this shows the template. " + f.error; host.appendChild(c); }
    else filled = f.out;
  }
  const editable = S.view === "design";
  let el;
  try { el = renderSlide(S.cur, filled ? filled[info.path] : undefined, !filled, editable); }
  catch (e) { el = document.createElement("div"); el.className = "callout bad"; el.textContent = `This slide couldn't be shown: ${e.message}`; }
  el.id = "mainSlide";
  host.appendChild(el);
  if (!filled) fitPlaceholderBoxes(el);
  if (editable) drawOverlay();
  renderStrip(filled);
  $("#canvasMeta").textContent = `Slide ${S.cur + 1} of ${S.slides.length} · ${inches(S.W)} × ${inches(S.H)} in`;
  $("#canvasHint").innerHTML = S.view === "design"
    ? "Drag blocks and fields onto the slide. Drag to move, use the handles to resize, <b>Delete</b> to remove."
    : "Showing the slide filled with your test data.";
}
function renderStrip(filled) {
  const strip = $("#strip"); strip.innerHTML = "";
  S.slides.forEach((s, i) => {
    const b = document.createElement("div"); b.className = "thumb"; b.setAttribute("role", "button"); b.tabIndex = 0;
    b.setAttribute("aria-label", `Slide ${i + 1}`); b.setAttribute("aria-current", i === S.cur);
    const no = document.createElement("span"); no.className = "no"; no.textContent = i + 1;
    let sl;
    try { sl = renderSlide(i, filled ? filled[s.path] : undefined, !filled, false); } catch (e) { sl = document.createElement("div"); sl.className = "slide"; sl.style.aspectRatio = `${S.W}/${S.H}`; }
    b.append(no, sl);
    if (S.view === "design") {
      const acts = document.createElement("div"); acts.className = "thumb-acts";
      acts.innerHTML = `<button type="button" data-act="dup" aria-label="Duplicate slide ${i + 1}">Duplicate</button><button type="button" data-act="del" aria-label="Delete slide ${i + 1}">Delete</button>`;
      b.appendChild(acts);
    }
    b.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "dup") return duplicateSlide(i);
      if (act === "del") return deleteSlide(i);
      if (S.cur !== i) { S.cur = i; S.selObj = null; S.selCell = null; renderCanvas(); renderPanel(); }
    });
    b.addEventListener("keydown", e => { if (e.key === "Enter") b.click(); });
    strip.appendChild(b);
  });
  if (S.view === "design") {
    const add = document.createElement("button"); add.type = "button"; add.className = "add-slide"; add.textContent = "Add slide";
    add.addEventListener("click", addBlankSlide);
    strip.appendChild(add);
  }
  requestAnimationFrame(() => strip.querySelectorAll(".thumb .slide").forEach(fitPlaceholderBoxes));
}
function objRect(slide, idx) {
  const els = slide.querySelectorAll(`[data-obj="${idx}"]`);
  if (!els.length) return null;
  const sr = slide.getBoundingClientRect();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  els.forEach(e => { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
  return { left: l - sr.left, top: t - sr.top, width: r - l, height: b - t };
}
function drawOverlay() {
  const slide = $("#mainSlide"); if (!slide) return;
  slide.querySelector(".overlay")?.remove();
  slide.querySelectorAll(".cellsel").forEach(e => e.classList.remove("cellsel"));
  if (S.selObj === null) return;
  const rc = objRect(slide, S.selObj);
  if (!rc) { S.selObj = null; S.selCell = null; return; }
  const ov = document.createElement("div"); ov.className = "overlay";
  Object.assign(ov.style, { left: rc.left + "px", top: rc.top + "px", width: rc.width + "px", height: rc.height + "px" });
  for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) { const d = document.createElement("div"); d.className = "h"; d.dataset.h = h; ov.appendChild(d); }
  const size = document.createElement("div"); size.className = "size"; ov.appendChild(size);
  const node = collectObjects(parseXml(S.texts[curInfo().path]))[S.selObj];
  const b = node ? readBox(node, curInfo()) : null;
  size.textContent = b ? `${inches(b.cx)} × ${inches(b.cy)} in` : "";
  slide.appendChild(ov);
  if (S.selCell !== null) slide.querySelector(`td.hit[data-edit="${S.selCell}"]`)?.classList.add("cellsel");
}

/* ---------------------------------------------------------------- pointer: select, move, resize */
function onPointerDown(e) {
  if (S.view !== "design" || e.button !== 0) return;
  const slide = $("#mainSlide"); if (!slide || !slide.contains(e.target)) return;
  const h = e.target.closest(".h");
  if (h) { e.preventDefault(); return startDrag(e, "resize", h.dataset.h); }
  const obj = e.target.closest("[data-obj]");
  if (!obj) { if (S.selObj !== null) { S.selObj = null; S.selCell = null; drawOverlay(); renderPanel(); } return; }
  e.preventDefault();
  const idx = +obj.dataset.obj;
  const td = e.target.closest("td.hit");
  const cell = td ? +td.dataset.edit : null;
  if (S.selObj !== idx || S.selCell !== cell || S.rtab !== "format") {
    S.selObj = idx; S.selCell = cell; S.rtab = "format";
    drawOverlay(); renderPanel();
  }
  startDrag(e, "move");
}
function resizeBox(b, h, dx, dy) {
  let { x, y, cx, cy } = b;
  if (h.includes("e")) cx = b.cx + dx;
  if (h.includes("s")) cy = b.cy + dy;
  if (h.includes("w")) { x = b.x + dx; cx = b.cx - dx; }
  if (h.includes("n")) { y = b.y + dy; cy = b.cy - dy; }
  if (cx < MIN) { if (h.includes("w")) x -= MIN - cx; cx = MIN; }
  if (cy < MIN) { if (h.includes("n")) y -= MIN - cy; cy = MIN; }
  return { ...b, x, y, cx, cy };
}
function startDrag(e, mode, handle) {
  const slide = $("#mainSlide");
  const info = curInfo();
  const node = collectObjects(parseXml(S.texts[info.path]))[S.selObj];
  const box = node ? readBox(node, info) : null;
  if (!box) return;
  const k = S.W / slide.clientWidth;
  const sx = e.clientX, sy = e.clientY;
  const els = [...slide.querySelectorAll(`[data-obj="${S.selObj}"]`)];
  const ov = slide.querySelector(".overlay");
  const ov0 = ov ? { l: parseFloat(ov.style.left), t: parseFloat(ov.style.top), w: parseFloat(ov.style.width), h: parseFloat(ov.style.height) } : null;
  const sizeLbl = ov?.querySelector(".size");
  let moved = false, nb = box;
  try { slide.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const move = ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (mode === "move") {
      nb = { ...box, x: snap(box.x + dx * k), y: snap(box.y + dy * k) };
      const px = (nb.x - box.x) / k, py = (nb.y - box.y) / k;
      els.forEach(el => { el.style.translate = `${px}px ${py}px`; });
      if (ov) ov.style.translate = `${px}px ${py}px`;
      if (sizeLbl) sizeLbl.textContent = `${inches(nb.x)}, ${inches(nb.y)} in`;
    } else {
      const r = resizeBox(box, handle, dx * k, dy * k);
      nb = { ...r, x: snap(r.x), y: snap(r.y), cx: snap(r.cx), cy: snap(r.cy) };
      if (ov && ov0) {
        const sxr = ov0.w / (box.cx / k || 1), syr = ov0.h / (box.cy / k || 1);
        Object.assign(ov.style, { left: ov0.l + (nb.x - box.x) / k + "px", top: ov0.t + (nb.y - box.y) / k + "px", width: nb.cx / k * sxr + "px", height: nb.cy / k * syr + "px" });
      }
      if (sizeLbl) sizeLbl.textContent = `${inches(nb.cx)} × ${inches(nb.cy)} in`;
    }
  };
  const up = () => {
    slide.removeEventListener("pointermove", move);
    slide.removeEventListener("pointerup", up);
    slide.removeEventListener("pointercancel", up);
    if (!moved) return;
    const ok = mutatePart(info.path, doc => {
      const n = collectObjects(doc)[S.selObj]; if (!n) return false;
      writeBox(n, nb, box);
    });
    if (ok) refresh(); else renderCanvas();
  };
  slide.addEventListener("pointermove", move);
  slide.addEventListener("pointerup", up);
  slide.addEventListener("pointercancel", up);
}

/* ---------------------------------------------------------------- drag from the sidebar */
const DT_BLOCK = "application/x-ts-block", DT_FIELD = "application/x-ts-field";
let dragInfo = null;
function emuAt(ev) {
  const slide = $("#mainSlide"); if (!slide) return null;
  const r = slide.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * S.W, y: (ev.clientY - r.top) / r.height * S.H, inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
}
function dropTargetAt(ev) {
  const slide = $("#mainSlide"); if (!slide) return null;
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const hit = el?.closest?.("td.hit") || el?.closest?.(".hit");
  return hit && slide.contains(hit) ? hit : null;
}
function clearDropMarks() {
  document.querySelectorAll(".drop-target").forEach(e => e.classList.remove("drop-target"));
  document.querySelector(".drop-ghost")?.remove();
}
function wireCanvasDrop() {
  const host = $("#canvas");
  host.addEventListener("dragover", e => {
    const types = [...(e.dataTransfer?.types || [])];
    if (types.includes("Files")) { e.preventDefault(); host.classList.add("drop-file"); return; }
    if (!dragInfo || S.view !== "design") return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    clearDropMarks();
    if (dragInfo.kind === "field") { dropTargetAt(e)?.classList.add("drop-target"); return; }
    const p = emuAt(e), slide = $("#mainSlide");
    if (!p || !p.inside) return;
    const size = blockSize(blockDef(dragInfo.type));
    const g = document.createElement("div"); g.className = "drop-ghost";
    const kx = slide.clientWidth / S.W;
    const x = Math.min(Math.max(p.x - size.cx / 2, 0), S.W - size.cx), y = Math.min(Math.max(p.y - size.cy / 2, 0), S.H - size.cy);
    Object.assign(g.style, { left: x * kx + "px", top: y * kx + "px", width: size.cx * kx + "px", height: size.cy * kx + "px" });
    slide.appendChild(g);
  });
  host.addEventListener("dragleave", e => { if (!host.contains(e.relatedTarget)) { clearDropMarks(); host.classList.remove("drop-file"); } });
  host.addEventListener("drop", e => {
    host.classList.remove("drop-file");
    const f = e.dataTransfer?.files?.[0];
    if (f) { e.preventDefault(); clearDropMarks(); return openFile(f); }
    if (!dragInfo || S.view !== "design") return;
    e.preventDefault();
    const info = dragInfo; dragInfo = null;
    const target = info.kind === "field" ? dropTargetAt(e) : null;
    const p = emuAt(e);
    clearDropMarks();
    if (info.kind === "block") { if (p && p.inside) insertBlock(info.type, p); return; }
    if (!target) { toast("Drop the field onto a text box or a table cell."); return; }
    placeField(+target.dataset.edit, info.payload);
  });
}
function makeDraggable(el, info) {
  el.draggable = true;
  el.addEventListener("dragstart", e => {
    dragInfo = info;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(info.kind === "block" ? DT_BLOCK : DT_FIELD, JSON.stringify(info));
    e.dataTransfer.setData("text/plain", info.kind === "block" ? info.type : `{{${info.payload.key || info.payload.list}}}`);
  });
  el.addEventListener("dragend", () => { dragInfo = null; clearDropMarks(); });
}

/* ---------------------------------------------------------------- left panel */
function renderBlocks() {
  const host = $("#blocks"); host.innerHTML = "";
  for (const b of BLOCKS) {
    const d = document.createElement("button"); d.type = "button"; d.className = "tool"; d.dataset.type = b.type;
    d.innerHTML = `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[b.type]}</svg><span>${b.label}</span>`;
    d.title = `Insert ${b.label.toLowerCase()}: drag it onto the slide, or click to place it in the middle`;
    makeDraggable(d, { kind: "block", type: b.type });
    d.addEventListener("click", () => insertBlock(b.type));
    host.appendChild(d);
  }
}
const GLYPHS = {
  text: '<path d="M3.5 4.5h9M8 4.5v8" />',
  list: '<circle cx="3.6" cy="5" r=".9" fill="currentColor" stroke="none"/><circle cx="3.6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3.6" cy="11" r=".9" fill="currentColor" stroke="none"/><path d="M6.5 5h6M6.5 8h6M6.5 11h4" />',
  item: '<path d="M4 8h8M9 5l3 3-3 3" />',
  count: '<path d="M5.5 3.5 4.5 12.5M10.5 3.5l-1 9M3 6.5h9.5M2.5 9.5H12" />',
  new: '<path d="M8 3.5v9M3.5 8h9" />',
};
function chip(label, payload, { cfgKey = null, tag = "", cls = "", glyph = "text" } = {}) {
  const c = document.createElement("div");
  c.className = "chip " + cls; c.tabIndex = 0; c.setAttribute("role", "button");
  c.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[glyph] || GLYPHS.text}</svg><span class="k">${esc(label)}</span>${tag ? `<span class="t">${esc(tag)}</span>` : ""}`;
  c.title = "Drag onto a text box or table cell. Click to edit its settings.";
  if (cfgKey && S.selField === cfgKey) c.classList.add("sel");
  makeDraggable(c, { kind: "field", payload });
  const open = () => { if (cfgKey) { S.selField = cfgKey; S.selObj = null; S.selCell = null; S.rtab = "fields"; drawOverlay(); renderPanel(); } };
  c.addEventListener("click", open);
  c.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  return c;
}
function renderFieldList() {
  const host = $("#fieldList"); if (!host) return; host.innerHTML = "";
  const m = S.model;
  for (const e of m.entries.filter(x => x.kind === "field"))
    host.appendChild(chip(e.name, { key: e.path }, { cfgKey: e.path, glyph: fieldType(e) === "list" ? "list" : "text", tag: fieldType(e) === "list" ? "List" : "" }));
  for (const e of m.entries.filter(x => x.kind !== "field")) {
    const g = document.createElement("div"); g.className = "fgroup";
    const head = document.createElement("div"); head.className = "fgroup-h";
    if (e.kind === "object") {
      head.innerHTML = `<span>${esc(e.name)}</span><span>Group</span>`;
      g.appendChild(head);
      e.children.forEach(c => g.appendChild(chip(c.sub, { key: c.path }, { cfgKey: c.path })));
    } else {
      head.innerHTML = `<span>${esc(e.name)}</span><span>List · ${e.max} row${e.max === 1 ? "" : "s"}</span>`;
      head.title = "Edit the list's settings";
      head.addEventListener("click", () => { S.selField = e.name + "[]"; S.selObj = null; S.selCell = null; S.rtab = "fields"; drawOverlay(); renderPanel(); });
      g.appendChild(head);
      if (e.scalar) g.appendChild(chip("item", { list: e.name, sub: "" }, { cfgKey: e.name + "[]", glyph: "item" }));
      e.children.forEach(sub => g.appendChild(chip(sub, { list: e.name, sub }, { cfgKey: `${e.name}[].${sub}`, glyph: "item" })));
      g.appendChild(chip(`Number of ${e.name}`, { key: `count:${e.name}` }, { glyph: "count" }));
      for (const sub of e.children) {
        const allowed = String(peekCfg(`${e.name}[].${sub}`).allowed || "").split(",").map(s => s.trim()).filter(Boolean);
        allowed.forEach(v => g.appendChild(chip(`Number with ${sub} ${v}`, { key: `count:${e.name}.${sub}=${v}` }, { glyph: "count" })));
      }
    }
    host.appendChild(g);
  }
  const pend = (S.project.pending || []).filter(p => !existingRootsPlaced().has(p));
  pend.forEach(p => host.appendChild(chip(p, { key: p }, { cls: "pending", glyph: "new", tag: "Not placed" })));
  if (!m.entries.length && !pend.length) host.innerHTML = '<span class="hint">No fields yet. Insert a Title, Text or Table, or add a field below.</span>';
}
function existingRootsPlaced() { return new Set(scanAll().map(f => f.key.replace(/^count:/, "").split(/[.=]/)[0])); }

/* ---------------------------------------------------------------- inspector */
function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (v !== null && v !== undefined) e.setAttribute(k, v); }
  if (html) e.innerHTML = html;
  return e;
}
const onSettingsChange = debounce(() => { if (!S.testEdited) S.testText = JSON.stringify(buildExample(S.model), null, 2); save(); }, 300);
function fieldEditor(cfgKey, opts = {}) {
  const c = peekCfg(cfgKey);
  const { label, scope } = scopeOf(cfgKey);
  const isArray = /\[\]$/.test(cfgKey), isChild = /\[\]\./.test(cfgKey);
  const entry = S.model.entries.find(e => e.kind === "field" && e.path === cfgKey);
  const arrEntry = isArray ? S.model.entries.find(e => e.kind === "array" && e.name + "[]" === cfgKey) : null;
  const card = el("div", { class: "field-card" });
  const name = el("input", { class: "key", type: "text", value: label, spellcheck: "false", "aria-label": "Field name", title: "Rename (updates the template too)" });
  name.addEventListener("change", () => {
    const v = name.value.trim();
    if (v === label) return;
    if (!KEY_RE.test(v)) { toast("Use letters, numbers and _ only, starting with a letter."); name.value = label; return; }
    if (renameKey(scope.from, v, scope)) {
      if (S.selField === cfgKey) S.selField = scope.type === "plain" ? v : scope.type === "array" ? v + "[]" : scope.type === "array-child" ? `${scope.name}[].${v}` : `${scope.name}.${v}`;
      refresh(); toast(`Renamed to ${v}`);
    }
  });
  const head = el("div", { class: "row", style: "flex-wrap:nowrap" });
  head.appendChild(name);
  if (entry) {
    const t = el("select", { class: "inp", style: "width:auto", "aria-label": "Field type" }, '<option value="text">Text</option><option value="list">List</option>');
    t.value = fieldType(entry);
    t.addEventListener("change", () => { cfg(cfgKey).type = t.value; refresh(); });
    head.appendChild(t);
  }
  card.appendChild(head);
  if (arrEntry && !arrEntry.scalar) {
    card.appendChild(el("span", { class: "hint" }, `A list with up to ${arrEntry.max} item${arrEntry.max === 1 ? "" : "s"}. Each item fills one table row; unused rows are removed.`));
  }
  const descWrap = el("div", { class: arrEntry && !arrEntry.scalar ? "" : "two" });
  const d = el("div"); d.appendChild(el("label", { class: "lbl" }, "Description for the LLM"));
  const desc = el("input", { class: "inp", type: "text", value: c.desc || "", placeholder: isArray ? "e.g. most important first" : "What should go here?" });
  desc.addEventListener("input", () => { cfg(cfgKey).desc = desc.value; onSettingsChange(); });
  d.appendChild(desc); descWrap.appendChild(d);
  if (!(arrEntry && !arrEntry.scalar)) {
    const mx = el("div"); mx.appendChild(el("label", { class: "lbl" }, "Max words"));
    const max = el("input", { class: "inp", type: "number", min: "0", value: c.max || "", placeholder: "—" });
    max.addEventListener("input", () => { cfg(cfgKey).max = max.value ? +max.value : ""; onSettingsChange(); });
    mx.appendChild(max); descWrap.appendChild(mx);
  }
  card.appendChild(descWrap);
  if (!(arrEntry && !arrEntry.scalar)) {
    const multi = isChild || isArray || (entry && fieldType(entry) === "list");
    const ex = el("div");
    ex.appendChild(el("label", { class: "lbl" }, multi ? (isChild ? "Examples (one per row)" : "Examples (one per line)") : "Example"));
    const exIn = multi ? el("textarea", { class: "inp", rows: "2" }) : el("input", { class: "inp", type: "text" });
    exIn.value = c.example || "";
    exIn.addEventListener("input", () => { cfg(cfgKey).example = exIn.value; onSettingsChange(); });
    ex.appendChild(exIn); card.appendChild(ex);
    if (!(entry && fieldType(entry) === "list") && !isArray) {
      const al = el("div"); al.appendChild(el("label", { class: "lbl" }, "Allowed values"));
      const alIn = el("input", { class: "inp", type: "text", value: c.allowed || "", placeholder: "e.g. High, Medium, Low" });
      alIn.addEventListener("input", () => { cfg(cfgKey).allowed = alIn.value; onSettingsChange(); });
      alIn.addEventListener("change", () => renderFieldList());
      al.appendChild(alIn); card.appendChild(al);
    }
  }
  return card;
}
function placeableOptions(ed) {
  const out = [];
  for (const e of S.model.entries) {
    if (e.kind === "field") out.push({ label: e.name, payload: { key: e.path } });
    else if (e.kind === "object") e.children.forEach(c => out.push({ label: c.path, payload: { key: c.path } }));
    else {
      if (e.scalar) out.push({ label: `${e.name} (item)`, payload: { list: e.name, sub: "" } });
      e.children.forEach(sub => out.push({ label: `${e.name} → ${sub}`, payload: { list: e.name, sub } }));
      out.push({ label: `count of ${e.name}`, payload: { key: `count:${e.name}` } });
    }
  }
  (S.project.pending || []).forEach(p => out.push({ label: `${p} (new)`, payload: { key: p } }));
  return out;
}
function textSection(doc, node, kind) {
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, kind === "cell" ? "Cell text" : "Text"));
  const txBody = kid(node, "txBody");
  const ta = el("textarea", { class: "inp", rows: "3", spellcheck: "false", "aria-label": "Text (one line per paragraph)", id: "inspText" });
  ta.value = txBody ? kids(txBody, "p").map(paraText).join("\n") : "";
  const apply = debounce(() => {
    if (editText(n => setBodyText(kid(n, "txBody"), ta.value), `text:${S.cur}:${S.selObj}:${S.selCell}`)) {
      S.model = buildModel(); renderCanvas(); onSettingsChange(); renderFieldsInSel();
    }
  }, 350);
  ta.addEventListener("input", apply);
  sec.appendChild(ta);
  const row = el("div", { class: "row", style: "flex-wrap:nowrap" });
  const sel = el("select", { class: "inp", "aria-label": "Use a field" });
  const eds = collectEditables(doc, false);
  const editIdx = S.selCell !== null ? S.selCell : eds.findIndex(x => x.node === node);
  const ed = eds[editIdx];
  const opts = placeableOptions(ed);
  sel.innerHTML = `<option value="">Use a field…</option>` + opts.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join("") + `<option value="new">New field…</option>`;
  sel.addEventListener("change", () => {
    if (sel.value === "new") { S.rtab = "fields"; renderPanel(); $("#newField").focus(); toast("Name the new field, then drag it onto the box."); return; }
    if (sel.value === "") return;
    if (editIdx < 0) return;
    placeField(editIdx, opts[+sel.value].payload);
  });
  row.appendChild(sel);
  sec.appendChild(row);
  sec.appendChild(el("span", { class: "hint" }, "One line per paragraph. Type <code>{{name}}</code> to add a field."));
  return sec;
}
function renderFieldsInSel() {
  const host = $("#selFields"); if (!host) return;
  host.innerHTML = "";
  const doc = parseXml(S.texts[curInfo().path]);
  const node = selTextNode(doc);
  const n = collectObjects(doc)[S.selObj];
  let keys = [];
  if (node) keys = Engine.scanPlaceholders(new XMLSerializer().serializeToString(node)).map(f => f.key);
  else if (n && n.localName === "graphicFrame") keys = Engine.scanPlaceholders(new XMLSerializer().serializeToString(n)).map(f => f.key);
  const cfgKeys = [...new Set(keys.map(cfgKeyOf).filter(Boolean))];
  const arrays = [...new Set(cfgKeys.filter(k => k.includes("[]")).map(k => k.split("[]")[0] + "[]"))];
  if (!cfgKeys.length) return;
  host.appendChild(el("div", { class: "sect-title" }, cfgKeys.length === 1 ? "Field" : "Fields"));
  arrays.forEach(a => { if (!cfgKeys.includes(a)) host.appendChild(fieldEditor(a)); });
  cfgKeys.forEach(k => host.appendChild(fieldEditor(k)));
}
function styleSection(node, label) {
  const st = readStyle(node);
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, label));
  const hasText = !!kid(node, "txBody");
  const apply = (fn, key) => { const ok = (S.selCell !== null || hasText) ? editText(n => fn(n), key) : editObj(n => fn(n), key); if (ok) renderCanvas(); };
  if (hasText) {
    const r = el("div", { class: "style-row" });
    const szW = el("div"); szW.appendChild(el("label", { class: "lbl" }, "Size"));
    const sz = el("input", { class: "inp", type: "number", min: "6", max: "120", step: "1", value: String(Math.round(st.sz)) });
    sz.addEventListener("change", () => apply(n => setTextStyle(n, { sz: +sz.value || st.sz }), "style"));
    szW.appendChild(sz);
    const bW = el("div"); bW.appendChild(el("label", { class: "lbl" }, "Weight"));
    const bs = el("div", { class: "seg" }, `<button type="button" aria-pressed="${!st.b}">Normal</button><button type="button" aria-pressed="${st.b}"><b>Bold</b></button>`);
    bs.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => { apply(n => setTextStyle(n, { b: i === 1 }), "style"); bs.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", i === j)); }));
    bW.appendChild(bs);
    const aW = el("div"); aW.appendChild(el("label", { class: "lbl" }, "Align"));
    const as = el("div", { class: "seg" }, ["l", "ctr", "r"].map(a => `<button type="button" data-a="${a}" aria-pressed="${st.algn === a}" aria-label="Align ${a === "l" ? "left" : a === "r" ? "right" : "centre"}">${a === "l" ? "Left" : a === "r" ? "Right" : "Centre"}</button>`).join(""));
    as.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { apply(n => setTextStyle(n, { algn: b.dataset.a }), "style"); as.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    aW.appendChild(as);
    r.append(szW, bW);
    sec.appendChild(r); sec.appendChild(aW);
  }
  const cr = el("div", { class: "two", style: "grid-template-columns:1fr 1fr" });
  if (hasText) {
    const tc = el("div"); tc.appendChild(el("label", { class: "lbl" }, "Text colour"));
    const ti = el("input", { type: "color", value: "#" + st.color, "aria-label": "Text colour" });
    ti.addEventListener("change", () => apply(n => setTextStyle(n, { color: ti.value.slice(1).toUpperCase() }), "style"));
    tc.appendChild(ti); cr.appendChild(tc);
  }
  const fc = el("div"); fc.appendChild(el("label", { class: "lbl" }, "Fill"));
  const fRow = el("div", { class: "row", style: "flex-wrap:nowrap" });
  const fi = el("input", { type: "color", value: "#" + (st.fill || "FFFFFF"), "aria-label": "Fill colour" });
  fi.addEventListener("change", () => apply(n => setBoxFill(n, fi.value.slice(1).toUpperCase()), "style"));
  const nf = el("button", { class: "btn small plain", type: "button", title: "No fill" }, "None");
  nf.addEventListener("click", () => apply(n => setBoxFill(n, null), "style"));
  fRow.append(fi, nf); fc.appendChild(fRow); cr.appendChild(fc);
  sec.appendChild(cr);
  return sec;
}
function positionSection(node) {
  const b = readBox(node, curInfo()); if (!b) return null;
  const sec = el("div", { class: "sect" });
  sec.appendChild(el("div", { class: "sect-title" }, "Position <span class=\"hint\" style=\"text-transform:none;letter-spacing:0;font-weight:400\">inches</span>"));
  const g = el("div", { style: "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px" });
  [["x", "Left"], ["y", "Top"], ["cx", "Width"], ["cy", "Height"]].forEach(([k, lab]) => {
    const w = el("div"); w.appendChild(el("label", { class: "lbl" }, lab));
    const i = el("input", { class: "inp", type: "number", step: "0.05", value: inches(b[k]) });
    i.addEventListener("change", () => {
      const v = Math.round(parseFloat(i.value) * IN); if (isNaN(v)) return;
      if (editObj(n => { const cur = readBox(n, curInfo()); writeBox(n, { ...cur, [k]: v }, cur); })) refresh();
    });
    w.appendChild(i); g.appendChild(w);
  });
  sec.appendChild(g);
  return sec;
}
function settingsPanel() {
  const wrap = el("div");
  const s = el("div", { class: "sect" });
  s.appendChild(el("div", { class: "sect-title" }, "Output"));
  const fnW = el("div"); fnW.appendChild(el("label", { class: "lbl", for: "fileNameField" }, "File name comes from"));
  const sel = el("select", { class: "inp", id: "fileNameField" });
  const opts = [];
  for (const e of S.model.entries) { if (e.kind === "field" && fieldType(e) === "text") opts.push(e.path); if (e.kind === "object") e.children.forEach(c => opts.push(c.path)); }
  sel.innerHTML = `<option value="">Template name</option>` + opts.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  sel.value = opts.includes(S.project.settings.file_name_field) ? S.project.settings.file_name_field : "";
  sel.addEventListener("change", () => { S.project.settings.file_name_field = sel.value; save(); });
  fnW.appendChild(sel); s.appendChild(fnW);
  wrap.appendChild(s);
  const r = el("div", { class: "sect" });
  r.appendChild(el("div", { class: "sect-title" }, "Table cell colours"));
  r.appendChild(el("span", { class: "hint" }, "A table cell whose whole text matches gets these colours. Text, fill."));
  S.project.settings.colour_rules.forEach((rule, i) => {
    const row = el("div", { class: "rule" });
    const m = el("input", { class: "inp", type: "text", value: rule.match, "aria-label": "Text to match" });
    const f = el("input", { type: "color", value: "#" + rule.fill, "aria-label": "Fill colour" });
    const t = el("input", { type: "color", value: "#" + rule.text, "aria-label": "Text colour" });
    const del = el("button", { class: "btn small plain danger", type: "button", "aria-label": "Remove rule" }, "Remove");
    const upd = () => { rule.match = m.value; rule.fill = f.value.slice(1).toUpperCase(); rule.text = t.value.slice(1).toUpperCase(); save(); };
    [m, f, t].forEach(x => x.addEventListener("input", upd));
    del.addEventListener("click", () => { S.project.settings.colour_rules.splice(i, 1); save(); renderPanel(); });
    row.append(m, t, f, del); r.appendChild(row);
  });
  const rb = el("div", { class: "row" });
  const add = el("button", { class: "btn small", type: "button" }, "Add rule");
  add.addEventListener("click", () => { S.project.settings.colour_rules.push({ match: "", fill: "E8F1FC", text: "0B4F99" }); save(); renderPanel(); });
  const rag = el("button", { class: "btn small plain", type: "button" }, "Add High / Medium / Low");
  rag.addEventListener("click", () => {
    const rl = S.project.settings.colour_rules;
    for (const x of [{ match: "High", fill: "FADBD8", text: "A93226" }, { match: "Medium", fill: "FCEBCF", text: "9C640C" }, { match: "Low", fill: "D9F2E3", text: "1E7A46" }])
      if (!rl.some(y => y.match.toLowerCase() === x.match.toLowerCase())) rl.push(x);
    save(); renderPanel();
  });
  rb.append(add, rag); r.appendChild(rb);
  wrap.appendChild(r);
  const tip = el("div", { class: "sect" });
  tip.innerHTML = `<div class="sect-title">How it works</div><div class="tip">
    <span>Insert blocks from the toolbar, or open your own PowerPoint.</span>
    <span>Drag fields from the Fields tab onto text boxes and table cells.</span>
    <span>Describe each field so the LLM knows what to write.</span>
    <span>Check the result in Test, then copy everything from Get code.</span></div>`;
  wrap.appendChild(tip);
  return wrap;
}
function renderPanel() {
  const design = S.view === "design";
  $("#designPanel").hidden = !design;
  $("#testPanel").hidden = S.view !== "test";
  if (!design) return;
  $$("[data-rtab]").forEach(b => b.setAttribute("aria-selected", b.dataset.rtab === S.rtab));
  $("#formatPane").hidden = S.rtab !== "format";
  $("#fieldsPane").hidden = S.rtab !== "fields";
  $("#documentPane").hidden = S.rtab !== "document";
  if (S.rtab === "format") renderInspector();
  else if (S.rtab === "fields") { renderFieldList(); renderFieldSettings(); }
  else { const d = $("#documentPane"); d.innerHTML = ""; d.appendChild(settingsPanel()); }
}
function renderFieldSettings() {
  const host = $("#fieldSettings"); host.innerHTML = "";
  if (!S.selField) return;
  const sect = el("div", { class: "sect" });
  const head = el("div", { class: "insp-head" });
  head.appendChild(el("h2", {}, /\[\]$/.test(S.selField) ? "List" : "Field"));
  const close = el("button", { class: "btn small plain", type: "button" }, "Done");
  close.addEventListener("click", () => { S.selField = null; renderPanel(); });
  head.appendChild(close); sect.appendChild(head);
  const root = S.selField.split(/\[\]|\./)[0];
  const used = fieldUsage(root);
  sect.appendChild(el("span", { class: "hint" }, used.length ? `On slide ${used.map(i => i + 1).join(", ")}.` : "Not on any slide yet. Drag it onto a text box."));
  sect.appendChild(fieldEditor(S.selField));
  const arr = S.model.entries.find(x => x.kind === "array" && x.name + "[]" === S.selField);
  if (arr) arr.children.forEach(sub => sect.appendChild(fieldEditor(`${arr.name}[].${sub}`)));
  if (used.length && !used.includes(S.cur)) {
    const go = el("button", { class: "btn small", type: "button" }, `Show slide ${used[0] + 1}`);
    go.addEventListener("click", () => { S.cur = used[0]; renderCanvas(); });
    sect.appendChild(go);
  }
  host.appendChild(sect);
}
function renderInspector() {
  const host = $("#inspector");
  const keep = document.activeElement?.id === "inspText" ? { sel: [document.activeElement.selectionStart, document.activeElement.selectionEnd] } : null;
  host.innerHTML = "";
  if (S.selObj === null) { host.appendChild(el("div", { class: "empty-note" }, "Select something on the slide to format it.<br>Insert blocks from the toolbar.")); return; }
  const doc = parseXml(S.texts[curInfo().path]);
  const node = collectObjects(doc)[S.selObj];
  if (!node) { S.selObj = null; host.appendChild(el("div", { class: "empty-note" }, "Select something on the slide to format it.")); return; }
  const kind = node.localName === "graphicFrame" ? (node.getElementsByTagNameNS(A_NS, "tbl")[0] ? "Table" : "Object")
    : node.localName === "pic" ? "Picture" : node.localName === "grpSp" ? "Group" : node.localName === "cxnSp" ? "Line"
    : kid(node, "txBody") ? "Text box" : "Shape";
  const top = el("div", { class: "sect" });
  const head = el("div", { class: "insp-head" });
  head.appendChild(el("h2", {}, S.selCell !== null ? "Table cell" : kind));
  const tools = el("div", { class: "tools" });
  [["Duplicate", duplicateObj, "Duplicate (Ctrl+D)"], ["Front", () => zOrder("front"), "Bring to front"], ["Back", () => zOrder("back"), "Send to back"], ["Delete", deleteObj, "Delete (Del)"]].forEach(([t, fn, title]) => {
    const b = el("button", { class: "btn small plain" + (t === "Delete" ? " danger" : ""), type: "button", title }, t);
    b.addEventListener("click", fn); tools.appendChild(b);
  });
  head.appendChild(tools); top.appendChild(head);
  host.appendChild(top);
  const textNode = selTextNode(doc);
  if (kind === "Table") {
    const sec = el("div", { class: "sect" });
    sec.appendChild(el("div", { class: "sect-title" }, "Rows and columns"));
    const r1 = el("div", { class: "row" });
    [["Add row", "addRow"], ["Add column", "addCol"], ["Delete row", "delRow"], ["Delete column", "delCol"]].forEach(([t, op]) => {
      const b = el("button", { class: "btn small" + (op.startsWith("del") ? " danger" : ""), type: "button" }, t);
      if (op.startsWith("del") && S.selCell === null) { b.disabled = true; b.title = "Click a cell first"; }
      b.addEventListener("click", () => tableOp(op)); r1.appendChild(b);
    });
    sec.appendChild(r1);
    sec.appendChild(el("span", { class: "hint" }, S.selCell === null ? "Click a cell to edit it, or drag a field onto it." : "Rows renumber themselves, so each list item lands in its own row."));
    host.appendChild(sec);
  }
  if (textNode) host.appendChild(textSection(doc, textNode, S.selCell !== null ? "cell" : "sp"));
  const sf = el("div", { class: "sect", id: "selFields" }); host.appendChild(sf);
  renderFieldsInSel();
  if (!sf.childElementCount) sf.remove();
  if (textNode) host.appendChild(styleSection(textNode, S.selCell !== null ? "Cell style" : "Style"));
  else if (node.localName === "sp") host.appendChild(styleSection(node, "Style"));
  const pos = positionSection(node); if (pos) host.appendChild(pos);
  if (keep) { const t = $("#inspText"); if (t) { t.focus(); t.setSelectionRange(...keep.sel); } }
}

/* ---------------------------------------------------------------- test + code views */
function renderTestPanel() {
  const ta = $("#testJson");
  if (document.activeElement !== ta) ta.value = S.testText;
  const host = $("#testStatus"); host.innerHTML = "";
  const t = parseTest();
  if (t.error) { host.innerHTML = `<div class="callout bad">This isn't valid JSON yet: ${esc(t.error)}</div>`; $("#dlFilledBtn").disabled = true; return; }
  $("#dlFilledBtn").disabled = false;
  const { rep } = fillAllTexts(t.data);
  const missing = [...rep.missing].filter(k => !/\.\d+(\.|$)/.test(k)).sort();
  const roots = existingRootsPlaced();
  const unused = Object.keys(t.data).filter(k => !roots.has(k));
  const line = (cls, html) => host.appendChild(el("div", {}, `<span class="dot ${cls}"></span>${html}`));
  line("ok", `${rep.replaced.size} placeholder${rep.replaced.size === 1 ? "" : "s"} filled`);
  line(missing.length ? "warn" : "ok", missing.length ? `Missing (left blank): <code>${missing.map(esc).join("</code>, <code>")}</code>` : "Nothing missing");
  if (unused.length) line("warn", `Not in the template: <code>${unused.map(esc).join("</code>, <code>")}</code>`);
}
function renderCodePage() {
  const host = $("#codePage");
  const m = S.model;
  host.innerHTML = `
    <header><h2>Get code</h2><p>Three things to paste into Dify. They update whenever you change the template.</p></header>
    <section class="step"><div class="step-h"><span class="num">1</span><h2>LLM node · system prompt</h2><span class="spacer"></span>
      <button class="btn small" type="button" data-copy="prompt">Copy prompt</button>
      <p>Asks the LLM for exactly the JSON this template needs. In a Workflow, replace <code>{{#sys.query#}}</code> with your Start variable.</p></div>
      <div class="step-body"><label class="lbl" for="promptExtra">Extra instructions (optional)</label>
      <textarea class="inp" id="promptExtra" rows="2" placeholder="e.g. Write for the Audit Committee. Use British spelling."></textarea>
      <pre class="code" id="promptOut" style="white-space:pre-wrap"></pre></div></section>
    <hr>
    <section class="step"><div class="step-h"><span class="num">2</span><h2>The JSON the LLM returns</h2><span class="spacer"></span>
      <div class="seg small" role="group" aria-label="JSON view"><button type="button" id="jsonEx" aria-pressed="${S.jsonView !== "schema"}">Example</button><button type="button" id="jsonSc" aria-pressed="${S.jsonView === "schema"}">JSON Schema</button></div>
      <button class="btn small" type="button" data-copy="json">Copy</button>
      <p>Use the schema for the LLM node's structured output, if your model supports it.</p></div>
      <div class="step-body"><pre class="code" id="jsonOut"></pre></div></section>
    <hr>
    <section class="step"><div class="step-h"><span class="num">3</span><h2>Code node · Python 3</h2><span class="spacer"></span>
      <button class="btn small primary" type="button" data-copy="python">Copy code</button>
      <p>Standard library only. The template is built into the code, so copy it again after you change the template.</p></div>
      <div class="step-body"><div class="io-wrap"><table class="io"><thead><tr><th>Variable</th><th>Type</th><th>Set to</th></tr></thead><tbody>
        <tr><td class="mono">content_json</td><td>String</td><td>Input: the LLM node's <code>text</code></td></tr>
        <tr><td class="mono">pptx_base64</td><td>String</td><td>Output: the finished .pptx, base64</td></tr>
        <tr><td class="mono">file_name</td><td>String</td><td>Output</td></tr>
        <tr><td class="mono">status</td><td>String</td><td>Output: success or error</td></tr>
        <tr><td class="mono">message</td><td>String</td><td>Output: blank fields or the error</td></tr></tbody></table></div>
        <span class="hint">On a laptop: <code>python fill_pptx.py content.json report.pptx</code>. On a computer with no installs allowed, use <code>pptx_kit.py</code> with the kit's <code>fields.json</code>.</span>
        <span class="hint mono" id="pyMeta">Building…</span>
        <pre class="code" id="pyOut"></pre></div></section>
    <hr>
    <div class="row"><button class="btn primary" type="button" id="kitBtn2">Download kit</button><span class="hint">Code, template, prompt, JSON, schema and fields.json in one zip.</span></div>`;
  $("#promptExtra").value = S.project.prompt_extra || "";
  $("#promptOut").textContent = buildPrompt(m);
  const showJson = () => { $("#jsonOut").textContent = JSON.stringify(S.jsonView === "schema" ? buildSchema(m) : buildExample(m), null, 2); };
  showJson();
  $("#jsonEx").addEventListener("click", () => { S.jsonView = "example"; $("#jsonEx").setAttribute("aria-pressed", true); $("#jsonSc").setAttribute("aria-pressed", false); showJson(); });
  $("#jsonSc").addEventListener("click", () => { S.jsonView = "schema"; $("#jsonSc").setAttribute("aria-pressed", true); $("#jsonEx").setAttribute("aria-pressed", false); showJson(); });
  $("#promptExtra").addEventListener("input", e => { S.project.prompt_extra = e.target.value; $("#promptOut").textContent = buildPrompt(S.model); save(); renderPython(); });
  $("#kitBtn2").addEventListener("click", downloadKit);
  host.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.copy;
    if (k === "prompt") copyText($("#promptOut").textContent, $("#promptOut"));
    if (k === "json") copyText($("#jsonOut").textContent, $("#jsonOut"));
    if (k === "python") {
      if (!S.py.code || S.py.version !== S.templateVersion || S.py.forProject !== JSON.stringify(projectForCode())) { toast("Still building the code. Try again in a moment."); renderPython(); return; }
      copyText(S.py.code, null);
    }
  }));
  renderPython();
}
const renderPython = debounce(async () => {
  try {
    const code = await buildPython(S.model);
    S.py.code = code; S.py.forProject = JSON.stringify(projectForCode());
    const out = $("#pyOut"); if (!out) return;
    out.textContent = displayPython(code);
    const kb = (new Blob([code]).size / 1024).toFixed(1);
    $("#pyMeta").textContent = `fill_pptx.py · ${kb} KB${kb > 400 ? " · large: compress the images in your template" : ""}`;
  } catch (e) { const m = $("#pyMeta"); if (m) m.textContent = "Couldn't build the code: " + e.message; }
}, 150);

/* ---------------------------------------------------------------- views + refresh */
function setView(v) {
  S.view = v;
  $$("[data-view]").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  $("#app").className = "app" + (v === "code" ? " code" : "");
  $("#nav").hidden = v === "code";
  $("#canvas").hidden = v === "code";
  $("#panel").hidden = v === "code";
  $("#codePage").hidden = v !== "code";
  $("#blocks").style.visibility = v === "design" ? "visible" : "hidden";
  try { localStorage.setItem(STORE_KEY + ":view", v); } catch (e) { /* ignore */ }
  renderView();
}
function renderView() {
  if (S.view === "design") { renderCanvas(); renderPanel(); }
  else if (S.view === "test") { renderPanel(); renderTestPanel(); renderCanvas(); }
  else renderCodePage();
  $("#undoBtn").disabled = !S.undo.length;
}
function refresh() {
  indexStructure();
  if (S.cur >= S.slides.length) S.cur = Math.max(0, S.slides.length - 1);
  S.model = buildModel();
  if (!S.project.settings.file_name_field) {
    const t = S.model.entries.find(e => e.kind === "field" && /title/i.test(e.name));
    if (t) S.project.settings.file_name_field = t.path;
  }
  const placed = existingRootsPlaced();
  S.project.pending = (S.project.pending || []).filter(p => !placed.has(p));
  if (!S.testEdited) S.testText = JSON.stringify(buildExample(S.model), null, 2);
  renderView();
  save();
}

/* ---------------------------------------------------------------- persistence + files */
const save = debounce(async () => {
  try {
    const b64 = await templateB64();
    localStorage.setItem(STORE_KEY, JSON.stringify({ b64, project: S.project, testText: S.testText, testEdited: S.testEdited, cur: S.cur }));
  } catch (e) { /* storage unavailable or full; the kit download is the durable copy */ }
}, 700);
function restore() {
  for (const k of [STORE_KEY, "template-studio:v1"]) {
    try { const raw = localStorage.getItem(k); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
  }
  return null;
}
function normaliseProject(p, fallbackName) {
  p = p ? clone(p) : {};
  p.name = p.name || fallbackName || "New template";
  p.settings = Object.assign({ file_name_field: "", colour_rules: [] }, p.settings || {});
  p.settings.colour_rules = (p.settings.colour_rules || []).map(r => ({ match: r.match || "", fill: String(r.fill || "FFFFFF").replace("#", "").toUpperCase(), text: String(r.text || "000000").replace("#", "").toUpperCase() }));
  p.fields = p.fields || {};
  p.prompt_extra = p.prompt_extra || "";
  p.pending = p.pending || [];
  delete p._help; delete p._unused_fields;
  return p;
}
async function openProject(bytes, project, testText, testEdited, cur) {
  await loadTemplateBytes(bytes);
  S.project = normaliseProject(project);
  S.testText = testText || ""; S.testEdited = !!testEdited;
  S.undo = []; S.selObj = null; S.selCell = null; S.selField = null; S.cur = Math.min(cur || 0, Math.max(0, S.slides.length - 1));
  S.templateVersion++; S.py = { version: -1, b64: "", code: "" };
  $("#projName").value = S.project.name;
  S.model = buildModel();
  if (!S.testText) S.testText = JSON.stringify(buildExample(S.model), null, 2);
  refresh();
}
const loadSample = () => openProject(b64ToBytes(SAMPLE_B64), SAMPLE_PROJECT, JSON.stringify(SAMPLE_TEST, null, 2), true);
const loadBlank = () => openProject(b64ToBytes(BLANK_B64), { name: "New template", settings: { file_name_field: "", colour_rules: [] }, fields: {} }, "", false);
async function openFile(file) {
  const name = file.name.replace(/\.[^.]+$/, "");
  try {
    if (/\.pptx$/i.test(file.name)) {
      await openProject(new Uint8Array(await file.arrayBuffer()), { name: humanize(name), settings: { file_name_field: "", colour_rules: [] }, fields: {} }, "", false);
      const t = S.model.entries.find(e => e.kind === "field" && /title/i.test(e.name));
      if (t) S.project.settings.file_name_field = t.path;
      setView("design");
      toast(`Opened ${file.name}. ${S.model.entries.length ? "Its {{fields}} are listed on the left." : "Drag fields onto its text boxes to start."}`);
    } else {
      const code = await file.text();
      const pm = code.match(/^PROJECT = json\.loads\((".*")\)\s*$/m);
      const tm = code.match(/^TEMPLATE_B64 = \(\n([\s\S]*?)\n\)/m);
      if (!pm || !tm) throw new Error("This .py file wasn't made by Template Studio.");
      await openProject(b64ToBytes([...tm[1].matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join("")), JSON.parse(JSON.parse(pm[1])), "", false);
      setView("design");
      toast(`Opened ${file.name} with its field settings.`);
    }
  } catch (e) { toast(e.message || "Couldn't open that file."); }
}
async function downloadKit() {
  const kit = new MiniZip.Zip();
  const code = await buildPython(S.model);
  const folder = safeName(S.project.name);
  kit.set(`${folder}/fill_pptx.py`, code);
  kit.set(`${folder}/template.pptx`, await S.zip.generate());
  kit.set(`${folder}/example_body.json`, JSON.stringify(buildExample(S.model), null, 2));
  kit.set(`${folder}/json_schema.json`, JSON.stringify(buildSchema(S.model), null, 2));
  kit.set(`${folder}/llm_prompt.txt`, buildPrompt(S.model));
  kit.set(`${folder}/fields.json`, JSON.stringify(projectForCode(), null, 2));
  kit.set(`${folder}/README.txt`, [
    `${S.project.name} - made with Template Studio`, "",
    "fill_pptx.py      Paste into a Dify Code node (Python 3), or run: python fill_pptx.py example_body.json out.pptx",
    "                  Input: content_json (String). Outputs: pptx_base64, file_name, status, message (all String).",
    "llm_prompt.txt    System prompt for the Dify LLM node.",
    "json_schema.json  Structured-output schema for the LLM node (optional).",
    "example_body.json Example of the JSON the LLM should return.",
    "template.pptx     The template (also embedded in fill_pptx.py).",
    "fields.json       Field settings. Works with pptx_kit.py: python pptx_kit.py watch template.pptx",
    "", "To keep editing: open template.pptx or fill_pptx.py in Template Studio.",
  ].join("\r\n"));
  saveFile(`${folder}_kit.zip`, new Blob([await kit.generate()]));
}

/* ---------------------------------------------------------------- wiring */
function confirmReplace(msg, onYes) {
  $("#confirmMsg").textContent = msg; $("#confirmBar").hidden = false;
  const done = () => { $("#confirmBar").hidden = true; };
  $("#confirmYes").onclick = () => { done(); onYes(); };
  $("#confirmNo").onclick = done;
}
function undo() {
  const step = S.undo.pop(); if (!step) return;
  for (const [part, xml] of Object.entries(step)) setPart(part, xml);
  S.selCell = null;
  refresh(); toast("Undone");
}
function wire() {
  renderBlocks();
  wireCanvasDrop();
  $("#slideHost").addEventListener("pointerdown", onPointerDown);
  $("#slideHost").addEventListener("dblclick", () => { const t = $("#inspText"); if (t) { t.focus(); t.select(); } });
  $$("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  $$("[data-rtab]").forEach(b => b.addEventListener("click", () => { S.rtab = b.dataset.rtab; renderPanel(); }));
  $("#undoBtn").addEventListener("click", undo);
  $("#projName").addEventListener("input", e => { S.project.name = e.target.value; save(); });
  const menu = $("#openMenu"), mb = $("#openMenuBtn");
  mb.addEventListener("click", () => { menu.hidden = !menu.hidden; mb.setAttribute("aria-expanded", !menu.hidden); });
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) { menu.hidden = true; mb.setAttribute("aria-expanded", "false"); } });
  menu.addEventListener("click", e => {
    const k = e.target.closest("[data-open]")?.dataset.open; if (!k) return;
    menu.hidden = true;
    if (k === "file") return $("#fileInput").click();
    confirmReplace(k === "blank" ? "Start a new blank template? The current one will be replaced." : "Replace the current template with the audit sample?",
      () => (k === "blank" ? loadBlank() : loadSample()).then(() => { setView("design"); toast(k === "blank" ? "Blank slide ready. Drag a block onto it." : "Audit sample loaded."); }));
  });
  $("#fileInput").addEventListener("change", e => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
  $("#kitBtn").addEventListener("click", downloadKit);
  $("#newFieldBtn").addEventListener("click", () => {
    const v = $("#newField").value.trim();
    if (!KEY_RE.test(v)) { toast("Use letters, numbers and _ only, starting with a letter."); return; }
    if (existingRoots().has(v)) { toast(`${v} already exists.`); return; }
    S.project.pending = [...(S.project.pending || []), v];
    $("#newField").value = ""; renderFieldList(); save();
    toast(`Now drag ${v} onto a text box.`);
  });
  $("#newField").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#newFieldBtn").click(); } });
  const onTest = debounce(() => { renderTestPanel(); renderCanvas(); save(); }, 300);
  $("#testJson").addEventListener("input", e => { S.testText = e.target.value; S.testEdited = true; onTest(); });
  $("#resetTestBtn").addEventListener("click", () => { S.testEdited = false; S.testText = JSON.stringify(buildExample(S.model), null, 2); $("#testJson").value = S.testText; renderTestPanel(); renderCanvas(); save(); });
  $("#dlFilledBtn").addEventListener("click", async () => {
    const t = parseTest(); if (t.error) return;
    const f = S.project.settings.file_name_field;
    const [found, v] = f ? Engine.walk(t.data, f) : [false, null];
    saveFile(`${safeName(found ? Engine.toText(v) : S.project.name)}.pptx`, await filledBlob(t.data));
  });
  document.addEventListener("keydown", e => {
    const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); return; }
    if (typing || S.view !== "design" || S.selObj === null) return;
    const step = e.shiftKey ? GRID * 10 : GRID;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteObj(); }
    else if (e.key === "Escape") { S.selObj = null; S.selCell = null; drawOverlay(); renderPanel(); }
    else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateObj(); }
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
    }
  });
  window.addEventListener("resize", debounce(() => { if (S.view !== "code") drawOverlay(); }, 100));
}
async function boot() {
  wire();
  const saved = restore();
  try {
    if (saved?.b64) await openProject(b64ToBytes(saved.b64), saved.project, saved.testText, saved.testEdited, saved.cur);
    else await loadSample();
  } catch (e) { await loadSample(); }
  let v = "design";
  try { v = localStorage.getItem(STORE_KEY + ":view") || "design"; } catch (e) { /* ignore */ }
  setView(["design", "test", "code"].includes(v) ? v : "design");
  window.__studio = { S, insertBlock, placeField, tableOp, addBlankSlide, deleteSlide, duplicateSlide, setView, buildPython, buildExample, buildSchema, buildPrompt, filledBytes, openFile, renameKey, refresh, undo };
}
if (MiniZip.supported()) boot();
else $("#slideHost").innerHTML = '<div class="callout">This browser is too old to open .pptx files. Use a current Chrome, Edge, Safari or Firefox.</div>';
