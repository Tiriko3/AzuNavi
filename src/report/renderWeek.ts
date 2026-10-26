// Eine Woche in die aktive Vorlage schreiben (gemeinsam für PC/Web und Handy)
import { buildWeekDocx } from "./weekDocx";
import { buildFreeDocx } from "./freeTemplate";
import { buildPlaceholderDocx, standardTemplateFor, type TemplateInfo } from "./templates";
import type { BerufProfile } from "../profiles/berufe";
import type { ReportMeta, WeekDraft } from "./types";

type Tpl = { bytes: ArrayBuffer; info: TemplateInfo; profile: BerufProfile | null };

export async function renderWeek(tpl: Tpl, draft: WeekDraft, meta: ReportMeta, kammer: string, qualNames: string[], useQ: boolean): Promise<{ bytes: Uint8Array; ext: "docx" | "pdf"; label: string }> {
  if (tpl.info.kind === "pdf") {
    const { buildHhuPdf } = await import("./hhuPdf");   // pdf-lib wird nur geladen, wenn es gebraucht wird
    return { bytes: await buildHhuPdf(tpl.bytes, draft, meta), ext: "pdf", label: "PDF-Dokument" };
  }
  const bytes = tpl.info.kind === "platzhalter" ? await buildPlaceholderDocx(tpl.bytes, draft, { ...meta, kammer })
    : tpl.info.kind === "frei" ? await buildFreeDocx(tpl.bytes, draft, { ...meta, kammer }, { quals: useQ, kammer })
    : await buildWeekDocx(tpl.bytes, draft, meta, qualNames, useQ);
  return { bytes, ext: "docx", label: "Word-Dokument" };
}

/** Die Fähigkeiten-Übersicht ist immer ein Word-Dokument. Bei einer PDF-Vorlage nimmt sie die IHK-Standard-Vorlage als Grundlage. */
export async function skillsBase(tpl: Tpl, kammer: string): Promise<ArrayBuffer> {
  return tpl.info.kind === "pdf" ? standardTemplateFor(tpl.profile, kammer) : tpl.bytes;
}
