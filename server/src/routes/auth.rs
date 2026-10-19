//! Konten, Einladungen, Anmeldung, Geräte. Das Passwort verlässt das Gerät nie: die App schickt nur einen abgeleiteten Login-Wert.
use crate::{db, error::AppError, routes::parse_json, util::*, AppState, ClientIp};
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{body::Bytes, extract::{Path, Query, State}, http::HeaderMap, Extension, Json};
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

#[allow(clippy::result_unit_err)]
pub fn hash_login_value(v: &str) -> Result<String, ()> {
    let salt = SaltString::encode_b64(&random_bytes(16)).map_err(|_| ())?;
    Argon2::default().hash_password(v.as_bytes(), &salt).map(|h| h.to_string()).map_err(|_| ())
}
fn verify_login_value(phc: &str, v: &str) -> bool {
    PasswordHash::new(phc).map(|p| Argon2::default().verify_password(v.as_bytes(), &p).is_ok()).unwrap_or(false)
}
/// Rechenintensiv, darum nie auf dem Server-Thread
async fn verify_blocking(phc: String, v: String) -> bool {
    tokio::task::spawn_blocking(move || verify_login_value(&phc, &v)).await.unwrap_or(false)
}
async fn hash_blocking(v: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || hash_login_value(&v)).await.map_err(|_| AppError::Internal)?.map_err(|_| AppError::Internal)
}

/* ---------- Eingabeprüfung ---------- */
fn check_login_value(s: &str) -> Result<(), AppError> {
    let v = b64_decode(s, 32, "bad_auth_hash")?;
    if v.len() != 32 { return Err(AppError::BadRequest("bad_auth_hash")); }
    Ok(())
}

/* ---------- Sitzungen ---------- */
pub struct Auth { pub user_id: i64, pub device_id: i64, pub session_id: i64 }

pub async fn authenticate(st: &AppState, headers: &HeaderMap) -> Result<Auth, AppError> {
    let token = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).ok_or(AppError::Unauthorized)?;
    if token.len() < 20 || token.len() > 100 { return Err(AppError::Unauthorized); }
    let h = sha256(token.as_bytes());
    let now = st.now();
    let a = st.with_db(move |c| {
        let r: Option<(i64, i64, i64)> = c.query_row(
            "SELECT s.id, d.id, u.id FROM sessions s JOIN devices d ON d.id = s.device_id JOIN users u ON u.id = d.user_id
             WHERE s.access_hash = ?1 AND s.access_expires > ?2 AND d.revoked = 0 AND u.disabled = 0", params![h, now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
        let (sid, did, uid) = r.ok_or(AppError::Unauthorized)?;
        c.execute("UPDATE devices SET last_seen = ?1 WHERE id = ?2 AND last_seen < ?1 - 60", params![now, did])?;
        Ok(Auth { user_id: uid, device_id: did, session_id: sid })
    }).await?;
    st.limiter.check(&format!("api:{}", a.user_id), st.cfg.api_per_user, 60, now).map_err(AppError::TooMany)?;
    Ok(a)
}

