// Draws a slide as HTML from its OOXML. Sizes are in container-query units (cqw), so a slide
// scales with its width: the same markup serves the editor, the thumbnails and the gallery.
import { PH } from "../engine/engine";
import type { Deck } from "./deck";
import { shapeByGeom } from "./shapes";
import { A_NS, R_NS, dig, kid, kids, num, parseXml } from "./xml";

const SVG_NS = "http://www.w3.org/2000/svg";
let arrowSeq = 0;

type ClrMap = Record<string, string>;
type Layer = "slide" | "layout" | "master";
interface Tf { sx: number; sy: number; dx: number; dy: number }
interface Box { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean; chOff: Element | null; chExt: Element | null }
interface PhInfo { type: string; idx: string | null; layoutSp?: Element | null; masterSp?: Element | null }
interface Ctx {
  deck: Deck;
  part: string;
  clrMap: ClrMap;
  layoutDoc: Document | null;
  masterDoc: Document | null;
  highlight: boolean;
  editIndex: Map<Element, number> | null;
  objIndex?: Map<Element, number>;
  curObj?: number;
  font: string | null;
  textColor: string | null;
  defSz?: number;
  anchor?: string | null;
}
type ColorSource = Pick<Element, "localName" | "getAttribute"> & { children: ArrayLike<Element> };

