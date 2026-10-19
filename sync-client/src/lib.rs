//! AzuNavi Sync-Client (ENTWURF): verschlüsselt auf dem Gerät und spricht mit dem Server.
//! Der Server bekommt nie das Passwort, nie den Datenschlüssel und nie Klartext.
pub mod backup;
pub mod crypto;

use base64::{engine::general_purpose::STANDARD, Engine};
use crypto::*;
use serde_json::{json, Value};
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum Error {
    #[error("Unsicher: {0}")] Insecure(&'static str),
    #[error("Ungültige Eingabe: {0}")] BadInput(&'static str),
    #[error("Anmeldung fehlgeschlagen")] Unauthorized,
    #[error("Zu viele Versuche, bitte {0} Sekunden warten")] RateLimited(u64),
    #[error("Der Server meldet: {0}")] Server(String),
    #[error("Keine Verbindung zum Server")] Network,
    #[error("Daten wurden verändert oder gehören nicht zu diesem Konto")] Tampered,
    #[error("Fehler bei der Verschlüsselung")] Crypto,
}

fn b64(d: &[u8]) -> String { STANDARD.encode(d) }
fn unb64(v: &Value, max: usize) -> Result<Vec<u8>, Error> {
    let s = v.as_str().ok_or(Error::Server("Antwort unvollständig".into()))?;
    if s.len() > max / 3 * 4 + 8 { return Err(Error::Server("Antwort zu groß".into())); }
    STANDARD.decode(s).map_err(|_| Error::Server("Antwort ungültig".into()))
}
fn valid_username(u: &str) -> bool { (3..=32).contains(&u.len()) && u.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-')) }
fn check_password(pw: &str) -> Result<(), Error> {
    if pw.chars().count() < 12 { return Err(Error::BadInput("Das Passwort braucht mindestens 12 Zeichen")); }
    if pw.len() > 1024 { return Err(Error::BadInput("Das Passwort ist zu lang")); }
    Ok(())
}

/// Verbindung zum Server. Bei https wird NUR die mitgegebene CA akzeptiert (Pinning), keine öffentlichen Zertifikate.
pub struct Server { base: String, http: reqwest::Client }
impl Server {
    pub fn new(base_url: &str, ca_pem: Option<&[u8]>) -> Result<Self, Error> {
        let base = base_url.trim().trim_end_matches('/').to_string();
        let b = reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).user_agent("AzuNavi");
        let http = if base.starts_with("https://") {
            let pem = ca_pem.ok_or(Error::Insecure("das Zertifikat der Server-CA fehlt"))?;
            // Streng prüfen: reqwest würde unlesbare Daten sonst stillschweigend ignorieren
            if !std::str::from_utf8(pem).map(|s| s.contains("-----BEGIN CERTIFICATE-----")).unwrap_or(false) { return Err(Error::Insecure("CA-Zertifikat ist unlesbar")); }
            let certs = reqwest::Certificate::from_pem_bundle(pem).map_err(|_| Error::Insecure("CA-Zertifikat ist unlesbar"))?;
            if certs.len() != 1 { return Err(Error::Insecure("genau ein CA-Zertifikat erwartet")); }
            let b = b.use_rustls_tls().tls_built_in_root_certs(false).min_tls_version(reqwest::tls::Version::TLS_1_3).https_only(true);
            certs.into_iter().fold(b, |b, c| b.add_root_certificate(c)).build()
        } else if base.starts_with("http://127.0.0.1:") || base.starts_with("http://localhost:") {
            // Unverschlüsselt nur für Tests auf demselben Rechner und nur im Entwicklungs-Build
            if !cfg!(debug_assertions) { return Err(Error::Insecure("unverschlüsselte Verbindungen sind nicht erlaubt")); }
            b.build()
        } else {
            return Err(Error::Insecure("nur https:// ist erlaubt"));
        }.map_err(|_| Error::Insecure("Verbindung konnte nicht eingerichtet werden"))?;
        Ok(Self { base, http })
    }

    async fn req(&self, method: reqwest::Method, path: &str, token: Option<&str>, body: Option<&Value>) -> Result<Value, Error> {
        let mut rb = self.http.request(method, format!("{}{}", self.base, path));
        if let Some(t) = token { rb = rb.bearer_auth(t); }
        if let Some(b) = body { rb = rb.json(b); }
        let res = rb.send().await.map_err(|_| Error::Network)?;
        let status = res.status();
        let retry = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(60);
        let v: Value = res.json().await.unwrap_or(Value::Null);
        match status.as_u16() {
            200 => Ok(v),
            401 => Err(Error::Unauthorized),
            429 => Err(Error::RateLimited(retry)),
            _ => Err(Error::Server(v["error"].as_str().unwrap_or("unbekannt").chars().take(40).collect())),
        }
    }
}

