// Dateien-Seite im Browser: Ordner, die du freigibst (Chrome/Edge am PC), sind über „virtuelle Pfade“ ansprechbar:
//   web:Ordnername/Unterordner/datei.pdf      (die Freigabe merkt sich nur dieser Browser, nie die Datenbank)
//   web-datei:3/name.pdf                       (eine einzelne gewählte oder hineingezogene Datei, nur bis zum Neuladen)
// Der Browser vergisst die Erlaubnis beim Schließen: Dann bietet die Seite „Zugriff erlauben“ an (grant).
import type { DirNode, Entry, FsApi, MoveResult } from "../fsapi";
import { kvRead, kvWrite } from "./dataStore";

const PREFIX = "web:", PICKED = "web-datei:";
export const NEED_PERMISSION = "Der Browser braucht neu deine Erlaubnis für diesen Ordner.";
const NOT_SHARED = "Dieser Ordner ist in diesem Browser nicht freigegeben. Bitte „Ordner neu wählen“.";

type Dir = FileSystemDirectoryHandle;
type FileH = FileSystemFileHandle;
const hidden = (n: string) => { const l = n.toLowerCase(); return n.startsWith(".") || n.startsWith("~$") || l === "desktop.ini" || l === "thumbs.db"; };
const nameOf = (e: unknown) => (e as { name?: string })?.name;
const isNotFound = (e: unknown) => nameOf(e) === "NotFoundError" || nameOf(e) === "TypeMismatchError";
async function* entriesOf(d: Dir): AsyncGenerator<[string, FileSystemHandle]> { for await (const x of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) yield x; }

/* ---------- Freigaben ---------- */
const roots = new Map<string, Dir>();
let loaded = false;
async function load() {
  if (loaded) return; loaded = true;
  for (const r of (await kvRead<{ key: string; handle: Dir }[]>("fsroots").catch(() => undefined)) ?? []) roots.set(r.key, r.handle);
}
const persist = () => kvWrite("fsroots", [...roots].map(([key, handle]) => ({ key, handle })));
/** Ordner merken und einen virtuellen Pfad dafür liefern (derselbe Ordner bekommt immer denselben Pfad) */
export async function registerFolder(h: Dir): Promise<string> {
  await load();
  for (const [k, v] of roots) if (await (v as any).isSameEntry?.(h)) return PREFIX + k;
  let key = h.name || "Ordner"; for (let n = 2; roots.has(key); n++) key = `${h.name} (${n})`;
  roots.set(key, h); await persist(); return PREFIX + key;
}
const picked = new Map<string, File>(); let pn = 0;
export const registerFile = (f: File) => { const p = `${PICKED}${++pn}/${f.name}`; picked.set(p, f); return p; };

/* ---------- Pfade auflösen ---------- */
function parts(path: string) {
  if (!path.startsWith(PREFIX)) throw new Error("Dieser Pfad stammt nicht aus dem Browser: " + path);
  const p = path.slice(PREFIX.length).split("/").filter(Boolean); return { key: p[0], rest: p.slice(1) };
}
const toPath = (key: string, rest: string[]) => PREFIX + [key, ...rest].join("/");
async function rootOf(key: string): Promise<Dir> {
  await load(); const h = roots.get(key); if (!h) throw new Error(NOT_SHARED);
  if ((await (h as any).queryPermission?.({ mode: "readwrite" })) !== "granted") throw new Error(NEED_PERMISSION);
  return h;
}
async function dirAt(path: string, create = false): Promise<Dir> {
  const { key, rest } = parts(path); let d = await rootOf(key);
  for (const r of rest) d = await d.getDirectoryHandle(r, { create });
  return d;
}
async function fileAt(path: string): Promise<FileH> {
  const { key, rest } = parts(path); const name = rest.pop(); if (!name) throw new Error("Das ist ein Ordner: " + path);
  return (await dirAt(toPath(key, rest))).getFileHandle(name);
}
const parentOf = (path: string) => { const { key, rest } = parts(path); rest.pop(); return toPath(key, rest); };
const lastOf = (path: string) => { const { key, rest } = parts(path); return rest[rest.length - 1] ?? key; };

async function fileOf(path: string): Promise<File> {
  if (path.startsWith(PICKED)) { const f = picked.get(path); if (!f) throw new Error("Datei nicht mehr verfügbar, bitte erneut wählen."); return f; }
  return (await fileAt(path)).getFile();
}

/* ---------- Kopieren ---------- */
async function copyFile(f: File | Blob, to: Dir, name: string) {
  const w = await (await to.getFileHandle(name, { create: true }) as any).createWritable();
  await w.write(f); await w.close();
}
async function copyDir(from: Dir, to: Dir) {
  for await (const [n, h] of entriesOf(from)) {
    if (h.kind === "directory") await copyDir(h as Dir, await to.getDirectoryHandle(n, { create: true }));
    else await copyFile(await (h as FileH).getFile(), to, n);
  }
}
async function exists(dir: Dir, name: string) {
  try { await dir.getFileHandle(name); return true; } catch { /* kein Treffer als Datei */ }
  try { await dir.getDirectoryHandle(name); return true; } catch { return false; }
}

