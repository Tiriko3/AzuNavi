// NUR für die Entwicklung im normalen Browser (npm run dev): echte SQLite per WebAssembly.
// Im fertigen App-Build ist dieser Code nicht enthalten.
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Backend } from "./db";

const KEY = "persona:sqljs";

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function bind(params: unknown[]): Record<string, any> {
  const o: Record<string, any> = {};
  params.forEach((v, i) => { o["$" + (i + 1)] = v === undefined ? null : v; });
  return o;
}

export async function openBrowserDb(): Promise<Backend> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = localStorage.getItem(KEY);
  const db = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
  const persist = () => localStorage.setItem(KEY, toB64(db.export()));
  return {
    async execute(sql, params = []) {
      db.run(sql, bind(params));
      const r = db.exec("SELECT last_insert_rowid(), changes()")[0].values[0];
      persist();
      return { lastInsertId: Number(r[0]), rowsAffected: Number(r[1]) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      stmt.bind(bind(params));
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
  };
}
