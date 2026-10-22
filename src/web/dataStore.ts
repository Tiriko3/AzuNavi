// Datenordner der Web-App. Zwei Varianten:
//  - "folder": ein Ordner, den du selbst wählst (z. B. OneDrive\AzuNavi). Geht in Chrome, Edge und Opera am PC.
//  - "browser": der private Speicher dieses Browsers (IndexedDB). Geht überall, auch im Handy-Browser und in Firefox.
// Inhalt des Ordners: azunavi.db (Datenbank), dateien/ (Anhänge, Porträts, Vorlage), azunavi.lock (wer gerade arbeitet),
// profil.json (nur mit Passwortschutz: Profil, Salz, verpackter Datenschlüssel). Mit Passwortschutz sind Datenbank
// und Anhänge verschlüsselt (siehe vault.ts); readData/writeData erledigen das für alle Seiten unsichtbar.
import { PROFILE_FILE, createProfile, decryptFile, encryptFile, isVaultFile, keyMatches, openWithPassword, openWithRecovery, parseProfile, profileBytes, toKey, withNewPassword, type ProfileFile } from "./vault";

type Kind = "folder" | "browser";
const IDB = "azunavi-web", KV = "kv", FILES = "files";
let kind: Kind | null = null;
let root: FileSystemDirectoryHandle | null = null;
let curId: string | null = null;
/** Passwortschutz dieses Ortes: Profil + Schlüssel (null = gesperrt). Ohne Eintrag: Ordner ohne Passwort. */
let secured: { profile: ProfileFile; key: CryptoKey | null } | null = null;

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

/* ---------- Speicherorte (mehrere, für die Profilauswahl an gemeinsam genutzten PCs) ---------- */
interface LocRec { id: string; kind: Kind; name: string; handle?: FileSystemDirectoryHandle; profileName?: string; declined?: boolean }
export interface SavedLocation { id: string; kind: Kind; name: string; profileName?: string; needsPermission: boolean; declined: boolean }

async function recs(): Promise<LocRec[]> {
  const list = await kvGet<LocRec[]>("locations");
  if (list) return list;
  const old = await kvGet<{ kind: Kind; handle?: FileSystemDirectoryHandle }>("location");   // bis Version 0.2: genau ein Ort
  if (!old) return [];
  const rec: LocRec = { id: newId(), kind: old.kind, name: old.kind === "folder" ? old.handle?.name ?? "Ordner" : "Dieser Browser", handle: old.handle };
  await kvSet("locations", [rec]); await kvSet("current", rec.id); await kvDel("location");
  return [rec];
}
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
async function patchRec(id: string, patch: Partial<LocRec>) { const l = await recs(); const r = l.find((x) => x.id === id); if (r) { Object.assign(r, patch); await kvSet("locations", l); } }

