// The Fields panel: every field the template uses, draggable onto the slide, with the
// settings that tell the LLM what to write.
import { fieldUsage, renameField, usedRoots, type FieldPayload, type RenameScope } from "../ooxml/edit";
import { KEY_RE, allowedOf, fieldType, rootOf, type FieldConfig } from "../model/fields";
import { esc } from "../ooxml/xml";
import { $, el, toast } from "./dom";
import { makeDraggable } from "./stage";
import { S, clearSel, ui } from "./state";

const GLYPH: Record<string, string> = {
  text: '<svg viewBox="0 0 16 16"><path d="M3.5 4.5h9M8 4.5v8"/></svg>',
  list: '<svg viewBox="0 0 16 16"><path d="M6.5 5h6M6.5 8h6M6.5 11h4M3.5 5h.01M3.5 8h.01M3.5 11h.01"/></svg>',
  item: '<svg viewBox="0 0 16 16"><path d="M3 5.5h10M3 8h10M3 10.5h10M6.5 3v10"/></svg>',
  count: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5 4.5 12.5M10.5 3.5l-1 9M3 6.5h9.5M2.5 9.5H12"/></svg>',
  new: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>',
};

const cfg = (key: string): FieldConfig => (S.project.fields[key] ??= {});
const peek = (key: string): FieldConfig => S.project.fields[key] ?? {};
const placedRoots = (): Set<string> => new Set(S.deck.scan().map(f => rootOf(f.key)));

interface ChipOpts { cfgKey?: string; tag?: string; cls?: string; glyph?: string }
function chip(label: string, payload: FieldPayload, { cfgKey, tag = "", cls = "", glyph = "text" }: ChipOpts = {}): HTMLElement {
  const c = el("div", { class: `chip ${cls}`, tabindex: 0, role: "button", title: "Drag onto a text box or table cell" + (cfgKey ? ". Click to edit its settings." : ".") },
    `<span class="g">${(GLYPH[glyph] ?? GLYPH.text!)}</span><span class="k">${esc(label)}</span>${tag ? `<span class="t">${esc(tag)}</span>` : ""}`);
  if (cfgKey && S.selField === cfgKey) c.classList.add("sel");
  makeDraggable(c, { kind: "field", payload });
  const open = () => { if (cfgKey) ui.select({ obj: null, cell: null }, { field: cfgKey }); };
  c.addEventListener("click", open);
  c.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  return c;
}

export function renderFieldList(host: HTMLElement): void {
  host.replaceChildren();
  const m = S.model;
  for (const e of m.entries) {
    if (e.kind !== "field") continue;
    const list = fieldType(S.project, e) === "list";
    host.appendChild(chip(e.name, { key: e.path }, { cfgKey: e.path, glyph: list ? "list" : "text", tag: list ? "List" : "" }));
  }
  for (const e of m.entries) {
    if (e.kind === "field") continue;
    const g = el("div", { class: "fgroup" });
    if (e.kind === "object") {
      g.appendChild(el("div", { class: "fgroup-h" }, `<span>${esc(e.name)}</span><span>Group</span>`));
      e.children.forEach(c => g.appendChild(chip(c.sub, { key: c.path }, { cfgKey: c.path })));
    } else {
      const head = el("button", { class: "fgroup-h", type: "button", title: "Edit the list's settings" },
        `<span>${esc(e.name)}</span><span>List, ${e.max} row${e.max === 1 ? "" : "s"}</span>`);
      head.addEventListener("click", () => ui.select({ obj: null, cell: null }, { field: e.name + "[]" }));
      g.appendChild(head);
      if (e.scalar) g.appendChild(chip("item", { list: e.name, sub: "" }, { cfgKey: e.name + "[]", glyph: "item" }));
      e.children.forEach(sub => g.appendChild(chip(sub, { list: e.name, sub }, { cfgKey: `${e.name}[].${sub}`, glyph: "item" })));
      g.appendChild(chip(`Number of ${e.name}`, { key: `count:${e.name}` }, { glyph: "count", cls: "calc" }));
      for (const sub of e.children) {
        for (const v of allowedOf(peek(`${e.name}[].${sub}`)))
          g.appendChild(chip(`Number with ${sub} ${v}`, { key: `count:${e.name}.${sub}=${v}` }, { glyph: "count", cls: "calc" }));
      }
    }
    host.appendChild(g);
  }
  const placed = placedRoots();
  const pending = (S.project.pending ?? []).filter(p => !placed.has(p));
  pending.forEach(p => host.appendChild(chip(p, { key: p }, { cls: "pending", glyph: "new", tag: "Not placed" })));
  if (!m.entries.length && !pending.length)
    host.appendChild(el("p", { class: "hint" }, "No fields yet. Add a Title, Text or Table from Elements, or name a field below and drag it onto a text box."));
}

