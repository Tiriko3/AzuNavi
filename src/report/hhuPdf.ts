// Export ins PDF-Formular „Ausbildungsnachweis (Wochenbericht)“ des öffentlichen Dienstes (HHU): die Formularfelder werden ausgefüllt.
// Das PDF bleibt ein Formular: Du kannst danach in Acrobat/Edge/Firefox weiter hineinschreiben und unterschreiben.
// Bewusst ohne Tauri/Vite-Importe, damit das auch in einem Node-Test läuft.
import { PDFDocument, StandardFonts, type PDFFont, type PDFTextField } from "pdf-lib";
import { ABSENT_PLACES, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const longDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

/** Nur Zeichen, die die Standardschrift im PDF kann (Umlaute ja, Sonderzeichen wie → nein) */
function safe(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(s.replace(/[\u2022\u00B7\u25AA]/g, "-").replace(/\u2192/g, "->").replace(/\u2026/g, "...")).filter((c) => c === "\n" || set.has(c.codePointAt(0)!)).join("");
}
const clean = (t: string) => t.replace(/\s*\n+\s*/g, "; ").trim();

/** Schriftgröße so wählen, dass der Text ins Feld passt (Feld mit mehreren Zeilen, Standard 10 pt) */
function fit(field: PDFTextField, font: PDFFont, text: string) {
  const w = field.acroField.getWidgets()[0].getRectangle();
  for (const size of [10, 9, 8, 7, 6.5, 6]) {
    const lineH = size * 1.18, maxLines = Math.floor((w.height - 2) / lineH);
    let lines = 0;
    for (const para of text.split("\n")) {
      let cur = 0; lines += 1;
      for (const word of para.split(/\s+/)) {
        const ww = font.widthOfTextAtSize(word + " ", size);
        if (cur + ww > w.width - 6 && cur > 0) { lines += 1; cur = ww; } else cur += ww;
      }
    }
    if (lines <= maxLines || size === 6) { field.setFontSize(size); return; }
  }
}

export interface HhuOpts { nr?: string }

export async function buildHhuPdf(template: ArrayBuffer | Uint8Array, draft: WeekDraft, meta: ReportMeta, opts: HhuOpts = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const set = (name: string, text: string, multiline = false) => {
    const f = form.getTextField(name);
    const t = safe(font, text);
    f.setText(t || undefined);
    if (multiline && t) fit(f, font, t);
  };
  const dates = weekDates(draft.year, draft.week);
  set("Vorname Name", meta.name);
  set("Abteilung", meta.betrieb);
  set("Zeitraum", `${longDate(dates[0])} - ${longDate(dates[4])}`);
  if (opts.nr) { set("Nr", opts.nr); set("2", opts.nr); }

  const school: string[] = [];
  DAYS.forEach((name, i) => {
    const date = dates[i];
    set(`Datum${i + 1}`, longDate(date));
    const d = draft.days.find((x) => x.date === date);
    // Samstag/Sonntag gibt es im Formular nicht: ihre Einträge hängen am Freitag
    const extra = i === 4 ? draft.days.filter((x) => x.date === dates[5] || x.date === dates[6]).filter((x) => x.entries.length) : [];
    const lines: string[] = [];
    const items = (x: typeof d, prefix = "") => (x?.entries ?? []).map((e) => `- ${prefix}${clean(e.text)}`);
    if (!d) { set(`${name}saufgaben`, "", true); return; }
    if (d.place === "Schule") {
      lines.push("Berufsschule (ganztägig)");
      if (d.entries.length) school.push(`*${name}:\n${items(d).join("\n")}`);
    } else if (d.place === "Schule/Betrieb") {
      lines.push("Berufsschule (halbtags)", ...items(d));
    } else if (d.entries.length) lines.push(...items(d));
    else if (ABSENT_PLACES.includes(d.place)) lines.push(d.place);
    for (const x of extra) lines.push(...items(x, `${weekdayName(x.date).slice(0, 2)}: `));
    set(`${name}saufgaben`, lines.join("\n"), true);
  });
  set("Unterweisungen", "/");
  set("Berufsschule", school.length ? school.join("\n\n") : "/", true);

  form.updateFieldAppearances(font);
  return doc.save();
}