async fn derive(password: Zeroizing<String>, salt: Vec<u8>, p: KdfParams) -> Result<PasswordKeys, Error> {
    // Argon2 ist absichtlich langsam: nicht auf dem Haupt-Thread rechnen
    tokio::task::spawn_blocking(move || derive_password_keys(&password, &salt, p)).await.map_err(|_| Error::Crypto)?
}

/// Ein Datensatz im Klartext (nur auf dem Gerät). data = None heißt gelöscht.
#[derive(Clone, Debug, PartialEq)]
pub struct Record { pub id: String, pub base_seq: Option<i64>, pub data: Option<Value> }
#[derive(Debug)]
pub struct Pulled { pub id: String, pub seq: i64, pub data: Option<Value> }
#[derive(Debug)]
pub struct PushOutcome { pub accepted: Vec<(String, i64)>, pub conflicts: Vec<(String, i64)>, pub latest_seq: i64 }
#[derive(Debug)]
pub struct PullOutcome { pub records: Vec<Pulled>, pub has_more: bool, pub latest_seq: i64 }

pub struct Session { server: Server, pub username: String, pub device_id: i64, access: Zeroizing<String>, refresh: Zeroizing<String>, dk: Key }

impl Session {
    fn from_tokens(server: Server, username: &str, v: &Value, dk: Key) -> Result<Self, Error> {
        let get = |k: &str| v[k].as_str().map(|s| Zeroizing::new(s.to_string())).ok_or(Error::Server("Antwort unvollständig".into()));
        Ok(Self { access: get("access_token")?, refresh: get("refresh_token")?, device_id: v["device_id"].as_i64().unwrap_or(0), server, username: username.into(), dk })
    }

    /// Konto mit Einladung anlegen. Gibt den Wiederherstellungsschlüssel zurück: NUR EINMAL anzeigen.
    pub async fn register(server: Server, invite: &str, username: &str, password: &str, device: &str) -> Result<(Self, Zeroizing<String>), Error> {
        if !valid_username(username) { return Err(Error::BadInput("Benutzername: 3 bis 32 Zeichen, nur a-z, 0-9, Punkt, Strich, Unterstrich")); }
        check_password(password)?;
        let (salt, p) = (random_salt(), KdfParams::DEFAULT);
        let pk = derive(Zeroizing::new(password.into()), salt.clone(), p).await?;
        let (dk, rk) = (random_key(), RecoveryKey::generate());
        let body = json!({ "invite": invite.trim(), "username": username, "auth_hash": *pk.auth_b64, "recovery_auth_hash": *rk.auth_b64(),
            "kdf_salt": b64(&salt), "kdf_params": p.to_param_string(), "key_blob_pw": b64(&wrap_dk(&pk.kek, &dk)),
            "key_blob_rec": b64(&wrap_dk(&rk.wrapping_key(), &dk)), "device_name": device });
        let v = server.req(reqwest::Method::POST, "/v1/register", None, Some(&body)).await?;
        let s = Self::from_tokens(server, username, &v, dk)?;
        Ok((s, rk.display()))
    }

