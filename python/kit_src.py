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
/*__ENGINE_A__*/
# =========================================================================== ENGINE END

ENGINE_CLI = r'''/*__ENGINE_B__*/'''

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
        "PROJECT = json.loads(" + json.dumps(json.dumps(project_for_code(project), ensure_ascii=False, separators=(",", ":")), ensure_ascii=False) + ")",
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
