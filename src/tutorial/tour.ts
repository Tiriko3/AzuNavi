// Nami, Caramella, Eva und die Hilfe-Texte (klein gehalten, damit der „?“-Knopf nichts Großes nachladen muss)
import namiGruss from "../assets/figuren/nami_gruss.webp";
import namiErklaert from "../assets/figuren/nami_erklaert.webp";
import namiSchreibt from "../assets/figuren/nami_schreibt.webp";
import namiPinnt from "../assets/figuren/nami_pinnt.webp";
import namiDenkt from "../assets/figuren/nami_denkt.webp";
import namiJubelt from "../assets/figuren/nami_jubelt.webp";

import evaGruss from "../assets/figuren/prof_gruss.webp";
import evaDenkt from "../assets/figuren/prof_denkt.webp";
import evaFertig from "../assets/figuren/prof_fertig.webp";
import catSchreibt from "../assets/figuren/katze_schreibt.webp";
import catSammelt from "../assets/figuren/katze_sammelt.webp";
import catZeigt from "../assets/figuren/katze_zeigt.webp";

export const NAMI = { gruss: namiGruss, erklaert: namiErklaert, schreibt: namiSchreibt, pinnt: namiPinnt, denkt: namiDenkt, jubelt: namiJubelt };
export type Pose = keyof typeof NAMI;

/** Die drei Begleiter: Nami führt durch die App, Caramella das Berichtsheft, Eva die Dateien */
export const GUIDES = {
  nami: { name: "Nami", accent: "#3db8ff", poses: NAMI as Record<string, string> },
  caramella: { name: "Caramella", accent: "#6c5cff", poses: { gruss: catZeigt, erklaert: catZeigt, schreibt: catSchreibt, pinnt: catSammelt, denkt: catSammelt, jubelt: catZeigt } as Record<string, string> },
  eva: { name: "Eva", accent: "#19e3b1", poses: { gruss: evaGruss, erklaert: evaGruss, schreibt: evaFertig, pinnt: evaFertig, denkt: evaDenkt, jubelt: evaFertig } as Record<string, string> },
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
}
export const TOUR: TourStep[] = [
  { title: "Das Hauptmenü", pose: "erklaert", page: null, target: ".item.on", side: "links",
    text: "Das ist dein Rad. Der große Punkt in der Mitte ist ausgewählt – hier klickst du, um ihn zu öffnen.",
    tips: ["Mausrad oder Pfeiltasten ↑ ↓ drehen das Rad", "Klick auf einen anderen Punkt dreht ihn in die Mitte", "Enter öffnet, Esc geht zurück"] },
  { title: "Bereiche und Hilfe", pose: "erklaert", page: null, target: "#scope", side: "links",
    text: "Oben rechts schaltest du zwischen Alles, Schule und Arbeit um – die Farben der App ändern sich mit. Daneben liegt der ?-Knopf: Der erklärt dir jederzeit die Seite, auf der du gerade bist.",
    tips: ["Tab wechselt den Bereich", "F1 oder der ?-Knopf öffnet die Hilfe", "F11 schaltet Vollbild um"] },
  { title: "Notizen", pose: "schreibt", page: "notizen", target: ".wtools .btn", side: "rechts",
    text: "Hier hältst du fest, was du erledigt hast. Mit „+ Neue Notiz“ legst du los – aus diesen Notizen baue ich später dein Berichtsheft.",
    tips: ["Datum, Bereich und Text eintragen", "Qualifikation aus deiner Liste wählen", "Projekt und Personen verknüpfen, Bilder anhängen", "„Text prüfen“ findet Tipp- und Grammatikfehler"] },
  { title: "Kontakte", pose: "gruss", page: "kontakte", target: ".wtools .pvtabs", side: "rechts",
    text: "Dein Netzplan aus Menschen: Ausbilder, Kolleginnen, Lehrkräfte. Schule und Arbeit haben eigene Zonen, und eine Person kann mehrere Vorgesetzte und Untergebene haben.",
    tips: ["„+ Neue Person“ anlegen, dann im Netz verbinden", "Knoten ziehen, Mausrad zoomt", "Doppelklick öffnet die Person zum Bearbeiten", "Reiter „Baum“ zeigt die klassische Ansicht"] },
  { title: "Projekte", pose: "pinnt", page: "projekte", target: ".bmode", side: "rechts",
    text: "Alle Projekte auf einen Blick, mit ihren Verbindungen und Ansprechpartnern. Doppelklick zoomt in ein Projekt hinein, Esc bringt dich zurück.",
    tips: ["„Netzplan“ oder „Pinnwand“ – beides zeigt dieselben Projekte", "„Faden spannen“ verbindet zwei Projekte", "Im Projekt: Was gemacht, Was als Nächstes, Dateien und eine eigene Mindmap"] },
  { title: "Dateien", pose: "denkt", guide: "eva", page: "dateien", target: ".wtools", side: "rechts",
    text: "Hallo, ich bin Eva! Ich kümmere mich um deine echten Ordner für Arbeit und Schule und sortiere neue Dateien für dich ein.",
    tips: ["Beim ersten Öffnen den Hauptordner wählen", "Dateien aufs Fenster ziehen oder „+ Datei hinzufügen“", "Ich lösche und überschreibe nie etwas – alles lässt sich rückgängig machen"] },
  { title: "Berichtsheft", pose: "schreibt", guide: "caramella", page: "berichtsheft", target: ".ractions", side: "rechts",
    text: "Und ich bin Caramella. Ich baue deinen Wochenbericht aus den Notizen zusammen – du prüfst ihn nur noch und exportierst ihn als Word-Datei.",
    tips: ["Mit ◀ ▶ die Woche wählen", "„Als Word exportieren“ im Format deiner Vorlage", "Reiter „Fähigkeiten“ zeigt, welche Qualifikationen noch offen sind"] },
  { title: "System", pose: "erklaert", page: "system", target: ".syscols", side: "rechts",
    text: "Hier stellst du alles ein: Schriftgröße, Animationen, Anzeige und deine Figur. Und du kannst deine Daten sichern, um sie auf einen anderen Laptop mitzunehmen.",
    tips: ["Anzeige: Fenster, randlos oder Vollbild", "„Sicherung erstellen“ und „einspielen“ zum Umziehen", "Hier findest du auch „Tutorial wiederholen“"] },
];

