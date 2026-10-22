// Freigegebene Orte für die Datei-Befehle (ab 0.4.1, nur PC). Die Prüfregeln stehen in fsguard.rs.
//
// Wie ein Ort freigegeben wird, bestimmt NICHT das Frontend:
//  - Ordner und Dateien wählt der Nutzer in Dialogen, die Rust selbst öffnet (fs_pick_folder, fs_pick_files, fs_save_file).
//  - Dateien, die aufs Fenster gezogen werden, meldet das Betriebssystem an Rust (on_webview_event in lib.rs), nicht das Frontend.
//  - Die bisherigen Ordner und Dateilinks aus der Datenbank werden EINMAL nach einer Rückfrage in einem Windows-Fenster übernommen (fs_adopt).
// Gespeichert wird in freigaben.json im Konfigurationsordner der App.

use crate::datadir as dd;
use crate::fsguard::{canon_for_check, Grants};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const FILE: &str = "freigaben.json";

pub struct FsGrants {
    pub inner: Mutex<Grants>,
    /// Wurde die Übernahme der bisherigen Orte schon einmal angeboten (egal wie die Antwort war)?
    asked: Mutex<bool>,
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    #[serde(default)]
    asked: bool,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    undo_dirs: Vec<String>,
}

fn path_of(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(FILE))
}
fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Beim Start laden. Eine fehlende oder kaputte Datei bedeutet: keine Freigaben (dann wird die Übernahme erneut angeboten).
pub fn load(app: &AppHandle) -> FsGrants {
    let st: Stored = path_of(app).ok().and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let canon = |v: &Vec<String>| v.iter().map(|x| PathBuf::from(x).canonicalize().unwrap_or_else(|_| PathBuf::from(x))).collect::<Vec<_>>();
    FsGrants {
        asked: Mutex::new(st.asked),
        inner: Mutex::new(Grants { roots: canon(&st.roots), files: canon(&st.files), undo_dirs: canon(&st.undo_dirs), session: vec![] }),
    }
}

fn save(app: &AppHandle, g: &FsGrants) -> Result<(), String> {
    let st = {
        let inner = g.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
        Stored {
            asked: *g.asked.lock().map_err(|_| "Interner Fehler.".to_string())?,
            roots: inner.roots.iter().map(|p| s(p)).collect(),
            files: inner.files.iter().map(|p| s(p)).collect(),
            undo_dirs: inner.undo_dirs.iter().map(|p| s(p)).collect(),
        }
    };
    let p = path_of(app)?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| format!("Freigaben konnten nicht gespeichert werden: {e}"))?;
    }
    dd::write_atomic(&p, &serde_json::to_vec_pretty(&st).map_err(|e| e.to_string())?)
}

/// Prüft einen Pfad der Datei-Befehle (Fehler: NICHT_FREIGEGEBEN)
pub fn check(app: &AppHandle, path: &str, need: crate::fsguard::Need) -> Result<PathBuf, String> {
    let g = app.state::<FsGrants>();
    let inner = g.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
    inner.check(Path::new(path), need)?;
    Ok(PathBuf::from(path))
}

/// Nach dem Verschieben: den Quellordner merken, damit „Rückgängig“ auch nach einem Neustart zurücklegen darf
pub fn remember_undo_dir(app: &AppHandle, src_parent: &Path) {
    let g = app.state::<FsGrants>();
    if let Ok(c) = canon_for_check(src_parent) {
        let changed = match g.inner.lock() {
            Ok(mut i) => i.add_undo_dir(c),
            Err(_) => false,
        };
        if changed {
            let _ = save(app, &g);
        }
    }
}

/// Vom Betriebssystem gemeldete abgelegte Dateien/Ordner: für diese Sitzung freigeben
pub fn allow_dropped(app: &AppHandle, paths: &[PathBuf]) {
    let g = app.state::<FsGrants>();
    let mut inner = match g.inner.lock() {
        Ok(i) => i,
        Err(_) => return,
    };
    for p in paths {
        if let Ok(c) = p.canonicalize() {
            inner.add_session(c);
        }
    }
}

/* ---------- Befehle ---------- */

#[derive(Serialize)]
pub struct GrantsState {
    asked: bool,
}

