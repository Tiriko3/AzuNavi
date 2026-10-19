use anyhow::{bail, Context, Result};
use azunavi_server::{build_app, db, util, AppState, Config};
use clap::{Parser, Subcommand};
use std::net::SocketAddr;

#[derive(Parser)]
#[command(name = "azunavi-server", about = "AzuNavi Sync-Server (ENTWURF, nur mit Testdaten)")]
struct Cli {
    #[arg(long, env = "AZUNAVI_DB", default_value = "azunavi.db")] db: String,
    #[command(subcommand)] cmd: Cmd,
}
#[derive(Subcommand)]
enum Cmd {
    /// Server starten
    Serve {
        #[arg(long, env = "AZUNAVI_BIND", default_value = "127.0.0.1:8080")] bind: String,
        /// Nur einschalten, wenn der Server ausschließlich hinter dem eigenen Proxy (Caddy) erreichbar ist
        #[arg(long, env = "AZUNAVI_TRUST_PROXY")] trust_proxy: bool,
    },
    /// Einladungen verwalten
    Invite { #[command(subcommand)] sub: InviteCmd },
    /// Konten verwalten
    User { #[command(subcommand)] sub: UserCmd },
    /// Abgelaufene Sitzungen und alte Protokolle löschen
    Purge,
}
#[derive(Subcommand)]
enum InviteCmd {
    /// Neue Einladung (der Link wird nur jetzt einmal angezeigt)
    Create { #[arg(long, default_value_t = 48)] hours: i64, #[arg(long)] note: Option<String> },
    List,
    Revoke { id: i64 },
}
#[derive(Subcommand)]
enum UserCmd { List, Disable { username: String }, Enable { username: String }, Delete { username: String } }

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let conn = db::open(&cli.db).with_context(|| format!("Datenbank {} lässt sich nicht öffnen", cli.db))?;
    let now = util::system_now();
    match cli.cmd {
        Cmd::Invite { sub } => match sub {
            InviteCmd::Create { hours, note } => {
                if !(1..=168).contains(&hours) { bail!("Gültigkeit: 1 bis 168 Stunden"); }
                let token = util::random_token();
                conn.execute("INSERT INTO invites (token_hash, note, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![util::sha256(token.as_bytes()), note, now, now + hours * 3600])?;
                db::audit(&conn, now, "invite_created", None);
                println!("Einladung (gilt {hours} Stunden, nur einmal nutzbar, wird nicht noch einmal angezeigt):\n{token}");
            }
            InviteCmd::List => {
                let mut s = conn.prepare("SELECT id, note, created_at, expires_at, used_at, revoked FROM invites ORDER BY id DESC LIMIT 50")?;
                let rows = s.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(3)?, r.get::<_, Option<i64>>(4)?, r.get::<_, i64>(5)?)))?;
                for r in rows { let (id, note, exp, used, rev) = r?;
                    let status = if rev != 0 { "widerrufen" } else if used.is_some() { "benutzt" } else if exp <= now { "abgelaufen" } else { "offen" };
                    println!("#{id}  {status:11} {}", note.unwrap_or_default()); }
            }
            InviteCmd::Revoke { id } => { let n = conn.execute("UPDATE invites SET revoked = 1 WHERE id = ?1 AND used_at IS NULL", [id])?; println!("{}", if n == 1 { "Widerrufen." } else { "Nicht gefunden oder schon benutzt." }); }
        },
        Cmd::User { sub } => match sub {
            UserCmd::List => {
                let mut s = conn.prepare("SELECT username, created_at, disabled, used_bytes, (SELECT COUNT(*) FROM devices d WHERE d.user_id = users.id AND d.revoked = 0) FROM users ORDER BY id")?;
                for r in s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?)))? {
                    let (n, dis, used, dev) = r?; println!("{n:32} {}  {} KiB  {dev} Geräte", if dis != 0 { "gesperrt" } else { "aktiv   " }, used / 1024); }
            }
            UserCmd::Disable { username } => { let n = conn.execute("UPDATE users SET disabled = 1 WHERE username = ?1", [&username])?; conn.execute("DELETE FROM sessions WHERE device_id IN (SELECT d.id FROM devices d JOIN users u ON u.id = d.user_id WHERE u.username = ?1)", [&username])?; println!("{}", if n == 1 { "Gesperrt, alle Sitzungen beendet." } else { "Konto nicht gefunden." }); }
            UserCmd::Enable { username } => { let n = conn.execute("UPDATE users SET disabled = 0 WHERE username = ?1", [&username])?; println!("{}", if n == 1 { "Entsperrt." } else { "Konto nicht gefunden." }); }
            UserCmd::Delete { username } => { let n = conn.execute("DELETE FROM users WHERE username = ?1", [&username])?; db::audit(&conn, now, "account_deleted_by_admin", None); println!("{}", if n == 1 { "Konto und alle Daten gelöscht." } else { "Konto nicht gefunden." }); }
        },
        Cmd::Purge => { db::purge(&conn, now)?; println!("Aufgeräumt."); }
        Cmd::Serve { bind, trust_proxy } => {
            tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).with_target(false).init();
            let addr: SocketAddr = bind.parse().context("Ungültige Adresse (Beispiel: 127.0.0.1:8080)")?;
            let cfg = Config { trust_proxy, ..Config::default() };
            if trust_proxy && addr.ip().is_unspecified() { tracing::warn!("trust_proxy mit offener Adresse: der Server darf nur über den Proxy erreichbar sein (Firewall/Docker-Netz prüfen)"); }
            db::purge(&conn, now)?;
            let state = AppState::new(conn, cfg)?;
            let purge_state = state.clone();
            tokio::spawn(async move { loop { tokio::time::sleep(std::time::Duration::from_secs(3600)).await; let n = purge_state.now(); let _ = purge_state.with_db(move |c| Ok(db::purge(c, n)?)).await; } });
            let listener = tokio::net::TcpListener::bind(addr).await?;
            tracing::info!("Server läuft auf {addr}");
            axum::serve(listener, build_app(state).into_make_service_with_connect_info::<SocketAddr>())
                .with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await?;
        }
    }
    Ok(())
}
