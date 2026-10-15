import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as RPointerEvent } from "react";
import { listTasks, type BoardProject, type Task } from "../db/boardRepo";
import { listNotes, listQualifications, type Note, type Person, type Qualification, type Scope } from "../db/repo";
import { listFolderProjects, listTracked, type TrackedFile } from "../db/filesRepo";
import {
  addFreeNode, clearPositions, deleteFreeNode, listFreeEdges, listFreeNodes, listPositions, savePositions,
  toggleFreeEdge, updateFreeNode, type FreeEdge, type FreeNode,
} from "../db/mindmapRepo";
import { getSetting, setSetting } from "../db/db";
import { baseName, fsapi } from "../fsapi";
import { Avatar } from "../Avatar";
import { dateParts } from "../util";

type Kind = "center" | "project" | "person" | "note" | "qual" | "file" | "folder" | "task" | "free";
interface MNode {
  key: string; kind: Kind; label: string; full: string; refId: number;
  scope?: Scope; role?: "lead" | "member"; portrait?: string | null; color?: string; done?: boolean; path?: string;
}
interface MEdge { a: string; b: string; free?: boolean }
type P = { x: number; y: number };

const SCOPE_COLOR: Record<Scope, string> = { arbeit: "#e8263f", schule: "#38b6ff" };
const FREE_COLORS: Record<string, string> = { teal: "#19e3b1", gold: "#ffb020", pink: "#ff6fa8", white: "#ffffff" };
const FILTERS: { kind: Kind; label: string; color: string }[] = [
  { kind: "person", label: "Personen", color: "#ffffff" },
  { kind: "note", label: "Notizen", color: "#cfdcff" },
  { kind: "qual", label: "Qualifikationen", color: "#ffb020" },
  { kind: "task", label: "Aufgaben", color: "#19e3b1" },
  { kind: "file", label: "Dateien", color: "#9aa3e0" },
  { kind: "project", label: "Projekte", color: "#ff6f86" },
  { kind: "free", label: "Eigene", color: "#ff6fa8" },
];
const KIND_LABEL: Record<Kind, string> = {
  center: "Projekt", project: "Verbundenes Projekt", person: "Person", note: "Notiz", qual: "Qualifikation",
  file: "Datei", folder: "Ordner", task: "Aufgabe", free: "Eigener Knoten",
};
const REST: Partial<Record<Kind, number>> = { project: 320, person: 250, note: 230, qual: 190, file: 230, folder: 230, task: 210, free: 190 };
const ZMIN = 0.25, ZMAX = 2.2;
const stageScale = () => { const st = document.getElementById("stage"); return st ? st.getBoundingClientRect().width / 1600 : 1; };
const vis = (k: Kind) => (k === "folder" ? "file" : k);

/* ---------- Kräfte-Layout (wie das Obsidian-Netz) ---------- */
function relax(nodes: MNode[], edges: MEdge[], start: Map<string, P>, fixed: Set<string>, iters = 320): Map<string, P> {
  const pos = new Map<string, P>();
  nodes.forEach((n) => pos.set(n.key, { ...(start.get(n.key) ?? { x: 0, y: 0 }) }));
  const kindOf = new Map(nodes.map((n) => [n.key, n.kind]));
  const keys = nodes.map((n) => n.key);
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    const f = new Map<string, P>(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < keys.length; i++) {
      const a = pos.get(keys[i])!;
      for (let j = i + 1; j < keys.length; j++) {
        const b = pos.get(keys[j])!;
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const rep = Math.min(80, 34000 / d2);
        const d = Math.sqrt(d2);
        const fx = (dx / d) * rep, fy = (dy / d) * rep;
        f.get(keys[i])!.x += fx; f.get(keys[i])!.y += fy;
        f.get(keys[j])!.x -= fx; f.get(keys[j])!.y -= fy;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.a), b = pos.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const rest = Math.max(REST[kindOf.get(e.a)!] ?? 150, REST[kindOf.get(e.b)!] ?? 150);
      const s = (d - rest) * 0.06;
      f.get(e.a)!.x += (dx / d) * s; f.get(e.a)!.y += (dy / d) * s;
      f.get(e.b)!.x -= (dx / d) * s; f.get(e.b)!.y -= (dy / d) * s;
    }
    for (const k of keys) {
      if (fixed.has(k)) continue;
      const p = pos.get(k)!, fk = f.get(k)!;
      fk.x -= p.x * 0.004; fk.y -= p.y * 0.004; // leichte Schwerkraft zur Mitte
      p.x += Math.max(-30, Math.min(30, fk.x * cool));
      p.y += Math.max(-30, Math.min(30, fk.y * cool));
    }
  }
  return pos;
}

