// Einmalige Übernahme der alten PC-Datenbank (persona.db) in den Datenordner (azunavi.db + dateien/).
// Reine Logik ohne Tauri: Quelle und Ziel werden hineingereicht, so lässt sich alles unter Node testen.
//
// Reihenfolge (wichtig für die Sicherheit der Daten):
//  1. Prüfen: Ordner hat noch keine azunavi.db, alte Datenbank hat das erwartete Schema.
//  2. Neue Datenbank im Speicher bauen und alle Zeilen kopieren, noch nichts im Ordner.
//  3. Dateien (Anhänge, Porträts, Vorlage) in den Ordner kopieren und jede zurücklesen und vergleichen.
//  4. Probe: neue Datenbank erneut öffnen, Tabellen Zeile für Zeile mit der alten vergleichen.
//  5. ZULETZT azunavi.db schreiben, zurücklesen, vergleichen. Erst das macht den Ordner „belegt“.
// Bricht etwas vorher ab, ist der Ordner weiterhin „leer“ und die Übernahme kann erneut laufen. Die alte Datenbank wird nie verändert.
import type { SqlJsStatic } from "sql.js";
import JSZip from "jszip";
import { MIGRATIONS } from "../db/migrations";

export interface LegacySource {
  schemaVersion(): Promise<number>;
  tableNames(): Promise<string[]>;
  columns(table: string): Promise<string[]>;
  rows(table: string): Promise<Record<string, unknown>[]>;
  /** null: Datei gibt es nicht */
  readFile(rel: string): Promise<Uint8Array | null>;
}
export interface ImportSink {
  /** Gibt es im Datenordner schon eine azunavi.db? */
  hasDb(): Promise<boolean>;
  writeFile(rel: string, bytes: Uint8Array): Promise<void>;
  readFile(rel: string): Promise<Uint8Array | null>;
  writeDb(bytes: Uint8Array): Promise<void>;
  readDb(): Promise<Uint8Array | null>;
}
export interface ImportReport {
  tables: number;
  rows: number;
  files: number;
  /** In der Datenbank erwähnt, aber im alten App-Ordner nicht (mehr) vorhanden */
  missing: string[];
  /** Pfade, die der Datenordner nicht annimmt (ungültige Namen) */
  rejected: string[];
}

const SKIP = new Set(["schema_migrations"]);
const TEMPLATE = "templates/vorlage.docx";

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version;

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bind = (vals: unknown[]) => { const o: Record<string, unknown> = {}; vals.forEach((v, i) => { o["$" + (i + 1)] = v === undefined ? null : v; }); return o; };
/** Zeile als eindeutiger Text (Spaltenreihenfolge egal), zum Vergleichen */
const canon = (r: Record<string, unknown>) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k] === undefined ? null : r[k]]));

/** Pfadregeln wie im Rust-Teil (datadir.rs): nur so wird eine Datei auch angenommen */
export function validRel(rel: string): boolean {
  if (!rel || rel.length > 380 || rel.startsWith("/") || rel.endsWith("/")) return false;
  return rel.split("/").every((p) => p && p !== "." && p !== ".." && !/[<>:"|?*\\\x00-\x1f]/.test(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(p) && !p.endsWith(".azunavi-tmp"));
}

/** Welche Dateien (Anhänge, Porträts, eigene Vorlage) die alte Datenbank verwendet */
export function legacyFilePaths(old: Record<string, Record<string, unknown>[]>): Set<string> {
  const want = new Set<string>();
  old.attachments?.forEach((a) => typeof a.stored_path === "string" && want.add(a.stored_path));
  old.persons?.forEach((p) => typeof p.portrait_path === "string" && p.portrait_path && want.add(p.portrait_path));
  if (old.settings?.some((s) => s.key === "custom_template" && s.value === "1")) want.add(TEMPLATE);
  return want;
}

/** Sicherung der ALTEN Daten als ZIP (gleiches Format wie „Daten mitnehmen“: daten.json plus dateien/), direkt aus der alten Datenbank gelesen.
 *  Lässt sich später mit „Sicherung einspielen“ wiederherstellen. Die alte Datenbank wird nur gelesen. */
export async function exportLegacyZip(src: LegacySource, version: string): Promise<{ bytes: Uint8Array; rows: number; files: number }> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  let rows = 0;
  for (const t of (await src.tableNames()).filter((x) => !SKIP.has(x))) { tables[t] = await src.rows(t); rows += tables[t].length; }
  const zip = new JSZip();
  zip.file("daten.json", JSON.stringify({ app: "persona-app", version, schema: await src.schemaVersion(), created: new Date().toISOString(), tables }));   // Kennung wie in backup.ts
  let files = 0;
  for (const rel of legacyFilePaths(tables)) {
    const b = await src.readFile(rel);
    if (b) { zip.file("dateien/" + rel, b); files++; }
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), rows, files };
}

