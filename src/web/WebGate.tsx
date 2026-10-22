// Startbildschirm der Web-App: Speicherort wählen, mit Passwort entsperren (Profil) oder ein Profil anlegen, dann startet AzuNavi.
import { useEffect, useState, type ReactNode } from "react";
import {
  activateNewProfile, addBrowser, addFolder, canPickFolder, clearSessionLocked, currentLocationId, deviceName, finishMigration, getAutoLock, holdLock, lockNow,
  markDeclined, otherLock, readProfile, recoverWithKey, rememberDevice, removeLocation, requestSetup, resumeLocation, savedLocations, sessionLocked,
  setSecure, setupRequested, unlockRemembered, unlockWithPassword, type SavedLocation,
} from "./dataStore";
import { MIN_PASSWORD, createProfile, passwordProblem, type ProfileFile } from "./vault";
import namiImg from "../assets/figuren/nami_gruss.webp";
import { DOWNLOAD_URL } from "./downloadUrl";

type Step = "laden" | "liste" | "wahl" | "entsperren" | "wiederherstellen" | "angebot" | "einrichten" | "schluessel" | "migration" | "sperre" | "bereit";
const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error:\s*/, "");

/** Sperrt nach der eingestellten Zeit ohne Eingabe (System → Passwortschutz). Aus, solange 0 Minuten gewählt sind. */
function AutoLock() {
  useEffect(() => {
    let min = 0, timer: number | undefined;
    const reset = () => { window.clearTimeout(timer); if (min > 0) timer = window.setTimeout(() => { void lockNow(); }, min * 60_000); };
    const load = () => { getAutoLock().then((m) => { min = m; reset(); }).catch(() => {}); };
    load();
    const ev = ["pointerdown", "keydown", "wheel", "touchstart"];
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    window.addEventListener("azunavi-autolock", load);
    return () => { window.clearTimeout(timer); ev.forEach((e) => window.removeEventListener(e, reset)); window.removeEventListener("azunavi-autolock", load); };
  }, []);
  return null;
}

