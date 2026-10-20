// „Daten mitnehmen“ (Etappe 9): komplette Sicherung als eine ZIP-Datei für einen anderen Laptop
import JSZip from "jszip";
import { appRead, appWrite } from "./storage/appFiles";
import { isWebApp } from "./platform";
import { execute, getSetting, inTauri, select } from "./db/db";

const APP = "persona-app"; // interne Kennung bleibt, damit alte Sicherungen passen
const SKIP_TABLES = new Set(["schema_migrations"]);

async function tables(): Promise<string[]> {
  const r = await select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return r.map((x) => x.name);
}

export async function createBackup(version: string): Promise<{ bytes: Uint8Array; rows: number; files: number }> {
  const zip = new JSZip();
  const data: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of await tables()) { data[t] = await select(`SELECT * FROM "${t}"`); rows += data[t].length; }
  const schema = (await select<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations"))[0]?.v ?? 0;
  zip.file("daten.json", JSON.stringify({ app: APP, version, schema, created: new Date().toISOString(), tables: data }));
  // Dateien aus dem App-Ordner: Anhänge, Porträts, eigene Vorlage
  const paths = new Set<string>();
  (data.attachments as { stored_path: string }[] | undefined)?.forEach((a) => paths.add(a.stored_path));
  (data.persons as { portrait_path: string | null }[] | undefined)?.forEach((p) => p.portrait_path && paths.add(p.portrait_path));
  if ((await getSetting("custom_template")) === "1") paths.add("templates/vorlage.docx");
  let files = 0;
  if (inTauri || isWebApp) {
    for (const p of paths) {
      try { zip.file("dateien/" + p, await appRead(p)); files++; } catch { /* fehlende Datei überspringen */ }
    }
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), rows, files };
}

export async function restoreBackup(bytes: ArrayBuffer): Promise<{ rows: number; files: number }> {
  const zip = await JSZip.loadAsync(bytes);
  const json = await zip.file("daten.json")?.async("string");
  if (!json) throw new Error("Das ist keine Sicherung von AzuNavi.");
  const backup = JSON.parse(json) as { app: string; schema: number; tables: Record<string, Record<string, unknown>[]> };
  if (backup.app !== APP) throw new Error("Das ist keine Sicherung von AzuNavi.");
  const schema = (await select<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations"))[0]?.v ?? 0;
  if (backup.schema > schema) throw new Error("Die Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.");
  let rows = 0;
  for (const t of await tables()) {
    if (SKIP_TABLES.has(t)) continue;
    await execute(`DELETE FROM "${t}"`);
    const list = backup.tables[t];
    if (!list?.length) continue;
    const cols = (await select<{ name: string }>(`PRAGMA table_info("${t}")`)).map((c) => c.name);
    for (const row of list) {
      const keys = Object.keys(row).filter((k) => cols.includes(k));
      if (!keys.length) continue;
      await execute(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(", ")})`, keys.map((k) => row[k]));
      rows++;
    }
  }
  let files = 0;
  if (inTauri || isWebApp) {
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith("dateien/") && !zip.files[n].dir)) {
      const rel = name.slice("dateien/".length);
      await appWrite(rel, await zip.file(name)!.async("uint8array"));
      files++;
    }
  }
  return { rows, files };
}

/** Alles löschen: Tabellen werden entfernt und beim Neustart frisch angelegt. Deine Ordner und Dateien bleiben unberührt. */
export async function resetApp() {
  for (const t of await tables()) await execute(`DROP TABLE IF EXISTS "${t}"`);
  if (!inTauri) localStorage.clear();
}
