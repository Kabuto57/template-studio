import { Zip } from "../zip/minizip";
import { scanPlaceholders, type Scanned } from "../engine/engine";
import { A_NS, R_NS, dig, kid, kids, num, parseXml, relsPathOf, resolvePath, serializeXml } from "./xml";

export interface SlideInfo { path: string; notes: string | null; layout: string | null; master: string | null }
export interface Rel { type: string; target: string | null }

/** One undo step: part name -> the XML it had before (null = the part did not exist). */
export type UndoStep = Record<string, string | null> & { _key?: string; _t?: number };

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", bmp: "image/bmp", webp: "image/webp",
};

/** An open .pptx: its parts as text, the slide order, theme colours, and an undo history. */
export class Deck {
  zip!: Zip;
  texts: Record<string, string> = {};
  media: Record<string, string> = {};
  W = 12192000;
  H = 6858000;
  slides: SlideInfo[] = [];
  theme: Record<string, string> = {};
  fonts: { major?: string; minor?: string } = {};
  defaultTextStyle: Element | null = null;
  undoStack: UndoStep[] = [];
  redoStack: UndoStep[] = [];
  /** Bumped on every change, so caches (generated Python, autosave) know when they are stale. */
  version = 0;

  static async load(bytes: Uint8Array): Promise<Deck> {
    const deck = new Deck();
    const zip = await Zip.load(bytes);
    for (const name of zip.names()) {
      if (!name.endsWith("/") && /\.(xml|rels)$/i.test(name)) deck.texts[name] = (await zip.text(name))!;
    }
    if (!deck.texts["ppt/presentation.xml"]) throw new Error("This file isn't a PowerPoint presentation (.pptx).");
    for (const name of zip.names()) {
      const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
      if (/^ppt\/media\//.test(name) && MIME[ext]) {
        try {
          deck.media[name] = URL.createObjectURL(new Blob([(await zip.bytes(name))! as BlobPart], { type: MIME[ext] }));
        } catch { /* skip an unreadable image; the slide still renders without it */ }
      }
    }
    deck.zip = zip;
    deck.index();
    return deck;
  }

  dispose(): void {
    for (const u of Object.values(this.media)) URL.revokeObjectURL(u);
    this.media = {};
  }

  relsOf(part: string): Record<string, Rel> {
    const out: Record<string, Rel> = {};
    const txt = this.texts[relsPathOf(part)];
    if (!txt) return out;
    for (const r of parseXml(txt).documentElement.children) {
      out[r.getAttribute("Id") ?? ""] = {
        type: (r.getAttribute("Type") ?? "").split("/").pop() ?? "",
        target: r.getAttribute("TargetMode") === "External" ? null : resolvePath(part, r.getAttribute("Target") ?? ""),
      };
    }
    return out;
  }

  relByType(part: string, type: string): string | null {
    return Object.values(this.relsOf(part)).find(r => r.type === type)?.target ?? null;
  }

  /** Re-read the slide order, size and theme from the parts. Call after structural edits. */
  index(): void {
    const pres = parseXml(this.texts["ppt/presentation.xml"]!).documentElement;
    const sz = kid(pres, "sldSz");
    this.W = num(sz?.getAttribute("cx"), 12192000);
    this.H = num(sz?.getAttribute("cy"), 6858000);
    this.defaultTextStyle = kid(pres, "defaultTextStyle");
    const prels = this.relsOf("ppt/presentation.xml");
    this.slides = kids(kid(pres, "sldIdLst"), "sldId").flatMap(s => {
      const path = prels[s.getAttributeNS(R_NS, "id") || s.getAttribute("r:id") || ""]?.target;
      if (!path || !this.texts[path]) return [];
      const layout = this.relByType(path, "slideLayout");
      const master = layout ? this.relByType(layout, "slideMaster") : null;
      return [{ path, notes: this.relByType(path, "notesSlide"), layout, master }];
    });
    const master = this.slides[0]?.master;
    const themePath = master ? this.relByType(master, "theme") : null;
    this.theme = {};
    this.fonts = {};
    if (themePath && this.texts[themePath]) {
      const th = parseXml(this.texts[themePath]).documentElement;
      const scheme = th.getElementsByTagNameNS(A_NS, "clrScheme")[0];
      for (const c of scheme ? scheme.children : []) {
        const v = c.firstElementChild;
        this.theme[c.localName] = v ? (v.getAttribute("lastClr") || v.getAttribute("val") || "000000") : "000000";
      }
      const fs = th.getElementsByTagNameNS(A_NS, "fontScheme")[0];
      this.fonts.major = dig(fs, "majorFont", "latin")?.getAttribute("typeface") || "Calibri Light";
      this.fonts.minor = dig(fs, "minorFont", "latin")?.getAttribute("typeface") || "Calibri";
    }
  }

