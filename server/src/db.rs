//! SQLite: Schema und Öffnen. secure_delete sorgt dafür, dass gelöschte Daten in der Datei überschrieben werden.
use rusqlite::Connection;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  auth_phc TEXT NOT NULL,            -- Argon2id über den vom Client abgeleiteten Login-Wert (nie das Passwort)
  kdf_salt BLOB NOT NULL,
  kdf_params TEXT NOT NULL,
  key_blob_pw BLOB NOT NULL,         -- Datenschlüssel, vom Gerät mit dem Passwort-Schlüssel verpackt (für den Server undurchsichtig)
  key_blob_rec BLOB NOT NULL,        -- derselbe Datenschlüssel, mit dem Wiederherstellungsschlüssel verpackt
  rec_phc TEXT NOT NULL DEFAULT '',  -- Argon2id über den Prüfwert des Wiederherstellungsschlüssels
  rec_token_hash BLOB,               -- kurzlebiges Token zwischen Schritt 1 und 2 der Wiederherstellung
  rec_token_expires INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  next_seq INTEGER NOT NULL DEFAULT 1,
  used_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  token_hash BLOB NOT NULL UNIQUE,   -- nur der Hash, die Einladung selbst kennt nur der Empfänger
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  access_hash BLOB NOT NULL UNIQUE,
  access_expires INTEGER NOT NULL,
  refresh_hash BLOB NOT NULL UNIQUE,
  refresh_expires INTEGER NOT NULL,
  prev_refresh_hash BLOB
);
CREATE INDEX IF NOT EXISTS sessions_prev ON sessions(prev_refresh_hash);
CREATE TABLE IF NOT EXISTS records (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  blob BLOB NOT NULL,                -- verschlüsselt auf dem Gerät. Gelöscht = leer + deleted=1
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, record_id)   -- jede Zeile gehört genau einem Konto
);
CREATE INDEX IF NOT EXISTS records_seq ON records(user_id, seq);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- nur Ereignisart, keine Inhalte
  user_id INTEGER
);
"#;

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA trusted_schema = OFF;")?;
    conn.execute_batch(SCHEMA)?;
    // Datenbanken aus Version 0.1.0 nachrüsten (Wiederherstellung)
    let has = |col: &str| -> rusqlite::Result<bool> { conn.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = ?1")?.exists([col]) };
    if !has("rec_phc")? { conn.execute_batch("ALTER TABLE users ADD COLUMN rec_phc TEXT NOT NULL DEFAULT ''")?; }
    if !has("rec_token_hash")? { conn.execute_batch("ALTER TABLE users ADD COLUMN rec_token_hash BLOB")?; }
    if !has("rec_token_expires")? { conn.execute_batch("ALTER TABLE users ADD COLUMN rec_token_expires INTEGER NOT NULL DEFAULT 0")?; }
    Ok(())
}

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;
    init(&conn)?;
    Ok(conn)
}

pub fn audit(conn: &Connection, ts: i64, kind: &str, user_id: Option<i64>) {
    let _ = conn.execute("INSERT INTO audit (ts, kind, user_id) VALUES (?1, ?2, ?3)", rusqlite::params![ts, kind, user_id]);
}

/// Geheimnis für gefälschte Salze (damit unbekannte Benutzernamen nicht erkennbar sind). Wird einmal erzeugt.
pub fn server_secret(conn: &Connection) -> rusqlite::Result<Vec<u8>> {
    let cur: Option<Vec<u8>> = conn.query_row("SELECT value FROM meta WHERE key='server_secret'", [], |r| r.get(0)).ok();
    if let Some(v) = cur { return Ok(v); }
    let v = crate::util::random_bytes(32);
    conn.execute("INSERT INTO meta (key, value) VALUES ('server_secret', ?1)", [&v])?;
    Ok(v)
}

/// Aufräumen: abgelaufene Sitzungen, alte Einladungen, Audit älter als 30 Tage
pub fn purge(conn: &Connection, now: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sessions WHERE refresh_expires < ?1", [now])?;
    conn.execute("DELETE FROM invites WHERE expires_at < ?1 AND used_at IS NULL", [now - 30 * 86400])?;
    conn.execute("DELETE FROM audit WHERE ts < ?1", [now - 30 * 86400])?;
    Ok(())
}
