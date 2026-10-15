import { useMemo } from "react";
import { rng } from "./util";

// Wellenlicht (Caustics) und aufsteigende Partikel im Hintergrund
export function Water() {
  const { blobs, petals } = useMemo(() => {
    const r = rng(7);
    const blobs: { pts: string; delay: string; dur: string }[] = [];
    for (let i = 0; i < 34; i++) {
      const x = r() * 1600, y = r() * 420, w = 40 + r() * 130, hh = 14 + r() * 34;
      const pts: string[] = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        pts.push(
          (x + Math.cos(a) * w * (0.6 + r() * 0.5)).toFixed(0) + "," +
          (y + Math.sin(a) * hh * (0.6 + r() * 0.5)).toFixed(0)
        );
      }
      blobs.push({
        pts: pts.join(" "),
        delay: (-r() * 9).toFixed(1) + "s",
        dur: (7 + r() * 6).toFixed(1) + "s",
      });
    }
    const petals: { cls: string; style: React.CSSProperties }[] = [];
    for (let i = 0; i < 16; i++) {
      petals.push({
        cls: r() < 0.4 ? "petal c" : "petal",
        style: {
          left: (r() * 1500).toFixed(0) + "px",
          top: (700 + r() * 200).toFixed(0) + "px",
          animationDuration: (16 + r() * 18).toFixed(1) + "s",
          animationDelay: (-r() * 30).toFixed(1) + "s",
          transform: `scale(${(0.6 + r() * 1.1).toFixed(2)})`,
        },
      });
    }
    return { blobs, petals };
  }, []);

  return (
    <>
      <div id="depth" />
      <div id="caustics">
        <svg viewBox="0 0 1600 500" preserveAspectRatio="none">
          {blobs.map((b, i) => (
            <polygon key={i} className="blob" points={b.pts}
              style={{ animationDelay: b.delay, animationDuration: b.dur }} />
          ))}
        </svg>
      </div>
      <div id="petals">
        {petals.map((p, i) => <i key={i} className={p.cls} style={p.style} />)}
      </div>
    </>
  );
}
