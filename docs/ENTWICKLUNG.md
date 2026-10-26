# AzuNavi: Hinweise für die Entwicklung (Stand 0.8.1)

Lokale App für Schule und Arbeit. **Tauri 2** (Rust) + **React/TypeScript** + **SQLite als WebAssembly (sql.js)**. Läuft am PC (Windows), am Handy (Android) und als Web-App im Browser. Alles offline.

## Starten und bauen

    npm install
    npm run dev            # nur die Oberfläche im Browser (http://localhost:1420)
    npm run tauri dev      # das Programm als Fenster (erster Start: Rust kompiliert, dauert)
    npm run build          # Oberfläche für das Programm (dist/)
    npm run build:web      # Web-App (dist-web/)
    npm run release:windows  # Windows-Setup bauen und an das GitLab-Release hängen (braucht $env:GITLAB_TOKEN, siehe GITLAB-UMZUG.md)

Rust-Teile prüfen: `cd src-tauri && cargo check` (PC) · reine Rust-Tests: `rustc --edition 2021 --test src/datadir.rs` und `src/fsguard.rs`.

## Aufbau (wichtigste Dateien)

| Bereich | Dateien |
|---|---|
| Daten | `src/web/dataStore.ts` (Datenordner, Profile, Sperre), `src/web/webDb.ts` (SQLite im Speicher, Speichern als `azunavi.db`), `src/web/vault.ts` (Verschlüsselung), `src/web/disk.ts` + `src-tauri/src/data_cmds.rs` + `datadir.rs` (PC-Ordner, geprüfte Pfade), `src/web/appStore.ts` (Handy) |
| Übernahme alter Daten | `src/desktop/legacyImport.ts` (Logik), `legacy.ts` (Anbindung), `src/web/WebGate.tsx` (Startbildschirm) |
| Datei-Freigaben (PC) | `src-tauri/src/fsguard.rs`, `fs_grants.rs`, `files.rs`, `src/desktop/grants.ts` |
| Prüfung (Text) | `src/spell/builtin.ts`, `rules.ts` (Regeln), `spell.ts` (Wörterbuch, LanguageTool) |
| Design | `src/Water.tsx`, `Splash.tsx`, `night.ts`, `chars.ts`, `EmptyArt.tsx`, `web/motion.ts` (Videos, Bewegung), `src/assets/` (Bilder, Videos) |
| Tutorial | `src/tutorial/Tutorial.tsx`, `tour.ts` |
| Handy | `src/mobile/` |

## Tests (Ordner `tools/`)
Einmalig zum Testen (nicht ins Projekt aufnehmen): `npm i --no-save tsx fake-indexeddb playwright-core`

    npx tsx tools/desktop-test.mts      # Übernahme der alten Datenbank, Datenspeicher
    npx tsx tools/vault-test.mts        # Verschlüsselung
    npx tsx tools/grammar-test.mts      # Rechtschreib- und Grammatikregeln (mit echtem Wörterbuch)
    npx tsx tools/night-test.mts        # Nacht-Zeiten
    npm run build && npx tsx tools/desktop-e2e.mts   # Browser-Durchlauf mit nachgebauter Tauri-Schnittstelle (Chromium unter /opt/pw-browsers)

## Design-Dateien neu erzeugen
`python3 tools/make-design-assets.py <Ordner mit den Gemini-Originalen> [figuren|bg|video|ui|splash]`. Das Hochskalieren nutzt Real-ESRGAN (`tools/sr.py`, ncnn, CPU). `python3 tools/fix-heads.py` ergänzt oben angeschnittene Köpfe.
