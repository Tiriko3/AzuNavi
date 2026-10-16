// Erzeugt das Berichtsheft einer Woche im Format deiner IHK-Word-Vorlage.
// Die Vorlage bleibt unverändert, es werden nur Texte und Dropdown-Werte eingesetzt.
// Die Dropdowns (Anwesenheit, Ort, Qualifikation) bleiben in Word weiter auswählbar.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { ABSENT_PLACES, monthName, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "./types";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
type El = any;

const kids = (e: El): El[] => { const out: El[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n); return out; };
const all = (e: El, local: string): El[] => Array.from(e.getElementsByTagNameNS(W, local));
const textOf = (e: El) => all(e, "t").map((t: El) => t.textContent).join("");
const setT = (t: El, s: string) => {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument.createTextNode(s));
  t.setAttribute("xml:space", "preserve");
};
const aliasOf = (sdt: El) => { const a = all(sdt, "alias")[0]; return a ? a.getAttributeNS(W, "val") || a.getAttribute("w:val") || "" : ""; };
const setVal = (el: El, v: string) => el.setAttribute("w:val", v);

/** Liest Beruf und Betrieb aus der Meta-Zeile der Vorlage (für Voreinstellungen) */
export async function readTemplateMeta(template: ArrayBuffer): Promise<Partial<ReportMeta>> {
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const body = all(doc, "body")[0];
  const meta = kids(body).find((k) => k.localName === "p" && textOf(k).includes("Ausbilder:"));
  if (!meta) return {};
  const parts = textOf(meta).split("·").map((s) => s.trim());
  return { beruf: parts[1] ?? "", betrieb: parts[2] ?? "" };
}

/** Meta-Zeile: Name · Beruf · Betrieb · Ausbilder */
export function applyMeta(top: El[], meta: ReportMeta) {
  const metaP = top.find((k) => k.localName === "p" && textOf(k).includes("Ausbilder:"));
  if (!metaP) return;
  const ts = all(metaP, "t");
  const iAus = ts.findIndex((t: El) => (t.textContent || "").includes("Ausbilder:"));
  if (iAus <= 0) return;
  setT(ts[0], meta.name || " ");
  for (let i = 1; i < iAus; i++) setT(ts[i], i === iAus - 1 ? "  ·" : "");
  setT(ts[iAus], `  ${meta.beruf}  ·  ${meta.betrieb}  ·  Ausbilder: `);
  if (ts[iAus + 1]) setT(ts[iAus + 1], meta.ausbilder);
  for (let i = iAus + 2; i < ts.length; i++) setT(ts[i], "");
}

export { W, kids, all, textOf, setT, aliasOf };

/** Tageskarte möglichst nicht über zwei Seiten teilen */
function keepTogether(tbl: El) {
  const doc = tbl.ownerDocument;
  const rows = kids(tbl).filter((k: El) => k.localName === "tr");
  rows.forEach((tr: El, ri: number) => {
    let trPr = kids(tr).find((k: El) => k.localName === "trPr");
    if (!trPr) { trPr = doc.createElementNS(W, "w:trPr"); const first = kids(tr)[0]; tr.insertBefore(trPr, first ?? null); }
    if (!kids(trPr).some((k: El) => k.localName === "cantSplit")) {
      const cs = doc.createElementNS(W, "w:cantSplit");
      const after = kids(trPr).find((k: El) => ["trHeight", "tblHeader", "tblCellSpacing", "jc", "hidden"].includes(k.localName));
      trPr.insertBefore(cs, after ?? null);
    }
    if (ri < rows.length - 1) {
      // Absätze der oberen Zeile mit der nächsten Zeile zusammenhalten
      kids(tr).filter((k: El) => k.localName === "tc").forEach((tc: El) => {
        all(tc, "p").forEach((p: El) => {
          let pPr = kids(p).find((k: El) => k.localName === "pPr");
          if (!pPr) { pPr = doc.createElementNS(W, "w:pPr"); p.insertBefore(pPr, kids(p)[0] ?? null); }
          if (kids(pPr).some((k: El) => k.localName === "keepNext")) return;
          const kn = doc.createElementNS(W, "w:keepNext");
          const ps = kids(pPr).find((k: El) => k.localName === "pStyle");
          pPr.insertBefore(kn, ps ? ps.nextSibling : kids(pPr)[0] ?? null);
        });
      });
    }
  });
}

