import { Suspense, lazy, useMemo } from "react";
import type { MutableRefObject } from "react";
// Seiten werden erst geladen, wenn man sie öffnet (schnellerer Start)
const NotesPage = lazy(() => import("./pages/NotesPage").then((m) => ({ default: m.NotesPage })));
const ContactsPage = lazy(() => import("./pages/ContactsPage").then((m) => ({ default: m.ContactsPage })));
const FilesPage = lazy(() => import("./pages/FilesPage").then((m) => ({ default: m.FilesPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const ReportPage = lazy(() => import("./pages/ReportPage").then((m) => ({ default: m.ReportPage })));
const SystemPage = lazy(() => import("./pages/SystemPage").then((m) => ({ default: m.SystemPage })));
import katzeSchlaeft from "./assets/figuren/katze_schlaeft.webp";
import { ITEMS, SCOPES, type ItemId, type ScopeId } from "./items";
import { skylinePath, torn } from "./util";
import type { DbStatus } from "./db/db";

interface Props {
  pageId: ItemId;
  scope: ScopeId;
  muted: boolean;
  db: DbStatus | null;
  onToggleMute: () => void;
  onBack: () => void;
  onScopeChange: (s: ScopeId) => void;
  escRef: MutableRefObject<(() => boolean) | null>;
}

// Innenansicht eines Menüpunkts. In Etappe 1 sind alle Seiten noch leer,
// nur "System" zeigt schon Ton und Datenbank-Status.
export function PageView({ pageId, scope, muted, db, onToggleMute, onBack, onScopeChange, escRef }: Props) {
  const item = ITEMS.find((i) => i.id === pageId)!;
  const scopeLabel = SCOPES.find((s) => s.id === scope)!.label;
  const sky = useMemo(() => ({ top: skylinePath(3), bottom: skylinePath(9) }), []);
  const stripPaths = useMemo(
    () => ({ a: torn(1000, 150, 14, 11), b: torn(960, 112, 10, 23) }),
    []
  );
  const isSystem = pageId === "system";
  const isWork = (pageId === "notizen" || pageId === "kontakte" || pageId === "dateien" || pageId === "projekte" || pageId === "berichtsheft" || pageId === "system") && !!db?.ok;
  const cardH = isSystem ? 350 : pageId === "berichtsheft" ? 310 : 270;
  const cardPath = useMemo(() => torn(760, cardH, 9, 5), [cardH]);

  return (
    <div id="page" className={"show" + (isWork ? " work-page" : "")}>
      <svg id="skyT" viewBox="0 0 1600 240" preserveAspectRatio="none">
        <path d={sky.top} fill="#06198f" transform="translate(0 240) scale(1 -1)" />
      </svg>
      <svg id="skyB" viewBox="0 0 1600 240" preserveAspectRatio="none">
        <path d={sky.bottom} fill="#06198f" />
      </svg>
      {isWork && (
        <div className="wscope" role="group" aria-label="Bereich">
          {SCOPES.map((sc) => (
            <button key={sc.id} className={"pill" + (sc.id === scope ? " on" : "")} onClick={() => onScopeChange(sc.id)}>
              <span>{sc.label}</span>
            </button>
          ))}
        </div>
      )}
      {isWork ? (
        <div id="board">
          <Suspense fallback={<div className="pageload">Lade …</div>}>
          {pageId === "notizen" ? <NotesPage scope={scope} escRef={escRef} /> : pageId === "kontakte" ? <ContactsPage scope={scope} escRef={escRef} /> : pageId === "projekte" ? <ProjectsPage scope={scope} escRef={escRef} /> : pageId === "berichtsheft" ? <ReportPage scope={scope} escRef={escRef} /> : pageId === "system" ? <SystemPage db={db} muted={muted} onToggleMute={onToggleMute} escRef={escRef} /> : <FilesPage scope={scope} escRef={escRef} />}
          </Suspense>
        </div>
      ) : (
      <div id="board">
        <div className="pagecard" style={{ top: isSystem ? 350 : 380 }}>
          <div className="paper" style={{ clipPath: `path('${cardPath}')`, height: cardH }}>
            <h3>{item.label}</h3>
            {isSystem ? (
              <dl className="rows">
                <dt>Ton</dt>
                <dd>
                  <button className="btn" onClick={onToggleMute}>
                    <span>{muted ? "Aus – anschalten" : "An – ausschalten"}</span>
                  </button>
                </dd>
                <dt>Datenbank</dt>
                <dd>
                  {db === null ? "wird geladen …" : db.ok ? (
                    <span className="ok">
                      {db.mode === "sqlite" ? `SQLite verbunden, Schema Version ${db.schemaVersion}` : "Browser-Testmodus (keine echte SQLite)"}
                    </span>
                  ) : (
                    <span className="bad">Fehler: {db.error}</span>
                  )}
                </dd>
                <dt>Datei</dt>
                <dd>%APPDATA%\com.local.personaapp\persona.db</dd>
                <dt>Bereich</dt>
                <dd>{scopeLabel} (Tab-Taste wechselt)</dd>
                <dt>Version</dt>
                <dd>0.7.0 – Etappe 1 bis 8</dd>
              </dl>
            ) : (
              <>
                <p>{item.desc}.</p>
                <p>Dieser Bereich wird in Etappe {item.etappe} gebaut.</p>
                <p>Aktiver Bereich: <strong>{scopeLabel}</strong></p>
                {pageId === "berichtsheft" && <p>Dein Berichtsheft-Begleiter schläft noch. Er wacht in Etappe 8 auf.</p>}
                {(pageId === "notizen" || pageId === "kontakte" || pageId === "dateien" || pageId === "projekte") && !db?.ok && (
                  <p className="bad">Die Datenbank ist nicht verbunden{db?.error ? ": " + db.error : ""}.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      )}
      {pageId === "berichtsheft" && !isWork && <img className="sleepcat" src={katzeSchlaeft} alt="" draggable={false} />}
      <div id="strip">
        <svg width="1000" height="200" viewBox="0 0 1000 200">
          <path d={stripPaths.a} transform="translate(6 24)" fill="#06198f" />
          <path d={stripPaths.a} transform="translate(0 18)" fill="#fff" />
          <path d={stripPaths.b} transform="translate(20 38)" fill="#3a3fb4" />
        </svg>
        <h2>{item.label}</h2>
      </div>
      <div id="back" style={{ cursor: "pointer" }} onClick={onBack}>
        <kbd>Esc</kbd>Zurück zum Menü
      </div>
    </div>
  );
}
