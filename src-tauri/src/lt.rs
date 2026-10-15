// LanguageTool (Grammatik-Prüfung, Java) als lokaler Hintergrunddienst.
// Läuft nur auf diesem Rechner (localhost), wird beim Beenden der App wieder gestoppt.
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

pub struct LtState(pub Mutex<Option<Child>>);

pub const LT_PORT: u16 = 8081;

fn find_jar(dir: &PathBuf) -> Option<PathBuf> {
    let direct = dir.join("languagetool-server.jar");
    if direct.exists() {
        return Some(direct);
    }
    // auch einen Unterordner wie „LanguageTool-6.6“ akzeptieren
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path().join("languagetool-server.jar")).find(|p| p.exists())
}

fn find_java(dir: &PathBuf) -> PathBuf {
    // mitgeliefertes Java im LanguageTool-Ordner bevorzugen, sonst das installierte
    for c in ["jre/bin/java.exe", "jre/bin/java", "java/bin/java.exe", "java/bin/java"] {
        let p = dir.join(c);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(if cfg!(windows) { "java.exe" } else { "java" })
}

/// Startet LanguageTool aus dem gewählten Ordner (falls er nicht schon läuft) und gibt den Port zurück
#[tauri::command]
pub fn lt_start(dir: String, state: tauri::State<LtState>) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(LT_PORT); // läuft schon
        }
    }
    let base = PathBuf::from(&dir);
    let jar = find_jar(&base).ok_or("In diesem Ordner liegt keine languagetool-server.jar. Bitte den entpackten LanguageTool-Ordner wählen.")?;
    let mut cmd = Command::new(find_java(&base));
    cmd.arg("-cp").arg(&jar)
        .arg("org.languagetool.server.HTTPServer")
        .arg("--port").arg(LT_PORT.to_string())
        .arg("--allow-origin").arg("*");
    if let Some(parent) = jar.parent() {
        cmd.current_dir(parent);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: kein schwarzes Konsolenfenster
    }
    let child = cmd.spawn().map_err(|e| {
        format!("Java konnte nicht gestartet werden ({e}). Ist Java 17 oder neuer installiert?")
    })?;
    *guard = Some(child);
    Ok(LT_PORT)
}

/// Stoppt LanguageTool
#[tauri::command]
pub fn lt_stop(state: tauri::State<LtState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
