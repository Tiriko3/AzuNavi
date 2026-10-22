import { useQualsEnabled } from "../report/quals";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MindMap } from "./MindMap";
import { SpellCheck } from "../spell/SpellCheck";
import type { MutableRefObject } from "react";
import {
  addTask, deleteTask, listTasks, moveTask, setTaskDone, setTaskNote, updateProject,
  type BoardProject, type Status, type Task,
} from "../db/boardRepo";
import { listNotes, listQualifications, saveNote, type Note, type Person, type Qualification, type Scope } from "../db/repo";
import { getRoots, listFolderProjects, listTracked, scopeOfPath, setFileProject, setFolderProject, type TrackedFile } from "../db/filesRepo";
import { baseName, extOf, fsapi } from "../fsapi";
import { Avatar } from "../Avatar";
import { dateParts, todayStr } from "../util";

const SCOPE_LABEL: Record<Scope, string> = { arbeit: "Arbeit", schule: "Schule" };
const STATUS: Record<Status, { label: string; color: string }> = {
  idee: { label: "Idee", color: "#e09a00" }, aktiv: { label: "Aktiv", color: "#1457ff" },
  pausiert: { label: "Pausiert", color: "#7b84c4" }, fertig: { label: "Fertig", color: "#0a8a3a" },
};

interface Props {
  project: BoardProject;
  projects: BoardProject[];
  threads: [number, number][];
  persons: Person[];
  version: number;
  escRef: MutableRefObject<(() => boolean) | null>;
  onBack: () => void;
  onEdit: (p: BoardProject) => void;
  onOpen: (id: number) => void;
  onChanged: () => void;
}

