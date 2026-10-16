// Berufsprofile (Runde 2): pro Ausbildungsberuf Kammer, Vorlagen-Farben und Vorschlagsliste für Qualifikationen.
// Die Qualifikationen sind IMMER freiwillig. Die Listen hier sind nur Vorschläge.
// Quellen: amtliche Ausbildungsverordnungen (FIAusbV 2020, BüroMKfAusbV 2025, MedInfoFAngAusbV 1998, BuchbAusbV 2011).
import { QUALIS } from "../db/migrations";

export type QualKind = "betrieb" | "schule" | "eigene" | "sonst";
export interface QualItem { name: string; kind: QualKind }
export interface QualSuggestion { title: string; source: string; items: QualItem[] }

export interface BerufProfile {
  id: string;
  label: string;            // Anzeige im Auswahlfeld
  beruf: string;            // wird als Ausbildungsberuf gespeichert
  fachrichtung: string;     // Standard-Fachrichtung (leer = keine)
  fachrichtungen?: string[]; // Auswahl, falls es mehrere gibt
  fachrichtungLabel?: string;
  kammer: string;           // Standard-Kammer
  accent: string;           // Hauptfarbe der Standard-Vorlage (Hex ohne #)
  accentLight: string;
  hinweis: string;          // kurze Info im Tutorial
}

export const PROFILES: BerufProfile[] = [
  { id: "si", label: "Fachinformatiker/in – Systemintegration", beruf: "Fachinformatiker/in", fachrichtung: "Systemintegration",
    kammer: "IHK", accent: "1D4E6B", accentLight: "4A7DB5", hinweis: "IHK-Ausbildungsnachweis mit Tageskarten." },
  { id: "ae", label: "Fachinformatiker/in – Anwendungsentwicklung", beruf: "Fachinformatiker/in", fachrichtung: "Anwendungsentwicklung",
    kammer: "IHK", accent: "4B2E83", accentLight: "7C5CC4", hinweis: "IHK-Ausbildungsnachweis mit Tageskarten." },
  { id: "dpa", label: "Fachinformatiker/in – Daten- und Prozessanalyse", beruf: "Fachinformatiker/in", fachrichtung: "Daten- und Prozessanalyse",
    kammer: "IHK", accent: "0F6B5C", accentLight: "3FA58F", hinweis: "IHK-Ausbildungsnachweis mit Tageskarten." },
  { id: "buero", label: "Kaufmann/-frau für Büromanagement", beruf: "Kaufmann/-frau für Büromanagement", fachrichtung: "",
    kammer: "IHK", accent: "9A4A00", accentLight: "D9822B", hinweis: "Ausbildungsnachweis (IHK oder öffentlicher Dienst)." },
  { id: "fami", label: "Fachangestellte/r für Medien- und Informationsdienste (FAMI)", beruf: "Fachangestellte/r für Medien- und Informationsdienste",
    fachrichtung: "Bibliothek", fachrichtungen: ["Archiv", "Bibliothek", "Information und Dokumentation", "Bildagentur", "Medizinische Dokumentation"], fachrichtungLabel: "Fachrichtung",
    kammer: "Öffentlicher Dienst", accent: "2F6B2F", accentLight: "5FA05F", hinweis: "Ausbildungsnachweis im öffentlichen Dienst (oder IHK)." },
  { id: "buchbinder", label: "Buchbinder/in", beruf: "Buchbinder/in", fachrichtung: "",
    kammer: "HWK", accent: "7A2E2E", accentLight: "B5605A", hinweis: "Berichtsheft der Handwerkskammer." },
];

export const ANDERE_ID = "andere";

/** Passendes Profil zu den gespeicherten Angaben (Beruf + Fachrichtung) – null = anderer Beruf */
export function findProfile(beruf: string, fachrichtung = ""): BerufProfile | null {
  const b = beruf.toLowerCase(), f = fachrichtung.toLowerCase();
  if (/fachinformatiker/.test(b)) {
    if (/anwendung/.test(f) || /anwendung/.test(b)) return PROFILES[1];
    if (/daten|prozess/.test(f) || /daten|prozess/.test(b)) return PROFILES[2];
    if (/system/.test(f) || /system/.test(b) || !f) return PROFILES[0];
    return null;
  }
  if (/büromanagement|bueromanagement/.test(b)) return PROFILES[3];
  if (/\bfami\b|medien- und informationsdienste/.test(b)) return PROFILES[4];
  if (/buchbinder/.test(b)) return PROFILES[5];
  return null;
}
export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? null;

/** Titel der Vorlage je Kammer: Handwerk sagt „Berichtsheft“, sonst „Ausbildungsnachweis“ */
export const templateTitle = (kammer: string) => (/hwk|handwerk/i.test(kammer) ? "Berichtsheft" : "Ausbildungsnachweis");

