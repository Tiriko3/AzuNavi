// Brücke zu den Rust-Datei-Befehlen (src-tauri/src/files.rs).
// Im normalen Browser (npm run dev) läuft stattdessen ein Test-Dateisystem im Speicher.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { inTauri } from "./db/db";
import { isMobile, isWebApp } from "./platform";

export interface DirNode { name: string; path: string; children: DirNode[] }
export interface Entry { name: string; path: string; is_dir: boolean; size: number; modified: number }
export interface MoveResult { to: string; mode: "moved" | "copied" }

export interface FsApi {
  tree(root: string): Promise<DirNode>;
  list(dir: string): Promise<Entry[]>;
  exists(path: string): Promise<boolean>;
  isDir(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  uniqueName(dir: string, name: string): Promise<string>;
  move(src: string, destDir: string, newName?: string | null): Promise<MoveResult>;
  read(path: string, max: number): Promise<Uint8Array>;
  open(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  /** PC (ab 0.4.1): Rust öffnet den Dialog. Gewählte Dateien sind für diese Sitzung freigegeben. */
  pickFiles(): Promise<string[]>;
  /** `keep` (Standard): Ordner dauerhaft freigeben (Arbeit, Schule, Cloud). false: nur für diese Sitzung. */
  pickFolder(title: string, keep?: boolean): Promise<string | null>;
  /** `keep`: Datei dauerhaft merken, weil sie mit einem Projekt verknüpft und später wieder geöffnet wird. */
  pickFile(keep?: boolean): Promise<string | null>;
  /** Speichern-unter-Fenster, gibt den gewählten Pfad zurück (oder null bei Abbruch) */
  saveFile(defaultName: string, bytes: Uint8Array, filterName: string, ext: string): Promise<string | null>;
  /** Datei ohne Dialog an einen bekannten Pfad schreiben (z. B. in den gewählten Cloud-Ordner am PC) */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Nur Web-App: Zugriff auf einen freigegebenen Ordner nach einem Klick neu erlauben (der Browser vergisst das beim Schließen) */
  grant?(path: string): Promise<boolean>;
}

const real: FsApi = {
  tree: (root) => invoke<DirNode>("fs_tree", { root }),
  list: (dir) => invoke<Entry[]>("fs_list", { dir }),
  exists: (path) => invoke<boolean>("fs_exists", { path }),
  isDir: (path) => invoke<boolean>("fs_is_dir", { path }),
  mkdir: (path) => invoke<void>("fs_mkdir", { path }),
  uniqueName: (dir, name) => invoke<string>("fs_unique_name", { dir, name }),
  move: (src, destDir, newName) => invoke<MoveResult>("fs_move", { src, destDir, newName: newName ?? null }),
  read: async (path, max) => {
    // Handy: Android liefert aus dem Dialog content://-Adressen, die nur das Fs-Plugin lesen kann
    if (isMobile) {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const u = await readFile(path);
      if (u.byteLength > max) throw new Error("Die Datei ist zu groß.");
      return u;
    }
    return new Uint8Array(await invoke<ArrayBuffer>("fs_read", { path, max }));
  },
  open: (path) => invoke<void>("fs_open", { path }),
  reveal: (path) => invoke<void>("fs_reveal", { path }),
  pickFiles: async () => {
    if (!isMobile) return invoke<string[]>("fs_pick_files", { multiple: true, title: "Dateien auswählen", keep: false });
    const r = await open({ multiple: true, directory: false, title: "Dateien auswählen" });
    return !r ? [] : Array.isArray(r) ? r : [r];
  },
  pickFolder: async (title, keep = true) => {
    if (!isMobile) return invoke<string | null>("fs_pick_folder", { title, keep });
    const r = await open({ multiple: false, directory: true, title });
    return typeof r === "string" ? r : null;
  },
  pickFile: async (keep = false) => {
    if (!isMobile) return (await invoke<string[]>("fs_pick_files", { multiple: false, title: "Datei suchen", keep }))[0] ?? null;
    const r = await open({ multiple: false, directory: false, title: "Datei suchen" });
    return typeof r === "string" ? r : null;
  },
  saveFile: async (defaultName, bytes, filterName, ext) => {
    // PC: Rust öffnet das Speichern-Fenster und schreibt selbst
    if (!isMobile) return invoke<string | null>("fs_save_file", { defaultName, filterName, ext, bytes: Array.from(bytes) });
    const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }], title: "Speichern unter" });
    if (!path) return null;
    if (isMobile) { const { writeFile } = await import("@tauri-apps/plugin-fs"); await writeFile(path, bytes); }   // content://-Adresse vom Android-Speicherdialog
    else await invoke("fs_write_file", { path, bytes: Array.from(bytes) });
    return path;
  },
  writeFile: async (path, bytes) => {
    if (isMobile) { const { writeFile } = await import("@tauri-apps/plugin-fs"); await writeFile(path, bytes); }
    else await invoke("fs_write_file", { path, bytes: Array.from(bytes) });
  },
};

let api: FsApi | null = inTauri ? real : null;
// Browser-Test: Test-Dateisystem gleich bereitstellen (nur im Entwicklungsmodus, nicht in der App)
if (import.meta.env.DEV && !inTauri) import("./fsmock").then((m) => { api = api ?? m.mockFs; });

export async function fsapi(): Promise<FsApi> {
  if (api) return api;
  if (isWebApp) { const m = await import("./web/webFs"); api = m.webFs; return api; }
  if (import.meta.env.DEV) {
    const m = await import("./fsmock");
    api = m.mockFs;
    return api;
  }
  throw new Error("Datei-Funktionen gibt es nur in der App");
}

/* ---------- Pfad-Helfer (Windows und Linux) ---------- */
export const sep = (p: string) => (p.includes("\\") ? "\\" : "/");
export const join = (dir: string, name: string) => dir.replace(/[\\/]+$/, "") + sep(dir) + name;
export const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
export const parentDir = (p: string) => {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  return i > 0 ? t.slice(0, i) : t;
};
export const extOf = (name: string) => {
  const b = baseName(name);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
};
/** Vergleichsschlüssel für Pfade: Windows unterscheidet keine Groß-/Kleinschreibung, Linux schon */
export const pathKey = (p: string) => (/^[a-zA-Z]:|\\/.test(p) ? p.toLowerCase() : p);
const norm = (p: string) => pathKey(p.replace(/[\\/]+/g, "/").replace(/\/$/, ""));
export const samePath = (a: string, b: string) => norm(a) === norm(b);
/** Liegt `p` in (oder ist) `dir`? */
export const isInside = (p: string, dir: string) => {
  const a = norm(p), d = norm(dir);
  return a === d || a.startsWith(d + "/");
};
/** Pfad relativ zu `root` als Teile, z. B. ["Server", "Logs"] */
export const relParts = (p: string, root: string): string[] => {
  if (!isInside(p, root)) return [];
  const a = p.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  const r = root.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  return a.slice(r.length).split("/").filter(Boolean);
};
