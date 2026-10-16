// Erzeugt je Beruf eine Beispiel-Vorlage (docx) für die Vorschaubilder. Aufruf: npx tsx scripts/make-previews.ts /tmp/prev
import { readFileSync, writeFileSync } from "node:fs";
import { PROFILES } from "../src/profiles/berufe";
import { buildStandardTemplate } from "../src/report/standard";
import { buildWeekDocx } from "../src/report/weekDocx";
import { weekDates, type WeekDraft } from "../src/report/types";

const out = process.argv[2] ?? "/tmp/prev";
const base = readFileSync("src/assets/berichtsheft-vorlage.docx");
const ab = base.buffer.slice(base.byteOffset, base.byteOffset + base.byteLength) as ArrayBuffer;
const SAMPLE: Record<string, [string, string][][]> = {
  si: [[["Neuen Client eingerichtet und in die Domäne aufgenommen", "Installieren und Konfigurieren von Netzwerken"]], [["Firewall-Regeln dokumentiert und geprüft", "Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit und zum Datenschutz"]], [["Berufsschule: Netzwerkprotokolle", "Allgemeinbildende Fächer"]]],
  ae: [[["REST-Schnittstelle für die Kundenverwaltung umgesetzt", "Programmieren von Softwarelösungen"]], [["Modultests geschrieben und Fehler behoben", "Sicherstellen der Qualität von Softwareanwendungen"]], [["Berufsschule: Datenbankmodellierung", "Allgemeinbildende Fächer"]]],
  dpa: [[["Datenquellen des Vertriebs analysiert und klassifiziert", "Analysieren von Datenquellen und Bereitstellen von Daten"]], [["Auswertung der Prozesszeiten visualisiert", "Nutzen der Daten zur Optimierung von Arbeits- und Geschäftsprozessen sowie zur Optimierung digitaler Geschäftsmodelle"]], [["Berufsschule: Statistik", "Allgemeinbildende Fächer"]]],
  buero: [[["Posteingang bearbeitet und Termine abgestimmt", "Bürowirtschaftliche Abläufe organisieren"]], [["Angebot erstellt und Bestellung ausgelöst", "Auftragsbearbeitung durchführen"]], [["Berufsschule: Geschäftsprozesse", "Allgemeinbildende Fächer"]]],
  fami: [[["Neuerwerbungen erfasst und inventarisiert", "Bibliothek: Erwerbung"]], [["Benutzer beraten und Recherchen durchgeführt", "Bibliothek: Benutzungsdienst und Informationsvermittlung"]], [["Berufsschule: Erschließung", "Allgemeinbildende Fächer"]]],
  buchbinder: [[["Buchblock geheftet und Rücken geleimt", "Herstellen buchbinderischer Erzeugnisse"]], [["Schadensbild an einem Altbestand dokumentiert", "Wahlqualifikation: Instandsetzen von Büchern und Objekten"]], [["Überbetriebliche Unterweisung: Handvergoldung", "Berufsbildung, Arbeits- und Tarifrecht"]]],
};
(async () => {
  for (const p of PROFILES) {
    const tpl = await buildStandardTemplate(ab, p, { kammerText: p.kammer });
    const dates = weekDates(2026, 42);
    const days = dates.slice(0, 5).map((date, i) => ({
      date, presence: "anwesend" as const, place: i === 2 ? "Schule" : "Betrieb",
      entries: (SAMPLE[p.id][[0, 1, 2, 3, 4][i]] ?? []).map(([text, q]) => ({ text, quals: q ? [q] : [] })),
    }));
    const draft: WeekDraft = { year: 2026, week: 42, days };
    const meta = { name: "Muster, Max", beruf: [p.beruf, p.fachrichtung].filter(Boolean).join(" – "), betrieb: "Beispiel GmbH", ausbilder: "Beispiel, Erika" };
    const bytes = await buildWeekDocx(tpl, draft, meta, [], true);
    writeFileSync(`${out}/${p.id}.docx`, bytes);
    console.log("ok", p.id);
  }
})();
