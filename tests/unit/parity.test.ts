// The rule that keeps the browser preview honest: engine.ts and python/engine.py must produce
// byte-identical slide XML and the same report for the same template and data.
import { describe, expect, it } from "vitest";
import { fillXml, isSlidePart, newReport, type ColourRule, type Data } from "../../src/engine/engine";
import { shapeXml, tableXml, blankSlideXml } from "../../src/ooxml/edit";
import { DESIGNS } from "../../src/templates/designs";
import { Zip } from "../../src/zip/minizip";
import { bytes, cell, json, para, py, row, run, tbl } from "./helpers";

interface Case { name: string; xml: string; data: Data; rules: ColourRule[] }
const RAG: ColourRule[] = [
  { match: "High", fill: "FADBD8", text: "A93226" }, { match: "Medium", fill: "FCEBCF", text: "9C640C" }, { match: "Low", fill: "D9F2E3", text: "1E7A46" },
  { match: "On track", fill: "D9F2E3", text: "1E7A46" }, { match: "P1", fill: "5A1E22", text: "FFB3B5" },
];

async function cases(): Promise<Case[]> {
  const out: Case[] = [];
  // 1. the audit sample, with complete, partial, empty and awkward data
  const zip = await Zip.load(bytes("src/assets/sample_template.pptx"));
  const sample = json<Data>("src/assets/sample_test_data.json");
  const rules = json<{ settings: { colour_rules: ColourRule[] } }>("src/assets/sample_project.json").settings.colour_rules;
  const awkward: Data = {
    report_title: "R&D <review> \"2026\" 'final' — café ☕ 𝒳", entity_name: 42, audit_period: null, report_date: true, prepared_by: 3.5,
    overall_rating: ["a", "b"], executive_summary: "line one\nline two\r\nline three", key_highlights: "one\ntwo\r\nthree",
    findings: [{ title: "only one", risk: "HIGH", owner: { team: "é" } }, "not an object", { risk: "low" }],
    conclusion: "{{not_a_field}} stays as text", "audit_scope": "",
  };
  for (const name of zip.names().filter(isSlidePart)) {
    const xml = (await zip.text(name))!;
    for (const [label, data] of [["full", sample], ["empty", {}], ["awkward", awkward], ["few rows", { ...sample, findings: (sample.findings as unknown[]).slice(0, 1) }]] as [string, Data][])
      out.push({ name: `sample ${name} / ${label}`, xml, data, rules });
  }
  // 2. every gallery design, filled with its own test data and with nothing
  for (const d of DESIGNS) {
    d.slides.forEach((s, i) => {
      const xml = blankSlideXml(s.els.map((el, k) => el(k + 2)).join(""), s.bg);
      out.push({ name: `${d.id} slide ${i + 1} / test`, xml, data: d.test, rules: d.project.settings.colour_rules });
      out.push({ name: `${d.id} slide ${i + 1} / empty`, xml, data: {}, rules: RAG });
    });
  }
  // 3. hand-made edge cases
  const box = { x: 0, y: 0, cx: 100, cy: 100 };
  const data: Data = { a: "A", n: 0, f: 1.0, big: 1e21, neg: -0.5, tiny: 1.5e-7, small: 0.00001, huge: 1.5e21, pow: 2 ** 60, sum: 0.1 + 0.2, whole: 123456.0, minus: -1e-10, list: ["x", "y"], empty: [], obj: { k: [1, 2] }, rows: [{ v: "High", w: "" }, { v: "medium" }, {}], "dotted.key": "D", deep: { er: { est: "ok" } } };
  const edge: [string, string][] = [
    ["split runs", para(run("{{"), run("a"), run("}}{{"), run("n}} {{f}}"))],
    ["numbers", para(run("{{n}}|{{f}}|{{big}}|{{neg}}|{{tiny}}|{{small}}|{{huge}}|{{pow}}|{{sum}}|{{whole}}|{{minus}}"))],
    ["lone list", para(run("  {{list}}  ", '<a:rPr lang="en-US"/>'))],
    ["empty list", para(run("{{empty}}"))],
    ["object value", para(run("{{obj}} {{deep.er.est}} {{dotted.key}}"))],
    ["counts", para(run("{{count:rows}} {{count:rows.v=high}} {{count:rows.v=Medium}} {{count:rows=x}} {{count:a}} {{count:nope.v=1}}"))],
    ["missing and odd keys", para(run("{{nope}} {{rows.9.v}} {{rows.x}} {{rows.1}} {{ a }} {{}} {{{a}}} {{a.b.c}}"))],
    ["entities", para(run("&#123;&#x7b;a}} &lt;{{a}}&gt; &amp; &quot;q&quot; &apos;s&apos;"))],
    ["empty text nodes", `<a:p><a:r><a:rPr/><a:t/></a:r>${run("{{a}}")}<a:r><a:t></a:t></a:r></a:p>`],
    ["table rows and colours", tbl(row(cell(para(run("Head")))), ...[1, 2, 3, 4].map(i => row(cell(para(run(`{{rows.${i}.v}}`))), cell(para(run(`{{rows.${i}.w}}`)), `<a:tcPr><a:lnL w="1"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL><a:noFill/></a:tcPr>`))))],
    ["generated shapes", shapeXml({ id: 2, name: 'A "name" & <more>', box, paras: [{ text: "{{a}} & co", sz: 20, b: true, font: "Arial" }, { text: "{{list}}", bullet: true }], fill: "FFFFFF", geom: "roundRect" })
      + tableXml({ id: 3, name: "T", box, list: "rows", rows: 4, cols: [{ key: "v", label: "V" }, { key: "w", label: "W" }] })],
  ];
  for (const [name, xml] of edge) out.push({ name, xml: `<p:sld>${xml}</p:sld>`, data, rules: RAG });
  // 4. hostile input: characters XML forbids, and a colour rule that tries to carry markup
  const nasty: Data = { a: "nul\u0000 vtab\u000b ff\u000c esc\u001b lone\ud800 pair\ud83d\ude00 tab\t fffe\ufffe", list: ["x\u0001", "y"], rows: [{ v: "High" }] };
  const badRules: ColourRule[] = [{ match: "High", fill: 'FF0000"/><a:evil/><a:srgbClr val="', text: "zzzzzz" }];
  out.push({ name: "forbidden characters", xml: `<p:sld>${para(run("{{a}}"))}${para(run("{{list}}"))}</p:sld>`, data: nasty, rules: RAG });
  out.push({ name: "hostile colour rule", xml: `<p:sld>${tbl(row(cell(para(run("{{rows.1.v}}")))))}</p:sld>`, data: nasty, rules: badRules });
  return out;
}

