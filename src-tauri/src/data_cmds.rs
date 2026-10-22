// Tauri-Befehle für den Datenordner (ab 0.4.0, nur PC). Die eigentliche Arbeit steht in datadir.rs.
//
// Sicherheit: Das Frontend darf KEINEN beliebigen Pfad als Datenordner angeben.
//  - Den Ordner wählt der Nutzer im Dialog, den Rust selbst öffnet (data_pick_folder).
//  - Die Liste der bekannten Ordner gehört Rust (orte.json im Konfigurationsordner der App). data_open nimmt nur eine ID daraus.
//  - Danach lesen, schreiben und auflisten die Befehle nur noch innerhalb dieses Ordners und nur AzuNavis eigene Dateien.

use crate::datadir as dd;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const REGISTRY_FILE: &str = "orte.json";
const LEGACY_DB: &str = "persona.db";
const BACKUP_DIR: &str = "Sicherung-vor-0.4.0";

#[derive(Default)]
pub struct DataState {
    /// Der gerade geöffnete Datenordner (kanonisch)
    current: Mutex<Option<PathBuf>>,
    /// Sperrt Lesen und Schreiben der Ortsliste
    registry: Mutex<()>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Loc {
    id: String,
    path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    orte: Vec<Loc>,
}

#[derive(Serialize)]
pub struct LocInfo {
    id: String,
    /// Name des Ordners (letzter Teil des Pfads)
    name: String,
    /// Voller Pfad, nur zur Anzeige
    path: String,
    /// Gibt es den Ordner gerade? (z. B. nicht, wenn ein Laufwerk fehlt)
    exists: bool,
}

fn info(l: &Loc) -> LocInfo {
    let shown = dd::display_str(&l.path);
    let name = Path::new(&shown).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| shown.clone());
    LocInfo { id: l.id.clone(), name, path: shown, exists: Path::new(&l.path).is_dir() }
}

fn reg_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(REGISTRY_FILE))
}
fn load_registry(app: &AppHandle) -> Registry {
    reg_path(app).ok().and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn save_registry(app: &AppHandle, r: &Registry) -> Result<(), String> {
    let p = reg_path(app)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Konfiguration konnte nicht gespeichert werden: {e}"))?;
    }
    let json = serde_json::to_vec_pretty(r).map_err(|e| e.to_string())?;
    dd::write_atomic(&p, &json)
}
fn new_id(existing: &[Loc]) -> String {
    let mut n = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(1);
    loop {
        let id = format!("{:x}", n & 0xffff_ffff_ffff);
        if !existing.iter().any(|l| l.id == id) {
            return id;
        }
        n = n.wrapping_add(7919);
    }
}
fn current(state: &State<'_, DataState>) -> Result<PathBuf, String> {
    state.current.lock().map_err(|_| "Interner Fehler.".to_string())?.clone().ok_or_else(|| "Kein Datenordner gewählt.".to_string())
}

/* ---------- Datenordner wählen und öffnen ---------- */

/// Alle bekannten Datenordner (aus der Liste, der Dialog wird nicht geöffnet)
#[tauri::command]
pub async fn data_locations(app: AppHandle, state: State<'_, DataState>) -> Result<Vec<LocInfo>, String> {
    let _g = state.registry.lock().map_err(|_| "Interner Fehler.".to_string())?;
    Ok(load_registry(&app).orte.iter().map(info).collect())
}

/// Ordner-Dialog (von Rust geöffnet). Gewählter Ordner wird in die Liste aufgenommen. Abbruch: null.
#[tauri::command]
pub async fn data_pick_folder(app: AppHandle, window: WebviewWindow, state: State<'_, DataState>) -> Result<Option<LocInfo>, String> {
    let picked = app.dialog().file().set_title("Datenordner wählen").set_parent(&window).blocking_pick_folder();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let canon = path.canonicalize().map_err(|e| format!("Der Ordner ist nicht erreichbar: {e}"))?;
    if !canon.is_dir() {
        return Err("Das ist kein Ordner.".into());
    }
    if canon.parent().is_none() {
        return Err("Bitte wähle einen Ordner, nicht das ganze Laufwerk (zum Beispiel einen neuen Ordner „AzuNavi“ in OneDrive).".into());
    }
    dd::probe_writable(&canon)?;
    let _g = state.registry.lock().map_err(|_| "Interner Fehler.".to_string())?;
    let mut reg = load_registry(&app);
    if let Some(l) = reg.orte.iter().find(|l| Path::new(&l.path) == canon.as_path()) {
        return Ok(Some(info(l)));
    }
    let loc = Loc { id: new_id(&reg.orte), path: canon.to_string_lossy().to_string() };
    reg.orte.push(loc.clone());
    save_registry(&app, &reg)?;
    Ok(Some(info(&loc)))
}

