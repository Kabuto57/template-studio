import base64
import io
import json
import re
import sys
import zipfile
from decimal import Decimal

# =========================================================================== placeholder rules
#   {{key}}                       text (keeps the template's formatting)
#   {{key}} alone in a paragraph  + a list value -> one paragraph / bullet per item
#   {{client.name}}               nested object  {"client": {"name": ...}}
#   {{findings.2.title}}          item 2 of a list {"findings": [{...}, {"title": ...}]}
#   {{count:findings}}            number of items in the list (calculated)
#   {{count:findings.risk=High}}  number of items whose "risk" is High (calculated)
#   table rows                    a row whose placeholders all come out empty is removed
#   colour rules                  table cells whose text matches a rule get its colours

PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
PARA_RE = re.compile(r"<a:p(?:\s[^>]*)?>.*?</a:p>", re.S)
RUN_RE = re.compile(r"<a:r(?:\s[^>]*)?>.*?</a:r>", re.S)
TEXT_RE = re.compile(r"(<a:t(?:\s[^>]*)?>)(.*?)(</a:t>)|<a:t\s*/>", re.S)
ROW_RE = re.compile(r"<a:tr(?:\s[^>]*)?>.*?</a:tr>", re.S)
CELL_RE = re.compile(r"<a:tc(?:\s[^>]*)?>.*?</a:tc>", re.S)
TBL_RE = re.compile(r"<a:tbl>.*?</a:tbl>", re.S)
BORDER_RE = re.compile(r"<a:(ln[LRTB]|lnTlToBr|lnBlToTr)\b(?:[^>]*/>|.*?</a:\1>)", re.S)
FILL_RE = re.compile(r"<a:(solidFill|noFill|gradFill|pattFill|blipFill|grpFill)\b(?:[^>]*/>|.*?</a:\1>)", re.S)
LN_RE = re.compile(r"<a:ln\b(?:[^>]*/>|.*?</a:ln>)", re.S)
INDEX_RE = re.compile(r"[0-9]+\Z")
NEWLINE_RE = re.compile(r"\r\n|\n|\r")


def xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def xml_unescape(s):
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"&#([0-9]+);", lambda m: chr(int(m.group(1))), s)
    return (s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
             .replace("&apos;", "'").replace("&amp;", "&"))


# =========================================================================== values


def walk(data, path):
    """Follow 'a.b.2.c' through dicts and lists (list positions start at 1)."""
    if path in data:
        return True, data[path]
    cur = data
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and INDEX_RE.match(part) and 1 <= int(part) <= len(cur):
            cur = cur[int(part) - 1]
        else:
            return False, None
    return True, cur


def lookup(data, key):
    if key.startswith("count:"):
        expr = key[6:].strip()
        cond = None
        if "=" in expr:
            expr, wanted = expr.split("=", 1)
            if "." not in expr.strip():
                return False, None
            expr, field = expr.strip().rsplit(".", 1)
            cond = (field.strip(), wanted.strip().lower())
        found, items = walk(data, expr)
        if not found or not isinstance(items, list):
            return False, None
        if cond is None:
            return True, len(items)
        return True, sum(1 for it in items
                         if isinstance(it, dict) and to_text(it.get(cond[0])).strip().lower() == cond[1])
    return walk(data, key)


def to_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, tuple)):
        return ", ".join(to_text(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, float):
        # Plain digits, never "1e+21" or "5.0", so the result matches the browser preview.
        text = repr(value)
        if text.endswith(".0"):
            return text[:-2]
        return format(Decimal(text), "f") if "e" in text else text
    return str(value).replace("\r\n", "\n").replace("\n", " ")


def parse_content(content):
    """Accept a dict or a JSON string (```json fences from an LLM are fine)."""
    if isinstance(content, dict):
        return content
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(content).strip())
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("the content must be a JSON object")
    return parsed


# =========================================================================== XML text editing


