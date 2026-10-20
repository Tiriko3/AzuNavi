import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { clearPersonPos, deletePerson, listNotes, listPersonLinks, listPersonPos, listPersons, savePerson, savePersonPos, togglePersonLink, type Note, type Person, type PersonLink, type Scope, listGroups, createGroup, renameGroup, deleteGroup, listGroupMembers, setPersonGroups, type ContactGroup } from "../db/repo";
import { NetGraph, layout, type GEdge, type GNode, type Pos } from "./NetGraph";
import { pickAndStoreImages } from "../files";
import { Avatar } from "../Avatar";
import { dateParts } from "../util";
import type { ScopeId } from "../items";

interface Draft {
  id?: number; name: string; role: string; scope: Scope; parent_id: number | null;
  phone: string; email: string; info: string; portrait_path: string | null;
  parentIds: number[]; childIds: number[]; groupIds: number[]; relIds: number[];
}
// Zonen im Netzplan: Schule links, Arbeit rechts
const ZONES = [
  { id: "schule", label: "Schule", x: -460, w: 0, color: "#38b6ff" },
  { id: "arbeit", label: "Arbeit", x: 460, w: 0, color: "#e8263f" },
];
const SCOPE_LABEL: Record<Scope, string> = { schule: "Schule", arbeit: "Arbeit" };

