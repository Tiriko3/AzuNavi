// Gemeinsame Netzplan-Ansicht (Etappe 10): Knoten ziehen, zoomen, verschieben, Nachbarn hervorheben.
// Wird vom Personen-Netz und von der Projekt-Übersicht genutzt.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";

export interface GNode { key: string; x?: number; y?: number; zone?: string; w?: number; h?: number }
export interface GEdge { a: string; b: string; kind?: string }
export type Pos = { x: number; y: number };

const ZMIN = 0.2, ZMAX = 2.4;
export const stageScale = () => { const st = document.getElementById("stage"); return st ? st.getBoundingClientRect().width / 1600 : 1; };

/** Kräfte-Layout: verbundene Knoten ziehen sich an, alle stoßen sich ab, Zonen ziehen zu ihrer Seite */
export function layout(nodes: GNode[], edges: GEdge[], start: Map<string, Pos>, fixed: Set<string>, zonePull?: (z: string | undefined) => number | null, iters = 320): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  nodes.forEach((n) => pos.set(n.key, { ...(start.get(n.key) ?? { x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 400 }) }));
  const keys = nodes.map((n) => n.key);
  const zone = new Map(nodes.map((n) => [n.key, n.zone]));
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    const f = new Map<string, Pos>(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < keys.length; i++) {
      const a = pos.get(keys[i])!;
      for (let j = i + 1; j < keys.length; j++) {
        const b = pos.get(keys[j])!;
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const rep = Math.min(90, 46000 / d2), d = Math.sqrt(d2);
        const fx = (dx / d) * rep, fy = (dy / d) * rep;
        f.get(keys[i])!.x += fx; f.get(keys[i])!.y += fy;
        f.get(keys[j])!.x -= fx; f.get(keys[j])!.y -= fy;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.a), b = pos.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const s = (d - 300) * 0.05;
      f.get(e.a)!.x += (dx / d) * s; f.get(e.a)!.y += (dy / d) * s;
      f.get(e.b)!.x -= (dx / d) * s; f.get(e.b)!.y -= (dy / d) * s;
    }
    for (const k of keys) {
      if (fixed.has(k)) continue;
      const p = pos.get(k)!, fk = f.get(k)!;
      const target = zonePull?.(zone.get(k));
      if (target !== null && target !== undefined) fk.x += (target - p.x) * 0.05; else fk.x -= p.x * 0.004;
      fk.y -= p.y * 0.006;
      p.x += Math.max(-34, Math.min(34, fk.x * cool));
      p.y += Math.max(-34, Math.min(34, fk.y * cool));
    }
  }
  return pos;
}

interface Props {
  nodes: GNode[]; edges: GEdge[]; pos: Map<string, Pos>;
  onMove: (key: string, p: Pos) => void; onClick: (key: string) => void; onDoubleClick?: (key: string) => void;
  renderNode: (key: string, hovered: boolean) => ReactNode; renderEdge?: (e: GEdge, a: Pos, b: Pos, hi: boolean) => ReactNode;
  zones?: { id: string; label: string; x: number; w: number; color: string }[];
  selected?: string | null; className?: string; children?: ReactNode; fitKey?: string;
  /** Mehrfachauswahl (von außen steuerbar, z. B. „ganze Gruppe markieren“) */
  multi?: Set<string>; onMultiChange?: (s: Set<string>) => void;
  /** Nach dem Ziehen mehrerer Knoten: alle neuen Positionen auf einmal (zum Speichern) */
  onMoveEnd?: (keys: string[]) => void;
}

