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
/** LaTeX-PDFs trennen den Umlaut vom Buchstaben („t¨aglich“, „Uber“ mit „¨“ in der Zeile davor oder danach). Das hier flickt, was sich sicher flicken lässt. */
export function fixLatexUmlauts(s: string): string {
  const MAP: Record<string, string> = { a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" };
  let t = s.replace(/¨\s?([aouAOU])/g, (_, c) => MAP[c]);          // „¨a“ → „ä“
  t = t.replace(/\b(Uber|Ubung|Ubungen|Ubersicht|Ubernahme)(?=[a-zäöüß]|\b)/g, (m) => "Ü" + m.slice(1)); // Wortanfang: „Uber“ gibt es im Deutschen nicht
  t = t.replace(/\bAnder(ung|ungen|n|t|te|ten)\b/g, (_, e) => "Änder" + e);
  t = t.replace(/\bOffentlich(e|en|er|es|keit)?\b/g, (_, e) => "Öffentlich" + (e ?? ""));
  return t.replace(/¨/g, "").replace(/\s{2,}/g, " ").trim();      // übrig gebliebene lose Zeichen entfernen
}

const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const PLAIN_PLACES = /^(schule|berufsschule|urlaub|feiertag|krank|ferien|sommerferien|gleitzeit|frei)\b/i;
/** Text eines Tages in einzelne Tätigkeiten zerlegen („- …“-Zeilen; Zeilen ohne Strich, die klein oder mit „(“ beginnen, hängen am Vorgänger) */
function splitTasks(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, "\n").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim(); if (!line) continue;
    const bullet = /^[•\-–*·▪]\s*/.test(line);
    const clean = line.replace(/^[•\-–*·▪]\s*/, "").trim();
    if (!bullet && out.length && /^[a-zäöü(]/.test(clean)) out[out.length - 1] += " " + clean;
    else out.push(clean);
  }
  return out.filter((x) => x.length >= 3);
}
const parseDeDate = (s: string): Date | null => { const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})/); if (!m) return null; const y = Number(m[3]); return new Date(y < 100 ? 2000 + y : y, Number(m[2]) - 1, Number(m[1])); };

/**
 * PDF-Formular (HHU: „Wochenbericht“ und „Fachbericht“). Die Einträge stehen in Formularfeldern und NICHT im sichtbaren Text,
 * deshalb hat der alte Import hier nichts gefunden. Felder: Montagsaufgaben … Freitagsaufgaben, Datum1 … Datum5, Berufsschule, Fließtext …
 */
export function isHhuForm(f: Record<string, string>) { return "Montagsaufgaben" in f || "Fließtext" in f || "Freitagsaufgaben" in f; }
export function parseHhuForm(f: Record<string, string>, source: string, now = new Date()): ImportedEntry[] {
  const out: ImportedEntry[] = [];
  if ("Fließtext" in f) {   // Fachbericht: eine Notiz mit dem ganzen Bericht
    const body = (f["Fließtext"] || "").replace(/\s+\n/g, "\n").trim();
    if (body) {
      const mon = (f["Monat"] || "").toLowerCase(); const mi = MONTHS.findIndex((m) => mon.includes(m));
      const y = Number((mon.match(/\d{4}/) ?? [])[0]) || now.getFullYear();
      const date = mi >= 0 ? mkDate(y, mi, 1) : isoDate(now);
      out.push({ date, text: `Fachbericht${f["Ausbildungsthema"] ? " – " + f["Ausbildungsthema"].replace(/^[\s\-–•]+/, "").trim() : ""}: ${body}`, quals: [], scope: "arbeit", source });
    }
    return out;
  }
  const start = parseDeDate((f["Zeitraum"] || "").split(/[–-]/)[0] ?? "");
  const dayDate = (i: number): string | null => {
    const d = parseDeDate(f[`Datum${i + 1}`] || ""); if (d) return isoDate(d);
    if (start) { const x = new Date(start); x.setDate(x.getDate() + i); return isoDate(x); }
    return null;
  };
  const schoolDays: string[] = [];
  WEEKDAY_NAMES.forEach((name, i) => {
    const date = dayDate(i); if (!date) return;
    const lines = splitTasks(f[`${name}saufgaben`] || "");
    let school = false;
    for (const t of lines) {
      if (PLAIN_PLACES.test(t) && t.length <= 40) { if (/schule/i.test(t)) school = true; continue; }   // „Berufsschule (ganztägig)“, „Urlaub“ = Ort, keine Tätigkeit
      out.push({ date, text: t, quals: [], scope: "arbeit", source });
    }
    if (school) schoolDays.push(date);
  });
  // Berufsschule-Feld: mit Tagesüberschriften („*Dienstag:“) oder als eine Liste ohne Tage
  const bs = (f["Berufsschule"] || "").split("\n").filter((l) => !/^\s*[/\-–]?\s*$/.test(l) && !PLAIN_PLACES.test(l.trim().replace(/^[-–•*\s]+/, "")) ).join("\n").trim();
  if (bs) {
    const parts = bs.split(/^\s*\*?\s*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag)\s*:?\s*$/im);
    if (parts.length > 1) {
      for (let k = 1; k < parts.length; k += 2) {
        const date = dayDate(WEEKDAY_NAMES.indexOf(parts[k].charAt(0).toUpperCase() + parts[k].slice(1).toLowerCase()));
        if (date) for (const t of splitTasks(parts[k + 1] || "")) out.push({ date, text: t, quals: [], scope: "schule", source });
      }
    } else {
      const date = schoolDays[0] ?? dayDate(0);
      if (date) for (const t of splitTasks(bs)) out.push({ date, text: t, quals: [], scope: "schule", source });
    }
  }
  return out;
}

