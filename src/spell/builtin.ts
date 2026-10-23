// Eingebaute Prüfung (ohne Java): Rechtschreibung mit Hunspell plus Regeln (Zeichensetzung, das/dass, Komma, Typografie …).
// Ohne Datenbank und ohne Netz, damit sie sich einzeln testen lässt (tools/grammar-test.mts). spell.ts lädt das Wörterbuch und ruft das hier auf.
import { extraIssues } from "./rules";

export interface Issue { start: number; end: number; text: string; kind: "spell" | "grammar" | "hint"; msg: string; suggestions: string[] }

// Fachbegriffe, die im deutschen Wörterbuch fehlen (IT, Ausbildung) – werden nie als Fehler markiert
const BUILTIN = `Server Serverraum Firewall Firewalls Router Switch Switches Docker Proxmox VLAN VLANs DHCP DNS LAN WLAN VPN Graylog Grafana
Logrotation Syslog Linux Ubuntu Fedora Windows Debian Samba Active Directory Backup Backups Login Logins Logfile Logfiles Dashboard Dashboards
Monitoring Deployment Cluster Container Hypervisor Admin Admins Repository Commit Commits GitHub Git SQL MySQL PostgreSQL SQLite Python PowerShell
Script Scripts Skript Skripte Bash Netzplan Subnetting Subnetz Subnetze IPv4 IPv6 Gateway Gateways Patchpanel Patchkabel Ticket Tickets Helpdesk
Firmware Update Updates Upgrade Patch Patches OIDC LDAP SSO SSH HTTPS HTTP TCP UDP ICMP Ping Traceroute Wireshark LoRaWAN ChirpStack Milesight
Sensor Sensoren Azubi Azubis Berichtsheft Berichtshefte Lernfeld Lernfelder IHK HWK Teams Outlook Excel Word PowerPoint OneDrive SharePoint
Tauri React TypeScript JavaScript Frontend Backend Notebook Notebooks Laptop Laptops Hardware Software Client Clients Thin Meeting Meetings Log Logs Logging Namespace Namespaces IPv ggf usw bzw evtl inkl vgl etc ca zzgl bspw Wiki Wikis Skript Cloud Hostname Hostnames Domain Domains Subnet Treiber Plugin Plugins Tool Tools Feature Features Bug Bugs Task Tasks Workflow Workflows`.split(/\s+/);
export const BUILTIN_WORDS = BUILTIN;

export type Hs = { spell: (w: string) => boolean; suggest: (w: string) => string[] };

function spellIssues(text: string, hs: Hs | null, isKnown: (w: string) => boolean): Issue[] {
  const out: Issue[] = [];
  if (!hs) return out;
  const re = /[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (m.index > 0 && text[m.index - 1] === "-") continue;   // Ergänzungsstrich („Vor- und -größen“): das Wort gehört zu einem Wort davor
    if (/^\.[a-z]/.test(text.slice(m.index + word.length, m.index + word.length + 2))) continue;   // Adresse oder Datei („git.example.de“)
    if (/[\w./@:\\]$/.test(before) && /[./@:\\]/.test(before)) continue; // Teil einer Adresse, Datei, Pfad oder Mail
    if (text.slice(m.index + word.length, m.index + word.length + 2) === "::" || text.slice(Math.max(0, m.index - 2), m.index) === "::") continue;   // Code (std::vector)
    if (word.length < 2 || /^[A-ZÄÖÜ]{2,}$/.test(word) || isKnown(word)) continue; // Abkürzungen wie DNS
    const parts = word.split("-");
    const bad = parts.some((p) => p.length > 1 && !isKnown(p) && !hs!.spell(p)) && !hs.spell(word);
    if (!bad) continue;
    // klein geschriebenes Hauptwort („datei“, „haus“): Das Wörterbuch kennt es nur groß. Das ist die häufigste Rechtschreibart.
    const cap = word[0].toUpperCase() + word.slice(1);
    if (parts.length === 1 && word[0] === word[0].toLowerCase() && hs.spell(cap)) {
      out.push({ start: m.index, end: m.index + word.length, text: word, kind: "spell", msg: "Hauptwort großschreiben", suggestions: [cap] });
    } else out.push({ start: m.index, end: m.index + word.length, text: word, kind: "spell", msg: "Unbekanntes Wort", suggestions: hs.suggest(word).slice(0, 4) });
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
  // „die die“, „das das“, „der der“, „sie sie“ sind oft richtig („alle, die die Adresse kennen“, „dass das das Problem ist“)
  while ((m = dbl.exec(text))) { if (/^(die|das|der|sie)$/i.test(m[1])) continue; add(m.index, m.index + m[0].length, "grammar", "Wort doppelt", [m[1]]); }
  // Satzanfang klein
  const start = /(^|[.!?]\s+)([a-zäöü][a-zäöüß]*)/g;
  while ((m = start.exec(text))) {
    const s = m.index + m[1].length;
    if (/^(z|d|u|bzw|ca|evtl|ggf|usw|inkl|vgl)$/.test(m[2])) continue;
    if (/^(\.[a-z]|\/|:\/\/)/.test(text.slice(s + m[2].length, s + m[2].length + 3))) continue;   // Adresse oder Datei („git.example.de“)
    // der Punkt gehört zu einer Abkürzung („d. h. oft“, „ca. 5“, „Nr. 3“) oder zu einer Ordnungszahl („am 5. oder 6.“): kein neuer Satz
    const before = text.slice(0, m.index + (m[1] ? 1 : 0));
    const prevWord = /([A-Za-zÄÖÜäöüß]+|\d+)\.$/.exec(before)?.[1] ?? "";
    if (m[1] && (prevWord.length === 1 || /^\d+$/.test(prevWord) || /^(ca|ggf|usw|bzw|evtl|inkl|vgl|etc|nr|bspw|zzgl|max|min|tel|str|dr|prof|abs|vs|mio|mrd|jh|gem|sog|ehem|evtl)$/i.test(prevWord))) continue;
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
  return out;
}


/** Alles zusammen, sortiert, ohne Treffer, die schon in einem früheren stecken. Vorrang haben die genaueren Regeln vor den allgemeinen. */
export function builtinCheck(text: string, hs: Hs | null, isKnown: (w: string) => boolean): Issue[] {
  const all = [...spellIssues(text, hs, isKnown), ...extraIssues(text), ...grammarIssues(text)].sort((a, b) => a.start - b.start);
  // überlappende Treffer zusammenfassen (z. B. doppeltes Wort und Satzanfang)
  return all.filter((x, i) => !all.slice(0, i).some((y) => y.start <= x.start && y.end >= x.end));
}
