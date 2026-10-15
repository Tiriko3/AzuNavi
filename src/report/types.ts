// Datenmodell des Berichtshefts (Etappe 8)
export const PLACES = ["Betrieb", "Schule", "Schule/Betrieb", "Urlaub", "Feiertag", "Krank", "Sonstige Abwesenheit"] as const;
export const ABSENT_PLACES = ["Urlaub", "Feiertag", "Krank", "Sonstige Abwesenheit"];
export type Presence = "anwesend" | "abwesend";

export interface ReportEntry { text: string; quals: string[]; noteId?: number }
export interface ReportDay { date: string; presence: Presence; place: string; entries: ReportEntry[] }
export interface WeekDraft { year: number; week: number; days: ReportDay[] }
export interface ReportMeta { name: string; beruf: string; betrieb: string; ausbilder: string }

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function parseDate(iso: string): Date { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const monthName = (iso: string) => MONTHS[parseDate(iso).getMonth()];
export const weekdayName = (iso: string) => WEEKDAYS[parseDate(iso).getDay()];

/** Montag der ISO-Kalenderwoche */
export function mondayOf(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  return mon;
}
/** ISO-Jahr und -Woche eines Datums */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7) };
}
export function weekDates(year: number, week: number): string[] {
  const mon = mondayOf(year, week);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return isoDate(d); });
}
export const shortDate = (iso: string) => { const d = parseDate(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`; };
