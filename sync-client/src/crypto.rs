//! Alles, was mit Schlüsseln zu tun hat. Nur geprüfte Bibliotheken (RustCrypto), keine eigenen Verfahren.
//! Aufbau: Passwort --Argon2id--> master --HKDF--> (Login-Wert für den Server, Schlüssel-Schlüssel kek)
//!         Datenschlüssel DK (zufällig) wird mit kek und mit dem Wiederherstellungsschlüssel verpackt.
use crate::Error;
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;

/// Mindestwerte, die die App akzeptiert – auch wenn ein (manipulierter) Server schwächere vorschlägt
pub const MIN_M: u32 = 65_536;
pub const MIN_T: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KdfParams { pub m: u32, pub t: u32, pub p: u32 }
impl KdfParams {
    pub const DEFAULT: KdfParams = KdfParams { m: 65_536, t: 3, p: 4 };
    pub fn parse(s: &str) -> Result<Self, Error> {
        let parts: Vec<&str> = s.split(';').collect();
        let num = |s: &str, k: &str| s.strip_prefix(k).and_then(|v| v.parse::<u32>().ok());
        if parts.len() != 4 || parts[0] != "argon2id" { return Err(Error::Insecure("unbekanntes Verfahren")); }
        let (m, t, p) = (num(parts[1], "m="), num(parts[2], "t="), num(parts[3], "p="));
        match (m, t, p) {
            (Some(m), Some(t), Some(p)) if (MIN_M..=1_048_576).contains(&m) && (MIN_T..=10).contains(&t) && (1..=16).contains(&p) => Ok(Self { m, t, p }),
            (Some(_), Some(_), Some(_)) => Err(Error::Insecure("zu schwache Schlüssel-Parameter vom Server")),
            _ => Err(Error::Insecure("ungültige Schlüssel-Parameter")),
        }
    }
    pub fn to_param_string(self) -> String { format!("argon2id;m={};t={};p={}", self.m, self.t, self.p) }
}

pub fn random_key() -> Key { let mut k = Zeroizing::new([0u8; 32]); rand::rngs::OsRng.fill_bytes(&mut *k); k }
pub fn random_salt() -> Vec<u8> { let mut s = vec![0u8; 16]; rand::rngs::OsRng.fill_bytes(&mut s); s }

fn hkdf32(ikm: &[u8], info: &[u8]) -> Key {
    let mut out = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(None, ikm).expand(info, &mut *out).expect("32 Bytes sind immer erlaubt");
    out
}

/// Aus dem Passwort: Login-Wert (Base64, geht an den Server) und kek (bleibt hier)
pub struct PasswordKeys { pub auth_b64: Zeroizing<String>, pub kek: Key }
pub fn derive_password_keys(password: &str, salt: &[u8], p: KdfParams) -> Result<PasswordKeys, Error> {
    let params = Params::new(p.m, p.t, p.p, Some(64)).map_err(|_| Error::Crypto)?;
    let mut master = Zeroizing::new([0u8; 64]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params).hash_password_into(password.as_bytes(), salt, &mut *master).map_err(|_| Error::Crypto)?;
    let auth = hkdf32(&*master, b"azunavi-auth-v1");
    Ok(PasswordKeys { auth_b64: Zeroizing::new(STANDARD.encode(*auth)), kek: hkdf32(&*master, b"azunavi-kek-v1") })
}

/// Verschlüsseln: Nonce (24 Bytes, zufällig) || Chiffretext mit Prüfsumme. aad bindet den Inhalt an seinen Zweck (z. B. Datensatz-ID).
pub fn seal(key: &[u8; 32], plain: &[u8], aad: &[u8]) -> Vec<u8> {
    let mut nonce = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ct = XChaCha20Poly1305::new(key.into()).encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad }).expect("Verschlüsseln schlägt nicht fehl");
    let mut out = nonce.to_vec(); out.extend_from_slice(&ct); out
}
/// Entschlüsseln. Jede Veränderung (auch ein vertauschter Datensatz) fällt hier auf.
pub fn open(key: &[u8; 32], blob: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, Error> {
    if blob.len() < 24 + 16 { return Err(Error::Tampered); }
    let (n, ct) = blob.split_at(24);
    XChaCha20Poly1305::new(key.into()).decrypt(XNonce::from_slice(n), Payload { msg: ct, aad }).map(Zeroizing::new).map_err(|_| Error::Tampered)
}

const DK_AAD: &[u8] = b"azunavi-dk-v1";
pub fn wrap_dk(wrapping: &[u8; 32], dk: &[u8; 32]) -> Vec<u8> { seal(wrapping, dk, DK_AAD) }
pub fn unwrap_dk(wrapping: &[u8; 32], blob: &[u8]) -> Result<Key, Error> {
    let v = open(wrapping, blob, DK_AAD)?;
    if v.len() != 32 { return Err(Error::Tampered); }
    let mut k = Zeroizing::new([0u8; 32]); k.copy_from_slice(&v); Ok(k)
}

/// Wiederherstellungsschlüssel: 32 Zufallsbytes, für Menschen als Base32 in Vierergruppen
pub struct RecoveryKey(pub Key);
impl RecoveryKey {
    pub fn generate() -> Self { Self(random_key()) }
    pub fn display(&self) -> Zeroizing<String> {
        let s = data_encoding::BASE32_NOPAD.encode(&*self.0);
        Zeroizing::new(s.as_bytes().chunks(4).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("-"))
    }
    pub fn parse(s: &str) -> Result<Self, Error> {
        let clean: Zeroizing<String> = Zeroizing::new(s.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>().to_uppercase());
        let v = Zeroizing::new(data_encoding::BASE32_NOPAD.decode(clean.as_bytes()).map_err(|_| Error::BadInput("Wiederherstellungsschlüssel unvollständig oder falsch abgetippt"))?);
        if v.len() != 32 { return Err(Error::BadInput("Wiederherstellungsschlüssel hat die falsche Länge")); }
        let mut k = Zeroizing::new([0u8; 32]); k.copy_from_slice(&v); Ok(Self(k))
    }
    pub fn wrapping_key(&self) -> Key { hkdf32(&*self.0, b"azunavi-rec-v1") }
    pub fn auth_b64(&self) -> Zeroizing<String> { Zeroizing::new(STANDARD.encode(*hkdf32(&*self.0, b"azunavi-rec-auth-v1"))) }
}