    async fn password_keys(server: &Server, username: &str, password: &str) -> Result<PasswordKeys, Error> {
        if !valid_username(username) { return Err(Error::Unauthorized); }
        let pre = server.req(reqwest::Method::GET, &format!("/v1/prelogin?username={username}"), None, None).await?;
        let p = KdfParams::parse(pre["kdf_params"].as_str().unwrap_or(""))?;   // lehnt zu schwache Parameter ab
        let salt = unb64(&pre["kdf_salt"], 64)?;
        if salt.len() < 16 { return Err(Error::Insecure("Salz vom Server zu kurz")); }
        derive(Zeroizing::new(password.into()), salt, p).await
    }

    pub async fn login(server: Server, username: &str, password: &str, device: &str) -> Result<Self, Error> {
        let pk = Self::password_keys(&server, username, password).await?;
        let v = server.req(reqwest::Method::POST, "/v1/login", None, Some(&json!({ "username": username, "auth_hash": *pk.auth_b64, "device_name": device }))).await?;
        let dk = unwrap_dk(&pk.kek, &unb64(&v["key_blob_pw"], 1024)?)?;
        Self::from_tokens(server, username, &v, dk)
    }

    /// Passwort vergessen: mit dem Wiederherstellungsschlüssel ein neues Passwort setzen. Alle anderen Geräte werden abgemeldet.
    pub async fn recover(server: Server, username: &str, recovery_key: &str, new_password: &str, device: &str) -> Result<Self, Error> {
        let rk = RecoveryKey::parse(recovery_key)?;
        check_password(new_password)?;
        if !valid_username(username) { return Err(Error::Unauthorized); }
        let v = server.req(reqwest::Method::POST, "/v1/recover/start", None, Some(&json!({ "username": username, "recovery_auth_hash": *rk.auth_b64() }))).await?;
        let dk = unwrap_dk(&rk.wrapping_key(), &unb64(&v["key_blob_rec"], 1024)?)?;
        let (salt, p) = (random_salt(), KdfParams::DEFAULT);
        let pk = derive(Zeroizing::new(new_password.into()), salt.clone(), p).await?;
        let body = json!({ "recovery_token": v["recovery_token"], "new_auth_hash": *pk.auth_b64, "new_kdf_salt": b64(&salt), "new_kdf_params": p.to_param_string(),
            "new_key_blob_pw": b64(&wrap_dk(&pk.kek, &dk)), "device_name": device });
        let v2 = server.req(reqwest::Method::POST, "/v1/recover/finish", None, Some(&body)).await?;
        Self::from_tokens(server, username, &v2, dk)
    }

    async fn refresh_tokens(&mut self) -> Result<(), Error> {
        let v = self.server.req(reqwest::Method::POST, "/v1/token/refresh", None, Some(&json!({ "refresh_token": *self.refresh }))).await?;
        let get = |k: &str| v[k].as_str().map(|s| Zeroizing::new(s.to_string())).ok_or(Error::Server("Antwort unvollständig".into()));
        self.access = get("access_token")?; self.refresh = get("refresh_token")?;
        Ok(())
    }
    /// Geschützter Aufruf; bei abgelaufenem Zugriffstoken einmal erneuern und wiederholen
    async fn authed(&mut self, m: reqwest::Method, path: &str, body: Option<&Value>) -> Result<Value, Error> {
        match self.server.req(m.clone(), path, Some(&self.access), body).await {
            Err(Error::Unauthorized) => { self.refresh_tokens().await?; self.server.req(m, path, Some(&self.access), body).await }
            r => r,
        }
    }

