// Qualifikationen sind pro Nutzer freiwillig: Schalter „quals_enabled“ (Standard: an, damit bestehende Nutzer nichts verlieren).
// Ausgeschaltet heißt: kein Feld in den Notizen, keine Dropdowns im Export, keine Fähigkeiten-Übersicht.
// Bereits vergebene Qualifikationen bleiben in der Datenbank und tauchen wieder auf, wenn man den Schalter einschaltet.
import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../db/db";

export const qualsEnabled = async () => (await getSetting("quals_enabled")) !== "0";
export async function setQualsEnabled(on: boolean) {
  await setSetting("quals_enabled", on ? "1" : "0");
  window.dispatchEvent(new Event("azunavi-quals"));
}
/** true = Qualifikationen werden genutzt. Bis die Einstellung geladen ist: false (damit nichts aufblitzt) */
export function useQualsEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => qualsEnabled().then((v) => alive && setOn(v));
    load();
    window.addEventListener("azunavi-quals", load);
    return () => { alive = false; window.removeEventListener("azunavi-quals", load); };
  }, []);
  return on;
}