/// Einen bekannten Datenordner öffnen (nur per ID aus der Liste)
#[tauri::command]
pub async fn data_open(app: AppHandle, state: State<'_, DataState>, id: String) -> Result<LocInfo, String> {
    let loc = {
        let _g = state.registry.lock().map_err(|_| "Interner Fehler.".to_string())?;
        load_registry(&app).orte.into_iter().find(|l| l.id == id).ok_or_else(|| "Diesen Datenordner kenne ich nicht.".to_string())?
    };
    let canon = Path::new(&loc.path).canonicalize().map_err(|_| "ORDNER_FEHLT".to_string())?;
    if !canon.is_dir() {
        return Err("ORDNER_FEHLT".into());
    }
    dd::probe_writable(&canon)?;
    *state.current.lock().map_err(|_| "Interner Fehler.".to_string())? = Some(canon);
    Ok(info(&loc))
}

#[tauri::command]
pub async fn data_close(state: State<'_, DataState>) -> Result<(), String> {
    *state.current.lock().map_err(|_| "Interner Fehler.".to_string())? = None;
    Ok(())
}

/// Einen Ordner aus der Liste nehmen. Der Ordner und alle Dateien darin bleiben unberührt.
#[tauri::command]
pub async fn data_forget(app: AppHandle, state: State<'_, DataState>, id: String) -> Result<(), String> {
    let _g = state.registry.lock().map_err(|_| "Interner Fehler.".to_string())?;
    let mut reg = load_registry(&app);
    let gone: Vec<Loc> = reg.orte.iter().filter(|l| l.id == id).cloned().collect();
    reg.orte.retain(|l| l.id != id);
    save_registry(&app, &reg)?;
    let mut cur = state.current.lock().map_err(|_| "Interner Fehler.".to_string())?;
    if let (Some(c), Some(g)) = (cur.as_ref(), gone.first()) {
        if Path::new(&g.path) == c.as_path() {
            *cur = None;
        }
    }
    Ok(())
}

/* ---------- Dateien im Datenordner ---------- */

/// Datei lesen. Gibt es sie nicht, kommt der Fehler „NICHT_GEFUNDEN“.
#[tauri::command]
pub async fn data_read(state: State<'_, DataState>, rel: String) -> Result<Response, String> {
    let root = current(&state)?;
    Ok(Response::new(dd::read_file(&root, &rel)?))
}

/// Datei atomar schreiben. Der Inhalt kommt als Rohdaten (schnell, auch bei großen Dateien), der Pfad prozentkodiert im Header „x-rel“.
#[tauri::command]
pub async fn data_write(state: State<'_, DataState>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Falscher Aufruf: es fehlen die Daten.".into());
    };
    let rel = request.headers().get("x-rel").and_then(|v| v.to_str().ok()).ok_or_else(|| "Der Pfad fehlt.".to_string())?;
    let rel = dd::percent_decode(rel)?;
    let root = current(&state)?;
    dd::write_file(&root, &rel, bytes)
}

/// Alle Dateien von AzuNavi im Datenordner (relative Pfade mit „/“)
#[tauri::command]
pub async fn data_list(state: State<'_, DataState>) -> Result<Vec<String>, String> {
    dd::list_app_files(&current(&state)?)
}

/// Sperrdatei entfernen (beim sauberen Beenden)
#[tauri::command]
pub async fn data_remove_lock(state: State<'_, DataState>) -> Result<(), String> {
    dd::remove_lock(&current(&state)?)
}

/* ---------- Alte Datenbank (persona.db) sichern ---------- */

#[derive(Serialize)]
pub struct LegacyInfo {
    exists: bool,
    size: u64,
    /// Zuletzt geändert (Sekunden seit 1970)
    modified: u64,
    dir: String,
    /// Ordner mit der Sicherung, falls es schon eine gibt
    backup_dir: Option<String>,
}

