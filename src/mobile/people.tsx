// Kontakte auf dem Handy: Liste mit Suche, Ansicht mit Anrufen/Mail, Bearbeiten. Netzplan-Verbindungen bleiben unberührt.
import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { createGroup, deletePerson, listGroupMembers, listGroups, listPersons, savePerson, setPersonGroups, type ContactGroup, type Person, type PersonInput, type Scope } from "../db/repo";
import { fileUrl, pickAndStoreImages } from "../files";
import { Empty, Field, Icon, Seg, Sheet } from "./ui";
import type { Who } from "./fx";
import namiImg from "../assets/figuren/nami_gruss.webp";

type ScopeF = "alle" | Scope;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
function Avatar({ p }: { p: { name: string; portrait_path: string | null; scope: string } }) {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { if (p.portrait_path) fileUrl(p.portrait_path).then(setU); else setU(null); }, [p.portrait_path]);
  return <div className="m-avatar" style={{ background: p.scope === "schule" ? "var(--m-schule)" : "var(--m-arbeit)" }}>{u ? <img src={u} alt="" /> : initials(p.name) || "?"}</div>;
}

export function PeopleScreen({ scope, fabRef, toast }: { scope: ScopeF; fabRef: MutableRefObject<(() => void) | null>; toast: (t: string, who?: Who, pose?: string) => void }) {
  const [list, setList] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<Person | null>(null);
  const [edit, setEdit] = useState<PersonInput | null>(null);
  const [arm, setArm] = useState(false), [err, setErr] = useState("");
  const [fresh, setFresh] = useState<number | null>(null), [leaving, setLeaving] = useState<number | null>(null);
  const [groups, setGroups] = useState<ContactGroup[]>([]), [members, setMembers] = useState<Map<number, number[]>>(new Map());
  const [gf, setGf] = useState<number | null>(null), [editGroups, setEditGroups] = useState<number[]>([]), [newG, setNewG] = useState("");
  const load = async () => { const [l, g, m] = await Promise.all([listPersons(), listGroups(), listGroupMembers()]); setList(l); setGroups(g); setMembers(m); };
  useEffect(() => { load(); }, []);
  const blank = (): PersonInput => ({ name: "", role: "", scope: scope === "alle" ? "arbeit" : scope, parent_id: null, phone: "", email: "", info: "", portrait_path: null });
  fabRef.current = () => { setErr(""); setEditGroups(gf ? [gf] : []); setEdit(blank()); };
  const shown = useMemo(() => (list ?? []).filter((p) => (scope === "alle" || p.scope === scope) && (gf === null || (members.get(p.id) ?? []).includes(gf)) && (!q || (p.name + " " + (p.role ?? "")).toLowerCase().includes(q.toLowerCase()))), [list, q, scope, gf, members]);
  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setErr("Ein Name fehlt."); return; }
    const isNew = !edit.id; const id = await savePerson(edit); await setPersonGroups(id, editGroups); setEdit(null); setView(null); await load();
    setFresh(id); setTimeout(() => setFresh(null), 1600); toast(isNew ? `${edit.name.split(" ")[0]} ist jetzt in deinem Team!` : "Kontakt aktualisiert.", "nami", isNew ? "jubelt" : "schreibt");
  };
  const remove = async () => { if (!view) return; if (!arm) { setArm(true); return; } const id = view.id; await deletePerson(id); setView(null); setArm(false); setLeaving(id); toast("Kontakt entfernt.", "nami", "denkt"); setTimeout(async () => { await load(); setLeaving(null); }, 480); };
  const toInput = (p: Person): PersonInput => ({ id: p.id, name: p.name, role: p.role ?? "", scope: p.scope, parent_id: p.parent_id, phone: p.phone ?? "", email: p.email ?? "", info: p.info ?? "", portrait_path: p.portrait_path });

  return (
    <>
      <div className="m-search"><Icon n="search" size={20} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name oder Rolle" aria-label="Kontakte durchsuchen" /></div>
      {groups.length > 0 && <div className="m-filter"><button className={gf === null ? "on" : ""} onClick={() => setGf(null)}>Alle</button>
        {groups.map((g) => <button key={g.id} className={gf === g.id ? "on" : ""} onClick={() => setGf(g.id)}><i className="m-gdot" style={{ background: g.color }} />{g.name}</button>)}</div>}
      {list && shown.length === 0 && <Empty img={namiImg} title={q ? "Nichts gefunden" : "Noch keine Kontakte"} text="Ausbilder, Lehrer, Kollegen: wer hilft dir in der Ausbildung?">{!q && <button className="m-btn" onClick={() => setEdit(blank())}><Icon n="plus" />Kontakt anlegen</button>}</Empty>}
      {shown.map((p) => (
        <article key={p.id} className={"m-card tap" + (p.id === fresh ? " fresh" : "") + (p.id === leaving ? " leave" : "")} style={{ ["--i" as string]: Math.min(shown.indexOf(p), 8) }} onClick={() => { setArm(false); setView(p); }}>
          <div className="m-row"><Avatar p={p} /><div className="m-grow"><b>{p.name}</b><div className="m-meta" style={{ marginTop: 0 }}>{p.role || (p.scope === "schule" ? "Schule" : "Arbeit")}
            {(members.get(p.id) ?? []).map((gid) => { const g = groups.find((x) => x.id === gid); return g ? <span key={gid} className="m-chip" style={{ height: 22 }}><i className="m-gdot" style={{ background: g.color }} />{g.name}</span> : null; })}</div></div><Icon n="right" size={20} /></div>
        </article>
      ))}

      <Sheet open={!!view && !edit} onClose={() => setView(null)} title="Kontakt"
        footer={view && <><button className="m-btn ghost" style={{ width: "auto" }} onClick={remove}><Icon n="trash" size={20} />{arm ? "Wirklich?" : ""}</button><button className="m-btn" onClick={() => { setErr(""); setEditGroups(members.get(view.id) ?? []); setEdit(toInput(view)); }}><Icon n="edit" />Bearbeiten</button></>}>
        {view && <>
          <div className="m-row" style={{ margin: "6px 0 14px" }}><Avatar p={view} /><div><b style={{ fontSize: 20 }}>{view.name}</b><div className="m-meta" style={{ marginTop: 0 }}>{view.role || "–"} · {view.scope === "schule" ? "Schule" : "Arbeit"}</div></div></div>
          <div className="m-btnrow" style={{ marginBottom: 12 }}>
            {view.phone && <a className="m-btn sec" href={`tel:${view.phone}`}><Icon n="phone" size={20} />Anrufen</a>}
            {view.email && <a className="m-btn sec" href={`mailto:${view.email}`}><Icon n="mail" size={20} />E-Mail</a>}
          </div>
          {view.phone && <p className="m-note">Telefon: {view.phone}</p>}{view.email && <p className="m-note">E-Mail: {view.email}</p>}
          {view.info && <div className="m-card" style={{ whiteSpace: "pre-wrap" }}>{view.info}</div>}
        </>}
      </Sheet>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Kontakt bearbeiten" : "Neuer Kontakt"} tall footer={<button className="m-btn" onClick={save}><Icon n="check" />Speichern</button>}>
        {edit && <>
          {err && <div className="m-err">{err}</div>}
          <div className="m-row" style={{ marginBottom: 12 }}><Avatar p={edit} /><button className="m-btn sec" style={{ width: "auto" }} onClick={async () => { const f = await pickAndStoreImages("portraits", false); if (f[0]) setEdit({ ...edit, portrait_path: f[0].path }); }}><Icon n="image" size={20} />Foto wählen</button></div>
          <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus={!edit.id} /></Field>
          <Field label="Rolle"><input value={edit.role} placeholder="z. B. Ausbilderin, Lehrer" onChange={(e) => setEdit({ ...edit, role: e.target.value })} /></Field>
          <Field label="Bereich"><Seg value={edit.scope} options={[["arbeit", "Arbeit"], ["schule", "Schule"]]} onChange={(v) => setEdit({ ...edit, scope: v })} /></Field>
          <Field label="Telefon"><input type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="E-Mail"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Notizen zur Person"><textarea value={edit.info} placeholder="Was für die Ausbildung wichtig ist, z. B. zuständig für Netzwerk. Keine Bewertungen, nichts Privates." onChange={(e) => setEdit({ ...edit, info: e.target.value })} style={{ minHeight: 90 }} /></Field>
          <Field label="Gruppen (mehrere möglich)"><div className="m-pick">
            {groups.map((g) => { const on = editGroups.includes(g.id); return <button key={g.id} className={on ? "on" : ""} onClick={() => setEditGroups(on ? editGroups.filter((x) => x !== g.id) : [...editGroups, g.id])}><i className="m-gdot" style={{ background: g.color }} />{g.name}{on && <Icon n="check" size={14} />}</button>; })}
          </div>
          <div className="m-search" style={{ marginTop: 8 }}><Icon n="plus" size={20} /><input value={newG} onChange={(e) => setNewG(e.target.value)} placeholder="Neue Gruppe" maxLength={60} enterKeyHint="done"
            onKeyDown={async (e) => { if (e.key === "Enter" && newG.trim()) { const id = await createGroup(newG); setGroups(await listGroups()); setEditGroups((x) => (x.includes(id) ? x : [...x, id])); setNewG(""); } }} /></div></Field>
          <p className="m-note">Wer wem übergeordnet ist, stellst du im Netzplan am PC ein.</p>
        </>}
      </Sheet>
    </>
  );
}
