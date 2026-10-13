// Regenerates the README screenshots from the production build.
// usage: npm run build && npm run preview &  then  node scripts/docs-shots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "docs/img", base = process.argv[2] ?? "http://localhost:4173/";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base);
await page.waitForSelector("#mainSlide");
await page.click("[data-design=audit]");
await page.locator("#film .thumb").nth(1).click();
await page.locator("#mainSlide td.hit").nth(7).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/design.png` });
await page.click("#rail [data-side=fields]");
await page.click('.chip:has-text("executive_summary")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/fields.png` });
await page.click(".steps [data-view=test]");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/test.png` });
await page.click(".steps [data-view=code]");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/code.png` });
// one sheet with every gallery design, filled with its test data
const covers = [];
await page.click(".steps [data-view=design]");
for (const id of ["boardroom", "signal", "headline", "postmortem", "orchard"]) {
  await page.click("#rail [data-side=templates]");
  await page.click(`[data-design=${id}]`);
  await page.click(".steps [data-view=test]");
  for (let i = 0; i < 3; i++) {
    await page.locator("#film .thumb").nth(i).click();
    await page.waitForTimeout(120);
    covers.push((await page.locator("#mainSlide").screenshot()).toString("base64"));
  }
  await page.click(".steps [data-view=design]");
}
const sheet = await browser.newPage({ viewport: { width: 1500, height: 100 } });
await sheet.setContent(`<body style="margin:0;background:#ECEEF3;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:14px">${covers.map(c => `<img src="data:image/png;base64,${c}" style="width:100%;display:block;box-shadow:0 2px 10px rgba(20,23,42,.15)">`).join("")}</body>`);
await sheet.waitForTimeout(300);
writeFileSync(`${out}/designs.png`, await sheet.screenshot({ fullPage: true }));
await browser.close();
console.log("wrote", out);