export function WebGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("laden");
  const [locs, setLocs] = useState<SavedLocation[]>([]);
  const [profile, setProfile] = useState<ProfileFile | null>(null);
  const [lock, setLock] = useState<{ device: string; ts: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [save, setSave] = useState<{ state: string; detail: string }>({ state: "gespeichert", detail: "" });
  // Formulare
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [name, setName] = useState("");
  const [recKey, setRecKey] = useState(""), [remember, setRemember] = useState(false), [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<{ profile: ProfileFile; recoveryKey: string; raw: Uint8Array } | null>(null);

  const clearForm = () => { setPw(""); setPw2(""); setRecKey(""); setSaved(false); setErr(""); };
  /** Läuft jemand anderes im selben Ordner? Sonst los. */
  const enter = async () => {
    const other = await otherLock();
    if (other) { setLock(other); setStep("sperre"); return; }
    holdLock(); clearForm(); setStep("bereit");
  };
  /** Nach dem Entsperren: angefangene Übernahme alter Daten beenden */
  const unlocked = async (p: ProfileFile) => {
    clearSessionLocked();
    if (p.legacy) {
      setStep("migration");
      try { await finishMigration(); } catch (e) { setErr(msg(e)); setStep("entsperren"); return; }
    }
    await enter();
  };
  const afterOpen = async (locId: string) => {
    setErr("");
    let p: ProfileFile | null = null;
    try { p = await readProfile(); } catch (e) { setErr(msg(e)); setStep("liste"); return; }
    setProfile(p); setSecure(p, null);
    if (p) {
      if (!sessionLocked() && await unlockRemembered(p)) { await unlocked(p); return; }
      clearForm(); setStep("entsperren"); return;
    }
    const cur = (await savedLocations()).find((l) => l.id === locId);
    if (setupRequested()) { clearForm(); setStep("einrichten"); return; }
    if (!cur?.declined) { setStep("angebot"); return; }
    await enter();
  };
  const open = async (id: string | null) => {
    setErr(""); if (!id) return;
    if (await resumeLocation(id)) await afterOpen(id);
    else setErr("Ohne Zugriff auf den Ordner geht es nicht. Bitte erlauben oder einen anderen Ordner wählen.");
  };

  useEffect(() => {
    (async () => {
      const list = await savedLocations(); setLocs(list);
      if (!list.length) { setStep("wahl"); return; }
      const cur = await currentLocationId(); const c = list.find((l) => l.id === cur);
      if (c && !c.needsPermission && await resumeLocation(c.id)) { await afterOpen(c.id); return; }
      setStep("liste");
    })().catch((e) => { setErr(msg(e)); setStep("wahl"); });
    const onSave = (e: Event) => setSave((e as CustomEvent).detail);
    window.addEventListener("azunavi-save", onSave);
    return () => window.removeEventListener("azunavi-save", onSave);
  }, []);

  if (step === "bereit") return <>{children}{profile && <AutoLock />}<div className={"websave " + save.state} title={save.detail || "Alles ist im Datenordner gespeichert"}>{save.state === "speichert" ? "Speichert …" : save.state === "fehler" ? "⚠ Nicht gespeichert" : "✓ Gespeichert"}</div></>;

  const run = (label: string, f: () => Promise<void>) => async () => { setErr(""); setBusy(label); try { await f(); } catch (e) { setErr(msg(e)); } finally { setBusy(""); } };
  const pickFolder = run("", async () => { const id = await addFolder(); if (id) await open(id); });
  const pickBrowser = run("", async () => { await open(await addBrowser()); });
  const goList = async () => { const l = await savedLocations(); setLocs(l); setErr(""); setStep(l.length ? "liste" : "wahl"); };

  const doUnlock = run("Passwort wird geprüft …", async () => {
    if (!profile) return;
    await unlockWithPassword(profile, pw); if (remember) await rememberDevice(true);
    await unlocked(profile);
  });
  const doRecover = run("Schlüssel wird geprüft …", async () => {
    if (!profile) return;
    if (pw !== pw2) throw new Error("Die beiden neuen Passwörter sind nicht gleich.");
    const bad = passwordProblem(pw); if (bad) throw new Error(bad);
    await recoverWithKey(profile, recKey, pw); if (remember) await rememberDevice(true);
    await unlocked(profile);
  });
  const doCreate = run("Profil wird erstellt …", async () => {
    if (pw !== pw2) throw new Error("Die beiden Passwörter sind nicht gleich.");
    const made = await createProfile(name, pw);   // schreibt noch nichts
    setPending(made); setSaved(false); setStep("schluessel");
  });
  const doActivate = run("Daten werden verschlüsselt …", async () => {
    if (!pending) return;
    await activateNewProfile(pending.profile, pending.raw);
    if (remember) await rememberDevice(true);
    setProfile(pending.profile); setPending(null); requestSetup(false);
    await enter();
  });
  const keyAsFile = () => {
    if (!pending) return;
    const text = `AzuNavi – Wiederherstellungsschlüssel\nProfil: ${pending.profile.name}\nErstellt: ${new Date().toLocaleDateString("de-DE")}\n\n${pending.recoveryKey}\n\nAufbewahren wie ein Passwort, NICHT im Datenordner. Wer diesen Schlüssel hat, kommt an die Daten.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "AzuNavi-Wiederherstellungsschluessel.txt"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const field = (label: string, value: string, set: (v: string) => void, type = "text", auto = "off") =>
    <label className="wg-field"><span>{label}</span><input type={type} value={value} autoComplete={auto} spellCheck={false} onChange={(e) => set(e.target.value)} /></label>;
  const rememberBox = <label className="wg-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Auf diesem Gerät angemeldet bleiben. Nur auf deinem eigenen Gerät, <b>nicht</b> an PCs, die auch andere benutzen.</span></label>;

  return (
    <div className="webgate">
      <div className="wg-card">
        <img className="wg-nami" src={namiImg} alt="" />
        <h1>AzuNavi<small>Web-App</small></h1>
        {step === "laden" && <p>Einen Moment …</p>}

        {step === "liste" && <>
          <p>{locs.length > 1 ? "Willkommen zurück! Wer arbeitet gerade?" : "Willkommen zurück!"}</p>
          {locs.map((l) => <div key={l.id}>
            <button className="wg-btn sec wg-loc" onClick={() => open(l.id)}>{l.profileName || (l.kind === "folder" ? `Ordner „${l.name}“` : "Dieser Browser")}<small>{l.kind === "folder" ? `Ordner „${l.name}“` : "Gespeichert in diesem Browser"}</small></button>
            <button className="wg-link" onClick={async () => { await removeLocation(l.id); const n = await savedLocations(); setLocs(n); if (!n.length) setStep("wahl"); }}>Aus der Liste nehmen (Daten bleiben)</button>
          </div>)}
          <p className="wg-small">Bei Ordnern fragt der Browser aus Sicherheitsgründen einmal nach, ob AzuNavi den Ordner bearbeiten darf.</p>
          <button className="wg-link" onClick={() => { setErr(""); setStep("wahl"); }}>Anderen Speicherort hinzufügen</button>
        </>}

        {step === "wahl" && <>
          <p>Wo sollen deine Daten liegen? Sie bleiben bei dir. AzuNavi hat keinen Server und keine Konten.</p>
          {canPickFolder ? <>
            <button className="wg-btn" onClick={pickFolder}>Datenordner wählen <span>empfohlen</span></button>
            <p className="wg-small">Zum Beispiel <b>OneDrive\AzuNavi</b>. Dann sind deine Daten automatisch in deiner Cloud, und du kannst auf jedem PC weitermachen, auf dem du denselben Ordner öffnest. Im Ordner liegen deine Datenbank (<code>azunavi.db</code>) und deine Anhänge.</p>
          </> : <p className="wg-small">Dieser Browser kann keine Ordner öffnen (das geht in Chrome und Edge am PC). Du kannst trotzdem loslegen:</p>}
          <button className={canPickFolder ? "wg-btn sec" : "wg-btn"} onClick={pickBrowser}>Nur in diesem Browser speichern</button>
          <p className="wg-small">Gut fürs eigene Handy oder zum Ausprobieren. Deine Daten bleiben in diesem Browser. Zum Übertragen nutzt du System → „Daten mitnehmen“. <b>Nicht auf PCs, die auch andere benutzen</b> (Schule, Schulungsraum).</p>
          {locs.length > 0 && <button className="wg-link" onClick={goList}>Zurück zur Liste</button>}
        </>}

        {step === "angebot" && <>
          <p><b>Möchtest du deine Daten mit einem Passwort schützen?</b></p>
          <p className="wg-small">Datenbank und Anhänge werden dann verschlüsselt. Ohne dein Passwort kommt niemand an die Inhalte, auch nicht mit Zugriff auf den Ordner oder die Cloud. Es gibt <b>kein Konto und keinen Reset durch andere</b>: Du bekommst einen Wiederherstellungsschlüssel, den du sicher aufbewahrst. Deine bisherigen Daten werden automatisch übernommen.</p>
          <button className="wg-btn" onClick={() => { clearForm(); setStep("einrichten"); }}>Mit Passwort schützen <span>empfohlen</span></button>
          <button className="wg-btn sec" onClick={async () => { await markDeclined(); await enter(); }}>Ohne Passwort weiterarbeiten</button>
          <p className="wg-small">Du kannst den Schutz später jederzeit in den Einstellungen einschalten (Passwortschutz).</p>
        </>}

        {step === "einrichten" && <>
          <p><b>Profil mit Passwort anlegen</b></p>
          {field("Name des Profils (z. B. dein Vorname)", name, setName, "text", "off")}
          {field(`Passwort (mindestens ${MIN_PASSWORD} Zeichen)`, pw, setPw, "password", "new-password")}
          {field("Passwort wiederholen", pw2, setPw2, "password", "new-password")}
          <p className="wg-small">Tipp: ein ganzer Satz oder drei bis vier Wörter sind sicherer und leichter zu merken als ein kurzes Passwort mit Sonderzeichen. Das Passwort wird nirgends gespeichert.</p>
          <button className="wg-btn" disabled={!!busy || !name.trim() || !pw || !pw2} onClick={doCreate}>{busy || "Weiter"}</button>
          <button className="wg-link" onClick={() => { if (setupRequested()) { requestSetup(false); void enter(); } else setStep("angebot"); }}>Abbrechen</button>
        </>}

        {step === "schluessel" && pending && <>
          <p><b>Dein Wiederherstellungsschlüssel</b></p>
          <div className="wg-key">{pending.recoveryKey}</div>
          <div className="wg-row"><button className="wg-btn sec wg-half" onClick={() => navigator.clipboard?.writeText(pending.recoveryKey).catch(() => {})}>Kopieren</button><button className="wg-btn sec wg-half" onClick={keyAsFile}>Als Datei speichern</button></div>
          <p className="wg-warn">Das ist die <b>einzige Möglichkeit</b>, wenn du dein Passwort vergisst. Es gibt keinen Reset durch andere. Gehen Passwort <b>und</b> Schlüssel verloren, sind die Daten für immer weg. Bewahre ihn getrennt von den Daten auf (Passwort-Manager oder ausgedruckt), <b>nicht im Datenordner</b>.</p>
          <label className="wg-check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>Ich habe den Schlüssel sicher aufbewahrt.</span></label>
          {rememberBox}
          <button className="wg-btn" disabled={!saved || !!busy} onClick={doActivate}>{busy || "Profil anlegen und Daten verschlüsseln"}</button>
          <button className="wg-link" disabled={!!busy} onClick={() => { setPending(null); setStep("einrichten"); }}>Zurück</button>
        </>}

        {step === "entsperren" && profile && <>
          <p>Profil <b>„{profile.name}“</b> ist durch ein Passwort geschützt.</p>
          <form onSubmit={(e) => { e.preventDefault(); void doUnlock(); }}>
            {field("Passwort", pw, setPw, "password", "current-password")}
            {rememberBox}
            <button className="wg-btn" type="submit" disabled={!!busy || !pw}>{busy || "Entsperren"}</button>
          </form>
          <button className="wg-link" onClick={() => { clearForm(); setStep("wiederherstellen"); }}>Passwort vergessen? Mit Wiederherstellungsschlüssel öffnen</button>
          <button className="wg-link" onClick={goList}>Anderen Speicherort oder anderes Profil wählen</button>
        </>}

        {step === "wiederherstellen" && profile && <>
          <p><b>Mit Wiederherstellungsschlüssel öffnen</b></p>
          {field("Wiederherstellungsschlüssel (8 Gruppen zu je 4 Zeichen)", recKey, setRecKey, "text", "off")}
          {field(`Neues Passwort (mindestens ${MIN_PASSWORD} Zeichen)`, pw, setPw, "password", "new-password")}
          {field("Neues Passwort wiederholen", pw2, setPw2, "password", "new-password")}
          {rememberBox}
          <button className="wg-btn" disabled={!!busy || !recKey || !pw || !pw2} onClick={doRecover}>{busy || "Öffnen und Passwort ändern"}</button>
          <button className="wg-link" onClick={() => { clearForm(); setStep("entsperren"); }}>Zurück</button>
        </>}

        {step === "migration" && <><p>Deine bisherigen Daten werden verschlüsselt …</p><p className="wg-small">Das dauert nur einen Moment. Bitte das Fenster nicht schließen.</p></>}

        {step === "sperre" && lock && <>
          <p className="wg-warn">Dieser Datenordner ist gerade auf einem anderen Gerät geöffnet: <b>{lock.device}</b> (zuletzt aktiv vor {Math.max(1, Math.round((Date.now() - lock.ts) / 60000))} Min.).</p>
          <p className="wg-small">Wenn ihr gleichzeitig arbeitet, überschreibt das zuletzt gespeicherte Gerät die Änderungen des anderen. Schließ AzuNavi dort am besten zuerst.</p>
          <button className="wg-btn" onClick={() => { holdLock(); setStep("bereit"); }}>Trotzdem öffnen</button>
          <button className="wg-link" onClick={() => location.reload()}>Erneut prüfen</button>
        </>}

        {err && <p className="wg-warn">{err}</p>}
        {DOWNLOAD_URL && <a className="wg-link wg-dl" href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Handy-App (Android) herunterladen</a>}
        <p className="wg-foot">Dieses Gerät: {deviceName()}</p>
      </div>
    </div>
  );
}
