// „Freie“ Vorlagen: jedes Word-Layout wird akzeptiert, auch wenn es nicht wie das der IHK aussieht.
//  1) makeEmptyCopy: aus einem alten, ausgefüllten Berichtsheft wird eine leere Vorlage (Text raus, Layout bleibt).
//  2) buildFreeDocx: trägt die Woche in so ein Layout ein. Gefunden werden Beschriftungen (Name, Beruf, Betrieb, Woche …)
//     und Tabellenzeilen mit Wochentagen. Findet sich nichts davon, hängt die App eine eigene Wochentabelle an.
// Bewusst ohne Tauri/Vite-Importe, damit es auch in Tests (Node) läuft.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { W, all, kids, setT, textOf } from "./weekDocx";
import { ABSENT_PLACES, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";

type El = any;
const WD = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
const WD_ABBR: Record<string, number> = { mo: 0, di: 1, mi: 2, do: 3, fr: 4, sa: 5, so: 6 };
const DATE_RE = /\d{1,2}\.\s?\d{1,2}\.(\d{4}|\d{2})?/g;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 0 = Montag … 6 = Sonntag, sonst -1 */
export function dayIndexOf(text: string): number {
  const t = text.trim().toLowerCase();
  for (let i = 0; i < 7; i++) if (t.startsWith(WD[i])) return i;
  const m = t.match(/^(mo|di|mi|do|fr|sa|so)\b\.?/);
  return m ? WD_ABBR[m[1]] : -1;
}

/** Ganzen Absatztext neu setzen (Format des ersten Textlaufs bleibt) */
function rewrite(p: El, text: string) {
  const ts = all(p, "t");
  if (!ts.length) {
    const doc = p.ownerDocument;
    const r = doc.createElementNS(W, "w:r"), t = doc.createElementNS(W, "w:t");
    r.appendChild(t); p.appendChild(r); setT(t, text); return;
  }
  setT(ts[0], text);
  ts.slice(1).forEach((t: El) => setT(t, ""));
}

/* ====================== 1) Leere Kopie ====================== */
function stripDates(s: string) { return s.replace(DATE_RE, "").replace(/\s{2,}/g, " ").replace(/[,\s]+$/, "").trimEnd(); }

function emptyParagraph(p: El) {
  const text = textOf(p), tr = text.trim();
  if (!tr) return;
  if (dayIndexOf(tr) >= 0 && tr.length <= 40) { rewrite(p, stripDates(tr)); return; }       // Wochentag bleibt, Datum raus
  const colon = text.indexOf(":");
  if (colon >= 0 && colon <= 40) { rewrite(p, text.slice(0, colon + 1) + " "); return; }    // „Name: Max Muster“ -> „Name: “
  if (/^[\d\s.,:;\-–/hH]+$/.test(tr)) { rewrite(p, ""); return; }                             // nur Zahlen, Stunden, Daten
  if (tr.length <= 60) { rewrite(p, stripDates(text).replace(/\b(Nr\.?|KW|Woche)\s*\d+/gi, "$1").replace(/\d+/g, "").replace(/\s{2,}/g, " ")); return; } // Überschrift: Zahlen weg
  rewrite(p, "");                                                                             // langer Text = Inhalt
}

function emptyTable(tbl: El) {
  const rows = kids(tbl).filter((k: El) => k.localName === "tr");
  const hasHeader = rows.length > 3;
  rows.forEach((tr: El, ri: number) => {
    if (ri === 0 && hasHeader) return;                                       // Kopfzeile bleibt
    kids(tr).filter((k: El) => k.localName === "tc").forEach((tc: El, ci: number) => {
      all(tc, "p").forEach((p: El) => {
        if (ci === 0) { const t = textOf(p).trim(); if (t.length > 40) rewrite(p, ""); else if (t) rewrite(p, stripDates(textOf(p))); }
        else rewrite(p, "");                                                 // alles rechts von der Beschriftung ist Inhalt
      });
    });
  });
}

function emptyPart(root: El) {
  for (const k of kids(root)) {
    if (k.localName === "p") emptyParagraph(k);
    else if (k.localName === "tbl") emptyTable(k);
  }
}

export async function makeEmptyCopy(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  const main = zip.file("word/document.xml");
  if (!main) throw new Error("Das ist keine gültige Word-Datei (.docx).");
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  for (const name of parts) {
    const doc = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "text/xml");
    const root = name.endsWith("document.xml") ? all(doc, "body")[0] : doc.documentElement;
    emptyPart(root);
    zip.file(name, new XMLSerializer().serializeToString(doc));
  }
  // Namen aus den Dokument-Eigenschaften entfernen
  const core = zip.file("docProps/core.xml");
  if (core) {
    const c = (await core.async("string")).replace(/(<dc:creator>)[\s\S]*?(<\/dc:creator>)/, "$1AzuNavi$2").replace(/(<cp:lastModifiedBy>)[\s\S]*?(<\/cp:lastModifiedBy>)/, "$1AzuNavi$2");
    zip.file("docProps/core.xml", c);
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/* ====================== 2) Befüllen ====================== */
export interface FreeOpts { quals: boolean; kammer?: string }

function labelValue(label: string, meta: ReportMeta & { kammer?: string }, draft: WeekDraft): string | null {
  const l = label.toLowerCase();
  const dates = weekDates(draft.year, draft.week);
  if (/unterschrift|^datum/.test(l)) return null;                                   // Unterschriftszeilen bleiben leer
  if (/ausbildungsbetrieb|betrieb|firma|ausbildungsstätte|ausbildungsstelle/.test(l)) return meta.betrieb;
  if (/ausbilder/.test(l)) return meta.ausbilder;
  if (/beruf/.test(l)) return meta.beruf;
  if (/kammer|zuständige stelle/.test(l)) return meta.kammer ?? "";
  if (/name|auszubildende|azubi/.test(l)) return meta.name;
  if (/(vom|zeitraum|von\b)/.test(l) && /(woche|kw|datum|zeitraum|vom)/.test(l)) return `${shortDate(dates[0])} – ${shortDate(dates[6])}`;
  if (/kalenderwoche|^kw\b|\bkw$|^woche\b|\bwoche$/.test(l)) return String(draft.week);
  if (/^jahr$/.test(l)) return String(draft.year);
  return null;
}

function entryLines(day: WeekDraft["days"][number] | undefined, quals: boolean): string[] {
  if (!day) return [""];
  const es = day.entries.filter((e) => e.text.trim());
  if (!es.length) return [ABSENT_PLACES.includes(day.place) ? day.place : ""];
  return es.map((e) => "• " + e.text.replace(/\s*\n+\s*/g, "; ").trim() + (quals && e.quals.length ? ` (Qualifikation: ${e.quals.join("; ")})` : ""));
}

function fillCell(tc: El, lines: string[]) {
  const ps = kids(tc).filter((k: El) => k.localName === "p");
  if (!ps.length) return;
  const proto = ps[0].cloneNode(true);
  ps.forEach((p: El) => tc.removeChild(p));
  lines.forEach((ln) => { const p = proto.cloneNode(true); rewrite(p, ln); tc.appendChild(p); });
}

const cellW = (tc: El) => { const w = all(tc, "tcW")[0]; return w ? parseInt(w.getAttribute("w:w") || "0", 10) || 0 : 0; };

function generatedTable(draft: WeekDraft, quals: boolean): string {
  const dates = weekDates(draft.year, draft.week);
  const cols = [1500, 1300, 6900];
  const bd = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="9AA5B1"/>`).join("");
  const cell = (text: string, w: number, bold = false, fill?: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>`
    + text.split("\n").map((l) => `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("") + `</w:tc>`;
  let t = `<w:tbl><w:tblPr><w:tblW w:w="9700" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>`;
  t += `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Tag", cols[0], true, "E5E9EF")}${cell("Ort", cols[1], true, "E5E9EF")}${cell("Tätigkeiten", cols[2], true, "E5E9EF")}</w:tr>`;
  draft.days.slice(0, 5).concat(draft.days.slice(5).filter((d) => d.entries.length || ABSENT_PLACES.includes(d.place))).forEach((d) => {
    t += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(`${weekdayName(d.date)}\n${shortDate(d.date)}`, cols[0], true)}${cell(d.place, cols[1])}${cell(entryLines(d, quals).join("\n"), cols[2])}</w:tr>`;
  });
  void dates;
  return t + `</w:tbl>`;
}

export async function buildFreeDocx(template: ArrayBuffer, draft: WeekDraft, meta: ReportMeta & { kammer?: string }, opts: FreeOpts): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const dates = weekDates(draft.year, draft.week);
  const dayOf = (i: number) => draft.days.find((d) => d.date === dates[i]);
  let dayFilled = false;

  for (const name of Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
    const doc = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "text/xml");
    const isMain = name.endsWith("document.xml");
    const root = isMain ? all(doc, "body")[0] : doc.documentElement;

    const fillLabelPara = (p: El) => {
      const t = textOf(p), c = t.indexOf(":");
      if (/\bvom\s+bis\b/i.test(t) && !/\d/.test(t)) { rewrite(p, t.replace(/\bvom\s+bis\b/i, `vom ${shortDate(dates[0])} bis ${shortDate(dates[6])}`)); return; }   // „Woche vom bis“
      if (c < 1 || c > 40 || t.slice(c + 1).trim()) return;           // nur leere „Beschriftung: “-Zeilen füllen
      const v = labelValue(t.slice(0, c), meta, draft);
      if (v) rewrite(p, t.slice(0, c + 1) + " " + v);
    };

    for (const k of kids(root)) {
      if (k.localName === "p") {
        fillLabelPara(k);
        // Tage als Absätze („Montag: “)
        const t = textOf(k).trim();
        const di = dayIndexOf(t);
        if (isMain && di >= 0 && t.length <= 40) {
          const d = dayOf(di);
          rewrite(k, `${weekdayName(dates[di])}, ${shortDate(dates[di])}: ${entryLines(d, opts.quals).join(" ").replace(/\s*•\s*/g, " ").trim()}`.trim());
          dayFilled = true;
        }
      } else if (k.localName === "tbl") {
        const rows = kids(k).filter((r: El) => r.localName === "tr");
        const cellsOf = (r: El) => kids(r).filter((c: El) => c.localName === "tc");
        const dayRows = rows.filter((r: El) => { const c0 = cellsOf(r)[0]; return c0 && dayIndexOf(textOf(c0)) >= 0; });
        if (dayRows.length >= 3) {
          const hdr = rows[rows.indexOf(dayRows[0]) - 1];
          const heads = hdr ? cellsOf(hdr).map((c: El) => textOf(c).toLowerCase()) : [];
          const colOf = (re: RegExp) => heads.findIndex((h: string) => re.test(h));
          dayRows.forEach((r: El) => {
            const cs = cellsOf(r);
            const di = dayIndexOf(textOf(cs[0]));
            const d = dayOf(di);
            const lab = stripDates(textOf(cs[0])) || weekdayName(dates[di]);
            fillCell(cs[0], [`${lab} ${shortDate(dates[di])}`.trim()]);
            let tCol = colOf(/tätig|arbeit|unterricht|inhalt|ausgeführt|beschreib|thema|lehr|aufgabe/);
            if (tCol < 1) { let best = -1, bw = -1; cs.forEach((c: El, i: number) => { if (i > 0 && cellW(c) > bw) { bw = cellW(c); best = i; } }); tCol = best; }
            const dCol = colOf(/datum/), oCol = colOf(/\bort\b|abteilung|bereich/);
            if (dCol > 0 && cs[dCol]) fillCell(cs[dCol], [shortDate(dates[di])]);
            if (oCol > 0 && cs[oCol] && d) fillCell(cs[oCol], [d.place]);
            if (tCol > 0 && cs[tCol]) fillCell(cs[tCol], entryLines(d, opts.quals));
          });
          dayFilled = true;
        } else {
          // Beschriftung | Wert – Tabellen (Name, Beruf, Betrieb …)
          rows.forEach((r: El) => {
            const cs = cellsOf(r);
            if (cs.length >= 2 && !textOf(cs[1]).trim()) {
              const v = labelValue(textOf(cs[0]).replace(/:\s*$/, ""), meta, draft);
              if (v) fillCell(cs[1], [v]);
            }
            all(r, "p").forEach((p: El) => fillLabelPara(p));
          });
        }
      }
    }

    if (isMain && !dayFilled) {
      // Keine Tage erkannt: eigene Wochentabelle am Ende anhängen
      const frag = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">KW ${draft.week}  ·  ${shortDate(dates[0])} – ${shortDate(dates[6])}</w:t></w:r></w:p>${generatedTable(draft, opts.quals)}<w:p/></w:body></w:document>`;
      const fdoc = new DOMParser().parseFromString(frag, "text/xml");
      const sect = kids(root).find((k: El) => k.localName === "sectPr");
      for (const n of kids(all(fdoc, "body")[0])) root.insertBefore(doc.importNode(n, true), sect ?? null);
      dayFilled = true;
    }
    zip.file(name, new XMLSerializer().serializeToString(doc));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