/* ---------------------------------------------------------------- colours */
const PRESET: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080" };
const hexToRgb = (h: string): number[] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
function rgbToHsl([r0, g0, b0]: number[]): number[] {
  const r = r0! / 255, g = g0! / 255, b = b0! / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]: number[]): number[] {
  if (!s) return [l!, l!, l!].map(v => Math.round(v * 255));
  const q = l! < .5 ? l! * (1 + s) : l! + s - l! * s, p = 2 * l! - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h! + 1 / 3), f(h!), f(h! - 1 / 3)].map(v => Math.round(v * 255));
}
function colorOf(deck: Deck, el: ColorSource | null | undefined, clrMap?: ClrMap): string | null {
  if (!el) return null;
  let hex: string | null;
  const n = el.localName;
  if (n === "srgbClr") hex = el.getAttribute("val");
  else if (n === "sysClr") hex = el.getAttribute("lastClr") || "000000";
  else if (n === "prstClr") hex = PRESET[el.getAttribute("val") ?? ""] || "000000";
  else if (n === "schemeClr") {
    let v = el.getAttribute("val") ?? "";
    const map = clrMap && Object.keys(clrMap).length ? clrMap : { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" } as ClrMap;
    if (map[v]) v = map[v]!;
    hex = deck.theme[v] || ({ lt1: "FFFFFF", dk1: "000000" } as ClrMap)[v] || "000000";
  } else return null;
  let rgb = hexToRgb((hex ?? "000000").padStart(6, "0"));
  let alpha = 1;
  for (const m of Array.from(el.children)) {
    const v = num(m.getAttribute("val")) / 100000;
    if (m.localName === "alpha") alpha = v;
    if (m.localName === "lumMod" || m.localName === "lumOff") {
      const hsl = rgbToHsl(rgb);
      hsl[2] = m.localName === "lumMod" ? hsl[2]! * v : Math.min(1, hsl[2]! + v);
      rgb = hslToRgb(hsl);
    }
    if (m.localName === "tint") rgb = rgb.map(c => Math.round(c + (255 - c) * (1 - v)));
    if (m.localName === "shade") rgb = rgb.map(c => Math.round(c * v));
  }
  return `rgba(${rgb.join(",")},${alpha})`;
}
/** undefined = not specified here (inherit), null = explicitly no fill. */
function fillOf(deck: Deck, parent: Element | null, clrMap?: ClrMap): string | null | undefined {
  if (!parent) return undefined;
  if (kid(parent, "noFill")) return null;
  const sf = kid(parent, "solidFill");
  if (sf) return colorOf(deck, sf.firstElementChild, clrMap);
  const gf = kid(parent, "gradFill");
  if (gf) {
    const gs = gf.getElementsByTagNameNS(A_NS, "gs")[0];
    return gs ? colorOf(deck, gs.firstElementChild, clrMap) : undefined;
  }
  return undefined;
}

/* ---------------------------------------------------------------- text styles */
interface Bullet { char?: string; auto?: string; start?: number }
interface Props {
  algn?: string; marL?: number; indent?: number; bullet?: Bullet | null; spcBef?: number; spcAft?: number; lnSpc?: number;
  sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; caps?: boolean; spc?: number; colorEl?: Element | null; font?: string | null;
  defSz?: number; defB?: boolean; defI?: boolean; defU?: boolean; defCaps?: boolean; defSpc?: number; defColorEl?: Element | null; defFont?: string | null;
}
function readPPr(p: Element | null): Props {
  const o: Props = {};
  if (!p) return o;
  const g = (a: string) => p.getAttribute(a);
  if (g("algn")) o.algn = g("algn")!;
  if (g("marL") !== null) o.marL = num(g("marL"));
  if (g("indent") !== null) o.indent = num(g("indent"));
  for (const c of p.children) {
    const n = c.localName;
    if (n === "buNone") o.bullet = null;
    if (n === "buChar") o.bullet = { char: c.getAttribute("char") || "•" };
    if (n === "buAutoNum") o.bullet = { auto: c.getAttribute("type") || "arabicPeriod", start: num(c.getAttribute("startAt"), 1) };
    if (n === "spcBef" || n === "spcAft") {
      const pts = kid(c, "spcPts");
      if (pts) o[n] = num(pts.getAttribute("val")) / 100;
    }
    if (n === "lnSpc") { const pct = kid(c, "spcPct"); if (pct) o.lnSpc = num(pct.getAttribute("val")) / 100000; }
    if (n === "defRPr") Object.assign(o, readRPr(c, "def"));
  }
  return o;
}
function readRPr(r: Element | null, prefix = ""): Props {
  const o: Record<string, unknown> = {};
  if (!r) return o;
  const put = (k: string, v: unknown) => { o[prefix ? prefix + k[0]!.toUpperCase() + k.slice(1) : k] = v; };
  const flag = (a: string) => r.getAttribute(a) === "1" || r.getAttribute(a) === "true";
  if (r.getAttribute("sz")) put("sz", num(r.getAttribute("sz")) / 100);
  if (r.getAttribute("b") !== null) put("b", flag("b"));
  if (r.getAttribute("i") !== null) put("i", flag("i"));
  if (r.getAttribute("u") && r.getAttribute("u") !== "none") put("u", true);
  if (r.getAttribute("strike") && r.getAttribute("strike") !== "noStrike") put("strike", true);
  if (r.getAttribute("cap") === "all") put("caps", true);
  if (r.getAttribute("spc")) put("spc", num(r.getAttribute("spc")) / 100);
  const sf = kid(r, "solidFill");
  if (sf) put("colorEl", sf.firstElementChild);
  const lt = kid(r, "latin");
  if (lt) put("font", lt.getAttribute("typeface"));
  return o as Props;
}
/** List-style elements that apply to a shape, lowest priority first. */
function styleChain(ctx: Ctx, sp: Element, phInfo: PhInfo | null): Element[] {
  const chain: Element[] = [];
  if (ctx.deck.defaultTextStyle) chain.push(ctx.deck.defaultTextStyle);
  if (phInfo) {
    const tx = ctx.masterDoc ? dig(ctx.masterDoc.documentElement, "txStyles") : null;
    const t = phInfo.type;
    const which = (t === "title" || t === "ctrTitle") ? "titleStyle" : (["dt", "ftr", "sldNum"].includes(t) ? "otherStyle" : "bodyStyle");
    const st = kid(tx, which);
    if (st) chain.push(st);
    for (const inh of [phInfo.masterSp, phInfo.layoutSp]) {
      const ls = inh ? dig(inh, "txBody", "lstStyle") : null;
      if (ls) chain.push(ls);
    }
  }
  const own = dig(sp, "txBody", "lstStyle");
  if (own) chain.push(own);
  return chain;
}
function levelProps(chain: Element[], lvl: number): Props {
  const o: Props = {};
  for (const st of chain) Object.assign(o, readPPr(kid(st, `lvl${lvl + 1}pPr`)));
  return o;
}

/* ---------------------------------------------------------------- geometry */
const FALLBACK = ', "Calibri", "Carlito", "Segoe UI", Arial, sans-serif';
function fontStack(deck: Deck, f: string | null | undefined): string | null {
  if (!f) return null;
  if (f === "+mj-lt") f = deck.fonts.major; else if (f === "+mn-lt") f = deck.fonts.minor;
  return f ? `"${f}"${FALLBACK}` : null;
}
export function xfrmOf(el: Element | null): Box | null {
  const x = kid(el, "xfrm");
  if (!x) return null;
  const off = kid(x, "off"), ext = kid(x, "ext");
  if (!off || !ext) return null;
  return {
    x: num(off.getAttribute("x")), y: num(off.getAttribute("y")),
    cx: num(ext.getAttribute("cx")), cy: num(ext.getAttribute("cy")),
    rot: num(x.getAttribute("rot")) / 60000, flipH: x.getAttribute("flipH") === "1", flipV: x.getAttribute("flipV") === "1",
    chOff: kid(x, "chOff"), chExt: kid(x, "chExt"),
  };
}
const applyTf = (tf: Tf, b: Box): Box => ({ ...b, x: tf.dx + b.x * tf.sx, y: tf.dy + b.y * tf.sy, cx: b.cx * tf.sx, cy: b.cy * tf.sy });

export function phOf(sp: Element): PhInfo | null {
  const ph = dig(sp, "nvSpPr", "nvPr", "ph") || dig(sp, "nvPicPr", "nvPr", "ph") || dig(sp, "nvGraphicFramePr", "nvPr", "ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") };
}
export function findPh(doc: Document | null, info: { type: string; idx: string | null }): Element | null {
  if (!doc) return null;
  const sps = [...doc.getElementsByTagName("*")].filter(e => e.localName === "sp" && phOf(e));
  const byIdx = info.idx !== null ? sps.find(s => phOf(s)!.idx === info.idx) : null;
  if (byIdx) return byIdx;
  const t = info.type === "ctrTitle" ? ["ctrTitle", "title"] : info.type === "subTitle" ? ["subTitle", "body"] : [info.type];
  for (const tt of t) { const m = sps.find(s => phOf(s)!.type === tt); if (m) return m; }
  return null;
}

