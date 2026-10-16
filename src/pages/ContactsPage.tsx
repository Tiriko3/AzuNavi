import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { clearPersonPos, deletePerson, listNotes, listPersonLinks, listPersonPos, listPersons, savePerson, savePersonPos, togglePersonLink, type Note, type Person, type PersonLink, type Scope } from "../db/repo";
import { NetGraph, layout, type GEdge, type GNode, type Pos } from "./NetGraph";
import { pickAndStoreImages } from "../files";
import { Avatar } from "../Avatar";
import { dateParts } from "../util";
import type { ScopeId } from "../items";

interface Draft {
  id?: number; name: string; role: string; scope: Scope; parent_id: number | null;
  phone: string; email: string; info: string; portrait_path: string | null;
  parentIds: number[]; childIds: number[];
}
// Zonen im Netzplan: Schule links, Arbeit rechts
const ZONES = [
  { id: "schule", label: "Schule", x: -460, w: 0, color: "#38b6ff" },
  { id: "arbeit", label: "Arbeit", x: 460, w: 0, color: "#e8263f" },
];
const SCOPE_LABEL: Record<Scope, string> = { schule: "Schule", arbeit: "Arbeit" };

/* ---------- Baum-Layout ---------- */
const NODE_W = 168, GAP = 22, LEVEL_H = 204, PAD = 24;
interface TNode { p: Person; kids: TNode[]; x: number; depth: number }

