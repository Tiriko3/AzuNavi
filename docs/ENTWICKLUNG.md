# AzuNavi (Version 1.0)

Lokale App für Schule und Arbeit. Tauri + React/TypeScript + SQLite.

    npm install
    npm run dev          # nur Oberfläche im Browser (http://localhost:1420)
    npm run tauri dev    # echte App als Fenster (erster Start: Rust kompiliert, dauert)
    npm run tauri build -- --no-bundle   # portable .exe ohne Installer

Wichtige Dateien:
- src/App.tsx          Menü, Tasten, Übergänge, Speichern der Auswahl
- src/PageView.tsx     Innenseiten (in Etappe 1 leer, System zeigt Ton und Datenbank)
- src/db/db.ts         SQLite öffnen, Einstellungen lesen und schreiben
- src/db/migrations.ts Tabellen (neue Etappen hängen hier Versionen an)
- src/sound.ts         selbst erzeugte Töne
- src/assets/hero.webp deine freigestellte Figur
- src-tauri/           Rust, Fensterkonfiguration, Rechte, Icons
