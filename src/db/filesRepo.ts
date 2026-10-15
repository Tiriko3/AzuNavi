// Datenbank-Teil von Etappe 4: Wurzelordner, bekannte Dateien, Ordner-Projekte, Verlauf, Vorschläge
import { execute, getSetting, select, setSetting } from "./db";
import type { Scope } from "./repo";
import { extOf, isInside, samePath } from "../fsapi";

export interface Roots { arbeit: string | null; schule: string | null }
export interface TrackedFile { id: number; path: string; name: string; scope: Scope | null; projectId: number | null }
export interface MoveRow {
  id: number; kind: "file" | "folder"; name: string; ext: string | null; from_path: string; to_path: string;
  scope: Scope | null; dest_folder: string; project_id: number | null; mode: "moved" | "copied";
  via: string; moved_at: string; undone_at: string | null;
}

export async function getRoots(): Promise<Roots> {
  return { arbeit: await getSetting("root_arbeit"), schule: await getSetting("root_schule") };
}
export async function setRoot(scope: Scope, path: string) {
  await setSetting("root_" + scope, path);
}
export function scopeOfPath(roots: Roots, p: string): Scope | null {
  if (roots.arbeit && isInside(p, roots.arbeit)) return "arbeit";
  if (roots.schule && isInside(p, roots.schule)) return "schule";
  return null;
}

/* ---------- bekannte Dateien ---------- */
export async function listTracked(): Promise<TrackedFile[]> {
  const rows = await select<{ id: number; path: string; name: string; scope: Scope | null }>(
    "SELECT id, path, name, scope FROM files ORDER BY name COLLATE NOCASE"
  );
  const links = await select<{ a_id: number; b_id: number }>(
    "SELECT a_id, b_id FROM links WHERE a_type = 'file' AND b_type = 'project'"
  );
  return rows.map((r) => ({ ...r, projectId: links.find((l) => l.a_id === r.id)?.b_id ?? null }));
}

export async function trackFile(path: string, name: string, scope: Scope | null): Promise<number> {
  const ex = await select<{ id: number }>("SELECT id FROM files WHERE path = $1", [path]);
  if (ex[0]) {
    await execute("UPDATE files SET name = $1, scope = $2 WHERE id = $3", [name, scope, ex[0].id]);
    return ex[0].id;
  }
  const r = await execute("INSERT INTO files (path, name, scope) VALUES ($1, $2, $3)", [path, name, scope]);
  return r.lastInsertId;
}

/** Nach einer Verschiebung: bekannte Pfade nachziehen (auch alles in einem verschobenen Ordner) */
export async function repath(from: string, to: string) {
  for (const table of ["files", "folders"]) {
    const rows = await select<{ id: number; path: string }>(`SELECT id, path FROM ${table}`);
    for (const r of rows) {
      if (isInside(r.path, from)) {
        const np = to + r.path.slice(from.length);
        await execute(`UPDATE ${table} SET path = $1 WHERE id = $2`, [np, r.id]);
        if (table === "files") await execute("UPDATE files SET name = $1 WHERE id = $2", [np.split(/[\\/]/).pop(), r.id]);
      }
    }
  }
}

export async function setFilePath(id: number, path: string) {
  await execute("UPDATE files SET path = $1, name = $2 WHERE id = $3", [path, path.split(/[\\/]/).pop(), id]);
}
/** Nur den Eintrag in der App entfernen (die Datei selbst wird nie gelöscht) */
export async function untrackFile(id: number) {
  await execute("DELETE FROM links WHERE (a_type = 'file' AND a_id = $1) OR (b_type = 'file' AND b_id = $1)", [id]);
  await execute("DELETE FROM files WHERE id = $1", [id]);
}

async function setSingleLink(aType: string, aId: number, projectId: number | null) {
  await execute("DELETE FROM links WHERE a_type = $1 AND a_id = $2 AND b_type = 'project'", [aType, aId]);
  if (projectId)
    await execute("INSERT OR IGNORE INTO links (a_type, a_id, b_type, b_id) VALUES ($1, $2, 'project', $3)", [aType, aId, projectId]);
}
export async function setFileProject(path: string, name: string, scope: Scope | null, projectId: number | null) {
  const id = await trackFile(path, name, scope);
  await setSingleLink("file", id, projectId);
}

