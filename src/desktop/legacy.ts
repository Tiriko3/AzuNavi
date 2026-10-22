// Anbindung der Übernahme an das PC-Programm: alte Datenbank über das SQL-Plugin (nur lesen), alte Dateien über das Fs-Plugin,
// Ziel ist der Datenordner (dataStore). Die Logik selbst steht in legacyImport.ts.
import { hasApp, legacy, type BackupInfo, type LegacyInfo } from "../web/disk";
import { exportLegacyZip, importLegacy, type ImportReport, type ImportSink, type LegacySource } from "./legacyImport";
import { fsapi } from "../fsapi";
import { APP_VERSION } from "../version";
import { DB_FILE } from "../web/webDb";
import { readData, writeData, listFiles } from "../web/dataStore";

export type { BackupInfo, LegacyInfo, ImportReport };
const NONE: LegacyInfo = { exists: false, size: 0, modified: 0, dir: "", backup_dir: null };
/** Gibt es noch die alte Datenbank (persona.db) mit Daten? PC: fragt Rust (Datei neben der App). Handy: schaut über das SQL-Plugin hinein. */
export async function legacyInfo(): Promise<LegacyInfo> {
  if (!hasApp) return legacy.info();
  try {
    const { src, close } = await openSource();
    try { return (await src.schemaVersion()) > 0 ? { ...NONE, exists: true } : NONE; } finally { await close(); }
  } catch { return NONE; }   // keine alte Datenbank (frische Installation)
}

/** Handy: Sicherung der alten Daten als ZIP über den Android-Speicherdialog (z. B. in OneDrive). Gibt den Ort zurück, bei Abbruch null. */
export async function saveLegacyBackup(): Promise<{ path: string; rows: number; files: number } | null> {
  const { src, close } = await openSource();
  try {
    const z = await exportLegacyZip(src, APP_VERSION);
    const path = await (await fsapi()).saveFile(`AzuNavi-Sicherung-alt_${stamp().slice(0, 8)}.zip`, z.bytes, "AzuNavi-Sicherung", "zip");
    return path ? { path, rows: z.rows, files: z.files } : null;
  } finally { await close(); }
}

/** Zeitstempel für den Namen der Sicherung, z. B. 20261022-101530 */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/** Sicherung der alten Datenbank (Rust prüft die Kopie Byte für Byte). Gibt es schon eine, bleibt sie die einzige. */
export const legacyBackup = () => legacy.backup(stamp());

/** Gibt es im Datenordner schon Daten? Dann wird nichts übernommen. */
export async function folderHasDb(): Promise<boolean> { return (await listFiles()).includes(DB_FILE); }

async function openSource(): Promise<{ src: LegacySource; close: () => Promise<void> }> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const { readFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const db = await Database.load("sqlite:persona.db");
  const src: LegacySource = {
    async schemaVersion() { return (await db.select<{ v: number | null }[]>("SELECT MAX(version) AS v FROM schema_migrations"))[0]?.v ?? 0; },
    async tableNames() { return (await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name); },
    async columns(t) { return (await db.select<{ name: string }[]>(`PRAGMA table_info("${t}")`)).map((c) => c.name); },
    rows: (t) => db.select<Record<string, unknown>[]>(`SELECT * FROM "${t}"`),
    async readFile(rel) { try { return await readFile(rel, { baseDir: BaseDirectory.AppData }); } catch { return null; } },
  };
  return { src, close: async () => { try { await db.close(); } catch { /* egal */ } } };
}

/** Alte Daten in den (leeren) Datenordner übernehmen. Die alte Datenbank wird nur gelesen. */
export async function runLegacyImport(progress: (m: string) => void): Promise<ImportReport> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([import("sql.js"), import("sql.js/dist/sql-wasm.wasm?url")]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sink: ImportSink = {
    hasDb: folderHasDb,
    writeFile: (rel, b) => writeData(rel, b),
    readFile: (rel) => readData(rel),
    writeDb: (b) => writeData(DB_FILE, b),
    readDb: () => readData(DB_FILE),
  };
  const { src, close } = await openSource();
  try { return await importLegacy(src, sink, SQL, progress); } finally { await close(); }
}
