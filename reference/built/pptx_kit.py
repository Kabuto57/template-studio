#!/usr/bin/env python3
"""
pptx_kit.py - turn a PowerPoint template with {{placeholders}} into everything Dify needs.
Pure Python standard library (Python 3.8+). No installs, no internet, no editor.

QUICK START
    python pptx_kit.py
        Asks for your template, builds the kit, then keeps watching: every time you save
        the template (or fields.json) in PowerPoint/Notepad, the code and documents rebuild.

COMMANDS
    python pptx_kit.py build  my_template.pptx            build the kit once
    python pptx_kit.py watch  my_template.pptx            build, then rebuild on every save
    python pptx_kit.py fields my_template.pptx            list the {{fields}} in the template
    python pptx_kit.py fill   my_template.pptx data.json [out.pptx]
                                                          fill a deck directly from JSON

THE KIT FOLDER  (created next to the template as  <template name>_kit/)
    fill_pptx.py        Paste into a Dify Code node (Python 3). Input: content_json (String).
                        Outputs: pptx_base64, file_name, status, message (all String).
                        Also runs on a laptop: python fill_pptx.py data.json out.pptx
    fields.json         YOU EDIT THIS: description, max words, examples, allowed values for
                        each field; file name; table colour rules. Kept between rebuilds.
    example_body.json   The JSON the LLM should return.
    json_schema.json    Structured-output schema for the Dify LLM node (optional).
    llm_prompt.txt      System prompt for the Dify LLM node.
    test_data.json      Optional. Put real LLM output here; preview.pptx will use it.
    preview.pptx        The template filled with test_data.json (or the example body).

PLACEHOLDER RULES (type these into the template in PowerPoint)
    {{report_title}}                text; keeps the font, size and colour you gave it
    {{key_highlights}}              alone in a paragraph + a list in the JSON -> one bullet per item
    {{client.name}}                 a group: {"client": {"name": "..."}}
    {{findings.1.title}}            item 1 of a list; put .1., .2., .3. in table rows
                                    -> {"findings": [{"title": "..."}, ...]}; unused rows are removed
    {{count:findings}}              number of items (calculated, not in the JSON)
    {{count:findings.risk=High}}    number of items whose risk is High (calculated)
"""

# =========================================================================== ENGINE START
#   Everything from here to ENGINE END is copied into every fill_pptx.py this kit writes.
import base64
import io
import json
import re
import sys
import zipfile

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
        elif isinstance(cur, list) and part.isdigit() and 1 <= int(part) <= len(cur):
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
    if isinstance(value, float) and value.is_integer():
        value = int(value)
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
            value = [x for x in value.strip().splitlines() if x.strip()]
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


# =========================================================================== ENGINE END

ENGINE_CLI = r'''# =========================================================================== command line (your laptop)

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
'''

import os
import time
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

PROJECT = {"settings": {}}   # the engine reads colour rules / file name from here
TEMPLATE_B64 = ""

NS_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
NS_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
LISTY = re.compile(r"(highlights|bullets|points|steps|items|agenda|actions|takeaways|lines|list|"
                   r"recommendations|risks|issues|tasks|goals|objectives)$", re.I)
HELP = {
    "read_me": "Edit the values below, save, and the kit rebuilds. Keys come from the {{fields}} in the template.",
    "type": "text or list (list = one bullet per item; only for a field alone in its paragraph)",
    "desc": "what the LLM should write there",
    "max": "maximum words (number), or leave empty",
    "example": "example value; for lists and table rows put one item per line using \\n",
    "allowed": "comma-separated allowed values, e.g. High, Medium, Low",
    "colour_rules": 'table cells whose whole text matches get these colours, e.g. '
                    '{"match": "High", "fill": "FADBD8", "text": "A93226"}',
}


# =========================================================================== reading the template


def resolve(base, target):
    parts = base.split("/")[:-1]
    for seg in target.split("/"):
        if seg == "..":
            if parts:
                parts.pop()
        elif seg not in (".", ""):
            parts.append(seg)
    return "/".join(parts)


def rels_of(z, part):
    rel_path = re.sub(r"([^/]+)$", r"_rels/\1.rels", part)
    if rel_path not in z.namelist():
        return {}
    out = {}
    for r in ET.fromstring(z.read(rel_path)):
        if r.get("TargetMode") == "External":
            continue
        out[r.get("Id")] = (r.get("Type", "").rsplit("/", 1)[-1], resolve(part, r.get("Target", "")))
    return out


