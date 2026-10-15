// Korrektur (Etappe 9): Rechtschreibung mit Hunspell (wie in LibreOffice) und deutschem Wörterbuch,
// komplett offline. Dazu ein paar einfache Grammatik- und Tippregeln.
import affUrl from "../assets/dict/de.aff?url";
import dicUrl from "../assets/dict/de.dic?url";
import { getSetting, inTauri, setSetting } from "../db/db";

export interface Issue { start: number; end: number; text: string; kind: "spell" | "grammar" | "hint"; msg: string; suggestions: string[] }

// Fachbegriffe, die im deutschen Wörterbuch fehlen (IT, Ausbildung) – werden nie als Fehler markiert
const BUILTIN = `Server Serverraum Firewall Firewalls Router Switch Switches Docker Proxmox VLAN VLANs DHCP DNS LAN WLAN VPN Graylog Grafana
Logrotation Syslog Linux Ubuntu Fedora Windows Debian Samba Active Directory Backup Backups Login Logins Logfile Logfiles Dashboard Dashboards
Monitoring Deployment Cluster Container Hypervisor Admin Admins Repository Commit Commits GitHub Git SQL MySQL PostgreSQL SQLite Python PowerShell
Script Scripts Skript Skripte Bash Netzplan Subnetting Subnetz Subnetze IPv4 IPv6 Gateway Gateways Patchpanel Patchkabel Ticket Tickets Helpdesk
Firmware Update Updates Upgrade Patch Patches OIDC LDAP SSO SSH HTTPS HTTP TCP UDP ICMP Ping Traceroute Wireshark LoRaWAN ChirpStack Milesight
Sensor Sensoren Azubi Azubis Berichtsheft Berichtshefte Lernfeld Lernfelder IHK HWK Teams Outlook Excel Word PowerPoint OneDrive SharePoint
Tauri React TypeScript JavaScript Frontend Backend Notebook Notebooks Laptop Laptops Hardware Software Client Clients Thin Meeting Meetings`.split(/\s+/);

let hs: { spell: (w: string) => boolean; suggest: (w: string) => string[] } | null = null;
let loading: Promise<void> | null = null;
let own = new Set<string>();
const known = new Set(BUILTIN.map((w) => w.toLowerCase()));

/** Lädt Hunspell und das Wörterbuch beim ersten Gebrauch (ca. 0,2 Sekunden) */
export function loadSpell(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [factory, aff, dic, words] = await Promise.all([
        import("hunspell-asm").then((m) => m.loadModule()), // erst beim ersten „Text prüfen“ laden
        fetch(affUrl).then((r) => r.arrayBuffer()),
        fetch(dicUrl).then((r) => r.arrayBuffer()),
        getSetting("spell_words").catch(() => null),
      ]);
      const a = factory.mountBuffer(new Uint8Array(aff), "de.aff");
      const d = factory.mountBuffer(new Uint8Array(dic), "de.dic");
      hs = factory.create(a, d);
      try { own = new Set(JSON.parse(words || "[]")); } catch { own = new Set(); }
    })();
  }
  return loading;
}

export let ltError = "";
async function loadOwnWords() {
  if (own.size) return;
  try { own = new Set(JSON.parse((await getSetting("spell_words")) || "[]")); } catch { own = new Set(); }
}

export async function addOwnWord(w: string) {
  own.add(w.toLowerCase());
  await setSetting("spell_words", JSON.stringify([...own]));
}

const isKnown = (w: string) => known.has(w.toLowerCase()) || own.has(w.toLowerCase());

function spellIssues(text: string): Issue[] {
  const out: Issue[] = [];
  if (!hs) return out;
  const re = /[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (/[\w./@:]$/.test(before) && /[./@:]/.test(before)) continue; // Teil einer Adresse, Datei oder Mail
    if (word.length < 2 || /^[A-ZÄÖÜ]{2,}$/.test(word) || isKnown(word)) continue; // Abkürzungen wie DNS
    const parts = word.split("-");
    const bad = parts.some((p) => p.length > 1 && !isKnown(p) && !hs!.spell(p)) && !hs.spell(word);
    if (bad) out.push({ start: m.index, end: m.index + word.length, text: word, kind: "spell", msg: "Unbekanntes Wort", suggestions: hs.suggest(word).slice(0, 4) });
  }
  return out;
}

