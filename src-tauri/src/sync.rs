// Cloud-Sicherung (TEST): Verbindung zum AzuNavi-Server. Passwort, Datenschlüssel und Tokens bleiben hier im Rust-Teil,
// das JavaScript bekommt sie nie zu sehen. Die Anmeldung wird nicht gespeichert: nach jedem App-Start neu anmelden.
use azunavi_sync_client::{backup::Upload, Error, Server, Session};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SyncState(pub Mutex<Option<Session>>);

fn e(err: Error) -> String { err.to_string() }
fn server(url: &str, ca: Option<String>) -> Result<Server, String> { Server::new(url, ca.as_deref().map(|s| s.as_bytes())).map_err(e) }
fn now() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }

#[tauri::command]
pub async fn sync_status(state: State<'_, SyncState>) -> Result<Option<String>, String> {
    Ok(state.0.lock().await.as_ref().map(|s| s.username.clone()))
}

#[tauri::command]
pub async fn sync_register(state: State<'_, SyncState>, url: String, ca: Option<String>, invite: String, username: String, password: String, device: String) -> Result<String, String> {
    let (s, rk) = Session::register(server(&url, ca)?, &invite, &username, &password, &device).await.map_err(e)?;
    *state.0.lock().await = Some(s);
    Ok(rk.to_string())
}

#[tauri::command]
pub async fn sync_login(state: State<'_, SyncState>, url: String, ca: Option<String>, username: String, password: String, device: String) -> Result<(), String> {
    let s = Session::login(server(&url, ca)?, &username, &password, &device).await.map_err(e)?;
    *state.0.lock().await = Some(s);
    Ok(())
}

#[tauri::command]
pub async fn sync_recover(state: State<'_, SyncState>, url: String, ca: Option<String>, username: String, recovery: String, new_password: String, device: String) -> Result<(), String> {
    let s = Session::recover(server(&url, ca)?, &username, &recovery, &new_password, &device).await.map_err(e)?;
    *state.0.lock().await = Some(s);
    Ok(())
}

#[tauri::command]
pub async fn sync_logout(state: State<'_, SyncState>) -> Result<(), String> {
    if let Some(s) = state.0.lock().await.take() { let _ = s.logout().await; }
    Ok(())
}

#[derive(Serialize)]
pub struct UploadResult { status: &'static str, meta_seq: i64 }

#[tauri::command]
pub async fn sync_upload(state: State<'_, SyncState>, b64: String, known_meta_seq: Option<i64>, device: String) -> Result<UploadResult, String> {
    if b64.len() > 140 * 1024 * 1024 { return Err("Die Sicherung ist zu groß für die Cloud (max. etwa 100 MB).".into()); }
    let bytes = zeroize::Zeroizing::new(STANDARD.decode(b64.as_bytes()).map_err(|_| "Sicherung ungültig".to_string())?);
    let mut g = state.0.lock().await;
    let s = g.as_mut().ok_or("Bitte zuerst anmelden.")?;
    match s.upload_backup(&bytes, known_meta_seq, &device, now()).await.map_err(e)? {
        Upload::Done { meta_seq } => Ok(UploadResult { status: "done", meta_seq }),
        Upload::Conflict { server_meta_seq } => Ok(UploadResult { status: "conflict", meta_seq: server_meta_seq }),
    }
}

#[derive(Serialize)]
pub struct DownloadResult { b64: String, meta_seq: i64, created: i64, device: String, size: usize }

#[tauri::command]
pub async fn sync_download(state: State<'_, SyncState>) -> Result<Option<DownloadResult>, String> {
    let mut g = state.0.lock().await;
    let s = g.as_mut().ok_or("Bitte zuerst anmelden.")?;
    Ok(s.download_backup().await.map_err(e)?.map(|(i, bytes)| DownloadResult { b64: STANDARD.encode(&bytes[..]), meta_seq: i.meta_seq, created: i.created, device: i.device, size: i.size }))
}

#[tauri::command]
pub async fn sync_delete_account(state: State<'_, SyncState>, password: String) -> Result<(), String> {
    let mut g = state.0.lock().await;
    let s = g.as_mut().ok_or("Bitte zuerst anmelden.")?;
    s.delete_account(&password).await.map_err(e)?;   // bei falschem Passwort bleibt man angemeldet
    *g = None;
    Ok(())
}
