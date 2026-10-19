//! Einfacher Zähler pro Schlüssel (Festes Zeitfenster). Liegt im Arbeitsspeicher, nach Neustart wieder leer.
use std::{collections::HashMap, sync::Mutex};

pub struct Limiter { map: Mutex<HashMap<String, (i64, u32)>> }
const MAX_KEYS: usize = 100_000;

impl Default for Limiter { fn default() -> Self { Self::new() } }

impl Limiter {
    pub fn new() -> Self { Self { map: Mutex::new(HashMap::new()) } }
    /// Ok(()) = erlaubt. Err(sekunden) = zu viele Anfragen, so lange warten.
    pub fn check(&self, key: &str, limit: u32, window_secs: i64, now: i64) -> Result<(), u64> {
        let mut m = self.map.lock().unwrap_or_else(|e| e.into_inner());
        if m.len() > MAX_KEYS { m.retain(|_, (start, _)| now - *start < 3600); }   // Speicher begrenzen
        if m.len() > MAX_KEYS { return Err(60); }                                    // Notbremse bei Flut
        let e = m.entry(key.to_string()).or_insert((now, 0));
        if now - e.0 >= window_secs { *e = (now, 0); }
        if e.1 >= limit { return Err((window_secs - (now - e.0)).max(1) as u64); }
        e.1 += 1;
        Ok(())
    }
}
