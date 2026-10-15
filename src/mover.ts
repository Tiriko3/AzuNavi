// Verschieben mit Verlauf, Pfad-Nachführung und Dazulernen – von Assistent, "Hier einfügen" und Drag & Drop genutzt
import { baseName, extOf, fsapi, parentDir } from "./fsapi";
import { logMove, markUndone, repath, scopeOfPath, setFileProject, setFolderProject, trackFile, type MoveRow, type Roots } from "./db/filesRepo";

export type MoveOutcome =
  | { ok: true; to: string; mode: "moved" | "copied" }
  | { ok: false; conflict: true; freeName: string }
  | { ok: false; conflict?: false; error: string };

export async function moveItem(opts: {
  src: string; destDir: string; roots: Roots; via: "assistent" | "hier" | "drop";
  projectId?: number | null; newName?: string | null;
}): Promise<MoveOutcome> {
  const fs = await fsapi();
  const isDir = await fs.isDir(opts.src);
  const name = opts.newName || baseName(opts.src);
  try {
    const r = await fs.move(opts.src, opts.destDir, opts.newName ?? null);
    const scope = scopeOfPath(opts.roots, opts.destDir);
    await logMove({
      kind: isDir ? "folder" : "file", name, ext: isDir ? null : extOf(name), from_path: opts.src, to_path: r.to,
      scope, dest_folder: opts.destDir, project_id: opts.projectId ?? null, mode: r.mode, via: opts.via,
    });
    if (r.mode === "moved") await repath(opts.src, r.to);
    if (isDir) {
      if (opts.projectId) await setFolderProject(r.to, opts.projectId);
    } else if (opts.projectId !== undefined && opts.projectId !== null) {
      await setFileProject(r.to, name, scope, opts.projectId);
    } else {
      await trackFile(r.to, name, scope);
    }
    return { ok: true, to: r.to, mode: r.mode };
  } catch (e) {
    const msg = String(e);
    if (msg.includes("ZIEL_EXISTIERT")) {
      return { ok: false, conflict: true, freeName: await fs.uniqueName(opts.destDir, name) };
    }
    if (msg.includes("QUELLE_FEHLT")) return { ok: false, error: "Die Datei liegt nicht mehr dort: " + opts.src };
    return { ok: false, error: msg.replace(/^Error:\s*/, "") };
  }
}

export type UndoOutcome = { ok: true } | { ok: false; conflict: true; freeName: string } | { ok: false; conflict?: false; error: string };

/** Verschiebung rückgängig machen: zurück an den alten Ort (mit Nachfrage, falls dort inzwischen etwas liegt) */
export async function undoMove(m: MoveRow, newName?: string): Promise<UndoOutcome> {
  if (m.mode === "copied") return { ok: false, error: "Das war eine Kopie, das Original liegt noch an der alten Stelle." };
  const fs = await fsapi();
  const dir = parentDir(m.from_path);
  const name = newName || baseName(m.from_path);
  try {
    const r = await fs.move(m.to_path, dir, name);
    await markUndone(m.id);
    await repath(m.to_path, r.to);
    return { ok: true };
  } catch (e) {
    const msg = String(e);
    if (msg.includes("ZIEL_EXISTIERT")) return { ok: false, conflict: true, freeName: await fs.uniqueName(dir, name) };
    if (msg.includes("QUELLE_FEHLT")) return { ok: false, error: "Die Datei liegt nicht mehr am neuen Ort, sie wurde inzwischen woanders hin verschoben." };
    return { ok: false, error: msg.replace(/^Error:\s*/, "") };
  }
}
