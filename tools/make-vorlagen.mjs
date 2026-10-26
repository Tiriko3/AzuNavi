// Erzeugt die eingebaute Word-Vorlage „Tagesnachweis mit Stundenspalte“ (src/assets/vorlagen/tagesnachweis.docx) mit {{Platzhaltern}}.
// Nur die Gliederung des bekannten Tagesnachweis-Layouts, keinerlei Inhalte aus echten Berichten.
// Aufruf: node tools/make-vorlagen.mjs   (braucht das npm-Paket „docx“: npm i --no-save docx)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType } = require("docx");

const line = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
const borders = { top: line, bottom: line, left: line, right: line };
const W = [1500, 6700, 1000]; // DXA, Summe 9200 (A4 mit 2 cm Rand ≈ 9638)
const p = (t, o = {}) => new Paragraph({ spacing: { after: o.after ?? 60 }, alignment: o.align, children: [new TextRun({ text: t, bold: o.bold, size: o.size ?? 22, font: "Arial" })] });
const cell = (t, w, o = {}) => new TableCell({
  borders, width: { size: w, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 },
  shading: o.head ? { fill: "E8E8E8", type: ShadingType.CLEAR } : undefined,
  children: [p(t, { bold: o.head || o.bold, size: o.head ? 20 : 21, after: 0 })],
});
const days = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG"], names = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const table = new Table({
  width: { size: 9200, type: WidthType.DXA }, columnWidths: W,
  rows: [
    new TableRow({ tableHeader: true, children: [cell("Wochentag", W[0], { head: true }), cell("Betriebliche Tätigkeiten, Unterweisungen, betrieblicher Unterricht, sonstige Schulungen, Themen des Berufsschulunterrichts", W[1], { head: true }), cell("Stunden", W[2], { head: true })] }),
    ...days.map((d, i) => new TableRow({ height: { value: 1900, rule: "atLeast" }, children: [cell(names[i], W[0], { bold: true }), cell(`{{${d}}}`, W[1]), cell(`{{${d}_STUNDEN}}`, W[2])] })),
  ],
});
const sign = new Table({
  width: { size: 9200, type: WidthType.DXA }, columnWidths: [4600, 4600],
  rows: [new TableRow({ height: { value: 900, rule: "atLeast" }, children: ["Datum, Unterschrift Auszubildende/r", "Datum, Unterschrift Ausbildende/r oder Ausbilder/in"].map((t) => new TableCell({
    width: { size: 4600, type: WidthType.DXA }, margins: { top: 600, left: 100, right: 100 },
    borders: { top: line, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    children: [p(t, { size: 18, after: 0 })] })) })],
});
const doc = new Document({
  styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: [
    p("Ausbildungsnachweis (täglich)", { bold: true, size: 32, after: 200 }),
    p("Name des/der Auszubildenden: {{NAME}}"),
    p("Ausbildungsjahr: {{JAHR}}"),
    p("Ggf. ausbildende Abteilung: {{BETRIEB}}"),
    p("Ausbildungswoche von {{VON}} bis {{BIS}}", { after: 200 }),
    table,
    p("", { after: 120 }),
    p("Durch die nachfolgende Unterschrift wird die Richtigkeit und Vollständigkeit der obigen Angaben bestätigt.", { size: 20, after: 120 }),
    sign,
  ] }],
});
writeFileSync(new URL("../src/assets/vorlagen/tagesnachweis.docx", import.meta.url), await Packer.toBuffer(doc));
console.log("tagesnachweis.docx geschrieben");
