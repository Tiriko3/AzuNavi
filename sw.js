// AzuNavi Web-App: offline nutzbar. Seite: erst Netz, sonst Zwischenspeicher. Dateien: erst Zwischenspeicher, sonst Netz.
// Deine Daten liegen NICHT hier, sondern in deinem Datenordner. Hier liegt nur die App selbst.
const V = new URL(self.location).searchParams.get("v") || "0";
const CACHE = "azunavi-app-" + V;
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icons/icon-192.png"]))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("azunavi-app-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put("./", cp)); return res; }).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)); }
    return res;
  })));
});
