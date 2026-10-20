// The slide in the middle and the filmstrip under it: drawing, selection, move/resize,
// and drops from the Elements and Fields panels.
import { fillXml, isSlidePart, newReport, parseContent, type Data, type Report } from "../engine/engine";
import { BLOCKS, LAYOUTS, selTextNode, setText, addLayoutSlide, type LayoutDef, boundsOf, copyObjs, deleteObjs, insertImage, moveObjs, pasteObjs, type Clip, blockDef, blockSize, deleteSlide, duplicateSlide, inches, insertBlock, moveSlide, placeField, readBox, resizeBox, setBox, snap, type BlockType, type FieldPayload, type Rect } from "../ooxml/edit";
import { collectObjects, fitPlaceholderBoxes, paraText, renderSlide } from "../ooxml/render";
import { esc, kid, kids, parseXml } from "../ooxml/xml";
import { $, ICON, el, toast } from "./dom";
import { openContextMenu } from "./inspector";
import { iconSvg, type IconDef } from "../ooxml/icons";
import { popover } from "./side";
import { S, clearSel, selected, setSel, ui } from "./state";

/* ---------------------------------------------------------------- filling for the Test view */
export function parseTest(): { data?: Data; error?: string } {
  try { return { data: parseContent(S.testText) }; }
  catch (e) { return { error: (e as Error).message }; }
}
export function fillAll(data: Data): { out: Record<string, string>; rep: Report } {
  const rep = newReport(), out: Record<string, string> = {};
  for (const [name, xml] of Object.entries(S.deck.texts)) {
    if (isSlidePart(name)) out[name] = fillXml(xml, data, rep, S.project.settings.colour_rules);
  }
  return { out, rep };
}

/* ---------------------------------------------------------------- drawing */
function callout(text: string): HTMLElement {
  const c = el("div", { class: "callout bad" });
  c.textContent = text;
  return c;
}

export function renderStage(): void {
  const host = $("#slideHost");
  host.replaceChildren();
  const { deck } = S;
  if (!deck.slides.length) { host.appendChild(callout("This file has no slides.")); $("#film").replaceChildren(); return; }
  const info = deck.slides[S.cur]!;
  let filled: Record<string, string> | null = null;
  let note = "";
  if (S.view === "test") {
    const t = parseTest();
    if (t.data) filled = fillAll(t.data).out;
    else note = "The test data isn't valid JSON yet, so this shows the template.";
  }
  const editable = S.view === "design";
  let slide: HTMLElement;
  try { slide = renderSlide(deck, S.cur, { xml: filled?.[info.path], highlight: !filled, editable }); }
  catch (e) { slide = callout(`This slide couldn't be shown: ${(e as Error).message}`); }
  slide.id = "mainSlide";
  host.style.setProperty("--ar", String(deck.W / deck.H));
  host.appendChild(slide);
  if (!filled) fitPlaceholderBoxes(slide);
  if (editable) drawOverlay();
  renderFilm(filled);
  $("#stageMeta").textContent = `Slide ${S.cur + 1} of ${deck.slides.length}`;
  $("#stageHint").innerHTML = note ? esc(note) : editable
    ? "<b>Step 1 of 3.</b> Pick a design, then click a yellow field to tell the LLM what to write there."
    : "<b>Step 2 of 3.</b> This is your template filled with sample data. Paste real LLM output on the right to check it.";
  $("#nextBtn").textContent = editable ? "Next: Test" : "Next: Get code";
}

