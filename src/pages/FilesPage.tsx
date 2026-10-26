import { useCallback, useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { baseName, extOf, fsapi, isInside, join, parentDir, relParts, samePath, type DirNode, type Entry, pathKey } from "../fsapi";
import {
  folderProject, getRoots, listFolderProjects, listMoves, listTracked, scopeOfPath, setFileProject,
  setFilePath, setFolderProject, setRoot, untrackFile, type MoveRow, type Roots, type TrackedFile,
} from "../db/filesRepo";
import { listProjects, type Project, type Scope } from "../db/repo";
import { getSetting, inTauri, setSetting } from "../db/db";
import { undoMove } from "../mover";
import { Assistant, DialogBox, prettyFolder } from "./Assistant";
import { suggestProject } from "../util";
import type { ScopeId } from "../items";
import { canUseFolders, hasRealFolders, isWebApp, noDesktop } from "../platform";
import { dropToPaths, exportBrowserFolderZip } from "../web/webFiles";

const SCOPE_LABEL: Record<Scope, string> = { arbeit: "Arbeit", schule: "Schule" };
const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const TEXT = ["txt", "md", "log", "csv", "json", "xml", "ini", "conf", "cfg", "yml", "yaml", "ps1", "bat", "sh", "py", "js", "ts", "html", "css", "sql"];
const MAX_PREVIEW = 25 * 1024 * 1024;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", pdf: "application/pdf" };

function fmtSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}
function fmtDate(sec: number) {
  return sec ? new Date(sec * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}
function typeBadge(name: string, dir: boolean) {
  if (dir) return { t: "ORD", c: "#3a3fb4" };
  const e = extOf(name);
  if (e === "pdf") return { t: "PDF", c: "#c4163f" };
  if (IMG.includes(e)) return { t: "BILD", c: "#1457ff" };
  if (["doc", "docx", "odt", "rtf"].includes(e)) return { t: "DOC", c: "#1b3a8a" };
  if (["xls", "xlsx", "ods", "csv"].includes(e)) return { t: "TAB", c: "#0a8a3a" };
  if (["ppt", "pptx", "odp"].includes(e)) return { t: "PRÄS", c: "#d45a00" };
  if (["zip", "7z", "rar", "tar", "gz"].includes(e)) return { t: "ZIP", c: "#6b4bb4" };
  return { t: (e || "?").slice(0, 4).toUpperCase(), c: "#46507a" };
}

type Modal = null | "setup" | "history" | "missing" | "newfolder";
interface Preview { kind: "img" | "pdf" | "text" | "none" | "big" | "loading" | "error"; url?: string; text?: string; msg?: string }

/** Auf dem Handy gibt es keine freien Ordner wie am PC (Android erlaubt Apps keinen direkten Zugriff) */
export function FilesPage(props: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  if (noDesktop && !(isWebApp && canUseFolders)) return (
    <div className="work"><div className="paperbox mobnote">
      <b>{isWebApp ? "Dateien gibt es in der Web-App nur am PC, nicht auf dem Handy." : "Dateien gibt es nur am PC."}</b>
      <p>{isWebApp ? "Handys lassen Web-Apps keine Ordner benutzen. Öffne die Web-App am PC (Firefox, Chrome oder Edge) oder nutze das PC-Programm. Deine Notizen, Kontakte, Projekte und das Berichtsheft funktionieren überall ganz normal." : "Android lässt Apps nicht frei auf deine Ordner zugreifen. Deine Notizen, Kontakte, Projekte und das Berichtsheft funktionieren hier ganz normal."}</p>
    </div></div>
  );
  return <FilesPageDesktop {...props} />;
}

function FilesPageDesktop({ scope, escRef }: { scope: ScopeId; escRef: MutableRefObject<(() => boolean) | null> }) {
  const [roots, setRoots] = useState<Roots | null>(null);
  const [trees, setTrees] = useState<Partial<Record<Scope, DirNode>>>({});
  const [treeErr, setTreeErr] = useState<Partial<Record<Scope, string>>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [listErr, setListErr] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folderLinks, setFolderLinks] = useState<{ path: string; projectId: number }[]>([]);
  const [tracked, setTracked] = useState<TrackedFile[]>([]);
  const [missing, setMissing] = useState<TrackedFile[]>([]);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [assistant, setAssistant] = useState<{ items: string[]; fixedDest?: string | null } | null>(null);
  const [drop, setDrop] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [undoAsk, setUndoAsk] = useState<{ m: MoveRow; freeName: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3200); };

  /* ---------- Laden ---------- */
  const loadTrees = useCallback(async (r: Roots) => {
    const fs = await fsapi();
    const t: Partial<Record<Scope, DirNode>> = {};
    const e: Partial<Record<Scope, string>> = {};
    for (const s of ["arbeit", "schule"] as Scope[]) {
      const p = r[s];
      if (!p) continue;
      try { t[s] = await fs.tree(p); } catch (x) { e[s] = String(x).replace(/^Error:\s*/, ""); }
    }
    setTrees(t); setTreeErr(e);
    return t;
  }, []);

  const loadMeta = useCallback(async () => {
    const fs = await fsapi();
    const [p, fl, tr, mv] = await Promise.all([listProjects(), listFolderProjects(), listTracked(), listMoves()]);
    setProjects(p); setFolderLinks(fl); setTracked(tr); setMoves(mv);
    const miss: TrackedFile[] = [];
    for (const f of tr) if (!(await fs.exists(f.path))) miss.push(f);
    setMissing(miss);
  }, []);

  const openFolder = useCallback(async (p: string) => {
    const fs = await fsapi();
    setCurrent(p); setSelected(null); setPreview(null); setListErr("");
    try { setEntries(await fs.list(p)); } catch (e) { setEntries([]); setListErr(String(e).replace(/^Error:\s*/, "")); }
    setSetting("files_last_folder", p);
  }, []);

  const reloadAll = useCallback(async (keepFolder?: string | null) => {
    try {
      const r = await getRoots();
      setRoots(r);
      if (!r.arbeit || !r.schule) { setModal("setup"); await loadMeta(); return; }
      const t = await loadTrees(r);
      await loadMeta();
      let target = keepFolder ?? current ?? (await getSetting("files_last_folder"));
      const fs = await fsapi();
      if (!target || !(await fs.exists(target)) || !scopeOfPath(r, target)) target = t.arbeit?.path ?? t.schule?.path ?? null;
      if (target) {
        await openFolder(target);
        setExpanded((x) => { const n = new Set(x); let p = parentDir(target!); while (scopeOfPath(r, p)) { n.add(pathKey(p)); const q = parentDir(p); if (q === p) break; p = q; } return n; });
      }
    } catch (e) { setErr(String(e)); }
  }, [current, loadMeta, loadTrees, openFolder]);

  useEffect(() => { reloadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* ---------- Esc ---------- */
  useEffect(() => {
    escRef.current = () => {
      if (assistant) { setAssistant(null); reloadAll(); return true; }
      if (drop) { setDrop(null); return true; }
      if (undoAsk) { setUndoAsk(null); return true; }
      if (modal && modal !== "setup") { setModal(null); return true; }
      if (modal === "setup" && roots?.arbeit && roots?.schule) { setModal(null); return true; }
      if (selected) { setSelected(null); setPreview(null); return true; }
      return false;
    };
    return () => { escRef.current = null; };
  }, [escRef, assistant, drop, undoAsk, modal, selected, roots, reloadAll]);

  /* ---------- Ziehen & Ablegen (nur im App-Fenster) ---------- */
  useEffect(() => {
    if (!inTauri) return;
    let un: (() => void) | undefined;
    let alive = true;
    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const u = await getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter" || p.type === "over") setDragOver(true);
        else if (p.type === "leave") setDragOver(false);
        else if (p.type === "drop") { setDragOver(false); if (p.paths.length) setDrop(p.paths); }
      });
      if (alive) un = u; else u();
    })();
    return () => { alive = false; un?.(); };
  }, []);

  /* ---------- abgeleitete Werte ---------- */
  const visibleScopes = (["arbeit", "schule"] as Scope[]).filter((s) => scope === "alle" || scope === s);
  const curScope = roots && current ? scopeOfPath(roots, current) : null;
  const curFolderProj = current ? folderProject(current, folderLinks) : null;
  const folderSugg = useMemo(() => {
    if (!current || !curScope || curFolderProj) return null;
    return suggestProject(baseName(current).replace(/[_\-.]+/g, " "), curScope, projects);
  }, [current, curScope, curFolderProj, projects]);
  const trackedSel = selected ? tracked.find((t) => samePath(t.path, selected.path)) : undefined;

  /* ---------- Vorschau ---------- */
  const selectEntry = async (e: Entry) => {
    if (e.is_dir) { openFolder(e.path); setExpanded((x) => new Set(x).add(pathKey(current!))); return; }
    setSelected(e);
    const ext = extOf(e.name);
    const kind = IMG.includes(ext) ? "img" : ext === "pdf" ? "pdf" : TEXT.includes(ext) ? "text" : "none";
    if (kind === "none") { setPreview({ kind: "none" }); return; }
    if (e.size > MAX_PREVIEW) { setPreview({ kind: "big" }); return; }
    setPreview({ kind: "loading" });
    try {
      const fs = await fsapi();
      const bytes = await fs.read(e.path, kind === "text" ? 200_000 : MAX_PREVIEW);
      if (kind === "text") setPreview({ kind: "text", text: new TextDecoder("utf-8").decode(bytes) });
      else setPreview({ kind, url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME[ext] })) });
    } catch (x) { setPreview({ kind: "error", msg: String(x) }); }
  };
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  /* ---------- Aktionen ---------- */
  const act = async (f: () => Promise<void>) => { try { setErr(""); await f(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } };

  const chooseMainFolder = () => act(async () => {
    const fs = await fsapi();
    const p = await fs.pickFolder("Hauptordner wählen (darin entstehen „Arbeit“ und „Schule“)");
    if (!p) return;
    for (const s of ["arbeit", "schule"] as Scope[]) {
      const dir = join(p, SCOPE_LABEL[s]);
      await fs.mkdir(dir);
      await setRoot(s, dir);
    }
    setModal(null);
    await reloadAll(null);
    flash("Ordner eingerichtet");
  });
  const chooseSingle = (s: Scope) => act(async () => {
    const fs = await fsapi();
    const p = await fs.pickFolder(`Ordner für ${SCOPE_LABEL[s]} wählen`);
    if (!p) return;
    await setRoot(s, p);
    const r = await getRoots();
    setRoots(r);
    if (r.arbeit && r.schule) { setModal(null); await reloadAll(null); }
  });

  const startAssistant = () => act(async () => {
    const fs = await fsapi();
    const files = await fs.pickFiles();
    if (files.length) setAssistant({ items: files });
  });
  const pasteHere = (folders: boolean) => act(async () => {
    if (!current) return;
    const fs = await fsapi();
    const picked = folders ? await fs.pickFolder("Ordner wählen, der hierher soll", false) : null;
    const items = folders ? (picked ? [picked] : []) : await fs.pickFiles();
    if (items.length) setAssistant({ items, fixedDest: current });
  });
  const makeFolder = () => act(async () => {
    if (!current || !newFolderName.trim()) return;
    const clean = newFolderName.trim().replace(/[\\/:*?"<>|]+/g, "_");
    const fs = await fsapi();
    const p = join(current, clean);
    if (await fs.exists(p)) { setErr(`„${clean}“ gibt es hier schon.`); return; }
    await fs.mkdir(p);
    setNewFolderName(""); setModal(null);
    setExpanded((x) => new Set(x).add(pathKey(current)));
    await loadTrees(roots!); await openFolder(current);
    flash(`Ordner „${clean}“ angelegt`);
  });
  const linkFolder = (pid: number | null) => act(async () => {
    if (!current) return;
    await setFolderProject(current, pid);
    setFolderLinks(await listFolderProjects());
  });
  const linkFile = (pid: number | null) => act(async () => {
    if (!selected || !roots) return;
    await setFileProject(selected.path, selected.name, scopeOfPath(roots, selected.path), pid);
    setTracked(await listTracked());
  });
  const doUndo = (m: MoveRow, freeName?: string) => act(async () => {
    const r = await undoMove(m, freeName);
    if (r.ok) { setUndoAsk(null); flash(`„${m.name}“ liegt wieder am alten Ort`); await reloadAll(current); }
    else if (r.conflict) setUndoAsk({ m, freeName: r.freeName });
    else { setUndoAsk(null); setErr(r.error); setMoves(await listMoves()); }
  });
  const relink = (f: TrackedFile) => act(async () => {
    const fs = await fsapi();
    const p = await fs.pickFile(true);
    if (!p) return;
    await setFilePath(f.id, p);
    await loadMeta();
    flash(`Pfad von „${f.name}“ neu gesetzt`);
  });
  const forget = (f: TrackedFile) => act(async () => { await untrackFile(f.id); await loadMeta(); });

  /* ---------- Darstellung: Baum ---------- */
  const toggle = (p: string) => setExpanded((x) => { const n = new Set(x); const k = pathKey(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const renderNode = (n: DirNode, depth: number) => {
    const open = expanded.has(pathKey(n.path)) || depth === 0;
    const isCur = !!current && samePath(current, n.path);
    const link = folderLinks.find((l) => samePath(l.path, n.path));
    const proj = link ? projects.find((p) => p.id === link.projectId) : null;
    return (
      <li key={n.path}>
        <div className={"tn" + (isCur ? " cur" : "")} style={{ paddingLeft: 8 + depth * 16 }}>
          {n.children.length > 0 && depth > 0 ? (
            <button className="tw" aria-label={open ? "zuklappen" : "aufklappen"} onClick={() => toggle(n.path)}>{open ? "▾" : "▸"}</button>
          ) : <span className="tw" />}
          <button className="tl" onClick={() => openFolder(n.path)} title={n.path}>
            {n.name}{proj && <i className="tproj">{proj.name}</i>}
          </button>
        </div>
        {open && n.children.length > 0 && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const crumbs = current && roots && curScope ? [
    { label: SCOPE_LABEL[curScope], path: roots[curScope]! },
    ...relParts(current, roots[curScope]!).map((part, i, arr) => ({
      label: part, path: join(roots[curScope]!, arr.slice(0, i + 1).join(current.includes("\\") ? "\\" : "/")),
    })),
  ] : [];

  /* ---------- Darstellung ---------- */
  return (
    <div className={"work files" + (dragOver ? " dragover" : "")}
      onDragOver={isWebApp ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={isWebApp ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); } : undefined}
      onDrop={isWebApp ? (e) => { e.preventDefault(); setDragOver(false); const p = dropToPaths(e.dataTransfer); void act(async () => { const l = await p; if (l.length) setDrop(l); }); } : undefined}>
      <section className="wcol ftree">
        <div className="wtools">
          <button className="btn" onClick={startAssistant}><span>+ Datei hinzufügen</span></button>
        </div>
        <div className="scroll treebox">
          {visibleScopes.map((s) => (
            <div key={s} className="troot">
              <div className={"trhead " + s}>{SCOPE_LABEL[s]}</div>
              {trees[s] ? <ul className="tlist">{renderNode(trees[s]!, 0)}</ul> :
                <div className="small trerr">{treeErr[s] ?? (roots?.[s] ? "wird geladen …" : "noch nicht eingerichtet")}
                  {treeErr[s]?.includes("Erlaubnis") && roots?.[s] && <button className="mini hot" onClick={() => act(async () => { const fs = await fsapi(); if (await fs.grant?.(roots[s]!)) await reloadAll(current); })}>Zugriff erlauben</button>}
                  {treeErr[s] && <button className="mini" onClick={() => chooseSingle(s)}>Ordner neu wählen</button>}</div>}
            </div>
          ))}
        </div>
        <div className="ftreefoot">
          <button className="mini" onClick={() => reloadAll(current)}>Aktualisieren</button>
          <button className="mini" onClick={async () => { setMoves(await listMoves()); setModal("history"); }}>Verlauf</button>
          <button className="mini" onClick={() => setModal("setup")}>Ordner ändern</button>
          {isWebApp && !hasRealFolders && <button className="mini" onClick={() => act(async () => { flash(`${await exportBrowserFolderZip()} wurde heruntergeladen`); })}>Alles als ZIP laden</button>}
          {missing.length > 0 && <button className="mini hot" onClick={() => setModal("missing")}>{missing.length} nicht gefunden</button>}
        </div>
      </section>

      <section className="wcol fmain">
        {msg && <div className="flash">{msg}</div>}
        {err && <div className="errbox">{err}</div>}
        {current ? (
          <div className="paperbox fview">
            <div className="fhead">
              <div className="crumbs">
                {crumbs.map((c, i) => (
                  <span key={c.path}>{i > 0 && <i>›</i>}<button onClick={() => openFolder(c.path)} className={i === crumbs.length - 1 ? "last" : ""}>{c.label}</button></span>
                ))}
              </div>
              <div className="fbtns">
                <button className="mini hot" onClick={() => pasteHere(false)} title="Dateien auswählen, sie kommen ohne Rückfragen in diesen Ordner">Hier einfügen</button>
                <button className="mini" onClick={() => pasteHere(true)} title="Einen ganzen Ordner (mit allem darin) hierher verschieben">Ordner hierher</button>
                <button className="mini" onClick={() => { setNewFolderName(""); setModal("newfolder"); }}>Neuer Ordner</button>
                {!isWebApp && <button className="mini" onClick={() => act(async () => (await fsapi()).open(current))}>Im Explorer</button>}
              </div>
              <div className="fproj">
                <span>Projekt dieses Ordners:</span>
                <select className="field mini-select" value={curFolderProj && !curFolderProj.inherited ? curFolderProj.projectId : ""}
                  onChange={(e) => linkFolder(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{curFolderProj?.inherited ? `geerbt: ${projects.find((p) => p.id === curFolderProj.projectId)?.name ?? "?"}` : "– keins –"}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {folderSugg && <button className="chip proj clickable" onClick={() => linkFolder(folderSugg.id)}>Vorschlag: {folderSugg.name}</button>}
              </div>
            </div>
            <div className={"fbody" + (selected ? " withprev" : "")}>
              <div className="flist">
                {listErr && <div className="errbox">{listErr}</div>}
                {!listErr && entries.length === 0 && (
                  <div className="fempty">Dieser Ordner ist leer. Zieh Dateien oder Ordner auf das Fenster, nimm „Hier einfügen“ oder lege sie im Explorer hinein und klicke auf „Aktualisieren“.</div>
                )}
                {entries.map((e) => {
                  const b = typeBadge(e.name, e.is_dir);
                  return (
                    <button key={e.path} className={"frow" + (selected && samePath(selected.path, e.path) ? " sel" : "")} onClick={() => selectEntry(e)}
                      onDoubleClick={() => !e.is_dir && act(async () => (await fsapi()).open(e.path))}>
                      <i className="badge" style={{ background: b.c }}>{b.t}</i>
                      <span className="fname">{e.name}</span>
                      <span className="fmeta">{e.is_dir ? "Ordner" : fmtSize(e.size)}</span>
                      <span className="fmeta">{fmtDate(e.modified)}</span>
                    </button>
                  );
                })}
              </div>
              {selected && (
                <aside className="fprev">
                  <h4 title={selected.name}>{selected.name}</h4>
                  <div className="pv">
                    {preview?.kind === "loading" && <span className="small">Lade Vorschau …</span>}
                    {preview?.kind === "img" && <img src={preview.url} alt="" />}
                    {preview?.kind === "pdf" && <iframe title="PDF-Vorschau" src={preview.url} />}
                    {preview?.kind === "text" && <pre>{preview.text}</pre>}
                    {preview?.kind === "none" && <span className="small">Für diesen Dateityp gibt es keine Vorschau. „Öffnen“ startet das passende Programm.</span>}
                    {preview?.kind === "big" && <span className="small">Datei ist zu groß für die Vorschau.</span>}
                    {preview?.kind === "error" && <span className="small">Vorschau nicht möglich: {preview.msg}</span>}
                  </div>
                  <div className="pvmeta">{[fmtSize(selected.size), fmtDate(selected.modified)].filter(Boolean).join(" · ")}</div>
                  <label className="lab">Projekt
                    <select className="field" value={trackedSel?.projectId ?? ""} onChange={(e) => linkFile(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">{!trackedSel?.projectId && curFolderProj ? `über Ordner: ${projects.find((p) => p.id === curFolderProj.projectId)?.name ?? "?"}` : "– keins –"}</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <div className="pvbtns">
                    <button className="btn" onClick={() => act(async () => (await fsapi()).open(selected.path))}><span>Öffnen</span></button>
                    {!isWebApp && <button className="mini" onClick={() => act(async () => (await fsapi()).reveal(selected.path))}>Im Explorer zeigen</button>}
                    <button className="mini" onClick={() => setAssistant({ items: [selected.path] })}>Woanders einsortieren</button>
                  </div>
                </aside>
              )}
            </div>
          </div>
        ) : (
          <div className="paperbox hintcard">
            <h3>Dateien</h3>
            <p>Richte zuerst deine beiden Hauptordner ein.</p>
            <button className="btn fsetupbtn" onClick={() => setModal("setup")}><span>Einrichten</span></button>
          </div>
        )}
      </section>

      {/* ---------- Fenster ---------- */}
      {modal === "setup" && (
        <div className="fmodal"><div className="paperbox mbox">
          <h3>Ordner einrichten</h3>
          {isWebApp && !hasRealFolders
            ? <p>Dieser Browser (zum Beispiel Firefox) darf keine Ordner auf deinem PC öffnen. Deshalb legt die App <b>eigene Ordner „Arbeit“ und „Schule“ im Browser</b> an. Dateien ziehst du hinein oder wählst sie aus, Eda sortiert sie wie gewohnt. <b>Wichtig:</b> Die Ordner liegen nur in diesem Browser. Löschst du die Browserdaten, sind sie weg. Mit „Alles als ZIP laden“ sicherst du sie.</p>
            : <p>Die App zeigt deine <b>echten Ordner</b>. Alles, was du in „Arbeit“ und „Schule“ ablegst, im Explorer oder hier, erscheint automatisch. Du musst nichts nachbauen.</p>}
          <p className="small">Aktuell: Arbeit = {roots?.arbeit?.replace(/^web:/, "") ?? "nicht gesetzt"} · Schule = {roots?.schule?.replace(/^web:/, "") ?? "nicht gesetzt"}</p>
          <div className="actions static">
            <button className="btn fpickmain" onClick={chooseMainFolder}><span>{isWebApp && !hasRealFolders ? "Ordner im Browser einrichten" : "Hauptordner wählen"}</span></button>
            {hasRealFolders || !isWebApp ? <>
              <button className="mini" onClick={() => chooseSingle("arbeit")}>Arbeit-Ordner einzeln wählen</button>
              <button className="mini" onClick={() => chooseSingle("schule")}>Schule-Ordner einzeln wählen</button></> : null}
            {roots?.arbeit && roots?.schule && <button className="mini" onClick={() => setModal(null)}>Schließen</button>}
          </div>
          <p className="small">„Hauptordner wählen“: Darin legt die App die Ordner „Arbeit“ und „Schule“ an (gibt es sie schon, werden sie einfach benutzt). Es wird nichts verschoben oder gelöscht.</p>
        </div></div>
      )}
      {modal === "newfolder" && current && (
        <div className="fmodal"><div className="paperbox mbox small-box">
          <h3>Neuer Ordner</h3>
          <p className="small">in {prettyFolder(current, roots!)}</p>
          <input className="field" autoFocus value={newFolderName} placeholder="Name des Ordners"
            onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") makeFolder(); }} />
          <div className="actions static">
            <button className="btn" onClick={makeFolder}><span>Anlegen</span></button>
            <button className="btn ghost" onClick={() => setModal(null)}><span>Abbrechen</span></button>
          </div>
        </div></div>
      )}
      {modal === "history" && (
        <div className="fmodal"><div className="paperbox mbox wide">
          <h3>Verlauf</h3>
          {moves.length === 0 ? <p>Noch nichts verschoben.</p> : (
            <div className="hist">
              {moves.map((m) => (
                <div key={m.id} className={"hrow" + (m.undone_at ? " undone" : "")}>
                  <span className="htime">{new Date(m.moved_at.replace(" ", "T") + "Z").toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="hname"><b>{m.name}</b><small>{parentDir(m.from_path)} → {roots ? prettyFolder(m.dest_folder, roots) : m.dest_folder}</small></span>
                  <span className="hvia">{m.mode === "copied" ? "kopiert" : m.via === "assistent" ? "Assistent" : m.via === "hier" ? "Hier eingefügt" : "abgelegt"}</span>
                  {m.undone_at ? <span className="hdone">rückgängig</span> : m.mode === "moved" ? <button className="mini" onClick={() => doUndo(m)}>Rückgängig</button> : <span />}
                </div>
              ))}
            </div>
          )}
          <div className="actions static"><button className="btn ghost" onClick={() => setModal(null)}><span>Schließen</span></button></div>
        </div></div>
      )}
      {modal === "missing" && (
        <div className="fmodal"><div className="paperbox mbox wide">
          <h3>Nicht gefunden</h3>
          <p className="small">Diese Dateien kennt die App, sie liegen aber nicht mehr am gespeicherten Ort (zum Beispiel im Explorer verschoben). Setz den Pfad neu, dann bleiben Projekt-Verknüpfungen erhalten.</p>
          <div className="hist">
            {missing.map((f) => (
              <div key={f.id} className="hrow">
                <span className="hname"><b>{f.name}</b><small>{f.path}</small></span>
                {!isWebApp && <button className="mini hot" onClick={() => relink(f)}>Datei suchen</button>}
                <button className="mini" onClick={() => forget(f)}>Aus App entfernen</button>
              </div>
            ))}
            {missing.length === 0 && <p>Alles gefunden.</p>}
          </div>
          <div className="actions static"><button className="btn ghost" onClick={() => setModal(null)}><span>Schließen</span></button></div>
        </div></div>
      )}

      {/* ---------- Assistent und Rückfragen ---------- */}
      {undoAsk && roots && (
        <DialogBox name="Eda" pose="denkt" onClose={() => setUndoAsk(null)}
          text={`Am alten Ort liegt inzwischen schon etwas mit dem Namen „${baseName(undoAsk.m.from_path)}“. Ich überschreibe nie etwas. Soll ich „${undoAsk.m.name}“ als „${undoAsk.freeName}“ zurücklegen?`}
          options={[
            { label: `Als „${undoAsk.freeName}“ zurücklegen`, primary: true, onPick: () => doUndo(undoAsk.m, undoAsk.freeName) },
            { label: "Abbrechen", onPick: () => setUndoAsk(null) },
          ]} />
      )}
      {drop && roots && !assistant && (
        <DialogBox name="Eda" pose="gruss" onClose={() => setDrop(null)}
          text={`Du hast mir ${drop.length === 1 ? `„${baseName(drop[0])}“` : `${drop.length} Elemente`} gegeben. Was soll ich damit machen?`}
          options={[
            ...(current ? [{ label: `Hierher nach ${prettyFolder(current, roots)}`, primary: true, onPick: () => { setAssistant({ items: drop, fixedDest: current }); setDrop(null); } }] : []),
            { label: "Mit dem Assistenten einsortieren", primary: !current, onPick: () => { setAssistant({ items: drop }); setDrop(null); } },
            { label: "Abbrechen", onPick: () => setDrop(null) },
          ]} />
      )}
      {assistant && roots && (
        <Assistant items={assistant.items} fixedDest={assistant.fixedDest} roots={roots} trees={trees} projects={projects}
          folderLinks={folderLinks} defaultScope={curScope ?? (scope === "schule" ? "schule" : "arbeit")}
          onClose={async (last) => {
            setAssistant(null);
            await reloadAll(last && roots && scopeOfPath(roots, last) ? last : current);
          }} />
      )}
      {dragOver && <div className="dropzone"><b>Loslassen zum Einsortieren</b></div>}
    </div>
  );
}

export { isInside };
