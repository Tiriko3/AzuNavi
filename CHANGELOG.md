# Änderungen

## 0.5.0 – Handy-App mit Datenordner-Format und Passwortschutz
- **Gleiche Datenschicht wie PC und Web:** Die Android-App speichert jetzt wie das PC-Programm und die Web-App in `azunavi.db` und `dateien/` (im geschützten App-Speicher unter `azunavi/`), mit derselben Verschlüsselung. Es gibt keinen Ordner zu wählen: Das Handy hat genau einen Speicher.
- **Passwortschutz am Handy:** Dieselben Profile wie am PC und im Browser (Passwort, Wiederherstellungsschlüssel, automatische Sperre, „Angemeldet bleiben“). Mehr → Passwortschutz.
- **Alte Daten übernehmen:** Beim ersten Start nach dem Update bietet die Handy-App an, die alten Daten zu übernehmen (Notizen, Kontakte, Projekte, Anhänge, Porträts, Vorlage).
  - **Vorher** speicherst du eine Sicherung über den Android-Speicherdialog (z. B. in OneDrive). Sie hat dasselbe Format wie „Daten mitnehmen“ und lässt sich mit „Sicherung einspielen“ wieder laden. **Ohne gespeicherte Sicherung wird nichts übernommen.**
  - Danach werden alle Zeilen nach dem Kopieren zur Probe mit dem Original verglichen, jede Datei wird zurückgelesen, und die Datenbank wird als **letzter** Schritt geschrieben. Bricht etwas ab, bleibt der Speicher leer und es geht von vorn.
  - Die alte Datenbank und die alten Dateien bleiben unverändert liegen und werden nie gelöscht.
- **Austausch Handy ↔ PC:** weiterhin über die Sicherungsdatei (Mehr → Sicherung erstellen / einspielen oder Cloud-Sicherung). Android kann Ordner in OneDrive nicht verlässlich öffnen, deshalb gibt es am Handy keinen gemeinsamen Live-Ordner.
- **Kleinere Rechte:** Die alte Datenbank darf am Handy nur noch gelesen werden (nur zur einmaligen Übernahme), nicht mehr beschrieben. Das SQL-Plugin wird sonst nirgends mehr benutzt.
- Bilder aus der Galerie landen im Datenordner (verschlüsselt, wenn das Profil ein Passwort hat).
- Neu: Browser-Durchläufe als Handy (`tools/desktop-e2e.mts`, Abschnitte J bis L), Test der Sicherung der alten Daten (`tools/desktop-test.mts`).

## 0.4.3 – Freigaben ansehen und entziehen, kleinere Rechte am PC
- **System → Freigegebene Ordner (PC):** Eine Übersicht zeigt, auf welche Ordner und Dateien AzuNavi außerhalb des Datenordners zugreifen darf. Jeder Ordner lässt sich mit zwei Klicks wieder entziehen („Entziehen“, dann „Wirklich entziehen?“), die einzelnen verknüpften Dateien und die Rückgängig-Orte mit „Alle entziehen“. Es wird nie etwas gelöscht oder verändert: Die Ordner und Dateien bleiben liegen, du wählst sie bei Bedarf auf der Dateien-Seite neu aus. Der Entzug wirkt sofort.
- **Kleinere Rechte (capabilities) am PC:** Das Fenster darf am PC nur noch die alte `persona.db` lesen und laden (nicht mehr schreiben), im App-Ordner nur lesen (nicht mehr schreiben) und den Öffnen-Dialog benutzen (nicht mehr Speichern, Meldungen, Fragen). Schreiben und Speichern laufen über die geprüften Rust-Befehle (Datenordner, Freigaben).
- **Handy unverändert:** Die Rechte der Android-App stehen jetzt in `capabilities/mobile.json` genau wie vorher (die Datei `default.json` gilt nur noch für Windows, Linux und macOS).
- Neu: Rust-Test fürs Entziehen (`fsguard.rs`), Browser-Test der Übersicht (`tools/desktop-e2e.mts`, Abschnitt I).