function renderFilm(filled: Record<string, string> | null): void {
  const film = $("#film");
  const { deck } = S;
  const design = S.view === "design";
  film.style.setProperty("--ar", String(deck.W / deck.H));
  film.replaceChildren();
  deck.slides.forEach((s, i) => {
    const b = el("div", { class: "thumb", role: "button", tabindex: 0, "aria-current": String(i === S.cur) });
    let sl: HTMLElement;
    try { sl = renderSlide(deck, i, { xml: filled?.[s.path], highlight: !filled }); }
    catch { sl = el("div", { class: "slide", style: `aspect-ratio:${deck.W}/${deck.H}` }); }
    sl.setAttribute("aria-hidden", "true");
    sl.inert = true; // a picture of the slide, not content to read or tab into
    const mini = el("div", { class: "mini" });
    mini.appendChild(sl);
    b.append(mini, el("span", { class: "no" }, `<span class="sr">Slide </span>${i + 1}`));
    if (design) {
      const last = deck.slides.length - 1;
      b.appendChild(el("div", { class: "thumb-acts" },
        `<button type="button" data-act="left" title="Move earlier" aria-label="Move slide ${i + 1} earlier"${i === 0 ? " disabled" : ""}>${ICON.left}</button>` +
        `<button type="button" data-act="right" title="Move later" aria-label="Move slide ${i + 1} later"${i === last ? " disabled" : ""}>${ICON.right}</button>` +
        `<button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate slide ${i + 1}">${ICON.duplicate}</button>` +
        `<button type="button" data-act="del" title="Delete" aria-label="Delete slide ${i + 1}"${last === 0 ? " disabled" : ""}>${ICON.trash}</button>`));
    }
    b.addEventListener("click", e => {
      const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act) return slideAction(act, i);
      if (S.cur !== i) { S.cur = i; clearSel(); ui.renderStage(); ui.renderInspector(); }
    });
    b.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === b) b.click(); });
    film.appendChild(b);
  });
  if (design) {
    const add: HTMLElement = el("button", { type: "button", class: "add-slide", id: "addSlideBtn", "aria-haspopup": "dialog", title: "Add a slide" }, 'Add slide <i class="caret"></i>');
    add.addEventListener("click", () => popover(add, pop => {
      pop.appendChild(el("div", { class: "sect-title" }, "New slide"));
      const g = el("div", { class: "layouts" });
      for (const l of LAYOUTS) {
        const b = el("button", { type: "button", class: "layout-btn", "data-layout": l.id }, `${layoutArt(l)}<span>${l.label}</span>`);
        b.addEventListener("click", () => {
          try { S.cur = addLayoutSlide(deck, S.project, S.cur, l.id); clearSel(); ui.refresh(); toast(`${l.label} slide added`); }
          catch (e) { toast((e as Error).message); }
        });
        g.appendChild(b);
      }
      pop.appendChild(g);
    }));
    film.appendChild(add);
  }
  requestAnimationFrame(() => {
    film.querySelectorAll<HTMLElement>(".thumb .slide").forEach(fitPlaceholderBoxes);
    film.querySelector('.thumb[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

/** A thumbnail of a layout: dark bars for titles, yellow for fields, grey for panels. */
function layoutArt(l: LayoutDef): string {
  const colour = (t: string) => t === "title" || t === "label" ? "#41465C" : t === "box" ? "#D5DAE3" : t === "line" ? "#41465C" : "#F2A300";
  const parts = l.parts.map(([t, x, y, w, h]) => {
    const hh = t === "title" ? Math.min(h, 0.55) : t === "text" || t === "bullets" ? Math.min(h, 0.3) : h;
    const lines = (t === "text" || t === "bullets") ? [0, 0.55, 1.1].filter(o => o + 0.3 <= h).map(o => `<rect x="${x}" y="${y + o}" width="${w * (o ? 0.8 : 1)}" height="${hh}" rx=".12" fill="${colour(t)}" opacity="${o ? 0.6 : 1}"/>`).join("")
      : `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(hh, 0.08)}" rx=".12" fill="${colour(t)}"/>`;
    return lines;
  }).join("");
  return `<svg viewBox="0 0 13.333 7.5" aria-hidden="true"><rect width="13.333" height="7.5" fill="#fff"/>${parts}</svg>`;
}

function slideAction(act: string, i: number): void {
  const { deck } = S;
  clearSel();
  if (act === "dup") { S.cur = duplicateSlide(deck, i); toast("Slide duplicated"); }
  else if (act === "del") {
    if (!deleteSlide(deck, i)) { toast("A template needs at least one slide."); return; }
    S.cur = Math.min(i, deck.slides.length - 1);
    toast("Slide deleted");
  } else {
    const to = act === "left" ? i - 1 : i + 1;
    if (!moveSlide(deck, i, to)) return;
    S.cur = to;
  }
  ui.refresh();
}

/* ---------------------------------------------------------------- selection overlay */
function objRect(slide: HTMLElement, idx: number): { left: number; top: number; width: number; height: number } | null {
  const els = slide.querySelectorAll(`[data-obj="${idx}"]`);
  if (!els.length) return null;
  const sr = slide.getBoundingClientRect();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  els.forEach(e => { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
  return { left: l - sr.left, top: t - sr.top, width: r - l, height: b - t };
}

function currentBox(): Rect | null {
  const info = S.deck.slides[S.cur];
  if (!info || S.sel.obj === null) return null;
  const node = collectObjects(parseXml(S.deck.texts[info.path]!))[S.sel.obj];
  return node ? readBox(S.deck, node, info) : null;
}

export function drawOverlay(): void {
  const slide = document.getElementById("mainSlide");
  if (!slide) return;
  slide.querySelectorAll(".overlay, .guide, .marquee").forEach(e => e.remove());
  slide.querySelectorAll(".cellsel").forEach(e => e.classList.remove("cellsel"));
  if (S.sel.obj === null || S.view !== "design") return;
  const rc = objRect(slide, S.sel.obj);
  if (!rc) { clearSel(); return; }
  S.multi = S.multi.filter(i => objRect(slide, i));
  if (S.multi.length) {
    // several selected: a thin outline on each and one dashed box around them all
    const rects = selected().map(i => objRect(slide, i)!);
    for (const r of rects) slide.appendChild(el("div", { class: "overlay item", style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` }));
    const l = Math.min(...rects.map(r => r.left)), t = Math.min(...rects.map(r => r.top));
    const w = Math.max(...rects.map(r => r.left + r.width)) - l, h = Math.max(...rects.map(r => r.top + r.height)) - t;
    const ov = el("div", { class: "overlay all", style: `left:${l}px;top:${t}px;width:${w}px;height:${h}px` });
    ov.appendChild(el("div", { class: "size" }, `${selected().length} selected`));
    slide.appendChild(ov);
    return;
  }
  const ov = el("div", { class: "overlay", style: `left:${rc.left}px;top:${rc.top}px;width:${rc.width}px;height:${rc.height}px` });
  for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) ov.appendChild(el("div", { class: "h", "data-h": h }));
  const b = currentBox();
  ov.appendChild(el("div", { class: "size" }, b ? `${inches(b.cx)} × ${inches(b.cy)} in` : ""));
  slide.appendChild(ov);
  if (S.sel.cell !== null) slide.querySelector(`td.hit[data-edit="${S.sel.cell}"]`)?.classList.add("cellsel");
}

/* ---------------------------------------------------------------- pointer: select, move, resize */
function onPointerDown(e: PointerEvent): void {
  if (S.view !== "design" || e.button !== 0) return;
  // Text being typed in the inspector is applied on blur, which redraws the slide. Do that first,
  // then look up what is under the pointer in the fresh DOM.
  const typing = document.activeElement as HTMLElement | null;
  if (typing?.closest("#insp, #side, .inline-edit")) typing.blur();
  const slide = document.getElementById("mainSlide");
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!slide || !target || !slide.contains(target)) return;
  const h = target.closest<HTMLElement>(".h");
  if (h) { e.preventDefault(); return startDrag(e, slide, "resize", h.dataset.h); }
  const obj = target.closest<HTMLElement>("[data-obj]");
  if (!obj) { e.preventDefault(); return startMarquee(e, slide); }
  e.preventDefault();
  const i = +obj.dataset.obj!;
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    // Shift+click adds to or takes away from the selection
    const cur = selected();
    const next = cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i];
    ui.select({ obj: next[0] ?? null, cell: null }, { multi: next.slice(1) });
    return;
  }
  if (S.multi.length && selected().includes(i)) return startDrag(e, slide, "move");
  const td = target.closest<HTMLElement>("td.hit");
  const next = { obj: i, cell: td ? +td.dataset.edit! : null };
  if (S.sel.obj !== next.obj || S.sel.cell !== next.cell || S.multi.length) ui.select(next);
  startDrag(e, slide, "move");
}

/** Double-click a text box or table cell to type straight onto the slide, like PowerPoint. */
function inlineEdit(): boolean {
  const slide = document.getElementById("mainSlide"), info = S.deck.slides[S.cur];
  if (!slide || !info || S.sel.obj === null || S.multi.length || S.view !== "design") return false;
  const node = selTextNode(parseXml(S.deck.texts[info.path]!), S.sel);
  if (!node) return false;
  const host = S.sel.cell !== null ? slide.querySelector<HTMLElement>(`td.hit[data-edit="${S.sel.cell}"]`) : slide.querySelector<HTMLElement>(`[data-obj="${S.sel.obj}"]`);
  if (!host) return false;
  const sr = slide.getBoundingClientRect(), hr = host.getBoundingClientRect();
  const span = host.querySelector<HTMLElement>(".para span") ?? host;
  const cs = getComputedStyle(span), ps = getComputedStyle(host.querySelector(".para") ?? host);
  const ta = el("textarea", { class: "inline-edit", spellcheck: "true", "aria-label": "Edit text" });
  ta.value = kids(kid(node, "txBody"), "p").map(paraText).join("\n");
  Object.assign(ta.style, {
    left: `${hr.left - sr.left}px`, top: `${hr.top - sr.top}px`, width: `${hr.width}px`, minHeight: `${hr.height}px`,
    fontSize: cs.fontSize, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, color: cs.color, textAlign: ps.textAlign, lineHeight: ps.lineHeight,
  });
  const txt = host.querySelector<HTMLElement>(".txt") ?? host;
  const was = txt.style.visibility;
  txt.style.visibility = "hidden";
  slide.querySelector(".overlay")?.setAttribute("hidden", "");
  slide.appendChild(ta);
  const grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.max(hr.height, ta.scrollHeight)}px`; };
  grow();
  ta.focus();
  ta.select();
  const sel = { ...S.sel }, slideNo = S.cur;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    ta.remove();
    txt.style.visibility = was;
    if (save && setText(S.deck, slideNo, sel, ta.value)) ui.refresh(); else ui.drawOverlay();
  };
  ta.addEventListener("input", grow);
  ta.addEventListener("blur", () => finish(true));
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
  });
  return true;
}

/** Drag a box on an empty part of the slide to select everything inside it. */
function startMarquee(e: PointerEvent, slide: HTMLElement): void {
  const sr = slide.getBoundingClientRect();
  const x0 = e.clientX - sr.left, y0 = e.clientY - sr.top;
  let box: HTMLElement | null = null;
  try { slide.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
  const rectOf = (ev: PointerEvent) => {
    const x1 = ev.clientX - sr.left, y1 = ev.clientY - sr.top;
    return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  };
  const move = (ev: PointerEvent) => {
    const r = rectOf(ev);
    if (!box && Math.hypot(r.width, r.height) < 4) return;
    box ??= slide.appendChild(el("div", { class: "marquee" }));
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  };
  const up = (ev: PointerEvent) => {
    slide.removeEventListener("pointermove", move);
    slide.removeEventListener("pointerup", up);
    slide.removeEventListener("pointercancel", up);
    box?.remove();
    if (!box) { if (S.sel.obj !== null) ui.select({ obj: null, cell: null }); return; }
    const m = rectOf(ev);
    const n = collectObjects(parseXml(S.deck.texts[S.deck.slides[S.cur]!.path]!)).length;
    const hits: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = objRect(slide, i);
      if (r && r.left >= m.left - 1 && r.top >= m.top - 1 && r.left + r.width <= m.left + m.width + 1 && r.top + r.height <= m.top + m.height + 1) hits.push(i);
    }
    ui.select({ obj: hits[0] ?? null, cell: null }, { multi: hits.slice(1) });
  };
  slide.addEventListener("pointermove", move);
  slide.addEventListener("pointerup", up);
  slide.addEventListener("pointercancel", up);
}

/** Edges and centres other objects and the slide offer for snapping, in EMU. */
function snapLines(exclude: number[]): { xs: number[]; ys: number[] } {
  const info = S.deck.slides[S.cur]!;
  const xs = [0, S.deck.W / 2, S.deck.W], ys = [0, S.deck.H / 2, S.deck.H];
  collectObjects(parseXml(S.deck.texts[info.path]!)).forEach((n, i) => {
    if (exclude.includes(i)) return;
    const b = readBox(S.deck, n, info);
    if (b) { xs.push(b.x, b.x + b.cx / 2, b.x + b.cx); ys.push(b.y, b.y + b.cy / 2, b.y + b.cy); }
  });
  return { xs, ys };
}
/** Move `start` so one of its edges or its centre lands on a line within `tol`. */
function snapTo(start: number, size: number, lines: number[], tol: number): { at: number; line: number | null } {
  let best = { d: tol + 1, at: start, line: null as number | null };
  for (const l of lines) for (const off of [0, size / 2, size]) {
    const d = Math.abs(start + off - l);
    if (d < best.d) best = { d, at: l - off, line: l };
  }
  return { at: best.at, line: best.line };
}

function startDrag(e: PointerEvent, slide: HTMLElement, mode: "move" | "resize", handle = ""): void {
  const objs = selected();
  const box = objs.length > 1 ? boundsOf(S.deck, S.cur, objs) : currentBox();
  if (!box) return;
  const k = S.deck.W / slide.clientWidth; // EMU per CSS pixel
  const sx = e.clientX, sy = e.clientY;
  const els = objs.flatMap(i => [...slide.querySelectorAll<HTMLElement>(`[data-obj="${i}"]`)]);
  const ovs = [...slide.querySelectorAll<HTMLElement>(".overlay")];
  const ov = slide.querySelector<HTMLElement>(".overlay:not(.item):not(.all)");
  const ov0 = ov ? { l: parseFloat(ov.style.left), t: parseFloat(ov.style.top), w: parseFloat(ov.style.width), h: parseFloat(ov.style.height) } : null;
  const sizeLbl = slide.querySelector(".overlay .size");
  const lines = snapLines(objs);
  const isPic = objs.length === 1 && !!slide.querySelector(`img[data-obj="${objs[0]}"]`);
  let moved = false, nb: Rect = box;
  try { slide.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
  const guide = (dir: "v" | "h", at: number | null) => {
    slide.querySelector(`.guide.${dir}`)?.remove();
    if (at !== null) slide.appendChild(el("div", { class: `guide ${dir}`, style: dir === "v" ? `left:${at / k}px` : `top:${at / k}px` }));
  };
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (mode === "move") {
      // snap to other objects and the slide's edges and centre; hold Alt to place freely
      const tol = ev.altKey ? -1 : 6 * k;
      const gx = snapTo(box.x + dx * k, box.cx, lines.xs, tol), gy = snapTo(box.y + dy * k, box.cy, lines.ys, tol);
      nb = { ...box, x: gx.line === null ? snap(gx.at) : Math.round(gx.at), y: gy.line === null ? snap(gy.at) : Math.round(gy.at) };
      guide("v", gx.line); guide("h", gy.line);
      const tr = `${(nb.x - box.x) / k}px ${(nb.y - box.y) / k}px`;
      els.forEach(x => { x.style.translate = tr; });
      ovs.forEach(o => { o.style.translate = tr; });
      if (sizeLbl && objs.length === 1) sizeLbl.textContent = `${inches(nb.x)}, ${inches(nb.y)} in`;
    } else {
      let r = resizeBox(box, handle, dx * k, dy * k);
      // corners keep the proportions for pictures, or for anything with Shift held
      if ((ev.shiftKey || isPic) && handle.length === 2 && box.cx && box.cy) {
        const f = Math.max(r.cx / box.cx, r.cy / box.cy);
        const cx = box.cx * f, cy = box.cy * f;
        r = { cx, cy, x: handle.includes("w") ? box.x + box.cx - cx : box.x, y: handle.includes("n") ? box.y + box.cy - cy : box.y };
        nb = { x: Math.round(r.x), y: Math.round(r.y), cx: Math.round(r.cx), cy: Math.round(r.cy) };
      } else nb = { x: snap(r.x), y: snap(r.y), cx: snap(r.cx), cy: snap(r.cy) };
      if (ov && ov0) {
        const sxr = ov0.w / (box.cx / k || 1), syr = ov0.h / (box.cy / k || 1);
        Object.assign(ov.style, { left: ov0.l + (nb.x - box.x) / k + "px", top: ov0.t + (nb.y - box.y) / k + "px", width: nb.cx / k * sxr + "px", height: nb.cy / k * syr + "px" });
      }
      if (sizeLbl) sizeLbl.textContent = `${inches(nb.cx)} × ${inches(nb.cy)} in`;
    }
  };
  const up = () => {
    slide.removeEventListener("pointermove", move);
    slide.removeEventListener("pointerup", up);
    slide.removeEventListener("pointercancel", up);
    guide("v", null); guide("h", null);
    if (!moved) return;
    const ok = objs.length > 1 ? moveObjs(S.deck, S.cur, objs, nb.x - box.x, nb.y - box.y) : setBox(S.deck, S.cur, S.sel.obj, () => nb);
    if (ok) ui.refresh(); else ui.renderStage();
  };
  slide.addEventListener("pointermove", move);
  slide.addEventListener("pointerup", up);
  slide.addEventListener("pointercancel", up);
}

/* ---------------------------------------------------------------- drag from the side panel */
export type DragInfo = { kind: "block"; type: BlockType } | { kind: "field"; payload: FieldPayload };
let dragInfo: DragInfo | null = null;

function emuAt(ev: MouseEvent): { x: number; y: number; inside: boolean } | null {
  const slide = document.getElementById("mainSlide");
  if (!slide) return null;
  const r = slide.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) / r.width * S.deck.W, y: (ev.clientY - r.top) / r.height * S.deck.H,
    inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom,
  };
}
function dropTargetAt(ev: MouseEvent): HTMLElement | null {
  const slide = document.getElementById("mainSlide");
  const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("td.hit, .hit");
  return hit && slide?.contains(hit) ? hit : null;
}
function clearDropMarks(): void {
  document.querySelectorAll(".drop-target").forEach(e => e.classList.remove("drop-target"));
  document.querySelector(".block-preview")?.remove();
}

export function makeDraggable(node: HTMLElement, info: DragInfo): void {
  node.draggable = true;
  node.addEventListener("dragstart", e => {
    dragInfo = info;
    e.dataTransfer!.effectAllowed = "copy";
    e.dataTransfer!.setData("text/plain", info.kind === "block" ? info.type : `{{${info.payload.key || info.payload.list}}}`);
  });
  node.addEventListener("dragend", () => { dragInfo = null; clearDropMarks(); });
}

export function doInsertBlock(type: BlockType, centre?: { x: number; y: number }): void {
  const made = insertBlock(S.deck, S.project, S.cur, type, centre);
  if (!made) return;
  setSel(made.obj);
  S.selField = null;
  ui.refresh();
  toast(made.note ? `Added ${made.label.toLowerCase()} with ${made.note}` : `Added ${made.label.toLowerCase()}`);
}

/**
 * Add a picture. Big images are scaled to 1600 px and re-encoded, because the template, pictures
 * included, is built into the generated Python and has to stay small enough for Dify.
 */
export async function doInsertImage(file: File): Promise<void> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { toast("That file isn't a picture this browser can read."); return; }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const keep = (file.type === "image/png" || file.type === "image/jpeg") && k === 1 && file.size <= 200_000;
  let data: Uint8Array, ext: "png" | "jpeg" = file.type === "image/jpeg" ? "jpeg" : "png";
  if (keep) data = new Uint8Array(await file.arrayBuffer());
  else {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    // a picture with no see-through pixels is much smaller as a JPEG
    if (ext === "png" && !g.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v < 255)) ext = "jpeg";
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, `image/${ext}`, 0.85));
    if (!blob) { toast("Couldn't prepare that picture."); return; }
    data = new Uint8Array(await blob.arrayBuffer());
  }
  const obj = insertImage(S.deck, S.cur, data, ext, bmp.width, bmp.height);
  bmp.close();
  if (obj === null) return;
  setSel(obj);
  S.selField = null;
  ui.refresh();
  toast(`Added picture (${Math.round(data.length / 1024)} KB)`);
}