export async function importLegacy(src: LegacySource, sink: ImportSink, SQL: SqlJsStatic, progress: (m: string) => void = () => {}): Promise<ImportReport> {
  if (await sink.hasDb()) throw new Error("Der Datenordner enthält schon Daten (azunavi.db). Die Übernahme geht nur in einen Ordner ohne Daten.");
  const legacyV = await src.schemaVersion();
  if (legacyV !== LATEST_SCHEMA) throw new Error(`Die alte Datenbank hat das Schema ${legacyV}, diese Version erwartet ${LATEST_SCHEMA}. Bitte starte zuerst die letzte alte Version einmal (0.3.1), dann klappt die Übernahme.`);

  /* 2. neue Datenbank im Speicher bauen */
  progress("Neue Datenbank wird aufgebaut …");
  const db = new SQL.Database();
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");   // wie db.ts
  for (const m of MIGRATIONS) {
    for (const sql of m.statements) db.run(sql);
    db.run("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ($1, $2)", bind([m.version, new Date().toISOString()]) as never);
  }
  const newTables = (db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []).map((r) => String(r[0]));
  const oldTables = (await src.tableNames()).filter((t) => !SKIP.has(t));
  const unknown = oldTables.filter((t) => !newTables.includes(t));
  if (unknown.length) throw new Error("Die alte Datenbank enthält Tabellen, die diese Version nicht kennt: " + unknown.join(", "));

  const old: Record<string, Record<string, unknown>[]> = {};
  let rows = 0;
  db.run("BEGIN");
  try {
    for (const t of oldTables) {
      progress(`Tabelle „${t}“ wird kopiert …`);
      const have = (db.exec(`PRAGMA table_info("${t}")`)[0]?.values ?? []).map((r) => String(r[1]));
      const extra = (await src.columns(t)).filter((c) => !have.includes(c));
      if (extra.length) throw new Error(`In der alten Tabelle „${t}“ gibt es Spalten, die diese Version nicht kennt (${extra.join(", ")}). Es wurde nichts übernommen.`);
      old[t] = await src.rows(t);
      db.run(`DELETE FROM "${t}"`);   // die Migrationen legen Standardzeilen an (z. B. Qualifikationen): der Stand der alten Datenbank ersetzt sie
      for (const r of old[t]) {
        const keys = Object.keys(r);
        if (!keys.length) continue;
        db.run(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(", ")})`, bind(keys.map((k) => r[k])) as never);
        rows++;
      }
    }
    db.run("COMMIT");
  } catch (e) { try { db.run("ROLLBACK"); } catch { /* egal */ } db.close(); throw e; }

  /* 3. Dateien kopieren und prüfen (erst nachdem klar ist, was die Datenbank verlangt) */
  const want = legacyFilePaths(old);
  const missing: string[] = [], rejected: string[] = [];
  let files = 0, n = 0;
  try {
    for (const rel of want) {
      progress(`Datei ${++n} von ${want.size} wird kopiert …`);
      if (!validRel(rel)) { rejected.push(rel); continue; }
      const bytes = await src.readFile(rel);
      if (!bytes) { missing.push(rel); continue; }
      await sink.writeFile("dateien/" + rel, bytes);
      const back = await sink.readFile("dateien/" + rel);
      if (!back || !same(back, bytes)) throw new Error(`Die Datei „${rel}“ ließ sich nach dem Kopieren nicht fehlerfrei zurücklesen. Es wurde nichts übernommen.`);
      files++;
    }

    /* 4. Probe: neue Datenbank erneut öffnen und Zeile für Zeile vergleichen */
    progress("Daten werden geprüft …");
    const bytes = db.export();
    const check = new SQL.Database(bytes);
    for (const t of oldTables) {
      const res = check.exec(`SELECT * FROM "${t}"`)[0];
      const got = (res?.values ?? []).map((v) => canon(Object.fromEntries(res!.columns.map((c, i) => [c, v[i]]))));
      const exp = old[t].map(canon);
      got.sort(); exp.sort();
      if (got.length !== exp.length) throw new Error(`Probe fehlgeschlagen: Tabelle „${t}“ hat ${got.length} statt ${exp.length} Zeilen. Es wurde nichts übernommen.`);
      for (let i = 0; i < exp.length; i++) if (got[i] !== exp[i]) throw new Error(`Probe fehlgeschlagen: Inhalt der Tabelle „${t}“ weicht ab. Es wurde nichts übernommen.`);
    }
    check.close();

    /* 5. zuletzt die Datenbank selbst */
    progress("Datenbank wird gespeichert …");
    await sink.writeDb(bytes);
    const back = await sink.readDb();
    if (!back || !same(back, bytes)) throw new Error("Die gespeicherte Datenbank ließ sich nicht fehlerfrei zurücklesen. Lösche die Datei azunavi.db im Datenordner und starte die Übernahme erneut (die alte Datenbank ist unverändert).");
  } finally { db.close(); }
  return { tables: oldTables.length, rows, files, missing, rejected };
}