  /** Slide and notes parts in presentation order. */
  slideParts(): string[] {
    return this.slides.flatMap(s => (s.notes && this.texts[s.notes] ? [s.path, s.notes] : [s.path]));
  }

  /** Every {{placeholder}} in order of appearance, with whether it is always alone in its paragraph. */
  scan(): Scanned[] {
    const seen = new Map<string, Scanned>();
    for (const part of this.slideParts()) {
      for (const f of scanPlaceholders(this.texts[part]!)) {
        const prev = seen.get(f.key);
        if (!prev) seen.set(f.key, { key: f.key, alone: f.alone });
        else if (!f.alone) prev.alone = false;
      }
    }
    return [...seen.values()];
  }

  setPart(part: string, xml: string | null): void {
    if (xml === null) { delete this.texts[part]; this.zip.delete(part); }
    else { this.texts[part] = xml; this.zip.set(part, xml); }
    this.version++;
  }

  private pushUndo(step: UndoStep): void {
    this.undoStack.push(step);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Edit one part through the DOM. `fn` returns false to cancel. Edits sharing a `mergeKey`
   * within 1.5 s (typing, nudging) collapse into a single undo step.
   */
  mutate(part: string, fn: (doc: Document) => boolean | void, mergeKey?: string): boolean {
    const before = this.texts[part];
    if (before === undefined) return false;
    const doc = parseXml(before);
    if (fn(doc) === false) return false;
    const after = serializeXml(doc);
    if (after === before) return false;
    const now = Date.now(), last = this.undoStack[this.undoStack.length - 1];
    if (mergeKey && last && last._key === mergeKey && now - (last._t ?? 0) < 1500 && part in last) {
      last._t = now;
      this.redoStack = [];
    } else {
      const step: UndoStep = { [part]: before };
      Object.defineProperty(step, "_key", { value: mergeKey, writable: true, enumerable: false });
      Object.defineProperty(step, "_t", { value: now, writable: true, enumerable: false });
      this.pushUndo(step);
    }
    this.setPart(part, after);
    return true;
  }

  /** Edit several parts as one undo step (adding or deleting slides, renaming fields). */
  transaction(fn: (put: (part: string, xml: string | null) => void) => void): boolean {
    const step: UndoStep = {};
    fn((part, xml) => {
      if (!(part in step)) step[part] = this.texts[part] ?? null;
      this.setPart(part, xml);
    });
    if (!Object.keys(step).length) return false;
    this.pushUndo(step);
    this.index();
    return true;
  }

  private swap(from: UndoStep[], to: UndoStep[]): boolean {
    const step = from.pop();
    if (!step) return false;
    const inverse: UndoStep = {};
    for (const [part, xml] of Object.entries(step) as [string, string | null][]) {
      inverse[part] = this.texts[part] ?? null;
      this.setPart(part, xml);
    }
    to.push(inverse);
    this.index();
    return true;
  }
  undo(): boolean { return this.swap(this.undoStack, this.redoStack); }
  redo(): boolean { return this.swap(this.redoStack, this.undoStack); }

  bytes(): Promise<Uint8Array> { return this.zip.generate(); }
}
