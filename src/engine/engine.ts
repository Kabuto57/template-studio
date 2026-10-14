// Fill engine: a line-for-line port of python/engine.py, so the browser preview and the
// generated Python produce the same slide XML. Change both files together; tests/py/parity.py
// fails the build if they drift.

export type Data = Record<string, unknown>;
export interface Report { replaced: Set<string>; missing: Set<string> }
export interface ColourRule { match: string; fill: string; text: string }
type Found = [found: boolean, value: unknown];

export const PH = () => /\{\{\s*([^{}]+?)\s*\}\}/g;
const PARA_RE = () => /<a:p(?:\s[^>]*)?>.*?<\/a:p>/gs;
const RUN_RE = () => /<a:r(?:\s[^>]*)?>.*?<\/a:r>/gs;
const TEXT_RE = () => /(<a:t(?:\s[^>]*)?>)(.*?)(<\/a:t>)|<a:t\s*\/>/gs;
const ROW_RE = () => /<a:tr(?:\s[^>]*)?>.*?<\/a:tr>/gs;
const CELL_RE = () => /<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs;
const TBL_RE = () => /<a:tbl>.*?<\/a:tbl>/gs;
const BORDER_RE = () => /<a:(ln[LRTB]|lnTlToBr|lnBlToTr)\b(?:[^>]*\/>|.*?<\/a:\1>)/gs;
const FILL_RE = () => /<a:(solidFill|noFill|gradFill|pattFill|blipFill|grpFill)\b(?:[^>]*\/>|.*?<\/a:\1>)/gs;
const LN_RE = () => /<a:ln\b(?:[^>]*\/>|.*?<\/a:ln>)/s;
const INDEX_RE = /^[0-9]+$/;
const NEWLINE_RE = /\r\n|\n|\r/;

// Characters XML 1.0 forbids. One of these in a slide makes PowerPoint refuse the file.
const ILLEGAL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/gu;
const HEX_RE = /^[0-9A-Fa-f]{6}$/;
export const xmlEscape = (s: string): string => s.replace(ILLEGAL_RE, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const xmlUnescape = (s: string): string => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const isObj = (v: unknown): v is Data => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o: unknown, k: string): o is Data => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

/** Follow 'a.b.2.c' through objects and lists (list positions start at 1). */
export function walk(data: unknown, path: string): Found {
  if (has(data, path)) return [true, data[path]];
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (has(cur, part)) cur = cur[part];
    else if (Array.isArray(cur) && INDEX_RE.test(part) && +part >= 1 && +part <= cur.length) cur = cur[+part - 1];
    else return [false, null];
  }
  return [true, cur];
}

/** Plain digits, never "1e+21", so the result matches Python's output. */
function plainNumber(n: number): string {
  const s = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2]! + (m[3] ?? ""), exp = +m[4]!;
  return exp >= 0 ? m[1]! + digits.padEnd(exp + 1, "0") : `${m[1]}0.${"0".repeat(-exp - 1)}${digits}`;
}

export function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(toText).join(", ");
  if (isObj(v)) return JSON.stringify(v);
  if (typeof v === "number") return plainNumber(v);
  return String(v).replace(/\r\n/g, "\n").replace(/\n/g, " ");
}

export function lookup(data: Data, key: string): Found {
  if (key.startsWith("count:")) {
    let expr = key.slice(6).trim();
    let cond: [string, string] | null = null;
    const eq = expr.indexOf("=");
    if (eq >= 0) {
      const left = expr.slice(0, eq).trim(), wanted = expr.slice(eq + 1).trim().toLowerCase();
      const dot = left.lastIndexOf(".");
      if (dot < 0) return [false, null];
      expr = left.slice(0, dot).trim();
      cond = [left.slice(dot + 1).trim(), wanted];
    }
    const [found, items] = walk(data, expr);
    if (!found || !Array.isArray(items)) return [false, null];
    if (!cond) return [true, items.length];
    const [field, wanted] = cond;
    return [true, items.filter(it => isObj(it) && toText(it[field]).trim().toLowerCase() === wanted).length];
  }
  return walk(data, key);
}

