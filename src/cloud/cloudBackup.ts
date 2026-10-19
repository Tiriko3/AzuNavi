// Sicherung im eigenen Cloud-Speicher (OneDrive, Google Drive, Nextcloud …): AzuNavi betreibt dafür keinen Server.
// Die Sicherung (ZIP) wird vorher mit einem Passwort verschlüsselt: AES-256-GCM, Schlüssel per PBKDF2-SHA256 (600.000 Runden).
// Dateiaufbau: "AZNAVI1\n" (8) | Runden (4, big-endian) | Salz (16) | IV (12) | Chiffretext mit Prüfsumme
const MAGIC = new TextEncoder().encode("AZNAVI1\n");
const ITER = 600_000;
/** WebCrypto erwartet BufferSource; neuere TypeScript-Typen unterscheiden hier streng */
const bs = (u: Uint8Array) => u as unknown as BufferSource;
export const CLOUD_PREFIX = "AzuNavi-Sicherung";

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bs(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function isEncrypted(b: Uint8Array): boolean {
  return b.length > 40 && MAGIC.every((v, i) => b[i] === v);
}

export async function encryptBackup(zip: Uint8Array, password: string): Promise<Uint8Array> {
  if (password.length < 10) throw new Error("Das Passwort braucht mindestens 10 Zeichen.");
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(MAGIC) }, key, bs(zip)));
  const out = new Uint8Array(8 + 4 + 16 + 12 + ct.length);
  out.set(MAGIC, 0); new DataView(out.buffer).setUint32(8, ITER); out.set(salt, 12); out.set(iv, 28); out.set(ct, 40);
  return out;
}

export async function decryptBackup(b: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncrypted(b)) throw new Error("Das ist keine verschlüsselte AzuNavi-Sicherung.");
  const iter = new DataView(b.buffer, b.byteOffset).getUint32(8);
  if (iter < 100_000 || iter > 5_000_000) throw new Error("Die Datei ist beschädigt.");   // schützt vor manipulierten Dateien
  const key = await deriveKey(password, b.slice(12, 28), iter);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(b.slice(28, 40)), additionalData: bs(MAGIC) }, key, bs(b.slice(40)))); }
  catch { throw new Error("Falsches Passwort oder beschädigte Datei."); }
}

export function backupName(encrypted: boolean, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${CLOUD_PREFIX}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${encrypted ? "azb" : "zip"}`;
}