#[tauri::command]
pub async fn fs_grants_state(state: State<'_, FsGrants>) -> Result<GrantsState, String> {
    Ok(GrantsState { asked: *state.asked.lock().map_err(|_| "Interner Fehler.".to_string())? })
}

#[derive(Serialize)]
pub struct AdoptResult {
    /// "ja", "nein" oder "nichts" (es gab nichts zu übernehmen)
    answer: String,
    folders: usize,
    files: usize,
}

/// Einmalig: bisherige Ordner und Dateilinks aus der Datenbank weiter erlauben, nach Rückfrage in einem Windows-Fenster.
/// Das Frontend liefert nur die Vorschläge. Freigegeben wird nur, wenn der Nutzer im Fenster zustimmt. Ein zweiter Aufruf bewirkt nichts.
#[tauri::command]
pub async fn fs_adopt(app: AppHandle, window: WebviewWindow, state: State<'_, FsGrants>, folders: Vec<String>, files: Vec<String>) -> Result<AdoptResult, String> {
    if *state.asked.lock().map_err(|_| "Interner Fehler.".to_string())? {
        return Ok(AdoptResult { answer: "nichts".into(), folders: 0, files: 0 });
    }
    let mut ok_folders: Vec<PathBuf> = Vec::new();
    let mut ok_files: Vec<PathBuf> = Vec::new();
    for f in folders.iter().take(200) {
        if let Ok(c) = Path::new(f).canonicalize() {
            if c.is_dir() && c.parent().is_some() && !ok_folders.contains(&c) {
                ok_folders.push(c);
            }
        }
    }
    for f in files.iter().take(5000) {
        if let Ok(c) = Path::new(f).canonicalize() {
            if (c.is_file() || c.is_dir()) && !ok_files.contains(&c) {
                ok_files.push(c);
            }
        }
    }
    if ok_folders.is_empty() && ok_files.is_empty() {
        return Ok(AdoptResult { answer: "nichts".into(), folders: 0, files: 0 });
    }
    let list: String = ok_folders.iter().take(8).map(|p| format!("  • {}", dd::display_path(p))).collect::<Vec<_>>().join("\n");
    let msg = format!(
        "Ab dieser Version darf AzuNavi nur noch auf Ordner und Dateien zugreifen, die du ausdrücklich freigibst.\n\n\
         Soll AzuNavi die bisher benutzten weiter verwenden?\n\n{} Ordner{}{}\n{} verknüpfte Datei(en)\n\n\
         Wählst du „Nicht jetzt“, wählst du die Ordner auf der Dateien-Seite einfach neu aus.",
        ok_folders.len(),
        if list.is_empty() { "" } else { ":\n" },
        list,
        ok_files.len()
    );
    let yes = app
        .dialog()
        .message(msg)
        .title("AzuNavi: Ordner weiter benutzen?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Erlauben".into(), "Nicht jetzt".into()))
        .parent(&window)
        .blocking_show();
    *state.asked.lock().map_err(|_| "Interner Fehler.".to_string())? = true;
    let (nf, nfi) = (ok_folders.len(), ok_files.len());
    if yes {
        let mut inner = state.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
        for p in ok_folders {
            inner.add_root(p);
        }
        for p in ok_files {
            inner.add_file(p);
        }
    }
    save(&app, &state)?;
    Ok(AdoptResult { answer: if yes { "ja" } else { "nein" }.into(), folders: nf, files: nfi })
}

#[derive(Serialize)]
pub struct GrantItem {
    /// Pfad zur Anzeige (und zum Entziehen: genau diesen Text zurückgeben)
    path: String,
    name: String,
    exists: bool,
}

#[derive(Serialize)]
pub struct GrantsList {
    roots: Vec<GrantItem>,
    files: Vec<GrantItem>,
    /// Anzahl gemerkter Rückweg-Ordner (zum Zurücklegen verschobener Dateien)
    undo_dirs: usize,
}

fn item(p: &Path) -> GrantItem {
    let shown = dd::display_path(p);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| shown.clone());
    GrantItem { exists: p.exists(), path: shown, name }
}

/// Was ist dauerhaft freigegeben? (Für die Übersicht unter System)
#[tauri::command]
pub async fn fs_grants_list(state: State<'_, FsGrants>) -> Result<GrantsList, String> {
    let g = state.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
    Ok(GrantsList { roots: g.roots.iter().map(|p| item(p)).collect(), files: g.files.iter().map(|p| item(p)).collect(), undo_dirs: g.undo_dirs.len() })
}

