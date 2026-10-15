// Im Release-Build kein zusätzliches Konsolenfenster unter Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    persona_app_lib::run()
}