fn create_session(c: &Connection, user_id: i64, device_name: &str, now: i64, st_cfg: &crate::Config) -> Result<(i64, String, String), AppError> {
    c.execute("INSERT INTO devices (user_id, name, created_at, last_seen) VALUES (?1, ?2, ?3, ?3)", params![user_id, device_name, now])?;
    let did = c.last_insert_rowid();
    let (acc, refr) = (random_token(), random_token());
    c.execute("INSERT INTO sessions (device_id, access_hash, access_expires, refresh_hash, refresh_expires) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![did, sha256(acc.as_bytes()), now + st_cfg.access_ttl, sha256(refr.as_bytes()), now + st_cfg.refresh_ttl])?;
    Ok((did, acc, refr))
}

fn tokens_json(did: i64, acc: &str, refr: &str, ttl: i64) -> Value {
    json!({ "device_id": did, "access_token": acc, "refresh_token": refr, "access_expires_in": ttl })
}

/* ---------- Prelogin: Salz und Parameter holen (für Unbekannte ein stabiler Fake) ---------- */
#[derive(Deserialize)] pub struct PreQ { username: Option<String> }

pub async fn prelogin(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, Query(q): Query<PreQ>) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("pre:ip:{}", ip.0), 30, 60, now).map_err(AppError::TooMany)?;
    let name = q.username.unwrap_or_default();
    if name.len() > 64 { return Err(AppError::BadRequest("bad_username")); }
    let n2 = name.clone();
    let row: Option<(Vec<u8>, String)> = st.with_db(move |c| Ok(c.query_row("SELECT kdf_salt, kdf_params FROM users WHERE username = ?1 AND disabled = 0", [&n2], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)).await?;
    let (salt, params) = row.unwrap_or_else(|| {
        let mut m = <Hmac<Sha256> as Mac>::new_from_slice(&st.server_secret).expect("hmac key");
        m.update(b"fake-salt:"); m.update(name.as_bytes());
        (m.finalize().into_bytes()[..16].to_vec(), DEFAULT_KDF_PARAMS.to_string())
    });
    Ok(Json(json!({ "kdf_salt": b64(&salt), "kdf_params": params })))
}

/* ---------- Registrierung nur mit Einladung ---------- */
#[derive(Deserialize)]
struct RegisterReq { invite: String, username: String, auth_hash: String, recovery_auth_hash: String, kdf_salt: String, kdf_params: String, key_blob_pw: String, key_blob_rec: String, device_name: String }

