# Änderungen

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
