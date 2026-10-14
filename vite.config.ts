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

/**
 * Content Security Policy for the built site. Scripts, fonts and requests may only come from the site
 * itself, so even if hostile markup reached the page it could neither run nor send data anywhere.
 * (Inline style attributes are allowed: the slide renderer positions shapes with them.)
 */
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:",
  "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'",
  "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join("; ");
function cspPlugin(): Plugin {
  return {
    name: "csp",
    apply: "build", // the dev server needs inline scripts and a websocket for hot reload
    transformIndexHtml: html => html.replace("<head>",
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="referrer" content="no-referrer">`),
  };
}

export default defineConfig({
  base: "./", // relative, so the same build works on GitHub Pages, Cloudflare Pages, Netlify or a file server
  plugins: [kitPlugin(), cspPlugin(), offlinePlugin()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
