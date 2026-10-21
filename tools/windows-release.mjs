#!/usr/bin/env node
// Windows-Programm bauen und auf die Download-Seite (Release) von git.hhu.de stellen.
// Aufruf (PowerShell, im Projektordner):
//   $env:GITLAB_TOKEN = "glpat-..."        # einmalig pro Fenster, siehe docs/GITLAB-UMZUG.md
//   npm run release:windows                 # baut, lädt hoch und hängt die Dateien an das Release
//   npm run release:windows -- --no-build   # ohne Bauen (Dateien liegen schon da)
// Voraussetzung: Der Tag der Version (z. B. v0.1.2) ist schon auf GitLab gesetzt.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE = (process.env.GITLAB_URL || "https://git.hhu.de").replace(/\/+$/, "");
const PROJECT = process.env.GITLAB_PROJECT || "qov83dor/AzuNavi";
const TOKEN = process.env.GITLAB_TOKEN || "";
const args = new Set(process.argv.slice(2));
const root = process.cwd();
const exe = process.platform === "win32" ? ".exe" : "";

const fail = (msg) => { console.error("\nFEHLER: " + msg); process.exit(1); };
const say = (msg) => console.log(msg);

if (args.has("--help") || args.has("-h")) {
  say("Windows-Programm bauen und auf die Download-Seite stellen.\nVorher: $env:GITLAB_TOKEN = \"glpat-...\"\nDann:   npm run release:windows\nOptionen: --no-build (nicht neu bauen)");
  process.exit(0);
}
if (!TOKEN) fail('Kein Zugangs-Token gefunden. Setze ihn zuerst (nur für dieses PowerShell-Fenster):\n  $env:GITLAB_TOKEN = "glpat-..."\nSo erzeugst du ihn: git.hhu.de -> Profilbild -> Preferences -> Access tokens, Haken bei "api".');

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = "v" + version;
say(`AzuNavi ${version}: Windows-Programm für ${BASE}/${PROJECT}`);

/* ---------- 1) Bauen ---------- */
if (!args.has("--no-build")) {
  if (process.platform === "win32") {
    const cli = path.join(root, "node_modules", "@tauri-apps", "cli-win32-x64-msvc", "cli.win32-x64-msvc.node");
    if (fs.existsSync(cli) && fs.statSync(cli).size < 5_000_000) {
      fail("Das Tauri-Werkzeug ist beschädigt (die Datei ist zu klein, Virenscanner oder Downloadfehler).\nLösung: Remove-Item node_modules -Recurse -Force; npm cache clean --force; npm ci");
    }
  }
  say("\nBaue das Windows-Programm (das dauert beim ersten Mal einige Minuten) …");
  const r = spawnSync("npm run tauri build", { stdio: "inherit", shell: true, cwd: root });
  if (r.status !== 0) fail("Der Bau ist fehlgeschlagen. Die Meldungen stehen weiter oben.");
}

/* ---------- 2) Dateien finden ---------- */
const setupDir = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const setupName = `AzuNavi_${version}_x64-setup.exe`;
const setupPath = path.join(setupDir, setupName);
const portablePath = path.join(root, "src-tauri", "target", "release", "AzuNavi" + exe);
if (!fs.existsSync(setupPath)) {
  const hint = fs.existsSync(setupDir) ? fs.readdirSync(setupDir).filter((f) => f.endsWith(".exe")).join(", ") || "(keine .exe)" : "(Ordner fehlt)";
  fail(`Der Installer wurde nicht gefunden: ${setupPath}\nVorhanden in ${setupDir}: ${hint}\nStimmt die Version in package.json (${version}) mit dem Bau überein? Dann ohne --no-build neu starten.`);
}
const files = [
  { path: setupPath, name: setupName, label: "Windows-Setup (Installer)" },
];
if (fs.existsSync(portablePath)) files.push({ path: portablePath, name: `AzuNavi_${version}_x64_portable.exe`, label: "Windows portabel (ohne Installation)" });
else say("Hinweis: die portable Datei fehlt, es gibt nur den Installer.");
for (const f of files) {
  f.size = fs.statSync(f.path).size;
  if (f.size < 1_000_000) fail(`${f.name} ist nur ${f.size} Bytes groß und vermutlich unvollständig.`);
}

