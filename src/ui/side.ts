// The panel beside the tool rail: Designs, Elements, Fields, Settings.
import sampleUrl from "../assets/sample_template.pptx?url";
import { fieldType } from "../model/fields";
import { Deck } from "../ooxml/deck";
import { BLOCKS, type BlockType } from "../ooxml/edit";
import { renderSlide } from "../ooxml/render";
import { esc } from "../ooxml/xml";
import { forgetRecent, listRecent } from "../persist/db";
import { buildDeck } from "../templates/builder";
import { DESIGNS } from "../templates/designs";
import { $, ICON, el, toast } from "./dom";
import { fieldsPanel } from "./fields";
import { openBlank, openDesign, openSample, openSaved } from "./project";
import { doInsertBlock, makeDraggable } from "./stage";
import { S, ui } from "./state";

/* ---------------------------------------------------------------- designs */
/** Cover thumbnails are real renders of each design's first slide, built once and reused. */
const covers = new Map<string, Promise<HTMLElement>>();
function cover(id: string, bytes: () => Promise<Uint8Array>): Promise<HTMLElement> {
  let p = covers.get(id);
  if (!p) {
    p = bytes().then(b => Deck.load(b)).then(deck => renderSlide(deck, 0, { highlight: true }));
    covers.set(id, p);
  }
  return p.then(node => node.cloneNode(true) as HTMLElement);
}

function designCard(id: string, name: string, blurb: string, palette: string[], bytes: () => Promise<Uint8Array>, open: () => Promise<void>): HTMLElement {
  const card = el("button", { class: "card", type: "button", "aria-current": String(S.designId === id), "data-design": id });
  const box = el("div", { class: "thumb-box" });
  card.append(box,
    el("span", { class: "name" }, `${esc(name)}<span class="dots">${palette.map(c => `<i style="background:#${c}"></i>`).join("")}</span>`),
    el("span", { class: "blurb" }, esc(blurb)));
  cover(id, bytes).then(node => { node.inert = true; box.appendChild(node); }, () => { /* the card still works without a preview */ });
  card.addEventListener("click", () => {
    open().then(() => { ui.setView("design"); toast(`${name} opened. Your last template is under Recent.`); })
      .catch((e: Error) => toast(e.message));
  });
  return card;
}

function designsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Designs</h2><p>Start from a finished deck. Fields are already placed and described.</p>"));
  const sect = el("div", { class: "sect" });
  const grid = el("div", { class: "gallery" });
  grid.appendChild(designCard("audit", "Audit report", "Internal audit highlights", ["16253D", "2A7F8F", "EEF2F5"],
    async () => new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()), openSample));
  for (const d of DESIGNS) grid.appendChild(designCard(d.id, d.name, d.blurb, d.palette, () => buildDeck(d.slides), () => openDesign(d)));
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
const F = "#F2A300", L = "#C9CFDB", D = "#41465C";
const BLOCK_ART: Record<BlockType, string> = {
  title: `<rect x="14" y="22" width="92" height="18" rx="4" fill="${F}"/>`,
  text: `<rect x="14" y="14" width="92" height="7" rx="3.5" fill="${F}"/><rect x="14" y="27" width="92" height="7" rx="3.5" fill="${F}" opacity=".7"/><rect x="14" y="40" width="58" height="7" rx="3.5" fill="${F}" opacity=".45"/>`,
  bullets: [14, 27, 40].map((y, i) => `<circle cx="18" cy="${y + 3.5}" r="3" fill="${D}"/><rect x="28" y="${y}" width="${[78, 62, 70][i]}" height="7" rx="3.5" fill="${F}" opacity="${1 - i * 0.2}"/>`).join(""),
  number: `<rect x="30" y="8" width="60" height="46" rx="8" fill="#fff" stroke="${L}"/><rect x="42" y="18" width="36" height="14" rx="4" fill="${F}"/><rect x="46" y="39" width="28" height="5" rx="2.5" fill="${L}"/>`,
  table: `<rect x="12" y="10" width="96" height="12" rx="3" fill="${D}"/>` + [26, 40].map(y => [12, 46, 80].map(x => `<rect x="${x}" y="${y}" width="28" height="10" rx="3" fill="${F}" opacity=".8"/>`).join("")).join(""),
  label: `<rect x="26" y="25" width="68" height="12" rx="4" fill="${D}"/>`,
  box: `<rect x="26" y="10" width="68" height="42" rx="9" fill="${L}"/>`,
  circle: `<circle cx="60" cy="31" r="22" fill="${L}"/>`,
  line: `<rect x="16" y="29.5" width="88" height="3" rx="1.5" fill="${D}"/>`,
};

function elementsPanel(): HTMLElement {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "panel-head" }, "<h2>Elements</h2><p>Drag onto the slide, or click to add in the middle. Yellow parts are fields.</p>"));
  const sect = el("div", { class: "sect" });
  const grid = el("div", { class: "blocks" });
  for (const b of BLOCKS) {
    const d = el("button", { class: "block", type: "button", "data-type": b.type },
      `<span class="pic"><svg viewBox="0 0 120 62" aria-hidden="true">${BLOCK_ART[b.type]}</svg></span><span><b>${b.label}</b><span>${b.hint}</span></span>`);
    makeDraggable(d, { kind: "block", type: b.type });
    d.addEventListener("click", () => doInsertBlock(b.type));
    grid.appendChild(d);
  }
  sect.appendChild(grid);
  wrap.appendChild(sect);
  return wrap;
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
