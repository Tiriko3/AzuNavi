// Datenordner der Web-App. Zwei Varianten:
//  - "folder": ein Ordner, den du selbst wählst (z. B. OneDrive\AzuNavi). Geht in Chrome, Edge und Opera am PC.
//  - "browser": der private Speicher dieses Browsers (IndexedDB). Geht überall, auch im Handy-Browser und in Firefox.
// Inhalt des Ordners: azunavi.db (Datenbank), dateien/ (Anhänge, Porträts, Vorlage), azunavi.lock (wer gerade arbeitet)
type Kind = "folder" | "browser";
const IDB = "azunavi-web", KV = "kv", FILES = "files";
let kind: Kind | null = null;
let root: FileSystemDirectoryHandle | null = null;

export const canPickFolder = typeof window !== "undefined" && "showDirectoryPicker" in window;

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(KV); r.result.createObjectStore(FILES); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => { const q = fn(db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
const kvGet = <T,>(k: string) => tx<T | undefined>(KV, "readonly", (s) => s.get(k) as IDBRequest<T | undefined>);
const kvSet = (k: string, v: unknown) => tx(KV, "readwrite", (s) => s.put(v, k));
const kvDel = (k: string) => tx(KV, "readwrite", (s) => s.delete(k));

export interface SavedLocation { kind: Kind; name: string; needsPermission: boolean }
/** Zuletzt benutzter Speicherort (ohne ihn schon zu öffnen) */
export async function savedLocation(): Promise<SavedLocation | null> {
  const loc = await kvGet<{ kind: Kind; handle?: FileSystemDirectoryHandle }>("location");
  if (!loc) return null;
  if (loc.kind === "browser") return { kind: "browser", name: "Dieser Browser", needsPermission: false };
  if (!loc.handle) return null;
  const perm = await (loc.handle as any).queryPermission?.({ mode: "readwrite" });
  return { kind: "folder", name: loc.handle.name, needsPermission: perm !== "granted" };
}
/** Gespeicherten Ort wieder öffnen. Bei einem Ordner muss das nach einem Klick passieren (Berechtigung). */
export async function resumeSaved(): Promise<boolean> {
  const loc = await kvGet<{ kind: Kind; handle?: FileSystemDirectoryHandle }>("location");
  if (!loc) return false;
  if (loc.kind === "browser") { kind = "browser"; root = null; return true; }
  const h = loc.handle!; const perm = await (h as any).requestPermission?.({ mode: "readwrite" });
  if (perm !== "granted") return false;
  kind = "folder"; root = h; return true;
}
export async function chooseFolder(): Promise<boolean> {
  try {
    const h: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: "azunavi-daten", mode: "readwrite" });
    kind = "folder"; root = h; await kvSet("location", { kind, handle: h }); return true;
  } catch { return false; }   // abgebrochen
}
export async function useBrowserStorage(): Promise<void> {
  kind = "browser"; root = null; await kvSet("location", { kind });
  try { await navigator.storage?.persist?.(); } catch { /* Browser entscheidet selbst */ }
}
export async function forgetLocation() { await kvDel("location"); kind = null; root = null; }
export const locationInfo = () => ({ kind, name: kind === "folder" ? root?.name ?? "" : "Dieser Browser" });

async function dirOf(rel: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = rel.split("/").filter(Boolean); const name = parts.pop()!;
  let dir = root!;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}
/** Datei aus dem Datenordner lesen (null, wenn es sie nicht gibt) */
export async function readData(rel: string): Promise<Uint8Array | null> {
  if (kind === "browser") { const v = await tx<ArrayBuffer | undefined>(FILES, "readonly", (s) => s.get(rel) as IDBRequest<ArrayBuffer | undefined>); return v ? new Uint8Array(v) : null; }
  if (!root) throw new Error("Kein Datenordner gewählt");
  try { const { dir, name } = await dirOf(rel, false); return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()); }
  catch (e) { if ((e as DOMException)?.name === "NotFoundError") return null; throw e; }
}
/** Datei in den Datenordner schreiben (Unterordner werden angelegt). Ein Ordner-Schreibvorgang ist atomar. */
export async function writeData(rel: string, bytes: Uint8Array): Promise<void> {
  if (kind === "browser") { const copy = bytes.slice().buffer; await tx(FILES, "readwrite", (s) => s.put(copy, rel)); return; }
  if (!root) throw new Error("Kein Datenordner gewählt");
  const { dir, name } = await dirOf(rel, true);
  const w = await (await dir.getFileHandle(name, { create: true }) as any).createWritable();
  await w.write(bytes); await w.close();
}

/* ---------- Sperre: zeigt an, wenn derselbe Ordner gerade auf einem anderen Gerät offen ist ---------- */
const LOCK = "azunavi.lock", FRESH_MS = 150_000;
const myId = (() => { const k = "azunavi-tab"; let v = sessionStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2); sessionStorage.setItem(k, v); } return v; })();
export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Gerät";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}
export async function otherLock(): Promise<{ device: string; ts: number } | null> {
  if (kind !== "folder") return null;
  try {
    const b = await readData(LOCK); if (!b) return null;
    const l = JSON.parse(new TextDecoder().decode(b)) as { id: string; device: string; ts: number };
    return l.id !== myId && Date.now() - l.ts < FRESH_MS ? { device: l.device, ts: l.ts } : null;
  } catch { return null; }
}
let lockTimer: number | undefined;
export function holdLock() {
  if (kind !== "folder") return;
  const beat = () => writeData(LOCK, new TextEncoder().encode(JSON.stringify({ id: myId, device: deviceName(), ts: Date.now() }))).catch(() => {});
  beat(); window.clearInterval(lockTimer); lockTimer = window.setInterval(beat, 60_000);
}
