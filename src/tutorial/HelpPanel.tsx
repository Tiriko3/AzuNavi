import { NAMI, TOUR } from "./tour";
import type { ItemId } from "../items";
import { usePrefs } from "../prefs";

// Welche Hilfe-Karte gehört zu welcher Seite (null = Hauptmenü)
const INDEX: Record<string, number> = { menu: 0, notizen: 1, kontakte: 2, projekte: 3, dateien: 4, berichtsheft: 5, system: 6 };
const EXTRA: Record<string, string[]> = {
  menu: ["F1 öffnet diese Hilfe, F11 schaltet Vollbild ein/aus", "M schaltet den Ton ein/aus"],
  notizen: ["„Importieren“ holt alte Berichtshefte (Word/PDF) als Notizen", "Esc schließt den Editor, nochmal Esc geht zum Menü"],
  projekte: ["Doppelklick auf einen Zettel öffnet das Projekt", "„Faden spannen“ und zwei Zettel anklicken verbindet sie"],
  berichtsheft: ["◀ ▶ wechselt die Woche", "„Neu aus Notizen“ baut den Entwurf frisch"],
  system: ["Anzeige: Fenster, randlos oder Vollbild", "„Sicherung erstellen“ zum Mitnehmen auf einen anderen Laptop"],
};

/** Der „?“-Knopf: kurze Hilfe zu der Seite, auf der du gerade bist */
export function HelpPanel({ pageId, onClose, onTutorial }: { pageId: ItemId | null; onClose: () => void; onTutorial: () => void }) {
  const { prefs } = usePrefs();
  const key = pageId ?? "menu";
  const card = TOUR[INDEX[key] ?? 0];
  return (
    <div className="helppanel" role="dialog" aria-label="Hilfe">
      {prefs.mascot && <img className="helpnami" src={NAMI[card.pose]} alt="" draggable={false} />}
      <div className="helpcard paperbox">
        <div className="tuthead"><span className="tutname">Nami hilft</span><button className="mini" onClick={onClose}>Schließen (Esc)</button></div>
        <h3>{card.title}</h3>
        <p>{card.text}</p>
        <ul className="tuttips">{[...card.tips, ...(EXTRA[key] ?? [])].map((t) => <li key={t}>{t}</li>)}</ul>
        <div className="inl"><button className="mini hot" onClick={onTutorial}>Ganzes Tutorial nochmal</button></div>
      </div>
    </div>
  );
}