def slide_parts(z):
    """Slide and notes XML parts in presentation order."""
    pres = ET.fromstring(z.read("ppt/presentation.xml"))
    rels = rels_of(z, "ppt/presentation.xml")
    parts = []
    lst = pres.find(NS_P + "sldIdLst")
    for sid in (list(lst) if lst is not None else []):
        rid = sid.get(NS_R + "id")
        if rid not in rels:
            continue
        slide = rels[rid][1]
        parts.append(slide)
        for typ, target in rels_of(z, slide).values():
            if typ == "notesSlide" and target in z.namelist():
                parts.append(target)
    return parts


def scan_fields(template_bytes):
    """Every {{placeholder}} in order of appearance, with whether it is alone in its paragraph."""
    seen = {}
    with zipfile.ZipFile(io.BytesIO(template_bytes)) as z:
        for part in slide_parts(z):
            xml = z.read(part).decode("utf-8")
            for pm in PARA_RE.finditer(xml):
                full = visible_text(pm.group(0))
                ms = list(PLACEHOLDER_RE.finditer(full))
                for m in ms:
                    alone = len(ms) == 1 and full.strip() == m.group(0)
                    key = m.group(1)
                    if key not in seen:
                        seen[key] = {"key": key, "alone": alone}
                    elif not alone:
                        seen[key]["alone"] = False
    return list(seen.values())


# =========================================================================== the field model


def build_model(scanned):
    entries, by_name, calc = [], {}, []

    def add(e):
        entries.append(e)
        by_name[e["name"]] = e
        return e

    for f in scanned:
        key, alone = f["key"], f["alone"]
        if key.startswith("count:"):
            calc.append(key)
            continue
        parts = key.split(".")
        ni = next((i for i, p in enumerate(parts) if i > 0 and p.isdigit()), -1)
        if ni > 0:
            name, n, sub = ".".join(parts[:ni]), int(parts[ni]), ".".join(parts[ni + 1:])
            e = by_name.get(name)
            if not e or e["kind"] != "array":
                e = add({"kind": "array", "name": name, "max": 0, "children": [], "scalar": not sub})
            e["max"] = max(e["max"], n)
            if sub and sub not in e["children"]:
                e["children"].append(sub)
            if sub:
                e["scalar"] = False
        elif len(parts) > 1:
            name = parts[0]
            e = by_name.get(name)
            if not e or e["kind"] != "object":
                e = add({"kind": "object", "name": name, "children": []})
            sub = ".".join(parts[1:])
            if not any(c["sub"] == sub for c in e["children"]):
                e["children"].append({"sub": sub, "path": key, "alone": alone})
        elif key not in by_name:
            add({"kind": "field", "name": key, "path": key, "alone": alone})
    return {"entries": entries, "calc": calc}


def cfg(project, key):
    return project.get("fields", {}).get(key) or {}


def humanize(k):
    s = re.sub(r"[_\-.]+", " ", str(k)).strip()
    return s[0].upper() + s[1:] if s else k


def lines(s):
    return [x.strip() for x in re.split(r"\r?\n", str(s or "")) if x.strip()]


def allowed_of(c):
    return [s.strip() for s in str(c.get("allowed") or "").split(",") if s.strip()]


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return int(f) if f.is_integer() else f


def field_type(project, e):
    t = cfg(project, e["path"]).get("type")
    if t in ("text", "list"):
        return t
    return "list" if e["alone"] and LISTY.search(e["name"]) else "text"


def set_deep(obj, path, v):
    ps = path.split(".")
    o = obj
    for p in ps[:-1]:
        if not isinstance(o.get(p), dict):
            o[p] = {}
        o = o[p]
    o[ps[-1]] = v


def example_value(project, key, typ, label):
    c = cfg(project, key)
    if typ == "list":
        ls = lines(c.get("example"))
        return ls if ls else ["%s 1" % label, "%s 2" % label]
    ex = str(c.get("example") or "").strip()
    al = allowed_of(c)
    return ex or (al[0] if al else label)


