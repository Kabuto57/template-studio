// The slide in the middle and the filmstrip under it: drawing, selection, move/resize,
// and drops from the Elements and Fields panels.
import { fillXml, isSlidePart, newReport, parseContent, type Data, type Report } from "../engine/engine";
import { BLOCKS, addBlankSlide, blockDef, blockSize, deleteSlide, duplicateSlide, inches, insertBlock, moveSlide, placeField, readBox, resizeBox, setBox, snap, type BlockType, type FieldPayload, type Rect } from "../ooxml/edit";
import { collectObjects, fitPlaceholderBoxes, renderSlide } from "../ooxml/render";
import { parseXml } from "../ooxml/xml";
import { $, ICON, el, toast } from "./dom";
import { S, clearSel, ui } from "./state";

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
  $("#stageHint").textContent = note || (editable
    ? "Drag elements and fields onto the slide. Arrow keys nudge, Delete removes."
    : "Your template filled with the test data.");
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
    b.append(sl, el("span", { class: "no" }, `<span class="sr">Slide </span>${i + 1}`));
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
    const add = el("button", { type: "button", class: "add-slide" }, "Add slide");
    add.addEventListener("click", () => {
      try { S.cur = addBlankSlide(deck, S.cur); clearSel(); ui.refresh(); toast("Slide added"); }
      catch (e) { toast((e as Error).message); }
    });
    film.appendChild(add);
  }
  requestAnimationFrame(() => {
    film.querySelectorAll<HTMLElement>(".thumb .slide").forEach(fitPlaceholderBoxes);
    film.querySelector('.thumb[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
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
  slide.querySelector(".overlay")?.remove();
  slide.querySelectorAll(".cellsel").forEach(e => e.classList.remove("cellsel"));
  if (S.sel.obj === null || S.view !== "design") return;
  const rc = objRect(slide, S.sel.obj);
  if (!rc) { clearSel(); return; }
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
  if (typing?.closest("#insp, #side")) typing.blur();
  const slide = document.getElementById("mainSlide");
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!slide || !target || !slide.contains(target)) return;
  const h = target.closest<HTMLElement>(".h");
  if (h) { e.preventDefault(); return startDrag(e, slide, "resize", h.dataset.h); }
  const obj = target.closest<HTMLElement>("[data-obj]");
  if (!obj) { if (S.sel.obj !== null) ui.select({ obj: null, cell: null }); return; }
  e.preventDefault();
  const td = target.closest<HTMLElement>("td.hit");
  const next = { obj: +obj.dataset.obj!, cell: td ? +td.dataset.edit! : null };
  if (S.sel.obj !== next.obj || S.sel.cell !== next.cell) ui.select(next);
  startDrag(e, slide, "move");
}

function startDrag(e: PointerEvent, slide: HTMLElement, mode: "move" | "resize", handle = ""): void {
  const box = currentBox();
  if (!box) return;
  const k = S.deck.W / slide.clientWidth; // EMU per CSS pixel
  const sx = e.clientX, sy = e.clientY;
  const els = [...slide.querySelectorAll<HTMLElement>(`[data-obj="${S.sel.obj}"]`)];
  const ov = slide.querySelector<HTMLElement>(".overlay");
  const ov0 = ov ? { l: parseFloat(ov.style.left), t: parseFloat(ov.style.top), w: parseFloat(ov.style.width), h: parseFloat(ov.style.height) } : null;
  const sizeLbl = ov?.querySelector(".size");
  let moved = false, nb: Rect = box;
  try { slide.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (mode === "move") {
      nb = { ...box, x: snap(box.x + dx * k), y: snap(box.y + dy * k) };
      const tr = `${(nb.x - box.x) / k}px ${(nb.y - box.y) / k}px`;
      els.forEach(x => { x.style.translate = tr; });
      if (ov) ov.style.translate = tr;
      if (sizeLbl) sizeLbl.textContent = `${inches(nb.x)}, ${inches(nb.y)} in`;
    } else {
      const r = resizeBox(box, handle, dx * k, dy * k);
      nb = { x: snap(r.x), y: snap(r.y), cx: snap(r.cx), cy: snap(r.cy) };
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
    if (!moved) return;
    if (setBox(S.deck, S.cur, S.sel.obj, () => nb)) ui.refresh(); else ui.renderStage();
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
  S.sel = { obj: made.obj, cell: null };
  S.selField = null;
  ui.refresh();
  toast(made.note ? `Added ${made.label.toLowerCase()} with ${made.note}` : `Added ${made.label.toLowerCase()}`);
}

export function doPlaceField(editIdx: number, payload: FieldPayload): void {
  const placed = placeField(S.deck, S.cur, editIdx, payload);
  if (!placed) return;
  const root = placed.key.replace(/^count:/, "").split(/[.=]/)[0];
  S.project.pending = (S.project.pending ?? []).filter(p => p !== root);
  S.sel = placed.sel;
  ui.refresh();
  toast(`Placed {{${placed.key}}}`);
}

export function wireStage(openFile: (f: File) => void): void {
  const stage = $("#stage");
  $("#slideHost").addEventListener("pointerdown", onPointerDown);
  $("#slideHost").addEventListener("dblclick", () => {
    const t = document.getElementById("inspText") as HTMLTextAreaElement | null;
    if (t) { t.focus(); t.select(); }
  });
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
    if (f) { e.preventDefault(); clearDropMarks(); return openFile(f); }
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
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.view === "design") drawOverlay(); }, 100); });
}

export { BLOCKS };
