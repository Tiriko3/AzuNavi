// Test: Import von PDF-Formularen und LaTeX-Tagesnachweisen, Export ins HHU-PDF und in die Tagesnachweis-Vorlage.
// Nur ERFUNDENE Daten. Aufruf: npx tsx tools/import-test.mts   (einmalig: npm i --no-save tsx)
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { fixLatexUmlauts, isHhuForm, parseHhuForm, parsePdfDoc, parseTagesnachweis } from "../src/import/importer.ts";
import { buildHhuPdf } from "../src/report/hhuPdf.ts";
import { buildPlaceholderDocx } from "../src/report/placeholderDocx.ts";
import { weekDates, type WeekDraft } from "../src/report/types.ts";

let ok = 0, bad = 0;
const t = (name: string, cond: boolean, info = "") => { if (cond) ok++; else { bad++; console.log("FEHLER:", name, info); } };

/* ---- 1) Umlaute aus LaTeX-PDFs ---- */
t("¨a", fixLatexUmlauts("t¨ aglich") === "täglich");
t("¨u + Leerzeichen", fixLatexUmlauts("begr¨ ußt") === "begrüßt");
t("Wortanfang Uber", fixLatexUmlauts("Uber den Tag ¨") === "Über den Tag");
t("Anderungen", fixLatexUmlauts("Anderungen speichern") === "Änderungen speichern");
t("lose ¨ weg", !fixLatexUmlauts("mit dem ¨").includes("¨"));