function grammarIssues(text: string): Issue[] {
  const out: Issue[] = [];
  const add = (start: number, end: number, kind: Issue["kind"], msg: string, suggestions: string[]) =>
    out.push({ start, end, text: text.slice(start, end), kind, msg, suggestions });
  let m: RegExpExecArray | null;
  // doppelte Wörter: „der der“
  const dbl = /\b([A-Za-zÄÖÜäöüß]{2,})\s+\1\b/gi;
  while ((m = dbl.exec(text))) add(m.index, m.index + m[0].length, "grammar", "Wort doppelt", [m[1]]);
  // Satzanfang klein
  const start = /(^|[.!?]\s+)([a-zäöü][a-zäöüß]*)/g;
  while ((m = start.exec(text))) {
    const s = m.index + m[1].length;
    if (/^(z|d|u|bzw|ca|evtl|ggf|usw|inkl|vgl)$/.test(m[2])) continue;
    add(s, s + m[2].length, "grammar", "Satzanfang groß schreiben", [m[2][0].toUpperCase() + m[2].slice(1)]);
  }
  // Leerzeichen nach Satzzeichen fehlt (aber nicht bei Zahlen wie 1.5 oder Abkürzungen wie z.B.)
  const sp = /([a-zäöüß]{3,})([,;:!?])([A-Za-zÄÖÜäöü])/g;
  while ((m = sp.exec(text))) { const s = m.index + m[1].length; add(s, s + 2, "grammar", "Leerzeichen nach Satzzeichen", [m[2] + " " + m[3]]); }
  // Leerzeichen vor Satzzeichen
  const spb = /(\S) +([,.;:!?])(?=\s|$)/g;
  while ((m = spb.exec(text))) { const s = m.index + 1; add(s, s + m[0].length - 1, "grammar", "Kein Leerzeichen vor Satzzeichen", [m[2]]); }
  // mehrere Leerzeichen
  const multi = /[^\S\n]{2,}/g;
  while ((m = multi.exec(text))) add(m.index, m.index + m[0].length, "grammar", "Mehrere Leerzeichen", [" "]);
  // Hinweis „das“/„dass“ nach Komma
  const das = /,\s+(das)\s/gi;
  while ((m = das.exec(text))) { const s = m.index + m[0].indexOf(m[1]); add(s, s + m[1].length, "hint", "Nach Komma oft „dass“ – prüfen: Kann man „welches“ einsetzen? Dann „das“.", ["dass"]); }
  return out;
}

/* ---------- LanguageTool (Java, optional): Rechtschreibung + Grammatik ---------- */
const LT_URL = "http://localhost:8081/v2";
let ltReady: Promise<boolean> | null = null;
let ltFailedAt = 0; // nach einem Fehlschlag 2 Minuten direkt Hunspell nehmen statt erneut zu warten
export let lastEngine: "LanguageTool" | "Hunspell" = "Hunspell";

export async function ltSettings() {
  return { on: (await getSetting("lt_on")) === "1", dir: (await getSetting("lt_dir")) ?? "" };
}
async function ping(): Promise<boolean> {
  try { const r = await fetch(LT_URL + "/languages", { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
/** Startet LanguageTool (falls nötig) und wartet, bis es antwortet (beim ersten Mal einige Sekunden) */
export function ensureLt(force = false): Promise<boolean> {
  if (force) ltFailedAt = 0;
  if (!ltReady || force) {
    ltReady = (async () => {
      const { on, dir } = await ltSettings();
      if (!on) return false;
      if (await ping()) return true;
      if (inTauri) {
        if (!dir) throw new Error("Kein LanguageTool-Ordner gewählt (System → Grammatik).");
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("lt_start", { dir });
      }
      const until = Date.now() + 30000; // LanguageTool braucht beim Start einige Sekunden
      while (Date.now() < until) { if (await ping()) return true; await new Promise((r) => setTimeout(r, 750)); }
      throw new Error("LanguageTool antwortet nicht. Ist Java 17 oder neuer installiert?");
    })();
    ltReady.catch(() => { ltReady = null; ltFailedAt = Date.now(); });
  }
  return ltReady;
}
interface LtMatch { offset: number; length: number; message: string; shortMessage?: string; replacements: { value: string }[]; rule: { issueType: string; category?: { id: string } } }
async function ltIssues(text: string): Promise<Issue[]> {
  const body = new URLSearchParams({ language: "de-DE", text });
  const r = await fetch(LT_URL + "/check", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error("LanguageTool-Fehler " + r.status);
  const data = (await r.json()) as { matches: LtMatch[] };
  return data.matches
    .map((m): Issue => {
      const word = text.slice(m.offset, m.offset + m.length);
      const spell = m.rule.issueType === "misspelling";
      return {
        start: m.offset, end: m.offset + m.length, text: word,
        kind: spell ? "spell" : m.rule.issueType === "style" ? "hint" : "grammar",
        msg: m.shortMessage || m.message, suggestions: m.replacements.slice(0, 4).map((x) => x.value),
      };
    })
    .filter((i) => !(i.kind === "spell" && isKnown(i.text)));
}

/** Prüft einen Text und liefert alle Auffälligkeiten (sortiert nach Position) */
export async function checkText(text: string): Promise<Issue[]> {
  // Mit LanguageTool, wenn eingerichtet – sonst (oder bei Problemen) Hunspell + eigene Regeln
  try {
    if (Date.now() - ltFailedAt > 120000 && await ensureLt()) {
      await loadOwnWords();
      const res = await ltIssues(text);
      lastEngine = "LanguageTool";
      return res;
    }
  } catch (e) { ltError = String(e).replace(/^Error:\s*/, ""); ltFailedAt = Date.now(); }
  lastEngine = "Hunspell";
  await loadSpell();
  const all = [...spellIssues(text), ...grammarIssues(text)].sort((a, b) => a.start - b.start);
  // überlappende Treffer zusammenfassen (z. B. doppeltes Wort und Satzanfang)
  return all.filter((x, i) => !all.slice(0, i).some((y) => y.start <= x.start && y.end >= x.end));
}

/** Ersetzt eine Stelle im Text */
export const applyFix = (text: string, i: Issue, repl: string) => text.slice(0, i.start) + repl + text.slice(i.end);
