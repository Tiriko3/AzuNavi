import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { charById } from "./chars";
import { applyDisplay, getDisplayMode, toggleFullscreen } from "./display";
import { HelpPanel } from "./tutorial/HelpPanel";
import { getSetting as getSet } from "./db/db";
import { ITEMS, SCOPES, type ItemId, type ScopeId } from "./items";
import { getSetting, initDb, setSetting, type DbStatus } from "./db/db";
import { isMuted, setMuted, snd } from "./sound";
import { Water } from "./Water";
import { PageView } from "./PageView";
import { kwNumber } from "./util";
import { DEFAULT_PREFS, PrefsContext, applyPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";
const Tutorial = lazy(() => import("./tutorial/Tutorial").then((m) => ({ default: m.Tutorial })));
import { inTauri } from "./db/db";

// Halbrad-Menü: Kreismittelpunkt und Radius (Bühne 1600 x 900)
const WHEEL = { cx: 560, cy: 440, r: 300 };

export default function App() {
  const [ready, setReady] = useState(false);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [sel, setSel] = useState(3); // Start bei "Projekte", wird gleich aus der Datenbank überschrieben
  const [scope, setScope] = useState<ScopeId>("alle");
  const [page, setPage] = useState<ItemId | null>(null);
  const [muted, setMutedState] = useState(false);
  const [now, setNow] = useState(new Date());
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [tutorial, setTutorial] = useState(false);
  const [help, setHelp] = useState(false);
  const [charId, setCharId] = useState("eigene");
  const POSES = charById(charId).poses;
  const busy = useRef(false);
  const [wheelTurn, setWheelTurn] = useState(3); // Ring-Drehung (zählt weiter, damit er nicht zurückspult)
  const prevSel = useRef(3); // vorherige Auswahl: Punkte, die „über die Rückseite“ springen, bewegen sich ohne Übergang
  const lastWheel = useRef(0);
  const escRef = useRef<(() => boolean) | null>(null); // Seiten können Esc selbst abfangen (z. B. Editor schließen)
  const wipeRefs = useRef<(HTMLElement | null)[]>([]);
  const bigRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  /* ---------- Start: Datenbank öffnen, Einstellungen laden ---------- */
  useEffect(() => {
    (async () => {
      const status = await initDb();
      setDb(status);
      const s = await getSetting("scope");
      if (s === "alle" || s === "schule" || s === "arbeit") setScope(s);
      const t = await getSetting("lastTab");
      const idx = ITEMS.findIndex((i) => i.id === t);
      if (idx >= 0) { setSel(idx); setWheelTurn(idx); prevSel.current = idx; }
      const m = (await getSetting("muted")) === "1";
      setMuted(m);
      setMutedState(m);
      const p = await loadPrefs();
      setPrefsState(p); applyPrefs(p);
      setCharId((await getSet("pref_char")) ?? "eigene");
      getDisplayMode().then((m) => applyDisplay(m).catch(() => {}));
      if (status.ok && !p.tutorialDone) setTutorial(true);   // erster Start: Tutorial mit Registrierung
      setReady(true);
      // Portable App: Verknüpfung auf dem Desktop anlegen bzw. nach einem Umzug aktualisieren
      if (inTauri) {
        import("@tauri-apps/api/core").then(({ invoke }) => invoke("ensure_desktop_shortcut").catch(() => {}));
      }
    })();
  }, []);

  const setPrefs = useCallback((x: Partial<Prefs>) => {
    setPrefsState((p) => { const n = { ...p, ...x }; applyPrefs(n); savePrefs(n).catch(() => {}); return n; });
  }, []);
  // „Tutorial wiederholen“: erst zurück zum Startbildschirm (Menü), dann das Tutorial
  const openTutorial = useCallback(() => { setPage(null); setHelp(false); setTimeout(() => setTutorial(true), 350); }, []);

  /* ---------- Skalierung: Bühne ist 1600x900 und wird ins Fenster eingepasst ---------- */
  useLayoutEffect(() => {
    const fit = () => {
      const k = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
      if (stageRef.current) stageRef.current.style.transform = `scale(${k})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ready]);

  /* ---------- Posen vorladen, damit beim Wechsel nichts flackert ---------- */
  useEffect(() => {
    Object.values(POSES).forEach((src) => { const i = new Image(); i.src = src; });
  }, [POSES]);

  /* ---------- Uhr ---------- */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  /* ---------- Hintergrundwort an die Breite anpassen ---------- */
  const fitBigWord = useCallback(() => {
    const el = bigRef.current;
    if (!el) return;
    el.style.fontSize = "330px";
    el.style.fontSize = Math.min(330, (330 * 1050) / el.scrollWidth) + "px";
  }, []);
  useLayoutEffect(() => {
    fitBigWord();
    document.fonts?.ready.then(fitBigWord);
  }, [sel, ready, fitBigWord]);

  /* ---------- Aktionen ---------- */
  const move = useCallback((next: number) => {
    document.documentElement.setAttribute("data-turned", "1"); // fürs Tutorial: das Rad wurde gedreht
    setSel((cur) => {
      prevSel.current = cur;
      const n = ITEMS.length;
      let step = ((next - cur) % n + n) % n; if (step > n / 2) step -= n; // kürzester Weg
      setWheelTurn((t) => t + step);
      return next;
    });
    snd.move();
    setSetting("lastTab", ITEMS[next].id);
  }, []);

  const wipe = useCallback((mid: () => void) => {
    busy.current = true;
    wipeRefs.current.forEach((p, i) => {
      p?.animate(
        [
          { transform: "translateX(-140%) skewX(-18deg)" },
          { transform: "translateX(70%) skewX(-18deg)", offset: 0.5 },
          { transform: "translateX(260%) skewX(-18deg)" },
        ],
        { duration: 820, delay: i * 70, easing: "cubic-bezier(.65,0,.3,1)" }
      );
    });
    setTimeout(mid, 430);
    setTimeout(() => { busy.current = false; }, 900);
  }, []);

  const openPage = useCallback((index: number) => {
    if (busy.current) return;
    snd.open();
    wipe(() => setPage(ITEMS[index].id));
  }, [wipe]);

  const closePage = useCallback(() => {
    if (busy.current) return;
    snd.back();
    getSet("pref_char").then((c) => setCharId(c ?? "eigene"));
    wipe(() => setPage(null));
  }, [wipe]);

  const changeScope = useCallback((s: ScopeId) => {
    setScope(s);
    snd.ok();
    setSetting("scope", s);
  }, []);

  const toggleMute = useCallback(() => {
    const m = !isMuted();
    setMuted(m);
    setMutedState(m);
    setSetting("muted", m ? "1" : "0");
    if (!m) snd.ok();
  }, []);

  /* ---------- Tastatur und Mausrad ---------- */
  const st = useRef({ sel, scope, page });
  st.current = { sel, scope, page };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") { e.preventDefault(); toggleFullscreen().catch(() => {}); return; }
      if (e.key === "F1") { e.preventDefault(); setHelp((h) => !h); return; }
      if (document.querySelector(".tut:not(.showpage)")) return; // nur die Einrichtung blockiert die Tastatur
      if (document.querySelector(".helppanel") && e.key === "Escape") { setHelp(false); return; }
      const { sel, scope, page } = st.current;
      // In Eingabefeldern gehören Tasten dem Feld (Tippen, Tab zwischen Feldern, ...)
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) {
        // Esc im Feld verlässt nur das Feld (so geht getippter Text nicht aus Versehen verloren)
        if (e.key === "Escape") { e.preventDefault(); t!.blur(); }
        return;
      }
      if (e.key === "m" || e.key === "M") { toggleMute(); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        const i = SCOPES.findIndex((s) => s.id === scope);
        changeScope(SCOPES[(i + 1) % SCOPES.length].id);
        return;
      }
      if (page) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault();
          if (escRef.current && escRef.current()) return;
          closePage();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        e.preventDefault(); move((sel + 1) % ITEMS.length);
      } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        e.preventDefault(); move((sel - 1 + ITEMS.length) % ITEMS.length);
      } else if (e.key === "Enter") {
        e.preventDefault(); openPage(sel);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (document.querySelector(".tut:not(.showpage)")) return;
      const { sel, page } = st.current;
      if (page) return;
      // Mausrad nur, wenn der Zeiger wirklich über den Menüpunkten ist
      const items = Array.from(document.querySelectorAll("#menu .item")).map((el) => el.getBoundingClientRect());
      if (!items.length) return;
      const pad = 24;
      const l = Math.min(...items.map((r) => r.left)) - pad, r = Math.max(...items.map((r) => r.right)) + pad;
      const tp = Math.min(...items.map((r) => r.top)) - pad, bt = Math.max(...items.map((r) => r.bottom)) + pad;
      if (e.clientX < l || e.clientX > r || e.clientY < tp || e.clientY > bt) return;
      if (Date.now() - lastWheel.current < 140) return; // nicht zu schnell durchrattern
      lastWheel.current = Date.now();
      move((sel + (e.deltaY > 0 ? 1 : -1) + ITEMS.length) % ITEMS.length);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [move, openPage, closePage, changeScope, toggleMute]);

  if (!ready) return <div id="stage" ref={stageRef} />;

  const item = ITEMS[sel];
  const dateStr = now.toLocaleDateString("de-DE", { day: "numeric", month: "long" }).toUpperCase();
  const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const wdayStr = now.toLocaleDateString("de-DE", { weekday: "long" }).toUpperCase();

  return (
    <PrefsContext.Provider value={{ prefs, setPrefs, openTutorial }}>
    <div id="stage" ref={stageRef} data-scope={scope}>
      <Water />

      {/* weiße Fläche links mit schräger Kante */}
      <div id="panel" aria-hidden="true">
        <svg viewBox="0 0 1600 900" preserveAspectRatio="none">
          <polygon points="0,0 760,0 560,900 0,900" fill="#fff" />
          <polygon points="760,0 782,0 582,900 560,900" fill="#ff2d5f" />
          <polygon points="782,0 792,0 592,900 582,900" fill="#7fe3ff" />
        </svg>
      </div>

      <div id="bigword" key={item.id} ref={bigRef} className="swap" aria-hidden="true">
        {item.label}
      </div>

      <svg id="wheel" aria-hidden="true" viewBox="0 0 1600 900">
        <g style={{ transform: `rotate(${-wheelTurn * 15}deg)`, transformOrigin: `${WHEEL.cx}px ${WHEEL.cy}px` }} className="wheelg">
          <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r - 26} className="wring" />
          <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r - 44} className="wring thin" />
          {Array.from({ length: 72 }, (_, k) => {
            const a = (k * 5 * Math.PI) / 180, long = k % 17 === 0 || k % 6 === 0;
            const r1 = WHEEL.r - 26, r2 = WHEEL.r - (long ? 6 : 16);
            return <line key={k} x1={WHEEL.cx + r1 * Math.cos(a)} y1={WHEEL.cy + r1 * Math.sin(a)} x2={WHEEL.cx + r2 * Math.cos(a)} y2={WHEEL.cy + r2 * Math.sin(a)} className={long ? "wtick long" : "wtick"} />;
          })}
        </g>
        <path d={`M ${WHEEL.cx + WHEEL.r - 30} ${WHEEL.cy} l 22 -12 v 24 z`} className="wpointer" />
      </svg>
      <div id="hero" className={charId === "eigene" ? "orig" : ""} key={"pose-" + item.id}><img id="avatarimg" alt="" src={POSES[item.id]} draggable={false} /></div>

      <ul id="menu" role="menu" aria-label="Hauptmenü">
        {ITEMS.map((it, i) => {
          // Halbrad: der aktive Punkt steht groß in der Mitte, die anderen laufen auf einem Bogen kleiner werdend weg
          const n = ITEMS.length;
          const d = ((i - sel + 3 + n * 10) % n) - 3;          // -3 … 2 (rundherum)
          const pd = ((i - prevSel.current + 3 + n * 10) % n) - 3;
          // Rad: Mittelpunkt links, die Wörter stehen wie Speichen auf dem Umfang (in Richtung ihres Radius gedreht)
          const angDeg = d * 15, ang = (angDeg * Math.PI) / 180;
          const x = WHEEL.cx + WHEEL.r * Math.cos(ang), y = WHEEL.cy + WHEEL.r * Math.sin(ang);
          const sc = [1, 0.58, 0.42, 0.34][Math.abs(d)];
          const on = d === 0;
          return (
            <li
              key={it.id}
              role="menuitem"
              tabIndex={on ? 0 : -1}
              className={"item" + (on ? " on" : "") + (Math.abs(d) === 3 ? " far" : "") + (Math.abs(d - pd) > 2 ? " snap" : "")}
              aria-current={on}
              style={{ transform: `translate(${x}px,${y - 50}px) rotate(${angDeg}deg) skewX(-9deg) scale(${sc})` }}
              onClick={() => { if (page) return; if (on) openPage(i); else move(i); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openPage(i); } }}
            >
              <span>{it.label}</span>
            </li>
          );
        })}
      </ul>

      <div id="kw"><small>Kalenderwoche</small><span>KW {kwNumber(now)}</span></div>
      <div id="clock">
        <div><span>{dateStr}</span><small>{timeStr}</small></div>
        <div className="sep" />
        <div>{wdayStr}</div>
      </div>
      <div id="scope" role="group" aria-label="Bereich">
        {SCOPES.map((s) => (
          <button key={s.id} className={"pill" + (s.id === scope ? " on" : "")} onClick={() => changeScope(s.id)}>
            <span>{s.label}</span>
          </button>
        ))}
        <button className="helpbtn" aria-label="Hilfe (F1)" title="Hilfe (F1)" onClick={() => setHelp((h) => !h)}>?</button>
      </div>
      <div id="foot">
        <div id="desc">{item.desc}</div>
        <div id="keys">
          <span><kbd>↵</kbd>Öffnen</span>
          <span><kbd>Esc</kbd>Zurück</span>
          <span><kbd>Tab</kbd>Bereich</span>
          <span><kbd>M</kbd>Ton {muted ? "aus" : "an"}</span>
        </div>
      </div>

      {db && !db.ok && !page && <div id="dberr">Datenbank-Fehler: {db.error}</div>}

      {page && (
        <PageView pageId={page} scope={scope} muted={muted} db={db}
          onToggleMute={toggleMute} onBack={closePage} onScopeChange={changeScope} onHelp={() => setHelp((h) => !h)} escRef={escRef} />
      )}

      <div id="wipe">
        {[0, 1, 2].map((i) => <i key={i} ref={(el) => { wipeRefs.current[i] = el; }} />)}
      </div>
      {help && !tutorial && <HelpPanel pageId={page} onClose={() => setHelp(false)} onTutorial={openTutorial} />}
      {tutorial && (
        <Suspense fallback={null}><Tutorial
          onShowPage={(p) => { if (p === undefined) return; setPage(p as ItemId | null); }}
          onDone={async () => { setTutorial(false); setPage(null); setPrefs({ tutorialDone: true }); setCharId((await getSet("pref_char")) ?? "eigene"); }} /></Suspense>
      )}
    </div>
    </PrefsContext.Provider>
  );
}
