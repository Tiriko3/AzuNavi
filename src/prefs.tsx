// Einstellungen aus „System“ (Etappe 9): Schriftgröße, Animationen, Maskottchen, Tutorial.
// Werden in der Datenbank (settings) gespeichert und gelten sofort für die ganze App.
import { createContext, useContext } from "react";
import { getSetting, setSetting } from "./db/db";
import type { NightMode } from "./night";
import { osReducesMotion } from "./web/motion";

export interface Prefs { font: number; anim: boolean; mascot: boolean; tutorialDone: boolean; night: NightMode; respectOs: boolean }
export const DEFAULT_PREFS: Prefs = { font: 1, anim: true, mascot: true, tutorialDone: false, night: "auto", respectOs: false };

export async function loadPrefs(): Promise<Prefs> {
  const f = Number(await getSetting("pref_font"));
  return {
    font: [1, 1.15, 1.3].includes(f) ? f : 1,
    anim: (await getSetting("pref_anim")) !== "0",
    mascot: (await getSetting("pref_mascot")) !== "0",
    tutorialDone: (await getSetting("tutorial_done")) === "1",
    respectOs: (await getSetting("pref_respect_os")) === "1",
    night: ((v) => (v === "an" || v === "aus" ? v : "auto") as NightMode)(await getSetting("pref_night")),
  };
}
export async function savePrefs(p: Prefs) {
  await setSetting("pref_font", String(p.font));
  await setSetting("pref_anim", p.anim ? "1" : "0");
  await setSetting("pref_mascot", p.mascot ? "1" : "0");
  await setSetting("tutorial_done", p.tutorialDone ? "1" : "0");
  await setSetting("pref_night", p.night);
  await setSetting("pref_respect_os", p.respectOs ? "1" : "0");
}
/** Einstellungen sofort auf die Seite anwenden (Schrift über eine CSS-Variable, Animationen über eine Klasse) */
export function applyPrefs(p: Prefs) {
  const r = document.documentElement;
  r.style.setProperty("--fs", String(p.font));
  r.classList.toggle("no-anim", !p.anim);
  try { localStorage.setItem("azunavi.anim", p.anim ? "1" : "0"); } catch { /* egal */ }   // der Startbildschirm (vor der Datenbank) liest das
  r.classList.toggle("no-mascot", !p.mascot);
  try { localStorage.setItem("azunavi.respectos", p.respectOs ? "1" : "0"); } catch { /* egal */ }
  r.classList.toggle("reduce-motion", p.respectOs && osReducesMotion());   // nur auf Wunsch: Windows-Einstellung „Animationen reduzieren“ beachten
}

export interface PrefsCtx { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; openTutorial: () => void }
export const PrefsContext = createContext<PrefsCtx>({ prefs: DEFAULT_PREFS, setPrefs: () => {}, openTutorial: () => {} });
export const usePrefs = () => useContext(PrefsContext);
/** Für Code außerhalb von React (z. B. Animationen): sind Animationen gerade an? */
export const animOn = () => !document.documentElement.classList.contains("no-anim");
export const mascotOn = () => !document.documentElement.classList.contains("no-mascot");
