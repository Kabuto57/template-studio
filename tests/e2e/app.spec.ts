import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Zip } from "../../src/zip/minizip";

const OUT = join(process.cwd(), "tests/py/out/e2e");
mkdirSync(OUT, { recursive: true });
const PYTHON = process.env.PYTHON ?? "python3";

/** Fail any test that logs a console error or throws. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  return errors;
}
async function open(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#mainSlide")).toBeVisible();
}
const fieldKeys = (page: Page) => page.locator("#mainSlide .ph").evaluateAll(els => els.map(e => e.getAttribute("title") ?? e.textContent));
const slideCount = (page: Page) => page.locator("#film .thumb").count();
async function startBlank(page: Page): Promise<void> {
  await open(page);
  await page.click("#rail [data-side=templates]");
  await page.click(".card.blank");
  await expect(page.locator("#mainSlide [data-obj]")).toHaveCount(0);
}
async function downloadKit(page: Page, name: string): Promise<Zip> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#kitBtn")]);
  const file = join(OUT, name);
  await dl.saveAs(file);
  return Zip.load(new Uint8Array(readFileSync(file)));
}

test("first visit opens the audit sample, ready to demo", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page.locator("#projName")).toHaveValue("Audit Report Highlights");
  await expect(page.locator(".steps [data-view=design]")).toHaveAttribute("aria-selected", "true");
  expect(await slideCount(page)).toBe(2);
  expect(await fieldKeys(page)).toContain("{{report_title}}");
  await expect(page.locator(".gallery .card")).toHaveCount(14);
  await expect(page.locator(".gallery .card .slide")).toHaveCount(13); // live cover renders
  expect(errors).toEqual([]);
});

test("build a template from blank, test it, get the code, and come back to it", async ({ page }) => {
  const errors = watchErrors(page);
  await startBlank(page);

  // insert by dragging and by clicking
  await page.dragAndDrop(".block[data-type=title]", "#mainSlide", { targetPosition: { x: 300, y: 60 } });
  await page.dragAndDrop(".block[data-type=text]", "#mainSlide", { targetPosition: { x: 200, y: 320 } });
  await page.dragAndDrop(".block[data-type=number]", "#mainSlide", { targetPosition: { x: 600, y: 320 } });
  await page.click(".block[data-type=table]");
  await expect(page.locator("#mainSlide [data-obj]")).toHaveCount(4);
  expect(await fieldKeys(page)).toEqual(expect.arrayContaining(["{{title}}", "{{text}}", "{{number}}", "{{rows.1.name}}", "{{rows.3.status}}"]));

  // move with the mouse, then resize from the south-east handle
  const title = page.locator('#mainSlide [data-obj="0"]');
  const before = (await title.boundingBox())!;
  await page.mouse.move(before.x + 30, before.y + 15);
  await page.mouse.down();
  await page.mouse.move(before.x + 110, before.y + 35, { steps: 5 });
  await page.mouse.up();
  const moved = (await page.locator('#mainSlide [data-obj="0"]').boundingBox())!;
  expect(moved.x - before.x).toBeGreaterThan(60);
  expect(moved.y - before.y).toBeGreaterThan(10);
  await expect(page.locator(".overlay")).toBeVisible();
  const handle = (await page.locator('.overlay .h[data-h="se"]').boundingBox())!;
  await page.mouse.move(handle.x + 5, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x - 95, handle.y + 25, { steps: 5 });
  await page.mouse.up();
  const resized = (await page.locator('#mainSlide [data-obj="0"]').boundingBox())!;
  expect(moved.width - resized.width).toBeGreaterThan(70);
  expect(resized.height - moved.height).toBeGreaterThan(12);
  await page.keyboard.press("ArrowRight");
  expect((await page.locator('#mainSlide [data-obj="0"]').boundingBox())!.x).toBeGreaterThan(resized.x);

  // new field -> drop on the text box, and on the number tile (its "Label" line must survive)
  await page.click("#rail [data-side=fields]");
  await page.fill("#newField", "summary");
  await page.keyboard.press("Enter");
  await page.dragAndDrop('.chip.pending:has-text("summary")', '#mainSlide [data-obj="1"]');
  expect(await fieldKeys(page)).toContain("{{summary}}");
  expect(await fieldKeys(page)).not.toContain("{{text}}");
  await page.fill("#newField", "revenue");
  await page.keyboard.press("Enter");
  await page.dragAndDrop('.chip.pending:has-text("revenue")', '#mainSlide [data-obj="2"]');
  await expect(page.locator('#mainSlide [data-obj="2"]')).toContainText("Label");
  expect(await fieldKeys(page)).toContain("{{revenue}}");

  // describe a field for the LLM
  await page.click('.chip:has-text("summary")');
  await page.getByLabel("Tell the LLM what to write").fill("Two sentences on the quarter");
  await page.getByLabel("Max words").fill("30");

  // table: select a cell, add a row and a column, list fields onto cells
  await page.locator("#mainSlide td.hit").nth(4).click();
  await expect(page.locator("#insp h2")).toHaveText("Table cell");
  await page.click('#insp button:has-text("Add row")');
  await page.click('#insp button:has-text("Add column")');
  expect(await fieldKeys(page)).toEqual(expect.arrayContaining(["{{rows.4.name}}", "{{rows.4.column}}"]));
  await page.click("#rail [data-side=fields]");
  await page.locator('.fgroup .chip:has-text("detail")').dragTo(page.locator("#mainSlide td.hit").nth(4));
  expect(await fieldKeys(page)).toContain("{{rows.1.detail}}");
  await page.locator('.fgroup .chip:has-text("Number of rows")').dragTo(page.locator('#mainSlide [data-obj="0"]'));
  expect(await fieldKeys(page)).toContain("{{count:rows}}");

  // slides: add, duplicate, delete, then undo the delete
  await page.click(".add-slide");
  await page.click(".ins-pop [data-layout=two]");
  expect(await slideCount(page)).toBe(2);
  const keys = await fieldKeys(page);
  expect(keys.length).toBe(3); // a title and two columns, each with its own field
  expect(new Set(keys).size).toBe(3);
  await page.locator("#film .thumb").first().hover();
  await page.locator('#film .thumb [data-act="dup"]').first().click();
  expect(await slideCount(page)).toBe(3);
  await page.locator("#film .thumb").nth(2).hover();
  await page.locator('#film .thumb [data-act="del"]').nth(2).click();
  expect(await slideCount(page)).toBe(2);
  await page.click("#undoBtn");
  expect(await slideCount(page)).toBe(3);
  await page.click("#redoBtn");
  expect(await slideCount(page)).toBe(2);

  // Test: the example fills the slide; real JSON updates it; bad JSON is explained
  await page.click(".steps [data-view=test]");
  await expect(page.locator("#mainSlide .ph")).toHaveCount(0);
  await expect(page.locator("#testStatus")).toContainText("Nothing left blank");
  await page.fill("#testJson", '```json\n{"summary": "Sales rose & costs fell <5%>", "rows": [{"detail": "Alpha"}], "extra": 1}\n```');
  await expect(page.locator("#mainSlide")).toContainText("Sales rose & costs fell <5%>");
  await expect(page.locator("#mainSlide")).toContainText("Label");
  await expect(page.locator("#testStatus")).toContainText("Left blank, not in the JSON: revenue");
  await expect(page.locator("#testStatus")).toContainText("In the JSON but not in the template: extra");
  await expect(page.locator("#mainSlide tr")).toHaveCount(2); // header + the one row sent
  const [filledDl] = await Promise.all([page.waitForEvent("download"), page.click("#dlFilledBtn")]);
  await filledDl.saveAs(join(OUT, "ui_filled.pptx"));
  await page.fill("#testJson", "{ nope");
  await expect(page.locator("#testStatus")).toContainText("isn't valid JSON");
  await expect(page.locator("#dlFilledBtn")).toBeDisabled();
  await page.click("#resetTestBtn");

  // Get code: prompt, JSON, schema, Python
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#promptOut")).toContainText("two sentences on the quarter; max 30 words".replace("two", "Two"));
  await expect(page.locator("#jsonOut")).toContainText('"summary"');
  await page.click("#jsonSc");
  await expect(page.locator("#jsonOut")).toContainText('"$schema"');
  await expect(page.locator("#pyOut")).toContainText("def main(content_json: str) -> dict:");
  await expect(page.locator("#pyOut")).toContainText("more lines of the embedded template");
  await expect(page.locator("#pyMeta")).toContainText("fits Dify's Code node limit");

  // the kit: every file present, the template is sound, and the Python really runs
  const kit = await downloadKit(page, "blank_kit.zip");
  const names = kit.names().map(n => n.split("/").pop());
  expect(names.sort()).toEqual(["README.txt", "example_body.json", "fields.json", "fill_pptx.py", "json_schema.json", "llm_prompt.txt", "template.pptx"]);
  const folder = kit.names()[0]!.split("/")[0]!;
  for (const n of ["fill_pptx.py", "template.pptx", "example_body.json"]) writeFileSync(join(OUT, n), (await kit.bytes(`${folder}/${n}`))!);
  const run = spawnSync(PYTHON, ["-I", "-S", "tests/py/dify_run.py", join(OUT, "fill_pptx.py"), join(OUT, "example_body.json"), join(OUT, "kit_filled.pptx")], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({ status: "success", message: "All fields filled.", stdlib_only: true });
  const check = spawnSync(PYTHON, ["tests/py/check_pptx.py", join(OUT, "template.pptx"), join(OUT, "kit_filled.pptx"), join(OUT, "ui_filled.pptx")], { encoding: "utf8" });
  expect(check.status, check.stdout + check.stderr).toBe(0);

  // reload: the project comes back from IndexedDB, in the same view
  await page.waitForTimeout(900); // autosave debounce
  await page.reload();
  await expect(page.locator("#pyOut")).toContainText("def main");
  await page.click(".steps [data-view=design]");
  expect(await slideCount(page)).toBe(2);
  expect(await fieldKeys(page)).toEqual(expect.arrayContaining(["{{summary}}", "{{revenue}}", "{{count:rows}}"]));
  await page.click("#rail [data-side=templates]");
  await expect(page.locator(".recent-row")).toHaveCount(1); // the audit sample we started from
  expect(errors).toEqual([]);
});

test("format a text box: text, style, colour, undo", async ({ page }) => {
  await startBlank(page);
  await page.click("#rail [data-side=elements]");
  await page.click(".block[data-type=label]");
  await expect(page.locator("#insp h2")).toHaveText("Text box");
  await page.fill("#inspText", "Quarterly update\nPrepared by {{author}}");
  await expect(page.locator("#mainSlide")).toContainText("Quarterly update");
  expect(await fieldKeys(page)).toEqual(["{{author}}"]);
  await expect(page.locator("#inspText")).toBeFocused(); // typing is not interrupted by the redraw
  await page.getByLabel("Font size").fill("28");
  await page.getByLabel("Font size").press("Enter");
  await page.getByLabel("Font", { exact: true }).selectOption("Georgia");
  await page.getByLabel("Align text centre").click();
  const span = page.locator("#mainSlide .para span").first();
  await expect(span).toHaveCSS("font-family", /Georgia/);
  await expect(page.locator("#mainSlide .para").first()).toHaveCSS("text-align", "center");
  await page.getByLabel("Italic").click();
  await expect(span).toHaveCSS("font-style", "italic");
  // slide background, then undo it
  await page.keyboard.press("Escape");
  await expect(page.locator("#insp")).toContainText("Nothing selected");
  await page.locator('#insp input[type=color]').fill("#0f1e3c");
  await expect(page.locator("#mainSlide")).toHaveCSS("background-color", "rgb(15, 30, 60)");
  await page.click("#undoBtn");
  await expect(page.locator("#mainSlide")).not.toHaveCSS("background-color", "rgb(15, 30, 60)");
  // delete with the keyboard
  await page.locator('#mainSlide [data-obj="0"]').click();
  await page.keyboard.press("Delete");
  await expect(page.locator("#mainSlide [data-obj]")).toHaveCount(0);
});

test("rename a field and it changes in the template and the outputs", async ({ page }) => {
  await open(page);
  await page.click("#rail [data-side=fields]");
  await page.click('.chip:has-text("entity_name")');
  await page.locator(".field-card .key").first().fill("company");
  await page.locator(".field-card .key").first().press("Enter");
  expect(await fieldKeys(page)).toContain("{{company}}");
  expect(await fieldKeys(page)).not.toContain("{{entity_name}}");
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#promptOut")).toContainText('"company": "Company or business unit audited"');
});

for (const id of ["brief", "market", "client", "approval", "project", "quarterly", "report", "boardroom", "signal", "headline", "postmortem", "orchard"]) {
  test(`gallery design "${id}" opens, fills completely and exports a sound kit`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page);
    await page.click(`[data-design=${id}]`);
    await expect(page.locator(`[data-design=${id}]`)).toHaveAttribute("aria-current", "true");
    expect(await slideCount(page)).toBe(3);
    await page.click(".steps [data-view=test]");
    await expect(page.locator("#testStatus")).toContainText("Nothing left blank");
    await expect(page.locator("#testStatus")).not.toContainText("not in the template");
    for (let i = 0; i < 3; i++) {
      await page.locator("#film .thumb").nth(i).click();
      await expect(page.locator("#mainSlide .ph")).toHaveCount(0);
      // nothing runs past the slide edge
      const overflow = await page.locator("#mainSlide").evaluate(s => {
        const r = s.getBoundingClientRect();
        return [...s.querySelectorAll(".para")].filter(p => { const q = p.getBoundingClientRect(); return q.width > 0 && (q.bottom > r.bottom + 1 || q.right > r.right + 1); }).length;
      });
      expect(overflow, `slide ${i + 1} has text outside the slide`).toBe(0);
    }
    const kit = await downloadKit(page, `${id}_kit.zip`);
    const folder = kit.names()[0]!.split("/")[0]!;
    writeFileSync(join(OUT, `${id}.pptx`), (await kit.bytes(`${folder}/template.pptx`))!);
    writeFileSync(join(OUT, `${id}_fill.py`), (await kit.bytes(`${folder}/fill_pptx.py`))!);
    writeFileSync(join(OUT, `${id}.json`), (await kit.bytes(`${folder}/example_body.json`))!);
    const run = spawnSync(PYTHON, ["-I", "-S", "tests/py/dify_run.py", join(OUT, `${id}_fill.py`), join(OUT, `${id}.json`), join(OUT, `${id}_filled.pptx`)], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: "success", message: "All fields filled." });
    const check = spawnSync(PYTHON, ["tests/py/check_pptx.py", join(OUT, `${id}.pptx`), join(OUT, `${id}_filled.pptx`)], { encoding: "utf8" });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("open a .pptx and a fill_pptx.py from disk", async ({ page }) => {
  await open(page);
  const kit = await downloadKit(page, "audit_kit.zip");
  const folder = kit.names()[0]!.split("/")[0]!;
  writeFileSync(join(OUT, "audit_template.pptx"), (await kit.bytes(`${folder}/template.pptx`))!);
  writeFileSync(join(OUT, "audit_fill.py"), (await kit.bytes(`${folder}/fill_pptx.py`))!);

  await page.click(".card.blank");
  await page.setInputFiles("#fileInput", join(OUT, "audit_template.pptx"));
  await expect(page.locator("#projName")).toHaveValue("Audit template");
  expect(await fieldKeys(page)).toContain("{{report_title}}");
  // a bare .pptx has no field descriptions...
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#promptOut")).not.toContainText("Short title of the audit");

  // ...the .py brings the template back together with its settings
  await page.click(".steps [data-view=design]");
  await page.setInputFiles("#fileInput", join(OUT, "audit_fill.py"));
  await expect(page.locator("#projName")).toHaveValue("Audit Report Highlights");
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#promptOut")).toContainText("Short title of the audit; max 6 words");

  await page.click(".steps [data-view=design]");
  writeFileSync(join(OUT, "not_ours.py"), "print('hello')\n");
  await page.setInputFiles("#fileInput", join(OUT, "not_ours.py"));
  await expect(page.locator("#toast")).toContainText("wasn't made by Template Studio");
  await expect(page.locator("#projName")).toHaveValue("Audit Report Highlights"); // nothing was replaced
});

test("decode Dify's pptx_base64 back into a file", async ({ page }) => {
  await open(page);
  await page.click(".steps [data-view=test]");
  const [filled] = await Promise.all([page.waitForEvent("download"), page.click("#dlFilledBtn")]);
  const bytes = readFileSync((await filled.path())!);
  await page.fill("#b64In", JSON.stringify({ pptx_base64: bytes.toString("base64"), file_name: "From_Dify.pptx", status: "success", message: "" }));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#b64Btn")]);
  expect(dl.suggestedFilename()).toBe("From_Dify.pptx");
  expect(readFileSync((await dl.path())!).equals(bytes)).toBe(true);
  await page.fill("#b64In", "definitely not base64 of a deck");
  await page.click("#b64Btn");
  await expect(page.locator("#toast")).toContainText("doesn't look like");
});

test("private and offline: no requests after load, and it runs without a network", async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const fromServer: string[] = [];
  page.on("response", r => { if (!/^(blob|data):/.test(r.url()) && !r.fromServiceWorker()) fromServer.push(r.url()); });
  await page.click("[data-design=boardroom]");
  await page.click("#rail [data-side=elements]");
  await page.click(".block[data-type=title]");
  await page.click(".steps [data-view=test]");
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#pyOut")).toContainText("def main");
  await Promise.all([page.waitForEvent("download"), page.click("#kitBtn")]);
  // Everything after load came from memory or the offline cache: the server saw nothing.
  expect(fromServer).toEqual([]);

  await page.waitForTimeout(900);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#pyOut")).toContainText("def main");
  await page.click(".steps [data-view=design]");
  await expect(page.locator("#projName")).toHaveValue("Boardroom");
  await page.click("#rail [data-side=templates]");
  await page.click("[data-design=orchard]");
  await expect(page.locator("#projName")).toHaveValue("Orchard");
  const [kit] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download pptx_kit.py" }).or(page.locator("#kitBtn")).first().click()]);
  expect(kit.suggestedFilename()).toMatch(/\.(zip|py)$/);
});

test("insert ribbon: shapes, a picture, copy and paste, and they reach the kit", async ({ page }) => {
  const errors = watchErrors(page);
  await startBlank(page);
  await page.click("#pop-shapes");
  await page.click(".ins-pop [data-type='shape:star5']");
  await expect(page.locator(".ins-pop")).toHaveCount(0);
  await expect(page.locator("#mainSlide svg.geom polygon")).toHaveCount(1);
  await expect(page.locator("#insp h2")).toHaveText("Shape");
  await page.click("#insp [aria-label='Change to hexagon']");
  await expect(page.locator("#insp [aria-label='Change to hexagon']")).toHaveAttribute("aria-pressed", "true");
  await page.setInputFiles("#imageInput", "docs/img/fields.png");
  await expect(page.locator("#mainSlide img")).toHaveCount(1);
  await expect(page.locator("#insp h2")).toHaveText("Picture");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("#mainSlide img")).toHaveCount(2);
  const kit = await downloadKit(page, "ribbon_kit.zip");
  const folder = kit.names()[0]!.split("/")[0]!;
  const tpl = await Zip.load((await kit.bytes(`${folder}/template.pptx`))!);
  expect(tpl.names().some(n => /^ppt\/media\/image1\.(png|jpeg)$/.test(n))).toBe(true);
  expect(errors).toEqual([]);
});

test("keyboard and accessibility basics", async ({ page }) => {
  await open(page);
  // every control has an accessible name
  const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, input:not([type=hidden]):not([hidden]), select, textarea, a[href]")]
    .filter(e => e.offsetParent !== null)
    .filter(e => !(e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length || e.getAttribute("placeholder")))
    .map(e => e.outerHTML.slice(0, 90)));
  expect(unnamed).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip")).toBeFocused();
  // About dialog opens, states privacy, closes with Escape
  await page.click("#aboutBtn");
  await expect(page.locator("#aboutDialog")).toContainText("Nothing is uploaded");
  await page.keyboard.press("Escape");
  await expect(page.locator("#aboutDialog")).not.toBeVisible();
  // slide thumbnails are reachable and work with Enter
  await page.locator("#film .thumb").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#stageMeta")).toHaveText("Slide 2 of 2");
});

test("phone width: panels stack and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  for (const view of ["design", "test", "code"]) {
    await page.click(`.steps [data-view=${view}]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${view} view scrolls sideways`).toBeLessThanOrEqual(1);
  }
});

test("security: a strict content policy, hostile text stays text, and saved data can be removed", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await open(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'self'");

  // Markup typed as a template name, a field description and test data must never become elements.
  const evil = `"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;
  await page.fill("#projName", evil);
  await page.click("#rail [data-side=fields]");
  await page.locator(".chip").first().click();
  await page.locator('.field-card input[placeholder="What should go here?"]').first().fill(evil);
  await page.click(".steps [data-view=test]");
  await page.fill("#testJson", JSON.stringify({ report_title: evil, [evil]: evil }));
  await expect(page.locator("#testStatus")).toContainText("not in the template");
  await page.click(".steps [data-view=code]");
  await expect(page.locator("#pyOut")).toContainText("def main");
  await page.click(".steps [data-view=design]");
  await page.click("#rail [data-side=templates]");
  await page.waitForTimeout(700); // autosave, so the name also reaches the Recent list on reload
  await page.reload();
  await expect(page.locator("#projName")).toHaveValue(evil);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator("img[src=x]").count()).toBe(0);
  expect(violations).toEqual([]); // the app itself never trips its own policy

  // Removing saved data brings back the sample and leaves nothing behind.
  await page.click("#rail [data-side=settings]");
  await page.click("#wipeBtn");
  await page.click("#wipeBtn");
  await expect(page.locator("#projName")).toHaveValue("Audit Report Highlights");
  await page.click("#rail [data-side=templates]");
  await expect(page.locator(".recent-row")).toHaveCount(0);
});
