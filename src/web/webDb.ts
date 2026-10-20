// Datenbank der Web-App: echte SQLite (WebAssembly), gespeichert als azunavi.db im Datenordner.
// Gespeichert wird kurz nach jeder Änderung und sofort, wenn du den Tab verlässt oder schließt.
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Backend } from "../db/db";
import { readData, writeData } from "./dataStore";

export const DB_FILE = "azunavi.db";
export type SaveState = "gespeichert" | "speichert" | "fehler";
const emit = (s: SaveState, detail = "") => window.dispatchEvent(new CustomEvent("azunavi-save", { detail: { state: s, detail } }));

function bind(params: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  params.forEach((v, i) => { o["$" + (i + 1)] = v === undefined ? null : v; });
  return o;
}

export async function openWebDb(): Promise<Backend> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await readData(DB_FILE);
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  let dirty = false, timer: number | undefined, chain: Promise<void> = Promise.resolve();
  const flush = () => {
    if (!dirty) return chain;
    dirty = false; window.clearTimeout(timer);
    const data = db.export();
    chain = chain.then(() => writeData(DB_FILE, data)).then(() => { emit("gespeichert"); }).catch((e) => { dirty = true; emit("fehler", String(e)); });
    return chain;
  };
  const schedule = () => { dirty = true; emit("speichert"); window.clearTimeout(timer); timer = window.setTimeout(flush, 600); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", () => { flush(); });
  window.addEventListener("beforeunload", (e) => { if (dirty) { flush(); e.preventDefault(); } });
  return {
    async execute(sql, params = []) {
      db.run(sql, bind(params) as never);
      const r = db.exec("SELECT last_insert_rowid(), changes()")[0].values[0];
      schedule();
      return { lastInsertId: Number(r[0]), rowsAffected: Number(r[1]) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql); stmt.bind(bind(params) as never);
      const rows: T[] = []; while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free(); return rows;
    },
  };
}