pub async fn register(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, body: Bytes) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("reg:ip:{}", ip.0), st.cfg.register_per_ip, 3600, now).map_err(AppError::TooMany)?;
    let r: RegisterReq = parse_json(&body)?;
    if r.invite.len() < 20 || r.invite.len() > 100 { return Err(AppError::BadRequest("invite_invalid")); }
    if !valid_username(&r.username) { return Err(AppError::BadRequest("bad_username")); }
    check_login_value(&r.auth_hash)?;
    check_login_value(&r.recovery_auth_hash)?;
    if r.recovery_auth_hash == r.auth_hash { return Err(AppError::BadRequest("bad_auth_hash")); }
    let salt = b64_decode(&r.kdf_salt, 64, "bad_salt")?;
    if salt.len() < 16 { return Err(AppError::BadRequest("bad_salt")); }
    if !valid_kdf_params(&r.kdf_params) { return Err(AppError::BadRequest("bad_kdf_params")); }
    let kb_pw = b64_decode(&r.key_blob_pw, 1024, "bad_key_blob")?;
    let kb_rec = b64_decode(&r.key_blob_rec, 1024, "bad_key_blob")?;
    if kb_pw.len() < 16 || kb_rec.len() < 16 { return Err(AppError::BadRequest("bad_key_blob")); }
    if !valid_device_name(&r.device_name) { return Err(AppError::BadRequest("bad_device_name")); }
    let phc = hash_blocking(r.auth_hash.clone()).await?;
    let rec_phc = hash_blocking(r.recovery_auth_hash.clone()).await?;
    let (invite_hash, cfg) = (sha256(r.invite.as_bytes()), st.cfg.clone());
    let (username, kdf_params, device) = (r.username.clone(), r.kdf_params.clone(), r.device_name.clone());
    let out = st.with_db(move |c| {
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let inv: Option<(i64, i64, Option<i64>, i64)> = tx.query_row("SELECT id, expires_at, used_at, revoked FROM invites WHERE token_hash = ?1", [&invite_hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()?;
        let (inv_id, exp, used, revoked) = inv.ok_or(AppError::BadRequest("invite_invalid"))?;
        if used.is_some() || revoked != 0 || exp <= now { return Err(AppError::BadRequest("invite_invalid")); }
        let ins = tx.execute("INSERT INTO users (username, auth_phc, kdf_salt, kdf_params, key_blob_pw, key_blob_rec, created_at, rec_phc) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![username, phc, salt, kdf_params, kb_pw, kb_rec, now, rec_phc]);
        match ins { Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => return Err(AppError::Conflict("username_taken")), Err(e) => return Err(e.into()), Ok(_) => {} }
        let uid = tx.last_insert_rowid();
        tx.execute("UPDATE invites SET used_at = ?1, used_by = ?2 WHERE id = ?3", params![now, uid, inv_id])?;
        let (did, acc, refr) = create_session(&tx, uid, &device, now, &cfg)?;
        db::audit(&tx, now, "register", Some(uid));
        tx.commit()?;
        Ok(tokens_json(did, &acc, &refr, cfg.access_ttl))
    }).await?;
    Ok(Json(out))
}

/* ---------- Login ---------- */
#[derive(Deserialize)] struct LoginReq { username: String, auth_hash: String, device_name: String }

pub async fn login(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, body: Bytes) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("login:ip:{}", ip.0), st.cfg.login_per_ip, 60, now).map_err(AppError::TooMany)?;
    let r: LoginReq = parse_json(&body)?;
    if !valid_username(&r.username) || check_login_value(&r.auth_hash).is_err() || !valid_device_name(&r.device_name) { return Err(AppError::Unauthorized); }
    st.limiter.check(&format!("login:user:{}", r.username), 20, 600, now).map_err(AppError::TooMany)?;
    let uname = r.username.clone();
    type Row = (i64, String, i64, i64, i64, Vec<u8>);
    let row: Option<Row> = st.with_db(move |c| Ok(c.query_row(
        "SELECT id, auth_phc, locked_until, disabled, failed_count, key_blob_pw FROM users WHERE username = ?1", [&uname],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).optional()?)).await?;
    // Immer genau eine Argon2-Prüfung, damit Dauer und Antwort bei unbekannten oder gesperrten Konten gleich bleiben
    let usable = matches!(&row, Some((_, _, locked, disabled, _, _)) if *locked <= now && *disabled == 0);
    let phc = match &row { Some((_, p, ..)) if usable => p.clone(), _ => (*st.dummy_phc).clone() };
    let ok = verify_blocking(phc, r.auth_hash.clone()).await && usable;
    let (uid, _, _, _, failed, key_blob_pw) = match row { Some(x) => x, None => return Err(AppError::Unauthorized) };
    if !ok {
        if usable {
            let nf = failed + 1;
            let lock = if nf >= 5 { now + (30i64 << (nf - 5).min(5)).min(900) } else { 0 };
            st.with_db(move |c| { c.execute("UPDATE users SET failed_count = ?1, locked_until = MAX(locked_until, ?2) WHERE id = ?3", params![nf, lock, uid])?; db::audit(c, now, "login_failed", Some(uid)); Ok(()) }).await?;
        }
        return Err(AppError::Unauthorized);
    }
    let (cfg, device) = (st.cfg.clone(), r.device_name.clone());
    let out = st.with_db(move |c| {
        let tx = c.transaction()?;
        tx.execute("UPDATE users SET failed_count = 0, locked_until = 0 WHERE id = ?1", [uid])?;
        let (did, acc, refr) = create_session(&tx, uid, &device, now, &cfg)?;
        db::audit(&tx, now, "login", Some(uid));
        tx.commit()?;
        let mut j = tokens_json(did, &acc, &refr, cfg.access_ttl);
        j["key_blob_pw"] = Value::String(b64(&key_blob_pw));
        Ok(j)
    }).await?;
    Ok(Json(out))
}

/* ---------- Token erneuern (jedes Mal ein neues Paar; Wiederverwendung eines alten sperrt das Gerät) ---------- */
#[derive(Deserialize)] struct RefreshReq { refresh_token: String }

