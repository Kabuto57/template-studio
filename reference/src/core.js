/* ====================================================================== helpers */
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const kids = (el, name) => el ? [...el.children].filter(c => c.localName === name) : [];
const kid = (el, name) => el ? ([...el.children].find(c => c.localName === name) || null) : null;
const dig = (el, ...names) => names.reduce((e, n) => kid(e, n), el);
const parseXml = s => new DOMParser().parseFromString(s, "application/xml");
const serializeXml = doc => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
const num = (v, d = 0) => (v === null || v === undefined || v === "" || isNaN(+v)) ? d : +v;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const humanize = k => { const s = String(k).replace(/[_\-.]+/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : k; };
const clone = o => JSON.parse(JSON.stringify(o));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function bytesToB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/"); parts.pop();
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ====================================================================== state */
const S = {
  zip: null, texts: {}, media: {}, W: 12192000, H: 6858000,
  slides: [], theme: {}, fonts: {}, defaultTextStyle: null,
  project: null, testText: "", testEdited: false,
  mode: "template", tab: "fields", jsonView: "example",
  sel: null, undo: [], templateVersion: 0,
  model: null, py: { version: -1, b64: "", code: "" },
};

/* ====================================================================== template loading */
function relsOf(part) {
  const relPath = part.replace(/([^/]+)$/, "_rels/$1.rels");
  const out = {};
  const txt = S.texts[relPath];
  if (!txt) return out;
  for (const r of parseXml(txt).documentElement.children) {
    const target = r.getAttribute("Target") || "";
    out[r.getAttribute("Id")] = {
      type: (r.getAttribute("Type") || "").split("/").pop(),
      target: r.getAttribute("TargetMode") === "External" ? null : resolvePath(part, target),
    };
  }
  return out;
}
const relByType = (part, type) => Object.values(relsOf(part)).find(r => r.type === type)?.target || null;

async function loadTemplateBytes(bytes) {
  const zip = await MiniZip.Zip.load(bytes);
  const texts = {};
  for (const name of zip.names()) {
    if (!name.endsWith("/") && /\.(xml|rels)$/i.test(name)) texts[name] = await zip.text(name);
  }
  if (!texts["ppt/presentation.xml"]) throw new Error("This file isn't a PowerPoint presentation (.pptx).");
  for (const u of Object.values(S.media)) URL.revokeObjectURL(u);
  const media = {};
  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", webp: "image/webp" };
  for (const name of zip.names()) {
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (/^ppt\/media\//.test(name) && MIME[ext]) {
      try { media[name] = URL.createObjectURL(new Blob([await zip.bytes(name)], { type: MIME[ext] })); } catch (e) { /* skip unreadable image */ }
    }
  }
  S.zip = zip; S.texts = texts; S.media = media;
  indexStructure();
}

function indexStructure() {
  const pres = parseXml(S.texts["ppt/presentation.xml"]).documentElement;
  const sz = kid(pres, "sldSz");
  S.W = num(sz?.getAttribute("cx"), 12192000); S.H = num(sz?.getAttribute("cy"), 6858000);
  S.defaultTextStyle = kid(pres, "defaultTextStyle");
  const prels = relsOf("ppt/presentation.xml");
  S.slides = kids(kid(pres, "sldIdLst"), "sldId").map(s => {
    const path = prels[s.getAttributeNS(R_NS, "id") || s.getAttribute("r:id")]?.target;
    if (!path || !S.texts[path]) return null;
    const layout = relByType(path, "slideLayout");
    const master = layout ? relByType(layout, "slideMaster") : null;
    return { path, notes: relByType(path, "notesSlide"), layout, master };
  }).filter(Boolean);
  const master = S.slides[0]?.master;
  const themePath = master ? relByType(master, "theme") : null;
  S.theme = {}; S.fonts = {};
  if (themePath && S.texts[themePath]) {
    const th = parseXml(S.texts[themePath]).documentElement;
    const scheme = th.getElementsByTagNameNS(A_NS, "clrScheme")[0];
    for (const c of scheme ? scheme.children : []) {
      const v = c.firstElementChild;
      S.theme[c.localName] = v ? (v.getAttribute("lastClr") || v.getAttribute("val") || "000000") : "000000";
    }
    const fs = th.getElementsByTagNameNS(A_NS, "fontScheme")[0];
    S.fonts.major = dig(fs, "majorFont", "latin")?.getAttribute("typeface") || "Calibri Light";
    S.fonts.minor = dig(fs, "minorFont", "latin")?.getAttribute("typeface") || "Calibri";
  }
}

/* ====================================================================== colours */
const PRESET = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080" };
function hexToRgb(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
function colorOf(el, clrMap) {
  if (!el) return null;
  let hex = null;
  const n = el.localName;
  if (n === "srgbClr") hex = el.getAttribute("val");
  else if (n === "sysClr") hex = el.getAttribute("lastClr") || "000000";
  else if (n === "prstClr") hex = PRESET[el.getAttribute("val")] || "000000";
  else if (n === "schemeClr") {
    let v = el.getAttribute("val");
    const map = clrMap || { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
    if (map[v]) v = map[v];
    hex = S.theme[v] || ({ lt1: "FFFFFF", dk1: "000000" }[v]) || "000000";
  } else return null;
  let rgb = hexToRgb(hex.padStart(6, "0")), alpha = 1;
  for (const m of el.children) {
    const v = num(m.getAttribute("val")) / 100000;
    if (m.localName === "alpha") alpha = v;
    if (m.localName === "lumMod" || m.localName === "lumOff") {
      const hsl = rgbToHsl(rgb);
      hsl[2] = m.localName === "lumMod" ? hsl[2] * v : Math.min(1, hsl[2] + v);
      rgb = hslToRgb(hsl);
    }
    if (m.localName === "tint") rgb = rgb.map(c => Math.round(c + (255 - c) * (1 - v)));
    if (m.localName === "shade") rgb = rgb.map(c => Math.round(c * v));
  }
  return `rgba(${rgb.join(",")},${alpha})`;
}
function fillOf(parent, clrMap) {
  if (!parent) return undefined;
  const nf = kid(parent, "noFill"); if (nf) return null;
  const sf = kid(parent, "solidFill"); if (sf) return colorOf(sf.firstElementChild, clrMap);
  const gf = kid(parent, "gradFill");
  if (gf) { const gs = gf.getElementsByTagNameNS(A_NS, "gs")[0]; return gs ? colorOf(gs.firstElementChild, clrMap) : undefined; }
  return undefined;
}

/* ====================================================================== text styles */
function readPPr(p) {
  const o = {};
  if (!p) return o;
  const g = a => p.getAttribute(a);
  if (g("algn")) o.algn = g("algn");
  if (g("marL") !== null) o.marL = num(g("marL"));
  if (g("indent") !== null) o.indent = num(g("indent"));
  for (const c of p.children) {
    const n = c.localName;
    if (n === "buNone") o.bullet = null;
    if (n === "buChar") o.bullet = { char: c.getAttribute("char") || "•" };
    if (n === "buAutoNum") o.bullet = { auto: c.getAttribute("type") || "arabicPeriod", start: num(c.getAttribute("startAt"), 1) };
    if (n === "spcBef" || n === "spcAft") {
      const pts = kid(c, "spcPts"); if (pts) o[n] = num(pts.getAttribute("val")) / 100;
    }
    if (n === "lnSpc") { const pct = kid(c, "spcPct"); if (pct) o.lnSpc = num(pct.getAttribute("val")) / 100000; }
    if (n === "defRPr") Object.assign(o, readRPr(c, "def"));
  }
  return o;
}
function readRPr(r, prefix = "") {
  const o = {};
  if (!r) return o;
  const put = (k, v) => { o[prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k] = v; };
  if (r.getAttribute("sz")) put("sz", num(r.getAttribute("sz")) / 100);
  if (r.getAttribute("b") !== null) put("b", r.getAttribute("b") === "1" || r.getAttribute("b") === "true");
  if (r.getAttribute("i") !== null) put("i", r.getAttribute("i") === "1" || r.getAttribute("i") === "true");
  if (r.getAttribute("u") && r.getAttribute("u") !== "none") put("u", true);
  if (r.getAttribute("cap") === "all") put("caps", true);
  if (r.getAttribute("spc")) put("spc", num(r.getAttribute("spc")) / 100);
  const sf = kid(r, "solidFill"); if (sf) put("colorEl", sf.firstElementChild);
  const lt = kid(r, "latin"); if (lt) put("font", lt.getAttribute("typeface"));
  return o;
}
// Ordered list of list-style elements (lowest priority first) for a shape.
function styleChain(ctx, sp, phInfo) {
  const chain = [];
  if (S.defaultTextStyle) chain.push(S.defaultTextStyle);
  if (phInfo) {
    const tx = ctx.masterDoc ? dig(ctx.masterDoc.documentElement, "txStyles") : null;
    const t = phInfo.type;
    const which = (t === "title" || t === "ctrTitle") ? "titleStyle" : (["dt", "ftr", "sldNum"].includes(t) ? "otherStyle" : "bodyStyle");
    if (tx && kid(tx, which)) chain.push(kid(tx, which));
    for (const inh of [phInfo.masterSp, phInfo.layoutSp]) {
      const ls = inh ? dig(inh, "txBody", "lstStyle") : null; if (ls) chain.push(ls);
    }
  }
  const own = dig(sp, "txBody", "lstStyle"); if (own) chain.push(own);
  return chain;
}
function levelProps(chain, lvl) {
  const o = {};
  for (const st of chain) Object.assign(o, readPPr(kid(st, `lvl${lvl + 1}pPr`)));
  return o;
}

/* ====================================================================== rendering */
const u = emu => `${(emu / S.W * 100).toFixed(4)}cqw`;
const pt = p => `${(p * 12700 / S.W * 100).toFixed(4)}cqw`;
const FALLBACK = ', "Calibri", "Carlito", "Segoe UI", Arial, sans-serif';
function fontStack(f) {
  if (!f) return null;
  if (f === "+mj-lt") f = S.fonts.major; else if (f === "+mn-lt") f = S.fonts.minor;
  return f ? `"${f}"${FALLBACK}` : null;
}
function xfrmOf(el) {
  const x = kid(el, "xfrm"); if (!x) return null;
  const off = kid(x, "off"), ext = kid(x, "ext");
  if (!off || !ext) return null;
  return {
    x: num(off.getAttribute("x")), y: num(off.getAttribute("y")),
    cx: num(ext.getAttribute("cx")), cy: num(ext.getAttribute("cy")),
    rot: num(x.getAttribute("rot")) / 60000, flipH: x.getAttribute("flipH") === "1", flipV: x.getAttribute("flipV") === "1",
    chOff: kid(x, "chOff"), chExt: kid(x, "chExt"),
  };
}
function applyTf(tf, b) {
  return { ...b, x: tf.dx + b.x * tf.sx, y: tf.dy + b.y * tf.sy, cx: b.cx * tf.sx, cy: b.cy * tf.sy };
}
function placeBox(div, b) {
  div.style.left = u(b.x); div.style.top = u(b.y); div.style.width = u(b.cx); div.style.height = u(b.cy);
  if (b.rot) div.style.transform = `rotate(${b.rot}deg)`;
}
function phOf(sp) {
  const ph = dig(sp, "nvSpPr", "nvPr", "ph") || dig(sp, "nvPicPr", "nvPr", "ph") || dig(sp, "nvGraphicFramePr", "nvPr", "ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") };
}
function findPh(doc, info) {
  if (!doc) return null;
  const sps = [...doc.getElementsByTagName("*")].filter(e => e.localName === "sp" && phOf(e));
  const byIdx = info.idx !== null ? sps.find(s => phOf(s).idx === info.idx) : null;
  if (byIdx) return byIdx;
  const t = info.type === "ctrTitle" ? ["ctrTitle", "title"] : info.type === "subTitle" ? ["subTitle", "body"] : [info.type];
  for (const tt of t) { const m = sps.find(s => phOf(s).type === tt); if (m) return m; }
  return null;
}

// Short, readable label for a {{placeholder}} shown in the editor (the template keeps the real text).
function tokenLabel(raw) {
  const k = raw.replace(/^\{\{\s*|\s*\}\}$/g, "");
  let m = k.match(/^count:(.+?)(?:\.([^.=]+)=(.+))?$/);
  if (m) return m[3] ? `# ${m[3]}` : `# ${m[1].split(".").pop()}`;
  m = k.match(/^(.+?)\.\d+(?:\.(.+))?$/);
  if (m) return m[2] || m[1].split(".").pop();
  return k;
}
function renderParagraphs(txBody, chain, ctx, highlight) {
  const box = document.createElement("div");
  box.className = "txt";
  const bodyPr = kid(txBody, "bodyPr");
  const ins = k => num(bodyPr?.getAttribute(k), k[0] === "l" || k[0] === "r" ? 91440 : 45720);
  box.style.padding = `${u(ins("tIns"))} ${u(ins("rIns"))} ${u(ins("bIns"))} ${u(ins("lIns"))}`;
  const anchor = bodyPr?.getAttribute("anchor") || ctx.anchor || "t";
  box.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
  const scale = num(dig(bodyPr, "normAutofit")?.getAttribute("fontScale"), 100000) / 100000;
  if (bodyPr?.getAttribute("wrap") === "none") box.style.whiteSpace = "nowrap";
  let autoCounter = {};
  for (const p of kids(txBody, "p")) {
    const pPr = kid(p, "pPr");
    const lvl = num(pPr?.getAttribute("lvl"), 0);
    const props = Object.assign({}, levelProps(chain, lvl), readPPr(pPr));
    const d = document.createElement("div");
    d.className = "para";
    d.style.textAlign = { ctr: "center", r: "right", just: "justify", dist: "justify" }[props.algn] || "left";
    const lh = props.lnSpc ? props.lnSpc * 1.2 : 1.2;
    d.style.lineHeight = String(lh);
    if (props.spcBef) d.style.marginTop = pt(props.spcBef);
    if (props.spcAft) d.style.marginBottom = pt(props.spcAft);
    const marL = props.marL || 0, indent = props.indent || 0;
    d.style.paddingLeft = u(marL);
    const defaults = {
      sz: (props.defSz || ctx.defSz || 18), b: props.defB ?? false, i: props.defI ?? false,
      colorEl: props.defColorEl || null, font: props.defFont || null, caps: props.defCaps, spc: props.defSpc,
    };
    // runs
    const segs = [];
    for (const c of p.children) {
      if (c.localName === "r" || c.localName === "fld") {
        const r = Object.assign({}, defaults, readRPr(kid(c, "rPr")));
        const t = [...c.children].filter(e => e.localName === "t").map(e => e.textContent).join("");
        segs.push({ text: t, st: r });
      } else if (c.localName === "br") segs.push({ br: true, st: Object.assign({}, defaults, readRPr(kid(c, "rPr"))) });
    }
    const endSt = Object.assign({}, defaults, readRPr(kid(p, "endParaRPr")));
    const firstSt = segs[0]?.st || endSt;
    const styleSpan = (span, st) => {
      span.style.fontSize = `calc(var(--fit, 1) * ${pt(st.sz * scale)})`;
      if (st.b) span.style.fontWeight = "700";
      if (st.i) span.style.fontStyle = "italic";
      if (st.u) span.style.textDecoration = "underline";
      if (st.caps) span.style.textTransform = "uppercase";
      if (st.spc) span.style.letterSpacing = pt(st.spc);
      const col = st.colorEl ? colorOf(st.colorEl, ctx.clrMap) : ctx.textColor;
      if (col) span.style.color = col;
      const f = fontStack(st.font) || ctx.font;
      if (f) span.style.fontFamily = f;
    };
    // bullet
    const hasText = segs.some(s => s.text);
    if (props.bullet && hasText) {
      const b = document.createElement("span");
      styleSpan(b, firstSt);
      b.style.display = "inline-block";
      const w = Math.max(-indent, 228600);
      b.style.width = u(w); b.style.marginLeft = indent < 0 ? u(indent) : "0";
      if (props.bullet.char) b.textContent = props.bullet.char;
      else {
        const key = lvl; autoCounter[key] = (autoCounter[key] ?? props.bullet.start - 1) + 1;
        const nn = autoCounter[key]; const tp = props.bullet.auto;
        b.textContent = (/alphaLc/.test(tp) ? String.fromCharCode(96 + nn) : /alphaUc/.test(tp) ? String.fromCharCode(64 + nn) : nn) + (/Paren/.test(tp) ? ")" : ".");
      }
      d.appendChild(b);
    } else if (!props.bullet || !props.bullet.auto) { autoCounter = {}; d.style.textIndent = indent ? u(indent) : ""; }
    // highlight ranges for {{placeholders}}
    const full = segs.map(s => s.br ? "\n" : s.text).join("");
    const ranges = highlight ? [...full.matchAll(Engine.PH())].map(m => [m.index, m.index + m[0].length]) : [];
    let pos = 0;
    for (const s of segs) {
      if (s.br) { d.appendChild(document.createElement("br")); pos += 1; continue; }
      const span = document.createElement("span"); styleSpan(span, s.st);
      let i = 0; const t = s.text;
      const cuts = new Set([0, t.length]);
      for (const [a, b] of ranges) { if (a > pos && a < pos + t.length) cuts.add(a - pos); if (b > pos && b < pos + t.length) cuts.add(b - pos); }
      const cs = [...cuts].sort((x, y) => x - y);
      for (let k = 0; k < cs.length - 1; k++) {
        const piece = t.slice(cs[k], cs[k + 1]); const abs = pos + cs[k];
        const hitRange = ranges.find(([a, b]) => abs >= a && abs < b);
        if (hitRange) {
          const m = document.createElement("span"); m.className = "ph";
          const whole = hitRange[0] === abs && hitRange[1] === abs + piece.length;
          m.textContent = whole ? tokenLabel(piece) : piece;
          if (whole) m.title = piece;
          span.appendChild(m);
        }
        else span.appendChild(document.createTextNode(piece));
      }
      i = t.length; pos += i;
      d.appendChild(span);
    }
    if (!hasText) { const sp = document.createElement("span"); styleSpan(sp, endSt); sp.textContent = " "; d.appendChild(sp); }
    box.appendChild(d);
  }
  return box;
}

function renderSpTree(tree, ctx, out, tf, layer) {
  for (const el of tree.children) {
    const n = el.localName;
    const oi = ctx.objIndex?.get(el);
    if (oi !== undefined) ctx = { ...ctx, curObj: oi };
    if (n === "sp") renderSp(el, ctx, out, tf, layer);
    else if (n === "pic") renderPic(el, ctx, out, tf, layer);
    else if (n === "cxnSp") renderLine(el, ctx, out, tf, kid(el, "spPr"));
    else if (n === "graphicFrame") renderFrame(el, ctx, out, tf, layer);
    else if (n === "grpSp") {
      const g = xfrmOf(kid(el, "grpSpPr"));
      let inner = tf;
      if (g && g.chOff && g.chExt) {
        const cx = num(g.chExt.getAttribute("cx"), 1) || 1, cy = num(g.chExt.getAttribute("cy"), 1) || 1;
        const sx = g.cx / cx, sy = g.cy / cy;
        const dx = g.x - num(g.chOff.getAttribute("x")) * sx, dy = g.y - num(g.chOff.getAttribute("y")) * sy;
        inner = { sx: tf.sx * sx, sy: tf.sy * sy, dx: tf.dx + dx * tf.sx, dy: tf.dy + dy * tf.sy };
      }
      renderSpTree(el, ctx, out, inner, layer);
    }
  }
}
function renderLine(el, ctx, out, tf, spPr) {
  const b0 = xfrmOf(spPr); if (!b0) return;
  const b = applyTf(tf, b0);
  const ln = kid(spPr, "ln");
  const col = fillOf(ln, ctx.clrMap) || "rgba(0,0,0,1)";
  if (fillOf(ln, ctx.clrMap) === null) return;
  const w = num(ln?.getAttribute("w"), 12700);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("shp"); svg.setAttribute("preserveAspectRatio", "none");
  if (ctx.curObj !== undefined) svg.dataset.obj = ctx.curObj;
  svg.setAttribute("viewBox", `0 0 ${Math.max(b.cx, 1)} ${Math.max(b.cy, 1)}`);
  svg.style.overflow = "visible";
  placeBox(svg, { ...b, cx: Math.max(b.cx, 1), cy: Math.max(b.cy, 1) });
  const line = document.createElementNS(svgNS, "line");
  const [x1, x2] = b.flipH ? [b.cx, 0] : [0, b.cx], [y1, y2] = b.flipV ? [b.cy, 0] : [0, b.cy];
  line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", col); line.setAttribute("vector-effect", "non-scaling-stroke");
  line.setAttribute("stroke-width", Math.max(1, w / 12700 * 1.33 * (ctx.pxPerPt || 1)));
  svg.appendChild(line); out.appendChild(svg);
}
function renderSp(sp, ctx, out, tf, layer) {
  const ph = phOf(sp);
  if (layer !== "slide" && ph) return; // layout/master placeholders are prompts, not content
  const spPr = kid(sp, "spPr");
  let phInfo = null;
  if (ph) {
    phInfo = { ...ph, layoutSp: findPh(ctx.layoutDoc, ph), masterSp: null };
    phInfo.masterSp = findPh(ctx.masterDoc, { type: ph.type, idx: null });
  }
  let b0 = xfrmOf(spPr);
  if (!b0 && phInfo) b0 = xfrmOf(kid(phInfo.layoutSp, "spPr")) || xfrmOf(kid(phInfo.masterSp, "spPr"));
  if (!b0) return;
  const geom = dig(spPr, "prstGeom")?.getAttribute("prst") || "rect";
  if (geom === "line" || geom === "straightConnector1") return renderLine(sp, ctx, out, tf, spPr);
  const b = applyTf(tf, b0);
  const div = document.createElement("div");
  div.className = "shp";
  if (ctx.curObj !== undefined) div.dataset.obj = ctx.curObj;
  placeBox(div, b);
  const style = kid(sp, "style");
  let fill = fillOf(spPr, ctx.clrMap);
  if (fill === undefined && style && num(kid(style, "fillRef")?.getAttribute("idx")) > 0) fill = colorOf(kid(style, "fillRef").firstElementChild, ctx.clrMap);
  if (fill) div.style.background = fill;
  const ln = kid(spPr, "ln");
  let lnCol = ln ? fillOf(ln, ctx.clrMap) : undefined;
  if (lnCol === undefined && style && num(kid(style, "lnRef")?.getAttribute("idx")) > 0 && !ln) lnCol = colorOf(kid(style, "lnRef").firstElementChild, ctx.clrMap);
  if (lnCol) div.style.border = `max(1px, ${u(num(ln?.getAttribute("w"), 9525))}) solid ${lnCol}`;
  if (geom === "ellipse") div.style.borderRadius = "50%";
  if (geom === "roundRect") {
    const adj = dig(spPr, "prstGeom", "avLst")?.firstElementChild?.getAttribute("fmla");
    const r = adj ? num(adj.replace(/\D/g, ""), 16667) / 100000 : .16667;
    div.style.borderRadius = u(Math.min(b.cx, b.cy) * r);
  }
  const txBody = kid(sp, "txBody");
  if (txBody && layer === "slide") {
    const t = phInfo?.type;
    const chain = styleChain(ctx, sp, phInfo);
    const anchorFrom = phInfo ? (dig(phInfo.layoutSp, "txBody", "bodyPr")?.getAttribute("anchor") || dig(phInfo.masterSp, "txBody", "bodyPr")?.getAttribute("anchor")) : null;
    const tctx = { ...ctx, defSz: (t === "title" || t === "ctrTitle") ? 40 : 18, anchor: anchorFrom || null };
    div.appendChild(renderParagraphs(txBody, chain, tctx, ctx.highlight));
    const idx = ctx.editIndex?.get(sp);
    if (idx !== undefined) { div.classList.add("hit"); div.dataset.edit = idx; }
  } else if (txBody) {
    div.appendChild(renderParagraphs(txBody, styleChain(ctx, sp, null), { ...ctx, defSz: 18 }, false));
  }
  out.appendChild(div);
}
function picUrl(el, ctx) {
  const blip = el.getElementsByTagNameNS(A_NS, "blip")[0];
  const rid = blip?.getAttributeNS(R_NS, "embed") || blip?.getAttribute("r:embed");
  const target = rid ? relsOf(ctx.part)[rid]?.target : null;
  return target ? S.media[target] : null;
}
function renderPic(el, ctx, out, tf, layer) {
  if (layer !== "slide" && phOf(el)) return;
  const b0 = xfrmOf(kid(el, "spPr")); if (!b0) return;
  const url = picUrl(el, ctx); if (!url) return;
  const img = document.createElement("img");
  img.className = "shp"; img.alt = ""; if (ctx.curObj !== undefined) img.dataset.obj = ctx.curObj; img.src = url; img.style.objectFit = "fill"; img.style.maxWidth = "none";
  placeBox(img, applyTf(tf, b0));
  out.appendChild(img);
}
function renderFrame(el, ctx, out, tf, layer) {
  const tbl = el.getElementsByTagNameNS(A_NS, "tbl")[0];
  const b0 = xfrmOf(el); if (!b0 || !tbl) return;
  const b = applyTf(tf, b0);
  const cols = kids(kid(tbl, "tblGrid"), "gridCol").map(c => num(c.getAttribute("w")));
  const table = document.createElement("table");
  if (ctx.curObj !== undefined) table.dataset.obj = ctx.curObj;
  table.style.left = u(b.x); table.style.top = u(b.y);
  const totalW = cols.reduce((a, c) => a + c, 0) || b.cx;
  table.style.width = u(totalW * tf.sx);
  const cg = document.createElement("colgroup");
  cols.forEach(w => { const c = document.createElement("col"); c.style.width = u(w * tf.sx); cg.appendChild(c); });
  table.appendChild(cg);
  const chain = [S.defaultTextStyle].filter(Boolean);
  for (const tr of kids(tbl, "tr")) {
    const row = document.createElement("tr");
    row.style.height = u(num(tr.getAttribute("h")) * tf.sy);
    for (const tc of kids(tr, "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      const td = document.createElement("td");
      if (tc.getAttribute("gridSpan")) td.colSpan = num(tc.getAttribute("gridSpan"), 1);
      if (tc.getAttribute("rowSpan")) td.rowSpan = num(tc.getAttribute("rowSpan"), 1);
      const tcPr = kid(tc, "tcPr");
      const f = fillOf(tcPr, ctx.clrMap); if (f) td.style.background = f;
      for (const [side, nm] of [["Left", "lnL"], ["Right", "lnR"], ["Top", "lnT"], ["Bottom", "lnB"]]) {
        const l = kid(tcPr, nm); const c = l ? fillOf(l, ctx.clrMap) : null;
        if (c) td.style["border" + side] = `max(1px, ${u(num(l.getAttribute("w"), 12700))}) solid ${c}`;
      }
      const inner = document.createElement("div");
      inner.style.position = "relative"; inner.style.height = "100%"; inner.style.minHeight = row.style.height;
      const txBody = kid(tc, "txBody");
      if (txBody) {
        const fake = { getAttribute: k => tcPr?.getAttribute({ lIns: "marL", rIns: "marR", tIns: "marT", bIns: "marB", anchor: "anchor" }[k] || "_") };
        const tb = renderParagraphs(txBody, chain, { ...ctx, defSz: 18, anchor: tcPr?.getAttribute("anchor") || "t" }, ctx.highlight);
        tb.style.position = "relative"; tb.style.minHeight = row.style.height;
        tb.style.padding = `${u(num(fake.getAttribute("tIns"), 45720))} ${u(num(fake.getAttribute("rIns"), 91440))} ${u(num(fake.getAttribute("bIns"), 45720))} ${u(num(fake.getAttribute("lIns"), 91440))}`;
        inner.appendChild(tb);
      }
      td.appendChild(inner);
      const idx = ctx.editIndex?.get(tc);
      if (idx !== undefined && layer === "slide") { td.classList.add("hit"); td.dataset.edit = idx; }
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  out.appendChild(table);
}
function bgOf(doc, part, ctx) {
  const bg = doc ? dig(doc.documentElement, "cSld", "bg") : null;
  if (!bg) return undefined;
  const bgPr = kid(bg, "bgPr");
  if (bgPr) {
    const blip = kid(bgPr, "blipFill");
    if (blip) { const url = picUrl(blip, { ...ctx, part }); if (url) return { img: url }; }
    const f = fillOf(bgPr, ctx.clrMap); if (f) return { color: f };
  }
  const ref = kid(bg, "bgRef");
  if (ref && ref.firstElementChild) return { color: colorOf(ref.firstElementChild, ctx.clrMap) };
  return undefined;
}

// Editable boxes in a slide, in a fixed order (text shapes, then table cells as met).
function collectEditables(doc, isNotes) {
  const list = [];
  const walk = tree => {
    for (const el of tree.children) {
      const n = el.localName;
      if (n === "sp" && kid(el, "txBody")) {
        if (!isNotes || phOf(el)?.type === "body") list.push({ node: el, kind: isNotes ? "notes" : "sp" });
      } else if (n === "grpSp") walk(el);
      else if (n === "graphicFrame") {
        const tbl = el.getElementsByTagNameNS(A_NS, "tbl")[0];
        if (tbl) for (const tr of kids(tbl, "tr")) for (const tc of kids(tr, "tc")) list.push({ node: tc, kind: "cell", frame: el, tr, tbl });
      }
    }
  };
  const tree = dig(doc.documentElement, "cSld", "spTree");
  if (tree) walk(tree);
  return list;
}

function renderSlide(i, xmlOverride, highlight, editable) {
  const info = S.slides[i];
  const doc = parseXml(xmlOverride ?? S.texts[info.path]);
  const layoutDoc = info.layout && S.texts[info.layout] ? parseXml(S.texts[info.layout]) : null;
  const masterDoc = info.master && S.texts[info.master] ? parseXml(S.texts[info.master]) : null;
  const cm = dig(masterDoc?.documentElement, "clrMap");
  const clrMap = {};
  if (cm) for (const a of cm.attributes) clrMap[a.name] = a.value;
  const slideEl = document.createElement("div");
  slideEl.className = "slide" + (editable ? " editable" : "");
  slideEl.style.aspectRatio = `${S.W} / ${S.H}`;
  const editIndex = new Map(), objIndex = new Map();
  if (editable) {
    collectEditables(doc, false).forEach((e, k) => editIndex.set(e.node, k));
    collectObjects(doc).forEach((n, k) => objIndex.set(n, k));
  }
  const base = { clrMap, layoutDoc, masterDoc, highlight, editIndex: null, font: fontStack("+mn-lt"), textColor: colorOf({ localName: "schemeClr", getAttribute: () => "tx1", children: [] }, clrMap) };
  const bg = bgOf(doc, info.path, base) ?? bgOf(layoutDoc, info.layout, base) ?? bgOf(masterDoc, info.master, base);
  if (bg?.color) slideEl.style.background = bg.color;
  if (bg?.img) { slideEl.style.backgroundImage = `url("${bg.img}")`; slideEl.style.backgroundSize = "100% 100%"; }
  const tf0 = { sx: 1, sy: 1, dx: 0, dy: 0 };
  const showMaster = doc.documentElement.getAttribute("showMasterSp") !== "0" && layoutDoc?.documentElement.getAttribute("showMasterSp") !== "0";
  if (masterDoc && showMaster) renderSpTree(dig(masterDoc.documentElement, "cSld", "spTree"), { ...base, part: info.master, highlight: false }, slideEl, tf0, "master");
  if (layoutDoc) renderSpTree(dig(layoutDoc.documentElement, "cSld", "spTree"), { ...base, part: info.layout, highlight: false }, slideEl, tf0, "layout");
  renderSpTree(dig(doc.documentElement, "cSld", "spTree"), { ...base, part: info.path, editIndex, objIndex }, slideEl, tf0, "slide");
  return slideEl;
}

function notesText(xml) {
  if (!xml) return null;
  const doc = parseXml(xml);
  const ed = collectEditables(doc, true)[0];
  if (!ed) return null;
  return kids(kid(ed.node, "txBody"), "p").map(paraText).join("\n");
}

/* ====================================================================== editing */
function paraText(p) {
  return [...p.children].map(c => (c.localName === "r" || c.localName === "fld")
    ? [...c.children].filter(e => e.localName === "t").map(e => e.textContent).join("")
    : c.localName === "br" ? " " : "").join("");
}
function setParaText(p, text) {
  const doc = p.ownerDocument;
  const first = [...p.children].find(c => c.localName === "r" || c.localName === "fld");
  const run = doc.createElementNS(A_NS, "a:r");
  const srcRPr = first ? kid(first, "rPr") : kid(p, "endParaRPr");
  const rPr = doc.createElementNS(A_NS, "a:rPr");
  if (srcRPr) { for (const at of srcRPr.attributes) rPr.setAttribute(at.name, at.value); for (const c of srcRPr.children) rPr.appendChild(c.cloneNode(true)); }
  run.appendChild(rPr);
  const t = doc.createElementNS(A_NS, "a:t"); t.textContent = text; run.appendChild(t);
  [...p.children].filter(c => ["r", "br", "fld"].includes(c.localName)).forEach(c => c.remove());
  if (text !== "") p.insertBefore(run, kid(p, "endParaRPr"));
}
function setBodyText(txBody, text) {
  const paras = kids(txBody, "p");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    if (i < paras.length) { if (paraText(paras[i]) !== line) setParaText(paras[i], line); }
    else {
      const last = kids(txBody, "p").pop();
      const c = last.cloneNode(true); setParaText(c, line);
      last.after(c);
    }
  });
  kids(txBody, "p").slice(Math.max(lines.length, 1)).forEach(p => p.remove());
}
// Re-number list rows in a table (findings.1, findings.2, ...) to match row order.
function renumberTable(tbl) {
  const rows = kids(tbl, "tr");
  const rowText = tr => [...tr.getElementsByTagNameNS(A_NS, "t")].map(t => t.textContent).join("");
  const counters = {};
  for (const tr of rows) {
    const map = {};
    for (const m of rowText(tr).matchAll(/\{\{\s*((?:[A-Za-z0-9_\-]+\.)*?[A-Za-z0-9_\-]+)\.(\d+)(?=[.\s}])/g)) {
      const name = m[1], n = +m[2];
      if (map[name] === undefined) { counters[name] = (counters[name] || 0) + 1; map[name] = { from: n, to: counters[name] }; }
    }
    const changes = Object.entries(map).filter(([, v]) => v.from !== v.to);
    if (!changes.length) continue;
    for (const tc of kids(tr, "tc")) {
      const txBody = kid(tc, "txBody"); if (!txBody) continue;
      for (const p of kids(txBody, "p")) {
        let t = paraText(p); const before = t;
        for (const [name, v] of changes) {
          const nameRe = name.replace(/[.\-]/g, "\\$&");
          t = t.replace(new RegExp(`(\\{\\{\\s*${nameRe}\\.)${v.from}(?=[.\\s}])`, "g"), `$1${v.to}`);
        }
        if (changes.length === 1 && before.trim() === String(changes[0][1].from)) t = before.replace(String(changes[0][1].from), String(changes[0][1].to));
        if (t !== before) setParaText(p, t);
      }
    }
  }
}
function mutatePart(part, fn, mergeKey) {
  const before = S.texts[part];
  const doc = parseXml(before);
  const res = fn(doc);
  if (res === false) return false;
  const after = serializeXml(doc);
  if (after === before) return false;
  const now = Date.now(), last = S.undo[S.undo.length - 1];
  if (mergeKey && last && last._key === mergeKey && now - last._t < 1500 && part in last) last._t = now;
  else {
    const step = { [part]: before };
    Object.defineProperty(step, "_key", { value: mergeKey, writable: true, enumerable: false });
    Object.defineProperty(step, "_t", { value: now, writable: true, enumerable: false });
    S.undo.push(step);
  }
  if (S.undo.length > 80) S.undo.shift();
  setPart(part, after);
  return true;
}
function setPart(part, xml) {
  if (xml === null || xml === undefined) { delete S.texts[part]; S.zip.delete(part); }
  else { S.texts[part] = xml; S.zip.set(part, xml); }
  S.templateVersion++;
}

/* ====================================================================== fields model */
const LISTY = /(highlights|bullets|points|steps|items|agenda|actions|takeaways|lines|list|recommendations|risks|issues|tasks|goals|objectives)$/i;
function scanAll() {
  const seen = new Map();
  const parts = [];
  for (const s of S.slides) { parts.push(s.path); if (s.notes && S.texts[s.notes]) parts.push(s.notes); }
  for (const part of parts) for (const f of Engine.scanPlaceholders(S.texts[part])) {
    if (!seen.has(f.key)) seen.set(f.key, { key: f.key, alone: f.alone });
    else if (!f.alone) seen.get(f.key).alone = false;
  }
  return [...seen.values()];
}
function buildModel() {
  const entries = [], byName = new Map(), calc = [];
  const add = e => { entries.push(e); byName.set(e.name, e); return e; };
  for (const { key, alone } of scanAll()) {
    if (key.startsWith("count:")) { calc.push(key); continue; }
    const parts = key.split(".");
    const ni = parts.findIndex((p, i) => i > 0 && /^\d+$/.test(p));
    if (ni > 0) {
      const name = parts.slice(0, ni).join("."), n = +parts[ni], sub = parts.slice(ni + 1).join(".");
      let e = byName.get(name);
      if (!e || e.kind !== "array") e = add({ kind: "array", name, max: 0, children: [], scalar: !sub });
      e.max = Math.max(e.max, n);
      if (sub && !e.children.includes(sub)) e.children.push(sub);
      if (sub) e.scalar = false;
    } else if (parts.length > 1) {
      const name = parts[0];
      let e = byName.get(name);
      if (!e || e.kind !== "object") e = add({ kind: "object", name, children: [] });
      const sub = parts.slice(1).join(".");
      if (!e.children.find(c => c.sub === sub)) e.children.push({ sub, path: key, alone });
    } else if (!byName.has(key)) add({ kind: "field", name: key, path: key, alone });
  }
  return { entries, calc };
}
function cfg(key) {
  const f = S.project.fields;
  if (!f[key]) f[key] = {};
  return f[key];
}
const peekCfg = key => S.project.fields[key] || {};
function fieldType(e) {
  const c = peekCfg(e.path);
  if (c.type) return c.type;
  return e.alone && LISTY.test(e.name) ? "list" : "text";
}
const lines = s => String(s || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
function setDeep(obj, path, v) {
  const ps = path.split("."); let o = obj;
  ps.slice(0, -1).forEach(p => { if (!o[p] || typeof o[p] !== "object") o[p] = {}; o = o[p]; });
  o[ps[ps.length - 1]] = v;
}
function exampleValue(key, type, label) {
  const c = peekCfg(key);
  if (type === "list") { const l = lines(c.example); return l.length ? l : [`${label} 1`, `${label} 2`]; }
  const allowed = String(c.allowed || "").split(",").map(s => s.trim()).filter(Boolean);
  return (c.example && String(c.example).trim()) || allowed[0] || label;
}
function buildExample(model) {
  const out = {};
  for (const e of model.entries) {
    if (e.kind === "field") out[e.name] = exampleValue(e.path, fieldType(e), humanize(e.name));
    else if (e.kind === "object") { const o = {}; for (const c of e.children) setDeep(o, c.sub, exampleValue(c.path, "text", humanize(c.sub))); out[e.name] = o; }
    else if (e.scalar) {
      const l = lines(peekCfg(e.name + "[]").example);
      out[e.name] = (l.length ? l : [`${humanize(e.name)} 1`, `${humanize(e.name)} 2`]).slice(0, e.max);
    } else {
      const per = e.children.map(sub => lines(peekCfg(`${e.name}[].${sub}`).example));
      const count = Math.min(e.max, Math.max(2, ...per.map(l => l.length)));
      const items = [];
      for (let i = 0; i < count; i++) {
        const it = {};
        e.children.forEach((sub, k) => {
          const l = per[k]; const allowed = String(peekCfg(`${e.name}[].${sub}`).allowed || "").split(",").map(s => s.trim()).filter(Boolean);
          setDeep(it, sub, l.length ? l[Math.min(i, l.length - 1)] : (allowed[i % (allowed.length || 1)] || `${humanize(sub)} ${i + 1}`));
        });
        items.push(it);
      }
      out[e.name] = items;
    }
  }
  return out;
}
function describe(key, extraEach) {
  const c = peekCfg(key);
  const bits = [];
  if (c.desc) bits.push(c.desc.trim().replace(/\.$/, ""));
  const allowed = String(c.allowed || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length) bits.push(`one of: ${allowed.join(", ")}`);
  if (num(c.max) > 0) bits.push(`max ${num(c.max)} words${extraEach ? " each" : ""}`);
  return bits.join("; ");
}
function schemaFor(key, type) {
  const d = describe(key, type === "list");
  const allowed = String(peekCfg(key).allowed || "").split(",").map(s => s.trim()).filter(Boolean);
  const s = type === "list" ? { type: "array", items: { type: "string" } } : { type: "string" };
  if (allowed.length && type !== "list") s.enum = allowed;
  if (d) s.description = d;
  return s;
}
function buildSchema(model) {
  const props = {}, req = [];
  const nestProps = (target, sub, sch) => {
    const ps = sub.split("."); let o = target;
    ps.slice(0, -1).forEach(p => { o[p] = o[p] || { type: "object", properties: {}, required: [] }; if (!o[p].properties) o[p].properties = {}; o = o[p].properties; });
    o[ps[ps.length - 1]] = sch;
  };
  for (const e of model.entries) {
    req.push(e.name);
    if (e.kind === "field") props[e.name] = schemaFor(e.path, fieldType(e));
    else if (e.kind === "object") {
      const p = {}; e.children.forEach(c => nestProps(p, c.sub, schemaFor(c.path, "text")));
      props[e.name] = { type: "object", properties: p, required: Object.keys(p) };
    } else if (e.scalar) {
      props[e.name] = { type: "array", maxItems: e.max, items: { type: "string" } };
      const d = describe(e.name + "[]", true); if (d) props[e.name].description = d;
    } else {
      const p = {}; e.children.forEach(sub => nestProps(p, sub, schemaFor(`${e.name}[].${sub}`, "text")));
      props[e.name] = { type: "array", minItems: 1, maxItems: e.max, items: { type: "object", properties: p, required: Object.keys(p) } };
      const d = describe(e.name + "[]"); if (d) props[e.name].description = d;
    }
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: S.project.name || "Presentation", type: "object", properties: props, required: req, additionalProperties: false };
}
function buildPrompt(model) {
  const skel = {};
  const hint = (key, type, label) => { const d = describe(key, type === "list"); return d || label.toLowerCase(); };
  const notes = [];
  for (const e of model.entries) {
    if (e.kind === "field") {
      const t = fieldType(e);
      skel[e.name] = t === "list" ? [hint(e.path, t, humanize(e.name))] : hint(e.path, t, humanize(e.name));
      if (t === "list") notes.push(`- ${e.name}: a list; each item becomes its own bullet or line.`);
    } else if (e.kind === "object") {
      const o = {}; e.children.forEach(c => setDeep(o, c.sub, hint(c.path, "text", humanize(c.sub)))); skel[e.name] = o;
    } else if (e.scalar) {
      skel[e.name] = [hint(e.name + "[]", "list", humanize(e.name))];
      notes.push(`- ${e.name}: up to ${e.max} items.`);
    } else {
      const it = {}; e.children.forEach(sub => setDeep(it, sub, hint(`${e.name}[].${sub}`, "text", humanize(sub)))); skel[e.name] = [it];
      const d = peekCfg(e.name + "[]").desc;
      notes.push(`- ${e.name}: 1 to ${e.max} items (the slide has room for ${e.max})${d ? "; " + d.trim().replace(/\.$/, "") : ""}.`);
    }
  }
  const parts = [
    `You fill in the PowerPoint template "${S.project.name || "Presentation"}". Turn the information you are given into the JSON object below.`,
    "",
    "Output ONLY the JSON object: no explanation, no markdown fences.",
    "Use plain text in every value (no markdown, no bullet symbols, no numbering).",
    "Keep to the length limits; text does not shrink to fit the slide.",
    "Only use facts from the information provided. If something is missing, write \"To be confirmed\" instead of inventing it.",
    "",
    JSON.stringify(skel, null, 2),
  ];
  if (notes.length) parts.push("", "Notes:", ...notes);
  if ((S.project.prompt_extra || "").trim()) parts.push("", S.project.prompt_extra.trim());
  parts.push("", "Information to use:", "{{#sys.query#}}");
  return parts.join("\n");
}

/* ====================================================================== python generation */
function projectForCode() {
  return { name: S.project.name, settings: S.project.settings, fields: S.project.fields, prompt_extra: S.project.prompt_extra || "" };
}
function pyHeader(model) {
  const rows = [];
  for (const e of model.entries) {
    if (e.kind === "field") rows.push([e.name, fieldType(e) === "list" ? "list of text" : "text", describe(e.path)]);
    else if (e.kind === "object") e.children.forEach(c => rows.push([c.path, "text", describe(c.path)]));
    else if (e.scalar) rows.push([e.name, `list (up to ${e.max})`, describe(e.name + "[]")]);
    else { rows.push([e.name, `list of up to ${e.max} items`, describe(e.name + "[]")]); e.children.forEach(sub => rows.push([`  .${sub}`, "text", describe(`${e.name}[].${sub}`)])); }
  }
  model.calc.forEach(k => rows.push([k, "calculated", "filled in automatically"]));
  const w = Math.min(34, Math.max(10, ...rows.map(r => r[0].length)));
  const fieldLines = rows.map(([k, t, d]) => `    ${k.padEnd(w)}  ${t}${d ? " - " + d : ""}`.replace(/"""/g, "'''").replace(/\\/g, "/"));
  const name = (S.project.name || "Presentation").replace(/"""/g, "'''").replace(/\\/g, "/");
  return [
    '"""',
    `${name} - fills the PowerPoint template with JSON.`,
    `Generated by Template Studio on ${new Date().toLocaleDateString("en-CA")}. Standard library only (Python 3.8+).`,
    "",
    "DIFY CODE NODE (Python 3)",
    "    Input variable:   content_json (String)  <- the LLM node's text output",
    "    Output variables: pptx_base64 (String), file_name (String), status (String), message (String)",
    "",
    "YOUR LAPTOP",
    "    python fill_pptx.py content.json [output.pptx]",
    "",
    "FIELDS",
    ...fieldLines,
    "",
    "The template is embedded at the bottom (TEMPLATE_B64). To change it, edit it in",
    "Template Studio and copy the new code; open this file in Template Studio to keep editing.",
    '"""',
    "",
  ].join("\n");
}
async function templateB64() {
  if (S.py.version === S.templateVersion && S.py.b64) return S.py.b64;
  const b64 = bytesToB64(await S.zip.generate());
  S.py = { version: S.templateVersion, b64, code: "" };
  return b64;
}
async function buildPython(model) {
  const b64 = await templateB64();
  const split = ENGINE_PY.indexOf("# =========================================================================== command line");
  const chunks = b64.match(/.{1,100}/g) || [""];
  const constants = [
    "# =========================================================================== template + settings (generated)",
    "",
    "PROJECT = json.loads(" + JSON.stringify(JSON.stringify(projectForCode())) + ")",
    "",
    "TEMPLATE_B64 = (",
    ...chunks.map(c => `    "${c}"`),
    ")",
    "",
    "",
  ].join("\n");
  return pyHeader(model) + ENGINE_PY.slice(0, split) + constants + ENGINE_PY.slice(split);
}
function displayPython(code) {
  const lines = code.split("\n");
  const s = lines.findIndex(l => l.startsWith("TEMPLATE_B64 = ("));
  const e = lines.findIndex((l, i) => i > s && l === ")");
  if (s < 0 || e - s < 6) return code;
  return [...lines.slice(0, s + 3), `    # ... ${e - s - 4} more lines of the embedded template (included when you copy) ...`, lines[e - 1], ...lines.slice(e)].join("\n");
}

/* ====================================================================== filling for test */
function fillAllTexts(data) {
  const rules = S.project.settings.colour_rules || [];
  const rep = { replaced: new Set(), missing: new Set() };
  const out = {};
  for (const [name, xml] of Object.entries(S.texts)) if (Engine.isSlidePart(name)) out[name] = Engine.fillXml(xml, data, rep, rules);
  return { out, rep };
}
function parseTest() {
  try { return { data: Engine.parseContent(S.testText) }; }
  catch (e) { return { error: e.message }; }
}


/* ====================================================================== renaming fields */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_\-]*$/;
function renameKey(from, to, scope) {
  // scope: {type:'plain'|'object-child'|'array'|'array-child', name, sub}
  const map = key => {
    const isCount = key.startsWith("count:");
    let k = isCount ? key.slice(6).trim() : key;
    let out = null;
    if (scope.type === "plain" || scope.type === "array" || scope.type === "object") {
      if (k === from) out = to;
      else if (k.startsWith(from + ".") || k.startsWith(from + "=")) out = to + k.slice(from.length);
    } else if (scope.type === "array-child") {
      const re = new RegExp(`^(${scope.name.replace(/[.\-]/g, "\\$&")}\\.(?:\\d+\\.)?)${scope.sub.replace(/[.\-]/g, "\\$&")}(?=$|[.=\\s])`);
      if (re.test(k)) out = k.replace(re, `$1${to}`);
    } else if (scope.type === "object-child") {
      const full = `${scope.name}.${scope.sub}`;
      if (k === full) out = `${scope.name}.${to}`;
    }
    if (out === null) return null;
    return `{{${isCount ? "count:" + out : out}}}`;
  };
  const before = {};
  let changed = 0;
  for (const name of Object.keys(S.texts)) {
    if (!Engine.isSlidePart(name)) continue;
    const xml = S.texts[name];
    const nx = Engine.rewritePlaceholders(xml, k => map(k));
    if (nx !== xml) { before[name] = xml; setPart(name, nx); changed++; }
  }
  if (!changed) return false;
  S.undo.push(before);
  // move settings
  const F = S.project.fields;
  const moveKey = (a, b) => { if (F[a]) { F[b] = F[a]; delete F[a]; } };
  if (scope.type === "plain") moveKey(from, to);
  else if (scope.type === "array") {
    for (const k of Object.keys(F)) if (k.startsWith(from + "[]")) { F[to + k.slice(from.length)] = F[k]; delete F[k]; }
  } else if (scope.type === "array-child") moveKey(`${scope.name}[].${scope.sub}`, `${scope.name}[].${to}`);
  else if (scope.type === "object-child") moveKey(`${scope.name}.${scope.sub}`, `${scope.name}.${to}`);
  if (S.project.settings.file_name_field === from && scope.type === "plain") S.project.settings.file_name_field = to;
  return true;
}

/* ====================================================================== downloads + copy */
let dlPromise = null;
function downloadsApi() {
  if (!dlPromise) dlPromise = (window.claude && typeof window.claude.use === "function") ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);
  return dlPromise;
}
async function saveFile(filename, data) {
  if (LOCAL) {
    try {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : (typeof data === "string" ? new TextEncoder().encode(data) : data);
      const j = await api("/api/file", { folder: folderName(), name: filename, b64: bytesToB64(bytes) });
      toast(`Saved ${j.path}`);
    } catch (e) { toast(`Couldn't save ${filename}: ${e.message}`); }
    return;
  }
  const dl = await downloadsApi();
  if (!dl) { toast("Downloads aren't available in this view. Use the Copy buttons instead."); return; }
  try { await dl.save({ filename, data }); toast(`Saved ${filename}`); }
  catch (e) {
    if (e?.code === "declined") return;
    toast(e?.code === "rate_limited" ? "A save is already waiting for your answer." : `Couldn't save ${filename}: ${e?.message || e?.code || "unknown error"}`);
  }
}
const safeName = s => (String(s || "").replace(/[^A-Za-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "presentation");
async function templateBlob() { return new Blob([await S.zip.generate()]); }
async function filledBytes(data) {
  const z = await MiniZip.Zip.load(await S.zip.generate());
  const { out } = fillAllTexts(data);
  for (const [n, x] of Object.entries(out)) z.set(n, x);
  return z.generate();
}
async function filledBlob(data) { return new Blob([await filledBytes(data)]); }
function copyText(text, preEl) {
  const ok = () => toast("Copied");
  const fallback = () => {
    if (preEl) { const r = document.createRange(); r.selectNodeContents(preEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast("Text selected. Press Ctrl+C (Cmd+C) to copy.");
  };
  try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
}

