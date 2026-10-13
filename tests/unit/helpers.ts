import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "tests/py/out");
mkdirSync(OUT, { recursive: true });
export const PYTHON = process.env.PYTHON ?? "python3";

export function py(args: string[], input?: string): string {
  const r = spawnSync(PYTHON, args, { input, encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`python ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
export const bytes = (rel: string): Uint8Array => new Uint8Array(readFileSync(join(ROOT, rel)));
export const json = <T = Record<string, unknown>>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;

/* tiny DrawingML builders for engine fixtures */
export const run = (t: string, rPr = ""): string => `<a:r>${rPr}<a:t>${t}</a:t></a:r>`;
export const para = (...runs: string[]): string => `<a:p>${runs.join("")}</a:p>`;
export const cell = (inner: string, tcPr = "<a:tcPr/>"): string => `<a:tc><a:txBody><a:bodyPr/>${inner}</a:txBody>${tcPr}</a:tc>`;
export const row = (...cells: string[]): string => `<a:tr h="100">${cells.join("")}</a:tr>`;
export const tbl = (...rows: string[]): string => `<a:tbl><a:tblPr/><a:tblGrid/>${rows.join("")}</a:tbl>`;
