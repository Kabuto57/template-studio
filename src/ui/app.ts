// Wires the pieces together: views, selection, refresh, keyboard, dialogs.
import { buildModel } from "../model/fields";
import { GRID, moveObjs, setBox, type Sel } from "../ooxml/edit";
import { collectObjects } from "../ooxml/render";
import { parseXml } from "../ooxml/xml";
import { zipSupported } from "../zip/minizip";
import { $, $$, ICON, el, toast } from "./dom";
import { deleteSelected, duplicateSelected, groupSelected, renderInspector, toggleStyle, ungroupSelected } from "./inspector";
import { renderCodePage, renderTestPanel } from "./outputs";
import { downloadKit, exampleText, openFile, restoreOrSample, save } from "./project";
import { renderInsertBar, renderSide } from "./side";
import { doInsertImage, drawOverlay, renderStage, wireStage } from "./stage";
import { S, clearSel, selected, ui, type SideTab, type View } from "./state";

declare const __APP_VERSION__: string;
const REPO_URL = "https://github.com/Kabuto57/template-studio";

function renderView(): void {
  if (S.view === "code") renderCodePage();
  else {
    renderStage();
    if (S.view === "design") { renderSide(); renderInspector(); }
    else renderTestPanel();
  }
  $<HTMLButtonElement>("#undoBtn").disabled = !S.deck.undoStack.length;
  $<HTMLButtonElement>("#redoBtn").disabled = !S.deck.redoStack.length;
}

function refresh(): void {
  const { deck, project } = S;
  if (S.cur >= deck.slides.length) S.cur = Math.max(0, deck.slides.length - 1);
  const scanned = deck.scan();
  S.model = buildModel(scanned);
  if (!project.settings.file_name_field) {
    const t = S.model.entries.find(e => e.kind === "field" && /title/i.test(e.name));
    if (t?.kind === "field") project.settings.file_name_field = t.path;
  }
  const placed = new Set(scanned.map(f => f.key.replace(/^count:/, "").split(/[.=]/)[0]));
  project.pending = (project.pending ?? []).filter(p => !placed.has(p));
  if (!S.testEdited) S.testText = exampleText();
  renderView();
  save();
}

