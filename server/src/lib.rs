//! AzuNavi-Server (ENTWURF): speichert nur verschlüsselte Blöcke. Die App verschlüsselt auf dem Gerät.
pub mod db;
pub mod error;
pub mod limiter;
pub mod routes;
pub mod util;

use axum::{extract::{DefaultBodyLimit, MatchedPath, Request}, http::{header, HeaderValue}, middleware::{self, Next}, response::Response, routing::{delete, get, post}, Router};
use error::AppError;
use limiter::Limiter;
use rusqlite::Connection;
use std::{net::SocketAddr, sync::{atomic::{AtomicI64, Ordering}, Arc, Mutex}, time::Duration};
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{set_header::SetResponseHeaderLayer, timeout::TimeoutLayer};

#[derive(Clone)]
pub struct Config {
    pub trust_proxy: bool,          // Client-Adresse aus X-Real-IP lesen (nur hinter Caddy einschalten)
    pub access_ttl: i64,            // Sekunden
    pub refresh_ttl: i64,           // Sekunden
    pub max_blob: usize,            // Bytes pro Datensatz
    pub quota_bytes: i64,           // Bytes pro Konto
    pub max_body: usize,            // Bytes pro Anfrage
    pub login_per_ip: u32,          // pro Minute
    pub register_per_ip: u32,       // pro Stunde
    pub api_per_user: u32,          // pro Minute
}
impl Default for Config {
    fn default() -> Self {
        Self { trust_proxy: false, access_ttl: 900, refresh_ttl: 30 * 86400, max_blob: 1 << 20, quota_bytes: 100 << 20,
               max_body: 4 << 20, login_per_ip: 10, register_per_ip: 5, api_per_user: 600 }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cfg: Arc<Config>,
    pub limiter: Arc<Limiter>,
    pub server_secret: Arc<Vec<u8>>,
    pub dummy_phc: Arc<String>,         // für gleichen Zeitaufwand bei unbekannten Konten
    pub clock_offset: Arc<AtomicI64>,   // nur für Tests: Zeit verschieben
}

impl AppState {
    pub fn new(conn: Connection, cfg: Config) -> anyhow::Result<Self> {
        db::init(&conn)?;
        let secret = db::server_secret(&conn)?;
        let dummy = routes::auth::hash_login_value(&util::b64(&util::random_bytes(32)))
            .map_err(|_| anyhow::anyhow!("Argon2 nicht nutzbar"))?;
        Ok(Self { db: Arc::new(Mutex::new(conn)), cfg: Arc::new(cfg), limiter: Arc::new(Limiter::new()),
                  server_secret: Arc::new(secret), dummy_phc: Arc::new(dummy), clock_offset: Arc::new(AtomicI64::new(0)) })
    }
    pub fn now(&self) -> i64 { util::system_now() + self.clock_offset.load(Ordering::Relaxed) }

    /// Datenbankarbeit im Hintergrund-Thread (blockiert nie den Server)
    pub async fn with_db<T: Send + 'static>(&self, f: impl FnOnce(&mut Connection) -> Result<T, AppError> + Send + 'static) -> Result<T, AppError> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || { let mut c = db.lock().unwrap_or_else(|e| e.into_inner()); f(&mut c) })
            .await.map_err(|_| AppError::Internal)?
    }
}

/// Adresse des Clients (für Rate-Limits). Nur hinter dem eigenen Proxy aus dem Header, sonst die echte Verbindung.
#[derive(Clone, Debug)]
pub struct ClientIp(pub String);

async fn client_ip(axum::extract::State(st): axum::extract::State<AppState>, mut req: Request, next: Next) -> Response {
    let mut ip = req.extensions().get::<axum::extract::ConnectInfo<SocketAddr>>().map(|c| c.0.ip().to_string()).unwrap_or_else(|| "unbekannt".into());
    if st.cfg.trust_proxy {
        if let Some(h) = req.headers().get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if h.len() <= 45 && h.parse::<std::net::IpAddr>().is_ok() { ip = h.to_string(); }
        }
    }
    req.extensions_mut().insert(ClientIp(ip));
    next.run(req).await
}

/// Protokoll pro Anfrage: nur Methode, Muster-Pfad, Status, Dauer. Nie Inhalte, Header, Tokens oder Adressen.
async fn access_log(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.extensions().get::<MatchedPath>().map(|m| m.as_str().to_owned()).unwrap_or_else(|| "?".into());
    let t = std::time::Instant::now();
    let res = next.run(req).await;
    tracing::info!("{} {} -> {} ({} ms)", method, path, res.status().as_u16(), t.elapsed().as_millis());
    res
}

pub fn build_app(state: AppState) -> Router {
    let max_body = state.cfg.max_body;
    Router::new()
        .route("/healthz", get(routes::healthz))
        .route("/v1/prelogin", get(routes::auth::prelogin))
        .route("/v1/register", post(routes::auth::register))
        .route("/v1/login", post(routes::auth::login))
        .route("/v1/token/refresh", post(routes::auth::refresh))
        .route("/v1/recover/start", post(routes::auth::recover_start))
        .route("/v1/recover/finish", post(routes::auth::recover_finish))
        .route("/v1/logout", post(routes::auth::logout))
        .route("/v1/me", get(routes::auth::me))
        .route("/v1/devices", get(routes::auth::devices))
        .route("/v1/devices/:id", delete(routes::auth::revoke_device))
        .route("/v1/password/change", post(routes::auth::change_password))
        .route("/v1/account", delete(routes::auth::delete_account))
        .route("/v1/sync/push", post(routes::sync::push))
        .route("/v1/sync/pull", get(routes::sync::pull))
        .layer(DefaultBodyLimit::max(max_body))
        .layer(TimeoutLayer::with_status_code(axum::http::StatusCode::REQUEST_TIMEOUT, Duration::from_secs(30)))
        .layer(ConcurrencyLimitLayer::new(64))
        .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-store")))
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(middleware::from_fn(access_log))
        .layer(middleware::from_fn_with_state(state.clone(), client_ip))
        .with_state(state)
}