pub async fn refresh(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, body: Bytes) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("refresh:ip:{}", ip.0), 60, 60, now).map_err(AppError::TooMany)?;
    let r: RefreshReq = parse_json(&body)?;
    if r.refresh_token.len() < 20 || r.refresh_token.len() > 100 { return Err(AppError::Unauthorized); }
    let h = sha256(r.refresh_token.as_bytes());
    let cfg = st.cfg.clone();
    let out = st.with_db(move |c| {
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let cur: Option<(i64, i64, i64, i64, i64)> = tx.query_row(
            "SELECT s.id, s.device_id, s.refresh_expires, d.revoked, u.disabled FROM sessions s JOIN devices d ON d.id = s.device_id JOIN users u ON u.id = d.user_id WHERE s.refresh_hash = ?1",
            [&h], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
        if let Some((sid, did, exp, revoked, disabled)) = cur {
            if exp <= now || revoked != 0 || disabled != 0 { return Err(AppError::Unauthorized); }
            let (acc, refr) = (random_token(), random_token());
            tx.execute("UPDATE sessions SET access_hash=?1, access_expires=?2, prev_refresh_hash=?3, refresh_hash=?4, refresh_expires=?5 WHERE id=?6",
                params![sha256(acc.as_bytes()), now + cfg.access_ttl, h, sha256(refr.as_bytes()), now + cfg.refresh_ttl, sid])?;
            tx.commit()?;
            return Ok(tokens_json(did, &acc, &refr, cfg.access_ttl));
        }
        // Altes, schon ersetztes Token taucht wieder auf: Diebstahl möglich -> Gerät sofort sperren
        let reused: Option<(i64, i64)> = tx.query_row("SELECT s.device_id, d.user_id FROM sessions s JOIN devices d ON d.id = s.device_id WHERE s.prev_refresh_hash = ?1", [&h], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if let Some((did, uid)) = reused {
            tx.execute("DELETE FROM sessions WHERE device_id = ?1", [did])?;
            tx.execute("UPDATE devices SET revoked = 1 WHERE id = ?1", [did])?;
            db::audit(&tx, now, "refresh_reuse", Some(uid));
            tx.commit()?;
        }
        Err(AppError::Unauthorized)
    }).await?;
    Ok(Json(out))
}

pub async fn logout(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    st.with_db(move |c| { c.execute("DELETE FROM sessions WHERE id = ?1", [a.session_id])?; Ok(()) }).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn me(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let quota = st.cfg.quota_bytes;
    let (name, used, next): (String, i64, i64) = st.with_db(move |c| Ok(c.query_row("SELECT username, used_bytes, next_seq FROM users WHERE id = ?1", [a.user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?)).await?;
    Ok(Json(json!({ "username": name, "used_bytes": used, "quota_bytes": quota, "next_seq": next })))
}

pub async fn devices(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let list: Vec<Value> = st.with_db(move |c| {
        let mut s = c.prepare("SELECT id, name, created_at, last_seen FROM devices WHERE user_id = ?1 AND revoked = 0 ORDER BY id")?;
        let rows = s.query_map([a.user_id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "created_at": r.get::<_, i64>(2)?, "last_seen": r.get::<_, i64>(3)?, "current": r.get::<_, i64>(0)? == a.device_id })))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }).await?;
    Ok(Json(json!({ "devices": list })))
}

pub async fn revoke_device(State(st): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    st.with_db(move |c| {
        let tx = c.transaction()?;
        // Nur eigene Geräte: das Konto kommt aus dem Token, nie aus der Anfrage
        let n = tx.execute("UPDATE devices SET revoked = 1 WHERE id = ?1 AND user_id = ?2", params![id, a.user_id])?;
        if n == 0 { return Err(AppError::NotFound); }
        tx.execute("DELETE FROM sessions WHERE device_id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

/* ---------- Passwort prüfen (für heikle Aktionen) ---------- */
async fn require_password(st: &AppState, user_id: i64, value: &str) -> Result<(), AppError> {
    check_login_value(value).map_err(|_| AppError::Unauthorized)?;
    st.limiter.check(&format!("pw:{user_id}"), 5, 600, st.now()).map_err(AppError::TooMany)?;
    let phc: String = st.with_db(move |c| Ok(c.query_row("SELECT auth_phc FROM users WHERE id = ?1", [user_id], |r| r.get(0))?)).await?;
    if verify_blocking(phc, value.to_string()).await { Ok(()) } else { Err(AppError::Unauthorized) }
}

#[derive(Deserialize)]
struct ChangePw { current_auth_hash: String, new_auth_hash: String, new_kdf_salt: String, new_kdf_params: String, new_key_blob_pw: String }

pub async fn change_password(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let r: ChangePw = parse_json(&body)?;
    check_login_value(&r.new_auth_hash)?;
    let salt = b64_decode(&r.new_kdf_salt, 64, "bad_salt")?;
    if salt.len() < 16 { return Err(AppError::BadRequest("bad_salt")); }
    if !valid_kdf_params(&r.new_kdf_params) { return Err(AppError::BadRequest("bad_kdf_params")); }
    let kb = b64_decode(&r.new_key_blob_pw, 1024, "bad_key_blob")?;
    if kb.len() < 16 { return Err(AppError::BadRequest("bad_key_blob")); }
    require_password(&st, a.user_id, &r.current_auth_hash).await?;
    let phc = hash_blocking(r.new_auth_hash.clone()).await?;
    let (now, params_txt) = (st.now(), r.new_kdf_params.clone());
    st.with_db(move |c| {
        let tx = c.transaction()?;
        tx.execute("UPDATE users SET auth_phc=?1, kdf_salt=?2, kdf_params=?3, key_blob_pw=?4, failed_count=0, locked_until=0 WHERE id=?5", params![phc, salt, params_txt, kb, a.user_id])?;
        // Alle anderen Geräte abmelden
        tx.execute("UPDATE devices SET revoked = 1 WHERE user_id = ?1 AND id != ?2", params![a.user_id, a.device_id])?;
        tx.execute("DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?1 AND id != ?2)", params![a.user_id, a.device_id])?;
        db::audit(&tx, now, "password_changed", Some(a.user_id));
        tx.commit()?;
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)] struct DeleteReq { auth_hash: String }

/// Konto samt aller Daten löschen (Betroffenenrecht). secure_delete überschreibt die Seiten.
pub async fn delete_account(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let r: DeleteReq = parse_json(&body)?;
    require_password(&st, a.user_id, &r.auth_hash).await?;
    let now = st.now();
    st.with_db(move |c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM users WHERE id = ?1", [a.user_id])?;
        db::audit(&tx, now, "account_deleted", None);
        tx.commit()?;
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

/* ---------- Passwort vergessen: mit dem Wiederherstellungsschlüssel ---------- */
// Schritt 1: Prüfwert des Wiederherstellungsschlüssels beweisen -> verpackter Datenschlüssel + Einmal-Token (10 Minuten)
// Schritt 2: mit dem Token neues Passwort setzen. Alle bisherigen Geräte werden abgemeldet.
#[derive(Deserialize)] struct RecoverStart { username: String, recovery_auth_hash: String }

pub async fn recover_start(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, body: Bytes) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("login:ip:{}", ip.0), st.cfg.login_per_ip, 60, now).map_err(AppError::TooMany)?;
    let r: RecoverStart = parse_json(&body)?;
    if !valid_username(&r.username) || check_login_value(&r.recovery_auth_hash).is_err() { return Err(AppError::Unauthorized); }
    st.limiter.check(&format!("recover:user:{}", r.username), 5, 3600, now).map_err(AppError::TooMany)?;
    let uname = r.username.clone();
    let row: Option<(i64, String, i64, i64, i64, Vec<u8>)> = st.with_db(move |c| Ok(c.query_row(
        "SELECT id, rec_phc, locked_until, disabled, failed_count, key_blob_rec FROM users WHERE username = ?1", [&uname],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).optional()?)).await?;
    let usable = matches!(&row, Some((_, phc, locked, disabled, _, _)) if *locked <= now && *disabled == 0 && !phc.is_empty());
    let phc = match &row { Some((_, p, ..)) if usable => p.clone(), _ => (*st.dummy_phc).clone() };
    let ok = verify_blocking(phc, r.recovery_auth_hash.clone()).await && usable;
    let (uid, _, _, _, failed, key_blob_rec) = match row { Some(x) => x, None => return Err(AppError::Unauthorized) };
    if !ok {
        if usable {
            let nf = failed + 1;
            let lock = if nf >= 5 { now + (30i64 << (nf - 5).min(5)).min(900) } else { 0 };
            st.with_db(move |c| { c.execute("UPDATE users SET failed_count = ?1, locked_until = MAX(locked_until, ?2) WHERE id = ?3", params![nf, lock, uid])?; db::audit(c, now, "recover_failed", Some(uid)); Ok(()) }).await?;
        }
        return Err(AppError::Unauthorized);
    }
    let token = random_token();
    let th = sha256(token.as_bytes());
    st.with_db(move |c| { c.execute("UPDATE users SET rec_token_hash = ?1, rec_token_expires = ?2 WHERE id = ?3", params![th, now + 600, uid])?; db::audit(c, now, "recover_started", Some(uid)); Ok(()) }).await?;
    Ok(Json(json!({ "recovery_token": token, "key_blob_rec": b64(&key_blob_rec) })))
}

#[derive(Deserialize)]
struct RecoverFinish { recovery_token: String, new_auth_hash: String, new_kdf_salt: String, new_kdf_params: String, new_key_blob_pw: String, device_name: String }

pub async fn recover_finish(State(st): State<AppState>, Extension(ip): Extension<ClientIp>, body: Bytes) -> Result<Json<Value>, AppError> {
    let now = st.now();
    st.limiter.check(&format!("login:ip:{}", ip.0), st.cfg.login_per_ip, 60, now).map_err(AppError::TooMany)?;
    let r: RecoverFinish = parse_json(&body)?;
    if r.recovery_token.len() < 20 || r.recovery_token.len() > 100 { return Err(AppError::Unauthorized); }
    check_login_value(&r.new_auth_hash)?;
    let salt = b64_decode(&r.new_kdf_salt, 64, "bad_salt")?;
    if salt.len() < 16 { return Err(AppError::BadRequest("bad_salt")); }
    if !valid_kdf_params(&r.new_kdf_params) { return Err(AppError::BadRequest("bad_kdf_params")); }
    let kb = b64_decode(&r.new_key_blob_pw, 1024, "bad_key_blob")?;
    if kb.len() < 16 { return Err(AppError::BadRequest("bad_key_blob")); }
    if !valid_device_name(&r.device_name) { return Err(AppError::BadRequest("bad_device_name")); }
    let phc = hash_blocking(r.new_auth_hash.clone()).await?;
    let (th, cfg, params_txt, device) = (sha256(r.recovery_token.as_bytes()), st.cfg.clone(), r.new_kdf_params.clone(), r.device_name.clone());
    let out = st.with_db(move |c| {
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let uid: Option<i64> = tx.query_row("SELECT id FROM users WHERE rec_token_hash = ?1 AND rec_token_expires > ?2 AND disabled = 0", params![th, now], |r| r.get(0)).optional()?;
        let uid = uid.ok_or(AppError::Unauthorized)?;
        tx.execute("UPDATE users SET auth_phc=?1, kdf_salt=?2, kdf_params=?3, key_blob_pw=?4, failed_count=0, locked_until=0, rec_token_hash=NULL, rec_token_expires=0 WHERE id=?5", params![phc, salt, params_txt, kb, uid])?;
        // Wer das Passwort zurücksetzt, wirft alle bisherigen Geräte raus
        tx.execute("DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?1)", [uid])?;
        tx.execute("UPDATE devices SET revoked = 1 WHERE user_id = ?1", [uid])?;
        let (did, acc, refr) = create_session(&tx, uid, &device, now, &cfg)?;
        db::audit(&tx, now, "recovered", Some(uid));
        tx.commit()?;
        Ok(tokens_json(did, &acc, &refr, cfg.access_ttl))
    }).await?;
    Ok(Json(out))
}
