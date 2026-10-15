// Profil aus der Registrierung (Tutorial). Füllt auch die Kopfzeile des Berichtshefts.
import { getSetting, setSetting } from "../db/db";
import { setMeta } from "../db/reportRepo";

export interface Profile {
  vorname: string; nachname: string; beruf: string; fachrichtung: string; taetigkeit: string;
  kammer: string; kammerOrt: string; betrieb: string; ausbilder: string; beginn: string;
}
export const EMPTY_PROFILE: Profile = { vorname: "", nachname: "", beruf: "", fachrichtung: "", taetigkeit: "", kammer: "IHK", kammerOrt: "", betrieb: "", ausbilder: "", beginn: "" };
const KEYS = Object.keys(EMPTY_PROFILE) as (keyof Profile)[];

export const BERUFE = [
  "Fachinformatiker/in", "IT-System-Elektroniker/in", "Kaufmann/-frau für Digitalisierungsmanagement", "Kaufmann/-frau für IT-System-Management",
  "Kaufmann/-frau für Büromanagement", "Industriekaufmann/-frau", "Verwaltungsfachangestellte/r", "Mediengestalter/in Digital und Print",
  "Elektroniker/in", "Mechatroniker/in", "Industriemechaniker/in", "Kraftfahrzeugmechatroniker/in", "Medizinische/r Fachangestellte/r",
  "Bankkaufmann/-frau", "Kaufmann/-frau im Einzelhandel", "Fachkraft für Lagerlogistik",
];
export const FACHRICHTUNGEN = ["Systemintegration", "Anwendungsentwicklung", "Daten- und Prozessanalyse", "Digitale Vernetzung"];
export const KAMMERN = ["IHK", "HWK", "Ärztekammer", "Landwirtschaftskammer", "Rechtsanwaltskammer", "Steuerberaterkammer", "Öffentlicher Dienst", "Sonstige"];

export async function loadProfile(): Promise<Profile> {
  const p = { ...EMPTY_PROFILE };
  for (const k of KEYS) { const v = await getSetting("profile_" + k); if (v !== null) p[k] = v; }
  return p;
}
export async function saveProfile(p: Profile) {
  for (const k of KEYS) await setSetting("profile_" + k, p[k]);
  const beruf = [p.beruf, p.fachrichtung].filter(Boolean).join(" ");
  await setMeta({ name: [p.nachname, p.vorname].filter(Boolean).join(", "), beruf, betrieb: p.betrieb, ausbilder: p.ausbilder });
  await setSetting("bh_kammer", [p.kammer, p.kammerOrt].filter(Boolean).join(" "));
}
export const isFachinformatiker = (p: Profile) => /fachinformatiker/i.test(p.beruf);