/** Short, readable label for a {{placeholder}} shown in the editor (the template keeps the real text). */
export function tokenLabel(raw: string): string {
  const k = raw.replace(/^\{\{\s*|\s*\}\}$/g, "");
  let m = /^count:(.+?)(?:\.([^.=]+)=(.+))?$/.exec(k);
  if (m) return m[3] ? `# ${m[3]}` : `# ${m[1]!.split(".").pop()}`;
  m = /^(.+?)\.\d+(?:\.(.+))?$/.exec(k);
  if (m) return m[2] || m[1]!.split(".").pop()!;
  return k;
}

export function paraText(p: Element): string {
  return [...p.children].map(c => (c.localName === "r" || c.localName === "fld")
    ? [...c.children].filter(e => e.localName === "t").map(e => e.textContent).join("")
    : c.localName === "br" ? " " : "").join("");
}

/* ---------------------------------------------------------------- rendering */
class Painter {
  constructor(private deck: Deck) {}
  u = (emu: number): string => `${(emu / this.deck.W * 100).toFixed(4)}cqw`;
  pt = (p: number): string => `${(p * 12700 / this.deck.W * 100).toFixed(4)}cqw`;

  /** An outer shadow as a CSS drop-shadow, which follows any outline (polygons, pictures). */
  shadow(el: HTMLElement | SVGElement, spPr: Element | null, ctx: Ctx): void {
    const sh = dig(spPr, "effectLst", "outerShdw");
    if (!sh) return;
    const dist = num(sh.getAttribute("dist")), dir = num(sh.getAttribute("dir")) / 60000 * Math.PI / 180;
    const col = colorOf(this.deck, sh.firstElementChild as Element | null, ctx.clrMap) || "rgba(0,0,0,.35)";
    el.style.filter = `drop-shadow(${this.u(dist * Math.cos(dir))} ${this.u(dist * Math.sin(dir))} ${this.u(num(sh.getAttribute("blurRad")) / 2)} ${col})`;
  }

  place(el: HTMLElement | SVGElement, b: Box): void {
    el.style.left = this.u(b.x); el.style.top = this.u(b.y); el.style.width = this.u(b.cx); el.style.height = this.u(b.cy);
    if (b.rot) el.style.transform = `rotate(${b.rot}deg)`;
  }