/** Zeichenfläche mit Zoom, Verschieben und Ziehen – die Knoten selbst kommen von außen */
export function NetGraph({ nodes, edges, pos, onMove, onClick, onDoubleClick, renderNode, renderEdge, zones, selected, className, children, fitKey, multi: multiProp, onMultiChange, onMoveEnd }: Props) {
  const [multiOwn, setMultiOwn] = useState<Set<string>>(new Set());
  const multi = multiProp ?? multiOwn;
  const setMulti = (s: Set<string>) => { if (onMultiChange) onMultiChange(s); else setMultiOwn(s); };
  const [lasso, setLasso] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 0.8 });
  const [hover, setHover] = useState<string | null>(null);
  const [anim, setAnim] = useState(false);
  const vp = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "node" | "pan" | "group" | "lasso"; key?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; keys?: string[]; orig?: Map<string, Pos> } | null>(null);
  const toWorld = (clientX: number, clientY: number): Pos => {
    const r = vp.current!.getBoundingClientRect(), k = stageScale();
    return { x: ((clientX - r.left) / k - view.x) / view.z, y: ((clientY - r.top) / k - view.y) / view.z };
  };
  const startGroup = (keys: string[], e: RPointerEvent<HTMLDivElement>) => {
    const orig = new Map<string, Pos>(); keys.forEach((k) => { const q = pos.get(k); if (q) orig.set(k, q); });
    drag.current = { kind: "group", keys, orig, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, moved: false };
  };
  const clickTimer = useRef<number | undefined>(undefined);

  const size = () => { const r = vp.current?.getBoundingClientRect(); const k = stageScale(); return r ? { w: r.width / k, h: r.height / k } : { w: 1400, h: 600 }; };
  const fit = useCallback((animate = true) => {
    const pts = nodes.map((n) => pos.get(n.key)).filter((p): p is Pos => !!p);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x)) - 200, maxX = Math.max(...pts.map((p) => p.x)) + 200;
    const minY = Math.min(...pts.map((p) => p.y)) - 150, maxY = Math.max(...pts.map((p) => p.y)) + 170;
    const { w, h } = size();
    const z = Math.max(ZMIN, Math.min(1.1, w / (maxX - minX), h / (maxY - minY)));
    if (animate) { setAnim(true); setTimeout(() => setAnim(false), 480); }
    setView({ z, x: w / 2 - ((minX + maxX) / 2) * z, y: h / 2 - ((minY + maxY) / 2) * z });
  }, [nodes, pos]);
  const fitted = useRef("");
  useEffect(() => { if (pos.size && fitted.current !== (fitKey ?? "")) { fitted.current = fitKey ?? ""; fit(false); } }, [pos, fit, fitKey]);

  useEffect(() => {
    const el = vp.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".nopan")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), k = stageScale();
      const cx = (e.clientX - r.left) / k, cy = (e.clientY - r.top) / k;
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => { const z = Math.max(ZMIN, Math.min(ZMAX, v.z * f)); return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".nopan")) return;
    const grip = t.closest(".netzone-grip") as HTMLElement | null;
    const el = t.closest(".gnode") as HTMLElement | null;
    if (grip) startGroup(nodes.filter((n) => n.zone === grip.dataset.zone).map((n) => n.key), e);   // ganzen Bereich verschieben
    else if (el) {
      const key = el.dataset.key!;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {   // markieren / Markierung aufheben
        const s = new Set(multi); if (s.has(key)) s.delete(key); else s.add(key); setMulti(s); return;
      }
      if (multi.has(key) && multi.size > 1) startGroup([...multi], e);   // ganze Auswahl verschieben
      else { const q = pos.get(key) ?? { x: 0, y: 0 }; drag.current = { kind: "node", key, sx: e.clientX, sy: e.clientY, ox: q.x, oy: q.y, moved: false }; }
    }
    else if (e.shiftKey) { const w = toWorld(e.clientX, e.clientY); drag.current = { kind: "lasso", sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, moved: false }; }
    else drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const k = stageScale(), dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "node" && d.key) onMove(d.key, { x: d.ox + dx / view.z, y: d.oy + dy / view.z });
    else if (d.kind === "group") d.orig!.forEach((q, k) => onMove(k, { x: q.x + dx / view.z, y: q.y + dy / view.z }));
    else if (d.kind === "lasso") { const w = toWorld(e.clientX, e.clientY); setLasso({ x1: d.ox, y1: d.oy, x2: w.x, y2: w.y }); }
    else setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.kind === "lasso") {
      if (lasso) {
        const [x1, x2] = [Math.min(lasso.x1, lasso.x2), Math.max(lasso.x1, lasso.x2)], [y1, y2] = [Math.min(lasso.y1, lasso.y2), Math.max(lasso.y1, lasso.y2)];
        const s = new Set(multi); nodes.forEach((n) => { const q = pos.get(n.key); if (q && q.x >= x1 && q.x <= x2 && q.y >= y1 && q.y <= y2) s.add(n.key); }); setMulti(s);
      }
      setLasso(null); return;
    }
    if (d?.kind === "group") { if (d.moved) { setHover(null); onMoveEnd?.(d.keys!); } return; }
    if (d?.kind === "node" && d.moved) onMoveEnd?.([d.key!]);
    if (!d || d.moved) { if (d?.moved) setHover(null); return; }
    if (d.kind === "pan" && multi.size) setMulti(new Set());
    if (d.kind === "pan") { onClick(""); return; }
    if (!d.key) return;
    const key = d.key;
    if (!onDoubleClick) { onClick(key); return; }
    if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = undefined; onDoubleClick(key); return; }
    clickTimer.current = window.setTimeout(() => { clickTimer.current = undefined; onClick(key); }, 230);
  };

  const focus = hover ?? selected;
  const near = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    edges.forEach((e) => { if (e.a === focus) s.add(e.b); if (e.b === focus) s.add(e.a); });
    return s;
  }, [focus, edges]);

  return (
    <div ref={vp} className={"netvp " + (className ?? "")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
      <div className={"networld" + (anim ? " anim" : "")} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {zones?.map((z) => {
          const pts = nodes.filter((n) => n.zone === z.id).map((n) => pos.get(n.key)).filter((p): p is Pos => !!p);
          if (pts.length < 1) return null;
          const minX = Math.min(...pts.map((p) => p.x)) - 110, maxX = Math.max(...pts.map((p) => p.x)) + 110;
          const minY = Math.min(...pts.map((p) => p.y)) - 90, maxY = Math.max(...pts.map((p) => p.y)) + 100;
          return (
            <div key={z.id} className="netzone" style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY, ["--zc" as string]: z.color }}>
              <span className="netzone-grip" data-zone={z.id} title="Ziehen: ganzen Bereich verschieben">⠿ {z.label}</span>
            </div>
          );
        })}
        <svg className="netedges" width="1" height="1">
          {edges.map((e) => {
            const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) return null;
            const hi = !!near && near.has(e.a) && near.has(e.b) && (e.a === focus || e.b === focus);
            return renderEdge ? <g key={e.a + "|" + e.b}>{renderEdge(e, a, b, hi)}</g>
              : <line key={e.a + "|" + e.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hi ? "hi" : near ? "dim" : ""} />;
          })}
        </svg>
        {nodes.map((n) => {
          const p = pos.get(n.key); if (!p) return null;
          return (
            <div key={n.key} data-key={n.key} style={{ left: p.x, top: p.y }}
              className={"gnode" + (near && !near.has(n.key) ? " dim" : "") + (selected === n.key ? " sel" : "") + (multi.has(n.key) ? " msel" : "")}
              onPointerEnter={() => { if (!drag.current) setHover(n.key); }}
              onPointerLeave={() => setHover((h) => (h === n.key ? null : h))}>
              {renderNode(n.key, hover === n.key)}
            </div>
          );
        })}
      </div>
      {lasso && <div className="netlasso" style={{ left: Math.min(lasso.x1, lasso.x2) * view.z + view.x, top: Math.min(lasso.y1, lasso.y2) * view.z + view.y, width: Math.abs(lasso.x2 - lasso.x1) * view.z, height: Math.abs(lasso.y2 - lasso.y1) * view.z }} />}
      {multi.size > 0 && <div className="netmulti nopan"><b>{multi.size} markiert</b> · zum Verschieben eins davon ziehen <button className="mini" onClick={() => setMulti(new Set())}>Aufheben</button></div>}
      <div className="nethelp nopan" title="Mehrere verschieben">Strg + Klick: markieren · Shift + Ziehen: Rahmen · Bereichsname ziehen: ganzer Bereich</div>
      <div className="netzoom nopan">
        <button className="mini" aria-label="Verkleinern" onClick={() => setView((v) => ({ ...v, z: Math.max(ZMIN, v.z / 1.25) }))}>−</button>
        <b>{Math.round(view.z * 100)}%</b>
        <button className="mini" aria-label="Vergrößern" onClick={() => setView((v) => ({ ...v, z: Math.min(ZMAX, v.z * 1.25) }))}>+</button>
        <button className="mini" onClick={() => fit(true)}>Alles zeigen</button>
      </div>
      {children}
    </div>
  );
}
