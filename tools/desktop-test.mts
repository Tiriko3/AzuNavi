// Test des PC-Datenordners (0.4.0) unter Node: Übernahme der alten persona.db und der Datenspeicher mit nachgebauter Rust-Schnittstelle.
// Start: npx tsx tools/desktop-test.mts   (braucht tsx und fake-indexeddb, nur zum Testen, nicht ins Projekt aufnehmen)
import "fake-indexeddb/auto";
import initSqlJs from "sql.js";

/* ---------- Umgebung wie im Fenster ---------- */
const st = new Map<string, string>();
(globalThis as any).sessionStorage = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, v: string) => void st.set(k, v), removeItem: (k: string) => void st.delete(k) };
(globalThis as any).window = Object.assign(globalThis, { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/130" }, configurable: true });

/* ---------- Nachbau der Rust-Befehle (gleiche Regeln wie datadir.rs) ---------- */
const disk = new Map<string, Uint8Array>();           // Datenordner: Pfad -> Inhalt
const locs = [{ id: "a1", path: "C:\\Users\\Test\\OneDrive\\AzuNavi" }];
let current: string | null = null;
let missingFolder = false;
const OK_TOP = new Set(["azunavi.db", "profil.json", "azunavi.lock"]);
function checkRel(rel: string) {
  const ok = (OK_TOP.has(rel) || (rel.startsWith("dateien/") && rel.length > 8)) && rel.split("/").every((p) => p && p !== "." && p !== ".." && !/[<>:"|?*\\\x00-\x1f]/.test(p) && !/[. ]$/.test(p) && !/^(con|nul|prn|aux|com\d|lpt\d)(\.|$)/i.test(p));
  if (!ok) throw "Dieser Pfad gehört nicht zu AzuNavi.";
}
const calls: string[] = [];
(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any, options?: any) => {
    calls.push(cmd);
    switch (cmd) {
      case "data_locations": return locs.map((l) => ({ id: l.id, name: l.path.split("\\").pop(), path: l.path, exists: !missingFolder }));
      case "data_pick_folder": { const l = { id: "n" + locs.length, path: "D:\\Neu\\Ordner" + locs.length }; locs.push(l); return { id: l.id, name: l.path.split("\\").pop(), path: l.path, exists: true }; }
      case "data_open": { const l = locs.find((x) => x.id === args.id); if (!l) throw "Diesen Datenordner kenne ich nicht."; if (missingFolder) throw "ORDNER_FEHLT"; current = l.id; return { id: l.id, name: l.path.split("\\").pop(), path: l.path, exists: true }; }
      case "data_close": current = null; return;
      case "data_forget": { const i = locs.findIndex((x) => x.id === args.id); if (i >= 0) locs.splice(i, 1); if (current === args.id) current = null; return; }
      case "data_read": { if (!current) throw "Kein Datenordner gewählt."; checkRel(args.rel); const b = disk.get(args.rel); if (!b) throw "NICHT_GEFUNDEN"; return b.slice().buffer; }
      case "data_write": {
        if (!current) throw "Kein Datenordner gewählt.";
        if (!(args instanceof Uint8Array)) throw "Falscher Aufruf: es fehlen die Daten.";
        const rel = decodeURIComponent(options?.headers?.["x-rel"] ?? ""); checkRel(rel); disk.set(rel, args.slice()); return;
      }
      case "data_list": { if (!current) throw "Kein Datenordner gewählt."; return [...disk.keys()].sort(); }
      case "data_remove_lock": disk.delete("azunavi.lock"); return;
    }
    throw "unbekannter Befehl " + cmd;
  },
};

let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) { ok++; } else { bad++; console.log("  ✗ " + m); } };
const rejects = async (f: () => Promise<unknown>, part: string, m: string) => { try { await f(); bad++; console.log("  ✗ " + m + " (kein Fehler)"); } catch (e) { const t = String((e as Error)?.message ?? e); if (t.includes(part)) ok++; else { bad++; console.log(`  ✗ ${m}: Fehlertext „${t}“ enthält nicht „${part}“`); } } };

const { importLegacy, exportLegacyZip, LATEST_SCHEMA, validRel } = await import("../src/desktop/legacyImport.ts");
const { MIGRATIONS } = await import("../src/db/migrations.ts");
const SQL = await initSqlJs();

import { legacyDb as mkLegacy, bytes, FILES } from "./legacy-fixture.mts";
const legacyDb = (v = LATEST_SCHEMA, extra = false) => mkLegacy(SQL, v, extra);
function source(db: any, files: Record<string, Uint8Array>) {
  const all = (sql: string) => { const r = db.exec(sql)[0]; return r ? r.values.map((v: unknown[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, v[i]]))) : []; };
  return {
    schemaVersion: async () => (all("SELECT MAX(version) AS v FROM schema_migrations")[0]?.v as number) ?? 0,
    tableNames: async () => all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r: any) => r.name as string),
    columns: async (t: string) => all(`PRAGMA table_info("${t}")`).map((r: any) => r.name as string),
    rows: async (t: string) => all(`SELECT * FROM "${t}"`) as Record<string, unknown>[],
    readFile: async (rel: string) => files[rel] ?? null,
  };
}
function sink(opts: { hasDb?: boolean; corruptFile?: boolean; corruptDb?: boolean } = {}) {
  const f = new Map<string, Uint8Array>(); let db: Uint8Array | null = opts.hasDb ? new Uint8Array([1]) : null;
  return {
    f, get db() { return db; },
    hasDb: async () => !!db,
    writeFile: async (rel: string, b: Uint8Array) => { const c = b.slice(); if (opts.corruptFile && c.length) c[0] ^= 1; f.set(rel, c); },
    readFile: async (rel: string) => f.get(rel) ?? null,
    writeDb: async (b: Uint8Array) => { const c = b.slice(); if (opts.corruptDb) c[c.length - 1] ^= 1; db = c; },
    readDb: async () => db,
  };
}

