// Projekte auf dem Handy: Karten mit Status und Fortschritt, Detail mit Aufgaben und zugehörigen Notizen.
import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { addTask, createBoardProject, deleteProject, deleteTask, listBoard, listTasks, setTaskDone, updateProject, type BoardProject, type ProjectInput, type Status, type Task } from "../db/boardRepo";
import { listNotes, type Note, type Scope } from "../db/repo";
import { Empty, Field, Icon, Seg, Sheet, relDay } from "./ui";
import { MASCOTS, Mascot, pose, type Who } from "./fx";

type ScopeF = "alle" | Scope;
const STATUS: [Status, string][] = [["aktiv", "Aktiv"], ["idee", "Idee"], ["pausiert", "Pausiert"], ["fertig", "Fertig"]];
const label = (s: Status) => STATUS.find((x) => x[0] === s)?.[1] ?? s;

export function ProjectsScreen({ scope, fabRef, toast, celebrate }: { scope: ScopeF; fabRef: MutableRefObject<(() => void) | null>; toast: (t: string, who?: Who, pose?: string) => void; celebrate: () => void }) {
  const [list, setList] = useState<BoardProject[] | null>(null);
  const [filter, setFilter] = useState<"alle" | Status>("alle");
  const [open, setOpen] = useState<BoardProject | null>(null);
  const [edit, setEdit] = useState<(ProjectInput & { id?: number }) | null>(null);
  const load = async () => { const b = await listBoard(); setList(b); if (open) setOpen(b.find((p) => p.id === open.id) ?? null); };
  useEffect(() => { load(); }, []);
  fabRef.current = () => setEdit({ name: "", scope: scope === "alle" ? "arbeit" : scope, description: "", status: "aktiv", progress: 0 });
  const shown = useMemo(() => (list ?? []).filter((p) => (scope === "alle" || p.scope === scope) && (filter === "alle" || p.status === filter)), [list, scope, filter]);
  const activeN = (list ?? []).filter((p) => p.status === "aktiv" && (scope === "alle" || p.scope === scope)).length;

  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    const { id, ...p } = edit;
    if (id) await updateProject(id, p); else await createBoardProject(p, 120 + Math.random() * 600, 120 + Math.random() * 300);
    setEdit(null); await load();
    if (p.progress >= 100 || p.status === "fertig") { celebrate(); toast(`„${p.name}“ ist geschafft! Stark!`, "eda", "fertig"); }
    else toast(id ? "Projekt gespeichert." : "Neues Projekt angelegt. Lass uns loslegen!", "eda", id ? "denkt" : "gruss");
  };

  return (
    <>
      {list && list.length > 0 && <div className="m-guide" style={{ ["--gc" as string]: MASCOTS.eda.color }}><Mascot who="eda" pose={activeN ? "denkt" : "gruss"} size={96} />
        <div><b>Eda</b>{activeN ? `${activeN} aktive${activeN === 1 ? "s" : ""} Projekt${activeN === 1 ? "" : "e"}. Hak Aufgaben ab, ich zähle mit!` : "Gerade nichts aktiv. Zeit für ein neues Projekt?"}</div></div>}
      <div className="m-filter">{([["alle", "Alle"], ...STATUS] as ["alle" | Status, string][]).map(([v, l]) => <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>)}</div>
      {list && shown.length === 0 && <Empty img={pose("eda", "gruss")} title="Keine Projekte" text="Projekte bündeln Notizen, Aufgaben und Fortschritt. Leg eins an mit dem Plus.">
        <button className="m-btn" onClick={() => fabRef.current?.()}><Icon n="plus" />Projekt anlegen</button></Empty>}
      {shown.map((p) => (
        <article key={p.id} className="m-card tap" data-scope={p.scope} style={{ ["--i" as string]: Math.min(shown.indexOf(p), 8) }} onClick={() => setOpen(p)}>
          <div className="m-row"><b className="m-grow">{p.name}</b><span className={"m-status " + p.status}>{label(p.status)}</span></div>
          {p.description && <div className="m-clamp" style={{ WebkitLineClamp: 2, color: "var(--m-mute)", fontSize: 14, marginTop: 4 }}>{p.description}</div>}
          <div className="m-bar"><i style={{ width: `${p.progress}%` }} /></div>
          <div className="m-meta"><span>{p.progress} %</span><span>· {p.notes} Notizen</span></div>
        </article>
      ))}
      <ProjectDetail p={open} onClose={() => setOpen(null)} onEdit={(p) => setEdit({ id: p.id, name: p.name, scope: p.scope, description: p.description ?? "", status: p.status, progress: p.progress })}
        onDeleted={async () => { setOpen(null); await load(); toast("Projekt gelöscht.", "eda", "denkt"); }} onChanged={load} toast={toast} celebrate={celebrate} />
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Projekt bearbeiten" : "Neues Projekt"} tall footer={<button className="m-btn" disabled={!edit?.name.trim()} onClick={save}><Icon n="check" />Speichern</button>}>
        {edit && <>
          <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus={!edit.id} /></Field>
          <Field label="Bereich"><Seg value={edit.scope} options={[["arbeit", "Arbeit"], ["schule", "Schule"]]} onChange={(v) => setEdit({ ...edit, scope: v })} /></Field>
          <Field label="Status"><Seg value={edit.status} options={STATUS} onChange={(v) => setEdit({ ...edit, status: v })} /></Field>
          <Field label={`Fortschritt: ${edit.progress} %`}><input type="range" min={0} max={100} step={5} value={edit.progress} onChange={(e) => setEdit({ ...edit, progress: Number(e.target.value) })} style={{ padding: 0, border: 0, background: "transparent" }} /></Field>
          <Field label="Beschreibung"><textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ minHeight: 100 }} /></Field>
        </>}
      </Sheet>
    </>
  );
}

