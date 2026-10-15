// Datenbank-Teil des Berichtshefts (Etappe 8)
import { execute, getSetting, select, setSetting } from "./db";
import type { Note, Qualification } from "./repo";
import { ABSENT_PLACES, weekDates, type ReportDay, type ReportMeta, type WeekDraft } from "../report/types";

export interface StoredWeek { draft: WeekDraft; exported_at: string | null; export_path: string | null; updated_at: string }

export async function getWeek(year: number, week: number): Promise<StoredWeek | null> {
  const r = await select<{ data: string; exported_at: string | null; export_path: string | null; updated_at: string }>(
    "SELECT data, exported_at, export_path, updated_at FROM report_weeks WHERE year = $1 AND week = $2", [year, week]
  );
  if (!r[0]) return null;
  try { return { draft: JSON.parse(r[0].data), exported_at: r[0].exported_at, export_path: r[0].export_path, updated_at: r[0].updated_at }; }
  catch { return null; }
}
export async function saveWeek(d: WeekDraft) {
  await execute(
    `INSERT INTO report_weeks (year, week, data, updated_at) VALUES ($1, $2, $3, datetime('now'))
     ON CONFLICT(year, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [d.year, d.week, JSON.stringify(d)]
  );
}
export async function deleteWeek(year: number, week: number) {
  await execute("DELETE FROM report_weeks WHERE year = $1 AND week = $2", [year, week]);
}
export async function markExported(year: number, week: number, path: string) {
  await execute("UPDATE report_weeks SET exported_at = datetime('now'), export_path = $1 WHERE year = $2 AND week = $3", [path, year, week]);
}

/* ---------- Angaben für die Kopfzeile ---------- */
const KEYS: (keyof ReportMeta)[] = ["name", "beruf", "betrieb", "ausbilder"];
export async function getMeta(defaults: Partial<ReportMeta>): Promise<ReportMeta> {
  const m: ReportMeta = { name: "", beruf: "", betrieb: "", ausbilder: "" };
  for (const k of KEYS) m[k] = (await getSetting("bh_" + k)) ?? defaults[k] ?? "";
  return m;
}
export async function setMeta(m: ReportMeta) {
  for (const k of KEYS) await setSetting("bh_" + k, m[k]);
}

/* ---------- Entwurf aus den Notizen einer Woche ---------- */
export function draftFromNotes(year: number, week: number, notes: Note[], quals: Qualification[]): WeekDraft {
  const dates = weekDates(year, week);
  const qn = new Map(quals.map((q) => [q.id, q.name]));
  const days: ReportDay[] = [];
  dates.forEach((date, i) => {
    const dayNotes = notes.filter((n) => n.date === date).sort((a, b) => a.id - b.id);
    if (i >= 5 && dayNotes.length === 0) return; // Wochenende nur, wenn es dort Notizen gibt
    const scopes = new Set(dayNotes.map((n) => n.scope));
    const place = scopes.has("arbeit") && scopes.has("schule") ? "Schule/Betrieb" : scopes.has("schule") ? "Schule" : "Betrieb";
    days.push({
      date, presence: "anwesend", place,
      entries: dayNotes.map((n) => ({ text: n.text.trim(), quals: n.qualIds.map((q) => qn.get(q)).filter((x): x is string => !!x), noteId: n.id })),
    });
  });
  return { year, week, days };
}
export const isAbsent = (place: string) => ABSENT_PLACES.includes(place);