describe("engine parity (TypeScript vs Python)", async () => {
  const all = await cases();
  const fromPython = JSON.parse(py(["tests/py/parity_driver.py"], JSON.stringify({ cases: all }))) as { xml: string; replaced: string[]; missing: string[] }[];

  it("covers a meaningful number of fixtures", () => { expect(all.length).toBeGreaterThan(50); });

  it.each(all.map((c, i) => [c.name, i] as const))("%s", (_name, i) => {
    const c = all[i]!, report = newReport();
    const xml = fillXml(c.xml, c.data, report, c.rules);
    expect(xml).toBe(fromPython[i]!.xml);
    expect([...report.replaced].sort()).toEqual(fromPython[i]!.replaced);
    expect([...report.missing].sort()).toEqual(fromPython[i]!.missing);
  });

  it("never lets forbidden characters or rule markup into a slide", () => {
    for (const name of ["forbidden characters", "hostile colour rule"]) {
      const c = all.find(x => x.name === name)!;
      const xml = fillXml(c.xml, c.data, newReport(), c.rules);
      expect(xml).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|a:evil/);
      expect(xml).not.toMatch(/[\ud800-\udfff]/u); // no lone surrogates
      if (name === "forbidden characters") expect(xml).toContain("pair\ud83d\ude00"); // real emoji survive
    }
  });

  it("actually changes the fixtures (the comparison is not vacuous)", () => {
    const changed = all.filter((c, i) => fromPython[i]!.xml !== c.xml).length;
    expect(changed).toBeGreaterThan(all.length / 2);
  });
});