def build_example(project, model):
    out = {}
    for e in model["entries"]:
        if e["kind"] == "field":
            out[e["name"]] = example_value(project, e["path"], field_type(project, e), humanize(e["name"]))
        elif e["kind"] == "object":
            o = {}
            for c in e["children"]:
                set_deep(o, c["sub"], example_value(project, c["path"], "text", humanize(c["sub"])))
            out[e["name"]] = o
        elif e["scalar"]:
            ls = lines(cfg(project, e["name"] + "[]").get("example"))
            h = humanize(e["name"])
            out[e["name"]] = (ls or ["%s 1" % h, "%s 2" % h])[:e["max"]]
        else:
            per = [lines(cfg(project, "%s[].%s" % (e["name"], sub)).get("example")) for sub in e["children"]]
            count = min(e["max"], max([2] + [len(l) for l in per]))
            items = []
            for i in range(count):
                it = {}
                for k, sub in enumerate(e["children"]):
                    ls = per[k]
                    al = allowed_of(cfg(project, "%s[].%s" % (e["name"], sub)))
                    if ls:
                        v = ls[min(i, len(ls) - 1)]
                    else:
                        v = al[i % len(al)] if al else "%s %d" % (humanize(sub), i + 1)
                    set_deep(it, sub, v)
                items.append(it)
            out[e["name"]] = items
    return out


def describe(project, key, each=False):
    c = cfg(project, key)
    bits = []
    d = str(c.get("desc") or "").strip()
    if d:
        bits.append(re.sub(r"\.$", "", d))
    al = allowed_of(c)
    if al:
        bits.append("one of: " + ", ".join(al))
    if num(c.get("max")) > 0:
        bits.append("max %s words%s" % (num(c.get("max")), " each" if each else ""))
    return "; ".join(bits)


def schema_for(project, key, typ):
    d = describe(project, key, typ == "list")
    al = allowed_of(cfg(project, key))
    s = {"type": "array", "items": {"type": "string"}} if typ == "list" else {"type": "string"}
    if al and typ != "list":
        s["enum"] = al
    if d:
        s["description"] = d
    return s


def nest_props(target, sub, sch):
    ps = sub.split(".")
    o = target
    for p in ps[:-1]:
        o.setdefault(p, {"type": "object", "properties": {}, "required": []})
        o[p].setdefault("properties", {})
        o = o[p]["properties"]
    o[ps[-1]] = sch


def build_schema(project, model):
    props, req = {}, []
    for e in model["entries"]:
        req.append(e["name"])
        if e["kind"] == "field":
            props[e["name"]] = schema_for(project, e["path"], field_type(project, e))
        elif e["kind"] == "object":
            p = {}
            for c in e["children"]:
                nest_props(p, c["sub"], schema_for(project, c["path"], "text"))
            props[e["name"]] = {"type": "object", "properties": p, "required": list(p)}
        elif e["scalar"]:
            props[e["name"]] = {"type": "array", "maxItems": e["max"], "items": {"type": "string"}}
            d = describe(project, e["name"] + "[]", True)
            if d:
                props[e["name"]]["description"] = d
        else:
            p = {}
            for sub in e["children"]:
                nest_props(p, sub, schema_for(project, "%s[].%s" % (e["name"], sub), "text"))
            props[e["name"]] = {"type": "array", "minItems": 1, "maxItems": e["max"],
                                "items": {"type": "object", "properties": p, "required": list(p)}}
            d = describe(project, e["name"] + "[]")
            if d:
                props[e["name"]]["description"] = d
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": project.get("name") or "Presentation",
            "type": "object", "properties": props, "required": req, "additionalProperties": False}


