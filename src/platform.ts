// Plattform: Handy (Android/iOS) oder PC. Auf dem Handy gibt es kein Fenster, keine echten Ordner und kein Java.
export const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
