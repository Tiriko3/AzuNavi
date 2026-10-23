import { useEffect, useRef, useState } from "react";
import { EMPTY_PROFILE, KAMMERN, loadProfile, saveProfile, type Profile } from "./profile";
import { ANDERE_ID, PROFILES, findProfile, profileById, qualSuggestion } from "../profiles/berufe";
import { TemplateChooser, applyTplChoice, type TplChoice } from "../report/TemplateChooser";
import { setQualsEnabled } from "../report/quals";
import { listQualifications, replaceQualifications } from "../db/repo";
import { ImportDialog } from "../import/ImportDialog";
import { usePrefs } from "../prefs";
import { GUIDES, NAMI, TOUR, type GuideId, type Pose } from "./tour";
import { CHARACTERS, DEFAULT_CHAR } from "../chars";
import { MASCOT_NAME } from "../mascot";
import { getSetting, setSetting } from "../db/db";

type Step = "start" | "profil" | "figur" | "vorlage" | "quali" | "import" | "tour" | "fertig";
const ORDER: Step[] = ["start", "profil", "figur", "vorlage", "quali", "import", "tour", "fertig"];

type Box = { x: number; y: number; w: number; h: number };

/** Klick-Filter als Pfad: alles gesperrt außer den Löchern. Per Raster gebaut, damit sich überlappende Löcher nicht gegenseitig aufheben. */
function blockPath(holes: Box[]): string {
  const cl = (v: number, m: number) => Math.max(0, Math.min(m, Math.round(v)));
  const xs = new Set([0, 1600]), ys = new Set([0, 900]);
  for (const h of holes) { xs.add(cl(h.x, 1600)); xs.add(cl(h.x + h.w, 1600)); ys.add(cl(h.y, 900)); ys.add(cl(h.y + h.h, 900)); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const inHole = (cx: number, cy: number) => holes.some((h) => cx > h.x && cx < h.x + h.w && cy > h.y && cy < h.y + h.h);
  let d = "";
  for (let j = 0; j < Y.length - 1; j++) {
    let start: number | null = null;
    for (let i = 0; i < X.length - 1; i++) {
      const blocked = !inHole((X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2);
      if (blocked && start === null) start = X[i];
      if (start !== null && (!blocked || i === X.length - 2)) {
        const end = blocked ? X[i + 1] : X[i];
        d += `M${start} ${Y[j]}H${end}V${Y[j + 1]}H${start}Z`;
        start = null;
      }
    }
  }
  return d;
}

export function Tutorial({ onDone, onShowPage }: { onDone: () => void; onShowPage?: (page: string | null) => void }) {
  const { prefs } = usePrefs();
  const [step, setStep] = useState<Step>("start");
  const [tourI, setTourI] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [tplChoice, setTplChoice] = useState<TplChoice>({ mode: "standard" });
  const [qualMode, setQualMode] = useState<"liste" | "vorlage" | "eigene" | "keine" | null>(null); // null = noch nichts gewählt = überspringen = ohne Qualifikationen
  const [otherBeruf, setOtherBeruf] = useState(false);
  const [qualText, setQualText] = useState("");
  const [qualCount, setQualCount] = useState(0);
  const [msg, setMsg] = useState("");
  const [charId, setCharId] = useState(DEFAULT_CHAR);
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [place, setPlace] = useState<"ru" | "lu" | "ro" | "lo">("ru"); // wo Karte und Figur stehen
  const [done, setDone] = useState(false);     // Aufgabe erledigt?
  const [preDone, setPreDone] = useState(false); // war schon vorher erledigt (dann kein Auto-Weiter)
  const stepStart = useRef(0);
  const [holes, setHoles] = useState<Box[]>([]);   // Fokusmodus: nur diese Flächen sind bedienbar
  const [nudge, setNudge] = useState(0);           // Klick auf gesperrte Fläche -> Markierung blinkt
  useEffect(() => { getSetting("pref_char").then((c) => c && setCharId(c)); }, []);
  useEffect(() => { loadProfile().then((pr) => { setP(pr); if (pr.beruf && !findProfile(pr.beruf, pr.fachrichtung)) setOtherBeruf(true); }); listQualifications().then((q) => setQualCount(q.length)); }, []);
  const prof = findProfile(p.beruf, p.fachrichtung);
  const suggestion = qualSuggestion(prof, p.fachrichtung);
  const tplQuals = tplChoice.mode === "datei" && tplChoice.kind === "karten" ? tplChoice.quals : [];

  useEffect(() => {
    if (step !== "tour") { onShowPage?.(undefined as never); setSpot(null); setDone(false); return; }
    const t = TOUR[tourI];
    onShowPage?.(t.page ?? null);
    setSpot(null);
    document.documentElement.removeAttribute("data-turned");
    // Die Seite wird gerade erst geöffnet: kurz warten und dann prüfen, ob schon alles erledigt ist
    stepStart.current = Date.now();
    setPreDone(false);
    setDone(!t.doneWhen && !t.doneOnClick);
    let stop = false;
    const find = (tries = 0) => {
      if (stop || !t.target) return;
      const el = t.target.split(",").map((q) => document.querySelector(q.trim()) as HTMLElement | null).find((x) => x && x.offsetParent !== null) ?? null;
      const st = document.getElementById("stage");
      if (!el || !st) { setSpot(null); if (tries < 14) setTimeout(() => find(tries + 1), 200); return; }
      const r = el.getBoundingClientRect(), s2 = st.getBoundingClientRect();
      const k = s2.width / 1600;
      const box = { x: (r.left - s2.left) / k, y: (r.top - s2.top) / k, w: r.width / k, h: r.height / k };
      setSpot(box);
      // Karte dorthin stellen, wo sie den markierten Bereich NICHT verdeckt
      const CW = 640, CH = 460, FW = 300;            // Karte und Figur daneben
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const opts: ("ru" | "lu" | "ro" | "lo")[] = ["ru", "lu", "ro", "lo"];
      const rect = (p: string) => ({
        x: p.startsWith("l") ? 20 : 1600 - CW - FW - 20, y: p.endsWith("u") ? 900 - CH - 20 : 20,
        w: CW + FW, h: CH,
      });
      const overlap = (p: string) => {
        const a = rect(p);
        const ox = Math.max(0, Math.min(a.x + a.w, box.x + box.w) - Math.max(a.x, box.x));
        const oy = Math.max(0, Math.min(a.y + a.h, box.y + box.h) - Math.max(a.y, box.y));
        return ox * oy + (p.startsWith("l") === cx < 800 ? 1 : 0) * 0 + (p.endsWith("u") === cy < 450 ? 600 : 0);
      };
      setPlace(opts.reduce((best, p) => (overlap(p) < overlap(best) ? p : best), "ru"));
    };
    const id = setTimeout(() => find(), 480);
    const reposition = window.setInterval(() => find(), 1200);
    return () => { stop = true; clearTimeout(id); window.clearInterval(reposition); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tourI]);

  /* ---------- Fokusmodus: Hintergrund sperren, nur die erlaubten Stellen bleiben aktiv ---------- */
  useEffect(() => {
    if (step !== "tour") { setHoles([]); return; }
    const t = TOUR[tourI];
    const calc = () => {
      const st = document.getElementById("stage");
      if (!st) return;
      const s2 = st.getBoundingClientRect(), k = s2.width / 1600, pad = 6;
      const found: Box[] = [];
      for (const q of t.allow ?? []) {
        document.querySelectorAll(q).forEach((n) => {
          const el = n as HTMLElement;
          if (!el.offsetParent && el.tagName !== "BODY") return;       // unsichtbar
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          found.push({ x: (r.left - s2.left) / k - pad, y: (r.top - s2.top) / k - pad, w: r.width / k + pad * 2, h: r.height / k + pad * 2 });
        });
      }
      const merged = found.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
      setHoles((old) => (JSON.stringify(old) === JSON.stringify(merged) ? old : merged));
    };
    setHoles([]);                      // neuer Schritt: erst mal alles zu, bis die Seite steht
    const iv = window.setInterval(calc, 250);
    const id = window.setTimeout(calc, 60);
    return () => { window.clearInterval(iv); window.clearTimeout(id); };
  }, [step, tourI]);

  // Tastatur und Mausrad: ganz vorn abfangen, bevor die App sie sieht
  useEffect(() => {
    const typingIn = (t: HTMLElement | null) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === "F1") { stop(); return; }                          // Hilfe-Fenster gibt es im ganzen Tutorial nicht
      if (step !== "tour") return;                                     // Einrichtung: Eingaben gehören den Feldern
      if (e.key === "F11") { stop(); return; }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".tutcard") && (e.key === "Enter" || e.key === " ")) { e.stopPropagation(); return; } // Knopf in der Karte bedienen, aber nichts an die App weitergeben
      if ((TOUR[tourI].keys ?? []).includes(e.key)) return;            // für diesen Schritt erlaubt
      if (typingIn(t) && e.key !== "Escape") return;                   // Tippen in einem erlaubten Feld
      stop();
    };
    const onWheel = (e: WheelEvent) => {
      if (step !== "tour" || TOUR[tourI].wheel) return;
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("wheel", onWheel, true); };
  }, [step, tourI]);

  /* ---------- Aufgabe erledigt? Dann von selbst weiter ---------- */
  useEffect(() => {
    if (step !== "tour" || done) return;
    const t = TOUR[tourI];
    if (t.doneWhen) {
      const iv = window.setInterval(() => {
        if (!document.querySelector(t.doneWhen!)) return;
        // Treffer gleich zu Beginn heißt: war schon vorher erledigt (z. B. Ordner stehen bereits)
        if (Date.now() - stepStart.current < 2200) setPreDone(true);
        setDone(true); window.clearInterval(iv);
      }, 300);
      return () => window.clearInterval(iv);
    }
    if (t.doneOnClick) {
      const onClick = (e: MouseEvent) => {
        if ((e.target as Element)?.closest?.(".tutcard, .tutblock")) return; // Klicks auf die Karte oder auf gesperrte Flächen zählen nicht
        setDone(true);
      };
      document.addEventListener("click", onClick, true);
      return () => document.removeEventListener("click", onClick, true);
    }
    return;
  }, [step, tourI, done]);

  // kurz warten, damit man die eigene Aktion noch sieht, dann weiter
  useEffect(() => {
    if (step !== "tour" || !done) return;
    const t = TOUR[tourI];
    if (preDone || (!t.doneWhen && !t.doneOnClick)) return;
    const id = setTimeout(() => { if (tourI < TOUR.length - 1) setTourI((i) => i + 1); else go(1); }, 1100);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, preDone, step, tourI]);

  const go = (d: number) => { setMsg(""); setStep(ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(step) + d))]); };
  const next = async () => {
    if (step === "profil") {
      if (!p.vorname.trim() || !p.nachname.trim() || !p.beruf.trim()) { setMsg("Bitte mindestens Vorname, Nachname und Ausbildungsberuf angeben."); return; }
      await saveProfile(p);
    }
    if (step === "figur") await setSetting("pref_char", charId);
    if (step === "vorlage") {
      try { await applyTplChoice(tplChoice); } catch (e) { setMsg("Die Vorlage konnte nicht übernommen werden: " + String(e).replace(/^Error:\s*/, "")); return; }
    }
    if (step === "quali") {
      // Qualifikationen sind freiwillig: wer überspringt, bekommt sie komplett nicht (für diesen Nutzer)
      if (qualMode === "liste" && suggestion) { await setQualsEnabled(true); setQualCount(await replaceQualifications(suggestion.items)); }
      else if (qualMode === "vorlage" && tplQuals.length) { await setQualsEnabled(true); setQualCount(await replaceQualifications(tplQuals)); }
      else if (qualMode === "eigene" && qualText.trim()) { await setQualsEnabled(true); setQualCount(await replaceQualifications(qualText.split("\n"))); }
      else {
        await setQualsEnabled(false);
        if (prof?.id !== "si") await replaceQualifications([]);   // die vorinstallierte IHK-Liste (Systemintegration) räumen, damit sie später nicht fälschlich auftaucht (belegte bleiben)
      }
    }
    if (step === "tour" && tourI < TOUR.length - 1) { setTourI(tourI + 1); return; }
    if (step === "import") setTourI(0);
    go(1);
  };
  const back = () => {
    if (step === "tour" && tourI > 0) { setTourI(tourI - 1); return; }   // ein Rundgang-Schritt zurück
    if (step === "tour") { setTourI(0); go(-1); return; }                // aus dem Rundgang zurück in die Einrichtung
    go(-1);
  };

  const guideId: GuideId = step === "tour" ? (TOUR[tourI].guide ?? "nami") : "nami";
  const guide = GUIDES[guideId];
  const pose: Pose = step === "start" ? "gruss" : step === "profil" ? "erklaert" : step === "figur" ? "jubelt" : step === "vorlage" ? "denkt" : step === "quali" ? "schreibt" : step === "import" ? "pinnt" : step === "tour" ? TOUR[tourI].pose : "jubelt";
  const field = (k: keyof Profile, label: string, ph = "", list?: string) => (
    <label className="lab">{label}<input className="field" value={p[k]} placeholder={ph} list={list} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
  );
  const idx = ORDER.indexOf(step);

  return (
    <div className={"tut" + (step === "tour" ? " showpage pl-" + place : "")} role="dialog" aria-label="Tutorial">
      {step === "tour" && (
        <div className="tutblock" aria-hidden="true"
          style={{ clipPath: `path(nonzero, "${blockPath(holes)}")` }}
          onPointerDown={() => setNudge((n) => n + 1)} />
      )}
      {spot && step === "tour" && (
        <>
          <div key={nudge} className="tutspot" style={{ left: spot.x - 10, top: spot.y - 10, width: spot.w + 20, height: spot.h + 20, ["--gc" as string]: guide.accent }} />
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
            <h2>Hallo, ich bin {MASCOT_NAME}!</h2>
            <p>Ich zeige dir in ein paar Minuten, wie diese App funktioniert. Sie ist dein Begleiter für die Ausbildung: Du hältst fest, was du gemacht hast, und daraus entstehen dein Berichtsheft, deine Projekte und eine Übersicht deiner Fähigkeiten.</p>
            <p>Alles bleibt bei dir: in deinem Datenordner bzw. auf diesem Gerät, ohne Konto und ohne Internet. Auf Wunsch schützt du es mit einem Passwort (System → Passwortschutz). Los geht's mit ein paar Angaben zu dir.</p>
          </>}
          {step === "profil" && <>
            <h2>Wer bist du?</h2>
            <div className="row2">{field("vorname", "Vorname")}{field("nachname", "Nachname")}</div>
            <div className="row2">
              <label className="lab">Ausbildungsberuf
                <select className="field" value={otherBeruf ? ANDERE_ID : (prof?.id ?? "")} onChange={(e) => {
                  const id = e.target.value;
                  if (id === ANDERE_ID) { setOtherBeruf(true); setP({ ...p, beruf: "", fachrichtung: "" }); return; }
                  setOtherBeruf(false);
                  const pr = profileById(id);
                  if (pr) setP({ ...p, beruf: pr.beruf, fachrichtung: pr.fachrichtung, kammer: pr.kammer });
                  else setP({ ...p, beruf: "", fachrichtung: "" });
                }}>
                  <option value="">– bitte wählen –</option>
                  {PROFILES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  <option value={ANDERE_ID}>Anderer Beruf …</option>
                </select>
              </label>
              {otherBeruf ? <>{field("beruf", "Dein Ausbildungsberuf", "z. B. Elektroniker/in")}</>
                : prof?.fachrichtungen ? (
                  <label className="lab">{prof.fachrichtungLabel ?? "Fachrichtung"}
                    <select className="field" value={p.fachrichtung} onChange={(e) => setP({ ...p, fachrichtung: e.target.value })}>
                      {prof.fachrichtungen.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </label>
                ) : <div className="lab"><span>Zuständige Stelle</span><div className="tutnote">{prof ? `${prof.hinweis}` : "Wähle deinen Beruf, dann stelle ich Kammer und Vorlage passend ein."}</div></div>}
            </div>
            {otherBeruf && <div className="row2">{field("fachrichtung", "Fachrichtung (falls es eine gibt)")}<div className="lab"><span>Vorlage</span><div className="tutnote">Für deinen Beruf gibt es keine fertige Vorlage. Du kannst gleich eine eigene hochladen oder die Standard-Vorlage nehmen.</div></div></div>}
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
          </>}
          {step === "figur" && <>
            <h2>Wähle deine Figur</h2>
            <p>Das ist deine <b>Hauptfigur</b>: Sie steht im Hauptmenü und wechselt je nach Bereich die Pose. {MASCOT_NAME} bleibt als Begleiter immer bei dir, egal wen du wählst. Du kannst die Figur später unter System ändern.</p>
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
            <p>Wie soll dein Wochenbericht aussehen? Such dir einen Weg aus. Du kannst das später jederzeit unter System ändern.</p>
            <TemplateChooser prof={prof} value={tplChoice} onChange={setTplChoice} />
          </>}
          {step === "quali" && <>
            <h2>Qualifikationen <small>freiwillig</small></h2>
            <p>Qualifikationen sind Stichwörter aus deinem Ausbildungsrahmenplan, die du an Notizen hängen kannst. Manche Betriebe und Kammern wollen das im Berichtsheft, andere nicht. Du entscheidest.</p>
            <div className="qopts">
              {suggestion && (
                <div className={"qopt" + (qualMode === "liste" ? " on" : "")} onClick={() => setQualMode("liste")} role="button" tabIndex={0}>
                  <b>{suggestion.title} <small>{suggestion.items.length} Einträge</small></b>
                  <span>{suggestion.source}</span>
                  <details onClick={(e) => e.stopPropagation()}><summary>Liste ansehen</summary><ul className="qtlist">{suggestion.items.map((i) => <li key={i.name}>{i.name}</li>)}</ul></details>
                </div>
              )}
              {tplQuals.length > 0 && (
                <div className={"qopt" + (qualMode === "vorlage" ? " on" : "")} onClick={() => setQualMode("vorlage")} role="button" tabIndex={0}>
                  <b>Aus meiner Vorlage übernehmen <small>{tplQuals.length} Einträge</small></b><span>Die Auswahlliste aus der Datei, die du hochgeladen hast.</span>
                </div>
              )}
              <div className={"qopt" + (qualMode === "eigene" ? " on" : "")} onClick={() => setQualMode("eigene")} role="button" tabIndex={0}>
                <b>Eigene Liste einfügen</b><span>Eine Qualifikation pro Zeile, z. B. aus dem Ausbildungsrahmenplan deines Betriebs.</span>
                {qualMode === "eigene" && <textarea className="field" rows={5} value={qualText} onClick={(e) => e.stopPropagation()} onChange={(e) => setQualText(e.target.value)} />}
              </div>
              <div className={"qopt" + (qualMode === "keine" ? " on" : "")} onClick={() => setQualMode("keine")} role="button" tabIndex={0}>
                <b>Keine Qualifikationen nutzen</b><span>Dann gibt es sie nirgends: kein Feld in den Notizen, keine Dropdowns im Export, keine Fähigkeiten-Übersicht.</span>
              </div>
            </div>
            <p className="tutnote">Wenn du diesen Schritt überspringst, bleiben die Qualifikationen aus. Unter System kannst du sie jederzeit einschalten.</p>
          </>}
          {step === "import" && <>
            <h2>Alte Berichtshefte mitnehmen</h2>
            <p>Hast du schon Berichtshefte geschrieben? Dann hol sie rein, als Word oder PDF. Daraus werden Notizen, und deine Fähigkeiten-Übersicht ist sofort aktuell.</p>
            <ImportDialog inline onClose={() => {}} />
          </>}
          {step === "tour" && <>
            <h2>{TOUR[tourI].title} <small>{tourI + 1} / {TOUR.length}</small></h2>
            <p dangerouslySetInnerHTML={{ __html: TOUR[tourI].text }} />
            {TOUR[tourI].todo && (
              <p className={"tuttodo" + (done ? " ok" : "")}>
                <b>{done ? "✓ Passt!" : "Du bist dran:"}</b>{" "}
                {done ? (preDone ? TOUR[tourI].doneText ?? "Das hast du schon erledigt." : "Weiter geht's …") : TOUR[tourI].todo}
              </p>
            )}
            <ul className="tuttips">{TOUR[tourI].tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </>}
          {step === "fertig" && <>
            <h2>Geschafft, {p.vorname || "los geht's"}!</h2>
            <p>Du bist startklar. Schreib heute deine erste Notiz, der Rest ergibt sich. Wenn du etwas vergisst: <b>System → Tutorial wiederholen</b>, oder der <b>?</b>-Knopf erklärt dir jede Seite.</p>
            <ul className="tutlist">
              <li><b>Text prüfen</b> bei Notizen findet Tippfehler, Kommas und „das/dass“ (ohne Internet).</li>
              <li><b>Passwortschutz</b> und Datenordner stehen unter System, auch für Handy und Browser.</li>
              <li>Nachts (21 bis 6 Uhr) wechselt der Hintergrund von allein auf den Mond.</li>
            </ul>
            <p>{MASCOT_NAME} hilft dir beim Aufhängen deiner Notizen.</p>
          </>}
          {msg && <div className="errbox">{msg}</div>}
        </div>
        <div className="tutfoot">
          {idx > 0 && step !== "fertig" && <button className="btn ghost" onClick={back}><span>Zurück</span></button>}
          {step === "fertig"
            ? <button className="btn" onClick={onDone}><span>Los geht's</span></button>
            : <button className="btn" onClick={next}><span>{step === "start" ? "Starten"
                : step === "tour" && TOUR[tourI].todo && !done ? "Überspringen"
                : step === "tour" && preDone ? "Weiter"
                : step === "quali" && (qualMode === null || qualMode === "keine" || (qualMode === "eigene" && !qualText.trim())) ? "Überspringen (ohne Qualifikationen)"
                : step === "import" ? "Weiter / überspringen" : "Weiter"}</span></button>}
        </div>
      </div>
    </div>
  );
}
