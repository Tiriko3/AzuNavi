// Effekte der Handy-Oberfläche: lebendiger Hintergrund, Begleiter mit Sprechblase, Konfetti, Übergangs-Wischer.
// Alles respektiert „Animationen aus“ (no-anim), „Maskottchen aus“ (no-mascot) und „Bewegung reduzieren“ des Systems.
import { useEffect, useState } from "react";
import namiGruss from "../assets/figuren/nami_gruss.webp";
import namiJubelt from "../assets/figuren/nami_jubelt.webp";
import namiPinnt from "../assets/figuren/nami_pinnt.webp";
import namiSchreibt from "../assets/figuren/nami_schreibt.webp";
import namiDenkt from "../assets/figuren/nami_denkt.webp";
import namiErklaert from "../assets/figuren/nami_erklaert.webp";
import katzeZeigt from "../assets/figuren/katze_zeigt.webp";
import katzeSammelt from "../assets/figuren/katze_sammelt.webp";
import katzeSchlaeft from "../assets/figuren/katze_schlaeft.webp";
import katzeSchreibt from "../assets/figuren/katze_schreibt.webp";
import edaGruss from "../assets/figuren/prof_gruss.webp";
import edaDenkt from "../assets/figuren/prof_denkt.webp";
import edaFertig from "../assets/figuren/prof_fertig.webp";

export const MASCOTS = {
  nami: { name: "Nami", color: "#3db8ff", poses: { gruss: namiGruss, jubelt: namiJubelt, pinnt: namiPinnt, schreibt: namiSchreibt, denkt: namiDenkt, erklaert: namiErklaert } },
  cara: { name: "Caramella", color: "#b45cff", poses: { zeigt: katzeZeigt, sammelt: katzeSammelt, schlaeft: katzeSchlaeft, schreibt: katzeSchreibt } },
  eda: { name: "Eda", color: "#19c2b4", poses: { gruss: edaGruss, denkt: edaDenkt, fertig: edaFertig } },
} as const;
export type Who = keyof typeof MASCOTS;
export const pose = (who: Who, p: string): string => (MASCOTS[who].poses as Record<string, string>)[p] ?? Object.values(MASCOTS[who].poses)[0];

/** Hintergrund: Verlauf + Rasterpunkte + Lichtstreifen + aufsteigende Blasen (Namis Wasser) */
export function Backdrop() {
  return (
    <div className="m-backdrop" aria-hidden="true">
      <div className="m-dots" /><div className="m-beam b1" /><div className="m-beam b2" />
      {Array.from({ length: 9 }, (_, i) => <i key={i} className="m-bubble" style={{ ["--x" as string]: `${(i * 37) % 100}%`, ["--s" as string]: `${8 + ((i * 7) % 18)}px`, ["--d" as string]: `${9 + ((i * 5) % 9)}s`, ["--w" as string]: `${-((i * 3) % 9)}s` }} />)}
    </div>
  );
}

/** Begleiter springt mit Sprechblase herein (ersetzt die nüchterne Meldung) */
export interface Say { who: Who; pose: string; text: string; id: number }
export function MascotToast({ say }: { say: Say | null }) {
  if (!say) return null;
  const m = MASCOTS[say.who];
  return (
    <div className="m-say" key={say.id} role="status" style={{ ["--mc" as string]: m.color }}>
      <img className="m-mascot" src={pose(say.who, say.pose)} alt="" />
      <div className="m-bubble-say"><b>{m.name}</b>{say.text}</div>
    </div>
  );
}

/** Konfetti-Explosion; neu auslösen über einen neuen `fire`-Wert */
const COLORS = ["#ff2d5f", "#3db8ff", "#ffd23f", "#7b5cff", "#19c2b4", "#ffffff"];
export function Confetti({ fire }: { fire: number }) {
  const [n, setN] = useState(0);
  useEffect(() => { if (fire) { setN(fire); const t = setTimeout(() => setN(0), 1600); return () => clearTimeout(t); } }, [fire]);
  if (!n) return null;
  return (
    <div className="m-confetti" key={n} aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => <i key={i} style={{ ["--a" as string]: `${(i * 360) / 28 + (i % 3) * 7}deg`, ["--r" as string]: `${110 + (i * 23) % 120}px`, ["--c" as string]: COLORS[i % COLORS.length], ["--t" as string]: `${(i * 47) % 360}deg` }} />)}
    </div>
  );
}

/** Schräge Balken fegen beim Reiterwechsel über den Bildschirm (Richtung je nach Reiter) */
export function Wipe({ n, dir }: { n: number; dir: 1 | -1 }) {
  if (!n) return null;
  return <div className={"m-wipe" + (dir < 0 ? " rev" : "")} key={n} aria-hidden="true"><i /><i /></div>;
}
