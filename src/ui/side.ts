// The panel beside the tool rail: Designs, Elements, Fields, Settings.
import sampleProject from "../assets/sample_project.json";
import sampleUrl from "../assets/sample_template.pptx?url";
import sampleTest from "../assets/sample_test_data.json";
import { fillXml, newReport, type Data } from "../engine/engine";
import type { Project } from "../model/fields";
import { fieldType } from "../model/fields";
import { Deck } from "../ooxml/deck";
import { SHAPE_BLOCKS, deckColours, replaceColour, lookOf, blockDef, type BlockDef, type BlockType } from "../ooxml/edit";
import { shapeByGeom } from "../ooxml/shapes";
import { ICONS, iconSvg } from "../ooxml/icons";
import { renderSlide } from "../ooxml/render";
import { esc } from "../ooxml/xml";
import { forgetRecent, listRecent } from "../persist/db";
import { buildDeck, type Design } from "../templates/builder";
import { BRIEFS, MORE } from "../templates/designs";
import { $, ICON, el, toast } from "./dom";
import { fieldsPanel } from "./fields";
import { openBlank, openDesign, openSample, openSaved, wipeAll } from "./project";
import { doInsertBlock, doInsertIcon, makeDraggable } from "./stage";
import { S, ui } from "./state";

/* ---------------------------------------------------------------- designs */
type Rules = Project["settings"]["colour_rules"];
/** Cover thumbnails are real renders of each design's first slide, filled with its example data. Built once and reused. */
const covers = new Map<string, Promise<HTMLElement>>();
function cover(id: string, bytes: () => Promise<Uint8Array>, data: Data, rules: Rules): Promise<HTMLElement> {
  let p = covers.get(id);
  if (!p) {
    p = bytes().then(b => Deck.load(b)).then(deck =>
      renderSlide(deck, 0, { xml: fillXml(deck.texts[deck.slides[0]!.path]!, data, newReport(), rules) }));
    covers.set(id, p);
  }
  return p.then(node => node.cloneNode(true) as HTMLElement);
}

function designCard(id: string, name: string, blurb: string, palette: string[], bytes: () => Promise<Uint8Array>, data: Data, rules: Rules, open: () => Promise<void>): HTMLElement {
  const card = el("button", { class: "card", type: "button", "aria-current": String(S.designId === id), "data-design": id });
  const box = el("div", { class: "thumb-box mini" });
  card.append(box,
    el("span", { class: "name" }, `${esc(name)}<span class="dots">${palette.map(c => `<i style="background:#${c}"></i>`).join("")}</span>`),
    el("span", { class: "blurb" }, esc(blurb)));
  cover(id, bytes, data, rules).then(node => { node.inert = true; box.appendChild(node); }, () => { /* the card still works without a preview */ });
  card.addEventListener("click", () => {
    open().then(() => { ui.setView("design"); toast(`${name} opened. Your last template is under Recent.`); })
      .catch((e: Error) => toast(e.message));
  });
  return card;
}

function designsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Designs</h2><p>Pick a design to start. Yellow boxes are fields the LLM fills; everything else stays as you set it.</p>"));
  const card = (d: Design) => designCard(d.id, d.name, d.blurb, d.palette, () => buildDeck(d.slides), d.test as Data, d.project.settings.colour_rules, () => openDesign(d));
  const briefs = el("div", { class: "sect" });
  briefs.appendChild(el("div", { class: "sect-title" }, "Bank briefs"));
  const bgrid = el("div", { class: "gallery" });
  for (const d of BRIEFS) bgrid.appendChild(card(d));
  briefs.appendChild(bgrid);
  wrap.appendChild(briefs);
  const sect = el("div", { class: "sect" });
  sect.appendChild(el("div", { class: "sect-title" }, "More designs"));
  const grid = el("div", { class: "gallery" });
  grid.appendChild(designCard("audit", "Audit report", "Internal audit highlights", ["16253D", "2A7F8F", "EEF2F5"],
    async () => new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()),
    sampleTest as Data, (sampleProject as Partial<Project>).settings?.colour_rules ?? [], openSample));
  for (const d of MORE) grid.appendChild(card(d));
  const blank = el("button", { class: "card blank", type: "button", "aria-current": String(S.designId === "blank") },
    `<div class="thumb-box">${ICON.plus}</div><span class="name">Blank</span><span class="blurb">An empty 16:9 slide</span>`);
  blank.addEventListener("click", () => { void openBlank().then(() => { ui.setView("design"); ui.setSide("elements"); toast("Blank slide ready. Add elements from the left."); }); });
  grid.appendChild(blank);
  sect.appendChild(grid);
  wrap.appendChild(sect);

  const own = el("div", { class: "sect" });
  own.appendChild(el("div", { class: "sect-title" }, "Your own PowerPoint"));
  const drop = el("div", { class: "dropzone" }, "<span>Drop a .pptx anywhere on the slide, or</span>");
  const pick = el("button", { class: "btn", type: "button" }, "Choose a file");
  pick.addEventListener("click", () => $("#fileInput").click());
  drop.appendChild(pick);
  own.append(drop, el("span", { class: "hint" }, "Also opens a fill_pptx.py made here, with its field settings. The file is read in your browser and never uploaded."));
  wrap.appendChild(own);

  const recent = el("div", { class: "sect", hidden: true });
  recent.appendChild(el("div", { class: "sect-title" }, "Recent"));
  const list = el("div", { class: "recent" });
  recent.appendChild(list);
  wrap.appendChild(recent);
  void listRecent().then(docs => {
    const others = docs.filter(d => d.id !== S.docId);
    if (!others.length) return;
    recent.hidden = false;
    for (const d of others) {
      const row = el("div", { class: "recent-row" });
      const open = el("button", { class: "recent-open", type: "button" });
      open.append(el("b", {}, esc(d.name)), el("span", {}, new Date(d.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })));
      open.addEventListener("click", () => { void openSaved(d).then(() => { ui.setView("design"); toast(`Opened ${d.name}`); }); });
      const del = el("button", { class: "icon-btn small", type: "button", title: "Remove from this list", "aria-label": `Remove ${d.name} from recent` }, ICON.close);
      del.addEventListener("click", () => { void forgetRecent(d.id).then(() => ui.renderSide()); });
      row.append(open, del);
      list.appendChild(row);
    }
  });
  return wrap;
}