## 0.4.2 – Startbildschirm mit Wasser-Animation und Intro
- **Startbildschirm:** Hinter der Startkarte läuft ruhiges Wasser mit Lichtstrahlen und Blasen (kleines WebM ohne Ton, nahtlose Schleife, ca. 215 KB). Es pausiert, wenn das Fenster nicht sichtbar ist.
- **Intro beim Start:** Beim Öffnen von AzuNavi läuft einmal pro Start ein kurzer Übergang (ca. 4 s, Panels und Blasen, ca. 860 KB). Ein Klick oder eine Taste überspringt ihn. Innerhalb derselben Sitzung (z. B. nach „Sperren“ oder Neuladen) kommt er nicht noch einmal.
- **Abschaltbar:** Der Schalter **System → Animationen** schaltet beides aus (dann nur Standbild und kein Intro). Das gilt schon beim nächsten Start, auch vor dem Laden der Datenbank. Wünscht das Betriebssystem „reduzierte Bewegung“, bleibt es ebenfalls beim Standbild.
- Gilt für PC-Programm und Web-App. Die Handy-App ist unverändert.
- Web-App: Der Service Worker legt Videos (Teilantworten) nicht mehr in den Zwischenspeicher, damit es keine Fehlermeldungen gibt.
- Die Videos wurden mit Gemini erzeugt und sind für die private Nutzung gedacht, nicht zum Weitergeben oder Veröffentlichen.
- Tests: `tools/desktop-e2e.mts` prüft jetzt auch, dass das Video wirklich läuft, das Intro erscheint und sich überspringen lässt, nicht doppelt kommt und bei „Animationen aus“ und reduzierter Bewegung entfällt.

## 0.4.1 – Datei-Befehle nur noch an freigegebenen Orten (PC)
- **Sicherer Zugriff auf deine Dateien:** Die Datei-Befehle (Dateien-Seite, Verschieben, Vorschau, Öffnen, Cloud-Sicherung) arbeiten am PC nur noch in Ordnern und an Dateien, die du selbst freigegeben hast. Vorher konnten sie jeden Pfad lesen und schreiben und waren nur durch die Sicherheitsregeln des Fensters geschützt.
- **Wie etwas freigegeben wird:** Du wählst Ordner (Arbeit, Schule, Cloud-Ordner) und Dateien in Dialogen, die das Programm selbst (Rust) öffnet. Gewählte Ordner merkt sich AzuNavi dauerhaft (`freigaben.json`). Mit einem Projekt verknüpfte Dateien ebenfalls. Alles andere, was du auswählst oder aufs Fenster ziehst, gilt nur für diese Sitzung. Das Frontend kann nichts selbst freigeben.
- **Einmalige Rückfrage beim ersten Start:** AzuNavi fragt in einem Windows-Fenster, ob die bisher benutzten Ordner und verknüpften Dateien weiter erlaubt sein sollen (mit Liste der Ordner). Ein Klick auf „Erlauben“, danach läuft alles wie bisher. Bei „Nicht jetzt“ wählst du die Ordner auf der Dateien-Seite einfach neu aus.
- **Geprüft wird der echte Ort:** Verknüpfungen, die aus einem freigegebenen Ordner hinausführen, und `..` im Pfad werden abgelehnt. Ein Ordner „Arbeit2“ ist nicht „Arbeit“.
- **Rückgängig nach einem Neustart:** Der Ordner, aus dem eine Datei verschoben wurde (z. B. Downloads), wird nur als Ziel zum Zurücklegen gemerkt, nie zum Lesen.
- **„Speichern unter“** öffnet und schreibt jetzt Rust selbst.
- Android: unverändert (die Prüfung gibt es nur am PC).
- Noch offen: Rechte in `capabilities` verkleinern (nach der Umstellung von Android).
- Neu: Rust-Tests in `src-tauri/src/fsguard.rs`, `tools/grants-test.mts`.

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
