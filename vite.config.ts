import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildKit } from "./scripts/build-kit.ts";

function kitPlugin(): Plugin {
  const write = () => {
    mkdirSync("public", { recursive: true });
    writeFileSync("public/pptx_kit.py", buildKit());
  };
  return {
    name: "pptx-kit",
    buildStart: write,
    configureServer(server) {
      server.watcher.add(["python/engine.py", "python/kit_src.py"]);
      server.watcher.on("change", f => { if (f.includes("/python/")) write(); });
    },
  };
}

/** Writes dist/sw.js with the exact list of built files, so the app works offline after the first visit. */
function offlinePlugin(): Plugin {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  return {
    name: "offline",
    apply: "build",
    closeBundle() {
      const files = walk("dist").map(f => relative("dist", f).split("\\").join("/")).filter(f => f !== "sw.js").sort();
      const hash = createHash("sha1");
      for (const f of files) hash.update(f).update(readFileSync(join("dist", f)));
      const sw = readFileSync("src/sw.js", "utf8")
        .replace("__VERSION__", hash.digest("hex").slice(0, 12))
        .replace("__FILES__", JSON.stringify(["./", ...files.filter(f => f !== "index.html")]));
      writeFileSync("dist/sw.js", sw);
    },
  };
}

export default defineConfig({
  base: "./", // relative, so the same build works on GitHub Pages, Cloudflare Pages, Netlify or a file server
  plugins: [kitPlugin(), offlinePlugin()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
