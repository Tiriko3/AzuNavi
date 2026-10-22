// Passwortschutz in den Einstellungen (nur Web-App): sperren, automatisch sperren, Gerät merken, Passwort ändern, Schutz einschalten.
import { useEffect, useState, type ReactNode } from "react";
import { changePassword, flushAll, getAutoLock, isRemembered, lockNow, profileInfo, rememberDevice, requestSetup, setAutoLock } from "./dataStore";
import { MIN_PASSWORD, passwordProblem } from "./vault";

const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error:\s*/, "");

export function ProfilePanel({ mobile = false }: { mobile?: boolean }) {
  const info = profileInfo();
  const [auto, setAuto] = useState(0), [rem, setRem] = useState(false);
  const [pwOpen, setPwOpen] = useState(false), [cur, setCur] = useState(""), [n1, setN1] = useState(""), [n2, setN2] = useState("");
  const [ok, setOk] = useState(""), [err, setErr] = useState("");
  useEffect(() => { getAutoLock().then(setAuto).catch(() => {}); isRemembered().then(setRem).catch(() => {}); }, []);

  const btn = mobile ? "m-btn sec" : "mini";
  const row = (label: string, control: ReactNode) => mobile
    ? <div className="m-field"><span>{label}</span><div className="m-btnrow">{control}</div></div>
    : <div className="sysrow"><span>{label}</span><span className="inl">{control}</span></div>;
  const act = (f: () => Promise<void>) => async () => { setErr(""); setOk(""); try { await f(); } catch (e) { setErr(msg(e)); } };

  if (!info) return <>
    {row("Passwortschutz", <>
      <span className="small">Aus</span>
      <button className={btn} onClick={async () => { requestSetup(true); await flushAll(); location.reload(); }}>Einschalten</button>
    </>)}
    {mobile && <p className="m-note">Mit Passwort sind Datenbank und Anhänge verschlüsselt. Bisherige Daten werden automatisch übernommen.</p>}
  </>;

  return <>
    {row("Passwortschutz", <>
      <span className="small">An · Profil „{info.name}“</span>
      <button className={btn} onClick={() => { void lockNow(); }}>Jetzt sperren</button>
    </>)}
    {row("Automatisch sperren", <select className={mobile ? "" : "mini-select"} value={auto} onChange={(e) => { const m = Number(e.target.value); setAuto(m); void setAutoLock(m); }}>
      {[[0, "Aus"], [5, "Nach 5 Minuten"], [15, "Nach 15 Minuten"], [30, "Nach 30 Minuten"], [60, "Nach 1 Stunde"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>)}
    {row("Auf diesem Gerät angemeldet bleiben", <>
      <span className="small">{rem ? "An" : "Aus"}</span>
      <button className={btn} onClick={act(async () => { await rememberDevice(!rem); setRem(!rem); })}>{rem ? "Ausschalten" : "Einschalten"}</button>
    </>)}
    {row("Passwort", <button className={btn} onClick={() => { setPwOpen(!pwOpen); setErr(""); setOk(""); }}>{pwOpen ? "Schließen" : "Ändern"}</button>)}
    {pwOpen && <div className={mobile ? "" : "sysrow"} style={mobile ? undefined : { display: "grid", gap: 8 }}>
      <input type="password" autoComplete="current-password" placeholder="Aktuelles Passwort" value={cur} onChange={(e) => setCur(e.target.value)} />
      <input type="password" autoComplete="new-password" placeholder={`Neues Passwort (mindestens ${MIN_PASSWORD} Zeichen)`} value={n1} onChange={(e) => setN1(e.target.value)} />
      <input type="password" autoComplete="new-password" placeholder="Neues Passwort wiederholen" value={n2} onChange={(e) => setN2(e.target.value)} />
      <button className={btn} disabled={!cur || !n1 || !n2} onClick={act(async () => {
        if (n1 !== n2) throw new Error("Die beiden neuen Passwörter sind nicht gleich.");
        const bad = passwordProblem(n1); if (bad) throw new Error(bad);
        await changePassword(cur, n1); setCur(""); setN1(""); setN2(""); setPwOpen(false); setOk("Passwort geändert. Der Wiederherstellungsschlüssel bleibt derselbe.");
      })}>Passwort ändern</button>
    </div>}
    {ok && <p className={mobile ? "m-ok" : "small"}>{ok}</p>}{err && <p className={mobile ? "m-err" : "small"} style={mobile ? undefined : { color: "var(--hot)" }}>{err}</p>}
  </>;
}
