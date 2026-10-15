# Baut die Persona App als portable .exe (ohne Installer) und legt sie fertig zum Mitnehmen ab.
# Aufruf in PowerShell im Projektordner:   .\build-portable.ps1
# Falls Skripte gesperrt sind:             powershell -ExecutionPolicy Bypass -File .\build-portable.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/3 Pakete prüfen ..." -ForegroundColor Cyan
npm install

Write-Host "2/3 App bauen (das dauert beim ersten Mal einige Minuten) ..." -ForegroundColor Cyan
npm run portable

$exe = Join-Path $PSScriptRoot "src-tauri\target\release\persona-app.exe"
if (-not (Test-Path $exe)) { throw "Die .exe wurde nicht gefunden: $exe" }

Write-Host "3/3 Portable Ordner anlegen ..." -ForegroundColor Cyan
$out = "C:\dev\Persona-App-Portable"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $exe (Join-Path $out "Persona App.exe") -Force
@"
Persona App – portable Version
==============================
Starten: Doppelklick auf "Persona App.exe". Beim ersten Start legt die App
selbst eine Verknüpfung "Persona App" auf dem Desktop an.

Auf einen anderen Laptop mitnehmen:
1. Im alten Laptop: System -> "Sicherung erstellen" (eine .zip-Datei).
2. Diesen Ordner (mit "Persona App.exe") und die Sicherung auf den neuen Laptop kopieren.
3. "Persona App.exe" starten, Tutorial überspringen, System -> "Sicherung einspielen".
4. Unter Dateien die Ordner Arbeit/Schule neu wählen (die echten Ordner kopierst du selbst).

Voraussetzung: Windows 10 oder 11 (Microsoft Edge WebView2 ist dort schon installiert).
Deine Daten liegen in %APPDATA%\com.local.personaapp, nicht im App-Ordner.
"@ | Set-Content -Encoding UTF8 (Join-Path $out "LIESMICH.txt")

$size = [math]::Round((Get-Item (Join-Path $out "Persona App.exe")).Length / 1MB, 1)
Write-Host ""
Write-Host "Fertig: $out\Persona App.exe ($size MB)" -ForegroundColor Green
