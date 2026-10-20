// Anzeige (System → Darstellung): Fenster, randlos oder Vollbild; Fenstergröße frei oder per Schnellwahl
import { getSetting, inTauri, setSetting } from "./db/db";
import { noDesktop } from "./platform";

export type DisplayMode = "fenster" | "randlos" | "vollbild";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function getDisplayMode(): Promise<DisplayMode> {
  const m = await getSetting("pref_display");
  return m === "randlos" || m === "fenster" ? m : "vollbild"; // Standard: Vollbild
}

export async function applyDisplay(mode: DisplayMode) {
  await setSetting("pref_display", mode);
  window.dispatchEvent(new CustomEvent("azunavi-display", { detail: mode })); // der Beenden-Knopf blendet sich je nach Modus ein/aus
  if (!inTauri || noDesktop) return;   // Handy: die App läuft immer bildschirmfüllend
  const w = await win();
  if (mode === "vollbild") {
    await w.setDecorations(true);
    await w.setFullscreen(true);
  } else if (mode === "randlos") {
    await w.setFullscreen(false);
    await w.setDecorations(false);
    await w.maximize();
  } else {
    await w.setFullscreen(false);
    await w.setDecorations(true);
    await w.unmaximize();
  }
}

/** Fenstergröße für den Fenstermodus (der Inhalt skaliert immer mit) */
export async function setWindowSize(width: number, height: number) {
  if (noDesktop) return;
  if (!inTauri) return;
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  const w = await win();
  await applyDisplay("fenster");
  await w.setSize(new LogicalSize(width, height));
  await w.center();
}

/** F11: zwischen Vollbild und Fenster wechseln */
export async function toggleFullscreen(): Promise<DisplayMode> {
  if (noDesktop) return "vollbild";
  const next: DisplayMode = (await getDisplayMode()) === "vollbild" ? "fenster" : "vollbild";
  await applyDisplay(next);
  return next;
}

/** Programm beenden (Knopf oben rechts im Vollbild) */
export async function quitApp() {
  if (!inTauri || noDesktop) return;
  const w = await win();
  await w.close();
}
