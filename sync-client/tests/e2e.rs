//! Ende-zu-Ende: echter Server (im Test gestartet) + echter Client über TCP. Nur erfundene Daten.
use azunavi_server::{build_app, util, AppState, Config};
use azunavi_sync_client::{crypto::RecoveryKey, Error, Record, Server, Session};
use rusqlite::Connection;
use serde_json::json;
use std::{net::SocketAddr, sync::atomic::Ordering};

async fn start() -> (String, AppState) {
    let st = AppState::new(Connection::open_in_memory().unwrap(), Config::default()).unwrap();
    let app = build_app(st.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap() });
    (format!("http://{addr}"), st)
}
fn invite(st: &AppState) -> String {
    let t = util::random_token(); let now = st.now();
    st.db.lock().unwrap().execute("INSERT INTO invites (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)", rusqlite::params![util::sha256(t.as_bytes()), now, now + 3600]).unwrap();
    t
}
fn srv(url: &str) -> Server { Server::new(url, None).unwrap() }
const PW: &str = "Korrekt-Pferd-Batterie-42";
const GEHEIM: &str = "GEHEIM-Notiz-Testdaten-123";

#[tokio::test]
async fn two_devices_share_encrypted_data() {
    let (url, st) = start().await;
    let (mut pc, rk) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    assert_eq!(rk.split('-').count(), 13, "Wiederherstellungsschlüssel in Vierergruppen");
    let r = pc.push(&[Record { id: "note:1".into(), base_seq: None, data: Some(json!({ "text": GEHEIM, "datum": "2026-10-16" })) }]).await.unwrap();
    assert_eq!(r.accepted.len(), 1);
    let mut handy = Session::login(srv(&url), "anna", PW, "Handy").await.unwrap();
    let p = handy.pull(0).await.unwrap();
    assert_eq!(p.records.len(), 1);
    assert_eq!(p.records[0].data.as_ref().unwrap()["text"], GEHEIM);
    // Löschen kommt auch an
    handy.push(&[Record { id: "note:1".into(), base_seq: Some(p.records[0].seq), data: None }]).await.unwrap();
    let p2 = pc.pull(p.latest_seq).await.unwrap();
    assert_eq!(p2.records[0].data, None);
    let _ = st;
}

