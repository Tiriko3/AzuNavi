// Große Projekt-Übersicht als Netzplan (Etappe 10): alle Projekte, ihre Verbindungen und Ansprechpartner.
// Doppelklick auf ein Projekt zoomt hinein und öffnet die Projektansicht.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NetGraph, layout, type GEdge, type GNode, type Pos } from "./NetGraph";
import type { BoardProject } from "../db/boardRepo";
import { listBoardPos, saveBoardPos, clearBoardPos } from "../db/boardRepo";
import type { Person, Scope } from "../db/repo";
import { Avatar } from "../Avatar";

const YARN: Record<Scope, string> = { arbeit: "#e8263f", schule: "#38b6ff" };
const ZONES = [
  { id: "schule", label: "Schule", x: -460, w: 0, color: "#38b6ff" },
  { id: "arbeit", label: "Arbeit", x: 460, w: 0, color: "#e8263f" },
];

interface Props {
  projects: BoardProject[]; threads: [number, number][]; persons: Person[]; scope: string;
  onOpen: (id: number) => void; onEdit: (p: BoardProject) => void; flash: (s: string) => void;
  connectMode?: boolean; connectFrom?: number | null; onConnect?: (id: number) => void;
}

export function ProjectNet({ projects, threads, persons, scope, onOpen, onEdit, flash, connectMode, connectFrom, onConnect }: Props) {
  const [pos, setPos] = useState<Map<string, Pos>>(new Map());
  const [sel, setSel] = useState<number | null>(null);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);

  const graph = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    const nodes: GNode[] = projects.map((p) => ({ key: String(p.id), zone: p.scope }));
    const edges: GEdge[] = threads.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({ a: String(a), b: String(b) }));
    return { nodes, edges };
  }, [projects, threads]);

  const zonePull = useCallback(
    (z: string | undefined) => (scope !== "alle" ? null : z === "schule" ? -420 : z === "arbeit" ? 420 : null),
    [scope]
  );
  const run = useRef(0);
  useEffect(() => {
    const r = ++run.current;
    (async () => {
      const saved = await listBoardPos();
      if (r !== run.current) return;
      const start = new Map<string, Pos>();
      const fixed = new Set<string>();
      const missing: string[] = [];
      graph.nodes.forEach((n) => {
        const s = saved.get(Number(n.key)) ?? pos.get(n.key);
        if (s) { start.set(n.key, s); fixed.add(n.key); } else missing.push(n.key);
      });
      if (!missing.length) { setPos(start); return; }
      missing.forEach((k, i) => {
        const p = byId.get(Number(k));
        const base = scope !== "alle" ? 0 : p?.scope === "schule" ? -420 : 420;
        start.set(k, { x: base + (Math.random() - 0.5) * 260, y: (i % 6) * 170 - 400 });
      });
      const out = layout(graph.nodes, graph.edges, start, fixed, zonePull, saved.size ? 220 : 360);
      if (r !== run.current) return;
      setPos(out);
      await saveBoardPos(missing.map((k) => ({ id: Number(k), ...out.get(k)! })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, scope]);

  const move = (key: string, p: Pos) => {
    setPos((m) => { const n = new Map(m); n.set(key, p); return n; });
    saveBoardPos([{ id: Number(key), ...p }]).catch(() => {});
  };
  const rearrange = async () => {
    await clearBoardPos();
    run.current++;
    const start = new Map<string, Pos>();
    graph.nodes.forEach((n, i) => {
      const p = byId.get(Number(n.key));
      const base = scope !== "alle" ? 0 : p?.scope === "schule" ? -420 : 420;
      start.set(n.key, { x: base + (Math.random() - 0.5) * 260, y: (i % 6) * 170 - 400 });
    });
    const out = layout(graph.nodes, graph.edges, start, new Set(), zonePull, 380);
    setPos(out);
    await saveBoardPos([...out].map(([k, p]) => ({ id: Number(k), ...p })));
    flash("Neu angeordnet");
  };

  const selP = sel ? byId.get(sel) : null;
  return (
    <NetGraph nodes={graph.nodes} edges={graph.edges} pos={pos} className={"pjnet" + (connectMode ? " connecting" : "")}
      fitKey={scope + "-" + graph.nodes.length}
      onMove={move}
      onClick={(k) => {
        if (!k) { setSel(null); return; }
        if (connectMode && onConnect) { onConnect(Number(k)); return; }
        setSel((s) => (s === Number(k) ? null : Number(k)));
      }}
      onDoubleClick={connectMode ? undefined : (k) => onOpen(Number(k))}
      selected={sel ? String(sel) : null}
      zones={scope === "alle" ? ZONES : undefined}
      renderEdge={(e, a, b, hi) => {
        const pa = byId.get(Number(e.a)), pb = byId.get(Number(e.b));
        const col = pa && pb && pa.scope !== pb.scope ? "#9b6bff" : YARN[pa?.scope ?? "arbeit"];
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} className={hi ? "hi" : ""} />;
      }}
      renderNode={(k) => {
        const p = byId.get(Number(k)); if (!p) return null;
        const lead = p.leadId ? personById.get(p.leadId) : null;
        const members = p.memberIds.map((m) => personById.get(m)).filter((x): x is Person => !!x).slice(0, 3);
        return (
          <div className={"pjnode " + p.scope + (connectFrom === p.id ? " from" : "")}>
            <b>{p.name}</b>
            {(lead || members.length > 0) && (
              <div className="pjpeople">
                {lead && <span className="pjlead" title={"Zuständig: " + lead.name}><Avatar name={lead.name} path={lead.portrait_path} size={40} /></span>}
                {members.map((m) => <span key={m.id} title={"Mitarbeit: " + m.name}><Avatar name={m.name} path={m.portrait_path} size={30} /></span>)}
              </div>
            )}
          </div>
        );
      }}>
      <div className="netzoom right nopan"><button className="mini" onClick={rearrange}>Neu anordnen</button></div>
      {selP && (
        <div className="netpanel paperbox nopan">
          <small className="mkind">{selP.scope === "schule" ? "Schule" : "Arbeit"} · {selP.status}</small>
          <b className="netname">{selP.name}</b>
          {selP.leadId && personById.get(selP.leadId) && <p className="small">Ansprechpartner: {personById.get(selP.leadId)!.name}</p>}
          <p className="small">Verbunden mit: {threads.filter(([a, b]) => a === selP.id || b === selP.id).map(([a, b]) => byId.get(a === selP.id ? b : a)?.name).filter(Boolean).join(", ") || "–"}</p>
          <div className="inl">
            <button className="btn" onClick={() => onOpen(selP.id)}><span>Projekt öffnen</span></button>
            <button className="mini" onClick={() => onEdit(selP)}>Bearbeiten</button>
          </div>
        </div>
      )}
      <div className="nethint nopan">{connectMode ? "Faden spannen: zwei Projekte nacheinander anklicken" : "Doppelklick auf ein Projekt öffnet es · Esc geht zurück"}</div>
    </NetGraph>
  );
}
