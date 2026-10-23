// Notizen auf dem Handy: Liste nach Tagen, Suche, Bearbeiten im Blatt (Datum, Bereich, Text, Projekt, Personen, Qualifikationen, Bilder)
import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { deleteNote, listNotes, listPersons, listProjects, listQualifications, saveNote, type Note, type NoteInput, type Person, type Project, type Qualification, type Scope } from "../db/repo";
import { fileUrl, pickAndStoreImages } from "../files";
import { useQualsEnabled } from "../report/quals";
import { todayStr } from "../util";
import { Empty, Field, Icon, Seg, Sheet, relDay } from "./ui";
import { SpellCheck } from "../spell/SpellCheck";
import type { Who } from "./fx";
import namiImg from "../assets/figuren/nami_schreibt.webp";

type ScopeF = "alle" | Scope;
const emptyNote = (scope: ScopeF): NoteInput => ({ date: todayStr(), scope: scope === "alle" ? "arbeit" : scope, text: "", projectId: null, qualIds: [], personIds: [], attachments: [] });

export function NotesScreen({ scope, fabRef, toast, autoNew, onAutoNew }: { scope: ScopeF; fabRef: MutableRefObject<(() => void) | null>; toast: (t: string, who?: Who, pose?: string) => void; autoNew?: boolean; onAutoNew?: () => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<NoteInput | null>(null);
  const [fresh, setFresh] = useState<number | null>(null), [leaving, setLeaving] = useState<number | null>(null);
  const load = async () => { const [n, p, ps] = await Promise.all([listNotes(), listProjects(), listPersons()]); setNotes(n); setProjects(p); setPersons(ps); };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (autoNew) { setEdit(emptyNote(scope)); onAutoNew?.(); } }, [autoNew]);
  fabRef.current = () => setEdit(emptyNote(scope));

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (notes ?? []).filter((n) => (scope === "alle" || n.scope === scope) && (!t || n.text.toLowerCase().includes(t)
      || projects.find((p) => p.id === n.projectId)?.name.toLowerCase().includes(t)
      || n.personIds.some((id) => persons.find((p) => p.id === id)?.name.toLowerCase().includes(t))));
  }, [notes, q, scope, projects, persons]);
  const groups = useMemo(() => { const m = new Map<string, Note[]>(); shown.forEach((n) => m.set(n.date, [...(m.get(n.date) ?? []), n])); return [...m.entries()]; }, [shown]);

  return (
    <>
      <div className="m-search"><Icon n="search" size={20} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notizen durchsuchen" aria-label="Notizen durchsuchen" />{q && <button className="m-iconbtn" style={{ width: 36, height: 36, background: "transparent" }} onClick={() => setQ("")} aria-label="Suche leeren"><Icon n="x" size={18} /></button>}</div>
      {notes && shown.length === 0 && <Empty img={namiImg} title={q ? "Nichts gefunden" : "Noch keine Notizen"} text={q ? "Versuch ein anderes Wort." : "Halte fest, was du heute gemacht hast. Daraus entsteht dein Berichtsheft."}>{!q && <button className="m-btn" onClick={() => setEdit(emptyNote(scope))}><Icon n="plus" />Erste Notiz</button>}</Empty>}
      {groups.map(([day, list]) => (
        <section key={day}>
          <div className="m-day">{relDay(day)}</div>
          {list.map((n) => {
            const pr = projects.find((p) => p.id === n.projectId);
            return (
              <article key={n.id} className={"m-card tap" + (n.id === fresh ? " fresh" : "") + (n.id === leaving ? " leave" : "")} data-scope={n.scope} style={{ ["--i" as string]: Math.min(list.indexOf(n), 8) }} onClick={() => setEdit({ ...n })}>
                <div className="m-clamp">{n.text || <i>(ohne Text)</i>}</div>
                <div className="m-meta">
                  <span className="m-chip">{n.scope === "schule" ? "Schule" : "Arbeit"}</span>
                  {pr && <span className="m-chip acc"><Icon n="folder" size={14} />{pr.name}</span>}
                  {n.personIds.length > 0 && <span className="m-chip"><Icon n="people" size={14} />{n.personIds.length}</span>}
                  {n.attachments.length > 0 && <span className="m-chip"><Icon n="image" size={14} />{n.attachments.length}</span>}
                </div>
              </article>
            );
          })}
        </section>
      ))}
      <NoteEditor value={edit} onClose={() => setEdit(null)} projects={projects} persons={persons}
        onSaved={async (msg, id, isNew) => { setEdit(null); await load(); setFresh(id); setTimeout(() => setFresh(null), 1600); toast(msg, "nami", isNew ? "pinnt" : "schreibt"); }}
        onDeleted={async (id) => { setEdit(null); setLeaving(id); toast("Weg damit! Die Notiz ist gelöscht.", "nami", "denkt"); setTimeout(async () => { await load(); setLeaving(null); }, 480); }} />
    </>
  );
}