  paragraphs(txBody: Element, chain: Element[], ctx: Ctx, highlight: boolean): HTMLElement {
    const { deck } = this;
    const box = document.createElement("div");
    box.className = "txt";
    const bodyPr = kid(txBody, "bodyPr");
    const ins = (k: string) => num(bodyPr?.getAttribute(k), k[0] === "l" || k[0] === "r" ? 91440 : 45720);
    box.style.padding = `${this.u(ins("tIns"))} ${this.u(ins("rIns"))} ${this.u(ins("bIns"))} ${this.u(ins("lIns"))}`;
    const anchor = bodyPr?.getAttribute("anchor") || ctx.anchor || "t";
    box.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
    const scale = num(dig(bodyPr, "normAutofit")?.getAttribute("fontScale"), 100000) / 100000;
    if (bodyPr?.getAttribute("wrap") === "none") box.style.whiteSpace = "nowrap";
    let autoCounter: Record<number, number> = {};
    for (const p of kids(txBody, "p")) {
      const pPr = kid(p, "pPr");
      const lvl = num(pPr?.getAttribute("lvl"), 0);
      const props: Props = { ...levelProps(chain, lvl), ...readPPr(pPr) };
      const d = document.createElement("div");
      d.className = "para";
      d.style.textAlign = ({ ctr: "center", r: "right", just: "justify", dist: "justify" } as Record<string, string>)[props.algn ?? ""] || "left";
      d.style.lineHeight = String(props.lnSpc ? props.lnSpc * 1.2 : 1.2);
      if (props.spcBef) d.style.marginTop = this.pt(props.spcBef);
      if (props.spcAft) d.style.marginBottom = this.pt(props.spcAft);
      const marL = props.marL || 0, indent = props.indent || 0;
      d.style.paddingLeft = this.u(marL);
      const defaults: Props = {
        sz: props.defSz || ctx.defSz || 18, b: props.defB ?? false, i: props.defI ?? false,
        colorEl: props.defColorEl || null, font: props.defFont || null, caps: props.defCaps, spc: props.defSpc,
      };
      const segs: { text: string; br?: boolean; st: Props }[] = [];
      for (const c of p.children) {
        if (c.localName === "r" || c.localName === "fld") {
          segs.push({ text: [...c.children].filter(e => e.localName === "t").map(e => e.textContent).join(""), st: { ...defaults, ...readRPr(kid(c, "rPr")) } });
        } else if (c.localName === "br") segs.push({ text: "", br: true, st: { ...defaults, ...readRPr(kid(c, "rPr")) } });
      }
      const endSt: Props = { ...defaults, ...readRPr(kid(p, "endParaRPr")) };
      const firstSt = segs[0]?.st || endSt;
      const styleSpan = (span: HTMLElement, st: Props) => {
        span.style.fontSize = `calc(var(--fit, 1) * ${this.pt((st.sz ?? 18) * scale)})`;
        if (st.b) span.style.fontWeight = "700";
        if (st.i) span.style.fontStyle = "italic";
        if (st.u || st.strike) span.style.textDecoration = [st.u ? "underline" : "", st.strike ? "line-through" : ""].join(" ").trim();
        if (st.caps) span.style.textTransform = "uppercase";
        if (st.spc) span.style.letterSpacing = this.pt(st.spc);
        const col = st.colorEl ? colorOf(deck, st.colorEl, ctx.clrMap) : ctx.textColor;
        if (col) span.style.color = col;
        const f = fontStack(deck, st.font) || ctx.font;
        if (f) span.style.fontFamily = f;
      };
      const hasText = segs.some(s => s.text);
      if (props.bullet && hasText) {
        const b = document.createElement("span");
        styleSpan(b, firstSt);
        b.style.display = "inline-block";
        b.style.width = this.u(Math.max(-indent, 228600));
        b.style.marginLeft = indent < 0 ? this.u(indent) : "0";
        if (props.bullet.char) b.textContent = props.bullet.char;
        else {
          autoCounter[lvl] = (autoCounter[lvl] ?? (props.bullet.start ?? 1) - 1) + 1;
          const nn = autoCounter[lvl]!, tp = props.bullet.auto ?? "";
          b.textContent = (/alphaLc/.test(tp) ? String.fromCharCode(96 + nn) : /alphaUc/.test(tp) ? String.fromCharCode(64 + nn) : nn) + (/Paren/.test(tp) ? ")" : ".");
        }
        d.appendChild(b);
      } else if (!props.bullet || !props.bullet.auto) { autoCounter = {}; d.style.textIndent = indent ? this.u(indent) : ""; }
      // In the editor, {{placeholders}} are drawn as tokens with a short label.
      const full = segs.map(s => s.br ? "\n" : s.text).join("");
      const ranges: [number, number][] = highlight ? [...full.matchAll(PH())].map(m => [m.index!, m.index! + m[0].length]) : [];
      let pos = 0;
      for (const s of segs) {
        if (s.br) { d.appendChild(document.createElement("br")); pos += 1; continue; }
        const span = document.createElement("span");
        styleSpan(span, s.st);
        const t = s.text;
        const cuts = new Set([0, t.length]);
        for (const [a, b] of ranges) { if (a > pos && a < pos + t.length) cuts.add(a - pos); if (b > pos && b < pos + t.length) cuts.add(b - pos); }
        const cs = [...cuts].sort((x, y) => x - y);
        for (let k = 0; k < cs.length - 1; k++) {
          const piece = t.slice(cs[k], cs[k + 1]), abs = pos + cs[k]!;
          const hit = ranges.find(([a, b]) => abs >= a && abs < b);
          if (hit) {
            const m = document.createElement("span");
            m.className = "ph";
            const whole = hit[0] === abs && hit[1] === abs + piece.length;
            m.textContent = whole ? tokenLabel(piece) : piece;
            if (whole) m.title = piece;
            span.appendChild(m);
          } else span.appendChild(document.createTextNode(piece));
        }
        pos += t.length;
        d.appendChild(span);
      }
      if (!hasText) { const sp = document.createElement("span"); styleSpan(sp, endSt); sp.textContent = " "; d.appendChild(sp); }
      box.appendChild(d);
    }
    return box;
  }

