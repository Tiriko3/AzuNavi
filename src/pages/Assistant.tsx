import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { baseName, extOf, fsapi, relParts, samePath, type DirNode } from "../fsapi";
import { folderProject, suggestFor, type Roots } from "../db/filesRepo";
import type { Project, Scope } from "../db/repo";
import { moveItem } from "../mover";
import { suggestProject } from "../util";
import profGruss from "../assets/figuren/prof_gruss.webp";
import profDenkt from "../assets/figuren/prof_denkt.webp";
import profFertig from "../assets/figuren/prof_fertig.webp";

export type Pose = "gruss" | "denkt" | "fertig";
const POSE_IMG: Record<Pose, string> = { gruss: profGruss, denkt: profDenkt, fertig: profFertig };

const SCOPE_LABEL: Record<Scope, string> = { arbeit: "Arbeit", schule: "Schule" };
export const ACCENT = "#19e3b1"; // Akzentfarbe des Evaen

export interface Opt { label: string; onPick: () => void; primary?: boolean; hint?: string }

/* ---------- Dialogbox im Persona-Stil ---------- */
export function DialogBox({ name, text, options, children, onClose, pose = "gruss" }: {
  name: string; text: string; options: Opt[]; children?: ReactNode; onClose?: () => void; pose?: Pose;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((n) => { if (n >= text.length) { clearInterval(t); return n; } return n + 2; }), 16);
    return () => clearInterval(t);
  }, [text]);
  const optsRef = useRef(options);
  optsRef.current = options;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= optsRef.current.length) { e.preventDefault(); optsRef.current[n - 1].onPick(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="asst" role="dialog" aria-label={name}>
      <div className="asst-fig" aria-hidden="true">
        <img key={pose} src={POSE_IMG[pose]} alt="" draggable={false} />
        {pose === "denkt" && <span className="asst-badge" key="q">?</span>}
        {pose === "fertig" && <span className="asst-badge" key="ok">✓</span>}
      </div>
      <div className="asst-box">
        <div className="asst-name">{name}</div>
        {onClose && <button className="asst-x" aria-label="Schließen" onClick={onClose}>Esc</button>}
        <p className="asst-text" onClick={() => setShown(text.length)}>{text.slice(0, shown)}<span className="caret" /></p>
        {children}
        <div className="asst-opts">
          {options.map((o, i) => (
            <button key={i} className={"asst-opt" + (o.primary ? " primary" : "")} onClick={o.onPick}>
              <kbd>{i + 1}</kbd><span>{o.label}</span>{o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Helfer ---------- */
export function flatten(n: DirNode | undefined, depth = 0): { path: string; name: string; depth: number }[] {
  if (!n) return [];
  return [{ path: n.path, name: n.name, depth }, ...n.children.flatMap((c) => flatten(c, depth + 1))];
}
export function prettyFolder(path: string, roots: Roots): string {
  for (const s of ["arbeit", "schule"] as Scope[]) {
    const r = roots[s];
    if (r && (samePath(path, r) || relParts(path, r).length)) return [SCOPE_LABEL[s], ...relParts(path, r)].join(" › ");
  }
  return path;
}
const tok = (s: string) => s.toLowerCase().replace(/\.[^.]+$/, "").split(/[^a-z0-9äöüß]+/).filter((t) => t.length >= 4);

type Step = "start" | "scope" | "folder" | "project" | "confirm" | "conflict" | "error" | "done";
interface Result { name: string; to?: string; mode?: string; skipped?: boolean }

/* ---------- Eva ---------- */
export function Assistant({ items, roots, trees, projects, folderLinks, defaultScope, fixedDest, onClose }: {
  items: string[]; roots: Roots; trees: Partial<Record<Scope, DirNode>>; projects: Project[];
  folderLinks: { path: string; projectId: number }[]; defaultScope: Scope; fixedDest?: string | null;
  onClose: (lastFolder: string | null) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState<Step>("start");
  const [isDir, setIsDir] = useState(false);
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [folder, setFolder] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [sugg, setSugg] = useState<{ scope: Scope | null; folders: string[]; projectId: number | null }>({ scope: null, folders: [], projectId: null });
  const [freeName, setFreeName] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [lastFolder, setLastFolder] = useState<string | null>(fixedDest ?? null);

  const src = items[idx];
  const name = src ? baseName(src) : "";
  const count = items.length > 1 ? ` (${idx + 1} von ${items.length})` : "";

  const nextItem = (r: Result, msg?: string) => {
    setResults((x) => [...x, r]);
    setNote(msg ?? "");
    if (idx + 1 < items.length) { setIdx(idx + 1); setStep("start"); } else setStep("done");
  };

  const run = async (dest: string, pid: number | null | undefined, newName?: string) => {
    const out = await moveItem({ src, destDir: dest, roots, via: fixedDest ? "hier" : "assistent", projectId: pid, newName });
    if (out.ok) {
      setLastFolder(dest);
      nextItem({ name: newName || name, to: out.to, mode: out.mode },
        out.mode === "copied" ? `„${newName || name}“ liegt auf einem anderen Laufwerk: kopiert, das Original ist noch da.` : `Erledigt: „${newName || name}“ ist jetzt in ${prettyFolder(dest, roots)}.`);
    } else if (out.conflict) { setFreeName(out.freeName); setFolder(dest); setStep("conflict"); }
    else { setError(out.error); setFolder(dest); setStep("error"); }
  };

  // Neues Element: Vorschläge laden (oder bei "Hier einfügen" direkt verschieben)
  useEffect(() => {
    if (step !== "start" || !src) return;
    let on = true;
    (async () => {
      const fs = await fsapi();
      const dir = await fs.isDir(src);
      if (!on) return;
      setIsDir(dir); setFilter(""); setError("");
      if (fixedDest) { await run(fixedDest, undefined); return; }
      const s = await suggestFor(name);
      if (!on) return;
      setSugg(s);
      setScope(s.scope ?? defaultScope);
      setFolder(null); setProjectId(null);
      setStep("scope");
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, idx]);

  const allFolders = useMemo(() => flatten(trees[scope]), [trees, scope]);
  const folderSuggestions = useMemo(() => {
    const out: string[] = [];
    for (const f of sugg.folders) {
      const hit = allFolders.find((a) => samePath(a.path, f));
      if (hit && !out.some((o) => samePath(o, hit.path))) out.push(hit.path);
    }
    // Ordnernamen, die dem Dateinamen ähneln (längste gemeinsame Wortanfänge zuerst)
    const nt = tok(name);
    const common = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
    const byName = allFolders.slice(1)
      .map((f) => ({ path: f.path, score: Math.max(0, ...tok(f.name).flatMap((a) => nt.map((b) => common(a, b)))) }))
      .filter((x) => x.score >= 4)
      .sort((a, b) => b.score - a.score);
    for (const x of byName) if (!out.some((o) => samePath(o, x.path))) out.push(x.path);
    return out.slice(0, 3);
  }, [sugg, allFolders, name]);

  const projectSuggestion = useMemo(() => {
    if (sugg.projectId && projects.some((p) => p.id === sugg.projectId)) return projects.find((p) => p.id === sugg.projectId)!;
    const fp = folder ? folderProject(folder, folderLinks) : null;
    if (fp) return projects.find((p) => p.id === fp.projectId) ?? null;
    return suggestProject(name.replace(/[_\-.]+/g, " "), scope, projects);
  }, [sugg, folder, folderLinks, projects, name, scope]);

  const close = () => onClose(lastFolder);
  const what = isDir ? "den Ordner" : "die Datei";
  const pre = note ? note + " " : "";

  if (step === "start") return <DialogBox name="Eva" pose={note ? "fertig" : "gruss"} text={`${pre}Moment, ich schaue mir „${name}“ an …`} options={[]} onClose={close} />;

  if (step === "scope") {
    const rootMissing = (s: Scope) => !roots[s];
    return (
      <DialogBox name="Eva" onClose={close} pose={note ? "fertig" : "gruss"}
        text={`${pre}Ich habe ${what} „${name}“${count}. Gehört das zu Arbeit oder Schule?`}
        options={[
          ...(["arbeit", "schule"] as Scope[]).filter((s) => !rootMissing(s)).map((s) => ({
            label: SCOPE_LABEL[s], primary: scope === s, hint: sugg.scope === s ? "Vorschlag" : undefined,
            onPick: () => { setScope(s); setStep("folder"); },
          })),
          { label: "Überspringen", onPick: () => nextItem({ name, skipped: true }) },
        ]} />
    );
  }

  if (step === "folder") {
    const root = roots[scope]!;
    const shown = allFolders.filter((f) => !filter.trim() || f.name.toLowerCase().includes(filter.trim().toLowerCase()));
    const pick = (p: string) => { setFolder(p); setStep("project"); };
    return (
      <DialogBox name="Eva" onClose={close} pose="denkt"
        text={folderSuggestions.length ? `Wohin damit in ${SCOPE_LABEL[scope]}? Das hier passt vermutlich:` : `Wohin damit in ${SCOPE_LABEL[scope]}? Such dir unten einen Ordner aus.`}
        options={[
          ...folderSuggestions.map((p, i) => ({ label: prettyFolder(p, roots), primary: i === 0, hint: i === 0 ? "Vorschlag" : undefined, onPick: () => pick(p) })),
          { label: "Zurück", onPick: () => setStep("scope") },
        ]}>
        <div className="asst-picker">
          <input className="field" placeholder="Ordner suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="asst-list">
            {shown.map((f) => (
              <button key={f.path} className="asst-folder" style={{ paddingLeft: 10 + (filter ? 0 : f.depth * 18) }} onClick={() => pick(f.path)}>
                {f.depth === 0 ? <b>{SCOPE_LABEL[scope]} (oberste Ebene)</b> : filter ? prettyFolder(f.path, roots) : f.name}
              </button>
            ))}
            {shown.length === 0 && <span className="small">Kein Ordner gefunden.</span>}
            {!trees[scope] && <span className="small">Der Ordner {root} wurde nicht gefunden.</span>}
          </div>
        </div>
      </DialogBox>
    );
  }

  if (step === "project") {
    const others = projects.filter((p) => p.id !== projectSuggestion?.id);
    const choose = (pid: number | null) => { setProjectId(pid); setStep("confirm"); };
    return (
      <DialogBox name="Eva" onClose={close} pose="denkt"
        text={isDir ? `Soll der ganze Ordner zu einem Projekt gehören?` : `Gehört „${name}“ zu einem Projekt?`}
        options={[
          ...(projectSuggestion ? [{ label: projectSuggestion.name, primary: true, hint: "Vorschlag", onPick: () => choose(projectSuggestion.id) }] : []),
          { label: "Kein Projekt", primary: !projectSuggestion, onPick: () => choose(null) },
          { label: "Zurück", onPick: () => setStep("folder") },
        ]}>
        {others.length > 0 && (
          <div className="asst-picker inline">
            <select className="field" value="" onChange={(e) => e.target.value && choose(Number(e.target.value))}>
              <option value="">Anderes Projekt wählen …</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name} ({SCOPE_LABEL[p.scope]})</option>)}
            </select>
          </div>
        )}
      </DialogBox>
    );
  }

  if (step === "confirm") {
    const proj = projects.find((p) => p.id === projectId);
    return (
      <DialogBox name="Eva" onClose={close} pose="denkt"
        text={`Ich verschiebe ${what} „${name}“ nach ${prettyFolder(folder!, roots)}${proj ? ` und verknüpfe es mit „${proj.name}“` : ""}. Passt das?`}
        options={[
          { label: "Verschieben", primary: true, onPick: () => run(folder!, projectId) },
          { label: "Anderer Ordner", onPick: () => setStep("folder") },
          { label: "Überspringen", onPick: () => nextItem({ name, skipped: true }) },
        ]} />
    );
  }

  if (step === "conflict") {
    return (
      <DialogBox name="Eva" onClose={close} pose="denkt"
        text={`In ${prettyFolder(folder!, roots)} gibt es schon etwas mit dem Namen „${name}“. Ich überschreibe nie etwas. Soll ich es als „${freeName}“ ablegen?`}
        options={[
          { label: `Als „${freeName}“ ablegen`, primary: true, onPick: () => run(folder!, fixedDest ? undefined : projectId, freeName) },
          ...(!fixedDest ? [{ label: "Anderer Ordner", onPick: () => setStep("folder") }] : []),
          { label: "Überspringen", onPick: () => nextItem({ name, skipped: true }) },
        ]} />
    );
  }

  if (step === "error") {
    return (
      <DialogBox name="Eva" onClose={close} pose="denkt"
        text={`Das hat nicht geklappt: ${error}`}
        options={[
          { label: "Überspringen", primary: true, onPick: () => nextItem({ name, skipped: true }) },
          { label: "Nochmal versuchen", onPick: () => run(folder!, fixedDest ? undefined : projectId) },
        ]} />
    );
  }

  // fertig
  const moved = results.filter((r) => !r.skipped).length;
  const skipped = results.length - moved;
  const copied = results.filter((r) => r.mode === "copied").length;
  return (
    <DialogBox name="Eva" onClose={close} pose="fertig"
      text={`${pre}Fertig! ${moved} ${moved === 1 ? "Element" : "Elemente"} einsortiert${skipped ? `, ${skipped} übersprungen` : ""}${copied ? `, ${copied} davon nur kopiert (anderes Laufwerk)` : ""}. Alles steht im Verlauf und lässt sich rückgängig machen.`}
      options={[
        ...(lastFolder ? [{ label: "Zum Ordner springen", primary: true, onPick: close }] : []),
        { label: "Schließen", primary: !lastFolder, onPick: () => onClose(null) },
      ]} />
  );
}

export { extOf };
