import { useEffect, useState } from "react";
import { fileUrl } from "./files";

export function useFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setUrl(null);
    if (path) fileUrl(path).then((u) => { if (on) setUrl(u); });
    return () => { on = false; };
  }, [path]);
  return url;
}

const COLORS = ["#ff2d5f", "#1457ff", "#3a3fb4", "#1db4ff", "#0a8a8a", "#8a3ab4"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Rundes "Charakter-Snippet": Porträt oder Initialen */
export function Avatar({ name, path, size = 48, title }: { name: string; path?: string | null; size?: number; title?: string }) {
  const url = useFileUrl(path);
  const color = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" title={title ?? name}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.36) }}>
      {url ? <img src={url} alt="" draggable={false} /> : initials(name)}
    </span>
  );
}

export function Thumb({ path, onRemove, onOpen }: { path: string; onRemove?: () => void; onOpen: (url: string) => void }) {
  const url = useFileUrl(path);
  return (
    <span className="thumb">
      {url ? <img src={url} alt="" onClick={() => onOpen(url)} draggable={false} /> : <i>…</i>}
      {onRemove && <button type="button" className="thumbx" aria-label="Bild entfernen" onClick={onRemove}>×</button>}
    </span>
  );
}
