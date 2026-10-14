// Opening, saving and exporting the template.
import sampleUrl from "../assets/sample_template.pptx?url";
import sampleProject from "../assets/sample_project.json";
import sampleTest from "../assets/sample_test_data.json";
import { walk, toText, type Data } from "../engine/engine";
import { buildExample, buildModel, buildPrompt, buildSchema, humanize, normaliseProject, projectForCode, type Project } from "../model/fields";
import { buildPython, parsePythonFile } from "../model/python";
import { Deck } from "../ooxml/deck";
import { b64ToBytes, bytesToB64 } from "../ooxml/xml";
import { forgetEverything, loadCurrent, newDocId, saveCurrent, type SavedDoc } from "../persist/db";
import { buildDeck, loadBlank, type Design } from "../templates/builder";
import { Zip } from "../zip/minizip";
import { $, debounce, download, safeName, toast } from "./dom";
import { fillAll } from "./stage";
import { S, clearSel, ui } from "./state";

export const exampleText = (): string => JSON.stringify(buildExample(S.project, S.model), null, 2);

interface OpenArgs { bytes: Uint8Array; project?: Partial<Project> | null; name?: string; testText?: string; testEdited?: boolean; cur?: number; id?: string; designId?: string | null }

export async function openProject(a: OpenArgs): Promise<void> {
  const deck = await Deck.load(a.bytes); // throws before anything is replaced if the file is bad
  if (S.deck) await saveNow(); // keep the outgoing template's latest state under Recent
  S.deck?.dispose();
  S.deck = deck;
  S.project = normaliseProject(a.project, a.name);
  S.docId = a.id ?? newDocId();
  S.designId = a.designId ?? null;
  S.model = buildModel(deck.scan());
  S.testText = a.testText || exampleText();
  S.testEdited = !!a.testEdited && !!a.testText;
  S.cur = Math.min(a.cur ?? 0, Math.max(0, deck.slides.length - 1));
  S.selField = null;
  S.py = { key: "", code: "", b64: "" };
  clearSel();
  $<HTMLInputElement>("#projName").value = S.project.name;
  ui.refresh();
}

const fetchBytes = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());

export const openSample = (): Promise<void> => fetchBytes(sampleUrl).then(bytes =>
  openProject({ bytes, project: sampleProject as Partial<Project>, testText: JSON.stringify(sampleTest, null, 2), testEdited: true, designId: "audit" }));

export const openBlank = async (): Promise<void> =>
  openProject({ bytes: await buildDeck([{ els: [] }], await loadBlank()), name: "New template", designId: "blank" });

export const openDesign = async (d: Design): Promise<void> =>
  openProject({ bytes: await buildDeck(d.slides), project: { ...d.project, name: d.name }, testText: JSON.stringify(d.test, null, 2), testEdited: true, designId: d.id });

export const openSaved = (d: SavedDoc): Promise<void> =>
  openProject({ bytes: d.bytes, project: d.project, testText: d.testText, testEdited: d.testEdited, cur: d.cur, id: d.id });

export async function restoreOrSample(): Promise<void> {
  const saved = await loadCurrent();
  if (saved) {
    try { return await openSaved(saved); } catch { /* a damaged autosave must not block the app */ }
  }
  await openSample();
}

const MAX_FILE = 100 * 1024 * 1024;

export async function openFile(file: File): Promise<void> {
  const base = file.name.replace(/\.[^.]+$/, "");
  try {
    if (file.size > MAX_FILE) throw new Error("That file is over 100 MB. Template Studio opens templates up to 100 MB.");
    if (/\.pptx$/i.test(file.name)) {
      await openProject({ bytes: new Uint8Array(await file.arrayBuffer()), name: humanize(base) });
      toast(S.model.entries.length ? `Opened ${file.name}. Its fields are in the Fields panel.` : `Opened ${file.name}. Drag fields onto its text boxes.`);
      ui.setSide("fields");
    } else {
      const { project, templateB64 } = parsePythonFile(await file.text());
      await openProject({ bytes: b64ToBytes(templateB64), project });
      toast(`Opened ${file.name} with its field settings.`);
    }
    ui.setView("design");
  } catch (e) {
    toast((e as Error).message || "Couldn't open that file.");
  }
}

