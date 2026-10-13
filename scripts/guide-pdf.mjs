// Renders docs/GUIDE.md to docs/Template-Studio-Guide.pdf. Needs pandoc and Playwright's Chromium.
// usage: node scripts/guide-pdf.mjs
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const css = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 10.5pt/1.5 "Helvetica Neue", Arial, sans-serif; color: #171A2B; max-width: none; margin: 0; }
  header { padding: 60mm 0 20mm; break-after: page; }
  header .title { font-size: 34pt; font-weight: 700; margin: 0; letter-spacing: -.02em; }
  header .subtitle { font-size: 15pt; color: #575D75; margin: 4mm 0 0; }
  h1 { font-size: 17pt; margin: 9mm 0 3mm; padding-top: 3mm; border-top: 2px solid #2B50ED; break-after: avoid; }
  h2 { font-size: 12.5pt; margin: 6mm 0 2mm; break-after: avoid; }
  h3 { font-size: 11pt; margin: 5mm 0 2mm; break-after: avoid; }
  p, ul, ol { margin: 0 0 3mm; }
  a { color: #2B50ED; text-decoration: none; }
  code { font: 9pt Menlo, Consolas, monospace; background: #ECEEF3; padding: .5pt 3pt; border-radius: 3px; }
  pre { background: #171A2B; color: #F3F4F8; padding: 4mm; border-radius: 6px; break-inside: avoid; line-height: 1.35; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.2pt; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 4mm; font-size: 9.5pt; break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 1.6mm 2.4mm; border-bottom: 1px solid #D5D9E3; }
  th { background: #ECEEF3; }
  img { max-width: 100%; border: 1px solid #D5D9E3; border-radius: 6px; }
  figure { margin: 0 0 4mm; break-inside: avoid; } figcaption { font-size: 8.5pt; color: #575D75; }
`;
const dir = new URL("../docs/", import.meta.url);
const cssFile = new URL("_guide.css", dir), html = new URL("_guide.html", dir);
writeFileSync(cssFile, css);
execFileSync("pandoc", ["GUIDE.md", "-s", "-f", "markdown", "-t", "html5", "--css", "_guide.css", "--toc", "--toc-depth=1", "-o", "_guide.html"], { cwd: dir });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html.pathname).href);
await page.pdf({
  path: new URL("Template-Studio-Guide.pdf", dir).pathname, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font:8pt Helvetica;color:#575D75;text-align:center">Template Studio &middot; <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
});
await browser.close();
rmSync(cssFile); rmSync(html);
