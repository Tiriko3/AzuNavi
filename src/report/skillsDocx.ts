// Fähigkeiten-Übersicht für den Ausbilder: pro Qualifikation wie oft, wann zuletzt, Beispiele, was noch fehlt.
// Nutzt Kopf, Meta-Zeile und Unterschriftsfeld der IHK-Vorlage, damit alles zusammenpasst.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { W, all, applyMeta, kids, setT, textOf } from "./weekDocx";
import { shortDate, type ReportMeta } from "./types";

export interface SkillRow { name: string; kind: string; count: number; last: string | null; examples: string[] }
const KIND_LABEL: Record<string, string> = {
  betrieb: "Betriebliche Qualifikationen", schule: "Schulische Qualifikationen", eigene: "Eigene Qualifikationen", sonst: "Sonstiges",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLS = [3700, 1100, 1100, 3806]; // Summe 9706 = Breite zwischen den Seitenrändern der Vorlage

function cell(text: string, w: number, o: { bold?: boolean; color?: string; fill?: string; italic?: boolean; size?: number; span?: number } = {}) {
  const rpr = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${o.bold ? "<w:b/>" : ""}${o.italic ? "<w:i/>" : ""}<w:color w:val="${o.color ?? "1F2937"}"/><w:sz w:val="${o.size ?? 18}"/></w:rPr>`;
  const lines = text.split("\n");
  const runs = lines.map((l, i) => `<w:r>${rpr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(l)}</w:t></w:r>`).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${runs}</w:p></w:tc>`;
}
const para = (text: string, o: { bold?: boolean; color?: string; size?: number; after?: number } = {}) =>
  `<w:p><w:pPr><w:spacing w:before="120" w:after="${o.after ?? 80}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${o.bold ? "<w:b/>" : ""}<w:color w:val="${o.color ?? "1D4E6B"}"/><w:sz w:val="${o.size ?? 20}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

export async function buildSkillsDocx(template: ArrayBuffer, rows: SkillRow[], meta: ReportMeta, today: string, accent = "1D4E6B", accentLight = "4A7DB5"): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const body = all(doc, "body")[0];
  let top = kids(body);
  // Titelzeile der Standard-Vorlage („AUSBILDUNGSNACHWEIS · IHK“) gehört nur zum Wochenbericht
  top.forEach((k) => { if (k.localName === "p" && /^(AUSBILDUNGSNACHWEIS|BERICHTSHEFT|WOCHENBERICHT)/.test(textOf(k).trim())) body.removeChild(k); });
  top = kids(body);

  // Kopf umbenennen
  const header = top.find((k) => k.localName === "tbl")!;
  for (const t of all(header, "t")) {
    const s = t.textContent || "";
    if (s.trim().startsWith("KW")) setT(t, "Fähigkeiten-Übersicht, ");
    else if (s.includes("–")) setT(t, `Stand ${shortDate(today)}`);
  }
  applyMeta(top, meta);

  // Alles zwischen Meta-Zeile und Unterschriften entfernen (Tabs, Tageskarten, Dauer, Hinweis)
  const metaIdx = top.findIndex((k) => k.localName === "p" && textOf(k).includes("Ausbilder:"));
  const signIdx = top.findIndex((k) => k.localName === "tbl" && textOf(k).includes("Unterschrift"));
  top.forEach((k, i) => {
    const tabsP = k.localName === "p" && textOf(k).includes("Einträge auf Tagesbasis");
    const between = i > metaIdx && i < signIdx;
    const hint = i > signIdx && k.localName === "p" && textOf(k).includes("Hinweise:");
    if (tabsP || between || hint) body.removeChild(k);
  });

  // Inhalt: Zusammenfassung + Tabelle
  const used = rows.filter((r) => r.count > 0).length;
  const total = rows.filter((r) => r.kind !== "sonst").length;
  const totalNotes = rows.reduce((a, r) => a + r.count, 0);
  let tbl = `<w:tbl><w:tblPr><w:tblW w:w="9706" w:type="dxa"/><w:tblBorders>`
    + ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="C9D3E3"/>`).join("")
    + `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${COLS.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>`;
  tbl += `<w:tr><w:trPr><w:tblHeader/></w:trPr>${["Qualifikation", "Anzahl", "Zuletzt", "Beispiele aus deinen Notizen"].map((h, i) => cell(h, COLS[i], { bold: true, color: "FFFFFF", fill: "1D4E6B" })).join("")}</w:tr>`;
  for (const kind of ["betrieb", "schule", "eigene", "sonst"]) {
    const group = rows.filter((r) => r.kind === kind);
    if (!group.length) continue;
    tbl += `<w:tr>${cell(KIND_LABEL[kind] ?? kind, 9706, { bold: true, color: "1D4E6B", fill: "EEF3FA", span: 4 })}</w:tr>`;
    for (const r of group) {
      const open = r.count === 0;
      tbl += `<w:tr><w:trPr><w:cantSplit/></w:trPr>`
        + cell(r.name, COLS[0], { fill: open ? "FFF4F6" : undefined })
        + cell(open ? "noch offen" : String(r.count), COLS[1], { bold: true, color: open ? "C4163F" : "1D4E6B", fill: open ? "FFF4F6" : undefined })
        + cell(r.last ? shortDate(r.last) : "–", COLS[2], { color: "6B7280", fill: open ? "FFF4F6" : undefined })
        + cell(r.examples.length ? r.examples.map((e) => "• " + e).join("\n") : "", COLS[3], { italic: true, color: "4A7DB5", size: 17, fill: open ? "FFF4F6" : undefined })
        + `</w:tr>`;
    }
  }
  tbl += `</w:tbl>`;
  const frag = `<w:document xmlns:w="${W}"><w:body>`
    + para(`${used} von ${total} Qualifikationen sind mit Tätigkeiten belegt, insgesamt ${totalNotes} Zuordnungen.`, { bold: true, size: 21 })
    + para("Rot markiert: Qualifikationen, zu denen es noch keine Notiz gibt.", { color: "6B7280", size: 17, after: 160 })
    + tbl + `<w:p/></w:body></w:document>`;
  const fdoc = new DOMParser().parseFromString(frag, "text/xml");
  const sign = kids(body).find((k) => k.localName === "tbl" && textOf(k).includes("Unterschrift"));
  for (const n of kids(all(fdoc, "body")[0])) body.insertBefore(doc.importNode(n, true), sign ?? null);

  // eigene Tabelle in den Farben des Berufsprofils
  const outXml = new XMLSerializer().serializeToString(doc).replace(/1D4E6B/g, accent).replace(/4A7DB5/g, accentLight);
  zip.file("word/document.xml", outXml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
