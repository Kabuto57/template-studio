import { describe, expect, it } from "vitest";
import { Zip, crc32 } from "../../src/zip/minizip";
import { OUT, bytes, py } from "./helpers";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const enc = new TextEncoder();

describe("minizip", () => {
  it("computes CRC-32 like zlib", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xCBF43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("refuses an entry that unpacks to more than its listing says (zip bomb)", async () => {
    const z = new Zip();
    z.set("big.xml", "slide ".repeat(5000));
    const out = await z.generate();
    const dv = new DataView(out.buffer);
    let p = 0;
    while (dv.getUint32(p, true) !== 0x02014b50) p++; // the central directory entry
    dv.setUint32(p + 24, 10, true);                   // claim it unpacks to 10 bytes
    await expect((await Zip.load(out)).bytes("big.xml")).rejects.toThrow(/far more/);
  });

  it("round-trips stored and deflated entries", async () => {
    const z = new Zip();
    const big = "slide ".repeat(5000);
    z.set("small.txt", "hi");                       // <= 64 bytes: stored
    z.set("big.xml", big);                          // compressible: deflated
    z.set("bin.dat", new Uint8Array([0, 255, 1, 254]));
    z.set("ünïcode/naïve.txt", "é");
    const out = await z.generate();
    expect(out.length).toBeLessThan(big.length / 10);
    const back = await Zip.load(out);
    expect(back.names()).toEqual(["small.txt", "big.xml", "bin.dat", "ünïcode/naïve.txt"]);
    expect(await back.text("small.txt")).toBe("hi");
    expect(await back.text("big.xml")).toBe(big);
    expect([...(await back.bytes("bin.dat"))!]).toEqual([0, 255, 1, 254]);
    expect(await back.text("ünïcode/naïve.txt")).toBe("é");
    expect(await back.bytes("missing")).toBeNull();
  });

  it("deletes and replaces entries", async () => {
    const z = new Zip();
    z.set("a", "1"); z.set("b", "2"); z.set("c", "3");
    const z2 = await Zip.load(await z.generate());
    z2.delete("b");
    z2.set("c", "three");
    const z3 = await Zip.load(await z2.generate());
    expect(z3.names()).toEqual(["a", "c"]);
    expect(z3.has("b")).toBe(false);
    expect(await z3.text("c")).toBe("three");
  });

  it("is deterministic: same content, same bytes", async () => {
    const make = async () => { const z = new Zip(); z.set("x.xml", "<a>".repeat(200)); return z.generate(); };
    expect(await make()).toEqual(await make());
  });

  it("reads a real .pptx and writes one Python's zipfile accepts", async () => {
    const z = await Zip.load(bytes("src/assets/sample_template.pptx"));
    expect(z.has("ppt/presentation.xml")).toBe(true);
    expect(await z.text("ppt/slides/slide1.xml")).toContain("{{report_title}}");
    z.set("ppt/slides/slide1.xml", (await z.text("ppt/slides/slide1.xml"))!);
    const file = join(OUT, "zip_roundtrip.pptx");
    writeFileSync(file, await z.generate());
    const res = py(["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip(), len(z.namelist()))", file]);
    expect(res.trim()).toBe(`None ${z.names().length}`);
  });

  it("rejects files that are not zips", async () => {
    await expect(Zip.load(enc.encode("not a zip at all, definitely"))).rejects.toThrow(/valid \.pptx/);
  });
});
