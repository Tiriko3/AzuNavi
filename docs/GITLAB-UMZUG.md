# Umzug von GitHub auf git.hhu.de (Neustart mit Version 0.1.0)

Danach baut und veröffentlicht euer GitLab alles selbst: Web-App (GitLab Pages), Android-APK und auf Wunsch das Windows-Programm. Dauer: etwa 30–45 Minuten plus Wartezeit für den ersten Bau.

## 0. Vorher prüfen (git.hhu.de, Anmeldung mit dem Uni-Konto)
git.hhu.de ist das GitLab der Heinrich-Heine-Universität. Vor dem Start nachsehen, was es dort gibt:
- **Pages:** ist auf git.hhu.de vorhanden (Deploy → Pages).
- **Package Registry:** ist vorhanden (Deploy → Package registry).
- **Runner:** Es gibt 2 Instance-Runner. Prüfen: Settings → CI/CD → Runners → Reiter **Instance** → auf einen Runner klicken. Wichtig sind **Tags** (die Pipeline arbeitet ohne Tags), „Run untagged jobs“, Executor (Docker?) und „Maximum job timeout“. Für den Android-Bau sollte das Limit mindestens 60 Minuten betragen.
- **Proxy:** Brauchen Jobs einen Proxy ins Internet? Das zeigt der erste Lauf (siehe unten).
- **Konten:** Wer die App nutzen soll, braucht einen Zugang zu git.hhu.de (Uni-Konto) und muss Projektmitglied sein.
Bei offenen Fragen: Support **git@hhu.de**.

## 1. Projekt anlegen
GitLab → **New project → Create blank project** → Name `AzuNavi`, Sichtbarkeit **Private**, Haken bei „Initialize repository with a README“ **weg** → Create.

## 2. Code hochladen (PowerShell)
Die alten Versions-Tags (v1.x) bleiben auf GitHub. Auf GitLab beginnen wir neu mit **v0.1.0**, deshalb **ohne** `--tags`:
```powershell
cd C:\dev\azunavi
git remote add gitlab https://git.hhu.de/DEINE-GRUPPE/AzuNavi.git
git push gitlab main
git push gitlab online
```
Ab jetzt soll GitLab der Standard sein:
```powershell
git remote rename origin github
git remote rename gitlab origin
git branch --set-upstream-to=origin/main main
```

## 3. Schützen (Settings → Repository)
- **Protected branches:** `main`, Allowed to push: Maintainers, Allowed to force push: **aus**
- **Protected tags:** `v*`, Allowed to create: Maintainers

Wichtig: Geschützte CI-Variablen gibt es nur in geschützten Zweigen und Tags. Ohne diesen Schritt bekommt die Android-APK den echten Schlüssel nicht.

## 4. CI/CD-Variablen (Settings → CI/CD → Variables → Add variable)
| Key | Wert | Optionen |
|---|---|---|
| `ANDROID_KEYSTORE_B64` | Inhalt aus dem Befehl unten | Protect ✓ |
| `ANDROID_KEYSTORE_PASSWORD` | dein Keystore-Passwort | Protect ✓, Mask ✓ |
| `ANDROID_KEY_ALIAS` | `azunavi` | Protect ✓ |

Den Schlüssel in die Zwischenablage holen:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\azunavi-android.jks")) | Set-Clipboard
```
Falls die Runner einen Proxy brauchen: zusätzlich `HTTP_PROXY`, `HTTPS_PROXY` und `NO_PROXY` als Variablen anlegen (Werte von der Administration).

## 5. Wer darf die Web-App öffnen? (Settings → General → Visibility)
Bei **Pages** „Only project members“ wählen, falls die Option da ist. Dann können nur Mitglieder des Projekts die Web-App öffnen. Azubis als Mitglied mit der Rolle **Guest** hinzufügen (Manage → Members). Fehlt die Option, ist die Web-App für alle erreichbar, die die Pages-Adresse kennen. Die App selbst enthält keine Nutzerdaten, nur Programmcode.

## 6. Erster Lauf: Web-App, dann Version 0.1.0
**a) Web-App:** Sobald `main` hochgeladen ist (Schritt 2), startet automatisch eine Pipeline. Unter **Build → Pipelines** laufen `pakete-pruefen` und `create-pages`. Wenn `create-pages` grün ist, steht unter **Deploy → Pages** die Adresse der Web-App. Öffne sie und prüfe, ob der Startbildschirm kommt.

**b) Version 0.1.0 mit Android-APK:**
```powershell
git tag v0.1.0
git push origin v0.1.0
```
Dann läuft zusätzlich `android` (beim ersten Mal etwa 20–30 Minuten). `windows` steht auf „manuell“ (▶ klicken, nur falls ein Windows-Runner existiert).

Die App zeigt danach unter System „Version 0.1.0“. **Bestehende Installationen lassen sich trotzdem einfach aktualisieren:** Die Pipeline gibt der Android-App intern eine höhere Nummer als allen alten 1.x-Versionen (0.1.0 → 2.000.100), und das Windows-Installationsprogramm erlaubt die kleinere Versionsnummer. Daten bleiben erhalten.

## 7. Wo ist was? Eine Adresse für alles
**Download-Seite (immer die neueste Version):**
`https://git.hhu.de/qov83dor/AzuNavi/-/releases/permalink/latest`