/** Alle bekannten Speicherorte (ohne sie schon zu öffnen) */
export async function savedLocations(): Promise<SavedLocation[]> {
  const out: SavedLocation[] = [];
  for (const r of await recs()) {
    let needs = false;
    if (r.kind === "folder") { const perm = await (r.handle as any)?.queryPermission?.({ mode: "readwrite" }); needs = perm !== "granted"; }
    out.push({ id: r.id, kind: r.kind, name: r.kind === "folder" ? r.name : "Dieser Browser", profileName: r.profileName, needsPermission: needs, declined: !!r.declined });
  }
  return out;
}
export const currentLocationId = async () => (await kvGet<string>("current")) ?? null;
/** Einen gespeicherten Ort öffnen. Bei einem Ordner muss das nach einem Klick passieren (Berechtigung). */
export async function resumeLocation(id: string): Promise<boolean> {
  const r = (await recs()).find((x) => x.id === id); if (!r) return false;
  if (r.kind === "folder") {
    const perm = await (r.handle as any)?.requestPermission?.({ mode: "readwrite" });
    if (perm !== "granted") return false;
    root = r.handle!;
  } else root = null;
  kind = r.kind; curId = r.id; secured = null; await kvSet("current", r.id); return true;
}
export async function addFolder(): Promise<string | null> {
  try {
    const h: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: "azunavi-daten", mode: "readwrite" });
    const list = await recs();
    for (const r of list) if (r.handle && await (r.handle as any).isSameEntry?.(h)) return r.id;   // schon bekannt
    const rec: LocRec = { id: newId(), kind: "folder", name: h.name, handle: h };
    await kvSet("locations", [...list, rec]); return rec.id;
  } catch { return null; }   // abgebrochen
}
export async function addBrowser(): Promise<string> {
  const list = await recs(); const have = list.find((r) => r.kind === "browser"); if (have) return have.id;
  const rec: LocRec = { id: newId(), kind: "browser", name: "Dieser Browser" };
  await kvSet("locations", [...list, rec]);
  try { await navigator.storage?.persist?.(); } catch { /* Browser entscheidet selbst */ }
  return rec.id;
}
/** „Wechseln“: Ort schließen, die Liste der Orte kommt wieder (der Ort selbst bleibt gemerkt) */
export async function forgetLocation() { await kvDel("current"); kind = null; root = null; curId = null; secured = null; }
/** Einen Ort aus der Liste nehmen (Ordner und Dateien bleiben unberührt) */
export async function removeLocation(id: string) {
  await kvSet("locations", (await recs()).filter((r) => r.id !== id));
  if ((await kvGet<string>("current")) === id) await kvDel("current");
}
export const locationInfo = () => ({ kind, name: kind === "folder" ? root?.name ?? "" : "Dieser Browser" });
export async function markDeclined() { if (curId) await patchRec(curId, { declined: true }); }

async function dirOf(rel: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = rel.split("/").filter(Boolean); const name = parts.pop()!;
  let dir = root!;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}
/** Datei roh (so wie sie im Ordner liegt) lesen, null, wenn es sie nicht gibt */
export async function readRaw(rel: string): Promise<Uint8Array | null> {
  if (kind === "browser") { const v = await tx<ArrayBuffer | undefined>(FILES, "readonly", (s) => s.get(rel) as IDBRequest<ArrayBuffer | undefined>); return v ? new Uint8Array(v) : null; }
  if (!root) throw new Error("Kein Datenordner gewählt");
  try { const { dir, name } = await dirOf(rel, false); return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()); }
  catch (e) { if ((e as DOMException)?.name === "NotFoundError") return null; throw e; }
}
/** Datei roh in den Datenordner schreiben (Unterordner werden angelegt). Ein Ordner-Schreibvorgang ist atomar. */
export async function writeRaw(rel: string, bytes: Uint8Array): Promise<void> {
  if (kind === "browser") { const copy = bytes.slice().buffer; await tx(FILES, "readwrite", (s) => s.put(copy, rel)); return; }
  if (!root) throw new Error("Kein Datenordner gewählt");
  const { dir, name } = await dirOf(rel, true);
  const w = await (await dir.getFileHandle(name, { create: true }) as any).createWritable();
  await w.write(bytes); await w.close();
}

/* ---------- Mit Passwortschutz: Dateien werden beim Schreiben verschlüsselt und beim Lesen entschlüsselt ---------- */
const plainPath = (rel: string) => rel === LOCK || rel === PROFILE_FILE;
/** Datei aus dem Datenordner lesen (null, wenn es sie nicht gibt). Mit Profil: entschlüsselt. */
export async function readData(rel: string): Promise<Uint8Array | null> {
  const raw = await readRaw(rel);
  if (!secured || plainPath(rel)) return raw;
  if (!secured.key) throw new Error("Das Profil ist gesperrt.");
  if (raw === null) return null;
  if (isVaultFile(raw)) return decryptFile(secured.key, rel, raw);
  if (secured.profile.legacy) return raw;   // Übernahme alter Daten läuft noch
  throw new Error("Eine Datei im Ordner ist nicht verschlüsselt und wird deshalb nicht gelesen: " + rel);
}
/** Datei in den Datenordner schreiben. Mit Profil: verschlüsselt. */
export async function writeData(rel: string, bytes: Uint8Array): Promise<void> {
  if (!secured || plainPath(rel)) return writeRaw(rel, bytes);
  if (!secured.key) throw new Error("Das Profil ist gesperrt.");
  return writeRaw(rel, await encryptFile(secured.key, rel, bytes));
}