  tree(tree: Element | null, ctx: Ctx, out: HTMLElement, tf: Tf, layer: Layer): void {
    if (!tree) return;
    for (const el of tree.children) {
      const n = el.localName;
      const oi = ctx.objIndex?.get(el);
      const c = oi !== undefined ? { ...ctx, curObj: oi } : ctx;
      if (n === "sp") this.sp(el, c, out, tf, layer);
      else if (n === "pic") this.pic(el, c, out, tf, layer);
      else if (n === "cxnSp") this.line(c, out, tf, kid(el, "spPr"));
      else if (n === "graphicFrame") this.frame(el, c, out, tf, layer);
      else if (n === "grpSp") {
        const g = xfrmOf(kid(el, "grpSpPr"));
        let inner = tf;
        if (g && g.chOff && g.chExt) {
          const cx = num(g.chExt.getAttribute("cx"), 1) || 1, cy = num(g.chExt.getAttribute("cy"), 1) || 1;
          const sx = g.cx / cx, sy = g.cy / cy;
          const dx = g.x - num(g.chOff.getAttribute("x")) * sx, dy = g.y - num(g.chOff.getAttribute("y")) * sy;
          inner = { sx: tf.sx * sx, sy: tf.sy * sy, dx: tf.dx + dx * tf.sx, dy: tf.dy + dy * tf.sy };
        }
        this.tree(el, c, out, inner, layer);
      }
    }
  }

  line(ctx: Ctx, out: HTMLElement, tf: Tf, spPr: Element | null): void {
    const b0 = xfrmOf(spPr);
    if (!b0) return;
    const b = applyTf(tf, b0);
    const ln = kid(spPr, "ln");
    const lineFill = fillOf(this.deck, ln, ctx.clrMap);
    if (lineFill === null) return;
    const w = num(ln?.getAttribute("w"), 12700);
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("shp");
    if (ctx.curObj !== undefined) svg.dataset.obj = String(ctx.curObj);
    svg.style.overflow = "visible";
    this.place(svg, { ...b, cx: Math.max(b.cx, 1), cy: Math.max(b.cy, 1) });
    // a perfectly flat or upright line has a zero-size box, which browsers don't draw at all
    svg.style.width = `max(1px, ${svg.style.width})`;
    svg.style.height = `max(1px, ${svg.style.height})`;
    const line = document.createElementNS(svgNS, "line");
    // percentages of the box, not a stretched viewBox, so arrowheads keep their shape
    const [x1, x2] = b.flipH ? ["100%", "0%"] : ["0%", "100%"], [y1, y2] = b.flipV ? ["100%", "0%"] : ["0%", "100%"];
    line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", lineFill || "rgba(0,0,0,1)");
    const sw = Math.max(1, w / 12700 * 1.33);
    line.setAttribute("stroke-width", String(sw));
    // arrowheads: drawn in screen pixels so they keep their shape however the line is stretched
    for (const end of ["headEnd", "tailEnd"] as const) {
      const t = kid(ln, end)?.getAttribute("type");
      if (!t || t === "none") continue;
      const id = `ah${++arrowSeq}`;
      const m = document.createElementNS(svgNS, "marker");
      m.setAttribute("id", id); m.setAttribute("viewBox", "0 0 10 10"); m.setAttribute("refX", "8"); m.setAttribute("refY", "5");
      m.setAttribute("markerWidth", "4"); m.setAttribute("markerHeight", "4"); m.setAttribute("orient", end === "tailEnd" ? "auto" : "auto-start-reverse");
      m.setAttribute("markerUnits", "strokeWidth");
      const pth = document.createElementNS(svgNS, "path");
      pth.setAttribute("d", t === "oval" ? "M5 1a4 4 0 1 1 0 8a4 4 0 1 1 0-8z" : "M0 0 10 5 0 10z");
      pth.setAttribute("fill", lineFill || "#000");
      m.appendChild(pth);
      svg.appendChild(m);
      line.setAttribute(end === "tailEnd" ? "marker-end" : "marker-start", `url(#${id})`);
    }
    svg.appendChild(line);
    // a wide invisible stroke makes a thin line easy to click
    const hit = line.cloneNode() as SVGLineElement;
    for (const a of ["marker-start", "marker-end"]) hit.removeAttribute(a);
    hit.setAttribute("stroke", "transparent"); hit.setAttribute("stroke-width", "14"); hit.style.pointerEvents = "stroke";
    svg.appendChild(hit);
    out.appendChild(svg);
  }