/// Eine Freigabe entziehen. `kind`: "root" (Ordner), "file" (einzelne Datei), "all-files" (alle Einzeldateien und Rückweg-Ordner).
/// Die Ordner und Dateien selbst werden nie angefasst. `path` ist der Text aus fs_grants_list.
#[tauri::command]
pub async fn fs_grants_revoke(app: AppHandle, state: State<'_, FsGrants>, kind: String, path: Option<String>) -> Result<(), String> {
    {
        let mut g = state.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
        let find = |list: &Vec<PathBuf>| path.as_ref().and_then(|want| list.iter().find(|p| dd::display_path(p) == *want).cloned());
        match kind.as_str() {
            "root" => {
                let p = find(&g.roots).ok_or_else(|| "Diese Freigabe gibt es nicht (mehr).".to_string())?;
                g.revoke_root(&p);
            }
            "file" => {
                let p = find(&g.files).ok_or_else(|| "Diese Freigabe gibt es nicht (mehr).".to_string())?;
                g.revoke_file(&p);
            }
            "all-files" => g.clear_files(),
            _ => return Err("Unbekannte Art.".into()),
        }
    }
    save(&app, &state)
}

/// Ordner-Dialog. `keep`: dauerhaft freigeben (Arbeit, Schule, Cloud-Ordner) oder nur für diese Sitzung (Quellordner zum Verschieben).
/// Gibt den gewählten Pfad zurück, bei Abbruch null.
#[tauri::command]
pub async fn fs_pick_folder(app: AppHandle, window: WebviewWindow, state: State<'_, FsGrants>, title: String, keep: bool) -> Result<Option<String>, String> {
    let Some(fp) = app.dialog().file().set_title(title).set_parent(&window).blocking_pick_folder() else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let canon = path.canonicalize().map_err(|e| format!("Der Ordner ist nicht erreichbar: {e}"))?;
    if !canon.is_dir() {
        return Err("Das ist kein Ordner.".into());
    }
    if canon.parent().is_none() {
        return Err("Bitte wähle einen Ordner, nicht das ganze Laufwerk.".into());
    }
    {
        let mut inner = state.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
        if keep {
            inner.add_root(canon);
        } else {
            inner.add_session(canon);
        }
    }
    if keep {
        save(&app, &state)?;
    }
    Ok(Some(s(&path)))
}

/// Datei-Dialog (eine oder mehrere). `keep`: dauerhaft merken (Datei wird mit einem Projekt verknüpft und später wieder geöffnet).
#[tauri::command]
pub async fn fs_pick_files(app: AppHandle, window: WebviewWindow, state: State<'_, FsGrants>, multiple: bool, title: String, keep: bool) -> Result<Vec<String>, String> {
    let b = app.dialog().file().set_title(title).set_parent(&window);
    let picked: Vec<PathBuf> = if multiple {
        b.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).collect()
    } else {
        b.blocking_pick_file().and_then(|f| f.into_path().ok()).into_iter().collect()
    };
    {
        let mut inner = state.inner.lock().map_err(|_| "Interner Fehler.".to_string())?;
        for p in &picked {
            if let Ok(c) = p.canonicalize() {
                if keep {
                    inner.add_file(c);
                } else {
                    inner.add_session(c);
                }
            }
        }
    }
    if keep && !picked.is_empty() {
        save(&app, &state)?;
    }
    Ok(picked.iter().map(|p| s(p)).collect())
}

/// „Speichern unter“: Rust öffnet den Dialog und schreibt die Datei selbst an den gewählten Ort. Gibt den Pfad zurück, bei Abbruch null.
/// (Ob eine vorhandene Datei ersetzt werden darf, fragt Windows im Dialog selbst.)
#[tauri::command]
pub async fn fs_save_file(app: AppHandle, window: WebviewWindow, default_name: String, filter_name: String, ext: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    let Some(fp) = app.dialog().file().set_title("Speichern unter").set_file_name(default_name).add_filter(filter_name, &[ext.as_str()]).set_parent(&window).blocking_save_file() else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))?;
    Ok(Some(s(&path)))
}