#[derive(Serialize)]
pub struct BackupInfo {
    dir: String,
    files: Vec<String>,
    bytes: u64,
    /// false: Es gab schon eine Sicherung, nichts wurde neu angelegt
    created: bool,
}

/// Wo liegt persona.db? Das SQL-Plugin legt sie im Konfigurationsordner an, das Fs-Plugin nutzt den Datenordner (unter Windows derselbe).
fn legacy_dir(app: &AppHandle) -> Option<PathBuf> {
    [app.path().app_config_dir(), app.path().app_data_dir()].into_iter().flatten().find(|d| d.join(LEGACY_DB).is_file())
}

fn existing_backup(bdir: &Path) -> Option<Vec<String>> {
    let rd = fs::read_dir(bdir).ok()?;
    let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.starts_with("persona-")).collect();
    names.sort();
    if names.iter().any(|n| n.ends_with(".db")) {
        Some(names)
    } else {
        None
    }
}

#[tauri::command]
pub async fn legacy_info(app: AppHandle) -> Result<LegacyInfo, String> {
    let Some(dir) = legacy_dir(&app) else {
        return Ok(LegacyInfo { exists: false, size: 0, modified: 0, dir: String::new(), backup_dir: None });
    };
    let meta = fs::metadata(dir.join(LEGACY_DB)).map_err(|e| e.to_string())?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let bdir = dir.join(BACKUP_DIR);
    Ok(LegacyInfo {
        exists: true,
        size: meta.len(),
        modified,
        dir: dd::display_path(&dir),
        backup_dir: existing_backup(&bdir).map(|_| dd::display_path(&bdir)),
    })
}

/// Sicherungskopie der alten Datenbank (persona.db und, falls vorhanden, persona.db-wal) neben die Datei legen.
/// Jede Kopie wird Byte für Byte mit dem Original verglichen. Es wird nie etwas überschrieben oder gelöscht.
/// Gibt es schon eine Sicherung, bleibt es dabei (die erste ist die wertvolle: der Stand vor der Übernahme).
#[tauri::command]
pub async fn legacy_backup(app: AppHandle, stamp: String) -> Result<BackupInfo, String> {
    if !dd::valid_stamp(&stamp) {
        return Err("Ungültiger Zeitstempel.".into());
    }
    let dir = legacy_dir(&app).ok_or_else(|| "Es gibt keine alte Datenbank (persona.db).".to_string())?;
    let bdir = dir.join(BACKUP_DIR);
    if let Some(names) = existing_backup(&bdir) {
        let bytes = names.iter().filter_map(|n| fs::metadata(bdir.join(n)).ok()).map(|m| m.len()).sum();
        return Ok(BackupInfo { dir: dd::display_path(&bdir), files: names, bytes, created: false });
    }
    fs::create_dir_all(&bdir).map_err(|e| format!("Sicherungsordner konnte nicht angelegt werden: {e}"))?;
    let mut made: Vec<PathBuf> = Vec::new();
    let mut names = Vec::new();
    let mut bytes = 0u64;
    for suffix in ["", "-wal"] {
        let src = dir.join(format!("{LEGACY_DB}{suffix}"));
        if !src.is_file() {
            continue;
        }
        let name = format!("persona-{stamp}.db{suffix}");
        let dst = bdir.join(&name);
        match dd::copy_verified(&src, &dst) {
            Ok(n) => {
                bytes += n;
                made.push(dst);
                names.push(name);
            }
            Err(e) => {
                for p in &made {
                    let _ = fs::remove_file(p);
                }
                return Err(e);
            }
        }
    }
    let readme = format!(
        "Sicherung der alten AzuNavi-Datenbank (persona.db), erstellt {stamp}, vor dem Umstieg auf Version 0.4.0.\r\n\r\n\
         Die Kopie wurde nach dem Anlegen Byte für Byte mit dem Original verglichen. AzuNavi löscht diese Dateien nie.\r\n\
         Zum Wiederherstellen mit einer älteren AzuNavi-Version: AzuNavi beenden, die Datei persona-{stamp}.db (und, falls vorhanden,\r\n\
         persona-{stamp}.db-wal) in den Ordner darüber kopieren und als persona.db (bzw. persona.db-wal) umbenennen.\r\n"
    );
    let _ = dd::write_atomic(&bdir.join("LIES-MICH.txt"), readme.as_bytes());
    Ok(BackupInfo { dir: dd::display_path(&bdir), files: names, bytes, created: true })
}