export function addPendingField(name: string): boolean {
  if (!KEY_RE.test(name)) { toast("Use letters, numbers and _ only, starting with a letter."); return false; }
  if (usedRoots(S.deck, S.project).has(name)) { toast(`${name} already exists.`); return false; }
  S.project.pending = [...(S.project.pending ?? []), name];
  ui.save();
  toast(`Now drag ${name} onto a text box.`);
  return true;
}

function scopeOf(cfgKey: string): { label: string; scope: RenameScope } {
  let m = /^(.+)\[\]\.(.+)$/.exec(cfgKey);
  if (m) return { label: m[2]!, scope: { type: "array-child", from: m[2]!, name: m[1]!, sub: m[2]! } };
  m = /^(.+)\[\]$/.exec(cfgKey);
  if (m) return { label: m[1]!, scope: { type: "array", from: m[1]! } };
  const e = S.model.entries.find(x => x.kind === "object" && cfgKey.startsWith(x.name + "."));
  if (e) { const sub = cfgKey.slice(e.name.length + 1); return { label: sub, scope: { type: "object-child", from: sub, name: e.name, sub } }; }
  return { label: cfgKey, scope: { type: "plain", from: cfgKey } };
}

let uid = 0;
function labelled(label: string, input: HTMLElement): HTMLElement {
  const id = `f${++uid}`;
  input.id = id;
  const w = el("div");
  w.append(el("label", { class: "lbl", for: id }, label), input);
  return w;
}

/** The settings card for one field: name, type, description, limits, examples, allowed values. */
export function fieldEditor(cfgKey: string): HTMLElement {
  const c = peek(cfgKey);
  const { label, scope } = scopeOf(cfgKey);
  const isArray = /\[\]$/.test(cfgKey), isChild = /\[\]\./.test(cfgKey);
  const entry = S.model.entries.find(e => e.kind === "field" && e.path === cfgKey);
  const arr = isArray ? S.model.entries.find(e => e.kind === "array" && e.name + "[]" === cfgKey) : undefined;
  const rowList = arr?.kind === "array" && !arr.scalar; // a list of rows has no content of its own
  const isList = entry?.kind === "field" && fieldType(S.project, entry) === "list";
  const card = el("div", { class: "field-card" });

  const name = el("input", { class: "key", type: "text", value: label, spellcheck: "false", "aria-label": "Field name", title: "Rename (updates the template too)" });
  name.addEventListener("change", () => {
    const v = name.value.trim();
    if (v === label) return;
    if (!KEY_RE.test(v)) { toast("Use letters, numbers and _ only, starting with a letter."); name.value = label; return; }
    if (!renameField(S.deck, S.project, v, scope)) { name.value = label; return; }
    if (S.selField === cfgKey) {
      S.selField = scope.type === "plain" ? v : scope.type === "array" ? v + "[]"
        : scope.type === "array-child" ? `${scope.name}[].${v}` : scope.type === "object-child" ? `${scope.name}.${v}` : v;
    }
    ui.refresh();
    toast(`Renamed to ${v}`);
  });
  name.addEventListener("keydown", e => { if (e.key === "Enter") name.blur(); });
  const head = el("div", { class: "row tight" });
  head.appendChild(name);
  if (entry) {
    const t = el("select", { class: "inp", "aria-label": "Field type" }, '<option value="text">Text</option><option value="list">List</option>');
    t.value = isList ? "list" : "text";
    t.addEventListener("change", () => { cfg(cfgKey).type = t.value; ui.refresh(); });
    head.appendChild(t);
  }
  card.appendChild(head);
  if (arr?.kind === "array" && rowList)
    card.appendChild(el("span", { class: "hint" }, `Up to ${arr.max} item${arr.max === 1 ? "" : "s"}. Each one fills a table row; unused rows are removed.`));

  const desc = el("input", { class: "inp", type: "text", value: c.desc ?? "", placeholder: isArray ? "e.g. most important first" : "What should go here?" });
  desc.addEventListener("input", () => { cfg(cfgKey).desc = desc.value; ui.settingsChanged(); });
  if (rowList) { card.appendChild(labelled("Tell the LLM about this list", desc)); return card; }

  const max = el("input", { class: "inp", type: "number", min: "0", value: c.max ?? "", placeholder: "Any" });
  max.addEventListener("input", () => { cfg(cfgKey).max = max.value ? +max.value : ""; ui.settingsChanged(); });
  const dm = el("div", { class: "desc-max" });
  dm.append(labelled("Tell the LLM what to write", desc), labelled("Max words", max));
  card.appendChild(dm);

  const multi = isChild || isArray || isList;
  const ex = multi ? el("textarea", { class: "inp", rows: "2" }) : el("input", { class: "inp", type: "text" });
  ex.value = c.example ?? "";
  ex.addEventListener("input", () => { cfg(cfgKey).example = ex.value; ui.settingsChanged(); });
  card.appendChild(labelled(multi ? (isChild ? "Examples, one per row" : "Examples, one per line") : "Example", ex));

  if (!isList && !isArray) {
    const al = el("input", { class: "inp", type: "text", value: c.allowed ?? "", placeholder: "e.g. High, Medium, Low" });
    al.addEventListener("input", () => { cfg(cfgKey).allowed = al.value; ui.settingsChanged(); });
    al.addEventListener("change", () => ui.renderSide()); // allowed values add "Number with ..." shortcuts
    card.appendChild(labelled("Allowed values", al));
  }
  return card;
}

