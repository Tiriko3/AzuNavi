// Berichtsheft-Vorlagen (Etappe 9): eigene Vorlage hochladen, erkennen, Qualifikationen übernehmen
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import bundledUrl from "../assets/berichtsheft-vorlage.docx?url";
import { BaseDirectory, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getSetting, inTauri, setSetting } from "../db/db";
import { W, all, kids, setT, textOf } from "./weekDocx";
import { ABSENT_PLACES, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";

export type TemplateKind = "karten" | "platzhalter" | "unbekannt";
export interface TemplateInfo { kind: TemplateKind; quals: string[]; placeholders: string[] }
const CUSTOM = "templates/vorlage.docx";
let memCustom: ArrayBuffer | null = null; // nur Browser-Test

export async function analyzeTemplate(bytes: ArrayBuffer): Promise<TemplateInfo> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("Das ist keine gültige Word-Datei (.docx).");
  const xml = await f.async("string");
  const quals: string[] = [];
  const sdtRe = /<w:sdt>[\s\S]*?<\/w:sdt>/g;
  let m: RegExpExecArray | null;
  while ((m = sdtRe.exec(xml))) {
    if (!/w:alias w:val="Qualifikation/.test(m[0])) continue;
    for (const li of m[0].matchAll(/<w:listItem[^>]*w:displayText="([^"]*)"/g)) {
      const name = li[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      if (name && !quals.includes(name) && !/bitte wählen/i.test(name)) quals.push(name);
    }
  }
  const plain = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("") + "\n");
  const placeholders = [...new Set([...plain.matchAll(/\{\{\s*([A-Za-zÄÖÜäöü_0-9]+)\s*\}\}/g)].map((x) => x[1].toUpperCase()))];
  const kind: TemplateKind = /w:alias w:val="Anwesenheit Tag/.test(xml) ? "karten" : placeholders.length ? "platzhalter" : "unbekannt";
  return { kind, quals, placeholders };
}

export async function saveCustomTemplate(bytes: ArrayBuffer) {
  if (inTauri) {
    await mkdir("templates", { baseDir: BaseDirectory.AppData, recursive: true });
    await writeFile(CUSTOM, new Uint8Array(bytes), { baseDir: BaseDirectory.AppData });
  } else memCustom = bytes;
  await setSetting("custom_template", "1");
}
export async function useBundledTemplate() { await setSetting("custom_template", "0"); }

/** Aktive Vorlage: deine hochgeladene, sonst die eingebaute IHK-Vorlage */
export async function loadActiveTemplate(): Promise<{ bytes: ArrayBuffer; custom: boolean; info: TemplateInfo }> {
  let bytes: ArrayBuffer | null = null;
  if ((await getSetting("custom_template")) === "1") {
    try {
      if (inTauri) { const u = await readFile(CUSTOM, { baseDir: BaseDirectory.AppData }); bytes = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; }
      else bytes = memCustom;
    } catch { bytes = null; }
  }
  const custom = !!bytes;
  if (!bytes) bytes = await (await fetch(bundledUrl)).arrayBuffer();
  return { bytes, custom, info: await analyzeTemplate(bytes) };
}

/* ---------- Vorlagen mit Platzhaltern ---------- */
// Unterstützt: {{NAME}} {{BERUF}} {{BETRIEB}} {{AUSBILDER}} {{KAMMER}} {{KW}} {{JAHR}} {{ZEITRAUM}} {{WOCHE}}
// und pro Tag {{MONTAG}} … {{SONNTAG}} (Tätigkeiten), {{MONTAG_DATUM}}, {{MONTAG_ORT}}, {{MONTAG_ANWESENHEIT}}
const DAYNAMES = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"];
export const PLACEHOLDER_HELP = ["NAME", "BERUF", "BETRIEB", "AUSBILDER", "KAMMER", "KW", "JAHR", "ZEITRAUM", "WOCHE", ...DAYNAMES, "MONTAG_DATUM", "MONTAG_ORT"];

export async function buildPlaceholderDocx(template: ArrayBuffer, draft: WeekDraft, meta: ReportMeta & { kammer?: string }): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const dates = weekDates(draft.year, draft.week);
  const entryText = (d?: WeekDraft["days"][number]) => {
    if (!d) return "";
    if (!d.entries.length) return ABSENT_PLACES.includes(d.place) ? d.place : "";
    return d.entries.map((e) => "• " + e.text.replace(/\s*\n+\s*/g, "; ") + (e.quals.length ? ` (${e.quals.join("; ")})` : "")).join("\n");
  };
  const vals: Record<string, string> = {
    NAME: meta.name, BERUF: meta.beruf, BETRIEB: meta.betrieb, AUSBILDER: meta.ausbilder, KAMMER: meta.kammer ?? "",
    KW: String(draft.week), JAHR: String(draft.year), ZEITRAUM: `${shortDate(dates[0])} – ${shortDate(dates[6])}`,
    WOCHE: draft.days.map((d) => `${weekdayName(d.date)}, ${shortDate(d.date)}:\n${entryText(d) || "–"}`).join("\n"),
  };
  DAYNAMES.forEach((n, i) => {
    const d = draft.days.find((x) => x.date === dates[i]);
    vals[n] = entryText(d); vals[n + "_DATUM"] = shortDate(dates[i]);
    vals[n + "_ORT"] = d?.place ?? ""; vals[n + "_ANWESENHEIT"] = d?.presence ?? "";
  });
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
    const doc = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "text/xml");
    for (const p of all(doc, "p")) {
      const text = textOf(p);
      if (!text.includes("{{")) continue;
      const replaced = text.replace(/\{\{\s*([A-Za-zÄÖÜäöü_0-9]+)\s*\}\}/g, (_, k) => vals[String(k).toUpperCase()] ?? "");
      const ts = all(p, "t");
      const lines = replaced.split("\n");
      setT(ts[0], lines[0]); ts.slice(1).forEach((t: any) => setT(t, ""));
      const run = ts[0].parentNode;
      let after = run;
      for (const line of lines.slice(1)) {
        const r = run.cloneNode(true);
        kids(r).filter((k: any) => k.localName === "t").forEach((t: any, i: number) => { if (i) r.removeChild(t); });
        const t = kids(r).find((k: any) => k.localName === "t");
        r.insertBefore(doc.createElementNS(W, "w:br"), t);
        setT(t, line);
        run.parentNode.insertBefore(r, after.nextSibling);
        after = r;
      }
    }
    zip.file(name, new XMLSerializer().serializeToString(doc));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