/** Draw a line icon in a colour as a 512 px PNG and add it, about 1.2 in square. */
export async function doInsertIcon(icon: IconDef, colour: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([iconSvg(icon, colour, 512)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d")!.drawImage(img, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/png"));
    if (!blob) return;
    const obj = insertImage(S.deck, S.cur, new Uint8Array(await blob.arrayBuffer()), "png", 512, 512, { w: 1.2, h: 1.2 }, `Icon ${icon.label}`);
    if (obj === null) return;
    setSel(obj);
    ui.refresh();
    toast(`Added ${icon.label.toLowerCase()} icon`);
  } catch { toast("Couldn't draw that icon."); }
  finally { URL.revokeObjectURL(url); }
}

let clip: Clip | null = null;
const CLIP_MARK = "[Template Studio element]";
export function copySelected(): boolean {
  clip = copyObjs(S.deck, S.cur, selected());
  return !!clip;
}
export function pasteClip(): boolean {
  if (!clip) return false;
  const got = pasteObjs(S.deck, S.cur, clip);
  if (!got.length) return false;
  setSel(got[0]!, got.slice(1));
  ui.refresh();
  return true;
}

export function doPlaceField(editIdx: number, payload: FieldPayload): void {
  const placed = placeField(S.deck, S.cur, editIdx, payload);
  if (!placed) return;
  const root = placed.key.replace(/^count:/, "").split(/[.=]/)[0];
  S.project.pending = (S.project.pending ?? []).filter(p => p !== root);
  S.sel = placed.sel;
  S.multi = [];
  ui.refresh();
  toast(`Placed {{${placed.key}}}`);
}