console.log("Übernahme: normaler Ablauf");
{
  const l = legacyDb(); const s = sink(); const msgs: string[] = [];
  const rep = await importLegacy(source(l, FILES()), s, SQL, (m) => msgs.push(m));
  const tables = (l.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations'")[0].values).length;
  check(rep.tables === tables && tables > 10, `Tabellenzahl ${rep.tables}/${tables}`);
  check(rep.rows > 30, "Zeilen übernommen: " + rep.rows);
  check(rep.files === 5, "Dateien: " + rep.files);
  check(rep.missing.length === 1 && rep.missing[0] === "portraits/fehlt.png", "fehlende Datei gemeldet: " + rep.missing);
  check(s.db && (await s.hasDb()), "Datenbank geschrieben");
  const n = new SQL.Database(s.db!);
  const ver = n.exec("SELECT MAX(version) FROM schema_migrations")[0].values[0][0];
  check(ver === LATEST_SCHEMA, "Schema in neuer Datenbank: " + ver);
  for (const t of ["notes", "persons", "settings", "attachments", "projects"]) {
    const a = l.exec(`SELECT * FROM "${t}" ORDER BY 1`)[0]?.values, b = n.exec(`SELECT * FROM "${t}" ORDER BY 1`)[0]?.values;
    check(JSON.stringify(a) === JSON.stringify(b) && !!a, `Tabelle ${t} identisch (${a?.length} Zeilen)`);
  }
  for (const [rel, b] of Object.entries(FILES())) if (rel !== "portraits/fehlt.png") check(s.f.get("dateien/" + rel)?.every((v, i) => v === b[i]) && s.f.get("dateien/" + rel)?.length === b.length, "Datei kopiert: " + rel);
  check(msgs.length > 5, "Fortschritt gemeldet");
  // Neue Datenbank hat genau das Schema, das db.ts beim Start erzeugen würde
  const fresh = new SQL.Database(); fresh.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const m of MIGRATIONS) { for (const q of m.statements) fresh.run(q); fresh.run("INSERT OR IGNORE INTO schema_migrations VALUES (?, ?)", [m.version, "x"]); }
  const sch = (d: any) => JSON.stringify(d.exec("SELECT type,name,sql FROM sqlite_master ORDER BY name")[0].values);
  check(sch(fresh) === sch(n), "Schema wie bei normalem Start");
}

