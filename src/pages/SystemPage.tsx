import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { usePrefs } from "../prefs";
import type { DbStatus } from "../db/db";
import { inTauri } from "../db/db";
import { fsapi } from "../fsapi";
import { createBackup, resetApp, restoreBackup } from "../backup";
import { ImportDialog } from "../import/ImportDialog";
import { loadProfile, saveProfile, type Profile } from "../tutorial/profile";
import { loadActiveTemplate, useBundledTemplate } from "../report/templates";
import { TemplateChooser, applyTplChoice, type TplChoice } from "../report/TemplateChooser";
import { setQualsEnabled, useQualsEnabled } from "../report/quals";
import { PROFILES, findProfile, profileById, qualSuggestion } from "../profiles/berufe";
import { listQualifications, replaceQualifications } from "../db/repo";
import { CloudFolderPanel } from "../cloud/CloudFolderPanel";
import { ProfilePanel } from "../web/ProfilePanel";
import { PrivacyInfo } from "../PrivacyInfo";
import { DOWNLOAD_URL } from "../web/downloadUrl";
import { todayStr } from "../util";
import { getSetting, setSetting } from "../db/db";
import { ensureLt } from "../spell/spell";
import { applyDisplay, getDisplayMode, setWindowSize, type DisplayMode } from "../display";
import { isDesktopApp, isMobile, isWebApp, noDesktop, usesDataFolder } from "../platform";
import { CHARACTERS } from "../chars";
import { listGrants, revokeGrant, type GrantsList } from "../desktop/grants";

import { APP_VERSION } from "../version";
export { APP_VERSION };