/** Accept an object or a JSON string (```json fences from an LLM are fine). */
export function parseContent(content: unknown): Data {
  if (isObj(content)) return content;
  const text = String(content).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed: unknown = JSON.parse(text);
  if (!isObj(parsed)) throw new Error("the content must be a JSON object");
  return parsed;
}

const runText = (r: string): string => [...r.matchAll(TEXT_RE())].map(m => xmlUnescape(m[2] || "")).join("");

function setRunText(runXml: string, text: string): string {
  let done = false;
  return runXml.replace(TEXT_RE(), () => {
    if (done) return "";
    done = true;
    return "<a:t>" + xmlEscape(text) + "</a:t>";
  });
}

/** Replace character ranges of a paragraph's joined text, mapping them back onto its runs. */
function spliceRuns(p: string, runs: RegExpMatchArray[], texts: string[], edits: { start: number; end: number; rep: string }[]): string {
  const bounds: [number, number][] = [];
  let pos = 0;
  for (const t of texts) { bounds.push([pos, pos + t.length]); pos += t.length; }
  const nt = texts.slice();
  for (const { start, end, rep } of edits) {
    let first = true;
    bounds.forEach(([rs, re], i) => {
      if (re <= start || rs >= end) return;
      const a = Math.max(start, rs) - rs, b = Math.min(end, re) - rs;
      nt[i] = nt[i]!.slice(0, a) + (first ? rep : "") + nt[i]!.slice(b);
      first = false;
    });
  }
  let out = "", last = 0;
  runs.forEach((r, i) => {
    out += p.slice(last, r.index) + (texts[i] === nt[i] ? r[0] : setRunText(r[0], nt[i]!));
    last = r.index! + r[0].length;
  });
  return out + p.slice(last);
}

function fillParagraph(p: string, data: Data, report: Report): string {
  const runs = [...p.matchAll(RUN_RE())];
  if (!runs.length) return p;
  const texts = runs.map(r => runText(r[0]));
  const full = texts.join("");
  if (!full.includes("{{")) return p;
  const matches = [...full.matchAll(PH())];
  if (!matches.length) return p;

  // Only "{{key}}" in the paragraph and the value is a list -> one paragraph per item.
  if (matches.length === 1 && full.trim() === matches[0]![0]) {
    const key = matches[0]![1]!;
    let [found, value] = lookup(data, key);
    if (found && typeof value === "string" && value.trim().includes("\n"))
      value = value.trim().split(NEWLINE_RE).filter(x => x.trim());
    if (found && Array.isArray(value)) {
      report.replaced.add(key);
      const items = value.length ? value.map(toText) : [""];
      const lastRun = runs[runs.length - 1]!;
      const start = runs[0]!.index!, end = lastRun.index! + lastRun[0].length;
      return items.map(it => p.slice(0, start) + setRunText(runs[0]![0], it) + p.slice(end)).join("");
    }
  }

  const edits = matches.slice().reverse().map(m => {
    const key = m[1]!;
    const [found, value] = lookup(data, key);
    (found ? report.replaced : report.missing).add(key);
    return { start: m.index!, end: m.index! + m[0].length, rep: found ? toText(value) : "" };
  });
  return spliceRuns(p, runs, texts, edits);
}

const fillParagraphs = (xml: string, data: Data, report: Report): string =>
  xml.replace(PARA_RE(), m => fillParagraph(m, data, report));

export const visibleText = (xml: string): string => [...xml.matchAll(RUN_RE())].map(r => runText(r[0])).join("");

