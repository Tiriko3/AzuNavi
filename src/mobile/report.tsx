// Berichtsheft auf dem Handy: Woche wählen, Tage prüfen und anpassen, als Word exportieren (Vorlage wie am PC).
import { useEffect, useState } from "react";
import { getSetting } from "../db/db";
import { listNotes, listQualifications } from "../db/repo";
import { draftFromNotes, getMeta, getWeek, markExported, saveWeek } from "../db/reportRepo";
import { fsapi } from "../fsapi";
import { qualsEnabled } from "../report/quals";
import { buildFreeDocx } from "../report/freeTemplate";
import { buildPlaceholderDocx, loadActiveTemplate } from "../report/templates";
import { PLACES, isoWeek, mondayOf, shortDate, weekDates, weekdayName, type WeekDraft } from "../report/types";
import { buildWeekDocx, readTemplateMeta } from "../report/weekDocx";
import { Icon } from "./ui";
import { MASCOTS, pose, type Who } from "./fx";

export function ReportScreen({ toast, goProfile, celebrate }: { toast: (t: string, who?: Who, pose?: string) => void; goProfile: () => void; celebrate: () => void }) {
  const cur = isoWeek(new Date());
  const [yw, setYw] = useState(cur);
  const [draft, setDraft] = useState<WeekDraft | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const load = async (fresh = false) => {
    setErr("");
    const stored = fresh ? null : await getWeek(yw.year, yw.week);
    if (stored) { setDraft(stored.draft); setEdited(true); return; }
    const [n, q] = await Promise.all([listNotes(), listQualifications()]);
    setDraft(draftFromNotes(yw.year, yw.week, n, q)); setEdited(false);
  };
  useEffect(() => { load(); }, [yw.year, yw.week]);
  const shift = (d: number) => { const m = mondayOf(yw.year, yw.week); m.setDate(m.getDate() + 7 * d); setYw(isoWeek(m)); };
  const change = async (next: WeekDraft) => { setDraft(next); setEdited(true); await saveWeek(next); };
  const dates = weekDates(yw.year, yw.week);

  const exportWord = async () => {
    if (!draft) return;
    setErr(""); setBusy("Ich packe die Woche zusammen …");
    try {
      const tpl = await loadActiveTemplate();
      const meta = await getMeta(await readTemplateMeta(tpl.bytes).catch(() => ({})));
      if (!meta.name.trim()) { setBusy(""); setErr("Trag zuerst deinen Namen ein (Mehr → Profil). Er steht oben im Berichtsheft."); return; }
      const kammer = (await getSetting("bh_kammer")) ?? "";
      const quals = await listQualifications();
      const useQ = quals.length > 0 && await qualsEnabled();
      const bytes = tpl.info.kind === "platzhalter" ? await buildPlaceholderDocx(tpl.bytes, draft, { ...meta, kammer })
        : tpl.info.kind === "frei" ? await buildFreeDocx(tpl.bytes, draft, { ...meta, kammer }, { quals: useQ, kammer })
        : await buildWeekDocx(tpl.bytes, draft, meta, quals.map((q) => q.name), useQ);
      const path = await (await fsapi()).saveFile(`Berichtsheft_KW${String(yw.week).padStart(2, "0")}_${yw.year}.docx`, bytes, "Word-Dokument", "docx");
      setBusy("");
      if (!path) return;
      await saveWeek(draft); await markExported(yw.year, yw.week, path); setEdited(true);
      celebrate(); toast(`Fertig! KW ${yw.week} liegt als Word-Datei bereit.`, "cara", "zeigt");
    } catch (e) { setBusy(""); setErr("Export fehlgeschlagen: " + String(e)); }
  };

  const days = draft ? draft.days.filter((d, i) => i < 5 || d.entries.length > 0) : [];
  return (
    <>
      <div className="m-sub">
        <button onClick={() => shift(-1)} aria-label="Vorige Woche"><Icon n="left" size={20} /></button>
        <div className="m-grow" style={{ textAlign: "center" }}><b style={{ font: "italic 900 20px var(--display)" }}>KW {yw.week}</b><div className="m-note" style={{ margin: 0 }}>{shortDate(dates[0])} – {shortDate(dates[6])}</div></div>
        <button onClick={() => shift(1)} aria-label="Nächste Woche"><Icon n="right" size={20} /></button>
      </div>
      {(yw.week !== cur.week || yw.year !== cur.year) && <button className="m-btn sec" style={{ height: 40, marginBottom: 8 }} onClick={() => setYw(cur)}>Zur aktuellen Woche</button>}
      {err && <div className="m-err">{err} {/Profil/.test(err) && <button className="m-btn sec" style={{ height: 40, marginTop: 8 }} onClick={goProfile}>Profil öffnen</button>}</div>}
      {(() => {
        const empty = !!draft && draft.days.every((d) => d.entries.length === 0);
        const [ps, txt] = busy ? ["sammelt", busy] : empty ? ["schlaeft", "Diese Woche ist noch leer … Schreib Notizen, dann sammle ich sie für dich ein."] : ["zeigt", edited ? "Deine Änderungen sind gespeichert. Wenn alles passt: ab nach Word!" : "Ich habe deine Notizen eingesammelt. Prüf die Tage, dann exportieren."];
        return <div className="m-guide" style={{ ["--gc" as string]: MASCOTS.cara.color }}><img className="m-mascot" src={pose("cara", ps)} alt="" /><div><b>Caramella</b>{txt}</div></div>;
      })()}
      {days.map((day) => {
        const i = draft!.days.indexOf(day);
        const setDay = (p: Partial<typeof day>) => change({ ...draft!, days: draft!.days.map((d, j) => (j === i ? { ...d, ...p } : d)) });
        return (
          <article key={day.date} className="m-card" style={{ ["--i" as string]: i }}>
            <div className="m-row"><div className="m-grow"><b>{weekdayName(day.date)}</b><div className="m-note" style={{ margin: 0 }}>{shortDate(day.date)}</div></div>
              <select value={day.place} onChange={(e) => setDay({ place: e.target.value })} style={{ border: "2px solid var(--m-line)", borderRadius: 10, padding: "6px 8px", background: "#fff", fontSize: 14 }}>
                {PLACES.map((p) => <option key={p}>{p}</option>)}</select></div>
            {day.entries.length === 0 ? <p className="m-note">Keine Einträge. Schreib Notizen für diesen Tag oder ergänze hier.</p> : day.entries.map((e, k) => (
              <textarea key={k} value={e.text} onChange={(ev) => setDay({ entries: day.entries.map((x, j) => (j === k ? { ...x, text: ev.target.value } : x)) })}
                style={{ width: "100%", marginTop: 8, border: "2px solid var(--m-line)", borderRadius: 12, padding: 10, minHeight: 64, font: "inherit", fontSize: 15 }} />
            ))}
            <button className="m-btn sec" style={{ height: 38, marginTop: 8, fontSize: 14 }} onClick={() => setDay({ entries: [...day.entries, { text: "", quals: [] }] })}><Icon n="plus" size={18} />Eintrag</button>
          </article>
        );
      })}
      <div className="m-btnrow" style={{ marginTop: 8 }}>
        <button className="m-btn sec" onClick={() => load(true)}>{edited ? "Neu aus Notizen" : "Aus Notizen"}</button>
        <button className="m-btn" disabled={!!busy} onClick={exportWord}><Icon n="export" />Word</button>
      </div>
      <p className="m-note">Der Export nutzt deine Vorlage (Mehr → Berichtsheft-Vorlage). Änderungen hier werden automatisch gespeichert.</p>
    </>
  );
}
