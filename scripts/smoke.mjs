// Smoke test of a deployed copy: loads, fills, exports, and still works offline.
// usage: node scripts/smoke.mjs https://kabuto57.github.io/template-studio/ [screenshotDir]
import { chromium } from "@playwright/test";
const url = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(String(e)));
await page.goto(url);
await page.waitForSelector("#mainSlide");
await page.waitForFunction(() => document.querySelectorAll(".gallery .card .slide").length === 6);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.click("[data-design=headline]");
await page.click(".steps [data-view=test]");
await page.waitForSelector("#testStatus:has-text('Nothing left blank')");
if (shots) await page.screenshot({ path: `${shots}/live-test.png` });
await page.click(".steps [data-view=code]");
await page.waitForSelector("#pyOut:has-text('def main')");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#kitBtn")]);
const kit = await (await fetch(new URL("pptx_kit.py", url))).text();
await page.waitForTimeout(900);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector("#pyOut:has-text('def main')");
if (shots) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click(".steps [data-view=design]");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/live-phone.png` });
}
console.log(JSON.stringify({ url, kit: dl.suggestedFilename(), pptxKitBytes: kit.length, pptxKitIsPython: kit.startsWith("#!/usr/bin/env python3"), offlineReload: "ok", errors }));
await browser.close();