/* ---------- Ordner <-> Projekt ---------- */
export async function listFolderProjects(): Promise<{ path: string; projectId: number }[]> {
  return select<{ path: string; projectId: number }>(
    `SELECT f.path AS path, l.b_id AS projectId FROM folders f
     JOIN links l ON l.a_type = 'folder' AND l.a_id = f.id AND l.b_type = 'project'`
  );
}
export async function setFolderProject(path: string, projectId: number | null) {
  let rows = await select<{ id: number }>("SELECT id FROM folders WHERE path = $1", [path]);
  if (!rows[0]) {
    if (!projectId) return;
    await execute("INSERT INTO folders (path) VALUES ($1)", [path]);
    rows = await select<{ id: number }>("SELECT id FROM folders WHERE path = $1", [path]);
  }
  await setSingleLink("folder", rows[0].id, projectId);
}
/** Projekt eines Ordners, auch geerbt vom nächsthöheren verknüpften Ordner */
export function folderProject(path: string, links: { path: string; projectId: number }[]) {
  let best: { path: string; projectId: number } | null = null;
  for (const l of links) if (isInside(path, l.path) && (!best || l.path.length > best.path.length)) best = l;
  return best ? { projectId: best.projectId, inherited: !samePath(best.path, path), from: best.path } : null;
}

/* ---------- Verlauf ---------- */
export async function logMove(m: Omit<MoveRow, "id" | "moved_at" | "undone_at">) {
  await execute(
    `INSERT INTO file_moves (kind, name, ext, from_path, to_path, scope, dest_folder, project_id, mode, via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [m.kind, m.name, m.ext, m.from_path, m.to_path, m.scope, m.dest_folder, m.project_id, m.mode, m.via]
  );
}
export const listMoves = (limit = 40) =>
  select<MoveRow>("SELECT * FROM file_moves ORDER BY id DESC LIMIT $1", [limit]);
export async function markUndone(id: number) {
  await execute("UPDATE file_moves SET undone_at = datetime('now') WHERE id = $1", [id]);
}

/* ---------- Vorschläge (lernt aus deinen bisherigen Entscheidungen) ---------- */
const tokens = (name: string) =>
  name.toLowerCase().replace(/\.[^.]+$/, "").split(/[^a-z0-9äöüß]+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t));

export interface Suggestion { scope: Scope | null; folders: string[]; projectId: number | null }

export async function suggestFor(fileName: string): Promise<Suggestion> {
  const moves = (await select<MoveRow>(
    "SELECT * FROM file_moves WHERE undone_at IS NULL AND kind = 'file' ORDER BY id DESC LIMIT 400"
  ));
  const ext = extOf(fileName);
  const tk = tokens(fileName);
  const folderScore = new Map<string, number>();
  const scopeScore = { arbeit: 0, schule: 0 } as Record<Scope, number>;
  const projScore = new Map<number, number>();
  moves.forEach((m, i) => {
    const recency = 1 + Math.max(0, 1 - i / 60); // neuere Entscheidungen zählen etwas mehr
    let s = 0;
    if (ext && m.ext === ext) s += 2;
    const mt = tokens(m.name);
    s += tk.filter((t) => mt.includes(t)).length * 3;
    if (s === 0) return;
    s *= recency;
    folderScore.set(m.dest_folder, (folderScore.get(m.dest_folder) ?? 0) + s);
    if (m.scope) scopeScore[m.scope] += s;
    if (m.project_id) projScore.set(m.project_id, (projScore.get(m.project_id) ?? 0) + s);
  });
  const folders = [...folderScore.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const scope: Scope | null =
    scopeScore.arbeit === 0 && scopeScore.schule === 0 ? null : scopeScore.arbeit >= scopeScore.schule ? "arbeit" : "schule";
  const proj = [...projScore.entries()].sort((a, b) => b[1] - a[1])[0];
  return { scope, folders, projectId: proj && proj[1] >= 3 ? proj[0] : null };
}
