// Durchlauf des PC-Startbildschirms (0.4.0) im echten Programm-Code, im Chromium-Browser mit nachgebauter Tauri-Schnittstelle.
// Die „Rust-Seite“ (Datenordner, alte persona.db, Sicherung) liegt hier in Node und überlebt damit ein Neuladen der Seite.
// Vorher bauen: npm run build.  Start: npx tsx tools/desktop-e2e.mts  (braucht tsx, playwright-core, sql.js; Chromium unter /opt/pw-browsers)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import initSqlJs from "sql.js";
import { legacyDb, FILES } from "./legacy-fixture.mts";

const DIST = path.resolve("dist"), PORT = 4179, SHOTS = process.env.SHOTS ?? "";
const SQL = await initSqlJs();
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".docx": "application/octet-stream" };
const server = http.createServer(async (req, res) => {
  let f = path.join(DIST, decodeURIComponent((req.url ?? "/").split("?")[0])); if (f.endsWith(path.sep) || f === DIST) f = path.join(DIST, "index.html");
  try { if (!(await stat(f)).isFile()) throw 0; res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" }); res.end(await readFile(f)); } catch { res.writeHead(404); res.end(); }
}).listen(PORT);

/* ---------- „Rust-Seite“ ---------- */
function makeBackend() {
  const disk = new Map<string, Uint8Array>();
  const locs: { id: string; path: string }[] = [];
  const st = { roots: ["C:\\Users\\Test\\Arbeit", "C:\\Users\\Test\\Schule"], gfiles: ["C:\\Downloads\\a.pdf"], undo: 2, current: null as string | null, missing: false, destroyed: 0, backups: 0, legacy: true, picks: 0, calls: [] as string[] };
  const legacy = legacyDb(SQL); const lfiles = FILES();
  const appdata = new Map<string, Uint8Array>(Object.entries(lfiles));   // „AppData“ des Handys: alte Dateien liegen direkt darin, neue Daten unter azunavi/
  const OK_TOP = new Set(["azunavi.db", "profil.json", "azunavi.lock"]);
  const checkRel = (rel: string) => { const ok = (OK_TOP.has(rel) || (rel.startsWith("dateien/") && rel.length > 8)) && rel.split("/").every((p) => p && p !== ".." && !/[<>:"|?*\\\x00-\x1f]/.test(p) && !/[. ]$/.test(p)); if (!ok) throw "Dieser Pfad gehört nicht zu AzuNavi."; };
  const info = (l: { id: string; path: string }) => ({ id: l.id, name: l.path.split("\\").pop(), path: l.path, exists: !st.missing });
  async function handle(cmd: string, args: any, b64: string | null, headers: any): Promise<any> {
    st.calls.push(cmd);
    switch (cmd) {
      case "data_locations": return locs.map(info);
      case "data_pick_folder": { st.picks++; const l = { id: "o" + locs.length, path: `C:\\Users\\Test\\OneDrive\\AzuNavi${locs.length || ""}` }; locs.push(l); return info(l); }
      case "data_open": { const l = locs.find((x) => x.id === args.id); if (!l) throw "Diesen Datenordner kenne ich nicht."; if (st.missing) throw "ORDNER_FEHLT"; st.current = l.id; return info(l); }
      case "data_close": st.current = null; return null;
      case "data_forget": { const i = locs.findIndex((x) => x.id === args.id); if (i >= 0) locs.splice(i, 1); return null; }
      case "data_read": { if (!st.current) throw "Kein Datenordner gewählt."; checkRel(args.rel); const b = disk.get(args.rel); if (!b) throw "NICHT_GEFUNDEN"; return { __bin: Buffer.from(b).toString("base64") }; }
      case "data_write": { if (!st.current) throw "Kein Datenordner gewählt."; if (!b64) throw "Falscher Aufruf: es fehlen die Daten."; const rel = decodeURIComponent(headers?.["x-rel"] ?? ""); checkRel(rel); disk.set(rel, new Uint8Array(Buffer.from(b64, "base64"))); return null; }
      case "data_list": return [...disk.keys()].sort();
      case "data_remove_lock": disk.delete("azunavi.lock"); return null;
      case "fs_grants_state": return { asked: true };
      case "fs_grants_list": return { roots: st.roots.map((p) => ({ path: p, name: p.split("\\").pop(), exists: true })), files: st.gfiles.map((p) => ({ path: p, name: p.split("\\").pop(), exists: true })), undo_dirs: st.undo };
      case "fs_grants_revoke": {
        if (args.kind === "root") { if (!st.roots.includes(args.path)) throw "Diese Freigabe gibt es nicht (mehr)."; st.roots = st.roots.filter((p) => p !== args.path); }
        else if (args.kind === "file") st.gfiles = st.gfiles.filter((p) => p !== args.path);
        else if (args.kind === "all-files") { st.gfiles = []; st.undo = 0; } else throw "Unbekannte Art.";
        return null;
      }
      case "legacy_info": return { exists: st.legacy, size: 4_200_000, modified: 1_790_000_000, dir: "C:\\Users\\Test\\AppData\\Roaming\\com.local.personaapp", backup_dir: null };
      case "legacy_backup": st.backups++; return { dir: "C:\\Users\\Test\\AppData\\Roaming\\com.local.personaapp\\Sicherung-vor-0.4.0", files: ["persona-x.db"], bytes: 4_200_000, created: st.backups === 1 };
      case "plugin:sql|load": return args.db;
      case "plugin:sql|close": return true;
      case "plugin:sql|select": { const r = legacy.exec(args.query)[0]; return r ? r.values.map((v: unknown[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, v[i]]))) : []; }
      case "plugin:fs|read_file": { const b = appdata.get(args.path); if (!b) throw "No such file"; return { __bin: Buffer.from(b).toString("base64") }; }
      case "plugin:fs|exists": return appdata.has(args.path) || [...appdata.keys()].some((k) => k.startsWith(args.path + "/"));
      case "plugin:fs|mkdir": return null;
      case "plugin:fs|write_file": { if (!b64) throw "keine Daten"; appdata.set(decodeURIComponent(headers.path), new Uint8Array(Buffer.from(b64, "base64"))); return null; }
      case "plugin:fs|rename": { const b = appdata.get(args.oldPath); if (!b) throw "No such file"; appdata.set(args.newPath, b); appdata.delete(args.oldPath); return null; }
      case "plugin:fs|remove": appdata.delete(args.path); return null;
      case "plugin:fs|read_dir": {
        const pre = args.path + "/"; const seen = new Map<string, boolean>();
        for (const k of appdata.keys()) if (k.startsWith(pre)) { const rest = k.slice(pre.length); const first = rest.split("/")[0]; seen.set(first, rest.includes("/")); }
        return [...seen].map(([name, dir]) => ({ name, isDirectory: dir, isFile: !dir, isSymlink: false }));
      }
      case "plugin:dialog|save": return "content://fake/Sicherung.zip";
      case "plugin:window|destroy": st.destroyed++; return null;
      default: return null;
    }
  }
  return { disk, locs, st, handle, appdata, legacy };
}

const INIT = `(() => {
  let n = 0; const cbs = {}; window.__listeners = {};
  const b64 = (u) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback(f) { const id = ++n; cbs[id] = f; return id; }, unregisterCallback(id) { delete cbs[id]; }, convertFileSrc: (x) => x,
    async invoke(cmd, args, options) {
      if (cmd === 'plugin:event|listen') { window.__listeners[args.event] = args.handler; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      const bin = args instanceof Uint8Array;
      const r = await window.__node(cmd, bin ? null : args, bin ? b64(args) : null, options && options.headers ? options.headers : null);
      if (r && r.__err !== undefined) throw r.__err;
      if (r && r.__bin) { const s = atob(r.__bin); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
      return r === undefined ? null : r;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__fire = (ev) => cbs[window.__listeners[ev]] && cbs[window.__listeners[ev]]({ event: ev, id: 1, payload: null });
})();`;

let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) ok++; else { bad++; console.log("  ✗ " + m); } };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

async function session(be: ReturnType<typeof makeBackend>, opts: { reducedMotion?: "reduce"; animOff?: boolean; phone?: boolean; hour?: number } = {}) {
  const ctx: BrowserContext = await browser.newContext(opts.phone ? { viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", reducedMotion: opts.reducedMotion } : { viewport: { width: 1280, height: 720 }, reducedMotion: opts.reducedMotion });
  if (opts.animOff) await ctx.addInitScript(() => localStorage.setItem("azunavi.anim", "0"));
  if (opts.hour !== undefined) await ctx.addInitScript((h) => { Date.prototype.getHours = function () { return h; }; }, opts.hour);
  await ctx.exposeFunction("__node", async (cmd: string, args: any, b64: string | null, headers: any) => { try { return (await be.handle(cmd, args, b64, headers)) ?? null; } catch (e) { return { __err: typeof e === "string" ? e : String((e as Error)?.message ?? e) }; } });
  await ctx.addInitScript(INIT);
  const errors: string[] = [];
  const open = async (): Promise<Page> => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(`http://localhost:${PORT}/`); return p; };
  return { ctx, open, errors };
}
const text = (p: Page) => p.evaluate(() => document.body.innerText);
const shot = async (p: Page, n: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const closeWin = async (p: Page) => { await p.evaluate(() => (window as any).__fire("tauri://close-requested")); await p.waitForTimeout(700); await p.close(); };
const gone = async (p: Page) => { try { await p.waitForSelector(".webgate", { state: "detached", timeout: 20000 }); } catch (e) { console.log("  … Startbildschirm hängt bei: " + (await p.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 400)); throw e; } };

console.log("A: erster Start, ohne Passwort, alte Daten übernehmen");
{
  const be = makeBackend(); const s = await session(be); let p = await s.open();
  await p.waitForSelector("button:has-text('Datenordner wählen')");
  let t = await text(p);
  check(t.includes("PC-Programm"), "Titel „PC-Programm“");
  check(t.toLowerCase().includes("datenordner wählen"), "Ordner wählen wird angeboten");
  check(!t.includes("Nur in diesem Browser"), "kein „nur im Browser“ am PC");
  check(!t.includes("Handy-App (Android) herunterladen"), "kein Web-Download-Link");
  await shot(p, "1-wahl");
  await p.click("text=Datenordner wählen");
  await p.waitForSelector("text=Möchtest du deine Daten mit einem Passwort schützen?");
  await shot(p, "2-angebot");
  await p.click("text=Ohne Passwort weiterarbeiten");
  await p.waitForSelector("text=Deine bisherigen Daten übernehmen?");
  await p.waitForSelector("text=Sicherung angelegt");
  t = await text(p);
  check(t.includes("4.0 MB") || t.includes("4,0 MB") || /4[.,]\d MB/.test(t), "Größe der alten Datenbank angezeigt");
  check(be.st.backups === 1, "Sicherung wurde angelegt, bevor irgendetwas übernommen wurde");
  check(!be.disk.has("azunavi.db"), "bis hierher noch nichts im Datenordner");
  await shot(p, "3-alt");
  await p.click("button:has-text('Daten übernehmen')");
  await p.waitForSelector("text=✓ Übernommen", { timeout: 30000 });
  t = await text(p);
  check(/\d+ Tabellen, \d+ Einträge und 5 Dateien/.test(t), "Bericht: " + (t.match(/\d+ Tabellen[^.]*\./)?.[0] ?? "?"));
  check(t.includes("1 Datei(en) waren schon im alten Ordner nicht mehr vorhanden"), "fehlende Datei wird gemeldet");
  check(be.disk.has("azunavi.db") && be.disk.has("dateien/attachments/170001_0_bild1.png") && be.disk.has("dateien/templates/vorlage.docx"), "Datenbank und Dateien liegen im Datenordner");
  await shot(p, "4-uebernommen");
  await p.click("button:has-text('Weiter')");
  await gone(p);
  await p.waitForTimeout(1500);
  check(be.disk.has("azunavi.lock"), "Sperrdatei wird gehalten");
  check((await p.locator(".websave").innerText()).includes("Gespeichert"), "Speicher-Anzeige: gespeichert");
  await shot(p, "5-app");

  // Schließen: speichert, gibt die Sperre frei und beendet erst dann
  await p.evaluate(() => (window as any).__fire("tauri://close-requested"));
  await p.waitForTimeout(800);
  check(be.st.destroyed === 1, "Fenster wird nach dem Speichern beendet");
  check(!be.disk.has("azunavi.lock"), "Sperre beim Beenden freigegeben");

  // Neustart: Ordner wird erkannt, keine neue Frage nach den alten Daten, Daten sind da
  const before = be.st.backups;
  p = await s.open(); await gone(p); await p.waitForTimeout(800);
  check(be.st.backups === before, "kein zweites Mal Sicherung/Übernahme-Frage");
  const dbBytes = be.disk.get("azunavi.db")!; const nd = new SQL.Database(dbBytes);
  check((nd.exec("SELECT COUNT(*) FROM notes")[0].values[0][0] as number) === 3, "Notizen aus der alten Datenbank sind da");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}

console.log("B: ohne alte Daten starten, danach keine Frage mehr");
{
  const be = makeBackend(); const s = await session(be); let p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten");
  await p.waitForSelector("text=Deine bisherigen Daten übernehmen?");
  await p.click("button:has-text('Ohne alte Daten starten')");
  await gone(p); await p.waitForTimeout(1800);
  check(be.disk.has("azunavi.db"), "leere Datenbank wurde angelegt");
  const nd = new SQL.Database(be.disk.get("azunavi.db")!);
  check((nd.exec("SELECT COUNT(*) FROM notes")[0].values[0][0] as number) === 0, "keine alten Notizen");
  await closeWin(p); p = await s.open(); await gone(p);
  check(!(await text(p)).includes("bisherigen Daten übernehmen"), "beim nächsten Start keine Frage");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}

console.log("C: mit Passwort: alte Daten landen verschlüsselt im Ordner, Neustart verlangt das Passwort");
{
  const be = makeBackend(); const s = await session(be); let p = await s.open();
  await p.click("text=Datenordner wählen");
  await p.click("button:has-text('Mit Passwort schützen')");
  await p.fill("label:has-text('Name des Profils') input", "Test");
  const pws = p.locator("input[type=password]"); await pws.nth(0).fill("ein sehr langes passwort 123"); await pws.nth(1).fill("ein sehr langes passwort 123");
  await p.click("button:has-text('Weiter')");
  await p.waitForSelector("text=Dein Wiederherstellungsschlüssel");
  await p.check("text=Ich habe den Schlüssel sicher aufbewahrt.");
  await p.click("button:has-text('Profil anlegen und Daten verschlüsseln')");
  await p.waitForSelector("text=Deine bisherigen Daten übernehmen?");
  await p.waitForSelector("text=Sicherung angelegt");
  await p.click("button:has-text('Daten übernehmen')");
  await p.waitForSelector("text=✓ Übernommen", { timeout: 40000 });
  const magic = (rel: string) => Buffer.from(be.disk.get(rel)!.slice(0, 4)).toString();
  check(magic("azunavi.db") === "AZV1", "Datenbank liegt verschlüsselt im Ordner");
  check(magic("dateien/attachments/170002_0_bild2.png") === "AZV1", "Anhang liegt verschlüsselt im Ordner");
  check(be.disk.has("profil.json"), "profil.json vorhanden");
  await p.click("button:has-text('Weiter')"); await gone(p); await p.waitForTimeout(1200);
  await closeWin(p);
  p = await s.open();
  await p.waitForSelector("text=ist durch ein Passwort geschützt");
  await p.fill("input[type=password]", "falsches passwort 12345"); await p.click("button:has-text('Entsperren')");
  await p.waitForSelector("text=Falsches Passwort");
  await p.fill("input[type=password]", "ein sehr langes passwort 123"); await p.click("button:has-text('Entsperren')");
  await gone(p); await p.waitForTimeout(800);
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}

console.log("D: Datenordner nicht auffindbar");
{
  const be = makeBackend(); const s = await session(be); let p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten");
  await p.click("button:has-text('Ohne alte Daten starten')"); await gone(p); await p.waitForTimeout(1500);
  be.st.missing = true;
  await closeWin(p); p = await s.open(); await p.waitForSelector(".wg-loc");
  const t = await text(p);
  check(t.toLowerCase().includes("nicht gefunden"), "Hinweis „nicht gefunden“ in der Liste");
  check(await p.locator(".wg-loc").first().isDisabled(), "Eintrag ist gesperrt");
  await shot(p, "6-fehlt");
  be.st.missing = false;
  await p.close(); p = await s.open(); await gone(p);
  check(true, "nach Rückkehr des Ordners geht es wieder");
  await s.ctx.close();
}

console.log("E: eine alte Datei ist nicht lesbar: der Rest wird trotzdem übernommen, die Datei wird gemeldet");
{
  const be = makeBackend(); be.st.legacy = true;
  const real = be.handle; let failOnce = true;
  be.handle = async (cmd, args, b64, h) => { if (cmd === "plugin:fs|read_file" && failOnce && args.path.includes("bild2")) { failOnce = false; throw "No such file"; } return real(cmd, args, b64, h); };
  const s = await session(be); let p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten");
  await p.waitForSelector("text=Sicherung angelegt");
  await p.click("button:has-text('Daten übernehmen')");
  await p.waitForSelector("text=✓ Übernommen", { timeout: 30000 });
  check((await text(p)).includes("2 Datei(en) waren schon im alten Ordner nicht mehr vorhanden"), "nicht lesbare Datei wird gemeldet, Rest übernommen");
  await s.ctx.close();
}


console.log("G: Hintergrund und Intro");
{
  const be = makeBackend(); const s = await session(be); let p = await s.open();
  await p.waitForSelector("button:has-text('Datenordner wählen')");
  await p.waitForTimeout(900);
  check((await p.locator(".wg-bg video").count()) === 1, "Startbildschirm hat den Wasser-Hintergrund als Video");
  check(await p.evaluate(() => { const v = document.querySelector(".wg-bg video") as HTMLVideoElement; return !!v && !v.paused && v.currentTime > 0 && v.videoWidth === 1280; }), "Video läuft wirklich (Chromium kann die WebM-Datei abspielen)");
  await shot(p, "7-gate-video");
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten");
  await p.click("button:has-text('Ohne alte Daten starten')");
  await p.waitForSelector(".intro video", { timeout: 20000 });
  await p.waitForTimeout(1300); await shot(p, "8-intro");
  check(await p.evaluate(() => { const v = document.querySelector(".intro video") as HTMLVideoElement; return !v.paused && v.currentTime > 0.5; }), "Intro läuft");
  await p.click(".intro");
  await p.waitForSelector(".intro", { state: "detached", timeout: 3000 });
  check(true, "Klick überspringt das Intro");
  await shot(p, "9-app-nach-intro");
  await p.reload(); await gone(p); await p.waitForTimeout(600);
  check((await p.locator(".intro").count()) === 0, "in derselben Sitzung kein zweites Intro");
  await closeWin(p);
  // Intro läuft von allein zu Ende
  p = await s.open(); await gone(p);
  await p.waitForSelector(".intro video"); await p.waitForSelector(".intro", { state: "detached", timeout: 9000 });
  check(true, "Intro endet von selbst (ca. 4 s)");
  await s.ctx.close();
}
for (const [name, opts] of [["Animationen aus", { animOff: true }], ["Betriebssystem: reduzierte Bewegung", { reducedMotion: "reduce" as const }]] as const) {
  console.log("H: " + name);
  const be = makeBackend(); const s = await session(be, opts); const p = await s.open();
  await p.waitForSelector("button:has-text('Datenordner wählen')");
  check((await p.locator(".wg-bg video").count()) === 0 && (await p.locator(".wg-bg img").count()) === 1, "nur Standbild, kein Video");
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten"); await p.click("button:has-text('Ohne alte Daten starten')");
  await gone(p); await p.waitForTimeout(1200);
  check((await p.locator(".intro").count()) === 0, "kein Intro");
  await s.ctx.close();
}


console.log("I: System → Freigaben ansehen und entziehen");
{
  const be = makeBackend(); const s = await session(be, { animOff: true }); const p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten"); await p.click("button:has-text('Ohne alte Daten starten')");
  await gone(p); await p.waitForTimeout(1500);
  await p.click("text=Tutorial überspringen"); await p.waitForTimeout(500);
  for (let i = 0; i < 7 && !(await text(p)).includes("Ton, Datenbank und Einstellungen"); i++) { await p.keyboard.press("ArrowDown"); await p.waitForTimeout(450); }
  await p.keyboard.press("Enter");
  await p.waitForSelector("text=Freigegebene Ordner", { timeout: 15000 });
  let t = await text(p);
  check(t.includes("2 Ordner, 1 Datei(en)"), "Zusammenfassung: 2 Ordner, 1 Datei");
  check(t.includes("C:\\Users\\Test\\Arbeit") && t.includes("C:\\Users\\Test\\Schule"), "beide Ordner mit Pfad aufgelistet");
  check(t.includes("1 verknüpfte Datei(en), 2 Rückgängig-Ort(e)"), "Einzeldateien und Rückgängig-Orte gezählt");
  await shot(p, "10-freigaben");
  const btn = p.locator(".sysrow", { hasText: "C:\\Users\\Test\\Arbeit" }).locator("button");
  await btn.click();
  check((await btn.innerText()).toLowerCase().includes("wirklich"), "erster Klick fragt nach");
  check(be.st.roots.length === 2, "… und entzieht noch nichts");
  await btn.click(); await p.waitForTimeout(400);
  check(be.st.roots.length === 1 && be.st.roots[0].endsWith("Schule"), "zweiter Klick entzieht genau diesen Ordner");
  check(!(await text(p)).includes("Users\\Test\\Arbeit"), "Liste aktualisiert sich");
  const all = p.locator(".sysrow", { hasText: "verknüpfte Datei" }).locator("button");
  await all.click(); await all.click(); await p.waitForTimeout(400);
  check(be.st.gfiles.length === 0 && be.st.undo === 0 && be.st.roots.length === 1, "„Alle entziehen“ entzieht Dateien, der Ordner bleibt");
  check(!(await text(p)).includes("verknüpfte Datei"), "Zeile für Einzeldateien verschwindet");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}


console.log("J: Handy-App (Android): Speicher im App-Ordner, alte Daten mit Sicherung übernehmen");
{
  const be = makeBackend(); const s = await session(be, { phone: true, animOff: true }); let p = await s.open();
  await p.waitForSelector("text=Möchtest du deine Daten mit einem Passwort schützen?", { timeout: 15000 });
  let t = await text(p);
  check(t.includes("HANDY-APP") || t.toLowerCase().includes("handy-app"), "Titel „Handy-App“");
  check(!t.toLowerCase().includes("datenordner wählen"), "keine Ordner-Auswahl am Handy (es gibt nur den App-Speicher)");
  await shot(p, "11-handy-angebot");
  await p.click("text=Ohne Passwort weiterarbeiten");
  await p.waitForSelector("text=Deine bisherigen Daten übernehmen?");
  t = await text(p);
  check(t.includes("Auf diesem Handy liegen noch deine Daten"), "Handy-Text der Übernahme");
  const imp = p.locator("button:has-text('Daten übernehmen')");
  check(await imp.isDisabled(), "Übernehmen ist gesperrt, solange keine Sicherung gespeichert ist");
  check(![...be.appdata.keys()].some((k) => k.startsWith("azunavi/")), "bis hierher nichts im neuen Speicher");
  await shot(p, "12-handy-alt");
  await p.click("button:has-text('Sicherung speichern')");
  await p.waitForSelector("text=Sicherung gespeichert");
  const saved = be.appdata.get("content://fake/Sicherung.zip");
  check(!!saved && Buffer.from(saved.slice(0, 2)).toString() === "PK", "Sicherung wurde als ZIP über den Android-Dialog gespeichert");
  check(!imp.isDisabled || !(await imp.isDisabled()), "danach ist Übernehmen frei");
  await imp.click();
  await p.waitForSelector("text=✓ Übernommen", { timeout: 40000 });
  t = await text(p);
  check(/\d+ Tabellen, \d+ Einträge und 5 Dateien/.test(t), "Bericht: " + (t.match(/\d+ Tabellen[^.]*\./)?.[0] ?? "?"));
  check(be.appdata.has("azunavi/azunavi.db") && be.appdata.has("azunavi/dateien/attachments/170001_0_bild1.png"), "Datenbank und Dateien im neuen Speicher (azunavi/)");
  check(be.appdata.has("attachments/170001_0_bild1.png") && be.appdata.has("portraits/p1.png"), "alte Dateien unverändert liegen geblieben");
  await p.click("button:has-text('Weiter')"); await gone(p); await p.waitForTimeout(1500);
  await shot(p, "13-handy-app");
  check(be.appdata.has("azunavi/azunavi.db") && !be.appdata.has("azunavi/azunavi.db.tmp"), "keine Zwischendatei übrig");
  const nd = new SQL.Database(be.appdata.get("azunavi/azunavi.db")!);
  check((nd.exec("SELECT COUNT(*) FROM notes")[0].values[0][0] as number) === 3, "Notizen aus der alten Datenbank sind da");
  // Neustart: keine Frage mehr, Daten da
  await p.reload(); await gone(p); await p.waitForTimeout(800);
  check(!(await text(p)).includes("bisherigen Daten übernehmen"), "beim nächsten Start keine Frage mehr");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}
{
  console.log("K: Handy mit Passwort: alte Daten landen verschlüsselt, Neustart verlangt das Passwort");
  const be = makeBackend(); const s = await session(be, { phone: true, animOff: true }); let p = await s.open();
  await p.waitForSelector("button:has-text('Mit Passwort schützen')");
  await p.click("button:has-text('Mit Passwort schützen')");
  await p.fill("label:has-text('Name des Profils') input", "Handy");
  const pws = p.locator("input[type=password]"); await pws.nth(0).fill("ein sehr langes passwort 123"); await pws.nth(1).fill("ein sehr langes passwort 123");
  await p.click("button:has-text('Weiter')");
  await p.waitForSelector("text=Dein Wiederherstellungsschlüssel");
  await p.check("text=Ich habe den Schlüssel sicher aufbewahrt.");
  await p.click("button:has-text('Profil anlegen und Daten verschlüsseln')");
  await p.waitForSelector("text=Deine bisherigen Daten übernehmen?");
  await p.click("button:has-text('Sicherung speichern')"); await p.waitForSelector("text=Sicherung gespeichert");
  await p.click("button:has-text('Daten übernehmen')");
  await p.waitForSelector("text=✓ Übernommen", { timeout: 40000 });
  const magic = (k: string) => Buffer.from(be.appdata.get(k)!.slice(0, 4)).toString();
  check(magic("azunavi/azunavi.db") === "AZV1" && magic("azunavi/dateien/attachments/170002_0_bild2.png") === "AZV1", "Datenbank und Anhang verschlüsselt im App-Speicher");
  check(Buffer.from(be.appdata.get("attachments/170002_0_bild2.png")!.slice(0, 4)).toString() !== "AZV1", "die alten Dateien wurden nicht angefasst");
  await p.click("button:has-text('Weiter')"); await gone(p); await p.waitForTimeout(1000);
  await p.reload();
  await p.waitForSelector("text=ist durch ein Passwort geschützt");
  await p.fill("input[type=password]", "falsches passwort 12345"); await p.click("button:has-text('Entsperren')");
  await p.waitForSelector("text=Falsches Passwort");
  await p.fill("input[type=password]", "ein sehr langes passwort 123"); await p.click("button:has-text('Entsperren')");
  await gone(p); await p.waitForTimeout(800);
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}
{
  console.log("L: Handy, frische Installation (keine alte Datenbank)");
  const be = makeBackend(); be.handle = ((real) => async (cmd: string, args: any, b64: string | null, h: any) => { if (cmd === "plugin:sql|select" && /schema_migrations/.test(args.query)) throw "no such table: schema_migrations"; return real(cmd, args, b64, h); })(be.handle);
  const s = await session(be, { phone: true, animOff: true }); const p = await s.open();
  await p.click("text=Ohne Passwort weiterarbeiten");
  await gone(p); await p.waitForTimeout(1200);
  check(be.appdata.has("azunavi/azunavi.db"), "leere Datenbank im App-Speicher angelegt, ohne Frage nach alten Daten");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}


{
  console.log("M: Handy: „Text prüfen“ in der Notiz (eingebaute Prüfung, ohne Java)");
  const be = makeBackend(); be.legacy.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('tutorial_done', '1')");
  const s = await session(be, { phone: true, animOff: true }); const p = await s.open();
  await p.click("text=Ohne Passwort weiterarbeiten");
  await p.click("button:has-text('Sicherung speichern')"); await p.waitForSelector("text=Sicherung gespeichert");
  await p.click("button:has-text('Daten übernehmen')"); await p.waitForSelector("text=✓ Übernommen", { timeout: 40000 });
  await p.click("button:has-text('Weiter')"); await gone(p); await p.waitForTimeout(1200);
  await p.click(".m-nav button:has-text('Notizen')"); await p.waitForTimeout(400);
  await p.click("[aria-label='Neue Notiz']");
  await p.waitForSelector("textarea");
  await p.fill("textarea", "Ich gehe nach Hause weil ich müde bin. Die datei liegt hier , z.B. im Ordner.");
  await p.click("button:has-text('Text prüfen')");
  await p.waitForSelector(".spelllist", { timeout: 30000 });
  const t = await text(p);
  check(t.includes("geprüft mit der eingebauten Prüfung"), "zeigt „der eingebauten Prüfung“ (kein Java)");
  check(t.includes("Vor „weil“ fehlt ein Komma"), "Komma vor „weil“ gefunden");
  check(t.includes("Hauptwort großschreiben"), "„datei“ → Hauptwort großschreiben");
  check(t.includes("Kein Leerzeichen vor Satzzeichen") && t.includes("Abkürzung mit Leerzeichen"), "Leerzeichen vor Komma und „z.B.“ gefunden");
  await shot(p, "14-handy-pruefen");
  await p.locator(".spelllist li", { hasText: "Vor „weil“" }).locator("button.chip").first().click();
  await p.waitForTimeout(600);
  check((await p.inputValue("textarea")).includes("nach Hause, weil ich"), "Klick auf den Vorschlag setzt das Komma");
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}


console.log("N: Design 0.7.0: Wasser statt Formen, 4K-Hintergründe, Hauptfigur bleibt wählbar");
{
  const be = makeBackend(); const s = await session(be, { hour: 12 }); const p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten"); await p.click("button:has-text('Ohne alte Daten starten')");
  await p.waitForSelector(".intro video", { timeout: 20000 }); await p.click(".intro"); await p.waitForSelector(".intro", { state: "detached", timeout: 3000 });
  await p.waitForSelector("text=Tutorial überspringen"); await shot(p, "17-tut-start");
  await p.click("button:has-text('Starten')"); await p.waitForTimeout(500);
  await p.fill("label:has-text('Vorname') input", "Test"); await p.fill("label:has-text('Nachname') input", "Azubi");
  await p.selectOption("select.field >> nth=0", { index: 1 });
  for (let i = 0; i < 4 && !(await text(p)).toLowerCase().includes("wähle deine figur"); i++) { await p.click(".tutfoot .btn:not(.ghost)"); await p.waitForTimeout(500); }
  check((await text(p)).toLowerCase().includes("wähle deine figur") && (await text(p)).includes("Hauptfigur"), "Tutorial: Figur-Schritt erklärt Hauptfigur und Begleiter");
  check((await p.locator(".charcard").count()) === 6 && !(await text(p)).toLowerCase().includes("wassergeist"), "Auswahl: Original, Kai, Leo, Mira, Nova, Ruby (der Wassergeist ist nur Begleiter)");
  await shot(p, "18-tut-figur");
  await p.click("text=Tutorial überspringen"); await p.waitForTimeout(1200);
  check((await p.locator("#waterbg video").count()) === 1, "Menü: Wasser-Video als Hintergrund");
  check(await p.evaluate(() => { const v = document.querySelector("#waterbg video") as HTMLVideoElement | null; return !!v && !v.paused && v.currentTime > 0; }), "Wasser läuft");
  check((await p.locator("#caustics, .petal, #petals, .blob, .liquid").count()) === 0, "die alten Formen und Teilchen sind weg");
  check((await p.locator("#nightbg").count()) === 0, "tagsüber kein Nacht-Bild");
  const hero = await p.evaluate(() => { const i = document.querySelector("#avatarimg") as HTMLImageElement; return i.naturalHeight; });
  check(hero >= 2000, "Hauptfigur in hoher Auflösung: " + hero + " px");
  await shot(p, "15-menue");
  for (const [i, n] of ["a", "b", "c", "d", "e", "f"].entries()) {
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(500);
    await p.keyboard.press("Enter"); await p.waitForSelector("#page.show", { timeout: 5000 }); await p.waitForTimeout(900);
    if (i === 0) check(await p.evaluate(() => getComputedStyle(document.querySelector(".secbg")!).backgroundImage.includes("webp") || getComputedStyle(document.querySelector(".secbg")!).backgroundImage.includes("url")), "Seite hat ihr Hintergrundbild");
    await shot(p, `16-seite-${i}-${n}`);
    await p.keyboard.press("Escape"); await p.waitForSelector("#page", { state: "detached", timeout: 5000 }); await p.waitForTimeout(500);
  }
  check(s.errors.length === 0, "keine Fehler im Fenster: " + s.errors.join(" | ").slice(0, 200));
  await s.ctx.close();
}
console.log("O: Nacht (Mond-Hintergrund nach Uhrzeit)");
for (const [hour, expectNight] of [[23, true], [3, true], [12, false], [20, false]] as const) {
  const be = makeBackend(); const s = await session(be, { hour, animOff: true }); const p = await s.open();
  await p.click("text=Datenordner wählen"); await p.click("text=Ohne Passwort weiterarbeiten"); await p.click("button:has-text('Ohne alte Daten starten')");
  await p.waitForSelector("text=Tutorial überspringen", { timeout: 20000 }); await p.click("text=Tutorial überspringen"); await p.waitForTimeout(1000);
  check(((await p.locator("#nightbg").count()) === 1) === expectNight && ((await p.locator("#waterbg").count()) === 1) === !expectNight, `${hour} Uhr: ${expectNight ? "Mond-Bild" : "Wasser"}`);
  if (hour === 23) {
    await shot(p, "19-nacht-menue");
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(400); await p.keyboard.press("Enter"); await p.waitForSelector("#page.show"); await p.waitForTimeout(900);
    check(await p.evaluate(() => getComputedStyle(document.querySelector(".secbg")!).backgroundImage.length > 20), "Seite bei Nacht mit Hintergrund");
    await shot(p, "20-nacht-seite");
  }
  await s.ctx.close();
}

await browser.close(); server.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
