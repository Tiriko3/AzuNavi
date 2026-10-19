// Datei-Befehle für Etappe 4 (Dateien).
// Grundregeln: Die App LÖSCHT NIE etwas und ÜBERSCHREIBT NIE etwas.
// Sie arbeitet nur, wenn du ihr etwas gibst (keine Überwachung, keine Hintergrundprozesse).

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct DirNode {
    name: String,
    path: String,
    children: Vec<DirNode>,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
pub struct MoveResult {
    /// neuer vollständiger Pfad
    to: String,
    /// "moved" = verschoben, "copied" = anderes Laufwerk: kopiert, Original liegt noch an alter Stelle
    mode: String,
}

/// Systemdateien und versteckte Dateien ausblenden
fn hidden(name: &str) -> bool {
    let n = name.to_lowercase();
    name.starts_with('.') || name.starts_with("~$") || n == "desktop.ini" || n == "thumbs.db"
}

fn name_of(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

fn build_tree(p: &Path, depth: u32) -> DirNode {
    let mut children = Vec::new();
    if depth < 16 {
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if hidden(&name) {
                    continue;
                }
                // Verknüpfungen/Symlinks werden bewusst nicht verfolgt (keine Endlosschleifen)
                if let Ok(ft) = e.file_type() {
                    if ft.is_dir() {
                        children.push(build_tree(&e.path(), depth + 1));
                    }
                }
            }
        }
    }
    children.sort_by_key(|c| c.name.to_lowercase());
    DirNode { name: name_of(p), path: p.to_string_lossy().to_string(), children }
}

/// Ordnerbaum (nur Ordner) unterhalb von `root`
#[tauri::command]
pub async fn fs_tree(root: String) -> Result<DirNode, String> {
    let p = PathBuf::from(&root);
    if !p.is_dir() {
        return Err(format!("Ordner nicht gefunden: {root}"));
    }
    Ok(build_tree(&p, 0))
}

