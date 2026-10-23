// Darf sich etwas bewegen? (Wasser-Video, Startbildschirm, Intro)
// Entscheidend ist nur der Schalter „Animationen“ (System). Die Windows-Einstellung „Animationen reduzieren“ wird NUR beachtet, wenn man das unter System
// ausdrücklich einschaltet (ab 0.7.2). Vorher haben Rechner mit abgeschalteten Windows-Effekten (z. B. virtuelle Maschinen) nur ein Standbild gezeigt.
import { useEffect, type RefObject } from "react";

const osReduce = () => { try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/** Vor der Datenbank (Startbildschirm, Intro): liest die gespiegelten Einstellungen aus dem lokalen Speicher */
export function motionOk(): boolean {
  try {
    if (localStorage.getItem("azunavi.anim") === "0") return false;
    if (localStorage.getItem("azunavi.respectos") === "1" && osReduce()) return false;
    return true;
  } catch { return true; }
}
/** Im Programm: direkt aus den Einstellungen */
export const motionFromPrefs = (p: { anim: boolean; respectOs: boolean }) => p.anim && !(p.respectOs && osReduce());
export const osReducesMotion = osReduce;

/** Hält ein Video am Laufen: pausiert, wenn das Fenster unsichtbar ist, startet neu, wenn es von allein stehen bleibt (z. B. weil das Springen zurück zum Anfang scheitert). */
export function useKeepPlaying(ref: RefObject<HTMLVideoElement | null>, on = true) {
  useEffect(() => {
    const v = ref.current; if (!v || !on) return;
    let last = -1, still = 0;
    const kick = () => { if (!document.hidden) v.play().catch(() => {}); };
    const vis = () => { if (document.hidden) v.pause(); else kick(); };
    const timer = window.setInterval(() => {
      if (document.hidden) { still = 0; return; }
      if (v.paused || v.ended) kick();
      still = Math.abs(v.currentTime - last) < 0.01 ? still + 1 : 0;
      last = v.currentTime;
      if (still >= 3) { still = 0; v.load(); kick(); }   // steht seit mehreren Prüfungen: neu laden
    }, 1500);
    document.addEventListener("visibilitychange", vis);
    v.addEventListener("ended", kick); v.addEventListener("canplay", kick);
    kick();
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", vis); v.removeEventListener("ended", kick); v.removeEventListener("canplay", kick); };
  }, [ref, on]);
}
