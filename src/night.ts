// Nacht-Hintergrund (ab 0.7.0): bei Nacht (echte Uhrzeit) liegt statt des Wassers das Mond-Bild hinter Menü und Seiten.
export type NightMode = "auto" | "an" | "aus";
/** Automatisch: von 21 bis 6 Uhr. „an“ = immer Nacht, „aus“ = nie. */
export function isNightNow(mode: NightMode, d: Date = new Date()): boolean {
  if (mode === "an") return true;
  if (mode === "aus") return false;
  const h = d.getHours();
  return h >= 21 || h < 6;
}
