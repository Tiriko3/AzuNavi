import Database from "@tauri-apps/plugin-sql";
import { MIGRATIONS } from "./migrations";
import { isWebApp } from "../platform";

// Läuft die App im Tauri-Fenster (echte SQLite-Datei) oder nur im normalen Browser (Entwicklung)?
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface DbStatus {
  ok: boolean;
  mode: "sqlite" | "browser";
  schemaVersion: number;
  error?: string;
}

export interface ExecResult { rowsAffected: number; lastInsertId: number }
export interface Backend {
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

let backend: Backend | null = null;
let initPromise: Promise<DbStatus> | null = null;

// Wird nur ein einziges Mal ausgeführt, auch wenn React (im Entwicklungsmodus) den Start doppelt auslöst
export function initDb(): Promise<DbStatus> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<DbStatus> {
  let mode: "sqlite" | "browser" = "sqlite";
  try {
    if (inTauri) {
      // "sqlite:persona.db" liegt automatisch unter %APPDATA%\com.local.personaapp\persona.db
      const db = await Database.load("sqlite:persona.db");
      backend = {
        async execute(sql, params = []) {
          const r = await db.execute(sql, params);
          return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? 0 };
        },
        select: <T,>(sql: string, params: unknown[] = []) => db.select<T[]>(sql, params),
      };
    } else if (isWebApp) {
      // Web-App: SQLite als WebAssembly, gespeichert im gewählten Datenordner (azunavi.db)
      mode = "browser";
      const { openWebDb } = await import("../web/webDb");
      backend = await openWebDb();
    } else if (import.meta.env.DEV) {
      mode = "browser";
      const { openBrowserDb } = await import("./browserDb");
      backend = await openBrowserDb();
    } else {
      return { ok: false, mode: "browser", schemaVersion: 0, error: "Keine Datenbank (bitte die App-Datei benutzen)" };
    }

    await backend.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`
    );
    const rows = await backend.select<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
    let current = rows[0]?.v ?? 0;
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      for (const sql of m.statements) await backend.execute(sql);
      await backend.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
        [m.version, new Date().toISOString()]
      );
      current = m.version;
    }
    return { ok: true, mode, schemaVersion: current };
  } catch (e) {
    backend = null;
    return { ok: false, mode, schemaVersion: 0, error: String(e) };
  }
}

function need(): Backend {
  if (!backend) throw new Error("Datenbank ist nicht verbunden");
  return backend;
}

export const execute = (sql: string, params: unknown[] = []) => need().execute(sql, params);
export const select = <T,>(sql: string, params: unknown[] = []) => need().select<T>(sql, params);

export async function getSetting(key: string): Promise<string | null> {
  if (!backend) return null;
  try {
    const rows = await backend.select<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!backend) return;
  try {
    await backend.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  } catch {
    /* Speichern ist nicht kritisch, die App läuft weiter */
  }
}