function setView(v: View): void {
  S.view = v;
  $("#app").dataset.view = v;
  $$("[data-view][role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("#codePage").hidden = v !== "code";
  if (v !== "design") $("#insp").replaceChildren();
  try { localStorage.setItem("template-studio:view", v); } catch { /* storage blocked: the view just won't be remembered */ }
  renderView();
}

function setSide(s: SideTab, fromRail = false): void {
  const app = $("#app");
  // clicking the open tab again folds the panel away for more room, like Canva
  const fold = fromRail && s === S.side && !app.classList.contains("side-hidden");
  app.classList.toggle("side-hidden", fold);
  S.side = s;
  renderSide();
  if (fold) $$<HTMLElement>("#rail [data-side]").forEach(b => b.setAttribute("aria-pressed", "false"));
}

function select(sel: Sel, opts: { field?: string | null; multi?: number[] } = {}): void {
  S.sel = sel;
  S.multi = (opts.multi ?? []).filter(i => i !== sel.obj);
  if (opts.field !== undefined) {
    S.selField = opts.field;
    if (opts.field) S.side = "fields";
    renderSide();
  }
  drawOverlay();
  renderInspector();
}

function undoRedo(which: "undo" | "redo"): void {
  if (!S.deck[which]()) return;
  clearSel();
  refresh();
  toast(which === "undo" ? "Undone" : "Redone");
}

function openAbout(keys = false): void {
  const d = $<HTMLDialogElement>("#aboutDialog");
  const fact = (title: string, text: string) => `<div class="fact">${ICON.check}<div><b>${title}</b><span>${text}</span></div></div>`;
  d.innerHTML = `<div class="dialog-body">
    <h2 id="aboutTitle">Template Studio</h2>
    <p>Design a PowerPoint template once, then let an LLM fill it. You get the prompt, the JSON schema and a Python script that pours the LLM's answer into your slides.</p>
    <div class="facts">
      ${fact("Your files stay on this device", "Templates and data are read and saved in your browser. Nothing is uploaded, and there is no account, server or tracking.")}
      ${fact("Works offline", "After the first visit the app runs without a connection. You can install it from your browser's menu.")}
      ${fact("Free and open source", "No paid tier. The generated Python uses only the standard library, so it runs in a Dify Code node as it is.")}
    </div>
    <details class="keys"><summary>Keyboard shortcuts</summary><dl>
      ${[["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Ctrl+C, X, V", "Copy, cut, paste (also screenshots)"], ["Ctrl+D", "Duplicate"], ["Ctrl+A", "Select everything on the slide"],
        ["Shift+click, or drag a box", "Select several"], ["Ctrl+G / Ctrl+Shift+G", "Group / ungroup"], ["Ctrl+B, I, U", "Bold, italic, underline"],
        ["Arrow keys (Shift for bigger steps)", "Nudge"], ["Alt while dragging", "Place without snapping"], ["Shift while resizing", "Keep proportions"],
        ["Delete", "Remove"], ["Esc", "Deselect"], ["Right-click", "More actions"], ["?", "This list"]]
        .map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join("")}</dl></details>
    <footer><span>Version ${__APP_VERSION__} · <a href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub</a></span>
    <button class="btn primary" type="button" id="aboutClose">Close</button></footer></div>`;
  d.querySelector("#aboutClose")!.addEventListener("click", () => d.close());
  if (keys) (d.querySelector("details.keys") as HTMLDetailsElement).open = true;
  d.showModal();
}

function wire(): void {
  wireStage(f => void openFile(f));
  $$("[data-view][role=tab]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view as View)));
  $$("#rail [data-side]").forEach(b => b.addEventListener("click", () => setSide(b.dataset.side as SideTab, true)));
  $("#undoBtn").addEventListener("click", () => undoRedo("undo"));
  $("#redoBtn").addEventListener("click", () => undoRedo("redo"));
  $("#aboutBtn").addEventListener("click", () => openAbout());
  $("#nextBtn").addEventListener("click", () => setView(S.view === "design" ? "test" : "code"));
  $("#kitBtn").addEventListener("click", () => void downloadKit());
  $("#openBtn").addEventListener("click", () => $("#fileInput").click());
  $("#aboutDialog").addEventListener("click", e => { if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close(); });
  const name = $<HTMLInputElement>("#projName");
  name.addEventListener("input", () => { S.project.name = name.value; save(); });
  name.addEventListener("keydown", e => { if (e.key === "Enter") name.blur(); });
  $<HTMLInputElement>("#imageInput").addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) { if (S.view !== "design") setView("design"); void doInsertImage(f); }
    input.value = "";
  });
  $<HTMLInputElement>("#fileInput").addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void openFile(f);
    input.value = "";
  });
  document.addEventListener("keydown", e => {
    const typing = (e.target as Element).closest?.("input, textarea, select, [contenteditable], dialog");
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === "z" && !typing) { e.preventDefault(); undoRedo(e.shiftKey ? "redo" : "undo"); return; }
    if (mod && key === "y" && !typing) { e.preventDefault(); undoRedo("redo"); return; }
    if (!typing && e.key === "?") { e.preventDefault(); openAbout(true); return; }
    if (!typing && S.view === "design" && mod && key === "a") {
      e.preventDefault();
      const n = S.deck.slides[S.cur] ? collectObjects(parseXml(S.deck.texts[S.deck.slides[S.cur]!.path]!)).length : 0;
      if (n) select({ obj: 0, cell: null }, { multi: [...Array(n).keys()].slice(1) });
      return;
    }
    if (typing || S.view !== "design" || S.sel.obj === null) return;
    if (mod && (key === "b" || key === "i" || key === "u") && !e.shiftKey && toggleStyle(key)) { e.preventDefault(); return; }
    if (mod && key === "g") { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    const step = e.shiftKey ? GRID * 10 : GRID;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
    else if (e.key === "Escape") select({ obj: null, cell: null });
    else if (mod && key === "d") { e.preventDefault(); duplicateSelected(); }
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if (S.multi.length ? moveObjs(S.deck, S.cur, selected(), dx, dy, "nudge") : setBox(S.deck, S.cur, S.sel.obj, b => ({ ...b, x: b.x + dx, y: b.y + dy }), "nudge")) refresh();
    }
  });
}

export async function boot(): Promise<void> {
  if (!zipSupported()) {
    $("#slideHost").appendChild(el("div", { class: "callout" }, "This browser is too old to open .pptx files. Use a current Chrome, Edge, Safari or Firefox."));
    return;
  }
  Object.assign(ui, {
    refresh, renderStage, renderSide, renderInspector, drawOverlay, save, select, setView, setSide,
    settingsChanged: () => { if (!S.testEdited) S.testText = exampleText(); save(); },
  });
  wire();
  renderInsertBar();
  let v: string | null = "design";
  try { v = localStorage.getItem("template-studio:view"); } catch { /* storage blocked */ }
  S.view = v === "test" || v === "code" ? v : "design";
  await restoreOrSample();
  setView(S.view);
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    // a new version took over from an old one: reload so the page shows it, not the cached copy
    if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    void navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is optional */ });
  }
}