function fillSdt(sdt: El, value: string, alias: string) {
  all(sdt, "alias").forEach((a: El) => setVal(a, alias));
  all(sdt, "tag").forEach((a: El) => setVal(a, alias));
  const content = all(sdt, "sdtContent")[0];
  const ts = all(content, "t");
  if (ts.length) { setT(ts[0], value); ts.slice(1).forEach((t: El) => setT(t, "")); }
}

/** withQuals = false: keine Qualifikationszeilen und keine Dropdown-Liste (Nutzer hat Qualifikationen abgeschaltet) */
export async function buildWeekDocx(template: ArrayBuffer, draft: WeekDraft, meta: ReportMeta, qualList?: string[], withQuals = true): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const body = all(doc, "body")[0];
  const top = kids(body);
  let nextId = 5000;
  const uniqueIds = (root: El) => all(root, "sdtPr").forEach((pr: El) => all(pr, "id").forEach((i: El) => setVal(i, String(nextId++))));

  /* ---------- Kopf: KW und Datumsbereich ---------- */
  const days = draft.days;
  const header = top.find((k) => k.localName === "tbl")!;
  for (const t of all(header, "t")) {
    const s = t.textContent || "";
    if (s.trim().startsWith("KW")) setT(t, `KW ${draft.week}, `);
    else if (s.includes("–")) { const wd = weekDates(draft.year, draft.week); setT(t, `${shortDate(wd[0])} – ${shortDate(wd[6])}`); }
  }

  applyMeta(top, meta);

  /* ---------- Tageskarten ---------- */
  const dayTables = top.filter((k) => k.localName === "tbl" && all(k, "sdt").some((s: El) => aliasOf(s).startsWith("Anwesenheit Tag")));
  if (!dayTables.length) throw new Error("In der Vorlage wurden keine Tageskarten gefunden.");
  const proto = dayTables[dayTables.length - 1].cloneNode(true);
  const firstDay = dayTables[0];
  const spacerSrc = firstDay.nextSibling && kids(body).includes(firstDay.nextSibling) ? null : null;
  const after = (() => { let n = firstDay.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; })();
  const spacer = after && after.localName === "p" && !textOf(after).trim() ? after.cloneNode(true) : null;
  void spacerSrc;
  const anchor = firstDay;
  const insertBefore = (n: El) => body.insertBefore(n, anchor);

  days.forEach((day, di) => {
    const t = proto.cloneNode(true);
    const rows = kids(t).filter((k: El) => k.localName === "tr");
    // Datum (Tag, Monat) und Wochentag
    const dateCell = kids(rows[0]).filter((k: El) => k.localName === "tc")[0];
    const dps = kids(dateCell).filter((k: El) => k.localName === "p");
    const dts = all(dps[0], "t");
    const dd = day.date.slice(8, 10);
    const digitTs = dts.filter((x: El) => /^\d$/.test((x.textContent || "").trim()));
    if (digitTs.length >= 2) { setT(digitTs[0], dd); setT(digitTs[1], ""); } else if (dts[0]) setT(dts[0], dd);
    const monthT = dts.filter((x: El) => /[A-Za-zÄÖÜäöü]/.test(x.textContent || "")).pop();
    if (monthT) setT(monthT, monthName(day.date));
    if (dps[1]) { const wts = all(dps[1], "t"); if (wts[0]) { setT(wts[0], weekdayName(day.date)); wts.slice(1).forEach((x: El) => setT(x, "")); } }
    // Dropdowns Anwesenheit und Ort
    all(rows[0], "sdt").forEach((s: El) => {
      const a = aliasOf(s);
      if (a.startsWith("Anwesenheit")) fillSdt(s, day.presence, `Anwesenheit Tag ${di + 1}`);
      else if (a.startsWith("Ort")) fillSdt(s, day.place, `Ort Tag ${di + 1}`);
    });
    // Einträge: abwechselnd Tätigkeit und Qualifikation
    const cell = kids(rows[1]).filter((k: El) => k.localName === "tc")[0];
    const ps = kids(cell).filter((k: El) => k.localName === "p");
    const pTask = ps[0], pQual = withQuals ? (ps.find((p: El) => all(p, "sdt").length > 0) ?? ps[1]) : undefined;
    ps.forEach((p: El) => cell.removeChild(p));
    let entries = day.entries.filter((e) => e.text.trim());
    if (!entries.length) {
      entries = ABSENT_PLACES.includes(day.place) ? [{ text: day.place, quals: [] }] : [{ text: "Tätigkeit hier eintragen …", quals: [""] }];
    }
    entries.forEach((e, ei) => {
      const tp = pTask.cloneNode(true);
      const tts = all(tp, "t");
      if (tts[0]) { setT(tts[0], e.text.replace(/\s*\n+\s*/g, "; ").trim()); tts.slice(1).forEach((x: El) => setT(x, "")); }
      cell.appendChild(tp);
      const qs = !pQual ? [] : e.quals.length ? e.quals : ABSENT_PLACES.includes(day.place) ? [] : [""];
      qs.forEach((q, qi) => {
        const qp = pQual.cloneNode(true);
        const sdt = all(qp, "sdt")[0];
        const letter = String.fromCharCode(97 + Math.min(ei, 25));
        if (sdt) fillSdt(sdt, q || "Bitte wählen …", `Qualifikation ${di + 1}${letter}${qi ? qi + 1 : ""}`);
        cell.appendChild(qp);
      });
    });
    keepTogether(t);
    uniqueIds(t);
    insertBefore(t);
    if (spacer && di < days.length - 1) insertBefore(spacer.cloneNode(true));
  });
  // alte Tageskarten und ihre Abstandsabsätze entfernen
  dayTables.forEach((tb) => {
    let n = tb.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling;
    const isLast = tb === dayTables[dayTables.length - 1];
    if (!isLast && n && n.localName === "p" && !textOf(n).trim()) body.removeChild(n);
    body.removeChild(tb);
  });

  // Auswahlliste der Qualifikations-Dropdowns: immer die aktuelle Liste aus der App (auch für andere Berufe)
  if (withQuals && qualList && qualList.length) {
    all(body, "sdt").forEach((sdt: El) => {
      if (!aliasOf(sdt).startsWith("Qualifikation")) return;
      const box = all(sdt, "comboBox")[0] ?? all(sdt, "dropDownList")[0];
      if (!box) return;
      kids(box).filter((k: El) => k.localName === "listItem").forEach((k: El) => box.removeChild(k));
      for (const q of qualList) {
        const li = doc.createElementNS(W, "w:listItem");
        li.setAttribute("w:displayText", q); li.setAttribute("w:value", q);
        box.appendChild(li);
      }
    });
  }
  // Ohne Qualifikationen soll auch der Hinweistext am Ende sie nicht erwähnen
  if (!withQuals) {
    for (const k of kids(body)) {
      if (k.localName !== "p" || !/^Hinweise:/.test(textOf(k).trim()) || !/Qualifikation/.test(textOf(k))) continue;
      const ts = all(k, "t");
      if (ts.length) { setT(ts[0], "Hinweise: Anwesenheit und Ort per Klick auf das Feld auswählen (Dropdown). Überflüssige Tätigkeitszeilen löschen, weitere per Kopieren/Einfügen ergänzen. Für die nächste Woche das Dokument kopieren und KW sowie Daten anpassen."); ts.slice(1).forEach((t: El) => setT(t, "")); }
    }
  }
  const out = new XMLSerializer().serializeToString(doc);
  zip.file("word/document.xml", out);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
