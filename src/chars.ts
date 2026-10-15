// Auswählbare Hauptfiguren (Tutorial → „Wähle deine Figur“).
// Jede Figur hat sechs Posen, eine je Menüpunkt. Dateien: src/assets/figuren/chars/<id>/<pose>.webp
import type { ItemId } from "./items";
import ichNotizen from "./assets/figuren/ich_notizen.webp";
import ichKontakte from "./assets/figuren/ich_kontakte.webp";
import ichBericht from "./assets/figuren/ich_berichtsheft.webp";
import ichProjekte from "./assets/figuren/ich_projekte.webp";
import ichDateien from "./assets/figuren/ich_dateien.webp";
import ichSystem from "./assets/figuren/ich_system.webp";

export interface Character { id: string; name: string; poses: Record<ItemId, string> }

const POSE_IDS: ItemId[] = ["notizen", "kontakte", "berichtsheft", "projekte", "dateien", "system"];
const NAMES: Record<string, string> = { kai: "Kai", leo: "Leo", mira: "Mira", nova: "Nova", ruby: "Ruby" };

// alle Bilder im Figuren-Ordner einsammeln (neue Figuren erscheinen automatisch)
const files = import.meta.glob("./assets/figuren/chars/*/*.webp", { eager: true, import: "default" }) as Record<string, string>;
const found = new Map<string, Partial<Record<ItemId, string>>>();
for (const [path, url] of Object.entries(files)) {
  const m = path.match(/chars\/([^/]+)\/([^/]+)\.webp$/);
  if (!m) continue;
  const poses = found.get(m[1]) ?? {};
  poses[m[2] as ItemId] = url;
  found.set(m[1], poses);
}

export const CHARACTERS: Character[] = [
  { id: "eigene", name: "Original", poses: { notizen: ichNotizen, kontakte: ichKontakte, berichtsheft: ichBericht, projekte: ichProjekte, dateien: ichDateien, system: ichSystem } },
  ...[...found.entries()]
    .filter(([, p]) => POSE_IDS.every((k) => p[k]))
    .map(([id, p]) => ({ id, name: NAMES[id] ?? id, poses: p as Record<ItemId, string> })),
];
export const charById = (id: string | null | undefined) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