def run_text(run_xml):
    return "".join(xml_unescape(m.group(2) or "") for m in TEXT_RE.finditer(run_xml))


def set_run_text(run_xml, text):
    done = [False]

    def repl(m):
        if done[0]:
            return ""
        done[0] = True
        return "<a:t>%s</a:t>" % xml_escape(text)

    return TEXT_RE.sub(repl, run_xml)


def fill_paragraph(p_xml, data, report):
    runs = list(RUN_RE.finditer(p_xml))
    if not runs:
        return p_xml
    texts = [run_text(r.group(0)) for r in runs]
    full = "".join(texts)
    if "{{" not in full:
        return p_xml
    matches = list(PLACEHOLDER_RE.finditer(full))
    if not matches:
        return p_xml

    # Only "{{key}}" in the paragraph and the value is a list -> one paragraph per item.
    if len(matches) == 1 and full.strip() == matches[0].group(0):
        key = matches[0].group(1)
        found, value = lookup(data, key)
        if found and isinstance(value, str) and "\n" in value.strip():
            value = [x for x in NEWLINE_RE.split(value.strip()) if x.strip()]
        if found and isinstance(value, (list, tuple)):
            report["replaced"].add(key)
            items = [to_text(v) for v in value] or [""]
            start, end = runs[0].start(), runs[-1].end()
            return "".join(p_xml[:start] + set_run_text(runs[0].group(0), it) + p_xml[end:] for it in items)

    bounds, pos = [], 0
    for t in texts:
        bounds.append((pos, pos + len(t)))
        pos += len(t)
    new_texts = list(texts)
    for m in reversed(matches):
        key = m.group(1)
        found, value = lookup(data, key)
        report["replaced" if found else "missing"].add(key)
        replacement = to_text(value) if found else ""
        first = True
        for i, (rs, re_) in enumerate(bounds):
            if re_ <= m.start() or rs >= m.end():
                continue
            a, b = max(m.start(), rs) - rs, min(m.end(), re_) - rs
            new_texts[i] = new_texts[i][:a] + (replacement if first else "") + new_texts[i][b:]
            first = False

    out, last = [], 0
    for r, old, new in zip(runs, texts, new_texts):
        out.append(p_xml[last:r.start()])
        out.append(r.group(0) if old == new else set_run_text(r.group(0), new))
        last = r.end()
    out.append(p_xml[last:])
    return "".join(out)


def fill_paragraphs(xml, data, report):
    return PARA_RE.sub(lambda m: fill_paragraph(m.group(0), data, report), xml)


def visible_text(xml):
    return "".join(run_text(r.group(0)) for r in RUN_RE.finditer(xml))


def colour_cell(cell_xml, rules):
    text = visible_text(cell_xml).strip().lower()
    rule = next((r for r in rules if str(r.get("match", "")).strip().lower() == text and text), None)
    if not rule:
        return cell_xml
    fill = '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % rule["fill"]
    color = '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % rule["text"]

    def tcpr(m):
        open_tag = m.group(1) or m.group(0)[:-2] + ">"
        body = m.group(2) or ""
        borders = "".join(b.group(0) for b in BORDER_RE.finditer(body))
        rest = FILL_RE.sub("", BORDER_RE.sub("", body)).strip()
        return open_tag + borders + fill + rest + "</a:tcPr>"

    if "<a:tcPr" in cell_xml:
        cell_xml = re.sub(r"(<a:tcPr(?:\s[^>]*)?>)(.*?)</a:tcPr>|<a:tcPr(?:\s[^>]*)?/>", tcpr, cell_xml, count=1, flags=re.S)
    else:
        cell_xml = cell_xml.replace("</a:tc>", "<a:tcPr>" + fill + "</a:tcPr></a:tc>")

    def rpr(m):
        attrs, body = m.group(1), m.group(2) or ""
        attrs = re.sub(r'\sb="[^"]*"', "", attrs) + ' b="1"'
        ln = LN_RE.search(body)
        ln_xml = ln.group(0) if ln else ""
        rest = body.replace(ln_xml, "", 1) if ln_xml else body
        return "<a:rPr%s>%s%s%s</a:rPr>" % (attrs, ln_xml, color, FILL_RE.sub("", rest))

    def run(m):
        r = m.group(0)
        if "<a:rPr" in r:
            return re.sub(r"<a:rPr([^>]*?)(?:/>|>(.*?)</a:rPr>)", rpr, r, count=1, flags=re.S)
        return r.replace("<a:r>", '<a:r><a:rPr b="1">%s</a:rPr>' % color, 1)

    return RUN_RE.sub(run, cell_xml)


