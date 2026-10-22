// AzuNavi: das Rust-Gerüst ist bewusst klein.
mod files;
mod lt;
// Datenordner und Profile (ab 0.4.0): nur am PC. Android bleibt wie bisher (Umstellung in einer späteren Version).
#[cfg(desktop)]
mod data_cmds;
#[cfg(desktop)]
mod datadir;

// Datenbank (SQLite) läuft über das offizielle Tauri-SQL-Plugin,
// Tabellen und Migrationen liegen im Frontend (src/db/migrations.ts).
// Dateien (Anhänge, Porträts) laufen über die Plugins fs und dialog.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(lt::LtState(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Dateien: Bilder werden in den App-Ordner kopiert und von dort gelesen
        .plugin(tauri_plugin_fs::init())
        // Dateiauswahl-Fenster ("Bild hinzufügen")
        .plugin(tauri_plugin_dialog::init());

    // PC: eigene Datei-Befehle (files.rs) und Datenordner (data_cmds.rs)
    #[cfg(desktop)]
    let builder = builder.manage(data_cmds::DataState::default()).invoke_handler(tauri::generate_handler![
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
        lt::lt_stop,
        data_cmds::data_locations,
        data_cmds::data_pick_folder,
        data_cmds::data_open,
        data_cmds::data_close,
        data_cmds::data_forget,
        data_cmds::data_read,
        data_cmds::data_write,
        data_cmds::data_list,
        data_cmds::data_remove_lock,
        data_cmds::legacy_info,
        data_cmds::legacy_backup
    ]);
    // Handy: wie bisher, ohne die neuen Datenordner-Befehle
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
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
    ]);

    builder
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
