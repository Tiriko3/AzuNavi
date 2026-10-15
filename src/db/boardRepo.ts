// Datenbank-Teil der Pinnwand (Etappe 5)
import { execute, select } from "./db";
import type { Scope } from "./repo";

export type Status = "idee" | "aktiv" | "pausiert" | "fertig";
export interface BoardProject {
  id: number; name: string; scope: Scope; description: string | null; status: Status;
  progress: number; board_x: number | null; board_y: number | null;
  notes: number; files: number; folders: number;
  personIds: number[];          // Personen aus den Notizen dieses Projekts
  leadId: number | null;        // zuständige Person
  memberIds: number[];          // Mitarbeitende
}

export async function listBoard(): Promise<BoardProject[]> {
  const rows = await select<Omit<BoardProject, "notes" | "files" | "folders" | "personIds" | "leadId" | "memberIds">>(
    "SELECT id, name, scope, description, status, progress, board_x, board_y FROM projects ORDER BY id"
  );
  const counts = await select<{ pid: number; t: string; c: number }>(
    `SELECT b_id AS pid, a_type AS t, COUNT(*) AS c FROM links
     WHERE b_type = 'project' AND a_type IN ('note', 'file', 'folder') GROUP BY b_id, a_type`
  );
  const people = await select<{ pid: number; person: number }>(
    `SELECT DISTINCT l1.b_id AS pid, l2.b_id AS person FROM links l1
     JOIN links l2 ON l2.a_type = 'note' AND l2.a_id = l1.a_id AND l2.b_type = 'person'
     WHERE l1.a_type = 'note' AND l1.b_type = 'project'`
  );
  const team = await select<{ pid: number; person: number; role: string | null }>(
    "SELECT a_id AS pid, b_id AS person, role FROM links WHERE a_type = 'project' AND b_type = 'person'"
  );
  const c = (pid: number, t: string) => counts.find((x) => x.pid === pid && x.t === t)?.c ?? 0;
  return rows.map((r) => ({
    ...r,
    progress: Number(r.progress) || 0,
    status: (r.status || "aktiv") as Status,
    notes: c(r.id, "note"), files: c(r.id, "file"), folders: c(r.id, "folder"),
    personIds: people.filter((p) => p.pid === r.id).map((p) => p.person),
    leadId: team.find((t) => t.pid === r.id && t.role === "zustaendig")?.person ?? null,
    memberIds: team.filter((t) => t.pid === r.id && t.role !== "zustaendig").map((t) => t.person),
  }));
}

/** Fäden zwischen Projekten (gemeinsame Verknüpfungstabelle, immer kleinere id zuerst) */
export async function listThreads(): Promise<[number, number][]> {
  const rows = await select<{ a: number; b: number }>(
    "SELECT a_id AS a, b_id AS b FROM links WHERE a_type = 'project' AND b_type = 'project'"
  );
  return rows.map((r) => [r.a, r.b]);
}
export async function connect(a: number, b: number) {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  await execute("INSERT OR IGNORE INTO links (a_type, a_id, b_type, b_id) VALUES ('project', $1, 'project', $2)", [x, y]);
}
export async function disconnect(a: number, b: number) {
  const [x, y] = a < b ? [a, b] : [b, a];
  await execute("DELETE FROM links WHERE a_type = 'project' AND a_id = $1 AND b_type = 'project' AND b_id = $2", [x, y]);
}

export async function setPos(id: number, x: number, y: number) {
  await execute("UPDATE projects SET board_x = $1, board_y = $2 WHERE id = $3", [Math.round(x), Math.round(y), id]);
}

