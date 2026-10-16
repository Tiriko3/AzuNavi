import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import katzeSchreibt from "../assets/figuren/katze_schreibt.webp";
import katzeSammelt from "../assets/figuren/katze_sammelt.webp";
import katzeZeigt from "../assets/figuren/katze_zeigt.webp";
import katzeSchlaeft from "../assets/figuren/katze_schlaeft.webp";
import { listNotes, listQualifications, type Note, type Qualification } from "../db/repo";
import { deleteWeek, draftFromNotes, getMeta, getWeek, isAbsent, markExported, saveWeek, setMeta } from "../db/reportRepo";
import { fsapi } from "../fsapi";
import { buildWeekDocx, readTemplateMeta } from "../report/weekDocx";
import { buildSkillsDocx, type SkillRow } from "../report/skillsDocx";
import { buildPlaceholderDocx, loadActiveTemplate } from "../report/templates";
import { SpellCheck } from "../spell/SpellCheck";
import { getSetting } from "../db/db";
import { PLACES, isoWeek, monthName, mondayOf, shortDate, weekDates, weekdayName, type ReportMeta, type WeekDraft } from "../report/types";
import { todayStr } from "../util";
import type { ScopeId } from "../items";

type Tab = "woche" | "faehig" | "angaben";
type CatPose = "schreibt" | "sammelt" | "zeigt" | "schlaeft";
const CAT: Record<CatPose, string> = { schreibt: katzeSchreibt, sammelt: katzeSammelt, zeigt: katzeZeigt, schlaeft: katzeSchlaeft };
const KIND_LABEL: Record<string, string> = { betrieb: "Betriebliche Qualifikationen", schule: "Schulische Qualifikationen", eigene: "Eigene", sonst: "Sonstiges" };

const POKES = ["Mrrrau! Weiter geht's!", "Noch eine Notiz, und die Woche ist voll!", "Ich passe auf dein Berichtsheft auf.", "Schnurr … alles im Plan.", "Hast du heute schon was festgehalten?"];
// aktive Vorlage (deine hochgeladene oder die eingebaute) – bei jedem Export frisch, falls du sie geändert hast
async function loadTemplate(): Promise<ArrayBuffer> { return (await loadActiveTemplate()).bytes; }

