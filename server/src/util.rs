//! Kleine Helfer: Zeit, Tokens, Hashes und strenge Eingabeprüfung.
use crate::error::AppError;
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn system_now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }

/// 256 Bit Zufall, URL-sicher kodiert (Einladungen und Sitzungs-Tokens)
pub fn random_token() -> String {
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
pub fn random_bytes(n: usize) -> Vec<u8> { let mut b = vec![0u8; n]; rand::rngs::OsRng.fill_bytes(&mut b); b }
pub fn sha256(data: &[u8]) -> Vec<u8> { Sha256::digest(data).to_vec() }
pub fn b64(data: &[u8]) -> String { STANDARD.encode(data) }

/// Base64 mit Längengrenze (schon VOR dem Dekodieren geprüft, damit niemand riesige Eingaben durchschleust)
pub fn b64_decode(s: &str, max_bytes: usize, code: &'static str) -> Result<Vec<u8>, AppError> {
    if s.len() > max_bytes / 3 * 4 + 8 { return Err(AppError::TooLarge(code)); }
    STANDARD.decode(s).map_err(|_| AppError::BadRequest(code)).and_then(|v| if v.len() > max_bytes { Err(AppError::TooLarge(code)) } else { Ok(v) })
}

pub fn valid_username(u: &str) -> bool {
    (3..=32).contains(&u.len()) && u.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'_' || c == b'-')
}
pub fn valid_record_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':' | b'.'))
}
pub fn valid_device_name(n: &str) -> bool {
    (1..=64).contains(&n.chars().count()) && !n.chars().any(|c| c.is_control())
}
/// KDF-Parameter als Text, z. B. "argon2id;m=65536;t=3;p=4". Grenzen verhindern Schwachstellen-Einstellungen vom Client.
pub fn valid_kdf_params(p: &str) -> bool {
    let parts: Vec<&str> = p.split(';').collect();
    if parts.len() != 4 || parts[0] != "argon2id" { return false; }
    let num = |s: &str, key: &str| s.strip_prefix(key).and_then(|v| v.parse::<u32>().ok());
    match (num(parts[1], "m="), num(parts[2], "t="), num(parts[3], "p=")) {
        (Some(m), Some(t), Some(par)) => (32_768..=1_048_576).contains(&m) && (2..=10).contains(&t) && (1..=16).contains(&par),
        _ => false,
    }
}
pub const DEFAULT_KDF_PARAMS: &str = "argon2id;m=65536;t=3;p=4";