/** Settings for the field picked in the list, shown under it. */
export function renderFieldSettings(host: HTMLElement): void {
  host.replaceChildren();
  const key = S.selField;
  if (!key) return;
  const sect = el("div", { class: "sect" });
  const head = el("div", { class: "insp-head" });
  head.appendChild(el("h2", {}, /\[\]$/.test(key) ? "List settings" : "Field settings"));
  const done = el("button", { class: "btn small quiet", type: "button" }, "Done");
  done.addEventListener("click", () => { S.selField = null; ui.renderSide(); });
  head.appendChild(done);
  sect.appendChild(head);
  const used = fieldUsage(S.deck, key.split(/\[\]|\./)[0]!);
  sect.appendChild(el("span", { class: "hint" }, used.length ? `Used on slide ${used.map(i => i + 1).join(", ")}.` : "Not on a slide yet. Drag it onto a text box."));
  sect.appendChild(fieldEditor(key));
  const arr = S.model.entries.find(x => x.kind === "array" && x.name + "[]" === key);
  if (arr?.kind === "array") arr.children.forEach(sub => sect.appendChild(fieldEditor(`${arr.name}[].${sub}`)));
  if (used.length && !used.includes(S.cur)) {
    const go = el("button", { class: "btn small", type: "button" }, `Show slide ${used[0]! + 1}`);
    go.addEventListener("click", () => { S.cur = used[0]!; clearSel(); ui.renderStage(); ui.renderInspector(); });
    sect.appendChild(go);
  }
  host.appendChild(sect);
  requestAnimationFrame(() => sect.scrollIntoView({ block: "nearest" }));
}

export function fieldsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Fields</h2><p>The blanks your LLM fills in. Drag one onto a text box or table cell.</p>"));
  const sect = el("div", { class: "sect" });
  const list = el("div", { class: "flist", id: "fieldList" });
  renderFieldList(list);
  sect.appendChild(list);
  const row = el("form", { class: "row tight" });
  const inp = el("input", { class: "inp", id: "newField", type: "text", placeholder: "New field name", spellcheck: "false", "aria-label": "New field name", autocomplete: "off" });
  row.append(inp, el("button", { class: "btn", type: "submit" }, "Add"));
  row.addEventListener("submit", e => {
    e.preventDefault();
    if (addPendingField(inp.value.trim())) { ui.renderSide(); $("#newField").focus(); }
  });
  sect.appendChild(row);
  wrap.appendChild(sect);
  const settings = el("div", { id: "fieldSettings" });
  renderFieldSettings(settings);
  wrap.appendChild(settings);
  return wrap;
}
