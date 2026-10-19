// Cloud-Sicherung (TEST, nur mit erfundenen Daten): Konto auf dem eigenen AzuNavi-Server, Sicherung verschlüsselt hoch- und herunterladen.
// Passwort, Schlüssel und Tokens bleiben im Rust-Teil der App (src-tauri/src/sync.rs); hier liegt nur, was der Nutzer sieht.
import { useEffect, useState } from "react";
import { getSetting, inTauri, setSetting } from "../db/db";
import { createBackup, restoreBackup } from "../backup";
import { fsapi } from "../fsapi";
import { isMobile } from "../platform";
import { APP_VERSION } from "../pages/SystemPage";

type Mode = "login" | "register" | "recover";
interface CloudInfo { b64: string; meta_seq: number; created: number; device: string; size: number }
const call = async <T,>(cmd: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
const device = () => (isMobile ? "Handy" : "PC");
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const when = (t: number) => (t ? new Date(t * 1000).toLocaleString("de-DE") : "unbekannt");

export function SyncPanel() {
  const [user, setUser] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [f, setF] = useState({ url: "", ca: "", username: "", password: "", password2: "", invite: "", recovery: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rk, setRk] = useState<string | null>(null);          // Wiederherstellungsschlüssel (nur einmal anzeigen)
  const [rkOk, setRkOk] = useState(false);
  const [conflict, setConflict] = useState<{ seq: number } | null>(null);
  const [pending, setPending] = useState<CloudInfo | null>(null);
  const [delArm, setDelArm] = useState(false);

  useEffect(() => {
    (async () => {
      const [url, ca, username] = await Promise.all([getSetting("sync_url"), getSetting("sync_ca"), getSetting("sync_user")]);
      setF((x) => ({ ...x, url: url ?? "", ca: ca ?? "", username: username ?? "" }));
      if (inTauri) setUser(await call<string | null>("sync_status").catch(() => null));
    })();
  }, []);

  if (!inTauri) return <p className="small">Die Cloud-Sicherung gibt es nur in der App (nicht im Browser-Testmodus).</p>;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: String(e).replace(/^Error:\s*/, "") }); }
    setBusy("");
  };
  const conn = { url: f.url.trim(), ca: f.ca.trim() || null };
  const saveConn = async () => { await setSetting("sync_url", conn.url); await setSetting("sync_ca", f.ca.trim()); await setSetting("sync_user", f.username.trim()); };
  const pickCa = () => run("Lese Zertifikat …", async () => {
    const fs = await fsapi(); const p = await fs.pickFile(); if (!p) return;
    const t = new TextDecoder().decode(await fs.read(p, 64 * 1024));
    if (!t.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Das ist kein Zertifikat (ca.crt aus deploy/certs nehmen).");
    setF((x) => ({ ...x, ca: t }));
  });
  const pwCheck = (a: string, b: string) => { if (a.length < 12) throw new Error("Das Passwort braucht mindestens 12 Zeichen."); if (a !== b) throw new Error("Die beiden Passwörter sind nicht gleich."); };

  const login = () => run("Melde an …", async () => {
    await call("sync_login", { ...conn, username: f.username.trim(), password: f.password, device: device() });
    await saveConn(); setUser(f.username.trim()); setF((x) => ({ ...x, password: "", password2: "" }));
  });
  const register = () => run("Lege Konto an …", async () => {
    pwCheck(f.password, f.password2);
    const key = await call<string>("sync_register", { ...conn, invite: f.invite.trim(), username: f.username.trim(), password: f.password, device: device() });
    await saveConn(); setUser(f.username.trim()); setRk(key); setRkOk(false);
    setF((x) => ({ ...x, password: "", password2: "", invite: "" }));
  });
  const recover = () => run("Setze Passwort zurück …", async () => {
    pwCheck(f.password, f.password2);
    await call("sync_recover", { ...conn, username: f.username.trim(), recovery: f.recovery, newPassword: f.password, device: device() });
    await saveConn(); setUser(f.username.trim()); setF((x) => ({ ...x, password: "", password2: "", recovery: "" }));
    setMsg({ ok: true, text: "Neues Passwort gesetzt. Alle anderen Geräte sind abgemeldet." });
  });
  const logout = () => run("Melde ab …", async () => { await call("sync_logout"); setUser(null); });

  const upload = (force?: number) => run("Lade Sicherung hoch …", async () => {
    const known = force ?? (Number(await getSetting("sync_meta_seq")) || null);
    const b = await createBackup(APP_VERSION);
    const r = await call<{ status: string; meta_seq: number }>("sync_upload", { b64: b64(b.bytes), knownMetaSeq: known, device: device() });
    if (r.status === "conflict") { setConflict({ seq: r.meta_seq }); return; }
    await setSetting("sync_meta_seq", String(r.meta_seq)); setConflict(null);
    setMsg({ ok: true, text: `Sicherung hochgeladen (${b.rows} Einträge, ${b.files} Dateien, verschlüsselt).` });
  });
  const fetchCloud = () => run("Hole Sicherung …", async () => {
    const r = await call<CloudInfo | null>("sync_download");
    if (!r) { setMsg({ ok: true, text: "Auf dem Server liegt noch keine Sicherung." }); return; }
    setPending(r);
  });
  const applyCloud = () => run("Spiele Sicherung ein …", async () => {
    if (!pending) return;
    const u = unb64(pending.b64);
    await restoreBackup(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);
    await setSetting("sync_meta_seq", String(pending.meta_seq));
    setPending(null); setConflict(null);
    window.location.reload();
  });
  const deleteAccount = () => run("Lösche Konto …", async () => {
    if (!delArm) { setDelArm(true); return; }
    await call("sync_delete_account", { password: f.password });
    await setSetting("sync_meta_seq", ""); setUser(null); setDelArm(false); setF((x) => ({ ...x, password: "" }));
    setMsg({ ok: true, text: "Konto und alle Daten auf dem Server sind gelöscht. Hier auf dem Gerät ist nichts verändert." });
  });

  const field = (k: keyof typeof f, label: string, type = "text", ph = "") => (
    <label className="lab">{label}<input className="field" type={type} value={f[k]} placeholder={ph} autoComplete="off" onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );

  return (
    <div className="syncp">
      <p className="tutnote">TEST: nur mit erfundenen Daten benutzen, bis Server, Datenschutz und Review freigegeben sind.</p>
      {msg && <div className={msg.ok ? "tutnote ok" : "errbox"}>{msg.text}</div>}
      {busy && <p className="small">{busy}</p>}

      {rk && (
        <div className="rkbox">
          <b>Dein Wiederherstellungsschlüssel</b>
          <p>Damit kommst du an deine Daten, wenn du das Passwort vergisst. <b>Er wird nur jetzt angezeigt.</b> Schreib ihn auf Papier oder speichere ihn im Passwortmanager, nicht in dieser App.</p>
          <code className="rkcode">{rk}</code>
          <label className="tutcheck"><input type="checkbox" checked={rkOk} onChange={(e) => setRkOk(e.target.checked)} /> Ich habe den Schlüssel sicher aufgeschrieben.</label>
          <button className="btn" disabled={!rkOk} onClick={() => setRk(null)}><span>Fertig</span></button>
        </div>
      )}

      {!rk && !user && (
        <>
          <div className="seg">{([["login", "Anmelden"], ["register", "Mit Einladung registrieren"], ["recover", "Passwort vergessen"]] as [Mode, string][]).map(([m, l]) => (
            <button key={m} className={"segb" + (mode === m ? " on schule" : "")} onClick={() => { setMode(m); setMsg(null); }}><span>{l}</span></button>))}</div>
          {field("url", "Server-Adresse", "text", "https://192.168.50.20")}
          <div className="sysrow"><span>Server-Zertifikat (ca.crt)</span><span className="inl"><span className="small">{f.ca ? "gewählt" : "fehlt"}</span><button className="mini" onClick={pickCa}>Datei wählen</button></span></div>
          {mode === "register" && field("invite", "Einladung")}
          {field("username", "Benutzername", "text", "z. B. anna.m")}
          {mode === "recover" && field("recovery", "Wiederherstellungsschlüssel", "text", "XXXX-XXXX-…")}
          {field("password", mode === "recover" ? "Neues Passwort (mind. 12 Zeichen)" : mode === "register" ? "Passwort (mind. 12 Zeichen)" : "Passwort", "password")}
          {mode !== "login" && field("password2", "Passwort wiederholen", "password")}
          <div className="actions static">
            <button className="btn" disabled={!!busy} onClick={mode === "login" ? login : mode === "register" ? register : recover}>
              <span>{mode === "login" ? "Anmelden" : mode === "register" ? "Konto anlegen" : "Neues Passwort setzen"}</span></button>
          </div>
        </>
      )}

      {!rk && user && (
        <>
          <p>Angemeldet als <b>{user}</b> ({device()}).</p>
          <div className="actions static">
            <button className="btn" disabled={!!busy} onClick={() => upload()}><span>Sicherung hochladen</span></button>
            <button className="btn ghost" disabled={!!busy} onClick={fetchCloud}><span>Vom Server holen</span></button>
            <button className="mini" disabled={!!busy} onClick={logout}>Abmelden</button>
          </div>
          {conflict && (
            <div className="errbox">
              Auf dem Server liegt eine neuere Sicherung von einem anderen Gerät. Hochladen würde sie überschreiben.
              <div className="inl" style={{ marginTop: 8 }}>
                <button className="mini" onClick={fetchCloud}>Erst ansehen / holen</button>
                <button className="mini hot" onClick={() => upload(conflict.seq)}>Trotzdem überschreiben</button>
              </div>
            </div>
          )}
          {pending && (
            <div className="errbox">
              Sicherung vom {when(pending.created)} ({pending.device}, {Math.round(pending.size / 1024)} KB).
              <b> Sie ersetzt alle Daten auf diesem Gerät.</b> Wenn du hier seit dem letzten Hochladen etwas geändert hast, lade es vorher hoch oder erstelle unter „Daten mitnehmen“ eine lokale Sicherung.
              <div className="inl" style={{ marginTop: 8 }}>
                <button className="mini hot" onClick={applyCloud}>Ja, einspielen</button>
                <button className="mini" onClick={() => setPending(null)}>Abbrechen</button>
              </div>
            </div>
          )}
          <details className="small" style={{ marginTop: 10 }}>
            <summary>Konto auf dem Server löschen</summary>
            {field("password", "Passwort zur Bestätigung", "password")}
            <button className={"mini" + (delArm ? " hot" : "")} disabled={!!busy || !f.password} onClick={deleteAccount}>{delArm ? "Wirklich alles auf dem Server löschen?" : "Konto löschen"}</button>
          </details>
        </>
      )}
    </div>
  );
}
