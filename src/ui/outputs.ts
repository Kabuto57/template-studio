// The Test panel (paste LLM JSON, see the slides fill) and the Get code page.
import { reportableMissing } from "../engine/engine";
import { buildExample, buildPrompt, buildSchema, rootOf } from "../model/fields";
import { DIFY_STRING_LIMIT, displayPython } from "../model/python";
import { b64ToBytes, esc } from "../ooxml/xml";
import { $, ICON, copyText, debounce, download, el, safeName, toast } from "./dom";
import { currentPython, downloadFilled, downloadKit, downloadTemplate, exampleText, filledBytes } from "./project";
import { fillAll, parseTest } from "./stage";
import { S, ui } from "./state";

/* ---------------------------------------------------------------- test */
export function renderTestPanel(): void {
  const host = $("#insp");
  if (!host.querySelector("#testJson")) buildTestPanel(host);
  const ta = $<HTMLTextAreaElement>("#testJson");
  if (document.activeElement !== ta) ta.value = S.testText;
  const status = $("#testStatus");
  status.replaceChildren();
  const t = parseTest();
  $<HTMLButtonElement>("#dlFilledBtn").disabled = !t.data;
  if (!t.data) { status.appendChild(el("div", { class: "callout bad" }, `This isn't valid JSON yet: ${esc(t.error)}`)); return; }
  const { rep } = fillAll(t.data);
  const missing = reportableMissing(rep);
  const roots = new Set(S.deck.scan().map(f => rootOf(f.key)));
  const unused = Object.keys(t.data).filter(k => !roots.has(k));
  const line = (cls: string, html: string) => status.appendChild(el("div", {}, `<span class="dot ${cls}"></span>${html}`));
  const codes = (keys: string[]) => keys.map(k => `<code>${esc(k)}</code>`).join(", ");
  line("ok", `${rep.replaced.size} field${rep.replaced.size === 1 ? "" : "s"} filled`);
  line(missing.length ? "warn" : "ok", missing.length ? `Left blank, not in the JSON: ${codes(missing)}` : "Nothing left blank");
  if (unused.length) line("warn", `In the JSON but not in the template: ${codes(unused)}`);
}