    /// Datensätze verschlüsseln und hochladen (höchstens 100 pro Anfrage)
    pub async fn push(&mut self, recs: &[Record]) -> Result<PushOutcome, Error> {
        let mut out = PushOutcome { accepted: vec![], conflicts: vec![], latest_seq: 0 };
        for chunk in recs.chunks(100) {
            let mut items = Vec::with_capacity(chunk.len());
            for r in chunk {
                items.push(match &r.data {
                    Some(d) => {
                        let plain = Zeroizing::new(serde_json::to_vec(d).map_err(|_| Error::Crypto)?);
                        json!({ "id": r.id, "base_seq": r.base_seq, "blob": b64(&seal(&self.dk, &plain, r.id.as_bytes())) })   // ID als aad: Datensätze lassen sich nicht vertauschen
                    }
                    None => json!({ "id": r.id, "base_seq": r.base_seq, "deleted": true }),
                });
            }
            let v = self.authed(reqwest::Method::POST, "/v1/sync/push", Some(&json!({ "records": items }))).await?;
            let pairs = |k: &str, f: &str| v[k].as_array().map(|a| a.iter().filter_map(|x| Some((x["id"].as_str()?.to_string(), x[f].as_i64()?))).collect::<Vec<_>>()).unwrap_or_default();
            out.accepted.extend(pairs("accepted", "seq")); out.conflicts.extend(pairs("conflicts", "server_seq"));
            out.latest_seq = v["latest_seq"].as_i64().unwrap_or(out.latest_seq);
        }
        Ok(out)
    }

    /// Änderungen seit `since` holen und entschlüsseln. Ein veränderter Datensatz bricht ab (Error::Tampered).
    pub async fn pull(&mut self, since: i64) -> Result<PullOutcome, Error> {
        let v = self.authed(reqwest::Method::GET, &format!("/v1/sync/pull?since={}&limit=500", since.max(0)), None).await?;
        let mut recs = Vec::new();
        for r in v["records"].as_array().cloned().unwrap_or_default() {
            let id = r["id"].as_str().ok_or(Error::Tampered)?.to_string();
            let seq = r["seq"].as_i64().ok_or(Error::Tampered)?;
            let data = if r["deleted"].as_bool().unwrap_or(false) { None } else {
                let plain = open(&self.dk, &unb64(&r["blob"], 2 << 20)?, id.as_bytes())?;
                Some(serde_json::from_slice(&plain).map_err(|_| Error::Tampered)?)
            };
            recs.push(Pulled { id, seq, data });
        }
        Ok(PullOutcome { records: recs, has_more: v["has_more"].as_bool().unwrap_or(false), latest_seq: v["latest_seq"].as_i64().unwrap_or(0) })
    }

    pub async fn devices(&mut self) -> Result<Value, Error> { self.authed(reqwest::Method::GET, "/v1/devices", None).await }

    /// Passwort ändern: Datenschlüssel bleibt gleich, wird nur neu verpackt. Andere Geräte werden abgemeldet.
    pub async fn change_password(&mut self, old: &str, new: &str) -> Result<(), Error> {
        check_password(new)?;
        let cur = Self::password_keys(&self.server, &self.username, old).await?;
        let (salt, p) = (random_salt(), KdfParams::DEFAULT);
        let pk = derive(Zeroizing::new(new.into()), salt.clone(), p).await?;
        let body = json!({ "current_auth_hash": *cur.auth_b64, "new_auth_hash": *pk.auth_b64, "new_kdf_salt": b64(&salt), "new_kdf_params": p.to_param_string(), "new_key_blob_pw": b64(&wrap_dk(&pk.kek, &self.dk)) });
        self.authed(reqwest::Method::POST, "/v1/password/change", Some(&body)).await.map(|_| ())
    }

    pub async fn logout(mut self) -> Result<(), Error> { self.authed(reqwest::Method::POST, "/v1/logout", None).await.map(|_| ()) }

    /// Konto und alle Daten auf dem Server löschen
    pub async fn delete_account(&mut self, password: &str) -> Result<(), Error> {
        let pk = Self::password_keys(&self.server, &self.username, password).await?;
        self.authed(reqwest::Method::DELETE, "/v1/account", Some(&json!({ "auth_hash": *pk.auth_b64 }))).await.map(|_| ())
    }
}
