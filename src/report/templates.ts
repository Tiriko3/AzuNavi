// Berichtsheft-Vorlagen (Etappe 9): eigene Vorlage hochladen, erkennen, Qualifikationen übernehmen
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import bundledUrl from "../assets/berichtsheft-vorlage.docx?url";
import tagesUrl from "../assets/vorlagen/tagesnachweis.docx?url";
import hhuUrl from "../assets/vorlagen/hhu-wochenbericht.pdf?url";
import { appRead, appWrite } from "../storage/appFiles";
import { isWebApp } from "../platform";
import { getSetting, inTauri, setSetting } from "../db/db";
import { W, all, kids, setT, textOf } from "./weekDocx";
import { ABSENT_PLACES, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";
import { findProfile, type BerufProfile } from "../profiles/berufe";
import { buildStandardTemplate } from "./standard";
import { makeEmptyCopy } from "./freeTemplate";

// karten = Tageskarten wie die IHK-Vorlage, platzhalter = Word mit {{…}}, frei = jedes andere Layout (wird als Rahmen benutzt)
export type TemplateKind = "karten" | "platzhalter" | "frei" | "pdf";
/** Eingebaute Vorlagen zur Auswahl: IHK-Tageskarten (Standard), Tagesnachweis mit Stunden (Word), Wochenbericht öffentlicher Dienst (PDF-Formular) */
export type BuiltinId = "ihk" | "tagesnachweis" | "hhu";
export const BUILTINS: { id: BuiltinId; label: string; hinweis: string; ext: "docx" | "pdf" }[] = [
  { id: "ihk", label: "IHK-Tageskarten", hinweis: "Standard: Word-Datei mit einer Karte pro Tag und Qualifikationen zum Wählen. Für IHK-Berufe, auch für Mediengestaltung.", ext: "docx" },
  { id: "tagesnachweis", label: "Tagesnachweis mit Stunden", hinweis: "Word-Tabelle Montag bis Freitag mit Spalte „Stunden“ (zum Ausfüllen), Kopf mit Name, Jahr, Abteilung und Woche.", ext: "docx" },
  { id: "hhu", label: "Wochenbericht öffentlicher Dienst (PDF-Formular)", hinweis: "Das PDF-Formular der HHU: Tage, Berufsschule und Unterweisungen werden direkt in die Felder geschrieben. Du kannst danach im PDF weiterschreiben und unterschreiben.", ext: "pdf" },
];
export const getBuiltinId = async (): Promise<BuiltinId> => { const v = (await getSetting("template_id")) ?? "ihk"; return (BUILTINS.some((b) => b.id === v) ? v : "ihk") as BuiltinId; };
export const setBuiltinId = (id: BuiltinId) => setSetting("template_id", id);
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
  const kind: TemplateKind = /w:alias w:val="Anwesenheit Tag/.test(xml) ? "karten" : placeholders.length ? "platzhalter" : "frei";
  return { kind, quals, placeholders };
}

export async function saveCustomTemplate(bytes: ArrayBuffer) {
  if (inTauri || isWebApp) await appWrite(CUSTOM, new Uint8Array(bytes));
  else memCustom = bytes;
  await setSetting("custom_template", "1");
}
export async function useBundledTemplate(id: BuiltinId = "ihk") { await setSetting("custom_template", "0"); await setBuiltinId(id); }

/** Profil des Nutzers (Beruf + Fachrichtung) – null bei anderem Beruf */
export async function activeProfile(): Promise<BerufProfile | null> {
  return findProfile((await getSetting("profile_beruf")) ?? "", (await getSetting("profile_fachrichtung")) ?? "");
}

/** Standard-Vorlage für einen Beruf (Farben, Titelzeile, Kopfzeile). Bei Profil = null: neutrale IHK-Vorlage. */
export async function standardTemplateFor(prof: BerufProfile | null, kammerText: string): Promise<ArrayBuffer> {
  const base = await (await fetch(bundledUrl)).arrayBuffer();
  return buildStandardTemplate(base, prof, { kammerText });
}

/** Aktive Vorlage: deine hochgeladene, sonst die Standard-Vorlage deines Berufs */
export async function loadActiveTemplate(): Promise<{ bytes: ArrayBuffer; custom: boolean; info: TemplateInfo; profile: BerufProfile | null; builtin: BuiltinId }> {
  let bytes: ArrayBuffer | null = null;
  if ((await getSetting("custom_template")) === "1") {
    try {
      if (inTauri || isWebApp) { const u = await appRead(CUSTOM); bytes = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; }
      else bytes = memCustom;
    } catch { bytes = null; }
  }
  const custom = !!bytes;
  const profile = await activeProfile();
  const builtin = custom ? "ihk" : await getBuiltinId();
  if (!bytes && builtin === "hhu") return { bytes: await (await fetch(hhuUrl)).arrayBuffer(), custom: false, info: { kind: "pdf", quals: [], placeholders: [] }, profile, builtin };
  if (!bytes && builtin === "tagesnachweis") bytes = await (await fetch(tagesUrl)).arrayBuffer();
  if (!bytes) bytes = await standardTemplateFor(profile, (await getSetting("bh_kammer")) ?? "");
  return { bytes, custom, info: await analyzeTemplate(bytes), profile, builtin };
}

/**
 * Hochgeladene Datei als Vorlage übernehmen. Wird nichts abgelehnt:
 * Tageskarten und Platzhalter-Vorlagen gehen so durch, jedes andere Layout wird (auf Wunsch) zur leeren Kopie.
 */
export async function adoptTemplate(bytes: ArrayBuffer, emptyIfFree = true, name = ""): Promise<TemplateKind> {
  const info = await analyzeTemplate(bytes);
  const out = info.kind === "frei" && emptyIfFree ? await makeEmptyCopy(bytes) : bytes;
  await saveCustomTemplate(out);
  if (name) await setSetting("custom_template_name", name);
  return info.kind;
}

export { buildPlaceholderDocx, PLACEHOLDER_HELP } from "./placeholderDocx";
