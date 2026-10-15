// Import alter Berichtshefte (Etappe 9): DOCX und PDF → Notizen
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { W, all, kids, textOf } from "../report/weekDocx";
import { isoDate } from "../report/types";
import type { Scope } from "../db/repo";

export interface ImportedEntry { date: string; text: string; quals: string[]; scope: Scope; source: string }

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const MONTH_RE = new RegExp(`^(${MONTHS.join("|")})\\b`, "i");
const WEEKDAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
const SKIP = /^(anwesenheit|ort \(|anwesend|abwesend|betrieb\s*▾|schule\s*▾|dauer gesamt|datum, unterschrift|hinweise:|einträge auf (tages|wochen)basis|tätigkeit hier eintragen|bitte wählen|qualifikation:\s*(bitte wählen.*)?$)/i;
const PLACE_ONLY = /^(betrieb|schule|schule\/betrieb|urlaub|feiertag|krank|sonstige abwesenheit)\s*▾?$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]+/g, " ").trim();
function matchQual(raw: string, quals: string[]): string {
  const r = norm(raw);
  return quals.find((q) => norm(q) === r) ?? quals.find((q) => norm(q).startsWith(r) || r.startsWith(norm(q))) ?? raw.trim();
}
function yearFrom(lines: string[]): number | null {
  for (const l of lines) {
    const m = l.match(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})\b/);
    if (m) { const y = Number(m[1]); return y < 100 ? 2000 + y : y; }
  }
  return null;
}
const mkDate = (y: number, m: number, d: number) => isoDate(new Date(y, m, d));

