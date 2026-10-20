// „Sicherung in deiner Cloud“: PC = fester Ordner (z. B. OneDrive), ein Klick sichert. Handy = Android-Speicherdialog, dort OneDrive wählen.
import { useEffect, useState } from "react";
import { getSetting, inTauri, setSetting } from "../db/db";
import { createBackup, restoreBackup } from "../backup";
import { fsapi, join } from "../fsapi";
import { isMobile, isWebApp, noDesktop } from "../platform";
import { APP_VERSION } from "../version";
import { CLOUD_PREFIX, backupName, decryptBackup, encryptBackup, isEncrypted } from "./cloudBackup";

export function CloudFolderPanel() {
  const [dir, setDir] = useState("");
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [remember, setRemember] = useState(false), [noCrypt, setNoCrypt] = useState(false);
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [pending, setPending] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  useEffect(() => { (async () => {
    setDir((await getSetting("cloud_dir")) ?? ""); setLast((await getSetting("cloud_last")) ?? "");
    const saved = await getSetting("cloud_pw"); if (saved) { setPw(saved); setPw2(saved); setRemember(true); }
  })(); }, []);

  const run = async (label: string, f: () => Promise<void>) => { setErr(""); setMsg(""); setBusy(label); try { await f(); } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); } setBusy(""); };
  const checkPw = () => { if (noCrypt) return; if (pw.length < 10) throw new Error("Das Passwort braucht mindestens 10 Zeichen."); if (pw !== pw2) throw new Error("Die beiden Passwörter sind nicht gleich."); };

  const pickDir = () => run("", async () => {
    const d = await (await fsapi()).pickFolder("Cloud-Ordner wählen (z. B. OneDrive\\AzuNavi)");
    if (d) { setDir(d); await setSetting("cloud_dir", d); }
  });
  const backup = () => run("Sichere …", async () => {
    checkPw();
    const b = await createBackup(APP_VERSION);
    const bytes = noCrypt ? b.bytes : await encryptBackup(b.bytes, pw);
    const name = backupName(!noCrypt), fs = await fsapi();
    let where: string | null;
    if (noDesktop) where = await fs.saveFile(name, bytes, "AzuNavi-Sicherung", noCrypt ? "zip" : "azb");   // im Dialog OneDrive wählen
    else { if (!dir) throw new Error("Bitte zuerst den Cloud-Ordner wählen."); where = join(dir, name); await fs.writeFile(where, bytes); }
    if (!where) return;
    await setSetting("cloud_pw", remember && !noCrypt ? pw : "");
    const stamp = new Date().toLocaleString("de-DE"); setLast(stamp); await setSetting("cloud_last", stamp);
    setMsg(`Gesichert (${b.rows} Einträge, ${b.files} Dateien${noCrypt ? "" : ", verschlüsselt"}). Deine Cloud lädt die Datei jetzt hoch.`);
  });
  const loadNewest = () => run("Suche die neueste Sicherung …", async () => {
    const fs = await fsapi();
    if (noDesktop || !dir) {
      const p = await fs.pickFile(); if (!p) return;
      setPending({ name: p.split(/[\\/]/).pop() ?? p, bytes: await fs.read(p, 500 * 1024 * 1024) }); return;
    }
    const list = (await fs.list(dir)).filter((e) => !e.is_dir && e.name.startsWith(CLOUD_PREFIX) && /\.(azb|zip)$/i.test(e.name)).sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
    if (!list.length) throw new Error("Im Cloud-Ordner liegt noch keine AzuNavi-Sicherung.");
    setPending({ name: list[0].name, bytes: await fs.read(list[0].path, 500 * 1024 * 1024) });
  });
  const apply = () => run("Spiele ein …", async () => {
    if (!pending) return;
    let zip = pending.bytes;
    if (isEncrypted(zip)) { if (!pw) throw new Error("Bitte das Passwort der Sicherung eingeben."); zip = await decryptBackup(zip, pw); }
    const r = await restoreBackup(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
    setPending(null); setMsg(`Eingespielt: ${r.rows} Einträge, ${r.files} Dateien. Die App startet neu …`);
    setTimeout(() => location.reload(), 1400);
  });

  return (
    <div className="cloudp">
      <p className="small">Deine Sicherung landet in deinem eigenen Cloud-Speicher (OneDrive, Google Drive, Nextcloud …). Auf dem anderen Gerät holst du sie von dort. AzuNavi betreibt dafür keinen Server.</p>
      {!noDesktop && <div className="sysrow"><span>Cloud-Ordner</span><span className="inl"><span className="small" style={{ wordBreak: "break-all" }}>{dir || "noch nicht gewählt"}</span><button className="mini" onClick={pickDir} disabled={!inTauri && false}>Wählen</button></span></div>}
      {!noDesktop && !dir && <p className="small">Tipp: Unter Windows liegt OneDrive meist unter <code>C:\Users\DEIN-NAME\OneDrive</code>. Leg dort einen Ordner „AzuNavi“ an und wähl ihn hier.</p>}
      {isWebApp && <p className="small">Im Browser wird die Sicherung als Datei gespeichert. Wähl im Dialog z. B. deinen OneDrive-Ordner. Liegt dein <b>Datenordner</b> schon in OneDrive, sind deine Daten ohnehin in deiner Cloud.</p>}
      {isMobile && <p className="small">Beim Sichern öffnet Android den Speicherdialog. Wähl dort links im Menü <b>OneDrive</b> (die OneDrive-App muss installiert sein) und einen Ordner.</p>}

      <label className="lab chk"><input type="checkbox" checked={!noCrypt} onChange={(e) => setNoCrypt(!e.target.checked)} /> Mit Passwort verschlüsseln (empfohlen)</label>
      {!noCrypt && <>
        <label className="lab">Passwort (mind. 10 Zeichen)<input className="field" type="password" value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} /></label>
        <label className="lab">Passwort wiederholen<input className="field" type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} /></label>
        <label className="lab chk"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Auf diesem Gerät merken</label>
        <p className="small">Ohne das Passwort lässt sich die Sicherung nicht öffnen, auch nicht von uns. Schreib es dir sicher auf.</p>
      </>}
      {noCrypt && <p className="errbox">Ohne Verschlüsselung kann dein Cloud-Anbieter Notizen, Kontakte und Berichtshefte lesen. Für Daten aus dem Betrieb bitte nicht nutzen.</p>}

      {err && <div className="errbox">{err}</div>}{msg && <div className="tutnote ok">{msg}</div>}{busy && <p className="small">{busy}</p>}
      <div className="actions static">
        <button className="btn" disabled={!!busy} onClick={backup}><span>{noDesktop ? "In die Cloud sichern" : "Jetzt in den Cloud-Ordner sichern"}</span></button>
        <button className="btn ghost" disabled={!!busy} onClick={loadNewest}><span>{noDesktop || !dir ? "Sicherung holen …" : "Neueste Sicherung holen"}</span></button>
      </div>
      {last && <p className="small">Zuletzt gesichert: {last}</p>}
      {pending && (
        <div className="errbox">
          „{pending.name}“ ersetzt <b>alle Daten auf diesem Gerät</b>.{isEncrypted(pending.bytes) && !pw && " Gib oben das Passwort der Sicherung ein."}
          <div className="inl" style={{ marginTop: 8 }}><button className="mini hot" onClick={apply}>Ja, einspielen</button><button className="mini" onClick={() => setPending(null)}>Abbrechen</button></div>
        </div>
      )}
    </div>
  );
}
