export type ItemId = "notizen" | "kontakte" | "berichtsheft" | "projekte" | "dateien" | "system";
export type ScopeId = "alle" | "schule" | "arbeit";

export interface MenuItem {
  id: ItemId;
  label: string;
  desc: string;
  etappe: number; // in welcher Etappe der Bereich gebaut wird
}

export const ITEMS: MenuItem[] = [
  { id: "notizen", label: "Notizen", desc: "Erledigtes festhalten, mit Qualifikation und Anhängen", etappe: 2 },
  { id: "kontakte", label: "Kontakte", desc: "Menschen und ihre Verbindungen im Personenbaum", etappe: 3 },
  { id: "berichtsheft", label: "Berichtsheft", desc: "Wochenbericht aus deinen Notizen, Export in deiner Vorlage", etappe: 8 },
  { id: "projekte", label: "Projekte", desc: "Pinnwand mit allen Projekten, Fortschritt und nächsten Schritten", etappe: 5 },
  { id: "dateien", label: "Dateien", desc: "Deine echten Ordner, Dateien einsortieren mit Eda", etappe: 4 },
  { id: "system", label: "System", desc: "Ton, Datenbank und Einstellungen", etappe: 1 },
];

export const SCOPES: { id: ScopeId; label: string }[] = [
  { id: "alle", label: "Alles" },
  { id: "schule", label: "Schule" },
  { id: "arbeit", label: "Arbeit" },
];
