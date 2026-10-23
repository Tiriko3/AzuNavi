// Bilder für leere Seiten (ab 0.7.1): ein Gegenstand (Kiste, Zettel, Ordner) und Mizu mit passender Pose. Mizu entfällt bei „Maskottchen aus“.
import { NAMI } from "./tutorial/tour";
import kiste from "./assets/ui/leer-kiste.webp";
import zettel from "./assets/ui/leer-zettel.webp";
import ordner from "./assets/ui/leer-ordner.webp";

const ART = { kiste, zettel, ordner };
export function EmptyArt({ kind, pose }: { kind: keyof typeof ART; pose: keyof typeof NAMI }) {
  return (
    <>
      <img className="emptyart" src={ART[kind]} alt="" draggable={false} />
      <img className="emptymizu" src={NAMI[pose]} alt="" draggable={false} />
    </>
  );
}
