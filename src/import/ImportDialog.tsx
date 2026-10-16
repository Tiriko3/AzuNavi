import { useEffect, useMemo, useState } from "react";
import { baseName, fsapi } from "../fsapi";
import { createQualification, listNotes, listQualifications, saveNote, type Note, type Qualification, type Scope } from "../db/repo";
import { parseFile, type ImportedEntry } from "./importer";
import { shortDate, weekdayName } from "../report/types";
import { adoptTemplate, loadActiveTemplate } from "../report/templates";
import { qualsEnabled } from "../report/quals";

interface Row extends ImportedEntry { pick: boolean; dup: boolean }
const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]+/g, " ").trim();

/** Alte Berichtshefte (DOCX/PDF) einlesen, Vorschau zeigen, als Notizen übernehmen */
export function ImportDialog({ onClose, inline }: { onClose: (imported: number) => void; inline?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [docxs, setDocxs] = useState<{ name: string; bytes: ArrayBuffer }[]>([]);   // gelesene Word-Dateien (für „leere Vorlage daraus machen“)
  const [offer, setOffer] = useState<{ pick: number } | null>(null);
  const [tplMsg, setTplMsg] = useState("");
  useEffect(() => { Promise.all([listQualifications(), listNotes()]).then(([q, n]) => { setQuals(q); setNotes(n); }); }, []);

  const pick = async () => {
    setErrors([]); setDone(null);
    const fs = await fsapi();
    const paths = (await fs.pickFiles()).filter(Boolean);
    if (!paths.length) return;
    const found: Row[] = [];
    const errs: string[] = [];
    const words: { name: string; bytes: ArrayBuffer }[] = [];
    for (const p of paths) {
      const name = baseName(p);
      setBusy(`Lese „${name}“ …`);
      try {
        const bytes = await fs.read(p, 60 * 1024 * 1024);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        if (/\.docx$/i.test(name)) words.push({ name, bytes: ab });
        const entries = await parseFile(name, ab, quals.map((q) => q.name));
        if (!entries.length) errs.push(`„${name}“: keine Einträge erkannt.`);
        for (const e of entries) {
          const dup = notes.some((n) => n.date === e.date && norm(n.text) === norm(e.text)) || found.some((f) => f.date === e.date && norm(f.text) === norm(e.text));
          found.push({ ...e, pick: !dup, dup });
        }
      } catch (e) { errs.push(String(e).replace(/^Error:\s*/, "")); }
    }
    setBusy(""); setErrors(errs);
    if (words.length) setDocxs((d) => [...d, ...words]);
    setRows([...(rows ?? []), ...found].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  };

  const doImport = async () => {
    if (!rows) return;
    setBusy("Übernehme Einträge …");
    const qmap = new Map(quals.map((q) => [q.name.toLowerCase(), q.id]));
    const useQ = await qualsEnabled();            // Qualifikationen ausgeschaltet: aus dem Import nichts übernehmen
    let n = 0;
    for (const r of rows.filter((x) => x.pick)) {
      const qualIds: number[] = [];
      for (const q of useQ ? r.quals : []) {
        let id = qmap.get(q.toLowerCase());
        if (!id) { id = await createQualification(q); qmap.set(q.toLowerCase(), id); }
        qualIds.push(id);
      }
      await saveNote({ date: r.date, scope: r.scope, text: r.text, projectId: null, qualIds, personIds: [], attachments: [] });
      n++;
    }
    setBusy(""); setDone(n); setRows(null);
    // Alte Berichtshefte als Word da und noch die Standard-Vorlage aktiv? Dann anbieten, daraus eine leere Vorlage zu machen.
    try { if (docxs.length && !(await loadActiveTemplate()).custom) setOffer({ pick: 0 }); } catch { /* Angebot ist optional */ }
  };
  const useAsTemplate = async () => {
    if (!offer) return;
    const f = docxs[offer.pick]; if (!f) return;
    setBusy("Erstelle die leere Vorlage …");
    try { await adoptTemplate(f.bytes, true, f.name); setTplMsg(`Fertig: „${f.name}“ ist jetzt deine Vorlage (Text entfernt, Layout bleibt). Du siehst sie unter System.`); setOffer(null); }
    catch (e) { setErrors([String(e).replace(/^Error:\s*/, "")]); }
    setBusy("");
  };

  const groups = useMemo(() => {
    const m = new Map<string, number[]>();
    (rows ?? []).forEach((r, i) => { const a = m.get(r.date) ?? []; a.push(i); m.set(r.date, a); });
    return [...m.entries()];
  }, [rows]);
  const picked = rows?.filter((r) => r.pick).length ?? 0;
  const upd = (i: number, x: Partial<Row>) => setRows((rs) => rs!.map((r, k) => (k === i ? { ...r, ...x } : r)));

  const body = (
    <div className={"impbox" + (inline ? " inline" : " paperbox")}>
      {!inline && <h3>Berichtshefte importieren</h3>}
      <p className="small">Wähle alte Berichtshefte als <b>Word (.docx)</b> oder <b>PDF</b>, auch mehrere auf einmal. Ich lese Datum, Tätigkeiten, Qualifikationen und Ort heraus. Du siehst alles vorher und entscheidest, was übernommen wird. Die Originaldateien bleiben unverändert.</p>
      <div className="inl">
        <button className="btn" onClick={pick} disabled={!!busy}><span>{rows ? "Weitere Dateien" : "Dateien wählen"}</span></button>
        {busy && <span className="small">{busy}</span>}
        {done !== null && <span className="flash inline">{done} Notizen übernommen</span>}
      </div>
      {errors.map((e, i) => <div key={i} className="errbox">{e}</div>)}
      {tplMsg && <div className="tutnote ok">{tplMsg}</div>}
      {offer && (
        <div className="tutnote tploffer">
          <b>Aus deinem alten Berichtsheft eine leere Vorlage machen?</b>
          <p>Ich kopiere die Datei, entferne den Text und nehme das Layout als deine Vorlage. Wenn nicht, bleibt die Standard-Vorlage.</p>
          {docxs.length > 1 && (
            <select className="field mini-select" value={offer.pick} onChange={(e) => setOffer({ pick: Number(e.target.value) })}>
              {docxs.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
            </select>
          )}
          <div className="inl">
            <button className="btn" onClick={useAsTemplate} disabled={!!busy}><span>Ja, leere Kopie als Vorlage</span></button>
            <button className="mini" onClick={() => setOffer(null)}>Nein, Standard behalten</button>
          </div>
        </div>
      )}
      {rows && (
        <>
          <div className="imprev">
            {groups.map(([date, idx]) => (
              <div key={date} className="impday">
                <b>{weekdayName(date)}, {shortDate(date)}</b>
                {idx.map((i) => {
                  const r = rows[i];
                  return (
                    <label key={i} className={"improw" + (r.dup ? " dup" : "") + (r.pick ? "" : " off")}>
                      <input type="checkbox" checked={r.pick} onChange={(e) => upd(i, { pick: e.target.checked })} />
                      <button type="button" className={"tag " + r.scope} onClick={(e) => { e.preventDefault(); upd(i, { scope: (r.scope === "arbeit" ? "schule" : "arbeit") as Scope }); }}>
                        {r.scope === "arbeit" ? "Arbeit" : "Schule"}</button>
                      <span className="imptext">{r.text}{r.quals.length > 0 && <small>{r.quals.join(" · ")}</small>}</span>
                      {r.dup && <i className="impdup">schon da</i>}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="actions static">
            <button className="btn" onClick={doImport} disabled={!picked || !!busy}><span>{picked} {picked === 1 ? "Eintrag" : "Einträge"} übernehmen</span></button>
            <button className="btn ghost" onClick={() => setRows(null)}><span>Verwerfen</span></button>
            {!inline && <button className="mini" onClick={() => onClose(done ?? 0)}>Schließen</button>}
          </div>
        </>
      )}
      {!rows && !inline && <div className="actions static"><button className="btn ghost" onClick={() => onClose(done ?? 0)}><span>Schließen</span></button></div>}
    </div>
  );
  return inline ? body : <div className="fmodal impmodal">{body}</div>;
}
