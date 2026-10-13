// Dev helper: contact sheet of screenshots. usage: node scripts/sheet.mjs <dir> <prefix> <out.png>
import { chromium } from "@playwright/test";
import { readdirSync, writeFileSync } from "node:fs";
const [dir, prefix, out] = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith(".png")).sort();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 100 } });
writeFileSync(`${dir}/_sheet.html`, `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px">${files.map(f => `<img src="${f}" style="width:100%">`).join("")}</body>`);
await p.goto(`file://${dir}/_sheet.html`);
await p.waitForTimeout(400);
await p.screenshot({ path: out, fullPage: true });
await b.close();
