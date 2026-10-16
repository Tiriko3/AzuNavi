// Alle Datenbank-Abfragen für Notizen, Projekte, Qualifikationen und Kontakte.
// Verknüpfungen (Notiz <-> Projekt/Qualifikation/Person) laufen über die gemeinsame Tabelle "links".
import { execute, select } from "./db";

export type Scope = "schule" | "arbeit";

export interface Project { id: number; name: string; scope: Scope }
export interface Qualification { id: number; name: string; kind: "betrieb" | "schule" | "sonst" | "eigene"; sort: number }
export interface Attachment { id?: number; original_name: string; stored_path: string }
export interface Person {
  id: number; name: string; role: string | null; scope: Scope; parent_id: number | null;
  phone: string | null; email: string | null; info: string | null; portrait_path: string | null;
}
export interface Note {
  id: number; date: string; scope: Scope; text: string;
  projectId: number | null; qualIds: number[]; personIds: number[]; attachments: Attachment[];
}
export interface NoteInput {
  id?: number; date: string; scope: Scope; text: string;
  projectId: number | null; qualIds: number[]; personIds: number[]; attachments: Attachment[];
}

/* ---------- Verknüpfungen ---------- */
async function setLinks(aType: string, aId: number, bType: string, bIds: number[]) {
  await execute("DELETE FROM links WHERE a_type = $1 AND a_id = $2 AND b_type = $3", [aType, aId, bType]);
  for (const b of Array.from(new Set(bIds))) {
    await execute(
      "INSERT OR IGNORE INTO links (a_type, a_id, b_type, b_id) VALUES ($1, $2, $3, $4)",
      [aType, aId, bType, b]
    );
  }
}

/* ---------- Projekte ---------- */
export const listProjects = () =>
  select<Project>("SELECT id, name, scope FROM projects ORDER BY name COLLATE NOCASE");

export async function createProject(name: string, scope: Scope): Promise<number> {
  const r = await execute("INSERT INTO projects (name, scope) VALUES ($1, $2)", [name.trim(), scope]);
  return r.lastInsertId;
}

/* ---------- Qualifikationen ---------- */
export const listQualifications = () =>
  select<Qualification>("SELECT id, name, kind, sort FROM qualifications ORDER BY sort, name");

export async function createQualification(name: string): Promise<number> {
  const max = await select<{ m: number | null }>("SELECT MAX(sort) AS m FROM qualifications");
  const r = await execute(
    "INSERT OR IGNORE INTO qualifications (name, kind, sort) VALUES ($1, 'eigene', $2)",
    [name.trim(), (max[0]?.m ?? 0) + 1]
  );
  if (r.lastInsertId && r.rowsAffected > 0) return r.lastInsertId;
  const ex = await select<{ id: number }>("SELECT id FROM qualifications WHERE name = $1", [name.trim()]);
  return ex[0].id;
}

/* ---------- Notizen ---------- */
export async function listNotes(): Promise<Note[]> {
  const rows = await select<{ id: number; date: string; scope: Scope; text: string }>(
    "SELECT id, date, scope, text FROM notes ORDER BY date DESC, id DESC"
  );
  const links = await select<{ a_id: number; b_type: string; b_id: number }>(
    "SELECT a_id, b_type, b_id FROM links WHERE a_type = 'note'"
  );
  const atts = await select<Attachment & { note_id: number }>(
    "SELECT id, note_id, original_name, stored_path FROM attachments ORDER BY id"
  );
  return rows.map((n) => ({
    ...n,
    projectId: links.find((l) => l.a_id === n.id && l.b_type === "project")?.b_id ?? null,
    qualIds: links.filter((l) => l.a_id === n.id && l.b_type === "qualification").map((l) => l.b_id),
    personIds: links.filter((l) => l.a_id === n.id && l.b_type === "person").map((l) => l.b_id),
    attachments: atts.filter((a) => a.note_id === n.id).map((a) => ({
      id: a.id, original_name: a.original_name, stored_path: a.stored_path,
    })),
  }));
}

export async function saveNote(input: NoteInput): Promise<number> {
  let id = input.id;
  if (id) {
    await execute(
      "UPDATE notes SET date = $1, scope = $2, text = $3, updated_at = datetime('now') WHERE id = $4",
      [input.date, input.scope, input.text.trim(), id]
    );
  } else {
    const r = await execute("INSERT INTO notes (date, scope, text) VALUES ($1, $2, $3)", [
      input.date, input.scope, input.text.trim(),
    ]);
    id = r.lastInsertId;
  }
  await setLinks("note", id, "project", input.projectId ? [input.projectId] : []);
  await setLinks("note", id, "qualification", input.qualIds);
  await setLinks("note", id, "person", input.personIds);

  // Anhänge abgleichen: entfernte Einträge aus der Datenbank nehmen (Dateikopie bleibt liegen),
  // neue (ohne id) eintragen
  const existing = await select<{ id: number }>("SELECT id FROM attachments WHERE note_id = $1", [id]);
  const keep = new Set(input.attachments.filter((a) => a.id).map((a) => a.id!));
  for (const e of existing) {
    if (!keep.has(e.id)) await execute("DELETE FROM attachments WHERE id = $1", [e.id]);
  }
  for (const a of input.attachments.filter((a) => !a.id)) {
    await execute(
      "INSERT INTO attachments (note_id, original_name, stored_path) VALUES ($1, $2, $3)",
      [id, a.original_name, a.stored_path]
    );
  }
  return id;
}

export async function deleteNote(id: number): Promise<void> {
  await execute("DELETE FROM links WHERE (a_type = 'note' AND a_id = $1) OR (b_type = 'note' AND b_id = $1)", [id]);
  await execute("DELETE FROM attachments WHERE note_id = $1", [id]);
  await execute("DELETE FROM notes WHERE id = $1", [id]);
}

