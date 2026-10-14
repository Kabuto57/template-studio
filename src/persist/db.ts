// Autosave in IndexedDB. Everything stays in this browser; nothing is sent anywhere.
import type { Project } from "../model/fields";

export interface SavedDoc {
  /** Stable id for a template, so reopening and saving updates one "recent" entry instead of adding more. */
  id: string;
  name: string;
  bytes: Uint8Array;
  project: Project;
  testText: string;
  testEdited: boolean;
  cur: number;
  savedAt: number;
}

const DB = "template-studio", STORE = "docs", CURRENT = "current", RECENT = "recent:";
export const MAX_RECENT = 5;

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is unavailable"));
  }));
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export const newDocId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function loadCurrent(): Promise<SavedDoc | null> {
  try { return (await run<SavedDoc | undefined>("readonly", s => s.get(CURRENT))) ?? null; }
  catch { return null; } // private browsing or blocked storage: start from the sample instead
}

/** Save the open template, and keep it in the list of recent templates (newest five). */
export async function saveCurrent(doc: SavedDoc): Promise<void> {
  await run("readwrite", s => s.put(doc, CURRENT));
  await run("readwrite", s => s.put(doc, RECENT + doc.id));
  const all = await listRecent();
  for (const old of all.slice(MAX_RECENT)) await run("readwrite", s => s.delete(RECENT + old.id));
}

export async function listRecent(): Promise<SavedDoc[]> {
  try {
    const all = await run<SavedDoc[]>("readonly", s => s.getAll(IDBKeyRange.bound(RECENT, RECENT + "￿")));
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}

export async function forgetRecent(id: string): Promise<void> {
  await run("readwrite", s => s.delete(RECENT + id));
}

/** Remove every template and setting this app has stored in this browser. */
export async function forgetEverything(): Promise<void> {
  (await open()).close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onblocked = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Could not clear storage"));
  });
}
