// Datenbank-Teil der Mindmap (Etappe 7)
import { execute, select } from "./db";

export interface FreeNode { id: number; label: string; color: string }
export interface FreeEdge { id: number; a: string; b: string }

export const listFreeNodes = (pid: number) =>
  select<FreeNode>("SELECT id, label, color FROM mindmap_nodes WHERE project_id = $1 ORDER BY id", [pid]);
export const listFreeEdges = (pid: number) =>
  select<FreeEdge>("SELECT id, a, b FROM mindmap_edges WHERE project_id = $1", [pid]);
export async function listPositions(pid: number): Promise<Map<string, { x: number; y: number }>> {
  const rows = await select<{ node_key: string; x: number; y: number }>("SELECT node_key, x, y FROM mindmap_pos WHERE project_id = $1", [pid]);
  return new Map(rows.map((r) => [r.node_key, { x: Number(r.x), y: Number(r.y) }]));
}

export async function addFreeNode(pid: number, label: string, color = "teal"): Promise<number> {
  const r = await execute("INSERT INTO mindmap_nodes (project_id, label, color) VALUES ($1, $2, $3)", [pid, label, color]);
  return r.lastInsertId;
}
export async function updateFreeNode(id: number, label: string, color: string) {
  await execute("UPDATE mindmap_nodes SET label = $1, color = $2 WHERE id = $3", [label.trim() || "Gedanke", color, id]);
}
export async function deleteFreeNode(pid: number, id: number) {
  const key = "free:" + id;
  await execute("DELETE FROM mindmap_edges WHERE project_id = $1 AND (a = $2 OR b = $2)", [pid, key]);
  await execute("DELETE FROM mindmap_pos WHERE project_id = $1 AND node_key = $2", [pid, key]);
  await execute("DELETE FROM mindmap_nodes WHERE id = $1", [id]);
}

const order = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
/** Eigene Linie setzen oder (wenn schon da) wieder lösen. Gibt true zurück, wenn sie jetzt existiert. */
export async function toggleFreeEdge(pid: number, a: string, b: string): Promise<boolean> {
  const [x, y] = order(a, b);
  const ex = await select<{ id: number }>("SELECT id FROM mindmap_edges WHERE project_id = $1 AND a = $2 AND b = $3", [pid, x, y]);
  if (ex[0]) { await execute("DELETE FROM mindmap_edges WHERE id = $1", [ex[0].id]); return false; }
  await execute("INSERT OR IGNORE INTO mindmap_edges (project_id, a, b) VALUES ($1, $2, $3)", [pid, x, y]);
  return true;
}

export async function savePositions(pid: number, pos: { key: string; x: number; y: number }[]) {
  for (const p of pos)
    await execute(
      `INSERT INTO mindmap_pos (project_id, node_key, x, y) VALUES ($1, $2, $3, $4)
       ON CONFLICT(project_id, node_key) DO UPDATE SET x = excluded.x, y = excluded.y`,
      [pid, p.key, Math.round(p.x), Math.round(p.y)]
    );
}
export async function clearPositions(pid: number) {
  await execute("DELETE FROM mindmap_pos WHERE project_id = $1", [pid]);
}
