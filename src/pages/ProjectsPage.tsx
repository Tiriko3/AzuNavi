import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as RPointerEvent } from "react";
import {
  connect, createBoardProject, deleteProject, disconnect, listBoard, listThreads, setPos, setProjectPeople, updateProject,
  type BoardProject, type ProjectInput, type Status,
} from "../db/boardRepo";
import { listPersons, type Person, type Scope } from "../db/repo";
import { getSetting, setSetting } from "../db/db";
import { Avatar } from "../Avatar";
import { torn } from "../util";
import type { ScopeId } from "../items";
import { ProjectView } from "./ProjectView";
import { ProjectNet } from "./ProjectNet";

const CW = 300, CH = 214;              // Größe eines Zettels (Pinnwand-Koordinaten)
const ZMIN = 0.3, ZMAX = 1.6;
const FOCUS_ZOOM = 0.85;               // ab hier zeigt die Pinnwand nur noch direkt Relevantes
const SCOPE_LABEL: Record<Scope, string> = { arbeit: "Arbeit", schule: "Schule" };
const STATUS: Record<Status, { label: string; color: string }> = {
  idee: { label: "Idee", color: "#e09a00" },
  aktiv: { label: "Aktiv", color: "#1457ff" },
  pausiert: { label: "Pausiert", color: "#7b84c4" },
  fertig: { label: "Fertig", color: "#0a8a3a" },
};

interface View { x: number; y: number; z: number }
interface Draft extends ProjectInput { id?: number; leadId: number | null; memberIds: number[] }
// Fadenfarben: Arbeit rot, Schule blau, gemischt mit Farbverlauf
const YARN: Record<Scope, string> = { arbeit: "#e8263f", schule: "#38b6ff" };
type Drag =
  | { kind: "card"; id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean };

const rot = (id: number) => (((id * 37) % 7) - 3) * 0.9;
const stageScale = () => {
  const st = document.getElementById("stage");
  return st ? st.getBoundingClientRect().width / 1600 : 1;
};