/* ---------------------------------------------------------------- elements */
const F = "#F2A300", L = "#C9CFDB", D = "#41465C", S2 = "#8C93A8";
const BLOCK_ART: Partial<Record<BlockType, string>> = {
  title: `<rect x="14" y="22" width="92" height="18" rx="4" fill="${F}"/>`,
  subtitle: `<rect x="14" y="16" width="92" height="12" rx="4" fill="${D}"/><rect x="14" y="34" width="66" height="9" rx="4" fill="${F}"/>`,
  text: `<rect x="14" y="14" width="92" height="7" rx="3.5" fill="${F}"/><rect x="14" y="27" width="92" height="7" rx="3.5" fill="${F}" opacity=".7"/><rect x="14" y="40" width="58" height="7" rx="3.5" fill="${F}" opacity=".45"/>`,
  bullets: [14, 27, 40].map((y, i) => `<circle cx="18" cy="${y + 3.5}" r="3" fill="${D}"/><rect x="28" y="${y}" width="${[78, 62, 70][i]}" height="7" rx="3.5" fill="${F}" opacity="${1 - i * 0.2}"/>`).join(""),
  quote: `<text x="12" y="40" font-size="40" font-family="Georgia" fill="${D}">“</text><rect x="34" y="20" width="70" height="8" rx="4" fill="${F}"/><rect x="34" y="34" width="50" height="8" rx="4" fill="${F}" opacity=".7"/>`,
  callout: `<rect x="14" y="10" width="92" height="42" rx="7" fill="${D}"/><rect x="26" y="21" width="68" height="8" rx="4" fill="${F}"/><rect x="26" y="34" width="44" height="8" rx="4" fill="${F}" opacity=".7"/>`,
  number: `<rect x="30" y="8" width="60" height="46" rx="8" fill="#fff" stroke="${L}"/><rect x="42" y="18" width="36" height="14" rx="4" fill="${F}"/><rect x="46" y="39" width="28" height="5" rx="2.5" fill="${L}"/>`,
  table: `<rect x="12" y="10" width="96" height="12" rx="3" fill="${D}"/>` + [26, 40].map(y => [12, 46, 80].map(x => `<rect x="${x}" y="${y}" width="28" height="10" rx="3" fill="${F}" opacity=".8"/>`).join("")).join(""),
  label: `<rect x="26" y="25" width="68" height="12" rx="4" fill="${D}"/>`,
  tag: `<rect x="30" y="20" width="60" height="22" rx="11" fill="${D}"/><rect x="44" y="28" width="32" height="6" rx="3" fill="#fff"/>`,
  box: `<rect x="26" y="10" width="68" height="42" rx="9" fill="${L}"/>`,
  frame: `<rect x="27" y="11" width="66" height="40" fill="none" stroke="${D}" stroke-width="3"/>`,
  circle: `<circle cx="60" cy="31" r="22" fill="${L}"/>`,
  line: `<rect x="16" y="29.5" width="88" height="3" rx="1.5" fill="${D}"/>`,
  arrow: `<rect x="16" y="29.5" width="76" height="3" rx="1.5" fill="${D}"/><path d="M90 22 104 31 90 40z" fill="${D}"/>`,
};
const PICTURE_ART = `<rect x="28" y="9" width="64" height="44" rx="5" fill="${L}"/><circle cx="44" cy="23" r="6" fill="#fff"/><path d="M28 47 50 30l14 11 10-7 18 13v1a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5z" fill="${D}"/>`;
/** The little picture on a block's button. */
function artOf(type: BlockType): string {
  if (type.startsWith("shape:")) {
    const s = shapeByGeom(type.slice(6));
    return s ? `<svg viewBox="-30 -4 160 108" aria-hidden="true"><polygon points="${s.poly}" fill="${S2}"/></svg>` : "";
  }
  return `<svg viewBox="0 0 120 62" aria-hidden="true">${BLOCK_ART[type] ?? ""}</svg>`;
}

/** Ask for a picture file; the stage takes it from there. */
export const pickImage = (): void => $("#imageInput").click();

function blockCard(b: BlockDef, compact = false): HTMLElement {
  const d = compact
    ? el("button", { class: "shape-btn", type: "button", "data-type": b.type, title: b.label, "aria-label": `Add ${b.label.toLowerCase()}` }, artOf(b.type))
    : el("button", { class: "block", type: "button", "data-type": b.type }, `<span class="pic">${artOf(b.type)}</span><span><b>${b.label}</b><span>${b.hint}</span></span>`);
  makeDraggable(d, { kind: "block", type: b.type });
  d.addEventListener("click", () => doInsertBlock(b.type));
  return d;
}
const defs = (types: BlockType[]): BlockDef[] => types.map(t => blockDef(t)!);
const TEXT: BlockType[] = ["title", "subtitle", "text", "bullets", "quote", "callout", "label", "tag"];
const BASIC_SHAPES: BlockType[] = ["box", "frame", "circle", "line", "arrow"];

/** Colour swatches plus a grid of icons; clicking one adds it in the chosen colour. */
let iconColour = "";
function iconPicker(): HTMLElement {
  const wrap = el("div");
  const look = lookOf(S.deck);
  const colours = [...new Set([look.accent, look.ink, look.muted, "FFFFFF"])];
  if (!colours.includes(iconColour)) iconColour = colours[0]!;
  const row = el("div", { class: "colour", role: "group", "aria-label": "Icon colour", style: "margin-bottom:10px" });
  const grid = el("div", { class: "shape-grid icons" });
  const paint = () => grid.querySelectorAll<HTMLElement>(".shape-btn").forEach(b => { b.style.color = `#${iconColour}`; b.style.background = iconColour === "FFFFFF" ? "#41465C" : ""; });
  for (const c of colours) {
    const b = el("button", { class: "sw", type: "button", style: `background:#${c}`, title: `#${c}`, "aria-label": `Icon colour #${c}`, "aria-pressed": String(c === iconColour) });
    b.addEventListener("click", ev => {
      ev.stopPropagation(); // choosing a colour keeps the menu open
      iconColour = c;
      row.querySelectorAll(".sw").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      paint();
    });
    row.appendChild(b);
  }
  for (const ic of ICONS) {
    const b = el("button", { class: "shape-btn", type: "button", title: ic.label, "aria-label": `Add ${ic.label.toLowerCase()} icon`, "data-icon": ic.id }, iconSvg(ic));
    b.addEventListener("click", () => void doInsertIcon(ic, iconColour));
    grid.appendChild(b);
  }
  paint();
  wrap.append(row, grid);
  return wrap;
}

function elementsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Elements</h2><p>Drag onto the slide, or click to add in the middle. Yellow parts are fields the LLM fills.</p>"));
  const section = (title: string, ...kids: HTMLElement[]) => {
    const sect = el("div", { class: "sect" });
    sect.append(el("div", { class: "sect-title" }, title), ...kids);
    wrap.appendChild(sect);
  };
  const grid = (items: HTMLElement[], cls = "blocks") => { const g = el("div", { class: cls }); g.append(...items); return g; };
  section("Text", grid(defs(TEXT).map(b => blockCard(b))));
  const pic = el("button", { class: "block", type: "button" }, `<span class="pic"><svg viewBox="0 0 120 62" aria-hidden="true">${PICTURE_ART}</svg></span><span><b>Picture</b><span>A logo or photo from your computer</span></span>`);
  pic.addEventListener("click", pickImage);
  section("Data and pictures", grid([...defs(["number", "table"]).map(b => blockCard(b)), pic]));
  section("Shapes", grid([...defs(BASIC_SHAPES), ...SHAPE_BLOCKS].map(b => blockCard(b, true)), "shape-grid"));
  section("Icons", iconPicker());
  return wrap;
}

/* ---------------------------------------------------------------- insert ribbon */
let openPop: HTMLElement | null = null;
function closePop(): void { openPop?.remove(); openPop = null; }
/** A dropdown under a ribbon button, like PowerPoint's Shapes gallery. */
export function popover(anchor: HTMLElement, fill: (pop: HTMLElement) => void): void {
  const was = openPop?.dataset.for === anchor.id;
  closePop();
  if (was) return;
  const pop = el("div", { class: "ins-pop", role: "dialog", "aria-label": anchor.title, "data-for": anchor.id });
  fill(pop);
  pop.addEventListener("click", e => { if ((e.target as Element).closest("button")) closePop(); });
  const r = anchor.getBoundingClientRect();
  document.body.appendChild(pop);
  // open below the button, or above it when there is no room (the filmstrip sits at the bottom)
  pop.style.top = `${r.bottom + 6 + pop.offsetHeight > innerHeight ? Math.max(8, r.top - 6 - pop.offsetHeight) : r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  openPop = pop;
  (pop.querySelector("button") as HTMLElement | null)?.focus();
}

export function renderInsertBar(): void {
  const bar = $("#insertBar");
  const btn = (label: string, art: string, title: string, onClick: () => void, type?: BlockType, more = false) => {
    const b = el("button", { class: "ins-btn" + (more ? " more" : ""), type: "button", title, id: more ? `pop-${label.toLowerCase().replace(/\W/g, "")}` : null, "aria-haspopup": more ? "dialog" : null },
      `${art}<span>${label}${more ? ' <i class="caret"></i>' : ""}</span>`);
    if (type) makeDraggable(b, { kind: "block", type });
    b.addEventListener("click", onClick);
    return b;
  };
  const SHORT: Partial<Record<BlockType, string>> = { number: "Number", bullets: "Bullets" };
  const blockBtn = (t: BlockType) => { const d = blockDef(t)!; return btn(SHORT[t] ?? d.label, artOf(t), `${d.label}: ${d.hint}`, () => doInsertBlock(t), t); };
  const group = (name: string, ...items: HTMLElement[]) => {
    const g = el("div", { class: "ins-group", role: "group", "aria-label": name });
    const row = el("div", { class: "ins-row" });
    row.append(...items);
    g.append(row, el("span", { class: "ins-name" }, name));
    bar.appendChild(g);
  };
  const moreText: HTMLElement = btn("More", artOf("quote"), "More text styles", () => popover(moreText, pop => {
    const g = el("div", { class: "blocks" });
    g.append(...defs(["quote", "callout", "label", "tag"]).map(b => blockCard(b)));
    pop.appendChild(g);
  }), undefined, true);
  group("Text", ...(["title", "subtitle", "text", "bullets"] as BlockType[]).map(blockBtn), moreText);
  const icons: HTMLElement = btn("Icons", `<svg viewBox="-12 -1 48 26" aria-hidden="true" style="color:#41465C">${ICONS[0]!.svg.replace(/<path/g, '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"')}</svg>`, "Icons", () => popover(icons, pop => {
    pop.appendChild(el("div", { class: "sect-title" }, "Icons"));
    pop.appendChild(iconPicker());
  }), undefined, true);
  group("Insert", blockBtn("number"), blockBtn("table"), icons, btn("Picture", `<svg viewBox="0 0 120 62" aria-hidden="true">${PICTURE_ART}</svg>`, "Picture: a logo or photo from your computer", pickImage));
  const shapes: HTMLElement = btn("Shapes", artOf("shape:star5"), "Shapes", () => popover(shapes, pop => {
    pop.appendChild(el("div", { class: "sect-title" }, "Shapes"));
    const g = el("div", { class: "shape-grid" });
    g.append(...[...defs(BASIC_SHAPES), ...SHAPE_BLOCKS].map(b => blockCard(b, true)));
    pop.appendChild(g);
  }), undefined, true);
  group("Draw", shapes, blockBtn("arrow"), blockBtn("line"));
  const fmt = el("div", { class: "ins-group fmt off", role: "group", "aria-label": "Format", id: "fmtGroup" });
  fmt.append(el("div", { class: "ins-row" }), el("span", { class: "ins-name" }, "Format: select some text"));
  bar.appendChild(fmt);
  document.addEventListener("pointerdown", e => { if (openPop && !(e.target as Element).closest(".ins-pop, .ins-btn.more, [aria-haspopup]")) closePop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && openPop) { const a = document.getElementById(openPop.dataset.for!); closePop(); a?.focus(); } });
  document.addEventListener("dragstart", closePop);
}

/* ---------------------------------------------------------------- settings */
function settingsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Settings</h2><p>How the finished deck is named and coloured.</p>"));
  const out = el("div", { class: "sect" });
  out.appendChild(el("label", { class: "sect-title", for: "fileNameField" }, "Name the file after"));
  const sel = el("select", { class: "inp", id: "fileNameField" });
  const opts: string[] = [];
  for (const e of S.model.entries) {
    if (e.kind === "field" && fieldType(S.project, e) === "text") opts.push(e.path);
    if (e.kind === "object") e.children.forEach(c => opts.push(c.path));
  }
  sel.innerHTML = '<option value="">The template name</option>' + opts.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  sel.value = opts.includes(S.project.settings.file_name_field) ? S.project.settings.file_name_field : "";
  sel.addEventListener("change", () => { S.project.settings.file_name_field = sel.value; ui.save(); });
  out.append(sel, el("span", { class: "hint" }, "Each generated deck takes its file name from this field's value."));
  wrap.appendChild(out);

  const pal = el("div", { class: "sect" });
  pal.appendChild(el("div", { class: "sect-title" }, "Template colours"));
  pal.appendChild(el("span", { class: "hint" }, "Change a colour and every slide follows, like a brand kit."));
  const prow = el("div", { class: "palette" });
  for (const c of deckColours(S.deck).slice(0, 12)) {
    const inp = el("input", { type: "color", value: `#${c}`, title: `#${c}: change everywhere`, "aria-label": `Change #${c} everywhere` });
    inp.addEventListener("change", () => {
      const to = inp.value.slice(1).toUpperCase();
      if (to !== c && replaceColour(S.deck, c, to)) { ui.refresh(); toast(`#${c} changed to #${to} on every slide`); }
    });
    prow.appendChild(inp);
  }
  pal.appendChild(prow);
  wrap.appendChild(pal);

  const rules = el("div", { class: "sect" });
  rules.appendChild(el("div", { class: "sect-title" }, "Table cell colours"));
  rules.appendChild(el("span", { class: "hint" }, "When a table cell's whole text matches, it gets this text colour and fill. Good for ratings."));
  const list = S.project.settings.colour_rules;
  list.forEach((rule, i) => {
    const row = el("div", { class: "rule" });
    const m = el("input", { class: "inp", type: "text", value: rule.match, placeholder: "Text to match", "aria-label": "Text to match" });
    const t = el("input", { type: "color", value: "#" + rule.text, title: "Text colour", "aria-label": "Text colour" });
    const f = el("input", { type: "color", value: "#" + rule.fill, title: "Fill colour", "aria-label": "Fill colour" });
    const del = el("button", { class: "icon-btn", type: "button", title: "Remove rule", "aria-label": "Remove rule" }, ICON.trash);
    const upd = () => { rule.match = m.value; rule.fill = f.value.slice(1).toUpperCase(); rule.text = t.value.slice(1).toUpperCase(); ui.save(); };
    [m, f, t].forEach(x => x.addEventListener("input", upd));
    del.addEventListener("click", () => { list.splice(i, 1); ui.save(); ui.renderSide(); });
    row.append(m, t, f, del);
    rules.appendChild(row);
  });
  const btns = el("div", { class: "row" });
  const add = el("button", { class: "btn small", type: "button" }, "Add rule");
  add.addEventListener("click", () => { list.push({ match: "", fill: "E9EEFF", text: "1E3EC9" }); ui.save(); ui.renderSide(); });
  const rag = el("button", { class: "btn small quiet", type: "button" }, "Add High / Medium / Low");
  rag.addEventListener("click", () => {
    for (const x of [{ match: "High", fill: "FADBD8", text: "A93226" }, { match: "Medium", fill: "FCEBCF", text: "9C640C" }, { match: "Low", fill: "D9F2E3", text: "1E7A46" }])
      if (!list.some(y => y.match.toLowerCase() === x.match.toLowerCase())) list.push(x);
    ui.save(); ui.renderSide();
  });
  btns.append(add, rag);
  rules.appendChild(btns);
  wrap.appendChild(rules);

  const how = el("div", { class: "sect" });
  how.innerHTML = `<div class="sect-title">How it works</div><ol class="steps-list">
    <li>Pick a design, or open your own PowerPoint.</li>
    <li>Drag fields onto text boxes and table cells, and say what each one is for.</li>
    <li>In Test, paste the JSON your LLM returned and check the slides.</li>
    <li>In Get code, copy the prompt, schema and Python into Dify.</li></ol>`;
  wrap.appendChild(how);

  const data = el("div", { class: "sect" });
  data.appendChild(el("div", { class: "sect-title" }, "Saved on this device"));
  data.appendChild(el("span", { class: "hint" }, "Your open template and recent ones are kept in this browser so you can come back to them. On a shared computer, remove them when you finish."));
  const wipe = el("button", { class: "btn small", type: "button", id: "wipeBtn" }, "Remove everything saved here");
  let armed = false;
  wipe.addEventListener("click", () => {
    if (!armed) { armed = true; wipe.textContent = "Click again to remove"; wipe.classList.add("danger"); return; }
    void wipeAll();
  });
  data.appendChild(wipe);
  wrap.appendChild(data);
  return wrap;
}

export function renderSide(): void {
  const host = $("#side");
  const scroll = host.scrollTop;
  const panel = S.side === "templates" ? designsPanel() : S.side === "elements" ? elementsPanel() : S.side === "fields" ? fieldsPanel() : settingsPanel();
  host.replaceChildren(panel);
  host.scrollTop = scroll;
  document.querySelectorAll<HTMLElement>("#rail [data-side]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.side === S.side)));
}