/// Inhalt eines Ordners (Unterordner und Dateien)
#[tauri::command]
pub async fn fs_list(dir: String) -> Result<Vec<Entry>, String> {
    let rd = fs::read_dir(&dir).map_err(|e| format!("Ordner kann nicht gelesen werden: {e}"))?;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if hidden(&name) {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(Entry {
            name,
            path: e.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified,
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub async fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub async fn fs_is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// Ordner anlegen (auch mehrere Ebenen). Existiert er schon, passiert nichts.
#[tauri::command]
pub async fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Ordner konnte nicht angelegt werden: {e}"))
}

/// Freier Name im Zielordner: "Bericht.pdf" -> "Bericht (2).pdf", "Bericht (3).pdf", ...
#[tauri::command]
pub async fn fs_unique_name(dir: String, name: String) -> String {
    let d = Path::new(&dir);
    if !d.join(&name).exists() {
        return name;
    }
    let p = Path::new(&name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.clone());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut i = 2;
    loop {
        let candidate = format!("{stem} ({i}){ext}");
        if !d.join(&candidate).exists() {
            return candidate;
        }
        i += 1;
    }
}

fn is_cross_device(e: &std::io::Error) -> bool {
    // Windows: ERROR_NOT_SAME_DEVICE (17), Linux/macOS: EXDEV (18)
    if cfg!(windows) {
        e.raw_os_error() == Some(17)
    } else {
        e.raw_os_error() == Some(18)
    }
}

/// Datei oder Ordner nach `dest_dir` verschieben, optional mit neuem Namen.
/// Liegt dort schon etwas mit dem Namen, kommt der Fehler "ZIEL_EXISTIERT" (nichts wird überschrieben).
#[tauri::command]
pub async fn fs_move(src: String, dest_dir: String, new_name: Option<String>) -> Result<MoveResult, String> {
    let src_p = PathBuf::from(&src);
    let dest_p = PathBuf::from(&dest_dir);
    if !src_p.exists() {
        return Err(format!("QUELLE_FEHLT: {src}"));
    }
    if !dest_p.is_dir() {
        return Err(format!("Zielordner nicht gefunden: {dest_dir}"));
    }
    let name = new_name.unwrap_or_else(|| name_of(&src_p));
    let target = dest_p.join(&name);
    if target.exists() {
        return Err("ZIEL_EXISTIERT".into());
    }
    if src_p.is_dir() {
        let canon_src = src_p.canonicalize().map_err(|e| e.to_string())?;
        let canon_dest = dest_p.canonicalize().map_err(|e| e.to_string())?;
        if canon_dest.starts_with(&canon_src) {
            return Err("Ein Ordner kann nicht in sich selbst verschoben werden.".into());
        }
    }
    match fs::rename(&src_p, &target) {
        Ok(()) => Ok(MoveResult { to: target.to_string_lossy().to_string(), mode: "moved".into() }),
        Err(e) if is_cross_device(&e) && src_p.is_file() => {
            // Anderes Laufwerk: nur kopieren, das Original wird NICHT gelöscht
            fs::copy(&src_p, &target).map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;
            Ok(MoveResult { to: target.to_string_lossy().to_string(), mode: "copied".into() })
        }
        Err(e) if is_cross_device(&e) => Err(
            "Der Ordner liegt auf einem anderen Laufwerk. Bitte diesen Ordner im Explorer verschieben.".into(),
        ),
        Err(e) => Err(format!("Verschieben fehlgeschlagen: {e}")),
    }
}

/// Liest bis zu `max` Bytes einer Datei (für die Vorschau von Bildern, PDF und Text)
#[tauri::command]
pub async fn fs_read(path: String, max: u64) -> Result<tauri::ipc::Response, String> {
    let f = fs::File::open(&path).map_err(|e| format!("Datei kann nicht gelesen werden: {e}"))?;
    let mut buf = Vec::new();
    f.take(max).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(buf))
}

/// Öffnet die Datei im Standardprogramm von Windows
#[tauri::command]
pub async fn fs_open(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Zeigt die Datei im Explorer (markiert)
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Schreibt eine Datei an den Ort, den du im Speichern-Fenster gewählt hast
/// (ob eine vorhandene Datei ersetzt werden darf, fragt Windows dort selbst nach)
#[tauri::command]
pub async fn fs_write_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
}

/// Portable App: legt beim Start eine Verknüpfung „AzuNavi“ auf dem Desktop an.
/// Ist sie schon da und zeigt auf diese .exe, passiert nichts. Nach einem Umzug der .exe
/// (z. B. auf einen anderen Laptop oder in einen anderen Ordner) wird sie neu gesetzt.
#[tauri::command]
pub async fn ensure_desktop_shortcut(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    // .lnk-Verknüpfungen gibt es nur unter Windows. Auf Linux legen .deb und AppImage selbst einen Starter an.
    if !cfg!(windows) {
        return Ok("nicht-windows".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Im Entwicklungsmodus (npm run tauri dev) keine Verknüpfung anlegen
    if cfg!(debug_assertions) {
        return Ok("dev".into());
    }
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let lnk = desktop.join("AzuNavi.lnk");
    let marker = app.path().app_config_dir().map_err(|e| e.to_string())?.join("shortcut-target.txt");
    let target = exe.to_string_lossy().to_string();
    let known = fs::read_to_string(&marker).unwrap_or_default();
    if lnk.exists() && known.trim() == target {
        return Ok("ok".into());
    }
    create_link(&exe, &lnk)?;
    if let Some(dir) = marker.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&marker, &target);
    Ok("created".into())
}

#[cfg(windows)]
fn create_link(exe: &Path, lnk: &Path) -> Result<(), String> {
    let mut sl = mslnk::ShellLink::new(exe).map_err(|e| e.to_string())?;
    if let Some(dir) = exe.parent() {
        sl.set_working_dir(Some(dir.to_string_lossy().to_string()));
    }
    sl.set_icon_location(Some(exe.to_string_lossy().to_string()));
    sl.create_lnk(lnk).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn create_link(_exe: &Path, _lnk: &Path) -> Result<(), String> {
    Ok(()) // auf Linux (Plan B: Fedora) gibt es keine .lnk-Dateien
}