def build_prompt(project, model):
    def hint(key, typ, label):
        return describe(project, key, typ == "list") or label.lower()

    skel, notes = {}, []
    for e in model["entries"]:
        if e["kind"] == "field":
            t = field_type(project, e)
            h = hint(e["path"], t, humanize(e["name"]))
            skel[e["name"]] = [h] if t == "list" else h
            if t == "list":
                notes.append("- %s: a list; each item becomes its own bullet or line." % e["name"])
        elif e["kind"] == "object":
            o = {}
            for c in e["children"]:
                set_deep(o, c["sub"], hint(c["path"], "text", humanize(c["sub"])))
            skel[e["name"]] = o
        elif e["scalar"]:
            skel[e["name"]] = [hint(e["name"] + "[]", "list", humanize(e["name"]))]
            notes.append("- %s: up to %d items." % (e["name"], e["max"]))
        else:
            it = {}
            for sub in e["children"]:
                set_deep(it, sub, hint("%s[].%s" % (e["name"], sub), "text", humanize(sub)))
            skel[e["name"]] = [it]
            d = str(cfg(project, e["name"] + "[]").get("desc") or "").strip()
            notes.append("- %s: 1 to %d items (the slide has room for %d)%s." % (
                e["name"], e["max"], e["max"], ("; " + re.sub(r"\.$", "", d)) if d else ""))
    parts = [
        'You fill in the PowerPoint template "%s". Turn the information you are given into the JSON object below.'
        % (project.get("name") or "Presentation"),
        "",
        "Output ONLY the JSON object: no explanation, no markdown fences.",
        "Use plain text in every value (no markdown, no bullet symbols, no numbering).",
        "Keep to the length limits; text does not shrink to fit the slide.",
        'Only use facts from the information provided. If something is missing, write "To be confirmed" instead of inventing it.',
        "",
        json.dumps(skel, indent=2, ensure_ascii=False),
    ]
    if notes:
        parts += ["", "Notes:"] + notes
    extra = str(project.get("prompt_extra") or "").strip()
    if extra:
        parts += ["", extra]
    parts += ["", "Information to use:", "{{#sys.query#}}"]
    return "\n".join(parts)


def py_header(project, model):
    rows = []
    for e in model["entries"]:
        if e["kind"] == "field":
            rows.append((e["name"], "list of text" if field_type(project, e) == "list" else "text", describe(project, e["path"])))
        elif e["kind"] == "object":
            for c in e["children"]:
                rows.append((c["path"], "text", describe(project, c["path"])))
        elif e["scalar"]:
            rows.append((e["name"], "list (up to %d)" % e["max"], describe(project, e["name"] + "[]")))
        else:
            rows.append((e["name"], "list of up to %d items" % e["max"], describe(project, e["name"] + "[]")))
            for sub in e["children"]:
                rows.append(("  ." + sub, "text", describe(project, "%s[].%s" % (e["name"], sub))))
    for k in model["calc"]:
        rows.append((k, "calculated", "filled in automatically"))
    w = min(34, max([10] + [len(r[0]) for r in rows]))
    field_lines = [("    %s  %s%s" % (k.ljust(w), t, (" - " + d) if d else "")).replace('"""', "'''").replace("\\", "/")
                   for k, t, d in rows]
    name = (project.get("name") or "Presentation").replace('"""', "'''").replace("\\", "/")
    return "\n".join([
        '"""',
        "%s - fills the PowerPoint template with JSON." % name,
        "Generated by Template Studio on %s. Standard library only (Python 3.8+)." % date.today().isoformat(),
        "",
        "DIFY CODE NODE (Python 3)",
        "    Input variable:   content_json (String)  <- the LLM node's text output",
        "    Output variables: pptx_base64 (String), file_name (String), status (String), message (String)",
        "",
        "YOUR LAPTOP",
        "    python fill_pptx.py content.json [output.pptx]",
        "",
        "FIELDS",
    ] + field_lines + [
        "",
        "The template is embedded at the bottom (TEMPLATE_B64). To change it, edit it in",
        "Template Studio and copy the new code; open this file in Template Studio to keep editing.",
        '"""',
        "",
    ])


def own_engine_source():
    src = Path(__file__).read_text(encoding="utf-8")
    marker = "#   Everything from here to ENGINE END is copied into every fill_pptx.py this kit writes.\n"
    start = src.index(marker) + len(marker)
    end = src.index("# =========================================================================== ENGINE END")
    return src[start:end]


