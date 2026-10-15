import { useCallback, useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import {
  createProject, createQualification, deleteNote, listNotes, listPersons, listProjects,
  listQualifications, saveNote, type Attachment, type Note, type Person, type Project,
  type Qualification, type Scope,
} from "../db/repo";
import { pickAndStoreImages } from "../files";
import { Avatar, Thumb } from "../Avatar";
import { dateParts, suggestProject, todayStr } from "../util";
import type { ScopeId } from "../items";
import { SpellCheck } from "../spell/SpellCheck";
import { ImportDialog } from "../import/ImportDialog";
import { animOn, mascotOn } from "../prefs";
import { NAMI } from "../tutorial/tour";

interface Draft {
  id?: number; date: string; scope: Scope; text: string;
  projectId: number | null; qualIds: number[]; personIds: number[]; attachments: Attachment[];
}

const SCOPE_LABEL: Record<Scope, string> = { schule: "Schule", arbeit: "Arbeit" };
const KIND_LABEL: Record<string, string> = {
  betrieb: "Betriebliche Qualifikationen", schule: "Schulische Qualifikationen",
  sonst: "Sonstiges", eigene: "Eigene",
};

export function NotesPage({ scope, escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [qualOpen, setQualOpen] = useState(false);
  const [qualSearch, setQualSearch] = useState("");
  const [newQual, setNewQual] = useState("");
  const [newProject, setNewProject] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pinned, setPinned] = useState<number | null>(null);   // neue Notiz: fällt mit Schwung in die Liste
  const [tearing, setTearing] = useState<number | null>(null); // gelöschte Notiz: Papier zerreißt
  const [nami, setNami] = useState<{ phase: "schreibt" | "pinnt"; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [n, p, q, pe] = await Promise.all([listNotes(), listProjects(), listQualifications(), listPersons()]);
      setNotes(n); setProjects(p); setQuals(q); setPersons(pe); setErr("");
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Esc: erst Bild-Ansicht, dann Editor schließen, danach erst die Seite
  useEffect(() => {
    escRef.current = () => {
      if (lightbox) { setLightbox(null); return true; }
      if (draft) { setDraft(null); setQualOpen(false); setConfirmDel(false); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, lightbox, draft]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };

  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (scope !== "alle" && n.scope !== scope) return false;
      if (!s) return true;
      const hay = [
        n.text,
        n.projectId ? projById.get(n.projectId)?.name ?? "" : "",
        ...n.qualIds.map((q) => qualById.get(q)?.name ?? ""),
        ...n.personIds.map((q) => personById.get(q)?.name ?? ""),
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [notes, scope, search, projById, qualById, personById]);

  const startNew = () => {
    setConfirmDel(false); setQualOpen(false); setNewProject(null);
    setDraft({
      date: todayStr(), scope: scope === "schule" ? "schule" : "arbeit", text: "",
      projectId: null, qualIds: [], personIds: [], attachments: [],
    });
  };
  const startEdit = (n: Note) => {
    setConfirmDel(false); setQualOpen(false); setNewProject(null);
    setDraft({ ...n, qualIds: [...n.qualIds], personIds: [...n.personIds], attachments: [...n.attachments] });
  };
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const suggestion = useMemo(
    () => (draft && !draft.projectId ? suggestProject(draft.text, draft.scope, projects) : null),
    [draft, projects]
  );
  const recent = useMemo(() => {
    if (!draft) return [];
    const ids: number[] = [];
    for (const n of notes) {
      if (n.scope === draft.scope && n.projectId && !ids.includes(n.projectId)) ids.push(n.projectId);
      if (ids.length >= 3) break;
    }
    return ids.map((i) => projById.get(i)).filter((p): p is Project => !!p);
  }, [notes, draft, projById]);

  const onSave = async () => {
    if (!draft) return;
    if (!draft.text.trim()) { setErr("Bitte einen Text eintragen."); return; }
    if (!draft.date) { setErr("Bitte ein Datum wählen."); return; }
    try {
      const isNew = !draft.id;
      const text = draft.text;
      const id = await saveNote(draft);
      setDraft(null); setQualOpen(false); setErr("");
      if (isNew && animOn() && mascotOn()) {
        // Nami schreibt die Notiz, hängt sie auf – dann fällt sie in die Liste
        setNami({ phase: "schreibt", text });
        await new Promise((r) => setTimeout(r, 900));
        setNami({ phase: "pinnt", text });
        await new Promise((r) => setTimeout(r, 650));
        setNami(null);
      }
      await reload();
      if (isNew) { setPinned(id); setTimeout(() => setPinned(null), 900); }
      flash(isNew ? "Notiz aufgehängt" : "Notiz gespeichert");
    } catch (e) { setNami(null); setErr("Speichern fehlgeschlagen: " + String(e)); }
  };
  const onDelete = async () => {
    if (!draft?.id) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    const id = draft.id;
    try {
      setDraft(null); setConfirmDel(false);
      if (animOn()) { setTearing(id); await new Promise((r) => setTimeout(r, 750)); }
      await deleteNote(id); setTearing(null); await reload(); flash("Notiz gelöscht");
    } catch (e) { setTearing(null); setErr(String(e)); }
  };
  const addImages = async () => {
    try {
      const files = await pickAndStoreImages("attachments", true);
      if (files.length) patch({ attachments: [...(draft?.attachments ?? []), ...files.map((f) => ({ original_name: f.name, stored_path: f.path }))] });
    } catch (e) { setErr("Bild konnte nicht hinzugefügt werden: " + String(e)); }
  };
  const makeProject = async () => {
    if (!draft || !newProject?.trim()) return;
    try {
      const id = await createProject(newProject, draft.scope);
      await reload();
      patch({ projectId: id }); setNewProject(null);
    } catch (e) { setErr(String(e)); }
  };
  const makeQual = async () => {
    if (!newQual.trim() || !draft) return;
    try {
      const id = await createQualification(newQual);
      await reload();
      patch({ qualIds: draft.qualIds.includes(id) ? draft.qualIds : [...draft.qualIds, id] });
      setNewQual("");
    } catch (e) { setErr(String(e)); }
  };
  const toggleQual = (id: number) =>
    draft && patch({ qualIds: draft.qualIds.includes(id) ? draft.qualIds.filter((x) => x !== id) : [...draft.qualIds, id] });

  const qualGroups = useMemo(() => {
    const s = qualSearch.trim().toLowerCase();
    const list = quals.filter((q) => !s || q.name.toLowerCase().includes(s));
    return (["betrieb", "schule", "eigene", "sonst"] as const)
      .map((k) => ({ kind: k, items: list.filter((q) => q.kind === k) }))
      .filter((g) => g.items.length);
  }, [quals, qualSearch]);

  const freePersons = draft ? persons.filter((p) => !draft.personIds.includes(p.id)) : [];

  return (
    <div className="work">
      <section className="wcol wlist">
        <div className="wtools">
          <input className="field grow" placeholder="Notizen durchsuchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="mini" onClick={() => setImportOpen(true)} title="Alte Berichtshefte (Word/PDF) als Notizen übernehmen">Importieren</button>
          <button className="btn" onClick={startNew}><span>+ Neue Notiz</span></button>
        </div>
        {msg && <div className="flash">{msg}</div>}
        {!draft && err && <div className="errbox">{err}</div>}
        <div className="scroll">
          {visible.length === 0 && (
            <div className="empty paperbox">
              <b>{notes.length === 0 ? "Noch keine Notizen." : "Nichts gefunden."}</b>
              <p>{notes.length === 0
                ? "Halte hier fest, was du erledigt hast: mit Datum, Bereich, Qualifikation und Bildern. Daraus entsteht später dein Berichtsheft."
                : "Ändere die Suche oder den Bereich oben rechts."}</p>
            </div>
          )}
          {visible.map((n) => {
            const d = dateParts(n.date);
            const proj = n.projectId ? projById.get(n.projectId) : null;
            const card = (<>
                <div className="ndate">
                  <b>{d.day}</b><span>{d.month}</span><small>{d.weekday} · KW {d.kw}</small>
                </div>
                <div className="nbody">
                  <p className="ntext">{n.text}</p>
                  <div className="ntags">
                    <span className={"tag " + n.scope}>{SCOPE_LABEL[n.scope]}</span>
                    {proj && <span className="chip proj">{proj.name}</span>}
                    {n.qualIds.slice(0, 2).map((q) => (
                      <span key={q} className="chip">{qualById.get(q)?.name}</span>
                    ))}
                    {n.qualIds.length > 2 && <span className="chip more">+{n.qualIds.length - 2}</span>}
                    {n.attachments.length > 0 && <span className="chip img">Bilder {n.attachments.length}</span>}
                    <span className="faces">
                      {n.personIds.slice(0, 4).map((pid) => {
                        const p = personById.get(pid);
                        return p ? <Avatar key={pid} name={p.name} path={p.portrait_path} size={28} /> : null;
                      })}
                    </span>
                  </div>
                </div>
            </>);
            return (
              <article key={n.id} className={"note" + (draft?.id === n.id ? " sel" : "") + (pinned === n.id ? " pinned" : "") + (tearing === n.id ? " tearing" : "")} tabIndex={0}
                onClick={() => tearing !== n.id && startEdit(n)}
                onKeyDown={(e) => { if (e.key === "Enter") startEdit(n); }}>
                {tearing === n.id ? <>
                  <div className="tearghost">{card}</div>
                  <div className="tearhalf l">{card}</div>
                  <div className="tearhalf r">{card}</div>
                </> : card}
              </article>
            );
          })}
        </div>
      </section>

      <section className="wcol wedit">
        {!draft ? (
          <div className="paperbox hintcard">
            <h3>Notizen</h3>
            <p>Eine Notiz ist eine erledigte Aufgabe. Wähle links eine Notiz zum Bearbeiten oder lege eine neue an.</p>
            <p className="small">Esc geht zurück, Enter öffnet die markierte Notiz.</p>
          </div>
        ) : (
          <div className="paperbox editor">
            <h3>{draft.id ? "Notiz bearbeiten" : "Neue Notiz"}</h3>
            {err && <div className="errbox">{err}</div>}

            <div className="row2">
              <label className="lab">Datum
                <input className="field" type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} />
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

            <label className="lab">Was hast du gemacht?
              <textarea className="field" rows={5} value={draft.text} placeholder="z. B. Syslog-Server eingerichtet und getestet …" spellCheck={false}
                onChange={(e) => patch({ text: e.target.value })} />
            </label>
            <SpellCheck value={draft.text} onChange={(v) => patch({ text: v })} />

            <div className="lab">Projekt (optional)
              <div className="inl">
                <select className="field grow" value={draft.projectId ?? ""}
                  onChange={(e) => patch({ projectId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">– kein Projekt –</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({SCOPE_LABEL[p.scope]})</option>)}
                </select>
                <button type="button" className="mini" onClick={() => setNewProject(newProject === null ? "" : null)}>+ Neues Projekt</button>
              </div>
              {newProject !== null && (
                <div className="inl">
                  <input className="field grow" autoFocus placeholder={`Projektname (${SCOPE_LABEL[draft.scope]})`} value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); makeProject(); } }} />
                  <button type="button" className="mini hot" onClick={makeProject}>Anlegen</button>
                </div>
              )}
              {!draft.projectId && (suggestion || recent.length > 0) && (
                <div className="sugg">
                  {suggestion && (
                    <span>Vorschlag: <button type="button" className="chip proj clickable" onClick={() => patch({ projectId: suggestion.id })}>{suggestion.name}</button></span>
                  )}
                  {recent.filter((r) => r.id !== suggestion?.id).length > 0 && (
                    <span>Zuletzt: {recent.filter((r) => r.id !== suggestion?.id).map((r) => (
                      <button type="button" key={r.id} className="chip clickable" onClick={() => patch({ projectId: r.id })}>{r.name}</button>
                    ))}</span>
                  )}
                </div>
              )}
            </div>

            <div className="lab">Qualifikationen (IHK-Liste)
              <div className="chips">
                {draft.qualIds.map((id) => (
                  <span key={id} className="chip sel">{qualById.get(id)?.name}
                    <button type="button" aria-label="entfernen" onClick={() => toggleQual(id)}>×</button></span>
                ))}
                <button type="button" className="mini" onClick={() => setQualOpen(!qualOpen)}>
                  {qualOpen ? "Liste schließen" : draft.qualIds.length ? "Ändern" : "Auswählen"}
                </button>
              </div>
              {qualOpen && (
                <div className="qpanel">
                  <input className="field" placeholder="Qualifikation suchen …" value={qualSearch} onChange={(e) => setQualSearch(e.target.value)} />
                  <div className="qlist">
                    {qualGroups.map((g) => (
                      <div key={g.kind}>
                        <div className="qhead">{KIND_LABEL[g.kind]}</div>
                        {g.items.map((q) => (
                          <button type="button" key={q.id} className={"qrow" + (draft.qualIds.includes(q.id) ? " on" : "")}
                            onClick={() => toggleQual(q.id)}>
                            <i>{draft.qualIds.includes(q.id) ? "✓" : ""}</i>{q.name}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="inl">
                    <input className="field grow" placeholder="Eigene Qualifikation hinzufügen …" value={newQual}
                      onChange={(e) => setNewQual(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); makeQual(); } }} />
                    <button type="button" className="mini hot" onClick={makeQual}>Hinzufügen</button>
                  </div>
                </div>
              )}
            </div>

            <div className="lab">Mit wem?
              <div className="chips">
                {draft.personIds.map((id) => {
                  const p = personById.get(id);
                  return p ? (
                    <span key={id} className="chip person"><Avatar name={p.name} path={p.portrait_path} size={22} />{p.name}
                      <button type="button" aria-label="entfernen" onClick={() => patch({ personIds: draft.personIds.filter((x) => x !== id) })}>×</button></span>
                  ) : null;
                })}
                {freePersons.length > 0 ? (
                  <select className="field mini-select" value="" onChange={(e) => e.target.value && patch({ personIds: [...draft.personIds, Number(e.target.value)] })}>
                    <option value="">+ Person</option>
                    {freePersons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>)}
                  </select>
                ) : persons.length === 0 ? <span className="small">Noch keine Kontakte angelegt.</span> : null}
              </div>
            </div>

            <div className="lab">Bilder
              <div className="chips">
                {draft.attachments.map((a, i) => (
                  <Thumb key={a.stored_path} path={a.stored_path} onOpen={setLightbox}
                    onRemove={() => patch({ attachments: draft.attachments.filter((_, k) => k !== i) })} />
                ))}
                <button type="button" className="mini" onClick={addImages}>+ Bild hinzufügen</button>
              </div>
            </div>

            <div className="actions">
              <button className="btn" onClick={onSave}><span>Speichern</span></button>
              <button className="btn ghost" onClick={() => { setDraft(null); setQualOpen(false); setErr(""); }}><span>Abbrechen</span></button>
              {draft.id && (
                <button className={"btn danger" + (confirmDel ? " arm" : "")} onClick={onDelete}>
                  <span>{confirmDel ? "Wirklich löschen?" : "Löschen"}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {nami && (
        <div className="namiwrite" aria-hidden="true">
          <img src={NAMI[nami.phase]} alt="" className={"nw-" + nami.phase} />
          <div className={"nwpaper nw-" + nami.phase}><span>{nami.text.length > 90 ? nami.text.slice(0, 90) + " …" : nami.text}</span></div>
        </div>
      )}
      {importOpen && <ImportDialog onClose={async (n) => { setImportOpen(false); if (n) { await reload(); flash(`${n} Notizen importiert`); } }} />}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}
