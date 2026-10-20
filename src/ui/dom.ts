export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];

type Attrs = Record<string, string | number | boolean | null | undefined>;
/** Create an element. `html` is trusted markup written in this codebase; escape user text with esc(). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  if (html) e.innerHTML = html;
  return e;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/** A normal browser download. The file is built in memory; nothing is uploaded. */
export function download(filename: string, data: Uint8Array | string, type = "application/octet-stream"): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Downloaded ${filename}`);
}

export function copyText(text: string, selectFallback?: HTMLElement | null): void {
  const fallback = () => {
    if (selectFallback) {
      const r = document.createRange();
      r.selectNodeContents(selectFallback);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    }
    toast("Text selected. Press Ctrl+C (Cmd+C) to copy.");
  };
  try { navigator.clipboard.writeText(text).then(() => toast("Copied"), fallback); } catch { fallback(); }
}

export const safeName = (s: unknown): string =>
  String(s ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "presentation";

/** Inline icons (20 px grid, stroked). */
export const ICON = {
  listNone: '<svg viewBox="0 0 20 20"><path d="M4 6h12M4 10h12M4 14h8"/></svg>',
  listBullet: '<svg viewBox="0 0 20 20"><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="10" r="1" fill="currentColor"/><circle cx="4.5" cy="14" r="1" fill="currentColor"/><path d="M8 6h8M8 10h8M8 14h8"/></svg>',
  listNumber: '<svg viewBox="0 0 20 20"><path d="M3.5 4.5h1v3M3.5 12.5h2l-2 2h2M8 6h8M8 10h8M8 14h8"/></svg>',
  duplicate: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 4.5H5.5a2 2 0 0 0-2 2V13"/></svg>',
  trash: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.600L14 6M8.5 9v4M11.5 9v4"/></svg>',
  front: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" fill-opacity=".18"/><path d="M15 9.5h1.5v7h-7V15"/></svg>',
  back: '<svg viewBox="0 0 20 20"><rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" fill-opacity=".18"/><path d="M5 10.5H3.5v-7h7V5"/></svg>',
  left: '<svg viewBox="0 0 20 20"><path d="M12 5 7 10l5 5"/></svg>',
  right: '<svg viewBox="0 0 20 20"><path d="m8 5 5 5-5 5"/></svg>',
  plus: '<svg viewBox="0 0 20 20"><path d="M10 4.5v11M4.5 10h11"/></svg>',
  close: '<svg viewBox="0 0 20 20"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/></svg>',
  download: '<svg viewBox="0 0 20 20"><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 15.5h12"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 4.5H5.5a2 2 0 0 0-2 2V13"/></svg>',
  arrow: '<svg viewBox="0 0 20 20"><path d="M4 10h12M12 6l4 4-4 4"/></svg>',
  check: '<svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>',
  alignL: '<svg viewBox="0 0 20 20"><path d="M4 3.5v13"/><rect x="7" y="6" width="9" height="3" rx="1"/><rect x="7" y="11" width="6" height="3" rx="1"/></svg>',
  alignC: '<svg viewBox="0 0 20 20"><path d="M10 3.5v13"/><rect x="5" y="6" width="10" height="3" rx="1"/><rect x="7" y="11" width="6" height="3" rx="1"/></svg>',
  alignR: '<svg viewBox="0 0 20 20"><path d="M16 3.5v13"/><rect x="4" y="6" width="9" height="3" rx="1"/><rect x="7" y="11" width="6" height="3" rx="1"/></svg>',
  alignT: '<svg viewBox="0 0 20 20"><path d="M3.5 4h13"/><rect x="6" y="7" width="3" height="9" rx="1"/><rect x="11" y="7" width="3" height="6" rx="1"/></svg>',
  alignM: '<svg viewBox="0 0 20 20"><path d="M3.5 10h13"/><rect x="6" y="5" width="3" height="10" rx="1"/><rect x="11" y="7" width="3" height="6" rx="1"/></svg>',
  alignB: '<svg viewBox="0 0 20 20"><path d="M3.5 16h13"/><rect x="6" y="4" width="3" height="9" rx="1"/><rect x="11" y="7" width="3" height="6" rx="1"/></svg>',
  textL: '<svg viewBox="0 0 20 20"><path d="M4 5.5h12M4 10h8M4 14.5h10"/></svg>',
  textC: '<svg viewBox="0 0 20 20"><path d="M4 5.5h12M6 10h8M5 14.5h10"/></svg>',
  textR: '<svg viewBox="0 0 20 20"><path d="M4 5.5h12M8 10h8M6 14.5h10"/></svg>',
} as const;
