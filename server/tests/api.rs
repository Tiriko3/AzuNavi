//! Sicherheits- und Funktionstests. Alle Daten sind erfunden. Der Server läuft dabei komplett im Speicher.
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use azunavi_server::{build_app, util, AppState, Config};
use rand::{Rng, RngCore};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tower::ServiceExt;

struct Ctx { app: Router, st: AppState }
fn setup_with(cfg: Config) -> Ctx {
    let st = AppState::new(Connection::open_in_memory().unwrap(), Config { trust_proxy: true, ..cfg }).unwrap();
    Ctx { app: build_app(st.clone()), st }
}
fn setup() -> Ctx { setup_with(Config::default()) }

async fn call(c: &Ctx, method: &str, uri: &str, ip: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value) {
    call_raw(c, method, uri, ip, token, body.map(|b| b.to_string().into_bytes())).await
}
async fn call_raw(c: &Ctx, method: &str, uri: &str, ip: &str, token: Option<&str>, body: Option<Vec<u8>>) -> (StatusCode, Value) {
    let mut rb = Request::builder().method(method).uri(uri).header("x-real-ip", ip).header("content-type", "application/json");
    if let Some(t) = token { rb = rb.header("authorization", format!("Bearer {t}")); }
    let req = rb.body(Body::from(body.unwrap_or_default())).unwrap();
    let res = c.app.clone().oneshot(req).await.unwrap();
    let st = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (st, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn h(n: u8) -> String { util::b64(&[n; 32]) }                      // erfundener Login-Wert
fn invite(c: &Ctx, hours: i64) -> String {
    let t = util::random_token(); let now = c.st.now();
    c.st.db.lock().unwrap().execute("INSERT INTO invites (token_hash, note, created_at, expires_at) VALUES (?1,'test',?2,?3)", rusqlite::params![util::sha256(t.as_bytes()), now, now + hours * 3600]).unwrap();
    t
}
fn reg_body(inv: &str, user: &str, pw: u8) -> Value {
    json!({ "invite": inv, "username": user, "auth_hash": h(pw), "recovery_auth_hash": h(pw.wrapping_add(100)), "kdf_salt": util::b64(&[7u8; 16]), "kdf_params": util::DEFAULT_KDF_PARAMS,
            "key_blob_pw": util::b64(&[1u8; 48]), "key_blob_rec": util::b64(&[2u8; 48]), "device_name": "Test-PC" })
}
async fn register(c: &Ctx, user: &str, pw: u8, ip: &str) -> Value {
    let inv = invite(c, 48);
    let (s, v) = call(c, "POST", "/v1/register", ip, None, Some(reg_body(&inv, user, pw))).await;
    assert_eq!(s, StatusCode::OK, "Registrierung: {v}");
    v
}
async fn login(c: &Ctx, user: &str, pw: u8, ip: &str) -> (StatusCode, Value) {
    call(c, "POST", "/v1/login", ip, None, Some(json!({ "username": user, "auth_hash": h(pw), "device_name": "Zweites Gerät" }))).await
}
fn tok(v: &Value) -> String { v["access_token"].as_str().unwrap().to_string() }
fn blob(n: u8, len: usize) -> String { util::b64(&vec![n; len]) }
async fn push(c: &Ctx, t: &str, recs: Value) -> (StatusCode, Value) { call(c, "POST", "/v1/sync/push", "10.1.1.1", Some(t), Some(json!({ "records": recs }))).await }
async fn pull(c: &Ctx, t: &str) -> Value { call(c, "GET", "/v1/sync/pull?since=0", "10.1.1.1", Some(t), None).await.1 }

/* ---------- Einladungen ---------- */
#[tokio::test]
async fn invite_is_single_use() {
    let c = setup();
    let inv = invite(&c, 48);
    let (s1, _) = call(&c, "POST", "/v1/register", "10.0.0.1", None, Some(reg_body(&inv, "anna", 1))).await;
    assert_eq!(s1, StatusCode::OK);
    let (s2, v2) = call(&c, "POST", "/v1/register", "10.0.0.1", None, Some(reg_body(&inv, "berta", 2))).await;
    assert_eq!(s2, StatusCode::BAD_REQUEST); assert_eq!(v2["error"], "invite_invalid");
}
#[tokio::test]
async fn expired_revoked_and_unknown_invites_are_rejected() {
    let c = setup();
    let exp = invite(&c, 1);
    c.st.clock_offset.fetch_add(2 * 3600, Ordering::Relaxed);
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.0.2", None, Some(reg_body(&exp, "anna", 1))).await.0, StatusCode::BAD_REQUEST);
    let rev = invite(&c, 48);
    c.st.db.lock().unwrap().execute("UPDATE invites SET revoked = 1", []).unwrap();
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.0.2", None, Some(reg_body(&rev, "anna", 1))).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.0.2", None, Some(reg_body(&util::random_token(), "anna", 1))).await.0, StatusCode::BAD_REQUEST);
}
#[tokio::test]
async fn register_validates_input_strictly() {
    let c = setup();
    let bad_users = ["ab", "ANNA", "an na", "a'; DROP TABLE users;--", "anna@example.com", "ä123", &"x".repeat(33), "../etc"];
    for (i, u) in bad_users.iter().enumerate() {
        let inv = invite(&c, 48);
        let (s, _) = call(&c, "POST", "/v1/register", &format!("10.0.1.{i}"), None, Some(reg_body(&inv, u, 1))).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "Benutzername {u:?} hätte abgelehnt werden müssen");
    }
    let inv = invite(&c, 48);
    let mut b = reg_body(&inv, "anna", 1); b["auth_hash"] = json!(util::b64(&[1u8; 5]));
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.2.1", None, Some(b)).await.0, StatusCode::BAD_REQUEST);
    let mut b = reg_body(&inv, "anna", 1); b["kdf_params"] = json!("argon2id;m=8;t=1;p=1");
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.2.2", None, Some(b)).await.0, StatusCode::BAD_REQUEST, "schwache KDF-Parameter dürfen nicht durchgehen");
    let mut b = reg_body(&inv, "anna", 1); b["key_blob_pw"] = json!(blob(1, 5000));
    assert!(call(&c, "POST", "/v1/register", "10.0.2.3", None, Some(b)).await.0.is_client_error());
    // doppelter Benutzername
    register(&c, "anna", 1, "10.0.3.1").await;
    let inv2 = invite(&c, 48);
    assert_eq!(call(&c, "POST", "/v1/register", "10.0.3.2", None, Some(reg_body(&inv2, "anna", 2))).await.0, StatusCode::CONFLICT);
}

