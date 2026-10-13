import { describe, expect, it } from "vitest";
import { fillXml, lookup, newReport, parseContent, reportableMissing, rewritePlaceholders, scanPlaceholders, toText, type ColourRule, type Data } from "../../src/engine/engine";
import { cell, para, row, run, tbl } from "./helpers";

const fill = (xml: string, data: Data, rules: ColourRule[] = []) => {
  const report = newReport();
  return { xml: fillXml(xml, data, report, rules), report };
};
const RAG: ColourRule[] = [{ match: "High", fill: "FADBD8", text: "A93226" }];

describe("placeholders", () => {
  it("replaces text in place and keeps the run's formatting", () => {
    const { xml } = fill(para(run("Hello {{name}}!", '<a:rPr b="1"/>')), { name: "World" });
    expect(xml).toBe(para(run("Hello World!", '<a:rPr b="1"/>')));
  });

  it("joins a placeholder PowerPoint split across runs", () => {
    const { xml, report } = fill(para(run("{{re", '<a:rPr sz="2000"/>'), run("port_"), run("title}} draft")), { report_title: "Audit" });
    expect(xml).toBe(para(run("Audit", '<a:rPr sz="2000"/>'), run(""), run(" draft")));
    expect([...report.replaced]).toEqual(["report_title"]);
  });

  it("handles several placeholders in one paragraph", () => {
    expect(fill(para(run("{{a}} and {{b}}")), { a: "1", b: "2" }).xml).toBe(para(run("1 and 2")));
  });

  it("escapes XML in values and reads entities in the template", () => {
    expect(fill(para(run("{{x}}")), { x: "R&D <b> \"q\"" }).xml).toBe(para(run('R&amp;D &lt;b&gt; "q"')));
    expect(fill(para(run("&#x7B;&#123;x}} &amp; co")), { x: "ok" }).xml).toBe(para(run("ok &amp; co")));
  });

  it("tolerates spaces inside the braces", () => {
    expect(fill(para(run("{{  name  }}")), { name: "x" }).xml).toBe(para(run("x")));
  });

  it("blanks missing keys and reports them, except unsent list rows", () => {
    const { xml, report } = fill(para(run("[{{gone}}][{{rows.3.name}}]")), { rows: [{ name: "a" }] });
    expect(xml).toBe(para(run("[][]")));
    expect([...report.missing].sort()).toEqual(["gone", "rows.3.name"]);
    expect(reportableMissing(report)).toEqual(["gone"]);
  });
});

describe("lists", () => {
  const bullet = `<a:p><a:pPr marL="1"><a:buChar char="•"/></a:pPr>${run("{{points}}", '<a:rPr sz="1600"/>')}<a:endParaRPr/></a:p>`;
  it("expands a lone placeholder into one paragraph per item, cloning the format", () => {
    const { xml } = fill(bullet, { points: ["one", "two"] });
    expect(xml).toBe(bullet.replace("{{points}}", "one") + bullet.replace("{{points}}", "two"));
  });
  it("keeps one empty paragraph for an empty list", () => {
    expect(fill(bullet, { points: [] }).xml).toBe(bullet.replace("{{points}}", ""));
  });
  it("splits a multi-line string like a list", () => {
    expect(fill(para(run("{{p}}")), { p: "a\r\nb\n\nc" }).xml).toBe(para(run("a")) + para(run("b")) + para(run("c")));
  });
  it("joins a list with commas when the placeholder is not alone", () => {
    expect(fill(para(run("Tags: {{t}}")), { t: ["a", "b"] }).xml).toBe(para(run("Tags: a, b")));
  });
});

describe("paths, groups and counts", () => {
  const data: Data = { client: { name: "ABC" }, findings: [{ title: "T1", risk: "High" }, { title: "T2", risk: " high " }, { title: "T3", risk: "Low" }], "a.b": "flat" };
  it("walks groups, 1-based list items and literal dotted keys", () => {
    expect(lookup(data, "client.name")).toEqual([true, "ABC"]);
    expect(lookup(data, "findings.2.title")).toEqual([true, "T2"]);
    expect(lookup(data, "findings.0.title")).toEqual([false, null]);
    expect(lookup(data, "findings.4.title")).toEqual([false, null]);
    expect(lookup(data, "a.b")).toEqual([true, "flat"]);
  });
  it("counts items, optionally by a condition (case and space insensitive)", () => {
    expect(lookup(data, "count:findings")).toEqual([true, 3]);
    expect(lookup(data, "count:findings.risk=High")).toEqual([true, 2]);
    expect(lookup(data, "count: findings.risk = low ")).toEqual([true, 1]);
    expect(lookup(data, "count:findings.risk=Medium")).toEqual([true, 0]);
  });
  it("treats a malformed count as missing instead of failing the whole deck", () => {
    expect(lookup(data, "count:findings=High")).toEqual([false, null]);
    expect(lookup(data, "count:client")).toEqual([false, null]);
    expect(lookup(data, "count:nope")).toEqual([false, null]);
  });
  it("turns values into text", () => {
    expect([null, true, false, 3, 2.5, ["a", 1], "x\r\ny\nz"].map(toText)).toEqual(["", "Yes", "No", "3", "2.5", "a, 1", "x y z"]);
    expect(toText({ a: "é" })).toBe('{"a":"é"}');
  });
});

