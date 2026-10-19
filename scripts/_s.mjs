import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:5199/"); await p.waitForTimeout(1200);
await p.click("[data-design=brief]"); await p.waitForTimeout(600);
await p.locator("#film .thumb").nth(1).click(); await p.waitForTimeout(300);
for (const [t, x, y] of [["shape:star5", .12, .8], ["shape:rightArrow", .32, .8], ["shape:wedgeRectCallout", .55, .8], ["shape:hexagon", .8, .8]]) {
  await p.click("#pop-shapes"); await p.waitForTimeout(150);
  const box = await p.locator("#mainSlide").boundingBox();
  await p.locator(`.ins-pop [data-type='${t}']`).dragTo(p.locator("#mainSlide"), { targetPosition: { x: x * box.width, y: y * box.height } });
  await p.waitForTimeout(250);
}
await p.click("#pop-more"); await p.click(".ins-pop [data-type=quote]"); await p.waitForTimeout(300);
await p.setInputFiles("#imageInput", "docs/img/design.png"); await p.waitForTimeout(800);
console.log(await p.locator(".toast").textContent());
// select hexagon and screenshot inspector
const box = await p.locator("#mainSlide").boundingBox();
await p.mouse.click(box.x + .8 * box.width, box.y + .8 * box.height); await p.waitForTimeout(300);
await p.screenshot({ path: "/Users/jieyung/.playwright-mcp/shapes.png" });
console.log(JSON.stringify(errs)); await b.close();
