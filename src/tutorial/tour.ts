// Nami, Caramella, Eda und die Hilfe-Texte (klein gehalten, damit der „?“-Knopf nichts Großes nachladen muss)
import namiGruss from "../assets/figuren/nami_gruss.webp";
import namiErklaert from "../assets/figuren/nami_erklaert.webp";
import namiSchreibt from "../assets/figuren/nami_schreibt.webp";
import namiPinnt from "../assets/figuren/nami_pinnt.webp";
import namiDenkt from "../assets/figuren/nami_denkt.webp";
import namiJubelt from "../assets/figuren/nami_jubelt.webp";

import edaGruss from "../assets/figuren/prof_gruss.webp";
import edaDenkt from "../assets/figuren/prof_denkt.webp";
import edaFertig from "../assets/figuren/prof_fertig.webp";
import catSchreibt from "../assets/figuren/katze_schreibt.webp";
import catSammelt from "../assets/figuren/katze_sammelt.webp";
import catZeigt from "../assets/figuren/katze_zeigt.webp";

export const NAMI = { gruss: namiGruss, erklaert: namiErklaert, schreibt: namiSchreibt, pinnt: namiPinnt, denkt: namiDenkt, jubelt: namiJubelt };
export type Pose = keyof typeof NAMI;

/** Die drei Begleiter: Nami führt durch die App, Caramella das Berichtsheft, Eda die Dateien */
export const GUIDES = {
  nami: { name: "Nami", accent: "#3db8ff", poses: NAMI as Record<string, string> },
  caramella: { name: "Caramella", accent: "#6c5cff", poses: { gruss: catZeigt, erklaert: catZeigt, schreibt: catSchreibt, pinnt: catSammelt, denkt: catSammelt, jubelt: catZeigt } as Record<string, string> },
  eda: { name: "Eda", accent: "#19e3b1", poses: { gruss: edaGruss, erklaert: edaGruss, schreibt: edaFertig, pinnt: edaFertig, denkt: edaDenkt, jubelt: edaFertig } as Record<string, string> },
} as const;
export type GuideId = keyof typeof GUIDES;