#[tokio::test]
async fn server_never_sees_plaintext_password_or_key() {
    let (url, st) = start().await;
    let (mut s, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    s.push(&[Record { id: "n".into(), base_seq: None, data: Some(json!({ "text": GEHEIM })) }]).await.unwrap();
    let db = st.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT blob FROM records UNION ALL SELECT key_blob_pw FROM users UNION ALL SELECT key_blob_rec FROM users UNION ALL SELECT CAST(auth_phc AS BLOB) FROM users UNION ALL SELECT kdf_salt FROM users").unwrap();
    let blobs: Vec<Vec<u8>> = stmt.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
    for b in &blobs {
        let s = String::from_utf8_lossy(b);
        assert!(!s.contains(GEHEIM), "Klartext darf nie auf dem Server liegen");
        assert!(!s.contains(PW), "Passwort darf nie auf dem Server liegen");
    }
}

#[tokio::test]
async fn wrong_password_fails_and_tampering_is_detected() {
    let (url, st) = start().await;
    let (mut s, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    assert_eq!(Session::login(srv(&url), "anna", "Falsches-Passwort-99", "X").await.err(), Some(Error::Unauthorized));
    s.push(&[Record { id: "a".into(), base_seq: None, data: Some(json!({ "t": "A" })) }, Record { id: "b".into(), base_seq: None, data: Some(json!({ "t": "B" })) }]).await.unwrap();
    // 1) Ein Byte im gespeicherten Datensatz kippen
    st.db.lock().unwrap().execute("UPDATE records SET blob = CAST(substr(blob,1,30) || char(unicode(substr(blob,31,1)) ^ 1) || substr(blob,32) AS BLOB) WHERE record_id = 'a'", []).ok();
    let flipped: Vec<u8> = st.db.lock().unwrap().query_row("SELECT blob FROM records WHERE record_id='a'", [], |r| r.get(0)).unwrap();
    let mut f = flipped.clone(); f[30] ^= 0x01;
    st.db.lock().unwrap().execute("UPDATE records SET blob = ?1 WHERE record_id='a'", [f]).unwrap();
    assert_eq!(s.pull(0).await.err(), Some(Error::Tampered), "veränderter Inhalt muss auffallen");
    // 2) Gültigen Inhalt von b unter der ID a ablegen (Vertauschen)
    let b_blob: Vec<u8> = st.db.lock().unwrap().query_row("SELECT blob FROM records WHERE record_id='b'", [], |r| r.get(0)).unwrap();
    st.db.lock().unwrap().execute("UPDATE records SET blob = ?1 WHERE record_id='a'", [b_blob]).unwrap();
    assert_eq!(s.pull(0).await.err(), Some(Error::Tampered), "vertauschte Datensätze müssen auffallen");
}

#[tokio::test]
async fn client_refuses_weak_kdf_params_from_server() {
    let (url, st) = start().await;
    Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    // Ein manipulierter Server schlägt schwächere Parameter vor (für ihn erlaubt, für die App nicht)
    st.db.lock().unwrap().execute("UPDATE users SET kdf_params = 'argon2id;m=32768;t=2;p=1'", []).unwrap();
    assert!(matches!(Session::login(srv(&url), "anna", PW, "X").await, Err(Error::Insecure(_))));
}

#[tokio::test]
async fn recovery_key_restores_access_with_new_password() {
    let (url, st) = start().await;
    let (mut s, rk) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    s.push(&[Record { id: "n".into(), base_seq: None, data: Some(json!({ "text": GEHEIM })) }]).await.unwrap();
    // Tippfehler-tolerant: Kleinbuchstaben und ohne Striche
    let typed = rk.replace('-', "").to_lowercase();
    let mut r = Session::recover(srv(&url), "anna", &typed, "Ganz-neues-Passwort-7", "Neues Handy").await.unwrap();
    assert_eq!(r.pull(0).await.unwrap().records[0].data.as_ref().unwrap()["text"], GEHEIM, "Daten sind nach der Wiederherstellung lesbar");
    assert_eq!(s.pull(0).await.err(), Some(Error::Unauthorized), "altes Gerät ist abgemeldet");
    assert_eq!(Session::login(srv(&url), "anna", PW, "X").await.err(), Some(Error::Unauthorized));
    assert!(Session::login(srv(&url), "anna", "Ganz-neues-Passwort-7", "Y").await.is_ok());
    // Falscher Schlüssel
    let other = RecoveryKey::generate().display();
    assert_eq!(Session::recover(srv(&url), "anna", &other, "Noch-ein-Passwort-88", "Z").await.err(), Some(Error::Unauthorized));
    assert!(matches!(Session::recover(srv(&url), "anna", "ABCD-EFGH", "Noch-ein-Passwort-88", "Z").await, Err(Error::BadInput(_))));
}

#[tokio::test]
async fn password_change_keeps_data_and_tokens_refresh_automatically() {
    let (url, st) = start().await;
    let (mut s, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    s.push(&[Record { id: "n".into(), base_seq: None, data: Some(json!({ "text": GEHEIM })) }]).await.unwrap();
    st.clock_offset.fetch_add(901, Ordering::Relaxed);          // Zugriffstoken abgelaufen
    assert_eq!(s.pull(0).await.unwrap().records.len(), 1, "App erneuert das Token selbst");
    assert!(matches!(s.change_password(PW, "kurz").await, Err(Error::BadInput(_))));
    s.change_password(PW, "Neues-langes-Passwort-1").await.unwrap();
    let mut n = Session::login(srv(&url), "anna", "Neues-langes-Passwort-1", "Z").await.unwrap();
    assert_eq!(n.pull(0).await.unwrap().records[0].data.as_ref().unwrap()["text"], GEHEIM);
    n.delete_account("Neues-langes-Passwort-1").await.unwrap();
    assert_eq!(Session::login(srv(&url), "anna", "Neues-langes-Passwort-1", "Z").await.err(), Some(Error::Unauthorized));
}

#[tokio::test]
async fn only_https_with_pinned_ca_is_accepted() {
    assert_eq!(Server::new("http://example.com", None).err(), Some(Error::Insecure("nur https:// ist erlaubt")));
    assert_eq!(Server::new("https://azunavi.intern", None).err(), Some(Error::Insecure("das Zertifikat der Server-CA fehlt")));
    assert_eq!(Server::new("https://azunavi.intern", Some(b"kein Zertifikat")).err(), Some(Error::Insecure("CA-Zertifikat ist unlesbar")));
    assert!(Server::new("ftp://x", None).is_err());
    let _ = Session::register; // nur damit der Import genutzt ist
}

/* ---------- Cloud-Sicherung ---------- */
use azunavi_sync_client::backup::Upload;
fn big(n: usize, seed: u8) -> Vec<u8> { (0..n).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect() }

#[tokio::test]
async fn backup_roundtrip_between_devices_and_old_chunks_are_removed() {
    let (url, st) = start().await;
    let (mut pc, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    assert!(pc.download_backup().await.unwrap().is_none(), "noch keine Sicherung");
    let data = big(1_500_000, 7);                                   // ~1,5 MB -> 3 Stücke
    let Upload::Done { meta_seq } = pc.upload_backup(&data, None, "PC", 100).await.unwrap() else { panic!("Konflikt erwartet nicht") };
    let mut handy = Session::login(srv(&url), "anna", PW, "Handy").await.unwrap();
    let (info, got) = handy.download_backup().await.unwrap().unwrap();
    assert_eq!(&got[..], &data[..]); assert_eq!(info.meta_seq, meta_seq); assert_eq!(info.device, "PC");
    // Zweite Sicherung vom Handy (kennt den Stand) -> alte Stücke weg
    let data2 = big(700_000, 9);
    let Upload::Done { .. } = handy.upload_backup(&data2, Some(info.meta_seq), "Handy", 200).await.unwrap() else { panic!() };
    let (info2, got2) = pc.download_backup().await.unwrap().unwrap();
    assert_eq!(&got2[..], &data2[..]); assert_eq!(info2.device, "Handy");
    let live: i64 = st.db.lock().unwrap().query_row("SELECT COUNT(*) FROM records WHERE deleted = 0 AND record_id LIKE 'bk:%:%' AND record_id != 'bk:meta'", [], |r| r.get(0)).unwrap();
    assert_eq!(live, 2, "nur die Stücke der neuesten Sicherung bleiben");
    let used: i64 = st.db.lock().unwrap().query_row("SELECT used_bytes FROM users", [], |r| r.get(0)).unwrap();
    assert!(used < 1_100_000, "Platz der alten Sicherung ist wieder frei ({used})");
}

#[tokio::test]
async fn backup_never_overwrites_a_newer_one_from_another_device() {
    let (url, st) = start().await;
    let (mut pc, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    let mut handy = Session::login(srv(&url), "anna", PW, "Handy").await.unwrap();
    let Upload::Done { meta_seq } = pc.upload_backup(&big(10_000, 1), None, "PC", 1).await.unwrap() else { panic!() };
    // Handy kennt den Stand nicht (erstes Mal) -> darf nicht überschreiben
    assert_eq!(handy.upload_backup(&big(10_000, 2), None, "Handy", 2).await.unwrap(), Upload::Conflict { server_meta_seq: meta_seq });
    // PC lädt neu hoch; das Handy mit altem Stand bekommt wieder einen Konflikt
    let Upload::Done { meta_seq: s2 } = pc.upload_backup(&big(10_000, 3), Some(meta_seq), "PC", 3).await.unwrap() else { panic!() };
    assert_eq!(handy.upload_backup(&big(10_000, 4), Some(meta_seq), "Handy", 4).await.unwrap(), Upload::Conflict { server_meta_seq: s2 });
    let (_, got) = pc.download_backup().await.unwrap().unwrap();
    assert_eq!(&got[..], &big(10_000, 3)[..], "Server hat weiter die Sicherung vom PC");
    let leftovers: i64 = st.db.lock().unwrap().query_row("SELECT COUNT(*) FROM records WHERE deleted = 0 AND record_id LIKE 'bk:%:%' AND record_id != 'bk:meta'", [], |r| r.get(0)).unwrap();
    assert_eq!(leftovers, 1, "abgelehnte Stücke wurden wieder entfernt");
}

#[tokio::test]
async fn manipulated_backup_is_rejected() {
    let (url, st) = start().await;
    let (mut s, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    s.upload_backup(&big(800_000, 5), None, "PC", 1).await.unwrap();
    // Ein Stück löschen -> unvollständig
    st.db.lock().unwrap().execute("DELETE FROM records WHERE record_id LIKE 'bk:%:00001'", []).unwrap();
    assert!(s.download_backup().await.is_err(), "unvollständige Sicherung darf nicht eingespielt werden");
}

#[tokio::test]
async fn wrong_password_on_delete_keeps_session() {
    let (url, st) = start().await;
    let (mut s, _) = Session::register(srv(&url), &invite(&st), "anna", PW, "PC").await.unwrap();
    assert!(s.delete_account("Falsches-Passwort-99").await.is_err());
    assert!(s.pull(0).await.is_ok(), "nach falschem Passwort weiter angemeldet");
    s.delete_account(PW).await.unwrap();
    assert_eq!(Session::login(srv(&url), "anna", PW, "X").await.err(), Some(Error::Unauthorized));
}