export function ContactsPage({ scope, escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [members, setMembers] = useState<Map<number, number[]>>(new Map());
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [groupMgr, setGroupMgr] = useState(false);
  const [newGroup, setNewGroup] = useState("");
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
      const [p, n, l, g, m] = await Promise.all([listPersons(), listNotes(), listPersonLinks(), listGroups(), listGroupMembers()]);
      setPersons(p); setNotes(n); setLinks(l); setGroups(g); setMembers(m); setErr("");
      setGroupFilter((f) => (f && !g.some((x) => x.id === f) ? null : f));
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    escRef.current = () => {
      if (groupMgr) { setGroupMgr(false); return true; }
      if (connectFrom) { setConnectFrom(null); return true; }
      if (draft) { setDraft(null); setConfirmDel(false); return true; }
      if (netSel) { setNetSel(null); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, draft, connectFrom, netSel, groupMgr]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };
  const shown = useMemo(() => persons.filter((p) => (scope === "alle" || p.scope === scope) && (groupFilter === null || (members.get(p.id) ?? []).includes(groupFilter))), [persons, scope, groupFilter, members]);

  /* ---------- Netzplan ---------- */
  const graph = useMemo(() => {
    const ids = new Set(shown.map((p) => p.id));
    const nodes: GNode[] = shown.map((p) => ({ key: String(p.id), zone: p.scope }));
    const edges: GEdge[] = links.filter((l) => ids.has(l.a_id) && ids.has(l.b_id))
      .map((l) => ({ a: String(l.a_id), b: String(l.b_id), kind: l.kind === "kontakt" ? "kontakt" : "hier" }));
    return { nodes, edges };
  }, [shown, links]);

  const layoutRun = useRef(0);
  useEffect(() => {
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
  }, [graph, scope]);

  // Beim Ziehen nur anzeigen, gespeichert wird beim Loslassen (auch wenn viele auf einmal bewegt werden)
  const pendingPos = useRef(new Map<string, Pos>());
  const moveNode = (key: string, p: Pos) => {
    pendingPos.current.set(key, p);
    setPos((m) => { const n = new Map(m); n.set(key, p); return n; });
  };
  const moveEnd = () => {
    const list = [...pendingPos.current].map(([k, p]) => ({ id: Number(k), ...p })); pendingPos.current.clear();
    if (list.length) savePersonPos(list).catch(() => {});
  };
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [connectKind, setConnectKind] = useState<"leitung" | "kontakt">("leitung");
  const clickNode = async (key: string) => {
    if (!key) { setNetSel(null); setConnectFrom(null); return; }
    const id = Number(key);
    if (connectFrom) {
      if (connectFrom !== id) {
        const now = await togglePersonLink(connectFrom, id, connectKind);
        setLinks(await listPersonLinks());
        flash(now ? (connectKind === "kontakt" ? "Kontakt verbunden" : "Leitung gesetzt") : "Verbindung gelöst");
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
    parentIds: parent ? [parent] : [], childIds: [], groupIds: groupFilter ? [groupFilter] : [], relIds: [],
  });
  const startEdit = (p: Person) => {
    setConfirmDel(false); setErr("");
    setDraft({
      id: p.id, name: p.name, role: p.role ?? "", scope: p.scope, parent_id: p.parent_id,
      phone: p.phone ?? "", email: p.email ?? "", info: p.info ?? "", portrait_path: p.portrait_path,
      parentIds: links.filter((l) => l.kind !== "kontakt" && l.b_id === p.id).map((l) => l.a_id),
      childIds: links.filter((l) => l.kind !== "kontakt" && l.a_id === p.id).map((l) => l.b_id),
      relIds: links.filter((l) => l.kind === "kontakt" && (l.a_id === p.id || l.b_id === p.id)).map((l) => (l.a_id === p.id ? l.b_id : l.a_id)),
      groupIds: members.get(p.id) ?? [],
    });
  };
  const patch = (x: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...x } : d));

  const onSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr("Bitte einen Namen eintragen."); return; }
    try {
      const isNew = !draft.id;
      const id = await savePerson(draft);
      await setPersonGroups(id, draft.groupIds);
      setDraft(null); setErr("");
      await reload();
      if (isNew) { setBorn(id); setTimeout(() => setBorn(null), 1400); }
      flash(isNew ? "Neue Person ist da" : "Person gespeichert");
    } catch (e) { setErr("Speichern fehlgeschlagen: " + String(e)); }
  };
  const addGroupToDraft = async (name: string) => {
    try { const id = await createGroup(name); setGroups(await listGroups()); setDraft((d) => (d && !d.groupIds.includes(id) ? { ...d, groupIds: [...d.groupIds, id] } : d)); }
    catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
  };
  /** Person oder ganze Gruppe („g:ID“) zu Über-/Untergeordnet/Kontakte hinzufügen */
  const addIds = (field: "parentIds" | "childIds" | "relIds", v: string, blockedIds?: Set<number>) => {
    if (!draft || !v) return;
    const ids = v.startsWith("g:") ? persons.filter((p) => (members.get(p.id) ?? []).includes(Number(v.slice(2)))).map((p) => p.id) : [Number(v)];
    const taken = new Set([draft.id ?? -1, ...draft.parentIds, ...draft.childIds, ...draft.relIds]);
    const add = ids.filter((i) => !taken.has(i) && !blockedIds?.has(i));
    patch({ [field]: [...draft[field], ...add] } as Partial<Draft>);
    if (v.startsWith("g:")) flash(add.length ? `${add.length} ${add.length === 1 ? "Person" : "Personen"} aus der Gruppe hinzugefügt` : "Alle aus der Gruppe sind schon zugeordnet");
  };
  const groupOptions = () => groups.length > 0 && (
    <optgroup label="Ganze Gruppe">{groups.map((g) => <option key={"g" + g.id} value={"g:" + g.id}>👥 {g.name} ({[...members.values()].filter((x) => x.includes(g.id)).length})</option>)}</optgroup>);
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
    <div className={"work kontakte" + (draft ? "" : " nodraft")}>
      <section className="wcol wlist">
        <div className="wtools">
          <button className="btn" onClick={() => { setErr(""); setConfirmDel(false); setDraft(blank()); }}><span>+ Neue Person</span></button>
          {selectedId && (
            <button className="btn ghost" onClick={() => { setErr(""); setConfirmDel(false); setDraft(blank(selectedId)); }}>
              <span>+ Verbundene Person</span>
            </button>
          )}
          <span className="pvtabs grptabs" title="Nach Gruppe filtern">
            <button className={"pvtab" + (groupFilter === null ? " on" : "")} onClick={() => setGroupFilter(null)}><span>Alle</span></button>
            {groups.map((g) => (
              <button key={g.id} className={"pvtab" + (groupFilter === g.id ? " on" : "")} onClick={() => setGroupFilter(g.id)}>
                <span><i className="gdot" style={{ background: g.color }} />{g.name}</span></button>
            ))}
          </span>
          <button className="mini" onClick={() => { setNewGroup(""); setGroupMgr(true); }}>Gruppen …</button>
          {groups.length > 0 && <select className="field mini-select markgrp" value="" title="Alle Mitglieder einer Gruppe markieren, dann zusammen verschieben"
            onChange={(e) => { const gid = Number(e.target.value); if (!gid) return; setMulti(new Set(shown.filter((p) => (members.get(p.id) ?? []).includes(gid)).map((p) => String(p.id)))); }}>
            <option value="">Gruppe markieren …</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
          <button className="mini" onClick={rearrange}>Neu anordnen</button>
          <span className="small grow">{shown.length} {shown.length === 1 ? "Person" : "Personen"}</span>
        </div>
        {msg && <div className="flash">{msg}</div>}
        {!draft && err && <div className="errbox">{err}</div>}
        {(
          shown.length === 0 ? (
            <div className="empty paperbox">
              <b>{groupFilter !== null && persons.length > 0 ? "In dieser Gruppe ist noch niemand." : "Noch keine Kontakte."}</b>
              <p>{groupFilter !== null && persons.length > 0 ? "Öffne eine Person und hak die Gruppe an, oder leg eine neue Person an." : "Lege Personen an und verbinde sie miteinander: Ausbilder, Abteilungsleitung, Kolleginnen, Lehrkräfte. Daraus entsteht dein Netzplan."}</p>
            </div>
          ) : (
            <NetGraph nodes={graph.nodes} edges={graph.edges} pos={pos} fitKey={scope + "-" + groupFilter + "-" + graph.nodes.length + "-" + (draft ? 1 : 0)}
              onMove={moveNode} onMoveEnd={moveEnd} multi={multi} onMultiChange={setMulti} onClick={clickNode} onDoubleClick={(k) => { const p = byId.get(Number(k)); if (p) startEdit(p); }}
              selected={netSel ? String(netSel) : null}
              className={"pnet" + (connectFrom ? " connecting" : "")}
              zones={scope === "alle" ? ZONES : undefined}
              renderEdge={(e, a, b, hi) => {
                const pa = byId.get(Number(e.a)), pb = byId.get(Number(e.b));
                const mixed = pa && pb && pa.scope !== pb.scope;
                const col = mixed ? "#9b6bff" : pa?.scope === "schule" ? "#38b6ff" : "#e8263f";
                if (e.kind === "kontakt") return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd23f" strokeDasharray="10 8" className={"rel" + (hi ? " hi" : "")} />;
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} className={hi ? "hi" : ""} markerEnd="url(#parrow)" />;
              }}
              renderNode={(k) => {
                const p = byId.get(Number(k)); if (!p) return null;
                const lead = links.some((l) => l.kind !== "kontakt" && l.a_id === p.id);
                return (
                  <div className={"pnode" + (connectFrom === p.id ? " from" : "") + (born === p.id ? " born" : "")}>
                    <Avatar name={p.name} path={p.portrait_path} size={lead ? 84 : 72} />
                    <b>{p.name}</b>
                    <small>{p.role || SCOPE_LABEL[p.scope]}</small>
                    <i className={"dot " + p.scope} />
                    {(members.get(p.id) ?? []).length > 0 && <span className="gdots">{(members.get(p.id) ?? []).map((gid) => { const g = groups.find((x) => x.id === gid); return g ? <i key={gid} className="gdot" style={{ background: g.color }} title={g.name} /> : null; })}</span>}
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
                      <button className="mini" onClick={() => { setConnectKind("leitung"); setConnectFrom(p.id); }} title="Diese Person ist der nächsten übergeordnet">Leitung ziehen →</button>
                      <button className="mini" onClick={() => { setConnectKind("kontakt"); setConnectFrom(p.id); }} title="Gleichrangiger Kontakt oder Beziehung">Kontakt ziehen ↔</button>
                      <button className="mini hot" onClick={() => startEdit(p)}>Bearbeiten</button>
                    </div>
                  </div>
                );
              })()}
            </NetGraph>
          )
        )}

      </section>

      <section className="wcol wedit">
        {!draft ? (
          <div className="paperbox hintcard">
            <h3>Kontakte</h3>
            <p>Doppelklicke eine Person im Netzplan, um sie zu bearbeiten. Mit „Gruppen …“ teilst du Menschen in Gruppen ein, eine Person kann in mehreren sein.</p>
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
                  <select className="field mini-select" value="" onChange={(e) => addIds("parentIds", e.target.value, blocked)}>
                    <option value="">+ hinzufügen</option>
                    {persons.filter((p) => !blocked.has(p.id) && !draft.parentIds.includes(p.id) && !draft.childIds.includes(p.id)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                    ))}
                    {groupOptions()}
                  </select>
                </div>
              </label>
              <label className="lab">Untergeordnet (mehrere möglich)
                <div className="chips">
                  {draft.childIds.map((id) => (
                    <span key={id} className="chip sel">{byId.get(id)?.name ?? "?"}
                      <button type="button" aria-label="entfernen" onClick={() => patch({ childIds: draft.childIds.filter((x) => x !== id) })}>×</button></span>
                  ))}
                  <select className="field mini-select" value="" onChange={(e) => addIds("childIds", e.target.value)}>
                    <option value="">+ hinzufügen</option>
                    {persons.filter((p) => p.id !== draft.id && !draft.childIds.includes(p.id) && !draft.parentIds.includes(p.id)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                    ))}
                    {groupOptions()}
                  </select>
                </div>
              </label>
            </div>
            <label className="lab">Kontakte &amp; Beziehungen (gleichrangig, ohne Über-/Unterordnung)
              <div className="chips">
                {draft.relIds.map((id) => (
                  <span key={id} className="chip sel rel">{byId.get(id)?.name ?? "?"}
                    <button type="button" aria-label="entfernen" onClick={() => patch({ relIds: draft.relIds.filter((x) => x !== id) })}>×</button></span>
                ))}
                <select className="field mini-select" value="" onChange={(e) => addIds("relIds", e.target.value)}>
                  <option value="">+ hinzufügen</option>
                  {persons.filter((p) => p.id !== draft.id && !draft.relIds.includes(p.id) && !draft.parentIds.includes(p.id) && !draft.childIds.includes(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>
                  ))}
                  {groupOptions()}
                </select>
              </div>
            </label>
            <div className="row2">
            <div className="lab">Gruppen (mehrere möglich)
              <div className="gpick">
                {groups.map((g) => { const on = draft.groupIds.includes(g.id); return (
                  <button type="button" key={g.id} className={"gchip" + (on ? " on" : "")} style={{ ["--gc" as string]: g.color }}
                    onClick={() => patch({ groupIds: on ? draft.groupIds.filter((x) => x !== g.id) : [...draft.groupIds, g.id] })}>{on ? "✓ " : ""}{g.name}</button>); })}
                <input className="field gnew" placeholder="+ neue Gruppe, Enter" maxLength={60}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; if (v.trim()) { addGroupToDraft(v); (e.target as HTMLInputElement).value = ""; } e.preventDefault(); } }} />
              </div>
            </div>
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
      {groupMgr && (
        <div className="fmodal impmodal" onClick={() => setGroupMgr(false)}>
          <div className="impbox paperbox grpmgr" onClick={(e) => e.stopPropagation()}>
            <h3>Gruppen</h3>
            <p className="small">Teile Menschen in Gruppen ein, z. B. Abteilung, Klasse, Projektteam. Eine Person kann in mehreren Gruppen sein. Löschen entfernt nur die Gruppe, nicht die Personen.</p>
            {err && <div className="errbox">{err}</div>}
            {groups.length === 0 && <p className="small"><i>Noch keine Gruppen.</i></p>}
            {groups.map((g) => (
              <GroupRow key={g.id} g={g} count={[...members.values()].filter((ids) => ids.includes(g.id)).length}
                onRename={async (n) => { try { await renameGroup(g.id, n); setErr(""); await reload(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } }}
                onDelete={async () => { await deleteGroup(g.id); await reload(); flash(`Gruppe „${g.name}“ gelöscht`); }} />
            ))}
            <div className="inl" style={{ marginTop: 10 }}>
              <input className="field" placeholder="Neue Gruppe" value={newGroup} maxLength={60} onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={async (e) => { if (e.key === "Enter" && newGroup.trim()) { await createGroup(newGroup); setNewGroup(""); await reload(); } }} />
              <button className="mini hot" disabled={!newGroup.trim()} onClick={async () => { await createGroup(newGroup); setNewGroup(""); await reload(); }}>Anlegen</button>
            </div>
            <div className="actions static"><button className="btn ghost" onClick={() => setGroupMgr(false)}><span>Fertig</span></button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Eine Zeile in der Gruppenverwaltung: umbenennen (Enter oder Feld verlassen), löschen mit Rückfrage */
function GroupRow({ g, count, onRename, onDelete }: { g: ContactGroup; count: number; onRename: (n: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(g.name), [arm, setArm] = useState(false);
  useEffect(() => setName(g.name), [g.name]);
  return (
    <div className="grprow">
      <i className="gdot big" style={{ background: g.color }} />
      <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== g.name) onRename(name); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="small">{count} {count === 1 ? "Person" : "Personen"}</span>
      <button className={"mini" + (arm ? " hot" : "")} onClick={() => (arm ? onDelete() : setArm(true))}>{arm ? "Wirklich löschen?" : "Löschen"}</button>
    </div>
  );
}
