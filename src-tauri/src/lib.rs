// AzuNavi: das Rust-Gerüst ist bewusst klein.
mod files;
mod lt;

// Datenbank (SQLite) läuft über das offizielle Tauri-SQL-Plugin,
// Tabellen und Migrationen liegen im Frontend (src/db/migrations.ts).
// Dateien (Anhänge, Porträts) laufen über die Plugins fs und dialog.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(lt::LtState(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Dateien: Bilder werden in den App-Ordner kopiert und von dort gelesen
        .plugin(tauri_plugin_fs::init())
        // Dateiauswahl-Fenster ("Bild hinzufügen")
        .plugin(tauri_plugin_dialog::init())
        // Etappe 4: eigene Datei-Befehle (lesen, verschieben, öffnen) – siehe files.rs
        .invoke_handler(tauri::generate_handler![
            files::fs_tree,
            files::fs_list,
            files::fs_exists,
            files::fs_is_dir,
            files::fs_mkdir,
            files::fs_unique_name,
            files::fs_move,
            files::fs_read,
            files::fs_open,
            files::fs_reveal,
            files::fs_write_file,
            files::ensure_desktop_shortcut,
            lt::lt_start,
            lt::lt_stop
        ])
        .build(tauri::generate_context!())
        .expect("Fehler beim Starten von AzuNavi")
        .run(|app, event| {
            // Beim Beenden der App auch LanguageTool beenden
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Some(state) = app.try_state::<lt::LtState>() {
                    if let Ok(mut g) = state.0.lock() {
                        if let Some(mut c) = g.take() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        });
}