/**
 * LaTeX-Vorlage „Ausbildungsnachweis (täglich)“ mit Stundenspalte: „Ausbildungswoche von 03.08.2026 bis 07.08.2026“,
 * danach „Montag <Text> … <Stunden>“. Ein Tag steht als Fließtext, deshalb wird er satzweise in Tätigkeiten zerlegt.
 */
export function parseTagesnachweis(lines: string[], source: string): ImportedEntry[] {
  // Trennstriche am Zeilenende („An- schließend“) zusammenziehen, aber „Wiki- und“ in Ruhe lassen
  const L = lines.map((l) => fixLatexUmlauts(l)).filter(Boolean);
  const out: ImportedEntry[] = [];
  let mon: Date | null = null, cur = -1; let texts: string[][] = [];
  const flush = () => {
    if (!mon) return;
    texts.forEach((ls, i) => {
      const day = new Date(mon!); day.setDate(mon!.getDate() + i); const date = isoDate(day);
      const joined = ls.join(" ").replace(/([A-Za-zÄÖÜäöüß]{1,6})-\s+(?!und\b|oder\b|bzw\b|sowie\b|bis\b)([a-zäöüß])/g, "$1$2").replace(/([A-Za-zÄÖÜäöüß]{2,}-)\s+(?=[A-ZÄÖÜ])/g, "$1").replace(/\s+/g, " ");
      for (const t of joined.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/).map((x) => x.trim()).filter((x) => x.length >= 8)) out.push({ date, text: t, quals: [], scope: "arbeit", source });
    });
  };
  for (const raw of L) {
    const line = raw.trim();
    const von = line.match(/^von\s+(\d{1,2}\.\d{1,2}\.\d{4})\b/i);
    if (von) { flush(); mon = parseDeDate(von[1]); texts = [[], [], [], [], []]; cur = -1; continue; }
    if (!mon) continue;
    if (/^Durch die nachfolgende Unterschrift/i.test(line)) { flush(); mon = null; cur = -1; continue; }
    if (/^(Ausbildungswoche|Ausbildungsmonat|Ausbildungsnachweis|Ausbildungsjahr|bis\s+\d|Wochentag\b|sonstige Schulungen|Stunden$|Name des|Ggf\.|Betriebliche T|Datum, Unterschrift)/i.test(line)) continue;
    const w = WEEKDAY_NAMES.findIndex((n) => line.startsWith(n + " ") || line === n);
    let t = line;
    if (w >= 0) { cur = w; t = line.slice(WEEKDAY_NAMES[w].length).trim(); }
    if (cur < 0 || !t) continue;
    texts[cur].push(t);
  }
  flush();
  return out;
}

/** Gemeinsame Logik für Browser und Test: bekommt ein geladenes pdf.js-Dokument */
export async function parsePdfDoc(pdf: { numPages: number; getPage(n: number): Promise<any> }, quals: string[], source: string): Promise<ImportedEntry[]> {
  const lines: string[] = [];
  const hourFree: string[] = [];
  const fields: Record<string, string> = {};
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    // Formularfelder: stehen nicht im sichtbaren Text
    try {
      for (const a of (await page.getAnnotations()) as any[]) {
        if (a.subtype !== "Widget" || !a.fieldName) continue;
        const v = Array.isArray(a.fieldValue) ? a.fieldValue.join("\n") : String(a.fieldValue ?? "");
        if (v.trim() && !(a.fieldName in fields)) fields[a.fieldName] = v;
      }
    } catch { /* ohne Felder weiter mit dem Text */ }
    const content = await page.getTextContent();
    // Textstücke nach Zeile (y) gruppieren, innerhalb der Zeile nach x sortieren; Spalten (große Lücken) trennen
    const items = (content.items as any[]).filter((it) => "str" in it && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    const pageW: number = page.view?.[2] ?? 595;
    const build = (src: typeof items) => {
      const sorted = [...src].sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: { y: number; parts: typeof items }[] = [];
      for (const it of sorted) {
        const r = rows.find((row) => Math.abs(row.y - it.y) < 3);
        if (r) r.parts.push(it); else rows.push({ y: it.y, parts: [it] });
      }
      rows.sort((a, b) => b.y - a.y);
      return rows.map((r) => { r.parts.sort((a, b) => a.x - b.x); return r.parts.map((x) => x.s).join(" ").replace(/\s+/g, " ").trim(); });
    };
    lines.push(...build(items));
    // Stundenspalte ganz rechts (nur Zahlen) für das Tagesnachweis-Layout getrennt behalten
    hourFree.push(...build(items.filter((it) => !(/^\d{1,2}([,.]\d)?$/.test(it.s.trim()) && it.x > pageW * 0.75))));
  }
  if (isHhuForm(fields)) return parseHhuForm(fields, source);
  if (lines.some((l) => /^Ausbildungswoche\b/i.test(l)) && lines.some((l) => /^von\s+\d/i.test(l))) { const t = parseTagesnachweis(hourFree, source); if (t.length) return t; }
  return parseLines(lines, quals, source);
}

export async function parsePdf(bytes: ArrayBuffer, quals: string[], source: string): Promise<ImportedEntry[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  return parsePdfDoc(pdf, quals, source);
}

export async function parseFile(name: string, bytes: ArrayBuffer, quals: string[]): Promise<ImportedEntry[]> {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx") return parseDocx(bytes, quals, name);
  if (ext === "pdf") return parsePdf(bytes, quals, name);
  throw new Error(`„${name}“: Nur Word (.docx) und PDF werden unterstützt.`);
}
