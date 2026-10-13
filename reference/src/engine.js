// Fill engine — a line-for-line port of engine.py so the browser preview and the
// generated Python produce the same slides.
const Engine = (() => {
  const PH = () => /\{\{\s*([^{}]+?)\s*\}\}/g;
  const PARA_RE = () => /<a:p(?:\s[^>]*)?>.*?<\/a:p>/gs;
  const RUN_RE = () => /<a:r(?:\s[^>]*)?>.*?<\/a:r>/gs;
  const TEXT_RE = () => /(<a:t(?:\s[^>]*)?>)(.*?)(<\/a:t>)|<a:t\s*\/>/gs;
  const ROW_RE = () => /<a:tr(?:\s[^>]*)?>.*?<\/a:tr>/gs;
  const CELL_RE = () => /<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs;
  const TBL_RE = () => /<a:tbl>.*?<\/a:tbl>/gs;
  const BORDER_RE = () => /<a:(ln[LRTB]|lnTlToBr|lnBlToTr)\b(?:[^>]*\/>|.*?<\/a:\1>)/gs;
  const FILL_RE = () => /<a:(solidFill|noFill|gradFill|pattFill|blipFill|grpFill)\b(?:[^>]*\/>|.*?<\/a:\1>)/gs;
  const LN_RE = () => /<a:ln\b(?:[^>]*\/>|.*?<\/a:ln>)/s;

  const xmlEscape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xmlUnescape = s => s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

  function walk(data, path) {
    if (has(data, path)) return [true, data[path]];
    let cur = data;
    for (const part of path.split(".")) {
      if (has(cur, part)) cur = cur[part];
      else if (Array.isArray(cur) && /^\d+$/.test(part) && +part >= 1 && +part <= cur.length) cur = cur[+part - 1];
      else return [false, null];
    }
    return [true, cur];
  }

  function toText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.map(toText).join(", ");
    if (isObj(v)) return JSON.stringify(v);
    return String(v).replace(/\r\n/g, "\n").replace(/\n/g, " ");
  }

  function lookup(data, key) {
    if (key.startsWith("count:")) {
      let expr = key.slice(6).trim(), cond = null;
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
      return [true, items.filter(it => isObj(it) && toText(it[cond[0]]).trim().toLowerCase() === cond[1]).length];
    }
    return walk(data, key);
  }

  function parseContent(content) {
    if (isObj(content)) return content;
    const text = String(content).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const parsed = JSON.parse(text);
    if (!isObj(parsed)) throw new Error("the content must be a JSON object");
    return parsed;
  }

  const runText = r => [...r.matchAll(TEXT_RE())].map(m => xmlUnescape(m[2] || "")).join("");

  function setRunText(runXml, text) {
    let done = false;
    return runXml.replace(TEXT_RE(), () => {
      if (done) return "";
      done = true;
      return "<a:t>" + xmlEscape(text) + "</a:t>";
    });
  }

  function fillParagraph(p, data, report) {
    const runs = [...p.matchAll(RUN_RE())];
    if (!runs.length) return p;
    const texts = runs.map(r => runText(r[0]));
    const full = texts.join("");
    if (!full.includes("{{")) return p;
    const matches = [...full.matchAll(PH())];
    if (!matches.length) return p;

    if (matches.length === 1 && full.trim() === matches[0][0]) {
      const key = matches[0][1];
      let [found, value] = lookup(data, key);
      if (found && typeof value === "string" && value.trim().includes("\n"))
        value = value.trim().split(/\r\n|\n|\r/).filter(x => x.trim());
      if (found && Array.isArray(value)) {
        report.replaced.add(key);
        const items = value.length ? value.map(toText) : [""];
        const start = runs[0].index, end = runs[runs.length - 1].index + runs[runs.length - 1][0].length;
        return items.map(it => p.slice(0, start) + setRunText(runs[0][0], it) + p.slice(end)).join("");
      }
    }

    const bounds = []; let pos = 0;
    for (const t of texts) { bounds.push([pos, pos + t.length]); pos += t.length; }
    const nt = texts.slice();
    for (const m of matches.slice().reverse()) {
      const key = m[1];
      const [found, value] = lookup(data, key);
      (found ? report.replaced : report.missing).add(key);
      const rep = found ? toText(value) : "";
      const ms = m.index, me = m.index + m[0].length;
      let first = true;
      bounds.forEach(([rs, re_], i) => {
        if (re_ <= ms || rs >= me) return;
        const a = Math.max(ms, rs) - rs, b = Math.min(me, re_) - rs;
        nt[i] = nt[i].slice(0, a) + (first ? rep : "") + nt[i].slice(b);
        first = false;
      });
    }
    let out = "", last = 0;
    runs.forEach((r, i) => {
      out += p.slice(last, r.index) + (texts[i] === nt[i] ? r[0] : setRunText(r[0], nt[i]));
      last = r.index + r[0].length;
    });
    return out + p.slice(last);
  }

  const fillParagraphs = (xml, data, report) => xml.replace(PARA_RE(), m => fillParagraph(m, data, report));
  const visibleText = xml => [...xml.matchAll(RUN_RE())].map(r => runText(r[0])).join("");

  function colourCell(cell, rules) {
    const text = visibleText(cell).trim().toLowerCase();
    const rule = text && rules.find(r => String(r.match || "").trim().toLowerCase() === text);
    if (!rule) return cell;
    const fill = `<a:solidFill><a:srgbClr val="${rule.fill}"/></a:solidFill>`;
    const color = `<a:solidFill><a:srgbClr val="${rule.text}"/></a:solidFill>`;
    if (cell.includes("<a:tcPr")) {
      cell = cell.replace(/(<a:tcPr(?:\s[^>]*)?>)(.*?)<\/a:tcPr>|<a:tcPr(?:\s[^>]*)?\/>/s, (whole, open, body) => {
        open = open || whole.slice(0, -2) + ">";
        body = body || "";
        const borders = [...body.matchAll(BORDER_RE())].map(b => b[0]).join("");
        const rest = body.replace(BORDER_RE(), "").replace(FILL_RE(), "").trim();
        return open + borders + fill + rest + "</a:tcPr>";
      });
    } else {
      cell = cell.replace("</a:tc>", "<a:tcPr>" + fill + "</a:tcPr></a:tc>");
    }
    return cell.replace(RUN_RE(), r => {
      if (r.includes("<a:rPr")) {
        return r.replace(/<a:rPr([^>]*?)(?:\/>|>(.*?)<\/a:rPr>)/s, (_, attrs, body) => {
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

  function fillTable(tbl, data, report, rules) {
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

  function fillXml(xml, data, report, rules) {
    xml = xml.replace(TBL_RE(), t => fillTable(t, data, report, rules));
    return fillParagraphs(xml, data, report);
  }

  // Rewrites placeholders in place (used for renaming a field). fn(key) -> new text or null to keep.
  function rewritePlaceholders(xml, fn) {
    return xml.replace(PARA_RE(), p => {
      const runs = [...p.matchAll(RUN_RE())];
      if (!runs.length) return p;
      const texts = runs.map(r => runText(r[0]));
      const full = texts.join("");
      if (!full.includes("{{")) return p;
      const bounds = []; let pos = 0;
      for (const t of texts) { bounds.push([pos, pos + t.length]); pos += t.length; }
      const nt = texts.slice();
      for (const m of [...full.matchAll(PH())].reverse()) {
        const rep = fn(m[1]);
        if (rep === null || rep === undefined) continue;
        const ms = m.index, me = m.index + m[0].length;
        let first = true;
        bounds.forEach(([rs, re_], i) => {
          if (re_ <= ms || rs >= me) return;
          const a = Math.max(ms, rs) - rs, b = Math.min(me, re_) - rs;
          nt[i] = nt[i].slice(0, a) + (first ? rep : "") + nt[i].slice(b);
          first = false;
        });
      }
      let out = "", last = 0;
      runs.forEach((r, i) => {
        out += p.slice(last, r.index) + (texts[i] === nt[i] ? r[0] : setRunText(r[0], nt[i]));
        last = r.index + r[0].length;
      });
      return out + p.slice(last);
    });
  }

  // Every placeholder in a slide, with whether it sits alone in its paragraph.
  function scanPlaceholders(xml) {
    const found = [];
    for (const pm of xml.matchAll(PARA_RE())) {
      const full = visibleText(pm[0]);
      const ms = [...full.matchAll(PH())];
      ms.forEach(m => found.push({ key: m[1], alone: ms.length === 1 && full.trim() === m[0] }));
    }
    return found;
  }

  const isSlidePart = name => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name);

  return { fillXml, lookup, walk, toText, parseContent, rewritePlaceholders, scanPlaceholders,
           visibleText, isSlidePart, xmlEscape, xmlUnescape, PH };
})();
if (typeof module !== "undefined") module.exports = Engine;