/* ---------- Qualifikations-Vorschläge ---------- */
const b = (names: string[]): QualItem[] => names.map((name) => ({ name, kind: "betrieb" }));
const SCHULE: QualItem[] = [{ name: "Allgemeinbildende Fächer", kind: "schule" }, { name: "Fachunterricht in der Berufsschule", kind: "schule" }];
const SONST: QualItem = { name: "Sonstige Qualifikation", kind: "sonst" };

// Fachinformatiker/in (FIAusbV vom 28.02.2020, § 4): fachrichtungsübergreifend + integrativ
const FI_A = b([
  "Planen, Vorbereiten und Durchführen von Arbeitsaufgaben in Abstimmung mit den kundenspezifischen Geschäfts- und Leistungsprozessen",
  "Informieren und Beraten von Kunden und Kundinnen",
  "Beurteilen marktgängiger IT-Systeme und kundenspezifischer Lösungen",
  "Entwickeln, Erstellen und Betreuen von IT-Lösungen",
  "Durchführen und Dokumentieren von qualitätssichernden Maßnahmen",
  "Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit und zum Datenschutz",
  "Erbringen der Leistungen und Auftragsabschluss",
  "Betreiben von IT-Systemen",
  "Inbetriebnehmen von Speicherlösungen",
  "Programmieren von Softwarelösungen",
]);
const FI_F = b([
  "Berufsbildung sowie Arbeits- und Tarifrecht", "Aufbau und Organisation des Ausbildungsbetriebes",
  "Sicherheit und Gesundheitsschutz bei der Arbeit", "Umweltschutz", "Vernetztes Zusammenarbeiten unter Nutzung digitaler Medien",
]);

const SUGGEST: Record<string, QualSuggestion> = {
  si: { title: "Deine IHK-Liste für Systemintegration", source: "Die Liste aus deiner IHK-Berichtsheft-Vorlage (26 Einträge).", items: QUALIS.map((q) => ({ name: q.name, kind: q.kind })) },
  ae: { title: "Qualifikationen Fachinformatiker/in – Anwendungsentwicklung", source: "Berufsbildpositionen aus der Fachinformatiker-Ausbildungsverordnung 2020 (§ 4 Abs. 2, 3 und 7).",
    items: [...FI_A, ...b(["Konzipieren und Umsetzen von kundenspezifischen Softwareanwendungen", "Sicherstellen der Qualität von Softwareanwendungen"]), ...FI_F, ...SCHULE, SONST] },
  dpa: { title: "Qualifikationen Fachinformatiker/in – Daten- und Prozessanalyse", source: "Berufsbildpositionen aus der Fachinformatiker-Ausbildungsverordnung 2020 (§ 4 Abs. 2, 5 und 7).",
    items: [...FI_A, ...b(["Analysieren von Arbeits- und Geschäftsprozessen", "Analysieren von Datenquellen und Bereitstellen von Daten",
      "Nutzen der Daten zur Optimierung von Arbeits- und Geschäftsprozessen sowie zur Optimierung digitaler Geschäftsmodelle", "Umsetzen des Datenschutzes und der Schutzziele der Datensicherheit"]), ...FI_F, ...SCHULE, SONST] },
  buero: { title: "Qualifikationen Kaufmann/-frau für Büromanagement", source: "Berufsbildpositionen und Wahlqualifikationen aus der Büromanagementkaufleute-Ausbildungsverordnung (gültig ab 01.08.2025). Wer früher angefangen hat: bei Abweichungen eigene Liste einfügen.",
    items: [...b(["Informationsmanagement anwenden", "Informationsverarbeitung durchführen", "Bürowirtschaftliche Abläufe organisieren", "Koordinations- und Organisationsaufgaben übernehmen",
      "Kundenbeziehungen gestalten", "Auftragsbearbeitung durchführen", "Material und externe Dienstleistungen beschaffen", "Personalbezogene Aufgaben übernehmen", "Kaufmännische Steuerung durchführen"]),
      ...b(["Wahlqualifikation: Auftragsprozess steuern", "Wahlqualifikation: Instrumente der kaufmännischen Steuerung und Kontrolle nutzen",
        "Wahlqualifikation: Kaufmännische Abläufe in kleinen und mittleren Unternehmen gestalten und umsetzen", "Wahlqualifikation: Einkauf und Logistikprozesse planen, koordinieren und durchführen",
        "Wahlqualifikation: Marketing- und Vertriebsaktivitäten mitgestalten", "Wahlqualifikation: Personalwirtschaftliche Prozesse umsetzen", "Wahlqualifikation: Assistenzaufgaben übernehmen",
        "Wahlqualifikation: Öffentlichkeitsarbeit gestalten und Aufgaben des Veranstaltungsmanagements übernehmen", "Wahlqualifikation: Aufgaben der Verwaltung wahrnehmen und Recht anwenden",
        "Wahlqualifikation: Haushaltsmittel planen und bewirtschaften"]),
      ...b(["Organisation des Ausbildungsbetriebes, Berufsbildung sowie Arbeits- und Tarifrecht", "Sicherheit und Gesundheit bei der Arbeit", "Umweltschutz und Nachhaltigkeit",
        "Digitalisierte Arbeitswelt", "Arbeitsorganisation und Informationsmanagement gestalten", "Zusammenarbeit und Kommunikation gestalten"]), ...SCHULE, SONST] },
  buchbinder: { title: "Qualifikationen Buchbinder/in", source: "Pflicht- und Wahlqualifikationen aus der Buchbinder-Ausbildungsverordnung 2011. Zwei Wahlqualifikationen aus Liste I und eine aus Liste II legt dein Ausbildungsvertrag fest, lösch einfach, was bei dir nicht dran ist.",
    items: [...b(["Planen und Organisieren von Arbeitsabläufen", "Einrichten von Arbeitsplätzen, Geräten, Maschinen und Anlagen", "Herstellen buchbinderischer Erzeugnisse",
      "Bewerten und Auswählen von Verarbeitungstechniken", "Pflegen und Warten"]),
      ...b(["Wahlqualifikation: Unternehmerisches Handeln", "Wahlqualifikation: Kaufmännische Auftragsbearbeitung", "Wahlqualifikation: Einrahmen von Bildern und Objekten",
        "Wahlqualifikation: Fertigen von Behältnissen", "Wahlqualifikation: Instandsetzen von Büchern und Objekten", "Wahlqualifikation: Gestalten buchbinderischer Erzeugnisse",
        "Wahlqualifikation: Kaschieren und Aufziehen", "Wahlqualifikation: Einzel- und Sonderfertigung", "Wahlqualifikation: Maschinelle Fertigung"]),
      ...b(["Berufsbildung, Arbeits- und Tarifrecht", "Aufbau und Organisation des Ausbildungsbetriebes", "Sicherheit und Gesundheitsschutz bei der Arbeit", "Umweltschutz",
        "Betriebliche und kundenorientierte Kommunikation"]), ...SCHULE, SONST] },
};