export function ReportPage({ escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const now = isoWeek(new Date());
  const [year, setYear] = useState(now.year);
  const [week, setWeek] = useState(now.week);
  const [tab, setTab] = useState<Tab>("woche");
  const [notes, setNotes] = useState<Note[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [draft, setDraft] = useState<WeekDraft | null>(null);
  const [edited, setEdited] = useState(false);
  const [exported, setExported] = useState<{ at: string | null; path: string | null }>({ at: null, path: null });
  const [meta, setMetaState] = useState<ReportMeta>({ name: "", beruf: "", betrieb: "", ausbilder: "" });
  const [armReset, setArmReset] = useState(false);
  const [cat, setCat] = useState<{ pose: CatPose; text: string; path?: string } | null>(null);
  const [err, setErr] = useState("");
  const [poke, setPoke] = useState<string | null>(null); // Katze angeklickt: kurzer Spruch
  const saveTimer = useRef<number | undefined>(undefined);

  /* ---------- Laden ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [n, q] = await Promise.all([listNotes(), listQualifications()]);
        setNotes(n); setQuals(q);
        const defaults = await readTemplateMeta(await loadTemplate()).catch(() => ({}));
        setMetaState(await getMeta(defaults));
      } catch (e) { setErr(String(e)); }
    })();
  }, []);

  const weekNotes = useMemo(() => {
    const d = weekDates(year, week);
    return notes.filter((n) => n.date >= d[0] && n.date <= d[6]);
  }, [notes, year, week]);

  const loadWeek = useCallback(async () => {
    const stored = await getWeek(year, week);
    if (stored) { setDraft(stored.draft); setEdited(true); setExported({ at: stored.exported_at, path: stored.export_path }); }
    else { setDraft(draftFromNotes(year, week, notes, quals)); setEdited(false); setExported({ at: null, path: null }); }
    setArmReset(false); setCat(null);
  }, [year, week, notes, quals]);
  useEffect(() => { loadWeek(); }, [loadWeek]);

  useEffect(() => {
    escRef.current = () => {
      if (cat?.path) { setCat(null); return true; }
      if (tab !== "woche") { setTab("woche"); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, tab, cat]);

  /* ---------- Bearbeiten (wird automatisch gespeichert) ---------- */
  const update = (fn: (d: WeekDraft) => WeekDraft) => {
    setDraft((d) => {
      if (!d) return d;
      const nd = fn(structuredClone(d));
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { saveWeek(nd).catch((e) => setErr(String(e))); }, 350);
      return nd;
    });
    setEdited(true);
  };
  const setPlace = (di: number, place: string) => update((d) => {
    d.days[di].place = place;
    d.days[di].presence = isAbsent(place) ? "abwesend" : "anwesend";
    return d;
  });

  const goWeek = (delta: number) => {
    const mon = mondayOf(year, week);
    mon.setDate(mon.getDate() + delta * 7);
    const w = isoWeek(mon); setYear(w.year); setWeek(w.week);
  };
  const resetFromNotes = async () => {
    if (!armReset) { setArmReset(true); return; }
    await deleteWeek(year, week);
    setDraft(draftFromNotes(year, week, notes, quals)); setEdited(false); setArmReset(false); setExported({ at: null, path: null });
    setCat({ pose: "sammelt", text: `Neu eingesammelt: ${weekNotes.length} Notizen aus KW ${week}.` });
  };

  /* ---------- Export ---------- */
  const exportWeek = async () => {
    if (!draft) return;
    if (!meta.name.trim()) { setTab("angaben"); setCat({ pose: "schreibt", text: "Trag zuerst deinen Namen ein, er steht oben im Berichtsheft." }); return; }
    try {
      setErr("");
      // Die Katze packt sichtbar die Woche zusammen, bevor das Speichern-Fenster kommt
      setCat({ pose: "sammelt", text: `Ich packe KW ${week} zusammen …` });
      await new Promise((r) => setTimeout(r, 900));
      const tpl = await loadActiveTemplate();
      const kammer = (await getSetting("bh_kammer")) ?? "";
      const bytes = tpl.info.kind === "platzhalter"
        ? await buildPlaceholderDocx(tpl.bytes, draft, { ...meta, kammer })
        : await buildWeekDocx(tpl.bytes, draft, meta, quals.map((q) => q.name));
      const fs = await fsapi();
      const path = await fs.saveFile(`Berichtsheft_KW${String(week).padStart(2, "0")}_${year}.docx`, bytes, "Word-Dokument", "docx");
      if (!path) return;
      await saveWeek(draft); await markExported(year, week, path);
      setEdited(true); setExported({ at: new Date().toISOString(), path });
      setCat({ pose: "zeigt", text: `Fertig! KW ${week} ist als Word-Datei gespeichert. Die Dropdowns kannst du in Word weiter ändern.`, path });
    } catch (e) { setErr("Export fehlgeschlagen: " + String(e)); }
  };

  /* ---------- Fähigkeiten-Übersicht ---------- */
  const skills: SkillRow[] = useMemo(() => quals.map((q) => {
    const hits = notes.filter((n) => n.qualIds.includes(q.id)).sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      name: q.name, kind: q.kind, count: hits.length, last: hits[0]?.date ?? null,
      examples: hits.slice(0, 3).map((n) => (n.text.length > 70 ? n.text.slice(0, 70) + " …" : n.text).replace(/\s*\n+\s*/g, "; ")),
    };
  }), [quals, notes]);
  const maxCount = Math.max(1, ...skills.map((s) => s.count));
  const used = skills.filter((s) => s.count > 0).length, total = skills.filter((s) => s.kind !== "sonst").length;
  const exportSkills = async () => {
    if (!meta.name.trim()) { setTab("angaben"); setCat({ pose: "schreibt", text: "Trag zuerst deinen Namen ein, er steht oben auf der Übersicht." }); return; }
    try {
      const bytes = await buildSkillsDocx(await loadTemplate(), skills, meta, todayStr());
      const path = await (await fsapi()).saveFile(`Faehigkeiten_Uebersicht_${todayStr()}.docx`, bytes, "Word-Dokument", "docx");
      if (path) setCat({ pose: "zeigt", text: `Die Fähigkeiten-Übersicht ist gespeichert. ${used} von ${total} Qualifikationen sind belegt.`, path });
    } catch (e) { setErr("Export fehlgeschlagen: " + String(e)); }
  };

  /* ---------- Katze: was sie gerade sagt ---------- */
  const catNow: { pose: CatPose; text: string; path?: string } = cat ?? (
    tab === "faehig" ? { pose: "zeigt", text: `${used} von ${total} Qualifikationen sind belegt. Rot heißt: dazu gibt es noch keine Notiz.` }
    : tab === "angaben" ? { pose: "schreibt", text: "Diese Angaben stehen oben im Berichtsheft. Beruf und Betrieb habe ich aus deiner Vorlage übernommen." }
    : weekNotes.length === 0 && !edited ? { pose: "schlaeft", text: `In KW ${week} gibt es noch keine Notizen. Ich schlafe, bis du etwas festhältst.` }
    : !edited ? { pose: "sammelt", text: `Ich habe ${weekNotes.length} ${weekNotes.length === 1 ? "Notiz" : "Notizen"} aus KW ${week} eingesammelt. Prüf den Entwurf und exportiere ihn dann.` }
    : exported.at ? { pose: "zeigt", text: `KW ${week} wurde schon exportiert. Änderungen hier kannst du einfach nochmal exportieren.`, path: exported.path ?? undefined }
    : { pose: "schreibt", text: "Deine Änderungen sind gespeichert. Wenn alles passt: Als Word exportieren." }
  );
  const dates = weekDates(year, week);
  const qualNames = quals.map((q) => q.name);

  return (
    <div className="work report">
      <div className="rhead">
        <div className="rweek">
          <button className="mini" aria-label="Vorige Woche" onClick={() => goWeek(-1)}>◀</button>
          <div className="rkw"><b>KW {week}</b><span>{shortDate(dates[0])} – {shortDate(dates[6])}</span></div>
          <button className="mini" aria-label="Nächste Woche" onClick={() => goWeek(1)}>▶</button>
          {(year !== now.year || week !== now.week) && <button className="mini" onClick={() => { setYear(now.year); setWeek(now.week); }}>Diese Woche</button>}
          <span className={"rstate" + (exported.at ? " done" : edited ? " edit" : "")}>{exported.at ? "exportiert" : edited ? "angepasst" : "aus Notizen"}</span>
        </div>
        <span className="pvtabs">
          {([["woche", "Woche"], ["faehig", "Fähigkeiten"], ["angaben", "Angaben"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={"pvtab" + (tab === k ? " on" : "")} onClick={() => { setTab(k); setCat(null); }}><span>{l}</span></button>
          ))}
        </span>
        <div className="ractions">
          {tab === "woche" && <>
            <button className={"mini" + (armReset ? " hot" : "")} onClick={resetFromNotes}>{armReset ? "Änderungen verwerfen?" : "Neu aus Notizen"}</button>
            <button className="btn" onClick={exportWeek}><span>Als Word exportieren</span></button>
          </>}
          {tab === "faehig" && <button className="btn" onClick={exportSkills}><span>Übersicht als Word</span></button>}
        </div>
      </div>
      {err && <div className="errbox">{err}</div>}

      {tab === "woche" && draft && (
        <div className="rdays tabanim" key={"w" + year + week}>
          {draft.days.map((d, di) => (
            <section key={d.date} className={"rday paperbox" + (isAbsent(d.place) ? " absent" : "")}>
              <div className="rdhead">
                <div className="rdate"><b>{d.date.slice(8, 10)}</b><span>{monthName(d.date)}</span><small>{weekdayName(d.date)}</small></div>
                <div className="rsel">
                  <label>Anwesenheit
                    <select className="field" value={d.presence} onChange={(e) => update((x) => { x.days[di].presence = e.target.value as "anwesend" | "abwesend"; return x; })}>
                      <option value="anwesend">anwesend</option><option value="abwesend">abwesend</option>
                    </select>
                  </label>
                  <label>Ort
                    <select className="field" value={d.place} onChange={(e) => setPlace(di, e.target.value)}>
                      {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="rentries">
                {d.entries.length === 0 && <p className="small">{isAbsent(d.place) ? `Im Export steht „${d.place}“.` : "Keine Einträge. Im Export bleibt ein Platzhalter zum Ausfüllen in Word."}</p>}
                {d.entries.map((e, ei) => (
                  <div key={ei} className="rentry">
                    <textarea className="field" rows={2} value={e.text} spellCheck={false}
                      onChange={(ev) => update((x) => { x.days[di].entries[ei].text = ev.target.value; return x; })} />
                    <SpellCheck compact value={e.text} onChange={(v) => update((x) => { x.days[di].entries[ei].text = v; return x; })} />
                    <div className="chips">
                      {e.quals.map((q, qi) => (
                        <span key={qi} className="chip sel" title={q}>{q.length > 42 ? q.slice(0, 42) + "…" : q}
                          <button type="button" aria-label="entfernen" onClick={() => update((x) => { x.days[di].entries[ei].quals.splice(qi, 1); return x; })}>×</button></span>
                      ))}
                      <select className="field mini-select" value="" onChange={(ev) => ev.target.value && update((x) => { x.days[di].entries[ei].quals.push(ev.target.value); return x; })}>
                        <option value="">+ Qualifikation</option>
                        {qualNames.filter((q) => !e.quals.includes(q)).map((q) => <option key={q} value={q}>{q}</option>)}
                      </select>
                      <button className="tsm del" aria-label="Eintrag entfernen" title="Eintrag entfernen (die Notiz bleibt)" onClick={() => update((x) => { x.days[di].entries.splice(ei, 1); return x; })}>×</button>
                    </div>
                  </div>
                ))}
                <button className="mini" onClick={() => update((x) => { x.days[di].entries.push({ text: "", quals: [] }); return x; })}>+ Eintrag</button>
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "faehig" && (
        <div className="rskills paperbox tabanim">
          {(["betrieb", "schule", "eigene", "sonst"] as const).map((kind) => {
            const rows = skills.filter((s) => s.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind} className="rsgroup">
                <h4>{KIND_LABEL[kind]}</h4>
                {rows.map((s) => (
                  <div key={s.name} className={"rsrow" + (s.count === 0 ? " open" : "")}>
                    <span className="rsname" title={s.name}>{s.name}</span>
                    <span className="rsbar"><i style={{ width: `${(s.count / maxCount) * 100}%` }} /></span>
                    <span className="rscount">{s.count === 0 ? "noch offen" : `${s.count}×`}</span>
                    <span className="rslast">{s.last ? shortDate(s.last) : "–"}</span>
                    <span className="rsex" title={s.examples.join("\n")}>{s.examples[0] ?? ""}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === "angaben" && (
        <div className="rmeta paperbox tabanim">
          <h3>Angaben für die Kopfzeile</h3>
          {(["name", "beruf", "betrieb", "ausbilder"] as const).map((k) => (
            <label key={k} className="lab">{{ name: "Dein Name (Nachname, Vorname)", beruf: "Ausbildungsberuf", betrieb: "Betrieb", ausbilder: "Ausbilder/in (Nachname, Vorname)" }[k]}
              <input className="field" value={meta[k]} onChange={(e) => { const m = { ...meta, [k]: e.target.value }; setMetaState(m); setMeta(m).catch(() => {}); }} />
            </label>
          ))}
          <p className="small">Vorschau: <b>{meta.name || "Name"}</b> · {meta.beruf} · {meta.betrieb} · Ausbilder: {meta.ausbilder}</p>
          <p className="small">Die Vorlage ist deine IHK-Word-Datei (Tageskarten mit Dropdowns für Anwesenheit, Ort und Qualifikation). „Dauer gesamt“ und die Unterschriften bleiben wie in der Vorlage zum Ausfüllen.</p>
        </div>
      )}

      <div className="rcat" key={catNow.pose + catNow.text}>
        <div className={"rfx fx-" + catNow.pose} aria-hidden="true">
          {catNow.pose === "schlaeft" && [0, 1, 2].map((i) => <i key={i} style={{ animationDelay: i * 1.1 + "s" }}>z</i>)}
          {catNow.pose === "sammelt" && [0, 1, 2, 3].map((i) => <b key={i} style={{ animationDelay: i * 0.35 + "s", top: 20 + i * 28 + "px" }} />)}
          {catNow.pose === "zeigt" && [0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ animationDelay: i * 0.18 + "s", left: 30 + ((i * 47) % 200) + "px", top: 10 + ((i * 31) % 90) + "px" }}>✦</i>)}
          {catNow.pose === "schreibt" && [0, 1, 2].map((i) => <u key={i} style={{ animationDelay: i * 0.4 + "s", top: 120 + i * 12 + "px" }} />)}
        </div>
        <img src={CAT[catNow.pose]} alt="Caramella" draggable={false} className={"rcatimg p-" + catNow.pose + (poke ? " poked" : "")}
          onClick={() => { setPoke(POKES[Math.floor(Math.random() * POKES.length)]); setTimeout(() => setPoke(null), 2200); }} />
        {poke && <div className="rpoke">{poke}</div>}
        <div className="rbubble">
          <span className="rname">Caramella</span>
          <p>{catNow.text}</p>
          {catNow.path && (
            <div className="inl">
              <button className="mini" onClick={async () => { try { await (await fsapi()).open(catNow.path!); } catch (e) { setErr(String(e)); } }}>Datei öffnen</button>
              <button className="mini" onClick={async () => { try { await (await fsapi()).reveal(catNow.path!); } catch (e) { setErr(String(e)); } }}>Im Explorer zeigen</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
