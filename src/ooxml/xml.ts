export const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
export const PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? [...el.children].filter(c => c.localName === name) : [];
export const kid = (el: Element | null | undefined, name: string): Element | null =>
  el ? ([...el.children].find(c => c.localName === name) ?? null) : null;
export const dig = (el: Element | null | undefined, ...names: string[]): Element | null =>
  names.reduce<Element | null>((e, n) => kid(e, n), el ?? null);

export const parseXml = (s: string): Document => new DOMParser().parseFromString(s, "application/xml");

/** XMLSerializer may or may not emit the declaration; strip any, then add exactly one. */
export const serializeXml = (doc: Document): string =>
  XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
export const nodeXml = (node: Node): string => new XMLSerializer().serializeToString(node);

export const num = (v: unknown, d = 0): number =>
  (v === null || v === undefined || v === "" || isNaN(+(v as string))) ? d : +(v as string);

/** Escape text for HTML or XML attribute/element content. */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

export function relTarget(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

export const relsPathOf = (part: string): string => part.replace(/([^/]+)$/, "_rels/$1.rels");

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