/* ---------- Anmeldung ---------- */
#[tokio::test]
async fn login_errors_do_not_reveal_whether_account_exists() {
    let c = setup();
    register(&c, "anna", 1, "10.0.0.1").await;
    let (s1, v1) = login(&c, "anna", 9, "10.0.0.2").await;      // falsches Passwort
    let (s2, v2) = login(&c, "gibtsnicht", 1, "10.0.0.3").await; // unbekanntes Konto
    assert_eq!((s1, &v1), (StatusCode::UNAUTHORIZED, &json!({"error":"unauthorized"})));
    assert_eq!((s2, &v2), (StatusCode::UNAUTHORIZED, &json!({"error":"unauthorized"})));
    let (s3, v3) = login(&c, "anna", 1, "10.0.0.4").await;
    assert_eq!(s3, StatusCode::OK); assert!(v3["access_token"].is_string() && v3["key_blob_pw"].is_string());
}
#[tokio::test]
async fn prelogin_looks_the_same_for_unknown_users() {
    let c = setup();
    register(&c, "anna", 1, "10.0.0.1").await;
    let (_, known) = call(&c, "GET", "/v1/prelogin?username=anna", "10.0.0.2", None, None).await;
    let (_, u1) = call(&c, "GET", "/v1/prelogin?username=nobody", "10.0.0.2", None, None).await;
    let (_, u2) = call(&c, "GET", "/v1/prelogin?username=nobody", "10.0.0.2", None, None).await;
    let (_, u3) = call(&c, "GET", "/v1/prelogin?username=other", "10.0.0.2", None, None).await;
    assert_eq!(u1, u2, "gefälschtes Salz muss stabil sein");
    assert_ne!(u1["kdf_salt"], u3["kdf_salt"]);
    assert_eq!(known["kdf_params"], u1["kdf_params"]);
    assert_eq!(known["kdf_salt"].as_str().unwrap().len(), u1["kdf_salt"].as_str().unwrap().len());
}
#[tokio::test]
async fn account_locks_after_failures_and_unlocks_later() {
    let c = setup();
    register(&c, "anna", 1, "10.0.0.1").await;
    for i in 0..5 { assert_eq!(login(&c, "anna", 9, &format!("10.9.0.{i}")).await.0, StatusCode::UNAUTHORIZED); }
    assert_eq!(login(&c, "anna", 1, "10.9.1.1").await.0, StatusCode::UNAUTHORIZED, "während der Sperre geht auch das richtige Passwort nicht");
    c.st.clock_offset.fetch_add(120, Ordering::Relaxed);
    assert_eq!(login(&c, "anna", 1, "10.9.1.2").await.0, StatusCode::OK, "nach der Sperre geht es wieder");
}
#[tokio::test]
async fn login_is_rate_limited_per_ip() {
    let c = setup();
    let mut limited = false;
    for _ in 0..15 { if login(&c, "nobody", 1, "10.7.7.7").await.0 == StatusCode::TOO_MANY_REQUESTS { limited = true; break; } }
    assert!(limited, "nach zu vielen Versuchen von einer Adresse muss 429 kommen");
    assert_ne!(login(&c, "nobody", 1, "10.7.7.8").await.0, StatusCode::TOO_MANY_REQUESTS, "andere Adressen sind nicht betroffen");
}
#[tokio::test]
async fn registration_is_rate_limited_per_ip() {
    let c = setup();
    let mut limited = false;
    for _ in 0..8 { let (s, _) = call(&c, "POST", "/v1/register", "10.8.8.8", None, Some(reg_body(&util::random_token(), "anna", 1))).await; if s == StatusCode::TOO_MANY_REQUESTS { limited = true; break; } }
    assert!(limited);
}