/** Allgemeiner Text-Leser: findet Tage (Datum, „12 Oktober“, Wochentag) und die Tätigkeiten darunter */
export function parseLines(lines: string[], quals: string[], source: string, fallbackYear = new Date().getFullYear()): ImportedEntry[] {
  const L = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const year = yearFrom(L) ?? fallbackYear;
  let weekStart: Date | null = null;
  let date: string | null = null;
  let scope: Scope = "arbeit";
  let lastExplicit = -10; // Zeile, in der zuletzt ein ausgeschriebenes Datum stand
  const out: ImportedEntry[] = [];
  // Ort einer Tageskarte steht oft in den Zeilen direkt um das Datum herum („anwesend ▾ Schule ▾“)
  const placeNear = (i: number): Scope => {
    for (let k = Math.max(0, i - 2); k <= Math.min(L.length - 1, i + 3); k++) {
      const t = L[k].replace(/ort \(betrieb\/schule\/…\)/i, "");
      if (/\bschule\s*▾/i.test(t) && !/schule\/betrieb/i.test(t)) return "schule";
    }
    return "arbeit";
  };
  for (let i = 0; i < L.length; i++) {
    let line = L[i];
    if (/^(dauer gesamt|hinweise:|datum, unterschrift)/i.test(line)) { date = null; continue; }
    // Zeitraum einer Woche: „13.07.26 – 19.07.26“
    const range = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*[–-]\s*\d{1,2}\.\d{1,2}\.\d{2,4}/);
    if (range) { const y = Number(range[3]); weekStart = new Date(y < 100 ? 2000 + y : y, Number(range[2]) - 1, Number(range[1])); continue; }
    // Tag als „12“ + nächste Zeile „Oktober“ (Tageskarten) oder „12 Oktober“ / „12. Oktober 2026“
    const dm = line.match(/^(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\b/);
    const dOnly = line.match(/^(\d{1,2})\b/);
    let found = false;
    if (dm && MONTHS.includes(dm[2].toLowerCase())) {
      date = mkDate(year, MONTHS.indexOf(dm[2].toLowerCase()), Number(dm[1])); found = true; lastExplicit = i;
    } else if (dOnly) {
      for (let k = 1; k <= 2 && i + k < L.length; k++) {
        const mm = L[i + k].match(MONTH_RE);
        if (mm) { date = mkDate(year, MONTHS.indexOf(mm[1].toLowerCase()), Number(dOnly[1])); L[i + k] = L[i + k].replace(MONTH_RE, "").trim(); found = true; lastExplicit = i; break; }
      }
    }
    // „Montag, 13.07.2026“ oder „13.07.2026“ am Zeilenanfang
    const full = line.match(/^(?:[A-Za-zäöü]+,?\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
    if (!found && full) { const y = Number(full[3]); date = mkDate(y < 100 ? 2000 + y : y, Number(full[2]) - 1, Number(full[1])); found = true; lastExplicit = i; line = line.slice(full[0].length).trim(); }
    // nur Wochentag nach einem Wochenzeitraum
    const wd = WEEKDAYS.indexOf(line.toLowerCase().replace(/[^a-zäöü]/g, ""));
    if (!found && wd >= 0) {
      // ein Wochentag allein: gehört zum Datum darüber; nur ohne ausgeschriebenes Datum aus dem Wochenzeitraum rechnen
      if (i - lastExplicit <= 3) continue;
      if (weekStart) { const d = new Date(weekStart); d.setDate(d.getDate() + wd); date = isoDate(d); found = true; line = ""; }
    }
    if (found) { scope = placeNear(i); continue; }
    if (!date) continue;
    if (!line) continue;
    if (/^schule\s*▾?/i.test(line) || /▾.*schule/i.test(line)) scope = "schule";
    const q = line.match(/^qualifikation:?\s*(.+)$/i);
    if (q) {
      if (!/bitte wählen/i.test(q[1]) && out.length && out[out.length - 1].date === date) out[out.length - 1].quals.push(matchQual(q[1], quals));
      continue;
    }
    const text = line.replace(/^[•\-–*·▪]\s*/, "").trim();
    if (SKIP.test(text) || PLACE_ONLY.test(text) || /ausbilder:/i.test(text) || /▾/.test(text)) continue;
    if (text.length < 3) continue;
    out.push({ date, text, quals: [], scope, source });
  }
  return out;
}

/* ---------- DOCX ---------- */
export async function parseDocx(bytes: ArrayBuffer, quals: string[], source: string): Promise<ImportedEntry[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("Keine gültige Word-Datei.");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const body = all(doc, "body")[0];
  // Zeilen in Lesereihenfolge: Absätze, auch innerhalb von Tabellen; Dropdown-Werte bleiben als Text erhalten
  const lines: string[] = [];
  const walk = (el: any) => {
    for (const k of kids(el)) {
      if (k.localName === "p") {
        // Datumszelle der Tageskarte: „12“ und „Oktober“ stehen im selben Absatz – als zwei Zeilen behandeln
        const t = textOf(k);
        const m = t.match(/^(\d{1,2})\s*([A-Za-zäöüÄÖÜ]+)$/);
        if (m && MONTHS.includes(m[2].toLowerCase())) { lines.push(m[1], m[2]); continue; }
        if (t.trim()) lines.push(t);
      } else if (["tbl", "tr", "tc", "sdt", "sdtContent"].includes(k.localName)) walk(k);
    }
  };
  walk(body);
  return parseLines(lines, quals, source);
}

/* ---------- PDF ---------- */
export async function parsePdf(bytes: ArrayBuffer, quals: string[], source: string): Promise<ImportedEntry[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Textstücke nach Zeile (y) gruppieren, innerhalb der Zeile nach x sortieren; Spalten (große Lücken) trennen
    const items = (content.items as any[]).filter((it) => "str" in it && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; parts: typeof items }[] = [];
    for (const it of items) {
      const r = rows.find((row) => Math.abs(row.y - it.y) < 3);
      if (r) r.parts.push(it); else rows.push({ y: it.y, parts: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      lines.push(r.parts.map((x) => x.s).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return parseLines(lines, quals, source);
}

export async function parseFile(name: string, bytes: ArrayBuffer, quals: string[]): Promise<ImportedEntry[]> {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx") return parseDocx(bytes, quals, name);
  if (ext === "pdf") return parsePdf(bytes, quals, name);
  throw new Error(`„${name}“: Nur Word (.docx) und PDF werden unterstützt.`);
}
