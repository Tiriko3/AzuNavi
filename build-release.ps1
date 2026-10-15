# AzuNavi 1.0 – baut BEIDE Varianten in einem Rutsch:
#   1) Installer:  "AzuNavi 1.0 Setup.exe"  (pro Benutzer, ohne Adminrechte, Startmenü + Desktop-Verknüpfung)
#   2) Portable:   "Portable\AzuNavi.exe"    (ohne Installation, legt beim Start selbst die Desktop-Verknüpfung an)
# Aufruf im Projektordner:  powershell -ExecutionPolicy Bypass -File .\build-release.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

Write-Host "1/3 Pakete prüfen ..." -ForegroundColor Cyan
npm install

Write-Host "2/3 App bauen (beim ersten Mal einige Minuten, der Installer-Baukasten NSIS wird automatisch geladen) ..." -ForegroundColor Cyan
npm run release

# Tauri benennt die .exe nach "mainBinaryName" (AzuNavi.exe); ältere Builds hießen persona-app.exe
$exe = @("src-tauri\target\release\AzuNavi.exe", "src-tauri\target\release\persona-app.exe") | ForEach-Object { Join-Path $PSScriptRoot $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
$setup = Get-ChildItem (Join-Path $PSScriptRoot "src-tauri\target\release\bundle\nsis") -Filter "*setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "Die .exe wurde nicht gefunden (src-tauri\target\release)." }
if (-not $setup) { throw "Der Installer wurde nicht gefunden (src-tauri\target\release\bundle\nsis)." }

Write-Host "3/3 Release-Ordner anlegen ..." -ForegroundColor Cyan
$out = "C:\dev\AzuNavi-$version"
New-Item -ItemType Directory -Force -Path (Join-Path $out "Portable") | Out-Null
Copy-Item $setup.FullName (Join-Path $out "AzuNavi $version Setup.exe") -Force
Copy-Item $exe (Join-Path $out "Portable\AzuNavi.exe") -Force
@"
AzuNavi $version
================

Zwei Varianten:

A) Installer: "AzuNavi $version Setup.exe"
   Doppelklick, installiert nur für dich (keine Adminrechte nötig).
   Legt Startmenü- und Desktop-Verknüpfung an.
   Deinstallieren: Windows-Einstellungen -> Apps -> AzuNavi.

B) Portable: Ordner "Portable" mit "AzuNavi.exe"
   Keine Installation, einfach starten (auch vom USB-Stick).
   Beim ersten Start erscheint die Verknüpfung "AzuNavi" auf dem Desktop.

Beide Varianten nutzen dieselben Daten (%APPDATA%\com.local.personaapp).
Eine alte Verknüpfung "Persona App" auf dem Desktop kannst du löschen.

Auf einen anderen Laptop mitnehmen:
1. Alter Laptop: System -> "Sicherung erstellen".
2. App (Installer oder Portable) und die Sicherung auf den neuen Laptop kopieren.
3. App starten, Tutorial überspringen, System -> "Sicherung einspielen".
4. Unter Dateien die Ordner Arbeit/Schule neu wählen.

Grammatik mit LanguageTool (optional):
Java 17+ installieren (winget install EclipseAdoptium.Temurin.21.JRE),
"LanguageTool Desktop" von languagetool.org laden und entpacken,
in der App: System -> Grammatik -> Ordner wählen.

Voraussetzung: Windows 10 oder 11 (WebView2 ist dort schon installiert).
"@ | Set-Content -Encoding UTF8 (Join-Path $out "LIESMICH.txt")

Write-Host ""
Write-Host "Fertig: $out" -ForegroundColor Green
Get-ChildItem $out -Recurse -File | ForEach-Object { "  {0}  ({1:N1} MB)" -f $_.FullName.Replace($out + '\',''), ($_.Length / 1MB) }
