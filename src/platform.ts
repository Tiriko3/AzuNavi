// Plattform: Handy (Android/iOS) oder PC. Auf dem Handy gibt es kein Fenster, keine echten Ordner und kein Java.
export const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Läuft im Tauri-Fenster (PC-Programm oder Android-App) */
export const inTauriApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Echte Web-App (Build mit „npm run build:web“), nicht der Entwicklungs-Testmodus im Browser */
export const isWebApp = !inTauriApp && import.meta.env.VITE_AZ_WEB === "1";
/** Kein PC-Programm: Handy-App oder Web-App. Dort gibt es kein Fenster, kein Java und keine freien Pfade. */
export const noDesktop = isMobile || isWebApp;

/** Der Browser kann Ordner freigeben (Chrome, Edge, Opera am PC): Voraussetzung für die Dateien-Seite in der Web-App */
export const canUseFolders = typeof window !== "undefined" && "showDirectoryPicker" in window && !isMobile;