console.log("Sicherung der alten Daten (Handy: vor der Übernahme)");
{
  const JSZip = (await import("jszip")).default;
  const l = legacyDb(); const z = await exportLegacyZip(source(l, FILES()), "0.5.0");
  const zip = await JSZip.loadAsync(z.bytes);
  const j = JSON.parse(await zip.file("daten.json")!.async("string"));
  check(j.app === "persona-app" && j.schema === LATEST_SCHEMA && j.version === "0.5.0", "gleiche Kennung wie „Daten mitnehmen“ (damit Einspielen funktioniert)");
  const n = (l.exec("SELECT COUNT(*) FROM notes")[0].values[0][0] as number);
  check(j.tables.notes.length === n && !("schema_migrations" in j.tables), "alle Notizen drin, keine Migrations-Tabelle");
  check(z.files === 5 && Object.keys(zip.files).filter((k) => k.startsWith("dateien/") && !zip.files[k].dir).length === 5, "5 Dateien in dateien/ (die fehlende wird übersprungen)");
  const orig = FILES()["attachments/170002_0_bild2.png"]; const got = await zip.file("dateien/attachments/170002_0_bild2.png")!.async("uint8array");
  check(got.length === orig.length && got.every((v: number, i: number) => v === orig[i]), "Dateiinhalt unverändert");
  check(z.rows > 30, "Zeilen gezählt: " + z.rows);
}

console.log("Übernahme: Schutz vor Fehlern (es darf nichts Halbes übrig bleiben)");
{
  let s = sink({ hasDb: true });
  await rejects(() => importLegacy(source(legacyDb(), FILES()), s, SQL), "schon Daten", "Ordner mit Daten abgelehnt");
  check(s.f.size === 0, "… und es wurde nichts geschrieben");

  s = sink();
  await rejects(() => importLegacy(source(legacyDb(11), FILES()), s, SQL), "Schema 11", "falsches Schema abgelehnt");
  check(s.f.size === 0 && !s.db, "… nichts geschrieben");

  s = sink();
  await rejects(() => importLegacy(source(legacyDb(LATEST_SCHEMA, true), FILES()), s, SQL), "geheim", "unbekannte Spalte abgelehnt");
  check(s.f.size === 0 && !s.db, "… nichts geschrieben");

  s = sink({ corruptFile: true });
  await rejects(() => importLegacy(source(legacyDb(), FILES()), s, SQL), "zurücklesen", "beschädigt geschriebene Datei bemerkt");
  check(!s.db, "… Datenbank NICHT geschrieben (Ordner bleibt leer)");

  s = sink({ corruptDb: true });
  await rejects(() => importLegacy(source(legacyDb(), FILES()), s, SQL), "zurücklesen", "beschädigt geschriebene Datenbank bemerkt");

  const l = legacyDb(); l.run("CREATE TABLE fremd (a INTEGER)");
  s = sink();
  await rejects(() => importLegacy(source(l, FILES()), s, SQL), "fremd", "unbekannte Tabelle abgelehnt");
  check(!s.db && s.f.size === 0, "… nichts geschrieben");

  // Probe bemerkt, wenn die Quelle beim zweiten Lesen etwas anderes liefert als beim Kopieren
  const src = source(legacyDb(), FILES()); let first = true; const realRows = src.rows;
  src.rows = async (t: string) => { const r = await realRows(t); if (t === "notes" && first) { first = false; return r; } return r; };
  s = sink(); await importLegacy(src, s, SQL); check(!!s.db, "Gegenprobe: unveränderte Quelle klappt");

  // Pfade, die der Datenordner nicht annimmt
  const l2 = legacyDb(); l2.run("UPDATE attachments SET stored_path = 'attachments/ende.' WHERE id = 1");
  s = sink(); const rep = await importLegacy(source(l2, { ...FILES(), "attachments/ende.": bytes(5) }), s, SQL);
  check(rep.rejected.includes("attachments/ende."), "ungültiger Name gemeldet, Rest übernommen");
}

console.log("Pfadregeln (müssen zu datadir.rs passen)");
for (const g of ["attachments/1_0_a.png", "portraits/ä ö.webp", "templates/vorlage.docx"]) check(validRel(g), "ok: " + g);
for (const b of ["", "../x", "a/../b", "/a", "a//b", "a\\b", "C:/x", "a/CON", "a/nul.png", "a/x.", "a/x ", "a/COM1.txt", "a/b:c", "a/x.azunavi-tmp"]) check(!validRel(b), "abgelehnt: " + JSON.stringify(b));

