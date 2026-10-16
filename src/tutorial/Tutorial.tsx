import { useEffect, useState } from "react";
import { BERUFE, EMPTY_PROFILE, FACHRICHTUNGEN, KAMMERN, isFachinformatiker, loadProfile, saveProfile, type Profile } from "./profile";
import { analyzeTemplate, saveCustomTemplate, useBundledTemplate, PLACEHOLDER_HELP, type TemplateInfo } from "../report/templates";
import { listQualifications, replaceQualifications } from "../db/repo";
import { baseName, fsapi } from "../fsapi";
import { ImportDialog } from "../import/ImportDialog";
import { usePrefs } from "../prefs";
import { GUIDES, NAMI, TOUR, type GuideId, type Pose } from "./tour";
import { CHARACTERS } from "../chars";
import { getSetting, setSetting } from "../db/db";

type Step = "start" | "profil" | "figur" | "vorlage" | "quali" | "import" | "tour" | "fertig";
const ORDER: Step[] = ["start", "profil", "figur", "vorlage", "quali", "import", "tour", "fertig"];

export function Tutorial({ onDone, onShowPage }: { onDone: () => void; onShowPage?: (page: string | null) => void }) {
  const { prefs } = usePrefs();
  const [step, setStep] = useState<Step>("start");
  const [tourI, setTourI] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [tpl, setTpl] = useState<{ name: string; info?: TemplateInfo; err?: string; pdf?: boolean; bytes?: ArrayBuffer } | null>(null);
  const [takeQuals, setTakeQuals] = useState(true);
  const [qualText, setQualText] = useState("");
  const [qualCount, setQualCount] = useState(0);
  const [msg, setMsg] = useState("");
  const [charId, setCharId] = useState("eigene");
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => { getSetting("pref_char").then((c) => c && setCharId(c)); }, []);
  useEffect(() => { loadProfile().then(setP); listQualifications().then((q) => setQualCount(q.length)); }, []);

  useEffect(() => {
    if (step !== "tour") { onShowPage?.(undefined as never); setSpot(null); return; }
    const t = TOUR[tourI];
    onShowPage?.(t.page ?? null);
    setSpot(null);
    const find = (tries = 0) => {
      if (!t.target) return;
      const el = document.querySelector(t.target) as HTMLElement | null;
      const st = document.getElementById("stage");
      if (!el || !st) { if (tries < 12) setTimeout(() => find(tries + 1), 200); return; }
      const r = el.getBoundingClientRect(), s2 = st.getBoundingClientRect();
      const k = s2.width / 1600;
      setSpot({ x: (r.left - s2.left) / k, y: (r.top - s2.top) / k, w: r.width / k, h: r.height / k });
    };
    const id = setTimeout(() => find(), 520);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tourI]);

  const go = (d: number) => { setMsg(""); setStep(ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(step) + d))]); };
  const next = async () => {
    if (step === "profil") {
      if (!p.vorname.trim() || !p.nachname.trim() || !p.beruf.trim()) { setMsg("Bitte mindestens Vorname, Nachname und Ausbildungsberuf eintragen."); return; }
      await saveProfile(p);
    }
    if (step === "figur") await setSetting("pref_char", charId);
    if (step === "vorlage" && tpl?.bytes && tpl.info && tpl.info.kind !== "unbekannt") {
      await saveCustomTemplate(tpl.bytes);
      if (takeQuals && tpl.info.quals.length) setQualCount(await replaceQualifications(tpl.info.quals));
    }
    if (step === "quali" && qualText.trim()) setQualCount(await replaceQualifications(qualText.split("\n")));
    if (step === "tour" && tourI < TOUR.length - 1) { setTourI(tourI + 1); return; }
    go(1);
  };
  const back = () => { if (step === "tour" && tourI > 0) { setTourI(tourI - 1); return; } go(-1); };

  const pickTemplate = async () => {
    const fs = await fsapi();
    const path = await fs.pickFile();
    if (!path) return;
    const name = baseName(path);
    try {
      const u = await fs.read(path, 30 * 1024 * 1024);
      const bytes = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
      if (/\.pdf$/i.test(name)) { setTpl({ name, pdf: true }); return; }
      if (!/\.docx$/i.test(name)) { setTpl({ name, err: "Bitte eine Word-Datei (.docx) oder PDF wählen." }); return; }
      setTpl({ name, info: await analyzeTemplate(bytes), bytes });
    } catch (e) { setTpl({ name, err: String(e).replace(/^Error:\s*/, "") }); }
  };

  const guideId: GuideId = step === "tour" ? (TOUR[tourI].guide ?? "nami") : "nami";
  const guide = GUIDES[guideId];
  const pose: Pose = step === "start" ? "gruss" : step === "profil" ? "erklaert" : step === "figur" ? "jubelt" : step === "vorlage" ? "denkt" : step === "quali" ? "schreibt" : step === "import" ? "pinnt" : step === "tour" ? TOUR[tourI].pose : "jubelt";
  const field = (k: keyof Profile, label: string, ph = "", list?: string) => (
    <label className="lab">{label}<input className="field" value={p[k]} placeholder={ph} list={list} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
  );
  const idx = ORDER.indexOf(step);

  return (
    <div className={"tut" + (step === "tour" ? " showpage" : "")} role="dialog" aria-label="Tutorial">
      {spot && step === "tour" && (
        <>
          <div className="tutspot" style={{ left: spot.x - 10, top: spot.y - 10, width: spot.w + 20, height: spot.h + 20, ["--gc" as string]: guide.accent }} />
          <div className="tutarrow" style={{ left: spot.x + spot.w / 2, top: spot.y + spot.h + 14, ["--gc" as string]: guide.accent }} />
        </>
      )}
      {prefs.mascot && <img key={guideId + pose + step + tourI} className={"tutnami g-" + guideId} src={guide.poses[pose] ?? NAMI[pose]} alt="" draggable={false} />}
      <div className="tutcard paperbox">
        <div className="tuthead">
          <span className="tutname" style={{ background: guide.accent }}>{guide.name}</span>
          <div className="tutdots">{ORDER.map((s, i) => <i key={s} className={i < idx ? "done" : i === idx ? "on" : ""} />)}</div>
          <button className="mini" onClick={onDone}>Tutorial überspringen</button>
        </div>
        <div className="tutbody" key={step + tourI}>
          {step === "start" && <>
            <h2>Hallo, ich bin Nami!</h2>
            <p>Ich zeige dir in ein paar Minuten, wie diese App funktioniert. Sie ist dein Begleiter für die Ausbildung: Du hältst fest, was du gemacht hast, und daraus entstehen dein Berichtsheft, deine Projekte und eine Übersicht deiner Fähigkeiten.</p>
            <p>Alles bleibt auf diesem Rechner. Los geht's mit ein paar Angaben zu dir.</p>
          </>}
          {step === "profil" && <>
            <h2>Wer bist du?</h2>
            <div className="row2">{field("vorname", "Vorname")}{field("nachname", "Nachname")}</div>
            <div className="row2">{field("beruf", "Ausbildungsberuf", "z. B. Fachinformatiker/in", "tut-berufe")}{field("fachrichtung", "Fachrichtung (falls es eine gibt)", "z. B. Systemintegration", "tut-fach")}</div>
            <label className="lab">Was machst du in deinem Beruf? (ein, zwei Sätze)
              <textarea className="field" rows={2} value={p.taetigkeit} onChange={(e) => setP({ ...p, taetigkeit: e.target.value })} placeholder="z. B. Ich betreue Server und Netzwerke und helfe Kolleginnen bei IT-Problemen." />
            </label>
            <div className="row2">
              <label className="lab">Zuständige Kammer
                <select className="field" value={p.kammer} onChange={(e) => setP({ ...p, kammer: e.target.value })}>{KAMMERN.map((k) => <option key={k}>{k}</option>)}</select>
              </label>
              {field("kammerOrt", "Ort der Kammer", "z. B. Düsseldorf")}
            </div>
            <div className="row2">{field("betrieb", "Ausbildungsbetrieb")}{field("ausbilder", "Ausbilder/in (Nachname, Vorname)")}</div>
            <label className="lab">Ausbildungsbeginn<input className="field" type="month" value={p.beginn} onChange={(e) => setP({ ...p, beginn: e.target.value })} /></label>
            <datalist id="tut-berufe">{BERUFE.map((b) => <option key={b} value={b} />)}</datalist>
            <datalist id="tut-fach">{FACHRICHTUNGEN.map((b) => <option key={b} value={b} />)}</datalist>
          </>}
          {step === "figur" && <>
            <h2>Wähle deine Figur</h2>
            <p>Deine Figur steht im Hauptmenü und wechselt je nach Bereich die Pose. Du kannst sie später unter System ändern.</p>
            <div className="charpick">
              {CHARACTERS.map((c) => (
                <button key={c.id} className={"charcard" + (charId === c.id ? " on" : "")} onClick={() => { setCharId(c.id); setSetting("pref_char", c.id); }}>
                  <img src={c.poses.notizen} alt="" draggable={false} /><b>{c.name}</b>
                </button>
              ))}
            </div>
            {CHARACTERS.length === 1 && <p className="tutnote">Weitere Figuren erscheinen hier, sobald sie im Ordner liegen.</p>}
          </>}
          {step === "vorlage" && <>
            <h2>Dein Berichtsheft</h2>
            <p>Hast du eine Vorlage oder ein altes Berichtsheft als Word-Datei? Lade eine Kopie hoch, dann erzeuge ich deine Wochenberichte künftig im selben Format. Ohne Vorlage nutze ich ein sauberes IHK-Layout mit Tageskarten.</p>
            <div className="inl">
              <button className="btn" onClick={pickTemplate}><span>Vorlage hochladen</span></button>
              <button className="mini" onClick={async () => { await useBundledTemplate(); setTpl(null); next(); }}>Standard-Layout nutzen</button>
            </div>
            {tpl?.err && <div className="errbox">{tpl.err}</div>}
            {tpl?.pdf && <p className="tutnote">„{tpl.name}“ ist eine PDF. Eine PDF kann ich nicht als Vorlage befüllen, aber im übernächsten Schritt kann ich die <b>Einträge daraus importieren</b>. Für das Format nehme ich das Standard-Layout.</p>}
            {tpl?.info?.kind === "karten" && <p className="tutnote ok">Erkannt: <b>Tageskarten-Vorlage</b> mit Dropdowns. Ich exportiere künftig genau in diesem Format.
              {tpl.info.quals.length > 0 && <label className="tutcheck"><input type="checkbox" checked={takeQuals} onChange={(e) => setTakeQuals(e.target.checked)} /> {tpl.info.quals.length} Qualifikationen aus der Vorlage übernehmen</label>}</p>}
            {tpl?.info?.kind === "platzhalter" && <p className="tutnote ok">Erkannt: Vorlage mit <b>Platzhaltern</b> ({tpl.info.placeholders.map((x) => `{{${x}}}`).join(", ")}). Die fülle ich beim Export aus.</p>}
            {tpl?.info?.kind === "unbekannt" && <p className="tutnote">Diese Vorlage kann ich noch nicht automatisch befüllen. Schreib in deine Word-Datei einfach Platzhalter an die passenden Stellen, zum Beispiel <code>{"{{KW}}"}</code>, <code>{"{{NAME}}"}</code>, <code>{"{{MONTAG}}"}</code>, und lade sie nochmal hoch. Möglich sind: {PLACEHOLDER_HELP.map((x) => `{{${x}}}`).join(" ")}</p>}
          </>}
          {step === "quali" && <>
            <h2>Deine Qualifikationen</h2>
            <p>Jede Notiz bekommt eine oder mehrere Qualifikationen aus deinem Ausbildungsrahmenplan. So sieht dein Ausbilder, was du schon gelernt hast.</p>
            <p className="tutnote">Aktuell sind <b>{qualCount}</b> Qualifikationen hinterlegt{isFachinformatiker(p) ? " (IHK-Liste für Fachinformatiker/innen)" : ""}.</p>
            <label className="lab">{isFachinformatiker(p) ? "Andere Liste? Hier einfügen (eine pro Zeile), sonst leer lassen" : "Für deinen Beruf: Liste einfügen (eine Qualifikation pro Zeile, z. B. aus deinem Berichtsheft oder dem Ausbildungsrahmenplan)"}
              <textarea className="field" rows={6} value={qualText} onChange={(e) => setQualText(e.target.value)} />
            </label>
          </>}
          {step === "import" && <>
            <h2>Alte Berichtshefte mitnehmen</h2>
            <p>Hast du schon Berichtshefte geschrieben? Dann hol sie rein, als Word oder PDF. Daraus werden Notizen, und deine Fähigkeiten-Übersicht ist sofort aktuell.</p>
            <ImportDialog inline onClose={() => {}} />
          </>}
          {step === "tour" && <>
            <h2>{TOUR[tourI].title} <small>{tourI + 1} / {TOUR.length}</small></h2>
            <p>{TOUR[tourI].text}</p>
            <ul className="tuttips">{TOUR[tourI].tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </>}
          {step === "fertig" && <>
            <h2>Geschafft, {p.vorname || "los geht's"}!</h2>
            <p>Du bist startklar. Schreib heute deine erste Notiz, der Rest ergibt sich. Wenn du etwas vergisst: <b>System → Tutorial wiederholen</b>.</p>
            <p>Ich bleibe übrigens in der Nähe und helfe beim Aufhängen deiner Notizen.</p>
          </>}
          {msg && <div className="errbox">{msg}</div>}
        </div>
        <div className="tutfoot">
          {idx > 0 && step !== "fertig" && <button className="btn ghost" onClick={back}><span>Zurück</span></button>}
          {step === "fertig"
            ? <button className="btn" onClick={onDone}><span>Los geht's</span></button>
            : <button className="btn" onClick={next}><span>{step === "start" ? "Starten" : (step === "import" || step === "vorlage") && !tpl?.info ? "Weiter / überspringen" : "Weiter"}</span></button>}
        </div>
      </div>
    </div>
  );
}
