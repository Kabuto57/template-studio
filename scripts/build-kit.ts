import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENGINE_SPLIT = "# =========================================================================== command line";

/** Splices python/engine.py into python/kit_src.py, the same way every generated fill_pptx.py is assembled. */
export function buildKit(root = process.cwd()): string {
  const src = readFileSync(join(root, "python/kit_src.py"), "utf8");
  const eng = readFileSync(join(root, "python/engine.py"), "utf8");
  const split = eng.indexOf(ENGINE_SPLIT);
  if (split < 0) throw new Error("python/engine.py lost its command-line marker");
  return src.replace("/*__ENGINE_A__*/\n", eng.slice(0, split)).replace("/*__ENGINE_B__*/", eng.slice(split));
}