export function wireStage(openFile: (f: File) => void): void {
  const stage = $("#stage");
  $("#slideHost").addEventListener("pointerdown", onPointerDown);
  $("#slideHost").addEventListener("dblclick", () => { if (!inlineEdit()) { const t = document.getElementById("inspText") as HTMLTextAreaElement | null; t?.focus(); t?.select(); } });
  stage.addEventListener("dragover", e => {
    if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { e.preventDefault(); stage.classList.add("file-over"); return; }
    if (!dragInfo || S.view !== "design") return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    clearDropMarks();
    if (dragInfo.kind === "field") { dropTargetAt(e)?.classList.add("drop-target"); return; }
    const p = emuAt(e), slide = document.getElementById("mainSlide");
    if (!p?.inside || !slide) return;
    const size = blockSize(S.deck, blockDef(dragInfo.type)!);
    const kx = slide.clientWidth / S.deck.W;
    const x = Math.min(Math.max(p.x - size.cx / 2, 0), S.deck.W - size.cx), y = Math.min(Math.max(p.y - size.cy / 2, 0), S.deck.H - size.cy);
    slide.appendChild(el("div", { class: "block-preview", style: `left:${x * kx}px;top:${y * kx}px;width:${size.cx * kx}px;height:${Math.max(size.cy * kx, 2)}px` }));
  });
  stage.addEventListener("dragleave", e => {
    if (!stage.contains(e.relatedTarget as Node | null)) { clearDropMarks(); stage.classList.remove("file-over"); }
  });
  stage.addEventListener("drop", e => {
    stage.classList.remove("file-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) { e.preventDefault(); clearDropMarks(); return f.type.startsWith("image/") && S.view === "design" ? doInsertImage(f) : openFile(f); }
    if (!dragInfo || S.view !== "design") return;
    e.preventDefault();
    const info = dragInfo;
    dragInfo = null;
    const target = info.kind === "field" ? dropTargetAt(e) : null;
    const p = emuAt(e);
    clearDropMarks();
    if (info.kind === "block") { if (p?.inside) doInsertBlock(info.type, p); return; }
    if (!target) { toast("Drop the field onto a text box or a table cell."); return; }
    doPlaceField(+target.dataset.edit!, info.payload);
  });
  // Ctrl+C / Ctrl+X / Ctrl+V. The system clipboard gets a marker, so a screenshot copied later
  // pastes as a picture instead of the element copied earlier.
  const typingIn = (e: Event) => S.view !== "design" || !!(e.target as Element).closest?.("input, textarea, select, [contenteditable], dialog");
  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    if (typingIn(e) || S.sel.obj === null || document.getSelection()?.toString() || !copySelected()) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", CLIP_MARK);
    if (cut && deleteObjs(S.deck, S.cur, selected())) { clearSel(); ui.refresh(); }
  };
  document.addEventListener("copy", e => onCopy(e, false));
  document.addEventListener("cut", e => onCopy(e, true));
  document.addEventListener("paste", e => {
    if (typingIn(e)) return;
    const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); void doInsertImage(f); }
    else if (e.clipboardData?.getData("text/plain") === CLIP_MARK && pasteClip()) e.preventDefault();
  });
  $("#slideHost").addEventListener("contextmenu", e => {
    if (S.view !== "design") return;
    const slide = document.getElementById("mainSlide");
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!slide || !hit || !slide.contains(hit)) return;
    e.preventDefault();
    const obj = hit.closest<HTMLElement>("[data-obj]");
    if (obj && !selected().includes(+obj.dataset.obj!)) ui.select({ obj: +obj.dataset.obj!, cell: null });
    if (!obj) ui.select({ obj: null, cell: null });
    openContextMenu(e.clientX, e.clientY, { copy: copySelected, paste: pasteClip, canPaste: !!clip });
  });
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.view === "design") drawOverlay(); }, 100); });
}

