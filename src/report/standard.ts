// Standard-Berichtsheft pro Beruf: wird aus der eingebauten Tageskarten-Vorlage erzeugt (Farben, Titelzeile, Kopfzeile).
// Bewusst ohne Tauri/Vite-Importe, damit das auch in einem Node-Skript läuft (Vorschaubilder).
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { W, all, applyMeta, kids } from "./weekDocx";
import { templateTitle, type BerufProfile } from "../profiles/berufe";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface StandardOpts { kammerText: string }

export async function buildStandardTemplate(base: ArrayBuffer, prof: BerufProfile | null, opts: StandardOpts): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(base);
  let xml = await zip.file("word/document.xml")!.async("string");
  const accent = prof?.accent ?? "1D4E6B", light = prof?.accentLight ?? "4A7DB5";
  xml = xml.replace(/1D4E6B/g, accent).replace(/4A7DB5/g, light);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const body = all(doc, "body")[0];
  const top = kids(body);

  // Titelzeile über dem Kopf: „AUSBILDUNGSNACHWEIS · IHK Düsseldorf“
  const title = templateTitle(prof?.kammer ?? opts.kammerText).toUpperCase() + (opts.kammerText ? "  ·  " + opts.kammerText : "");
  const frag = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:color w:val="${light}"/><w:spacing w:val="30"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(title)}</w:t></w:r></w:p></w:body></w:document>`;
  const fdoc = new DOMParser().parseFromString(frag, "text/xml");
  const header = top.find((k) => k.localName === "tbl");
  if (header) body.insertBefore(doc.importNode(kids(all(fdoc, "body")[0])[0], true), header);

  // Beruf in die Namenszeile
  if (prof) applyMeta(kids(body), { name: "Nachname, Vorname", beruf: [prof.beruf, prof.fachrichtung].filter(Boolean).join(" – "), betrieb: "Ausbildungsbetrieb", ausbilder: "Nachname, Vorname" });

  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
