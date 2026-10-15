// Bilder für Notizen (Anhänge) und Kontakte (Porträts).
// Die Auswahl wird IMMER in den App-Ordner kopiert (%APPDATA%\com.local.personaapp\...),
// das Original bleibt unberührt liegen.
import { open } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, copyFile, mkdir, readFile } from "@tauri-apps/plugin-fs";
import { inTauri } from "./db/db";

export interface StoredFile { name: string; path: string } // path = relativ zum App-Ordner

const EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
};
const safe = (n: string) => n.replace(/[^\w.\-äöüÄÖÜß]+/g, "_");
const base = (p: string) => p.split(/[\\/]/).pop() || "bild";
const extOf = (p: string) => (p.split(".").pop() || "").toLowerCase();

// Nur für den Browser-Test (npm run dev): Bilder im Speicher halten
const memory = new Map<string, Blob>();
const urlCache = new Map<string, string>();

function pickInBrowser(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export async function pickAndStoreImages(folder: "attachments" | "portraits", multiple: boolean): Promise<StoredFile[]> {
  const stamp = Date.now();
  if (!inTauri) {
    const files = await pickInBrowser(multiple);
    return files.map((f, i) => {
      const path = `${folder}/${stamp}_${i}_${safe(f.name)}`;
      memory.set(path, f);
      return { name: f.name, path };
    });
  }
  const sel = await open({ multiple, directory: false, filters: [{ name: "Bilder", extensions: EXT }] });
  if (!sel) return [];
  const sources = Array.isArray(sel) ? sel : [sel];
  await mkdir(folder, { baseDir: BaseDirectory.AppData, recursive: true });
  const out: StoredFile[] = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const name = base(src);
    const path = `${folder}/${stamp}_${i}_${safe(name)}`;
    await copyFile(src, path, { toPathBaseDir: BaseDirectory.AppData });
    out.push({ name, path });
  }
  return out;
}

/** Liefert eine Adresse, mit der ein <img> das gespeicherte Bild anzeigen kann */
export async function fileUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  try {
    let blob: Blob | undefined;
    if (!inTauri) {
      blob = memory.get(path);
    } else {
      const bytes = await readFile(path, { baseDir: BaseDirectory.AppData });
      blob = new Blob([bytes], { type: MIME[extOf(path)] ?? "application/octet-stream" });
    }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(path, url);
    return url;
  } catch {
    return null;
  }
}
