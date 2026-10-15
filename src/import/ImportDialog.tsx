import { useEffect, useMemo, useState } from "react";
import { baseName, fsapi } from "../fsapi";
import { createQualification, listNotes, listQualifications, saveNote, type Note, type Qualification, type Scope } from "../db/repo";
import { parseFile, type ImportedEntry } from "./importer";
import { shortDate, weekdayName } from "../report/types";

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
  useEffect(() => { Promise.all([listQualifications(), listNotes()]).then(([q, n]) => { setQuals(q); setNotes(n); }); }, []);

  const pick = async () => {
    setErrors([]); setDone(null);
    const fs = await fsapi();
    const paths = (await fs.pickFiles()).filter(Boolean);
    if (!paths.length) return;
    const found: Row[] = [];
    const errs: string[] = [];
    for (const p of paths) {
      const name = baseName(p);
      setBusy(`Lese „${name}“ …`);
      try {
        const bytes = await fs.read(p, 60 * 1024 * 1024);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const entries = await parseFile(name, ab, quals.map((q) => q.name));
        if (!entries.length) errs.push(`„${name}“: keine Einträge erkannt.`);
        for (const e of entries) {
          const dup = notes.some((n) => n.date === e.date && norm(n.text) === norm(e.text)) || found.some((f) => f.date === e.date && norm(f.text) === norm(e.text));
          found.push({ ...e, pick: !dup, dup });
        }
      } catch (e) { errs.push(String(e).replace(/^Error:\s*/, "")); }
    }
    setBusy(""); setErrors(errs);
    setRows([...(rows ?? []), ...found].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  };

  const doImport = async () => {
    if (!rows) return;
    setBusy("Übernehme Einträge …");
    const qmap = new Map(quals.map((q) => [q.name.toLowerCase(), q.id]));
    let n = 0;
    for (const r of rows.filter((x) => x.pick)) {
      const qualIds: number[] = [];
      for (const q of r.quals) {
        let id = qmap.get(q.toLowerCase());
        if (!id) { id = await createQualification(q); qmap.set(q.toLowerCase(), id); }
        qualIds.push(id);
      }
      await saveNote({ date: r.date, scope: r.scope, text: r.text, projectId: null, qualIds, personIds: [], attachments: [] });
      n++;
    }
    setBusy(""); setDone(n); setRows(null);
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
