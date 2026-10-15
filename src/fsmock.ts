// NUR für den Browser-Test (npm run dev): ein kleines Dateisystem im Speicher,
// das sich wie die echten Rust-Befehle verhält. Im App-Build nicht enthalten.
import type { DirNode, Entry, FsApi } from "./fsapi";

interface Node { dir: boolean; size: number; modified: number; text?: string; bin?: Uint8Array }
const S = "\\";
const files = new Map<string, Node>();
const now = Math.floor(Date.now() / 1000);
const key = (p: string) => p.replace(/[\\/]+/g, S).replace(/\\$/, "");
const lower = (p: string) => key(p).toLowerCase();
const parent = (p: string) => key(p).slice(0, key(p).lastIndexOf(S));
const base = (p: string) => key(p).split(S).pop()!;

function find(p: string): [string, Node] | undefined {
  const l = lower(p);
  for (const [k, v] of files) if (k.toLowerCase() === l) return [k, v];
  return undefined;
}
function addDir(p: string) {
  const parts = key(p).split(S);
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join(S);
    if (!find(sub)) files.set(sub, { dir: true, size: 0, modified: now });
  }
}
function addFile(p: string, size: number, text?: string) {
  addDir(parent(p));
  files.set(key(p), { dir: false, size, modified: now - Math.floor(Math.random() * 90000), text });
}

// Startinhalt: Downloads (außerhalb) und eine schon vorhandene Struktur zum Testen
addDir("C:\\Users\\Dev\\Downloads");
addFile("C:\\Users\\Dev\\Downloads\\Netzplan_Server_v2.pdf", 482133);
addFile("C:\\Users\\Dev\\Downloads\\syslog-notizen.txt", 912, "Syslog-Server: Port 514 UDP\nRotation täglich, 30 Tage aufbewahren.");
addFile("C:\\Users\\Dev\\Downloads\\Screenshot_Grafana.png", 220551);
addFile("C:\\Users\\Dev\\Downloads\\Lernfeld4_Aufgaben.docx", 33000);
addFile("C:\\Users\\Dev\\Downloads\\Netzplan_Server_v3.pdf", 501000);
addDir("C:\\Users\\Dev\\Alte Struktur\\Projekte\\Monitoring");
addFile("C:\\Users\\Dev\\Alte Struktur\\Projekte\\Monitoring\\sensoren.xlsx", 15000);
addFile("C:\\Users\\Dev\\Alte Struktur\\Projekte\\readme.txt", 120, "Alte Projektablage");

const pickQueue: string[][] = [];
const folderQueue: (string | null)[] = [];
/** Für Tests: nächste Dateiauswahl vorbereiten */
(window as any).__mockPick = (paths: string[]) => pickQueue.push(paths);
(window as any).__mockPickFolder = (p: string | null) => folderQueue.push(p);
(window as any).__mockFs = files;
/** Für Tests: echte Datei (Base64) ins Test-Dateisystem legen */
(window as any).__mockAddBinary = (path: string, b64: string) => {
  const raw = atob(b64); const bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  addFile(path, bin.length); files.get(key(path))!.bin = bin;
};

function tree(p: string): DirNode {
  const k = find(p)![0];
  const kids = [...files.entries()]
    .filter(([c, n]) => n.dir && parent(c).toLowerCase() === k.toLowerCase())
    .map(([c]) => tree(c))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { name: base(k), path: k, children: kids };
}

export const mockFs: FsApi = {
  async tree(root) {
    if (!find(root)?.[1].dir) throw new Error("Ordner nicht gefunden: " + root);
    return tree(root);
  },
  async list(dir) {
    const d = find(dir);
    if (!d) throw new Error("Ordner kann nicht gelesen werden");
    const out: Entry[] = [...files.entries()]
      .filter(([c]) => parent(c).toLowerCase() === d[0].toLowerCase())
      .map(([c, n]) => ({ name: base(c), path: c, is_dir: n.dir, size: n.size, modified: n.modified }));
    return out.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
  async exists(p) { return !!find(p); },
  async isDir(p) { return !!find(p)?.[1].dir; },
  async mkdir(p) { addDir(p); },
  async uniqueName(dir, name) {
    if (!find(dir + S + name)) return name;
    const i = name.lastIndexOf(".");
    const stem = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : "";
    for (let n = 2; ; n++) { const c = `${stem} (${n})${ext}`; if (!find(dir + S + c)) return c; }
  },
  async move(src, destDir, newName) {
    const s = find(src);
    if (!s) throw new Error("QUELLE_FEHLT: " + src);
    const d = find(destDir);
    if (!d || !d[1].dir) throw new Error("Zielordner nicht gefunden: " + destDir);
    const target = d[0] + S + (newName || base(s[0]));
    if (find(target)) throw new Error("ZIEL_EXISTIERT");
    if (s[1].dir && (d[0] + S).toLowerCase().startsWith((s[0] + S).toLowerCase()))
      throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden.");
    const moved = [...files.entries()].filter(([k]) => k.toLowerCase() === s[0].toLowerCase() || k.toLowerCase().startsWith(s[0].toLowerCase() + S));
    for (const [k, n] of moved) { files.delete(k); files.set(target + k.slice(s[0].length), n); }
    return { to: target, mode: "moved" };
  },
  async read(p) {
    const n = find(p)?.[1];
    return n?.bin ?? new TextEncoder().encode(n?.text ?? "");
  },
  async open(p) { console.log("[Test] öffnen:", p); },
  async reveal(p) { console.log("[Test] im Explorer zeigen:", p); },
  async pickFiles() { return pickQueue.shift() ?? []; },
  async pickFolder() { return folderQueue.length ? folderQueue.shift()! : "C:\\Users\\Dev\\Persona"; },
  async pickFile() { return pickQueue.shift()?.[0] ?? null; },
  async saveFile(defaultName, bytes) {
    const path = "C:\\Users\\Dev\\Documents\\" + defaultName;
    (window as any).__saved = (window as any).__saved || {};
    (window as any).__saved[path] = bytes;
    addFile(path, bytes.length);
    files.get(key(path))!.bin = bytes;
    return path;
  },
};
