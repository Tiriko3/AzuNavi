// Test der Dateien-Seite im Browser (Node, mit Ersatz-Ordnern im Speicher). Start: npx tsx tools/webfiles-test.mts (braucht fake-indexeddb)
import "fake-indexeddb/auto";
const st = new Map<string, string>();
(globalThis as any).sessionStorage = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, v: string) => void st.set(k, v), removeItem: (k: string) => void st.delete(k) };
(globalThis as any).window = Object.assign(globalThis, { dispatchEvent: () => true, addEventListener: () => {} });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Test" }, configurable: true });

class Mem { // Ersatz für FileSystemDirectoryHandle / FileSystemFileHandle
  kind: "directory" | "file"; kids = new Map<string, Mem>(); data = new Uint8Array(0); mod = Date.now(); perm = "granted";
  constructor(public name: string, kind: "directory" | "file") { this.kind = kind; }
  async getDirectoryHandle(n: string, o?: { create?: boolean }) { const k = this.kids.get(n); if (k) { if (k.kind !== "directory") throw Object.assign(new Error("tm"), { name: "TypeMismatchError" }); return k; } if (o?.create) { const d = new Mem(n, "directory"); this.kids.set(n, d); return d; } throw Object.assign(new Error("nf"), { name: "NotFoundError" }); }
  async getFileHandle(n: string, o?: { create?: boolean }) { const k = this.kids.get(n); if (k) { if (k.kind !== "file") throw Object.assign(new Error("tm"), { name: "TypeMismatchError" }); return k; } if (o?.create) { const f = new Mem(n, "file"); this.kids.set(n, f); return f; } throw Object.assign(new Error("nf"), { name: "NotFoundError" }); }
  async removeEntry(n: string) { if (!this.kids.delete(n)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); }
  async *entries() { for (const e of this.kids) yield e; }
  async getFile() { return new File([this.data], this.name, { lastModified: this.mod }); }
  async createWritable() { const me = this; let buf: Uint8Array[] = []; return { async write(x: Blob | Uint8Array) { buf.push(x instanceof Uint8Array ? x : new Uint8Array(await x.arrayBuffer())); }, async close() { me.data = Buffer.concat(buf); me.mod = Date.now(); } }; }
  async isSameEntry(o: Mem) { return o === this; }
  async queryPermission() { return this.perm; } async requestPermission() { this.perm = "granted"; return "granted"; }
}
const dir = (n: string) => new Mem(n, "directory");
const put = (d: Mem, path: string, text = "x") => { const p = path.split("/"); const f = p.pop()!; let c = d; for (const s of p) { if (!c.kids.has(s)) c.kids.set(s, dir(s)); c = c.kids.get(s)!; } const m = new Mem(f, "file"); m.data = new TextEncoder().encode(text); c.kids.set(f, m); };
const has = (d: Mem, path: string) => { let c: Mem | undefined = d; for (const s of path.split("/")) c = c?.kids.get(s); return !!c; };
const txt = (d: Mem, path: string) => { let c: Mem | undefined = d; for (const s of path.split("/")) c = c?.kids.get(s); return c ? new TextDecoder().decode(c.data) : null; };

let ok = 0, bad = 0;
const t = async (n: string, f: () => Promise<void> | void) => { try { await f(); ok++; console.log("  ✓", n); } catch (e) { bad++; console.log("  ✗", n, "→", (e as Error).message); } };
const must = (c: boolean, m = "falsch") => { if (!c) throw new Error(m); };
const rej = async (p: Promise<unknown>, part: string) => { try { await p; } catch (e) { must(String((e as Error).message).includes(part), "andere Meldung: " + (e as Error).message); return; } throw new Error("hätte fehlschlagen müssen"); };

const { webFolderFs: fs, registerFile } = await import("../src/web/webFiles");
const { baseName, parentDir, join, isInside } = await import("../src/fsapi");

