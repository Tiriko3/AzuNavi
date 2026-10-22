// AzuNavi auf dem Handy (Hochformat): eigene, moderne Oberfläche mit unterer Navigation.
// Daten, Berichtsheft-Export und Sicherung sind dieselben wie am PC.
import { useEffect, useRef, useState } from "react";
import "./mobile.css";
import { getSetting, initDb, setSetting } from "../db/db";
import { listNotes, replaceQualifications, type Note, type Scope } from "../db/repo";
import { listBoard, type BoardProject } from "../db/boardRepo";
import { DEFAULT_PREFS, applyPrefs, loadPrefs, savePrefs, type Prefs } from "../prefs";
import { EMPTY_PROFILE, KAMMERN, loadProfile, saveProfile, type Profile } from "../tutorial/profile";
import { ANDERE_ID, PROFILES, findProfile, profileById, qualSuggestion } from "../profiles/berufe";
import { setQualsEnabled, useQualsEnabled } from "../report/quals";
import { isoWeek, weekDates } from "../report/types";
import { TemplateChooser, applyTplChoice, type TplChoice } from "../report/TemplateChooser";
import { createBackup, restoreBackup } from "../backup";
import { fsapi } from "../fsapi";
import { ProfilePanel } from "../web/ProfilePanel";
import { CloudFolderPanel } from "../cloud/CloudFolderPanel";
import { PrivacyInfo } from "../PrivacyInfo";
import { DOWNLOAD_URL } from "../web/downloadUrl";
import { isWebApp, usesDataFolder } from "../platform";
import { todayStr } from "../util";
import { APP_VERSION } from "../version";
import { Field, Icon, Seg, Sheet, relDay, scopeLabel, useBackLayer } from "./ui";
import { NotesScreen } from "./notes";
import { PeopleScreen } from "./people";
import { ProjectsScreen } from "./projects";
import { ReportScreen } from "./report";
import { Backdrop, Confetti, Mascot, MascotToast, Wipe, type Say, type Who } from "./fx";
import namiGruss from "../assets/figuren/nami_gruss.webp";
import namiJubelt from "../assets/figuren/nami_jubelt.webp";

type Tab = "heute" | "notizen" | "projekte" | "kontakte" | "bericht";
type ScopeF = "alle" | Scope;
const TABS: [Tab, string, string][] = [["heute", "Heute", "home"], ["notizen", "Notizen", "note"], ["projekte", "Projekte", "folder"], ["kontakte", "Kontakte", "people"], ["bericht", "Bericht", "book"]];
const TITLES: Record<Tab, string> = { heute: "AzuNavi", notizen: "Notizen", projekte: "Projekte", kontakte: "Kontakte", bericht: "Berichtsheft" };