/* ---------------------------------------------------------------- autosave */
const savedNote = (text: string) => { const n = document.getElementById("savedNote"); if (n) n.textContent = text; };

let wiping = false;
/** Remove everything stored in this browser and start again from the sample. */
export async function wipeAll(): Promise<void> {
  wiping = true; // a pending autosave must not put the template straight back
  await forgetEverything();
  location.reload();
}

export async function saveNow(): Promise<void> {
  if (!S.deck || wiping) return;
  try {
    await saveCurrent({
      id: S.docId, name: S.project.name, bytes: await S.deck.bytes(), project: S.project,
      testText: S.testText, testEdited: S.testEdited, cur: S.cur, savedAt: Date.now(),
    });
    savedNote("Saved on this device");
  } catch {
    savedNote("Not saved: browser storage is off"); // private windows; the kit download is the durable copy
  }
}
export const save = debounce(() => { void saveNow(); }, 600);

/* ---------------------------------------------------------------- exports */
export async function templateB64(): Promise<string> {
  const key = String(S.deck.version);
  if (S.py.b64 && S.py.key.startsWith(key + "|")) return S.py.b64;
  return bytesToB64(await S.deck.bytes());
}

/** fill_pptx.py for the template as it is right now (cached until the template or settings change). */
export async function currentPython(): Promise<string> {
  const key = `${S.deck.version}|${JSON.stringify(projectForCode(S.project))}`;
  if (S.py.key === key) return S.py.code;
  const b64 = await templateB64();
  const code = buildPython(S.project, S.model, b64);
  S.py = { key, code, b64 };
  return code;
}

export async function filledBytes(data: Data): Promise<Uint8Array> {
  const z = await Zip.load(await S.deck.bytes());
  for (const [n, x] of Object.entries(fillAll(data).out)) z.set(n, x);
  return z.generate();
}

export function outputName(data: Data): string {
  const f = S.project.settings.file_name_field;
  const [found, v] = f ? walk(data, f) : [false, null];
  return `${safeName((found ? toText(v) : "") || S.project.name)}.pptx`;
}

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function downloadFilled(data: Data): Promise<void> {
  download(outputName(data), await filledBytes(data), PPTX);
}
export async function downloadTemplate(): Promise<void> {
  download(`${safeName(S.project.name)}_template.pptx`, await S.deck.bytes(), PPTX);
}

export async function buildKitZip(): Promise<{ name: string; bytes: Uint8Array }> {
  const kit = new Zip();
  const folder = safeName(S.project.name);
  const put = (name: string, content: string | Uint8Array) => kit.set(`${folder}/${name}`, content);
  put("fill_pptx.py", await currentPython());
  put("template.pptx", await S.deck.bytes());
  put("example_body.json", exampleText());
  put("json_schema.json", JSON.stringify(buildSchema(S.project, S.model), null, 2));
  put("llm_prompt.txt", buildPrompt(S.project, S.model));
  put("fields.json", JSON.stringify(projectForCode(S.project), null, 2));
  put("README.txt", [
    `${S.project.name} - made with Template Studio`, "",
    "fill_pptx.py      Paste into a Dify Code node (Python 3), or run: python fill_pptx.py example_body.json out.pptx",
    "                  Input: content_json (String). Outputs: pptx_base64, file_name, status, message (all String).",
    "llm_prompt.txt    System prompt for the Dify LLM node.",
    "json_schema.json  Structured-output schema for the LLM node (optional).",
    "example_body.json Example of the JSON the LLM should return.",
    "template.pptx     The template (also embedded in fill_pptx.py).",
    "fields.json       Field settings. Works with pptx_kit.py: python pptx_kit.py watch template.pptx",
    "", "To keep editing: open template.pptx or fill_pptx.py in Template Studio.",
  ].join("\r\n"));
  return { name: `${folder}_kit.zip`, bytes: await kit.generate() };
}

export async function downloadKit(): Promise<void> {
  const { name, bytes } = await buildKitZip();
  download(name, bytes, "application/zip");
}