function buildTestPanel(host: HTMLElement): void {
  host.replaceChildren();
  const sect = el("div", { class: "sect" });
  sect.innerHTML = `
    <div class="insp-head"><h2>Test data</h2><button class="btn small quiet" type="button" id="resetTestBtn">Use the example</button></div>
    <label class="hint" for="testJson">Paste the JSON your LLM returned. The slides update as you type.</label>
    <textarea class="inp mono" id="testJson" spellcheck="false"></textarea>
    <div class="status" id="testStatus"></div>
    <button class="btn primary wide" type="button" id="dlFilledBtn">${ICON.download}Download filled deck</button>`;
  host.appendChild(sect);

  const dec = el("div", { class: "sect" });
  dec.innerHTML = `
    <div class="sect-title">Turn Dify's output into a file</div>
    <label class="hint" for="b64In">The Code node returns the deck as text in <code>pptx_base64</code>. Paste it here to save it as a .pptx.</label>
    <textarea class="inp mono" id="b64In" rows="3" spellcheck="false" placeholder="UEsDBBQAAAAI..."></textarea>
    <button class="btn wide" type="button" id="b64Btn">${ICON.download}Save as .pptx</button>`;
  host.appendChild(dec);

  const onTest = debounce(() => { renderTestPanel(); ui.renderStage(); ui.save(); }, 300);
  $<HTMLTextAreaElement>("#testJson").addEventListener("input", e => {
    S.testText = (e.target as HTMLTextAreaElement).value;
    S.testEdited = true;
    onTest();
  });
  $("#resetTestBtn").addEventListener("click", () => {
    S.testEdited = false;
    S.testText = exampleText();
    $<HTMLTextAreaElement>("#testJson").value = S.testText;
    renderTestPanel(); ui.renderStage(); ui.save();
  });
  $("#dlFilledBtn").addEventListener("click", () => { const t = parseTest(); if (t.data) void downloadFilled(t.data); });
  $("#b64Btn").addEventListener("click", () => {
    const raw = $<HTMLTextAreaElement>("#b64In").value;
    // Accept the bare string, a quoted string, or the whole JSON output of the Code node.
    let b64 = raw, name = `${safeName(S.project.name)}.pptx`;
    try {
      const j = JSON.parse(raw) as unknown;
      if (typeof j === "string") b64 = j;
      else if (j && typeof j === "object") {
        const o = j as Record<string, unknown>;
        if (typeof o.pptx_base64 === "string") b64 = o.pptx_base64;
        if (typeof o.file_name === "string" && o.file_name) name = o.file_name;
      }
    } catch { /* not JSON: treat it as the base64 text itself */ }
    b64 = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    try {
      const bytes = b64ToBytes(b64);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error("not a zip");
      download(name, bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } catch {
      toast("That doesn't look like a pptx_base64 value. Copy the whole string from Dify.");
    }
  });
}

/* ---------------------------------------------------------------- get code */
const arrow = ICON.arrow;

export function renderCodePage(): void {
  const host = $("#codePage");
  host.innerHTML = `<div class="code-wrap">
    <header>
      <h1>Get code</h1>
      <p>Three things to paste into a Dify workflow. They are generated from your template and update whenever it changes.</p>
    </header>
    <div class="flow" aria-label="How the pieces fit"><span>Your notes</span>${arrow}<span class="you">LLM node: prompt</span>${arrow}<span class="you">JSON</span>${arrow}<span class="you">Code node: Python</span>${arrow}<span>Filled .pptx</span></div>

    <section class="step"><div class="step-h"><span class="num">1</span><h2>LLM node: system prompt</h2>
      <div class="row"><button class="btn small" type="button" data-copy="prompt">${ICON.copy}Copy prompt</button></div>
      <p>Asks for exactly the JSON this template needs. In a Workflow, replace <code>{{#sys.query#}}</code> with your own input variable.</p></div>
      <div><label class="lbl" for="promptExtra">Extra instructions (optional)</label>
      <textarea class="inp" id="promptExtra" rows="2" placeholder="e.g. Write for the Audit Committee. Use British spelling."></textarea></div>
      <pre class="code wrap" id="promptOut" tabindex="0"></pre></section>

    <section class="step"><div class="step-h"><span class="num">2</span><h2>The JSON the LLM returns</h2>
      <div class="row"><div class="seg" role="group" aria-label="JSON view"><button type="button" id="jsonEx">Example</button><button type="button" id="jsonSc">JSON Schema</button></div>
      <button class="btn small" type="button" data-copy="json">${ICON.copy}Copy</button></div>
      <p>Paste the schema into the LLM node's structured output if your model supports it. The example is what a correct answer looks like.</p></div>
      <pre class="code" id="jsonOut" tabindex="0"></pre></section>

    <section class="step"><div class="step-h"><span class="num">3</span><h2>Code node: Python 3</h2>
      <div class="row"><button class="btn small primary" type="button" data-copy="python">${ICON.copy}Copy code</button></div>
      <p>Standard library only: nothing to install. The template is built into the code, so copy it again after you change the template.</p></div>
      <div class="io-wrap"><table class="io"><thead><tr><th>Variable</th><th>Type</th><th>Set to</th></tr></thead><tbody>
        <tr><td class="mono">content_json</td><td>String, input</td><td>The LLM node's <code>text</code> (or its structured output)</td></tr>
        <tr><td class="mono">pptx_base64</td><td>String, output</td><td>The finished .pptx as base64 text</td></tr>
        <tr><td class="mono">file_name</td><td>String, output</td><td>A file name taken from your template settings</td></tr>
        <tr><td class="mono">status</td><td>String, output</td><td><code>success</code> or <code>error</code></td></tr>
        <tr><td class="mono">message</td><td>String, output</td><td>Which fields were left blank, or what went wrong</td></tr></tbody></table></div>
      <div class="meter" id="pyMeter"><span id="pyMeta">Building the code…</span><div class="meter-bar"><i style="width:0"></i></div></div>
      <pre class="code" id="pyOut" tabindex="0"></pre>
      <p class="hint">A Code node returns text, not files. To get the .pptx, decode <code>pptx_base64</code>: paste it into Test, "Turn Dify's output into a file", or decode it in whatever receives your workflow's result. On a laptop, run <code>python fill_pptx.py content.json report.pptx</code>.</p></section>

    <section class="step"><div class="step-h"><span class="num">${ICON.download}</span><h2>Downloads</h2></div>
      <div class="downloads">
        <div class="dl"><b>The kit</b><p>Code, template, prompt, example, schema and field settings in one zip.</p><button class="btn primary" type="button" id="kitBtn2">Download kit</button></div>
        <div class="dl"><b>The template</b><p>The .pptx on its own, to keep editing in PowerPoint.</p><button class="btn" type="button" id="tplBtn">Download .pptx</button></div>
        <div class="dl"><b>For locked-down computers</b><p>pptx_kit.py builds the same kit from a .pptx with plain Python. No installs, no internet.</p><a class="btn" href="./pptx_kit.py" download="pptx_kit.py">Download pptx_kit.py</a></div>
      </div></section>
  </div>`;
  const prompt = () => buildPrompt(S.project, S.model);
  const json = () => JSON.stringify(S.jsonView === "schema" ? buildSchema(S.project, S.model) : buildExample(S.project, S.model), null, 2);
  const showJson = () => {
    $("#jsonOut").textContent = json();
    $("#jsonEx").setAttribute("aria-pressed", String(S.jsonView !== "schema"));
    $("#jsonSc").setAttribute("aria-pressed", String(S.jsonView === "schema"));
  };
  $<HTMLTextAreaElement>("#promptExtra").value = S.project.prompt_extra || "";
  $("#promptOut").textContent = prompt();
  showJson();
  $("#jsonEx").addEventListener("click", () => { S.jsonView = "example"; showJson(); });
  $("#jsonSc").addEventListener("click", () => { S.jsonView = "schema"; showJson(); });
  $("#promptExtra").addEventListener("input", e => {
    S.project.prompt_extra = (e.target as HTMLTextAreaElement).value;
    $("#promptOut").textContent = prompt();
    ui.save();
    renderPython();
  });
  $("#kitBtn2").addEventListener("click", () => void downloadKit());
  $("#tplBtn").addEventListener("click", () => void downloadTemplate());
  host.querySelectorAll<HTMLElement>("[data-copy]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.copy;
    if (k === "prompt") copyText(prompt(), $("#promptOut"));
    else if (k === "json") copyText(json(), $("#jsonOut"));
    else void currentPython().then(code => copyText(code, null)); // the full file, not the collapsed view
  }));
  renderPython();
}