export default function MobileApp() {
  const [ready, setReady] = useState<"" | "ok" | string>("");
  const [tab, setTab] = useState<Tab>("heute");
  const [scope, setScopeState] = useState<ScopeF>("alle");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [more, setMore] = useState(false);
  const [moreSection, setMoreSection] = useState<"" | "profil">("");
  const [onboard, setOnboard] = useState(false);
  const [autoNew, setAutoNew] = useState(false);
  const [say, setSay] = useState<Say | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [wipe, setWipe] = useState<{ n: number; dir: 1 | -1 }>({ n: 0, dir: 1 });
  const fabRef = useRef<(() => void) | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const st = await initDb();
        if (!st.ok) { setReady("Die Datenbank konnte nicht geöffnet werden."); return; }
        const p = await loadPrefs(); setPrefs(p); applyPrefs(p);
        const pr = await loadProfile(); setProfile(pr);
        const sc = (await getSetting("m_scope")) as ScopeF | null; if (sc) setScopeState(sc);
        if (!pr.vorname.trim() && !p.tutorialDone) setOnboard(true);
        setReady("ok");
      } catch (e) { setReady(String(e)); }
    })();
  }, []);
  const idx = (t: Tab) => TABS.findIndex((x) => x[0] === t);
  const go = (t: Tab) => { if (t === tab) return; setWipe((w) => ({ n: w.n + 1, dir: idx(t) > idx(tab) ? 1 : -1 })); setTab(t); };
  useBackLayer(tab !== "heute", () => go("heute"));
  const setScope = (s: ScopeF) => { setScopeState(s); setSetting("m_scope", s); };
  // Meldungen kommen vom passenden Begleiter: Nami (Notizen, Kontakte), Eda (Projekte), Caramella (Berichtsheft)
  const toast = (t: string, who?: Who, ps?: string) => {
    const w: Who = who ?? (tab === "projekte" ? "eda" : tab === "bericht" ? "cara" : "nami");
    setSay({ who: w, pose: ps ?? (w === "eda" ? "gruss" : w === "cara" ? "zeigt" : "gruss"), text: t, id: Date.now() });
    window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setSay(null), 3100);
  };
  const celebrate = () => setConfetti((c) => c + 1);
  const newNote = () => { go("notizen"); setAutoNew(true); };

  if (ready !== "ok") return <div className="m-app"><div className="m-main" style={{ display: "grid", placeItems: "center" }}>{ready ? <div className="m-err">{ready}</div> : <img src={namiGruss} alt="" style={{ width: 120, opacity: .8 }} />}</div></div>;
  if (onboard) return <Onboarding onDone={async (p) => { setProfile(p); const np = { ...prefs, tutorialDone: true }; setPrefs(np); await savePrefs(np); setOnboard(false); }} />;

  return (
    <div className="m-app" data-scope={scope}>
      <Backdrop />
      <header className="m-top">
        <div className="m-toprow">
          <h1 className="m-title" key={tab}><small>{tab === "heute" ? `KW ${isoWeek(new Date()).week} · ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}` : "AzuNavi"}</small>{TITLES[tab]}</h1>
          <button className="m-iconbtn" onClick={() => { setMoreSection(""); setMore(true); }} aria-label="Mehr und Einstellungen"><Icon n="gear" /></button>
        </div>
        <div className="m-scope" role="tablist" aria-label="Bereich">{(["alle", "schule", "arbeit"] as ScopeF[]).map((s) => <button key={s} className={scope === s ? "on" : ""} onClick={() => setScope(s)} role="tab" aria-selected={scope === s}>{scopeLabel(s)}</button>)}</div>
      </header>

      <main className="m-main"><div className={"m-page" + (wipe.dir < 0 ? " rev" : "")} key={tab}>
        {tab === "heute" && <Today scope={scope} name={profile.vorname} go={go} newNote={newNote} celebrate={celebrate} />}
        {tab === "notizen" && <NotesScreen scope={scope} fabRef={fabRef} toast={toast} autoNew={autoNew} onAutoNew={() => setAutoNew(false)} />}
        {tab === "projekte" && <ProjectsScreen scope={scope} fabRef={fabRef} toast={toast} celebrate={celebrate} />}
        {tab === "kontakte" && <PeopleScreen scope={scope} fabRef={fabRef} toast={toast} />}
        {tab === "bericht" && <ReportScreen toast={toast} celebrate={celebrate} goProfile={() => { setMoreSection("profil"); setMore(true); }} />}
      </div></main>

      {tab !== "bericht" && <button className="m-fab" aria-label={tab === "projekte" ? "Neues Projekt" : tab === "kontakte" ? "Neuer Kontakt" : "Neue Notiz"} onClick={() => (tab === "heute" ? newNote() : fabRef.current?.())}><Icon n="plus" size={30} stroke={2.6} /></button>}
      <nav className="m-nav" aria-label="Bereiche"><span className="m-nav-ind" style={{ transform: `translateX(${idx(tab) * 100}%)` }} />{TABS.map(([t, l, ic]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)} aria-current={tab === t ? "page" : undefined}><Icon n={ic} size={22} />{l}</button>)}</nav>
      <Wipe n={wipe.n} dir={wipe.dir} />
      <MascotToast say={say} />
      <Confetti fire={confetti} />
      <div id="m-layer" />

      <MoreSheet open={more} section={moreSection} onClose={() => setMore(false)} prefs={prefs} setPrefs={async (p) => { setPrefs(p); applyPrefs(p); await savePrefs(p); }}
        profile={profile} setProfile={setProfile} toast={toast} />
    </div>
  );
}