/* ---------- 3) GitLab ---------- */
async function api(method, p, { json, body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api/v4${p}`, {
      method,
      headers: { "PRIVATE-TOKEN": TOKEN, ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
  } catch (e) {
    fail(`Keine Verbindung zu ${BASE} (${e.cause?.code || e.message}). Netzwerk prüfen. Brauchst du einen Proxy? Dann: $env:HTTPS_PROXY = "http://proxy:port"`);
  }
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  return { status: res.status, ok: res.ok, data, text };
}

const proj = await api("GET", `/projects/${encodeURIComponent(PROJECT)}`);
if (proj.status === 401) fail("Der Token wurde abgelehnt (ungültig oder abgelaufen). Erzeuge einen neuen mit dem Haken bei „api“.");
if (proj.status === 403 || proj.status === 404) fail(`Projekt ${PROJECT} nicht gefunden oder keine Berechtigung (${proj.status}). Prüfe Projektname und Token.`);
if (!proj.ok) fail(`GitLab antwortet mit ${proj.status}: ${proj.text.slice(0, 200)}`);
const pid = proj.data.id;

const tg = await api("GET", `/projects/${pid}/repository/tags/${encodeURIComponent(tag)}`);
if (tg.status === 404) fail(`Den Tag ${tag} gibt es auf GitLab noch nicht. Erst setzen:\n  git tag ${tag}\n  git push gitlab ${tag}`);
if (tg.status === 403) {
  const me = await api("GET", "/personal_access_tokens/self");
  const scopes = me.ok && Array.isArray(me.data?.scopes) ? me.data.scopes.join(", ") : "nicht ermittelbar";
  fail(`Dein Token darf das Repository nicht lesen (403). Rechte des Tokens: ${scopes}.\n` +
    `Meist ist die Rolle des Tokens zu niedrig (Guest oder Reporter) oder der Haken bei "api" fehlt.\n` +
    `Lösung: neuen Token erzeugen mit Haken "api" und Rolle Developer oder Maintainer (Projekt -> Settings -> Access tokens),\n` +
    `oder einen persönlichen Token (Profilbild -> Preferences -> Access tokens, Haken bei "api"). Der gebaute Installer bleibt erhalten, danach einfach mit --no-build erneut starten.`);
}
if (!tg.ok) fail(`Tag prüfen: GitLab antwortet mit ${tg.status}.`);

/* ---------- 4) Hochladen (Package Registry) ---------- */
for (const f of files) {
  say(`\nLade hoch: ${f.name} (${(f.size / 1048576).toFixed(1)} MB) …`);
  const up = await api("PUT", `/projects/${pid}/packages/generic/azunavi/${encodeURIComponent(tag)}/${encodeURIComponent(f.name)}?select=package_file`,
    { body: fs.readFileSync(f.path), headers: { "Content-Type": "application/octet-stream" } });
  if (!(up.status === 201 || up.status === 200)) fail(`Hochladen von ${f.name} fehlgeschlagen (${up.status}): ${up.text.slice(0, 200)}\nIst die Package Registry im Projekt eingeschaltet? Reicht die Rolle (Developer oder höher)?`);
  f.url = `${BASE}/api/v4/projects/${pid}/packages/generic/azunavi/${tag}/${f.name}`;
}

/* ---------- 5) An die Download-Seite hängen ---------- */
const releaseRoleHint = () => `\nDas heißt meist: Die Rolle deines Tokens reicht nicht. Der Tag ${tag} ist geschützt (Settings -> Repository -> Protected tags),\n` +
  `und Releases an geschützten Tags ändern darf nur, wer den Tag anlegen darf, also Maintainer.\n` +
  `Lösung: Token mit Rolle Maintainer erzeugen (Projekt -> Settings -> Access tokens) oder einen persönlichen Token als Besitzer.\n` +
  `Die Dateien sind schon hochgeladen. Mit --no-build erneut starten.`;
let rel = await api("GET", `/projects/${pid}/releases/${encodeURIComponent(tag)}`);
if (rel.status === 404) {
  say("\nDie Release-Seite gibt es noch nicht, ich lege sie an …");
  const created = await api("POST", `/projects/${pid}/releases`, { json: { name: `AzuNavi ${version}`, tag_name: tag,
    description: `## AzuNavi ${version}\n\n**Windows:** das Setup herunterladen und starten (installiert nur für dich, keine Adminrechte nötig).` } });
  if (!created.ok) fail(`Release anlegen fehlgeschlagen (${created.status}): ${created.text.slice(0, 200)}` + (created.status === 403 ? releaseRoleHint() : ""));
} else if (!rel.ok) fail(`Release prüfen: GitLab antwortet mit ${rel.status}.`);

const links = await api("GET", `/projects/${pid}/releases/${encodeURIComponent(tag)}/assets/links`);
const existing = Array.isArray(links.data) ? links.data : [];
for (const f of files) {
  for (const old of existing.filter((l) => l.name === f.label)) {
    const del = await api("DELETE", `/projects/${pid}/releases/${encodeURIComponent(tag)}/assets/links/${old.id}`);
    if (del.status === 403) fail(`Alten Link „${f.label}“ entfernen fehlgeschlagen (403).` + releaseRoleHint());
  }
  const add = await api("POST", `/projects/${pid}/releases/${encodeURIComponent(tag)}/assets/links`, { json: { name: f.label, url: f.url, link_type: "package" } });
  if (!add.ok) fail(`Link „${f.label}“ anhängen fehlgeschlagen (${add.status}): ${add.text.slice(0, 200)}` + (add.status === 403 ? releaseRoleHint() : ""));
  say(`Angehängt: ${f.label}`);
}

say(`\nFertig! Download-Seite dieser Version:\n  ${BASE}/${PROJECT}/-/releases/${tag}\nImmer die neueste Version:\n  ${BASE}/${PROJECT}/-/releases/permalink/latest`);