function buildTree(persons: Person[]) {
  const ids = new Set(persons.map((p) => p.id));
  const kidsOf = new Map<number, Person[]>();
  const roots: Person[] = [];
  for (const p of persons) {
    if (p.parent_id && ids.has(p.parent_id)) {
      const arr = kidsOf.get(p.parent_id) ?? [];
      arr.push(p); kidsOf.set(p.parent_id, arr);
    } else roots.push(p);
  }
  const seen = new Set<number>();
  let cursor = PAD;
  let maxDepth = 0;
  const all: TNode[] = [];
  const place = (p: Person, depth: number): TNode => {
    seen.add(p.id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = (kidsOf.get(p.id) ?? []).filter((k) => !seen.has(k.id)).map((k) => place(k, depth + 1));
    const node: TNode = { p, kids, x: 0, depth };
    if (kids.length === 0) { node.x = cursor + NODE_W / 2; cursor += NODE_W + GAP; }
    else node.x = (kids[0].x + kids[kids.length - 1].x) / 2;
    all.push(node);
    return node;
  };
  roots.forEach((r) => place(r, 0));
  // Falls durch einen Kreis Personen übrig bleiben, als eigene Wurzeln zeigen
  persons.filter((p) => !seen.has(p.id)).forEach((p) => place(p, 0));
  const edges: [TNode, TNode][] = [];
  all.forEach((n) => n.kids.forEach((k) => edges.push([n, k])));
  return { nodes: all, edges, width: Math.max(cursor + PAD - GAP, 400), height: (maxDepth + 1) * LEVEL_H + PAD };
}

export function ContactsPage({ scope, escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState<"baum" | "netz">("netz");
  const [links, setLinks] = useState<PersonLink[]>([]);
  const [pos, setPos] = useState<Map<string, Pos>>(new Map());
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [netSel, setNetSel] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState("");
  const [born, setBorn] = useState<number | null>(null); // neue Person: Punkt wächst und macht „Pop“
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try {
      const [p, n, l] = await Promise.all([listPersons(), listNotes(), listPersonLinks()]);
      setPersons(p); setNotes(n); setLinks(l); setErr("");
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    escRef.current = () => {
      if (connectFrom) { setConnectFrom(null); return true; }
      if (draft) { setDraft(null); setConfirmDel(false); return true; }
      if (netSel) { setNetSel(null); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, draft, connectFrom, netSel]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };
  const shown = useMemo(() => persons.filter((p) => scope === "alle" || p.scope === scope), [persons, scope]);
  const tree = useMemo(() => buildTree(shown), [shown]);

  /* ---------- Netzplan ---------- */
  const graph = useMemo(() => {
    const ids = new Set(shown.map((p) => p.id));
    const nodes: GNode[] = shown.map((p) => ({ key: String(p.id), zone: p.scope }));
    const edges: GEdge[] = links.filter((l) => ids.has(l.a_id) && ids.has(l.b_id))
      .map((l) => ({ a: String(l.a_id), b: String(l.b_id), kind: "hier" }));
    return { nodes, edges };
  }, [shown, links]);

  const layoutRun = useRef(0);
  useEffect(() => {
    if (view !== "netz") return;
    const run = ++layoutRun.current;
    (async () => {
      const saved = await listPersonPos();
      if (run !== layoutRun.current) return;
      const start = new Map<string, Pos>();
      const fixed = new Set<string>();
      const missing: string[] = [];
      graph.nodes.forEach((n) => {
        const s = saved.get(Number(n.key)) ?? pos.get(n.key);
        if (s) { start.set(n.key, s); fixed.add(n.key); } else missing.push(n.key);
      });
      if (!missing.length) { setPos(start); return; }
      // Zonen: Schule nach links, Arbeit nach rechts (bei „Alles“ nebeneinander)
      const zonePull = (z: string | undefined) => (scope !== "alle" ? null : z === "schule" ? -420 : z === "arbeit" ? 420 : null);
      missing.forEach((k, i) => {
        const p = shown.find((x) => String(x.id) === k);
        const base = scope !== "alle" ? 0 : p?.scope === "schule" ? -420 : 420;
        start.set(k, { x: base + (Math.random() - 0.5) * 240, y: (i % 7) * 150 - 420 + (Math.random() - 0.5) * 90 });
      });
      const out = layout(graph.nodes, graph.edges, start, fixed, zonePull, saved.size ? 220 : 360);
      if (run !== layoutRun.current) return;
      setPos(out);
      await savePersonPos(missing.map((k) => ({ id: Number(k), ...out.get(k)! })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, view, scope]);

  const moveNode = (key: string, p: Pos) => {
    setPos((m) => { const n = new Map(m); n.set(key, p); return n; });
    savePersonPos([{ id: Number(key), ...p }]).catch(() => {});
  };
  const clickNode = async (key: string) => {
    if (!key) { setNetSel(null); setConnectFrom(null); return; }
    const id = Number(key);
    if (connectFrom) {
      if (connectFrom !== id) {
        const now = await togglePersonLink(connectFrom, id);
        setLinks(await listPersonLinks());
        flash(now ? "Verbindung gesetzt" : "Verbindung gelöst");
      }
      setConnectFrom(null); return;
    }
    setNetSel((s) => (s === id ? null : id));
  };
  const rearrange = async () => {
    await clearPersonPos();
    setPos(new Map()); layoutRun.current++;
    const zonePull = (z: string | undefined) => (scope !== "alle" ? null : z === "schule" ? -420 : z === "arbeit" ? 420 : null);
    const start = new Map<string, Pos>();
    graph.nodes.forEach((n, i) => {
      const p = shown.find((x) => String(x.id) === n.key);
      const base = scope !== "alle" ? 0 : p?.scope === "schule" ? -420 : 420;
      start.set(n.key, { x: base + (Math.random() - 0.5) * 240, y: (i % 7) * 150 - 420 });
    });
    const out = layout(graph.nodes, graph.edges, start, new Set(), zonePull, 380);
    setPos(out);
    await savePersonPos([...out].map(([k, p]) => ({ id: Number(k), ...p })));
    flash("Neu angeordnet");
  };
  const byId = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);

  // Personen, die NICHT als "zugeordnet zu" in Frage kommen: man selbst und alle darunter
  const blocked = useMemo(() => {
    const out = new Set<number>();
    if (!draft?.id) return out;
    const walk = (id: number) => {
      out.add(id);
      persons.filter((p) => p.parent_id === id).forEach((c) => { if (!out.has(c.id)) walk(c.id); });
    };
    walk(draft.id);
    return out;
  }, [draft?.id, persons]);

  const blank = (parent: number | null = null): Draft => ({
    name: "", role: "", scope: scope === "schule" ? "schule" : "arbeit", parent_id: parent,
    phone: "", email: "", info: "", portrait_path: null,
    parentIds: parent ? [parent] : [], childIds: [],
  });
  const startEdit = (p: Person) => {
    setConfirmDel(false); setErr("");
    setDraft({
      id: p.id, name: p.name, role: p.role ?? "", scope: p.scope, parent_id: p.parent_id,
      phone: p.phone ?? "", email: p.email ?? "", info: p.info ?? "", portrait_path: p.portrait_path,
      parentIds: links.filter((l) => l.b_id === p.id).map((l) => l.a_id),
      childIds: links.filter((l) => l.a_id === p.id).map((l) => l.b_id),
    });
  };
  const patch = (x: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...x } : d));

  const onSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr("Bitte einen Namen eintragen."); return; }
    try {
      const isNew = !draft.id;
      const id = await savePerson(draft);
      setDraft(null); setErr("");
      await reload();
      if (isNew) { setBorn(id); setTimeout(() => setBorn(null), 1400); }
      flash(isNew ? "Neue Person ist da" : "Person gespeichert");
    } catch (e) { setErr("Speichern fehlgeschlagen: " + String(e)); }
  };
  const onDelete = async () => {
    if (!draft?.id) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await deletePerson(draft.id); setDraft(null); await reload(); flash("Person gelöscht"); }
    catch (e) { setErr(String(e)); }
  };
  const pickPortrait = async () => {
    try {
      const f = await pickAndStoreImages("portraits", false);
      if (f[0]) patch({ portrait_path: f[0].path });
    } catch (e) { setErr("Porträt konnte nicht hinzugefügt werden: " + String(e)); }
  };

  const linkedNotes = useMemo(
    () => (draft?.id ? notes.filter((n) => n.personIds.includes(draft.id!)).slice(0, 6) : []),
    [notes, draft?.id]
  );
  const selectedId = draft?.id ?? null;

  return (
    <div className="work">
      <section className="wcol wlist">
        <div className="wtools">
          <button className="btn" onClick={() => { setErr(""); setConfirmDel(false); setDraft(blank()); }}><span>+ Neue Person</span></button>
          {selectedId && (
            <button className="btn ghost" onClick={() => { setErr(""); setConfirmDel(false); setDraft(blank(selectedId)); }}>
              <span>+ Unterperson</span>
            </button>
          )}
          <span className="pvtabs">
            <button className={"pvtab" + (view === "netz" ? " on" : "")} onClick={() => setView("netz")}><span>Netzplan</span></button>
            <button className={"pvtab" + (view === "baum" ? " on" : "")} onClick={() => setView("baum")}><span>Baum</span></button>
          </span>
          {view === "netz" && <button className="mini" onClick={rearrange}>Neu anordnen</button>}
          <span className="small grow">{shown.length} {shown.length === 1 ? "Person" : "Personen"}</span>
        </div>
        {msg && <div className="flash">{msg}</div>}
        {!draft && err && <div className="errbox">{err}</div>}
        {view === "netz" ? (
          shown.length === 0 ? (
            <div className="empty paperbox">
              <b>Noch keine Kontakte.</b>
              <p>Lege Personen an und verbinde sie miteinander: Ausbilder, Abteilungsleitung, Kolleginnen, Lehrkräfte. Daraus entsteht dein Netzplan.</p>
            </div>
          ) : (
            <NetGraph nodes={graph.nodes} edges={graph.edges} pos={pos} fitKey={scope + "-" + view + "-" + graph.nodes.length}
              onMove={moveNode} onClick={clickNode} onDoubleClick={(k) => { const p = byId.get(Number(k)); if (p) startEdit(p); }}
              selected={netSel ? String(netSel) : null}
              className={"pnet" + (connectFrom ? " connecting" : "")}
              zones={scope === "alle" ? ZONES : undefined}
              renderEdge={(e, a, b, hi) => {
                const pa = byId.get(Number(e.a)), pb = byId.get(Number(e.b));
                const mixed = pa && pb && pa.scope !== pb.scope;
                const col = mixed ? "#9b6bff" : pa?.scope === "schule" ? "#38b6ff" : "#e8263f";
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} className={hi ? "hi" : ""} markerEnd="url(#parrow)" />;
              }}
              renderNode={(k) => {
                const p = byId.get(Number(k)); if (!p) return null;
                const lead = links.some((l) => l.a_id === p.id);
                return (
                  <div className={"pnode" + (connectFrom === p.id ? " from" : "") + (born === p.id ? " born" : "")}>
                    <Avatar name={p.name} path={p.portrait_path} size={lead ? 84 : 72} />
                    <b>{p.name}</b>
                    <small>{p.role || SCOPE_LABEL[p.scope]}</small>
                    <i className={"dot " + p.scope} />
                  </div>
                );
              }}>
              <svg width="0" height="0"><defs>
                <marker id="parrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" />
                </marker>
              </defs></svg>
              {connectFrom && <div className="phint">Verbindung: jetzt die zweite Person anklicken (die erste ist dann übergeordnet). Dasselbe Paar nochmal löst die Verbindung. Esc bricht ab.</div>}
              {netSel && !connectFrom && (() => {
                const p = byId.get(netSel); if (!p) return null;
                const oben = links.filter((l) => l.b_id === p.id).map((l) => byId.get(l.a_id)?.name).filter(Boolean);
                const unten = links.filter((l) => l.a_id === p.id).map((l) => byId.get(l.b_id)?.name).filter(Boolean);
                return (
                  <div className="netpanel paperbox nopan">
                    <small className="mkind">{SCOPE_LABEL[p.scope]}{p.role ? " · " + p.role : ""}</small>
                    <b className="netname">{p.name}</b>
                    {oben.length > 0 && <p className="small">Übergeordnet: {oben.join(", ")}</p>}
                    {unten.length > 0 && <p className="small">Untergeordnet: {unten.join(", ")}</p>}
                    <div className="inl">
                      <button className="mini" onClick={() => setConnectFrom(p.id)}>Verbindung ziehen</button>
                      <button className="mini hot" onClick={() => startEdit(p)}>Bearbeiten</button>
                    </div>
                  </div>
                );
              })()}
            </NetGraph>
          )
        ) : (
        <div className="scroll tree">
          {shown.length === 0 ? (
            <div className="empty paperbox">
              <b>Noch keine Kontakte.</b>
              <p>Lege Personen an und ordne sie einander zu, zum Beispiel Ausbilder, Abteilungsleiter und Kollegen. Daraus entsteht dein Personenbaum.</p>
            </div>
          ) : (
            <div className="treecanvas" style={{ width: tree.width, height: tree.height }}>
              <svg className="treelines" width={tree.width} height={tree.height}>
                {tree.edges.map(([a, b]) => {
                  const x1 = a.x, y1 = PAD + a.depth * LEVEL_H + 150, x2 = b.x, y2 = PAD + b.depth * LEVEL_H + 8;
                  const my = (y1 + y2) / 2;
                  return <path key={a.p.id + "-" + b.p.id} d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} />;
                })}
              </svg>
              {tree.nodes.map((n) => (
                <button key={n.p.id} className={"tnode" + (selectedId === n.p.id ? " sel" : "") + (born === n.p.id ? " born" : "")}
                  style={{ left: n.x - NODE_W / 2, top: PAD + n.depth * LEVEL_H, width: NODE_W }}
                  onClick={() => startEdit(n.p)}>
                  <Avatar name={n.p.name} path={n.p.portrait_path} size={88} />
                  <b>{n.p.name}</b>
                  <small>{n.p.role || SCOPE_LABEL[n.p.scope]}</small>
                  <i className={"dot " + n.p.scope} />
                </button>
              ))}
            </div>
          )}
        </div>
        )}

      </section>

      <section className="wcol wedit">
        {!draft ? (
          <div className="paperbox hintcard">
            <h3>Kontakte</h3>
            <p>Klicke eine Person im Baum an, um sie zu bearbeiten. Unter einer markierten Person legst du mit „+ Unterperson“ jemanden an, der ihr zugeordnet ist.</p>
            <p className="small">Telefon, E-Mail und Porträt bleiben nur in der lokalen Datenbank auf diesem Rechner.</p>
          </div>
        ) : (
          <div className="paperbox editor">
            <h3>{draft.id ? "Person bearbeiten" : "Neue Person"}</h3>
            {err && <div className="errbox">{err}</div>}

            <div className="portraitrow">
              <Avatar name={draft.name || "?"} path={draft.portrait_path} size={92} />
              <div className="col">
                <button type="button" className="mini" onClick={pickPortrait}>{draft.portrait_path ? "Porträt ändern" : "Porträt wählen"}</button>
                {draft.portrait_path && <button type="button" className="mini" onClick={() => patch({ portrait_path: null })}>Porträt entfernen</button>}
              </div>
            </div>

            <label className="lab">Name
              <input className="field" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <div className="row2">
              <label className="lab">Funktion / Rolle
                <input className="field" value={draft.role} placeholder="z. B. Ausbilder" onChange={(e) => patch({ role: e.target.value })} />
              </label>
              <div className="lab">Bereich
                <div className="seg">
                  {(["arbeit", "schule"] as Scope[]).map((s) => (
                    <button type="button" key={s} className={"segb " + s + (draft.scope === s ? " on" : "")}
                      onClick={() => patch({ scope: s })}><span>{SCOPE_LABEL[s]}</span></button>
                  ))}
                </div>
              </div>
            </div>
            <div className="row2">
              <label className="lab">Übergeordnet (mehrere möglich)
                <div className="chips">
                  {draft.parentIds.map((id) => (
                    <span key={id} className="chip sel">{byId.get(id)?.name ?? "?"}
                      <button type="button" aria-label="entfernen" onClick={() => patch({ parentIds: draft.parentIds.filter((x) => x !== id) })}>×</button></span>
                  ))}
                  <select className="field mini-select" value="" onChange={(e) => e.target.value && patch({ parentIds: [...draft.parentIds, Number(e.target.value)] })}>
                    <option value="">+ hinzufügen</option>
                    {persons.filter((p) => !blocked.has(p.id) && !draft.parentIds.includes(p.id) && !draft.childIds.includes(p.id)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="lab">Untergeordnet (mehrere möglich)
                <div className="chips">
                  {draft.childIds.map((id) => (
                    <span key={id} className="chip sel">{byId.get(id)?.name ?? "?"}
                      <button type="button" aria-label="entfernen" onClick={() => patch({ childIds: draft.childIds.filter((x) => x !== id) })}>×</button></span>
                  ))}
                  <select className="field mini-select" value="" onChange={(e) => e.target.value && patch({ childIds: [...draft.childIds, Number(e.target.value)] })}>
                    <option value="">+ hinzufügen</option>
                    {persons.filter((p) => p.id !== draft.id && !draft.childIds.includes(p.id) && !draft.parentIds.includes(p.id)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
            <div className="row2">
              <label className="lab">Telefon
                <input className="field" value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
              </label>
              <label className="lab">E-Mail
                <input className="field" value={draft.email} onChange={(e) => patch({ email: e.target.value })} />
              </label>
            </div>
            <label className="lab">Info
              <textarea className="field" rows={3} value={draft.info} onChange={(e) => patch({ info: e.target.value })} />
            </label>

            {draft.id && (
              <div className="lab">Notizen mit dieser Person
                {linkedNotes.length === 0 ? <span className="small">Noch keine verknüpft (in einer Notiz unter „Mit wem?“ auswählen).</span> : (
                  <ul className="mini-notes">
                    {linkedNotes.map((n) => {
                      const d = dateParts(n.date);
                      return <li key={n.id}><b>{d.day}. {d.month}</b> {n.text.length > 70 ? n.text.slice(0, 70) + " …" : n.text}</li>;
                    })}
                  </ul>
                )}
              </div>
            )}

            <div className="actions">
              <button className="btn" onClick={onSave}><span>Speichern</span></button>
              <button className="btn ghost" onClick={() => { setDraft(null); setErr(""); }}><span>Abbrechen</span></button>
              {draft.id && (
                <button className={"btn danger" + (confirmDel ? " arm" : "")} onClick={onDelete}>
                  <span>{confirmDel ? "Wirklich löschen?" : "Löschen"}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
