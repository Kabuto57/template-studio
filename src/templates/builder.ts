// Builds a real .pptx for a gallery design, starting from the bundled blank deck.
// Positions are in inches on a 13.333 x 7.5 in (16:9) slide.
import blankUrl from "../assets/blank.pptx?url";
import { Zip } from "../zip/minizip";
import { IN, blankSlideXml, layoutRelsXml, shapeXml, tableXml, type CellStyle, type ParaSpec, type ShapeSpec } from "../ooxml/edit";
import type { Project } from "../model/fields";

export type El = (id: number) => string;
export interface SlideSpec { bg?: string; els: El[] }
export interface Design {
  id: string;
  name: string;
  blurb: string;
  /** Three swatches shown on the gallery card. */
  palette: [string, string, string];
  slides: SlideSpec[];
  project: Omit<Project, "name" | "pending" | "prompt_extra"> & { prompt_extra?: string };
  /** Realistic LLM output, shown in the Test view. */
  test: Record<string, unknown>;
}

const box = (x: number, y: number, w: number, h: number) => ({ x: x * IN, y: y * IN, cx: w * IN, cy: h * IN });
type ShapeOpts = Partial<Pick<ShapeSpec, "geom" | "radius" | "line" | "lineW" | "anchor" | "ins" | "fill">> & { name?: string };

/** A filled shape with no text. */
export const shape = (x: number, y: number, w: number, h: number, fill: string | null, o: ShapeOpts = {}): El =>
  id => shapeXml({ id, name: o.name ?? `Shape ${id}`, box: box(x, y, w, h), ...o, fill });

/** A text box. Pass a string for one paragraph, or several paragraph specs. */
export const text = (x: number, y: number, w: number, h: number, paras: ParaSpec[] | string, style: Omit<ParaSpec, "text"> = {}, o: ShapeOpts = {}): El =>
  id => shapeXml({
    id, name: o.name ?? `Text ${id}`, box: box(x, y, w, h), ...o,
    ins: o.ins !== undefined ? o.ins * IN : 0,
    txBox: !o.fill,
    paras: (typeof paras === "string" ? [{ text: paras }] : paras).map(p => ({ ...style, ...p })),
  });

export interface TableOpts { cols: { key: string; label: string; w?: number }[]; rows: number; head?: CellStyle; body?: CellStyle; band?: string | null; headH?: number; rowH?: number }
export const table = (x: number, y: number, w: number, list: string, o: TableOpts): El =>
  id => tableXml({ id, name: `Table ${id}`, box: box(x, y, w, 0), list, ...o });

let blankBytes: Promise<Uint8Array> | null = null;
export const loadBlank = (): Promise<Uint8Array> =>
  (blankBytes ??= fetch(blankUrl).then(async r => new Uint8Array(await r.arrayBuffer())));

const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const LAYOUT = "ppt/slideLayouts/slideLayout1.xml";

export async function buildDeck(slides: SlideSpec[], blank?: Uint8Array): Promise<Uint8Array> {
  const zip = await Zip.load(blank ?? await loadBlank());
  let ct = (await zip.text("[Content_Types].xml"))!;
  let rels = (await zip.text("ppt/_rels/presentation.xml.rels"))!;
  let pres = (await zip.text("ppt/presentation.xml"))!;
  let nextId = 256;
  for (const m of pres.matchAll(/<p:sldId id="(\d+)"/g)) nextId = Math.max(nextId, +m[1]! + 1);
  slides.forEach((s, i) => {
    const path = `ppt/slides/slide${i + 1}.xml`;
    zip.set(path, blankSlideXml(s.els.map((el, k) => el(k + 2)).join(""), s.bg));
    if (i === 0) return; // the blank deck already registers slide 1
    zip.set(`ppt/slides/_rels/slide${i + 1}.xml.rels`, layoutRelsXml(LAYOUT));
    ct = ct.replace("</Types>", `<Override PartName="/${path}" ContentType="${SLIDE_CT}"/></Types>`);
    rels = rels.replace("</Relationships>", `<Relationship Id="rIdS${i + 1}" Type="${REL_SLIDE}" Target="slides/slide${i + 1}.xml"/></Relationships>`);
    pres = pres.replace("</p:sldIdLst>", `<p:sldId id="${nextId++}" r:id="rIdS${i + 1}"/></p:sldIdLst>`);
  });
  zip.set("[Content_Types].xml", ct);
  zip.set("ppt/_rels/presentation.xml.rels", rels);
  zip.set("ppt/presentation.xml", pres);
  return zip.generate();
}