export function ProjectView({ project: p, projects, threads, persons, version, escRef, onBack, onEdit, onOpen, onChanged }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const qualsOn = useQualsEnabled();
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<(TrackedFile & { missing: boolean })[]>([]);
  const [folders, setFolders] = useState<{ path: string; missing: boolean }[]>([]);
  const [noteForm, setNoteForm] = useState<{ text: string; date: string; qualId: number | null } | null>(null);
  const [taskText, setTaskText] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"ov" | "map">("ov");
  const mapEsc = useRef<(() => boolean) | null>(null);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };

  const load = useCallback(async () => {
    try {
      const [n, q, t, tr, fl] = await Promise.all([listNotes(), listQualifications(), listTasks(p.id), listTracked(), listFolderProjects()]);
      setNotes(n.filter((x) => x.projectId === p.id));
      setQuals(q);
      setTasks(t);
      const fs = await fsapi().catch(() => null);
      const myFiles = tr.filter((f) => f.projectId === p.id);
      const myFolders = fl.filter((f) => f.projectId === p.id);
      setFiles(await Promise.all(myFiles.map(async (f) => ({ ...f, missing: fs ? !(await fs.exists(f.path)) : false }))));
      setFolders(await Promise.all(myFolders.map(async (f) => ({ path: f.path, missing: fs ? !(await fs.exists(f.path)) : false }))));
      setErr("");
    } catch (e) { setErr(String(e)); }
  }, [p.id]);
  useEffect(() => { load(); }, [load, version]);

  useEffect(() => {
    escRef.current = () => {
      if (noteForm) { setNoteForm(null); return true; }
      if (tab === "map") { if (mapEsc.current && mapEsc.current()) return true; setTab("ov"); return true; }
      onBack(); return true;
    };
    return () => { escRef.current = null; };
  }, [escRef, noteForm, onBack, tab]);

  const act = async (f: () => Promise<void>) => { try { setErr(""); await f(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } };
  const personById = useMemo(() => new Map(persons.map((x) => [x.id, x])), [persons]);
  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals]);
  const st = STATUS[p.status] ?? STATUS.aktiv;
  const linked = threads.filter(([a, b]) => a === p.id || b === p.id).map(([a, b]) => projects.find((x) => x.id === (a === p.id ? b : a))).filter((x): x is BoardProject => !!x);
  const openTasks = tasks.filter((t) => !t.done), doneTasks = tasks.filter((t) => t.done);
  const fromTasks = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : null;

  /* ---------- Aktionen ---------- */
  const takeProgress = () => act(async () => {
    if (fromTasks === null) return;
    await updateProject(p.id, { name: p.name, scope: p.scope, description: p.description ?? "", status: fromTasks === 100 ? "fertig" : p.status, progress: fromTasks });
    onChanged(); flash(`Fortschritt auf ${fromTasks}% gesetzt`);
  });
  const addNote = () => act(async () => {
    if (!noteForm || !noteForm.text.trim()) return;
    await saveNote({ date: noteForm.date, scope: p.scope, text: noteForm.text, projectId: p.id, qualIds: noteForm.qualId ? [noteForm.qualId] : [], personIds: [], attachments: [] });
    setNoteForm(null); await load(); onChanged(); flash("Notiz gespeichert");
  });
  const newTask = () => act(async () => {
    if (!taskText.trim()) return;
    await addTask(p.id, taskText); setTaskText(""); await load();
  });
  const toggle = (t: Task) => act(async () => { await setTaskDone(t.id, !t.done); await load(); });
  const taskToNote = (t: Task) => act(async () => {
    const id = await saveNote({ date: todayStr(), scope: p.scope, text: t.text, projectId: p.id, qualIds: [], personIds: [], attachments: [] });
    await setTaskNote(t.id, id); await load(); onChanged(); flash("Als Notiz festgehalten");
  });
  const removeTask = (t: Task) => act(async () => {
    if (armed !== t.id) { setArmed(t.id); setTimeout(() => setArmed((a) => (a === t.id ? null : a)), 2500); return; }
    await deleteTask(t.id); setArmed(null); await load();
  });
  const linkFile = () => act(async () => {
    const fs = await fsapi();
    const path = await fs.pickFile(true);
    if (!path) return;
    const roots = await getRoots();
    await setFileProject(path, baseName(path), scopeOfPath(roots, path), p.id);
    await load(); onChanged(); flash("Datei verknüpft");
  });
  const unlinkFile = (f: TrackedFile) => act(async () => { await setFileProject(f.path, f.name, f.scope, null); await load(); onChanged(); });
  const unlinkFolder = (path: string) => act(async () => { await setFolderProject(path, null); await load(); onChanged(); });
  const openPath = (path: string) => act(async () => (await fsapi()).open(path));
  const reveal = (path: string) => act(async () => (await fsapi()).reveal(path));

  /* ---------- Personen-Snippets ---------- */
  const lead = p.leadId ? personById.get(p.leadId) : undefined;
  const members = p.memberIds.map((id) => personById.get(id)).filter((x): x is Person => !!x);
  const others = p.personIds.filter((id) => id !== p.leadId && !p.memberIds.includes(id)).map((id) => personById.get(id)).filter((x): x is Person => !!x);

  return (
    <div className={"pview" + (tab === "map" ? " maptab" : "")}>
      <header className="pvhead">
        <div className="pvleft">
          <div className="pvtop">
            <button className="mini" onClick={onBack}>← Pinnwand</button>
            <span className={"tag " + p.scope}>{SCOPE_LABEL[p.scope]}</span>
            <span className="pstatus" style={{ background: st.color }}>{st.label}</span>
            <button className="mini" onClick={() => onEdit(p)}>Bearbeiten</button>
            <span className="pvtabs">
              <button className={"pvtab" + (tab === "ov" ? " on" : "")} onClick={() => setTab("ov")}><span>Übersicht</span></button>
              <button className={"pvtab" + (tab === "map" ? " on" : "")} onClick={() => setTab("map")}><span>Mindmap</span></button>
            </span>
            {msg && <span className="flash inline">{msg}</span>}
          </div>
          <h2 className="pvtitle"><span>{p.name}</span></h2>
          <div className="pvprog">
            <div className="pbar big"><i style={{ width: p.progress + "%", background: st.color }} /><b>{p.progress}%</b></div>
            {fromTasks !== null && fromTasks !== p.progress && (
              <button className="chip clickable" onClick={takeProgress}>Aus Aufgaben: {fromTasks}% übernehmen</button>
            )}
          </div>
          {p.description && <p className="pvdesc">{p.description}</p>}
          {linked.length > 0 && (
            <div className="pvlinks">Verbunden mit:
              {linked.map((x) => <button key={x.id} className={"chip clickable link-" + x.scope} onClick={() => onOpen(x.id)}>{x.name}</button>)}
            </div>
          )}
        </div>
        <div className="pvpeople">
          {lead && (
            <div className="snip lead" title={`Zuständig: ${lead.name}`}>
              <Avatar name={lead.name} path={lead.portrait_path} size={92} />
              <b>{lead.name}</b><small>Zuständig</small>
            </div>
          )}
          {members.map((m) => (
            <div key={m.id} className="snip" title={`Mitarbeit: ${m.name}`}>
              <Avatar name={m.name} path={m.portrait_path} size={66} />
              <b>{m.name}</b><small>Mitarbeit</small>
            </div>
          ))}
          {others.slice(0, 4).map((m) => (
            <div key={m.id} className="snip small-snip" title={`aus Notizen: ${m.name}`}>
              <Avatar name={m.name} path={m.portrait_path} size={48} />
              <b>{m.name}</b>
            </div>
          ))}
          {!lead && members.length === 0 && others.length === 0 && (
            <button className="mini" onClick={() => onEdit(p)}>+ Zuständig / Mitarbeit</button>
          )}
        </div>
      </header>
      {err && <div className="errbox">{err}</div>}

      {tab === "map" ? (
        <div className="tabanim mmtab" key={"m" + p.id}><MindMap key={p.id} project={p} projects={projects} threads={threads} persons={persons} version={version}
          escRef={mapEsc} onOpenProject={onOpen} /></div>
      ) : (
      <div className="pvcols tabanim">
        {/* ---------- Was gemacht ---------- */}
        <section className="pvcol paperbox">
          <h3>Was gemacht <small>{notes.length}</small></h3>
          {noteForm ? (
            <div className="pvform">
              <textarea className="field" rows={3} autoFocus placeholder="Was hast du erledigt?" value={noteForm.text} spellCheck={false}
                onChange={(e) => setNoteForm({ ...noteForm, text: e.target.value })} />
              <SpellCheck compact value={noteForm.text} onChange={(v) => setNoteForm({ ...noteForm, text: v })} />
              <div className="inl">
                <input className="field" type="date" value={noteForm.date} onChange={(e) => setNoteForm({ ...noteForm, date: e.target.value })} />
                {qualsOn && <select className="field" value={noteForm.qualId ?? ""} onChange={(e) => setNoteForm({ ...noteForm, qualId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Qualifikation (optional)</option>
                  {quals.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>}
              </div>
              <div className="inl">
                <button className="mini hot" onClick={addNote}>Speichern</button>
                <button className="mini" onClick={() => setNoteForm(null)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <button className="mini addbtn" onClick={() => setNoteForm({ text: "", date: todayStr(), qualId: null })}>+ Erledigtes festhalten</button>
          )}
          <div className="pvlist">
            {notes.length === 0 && <p className="small">Noch keine Notizen zu diesem Projekt. Halte hier fest, was du erledigt hast, oder wähle das Projekt in einer Notiz aus.</p>}
            {notes.map((n) => {
              const d = dateParts(n.date);
              return (
                <div key={n.id} className={"pvnote" + (expanded === n.id ? " open" : "")} onClick={() => setExpanded(expanded === n.id ? null : n.id)}>
                  <div className="pvdate"><b>{d.day}. {d.month}</b><small>KW {d.kw}</small></div>
                  <div className="pvntext">
                    <p>{n.text}</p>
                    {n.qualIds.filter((q) => qualById.has(q)).length > 0 && <div className="chips">{n.qualIds.filter((q) => qualById.has(q)).map((q) => <span key={q} className="chip">{qualById.get(q)?.name}</span>)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Was als Nächstes ---------- */}
        <section className="pvcol paperbox">
          <h3>Was als Nächstes <small>{openTasks.length} offen</small></h3>
          <div className="inl addtask">
            <input className="field grow" placeholder="Nächster Schritt …" value={taskText}
              onChange={(e) => setTaskText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") newTask(); }} />
            <button className="mini hot" onClick={newTask}>+</button>
          </div>
          <div className="pvlist">
            {tasks.length === 0 && <p className="small">Noch keine Aufgaben. Plane hier die nächsten Schritte, abgehakte Aufgaben kannst du als Notiz fürs Berichtsheft festhalten.</p>}
            {openTasks.map((t, i) => (
              <div key={t.id} className="task">
                <button className="tick" aria-label="erledigt" onClick={() => toggle(t)} />
                <span className="ttext">{t.text}</span>
                <span className="tbtns">
                  <button className="tsm" aria-label="nach oben" disabled={i === 0} onClick={() => act(async () => { await moveTask(p.id, t.id, -1); await load(); })}>▲</button>
                  <button className="tsm" aria-label="nach unten" disabled={i === openTasks.length - 1} onClick={() => act(async () => { await moveTask(p.id, t.id, 1); await load(); })}>▼</button>
                  <button className={"tsm del" + (armed === t.id ? " arm" : "")} aria-label="löschen" onClick={() => removeTask(t)}>{armed === t.id ? "?" : "×"}</button>
                </span>
              </div>
            ))}
            {doneTasks.length > 0 && <div className="tdiv">Erledigt</div>}
            {doneTasks.map((t) => (
              <div key={t.id} className="task done">
                <button className="tick on" aria-label="wieder öffnen" onClick={() => toggle(t)}>✓</button>
                <span className="ttext">{t.text}</span>
                <span className="tbtns">
                  {t.note_id ? <span className="tnoted">in Notizen</span> : <button className="mini" onClick={() => taskToNote(t)}>→ als Notiz</button>}
                  <button className={"tsm del" + (armed === t.id ? " arm" : "")} aria-label="löschen" onClick={() => removeTask(t)}>{armed === t.id ? "?" : "×"}</button>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Dateilinks ---------- */}
        <section className="pvcol paperbox">
          <h3>Dateilinks <small>{files.length + folders.length}</small></h3>
          <button className="mini addbtn" onClick={linkFile}>+ Datei verknüpfen</button>
          <div className="pvlist">
            {files.length + folders.length === 0 && <p className="small">Noch nichts verknüpft. Hier verknüpfen, oder im Bereich Dateien einem Ordner bzw. einer Datei dieses Projekt geben.</p>}
            {folders.map((f) => (
              <div key={f.path} className={"flink" + (f.missing ? " missing" : "")}>
                <i className="badge" style={{ background: "#3a3fb4" }}>ORD</i>
                <span className="fln" title={f.path}><b>{baseName(f.path)}</b><small>{f.missing ? "nicht gefunden" : "Ordner, alles darin gehört dazu"}</small></span>
                <span className="tbtns">
                  {!f.missing && <button className="mini" onClick={() => openPath(f.path)}>Öffnen</button>}
                  <button className="tsm del" aria-label="Verknüpfung lösen" title="Verknüpfung lösen (der Ordner bleibt)" onClick={() => unlinkFolder(f.path)}>×</button>
                </span>
              </div>
            ))}
            {files.map((f) => (
              <div key={f.id} className={"flink" + (f.missing ? " missing" : "")}>
                <i className="badge" style={{ background: extOf(f.name) === "pdf" ? "#c4163f" : "#46507a" }}>{(extOf(f.name) || "?").slice(0, 4).toUpperCase()}</i>
                <span className="fln" title={f.path}><b>{f.name}</b><small>{f.missing ? "nicht gefunden – im Bereich Dateien neu verbinden" : f.path}</small></span>
                <span className="tbtns">
                  {!f.missing && <button className="mini" onClick={() => openPath(f.path)}>Öffnen</button>}
                  {!f.missing && <button className="mini" onClick={() => reveal(f.path)}>Zeigen</button>}
                  <button className="tsm del" aria-label="Verknüpfung lösen" title="Verknüpfung lösen (die Datei bleibt)" onClick={() => unlinkFile(f)}>×</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
