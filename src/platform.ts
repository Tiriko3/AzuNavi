// Plattform: Handy (Android/iOS) oder PC. Auf dem Handy gibt es kein Fenster, keine echten Ordner und kein Java.
export const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Läuft im Tauri-Fenster (PC-Programm oder Android-App) */
export const inTauriApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Echte Web-App (Build mit „npm run build:web“), nicht der Entwicklungs-Testmodus im Browser */
export const isWebApp = !inTauriApp && import.meta.env.VITE_AZ_WEB === "1";
/** PC-Programm (Windows-Fenster), nicht die Android-App */
export const isDesktopApp = inTauriApp && !isMobile;
/** Handy-App (Android/iOS im Tauri-Fenster) */
export const isMobileApp = inTauriApp && isMobile;
/** Datenordner und Profile: Web-App, PC-Programm (ab 0.4.0) und Handy-App (ab 0.5.0) benutzen denselben Aufbau (azunavi.db, dateien/, profil.json). */
export const usesDataFolder = isWebApp || isDesktopApp || isMobileApp;
/** Kein PC-Programm: Handy-App oder Web-App. Dort gibt es kein Fenster, kein Java und keine freien Pfade. */
export const noDesktop = isMobile || isWebApp;

/** Der Browser kann Ordner freigeben (Chrome, Edge, Opera am PC): Voraussetzung für die Dateien-Seite in der Web-App */
export const canUseFolders = typeof window !== "undefined" && ("showDirectoryPicker" in window || !!navigator.storage?.getDirectory) && !isMobile;
/** Echte PC-Ordner freigeben geht nur in Chrome/Edge. Sonst benutzt die Dateien-Seite einen eigenen Ordner im Browser (Firefox, Safari). */
export const hasRealFolders = typeof window !== "undefined" && "showDirectoryPicker" in window;
