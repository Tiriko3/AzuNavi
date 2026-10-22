// „Datenschutz & Speicherorte“: was AzuNavi speichert, wo, und wie man es wieder los wird. Gleicher Text am PC, im Browser und auf dem Handy.
import { inTauriApp, isDesktopApp, isMobile, isWebApp, usesDataFolder } from "./platform";

export function PrivacyInfo() {
  return (
    <div className="privacy">
      <p><b>Kurz:</b> AzuNavi hat keinen Server, keine Konten, keine Werbung und kein Tracking. Deine Daten liegen nur dort, wo du sie speicherst.</p>
      <h4>Wo liegen meine Daten?</h4>
      <ul>
        {isDesktopApp && <li><b>PC-Programm:</b> in deinem gewählten Datenordner (<code>azunavi.db</code>, <code>dateien/</code>, bei Passwortschutz <code>profil.json</code>), derselbe Aufbau wie in der Web-App. Die alte Datenbank von früheren Versionen (<code>persona.db</code> unter <code>%APPDATA%\com.local.personaapp</code>) und die Sicherung davor bleiben dort liegen, bis du sie selbst löschst. AzuNavi fasst im Datenordner nur seine eigenen Dateien an.</li>}
        {inTauriApp && isMobile && <li><b>Handy-App:</b> im geschützten Speicher der App auf diesem Handy.</li>}
        {isWebApp && <li><b>Web-App:</b> in deinem gewählten Datenordner (<code>azunavi.db</code>, <code>dateien/</code>) oder, wenn du „Nur in diesem Browser“ gewählt hast, im Speicher dieses Browsers.</li>}
        <li><b>Sicherungen</b> liegen nur dort, wo du sie speicherst. Die Cloud-Sicherung ist mit deinem Passwort verschlüsselt (AES-256).</li>
      </ul>
      {isWebApp && <>
        <h4>Was passiert beim Aufruf der Web-App?</h4>
        <p>Die App-Dateien kommen von dem Webserver, auf dem die Web-App liegt (z. B. GitLab Pages eures Betriebs). Dabei entstehen wie bei jedem Webserver technische Protokolle, etwa mit deiner IP-Adresse. Deine Inhalte gehen dabei nie an den Server. Das verhindern auch die Sicherheitsregeln der App.</p>
      </>}
      {usesDataFolder && <>
        <h4>Passwortschutz (Profil)</h4>
        <p>Mit Passwortschutz sind Datenbank und Anhänge verschlüsselt (AES-256). Das Passwort wird nirgends gespeichert; es gibt keinen Zugang durch andere und keinen Reset. Wer Ordner <b>und</b> Passwort (oder Wiederherstellungsschlüssel) hat, kommt an die Daten, sonst niemand. Dateinamen und -größen bleiben sichtbar, nur der Inhalt ist verschlüsselt. „Angemeldet bleiben“ speichert einen Schlüssel nur auf diesem Gerät (im Browser bzw. im Programm), nie das Passwort. Die ZIP-Sicherung „Daten mitnehmen“ enthält die Daten unverschlüsselt, bewahre sie entsprechend auf.</p>
      </>}
      {isWebApp && <>
        <h4>Ordner-Freigaben (Dateien-Seite)</h4>
        <p>Der Browser darf nur auf Ordner zugreifen, die du einzeln freigibst. Die Freigabe merkt sich nur dieser Browser (nicht die Datenbank und nicht deine Cloud). Die Erlaubnis läuft ab, wenn du den Browser schließt, und du bestätigst sie mit einem Klick neu. Dateien in diesen Ordnern werden von AzuNavi <b>nicht</b> verschlüsselt, das sind deine normalen Dateien. Nur die App-Daten im Datenordner sind mit Passwortschutz verschlüsselt.</p>
      </>}
      <h4>Daten anderer Menschen (Kontakte)</h4>
      <p>Speichere nur, was du für die Ausbildung brauchst. In „Notizen zur Person“ gehören <b>keine Bewertungen, keine Gesundheitsdaten und nichts Privates</b>.</p>
      <h4>Speicherort</h4>
      <p>Wo deine Daten liegen, entscheidest du: auf diesem Gerät, im Browser oder in deinem Cloud-Ordner (z. B. OneDrive, privat oder vom Betrieb). Liegen sie in einer Cloud, kommst du von jedem Gerät an sie heran, auf dem du diesen Ordner öffnest.</p>
      <h4>Gemeinsam genutzte PCs</h4>
      <p>Auf PCs, die auch andere benutzen (Schule, Schulungsraum), wähle in der Web-App einen eigenen Datenordner und entferne danach die Daten aus dem Browser (System → Datenordner → „Aus diesem Browser entfernen“).</p>
      <h4>Löschen</h4>
      <p>System → „App zurücksetzen“ löscht alle Einträge. Am Ende der Ausbildung: erst eine Sicherung aufheben, dann zurücksetzen.</p>
    </div>
  );
}
