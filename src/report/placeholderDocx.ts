// Vorlagen mit Platzhaltern ausfüllen. Bewusst ohne Tauri/Vite-Importe, damit es auch in Tests (Node) läuft.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { W, all, kids, setT, textOf } from "./weekDocx";
import { ABSENT_PLACES, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";

/* ---------- Vorlagen mit Platzhaltern ---------- */
// Unterstützt: {{NAME}} {{BERUF}} {{BETRIEB}} {{AUSBILDER}} {{KAMMER}} {{KW}} {{JAHR}} {{ZEITRAUM}} {{WOCHE}}
// und pro Tag {{MONTAG}} … {{SONNTAG}} (Tätigkeiten), {{MONTAG_DATUM}}, {{MONTAG_ORT}}, {{MONTAG_ANWESENHEIT}}
const longDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const DAYNAMES = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"];
export const PLACEHOLDER_HELP = ["NAME", "BERUF", "BETRIEB", "AUSBILDER", "KAMMER", "KW", "JAHR", "ZEITRAUM", "VON", "BIS", "WOCHE", ...DAYNAMES, "MONTAG_DATUM", "MONTAG_ORT", "MONTAG_STUNDEN"];

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
    VON: longDate(dates[0]), BIS: longDate(dates[4]),
    WOCHE: draft.days.map((d) => `${weekdayName(d.date)}, ${shortDate(d.date)}:\n${entryText(d) || "–"}`).join("\n"),
  };
  DAYNAMES.forEach((n, i) => {
    const d = draft.days.find((x) => x.date === dates[i]);
    vals[n] = entryText(d); vals[n + "_DATUM"] = shortDate(dates[i]);
    vals[n + "_ORT"] = d?.place ?? ""; vals[n + "_ANWESENHEIT"] = d?.presence ?? ""; vals[n + "_STUNDEN"] = "";   // Stunden trägst du selbst ein (die App führt bewusst keine Dauer)
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