export function SystemPage({ db, muted, onToggleMute, escRef }: { db: DbStatus | null; muted: boolean; onToggleMute: () => void; escRef: MutableRefObject<(() => boolean) | null> }) {
  const { prefs, setPrefs, openTutorial } = usePrefs();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tplInfo, setTplInfo] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [tplChoice, setTplChoice] = useState<TplChoice>({ mode: "standard" });
  const qualsOn = useQualsEnabled();
  const [qualCount, setQualCount] = useState(0);
  const [armLoad, setArmLoad] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [privOpen, setPrivOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [display, setDisplay] = useState<DisplayMode>("fenster");
  const [charId, setCharId] = useState("eigene");
  useEffect(() => { getDisplayMode().then(setDisplay); getSetting("pref_char").then((c) => c && setCharId(c)); }, []);
  const pickDisplay = (m: DisplayMode) => act(async () => { await applyDisplay(m); setDisplay(m); });
  const pickChar = async (id: string) => { await setSetting("pref_char", id); setCharId(id); setMsg("Figur gewechselt – sie erscheint, wenn du zum Menü zurückgehst."); };
  const [lt, setLt] = useState<{ on: boolean; dir: string; status: string }>({ on: false, dir: "", status: "" });
  useEffect(() => { (async () => setLt({ on: (await getSetting("lt_on")) === "1", dir: (await getSetting("lt_dir")) ?? "", status: "" }))(); }, []);
  const ltTest = () => act(async () => {
    setLt((x) => ({ ...x, status: "startet … (beim ersten Mal bis zu 30 Sekunden)" }));
    try { const ok = await ensureLt(true); setLt((x) => ({ ...x, status: ok ? "läuft ✓" : "aus" })); }
    catch (e) { setLt((x) => ({ ...x, status: String(e).replace(/^Error:\s*/, "") })); }
  });
  const ltToggle = async () => { const on = !lt.on; await setSetting("lt_on", on ? "1" : "0"); setLt({ ...lt, on, status: "" }); if (on && lt.dir) ltTest(); };
  const ltPick = () => act(async () => {
    const d = await (await fsapi()).pickFolder("LanguageTool-Ordner wählen (darin liegt languagetool-server.jar)", false);
    if (!d) return;
    await setSetting("lt_dir", d); await setSetting("lt_on", "1");
    setLt({ on: true, dir: d, status: "" }); ltTest();
  });
  const refreshTpl = async () => {
    const t = await loadActiveTemplate();
    const name = await getSetting("custom_template_name");
    setTplInfo(t.custom
      ? `Eigene Vorlage${name ? ` „${name}“` : ""} (${t.info.kind === "karten" ? "Tageskarten" : t.info.kind === "platzhalter" ? "mit Platzhaltern" : "freies Layout"})`
      : `Standard-Vorlage${t.profile ? ` für ${t.profile.beruf}` : " (IHK-Tageskarten)"}`);
  };
  const refreshQuals = () => listQualifications().then((q) => setQualCount(q.length));
  useEffect(() => { loadProfile().then(setProfile); refreshTpl().catch(() => {}); refreshQuals(); }, [qualsOn]);
  useEffect(() => {
    escRef.current = () => { if (privOpen) { setPrivOpen(false); return true; } if (cloudOpen) { setCloudOpen(false); return true; } if (tplOpen) { setTplOpen(false); return true; } if (importOpen) { setImportOpen(false); return true; } return false; };
    return () => { escRef.current = null; };
  }, [escRef, importOpen, tplOpen, cloudOpen, privOpen]);
  const act = async (f: () => Promise<void>) => { setErr(""); setMsg(""); setBusy(true); try { await f(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } finally { setBusy(false); } };

  const backup = () => act(async () => {
    const { bytes, rows, files } = await createBackup(APP_VERSION);
    const path = await (await fsapi()).saveFile(`AzuNavi-Sicherung_${todayStr()}.zip`, bytes, "Sicherung", "zip");
    if (path) setMsg(`Sicherung gespeichert: ${rows} Einträge und ${files} Dateien. Nimm die Datei zusammen mit der App auf den anderen Laptop.`);
  });
  const restore = () => act(async () => {
    const fs = await fsapi();
    const path = await fs.pickFile();
    if (!path) return;
    const u = await fs.read(path, 500 * 1024 * 1024);
    const r = await restoreBackup(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);
    setMsg(`Sicherung eingespielt: ${r.rows} Einträge und ${r.files} Dateien. Die App startet neu …`);
    setTimeout(() => location.reload(), 1600);
  });
  const shortcut = () => act(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke<string>("ensure_desktop_shortcut");
    setMsg(r === "dev" ? "Im Entwicklungsmodus wird keine Verknüpfung angelegt (nur in der fertigen .exe)." : r === "nicht-windows" ? "Auf Linux brauchst du keine Verknüpfung: .deb und AppImage legen selbst einen Starter im Menü an." : "Die Verknüpfung „AzuNavi“ liegt auf dem Desktop.");
  });
  const reset = () => act(async () => {
    if (resetText.trim().toUpperCase() !== "ZURÜCKSETZEN") return;
    await resetApp();
    setMsg("Alles gelöscht. Die App startet neu …");
    setTimeout(() => location.reload(), 1200);
  });

  const prof = profile ? findProfile(profile.beruf, profile.fachrichtung) : null;
  const suggestion = qualSuggestion(prof, profile?.fachrichtung ?? "");
  const changeBeruf = (id: string) => act(async () => {
    const pr = profileById(id); if (!pr || !profile) return;
    const np = { ...profile, beruf: pr.beruf, fachrichtung: pr.fachrichtung, kammer: pr.kammer };
    await saveProfile(np); setProfile(np); await refreshTpl();
    setMsg("Beruf geändert: Kammer und Standard-Vorlage sind angepasst. Deine Qualifikationen habe ich nicht angefasst.");
  });
  const changeFach = (f: string) => act(async () => { if (!profile) return; const np = { ...profile, fachrichtung: f }; await saveProfile(np); setProfile(np); setArmLoad(false); });
  const applyTpl = () => act(async () => { await applyTplChoice(tplChoice); await refreshTpl(); setTplOpen(false); setMsg("Vorlage übernommen. Sie gilt ab dem nächsten Export."); });
  const toggleQuals = () => act(async () => { await setQualsEnabled(!qualsOn); setMsg(!qualsOn ? "Qualifikationen sind wieder an. Frühere Zuordnungen sind noch da." : "Qualifikationen sind aus: kein Feld in den Notizen, keine Dropdowns im Export, keine Fähigkeiten-Übersicht. Nichts ist gelöscht."); });
  const loadQualList = () => act(async () => {
    if (!suggestion) return;
    if (!armLoad) { setArmLoad(true); return; }
    await replaceQualifications(suggestion.items); await refreshQuals(); setArmLoad(false); setMsg(`Liste geladen: ${suggestion.items.length} Qualifikationen. Schon vergebene bleiben erhalten.`);
  });

  return (
    <div className="work sys">
      <div className="syscols">
        <section className="paperbox syscard">
          <h3>Darstellung</h3>
          <div className="sysrow"><span>Schriftgröße</span>
            <div className="seg">{[[1, "Normal"], [1.15, "Groß"], [1.3, "Sehr groß"]].map(([v, l]) => (
              <button key={String(v)} className={"segb" + (prefs.font === v ? " on schule" : "")} onClick={() => setPrefs({ font: v as number })}><span>{l}</span></button>))}</div>
          </div>
          {!noDesktop && <>
          <div className="sysrow"><span>Anzeige</span>
            <div className="seg">{([["fenster", "Fenster"], ["randlos", "Randlos"], ["vollbild", "Vollbild"]] as [DisplayMode, string][]).map(([v, l]) => (
              <button key={v} className={"segb" + (display === v ? " on schule" : "")} onClick={() => pickDisplay(v)}><span>{l}</span></button>))}</div>
          </div>
          <div className="sysrow"><span>Fenstergröße</span>
            <span className="inl">{[[1280, 720], [1600, 900], [1920, 1080]].map(([w, h]) => (
              <button key={w} className="mini" onClick={() => act(async () => { await setWindowSize(w, h); setDisplay("fenster"); })}>{w}×{h}</button>))}</span>
          </div>
          <p className="small">Im Fenstermodus kannst du das Fenster auch frei ziehen, der Inhalt skaliert mit. F11 schaltet jederzeit Vollbild ein und aus.</p>
          </>}
          <div className="sysrow"><span>Figur</span>
            <select className="field mini-select" value={charId} onChange={(e) => pickChar(e.target.value)}>
              {CHARACTERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="sysrow"><span>Animationen</span>
            <button className={"toggle" + (prefs.anim ? " on" : "")} onClick={() => setPrefs({ anim: !prefs.anim })}><i />{prefs.anim ? "an" : "aus"}</button></div>
          <div className="sysrow"><span>Maskottchen (Nami, Caramella, Eda)</span>
            <button className={"toggle" + (prefs.mascot ? " on" : "")} onClick={() => setPrefs({ mascot: !prefs.mascot })}><i />{prefs.mascot ? "an" : "aus"}</button></div>
          <div className="sysrow"><span>Ton</span>
            <button className={"toggle" + (!muted ? " on" : "")} onClick={onToggleMute}><i />{muted ? "aus" : "an"}</button></div>
          <div className="sysrow"><span>Tutorial</span><button className="mini hot" onClick={openTutorial}>Tutorial wiederholen</button></div>
          {!noDesktop ? <>
          <h3 className="sysh">Grammatik (LanguageTool)</h3>
          <div className="sysrow"><span>LanguageTool nutzen</span>
            <button className={"toggle" + (lt.on ? " on" : "")} onClick={ltToggle}><i />{lt.on ? "an" : "aus"}</button></div>
          <div className="sysrow"><span className="ltdir" title={lt.dir}>{lt.dir || "kein Ordner gewählt"}</span>
            <span className="inl"><button className="mini" onClick={ltPick}>Ordner wählen</button>{lt.dir && <button className="mini" onClick={ltTest}>Testen</button>}</span></div>
          {lt.status && <p className="small ltstat">Status: {lt.status}</p>}
          <p className="small">Einmalig: Java 17+ installieren (Windows: <code>winget install EclipseAdoptium.Temurin.21.JRE</code>, Linux: <code>sudo apt install openjdk-21-jre</code>) und „LanguageTool Desktop“ von languagetool.org herunterladen und entpacken. Dann hier den Ordner wählen. Ohne LanguageTool prüft die App mit Hunspell (nur Rechtschreibung und einfache Regeln).</p>
          </> : <p className="small">Die Grammatikprüfung mit LanguageTool braucht Java und geht nur am PC. Die Rechtschreibprüfung funktioniert auch hier.</p>}
        </section>

        <section className="paperbox syscard">
          <h3>Beruf &amp; Berichtsheft</h3>
          {profile && <div className="sysrow"><span>Beruf</span>
            <select className="field mini-select" value={prof?.id ?? "andere"} onChange={(e) => changeBeruf(e.target.value)}>
              {!prof && <option value="andere">Anderer Beruf: {profile.beruf || "–"}</option>}
              {PROFILES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select></div>}
          {prof?.fachrichtungen && profile && <div className="sysrow"><span>{prof.fachrichtungLabel ?? "Fachrichtung"}</span>
            <select className="field mini-select" value={profile.fachrichtung} onChange={(e) => changeFach(e.target.value)}>{prof.fachrichtungen.map((f) => <option key={f}>{f}</option>)}</select></div>}
          <div className="sysrow"><span>Vorlage</span><span className="inl"><span className="small">{tplInfo}</span><button className="mini hot" onClick={() => { setTplChoice({ mode: "standard" }); setTplOpen(true); }}>Ansehen / ändern</button></span></div>
          <div className="sysrow"><span>Qualifikationen</span>
            <button className={"toggle" + (qualsOn ? " on" : "")} onClick={toggleQuals}><i />{qualsOn ? "an" : "aus"}</button></div>
          {qualsOn && suggestion && <div className="sysrow"><span>{qualCount} gespeichert</span>
            <button className={"mini" + (armLoad ? " hot" : "")} disabled={busy} onClick={loadQualList}>{armLoad ? "Wirklich laden?" : "Liste für meinen Beruf laden"}</button></div>}
          <h3 className="sysh">Daten</h3>
          <div className="sysrow"><span>Alte Berichtshefte</span><button className="mini" onClick={() => setImportOpen(true)}>Importieren (Word/PDF)</button></div>
          {usesDataFolder && <WebDataRow />}
          {isDesktopApp && <GrantsPanel />}
          {isWebApp && DOWNLOAD_URL && <div className="sysrow"><span>Handy-App (Android)</span><a className="mini" href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Herunterladen</a></div>}
          <div className="sysrow"><span>Daten mitnehmen</span><button className="mini" disabled={busy} onClick={backup}>Sicherung erstellen</button></div>
          <div className="sysrow"><span>Datenschutz &amp; Speicherorte</span><button className="mini" onClick={() => setPrivOpen(true)}>Ansehen</button></div>
          <div className="sysrow"><span>Sicherung in deiner Cloud</span><button className="mini" onClick={() => setCloudOpen(true)}>Öffnen</button></div>
          <div className="sysrow"><span>Auf neuem Laptop</span><button className="mini" disabled={busy} onClick={restore}>Sicherung einspielen</button></div>
          {inTauri && !isMobile && <div className="sysrow"><span>Desktop-Verknüpfung</span><button className="mini" disabled={busy} onClick={shortcut}>Anlegen</button></div>}
          <p className="small">Die Sicherung enthält Notizen, Kontakte, Projekte, Berichtshefte, Einstellungen, Anhänge, Porträts und deine Vorlage. Deine Ordner Arbeit/Schule kopierst du wie gewohnt selbst, auf dem neuen Laptop wählst du sie unter Dateien neu.</p>
          {msg && <div className="flash">{msg}</div>}
          {err && <div className="errbox">{err}</div>}
        </section>

        <section className="paperbox syscard">
          <h3>Profil &amp; Info</h3>
          {profile && <dl className="rows">
            <dt>Name</dt><dd>{[profile.vorname, profile.nachname].filter(Boolean).join(" ") || "–"}</dd>
            <dt>Beruf</dt><dd>{[profile.beruf, profile.fachrichtung].filter(Boolean).join(" ") || "–"}</dd>
            <dt>Kammer</dt><dd>{[profile.kammer, profile.kammerOrt].filter(Boolean).join(" ")}</dd>
            <dt>Betrieb</dt><dd>{profile.betrieb || "–"}</dd>
            <dt>Vorlage</dt><dd>{tplInfo}</dd>
            <dt>Datenbank</dt><dd>{db?.ok ? <span className="ok">{db.mode === "sqlite" ? `SQLite, Schema ${db.schemaVersion}` : db.mode === "ordner" ? `SQLite im Datenordner, Schema ${db.schemaVersion}` : "Browser-Testmodus"}</span> : <span className="bad">{db?.error}</span>}</dd>
            <dt>Version</dt><dd>{APP_VERSION}</dd>
          </dl>}
          {usesDataFolder && <><h3 className="sysh">Passwortschutz</h3><ProfilePanel /></>}
          <div className="danger">
            <b>App zurücksetzen</b>
            <p className="small">Löscht alle Daten in der App. Deine Ordner und Dateien auf der Festplatte bleiben. Tippe <b>ZURÜCKSETZEN</b> ein:</p>
            <div className="inl">
              <input className="field grow" value={resetText} onChange={(e) => setResetText(e.target.value)} />
              <button className={"btn danger" + (resetText.trim().toUpperCase() === "ZURÜCKSETZEN" ? " arm" : "")} disabled={resetText.trim().toUpperCase() !== "ZURÜCKSETZEN" || busy} onClick={reset}><span>Zurücksetzen</span></button>
            </div>
          </div>
        </section>
      </div>
      {importOpen && <ImportDialog onClose={() => { setImportOpen(false); refreshTpl().catch(() => {}); }} />}
      {privOpen && (
        <div className="fmodal impmodal" onClick={() => setPrivOpen(false)}>
          <div className="impbox paperbox" onClick={(e) => e.stopPropagation()}>
            <h3>Datenschutz &amp; Speicherorte</h3>
            <PrivacyInfo />
            <div className="actions static"><button className="btn ghost" onClick={() => setPrivOpen(false)}><span>Schließen</span></button></div>
          </div>
        </div>
      )}
      {cloudOpen && (
        <div className="fmodal impmodal">
          <div className="impbox paperbox">
            <h3>Sicherung in deiner Cloud</h3>
            <CloudFolderPanel />
            <div className="actions static"><button className="btn ghost" onClick={() => setCloudOpen(false)}><span>Schließen</span></button></div>
          </div>
        </div>
      )}
      {tplOpen && (
        <div className="fmodal impmodal">
          <div className="impbox paperbox">
            <h3>Vorlage für dein Berichtsheft</h3>
            <p className="small">Aktuell: {tplInfo}. Wähle eine neue und klick auf „Übernehmen“.</p>
            <TemplateChooser prof={prof} value={tplChoice} onChange={setTplChoice} />
            <div className="actions static">
              <button className="btn" onClick={applyTpl} disabled={busy}><span>Übernehmen</span></button>
              <button className="btn ghost" onClick={() => setTplOpen(false)}><span>Abbrechen</span></button>
              {tplInfo.startsWith("Eigene") && <button className="mini" disabled={busy} onClick={() => act(async () => { await useBundledTemplate(); await refreshTpl(); setTplOpen(false); setMsg("Zurück zur Standard-Vorlage."); })}>Zurück zur Standard-Vorlage</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** PC (ab 0.4.2): Was darf AzuNavi außerhalb des Datenordners anfassen? Hier lässt sich jede Freigabe wieder entziehen (die Ordner und Dateien bleiben unberührt). */
function GrantsPanel() {
  const [g, setG] = useState<GrantsList | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = () => listGrants().then(setG).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);
  const revoke = async (key: string, kind: "root" | "file" | "all-files", path?: string) => {
    if (arm !== key) { setArm(key); window.setTimeout(() => setArm((a) => (a === key ? null : a)), 3000); return; }
    setArm(null); setErr("");
    try { await revokeGrant(kind, path); await load(); } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  };
  if (!g) return err ? <p className="small">{err}</p> : null;
  const none = !g.roots.length && !g.files.length;
  return (
    <>
      <div className="sysrow"><span>Freigegebene Ordner</span><span className="small">{none ? "noch nichts" : `${g.roots.length} Ordner, ${g.files.length} Datei(en)`}</span></div>
      {g.roots.map((r) => (
        <div className="sysrow" key={r.path}><span className="small" style={{ wordBreak: "break-all" }} title={r.path}>{r.name}{r.exists ? "" : " (nicht gefunden)"}<br />{r.path}</span>
          <button className={"mini" + (arm === "r" + r.path ? " hot" : "")} onClick={() => revoke("r" + r.path, "root", r.path)}>{arm === "r" + r.path ? "Wirklich entziehen?" : "Entziehen"}</button></div>
      ))}
      {(g.files.length > 0 || g.undo_dirs > 0) && (
        <div className="sysrow"><span className="small">{g.files.length} verknüpfte Datei(en), {g.undo_dirs} Rückgängig-Ort(e)</span>
          <button className={"mini" + (arm === "files" ? " hot" : "")} onClick={() => revoke("files", "all-files")}>{arm === "files" ? "Wirklich entziehen?" : "Alle entziehen"}</button></div>
      )}
      <p className="small">AzuNavi greift außerhalb des Datenordners nur auf diese Orte zu. Entziehen löscht nichts: Die Ordner und Dateien bleiben, du wählst sie bei Bedarf auf der Dateien-Seite neu aus.</p>
      {err && <p className="small">{err}</p>}
    </>
  );
}

/** Web-App: wo liegen die Daten, und anderen Ort wählen */
function WebDataRow() {
  const [info, setInfo] = useState<{ kind: string | null; name: string }>({ kind: null, name: "" });
  const [arm, setArm] = useState(false);
  useEffect(() => { import("../web/dataStore").then((m) => setInfo(m.locationInfo())); }, []);
  return (
    <div className="sysrow"><span>Datenordner</span><span className="inl">
      <span className="small">{info.kind === "folder" || info.kind === "disk" ? `Ordner „${info.name}“` : "Dieser Browser"}</span>
      <button className="mini" onClick={async () => { const m = await import("../web/dataStore"); await m.forgetLocation(); location.reload(); }}>Wechseln</button>
      {isWebApp && <button className={"mini" + (arm ? " hot" : "")} title="Datenbank, Anhänge und gemerkten Ordner aus diesem Browser entfernen"
        onClick={async () => { if (!arm) { setArm(true); return; } const m = await import("../web/dataStore"); await m.wipeBrowser(); location.reload(); }}>
        {arm ? (info.kind === "folder" ? "Wirklich? (Ordner bleibt)" : "Wirklich? Alles weg!") : "Aus diesem Browser entfernen"}</button>}
    </span></div>
  );
}