export interface ProjectInput { name: string; scope: Scope; description: string; status: Status; progress: number }
export async function createBoardProject(p: ProjectInput, x: number, y: number): Promise<number> {
  const r = await execute(
    `INSERT INTO projects (name, scope, description, status, progress, board_x, board_y, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
    [p.name.trim(), p.scope, p.description.trim() || null, p.status, p.progress, Math.round(x), Math.round(y)]
  );
  return r.lastInsertId;
}
export async function updateProject(id: number, p: ProjectInput) {
  await execute(
    `UPDATE projects SET name = $1, scope = $2, description = $3, status = $4, progress = $5, updated_at = datetime('now')
     WHERE id = $6`,
    [p.name.trim(), p.scope, p.description.trim() || null, p.status, Math.max(0, Math.min(100, Math.round(p.progress))), id]
  );
}
/** Projekt entfernen: Notizen, Dateien und Ordner bleiben, nur die Verknüpfungen fallen weg */
export async function deleteProject(id: number) {
  await execute("DELETE FROM project_tasks WHERE project_id = $1", [id]);
  for (const t of ["mindmap_nodes", "mindmap_edges", "mindmap_pos"]) await execute(`DELETE FROM ${t} WHERE project_id = $1`, [id]);
  await execute("DELETE FROM links WHERE (a_type = 'project' AND a_id = $1) OR (b_type = 'project' AND b_id = $1)", [id]);
  await execute("DELETE FROM projects WHERE id = $1", [id]);
}

/** Zuständige Person und Mitarbeitende eines Projekts setzen (über die gemeinsame Verknüpfungstabelle, mit Rolle) */
export async function setProjectPeople(projectId: number, leadId: number | null, memberIds: number[]) {
  await execute("DELETE FROM links WHERE a_type = 'project' AND a_id = $1 AND b_type = 'person'", [projectId]);
  if (leadId)
    await execute("INSERT OR IGNORE INTO links (a_type, a_id, b_type, b_id, role) VALUES ('project', $1, 'person', $2, 'zustaendig')", [projectId, leadId]);
  for (const m of Array.from(new Set(memberIds))) {
    if (m === leadId) continue;
    await execute("INSERT OR IGNORE INTO links (a_type, a_id, b_type, b_id, role) VALUES ('project', $1, 'person', $2, 'mitarbeit')", [projectId, m]);
  }
}

/* ---------- Aufgaben (Was als Nächstes) ---------- */
export interface Task { id: number; project_id: number; text: string; done: number; sort: number; note_id: number | null }

export const listTasks = (projectId: number) =>
  select<Task>("SELECT id, project_id, text, done, sort, note_id FROM project_tasks WHERE project_id = $1 ORDER BY done, sort, id", [projectId]);

export async function addTask(projectId: number, text: string) {
  const m = await select<{ m: number | null }>("SELECT MAX(sort) AS m FROM project_tasks WHERE project_id = $1", [projectId]);
  await execute("INSERT INTO project_tasks (project_id, text, sort) VALUES ($1, $2, $3)", [projectId, text.trim(), (m[0]?.m ?? 0) + 1]);
}
export async function setTaskDone(id: number, done: boolean) {
  await execute(
    done ? "UPDATE project_tasks SET done = 1, done_at = datetime('now') WHERE id = $1" : "UPDATE project_tasks SET done = 0, done_at = NULL WHERE id = $1",
    [id]
  );
}
export async function deleteTask(id: number) {
  await execute("DELETE FROM project_tasks WHERE id = $1", [id]);
}
export async function setTaskNote(id: number, noteId: number) {
  await execute("UPDATE project_tasks SET note_id = $1 WHERE id = $2", [noteId, id]);
}
/** Aufgabe in der Reihenfolge nach oben (-1) oder unten (+1) schieben */
export async function moveTask(projectId: number, id: number, dir: -1 | 1) {
  const open = (await listTasks(projectId)).filter((t) => !t.done);
  const i = open.findIndex((t) => t.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= open.length) return;
  [open[i], open[j]] = [open[j], open[i]];
  for (let k = 0; k < open.length; k++) await execute("UPDATE project_tasks SET sort = $1 WHERE id = $2", [k + 1, open[k].id]);
}
