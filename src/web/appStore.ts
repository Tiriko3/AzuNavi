// Handy (Android, ab 0.5.0): Datenordner im geschützten App-Speicher. Gleicher Aufbau wie am PC und im Browser:
//   azunavi/azunavi.db, azunavi/profil.json, azunavi/dateien/…  (unter AppData der App)
// Passwortschutz (Profil) und Verschlüsselung laufen darüber exakt wie in der Web-App (dataStore.ts/vault.ts).
// Der Austausch mit PC und Browser geschieht über die Sicherungsdatei (System → Daten mitnehmen bzw. Cloud-Sicherung).
// Fs-Plugin wird erst bei Bedarf geladen (die Web-App braucht es nicht).

const ROOT = "azunavi";
const TOP = new Set(["azunavi.db", "profil.json", "azunavi.lock"]);

/** Nur AzuNavis eigene Dateien, keine ..-Pfade */
function okRel(rel: string): boolean {
  if (TOP.has(rel)) return true;
  if (!rel.startsWith("dateien/") || rel.length <= 8) return false;
  return rel.split("/").every((p) => p && p !== "." && p !== ".." && !/[\\:\x00]/.test(p));
}
const fsp = () => import("@tauri-apps/plugin-fs");

export const appStore = {
  /** null: gibt es nicht */
  async read(rel: string): Promise<Uint8Array | null> {
    if (!okRel(rel)) throw new Error("Dieser Pfad gehört nicht zu AzuNavi.");
    const { exists, readFile, BaseDirectory } = await fsp();
    const p = `${ROOT}/${rel}`;
    if (!(await exists(p, { baseDir: BaseDirectory.AppData }))) return null;
    return await readFile(p, { baseDir: BaseDirectory.AppData });
  },
  /** Erst in eine Zwischendatei, dann umbenennen (so bleibt bei einem Abbruch die alte Datei heil) */
  async write(rel: string, bytes: Uint8Array): Promise<void> {
    if (!okRel(rel)) throw new Error("Dieser Pfad gehört nicht zu AzuNavi.");
    const { mkdir, writeFile, rename, remove, BaseDirectory } = await fsp();
    const base = { baseDir: BaseDirectory.AppData };
    const p = `${ROOT}/${rel}`;
    await mkdir(p.slice(0, p.lastIndexOf("/")), { ...base, recursive: true });
    const tmp = p + ".tmp";
    await writeFile(tmp, bytes, base);
    try { await rename(tmp, p, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData }); }
    catch { await writeFile(p, bytes, base); try { await remove(tmp, base); } catch { /* egal */ } }   // Ersatzweg: direkt schreiben
  },
  /** Alle Dateien von AzuNavi (relative Pfade mit „/“) */
  async list(): Promise<string[]> {
    const { exists, readDir, BaseDirectory } = await fsp();
    const base = { baseDir: BaseDirectory.AppData };
    const out: string[] = [];
    for (const top of TOP) if (await exists(`${ROOT}/${top}`, base)) out.push(top);
    const walk = async (dir: string, rel: string, depth: number) => {
      if (depth > 12 || !(await exists(dir, base))) return;
      for (const e of await readDir(dir, base)) {
        if (e.name.endsWith(".tmp")) continue;
        if (e.isDirectory) await walk(`${dir}/${e.name}`, `${rel}/${e.name}`, depth + 1);
        else if (e.isFile) out.push(`${rel}/${e.name}`);
      }
    };
    await walk(`${ROOT}/dateien`, "dateien", 0);
    return out.sort();
  },
};