// Rundgang durch die App: wer führt, wohin gezeigt wird und was gesagt wird.
// „target“ ist ein CSS-Name auf der jeweiligen Seite, auf den der Pfeil zeigt.
export interface TourStep {
  title: string; pose: Pose; text: string; tips: string[];
  guide?: GuideId;        // wer spricht (Standard: Nami)
  page?: string | null;   // welche Seite dabei geöffnet wird (null = Hauptmenü)
  target?: string;        // worauf gezeigt wird
  side?: "links" | "rechts";
  /** Schritt gilt als erledigt, sobald dieses Element auftaucht – dann geht es von selbst weiter */
  doneWhen?: string;
  /** Erledigt, sobald auf das markierte Element geklickt wurde */
  doneOnClick?: boolean;
  /** Hinweis, was zu tun ist (steht unter dem Text) */
  todo?: string;
  /** Text, wenn die Aufgabe schon beim Öffnen erledigt war */
  doneText?: string;
  /** Fokusmodus: NUR diese Elemente (CSS-Selektoren) lassen sich anklicken, der Rest der App ist gesperrt. Leer = alles gesperrt. */
  allow?: string[];
  /** Erlaubte Tasten in diesem Schritt (z. B. ["ArrowUp", "ArrowDown"]). Alles andere ist gesperrt, auch Esc, F1 und F11. */
  keys?: string[];
  /** Mausrad erlaubt (nur beim Rad-Schritt) */
  wheel?: boolean;
}
export const TOUR: TourStep[] = [
  { title: "Das Hauptmenü", pose: "erklaert", page: null, target: ".item.on", side: "links",
    text: "Das ist dein Rad. Der große Punkt in der Mitte ist ausgewählt.",
    todo: "Dreh das Rad – Mausrad oder Pfeiltasten ↑ ↓.",
    doneWhen: "[data-turned='1']",
    allow: ["#menu .item span"], keys: ["ArrowUp", "ArrowDown", "w", "W", "s", "S"], wheel: true,
    tips: ["Mausrad oder Pfeiltasten ↑ ↓ drehen das Rad", "Klick auf einen anderen Punkt dreht ihn in die Mitte", "Enter öffnet, Esc geht zurück"] },
  { title: "Bereiche und Hilfe", pose: "erklaert", page: null, target: "#scope", side: "links",
    text: "Oben rechts schaltest du zwischen Alles, Schule und Arbeit um – die Farben der App ändern sich mit. Daneben liegt der ?-Knopf, der dir jede Seite erklärt.",
    todo: "Klick auf „Schule“ oder „Arbeit“ – du siehst, wie die Farben wechseln.",
    doneWhen: "#stage[data-scope='schule'], #stage[data-scope='arbeit']",
    allow: ["#scope .pill"], keys: ["Tab"],
    tips: ["Tab wechselt den Bereich", "F1 oder der ?-Knopf öffnet die Hilfe", "F11 schaltet Vollbild um"] },
  { title: "Notizen", pose: "schreibt", page: "notizen", target: ".wtools .btn", side: "rechts",
    text: "Hier hältst du fest, was du erledigt hast. Aus diesen Notizen baue ich später dein Berichtsheft.",
    todo: "Klick auf „+ Neue Notiz“.",
    doneWhen: ".editor textarea",
    allow: [".wtools .btn"],
    tips: ["Datum, Bereich und Text eintragen", "Qualifikation aus deiner Liste wählen", "Projekt und Personen verknüpfen, Bilder anhängen", "„Text prüfen“ findet Tipp- und Grammatikfehler"] },
  { title: "Kontakte", pose: "gruss", page: "kontakte", target: ".wtools .pvtabs", side: "rechts",
    text: "Dein Netzplan aus Menschen: Ausbilder, Kolleginnen, Lehrkräfte. Schule und Arbeit haben eigene Zonen, und eine Person kann mehrere Vorgesetzte und Untergebene haben.",
    todo: "Schau dir beide Ansichten an: klick auf „Baum“ und wieder auf „Netzplan“.",
    doneOnClick: true,
    allow: [".wtools .pvtabs"],
    tips: ["„+ Neue Person“ anlegen, dann im Netz verbinden", "Knoten ziehen, Mausrad zoomt", "Doppelklick öffnet die Person zum Bearbeiten", "Reiter „Baum“ zeigt die klassische Ansicht"] },
  { title: "Projekte", pose: "pinnt", page: "projekte", target: ".bmode .pvtabs", side: "rechts",
    text: "Alle Projekte auf einen Blick, mit ihren Verbindungen und Ansprechpartnern. Doppelklick zoomt in ein Projekt hinein, Esc bringt dich zurück.",
    todo: "Schau dir die beiden Ansichten an: „Netzplan“ und „Pinnwand“.",
    doneOnClick: true,
    allow: [".bmode .pvtabs"],
    tips: ["„Netzplan“ oder „Pinnwand“ – beides zeigt dieselben Projekte", "„Faden spannen“ verbindet zwei Projekte", "Im Projekt: Was gemacht, Was als Nächstes, Dateien und eine eigene Mindmap"] },
  { title: "Dateien", pose: "gruss", guide: "eda", page: "dateien", target: ".fpickmain, .wtools", side: "rechts",
    text: "Hallo, ich bin Eda! Ich kümmere mich um deine echten Ordner für Arbeit und Schule. Als Erstes brauche ich einen <b>Hauptordner</b> – darin lege ich die beiden Ordner „Arbeit“ und „Schule“ an. Gibt es sie schon, benutze ich sie einfach.",
    todo: "Klick auf „Hauptordner wählen“ und such dir einen Ordner aus – oder überspring es und hol es später nach.",
    doneText: "Deine Ordner stehen schon – perfekt. Alles, was du dort ablegst, siehst du hier.",
    doneWhen: ".files .frow, .files .tn",
    allow: [".fpickmain"],
    tips: ["Nichts wird verschoben oder gelöscht – ich lege nur Ordner an", "Danach: Dateien aufs Fenster ziehen oder „+ Datei hinzufügen“", "Jede Ablage lässt sich rückgängig machen"] },
  { title: "Berichtsheft", pose: "schreibt", guide: "caramella", page: "berichtsheft", target: ".rweek", side: "rechts",
    text: "Und ich bin Caramella. Ich baue deinen Wochenbericht aus den Notizen zusammen – du prüfst ihn nur noch und exportierst ihn als Word-Datei.",
    todo: "Blätter einmal mit ◀ ▶ durch die Wochen.",
    doneOnClick: true,
    allow: [".rweek button[aria-label]"],
    tips: ["Mit ◀ ▶ die Woche wählen", "„Als Word exportieren“ im Format deiner Vorlage", "Reiter „Fähigkeiten“ zeigt, welche Qualifikationen noch offen sind"] },
  { title: "System", pose: "erklaert", page: "system", target: ".syscols", side: "rechts",
    text: "Hier stellst du alles ein: Schriftgröße, Animationen, Anzeige und deine Figur. Und du kannst deine Daten sichern, um sie auf einen anderen Laptop mitzunehmen.",
    todo: "Schau dich kurz um – mit „Weiter“ bist du fertig.",
    allow: [],
    tips: ["Anzeige: Fenster, randlos oder Vollbild", "„Sicherung erstellen“ und „einspielen“ zum Umziehen", "Hier findest du auch „Tutorial wiederholen“"] },
];

