# Änderungen

## 0.4.0 – PC-Programm mit Datenordner und Profilen
- **Gleiche Daten am PC und im Browser:** Das PC-Programm legt seine Daten jetzt wie die Web-App in einem **Datenordner** ab (`azunavi.db`, `dateien/`, `profil.json`). Wählst du am PC und in der Web-App denselben Ordner (z. B. `OneDrive\AzuNavi`), arbeitest du an beiden Orten mit denselben Daten und demselben Profil.
- **Passwortschutz auch am PC:** Dieselben Profile mit Passwort und Wiederherstellungsschlüssel wie in der Web-App (Verschlüsselung der Datenbank und der Anhänge). System → Passwortschutz.
- **Alte Daten übernehmen:** Beim ersten Start bietet AzuNavi an, die alte `persona.db` samt Anhängen, Porträts und Vorlage zu übernehmen. **Vorher** wird eine Sicherung neben die alte Datei gelegt (`Sicherung-vor-0.4.0`, inklusive `persona.db-wal`, jede Kopie Byte für Byte geprüft). Danach wird alles Zeile für Zeile mit dem Original verglichen, die Datenbank wird als **letzter** Schritt geschrieben. Bricht etwas ab, bleibt der Ordner leer und es geht von vorn. Die alte Datenbank bleibt unverändert liegen und wird nie gelöscht.
- **Sicherer Zugriff auf den Datenordner:** Den Ordner wählst du im Dialog, den das Programm selbst öffnet. Rust liest, schreibt und listet nur AzuNavis eigene Dateien im gewählten Ordner (kein `..`, keine Laufwerke, keine Windows-Gerätenamen, keine Verknüpfungen). Geschrieben wird atomar (Zwischendatei, dann umbenennen, mit Wiederholungen, falls OneDrive die Datei kurz festhält). Fremde Dateien im Ordner bleiben unberührt.
- **Beim Beenden wird gespeichert:** Fenster schließen (X, Alt+F4, Beenden-Knopf) speichert zuerst alles und gibt die Sperre frei, damit die Web-App nicht warnt. Schlägt das Speichern fehl, bleibt das Fenster offen (zweites Schließen beendet trotzdem).
- **Fehlender Ordner:** Ist der Datenordner nicht erreichbar (Laufwerk, Cloud), zeigt AzuNavi das in der Liste an, statt einen neuen anzubieten.
- Anhänge und Porträts werden am PC in den Datenordner kopiert (`dateien/attachments`, `dateien/portraits`).
- Android-App unverändert (kommt in einer späteren Version). Die Rust-Befehle für den Datenordner gibt es nur am PC.
- Noch nicht in dieser Version: Die allgemeinen Datei-Befehle der Dateien-Seite (`fs_*`) und die Rechte in `capabilities` werden erst in 0.4.1 bzw. später eingeschränkt.
- Neu: `tools/desktop-test.mts` (Übernahme und Datenspeicher), `tools/desktop-e2e.mts` (Startbildschirm im Browser mit nachgebauter Tauri-Schnittstelle), `tools/legacy-fixture.mts`; Rust-Tests in `src-tauri/src/datadir.rs`.

## 0.3.1 – Dateien-Seite im Browser
- Die **Dateien-Seite** läuft jetzt auch in der Web-App (Chrome, Edge, Opera am PC): Du gibst deine Hauptordner (Arbeit und Schule) einmal frei, danach siehst du den Ordnerbaum, legst Ordner an, sortierst Dateien mit dem Assistenten ein, ordnest Projekte zu und nutzt Vorschau und Verlauf.
- **Ziehen & Ablegen** von Dateien und Ordnern ins Fenster funktioniert auch im Browser.
- Dateien von außerhalb werden **kopiert** (der Browser darf das Original nicht löschen), Verschiebungen innerhalb deiner freigegebenen Ordner sind echte Verschiebungen mit Rückgängig.
- Der Browser vergisst die Erlaubnis beim Schließen: Dann erscheint **„Zugriff erlauben“**, ein Klick genügt. Nicht verfügbar im Browser: „Im Explorer zeigen“, Ordner öffnen, „Datei suchen“ bei verschobenen Dateien.
- Andere Browser und Handys zeigen einen Hinweis statt der Seite.
- Neu: `tools/webfiles-test.mts` (Test der Datei-Logik).