  sp(sp: Element, ctx: Ctx, out: HTMLElement, tf: Tf, layer: Layer): void {
    const { deck } = this;
    const ph = phOf(sp);
    if (layer !== "slide" && ph) return; // layout/master placeholders are prompts, not content
    const spPr = kid(sp, "spPr");
    let phInfo: PhInfo | null = null;
    if (ph) phInfo = { ...ph, layoutSp: findPh(ctx.layoutDoc, ph), masterSp: findPh(ctx.masterDoc, { type: ph.type, idx: null }) };
    let b0 = xfrmOf(spPr);
    if (!b0 && phInfo) b0 = xfrmOf(kid(phInfo.layoutSp ?? null, "spPr")) || xfrmOf(kid(phInfo.masterSp ?? null, "spPr"));
    if (!b0) return;
    const geom = dig(spPr, "prstGeom")?.getAttribute("prst") || "rect";
    if (geom === "line" || geom === "straightConnector1") return this.line(ctx, out, tf, spPr);
    const b = applyTf(tf, b0);
    const div = document.createElement("div");
    div.className = "shp";
    if (ctx.curObj !== undefined) div.dataset.obj = String(ctx.curObj);
    this.place(div, b);
    const style = kid(sp, "style");
    let fill = fillOf(deck, spPr, ctx.clrMap);
    const fillRef = kid(style, "fillRef");
    if (fill === undefined && fillRef && num(fillRef.getAttribute("idx")) > 0) fill = colorOf(deck, fillRef.firstElementChild, ctx.clrMap);
    const ln = kid(spPr, "ln");
    let lnCol = ln ? fillOf(deck, ln, ctx.clrMap) : undefined;
    const lnRef = kid(style, "lnRef");
    if (lnCol === undefined && lnRef && num(lnRef.getAttribute("idx")) > 0 && !ln) lnCol = colorOf(deck, lnRef.firstElementChild, ctx.clrMap);
    const lnW = `max(1px, ${this.u(num(ln?.getAttribute("w"), 9525))})`;
    const shape = geom !== "rect" ? shapeByGeom(geom) : undefined;
    if (shape) {
      // non-rectangular presets are drawn as an SVG outline behind the text
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.classList.add("geom");
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", shape.poly);
      poly.setAttribute("vector-effect", "non-scaling-stroke");
      const fx = xfrmOf(spPr);
      if (fx?.flipH || fx?.flipV) svg.style.transform = `scale(${fx.flipH ? -1 : 1}, ${fx.flipV ? -1 : 1})`;
      poly.style.fill = fill || "none";
      if (lnCol) { poly.style.stroke = lnCol; poly.style.strokeWidth = lnW; }
      svg.appendChild(poly);
      div.appendChild(svg);
    } else {
      if (fill) div.style.background = fill;
      if (lnCol) div.style.border = `${lnW} solid ${lnCol}`;
    }
    if (geom === "ellipse") div.style.borderRadius = "50%";
    if (geom === "roundRect") {
      const adj = dig(spPr, "prstGeom", "avLst")?.firstElementChild?.getAttribute("fmla");
      const r = adj ? num(adj.replace(/\D/g, ""), 16667) / 100000 : .16667;
      div.style.borderRadius = this.u(Math.min(b.cx, b.cy) * r);
    }
    this.shadow(div, spPr, ctx);
    const txBody = kid(sp, "txBody");
    if (txBody && layer === "slide") {
      const t = phInfo?.type;
      const anchorFrom = phInfo ? (dig(phInfo.layoutSp ?? null, "txBody", "bodyPr")?.getAttribute("anchor") || dig(phInfo.masterSp ?? null, "txBody", "bodyPr")?.getAttribute("anchor")) : null;
      const tctx: Ctx = { ...ctx, defSz: (t === "title" || t === "ctrTitle") ? 40 : 18, anchor: anchorFrom || null };
      div.appendChild(this.paragraphs(txBody, styleChain(ctx, sp, phInfo), tctx, ctx.highlight));
      const idx = ctx.editIndex?.get(sp);
      if (idx !== undefined) { div.classList.add("hit"); div.dataset.edit = String(idx); }
    } else if (txBody) {
      div.appendChild(this.paragraphs(txBody, styleChain(ctx, sp, null), { ...ctx, defSz: 18 }, false));
    }
    out.appendChild(div);
  }

  picUrl(el: Element, part: string): string | null {
    const blip = el.getElementsByTagNameNS(A_NS, "blip")[0];
    const rid = blip?.getAttributeNS(R_NS, "embed") || blip?.getAttribute("r:embed");
    const target = rid ? this.deck.relsOf(part)[rid]?.target : null;
    return target ? this.deck.media[target] ?? null : null;
  }

  pic(el: Element, ctx: Ctx, out: HTMLElement, tf: Tf, layer: Layer): void {
    if (layer !== "slide" && phOf(el)) return;
    const b0 = xfrmOf(kid(el, "spPr"));
    const url = this.picUrl(el, ctx.part);
    if (!b0 || !url) return;
    const img = document.createElement("img");
    img.className = "shp";
    img.alt = "";
    img.draggable = false;
    if (ctx.curObj !== undefined) img.dataset.obj = String(ctx.curObj);
    img.src = url;
    img.style.objectFit = "fill";
    if (b0.flipH || b0.flipV) img.style.scale = `${b0.flipH ? -1 : 1} ${b0.flipV ? -1 : 1}`;
    const amt = el.getElementsByTagNameNS(A_NS, "alphaModFix")[0]?.getAttribute("amt");
    if (amt) img.style.opacity = String(num(amt) / 100000);
    this.shadow(img, kid(el, "spPr"), ctx);
    img.style.maxWidth = "none";
    const sr = kid(kid(el, "blipFill"), "srcRect");
    if (!sr) { this.place(img, applyTf(tf, b0)); out.appendChild(img); return; }
    // a cropped picture: a clipping frame, with the whole image inside it shifted and enlarged
    const c = (k: string) => num(sr.getAttribute(k)) / 100000;
    const frame = document.createElement("div");
    frame.className = "shp crop";
    if (ctx.curObj !== undefined) frame.dataset.obj = String(ctx.curObj);
    delete img.dataset.obj;
    img.className = "";
    const w = 1 - c("l") - c("r") || 1, h = 1 - c("t") - c("b") || 1;
    Object.assign(img.style, { position: "absolute", width: `${100 / w}%`, height: `${100 / h}%`, left: `${-c("l") / w * 100}%`, top: `${-c("t") / h * 100}%` });
    frame.appendChild(img);
    this.place(frame, applyTf(tf, b0));
    out.appendChild(frame);
  }