export { BLOCKS };

/* ---------------------------------------------------------------- present */
/**
 * Full-screen slideshow of the deck filled with the test data, like PowerPoint's Slide Show.
 * Arrow keys, space or a click move on; Esc ends it.
 */
export function present(from = S.cur): void {
  const t = parseTest();
  const filled = t.data ? fillAll(t.data).out : null;
  const show = el("div", { class: "show", role: "dialog", "aria-label": "Slide show", tabindex: "-1" });
  const stage = el("div", { class: "show-stage" });
  const count = el("div", { class: "show-count" });
  show.append(stage, count);
  document.body.appendChild(show);
  let i = from;
  const draw = () => {
    const sl = renderSlide(S.deck, i, { xml: filled?.[S.deck.slides[i]!.path], highlight: !filled });
    sl.classList.add("show-slide");
    stage.replaceChildren(sl);
    stage.style.setProperty("--ar", String(S.deck.W / S.deck.H));
    if (!filled) fitPlaceholderBoxes(sl);
    count.textContent = `${i + 1} / ${S.deck.slides.length}${filled ? "" : " \u00B7 fields shown, test data isn't valid JSON"}`;
  };
  const end = () => {
    show.remove();
    document.removeEventListener("keydown", key, true);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { /* already out */ });
  };
  const go = (d: number) => { const n = i + d; if (n < 0) return; if (n >= S.deck.slides.length) return end(); i = n; draw(); };
  const key = (e: KeyboardEvent) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === "Home") { i = 0; draw(); }
    else if (e.key === "End") { i = S.deck.slides.length - 1; draw(); }
    else if (e.key === "Escape") { e.preventDefault(); end(); }
    e.stopPropagation();
  };
  document.addEventListener("keydown", key, true);
  show.addEventListener("click", e => go(e.clientX < innerWidth / 4 ? -1 : 1));
  show.addEventListener("contextmenu", e => { e.preventDefault(); go(-1); });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && show.isConnected) end(); });
  draw();
  show.focus();
  void show.requestFullscreen?.().catch(() => { /* a window-sized show is fine too */ });
}
