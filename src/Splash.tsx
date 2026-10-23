// Wasser-Übergang beim Seitenwechsel (ab 0.8.0): Splash-Krone, Wellenringe und ein großer Burst, der den Bildschirm füllt und wieder freigibt.
// Das Video liegt auf Schwarz und wird mit „aufhellen“ darübergelegt. Genau wenn der Burst alles bedeckt, wechselt die Seite darunter.
// Ohne Bewegung (Schalter „Animationen aus“) bleibt der alte Übergang mit den drei Balken.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import splashUrl from "./assets/media/water-splash.webm?url";

export interface SplashApi {
  /** Spielt den Übergang. `mid` wird aufgerufen, wenn der Burst alles bedeckt. Gibt false zurück, wenn es keinen Übergang gibt (dann Ersatz nutzen). */
  play: (mid: () => void) => boolean;
}
const RATE = 1.35;       // etwas schneller als im Video, damit man nicht wartet
const MID_MS = 520;      // so lange nach dem Start bedeckt der Burst alles (Quelle: ca. 0,7 s, durch RATE geteilt)

export const Splash = forwardRef<SplashApi, { enabled: boolean }>(function Splash({ enabled }, ref) {
  const v = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  useImperativeHandle(ref, () => ({
    play(mid) {
      const el = v.current;
      if (!enabled || !el) return false;
      el.currentTime = 0; el.playbackRate = RATE; setOn(true);
      let done = false; const go = () => { if (!done) { done = true; mid(); } };
      el.play().then(() => window.setTimeout(go, MID_MS)).catch(() => { setOn(false); go(); });   // klappt das Abspielen nicht, wechselt die Seite trotzdem
      window.setTimeout(go, 1200);                                                                   // Sicherung
      return true;
    },
  }), [enabled]);
  if (!enabled) return null;
  return <video ref={v} className="splashvid" style={{ opacity: on ? 1 : 0 }} src={splashUrl} muted playsInline preload="auto" aria-hidden="true" onEnded={() => setOn(false)} />;
});