  frame(el: Element, ctx: Ctx, out: HTMLElement, tf: Tf, layer: Layer): void {
    const { deck } = this;
    const tbl = el.getElementsByTagNameNS(A_NS, "tbl")[0];
    const b0 = xfrmOf(el);
    if (!b0 || !tbl) return;
    const b = applyTf(tf, b0);
    const cols = kids(kid(tbl, "tblGrid"), "gridCol").map(c => num(c.getAttribute("w")));
    const table = document.createElement("table");
    table.setAttribute("role", "presentation"); // drawn for position, like every other shape
    if (ctx.curObj !== undefined) table.dataset.obj = String(ctx.curObj);
    table.style.left = this.u(b.x);
    table.style.top = this.u(b.y);
    table.style.width = this.u((cols.reduce((a, c) => a + c, 0) || b.cx) * tf.sx);
    const cg = document.createElement("colgroup");
    cols.forEach(w => { const c = document.createElement("col"); c.style.width = this.u(w * tf.sx); cg.appendChild(c); });
    table.appendChild(cg);
    const chain = deck.defaultTextStyle ? [deck.defaultTextStyle] : [];
    for (const tr of kids(tbl, "tr")) {
      const row = document.createElement("tr");
      row.style.height = this.u(num(tr.getAttribute("h")) * tf.sy);
      for (const tc of kids(tr, "tc")) {
        if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
        const td = document.createElement("td");
        if (tc.getAttribute("gridSpan")) td.colSpan = num(tc.getAttribute("gridSpan"), 1);
        if (tc.getAttribute("rowSpan")) td.rowSpan = num(tc.getAttribute("rowSpan"), 1);
        const tcPr = kid(tc, "tcPr");
        const f = fillOf(deck, tcPr, ctx.clrMap);
        if (f) td.style.background = f;
        for (const [side, nm] of [["Left", "lnL"], ["Right", "lnR"], ["Top", "lnT"], ["Bottom", "lnB"]] as const) {
          const l = kid(tcPr, nm);
          const c = l ? fillOf(deck, l, ctx.clrMap) : null;
          if (l && c) td.style[`border${side}`] = `max(1px, ${this.u(num(l.getAttribute("w"), 12700))}) solid ${c}`;
        }
        const inner = document.createElement("div");
        inner.style.position = "relative";
        inner.style.height = "100%";
        inner.style.minHeight = row.style.height;
        const txBody = kid(tc, "txBody");
        if (txBody) {
          const mar = (k: string, d: number) => this.u(num(tcPr?.getAttribute(k), d));
          const tb = this.paragraphs(txBody, chain, { ...ctx, defSz: 18, anchor: tcPr?.getAttribute("anchor") || "t" }, ctx.highlight);
          tb.style.position = "relative";
          tb.style.minHeight = row.style.height;
          tb.style.padding = `${mar("marT", 45720)} ${mar("marR", 91440)} ${mar("marB", 45720)} ${mar("marL", 91440)}`;
          inner.appendChild(tb);
        }
        td.appendChild(inner);
        const idx = ctx.editIndex?.get(tc);
        if (idx !== undefined && layer === "slide") { td.classList.add("hit"); td.dataset.edit = String(idx); }
        row.appendChild(td);
      }
      table.appendChild(row);
    }
    out.appendChild(table);
  }

  bg(doc: Document | null, part: string | null, clrMap: ClrMap): { color?: string | null; img?: string } | undefined {
    const bg = doc ? dig(doc.documentElement, "cSld", "bg") : null;
    if (!bg || !part) return undefined;
    const bgPr = kid(bg, "bgPr");
    if (bgPr) {
      const blip = kid(bgPr, "blipFill");
      if (blip) { const url = this.picUrl(blip, part); if (url) return { img: url }; }
      const f = fillOf(this.deck, bgPr, clrMap);
      if (f) return { color: f };
    }
    const ref = kid(bg, "bgRef");
    if (ref?.firstElementChild) return { color: colorOf(this.deck, ref.firstElementChild, clrMap) };
    return undefined;
  }
}