function ProjectDetail({ p, onClose, onEdit, onDeleted, onChanged, toast, celebrate }: { p: BoardProject | null; onClose: () => void; onEdit: (p: BoardProject) => void; onDeleted: () => void; onChanged: () => void; toast: (t: string, who?: Who, pose?: string) => void; celebrate: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState(""), [arm, setArm] = useState(false);
  const reload = async (id: number) => { setTasks(await listTasks(id)); setNotes((await listNotes()).filter((n) => n.projectId === id)); };
  useEffect(() => { setArm(false); if (p) reload(p.id); }, [p?.id]);
  if (!p) return <Sheet open={false} onClose={onClose} title=""><></></Sheet>;
  const done = tasks.filter((t) => t.done).length;
  return (
    <Sheet open={!!p} onClose={onClose} title={p.name} tall
      footer={<><button className="m-btn ghost" style={{ width: "auto" }} onClick={async () => { if (!arm) { setArm(true); return; } await deleteProject(p.id); onDeleted(); }}><Icon n="trash" size={20} />{arm ? "Wirklich?" : ""}</button><button className="m-btn" onClick={() => onEdit(p)}><Icon n="edit" />Bearbeiten</button></>}>
      <div className="m-card" data-scope={p.scope}>
        <div className="m-row"><span className={"m-status " + p.status}>{label(p.status)}</span><span className="m-grow" /><b>{p.progress} %</b></div>
        <div className="m-bar"><i style={{ width: `${p.progress}%` }} /></div>
        {p.description && <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{p.description}</p>}
      </div>
      <div className="m-h">Aufgaben {tasks.length > 0 && <small style={{ fontStyle: "normal", color: "var(--m-mute)" }}>{done}/{tasks.length}</small>}</div>
      <div className="m-list">
        {tasks.map((t) => (
          <button key={t.id} onClick={async () => {
            await setTaskDone(t.id, !t.done); const now = await listTasks(p.id); setTasks(now); onChanged();
            if (!t.done) { if (now.length > 1 && now.every((x) => x.done)) { celebrate(); toast("Alle Aufgaben erledigt! Ich bin stolz auf dich.", "eda", "fertig"); } else toast("Abgehakt! Weiter so.", "eda", "fertig"); }
          }}>
            <span className={"m-check" + (t.done ? " on" : "")}>{!!t.done && <Icon n="check" size={16} stroke={3} />}</span>
            <span className="m-grow" style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? .6 : 1 }}>{t.text}</span>
            <span role="button" aria-label="Aufgabe löschen" onClick={async (e) => { e.stopPropagation(); await deleteTask(t.id); reload(p.id); }} style={{ padding: 6, color: "var(--m-mute)" }}><Icon n="x" size={18} /></span>
          </button>
        ))}
      </div>
      <form className="m-search" style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await addTask(p.id, text.trim()); setText(""); reload(p.id); }}>
        <Icon n="plus" size={20} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Neue Aufgabe" enterKeyHint="done" /></form>
      <div className="m-h">Notizen ({notes.length})</div>
      {notes.length === 0 ? <p className="m-note">Noch keine Notizen zu diesem Projekt. Wähl das Projekt beim Schreiben einer Notiz aus.</p>
        : notes.slice(0, 20).map((n) => <div key={n.id} className="m-card"><div className="m-meta" style={{ marginTop: 0 }}>{relDay(n.date)}</div><div className="m-clamp">{n.text}</div></div>)}
    </Sheet>
  );
}
