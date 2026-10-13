// Reads and writes .zip/.pptx files with the platform's CompressionStream /
// DecompressionStream. No zip library, so nothing to download or trust.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]!) & 0xFF]! ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function pipe(u8: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(u8); c.close(); } });
  return new Uint8Array(await new Response(source.pipeThrough(stream)).arrayBuffer());
}
const inflate = (u8: Uint8Array) => pipe(u8, new DecompressionStream("deflate-raw") as TransformStream<Uint8Array, Uint8Array>);
const deflate = (u8: Uint8Array) => pipe(u8, new CompressionStream("deflate-raw") as TransformStream<Uint8Array, Uint8Array>);
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

export const zipSupported = (): boolean =>
  typeof CompressionStream === "function" && typeof DecompressionStream === "function";

interface Raw { method: number; crc: number; size: number; comp: Uint8Array }
interface Entry { data?: Uint8Array; raw?: Raw; dirty?: boolean }

export class Zip {
  private entries = new Map<string, Entry>();

  static async load(bytes: Uint8Array | ArrayBuffer): Promise<Zip> {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This file isn't a valid .pptx (zip) file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const z = new Zip();
    for (let i = 0; i < count; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("The file's zip directory is damaged.");
      const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
      const compSize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
      const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nLen));
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      z.entries.set(name, { raw: { method, crc, size, comp: u8.slice(start, start + compSize) } });
      p += 46 + nLen + xLen + cLen;
    }
    return z;
  }

  names(): string[] { return [...this.entries.keys()]; }
  has(name: string): boolean { return this.entries.has(name); }
  delete(name: string): void { this.entries.delete(name); }

  async bytes(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    if (!e.data) {
      const r = e.raw!;
      if (r.method === 0) e.data = r.comp;
      else if (r.method === 8) e.data = await inflate(r.comp);
      else throw new Error(`Unsupported compression in ${name}`);
    }
    return e.data;
  }

  async text(name: string): Promise<string | null> {
    const b = await this.bytes(name);
    return b ? dec.decode(b) : null;
  }

  set(name: string, content: string | Uint8Array | ArrayBuffer): void {
    const data = typeof content === "string" ? enc.encode(content)
      : content instanceof Uint8Array ? content : new Uint8Array(content);
    this.entries.set(name, { data, dirty: true });
  }

  async generate(): Promise<Uint8Array> {
    const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
    let offset = 0;
    for (const [name, e] of this.entries) {
      let raw: Raw;
      if (e.raw && !e.dirty) raw = e.raw;
      else {
        const data = e.data!;
        const d = data.length > 64 ? await deflate(data) : null;
        raw = d && d.length < data.length
          ? { method: 8, crc: crc32(data), size: data.length, comp: d }
          : { method: 0, crc: crc32(data), size: data.length, comp: data };
        e.raw = raw; e.dirty = false;
      }
      const { method, crc, size, comp } = raw;
      const nm = enc.encode(name);
      // Fixed timestamp (1980-01-01) and UTF-8 names: the same content always gives the same bytes.
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, size, true);
      lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, size, true);
      ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
      locals.push(new Uint8Array(lh.buffer), nm, comp);
      centrals.push(new Uint8Array(ch.buffer), nm);
      offset += 30 + nm.length + comp.length;
    }
    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.size, true); end.setUint16(10, this.entries.size, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let pos = 0;
    for (const part of parts) { out.set(part, pos); pos += part.length; }
    return out;
  }
}
