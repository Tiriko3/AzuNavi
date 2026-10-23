// Startbildschirm-Hintergrund und Intro (ab 0.4.2). Die Videos sind kleine WebM-Dateien ohne Ton (src/assets/media).
//  - GateBackground: ruhiges Wasser hinter der Startkarte (Schleife), pausiert, wenn das Fenster nicht sichtbar ist.
//  - Intro: kurzer Übergang ins Programm, einmal pro Start, mit Klick oder Taste überspringbar.
// Beides entfällt (Standbild bzw. nichts), wenn „Animationen“ aus ist oder das Betriebssystem reduzierte Bewegung wünscht.
import { useEffect, useRef, useState } from "react";
import { motionOk, useKeepPlaying } from "./motion";
export { motionOk };
import bgUrl from "../assets/media/azunavi-bg.webm?url";
import posterUrl from "../assets/media/azunavi-bg-poster.webp?url";
import introUrl from "../assets/media/azunavi-intro.webm?url";

export function GateBackground() {
  const [motion] = useState(motionOk);
  const ref = useRef<HTMLVideoElement>(null);
  useKeepPlaying(ref, motion);
  return (
    <div className="wg-bg" aria-hidden="true">
      {motion
        ? <video ref={ref} className="wg-bgmedia" src={bgUrl} poster={posterUrl} autoPlay muted loop playsInline preload="auto" />
        : <img className="wg-bgmedia" src={posterUrl} alt="" />}
      <div className="wg-bgshade" />
    </div>
  );
}

export function Intro() {
  const [on, setOn] = useState(() => { try { return motionOk() && sessionStorage.getItem("az-intro") !== "1"; } catch { return false; } });
  const [out, setOut] = useState(false);
  const closing = useRef(false);
  const ref = useRef<HTMLVideoElement>(null);
  const done = () => {
    if (closing.current) return;
    closing.current = true; setOut(true); window.setTimeout(() => setOn(false), 650);
  };
  useEffect(() => {
    if (!on) return;
    try { sessionStorage.setItem("az-intro", "1"); } catch { /* egal */ }
    ref.current?.play().catch(done);
    const safety = window.setTimeout(done, 8000);   // falls das Video hängt
    const key = () => done();
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(safety); window.removeEventListener("keydown", key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  if (!on) return null;
  return (
    <div className={"intro" + (out ? " out" : "")} onClick={done} role="presentation" title="Klicken zum Überspringen">
      <video ref={ref} src={introUrl} muted playsInline autoPlay preload="auto" onEnded={done} onError={done} />
    </div>
  );
}