/* ---------------------------------------------------------------- what can be selected / edited */
export interface Editable { node: Element; kind: "sp" | "notes" | "cell"; frame?: Element; tr?: Element; tbl?: Element }

/** Text boxes and table cells in a slide, in a fixed order (the index is the "edit id" in the DOM). */
export function collectEditables(doc: Document, isNotes: boolean): Editable[] {
  const list: Editable[] = [];
  const walk = (tree: Element) => {
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

const OBJ_TYPES = new Set(["sp", "pic", "graphicFrame", "grpSp", "cxnSp"]);
/** Top-level objects on a slide, in z-order (the index is the "object id" in the DOM). */
export function collectObjects(doc: Document): Element[] {
  const tree = dig(doc.documentElement, "cSld", "spTree");
  return tree ? [...tree.children].filter(c => OBJ_TYPES.has(c.localName)) : [];
}

export interface RenderOptions { xml?: string; highlight?: boolean; editable?: boolean }

export function renderSlide(deck: Deck, i: number, opts: RenderOptions = {}): HTMLElement {
  const info = deck.slides[i]!;
  const painter = new Painter(deck);
  const doc = parseXml(opts.xml ?? deck.texts[info.path]!);
  const layoutDoc = info.layout && deck.texts[info.layout] ? parseXml(deck.texts[info.layout]!) : null;
  const masterDoc = info.master && deck.texts[info.master] ? parseXml(deck.texts[info.master]!) : null;
  const cm = dig(masterDoc?.documentElement, "clrMap");
  const clrMap: ClrMap = {};
  if (cm) for (const a of cm.attributes) clrMap[a.name] = a.value;
  const slideEl = document.createElement("div");
  slideEl.className = "slide" + (opts.editable ? " editable" : "");
  slideEl.style.aspectRatio = `${deck.W} / ${deck.H}`;
  const editIndex = new Map<Element, number>(), objIndex = new Map<Element, number>();
  if (opts.editable) {
    collectEditables(doc, false).forEach((e, k) => editIndex.set(e.node, k));
    collectObjects(doc).forEach((n, k) => objIndex.set(n, k));
  }
  const tx1: ColorSource = { localName: "schemeClr", getAttribute: () => "tx1", children: [] };
  const base: Ctx = {
    deck, part: info.path, clrMap, layoutDoc, masterDoc, highlight: !!opts.highlight, editIndex: null,
    font: fontStack(deck, "+mn-lt"), textColor: colorOf(deck, tx1, clrMap),
  };
  const bg = painter.bg(doc, info.path, clrMap) ?? painter.bg(layoutDoc, info.layout, clrMap) ?? painter.bg(masterDoc, info.master, clrMap);
  if (bg?.color) slideEl.style.background = bg.color;
  if (bg?.img) { slideEl.style.backgroundImage = `url("${bg.img}")`; slideEl.style.backgroundSize = "100% 100%"; }
  const tf0: Tf = { sx: 1, sy: 1, dx: 0, dy: 0 };
  const showMaster = doc.documentElement.getAttribute("showMasterSp") !== "0" && layoutDoc?.documentElement.getAttribute("showMasterSp") !== "0";
  if (masterDoc && showMaster && info.master) painter.tree(dig(masterDoc.documentElement, "cSld", "spTree"), { ...base, part: info.master, highlight: false }, slideEl, tf0, "master");
  if (layoutDoc && info.layout) painter.tree(dig(layoutDoc.documentElement, "cSld", "spTree"), { ...base, part: info.layout, highlight: false }, slideEl, tf0, "layout");
  painter.tree(dig(doc.documentElement, "cSld", "spTree"), { ...base, editIndex, objIndex }, slideEl, tf0, "slide");
  return slideEl;
}

/**
 * Editor only: shrink text that holds field tokens until it fits its box (never below 40%).
 * This sets a CSS variable on the preview; the template's real font sizes are untouched.
 */
export function fitPlaceholderBoxes(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLElement>(".txt")) {
    if (!box.querySelector(".ph") || !box.clientWidth) continue;
    const inCell = !!box.closest("td");
    const cs = getComputedStyle(box);
    const fits = () => {
      const paras = [...box.children] as HTMLElement[];
      if (paras.some(p => p.scrollWidth > p.clientWidth + 1)) return false;
      if (inCell) return true;
      const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let used = 0;
      for (const p of paras) { const ps = getComputedStyle(p); used += p.offsetHeight + parseFloat(ps.marginTop) + parseFloat(ps.marginBottom); }
      return used <= avail + 1;
    };
    if (fits()) continue;
    let lo = 0.4, hi = 1;
    for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; box.style.setProperty("--fit", String(mid)); if (fits()) lo = mid; else hi = mid; }
    box.style.setProperty("--fit", String(lo));
  }
}
