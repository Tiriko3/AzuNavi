// Profile mit Passwort (ab 0.3.0): Verschlüsselung der Daten im Datenordner.
// Nur WebCrypto, keine Abhängigkeiten, keine Browser-Funktionen: läuft auch im Test unter Node.
//
// Aufbau (wie bei einem Passwort-Tresor):
//  - Ein zufälliger Datenschlüssel (DK, 256 Bit) verschlüsselt alle Dateien (AES-256-GCM).
//  - Der DK liegt zweimal verpackt in profil.json: einmal mit dem Passwort (PBKDF2-SHA256, 600.000 Runden),
//    einmal mit dem Wiederherstellungsschlüssel (160 Bit Zufall, HKDF). Das Passwort selbst wird nie gespeichert.
//  - Ob ein Passwort stimmt, zeigt sich daran, ob sich der DK entpacken lässt (AES-GCM prüft das).
//  - Jede Datei ist an ihren Pfad gebunden (AAD): eine verschlüsselte Datei lässt sich nicht unbemerkt austauschen.
//  - Dateinamen und Dateigrößen sind nicht verschlüsselt (nur der Inhalt).
const enc = new TextEncoder(), dec = new TextDecoder();
const bs = (u: Uint8Array) => u as unknown as BufferSource;   // WebCrypto-Typen sind streng

export const PROFILE_FILE = "profil.json";
const MAGIC = enc.encode("AZV1");                 // Dateikopf verschlüsselter Dateien
export const ITER = 600_000;
export const MIN_PASSWORD = 12;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 Zeichen, ohne I, O, 0, 1 (nicht zu verwechseln)

export interface Wrapped { iv: string; ct: string }
export interface ProfileFile {
  v: 1;
  id: string;                    // zufällig, bindet gemerkte Schlüssel und Dateien an dieses Profil
  name: string;
  created: string;
  kdf: { alg: "PBKDF2-SHA256"; iter: number; salt: string };
  wrapPw: Wrapped;               // Datenschlüssel, verpackt mit dem Passwort
  wrapRec: Wrapped & { salt: string };   // Datenschlüssel, verpackt mit dem Wiederherstellungsschlüssel
  check: Wrapped;                // kleiner Prüftext, damit ein gemerkter Schlüssel geprüft werden kann
  legacy?: true;                 // Übernahme alter Daten läuft noch (unverschlüsselte Dateien werden noch gelesen)
}

/* ---------- Hilfen ---------- */
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const hex = (u: Uint8Array) => Array.from(u, (x) => x.toString(16).padStart(2, "0")).join("");
const aad = (id: string, what: string) => bs(enc.encode(`AZV1|${id}|${what}`));

async function seal(key: CryptoKey, plain: Uint8Array, ad: BufferSource): Promise<Wrapped> {
  const iv = rand(12);
  return { iv: b64(iv), ct: b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: ad }, key, bs(plain)))) };
}
const unseal = async (key: CryptoKey, w: Wrapped, ad: BufferSource) =>
  new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(unb64(w.iv)), additionalData: ad }, key, bs(unb64(w.ct))));

