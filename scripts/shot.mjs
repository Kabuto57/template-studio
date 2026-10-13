// Dev helper: screenshots of each view. usage: node scripts/shot.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "shots", base = process.argv[3] ?? "http://localhost:5173/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(String(e)));
await page.goto(base);
await page.waitForSelector("#mainSlide");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-design.png` });
for (const id of (process.env.DESIGNS ?? "boardroom,signal,headline,postmortem,orchard").split(",")) {
  await page.click(`#rail [data-side=templates]`);
  await page.click(`[data-design=${id}]`);
  await page.waitForTimeout(500);
  const n = await page.locator("#film .thumb").count();
  for (let i = 0; i < n; i++) {
    await page.locator("#film .thumb").nth(i).click();
    await page.waitForTimeout(150);
    await page.locator("#mainSlide").screenshot({ path: `${out}/d-${id}-${i + 1}.png` });
  }
  await page.click("[data-view=test]");
  await page.waitForTimeout(300);
  for (let i = 0; i < n; i++) {
    await page.locator("#film .thumb").nth(i).click();
    await page.waitForTimeout(150);
    await page.locator("#mainSlide").screenshot({ path: `${out}/t-${id}-${i + 1}.png` });
  }
  await page.click("[data-view=design]");
}
await page.locator("#mainSlide .hit").first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/2-selected.png` });
await page.click("#rail [data-side=fields]");
await page.screenshot({ path: `${out}/3-fields.png` });
await page.click("#rail [data-side=elements]");
await page.screenshot({ path: `${out}/4-elements.png` });
await page.click("[data-view=test]");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/5-test.png` });
await page.click("[data-view=code]");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/6-code.png`, fullPage: false });
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
