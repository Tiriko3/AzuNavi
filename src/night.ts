// Nacht-Hintergrund (ab 0.7.0): bei Nacht (echte Uhrzeit) liegt statt des Wassers das Mond-Bild hinter Menü und Seiten.
// Ab 0.8.1 wählt man selbst, von wann bis wann „Nacht“ ist (System → Nacht-Hintergrund). Wer will, stellt 00:00 bis 23:59 ein und hat den Mond immer.
export type NightMode = "auto" | "an" | "aus";
export const NIGHT_FROM = "21:00", NIGHT_TO = "06:00";
const toMin = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null; };
export const validTime = (v: string | null | undefined, fallback: string) => (v && toMin(v) !== null ? v : fallback);
/** Automatisch: von `from` bis `to` (geht über Mitternacht, wenn `to` früher ist). Gleiche Zeiten = nie. „an“ = immer Nacht, „aus“ = nie. */
export function isNightNow(mode: NightMode, d: Date = new Date(), from: string = NIGHT_FROM, to: string = NIGHT_TO): boolean {
  if (mode === "an") return true;
  if (mode === "aus") return false;
  const now = d.getHours() * 60 + d.getMinutes(), a = toMin(from) ?? toMin(NIGHT_FROM)!, b = toMin(to) ?? toMin(NIGHT_TO)!;
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}