## 0.3.0 – Profile mit Passwort (Web-App)
- **Passwortschutz mit Verschlüsselung** für die Web-App: Datenbank und Anhänge im Datenordner (oder im Browser-Speicher) werden mit AES-256-GCM verschlüsselt. Kein zentrales Konto, kein Server: Wer Ordner **und** Passwort hat, kommt an die Daten.
- Passwort mindestens 12 Zeichen (PBKDF2-SHA256, 600.000 Runden). Der Datenschlüssel liegt zweimal verpackt in `profil.json`: per Passwort und per **Wiederherstellungsschlüssel**, der bei der Einrichtung einmal angezeigt wird. Ohne beides sind die Daten weg (kein Admin-Reset).
- **Bestehende Daten werden automatisch übernommen** (jede Datei wird nach dem Verschlüsseln zur Probe entschlüsselt und verglichen; bei Abbruch macht der nächste Start weiter).
- **Angemeldet bleiben pro Gerät** (nicht exportierbarer Schlüssel im Browser, nie das Passwort), **Jetzt sperren** und **automatische Sperre** nach 5/15/30/60 Minuten.
- **Profilauswahl** für gemeinsam genutzte PCs: mehrere Speicherorte werden gemerkt, beim Start wählst du dein Profil.
- Passwort ändern, Passwort vergessen → Wiederherstellungsschlüssel. Einschalten unter System → Passwortschutz (am Handy: Mehr → Passwortschutz).
- Dateien sind an ihren Pfad gebunden: vertauschte oder manipulierte Dateien werden abgelehnt. Dateinamen und -größen bleiben sichtbar, nur der Inhalt ist verschlüsselt.
- PC-Programm und Android-App sind unverändert (kommen in einer späteren Version).
- Datenschutzseite erklärt den Passwortschutz.
- Neu: `tools/vault-test.mts` (Test der Verschlüsselung).

## 0.1.2 – Windows-Setup auf der Download-Seite
- Neuer Befehl `npm run release:windows`: baut das Windows-Programm, lädt Installer und portable Datei hoch und hängt sie an die Download-Seite der Version. Ohne Windows-Runner nötig, ein Befehl.
- Der Release-Job der Pipeline hängt seine Links an, wenn die Download-Seite schon existiert (Reihenfolge egal).

## 0.1.1 – Eine Adresse für alle Downloads
- Bei jeder neuen Version legt GitLab automatisch eine **Download-Seite (Release)** an, mit der Android-App und dem Link zur Web-App.
- Fester Link auf die jeweils **neueste Version**: `https://git.hhu.de/qov83dor/AzuNavi/-/releases/permalink/latest`
- Die Web-App verlinkt selbst auf diese Seite (Startbildschirm, System, Handy: Mehr).
- Neuer Diagnose-Job `runner-info` in der Pipeline.

## 0.1.0 – Neustart auf dem internen GitLab
Erste Version auf GitLab. Enthält alles aus der Entwicklung bis dahin:
- **Notizen, Berichtsheft (Word-Export mit eigener Vorlage), Projekte mit Netzplan und Pinnwand, Kontakte mit Netzplan**
- **Kontakt-Gruppen**: eine Person in mehreren Gruppen, ganze Gruppen zuweisen, Bereiche und Gruppen am Stück verschieben, Beziehungen (Leitung oder Kontakt)
- **Berufsprofile** mit Qualifikationen nach Ausbildungsordnung (optional)
- **Drei Wege**: Windows-Programm, Android-App (eigene Handy-Oberfläche mit Nami, Caramella und Eda), Web-App im Browser (installierbar, offline, Datenordner z. B. in OneDrive)
- **Sicherung** lokal und verschlüsselt in der eigenen Cloud
- **Sicherheit**: strenge Sicherheitsregeln (CSP), keine Verbindungen ins Internet, Datenschutzseite in der App
- Figuren in 4K-Auflösung

Die Versionsnummern davor (1.x) stammen aus der Entwicklungszeit auf GitHub. Installierte Apps lassen sich ohne Datenverlust auf 0.1.0 aktualisieren.