const main = dir("Hauptordner"); put(main, "Arbeit/Server/notizen.txt", "Syslog"); put(main, "Arbeit/Server/plan.pdf", "PDF"); put(main, "Schule/LF4/aufgabe.docx", "DOC"); put(main, "Arbeit/.versteckt/x.txt"); put(main, "Arbeit/desktop.ini");
(globalThis as any).showDirectoryPicker = async () => main;
console.log("webFiles.ts");
let root = ""; await t("Ordner freigeben liefert virtuellen Pfad", async () => { root = (await fs.pickFolder("x"))!; must(root === "web:Hauptordner", root); });
await t("derselbe Ordner bekommt denselben Pfad", async () => must((await fs.pickFolder("x")) === root));
await t("anderer Ordner mit gleichem Namen bekommt eigenen Pfad", async () => { const o = dir("Hauptordner"); (globalThis as any).showDirectoryPicker = async () => o; must((await fs.pickFolder("x")) === "web:Hauptordner (2)"); (globalThis as any).showDirectoryPicker = async () => main; });
const A = join(root, "Arbeit"), S = join(root, "Schule");
await t("Pfad-Helfer der App funktionieren mit web:-Pfaden", () => { must(A === "web:Hauptordner/Arbeit"); must(baseName(A) === "Arbeit"); must(parentDir(A) === root); must(isInside(join(A, "Server"), A)); });
await t("tree: nur Ordner, versteckte fehlen, sortiert", async () => { const tr = await fs.tree(A); must(tr.name === "Arbeit" && tr.path === A); must(tr.children.length === 1 && tr.children[0].name === "Server" && tr.children[0].path === A + "/Server", JSON.stringify(tr)); });
await t("list: Dateien mit Größe, Ordner zuerst, ohne desktop.ini", async () => { const l = await fs.list(A); must(l.length === 1 && l[0].is_dir); const s = await fs.list(A + "/Server"); must(s.map((e) => e.name).join() === "notizen.txt,plan.pdf" && s[0].size === 6 && s[0].modified > 0); });
await t("exists/isDir", async () => { must(await fs.exists(A + "/Server/plan.pdf")); must(!(await fs.exists(A + "/Server/gibts.pdf"))); must(await fs.isDir(A + "/Server")); must(!(await fs.isDir(A + "/Server/plan.pdf"))); must(!(await fs.isDir(A + "/nix"))); });
await t("mkdir legt verschachtelt an", async () => { await fs.mkdir(A + "/Neu/Tief"); must(has(main, "Arbeit/Neu/Tief")); });
await t("uniqueName zählt hoch", async () => { must((await fs.uniqueName(A + "/Server", "plan.pdf")) === "plan (2).pdf"); must((await fs.uniqueName(A + "/Server", "frei.pdf")) === "frei.pdf"); });
await t("read liest Inhalt, Größenlimit greift", async () => { must(new TextDecoder().decode(await fs.read(A + "/Server/notizen.txt", 100)) === "Syslog"); await rej(fs.read(A + "/Server/notizen.txt", 3), "zu groß"); });
await t("move Datei innerhalb: verschoben, Quelle weg, Inhalt gleich", async () => { const r = await fs.move(A + "/Server/plan.pdf", S + "/LF4", null); must(r.mode === "moved" && r.to === S + "/LF4/plan.pdf"); must(!has(main, "Arbeit/Server/plan.pdf") && txt(main, "Schule/LF4/plan.pdf") === "PDF"); });
await t("move mit neuem Namen", async () => { const r = await fs.move(S + "/LF4/plan.pdf", A + "/Server", "plan_neu.pdf"); must(r.to === A + "/Server/plan_neu.pdf" && has(main, "Arbeit/Server/plan_neu.pdf")); });
await t("move auf vorhandene Datei: ZIEL_EXISTIERT, nichts verloren", async () => { put(main, "Schule/LF4/notizen.txt", "ANDERS"); await rej(fs.move(A + "/Server/notizen.txt", S + "/LF4", null), "ZIEL_EXISTIERT"); must(txt(main, "Arbeit/Server/notizen.txt") === "Syslog" && txt(main, "Schule/LF4/notizen.txt") === "ANDERS"); });
await t("move fehlende Quelle: QUELLE_FEHLT", () => rej(fs.move(A + "/Server/weg.txt", S, null), "QUELLE_FEHLT"));
await t("move Ordner mit Inhalt", async () => { put(main, "Arbeit/Server/sub/tief/a.txt", "A"); const r = await fs.move(A + "/Server/sub", S, null); must(r.mode === "moved" && txt(main, "Schule/sub/tief/a.txt") === "A" && !has(main, "Arbeit/Server/sub")); });
await t("Ordner nicht in sich selbst", async () => { await rej(fs.move(S + "/sub", S + "/sub/tief", null), "in sich selbst"); must(has(main, "Schule/sub/tief/a.txt")); });
await t("Rückgängig: zurück an alten Ort", async () => { await fs.move(S + "/sub", A + "/Server", null); must(has(main, "Arbeit/Server/sub/tief/a.txt") && !has(main, "Schule/sub")); });
await t("Datei von außerhalb wird kopiert (mode copied)", async () => { const p = registerFile(new File(["EXTERN"], "bericht.pdf")); must(!(await fs.isDir(p)) && (await fs.exists(p))); const r = await fs.move(p, A + "/Server", null); must(r.mode === "copied" && txt(main, "Arbeit/Server/bericht.pdf") === "EXTERN"); });
await t("freigegebener Ordner von außerhalb: Kopie, Original bleibt", async () => { const ext = dir("Downloads"); put(ext, "a.txt", "1"); put(ext, "u/b.txt", "2"); (globalThis as any).showDirectoryPicker = async () => ext; const p = (await fs.pickFolder("x"))!; const r = await fs.move(p, A, null); must(r.mode === "copied" && txt(main, "Arbeit/Downloads/u/b.txt") === "2" && has(ext, "a.txt")); (globalThis as any).showDirectoryPicker = async () => main; });
await t("Hauptordner in sich selbst: abgelehnt, nichts verändert", async () => { await rej(fs.move(root, S, "Kopie"), "in sich selbst"); must(has(main, "Arbeit") && !has(main, "Schule/Kopie")); });
await t("Abbruch im Ordner-Dialog → null", async () => { (globalThis as any).showDirectoryPicker = async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }; must((await fs.pickFolder("x")) === null); (globalThis as any).showDirectoryPicker = async () => main; });
await t("Erlaubnis fehlt: klare Meldung, exists lügt nicht, grant hilft", async () => {
  main.perm = "prompt";
  await rej(fs.list(A), "Erlaubnis"); await rej(fs.tree(A), "Erlaubnis");
  must(await fs.exists(A + "/Server/notizen.txt") === true, "exists darf bei fehlender Erlaubnis nicht 'weg' melden");
  must(await fs.grant!(A) === true); must((await fs.list(A)).length > 0);
});
await t("nicht freigegebener Ordner: klare Meldung", () => rej(fs.list("web:Unbekannt/x"), "nicht freigegeben"));
await t("Pfad ohne web: wird abgelehnt", () => rej(fs.list("C:\\Users\\x"), "nicht aus dem Browser"));
await t("Freigaben überleben einen Neustart (IndexedDB)", async () => { const { kvRead } = await import("../src/web/dataStore"); const r = await kvRead<{ key: string }[]>("fsroots"); must(!!r && r.some((x) => x.key === "Hauptordner")); });
/* ---- Firefox & Co.: kein showDirectoryPicker → eigener Ordner im Browser (OPFS) ---- */
console.log("Browser-Ordner (ohne Ordner-Zugriff)");
const opfs = dir("opfs-root");
delete (globalThis as any).showDirectoryPicker;
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 Firefox/158", storage: { getDirectory: async () => opfs } }, configurable: true });
let br = "";
await t("ohne Picker: pickFolder liefert den Browser-Ordner", async () => { br = (await fs.pickFolder("Hauptordner wählen"))!; must(br === "web:Browser-Ordner", br); });
await t("Unterordner Arbeit/Schule lassen sich anlegen und listen (ohne Berechtigungsabfrage)", async () => { await fs.mkdir(br + "/Arbeit"); await fs.mkdir(br + "/Schule"); must(has(opfs, "azunavi-dateien/Arbeit")); must((await fs.list(br)).length === 2); must((await fs.tree(br)).children.length === 2); });
await t("Titel „für Arbeit“/„für Schule“ geben getrennte Unterordner", async () => { must((await fs.pickFolder("Ordner für Arbeit wählen")) === br + "/Arbeit"); must((await fs.pickFolder("Ordner für Schule wählen")) === br + "/Schule"); });
await t("Datei von außerhalb wird in den Browser-Ordner kopiert", async () => { const p = registerFile(new File(["BERICHT"], "rechnung.txt")); const r = await fs.move(p, br + "/Arbeit", null); must(r.mode === "copied" && txt(opfs, "azunavi-dateien/Arbeit/rechnung.txt") === "BERICHT"); });
await t("Verschieben innerhalb des Browser-Ordners", async () => { const r = await fs.move(br + "/Arbeit/rechnung.txt", br + "/Schule", null); must(r.mode === "moved" && has(opfs, "azunavi-dateien/Schule/rechnung.txt") && !has(opfs, "azunavi-dateien/Arbeit/rechnung.txt")); });
await t("grant braucht im Browser-Ordner keine Abfrage", async () => must((await fs.grant!(br)) === true));
await t("ZIP-Export des Browser-Ordners enthält die Datei", async () => {
  const urls: Blob[] = []; (globalThis as any).URL.createObjectURL = (b: Blob) => { urls.push(b); return "blob:x"; }; (globalThis as any).URL.revokeObjectURL = () => {};
  (globalThis as any).document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  const { exportBrowserFolderZip } = await import("../src/web/webFiles");
  const name = await exportBrowserFolderZip(); must(/^AzuNavi-Dateien-\d{4}-\d{2}-\d{2}\.zip$/.test(name), name);
  const JSZip = (await import("jszip")).default; const z = await JSZip.loadAsync(await urls[0].arrayBuffer()); must(!!z.file("Schule/rechnung.txt"), Object.keys(z.files).join());
});

console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`); process.exit(bad ? 1 : 0);
