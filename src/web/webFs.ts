// Datei-Funktionen im Browser: Dateien wählen, „Speichern unter“ (oder Herunterladen).
// Freie Ordnerpfade (Dateien-Seite) gibt es im Browser nicht; dafür kommt eine eigene Lösung.
import type { FsApi } from "../fsapi";

const picked = new Map<string, File>();
let n = 0;
function pick(multiple: boolean, accept = ""): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = multiple; if (accept) input.accept = accept;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
const register = (f: File) => { const p = `web-datei:${++n}/${f.name}`; picked.set(p, f); return p; };
const notHere = async (): Promise<never> => { throw new Error("Das geht in der Web-App noch nicht. Nutze dafür das PC-Programm."); };

export const webFs: FsApi = {
  tree: async (root) => ({ name: root, path: root, children: [] }),
  list: async () => [],
  exists: async (p) => picked.has(p),
  isDir: async () => false,
  mkdir: notHere, uniqueName: async (_d, name) => name, move: notHere, open: notHere, reveal: notHere,
  pickFiles: async () => (await pick(true)).map(register),
  pickFolder: async () => null,
  pickFile: async () => { const f = (await pick(false))[0]; return f ? register(f) : null; },
  read: async (path, max) => {
    const f = picked.get(path); if (!f) throw new Error("Datei nicht mehr verfügbar, bitte erneut wählen.");
    if (f.size > max) throw new Error("Die Datei ist zu groß.");
    return new Uint8Array(await f.arrayBuffer());
  },
  saveFile: async (defaultName, bytes, filterName, ext) => {
    const w = window as any;
    if (w.showSaveFilePicker) {   // Chrome/Edge: echtes „Speichern unter“
      try {
        const h = await w.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: filterName, accept: { "application/octet-stream": ["." + ext] } }] });
        const s = await h.createWritable(); await s.write(bytes); await s.close(); return h.name as string;
      } catch (e) { if ((e as DOMException)?.name === "AbortError") return null; }
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));   // sonst: normal herunterladen
    const a = document.createElement("a"); a.href = url; a.download = defaultName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return defaultName;
  },
  writeFile: notHere,
};