/* ---------- Heute ---------- */
let weekCheered = false;
function Today({ scope, name, go, newNote, celebrate }: { scope: ScopeF; name: string; go: (t: Tab) => void; newNote: () => void; celebrate: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<BoardProject[]>([]);
  useEffect(() => { listNotes().then(setNotes); listBoard().then(setProjects); }, []);
  const yw = isoWeek(new Date()), dates = weekDates(yw.year, yw.week).slice(0, 5), today = todayStr();
  const mine = notes.filter((n) => scope === "alle" || n.scope === scope);
  const filled = new Set(mine.filter((n) => dates.includes(n.date)).map((n) => n.date));
  const active = projects.filter((p) => p.status === "aktiv" && (scope === "alle" || p.scope === scope)).slice(0, 3);
  const hour = new Date().getHours();
  useEffect(() => { if (filled.size === 5 && !weekCheered) { weekCheered = true; setTimeout(celebrate, 500); } }, [filled.size]);
  return (
    <>
      <div className="m-hero"><Mascot who="nami" pose={filled.has(today) ? "jubelt" : "gruss"} size={98} />
        <div><b>{hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend"}{name ? `, ${name}` : ""}!</b>
          <p>{filled.has(today) ? "Heute ist schon etwas notiert. Stark!" : "Was hast du heute gemacht? Ein Satz reicht."}</p></div></div>
      <div className="m-card">
        <div className="m-row"><b className="m-grow">Diese Woche</b><span className="m-note" style={{ margin: 0 }}>{filled.size === 5 ? "Volle Woche! 🎉" : `${filled.size} von 5 Tagen`}</span></div>
        <div className="m-week">{dates.map((d) => <span key={d} style={{ ["--i" as string]: dates.indexOf(d) }} className={(filled.has(d) ? "full " : "") + (d === today ? "today" : "")}>{["Mo", "Di", "Mi", "Do", "Fr"][dates.indexOf(d)]}</span>)}</div>
        <div className="m-btnrow" style={{ marginTop: 12 }}>
          <button className="m-btn" onClick={newNote}><Icon n="plus" />Notiz</button>
          <button className="m-btn sec" onClick={() => go("bericht")}><Icon n="book" size={20} />KW {yw.week}</button>
        </div>
      </div>
      {mine.length > 0 && <><div className="m-h">Zuletzt notiert</div>
        {mine.slice(0, 3).map((n, i) => <article key={n.id} style={{ ["--i" as string]: i + 1 }} className="m-card tap" data-scope={n.scope} onClick={() => go("notizen")}><div className="m-meta" style={{ marginTop: 0 }}>{relDay(n.date)}</div><div className="m-clamp">{n.text}</div></article>)}</>}
      {active.length > 0 && <><div className="m-h">Aktive Projekte</div>
        {active.map((p, i) => <article key={p.id} style={{ ["--i" as string]: i + 4 }} className="m-card tap" data-scope={p.scope} onClick={() => go("projekte")}><div className="m-row"><b className="m-grow">{p.name}</b><span className="m-note" style={{ margin: 0 }}>{p.progress} %</span></div><div className="m-bar"><i style={{ width: `${p.progress}%` }} /></div></article>)}</>}
    </>
  );
}

/* ---------- Mehr: Profil, Darstellung, Berichtsheft, Daten ---------- */
function MoreSheet({ open, section, onClose, prefs, setPrefs, profile, setProfile, toast }: { open: boolean; section: "" | "profil"; onClose: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void; profile: Profile; setProfile: (p: Profile) => void; toast: (t: string) => void }) {
  const qualsOn = useQualsEnabled();
  const [sub, setSub] = useState<"" | "profil" | "vorlage" | "cloud" | "privacy" | "schutz">("");
  const [p, setP] = useState<Profile>(profile);
  const [tpl, setTpl] = useState<TplChoice>({ mode: "standard" });
  const [msg, setMsg] = useState(""), [err, setErr] = useState("");
  useEffect(() => { if (open) { setSub(section); setP(profile); setMsg(""); setErr(""); } }, [open]);
  const prof = findProfile(p.beruf, p.fachrichtung);
  const act = async (f: () => Promise<void>) => { setErr(""); setMsg(""); try { await f(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } };
  const row = (icon: string, title: string, text: string, onClick: () => void) => (
    <button onClick={onClick}><span className="m-avatar" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--m-navy)" }}><Icon n={icon} size={20} /></span><span className="m-grow"><b>{title}</b><br /><small style={{ color: "var(--m-mute)" }}>{text}</small></span><Icon n="right" size={18} /></button>);

  return (
    <Sheet open={open} onClose={onClose} title="Mehr" tall>
      {msg && <div className="m-ok">{msg}</div>}{err && <div className="m-err">{err}</div>}
      <div className="m-list">
        {row("people", "Profil", profile.vorname ? `${profile.vorname} ${profile.nachname} · ${profile.beruf || "Beruf fehlt"}` : "Name und Beruf eintragen", () => setSub("profil"))}
        {row("book", "Berichtsheft-Vorlage", "Standard-Vorlage oder eigene Datei", () => setSub("vorlage"))}
        {row("cloud", "Sicherung in deiner Cloud", "OneDrive, Google Drive …, verschlüsselt", () => setSub("cloud"))}
        {usesDataFolder && row("gear", "Passwortschutz", "Sperren, automatische Sperre, Passwort ändern", () => setSub("schutz"))}
        {row("people", "Datenschutz & Speicherorte", "Was wo gespeichert ist", () => setSub("privacy"))}
        {isWebApp && DOWNLOAD_URL && row("export", "Android-App herunterladen", "Öffnet die Download-Seite", () => window.open(DOWNLOAD_URL, "_blank", "noopener"))}
      </div>
      <div className="m-h">Darstellung</div>
      <Field label="Schriftgröße"><Seg value={String(prefs.font)} options={[["1", "Normal"], ["1.15", "Groß"], ["1.3", "Sehr groß"]]} onChange={(v) => setPrefs({ ...prefs, font: Number(v) })} /></Field>
      <Field label="Begleiter (Nami, Eda, Caramella)"><Seg value={prefs.mascot ? "an" : "aus"} options={[["an", "An"], ["aus", "Aus"]]} onChange={(v) => setPrefs({ ...prefs, mascot: v === "an" })} /></Field>
      <Field label="Animationen"><Seg value={prefs.anim ? "an" : "aus"} options={[["an", "An"], ["aus", "Aus"]]} onChange={(v) => setPrefs({ ...prefs, anim: v === "an" })} /></Field>
      <Field label="Qualifikationen"><Seg value={qualsOn ? "an" : "aus"} options={[["an", "An"], ["aus", "Aus"]]} onChange={(v) => act(async () => { await setQualsEnabled(v === "an"); toast(v === "an" ? "Qualifikationen an" : "Qualifikationen aus"); })} /></Field>
      <div className="m-h">Daten</div>
      <div className="m-btnrow">
        <button className="m-btn sec" onClick={() => act(async () => { const b = await createBackup(APP_VERSION); const path = await (await fsapi()).saveFile(`AzuNavi-Sicherung_${todayStr()}.zip`, b.bytes, "Sicherung", "zip"); if (path) setMsg(`Sicherung gespeichert (${b.rows} Einträge, ${b.files} Dateien).`); })}>Sichern</button>
        <button className="m-btn sec" onClick={() => act(async () => { const fs = await fsapi(); const path = await fs.pickFile(); if (!path) return; const u = await fs.read(path, 500 * 1024 * 1024); const r = await restoreBackup(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer); setMsg(`Eingespielt: ${r.rows} Einträge. Die App startet neu …`); setTimeout(() => location.reload(), 1500); })}>Einspielen</button>
      </div>
      <p className="m-note">Alle Daten liegen nur auf diesem Handy, außer du sicherst sie in deine Cloud. AzuNavi {APP_VERSION}.</p>

      <Sheet open={sub === "profil"} onClose={() => setSub("")} title="Profil" tall footer={<button className="m-btn" onClick={() => act(async () => { await saveProfile(p); setProfile(p); setSub(""); toast("Profil gespeichert"); })}><Icon n="check" />Speichern</button>}>
        <div className="m-btnrow"><Field label="Vorname"><input value={p.vorname} onChange={(e) => setP({ ...p, vorname: e.target.value })} /></Field><Field label="Nachname"><input value={p.nachname} onChange={(e) => setP({ ...p, nachname: e.target.value })} /></Field></div>
        <BerufFields p={p} setP={setP} />
        <Field label="Kammer"><select value={p.kammer} onChange={(e) => setP({ ...p, kammer: e.target.value })}>{[...new Set([...(prof ? [prof.kammer] : []), ...KAMMERN, "Öffentlicher Dienst"])].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Ort der Kammer"><input value={p.kammerOrt} onChange={(e) => setP({ ...p, kammerOrt: e.target.value })} /></Field>
        <Field label="Ausbildungsbetrieb"><input value={p.betrieb} onChange={(e) => setP({ ...p, betrieb: e.target.value })} /></Field>
        <Field label="Ausbilder/in"><input value={p.ausbilder} onChange={(e) => setP({ ...p, ausbilder: e.target.value })} /></Field>
        <p className="m-note">Name, Beruf, Betrieb und Ausbilder stehen oben in jedem Berichtsheft.</p>
      </Sheet>
      <Sheet open={sub === "vorlage"} onClose={() => setSub("")} title="Berichtsheft-Vorlage" tall footer={<button className="m-btn" onClick={() => act(async () => { await applyTplChoice(tpl); setSub(""); toast("Vorlage übernommen"); })}><Icon n="check" />Übernehmen</button>}>
        <TemplateChooser prof={prof} value={tpl} onChange={setTpl} />
      </Sheet>
      {usesDataFolder && <Sheet open={sub === "schutz"} onClose={() => setSub("")} title="Passwortschutz" tall><ProfilePanel mobile /></Sheet>}
      <Sheet open={sub === "privacy"} onClose={() => setSub("")} title="Datenschutz" tall><PrivacyInfo /></Sheet>
      <Sheet open={sub === "cloud"} onClose={() => setSub("")} title="Deine Cloud" tall><CloudFolderPanel /></Sheet>
    </Sheet>
  );
}

function BerufFields({ p, setP }: { p: Profile; setP: (p: Profile) => void }) {
  const prof = findProfile(p.beruf, p.fachrichtung);
  const [other, setOther] = useState(!!p.beruf && !prof);
  return <>
    <Field label="Ausbildungsberuf"><select value={other ? ANDERE_ID : prof?.id ?? ""} onChange={(e) => {
      const id = e.target.value; if (id === ANDERE_ID) { setOther(true); setP({ ...p, beruf: "", fachrichtung: "" }); return; }
      setOther(false); const pr = profileById(id); setP(pr ? { ...p, beruf: pr.beruf, fachrichtung: pr.fachrichtung, kammer: pr.kammer } : { ...p, beruf: "", fachrichtung: "" });
    }}><option value="">– bitte wählen –</option>{PROFILES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}<option value={ANDERE_ID}>Anderer Beruf …</option></select></Field>
    {other && <Field label="Dein Beruf"><input value={p.beruf} onChange={(e) => setP({ ...p, beruf: e.target.value })} /></Field>}
    {prof?.fachrichtungen && <Field label={prof.fachrichtungLabel ?? "Fachrichtung"}><select value={p.fachrichtung} onChange={(e) => setP({ ...p, fachrichtung: e.target.value })}>{prof.fachrichtungen.map((f) => <option key={f}>{f}</option>)}</select></Field>}
  </>;
}

/* ---------- Einrichtung beim ersten Start ---------- */
function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [qual, setQual] = useState<"liste" | "keine">("keine");
  const [err, setErr] = useState("");
  const prof = findProfile(p.beruf, p.fachrichtung), sug = qualSuggestion(prof, p.fachrichtung);
  const finish = async () => {
    try {
      await saveProfile(p);
      if (qual === "liste" && sug) { await setQualsEnabled(true); await replaceQualifications(sug.items); }
      else { await setQualsEnabled(false); if (prof?.id !== "si") await replaceQualifications([]); }
      onDone(p);
    } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="m-app">
      <header className="m-top"><div className="m-toprow"><h1 className="m-title"><small>Einrichtung · {step + 1} von 3</small>{["Willkommen", "Über dich", "Qualifikationen"][step]}</h1></div></header>
      <main className="m-main" style={{ paddingBottom: 30 }}>
        {err && <div className="m-err">{err}</div>}
        {step === 0 && <>
          <div className="m-hero"><Mascot who="nami" pose="gruss" size={98} /><div><b>Hallo, ich bin Nami!</b><p>Ich begleite dich durch die Ausbildung.</p></div></div>
          <div className="m-card"><p style={{ margin: 0 }}>Mit AzuNavi hältst du fest, was du in Betrieb und Schule machst. Daraus entsteht dein <b>Berichtsheft</b>, dazu Projekte und deine Kontakte.</p>
            <p className="m-note">Alles bleibt auf diesem Handy. Es gibt kein Konto und keine Werbung.</p></div>
          <button className="m-btn" onClick={() => setStep(1)}>Los geht’s</button>
        </>}
        {step === 1 && <>
          <div className="m-btnrow"><Field label="Vorname"><input value={p.vorname} onChange={(e) => setP({ ...p, vorname: e.target.value })} autoFocus /></Field><Field label="Nachname"><input value={p.nachname} onChange={(e) => setP({ ...p, nachname: e.target.value })} /></Field></div>
          <BerufFields p={p} setP={setP} />
          <Field label="Ausbildungsbetrieb (optional)"><input value={p.betrieb} onChange={(e) => setP({ ...p, betrieb: e.target.value })} /></Field>
          <div className="m-btnrow"><button className="m-btn sec" onClick={() => setStep(0)}>Zurück</button><button className="m-btn" disabled={!p.vorname.trim() || !p.beruf.trim()} onClick={() => setStep(2)}>Weiter</button></div>
        </>}
        {step === 2 && <>
          <div className="m-card"><p style={{ marginTop: 0 }}>Qualifikationen sind Stichwörter aus deinem Ausbildungsrahmenplan, die du an Notizen hängen kannst. Manche Betriebe wollen das im Berichtsheft, andere nicht.</p>
            <div className="m-list">
              {sug && <button onClick={() => setQual("liste")}><span className={"m-check" + (qual === "liste" ? " on" : "")}>{qual === "liste" && <Icon n="check" size={16} stroke={3} />}</span><span className="m-grow"><b>Liste für meinen Beruf</b><br /><small style={{ color: "var(--m-mute)" }}>{sug.items.length} Einträge</small></span></button>}
              <button onClick={() => setQual("keine")}><span className={"m-check" + (qual === "keine" ? " on" : "")}>{qual === "keine" && <Icon n="check" size={16} stroke={3} />}</span><span className="m-grow"><b>Ohne Qualifikationen</b><br /><small style={{ color: "var(--m-mute)" }}>Kannst du später unter Mehr einschalten</small></span></button>
            </div></div>
          <div className="m-btnrow"><button className="m-btn sec" onClick={() => setStep(1)}>Zurück</button><button className="m-btn" onClick={finish}>Fertig</button></div>
        </>}
      </main>
    </div>
  );
}