/** Alle Dateien im Datenordner (Pfade mit /) */
export async function listFiles(): Promise<string[]> {
  if (kind === "browser") {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction(FILES, "readonly").objectStore(FILES).getAllKeys(); r.onsuccess = () => res(r.result as string[]); r.onerror = () => rej(r.error); });
  }
  if (!root) throw new Error("Kein Datenordner gewählt");
  const out: string[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, prefix + name + "/"); else out.push(prefix + name);
    }
  };
  await walk(root, ""); return out;
}

export async function readProfile(): Promise<ProfileFile | null> {
  const b = await readRaw(PROFILE_FILE); return b ? parseProfile(b) : null;
}
/** Profil dieses Ortes setzen (gesperrt, solange key null ist). Ohne Profil: null. */
export function setSecure(profile: ProfileFile | null, key: CryptoKey | null) { secured = profile ? { profile, key } : null; }
export const profileInfo = () => secured ? { name: secured.profile.name, id: secured.profile.id, unlocked: !!secured.key } : null;
export const isSecured = () => !!secured?.key;

async function writeProfile(p: ProfileFile) {
  await writeRaw(PROFILE_FILE, profileBytes(p));
  if (secured) secured.profile = p;
  if (curId) await patchRec(curId, { profileName: p.name });
}

/** Alle noch unverschlüsselten Dateien verschlüsseln. Jede wird danach zur Probe entschlüsselt und verglichen. */
async function migrateToVault(): Promise<number> {
  if (!secured?.key) throw new Error("Das Profil ist gesperrt.");
  const key = secured.key; let n = 0;
  for (const f of (await listFiles()).filter((f) => !plainPath(f))) {
    const raw = await readRaw(f); if (!raw || isVaultFile(raw)) continue;
    await writeRaw(f, await encryptFile(key, f, raw));
    const back = await decryptFile(key, f, (await readRaw(f))!);
    if (back.length !== raw.length || back.some((v, i) => v !== raw[i])) throw new Error("Die Verschlüsselung von „" + f + "“ ließ sich nicht bestätigen. Die Daten wurden nicht verändert, soweit sie noch lesbar sind.");
    n++;
  }
  return n;
}
/** Nach dem Entsperren: angefangene Übernahme alter Daten zu Ende bringen */
export async function finishMigration(): Promise<void> {
  if (!secured?.key || !secured.profile.legacy) return;
  await migrateToVault();
  const { legacy: _l, ...done } = secured.profile; await writeProfile(done as ProfileFile);
}

/** Neues Profil festschreiben (erst nachdem der Wiederherstellungsschlüssel bestätigt wurde). Alte Daten werden übernommen. */
export async function activateNewProfile(profile: ProfileFile, raw: Uint8Array): Promise<void> {
  const key = await toKey(raw);
  const hasData = (await listFiles()).some((f) => !plainPath(f));
  const p: ProfileFile = hasData ? { ...profile, legacy: true } : profile;
  await writeProfile(p);            // zuerst das Profil (mit Hinweis „Übernahme läuft“) …
  secured = { profile: p, key };
  await finishMigration();           // … dann die Dateien. Bei Abbruch macht der nächste Start weiter.
}

export async function unlockWithPassword(p: ProfileFile, password: string): Promise<CryptoKey> {
  const key = await toKey(await openWithPassword(p, password)); secured = { profile: p, key }; return key;
}
/** Passwort vergessen: mit dem Wiederherstellungsschlüssel öffnen und gleich ein neues Passwort setzen */
export async function recoverWithKey(p: ProfileFile, recoveryKey: string, newPassword: string): Promise<CryptoKey> {
  const raw = await openWithRecovery(p, recoveryKey);
  const np = await withNewPassword(p, raw, newPassword);
  const key = await toKey(raw); secured = { profile: np, key }; await writeProfile(np); return key;
}
export async function changePassword(current: string, next: string): Promise<void> {
  if (!secured?.key) throw new Error("Das Profil ist gesperrt.");
  const raw = await openWithPassword(secured.profile, current);
  await writeProfile(await withNewPassword(secured.profile, raw, next));
}

