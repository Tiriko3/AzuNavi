# AzuNavi Server (ENTWURF, Version 0.2.0)

Sync-Server für AzuNavi: Konten nur per Einladung, Ende-zu-Ende-verschlüsselter Abgleich. **Nur mit erfundenen Testdaten benutzen.**
Es gibt noch keine App-Anbindung (kommt in der nächsten Runde) und noch kein Sicherheits-Review durch Dritte.

## Was der Server speichert und was nicht
- Er speichert nur: Benutzername, einen Argon2id-Hash des **abgeleiteten Login-Werts** (nie das Passwort), Geräte, **verschlüsselte** Datensätze, Zeitstempel, Größen.
- Er sieht nie: Passwort, Datenschlüssel, Klartext der Notizen/Kontakte/Projekte. Die App verschlüsselt auf dem Gerät.
- Tokens und Einladungen liegen nur als Hash in der Datenbank. Gelöschtes wird überschrieben (`secure_delete`).

## Tests (alles im Speicher, keine echten Daten)
```bash
cd server
cargo test                  # 26 Tests: Einladungen, Anmeldung, Sperre, Token, Konten-Trennung, Limits, Wiederherstellung, Fuzzing
cargo clippy --all-targets  # Linter, 0 Warnungen
cargo audit                 # bekannte Schwachstellen in Abhängigkeiten (cargo install cargo-audit)
```
Rust 1.85+ nötig (getestet mit 1.91).

## Test-Aufbau auf deinem Proxmox (Ubuntu-24.04-VM, Docker)
1. VM anlegen (2 CPU, 2 GB RAM, 20 GB Platte), Ubuntu Server 24.04, Festplatte möglichst verschlüsselt (LUKS bei der Installation).
2. Docker installieren (offizielle Anleitung von docker.com) und den Ordner `server/` in die VM kopieren.
3. Zertifikate für den Test erzeugen (IP der VM einsetzen):
   ```bash
   cd server/deploy && ./make-test-certs.sh 192.168.50.20
   echo "BIND_IP=192.168.50.20" > .env
   ```
4. Starten:
   ```bash
   cd server && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   docker compose -f deploy/docker-compose.yml ps
   curl --cacert deploy/certs/ca.crt https://192.168.50.20/healthz     # -> ok
   ```
5. Einladung für einen Test-Azubi erzeugen (wird nur einmal angezeigt):
   ```bash
   docker compose -f deploy/docker-compose.yml run --rm --no-deps azunavi invite create --hours 48 --note "Test Anna"
   ```
   Hinweis: Der Befehl nutzt dasselbe Datenvolumen. Weitere Befehle: `invite list`, `invite revoke <id>`, `user list`, `user disable|enable|delete <name>`, `purge`.
6. Firewall der VM (Entwurf, vorher an deine Adressen anpassen):
   ```bash
   sudo nft -c -f deploy/nftables.conf     # nur prüfen
   sudo nft -f deploy/nftables.conf        # laden (Achtung: SSH nur noch von ADMIN_IP!)
   ```
   Danach **von einem anderen Rechner** prüfen: `nmap -Pn -p 1-1024 192.168.50.20` (nur 443 darf offen sein) und aus einem fremden Netz muss auch 443 zu sein.
7. Backups: SQLite-Datei nie im laufenden Betrieb kopieren, sondern `sqlite3 azunavi.db ".backup backup.db"` oder Volume-Snapshot, und die Sicherung **verschlüsseln** (z. B. mit `age`). Rücksicherung testen.

## Was bewusst (noch) fehlt
- App-Anbindung und Handy-App, Dateien/Anhänge, zweiter Faktor (TOTP), unabhängiges Review.
- Der Login nutzt in Version 0.1 einen **abgeleiteten Login-Wert** (wie bei Passwortmanagern). OPAQUE (stärkeres Verfahren) ist für später vorgesehen.
- Einbau in die App (Konto-Oberfläche, Wiederherstellungsschlüssel-Dialog): nächste Runde. Verschlüsselung und Pinning stecken schon im Baustein `sync-client/`.
- Datenbanken aus 0.1.0 werden beim Start automatisch um die Wiederherstellungs-Spalten ergänzt.

## Schnittstelle (für die App-Runde)
Alle Antworten sind JSON. Fehler: `{"error":"code"}`. Geschützte Aufrufe: Header `Authorization: Bearer <access_token>`.

| Aufruf | Zweck |
|---|---|
| `GET /healthz` | Lebenszeichen |
| `GET /v1/prelogin?username=` | Salz und KDF-Parameter (für Unbekannte ein stabiler Fake) |
| `POST /v1/register` | Konto mit Einladung anlegen |
| `POST /v1/login` | Anmelden (liefert Tokens und `key_blob_pw`) |
| `POST /v1/token/refresh` | Tokens erneuern (Rotation, Wiederverwendung sperrt das Gerät) |
| `POST /v1/recover/start`, `POST /v1/recover/finish` | Passwort vergessen: mit dem Wiederherstellungsschlüssel neues Passwort setzen (meldet alle Geräte ab) |
| `POST /v1/logout` | Sitzung beenden |
| `GET /v1/me` | Name, belegter Speicher, Kontingent |
| `GET /v1/devices`, `DELETE /v1/devices/:id` | Geräte ansehen / sperren |
| `POST /v1/password/change` | Passwort ändern (meldet alle anderen Geräte ab) |
| `DELETE /v1/account` | Konto und alle Daten löschen |
| `POST /v1/sync/push`, `GET /v1/sync/pull?since=&limit=` | Datensätze abgleichen |

### Schlüssel auf dem Gerät (Entwurf, vor Einsatz mit echten Daten gegenlesen lassen)
```
Registrieren:   salt  = 16 Zufallsbytes;  params = "argon2id;m=65536;t=3;p=4"
                master = Argon2id(Passwort, salt, params) -> 64 Bytes
                auth   = HKDF-SHA256(master, info="azunavi-auth-v1")[32]   -> geht an den Server (Base64)
                kek    = HKDF-SHA256(master, info="azunavi-kek-v1")[32]    -> bleibt auf dem Gerät
                DK     = 32 Zufallsbytes (Datenschlüssel)
                key_blob_pw  = Nonce(24) || XChaCha20-Poly1305(kek, DK, aad="azunavi-dk-v1")
                RK     = 32 Zufallsbytes (Wiederherstellungsschlüssel, wird dem Azubi einmal angezeigt)
                key_blob_rec = Nonce(24) || XChaCha20-Poly1305(HKDF(RK,"azunavi-rec-v1"), DK, aad="azunavi-dk-v1")
                recovery_auth = HKDF-SHA256(RK, info="azunavi-rec-auth-v1")[32]  -> geht an den Server (Base64, dort Argon2id)
Datensätze:     blob = Nonce(24) || XChaCha20-Poly1305(DK, Klartext-JSON, aad=record_id)
```
Der Server prüft nur Längen und Formate, nie Inhalte.

## Grenzen
Kein Programm ist fehlerfrei. Dieser Entwurf ersetzt weder ein Review durch die IT noch einen Penetrationstest noch eine Datenschutzprüfung.