export function ProjectsPage({ scope, escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const [projects, setProjects] = useState<BoardProject[]>([]);
  const [threads, setThreads] = useState<[number, number][]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [view, setView] = useState<View>({ x: 40, y: 30, z: 0.8 });
  const [anim, setAnim] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);   // Projektansicht (Etappe 6)
  const [mode, setMode] = useState<"pinnwand" | "netz">("netz"); // Übersicht: Pinnwand oder Netzplan (Etappe 10)
  const [zooming, setZooming] = useState(false);                 // kurzer Hineinzoom-Effekt
  const [version, setVersion] = useState(0);
  const viewEsc = useRef<(() => boolean) | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const viewLoaded = useRef(false);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };

  /* ---------- Laden ---------- */
  const reload = useCallback(async () => {
    try {
      const [ps, th, pe] = await Promise.all([listBoard(), listThreads(), listPersons()]);
      // Zettel ohne Platz bekommen einen freien Platz im Raster
      let i = 0;
      for (const p of ps) {
        if (p.board_x === null || p.board_y === null) {
          while (ps.some((q) => q.board_x !== null && Math.abs((q.board_x ?? 0) - (80 + (i % 5) * 360)) < 40 && Math.abs((q.board_y ?? 0) - (80 + Math.floor(i / 5) * 290)) < 40)) i++;
          p.board_x = 80 + (i % 5) * 360; p.board_y = 80 + Math.floor(i / 5) * 290; i++;
          await setPos(p.id, p.board_x, p.board_y);
        }
      }
      setProjects(ps); setThreads(th); setPersons(pe); setErr("");
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => {
    reload();
    getSetting("board_view").then((v) => {
      if (v) { try { const o = JSON.parse(v); if (o && typeof o.z === "number") setView(o); } catch { /* egal */ } }
      viewLoaded.current = true;
    });
  }, [reload]);
  // Ansicht merken (leicht verzögert)
  useEffect(() => {
    if (!viewLoaded.current) return;
    const t = setTimeout(() => setSetting("board_view", JSON.stringify(view)), 500);
    return () => clearTimeout(t);
  }, [view]);

  /* ---------- Esc ---------- */
  useEffect(() => {
    escRef.current = () => {
      if (draft) { setDraft(null); setConfirmDel(false); return true; }
      if (openId !== null) { if (viewEsc.current && viewEsc.current()) return true; setOpenId(null); setZooming(false); return true; }
      if (connectMode) { setConnectMode(false); setConnectFrom(null); return true; }
      if (selected !== null) { setSelected(null); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, draft, connectMode, selected, openId]);

  /* ---------- abgeleitet ---------- */
  const shown = useMemo(() => projects.filter((p) => scope === "alle" || p.scope === scope), [projects, scope]);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const shownIds = useMemo(() => new Set(shown.map((p) => p.id)), [shown]);
  const shownThreads = threads.filter(([a, b]) => shownIds.has(a) && shownIds.has(b));
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const focus = selected !== null && view.z >= FOCUS_ZOOM;
  const related = useMemo(() => {
    const s = new Set<number>();
    if (selected === null) return s;
    s.add(selected);
    threads.forEach(([a, b]) => { if (a === selected) s.add(b); if (b === selected) s.add(a); });
    return s;
  }, [selected, threads]);
  const detail = view.z >= 0.55; // rausgezoomt: nur Name und Fortschritt

  /* ---------- Ansicht bewegen ---------- */
  const animateTo = (v: View) => { setAnim(true); setView(v); setTimeout(() => setAnim(false), 480); };
  const vpSize = () => {
    const r = vpRef.current?.getBoundingClientRect();
    const k = stageScale();
    return r ? { w: r.width / k, h: r.height / k } : { w: 1500, h: 700 };
  };
  const fitAll = () => {
    if (shown.length === 0) { animateTo({ x: 40, y: 30, z: 0.8 }); return; }
    const xs = shown.map((p) => p.board_x ?? 0), ys = shown.map((p) => p.board_y ?? 0);
    const minX = Math.min(...xs) - 60, minY = Math.min(...ys) - 60, maxX = Math.max(...xs) + CW + 60, maxY = Math.max(...ys) + CH + 60;
    const { w, h } = vpSize();
    const z = Math.max(ZMIN, Math.min(1.1, w / (maxX - minX), h / (maxY - minY)));
    animateTo({ z, x: (w - (maxX - minX) * z) / 2 - minX * z, y: (h - (maxY - minY) * z) / 2 - minY * z });
  };
  const zoomTo = (id: number, z = 1.1) => {
    const p = byId.get(id); if (!p) return;
    const { w, h } = vpSize();
    animateTo({ z, x: w / 2 - ((p.board_x ?? 0) + CW / 2) * z, y: h / 2 - ((p.board_y ?? 0) + CH / 2) * z });
  };
  const zoomBy = (f: number) => {
    const { w, h } = vpSize();
    setView((v) => {
      const z = Math.max(ZMIN, Math.min(ZMAX, v.z * f));
      return { z, x: w / 2 - (w / 2 - v.x) * (z / v.z), y: h / 2 - (h / 2 - v.y) * (z / v.z) };
    });
  };

  // Mausrad = Zoom zur Mausposition (nur über der Pinnwand)
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".pedit")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), k = stageScale();
      const cx = (e.clientX - r.left) / k, cy = (e.clientY - r.top) / k;
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => {
        const z = Math.max(ZMIN, Math.min(ZMAX, v.z * f));
        return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------- Ziehen: Zettel verschieben oder Pinnwand bewegen ---------- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".ptools") || t.closest(".pedit") || t.closest(".pact") || t.closest(".pempty")) return;
    const card = t.closest(".pcard") as HTMLElement | null;
    if (card) {
      const id = Number(card.dataset.id);
      const p = byId.get(id); if (!p) return;
      drag.current = { kind: "card", id, sx: e.clientX, sy: e.clientY, ox: p.board_x ?? 0, oy: p.board_y ?? 0, moved: false };
    } else {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const k = stageScale();
    const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "card") {
      const nx = d.ox + dx / view.z, ny = d.oy + dy / view.z;
      setProjects((ps) => ps.map((p) => (p.id === d.id ? { ...p, board_x: nx, board_y: ny } : p)));
    } else {
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    }
  };
  const onUp = async () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === "card") {
      if (d.moved) {
        const p = projects.find((q) => q.id === d.id);
        if (p) await setPos(p.id, p.board_x ?? 0, p.board_y ?? 0);
      } else clickCard(d.id);
    } else if (!d.moved) {
      setSelected(null);
    }
  };

  const lastClick = useRef<{ id: number; t: number }>({ id: -1, t: 0 });
  const clickCard = async (id: number) => {
    if (!connectMode) {
      // Doppelklick (selbst erkannt, weil die Pinnwand den Zeiger beim Ziehen festhält) = Projekt öffnen
      const now = Date.now();
      if (lastClick.current.id === id && now - lastClick.current.t < 400) {
        lastClick.current = { id: -1, t: 0 };
        setSelected(id); setOpenId(id);
        return;
      }
      lastClick.current = { id, t: now };
      setSelected((s) => (s === id ? null : id));
      return;
    }
    if (connectFrom === null) { setConnectFrom(id); return; }
    if (connectFrom === id) { setConnectFrom(null); return; }
    const exists = threads.some(([a, b]) => (a === Math.min(id, connectFrom) && b === Math.max(id, connectFrom)));
    try {
      if (exists) { await disconnect(connectFrom, id); flash("Faden gelöst"); }
      else { await connect(connectFrom, id); flash("Faden gespannt"); }
      setThreads(await listThreads());
    } catch (e) { setErr(String(e)); }
    setConnectFrom(null);
  };

  /* ---------- Bearbeiten ---------- */
  const openNew = () => {
    setConfirmDel(false); setErr("");
    setDraft({ name: "", scope: scope === "schule" ? "schule" : "arbeit", description: "", status: "aktiv", progress: 0, leadId: null, memberIds: [] });
  };
  const openEdit = (p: BoardProject) => {
    setConfirmDel(false); setErr("");
    setDraft({ id: p.id, name: p.name, scope: p.scope, description: p.description ?? "", status: p.status, progress: p.progress, leadId: p.leadId, memberIds: [...p.memberIds] });
  };
  const patch = (x: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...x } : d));
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr("Bitte einen Namen eintragen."); return; }
    try {
      let pid = draft.id;
      if (draft.id) await updateProject(draft.id, draft);
      else {
        const { w, h } = vpSize();
        // Mitte der Ansicht, oder der nächste freie Platz daneben (nichts soll übereinander liegen)
        const cx = (w / 2 - view.x) / view.z - CW / 2, cy = (h / 2 - view.y) / view.z - CH / 2;
        const free = (x: number, y: number) => !projects.some((p) => Math.abs((p.board_x ?? 0) - x) < CW + 30 && Math.abs((p.board_y ?? 0) - y) < CH + 40);
        let x = cx, y = cy;
        search: for (let ring = 0; ring < 8; ring++) {
          for (let gy = -ring; gy <= ring; gy++) for (let gx = -ring; gx <= ring; gx++) {
            if (Math.max(Math.abs(gx), Math.abs(gy)) !== ring) continue;
            const tx = cx + gx * (CW + 50), ty = cy + gy * (CH + 70);
            if (free(tx, ty)) { x = tx; y = ty; break search; }
          }
        }
        const id = await createBoardProject(draft, x, y);
        pid = id;
      }
      if (pid) await setProjectPeople(pid, draft.leadId, draft.memberIds);
      setDraft(null); await reload(); setVersion((v) => v + 1); flash("Projekt gespeichert");
    } catch (e) { setErr("Speichern fehlgeschlagen: " + String(e)); }
  };
  const remove = async () => {
    if (!draft?.id) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await deleteProject(draft.id); setDraft(null); setSelected(null); setOpenId(null); await reload(); flash("Projekt entfernt"); }
    catch (e) { setErr(String(e)); }
  };
  const editLinks = draft?.id ? threads.filter(([a, b]) => a === draft.id || b === draft.id).map(([a, b]) => (a === draft.id ? b : a)) : [];
  const sel = selected !== null ? byId.get(selected) : undefined;

  /* ---------- Darstellung ---------- */
  /** Aus der Übersicht in ein Projekt hineinzoomen */
  const zoomInto = (id: number) => {
    setZooming(true);
    setTimeout(() => { setOpenId(id); setZooming(false); }, 260);
  };
  const switchMode = (m: "pinnwand" | "netz") => { setMode(m); setSetting("board_mode", m); };

  return (
    <div className="work board">
      {openId !== null && byId.get(openId) && (
        <ProjectView project={byId.get(openId)!} projects={projects} threads={threads} persons={persons} version={version}
          escRef={viewEsc} onBack={() => setOpenId(null)} onEdit={openEdit} onOpen={(id) => setOpenId(id)}
          onChanged={async () => { await reload(); }} />
      )}
      {openId === null && (
        <div className="bmode">
          {mode === "netz" && <>
            <button className="btn" onClick={openNew}><span>+ Projekt</span></button>
            <button className={"mini" + (connectMode ? " hot" : "")} onClick={() => { setConnectMode(!connectMode); setConnectFrom(null); }}>
              {connectMode ? "Fäden: an" : "Faden spannen"}</button>
          </>}
          <span className="pvtabs">
            <button className={"pvtab" + (mode === "netz" ? " on" : "")} onClick={() => switchMode("netz")}><span>Netzplan</span></button>
            <button className={"pvtab" + (mode === "pinnwand" ? " on" : "")} onClick={() => switchMode("pinnwand")}><span>Pinnwand</span></button>
          </span>
        </div>
      )}
      {openId === null && mode === "netz" && (
        <div className={"pjnetwrap" + (zooming ? " zoomin" : "")}>
          <ProjectNet projects={shown} threads={shownThreads} persons={persons} scope={scope}
            onOpen={zoomInto} onEdit={openEdit} flash={flash}
            connectMode={connectMode} connectFrom={connectFrom}
            onConnect={async (id) => {
              if (connectFrom === null) { setConnectFrom(id); return; }
              if (connectFrom !== id) {
                const exists = threads.some(([a, b]) => a === Math.min(id, connectFrom) && b === Math.max(id, connectFrom));
                try {
                  if (exists) { await disconnect(connectFrom, id); flash("Faden gelöst"); }
                  else { await connect(connectFrom, id); flash("Faden gespannt"); }
                  setThreads(await listThreads());
                } catch (e) { setErr(String(e)); }
              }
              setConnectFrom(null);
            }} />
        </div>
      )}
      <div ref={vpRef} className={"bvp" + (connectMode ? " connecting" : "")} style={openId !== null || mode === "netz" ? { display: "none" } : undefined}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
        <div className={"bworld" + (anim ? " anim" : "")} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="threads" width="1" height="1">
            <defs>
              {shownThreads.map(([a, b]) => {
                const pa = byId.get(a)!, pb = byId.get(b)!;
                if (pa.scope === pb.scope) return null;
                return (
                  <linearGradient key={a + "-" + b} id={`yarn-${a}-${b}`} gradientUnits="userSpaceOnUse"
                    x1={(pa.board_x ?? 0) + CW / 2} y1={(pa.board_y ?? 0) + 16} x2={(pb.board_x ?? 0) + CW / 2} y2={(pb.board_y ?? 0) + 16}>
                    <stop offset="0%" stopColor={YARN[pa.scope]} />
                    <stop offset="100%" stopColor={YARN[pb.scope]} />
                  </linearGradient>
                );
              })}
            </defs>
            {shownThreads.map(([a, b]) => {
              const pa = byId.get(a)!, pb = byId.get(b)!;
              const x1 = (pa.board_x ?? 0) + CW / 2, y1 = (pa.board_y ?? 0) + 16, x2 = (pb.board_x ?? 0) + CW / 2, y2 = (pb.board_y ?? 0) + 16;
              const sag = Math.min(90, Math.hypot(x2 - x1, y2 - y1) * 0.16);
              const d = `M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag} ${x2} ${y2}`;
              const dim = focus && !(related.has(a) && related.has(b) && (a === selected || b === selected));
              const color = pa.scope === pb.scope ? YARN[pa.scope] : `url(#yarn-${a}-${b})`;
              return (
                <g key={a + "-" + b} className={dim ? "dim" : ""}>
                  <path d={d} className="yarn-shadow" />
                  <path d={d} className="yarn" style={{ stroke: color }} />
                </g>
              );
            })}
          </svg>
          {shown.map((p) => {
            const dim = focus && !related.has(p.id);
            const st = STATUS[p.status] ?? STATUS.aktiv;
            return (
              <div key={p.id} data-id={p.id}
                className={"pcard" + (selected === p.id ? " sel" : "") + (connectFrom === p.id ? " from" : "") + (dim ? " dim" : "") + (detail ? "" : " far")}
                style={{ left: p.board_x ?? 0, top: p.board_y ?? 0, transform: `rotate(${rot(p.id)}deg)` }}>
                <div className="ppaper" style={{ clipPath: `path('${torn(CW, CH, 6, p.id * 13 + 7)}')` }}>
                  <div className="ptitle">{p.name}</div>
                  {detail && (
                    <div className="ptags">
                      <span className={"tag " + p.scope}>{SCOPE_LABEL[p.scope]}</span>
                      <span className="pstatus" style={{ background: st.color }}>{st.label}</span>
                    </div>
                  )}
                  <div className="pbar"><i style={{ width: p.progress + "%", background: st.color }} /><b>{p.progress}%</b></div>
                  {detail && (
                    <div className="pfoot">
                      <span className="pcount">{p.notes} Notizen · {p.files + p.folders} Dateien</span>
                      <span className="faces">
                        {[...(p.leadId ? [p.leadId] : []), ...p.memberIds, ...p.personIds]
                          .filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 5).map((pid) => {
                            const pe = personById.get(pid);
                            if (!pe) return null;
                            const lead = pid === p.leadId;
                            return (
                              <span key={pid} className={lead ? "lead" : ""}>
                                <Avatar name={pe.name} path={pe.portrait_path} size={lead ? 36 : 30}
                                  title={lead ? `Zuständig: ${pe.name}` : p.memberIds.includes(pid) ? `Mitarbeit: ${pe.name}` : pe.name} />
                              </span>
                            );
                          })}
                      </span>
                    </div>
                  )}
                </div>
                <i className="pin" />
              </div>
            );
          })}
          {sel && detail && !connectMode && !draft && shownIds.has(sel.id) && (
            <div className="pact" style={{ left: (sel.board_x ?? 0) + 6, top: (sel.board_y ?? 0) + CH + 14 }}>
              <button className="mini hot" onClick={() => setOpenId(sel.id)}>Öffnen</button>
              <button className="mini" onClick={() => openEdit(sel)}>Bearbeiten</button>
              <button className="mini" onClick={() => zoomTo(sel.id)}>Heranzoomen</button>
              <button className="mini" onClick={() => { setConnectMode(true); setConnectFrom(sel.id); }}>Faden ziehen</button>
            </div>
          )}
        </div>

        <div className="ptools">
          <button className="btn" onClick={openNew}><span>+ Projekt</span></button>
          <button className={"mini" + (connectMode ? " hot" : "")} onClick={() => { setConnectMode(!connectMode); setConnectFrom(null); }}>
            {connectMode ? "Fäden: an" : "Faden spannen"}</button>
          <button className="mini" onClick={fitAll}>Alles zeigen</button>
          <span className="pzoom">
            <button className="mini" aria-label="Verkleinern" onClick={() => zoomBy(1 / 1.2)}>−</button>
            <b>{Math.round(view.z * 100)}%</b>
            <button className="mini" aria-label="Vergrößern" onClick={() => zoomBy(1.2)}>+</button>
          </span>
          {msg && <span className="flash inline">{msg}</span>}
        </div>
        {shownThreads.length > 0 && !connectMode && (
          <div className="plegend">
            <span><i style={{ background: YARN.arbeit }} />Arbeit</span>
            <span><i style={{ background: YARN.schule }} />Schule</span>
            <span><i style={{ background: `linear-gradient(90deg, ${YARN.arbeit}, ${YARN.schule})` }} />gemischt</span>
          </div>
        )}
        {connectMode && (
          <div className="phint">{connectFrom === null
            ? "Klicke zwei Zettel nacheinander an, um sie mit einem Faden zu verbinden. Ein bestehender Faden wird so wieder gelöst."
            : `„${byId.get(connectFrom)?.name}“ gewählt – jetzt den zweiten Zettel anklicken.`}</div>
        )}
        {shown.length === 0 && !draft && (
          <div className="pempty paperbox">
            <b>{projects.length === 0 ? "Noch keine Projekte." : "In diesem Bereich gibt es keine Projekte."}</b>
            <p>Projekte hängen hier als Zettel an der Pinnwand. Verbinde zusammengehörige Projekte mit Fäden und zoome mit dem Mausrad.</p>
            <button className="btn" onClick={openNew}><span>Erstes Projekt anlegen</span></button>
          </div>
        )}
        {err && !draft && <div className="errbox perr">{err}</div>}
      </div>

      {draft && (
        <aside className="pedit paperbox editor">
          <h3>{draft.id ? "Projekt bearbeiten" : "Neues Projekt"}</h3>
          {err && <div className="errbox">{err}</div>}
          <label className="lab">Name
            <input className="field" autoFocus value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <div className="lab">Bereich
            <div className="seg">
              {(["arbeit", "schule"] as Scope[]).map((s) => (
                <button type="button" key={s} className={"segb " + s + (draft.scope === s ? " on" : "")} onClick={() => patch({ scope: s })}><span>{SCOPE_LABEL[s]}</span></button>
              ))}
            </div>
          </div>
          <div className="lab">Status
            <div className="seg">
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <button type="button" key={s} className={"segb st" + (draft.status === s ? " on" : "")}
                  style={draft.status === s ? { background: STATUS[s].color, color: "#fff" } : undefined}
                  onClick={() => patch({ status: s, progress: s === "fertig" ? 100 : draft.progress })}><span>{STATUS[s].label}</span></button>
              ))}
            </div>
          </div>
          <label className="lab">Fortschritt: {draft.progress}%
            <input className="range" type="range" min={0} max={100} step={5} value={draft.progress}
              onChange={(e) => patch({ progress: Number(e.target.value) })} />
          </label>
          <label className="lab">Zuständig
            <select className="field" value={draft.leadId ?? ""}
              onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; patch({ leadId: v, memberIds: draft.memberIds.filter((m) => m !== v) }); }}>
              <option value="">– niemand –</option>
              {persons.map((pe) => <option key={pe.id} value={pe.id}>{pe.name}{pe.role ? ` (${pe.role})` : ""}</option>)}
            </select>
          </label>
          <div className="lab">Mitarbeit
            <div className="chips">
              {draft.memberIds.map((id) => {
                const pe = personById.get(id);
                return pe ? (
                  <span key={id} className="chip person"><Avatar name={pe.name} path={pe.portrait_path} size={22} />{pe.name}
                    <button type="button" aria-label="entfernen" onClick={() => patch({ memberIds: draft.memberIds.filter((m) => m !== id) })}>×</button></span>
                ) : null;
              })}
              {persons.filter((pe) => pe.id !== draft.leadId && !draft.memberIds.includes(pe.id)).length > 0 ? (
                <select className="field mini-select" value="" onChange={(e) => e.target.value && patch({ memberIds: [...draft.memberIds, Number(e.target.value)] })}>
                  <option value="">+ Person</option>
                  {persons.filter((pe) => pe.id !== draft.leadId && !draft.memberIds.includes(pe.id)).map((pe) => (
                    <option key={pe.id} value={pe.id}>{pe.name}{pe.role ? ` (${pe.role})` : ""}</option>
                  ))}
                </select>
              ) : persons.length === 0 ? <span className="small">Noch keine Kontakte angelegt.</span> : null}
            </div>
          </div>
          <label className="lab">Beschreibung
            <textarea className="field" rows={4} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
          </label>
          {draft.id && (
            <div className="lab">Verbunden mit
              <div className="chips">
                {editLinks.length === 0 && <span className="small">Noch keine Fäden. Nutze „Faden spannen“ auf der Pinnwand.</span>}
                {editLinks.map((oid) => (
                  <span key={oid} className="chip sel">{byId.get(oid)?.name ?? "?"}
                    <button type="button" aria-label="Faden lösen" onClick={async () => { await disconnect(draft.id!, oid); setThreads(await listThreads()); }}>×</button></span>
                ))}
              </div>
            </div>
          )}
          {draft.id && (() => {
            const p = byId.get(draft.id!);
            return p ? <p className="small">{p.notes} Notizen, {p.files} Dateien und {p.folders} Ordner sind mit diesem Projekt verknüpft.</p> : null;
          })()}
          <div className="actions">
            <button className="btn" onClick={save}><span>Speichern</span></button>
            <button className="btn ghost" onClick={() => { setDraft(null); setErr(""); }}><span>Abbrechen</span></button>
            {draft.id && <button className={"btn danger" + (confirmDel ? " arm" : "")} onClick={remove}><span>{confirmDel ? "Wirklich entfernen?" : "Entfernen"}</span></button>}
          </div>
          {confirmDel && <p className="small">Notizen, Dateien und Ordner bleiben erhalten, nur das Projekt und seine Verknüpfungen verschwinden.</p>}
        </aside>
      )}
    </div>
  );
}