describe("tables", () => {
  const header = row(cell(para(run("Title"))), cell(para(run("Risk"))));
  const item = (n: number) => row(cell(para(run(`{{f.${n}.title}}`))), cell(para(run(`{{f.${n}.risk}}`))));
  it("removes rows whose placeholders all come out empty, and keeps static rows", () => {
    const { xml } = fill(tbl(header, item(1), item(2), item(3)), { f: [{ title: "A", risk: "Low" }] });
    expect(xml).toBe(tbl(header, row(cell(para(run("A"))), cell(para(run("Low"))))));
  });
  it("keeps a row that has any value", () => {
    const { xml } = fill(tbl(item(1)), { f: [{ title: "", risk: "Low" }] });
    expect(xml).toContain("Low");
  });
  it("colours a cell whose whole text matches a rule", () => {
    const { xml } = fill(tbl(row(cell(para(run("{{r}}", '<a:rPr sz="1200" b="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr>')), '<a:tcPr anchor="ctr"><a:noFill/></a:tcPr>'))), { r: " high " }, RAG);
    expect(xml).toContain('<a:tcPr anchor="ctr"><a:solidFill><a:srgbClr val="FADBD8"/></a:solidFill></a:tcPr>');
    expect(xml).toContain('<a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="A93226"/></a:solidFill></a:rPr>');
  });
  it("leaves cells that only contain the word alone", () => {
    const c = cell(para(run("High priority")));
    expect(fill(tbl(row(c)), {}, RAG).xml).toBe(tbl(row(c)));
  });
  it("keeps border fills and puts the cell fill after the borders", () => {
    const border = '<a:lnL w="9525"><a:solidFill><a:srgbClr val="D9DFE6"/></a:solidFill></a:lnL><a:lnB w="9525"><a:solidFill><a:srgbClr val="D9DFE6"/></a:solidFill></a:lnB>';
    const { xml } = fill(tbl(row(cell(para(run("High")), `<a:tcPr>${border}<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr>`))), {}, RAG);
    expect(xml).toContain(`<a:tcPr>${border}<a:solidFill><a:srgbClr val="FADBD8"/></a:solidFill></a:tcPr>`);
  });
  it("adds cell and run properties when the cell has none", () => {
    const { xml } = fill(tbl(row(`<a:tc><a:txBody>${para(run("High"))}</a:txBody></a:tc>`)), {}, RAG);
    expect(xml).toContain('<a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="A93226"/></a:solidFill></a:rPr><a:t>High</a:t></a:r>');
    expect(xml).toContain('<a:tcPr><a:solidFill><a:srgbClr val="FADBD8"/></a:solidFill></a:tcPr></a:tc>');
  });
  it("handles a self-closing tcPr and keeps a run outline before the text fill", () => {
    const { xml } = fill(tbl(row(cell(para(run("High", '<a:rPr><a:ln w="1"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:ln><a:latin typeface="Arial"/></a:rPr>')), '<a:tcPr marL="1"/>'))), {}, RAG);
    expect(xml).toContain('<a:tcPr marL="1"><a:solidFill><a:srgbClr val="FADBD8"/></a:solidFill></a:tcPr>');
    expect(xml).toContain('<a:rPr b="1"><a:ln w="1"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:ln><a:solidFill><a:srgbClr val="A93226"/></a:solidFill><a:latin typeface="Arial"/></a:rPr>');
  });
});

describe("content parsing", () => {
  it("accepts objects, JSON text and ```json fences", () => {
    expect(parseContent({ a: 1 })).toEqual({ a: 1 });
    expect(parseContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseContent('  ```\n{"a":1}\n```  ')).toEqual({ a: 1 });
  });
  it("rejects anything that is not a JSON object", () => {
    expect(() => parseContent("[1]")).toThrow(/JSON object/);
    expect(() => parseContent("nope")).toThrow();
  });
});

describe("scanning and renaming", () => {
  const xml = para(run("{{title}}")) + para(run("By {{au"), run("thor}}")) + para(run("{{count:rows.risk=High}}"));
  it("lists placeholders with whether each stands alone", () => {
    expect(scanPlaceholders(xml)).toEqual([{ key: "title", alone: true }, { key: "author", alone: false }, { key: "count:rows.risk=High", alone: true }]);
  });
  it("rewrites placeholders, including ones split across runs", () => {
    const out = rewritePlaceholders(xml, k => (k === "author" ? "{{writer}}" : null));
    expect(scanPlaceholders(out).map(p => p.key)).toEqual(["title", "writer", "count:rows.risk=High"]);
  });
});
