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
  const st = { current: null as string | null, missing: false, destroyed: 0, backups: 0, legacy: true, picks: 0, calls: [] as string[] };
  const legacy = legacyDb(SQL); const lfiles = FILES();
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
      case "legacy_info": return { exists: st.legacy, size: 4_200_000, modified: 1_790_000_000, dir: "C:\\Users\\Test\\AppData\\Roaming\\com.local.personaapp", backup_dir: null };
      case "legacy_backup": st.backups++; return { dir: "C:\\Users\\Test\\AppData\\Roaming\\com.local.personaapp\\Sicherung-vor-0.4.0", files: ["persona-x.db"], bytes: 4_200_000, created: st.backups === 1 };
      case "plugin:sql|load": return args.db;
      case "plugin:sql|close": return true;
      case "plugin:sql|select": { const r = legacy.exec(args.query)[0]; return r ? r.values.map((v: unknown[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, v[i]]))) : []; }
      case "plugin:fs|read_file": { const b = (lfiles as any)[args.path]; if (!b) throw "No such file"; return { __bin: Buffer.from(b).toString("base64") }; }
      case "plugin:window|destroy": st.destroyed++; return null;
      default: return null;
    }
  }
  return { disk, locs, st, handle };
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
  window.__fire = (ev) => cbs[window.__listeners[ev]] && cbs[window.__listeners[ev]]({ event: ev, id: 1, payload: null });
})();`;

let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) ok++; else { bad++; console.log("  ✗ " + m); } };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

async function session(be: ReturnType<typeof makeBackend>) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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

await browser.close(); server.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
