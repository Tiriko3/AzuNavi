// Startbildschirm der Web-App: Datenordner wählen (oder im Browser speichern), dann startet AzuNavi.
import { useEffect, useState, type ReactNode } from "react";
import { canPickFolder, chooseFolder, deviceName, holdLock, otherLock, resumeSaved, savedLocation, useBrowserStorage, type SavedLocation } from "./dataStore";
import namiImg from "../assets/figuren/nami_gruss.webp";

type Step = "laden" | "wahl" | "weiter" | "sperre" | "bereit";

export function WebGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("laden");
  const [saved, setSaved] = useState<SavedLocation | null>(null);
  const [lock, setLock] = useState<{ device: string; ts: number } | null>(null);
  const [err, setErr] = useState("");
  const [save, setSave] = useState<{ state: string; detail: string }>({ state: "gespeichert", detail: "" });

  const afterOpen = async () => {
    const other = await otherLock();
    if (other) { setLock(other); setStep("sperre"); return; }
    holdLock(); setStep("bereit");
  };
  useEffect(() => {
    (async () => {
      const s = await savedLocation(); setSaved(s);
      if (!s) { setStep("wahl"); return; }
      if (!s.needsPermission && await resumeSaved()) { await afterOpen(); return; }
      setStep("weiter");
    })().catch((e) => { setErr(String(e)); setStep("wahl"); });
    const onSave = (e: Event) => setSave((e as CustomEvent).detail);
    window.addEventListener("azunavi-save", onSave);
    return () => window.removeEventListener("azunavi-save", onSave);
  }, []);

  if (step === "bereit") return <>{children}<div className={"websave " + save.state} title={save.detail || "Alles ist im Datenordner gespeichert"}>{save.state === "speichert" ? "Speichert …" : save.state === "fehler" ? "⚠ Nicht gespeichert" : "✓ Gespeichert"}</div></>;

  const folder = async () => { setErr(""); if (await chooseFolder()) await afterOpen(); };
  const browser = async () => { setErr(""); await useBrowserStorage(); await afterOpen(); };
  const resume = async () => { setErr(""); if (await resumeSaved()) await afterOpen(); else setErr("Ohne Zugriff auf den Ordner geht es nicht. Bitte erlauben oder einen anderen Ordner wählen."); };

  return (
    <div className="webgate">
      <div className="wg-card">
        <img className="wg-nami" src={namiImg} alt="" />
        <h1>AzuNavi<small>Web-App</small></h1>
        {step === "laden" && <p>Einen Moment …</p>}
        {step === "weiter" && saved && <>
          <p>Willkommen zurück! Deine Daten liegen im Ordner <b>„{saved.name}“</b>.</p>
          <button className="wg-btn" onClick={resume}>Weiter mit „{saved.name}“</button>
          <p className="wg-small">Der Browser fragt aus Sicherheitsgründen einmal nach, ob AzuNavi den Ordner bearbeiten darf.</p>
          <button className="wg-link" onClick={() => setStep("wahl")}>Anderen Speicherort wählen</button>
        </>}
        {step === "wahl" && <>
          <p>Wo sollen deine Daten liegen? Sie bleiben bei dir. AzuNavi hat keinen Server und keine Konten.</p>
          {canPickFolder ? <>
            <button className="wg-btn" onClick={folder}>Datenordner wählen <span>empfohlen</span></button>
            <p className="wg-small">Zum Beispiel <b>OneDrive\AzuNavi</b>. Dann sind deine Daten automatisch in deiner Cloud, und du kannst auf jedem PC weitermachen, auf dem du denselben Ordner öffnest. Im Ordner liegen deine Datenbank (<code>azunavi.db</code>) und deine Anhänge.</p>
          </> : <p className="wg-small">Dieser Browser kann keine Ordner öffnen (das geht in Chrome und Edge am PC). Du kannst trotzdem loslegen:</p>}
          <button className={canPickFolder ? "wg-btn sec" : "wg-btn"} onClick={browser}>Nur in diesem Browser speichern</button>
          <p className="wg-small">Gut fürs eigene Handy oder zum Ausprobieren. Deine Daten bleiben in diesem Browser. Zum Übertragen nutzt du System → „Daten mitnehmen“. <b>Nicht auf PCs, die auch andere benutzen</b> (Schule, Schulungsraum).</p>
        </>}
        {step === "sperre" && lock && <>
          <p className="wg-warn">Dieser Datenordner ist gerade auf einem anderen Gerät geöffnet: <b>{lock.device}</b> (zuletzt aktiv vor {Math.max(1, Math.round((Date.now() - lock.ts) / 60000))} Min.).</p>
          <p className="wg-small">Wenn ihr gleichzeitig arbeitet, überschreibt das zuletzt gespeicherte Gerät die Änderungen des anderen. Schließ AzuNavi dort am besten zuerst.</p>
          <button className="wg-btn" onClick={() => { holdLock(); setStep("bereit"); }}>Trotzdem öffnen</button>
          <button className="wg-link" onClick={() => location.reload()}>Erneut prüfen</button>
        </>}
        {err && <p className="wg-warn">{err}</p>}
        <p className="wg-foot">Dieses Gerät: {deviceName()}</p>
      </div>
    </div>
  );
}
