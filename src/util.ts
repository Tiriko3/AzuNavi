// Kleine Helfer für Zufall, zerrissenes Papier und Stadt-Silhouette

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** SVG-Pfad für ein zerrissenes Blatt (w x h) */
export function torn(w: number, h: number, jag: number, seed: number): string {
  const r = rng(seed);
  const pts: [number, number][] = [];
  const step = () => 8 + r() * 14;
  for (let x = 0; x <= w; x += step()) pts.push([x, (r() - 0.5) * 2 * jag]);
  for (let y = step(); y <= h; y += step()) pts.push([w + (r() - 0.5) * jag, y]);
  for (let x = w; x >= 0; x -= step()) pts.push([x, h + (r() - 0.5) * 2 * jag]);
  for (let y = h - step(); y > 0; y -= step()) pts.push([(r() - 0.5) * jag, y]);
  return pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + "Z";
}

/** SVG-Pfad für eine Stadt-Silhouette (1600 x 240) */
export function skylinePath(seed: number): string {
  const r = rng(seed);
  const W = 1600, H = 240;
  let x = 0;
  const pts: [number, number][] = [[0, H]];
  while (x < W) {
    const w = 24 + r() * 60;
    const h = 40 + r() * 110;
    pts.push([x, H - h]);
    if (r() < 0.22) pts.push([x + w / 2, H - h - 30 - r() * 40]);
    pts.push([x + w, H - h]);
    x += w;
  }
  pts.push([W, H]);
  return pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(0) + " " + p[1].toFixed(0)).join(" ") + "Z";
}

/** Kalenderwoche nach ISO */
export function kwNumber(n: Date): number {
  const t = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
}

/* ---------- Datum ---------- */
export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateParts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    day: String(dt.getDate()),
    month: dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase(),
    weekday: dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "").toUpperCase(),
    kw: kwNumber(dt),
  };
}

/* ---------- Projektvorschlag ---------- */
// Vergleicht den Notiztext mit Projektnamen: ganzer Name im Text zählt 3 Punkte,
// jedes längere Namenswort zählt 1 Punkt. Gleicher Bereich gewinnt bei Gleichstand.
export function suggestProject<T extends { id: number; name: string; scope: string }>(
  text: string, scope: string, projects: T[]
): T | null {
  const t = text.toLowerCase();
  if (t.trim().length < 3) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const p of projects) {
    const name = p.name.toLowerCase().trim();
    if (!name) continue;
    let score = t.includes(name) ? 3 : 0;
    for (const w of name.split(/[\s\-_/]+/)) if (w.length >= 4 && t.includes(w)) score += 1;
    if (score === 0) continue;
    if (p.scope === scope) score += 0.5;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}