Sie entsteht automatisch bei jedem Tag `v…` (Job `release` in der Pipeline). Dort stehen die Android-App (APK) und der Link zur Web-App, dazu die Änderungen aus `CHANGELOG.md`. Diesen einen Link gibst du weiter. Alle Versionen: **Deploy → Releases**.

- **Web-App:** Deploy → Pages (die Web-App verlinkt selbst auf die Download-Seite).
- **Windows-Programm:** siehe Abschnitt „Windows-Setup veröffentlichen“ direkt darunter (ein Befehl auf deinem PC).
- **Falls der Job `release` rot wird:** Deploy → Releases → **New release**, den Tag wählen und die APK-Adresse aus Deploy → Package registry als Asset-Link eintragen.

## Windows-Setup veröffentlichen (ein Befehl auf deinem PC)
Auf git.hhu.de gibt es keinen Windows-Runner. Deshalb baust du das Windows-Programm auf deinem PC. Das Skript lädt es hoch und hängt es an dieselbe Download-Seite wie die Android-App.

**Einmalig: Zugangs-Token erzeugen**
- Projekt → **Settings → Access tokens → Add new token** (falls es das Menü gibt, Rolle **Developer**), Haken bei **`api`**, Ablauf in etwa einem Jahr.
- Alternativ: Profilbild → **Preferences → Access tokens** (persönlicher Token, Haken bei `api`).
- Token kopieren (wird nur einmal angezeigt). **Nie** in eine Datei im Projekt schreiben oder hochladen.

**Bei jeder neuen Version**
1. Version hochladen und Tag setzen (siehe oben), die Pipeline `v…` soll **grün** sein (dann existiert die Download-Seite).
2. Auf deinem PC (PowerShell):
```powershell
cd C:\dev\azunavi
$env:GITLAB_TOKEN = "glpat-DEIN-TOKEN"
npm run release:windows
```
Das Skript baut das Programm, lädt `AzuNavi_<version>_x64-setup.exe` und die portable Datei in die Package Registry und hängt beide an die Download-Seite. Dauer beim ersten Bau etwa 5–10 Minuten.

Ohne neu zu bauen (die Dateien liegen schon da): `npm run release:windows -- --no-build`.

**Wenn es klemmt:** Die Meldungen sind auf Deutsch und nennen die Lösung, z. B. „Der Tag v… gibt es noch nicht“ oder „Das Tauri-Werkzeug ist beschädigt“. Letzteres: `Remove-Item node_modules -Recurse -Force; npm cache clean --force; npm ci`.

**Hinweis zu Windows-Warnungen:** Das Setup ist nicht digital signiert. Windows zeigt beim ersten Start „Der Computer wurde durch Windows geschützt“. Lösung: **Weitere Informationen → Trotzdem ausführen**. Auf verwalteten Firmen-PCs kann eine Richtlinie unsignierte Programme blockieren, dann hilft die Web-App.

## 8. GitHub aufräumen (erst wenn alles läuft)
- GitHub-Repository → Settings → ganz unten **Archive this repository** (oder auf Private stellen)
- Settings → Pages → deaktivieren
- Settings → Secrets → die drei Android-Secrets löschen
- Die Ordner `.github/` kann man dann im Repository löschen: `git rm -r .github`

## Ab jetzt: neue Versionen
Versionsnummer erhöhen (Claude liefert sie mit jedem Update mit), dann:
```powershell
git add .
git commit -m "Version 0.1.1: …"
git push
git tag v0.1.1
git push origin v0.1.1
```
Was sich je Version geändert hat, steht in `CHANGELOG.md`.

## Wenn etwas rot wird
Den roten Job öffnen, die letzten ~30 Zeilen kopieren und an Claude schicken. Häufig: fehlender Proxy (Downloads schlagen fehl) oder kein passender Runner („This job is stuck“).
