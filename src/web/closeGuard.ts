// PC-Programm: Beim Schließen des Fensters (X, Alt+F4, Beenden-Knopf) zuerst alles speichern und die eigene Sperre freigeben.
// Ohne das könnten die Änderungen der letzten Sekunden verloren gehen, weil die Datenbank verzögert (kurz nach der Änderung) geschrieben wird.
// Schlägt das Speichern fehl, bleibt das Fenster offen (der Hinweis „Nicht gespeichert“ steht dann unten). Ein zweites Schließen beendet trotzdem.
import { flushAll, releaseLock } from "./dataStore";

let installed = false;
export async function installCloseGuard(): Promise<void> {
  if (installed) return;
  installed = true;
  let failed = false, armed = false;
  window.addEventListener("azunavi-save", (e) => { failed = (e as CustomEvent).detail?.state === "fehler"; });
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.onCloseRequested(async (e) => {
    e.preventDefault();
    try { await Promise.race([flushAll(), new Promise<void>((r) => setTimeout(r, 10_000))]); } catch { failed = true; }
    if (failed && !armed) { armed = true; setTimeout(() => { armed = false; }, 15_000); return; }   // erster Versuch: offen lassen, Hinweis ist sichtbar
    await releaseLock();
    await w.destroy();
  });
}