console.log("Datenspeicher im PC-Programm (mit nachgebauter Rust-Schnittstelle)");
{
  const ds = await import("../src/web/dataStore.ts");
  const vault = await import("../src/web/vault.ts");
  const list = await ds.savedLocations();
  check(list.length === 1 && list[0].kind === "disk" && list[0].name === "AzuNavi" && !list[0].missing, "Ordnerliste kommt von Rust");
  check(ds.canPickFolder, "Ordner wählen ist möglich");
  check(await ds.resumeLocation("a1"), "Ordner öffnen");
  check(ds.locationInfo().kind === "disk" && ds.locationInfo().name === "AzuNavi", "Ordnername");
  check((await ds.readRaw("azunavi.db")) === null, "fehlende Datei = null (kein Fehler)");
  await ds.writeData("azunavi.db", bytes(1000));
  await ds.writeData("dateien/attachments/1_0_ä.png", bytes(50));
  check((await ds.readData("azunavi.db"))!.length === 1000, "schreiben und lesen");
  check((await ds.listFiles()).join() === "azunavi.db,dateien/attachments/1_0_ä.png", "auflisten");
  await rejects(() => ds.writeData("../x", bytes(1)), "gehört nicht", "Pfad außerhalb abgelehnt (Fehlertext kommt an)");
  await rejects(() => ds.readData("desktop.ini"), "gehört nicht", "fremde Datei abgelehnt");

  // Sperre
  ds.holdLock(); await new Promise((r) => setTimeout(r, 30));
  check(disk.has("azunavi.lock"), "Sperrdatei angelegt");
  check((await ds.otherLock()) === null, "eigene Sperre warnt nicht");
  await ds.releaseLock();
  check(!disk.has("azunavi.lock"), "eigene Sperre beim Beenden entfernt");
  disk.set("azunavi.lock", new TextEncoder().encode(JSON.stringify({ id: "fremd", device: "Android · Chrome", ts: Date.now() })));
  check((await ds.otherLock())?.device === "Android · Chrome", "Sperre eines anderen Geräts wird gemeldet");
  await ds.releaseLock();
  check(disk.has("azunavi.lock"), "fremde Sperre wird NICHT entfernt");
  disk.delete("azunavi.lock");

  // Passwortschutz auf dem PC: bestehende Daten werden verschlüsselt übernommen, Dateinamen bleiben, Inhalt nicht lesbar
  const made = await vault.createProfile("Test", "ein sehr langes passwort 123");
  const plainDb = disk.get("azunavi.db")!.slice();
  await ds.activateNewProfile(made.profile, made.raw);
  check(vault.isVaultFile(disk.get("azunavi.db")!) && vault.isVaultFile(disk.get("dateien/attachments/1_0_ä.png")!), "bestehende Dateien verschlüsselt");
  check(!vault.isVaultFile(disk.get("profil.json")!), "profil.json bleibt lesbar (enthält nur verpackte Schlüssel)");
  check(JSON.stringify([...(await ds.readData("azunavi.db"))!]) === JSON.stringify([...plainDb]), "entschlüsselt wieder identisch");
  await ds.writeData("dateien/neu.bin", bytes(9));
  check(vault.isVaultFile(disk.get("dateien/neu.bin")!), "neue Datei wird verschlüsselt geschrieben");
  const prof = await ds.readProfile();
  check(prof?.name === "Test" && !prof.legacy, "Profil gelesen, Übernahme abgeschlossen");

  // Neustart: gesperrt, falsches Passwort, richtiges Passwort
  ds.setSecure(prof, null);
  await rejects(() => ds.readData("azunavi.db"), "gesperrt", "gesperrtes Profil liest nichts");
  await rejects(() => ds.unlockWithPassword(prof!, "falsches passwort 12345"), "Falsches Passwort", "falsches Passwort");
  await ds.unlockWithPassword(prof!, "ein sehr langes passwort 123");
  check((await ds.readData("azunavi.db"))!.length === 1000, "mit Passwort entsperrt");
  // Eine Datei, die jemand unverschlüsselt in dateien/ legt, wird nicht stillschweigend gelesen
  disk.set("dateien/unterschoben.txt", new TextEncoder().encode("hallo"));
  await rejects(() => ds.readData("dateien/unterschoben.txt"), "nicht verschlüsselt", "unverschlüsselte Datei wird abgelehnt");

  // Ordner wechseln
  const id = await ds.addFolder(); check(id === "n1", "neuen Ordner wählen");
  await ds.removeLocation("n1"); check((await ds.savedLocations()).length === 1, "Ordner aus Liste nehmen (Dateien bleiben)");
  missingFolder = true;
  check((await ds.savedLocations())[0].missing === true, "fehlender Ordner wird erkannt");
  await rejects(() => ds.resumeLocation("a1"), "nicht gefunden", "verständliche Meldung bei fehlendem Ordner");
  missingFolder = false;
  await ds.forgetLocation(); check(current === null, "Ordner schließen");
}

console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