def fill_table(tbl_xml, data, report, rules):
    def row(m):
        state = {"ph": False, "value": False}

        def cell(cm):
            c = cm.group(0)
            has_ph = bool(PLACEHOLDER_RE.search(visible_text(c)))
            c = fill_paragraphs(c, data, report)
            if has_ph:
                state["ph"] = True
                state["value"] = state["value"] or bool(visible_text(c).strip())
            return colour_cell(c, rules)

        row_xml = CELL_RE.sub(cell, m.group(0))
        return "" if state["ph"] and not state["value"] else row_xml

    return ROW_RE.sub(row, tbl_xml)


def fill_xml(xml, data, report, rules):
    xml = TBL_RE.sub(lambda m: fill_table(m.group(0), data, report, rules), xml)
    return fill_paragraphs(xml, data, report)


# =========================================================================== pptx


def fill_pptx(data, template_bytes=None):
    """Fill the template. Returns (pptx_bytes, missing_keys)."""
    if template_bytes is None:
        template_bytes = base64.b64decode("".join(TEMPLATE_B64))
    rules = PROJECT.get("settings", {}).get("colour_rules", [])
    report = {"replaced": set(), "missing": set()}
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(template_bytes)) as zin, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)
            if re.match(r"ppt/(slides/slide|notesSlides/notesSlide)\d+\.xml$", item.filename):
                content = fill_xml(content.decode("utf-8"), data, report, rules).encode("utf-8")
            zout.writestr(item, content, compress_type=zipfile.ZIP_DEFLATED)
    # list items that weren't sent (e.g. 3 of 5 table rows) are expected, so don't report them
    missing = sorted(k for k in report["missing"] if not re.search(r"\.\d+(\.|$)", k))
    return out.getvalue(), missing


def output_name(data):
    field = PROJECT.get("settings", {}).get("file_name_field") or ""
    found, value = walk(data, field) if field else (False, None)
    name = re.sub(r"[^A-Za-z0-9_\-]+", "_", to_text(value) if found else "").strip("_")[:60]
    fallback = re.sub(r"[^A-Za-z0-9_\-]+", "_", str(PROJECT.get("name") or "")).strip("_")[:60]
    return (name or fallback or "presentation") + ".pptx"


# =========================================================================== Dify Code node entry


def main(content_json: str) -> dict:
    try:
        data = parse_content(content_json)
        blob, missing = fill_pptx(data)
    except Exception as exc:
        return {"pptx_base64": "", "file_name": "", "status": "error",
                "message": "Could not build the presentation: %s" % exc}
    return {
        "pptx_base64": base64.b64encode(blob).decode("ascii"),
        "file_name": output_name(data),
        "status": "success",
        "message": ("Left blank (not in the JSON): " + ", ".join(missing)) if missing else "All fields filled.",
    }


# =========================================================================== command line (your laptop)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python %s <content.json> [output.pptx]" % sys.argv[0])
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        body = json.load(f)
    data = parse_content(body.get("content_json", body) if isinstance(body, dict) else body)
    blob, missing = fill_pptx(data)
    out_path = sys.argv[2] if len(sys.argv) > 2 else output_name(data)
    with open(out_path, "wb") as f:
        f.write(blob)
    print("Saved", out_path)
    if missing:
        print("Left blank (not in the JSON):", ", ".join(missing))