// FAMI (MedInfoFAngAusbV vom 03.06.1998, § 3): gemeinsamer Teil + Fachrichtung
const FAMI_COMMON = b(["Der Ausbildungsbetrieb: Stellung, Rechtsform, Organisation und Aufgaben", "Berufsbildung, arbeits- und sozialrechtliche Grundlagen", "Sicherheit und Gesundheitsschutz bei der Arbeit",
  "Umweltschutz", "Beschaffung, Erschließung und Bereitstellung", "Kommunikation und Kooperation", "Arbeitsorganisation und Bürowirtschaft", "Informations- und Kommunikationssysteme", "Öffentlichkeitsarbeit und Werbung"]);
const FAMI_FACH: Record<string, string[]> = {
  "Archiv": ["Übernahme von Schriftgut und anderen Informationsträgern", "Erschließung", "Technische Bearbeitung und Aufbewahrung", "Informationsvermittlung und Benutzungsdienst"],
  "Bibliothek": ["Erwerbung", "Erschließung", "Bearbeitung von Medien, Bestandspflege", "Benutzungsdienst und Informationsvermittlung"],
  "Information und Dokumentation": ["Beschaffung", "Erschließung", "Verwaltung und Pflege von Datenspeichern", "Informationsvermittlung und Informationsdienstleistungen", "Marketing"],
  "Bildagentur": ["Beschaffung", "Erschließung", "Aufbewahrung und technische Bearbeitung", "Bildvermittlung", "Marketing"],
  "Medizinische Dokumentation": ["Sammlung, Erfassung und Strukturierung medizinischer Informationen", "Erschließung und Verschlüsselung", "Verwaltung und Pflege von Datenbeständen", "Statistik und Informationsdienstleistungen"],
};

/** Vorschlagsliste für Beruf und Fachrichtung – null, wenn es für diesen Beruf keine gibt */
export function qualSuggestion(p: BerufProfile | null, fachrichtung = ""): QualSuggestion | null {
  if (!p) return null;
  if (p.id === "fami") {
    const fr = FAMI_FACH[fachrichtung] ? fachrichtung : p.fachrichtung;
    return { title: `Qualifikationen FAMI – Fachrichtung ${fr}`, source: "Ausbildungsberufsbild der FAMI-Ausbildungsverordnung von 1998 (§ 3). Der Beruf wird gerade neu geordnet, die neue Verordnung soll ab 2027 gelten.",
      items: [...FAMI_COMMON, ...FAMI_FACH[fr].map((n) => ({ name: `${fr}: ${n}`, kind: "betrieb" as QualKind })), ...SCHULE, SONST] };
  }
  return SUGGEST[p.id] ?? null;
}