async function passwordKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bs(enc.encode(password.normalize("NFC"))), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function recoveryKdf(recoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bs(enc.encode(normalizeRecovery(recoveryKey))), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(enc.encode("azunavi-recovery")) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/* ---------- Wiederherstellungsschlüssel ---------- */
/** 32 Zeichen aus 32 möglichen = 160 Bit, in Vierergruppen: ABCD-EFGH-… */
export function newRecoveryKey(): string {
  const r = rand(32); let s = "";
  for (let i = 0; i < 32; i++) s += ALPHABET[r[i] & 31];   // 256 ist durch 32 teilbar: gleichmäßig verteilt
  return s.match(/.{4}/g)!.join("-");
}
export const normalizeRecovery = (k: string) => k.toUpperCase().replace(/[^A-Z2-9]/g, "");
export const recoveryLooksValid = (k: string) => normalizeRecovery(k).length === 32;

/* ---------- Passwort-Regeln ---------- */
export function passwordProblem(pw: string): string | null {
  if ([...pw].length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (/^(.)\1+$/.test(pw)) return "Das Passwort darf nicht nur aus einem Zeichen bestehen.";
  return null;
}

/* ---------- Profil anlegen und öffnen ---------- */
export async function createProfile(name: string, password: string): Promise<{ profile: ProfileFile; recoveryKey: string; raw: Uint8Array }> {
  const bad = passwordProblem(password); if (bad) throw new Error(bad);
  if (!name.trim()) throw new Error("Bitte gib einen Namen für das Profil ein.");
  const id = hex(rand(16)), raw = rand(32), saltPw = rand(16), saltRec = rand(16), recoveryKey = newRecoveryKey();
  const dk = await toKey(raw);
  const profile: ProfileFile = {
    v: 1, id, name: name.trim(), created: new Date().toISOString(),
    kdf: { alg: "PBKDF2-SHA256", iter: ITER, salt: b64(saltPw) },
    wrapPw: await seal(await passwordKey(password, saltPw, ITER), raw, aad(id, "pw")),
    wrapRec: { salt: b64(saltRec), ...(await seal(await recoveryKdf(recoveryKey, saltRec), raw, aad(id, "rec"))) },
    check: await seal(dk, enc.encode("azunavi"), aad(id, "check")),
  };
  return { profile, recoveryKey, raw };
}

/** Datenschlüssel (roh) mit dem Passwort entpacken. Falsches Passwort → Fehler. */
export async function openWithPassword(p: ProfileFile, password: string): Promise<Uint8Array> {
  if (p.kdf.iter < 100_000 || p.kdf.iter > 5_000_000) throw new Error("Die Profil-Datei ist beschädigt.");
  try { return await unseal(await passwordKey(password, unb64(p.kdf.salt), p.kdf.iter), p.wrapPw, aad(p.id, "pw")); }
  catch { throw new Error("Falsches Passwort."); }
}
export async function openWithRecovery(p: ProfileFile, recoveryKey: string): Promise<Uint8Array> {
  if (!recoveryLooksValid(recoveryKey)) throw new Error("Der Wiederherstellungsschlüssel hat 32 Zeichen (8 Gruppen zu je 4).");
  try { return await unseal(await recoveryKdf(recoveryKey, unb64(p.wrapRec.salt)), p.wrapRec, aad(p.id, "rec")); }
  catch { throw new Error("Falscher Wiederherstellungsschlüssel."); }
}
/** Neues Passwort setzen (mit neuem Salz). Der Datenschlüssel und alle Daten bleiben gleich. */
export async function withNewPassword(p: ProfileFile, raw: Uint8Array, password: string): Promise<ProfileFile> {
  const bad = passwordProblem(password); if (bad) throw new Error(bad);
  const salt = rand(16);
  return { ...p, kdf: { alg: "PBKDF2-SHA256", iter: ITER, salt: b64(salt) }, wrapPw: await seal(await passwordKey(password, salt, ITER), raw, aad(p.id, "pw")) };
}
/** Nicht exportierbarer Schlüssel: kann verschlüsseln, aber seine Bytes nie auslesen */
export const toKey = (raw: Uint8Array) => crypto.subtle.importKey("raw", bs(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
/** Gehört dieser (z. B. auf dem Gerät gemerkte) Schlüssel zu diesem Profil? */
export async function keyMatches(p: ProfileFile, key: CryptoKey): Promise<boolean> {
  try { return dec.decode(await unseal(key, p.check, aad(p.id, "check"))) === "azunavi"; } catch { return false; }
}

export function parseProfile(bytes: Uint8Array): ProfileFile {
  try {
    const p = JSON.parse(dec.decode(bytes)) as ProfileFile;
    if (p.v !== 1 || !p.id || !p.kdf?.salt || !p.wrapPw?.ct || !p.wrapRec?.ct || !p.check?.ct) throw 0;
    return p;
  } catch { throw new Error("Die Profil-Datei (profil.json) ist beschädigt oder stammt aus einer neueren Version."); }
}
export const profileBytes = (p: ProfileFile) => enc.encode(JSON.stringify(p, null, 2));

/* ---------- Dateien ---------- */
export const isVaultFile = (b: Uint8Array) => b.length >= 4 + 12 + 16 && MAGIC.every((v, i) => b[i] === v);
/** Aufbau: "AZV1" (4) | IV (12) | Chiffretext mit Prüfsumme. Der Pfad ist Teil der Prüfung. */
export async function encryptFile(key: CryptoKey, path: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(enc.encode("AZV1:" + path)) }, key, bs(plain)));
  const out = new Uint8Array(16 + ct.length); out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16); return out;
}
export async function decryptFile(key: CryptoKey, path: string, b: Uint8Array): Promise<Uint8Array> {
  if (!isVaultFile(b)) throw new Error("Keine verschlüsselte Datei: " + path);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(b.slice(4, 16)), additionalData: bs(enc.encode("AZV1:" + path)) }, key, bs(b.slice(16)))); }
  catch { throw new Error("Datei lässt sich nicht entschlüsseln (beschädigt oder vertauscht): " + path); }
}