/* ---------- Der Browser-Ersatz für die Rust-Datei-Befehle ---------- */
export const webFolderFs: Pick<FsApi, "tree" | "list" | "exists" | "isDir" | "mkdir" | "uniqueName" | "move" | "read" | "open" | "reveal" | "pickFolder" | "grant"> = {
  async tree(root) {
    const build = async (d: Dir, path: string, depth: number): Promise<DirNode> => {
      const children: DirNode[] = [];
      if (depth < 16) for await (const [n, h] of entriesOf(d)) if (h.kind === "directory" && !hidden(n)) children.push(await build(h as Dir, path + "/" + n, depth + 1));
      children.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { name: depth === 0 ? d.name : path.split("/").pop()!, path, children };
    };
    return build(await dirAt(root), root.replace(/\/+$/, ""), 0);
  },
  async list(dir) {
    const d = await dirAt(dir); const out: Entry[] = [];
    for await (const [name, h] of entriesOf(d)) {
      if (hidden(name)) continue;
      const path = dir.replace(/\/+$/, "") + "/" + name;
      if (h.kind === "directory") out.push({ name, path, is_dir: true, size: 0, modified: 0 });
      else { const f = await (h as FileH).getFile(); out.push({ name, path, is_dir: false, size: f.size, modified: Math.floor(f.lastModified / 1000) }); }
    }
    return out.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
  async exists(p) {
    if (p.startsWith(PICKED)) return picked.has(p);
    try { const { rest } = parts(p); if (!rest.length) { await dirAt(p); return true; } return await exists(await dirAt(parentOf(p)), rest[rest.length - 1]); }
    catch (e) { return isNotFound(e) ? false : true; }   // Zugriff fehlt: nicht behaupten, die Datei sei weg
  },
  async isDir(p) {
    if (p.startsWith(PICKED)) return false;
    try { await dirAt(p); return true; } catch (e) { if (isNotFound(e)) return false; throw e; }
  },
  async mkdir(p) { await dirAt(p, true); },
  async uniqueName(dir, name) {
    const d = await dirAt(dir); if (!(await exists(d, name))) return name;
    const i = name.lastIndexOf("."); const stem = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : "";
    for (let n = 2; ; n++) { const c = `${stem} (${n})${ext}`; if (!(await exists(d, c))) return c; }
  },
  async move(src, destDir, newName): Promise<MoveResult> {
    const dest = await dirAt(destDir);
    const base = newName || (src.startsWith(PICKED) ? src.slice(src.indexOf("/") + 1) : lastOf(src));
    if (await exists(dest, base)) throw new Error("ZIEL_EXISTIERT");
    const to = destDir.replace(/\/+$/, "") + "/" + base;
    if (src.startsWith(PICKED)) {   // Datei von außerhalb: wird kopiert, das Original kann der Browser nicht löschen
      const f = picked.get(src); if (!f) throw new Error("QUELLE_FEHLT: " + src);
      await copyFile(f, dest, base); return { to, mode: "copied" };
    }
    const { rest } = parts(src);
    let h: FileSystemHandle;
    try { const pd = rest.length ? await dirAt(parentOf(src)) : null; const nm = rest[rest.length - 1];
      h = pd ? await pd.getFileHandle(nm).catch(() => pd!.getDirectoryHandle(nm)) : await dirAt(src); }
    catch (e) { if (isNotFound(e)) throw new Error("QUELLE_FEHLT: " + src); throw e; }
    if (h.kind === "directory") {
      if ((destDir + "/").startsWith(src.replace(/\/+$/, "") + "/") || await (h as any).isSameEntry?.(dest)) throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden.");
      await copyDir(h as Dir, await dest.getDirectoryHandle(base, { create: true }));
    } else await copyFile(await (h as FileH).getFile(), dest, base);
    if (!rest.length) return { to, mode: "copied" };   // freigegebener Hauptordner selbst: nie löschen
    await (await dirAt(parentOf(src))).removeEntry(rest[rest.length - 1], { recursive: true });
    return { to, mode: "moved" };
  },
  async read(path, max) {
    const f = await fileOf(path); if (f.size > max) throw new Error("Die Datei ist zu groß.");
    return new Uint8Array(await f.arrayBuffer());
  },
  async open(path) {
    if (!path.startsWith(PICKED) && await webFolderFs.isDir(path)) throw new Error("Ordner lassen sich im Browser nicht öffnen. Klick ihn links im Baum an.");
    const url = URL.createObjectURL(await fileOf(path));
    window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 120_000);
  },
  async reveal() { throw new Error("„Im Explorer zeigen“ gibt es im Browser nicht."); },
  async pickFolder() {
    try { return await registerFolder(await (window as any).showDirectoryPicker({ id: "azunavi-dateien", mode: "readwrite" })); }
    catch (e) { if (nameOf(e) === "AbortError") return null; throw e; }
  },
  async grant(path) {
    await load(); const h = roots.get(parts(path).key); if (!h) return false;
    return (await (h as any).requestPermission?.({ mode: "readwrite" })) === "granted";
  },
};

/** Hineingezogene Dateien und Ordner (Ziehen & Ablegen) in virtuelle Pfade umwandeln.
 *  Wichtig: Alle Zugriffe auf das Ereignis müssen sofort passieren, bevor etwas abgewartet wird. */
export async function dropToPaths(dt: DataTransfer): Promise<string[]> {
  const jobs = Array.from(dt.items ?? []).filter((i) => i.kind === "file").map((it) => ({
    handle: ((it as any).getAsFileSystemHandle?.() as Promise<FileSystemHandle | null> | undefined) ?? Promise.resolve(null),
    file: it.getAsFile(),
  }));
  const plain = Array.from(dt.files);
  const out: string[] = [];
  for (const j of jobs) {
    const h = await j.handle.catch(() => null);
    if (h?.kind === "directory") { try { await (h as any).requestPermission?.({ mode: "readwrite" }); } catch { /* nur lesen */ } out.push(await registerFolder(h as Dir)); }
    else if (h?.kind === "file") out.push(registerFile(await (h as FileH).getFile()));
    else if (j.file) out.push(registerFile(j.file));
  }
  if (!out.length) for (const f of plain) out.push(registerFile(f));
  return out;
}
