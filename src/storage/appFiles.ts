// Dateien der App (Anhänge, Porträts, eigene Berichtsheft-Vorlage), relativ zum App-Ordner.
// PC/Handy: App-Datenordner von Tauri. Web-App: Unterordner „dateien/“ im gewählten Datenordner.
import { isWebApp } from "../platform";

export async function appRead(rel: string): Promise<Uint8Array> {
  if (isWebApp) {
    const { readData } = await import("../web/dataStore");
    const b = await readData("dateien/" + rel); if (!b) throw new Error("Datei fehlt: " + rel); return b;
  }
  const { readFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return readFile(rel, { baseDir: BaseDirectory.AppData });
}
export async function appWrite(rel: string, bytes: Uint8Array): Promise<void> {
  if (isWebApp) { const { writeData } = await import("../web/dataStore"); return writeData("dateien/" + rel, bytes); }
  const { mkdir, writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const dir = rel.split("/").slice(0, -1).join("/");
  if (dir) await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeFile(rel, bytes, { baseDir: BaseDirectory.AppData });
}
