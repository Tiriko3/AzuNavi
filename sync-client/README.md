# AzuNavi Sync-Client (ENTWURF 0.1.0)

Rust-Baustein für die App: verschlüsselt auf dem Gerät und spricht mit dem AzuNavi-Server. Wird in der nächsten Runde in den Tauri-Teil eingebaut, damit Schlüssel und Tokens **nie im JavaScript** landen.

## Was er tut
- Konto anlegen (mit Einladung), anmelden, abmelden, Passwort ändern, Konto löschen.
- Passwort vergessen: Wiederherstellung mit dem 52-stelligen Wiederherstellungsschlüssel (wird nur bei der Registrierung einmal angezeigt).
- Datensätze verschlüsseln (XChaCha20-Poly1305, Datensatz-ID als Zusatzdaten) und abgleichen, Zugriffstoken automatisch erneuern.

## Schutzmaßnahmen
- **Pinning:** Bei `https://` wird nur die mitgegebene CA akzeptiert, keine öffentlichen Zertifikate, nur TLS 1.3, keine Weiterleitungen. Unverschlüsseltes `http://` nur für `127.0.0.1`/`localhost` und nur im Entwicklungs-Build.
- **Zu schwache Schlüssel-Parameter vom Server werden abgelehnt** (Schutz gegen einen manipulierten Server).
- **Veränderte oder vertauschte Datensätze fallen auf** (Fehler `Tampered`), statt still falsche Daten zu zeigen.
- Passwort mindestens 12 Zeichen. Schlüssel und Tokens werden nach Gebrauch im Speicher überschrieben (`zeroize`).

## Tests
```bash
cd sync-client
cargo test     # 15 Tests: 11 gegen den echten Server (inkl. Cloud-Sicherung), 4 mit echtem TLS (eigene CA ok, fremde CA, TLS 1.2, mehrere CAs)
```

## Noch offen (nächste Runde)
Einbau in die App (Tauri-Befehle, Konto-Oberfläche, Anzeige des Wiederherstellungsschlüssels, Abgleich der lokalen Tabellen), sicheres Merken der Anmeldung im Schlüsselspeicher des Betriebssystems.