/* ---------- Sitzungen ---------- */
#[tokio::test]
async fn protected_routes_need_a_valid_token() {
    let c = setup();
    let routes = [("GET", "/v1/me"), ("GET", "/v1/devices"), ("POST", "/v1/logout"), ("GET", "/v1/sync/pull"), ("POST", "/v1/sync/push"), ("DELETE", "/v1/devices/1"), ("DELETE", "/v1/account"), ("POST", "/v1/password/change")];
    for (m, u) in routes {
        for t in [None, Some("kaputt"), Some("A".repeat(43)).as_deref().map(|_| "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] {
            let (s, _) = call(&c, m, u, "10.0.0.9", t, Some(json!({}))).await;
            assert_eq!(s, StatusCode::UNAUTHORIZED, "{m} {u} ohne gültiges Token");
        }
    }
    let (s, _) = call_raw(&c, "GET", "/v1/me", "10.0.0.9", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}
#[tokio::test]
async fn access_token_expires_and_refresh_rotates() {
    let c = setup();
    let v = register(&c, "anna", 1, "10.0.0.1").await;
    let (access, refresh) = (tok(&v), v["refresh_token"].as_str().unwrap().to_string());
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&access), None).await.0, StatusCode::OK);
    c.st.clock_offset.fetch_add(901, Ordering::Relaxed);
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&access), None).await.0, StatusCode::UNAUTHORIZED, "Zugriffstoken läuft nach 15 Minuten ab");
    let (s, v2) = call(&c, "POST", "/v1/token/refresh", "10.0.0.1", None, Some(json!({ "refresh_token": refresh }))).await;
    assert_eq!(s, StatusCode::OK);
    assert_ne!(v2["refresh_token"].as_str().unwrap(), refresh, "Erneuerungstoken wird bei jeder Nutzung ausgetauscht");
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&tok(&v2)), None).await.0, StatusCode::OK);
}
#[tokio::test]
async fn reusing_an_old_refresh_token_locks_the_device() {
    let c = setup();
    let v = register(&c, "anna", 1, "10.0.0.1").await;
    let old = v["refresh_token"].as_str().unwrap().to_string();
    let (_, v2) = call(&c, "POST", "/v1/token/refresh", "10.0.0.1", None, Some(json!({ "refresh_token": old }))).await;
    let new_access = tok(&v2);
    let (s, _) = call(&c, "POST", "/v1/token/refresh", "10.0.0.1", None, Some(json!({ "refresh_token": old }))).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "altes Token darf nicht noch einmal funktionieren");
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&new_access), None).await.0, StatusCode::UNAUTHORIZED, "nach Wiederverwendung ist das ganze Gerät gesperrt");
}
#[tokio::test]
async fn logout_and_device_revocation_work() {
    let c = setup();
    let a = register(&c, "anna", 1, "10.0.0.1").await;
    let (_, second) = login(&c, "anna", 1, "10.0.0.2").await;
    let list = call(&c, "GET", "/v1/devices", "10.0.0.1", Some(&tok(&a)), None).await.1;
    assert_eq!(list["devices"].as_array().unwrap().len(), 2);
    let second_id = second["device_id"].as_i64().unwrap();
    assert_eq!(call(&c, "DELETE", &format!("/v1/devices/{second_id}"), "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::OK);
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.2", Some(&tok(&second)), None).await.0, StatusCode::UNAUTHORIZED, "gesperrtes Gerät verliert sofort den Zugriff");
    assert_eq!(call(&c, "POST", "/v1/logout", "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::OK);
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::UNAUTHORIZED);
}
#[tokio::test]
async fn disabled_accounts_lose_access() {
    let c = setup();
    let a = register(&c, "anna", 1, "10.0.0.1").await;
    c.st.db.lock().unwrap().execute("UPDATE users SET disabled = 1", []).unwrap();
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(login(&c, "anna", 1, "10.0.0.2").await.0, StatusCode::UNAUTHORIZED);
}

/* ---------- Trennung der Konten (wichtigster Test) ---------- */
#[tokio::test]
async fn accounts_are_strictly_isolated() {
    let c = setup();
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    let b = tok(&register(&c, "berta", 2, "10.0.0.2").await);
    assert_eq!(push(&c, &a, json!([{ "id": "note-1", "blob": blob(0xAA, 64) }])).await.0, StatusCode::OK);
    // Berta sieht nichts von Annas Daten
    assert_eq!(pull(&c, &b).await["records"].as_array().unwrap().len(), 0);
    // Berta nutzt dieselbe Datensatz-ID: überschreibt nichts bei Anna, auch nicht mit einer geratenen Versionsnummer
    let (s, v) = push(&c, &b, json!([{ "id": "note-1", "base_seq": 1, "blob": blob(0xBB, 64) }])).await;
    assert_eq!(s, StatusCode::OK); assert_eq!(v["conflicts"].as_array().unwrap().len(), 0);
    let pa = pull(&c, &a).await;
    assert_eq!(pa["records"][0]["blob"], blob(0xAA, 64), "Annas Datensatz blieb unverändert");
    let pb = pull(&c, &b).await;
    assert_eq!(pb["records"][0]["blob"], blob(0xBB, 64));
    // Geräte und Konto-Infos sind getrennt
    let da = call(&c, "GET", "/v1/devices", "10.0.0.1", Some(&a), None).await.1;
    let anna_dev = da["devices"][0]["id"].as_i64().unwrap();
    assert_eq!(call(&c, "DELETE", &format!("/v1/devices/{anna_dev}"), "10.0.0.2", Some(&b), None).await.0, StatusCode::NOT_FOUND, "fremdes Gerät sperren geht nicht");
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&a), None).await.1["username"], "anna");
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.2", Some(&b), None).await.1["username"], "berta");
}
#[tokio::test]
async fn user_cannot_pass_another_account_id() {
    // Es gibt keine Stelle in der Schnittstelle, an der eine Konto-ID mitgegeben wird. Zusätzliche Felder werden ignoriert und ändern nichts.
    let c = setup();
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    let b = tok(&register(&c, "berta", 2, "10.0.0.2").await);
    push(&c, &a, json!([{ "id": "geheim", "blob": blob(0xAA, 40) }])).await;
    let (s, _) = call(&c, "POST", "/v1/sync/push", "10.0.0.2", Some(&b), Some(json!({ "user_id": 1, "records": [{ "id": "x", "user_id": 1, "blob": blob(0xBB, 40) }] }))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(pull(&c, &a).await["records"].as_array().unwrap().len(), 1, "Anna hat weiter genau ihren einen Datensatz");
    let (_, v) = call(&c, "GET", "/v1/sync/pull?since=0&user_id=1", "10.0.0.2", Some(&b), None).await;
    assert_eq!(v["records"].as_array().unwrap().len(), 1); assert_eq!(v["records"][0]["id"], "x");
}

/* ---------- Sync ---------- */
#[tokio::test]
async fn sync_detects_conflicts_and_supports_deletes() {
    let c = setup();
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    let (_, v) = push(&c, &a, json!([{ "id": "n1", "blob": blob(1, 40) }])).await;
    let seq1 = v["accepted"][0]["seq"].as_i64().unwrap();
    let (_, v) = push(&c, &a, json!([{ "id": "n1", "base_seq": seq1, "blob": blob(2, 40) }])).await;
    let seq2 = v["accepted"][0]["seq"].as_i64().unwrap(); assert!(seq2 > seq1);
    let (_, v) = push(&c, &a, json!([{ "id": "n1", "base_seq": seq1, "blob": blob(3, 40) }])).await;   // zweites Gerät mit altem Stand
    assert_eq!(v["conflicts"][0]["server_seq"], seq2); assert_eq!(v["accepted"].as_array().unwrap().len(), 0);
    let (_, _) = push(&c, &a, json!([{ "id": "n1", "base_seq": seq2, "deleted": true }])).await;
    let p = pull(&c, &a).await;
    assert_eq!(p["records"][0]["deleted"], true); assert_eq!(p["records"][0]["blob"], "", "gelöschte Datensätze behalten keinen Inhalt");
    // Abgleich nur ab einer Position
    let (_, p2) = call(&c, "GET", &format!("/v1/sync/pull?since={}", p["latest_seq"]), "10.1.1.1", Some(&a), None).await;
    assert_eq!(p2["records"].as_array().unwrap().len(), 0);
}
#[tokio::test]
async fn sync_rejects_bad_and_oversized_input() {
    let c = setup();
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    for id in ["../x", "a b", "'; DROP TABLE records;--", "", &"x".repeat(65), "ä"] {
        assert_eq!(push(&c, &a, json!([{ "id": id, "blob": blob(1, 40) }])).await.0, StatusCode::BAD_REQUEST, "ID {id:?}");
    }
    assert_eq!(push(&c, &a, json!([{ "id": "a", "blob": "***kein-base64***" }])).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(push(&c, &a, json!([{ "id": "a" }])).await.0, StatusCode::BAD_REQUEST, "Inhalt fehlt");
    assert_eq!(push(&c, &a, json!([{ "id": "a", "blob": blob(1, 4) }])).await.0, StatusCode::BAD_REQUEST, "zu kurz für eine Verschlüsselung");
    assert_eq!(push(&c, &a, json!([{ "id": "a", "blob": blob(1, (1 << 20) + 1) }])).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(push(&c, &a, json!([])).await.0, StatusCode::BAD_REQUEST);
    let many: Vec<Value> = (0..201).map(|i| json!({ "id": format!("r{i}"), "blob": blob(1, 20) })).collect();
    assert_eq!(push(&c, &a, Value::Array(many)).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(push(&c, &a, json!([{ "id": "d", "blob": blob(1, 20) }, { "id": "d", "blob": blob(2, 20) }])).await.0, StatusCode::BAD_REQUEST, "doppelte ID");
    // Eine Anfrage über dem Gesamtlimit wird abgewiesen, bevor sie gelesen wird
    let huge = vec![b'a'; 5 << 20];
    assert_eq!(call_raw(&c, "POST", "/v1/sync/push", "10.1.1.1", Some(&a), Some(huge)).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    // Nach alledem ist nichts gespeichert
    assert_eq!(pull(&c, &a).await["records"].as_array().unwrap().len(), 0);
}
#[tokio::test]
async fn quota_is_enforced_and_pull_pages() {
    let c = setup_with(Config { quota_bytes: 2000, ..Config::default() });
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    assert_eq!(push(&c, &a, json!([{ "id": "a", "blob": blob(1, 1500) }])).await.0, StatusCode::OK);
    assert_eq!(push(&c, &a, json!([{ "id": "b", "blob": blob(1, 1000) }])).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    let (s, _) = push(&c, &a, json!([{ "id": "b", "blob": blob(1, 300) }])).await; assert_eq!(s, StatusCode::OK);
    let (_, p) = call(&c, "GET", "/v1/sync/pull?since=0&limit=1", "10.1.1.1", Some(&a), None).await;
    assert_eq!(p["records"].as_array().unwrap().len(), 1); assert_eq!(p["has_more"], true);
}

/* ---------- Passwort ändern, Konto löschen ---------- */
#[tokio::test]
async fn password_change_logs_out_other_devices() {
    let c = setup();
    let a = register(&c, "anna", 1, "10.0.0.1").await;
    let (_, second) = login(&c, "anna", 1, "10.0.0.2").await;
    let body = json!({ "current_auth_hash": h(1), "new_auth_hash": h(5), "new_kdf_salt": util::b64(&[8u8; 16]), "new_kdf_params": util::DEFAULT_KDF_PARAMS, "new_key_blob_pw": util::b64(&[3u8; 48]) });
    let mut wrong = body.clone(); wrong["current_auth_hash"] = json!(h(9));
    assert_eq!(call(&c, "POST", "/v1/password/change", "10.0.0.1", Some(&tok(&a)), Some(wrong)).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(call(&c, "POST", "/v1/password/change", "10.0.0.1", Some(&tok(&a)), Some(body)).await.0, StatusCode::OK);
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.2", Some(&tok(&second)), None).await.0, StatusCode::UNAUTHORIZED, "andere Geräte sind abgemeldet");
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::OK, "das ändernde Gerät bleibt angemeldet");
    assert_eq!(login(&c, "anna", 1, "10.0.0.3").await.0, StatusCode::UNAUTHORIZED, "altes Passwort geht nicht mehr");
    assert_eq!(login(&c, "anna", 5, "10.0.0.4").await.0, StatusCode::OK);
}
#[tokio::test]
async fn deleting_an_account_removes_all_its_data_and_only_its_data() {
    let c = setup();
    let a = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    let b = tok(&register(&c, "berta", 2, "10.0.0.2").await);
    push(&c, &a, json!([{ "id": "n1", "blob": blob(1, 50) }])).await; push(&c, &b, json!([{ "id": "n1", "blob": blob(2, 50) }])).await;
    assert_eq!(call(&c, "DELETE", "/v1/account", "10.0.0.1", Some(&a), Some(json!({ "auth_hash": h(9) }))).await.0, StatusCode::UNAUTHORIZED, "ohne richtiges Passwort wird nichts gelöscht");
    assert_eq!(call(&c, "DELETE", "/v1/account", "10.0.0.1", Some(&a), Some(json!({ "auth_hash": h(1) }))).await.0, StatusCode::OK);
    {
        let db = c.st.db.lock().unwrap();
        let count = |sql: &str| -> i64 { db.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM users WHERE username='anna'"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM records WHERE user_id = 1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM devices WHERE user_id = 1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM records WHERE user_id = 2"), 1, "Bertas Daten bleiben");
    }
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&a), None).await.0, StatusCode::UNAUTHORIZED);
}

/* ---------- Datenablage ---------- */
#[tokio::test]
async fn database_holds_no_plain_secrets() {
    let c = setup();
    let v = register(&c, "anna", 1, "10.0.0.1").await;
    let (access, refresh) = (tok(&v), v["refresh_token"].as_str().unwrap().to_string());
    let db = c.st.db.lock().unwrap();
    let phc: String = db.query_row("SELECT auth_phc FROM users", [], |r| r.get(0)).unwrap();
    assert!(phc.starts_with("$argon2id$"), "Login-Wert wird mit Argon2id gespeichert");
    assert!(!phc.contains(&h(1)));
    let (ah, rh): (Vec<u8>, Vec<u8>) = db.query_row("SELECT access_hash, refresh_hash FROM sessions", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(ah.len(), 32); assert_eq!(rh.len(), 32);
    assert_ne!(ah, access.as_bytes()); assert_ne!(rh, refresh.as_bytes(), "nur Hashes der Tokens liegen in der Datenbank");
    let inv: Vec<u8> = db.query_row("SELECT token_hash FROM invites", [], |r| r.get(0)).unwrap();
    assert_eq!(inv.len(), 32, "Einladungen nur als Hash");
}
#[tokio::test]
async fn responses_carry_security_headers() {
    let c = setup();
    let req = Request::builder().uri("/healthz").header("x-real-ip", "10.0.0.1").body(Body::empty()).unwrap();
    let res = c.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers().get("cache-control").unwrap(), "no-store");
    assert_eq!(res.headers().get("x-content-type-options").unwrap(), "nosniff");
    assert!(c.app.clone().oneshot(Request::builder().uri("/gibt-es-nicht").body(Body::empty()).unwrap()).await.unwrap().status() == StatusCode::NOT_FOUND);
}
#[tokio::test]
async fn forged_proxy_header_is_ignored_when_not_trusted() {
    let st = AppState::new(Connection::open_in_memory().unwrap(), Config { trust_proxy: false, ..Config::default() }).unwrap();
    let c = Ctx { app: build_app(st.clone()), st };
    let mut limited = false;
    for i in 0..15 {   // Angreifer wechselt die behauptete Adresse bei jeder Anfrage: ohne trust_proxy zählt trotzdem die echte Verbindung
        let (s, _) = login(&c, "nobody", 1, &format!("10.66.0.{i}")).await;
        if s == StatusCode::TOO_MANY_REQUESTS { limited = true; break; }
    }
    assert!(limited, "gefälschter X-Real-IP darf das Rate-Limit nicht umgehen");
}

/* ---------- Zufallseingaben: nie ein 500er, nie ein Absturz ---------- */
#[tokio::test]
async fn fuzzing_never_causes_server_errors() {
    let c = setup();
    let t = tok(&register(&c, "anna", 1, "10.0.0.1").await);
    let mut rng = rand::thread_rng();
    let endpoints = [("POST", "/v1/register"), ("POST", "/v1/login"), ("POST", "/v1/token/refresh"), ("POST", "/v1/sync/push"), ("POST", "/v1/password/change"), ("DELETE", "/v1/account"), ("GET", "/v1/sync/pull")];
    let words = ["null", "true", "-1", "9223372036854775807", "\"\"", "[]", "{}", "\"\\u0000\"", "\"%00\"", "\"' OR 1=1 --\"", "\"AAAA\"", "1e999"];
    for i in 0..400 {
        let (m, u) = endpoints[rng.gen_range(0..endpoints.len())];
        let ip = format!("10.50.{}.{}", i / 200, i % 200);
        let body: Vec<u8> = match rng.gen_range(0..4) {
            0 => { let mut b = vec![0u8; rng.gen_range(0..300)]; rng.fill_bytes(&mut b); b }
            1 => format!("{{\"records\":[{{\"id\":{},\"blob\":{},\"base_seq\":{}}}],\"username\":{},\"auth_hash\":{},\"refresh_token\":{},\"invite\":{}}}",
                words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())], words[rng.gen_range(0..words.len())]).into_bytes(),
            2 => format!("{{\"records\":[{{\"id\":\"{}\",\"blob\":\"{}\"}}]}}", (0..rng.gen_range(0..80)).map(|_| rng.gen_range(33u8..126) as char).filter(|c| *c != '"' && *c != '\\').collect::<String>(), (0..rng.gen_range(0..60)).map(|_| rng.gen_range(33u8..126) as char).filter(|c| *c != '"' && *c != '\\').collect::<String>()).into_bytes(),
            _ => b"{\"records\": [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[".to_vec(),
        };
        let token = if rng.gen_bool(0.5) { Some(t.as_str()) } else { None };
        let (s, _) = call_raw(&c, m, &format!("{u}{}", if u.ends_with("pull") { "?since=abc&limit=-5" } else { "" }), &ip, token, Some(body)).await;
        assert!(s.as_u16() < 500, "{m} {u} lieferte {s}");
    }
}

