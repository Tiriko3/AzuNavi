// Nami und die Hilfe-Texte (klein gehalten, damit der „?“-Knopf nichts Großes nachladen muss)
import namiGruss from "../assets/figuren/nami_gruss.webp";
import namiErklaert from "../assets/figuren/nami_erklaert.webp";
import namiSchreibt from "../assets/figuren/nami_schreibt.webp";
import namiPinnt from "../assets/figuren/nami_pinnt.webp";
import namiDenkt from "../assets/figuren/nami_denkt.webp";
import namiJubelt from "../assets/figuren/nami_jubelt.webp";

export const NAMI = { gruss: namiGruss, erklaert: namiErklaert, schreibt: namiSchreibt, pinnt: namiPinnt, denkt: namiDenkt, jubelt: namiJubelt };
export type Pose = keyof typeof NAMI;

// Rundgang durch die App: kurz und mit Beispielen
export const TOUR: { title: string; pose: Pose; text: string; tips: string[] }[] = [
  { title: "Das Hauptmenü", pose: "erklaert", text: "Das Menü ist ein Rad. Der Punkt in der Mitte ist ausgewählt.", tips: ["Mausrad oder Pfeiltasten ↑ ↓ drehen das Rad", "Klick auf einen Punkt dreht ihn in die Mitte, Klick auf die Mitte öffnet ihn", "Enter öffnet, Esc geht zurück", "Tab wechselt zwischen Alles, Schule und Arbeit, die Farben ändern sich mit"] },
  { title: "Notizen", pose: "schreibt", text: "Eine Notiz ist eine erledigte Aufgabe. Aus deinen Notizen entsteht später das Berichtsheft.", tips: ["Datum, Bereich und Text eintragen", "Qualifikation aus der IHK-Liste wählen", "Projekt und Personen verknüpfen, Bilder anhängen", "„Text prüfen“ findet Tippfehler und Grammatik-Fehler"] },
  { title: "Kontakte", pose: "gruss", text: "Dein Personenbaum: Ausbilder, Kollegen, Lehrkräfte.", tips: ["„+ Neue Person“, mit „Zugeordnet zu“ entsteht der Baum", "Porträts machen die Personen-Snippets in Projekten lebendig"] },
  { title: "Projekte", pose: "pinnt", text: "Eine Detektiv-Pinnwand: Projekte als Zettel, rote und blaue Fäden verbinden sie.", tips: ["Doppelklick öffnet ein Projekt mit „Was gemacht“, „Was als Nächstes“ und Dateien", "Reiter „Mindmap“ zeigt alles als Netz", "Mausrad zoomt, Ziehen verschiebt"] },
  { title: "Dateien", pose: "denkt", text: "Deine echten Ordner Arbeit und Schule. Die Ordner-Assistentin sortiert Dateien ein.", tips: ["Beim ersten Öffnen den Hauptordner wählen", "Dateien aufs Fenster ziehen oder „+ Datei hinzufügen“", "Nichts wird gelöscht oder überschrieben, alles lässt sich rückgängig machen"] },
  { title: "Berichtsheft", pose: "schreibt", text: "Die Katze baut deinen Wochenbericht aus den Notizen.", tips: ["Woche wählen, Entwurf prüfen und anpassen", "„Als Word exportieren“ im Format deiner Vorlage", "Reiter „Fähigkeiten“ zeigt, welche Qualifikationen noch offen sind"] },
  { title: "System", pose: "erklaert", text: "Hier stellst du die App ein.", tips: ["Schrift größer, Animationen aus, Maskottchen ausblenden", "„Daten mitnehmen“: Sicherung für einen anderen Laptop", "Tutorial wiederholen oder alles zurücksetzen"] },
];