export function NoteEditor({ value, onClose, projects, persons, onSaved, onDeleted }: { value: NoteInput | null; onClose: () => void; projects: Project[]; persons: Person[]; onSaved: (msg: string, id: number, isNew: boolean) => void; onDeleted: (id: number) => void }) {
  const qualsOn = useQualsEnabled();
  const [d, setD] = useState<NoteInput | null>(value);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [pickP, setPickP] = useState(false), [pickQ, setPickQ] = useState(false);
  const [qq, setQq] = useState(""), [arm, setArm] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => { setD(value); setArm(false); setErr(""); }, [value]);
  useEffect(() => { if (value && qualsOn) listQualifications().then(setQuals); }, [value, qualsOn]);
  useEffect(() => { d?.attachments.forEach((a) => { if (!thumbs[a.stored_path]) fileUrl(a.stored_path).then((u) => u && setThumbs((t) => ({ ...t, [a.stored_path]: u }))); }); }, [d?.attachments]);
  if (!d) return <Sheet open={false} onClose={onClose} title=""><></></Sheet>;
  const set = (p: Partial<NoteInput>) => setD({ ...d, ...p });
  const toggle = (key: "personIds" | "qualIds", id: number) => set({ [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] } as Partial<NoteInput>);
  const save = async () => {
    if (!d.text.trim()) { setErr("Schreib kurz auf, was du gemacht hast."); return; }
    setBusy(true);
    try { const id = await saveNote(d); onSaved(d.id ? "Gespeichert! Alles aktuell." : "Angepinnt! Daraus wird dein Berichtsheft.", id, !d.id); } catch (e) { setErr(String(e)); }
    setBusy(false);
  };
  const remove = async () => { if (!d.id) return; if (!arm) { setArm(true); return; } await deleteNote(d.id); onDeleted(d.id); };
  const addImages = async () => { try { const f = await pickAndStoreImages("attachments", true); set({ attachments: [...d.attachments, ...f.map((x) => ({ original_name: x.name, stored_path: x.path }))] }); } catch (e) { setErr("Bilder: " + String(e)); } };
  const projOpts = projects.filter((p) => p.scope === d.scope || p.id === d.projectId);

  return (
    <Sheet open={!!value} onClose={onClose} title={d.id ? "Notiz bearbeiten" : "Neue Notiz"} tall
      footer={<>{d.id && <button className="m-btn ghost" style={{ width: "auto" }} onClick={remove}><Icon n="trash" size={20} />{arm ? "Wirklich?" : ""}</button>}<button className="m-btn" disabled={busy} onClick={save}><Icon n="check" />Speichern</button></>}>
      {err && <div className="m-err">{err}</div>}
      <Field label="Bereich"><Seg value={d.scope} options={[["arbeit", "Arbeit"], ["schule", "Schule"]]} onChange={(v) => set({ scope: v, projectId: null })} /></Field>
      <Field label="Datum"><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
      <Field label="Was hast du gemacht?"><textarea value={d.text} onChange={(e) => set({ text: e.target.value })} placeholder="z. B. Neuen Drucker im Netzwerk eingerichtet" autoFocus={!d.id} /><SpellCheck value={d.text} onChange={(v) => set({ text: v })} compact /></Field>
      <Field label="Projekt"><select value={d.projectId ?? ""} onChange={(e) => set({ projectId: e.target.value ? Number(e.target.value) : null })}>
        <option value="">kein Projekt</option>{projOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Mit wem?"><div className="m-pick">
        {d.personIds.map((id) => <button key={id} className="on" onClick={() => toggle("personIds", id)}>{persons.find((p) => p.id === id)?.name ?? "?"}<Icon n="x" size={14} /></button>)}
        <button onClick={() => setPickP(true)}><Icon n="plus" size={16} />Person</button></div></Field>
      {qualsOn && <Field label="Qualifikationen"><div className="m-pick">
        {d.qualIds.map((id) => <button key={id} className="on" onClick={() => toggle("qualIds", id)}>{(quals.find((q) => q.id === id)?.name ?? "…").slice(0, 38)}<Icon n="x" size={14} /></button>)}
        <button onClick={() => setPickQ(true)}><Icon n="plus" size={16} />Auswählen</button></div></Field>}
      <Field label="Bilder"><div className="m-thumbs">
        {d.attachments.map((a, i) => <div key={a.stored_path + i}>{thumbs[a.stored_path] && <img src={thumbs[a.stored_path]} alt={a.original_name} />}<button onClick={() => set({ attachments: d.attachments.filter((_, j) => j !== i) })} aria-label="Bild entfernen"><Icon n="x" size={16} /></button></div>)}
        <button className="m-btn sec" style={{ width: 84, height: 84, padding: 0 }} onClick={addImages} aria-label="Bild hinzufügen"><Icon n="image" /></button></div></Field>

      <Sheet open={pickP} onClose={() => setPickP(false)} title="Personen" footer={<button className="m-btn" onClick={() => setPickP(false)}>Fertig</button>}>
        {persons.length === 0 ? <p className="m-note">Noch keine Kontakte. Leg sie im Reiter „Kontakte“ an.</p> :
          <div className="m-list">{persons.map((p) => <button key={p.id} onClick={() => toggle("personIds", p.id)}><span className={"m-check" + (d.personIds.includes(p.id) ? " on" : "")}>{d.personIds.includes(p.id) && <Icon n="check" size={16} stroke={3} />}</span><span className="m-grow">{p.name}<br /><small style={{ color: "var(--m-mute)" }}>{p.role ?? (p.scope === "schule" ? "Schule" : "Arbeit")}</small></span></button>)}</div>}
      </Sheet>
      <Sheet open={pickQ} onClose={() => setPickQ(false)} title="Qualifikationen" tall footer={<button className="m-btn" onClick={() => setPickQ(false)}>Fertig</button>}>
        <div className="m-search"><Icon n="search" size={20} /><input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="Suchen" /></div>
        <div className="m-list">{quals.filter((x) => !qq || x.name.toLowerCase().includes(qq.toLowerCase())).map((x) => <button key={x.id} onClick={() => toggle("qualIds", x.id)}><span className={"m-check" + (d.qualIds.includes(x.id) ? " on" : "")}>{d.qualIds.includes(x.id) && <Icon n="check" size={16} stroke={3} />}</span><span className="m-grow">{x.name}</span></button>)}</div>
      </Sheet>
    </Sheet>
  );
}