/* ---------- Wiederherstellung (Passwort vergessen) ---------- */
#[tokio::test]
async fn recovery_resets_password_and_logs_out_all_devices() {
    let c = setup();
    let a = register(&c, "anna", 1, "10.0.0.1").await;            // Wiederherstellungs-Prüfwert = h(101)
    push(&c, &tok(&a), json!([{ "id": "n1", "blob": blob(9, 40) }])).await;
    let (s, v) = call(&c, "POST", "/v1/recover/start", "10.0.0.2", None, Some(json!({ "username": "anna", "recovery_auth_hash": h(101) }))).await;
    assert_eq!(s, StatusCode::OK); assert_eq!(v["key_blob_rec"], util::b64(&[2u8; 48]));
    let rt = v["recovery_token"].as_str().unwrap().to_string();
    let fin = json!({ "recovery_token": rt, "new_auth_hash": h(7), "new_kdf_salt": util::b64(&[5u8; 16]), "new_kdf_params": util::DEFAULT_KDF_PARAMS, "new_key_blob_pw": util::b64(&[4u8; 48]), "device_name": "Neues Handy" });
    let (s, v2) = call(&c, "POST", "/v1/recover/finish", "10.0.0.2", None, Some(fin.clone())).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(call(&c, "GET", "/v1/me", "10.0.0.1", Some(&tok(&a)), None).await.0, StatusCode::UNAUTHORIZED, "alte Geräte sind abgemeldet");
    assert_eq!(pull(&c, &tok(&v2)).await["records"].as_array().unwrap().len(), 1, "Daten sind noch da");
    assert_eq!(call(&c, "POST", "/v1/recover/finish", "10.0.0.2", None, Some(fin)).await.0, StatusCode::UNAUTHORIZED, "Token nur einmal nutzbar");
    assert_eq!(login(&c, "anna", 1, "10.0.0.3").await.0, StatusCode::UNAUTHORIZED);
    let (s, l) = login(&c, "anna", 7, "10.0.0.4").await; assert_eq!(s, StatusCode::OK); assert_eq!(l["key_blob_pw"], util::b64(&[4u8; 48]));
}
#[tokio::test]
async fn recovery_rejects_wrong_keys_expired_tokens_and_unknown_users_alike() {
    let c = setup();
    register(&c, "anna", 1, "10.0.0.1").await;
    let (s1, v1) = call(&c, "POST", "/v1/recover/start", "10.0.1.1", None, Some(json!({ "username": "anna", "recovery_auth_hash": h(55) }))).await;
    let (s2, v2) = call(&c, "POST", "/v1/recover/start", "10.0.1.2", None, Some(json!({ "username": "niemand", "recovery_auth_hash": h(101) }))).await;
    assert_eq!((s1, &v1), (StatusCode::UNAUTHORIZED, &json!({"error":"unauthorized"})));
    assert_eq!((s2, &v2), (StatusCode::UNAUTHORIZED, &json!({"error":"unauthorized"})));
    assert_eq!(call(&c, "POST", "/v1/recover/start", "10.0.1.3", None, Some(json!({ "username": "anna", "recovery_auth_hash": h(1) }))).await.0, StatusCode::UNAUTHORIZED, "das Passwort ist kein Wiederherstellungsschlüssel");
    let (_, v) = call(&c, "POST", "/v1/recover/start", "10.0.1.4", None, Some(json!({ "username": "anna", "recovery_auth_hash": h(101) }))).await;
    c.st.clock_offset.fetch_add(601, Ordering::Relaxed);
    let fin = json!({ "recovery_token": v["recovery_token"], "new_auth_hash": h(7), "new_kdf_salt": util::b64(&[5u8; 16]), "new_kdf_params": util::DEFAULT_KDF_PARAMS, "new_key_blob_pw": util::b64(&[4u8; 48]), "device_name": "X" });
    assert_eq!(call(&c, "POST", "/v1/recover/finish", "10.0.1.5", None, Some(fin)).await.0, StatusCode::UNAUTHORIZED, "Token läuft nach 10 Minuten ab");
    assert_eq!(login(&c, "anna", 1, "10.0.1.6").await.0, StatusCode::OK, "nichts wurde verändert");
}