function colourCell(cell: string, rules: ColourRule[]): string {
  const text = visibleText(cell).trim().toLowerCase();
  const rule = text ? rules.find(r => String(r.match || "").trim().toLowerCase() === text) : undefined;
  if (!rule || !(HEX_RE.test(String(rule.fill)) && HEX_RE.test(String(rule.text)))) return cell;
  const fill = `<a:solidFill><a:srgbClr val="${rule.fill}"/></a:solidFill>`;
  const color = `<a:solidFill><a:srgbClr val="${rule.text}"/></a:solidFill>`;
  if (cell.includes("<a:tcPr")) {
    cell = cell.replace(/(<a:tcPr(?:\s[^>]*)?>)(.*?)<\/a:tcPr>|<a:tcPr(?:\s[^>]*)?\/>/s, (whole: string, open?: string, body?: string) => {
      open = open || whole.slice(0, -2) + ">";
      body = body || "";
      // Borders carry their own solidFill, so set them aside before swapping the cell fill.
      const borders = [...body.matchAll(BORDER_RE())].map(b => b[0]).join("");
      const rest = body.replace(BORDER_RE(), "").replace(FILL_RE(), "").trim();
      return open + borders + fill + rest + "</a:tcPr>";
    });
  } else {
    cell = cell.replace("</a:tc>", "<a:tcPr>" + fill + "</a:tcPr></a:tc>");
  }
  return cell.replace(RUN_RE(), r => {
    if (r.includes("<a:rPr")) {
      return r.replace(/<a:rPr([^>]*?)(?:\/>|>(.*?)<\/a:rPr>)/s, (_: string, attrs: string, body?: string) => {
        body = body || "";
        attrs = attrs.replace(/\sb="[^"]*"/g, "") + ' b="1"';
        const ln = body.match(LN_RE());
        const lnXml = ln ? ln[0] : "";
        const rest = lnXml ? body.replace(lnXml, "") : body;
        return `<a:rPr${attrs}>${lnXml}${color}${rest.replace(FILL_RE(), "")}</a:rPr>`;
      });
    }
    return r.replace("<a:r>", `<a:r><a:rPr b="1">${color}</a:rPr>`);
  });
}

function fillTable(tbl: string, data: Data, report: Report, rules: ColourRule[]): string {
  return tbl.replace(ROW_RE(), rowXml => {
    let ph = false, val = false;
    const out = rowXml.replace(CELL_RE(), c => {
      const hasPh = PH().test(visibleText(c));
      c = fillParagraphs(c, data, report);
      if (hasPh) { ph = true; val = val || !!visibleText(c).trim(); }
      return colourCell(c, rules);
    });
    return ph && !val ? "" : out;
  });
}

export function fillXml(xml: string, data: Data, report: Report, rules: ColourRule[]): string {
  xml = xml.replace(TBL_RE(), t => fillTable(t, data, report, rules));
  return fillParagraphs(xml, data, report);
}

/** Rewrites placeholders in place (used for renaming a field). fn(key) -> new text, or null to keep. */
export function rewritePlaceholders(xml: string, fn: (key: string) => string | null): string {
  return xml.replace(PARA_RE(), p => {
    const runs = [...p.matchAll(RUN_RE())];
    if (!runs.length) return p;
    const texts = runs.map(r => runText(r[0]));
    const full = texts.join("");
    if (!full.includes("{{")) return p;
    const edits: { start: number; end: number; rep: string }[] = [];
    for (const m of [...full.matchAll(PH())].reverse()) {
      const rep = fn(m[1]!);
      if (rep !== null && rep !== undefined) edits.push({ start: m.index!, end: m.index! + m[0].length, rep });
    }
    return spliceRuns(p, runs, texts, edits);
  });
}

export interface Scanned { key: string; alone: boolean }

/** Every placeholder in a slide, with whether it sits alone in its paragraph. */
export function scanPlaceholders(xml: string): Scanned[] {
  const found: Scanned[] = [];
  for (const pm of xml.matchAll(PARA_RE())) {
    const full = visibleText(pm[0]);
    const ms = [...full.matchAll(PH())];
    ms.forEach(m => found.push({ key: m[1]!, alone: ms.length === 1 && full.trim() === m[0] }));
  }
  return found;
}

export const isSlidePart = (name: string): boolean => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name);

/** Keys the engine reports as left blank. Unsent list rows (e.g. 3 of 5 table rows) are expected. */
export const reportableMissing = (report: Report): string[] =>
  [...report.missing].filter(k => !/\.\d+(\.|$)/.test(k)).sort();

export const newReport = (): Report => ({ replaced: new Set(), missing: new Set() });