/* ---- 2) Formularfelder (HHU) ---- */
const f = {
  "Vorname Name": "Erika Beispiel", Zeitraum: "14.09.2026 - 18.09.2026", Nr: "7",
  Datum1: "14.09.2026", Datum2: "15.09.2026", Datum3: "16.09.2026", Datum4: "17.09.2026", Datum5: "18.09.2026",
  Montagsaufgaben: "- Post verteilt\n  - Bewerbungen eingetragen\n  - Leistungen im System eingetragen (Pflichtmodule) im Test",
  Dienstagsaufgaben: "Berufsschule (nachmittags)\n  - Prüfungsergebnisse umgetragen",
  Mittwochsaufgaben: "Urlaub", Donnerstagsaufgaben: "- Berufsschule (ganztägig)", Freitagsaufgaben: "- Fachbericht überarbeitet",
  Unterweisungen: "/", Berufsschule: "*Dienstag:\n  - Geschäftsprozesse 2: Arbeitsauftrag\n\n  *Donnerstag:\n  - Politik: Streiks",
};
t("erkennt HHU-Formular", isHhuForm(f));
const e = parseHhuForm(f, "test.pdf");
t("Montag hat 3 Tätigkeiten (Fortsetzungszeile hängt am Vorgänger)", e.filter((x) => x.date === "2026-09-14").length === 3, JSON.stringify(e.filter((x) => x.date === "2026-09-14").map((x) => x.text)));
t("Ortszeile „Berufsschule (nachmittags)“ ist keine Tätigkeit", !e.some((x) => /^Berufsschule \(/.test(x.text)));
t("Urlaub ist keine Tätigkeit", !e.some((x) => x.text === "Urlaub"));
t("Schule am Dienstag", e.some((x) => x.date === "2026-09-15" && x.scope === "schule" && /Geschäftsprozesse/.test(x.text)));
t("Schule am Donnerstag", e.some((x) => x.date === "2026-09-17" && x.scope === "schule" && /Politik/.test(x.text)));
const noHead = parseHhuForm({ ...f, Berufsschule: "StuK\nGP2: Übung", Dienstagsaufgaben: "Schule ganztägig", Donnerstagsaufgaben: "" }, "t");
t("Berufsschule ohne Tage → erster Schultag", noHead.filter((x) => x.scope === "schule").every((x) => x.date === "2026-09-15") && noHead.some((x) => x.scope === "schule"));
t("Sommerferien/„/“ ergeben nichts", parseHhuForm({ ...f, Montagsaufgaben: "Urlaub", Dienstagsaufgaben: "", Mittwochsaufgaben: "", Donnerstagsaufgaben: "", Freitagsaufgaben: "", Berufsschule: "Sommerferien" }, "t").length === 0);
const fb = parseHhuForm({ "Vorname, Name": "Erika", Monat: "September 2026", Ausbildungsthema: "- Studierendenservice", Fließtext: "Ich habe gelernt, wie …" }, "fb.pdf");
t("Fachbericht wird eine Notiz", fb.length === 1 && fb[0].date === "2026-09-01" && /Studierendenservice/.test(fb[0].text));

/* ---- 3) Tagesnachweis (LaTeX) ---- */
const lines = [
  "Ausbildungsnachweis (t¨ aglich)", "Name des/der Auszubildenden: Erika Beispiel", "von 03.08.2026", "Ausbildungswoche", "bis 07.08.2026",
  "Wochentag Betriebliche T¨ atigkeiten, Unterweisungen", "sonstige Schulungen, Themen des Berufsschulunterrichts",
  "Montag Alle werden begr¨ ußt. Danach pflanzen wir einen Baum mit W¨ unschen.", "Wir richten den Arbeitsplatz ein. An-", "schließend gibt es ein Treffen mit dem Team.",
  "Dienstag Uber den Tag arbeite ich am Helpdesk. Dabei verschaffe ich mir einen Uberblick.", "Durch die nachfolgende Unterschrift wird die Richtigkeit best¨ atigt.",
];
const tn = parseTagesnachweis(lines, "tn.pdf");
t("Tagesnachweis: Montag 4 Sätze", tn.filter((x) => x.date === "2026-08-03").length === 4, JSON.stringify(tn.filter((x) => x.date === "2026-08-03").map((x) => x.text)));
t("Tagesnachweis: Silbentrennung zusammengezogen", tn.some((x) => /Anschließend gibt es/.test(x.text)));
t("Tagesnachweis: Dienstag mit Umlaut", tn.some((x) => x.date === "2026-08-04" && /^Über den Tag/.test(x.text)) && tn.some((x) => /einen Überblick/.test(x.text)));
t("Tagesnachweis: Kopfzeilen nicht als Tätigkeit", !tn.some((x) => /Wochentag|Ausbildungsnachweis|Name des/.test(x.text)));

/* ---- 4) Export: HHU-PDF und zurücklesen ---- */
const dates = weekDates(2026, 38);
const draft: WeekDraft = { year: 2026, week: 38, days: dates.map((date, i) => ({ date, presence: "anwesend", place: ["Betrieb", "Schule", "Schule/Betrieb", "Urlaub", "Betrieb", "Betrieb", "Betrieb"][i], entries: [] })) };
draft.days[0].entries = [{ text: "Post für Kanzler und Rektorin verteilt", quals: [] }, { text: "Zeugnisse nach Alphabet sortiert und abgelegt – größere Menge, mit Umlauten äöüß", quals: [] }];
draft.days[1].entries = [{ text: "Geschäftsprozesse: Arbeitsauftrag Unternehmenspräsentation", quals: [] }];
draft.days[2].entries = [{ text: "Büroprozesse: Registratur", quals: [] }];
draft.days[3].presence = "abwesend";
draft.days[4].entries = Array.from({ length: 9 }, (_, i) => ({ text: `Aufgabe Nummer ${i + 1} mit etwas längerem Text, damit die Zeilen umbrechen müssen und die Schrift kleiner wird`, quals: [] }));
draft.days[5].entries = [{ text: "Samstagsdienst Messe", quals: [] }];
const tpl = readFileSync("src/assets/vorlagen/hhu-wochenbericht.pdf");
const pdfBytes = await buildHhuPdf(tpl, draft, { name: "Erika Beispiel", beruf: "Kauffrau für Büromanagement", betrieb: "Dezernat 9, Testverwaltung", ausbilder: "" });
writeFileSync("/tmp/out-hhu.pdf", pdfBytes);
const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true, verbosity: 0 }).promise;
const back = await parsePdfDoc(doc, [], "out.pdf");
t("PDF-Roundtrip: Montag 2 Einträge", back.filter((x) => x.date === "2026-09-14").length === 2, String(back.length));
t("PDF-Roundtrip: Umlaute heil", back.some((x) => /äöüß/.test(x.text)));
t("PDF-Roundtrip: Schule am Dienstag", back.some((x) => x.date === "2026-09-15" && x.scope === "schule"));
t("PDF-Roundtrip: Freitag 9 + Samstag", back.filter((x) => x.date === "2026-09-18").length === 10, String(back.filter((x) => x.date === "2026-09-18").length));
const fields = await (async () => { const out: Record<string, string> = {}; for (let p = 1; p <= doc.numPages; p++) for (const a of await (await doc.getPage(p)).getAnnotations()) if (a.fieldName) out[a.fieldName] = String(a.fieldValue ?? ""); return out; })();
t("Kopf: Name, Abteilung, Zeitraum", fields["Vorname Name"] === "Erika Beispiel" && /Testverwaltung/.test(fields["Abteilung"]) && fields["Zeitraum"] === "14.09.2026 - 18.09.2026", JSON.stringify([fields["Vorname Name"], fields["Abteilung"], fields["Zeitraum"]]));
t("Datum1 = Montag", fields["Datum1"] === "14.09.2026");
t("Unterweisungen = /", fields["Unterweisungen"] === "/");

/* ---- 5) Export: Tagesnachweis (Word) ---- */
const docx = await buildPlaceholderDocx(readFileSync("src/assets/vorlagen/tagesnachweis.docx").buffer as ArrayBuffer, draft, { name: "Erika Beispiel", beruf: "FI", betrieb: "Abteilung X", ausbilder: "" });
writeFileSync("/tmp/out-tagesnachweis.docx", docx);
const xml = await (await JSZip.loadAsync(docx)).file("word/document.xml")!.async("string");
t("Tagesnachweis: keine Platzhalter übrig", !xml.includes("{{"), (xml.match(/\{\{[^}]*\}\}/g) || []).join());
t("Tagesnachweis: Name, Woche, Eintrag", xml.includes("Erika Beispiel") && xml.includes("14.09.2026") && xml.includes("18.09.2026") && xml.includes("Post für Kanzler"));

console.log(`${ok} ok, ${bad} Fehler`);
process.exit(bad ? 1 : 0);
