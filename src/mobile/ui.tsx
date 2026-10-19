// Bausteine der Handy-Oberfläche: Icons (eigene, schlichte SVG-Linien), Blätter von unten, Umschalter, Leerzustände
// und die Zurück-Geste (Android): sie schließt immer die oberste offene Ebene.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const P: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5",
  note: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.2 3.2 0 0 1 0 6.2M18 14.8c2 .6 3.2 2.3 3.5 5.2",
  book: "M5 4h10.5A2.5 2.5 0 0 1 18 6.5V21H7.5A2.5 2.5 0 0 1 5 18.5zM5 18.5A2.5 2.5 0 0 1 7.5 16H18M9 8h6M9 11.5h4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.6L4.6 9.7l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.6z",
  plus: "M12 5v14M5 12h14", x: "M6 6l12 12M18 6 6 18", check: "M5 12.5 10 17.5 19 7",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20",
  left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7", trash: "M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4", phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  mail: "M3.5 6h17v12h-17zM4 7l8 6 8-6", calendar: "M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7",
  cloud: "M7 18h10.5a4 4 0 0 0 .5-8A6 6 0 0 0 6.5 9.5 4.3 4.3 0 0 0 7 18z", export: "M12 15V3.5M7.5 8 12 3.5 16.5 8M5 13v7h14v-7",
};
export function Icon({ n, size = 24, stroke = 2 }: { n: keyof typeof P | string; size?: number; stroke?: number }) {
  return <svg className="m-ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n] ?? ""} /></svg>;
}

/* ---------- Zurück-Geste: Stapel offener Ebenen ---------- */
const stack: { id: number; close: () => void }[] = [];
let seq = 0, ignore = 0, listening = false;
function listen() {
  if (listening) return; listening = true;
  window.addEventListener("popstate", () => {
    if (ignore > 0) { ignore--; return; }
    stack.pop()?.close();
  });
}
/** Solange `active` wahr ist, schließt die Zurück-Geste diese Ebene (Blatt, Detailseite, Reiter). */
export function useBackLayer(active: boolean, close: () => void) {
  const ref = useRef(close); ref.current = close;
  useEffect(() => {
    if (!active) return;
    listen();
    const id = ++seq;
    stack.push({ id, close: () => ref.current() });
    window.history.pushState({ m: id }, "");
    return () => {
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) { stack.splice(i, 1); ignore++; window.history.back(); }   // per Knopf geschlossen: Verlaufseintrag wieder entfernen
    };
  }, [active]);
}

/* ---------- Blatt von unten (Bearbeiten, Auswahl, Details) ---------- */
export function Sheet({ open, onClose, title, children, footer, tall }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  useBackLayer(open, onClose);
  if (!open) return null;
  // Über ein Portal in die eigene Ebene der App: so hängt das Blatt nie an einer animierten (transformierten) Seite
  const layer = document.getElementById("m-layer") ?? document.body;
  return createPortal(
    <div className="m-sheet-bg" onClick={onClose}>
      <div className={"m-sheet" + (tall ? " tall" : "")} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="m-sheet-grip" />
        <header className="m-sheet-head"><h2>{title}</h2><button className="m-iconbtn" onClick={onClose} aria-label="Schließen"><Icon n="x" /></button></header>
        <div className="m-sheet-body">{children}</div>
        {footer && <footer className="m-sheet-foot">{footer}</footer>}
      </div>
    </div>, layer);
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="m-seg">{options.map(([v, l]) => <button key={v} className={v === value ? "on" : ""} data-v={v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export function Empty({ img, title, text, children }: { img?: string; title: string; text: string; children?: ReactNode }) {
  return <div className="m-empty">{img && <img src={img} alt="" />}<b>{title}</b><p>{text}</p>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="m-field"><span>{label}</span>{children}</label>;
}

export const scopeLabel = (s: string) => (s === "schule" ? "Schule" : s === "arbeit" ? "Arbeit" : "Alles");
export function relDay(iso: string): string {
  const d = new Date(iso + "T00:00:00"), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Heute"; if (diff === 1) return "Gestern"; if (diff === -1) return "Morgen";
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}
