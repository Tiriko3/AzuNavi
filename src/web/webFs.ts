// Datei-Funktionen im Browser: Dateien wählen, „Speichern unter“ (oder Herunterladen).
// Freie Ordnerpfade (Dateien-Seite) gibt es im Browser nicht; dafür kommt eine eigene Lösung.
import type { FsApi } from "../fsapi";
import { registerFile, webFolderFs } from "./webFiles";

function pick(multiple: boolean, accept = ""): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = multiple; if (accept) input.accept = accept;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
const register = registerFile;
const notHere = async (): Promise<never> => { throw new Error("Das geht in der Web-App noch nicht. Nutze dafür das PC-Programm."); };

export const webFs: FsApi = {
  ...webFolderFs,
  pickFiles: async () => (await pick(true)).map(register),
  pickFile: async () => { const f = (await pick(false))[0]; return f ? register(f) : null; },
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
