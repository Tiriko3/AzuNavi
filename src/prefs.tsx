// Einstellungen aus „System“ (Etappe 9): Schriftgröße, Animationen, Maskottchen, Tutorial.
// Werden in der Datenbank (settings) gespeichert und gelten sofort für die ganze App.
import { createContext, useContext } from "react";
import { getSetting, setSetting } from "./db/db";

export interface Prefs { font: number; anim: boolean; mascot: boolean; tutorialDone: boolean }
export const DEFAULT_PREFS: Prefs = { font: 1, anim: true, mascot: true, tutorialDone: false };

export async function loadPrefs(): Promise<Prefs> {
  const f = Number(await getSetting("pref_font"));
  return {
    font: [1, 1.15, 1.3].includes(f) ? f : 1,
    anim: (await getSetting("pref_anim")) !== "0",
    mascot: (await getSetting("pref_mascot")) !== "0",
    tutorialDone: (await getSetting("tutorial_done")) === "1",
  };
}
export async function savePrefs(p: Prefs) {
  await setSetting("pref_font", String(p.font));
  await setSetting("pref_anim", p.anim ? "1" : "0");
  await setSetting("pref_mascot", p.mascot ? "1" : "0");
  await setSetting("tutorial_done", p.tutorialDone ? "1" : "0");
}
/** Einstellungen sofort auf die Seite anwenden (Schrift über eine CSS-Variable, Animationen über eine Klasse) */
export function applyPrefs(p: Prefs) {
  const r = document.documentElement;
  r.style.setProperty("--fs", String(p.font));
  r.classList.toggle("no-anim", !p.anim);
  r.classList.toggle("no-mascot", !p.mascot);
}

export interface PrefsCtx { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; openTutorial: () => void }
export const PrefsContext = createContext<PrefsCtx>({ prefs: DEFAULT_PREFS, setPrefs: () => {}, openTutorial: () => {} });
export const usePrefs = () => useContext(PrefsContext);
/** Für Code außerhalb von React (z. B. Animationen): sind Animationen gerade an? */
export const animOn = () => !document.documentElement.classList.contains("no-anim");
export const mascotOn = () => !document.documentElement.classList.contains("no-mascot");
