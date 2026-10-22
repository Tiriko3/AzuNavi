// Gemeinsame Beispieldaten für die Tests: eine „alte“ persona.db (Schema 12) mit Zeilen in allen Tabellen und passende Dateien.
import type { SqlJsStatic } from "sql.js";
import { MIGRATIONS } from "../src/db/migrations.ts";
import { LATEST_SCHEMA } from "../src/desktop/legacyImport.ts";
export { LATEST_SCHEMA };

export function legacyDb(SQL: SqlJsStatic, version = LATEST_SCHEMA, extraCol = false) {
  const db = new SQL.Database();
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const m of MIGRATIONS) { for (const s of m.statements) db.run(s); db.run("INSERT INTO schema_migrations VALUES (?, ?)", [m.version, "2026-01-01"]); }
  if (version !== LATEST_SCHEMA) db.run("DELETE FROM schema_migrations WHERE version > ?", [version]);
  const tables = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'")[0]?.values ?? []).map((r) => String(r[0]));
  for (const t of tables) {
    const cols = (db.exec(`PRAGMA table_info("${t}")`)[0].values as any[][]).map((c) => ({ name: String(c[1]), type: String(c[2]).toUpperCase(), notnull: !!c[3], dflt: c[4], pk: !!c[5] }));
    const existing = t === "settings" ? 0 : 0; void existing;
    for (let i = 1; i <= 3; i++) {
      const names: string[] = [], vals: unknown[] = [];
      for (const c of cols) {
        if (c.pk && c.type.startsWith("INT") && cols.filter((x) => x.pk).length === 1) { names.push(c.name); vals.push(i); continue; }
        let v: unknown;
        if (c.name === "stored_path") v = `attachments/17000${i}_0_bild${i}.png`;
        else if (c.name === "portrait_path") v = i === 1 ? "portraits/p1.png" : i === 2 ? null : "portraits/fehlt.png";
        else if (c.name === "key") v = i === 1 ? "custom_template" : "k" + i;
        else if (c.name === "value") v = i === 1 ? "1" : "Wert ä ö ü ß € 日本 " + "x".repeat(i * 500);
        else if (c.type.includes("INT")) v = i + 10;
        else if (c.type.includes("REAL") || c.type.includes("FLOAT")) v = i * 1.1;
        else if (c.type.includes("TEXT") || c.type === "") v = `${c.name} ${t} ${i} „Üml“ 😀`;
        else v = i;
        if (!c.notnull && c.dflt === null && i === 3 && !c.pk && !["stored_path", "portrait_path", "key", "value"].includes(c.name)) v = null;   // NULL-Werte mit abdecken
        names.push(c.name); vals.push(v);
      }
      db.run(`INSERT OR IGNORE INTO "${t}" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`, vals as never);
    }
  }
  if (extraCol) db.run("ALTER TABLE notes ADD COLUMN geheim TEXT");
  return db;
}

export const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
export const FILES = () => ({ "attachments/170001_0_bild1.png": bytes(5000, 1), "attachments/170002_0_bild2.png": bytes(70000, 2), "attachments/170003_0_bild3.png": bytes(10, 3), "portraits/p1.png": bytes(3000, 4), "templates/vorlage.docx": bytes(20000, 5) });
