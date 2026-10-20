// „Datenschutz & Speicherorte“: was AzuNavi speichert, wo, und wie man es wieder los wird. Gleicher Text am PC, im Browser und auf dem Handy.
import { inTauriApp, isMobile, isWebApp } from "./platform";

export function PrivacyInfo() {
  return (
    <div className="privacy">
      <p><b>Kurz:</b> AzuNavi hat keinen Server, keine Konten, keine Werbung und kein Tracking. Deine Daten liegen nur dort, wo du sie speicherst.</p>
      <h4>Wo liegen meine Daten?</h4>
      <ul>
        {inTauriApp && !isMobile && <li><b>PC-Programm:</b> im App-Ordner deines Benutzerkontos (Windows: <code>%APPDATA%\com.local.personaapp</code>).</li>}
        {inTauriApp && isMobile && <li><b>Handy-App:</b> im geschützten Speicher der App auf diesem Handy.</li>}
        {isWebApp && <li><b>Web-App:</b> in deinem gewählten Datenordner (<code>azunavi.db</code>, <code>dateien/</code>) oder, wenn du „Nur in diesem Browser“ gewählt hast, im Speicher dieses Browsers.</li>}
        <li><b>Sicherungen</b> liegen nur dort, wo du sie speicherst. Die Cloud-Sicherung ist mit deinem Passwort verschlüsselt (AES-256).</li>
      </ul>
      {isWebApp && <>
        <h4>Was passiert beim Aufruf der Web-App?</h4>
        <p>Die App-Dateien kommen von GitHub Pages (GitHub Inc., USA). Dabei speichert GitHub wie jeder Webserver technische Daten wie deine IP-Adresse. AzuNavi selbst schickt keine Inhalte ins Internet. Das verhindern auch die Sicherheitsregeln der App.</p>
      </>}
      <h4>Daten anderer Menschen (Kontakte)</h4>
      <p>Speichere nur, was du für die Ausbildung brauchst. In „Notizen zur Person“ gehören <b>keine Bewertungen, keine Gesundheitsdaten und nichts Privates</b>. Betriebliche Inhalte gehören in einen vom Betrieb erlaubten Speicher (z. B. Firmen-OneDrive), nicht in einen privaten.</p>
      <h4>Gemeinsam genutzte PCs</h4>
      <p>Auf PCs, die auch andere benutzen (Schule, Schulungsraum), wähle in der Web-App einen eigenen Datenordner und entferne danach die Daten aus dem Browser (System → Datenordner → „Aus diesem Browser entfernen“).</p>
      <h4>Löschen</h4>
      <p>System → „App zurücksetzen“ löscht alle Einträge. Am Ende der Ausbildung: erst eine Sicherung aufheben, dann zurücksetzen.</p>
    </div>
  );
}