interface Props {
  project: BoardProject; projects: BoardProject[]; threads: [number, number][]; persons: Person[];
  version: number; escRef: MutableRefObject<(() => boolean) | null>; onOpenProject: (id: number) => void;
}

export function MindMap({ project: p, projects, threads, persons, version, escRef, onOpenProject }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [free, setFree] = useState<FreeNode[]>([]);
  const [freeEdges, setFreeEdges] = useState<FreeEdge[]>([]);
  const [pos, setPos] = useState<Map<string, P>>(new Map());
  const [ready, setReady] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, z: 0.8 });
  const [anim, setAnim] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [edit, setEdit] = useState<{ label: string; color: string } | null>(null);
  const [armDel, setArmDel] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "node" | "pan"; key?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2400); };

  /* ---------- Daten ---------- */
  const load = useCallback(async () => {
    try {
      const [n, q, t, tr, fl, fn, fe] = await Promise.all([
        listNotes(), listQualifications(), listTasks(p.id), listTracked(), listFolderProjects(), listFreeNodes(p.id), listFreeEdges(p.id),
      ]);
      setNotes(n.filter((x) => x.projectId === p.id)); setQuals(q); setTasks(t);
      setFiles(tr.filter((f) => f.projectId === p.id)); setFolders(fl.filter((f) => f.projectId === p.id).map((f) => f.path));
      setFree(fn); setFreeEdges(fe); setErr("");
    } catch (e) { setErr(String(e)); }
  }, [p.id]);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => {
    getSetting("mm_hidden").then((v) => { if (v) { try { setHidden(new Set(JSON.parse(v))); } catch { /* egal */ } } });
  }, []);

  /* ---------- Graph aufbauen ---------- */
  const graph = useMemo(() => {
    const nodes: MNode[] = [];
    const edges: MEdge[] = [];
    const personById = new Map(persons.map((x) => [x.id, x]));
    const qualById = new Map(quals.map((x) => [x.id, x]));
    const C = "center";
    nodes.push({ key: C, kind: "center", label: p.name, full: p.description || p.name, refId: p.id, scope: p.scope });
    threads.filter(([a, b]) => a === p.id || b === p.id).forEach(([a, b]) => {
      const o = projects.find((x) => x.id === (a === p.id ? b : a)); if (!o) return;
      nodes.push({ key: "project:" + o.id, kind: "project", label: o.name, full: o.description || o.name, refId: o.id, scope: o.scope });
      edges.push({ a: C, b: "project:" + o.id });
    });
    const addPerson = (id: number, role?: "lead" | "member") => {
      const pe = personById.get(id); if (!pe) return;
      const key = "person:" + id;
      const ex = nodes.find((n) => n.key === key);
      if (ex) { if (role && !ex.role) ex.role = role; return; }
      nodes.push({ key, kind: "person", label: pe.name, full: [pe.name, pe.role].filter(Boolean).join(" – "), refId: id, role, portrait: pe.portrait_path });
    };
    if (p.leadId) { addPerson(p.leadId, "lead"); edges.push({ a: C, b: "person:" + p.leadId }); }
    p.memberIds.forEach((m) => { addPerson(m, "member"); edges.push({ a: C, b: "person:" + m }); });
    notes.forEach((n) => {
      const d = dateParts(n.date);
      const key = "note:" + n.id;
      nodes.push({ key, kind: "note", label: `${d.day}. ${d.month} · ${n.text.length > 34 ? n.text.slice(0, 34) + "…" : n.text}`, full: n.text, refId: n.id });
      edges.push({ a: C, b: key });
      n.personIds.forEach((pid) => { addPerson(pid); edges.push({ a: key, b: "person:" + pid }); });
      n.qualIds.forEach((qid) => {
        const q = qualById.get(qid); if (!q) return;
        const qk = "qual:" + qid;
        if (!nodes.some((x) => x.key === qk)) nodes.push({ key: qk, kind: "qual", label: q.name.length > 40 ? q.name.slice(0, 40) + "…" : q.name, full: q.name, refId: qid });
        edges.push({ a: key, b: qk });
      });
    });
    tasks.forEach((t) => {
      nodes.push({ key: "task:" + t.id, kind: "task", label: t.text.length > 36 ? t.text.slice(0, 36) + "…" : t.text, full: t.text, refId: t.id, done: !!t.done });
      edges.push({ a: C, b: "task:" + t.id });
    });
    files.forEach((f) => { nodes.push({ key: "file:" + f.id, kind: "file", label: f.name, full: f.path, refId: f.id, path: f.path }); edges.push({ a: C, b: "file:" + f.id }); });
    folders.forEach((path, i) => { nodes.push({ key: "folder:" + i, kind: "folder", label: baseName(path), full: path, refId: i, path }); edges.push({ a: C, b: "folder:" + i }); });
    free.forEach((fn) => nodes.push({ key: "free:" + fn.id, kind: "free", label: fn.label, full: fn.label, refId: fn.id, color: fn.color }));
    const keys = new Set(nodes.map((n) => n.key));
    freeEdges.forEach((e) => { if (keys.has(e.a) && keys.has(e.b)) edges.push({ a: e.a, b: e.b, free: true }); });
    // eigene Knoten ohne Linie hängen locker an der Mitte (nur fürs Layout)
    return { nodes, edges };
  }, [p, projects, threads, persons, notes, quals, tasks, files, folders, free, freeEdges]);

  /* ---------- Layout: gemerkte Positionen + neue Knoten einpassen ---------- */
  const layoutRun = useRef(0);
  useEffect(() => {
    const run = ++layoutRun.current;
    (async () => {
      const saved = await listPositions(p.id);
      if (run !== layoutRun.current) return;
      const start = new Map<string, P>();
      const fixed = new Set<string>(["center"]);
      start.set("center", { x: 0, y: 0 });
      const missing: string[] = [];
      graph.nodes.forEach((n) => {
        const s = saved.get(n.key) ?? pos.get(n.key);
        if (n.key === "center") return;
        if (s) { start.set(n.key, s); fixed.add(n.key); } else missing.push(n.key);
      });
      if (missing.length === 0) { setPos(start); setReady(true); return; }
      // neue Knoten in die Nähe eines schon platzierten Nachbarn setzen
      missing.forEach((k, i) => {
        const nb = graph.edges.find((e) => (e.a === k && start.has(e.b)) || (e.b === k && start.has(e.a)));
        const anchor = nb ? start.get(nb.a === k ? nb.b : nb.a)! : { x: 0, y: 0 };
        const ang = (i / Math.max(1, missing.length)) * Math.PI * 2 + i * 0.37;
        const r = 120 + (i % 3) * 40;
        start.set(k, { x: anchor.x + Math.cos(ang) * r, y: anchor.y + Math.sin(ang) * r });
      });
      const free = new Set(missing);
      const fx = new Set([...start.keys()].filter((k) => !free.has(k)));
      const out = relax(graph.nodes, graph.edges, start, fx, saved.size === 0 ? 360 : 200);
      if (run !== layoutRun.current) return;
      setPos(out);
      await savePositions(p.id, missing.map((k) => ({ key: k, ...out.get(k)! })));
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, p.id]);

  /* ---------- Ansicht ---------- */
  const vpSize = () => { const r = vpRef.current?.getBoundingClientRect(); const k = stageScale(); return r ? { w: r.width / k, h: r.height / k } : { w: 1400, h: 560 }; };
  const visibleNodes = graph.nodes.filter((n) => n.kind === "center" || !hidden.has(vis(n.kind)));
  const visKeys = new Set(visibleNodes.map((n) => n.key));
  const visibleEdges = graph.edges.filter((e) => visKeys.has(e.a) && visKeys.has(e.b));
  const fitAll = useCallback((animate = true) => {
    const pts = visibleNodes.map((n) => pos.get(n.key)).filter((x): x is P => !!x);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((q) => q.x)) - 170, maxX = Math.max(...pts.map((q) => q.x)) + 170;
    const minY = Math.min(...pts.map((q) => q.y)) - 110, maxY = Math.max(...pts.map((q) => q.y)) + 160;
    const { w, h } = vpSize();
    const z = Math.max(ZMIN, Math.min(1.2, w / (maxX - minX), h / (maxY - minY)));
    if (animate) { setAnim(true); setTimeout(() => setAnim(false), 480); }
    setView({ z, x: w / 2 - ((minX + maxX) / 2) * z, y: h / 2 - ((minY + maxY) / 2) * z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes.length, pos]);
  const fitted = useRef(false);
  useEffect(() => { if (ready && !fitted.current && pos.size) { fitted.current = true; fitAll(false); } }, [ready, pos, fitAll]);

  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".mmpanel")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), k = stageScale();
      const cx = (e.clientX - r.left) / k, cy = (e.clientY - r.top) / k;
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => { const z = Math.max(ZMIN, Math.min(ZMAX, v.z * f)); return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------- Esc ---------- */
  useEffect(() => {
    escRef.current = () => {
      if (connectFrom) { setConnectFrom(null); return true; }
      if (selected) { setSelected(null); setEdit(null); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, connectFrom, selected]);

  /* ---------- Ziehen ---------- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".mmpanel") || t.closest(".mmtools") || t.closest(".mmfilter")) return;
    const nodeEl = t.closest(".mnode") as HTMLElement | null;
    if (nodeEl) {
      const key = nodeEl.dataset.key!;
      const q = pos.get(key) ?? { x: 0, y: 0 };
      drag.current = { kind: "node", key, sx: e.clientX, sy: e.clientY, ox: q.x, oy: q.y, moved: false };
    } else drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const k = stageScale();
    const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "node" && d.key) {
      const key = d.key, nx = d.ox + dx / view.z, ny = d.oy + dy / view.z;
      setPos((m) => { const n = new Map(m); n.set(key, { x: nx, y: ny }); return n; });
    } else setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onUp = async () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.kind === "node" && d.key) {
      if (d.moved) { setHover(null); const q = pos.get(d.key); if (q) await savePositions(p.id, [{ key: d.key, ...q }]); }
      else await clickNode(d.key);
    } else if (!d.moved) { setSelected(null); setEdit(null); }
  };

  const clickNode = async (key: string) => {
    if (connectFrom) {
      if (key === connectFrom) { setConnectFrom(null); return; }
      try { const now = await toggleFreeEdge(p.id, connectFrom, key); flash(now ? "Linie gezogen" : "Linie gelöst"); setFreeEdges(await listFreeEdges(p.id)); }
      catch (e) { setErr(String(e)); }
      setConnectFrom(null); return;
    }
    setArmDel(false);
    setSelected((s) => (s === key ? null : key));
    const n = graph.nodes.find((x) => x.key === key);
    setEdit(n && n.kind === "free" ? { label: n.label, color: n.color ?? "teal" } : null);
  };

  /* ---------- Aktionen ---------- */
  const addNode = async () => {
    try {
      const id = await addFreeNode(p.id, "Neuer Gedanke");
      const key = "free:" + id;
      const anchor = selected && pos.get(selected) ? pos.get(selected)! : { x: 0, y: 0 };
      const ang = Math.random() * Math.PI * 2;
      await savePositions(p.id, [{ key, x: anchor.x + Math.cos(ang) * 150, y: anchor.y + Math.sin(ang) * 150 }]);
      if (selected) await toggleFreeEdge(p.id, selected, key);
      await load();
      setSelected(key); setEdit({ label: "Neuer Gedanke", color: "teal" });
    } catch (e) { setErr(String(e)); }
  };
  const saveFree = async (label: string, color: string) => {
    if (!selected?.startsWith("free:")) return;
    await updateFreeNode(Number(selected.slice(5)), label, color);
    setFree(await listFreeNodes(p.id));
  };
  const removeFree = async () => {
    if (!selected?.startsWith("free:")) return;
    if (!armDel) { setArmDel(true); return; }
    await deleteFreeNode(p.id, Number(selected.slice(5)));
    setSelected(null); setEdit(null); setArmDel(false); await load();
  };
  const rearrange = async () => {
    await clearPositions(p.id);
    setPos(new Map()); fitted.current = false; setReady(false);
    await load();
    flash("Neu angeordnet");
  };
  const toggleFilter = (k: Kind) => {
    setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); setSetting("mm_hidden", JSON.stringify([...n])); return n; });
  };

  /* ---------- Hervorheben wie bei Obsidian ---------- */
  const focusKey = hover ?? selected;
  const near = useMemo(() => {
    if (!focusKey) return null;
    const s = new Set([focusKey]);
    visibleEdges.forEach((e) => { if (e.a === focusKey) s.add(e.b); if (e.b === focusKey) s.add(e.a); });
    return s;
  }, [focusKey, visibleEdges]);
  const labelsOn = view.z >= 0.55;
  const sel = selected ? graph.nodes.find((n) => n.key === selected) : undefined;

  const nodeColor = (n: MNode) =>
    n.kind === "center" || n.kind === "project" ? SCOPE_COLOR[n.scope ?? "arbeit"]
      : n.kind === "free" ? FREE_COLORS[n.color ?? "teal"] ?? FREE_COLORS.teal
      : n.kind === "task" ? (n.done ? "#8a93d6" : "#19e3b1")
      : n.kind === "qual" ? "#ffb020" : n.kind === "note" ? "#eef3ff" : "#9aa3e0";

  return (
    <div className="mmwrap">
      <div ref={vpRef} className={"mmvp" + (connectFrom ? " connecting" : "")}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
        <div className={"mmworld" + (anim ? " anim" : "")} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="mmedges" width="1" height="1">
            {visibleEdges.map((e) => {
              const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) return null;
              const hi = near && near.has(e.a) && near.has(e.b) && (e.a === focusKey || e.b === focusKey);
              return <line key={e.a + "|" + e.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={(e.free ? "free " : "") + (hi ? "hi" : near ? "dim" : "")} />;
            })}
          </svg>
          {visibleNodes.map((n) => {
            const q = pos.get(n.key); if (!q) return null;
            const dim = near && !near.has(n.key);
            const showLabel = labelsOn || n.kind === "center" || n.kind === "project" || n.kind === "free" || hover === n.key;
            return (
              <div key={n.key} data-key={n.key}
                className={`mnode k-${n.kind}` + (dim ? " dim" : "") + (selected === n.key ? " sel" : "") + (connectFrom === n.key ? " from" : "") + (n.role ? " r-" + n.role : "") + (n.done ? " done" : "")}
                style={{ left: q.x, top: q.y, ["--c" as string]: nodeColor(n) }}
                onPointerEnter={() => { if (!drag.current) setHover(n.key); }}
                onPointerLeave={() => setHover((h) => (h === n.key ? null : h))}>
                {n.kind === "person" ? <Avatar name={n.label} path={n.portrait} size={n.role === "lead" ? 64 : 52} />
                  : n.kind === "free" ? <span className="mfree">{n.label}</span>
                  : <i className="mdot">{n.kind === "center" ? "" : n.kind === "task" ? (n.done ? "✓" : "") : n.kind === "file" ? "D" : n.kind === "folder" ? "O" : ""}</i>}
                {showLabel && n.kind !== "free" && <span className="mlabel">{n.label}</span>}
              </div>
            );
          })}
        </div>

        <div className="mmtools">
          <button className="btn" onClick={addNode}><span>+ Knoten</span></button>
          <button className="mini" onClick={() => fitAll(true)}>Alles zeigen</button>
          <button className="mini" onClick={rearrange}>Neu anordnen</button>
          <span className="pzoom">
            <button className="mini" aria-label="Verkleinern" onClick={() => setView((v) => ({ ...v, z: Math.max(ZMIN, v.z / 1.2) }))}>−</button>
            <b>{Math.round(view.z * 100)}%</b>
            <button className="mini" aria-label="Vergrößern" onClick={() => setView((v) => ({ ...v, z: Math.min(ZMAX, v.z * 1.2) }))}>+</button>
          </span>
          {msg && <span className="flash inline">{msg}</span>}
        </div>
        <div className="mmfilter">
          {FILTERS.map((f) => (
            <button key={f.kind} className={"mfchip" + (hidden.has(f.kind) ? " off" : "")} onClick={() => toggleFilter(f.kind)}>
              <i style={{ background: f.color }} />{f.label}
            </button>
          ))}
        </div>
        {connectFrom && <div className="phint">Linie ziehen: jetzt den zweiten Knoten anklicken. Eine bestehende eigene Linie wird so wieder gelöst. Esc bricht ab.</div>}
        {err && <div className="errbox perr">{err}</div>}

        {sel && !connectFrom && (
          <div className="mmpanel paperbox">
            <small className="mkind">{KIND_LABEL[sel.kind]}{sel.role === "lead" ? " · Zuständig" : sel.role === "member" ? " · Mitarbeit" : ""}</small>
            {sel.kind === "free" && edit ? (
              <>
                <input className="field" autoFocus value={edit.label}
                  onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                  onBlur={() => saveFree(edit.label, edit.color)}
                  onKeyDown={(e) => { if (e.key === "Enter") { saveFree(edit.label, edit.color); (e.target as HTMLInputElement).blur(); } }} />
                <div className="mswatches">
                  {Object.entries(FREE_COLORS).map(([k, c]) => (
                    <button key={k} className={"msw" + (edit.color === k ? " on" : "")} style={{ background: c }} aria-label={k}
                      onClick={() => { setEdit({ ...edit, color: k }); saveFree(edit.label, k); }} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mfull">{sel.full}</p>
            )}
            <div className="inl">
              <button className="mini" onClick={() => setConnectFrom(sel.key)}>Linie ziehen</button>
              {sel.kind === "free" && <button className="mini" onClick={addNode}>+ Unterknoten</button>}
              {sel.kind === "project" && <button className="mini hot" onClick={() => onOpenProject(sel.refId)}>Projekt öffnen</button>}
              {(sel.kind === "file" || sel.kind === "folder") && sel.path && (
                <button className="mini" onClick={async () => { try { await (await fsapi()).open(sel.path!); } catch (e) { setErr(String(e)); } }}>Öffnen</button>
              )}
              {sel.kind === "free" && <button className={"mini" + (armDel ? " hot" : "")} onClick={removeFree}>{armDel ? "Wirklich löschen?" : "Löschen"}</button>}
            </div>
          </div>
        )}
        {!ready && <div className="mmloading">Ordne die Karte …</div>}
      </div>
    </div>
  );
}
