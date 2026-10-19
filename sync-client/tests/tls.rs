//! Pinning-Test mit echtem TLS: Die App darf nur Servern vertrauen, deren Zertifikat von UNSERER CA stammt, und nur mit TLS 1.3.
use azunavi_server::{build_app, util, AppState, Config};
use azunavi_sync_client::{Error, Server, Session};
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};
use rusqlite::Connection;
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
use std::{net::SocketAddr, sync::Arc};

struct Pki { ca_pem: String, cert_pem: String, key_pem: String }
fn make_pki() -> Pki {
    let ca_key = KeyPair::generate().unwrap();
    let mut ca = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    let ca_cert = ca.self_signed(&ca_key).unwrap();
    let key = KeyPair::generate().unwrap();
    let cert = CertificateParams::new(vec!["localhost".to_string()]).unwrap().signed_by(&key, &ca_cert, &ca_key).unwrap();
    Pki { ca_pem: ca_cert.pem(), cert_pem: cert.pem(), key_pem: key.serialize_pem() }
}

async fn start_tls(pki: &Pki, tls12_only: bool) -> (String, AppState) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let st = AppState::new(Connection::open_in_memory().unwrap(), Config::default()).unwrap();
    let app = build_app(st.clone());
    let certs = vec![CertificateDer::from_pem_slice(pki.cert_pem.as_bytes()).unwrap()];
    let key = PrivateKeyDer::from_pem_slice(pki.key_pem.as_bytes()).unwrap();
    let versions: &[&rustls::SupportedProtocolVersion] = if tls12_only { &[&rustls::version::TLS12] } else { &[&rustls::version::TLS13] };
    let mut cfg = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_protocol_versions(versions).unwrap().with_no_client_auth().with_single_cert(certs, key).unwrap();
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    let tls = axum_server::tls_rustls::RustlsConfig::from_config(Arc::new(cfg));
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move { axum_server::from_tcp_rustls(l, tls).serve(app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    (format!("https://localhost:{port}"), st)
}
fn invite(st: &AppState) -> String {
    let t = util::random_token(); let now = st.now();
    st.db.lock().unwrap().execute("INSERT INTO invites (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)", rusqlite::params![util::sha256(t.as_bytes()), now, now + 3600]).unwrap();
    t
}
const PW: &str = "Korrekt-Pferd-Batterie-42";

#[tokio::test]
async fn works_with_our_ca() {
    let pki = make_pki();
    let (url, st) = start_tls(&pki, false).await;
    let s = Server::new(&url, Some(pki.ca_pem.as_bytes())).unwrap();
    assert!(Session::register(s, &invite(&st), "anna", PW, "PC").await.is_ok(), "mit der eigenen CA klappt die Verbindung");
}

#[tokio::test]
async fn rejects_server_from_another_ca() {
    let (pki, fremd) = (make_pki(), make_pki());
    let (url, st) = start_tls(&pki, false).await;
    // Ein Angreifer (oder ein Proxy) mit eigenem, fremdem Zertifikat
    let s = Server::new(&url, Some(fremd.ca_pem.as_bytes())).unwrap();
    assert_eq!(Session::register(s, &invite(&st), "anna", PW, "PC").await.err(), Some(Error::Network));
}

#[tokio::test]
async fn rejects_tls_older_than_1_3() {
    let pki = make_pki();
    let (url, st) = start_tls(&pki, true).await;
    let s = Server::new(&url, Some(pki.ca_pem.as_bytes())).unwrap();
    assert_eq!(Session::register(s, &invite(&st), "anna", PW, "PC").await.err(), Some(Error::Network), "TLS 1.2 wird abgelehnt");
}

#[tokio::test]
async fn rejects_more_than_one_ca_in_pin() {
    let (a, b) = (make_pki(), make_pki());
    let both = format!("{}{}", a.ca_pem, b.ca_pem);
    assert!(matches!(Server::new("https://localhost:1", Some(both.as_bytes())), Err(Error::Insecure(_))));
}
