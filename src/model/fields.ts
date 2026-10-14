// The field model and the three text outputs derived from it (example JSON, JSON Schema,
// LLM prompt). Mirrors python/kit_src.py function for function: tests/py compares the two.
import type { ColourRule, Scanned } from "../engine/engine";

export interface FieldConfig { type?: string; desc?: string; max?: number | string; example?: string; allowed?: string }
export interface Project {
  name: string;
  settings: { file_name_field: string; colour_rules: ColourRule[] };
  fields: Record<string, FieldConfig>;
  prompt_extra: string;
  /** Fields the user created but has not placed on a slide yet (editor only). */
  pending?: string[];
}

export interface FieldEntry { kind: "field"; name: string; path: string; alone: boolean }
export interface ObjectEntry { kind: "object"; name: string; children: { sub: string; path: string; alone: boolean }[] }
export interface ArrayEntry { kind: "array"; name: string; max: number; children: string[]; scalar: boolean }
export type Entry = FieldEntry | ObjectEntry | ArrayEntry;
export interface Model { entries: Entry[]; calc: string[] }

const LISTY = /(highlights|bullets|points|steps|items|agenda|actions|takeaways|lines|list|recommendations|risks|issues|tasks|goals|objectives)$/i;
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export const humanize = (k: string): string => {
  const s = String(k).replace(/[_\-.]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : k;
};

export function buildModel(scanned: Scanned[]): Model {
  const entries: Entry[] = [], calc: string[] = [];
  const byName = new Map<string, Entry>();
  const add = <T extends Entry>(e: T): T => { entries.push(e); byName.set(e.name, e); return e; };
  for (const { key, alone } of scanned) {
    if (key.startsWith("count:")) { calc.push(key); continue; }
    const parts = key.split(".");
    const ni = parts.findIndex((p, i) => i > 0 && /^[0-9]+$/.test(p));
    if (ni > 0) {
      const name = parts.slice(0, ni).join("."), n = +parts[ni]!, sub = parts.slice(ni + 1).join(".");
      let e = byName.get(name);
      if (!e || e.kind !== "array") e = add({ kind: "array", name, max: 0, children: [], scalar: !sub });
      e.max = Math.max(e.max, n);
      if (sub && !e.children.includes(sub)) e.children.push(sub);
      if (sub) e.scalar = false;
    } else if (parts.length > 1) {
      const name = parts[0]!;
      let e = byName.get(name);
      if (!e || e.kind !== "object") e = add({ kind: "object", name, children: [] });
      const sub = parts.slice(1).join(".");
      if (!e.children.find(c => c.sub === sub)) e.children.push({ sub, path: key, alone });
    } else if (!byName.has(key)) add({ kind: "field", name: key, path: key, alone });
  }
  return { entries, calc };
}

/** Settings key for a placeholder: findings.2.title -> findings[].title, findings.2 -> findings[]. */
export function cfgKeyOf(key: string): string | null {
  if (key.startsWith("count:")) return null;
  const parts = key.split(".");
  const ni = parts.findIndex((p, i) => i > 0 && /^[0-9]+$/.test(p));
  if (ni > 0) {
    const name = parts.slice(0, ni).join("."), sub = parts.slice(ni + 1).join(".");
    return sub ? `${name}[].${sub}` : `${name}[]`;
  }
  return key;
}

/** The first name segment of a placeholder key: count:findings.risk=High -> findings. */
export const rootOf = (key: string): string => key.replace(/^count:/, "").split(/[.=]/)[0]!.trim();

const cfg = (project: Project, key: string): FieldConfig => project.fields[key] ?? {};
const lines = (s: unknown): string[] => String(s ?? "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
export const allowedOf = (c: FieldConfig): string[] => String(c.allowed ?? "").split(",").map(s => s.trim()).filter(Boolean);
const maxWords = (c: FieldConfig): number => { const n = Number(c.max); return c.max === "" || c.max === undefined || isNaN(n) ? 0 : n; };

export function fieldType(project: Project, e: { path: string; alone: boolean; name: string }): "text" | "list" {
  const t = cfg(project, e.path).type;
  if (t === "text" || t === "list") return t;
  return e.alone && LISTY.test(e.name) ? "list" : "text";
}

function setDeep(obj: Record<string, unknown>, path: string, v: unknown): void {
  const ps = path.split(".");
  let o = obj;
  for (const p of ps.slice(0, -1)) {
    if (!o[p] || typeof o[p] !== "object") o[p] = {};
    o = o[p] as Record<string, unknown>;
  }
  o[ps[ps.length - 1]!] = v;
}

function exampleValue(project: Project, key: string, type: "text" | "list", label: string): string | string[] {
  const c = cfg(project, key);
  if (type === "list") { const l = lines(c.example); return l.length ? l : [`${label} 1`, `${label} 2`]; }
  return String(c.example ?? "").trim() || allowedOf(c)[0] || label;
}

export function buildExample(project: Project, model: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of model.entries) {
    if (e.kind === "field") out[e.name] = exampleValue(project, e.path, fieldType(project, e), humanize(e.name));
    else if (e.kind === "object") {
      const o: Record<string, unknown> = {};
      for (const c of e.children) setDeep(o, c.sub, exampleValue(project, c.path, "text", humanize(c.sub)));
      out[e.name] = o;
    } else if (e.scalar) {
      const l = lines(cfg(project, e.name + "[]").example);
      out[e.name] = (l.length ? l : [`${humanize(e.name)} 1`, `${humanize(e.name)} 2`]).slice(0, e.max);
    } else {
      const per = e.children.map(sub => lines(cfg(project, `${e.name}[].${sub}`).example));
      const count = Math.min(e.max, Math.max(2, ...per.map(l => l.length)));
      const items: Record<string, unknown>[] = [];
      for (let i = 0; i < count; i++) {
        const it: Record<string, unknown> = {};
        e.children.forEach((sub, k) => {
          const l = per[k]!, al = allowedOf(cfg(project, `${e.name}[].${sub}`));
          setDeep(it, sub, l.length ? l[Math.min(i, l.length - 1)] : (al.length ? al[i % al.length] : `${humanize(sub)} ${i + 1}`));
        });
        items.push(it);
      }
      out[e.name] = items;
    }
  }
  return out;
}

export function describe(project: Project, key: string, each = false): string {
  const c = cfg(project, key);
  const bits: string[] = [];
  const d = String(c.desc ?? "").trim();
  if (d) bits.push(d.replace(/\.$/, ""));
  const al = allowedOf(c);
  if (al.length) bits.push(`one of: ${al.join(", ")}`);
  if (maxWords(c) > 0) bits.push(`max ${maxWords(c)} words${each ? " each" : ""}`);
  return bits.join("; ");
}

type Schema = Record<string, unknown>;
function schemaFor(project: Project, key: string, type: "text" | "list"): Schema {
  const d = describe(project, key, type === "list");
  const al = allowedOf(cfg(project, key));
  const s: Schema = type === "list" ? { type: "array", items: { type: "string" } } : { type: "string" };
  if (al.length && type !== "list") s.enum = al;
  if (d) s.description = d;
  return s;
}
function nestProps(target: Record<string, Schema>, sub: string, sch: Schema): void {
  const ps = sub.split(".");
  let o = target;
  for (const p of ps.slice(0, -1)) {
    o[p] = o[p] ?? { type: "object", properties: {}, required: [] };
    if (!o[p]!.properties) o[p]!.properties = {};
    o = o[p]!.properties as Record<string, Schema>;
  }
  o[ps[ps.length - 1]!] = sch;
}

export function buildSchema(project: Project, model: Model): Schema {
  const props: Record<string, Schema> = {}, req: string[] = [];
  for (const e of model.entries) {
    req.push(e.name);
    if (e.kind === "field") props[e.name] = schemaFor(project, e.path, fieldType(project, e));
    else if (e.kind === "object") {
      const p: Record<string, Schema> = {};
      e.children.forEach(c => nestProps(p, c.sub, schemaFor(project, c.path, "text")));
      props[e.name] = { type: "object", properties: p, required: Object.keys(p) };
    } else if (e.scalar) {
      props[e.name] = { type: "array", maxItems: e.max, items: { type: "string" } };
      const d = describe(project, e.name + "[]", true);
      if (d) props[e.name]!.description = d;
    } else {
      const p: Record<string, Schema> = {};
      e.children.forEach(sub => nestProps(p, sub, schemaFor(project, `${e.name}[].${sub}`, "text")));
      props[e.name] = { type: "array", minItems: 1, maxItems: e.max, items: { type: "object", properties: p, required: Object.keys(p) } };
      const d = describe(project, e.name + "[]");
      if (d) props[e.name]!.description = d;
    }
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: project.name || "Presentation",
    type: "object", properties: props, required: req, additionalProperties: false,
  };
}

export function buildPrompt(project: Project, model: Model): string {
  const skel: Record<string, unknown> = {};
  const hint = (key: string, type: "text" | "list", label: string) => describe(project, key, type === "list") || label.toLowerCase();
  const notes: string[] = [];
  for (const e of model.entries) {
    if (e.kind === "field") {
      const t = fieldType(project, e);
      const h = hint(e.path, t, humanize(e.name));
      skel[e.name] = t === "list" ? [h] : h;
      if (t === "list") notes.push(`- ${e.name}: a list; each item becomes its own bullet or line.`);
    } else if (e.kind === "object") {
      const o: Record<string, unknown> = {};
      e.children.forEach(c => setDeep(o, c.sub, hint(c.path, "text", humanize(c.sub))));
      skel[e.name] = o;
    } else if (e.scalar) {
      skel[e.name] = [hint(e.name + "[]", "list", humanize(e.name))];
      notes.push(`- ${e.name}: up to ${e.max} items.`);
    } else {
      const it: Record<string, unknown> = {};
      e.children.forEach(sub => setDeep(it, sub, hint(`${e.name}[].${sub}`, "text", humanize(sub))));
      skel[e.name] = [it];
      const d = String(cfg(project, e.name + "[]").desc ?? "").trim();
      notes.push(`- ${e.name}: 1 to ${e.max} items (the slide has room for ${e.max})${d ? "; " + d.replace(/\.$/, "") : ""}.`);
    }
  }
  const parts = [
    `You fill in the PowerPoint template "${project.name || "Presentation"}". Turn the information you are given into the JSON object below.`,
    "",
    "Output ONLY the JSON object: no explanation, no markdown fences.",
    "Use plain text in every value (no markdown, no bullet symbols, no numbering).",
    "Keep to the length limits; text does not shrink to fit the slide.",
    "Only use facts from the information provided. If something is missing, write \"To be confirmed\" instead of inventing it.",
    "",
    JSON.stringify(skel, null, 2),
  ];
  if (notes.length) parts.push("", "Notes:", ...notes);
  const extra = (project.prompt_extra || "").trim();
  if (extra) parts.push("", extra);
  parts.push("", "Information to use:", "{{#sys.query#}}");
  return parts.join("\n");
}

/** What ends up inside fill_pptx.py and fields.json (editor-only state such as `pending` is left out). */
export function projectForCode(project: Project): Omit<Project, "pending"> {
  return { name: project.name, settings: project.settings, fields: project.fields, prompt_extra: project.prompt_extra || "" };
}

/** A colour from a file someone else may have written: six hex digits or the fallback, nothing else. */
const hex = (v: unknown, fallback: string): string => {
  const s = String(v ?? "").replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : fallback;
};

export function normaliseProject(p: Partial<Project> | null | undefined, fallbackName?: string): Project {
  const src = (p ? JSON.parse(JSON.stringify(p)) : {}) as Partial<Project> & Record<string, unknown>;
  const rules = src.settings?.colour_rules ?? [];
  return {
    name: src.name || fallbackName || "New template",
    settings: {
      file_name_field: src.settings?.file_name_field ?? "",
      colour_rules: rules.map(r => ({
        match: r.match || "",
        fill: hex(r.fill, "FFFFFF"),
        text: hex(r.text, "000000"),
      })),
    },
    fields: src.fields ?? {},
    prompt_extra: src.prompt_extra ?? "",
    pending: src.pending ?? [],
  };
}