/* ---------- Kontakte ---------- */
export const listPersons = () =>
  select<Person>(
    "SELECT id, name, role, scope, parent_id, phone, email, info, portrait_path FROM persons ORDER BY name COLLATE NOCASE"
  );

export interface PersonInput {
  id?: number; name: string; role: string; scope: Scope; parent_id: number | null;
  phone: string; email: string; info: string; portrait_path: string | null;
  /** mehrere Übergeordnete und Untergeordnete (Netzplan) */
  parentIds?: number[]; childIds?: number[];
}

/* ---------- Beziehungen zwischen Personen (mehrfach möglich) ---------- */
export interface PersonLink { id: number; a_id: number; b_id: number; label: string | null }
export const listPersonLinks = () =>
  select<PersonLink>("SELECT id, a_id, b_id, label FROM person_links ORDER BY id");

export async function setPersonLinks(personId: number, parentIds: number[], childIds: number[]) {
  await execute("DELETE FROM person_links WHERE b_id = $1", [personId]);
  await execute("DELETE FROM person_links WHERE a_id = $1", [personId]);
  for (const a of new Set(parentIds.filter((x) => x && x !== personId)))
    await execute("INSERT OR IGNORE INTO person_links (a_id, b_id) VALUES ($1, $2)", [a, personId]);
  for (const b of new Set(childIds.filter((x) => x && x !== personId)))
    await execute("INSERT OR IGNORE INTO person_links (a_id, b_id) VALUES ($1, $2)", [personId, b]);
}
/** Eine einzelne Verbindung setzen oder lösen (Netzplan: „Linie ziehen“) */
export async function togglePersonLink(aId: number, bId: number): Promise<boolean> {
  if (aId === bId) return false;
  const ex = await select<{ id: number }>(
    "SELECT id FROM person_links WHERE (a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1)", [aId, bId]);
  if (ex[0]) { await execute("DELETE FROM person_links WHERE id = $1", [ex[0].id]); return false; }
  await execute("INSERT OR IGNORE INTO person_links (a_id, b_id) VALUES ($1, $2)", [aId, bId]);
  return true;
}

/* ---------- Plätze im Netzplan ---------- */
export async function listPersonPos(): Promise<Map<number, { x: number; y: number }>> {
  const r = await select<{ person_id: number; x: number; y: number }>("SELECT person_id, x, y FROM person_pos");
  return new Map(r.map((p) => [p.person_id, { x: Number(p.x), y: Number(p.y) }]));
}
export async function savePersonPos(list: { id: number; x: number; y: number }[]) {
  for (const p of list)
    await execute(
      `INSERT INTO person_pos (person_id, x, y) VALUES ($1, $2, $3)
       ON CONFLICT(person_id) DO UPDATE SET x = excluded.x, y = excluded.y`,
      [p.id, Math.round(p.x), Math.round(p.y)]);
}
export const clearPersonPos = () => execute("DELETE FROM person_pos");

export async function savePerson(p: PersonInput): Promise<number> {
  const vals = [p.name.trim(), p.role.trim() || null, p.scope, p.parent_id, p.phone.trim() || null,
    p.email.trim() || null, p.info.trim() || null, p.portrait_path];
  if (p.id) {
    await execute(
      `UPDATE persons SET name = $1, role = $2, scope = $3, parent_id = $4, phone = $5,
         email = $6, info = $7, portrait_path = $8 WHERE id = $9`,
      [...vals, p.id]
    );
    if (p.parentIds || p.childIds) await setPersonLinks(p.id, p.parentIds ?? [], p.childIds ?? []);
    return p.id;
  }
  const r = await execute(
    `INSERT INTO persons (name, role, scope, parent_id, phone, email, info, portrait_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    vals
  );
  if (p.parentIds || p.childIds) await setPersonLinks(r.lastInsertId, p.parentIds ?? [], p.childIds ?? []);
  return r.lastInsertId;
}

export async function deletePerson(id: number): Promise<void> {
  await execute("UPDATE persons SET parent_id = NULL WHERE parent_id = $1", [id]);
  await execute("DELETE FROM person_links WHERE a_id = $1 OR b_id = $1", [id]);
  await execute("DELETE FROM person_pos WHERE person_id = $1", [id]);
  await execute("DELETE FROM links WHERE (a_type = 'person' AND a_id = $1) OR (b_type = 'person' AND b_id = $1)", [id]);
  await execute("DELETE FROM persons WHERE id = $1", [id]);
}

/** Qualifikationsliste ersetzen (z. B. anderer Ausbildungsberuf). Belegte Qualifikationen bleiben erhalten. */
export async function replaceQualifications(names: string[]): Promise<number> {
  const clean = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const used = await select<{ id: number }>("SELECT DISTINCT b_id AS id FROM links WHERE a_type = 'note' AND b_type = 'qualification'");
  const usedIds = new Set(used.map((u) => u.id));
  const cur = await listQualifications();
  for (const q of cur) if (!usedIds.has(q.id) && !clean.includes(q.name)) await execute("DELETE FROM qualifications WHERE id = $1", [q.id]);
  let sort = 1;
  for (const n of clean) {
    const ex = await select<{ id: number }>("SELECT id FROM qualifications WHERE name = $1", [n]);
    if (ex[0]) await execute("UPDATE qualifications SET sort = $1 WHERE id = $2", [sort, ex[0].id]);
    else await execute("INSERT INTO qualifications (name, kind, sort) VALUES ($1, 'betrieb', $2)", [n, sort]);
    sort++;
  }
  return clean.length;
}