const renderPython = debounce(() => {
  void (async () => {
    const meta = document.getElementById("pyMeta");
    try {
      const code = await currentPython();
      const out = document.getElementById("pyOut");
      if (!out || !meta) return;
      out.textContent = displayPython(code);
      // What Dify will be handed back: the filled deck, base64-encoded (4 characters per 3 bytes).
      const outChars = Math.ceil((await filledBytes(buildExample(S.project, S.model))).length / 3) * 4;
      const over = outChars > DIFY_STRING_LIMIT;
      const meter = $("#pyMeter");
      meter.classList.toggle("over", over);
      meter.querySelector<HTMLElement>("i")!.style.width = `${Math.min(100, outChars / DIFY_STRING_LIMIT * 100)}%`;
      const kb = (new Blob([code]).size / 1024).toFixed(0);
      meta.innerHTML = `<b>fill_pptx.py</b> is ${kb} KB. Its <code>pptx_base64</code> output is about ${outChars.toLocaleString()} characters` +
        (over
          ? `, over the ${DIFY_STRING_LIMIT.toLocaleString()} a self-hosted Dify allows by default. Raise <code>CODE_MAX_STRING_LENGTH</code> in Dify's settings, or remove large pictures from the template.`
          : `, within the ${DIFY_STRING_LIMIT.toLocaleString()} a self-hosted Dify allows by default.`);
    } catch (e) {
      if (meta) meta.textContent = "Couldn't build the code: " + (e as Error).message;
    }
  })();
}, 150);
