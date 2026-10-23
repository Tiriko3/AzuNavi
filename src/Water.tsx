// Hintergrund des Hauptmenüs: bewegtes Wasser (nur der Wasserteil aus dem Gemini-Video, rechte Bildhälfte, Bild für Bild mit KI auf 4K hochskaliert)
// oder bei Nacht das Mond-Bild. Die früheren gezeichneten Wasserflecken und fliegenden Teilchen sind seit 0.7.0 entfernt.
import { useRef } from "react";
import waterLoop from "./assets/media/water-loop.webm?url";
import waterPoster from "./assets/media/water-poster.webp?url";
import nightBg from "./assets/bg/nacht.webp";
import { useKeepPlaying } from "./web/motion";

export function Water({ night, moving }: { night: boolean; moving: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useKeepPlaying(ref, moving && !night);
  if (night) return <div id="nightbg" style={{ backgroundImage: `url(${nightBg})` }} aria-hidden="true" />;
  return (
    <div id="waterbg" aria-hidden="true">
      {moving
        ? <video ref={ref} src={waterLoop} poster={waterPoster} autoPlay muted loop playsInline preload="auto" />
        : <img src={waterPoster} alt="" />}
    </div>
  );
}
