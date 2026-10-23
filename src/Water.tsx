// Hintergrund des Hauptmenüs: bewegtes Wasser (nur der Wasserteil aus dem Gemini-Video, rechte Bildhälfte) oder bei Nacht das Mond-Bild.
// Die früheren gezeichneten Wasserflecken und fliegenden Teilchen sind seit 0.7.0 entfernt.
import { useEffect, useRef, useState } from "react";
import waterLoop from "./assets/media/water-loop.webm?url";
import waterPoster from "./assets/media/water-poster.webp?url";
import nightBg from "./assets/bg/nacht.webp";
import { motionOk } from "./web/Intro";

export function Water({ night }: { night: boolean }) {
  const [moving] = useState(motionOk);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const sync = () => { if (document.hidden) v.pause(); else v.play().catch(() => {}); };   // unsichtbar = kein Strom verbrauchen
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [night]);
  if (night) return <div id="nightbg" style={{ backgroundImage: `url(${nightBg})` }} aria-hidden="true" />;
  return (
    <div id="waterbg" aria-hidden="true">
      {moving
        ? <video ref={ref} src={waterLoop} poster={waterPoster} autoPlay muted loop playsInline preload="auto" />
        : <img src={waterPoster} alt="" />}
    </div>
  );
}