def recompress(template_bytes):
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(template_bytes)) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for item in zin.infolist():
            zout.writestr(item, zin.read(item.filename), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return out.getvalue()


def project_for_code(project):
    return {"name": project.get("name"), "settings": project.get("settings", {}),
            "fields": project.get("fields", {}), "prompt_extra": project.get("prompt_extra", "")}


def build_python(project, model, template_bytes):
    b64 = base64.b64encode(recompress(template_bytes)).decode("ascii")
    chunks = [b64[i:i + 100] for i in range(0, len(b64), 100)] or [""]
    constants = "\n".join([
        "# =========================================================================== template + settings (generated)",
        "",
        "PROJECT = json.loads(" + json.dumps(json.dumps(project_for_code(project))) + ")",
        "",
        "TEMPLATE_B64 = (",
    ] + ['    "%s"' % c for c in chunks] + [")", "", ""])
    return py_header(project, model) + own_engine_source() + constants + ENGINE_CLI


# =========================================================================== fields.json (settings)


def default_settings(name):
    return {"_help": HELP, "name": name, "settings": {"file_name_field": "", "colour_rules": []},
            "fields": {}, "prompt_extra": ""}


def read_settings(kit_dir, name, template_dir=None):
    f = kit_dir / "fields.json"
    if not f.exists() and template_dir is not None and (template_dir / "fields.json").exists():
        f = template_dir / "fields.json"   # e.g. a kit downloaded from the online editor
    if f.exists():
        data = json.loads(f.read_text(encoding="utf-8"))
        data.setdefault("settings", {}).setdefault("colour_rules", [])
        data["settings"].setdefault("file_name_field", "")
        data.setdefault("fields", {})
        data.setdefault("name", name)
        return data
    # no fields.json yet: take settings from a fill_pptx.py made by the online editor, if present
    code = kit_dir / "fill_pptx.py"
    if not code.exists() and template_dir is not None:
        code = template_dir / "fill_pptx.py"
    if code.exists():
        m = re.search(r'^PROJECT = json\.loads\((".*")\)\s*$', code.read_text(encoding="utf-8"), re.M)
        if m:
            p = json.loads(json.loads(m.group(1)))
            s = default_settings(p.get("name") or name)
            s.update({k: p[k] for k in ("settings", "fields", "prompt_extra") if k in p})
            return s
    return default_settings(name)


def field_keys(project, model):
    """Every settings key the template uses, with a starter entry."""
    out = []
    for e in model["entries"]:
        if e["kind"] == "field":
            out.append((e["path"], {"type": field_type(project, e), "desc": "", "max": "", "example": "", "allowed": ""}))
        elif e["kind"] == "object":
            for c in e["children"]:
                out.append((c["path"], {"desc": "", "max": "", "example": "", "allowed": ""}))
        elif e["scalar"]:
            out.append((e["name"] + "[]", {"desc": "", "max": "", "example": ""}))
        else:
            out.append((e["name"] + "[]", {"desc": ""}))
            for sub in e["children"]:
                out.append(("%s[].%s" % (e["name"], sub), {"desc": "", "max": "", "example": "", "allowed": ""}))
    return out


def merge_settings(project, model):
    """Add new fields, keep what you wrote, park fields no longer in the template."""
    fields = project.get("fields", {})
    unused = project.get("_unused_fields", {})
    merged = {}
    for key, starter in field_keys(project, model):
        cur = fields.get(key) or unused.pop(key, None) or {}
        entry = dict(starter)
        entry.update(cur)
        merged[key] = entry
    for key, val in fields.items():
        if key not in merged:
            unused[key] = val
    project["fields"] = merged
    if unused:
        project["_unused_fields"] = unused
    else:
        project.pop("_unused_fields", None)
    s = project["settings"]
    if not s.get("file_name_field"):
        title = next((e["path"] for e in model["entries"] if e["kind"] == "field" and "title" in e["name"].lower()), "")
        s["file_name_field"] = title
    return project


# =========================================================================== commands


def kit_dir_for(template):
    return template.with_name(template.stem + "_kit")


def build(template, quiet=False):
    template = Path(template)
    template_bytes = template.read_bytes()
    kit = kit_dir_for(template)
    kit.mkdir(exist_ok=True)
    project = read_settings(kit, humanize(template.stem), template.parent)
    model = build_model(scan_fields(template_bytes))
    project = merge_settings(project, model)
    project["_help"] = HELP
    ordered = {"_help": HELP}
    ordered.update({k: v for k, v in project.items() if k != "_help"})
    (kit / "fields.json").write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    example = build_example(project, model)
    write = lambda name, text: (kit / name).write_text(text, encoding="utf-8", newline="\n")
    write("example_body.json", json.dumps(example, indent=2, ensure_ascii=False) + "\n")
    write("json_schema.json", json.dumps(build_schema(project, model), indent=2, ensure_ascii=False) + "\n")
    write("llm_prompt.txt", build_prompt(project, model) + "\n")
    write("fill_pptx.py", build_python(project, model, template_bytes))

    # preview deck: test_data.json if you made one, otherwise the example body
    data, source = example, "example_body.json"
    test = kit / "test_data.json"
    if test.exists():
        try:
            data, source = parse_content(test.read_text(encoding="utf-8")), "test_data.json"
        except Exception as exc:
            print("  test_data.json isn't valid JSON (%s); previewing the example instead." % exc)
    global PROJECT
    PROJECT = project_for_code(project)
    blob, missing = fill_pptx(data, template_bytes)
    preview = kit / "preview.pptx"
    try:
        preview.write_bytes(blob)
    except PermissionError:
        preview = kit / ("preview_%s.pptx" % time.strftime("%H%M%S"))
        preview.write_bytes(blob)
        print("  preview.pptx is open in PowerPoint, so this preview went to %s" % preview.name)

    n_fields = sum(1 if e["kind"] == "field" else max(1, len(e["children"])) for e in model["entries"])
    if not quiet:
        print("Built %s" % kit)
    print("  %d field%s, %d calculated | preview from %s%s" % (
        n_fields, "" if n_fields == 1 else "s", len(model["calc"]), source,
        (" | blank in preview: " + ", ".join(missing)) if missing else ""))
    return kit


def watch(template):
    template = Path(template)
    kit = kit_dir_for(template)

    def stamp():
        out = []
        for p in (template, kit / "fields.json", kit / "test_data.json"):
            try:
                out.append(p.stat().st_mtime)
            except OSError:
                out.append(None)
        return out

    build(template)
    last = stamp()
    print("Watching %s and %s (Ctrl+C to stop)..." % (template.name, kit / "fields.json"))
    try:
        while True:
            time.sleep(1)
            now = stamp()
            if now != last:
                time.sleep(0.6)  # let PowerPoint finish writing
                try:
                    print("%s  change detected, rebuilding" % time.strftime("%H:%M:%S"))
                    build(template, quiet=True)
                except (zipfile.BadZipFile, KeyError, OSError) as exc:
                    print("  couldn't read the template yet (%s); will retry on the next save." % exc)
                except Exception as exc:
                    print("  rebuild failed: %s" % exc)
                last = stamp()
    except KeyboardInterrupt:
        print("\nStopped watching.")


def list_fields(template):
    template_bytes = Path(template).read_bytes()
    model = build_model(scan_fields(template_bytes))
    project = read_settings(kit_dir_for(Path(template)), humanize(Path(template).stem), Path(template).parent)
    for e in model["entries"]:
        if e["kind"] == "field":
            print("  %-28s %s" % (e["name"], field_type(project, e)))
        elif e["kind"] == "object":
            for c in e["children"]:
                print("  %-28s text" % c["path"])
        else:
            print("  %-28s list of up to %d%s" % (e["name"], e["max"], "" if e["scalar"] else " items: " + ", ".join(e["children"])))
    for k in model["calc"]:
        print("  %-28s calculated" % k)
    if not model["entries"] and not model["calc"]:
        print("  No {{fields}} found. Type {{field_name}} into the template where content should go.")


def fill_direct(template, data_path, out_path=None):
    template = Path(template)
    project = read_settings(kit_dir_for(template), humanize(template.stem), template.parent)
    global PROJECT
    PROJECT = project_for_code(project)
    data = parse_content(Path(data_path).read_text(encoding="utf-8"))
    blob, missing = fill_pptx(data, template.read_bytes())
    out = Path(out_path) if out_path else template.with_name(output_name(data))
    out.write_bytes(blob)
    print("Saved %s" % out)
    if missing:
        print("Left blank (not in the JSON): %s" % ", ".join(missing))


def cli(argv):
    if not argv:
        print(__doc__.split("COMMANDS")[0].strip())
        path = input("\nPath to your template .pptx: ").strip().strip('"').strip("'")
        if not path:
            return
        return watch(path)
    cmd, args = argv[0].lower(), argv[1:]
    if cmd in ("build", "watch", "fields") and len(args) == 1:
        return {"build": build, "watch": watch, "fields": list_fields}[cmd](args[0])
    if cmd == "fill" and len(args) in (2, 3):
        return fill_direct(*args)
    if cmd.endswith(".pptx") and not args:
        return watch(argv[0])
    print(__doc__)


if __name__ == "__main__":
    try:
        cli(sys.argv[1:])
    except FileNotFoundError as exc:
        print("File not found: %s" % exc.filename)
    except zipfile.BadZipFile:
        print("That file isn't a .pptx PowerPoint file.")