/* ---------- „Angemeldet bleiben“ pro Gerät: nicht exportierbarer Schlüssel in IndexedDB (nie das Passwort) ---------- */
const remKey = (id: string) => "remember:" + id;
export async function rememberDevice(on: boolean): Promise<void> {
  if (!secured) return;
  if (on && secured.key) await kvSet(remKey(secured.profile.id), secured.key); else await kvDel(remKey(secured.profile.id));
}
export async function isRemembered(): Promise<boolean> { return !!secured && !!(await kvGet(remKey(secured.profile.id))); }
/** Gemerkten Schlüssel nehmen, wenn er zu diesem Profil passt */
export async function unlockRemembered(p: ProfileFile): Promise<boolean> {
  const k = await kvGet<CryptoKey>(remKey(p.id));
  if (!k || !(await keyMatches(p, k))) return false;
  secured = { profile: p, key: k }; return true;
}

/* ---------- Sperren ---------- */
const LOCKED_FLAG = "azunavi-gesperrt";
export const sessionLocked = () => { try { return sessionStorage.getItem(LOCKED_FLAG) === "1"; } catch { return false; } };
export const clearSessionLocked = () => { try { sessionStorage.removeItem(LOCKED_FLAG); } catch { /* egal */ } };
/** Alle offenen Änderungen speichern (die Datenbank hört auf dieses Ereignis) */
export async function flushAll(): Promise<void> {
  const jobs: Promise<unknown>[] = []; window.dispatchEvent(new CustomEvent("azunavi-flush", { detail: jobs })); await Promise.all(jobs);
}
/** Jetzt sperren: speichern, Schlüssel aus dem Speicher werfen, Seite neu laden (dann fragt AzuNavi wieder nach dem Passwort) */
export async function lockNow(): Promise<void> {
  await flushAll();
  try { sessionStorage.setItem(LOCKED_FLAG, "1"); } catch { /* egal */ }
  if (secured) secured.key = null;
  location.reload();
}
export async function getAutoLock(): Promise<number> { return (await kvGet<number>("autolock")) ?? 0; }
export async function setAutoLock(min: number): Promise<void> { await kvSet("autolock", min); window.dispatchEvent(new Event("azunavi-autolock")); }
export const setupRequested = () => { try { return sessionStorage.getItem("azunavi-setup") === "1"; } catch { return false; } };
export const requestSetup = (on: boolean) => { try { on ? sessionStorage.setItem("azunavi-setup", "1") : sessionStorage.removeItem("azunavi-setup"); } catch { /* egal */ } };

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
    const b = await readRaw(LOCK); if (!b) return null;
    const l = JSON.parse(new TextDecoder().decode(b)) as { id: string; device: string; ts: number };
    return l.id !== myId && Date.now() - l.ts < FRESH_MS ? { device: l.device, ts: l.ts } : null;
  } catch { return null; }
}
let lockTimer: number | undefined;
export function holdLock() {
  if (kind !== "folder") return;
  const beat = () => writeRaw(LOCK, new TextEncoder().encode(JSON.stringify({ id: myId, device: deviceName(), ts: Date.now() }))).catch(() => {});
  beat(); window.clearInterval(lockTimer); lockTimer = window.setInterval(beat, 60_000);
}

/** Alles, was AzuNavi in diesem Browser gespeichert hat, entfernen: Datenbank und Anhänge (Modus „Browser“),
 *  gemerkter Ordner und Sperre. Dateien in einem gewählten Datenordner bleiben dort (das ist dein Ordner). */
export async function wipeBrowser(): Promise<void> {
  window.clearInterval(lockTimer);
  if (kind === "folder" && root) { try { await root.removeEntry(LOCK); } catch { /* schon weg */ } }
  kind = null; root = null; secured = null; curId = null;
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(IDB); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ }
}
