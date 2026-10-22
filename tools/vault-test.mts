// Test der Profil-Verschlüsselung (Node). Start: npx tsx tools/vault-test.mts   (braucht fake-indexeddb, nur zum Testen)
import "fake-indexeddb/auto";
const store = new Map<string, string>();
(globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as any).window = Object.assign(globalThis, { dispatchEvent: () => true, addEventListener: () => {}, clearInterval, setInterval });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Test", storage: { persist: async () => true } }, configurable: true });
(globalThis as any).location = { reload: () => {} };

const V = await import("../src/web/vault");
const D = await import("../src/web/dataStore");
let ok = 0, bad = 0;
const t = async (name: string, f: () => Promise<void> | void) => { try { await f(); ok++; console.log("  ✓", name); } catch (e) { bad++; console.log("  ✗", name, "→", (e as Error).message); } };
const must = (c: boolean, m = "Bedingung falsch") => { if (!c) throw new Error(m); };
const rejects = async (p: Promise<unknown>, part: string) => { try { await p; } catch (e) { must(String((e as Error).message).includes(part), "falsche Meldung: " + (e as Error).message); return; } throw new Error("hätte fehlschlagen müssen"); };
const te = new TextEncoder(), td = new TextDecoder();
const same = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

console.log("vault.ts");
const { profile, recoveryKey, raw } = await V.createProfile("Test Azubi", "korrektes-pferd-batterie");
await t("Recovery-Schlüssel: 8 Gruppen à 4, nur erlaubte Zeichen", () => must(/^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/.test(recoveryKey)));
await t("Passwort öffnet den Datenschlüssel", async () => must(same(await V.openWithPassword(profile, "korrektes-pferd-batterie"), raw)));
await t("falsches Passwort wird abgelehnt", () => rejects(V.openWithPassword(profile, "korrektes-pferd-batteriE"), "Falsches Passwort"));
await t("Recovery-Schlüssel öffnet (auch klein geschrieben, ohne Striche)", async () => must(same(await V.openWithRecovery(profile, recoveryKey.toLowerCase().replace(/-/g, " ")), raw)));
await t("falscher Recovery-Schlüssel wird abgelehnt", () => rejects(V.openWithRecovery(profile, V.newRecoveryKey()), "Falscher"));
await t("zu kurzes Passwort wird abgelehnt", () => rejects(V.createProfile("x", "kurz"), "mindestens"));
await t("leerer Name wird abgelehnt", () => rejects(V.createProfile("  ", "korrektes-pferd-batterie"), "Namen"));
const key = await V.toKey(raw);
await t("Schlüsselprüfung: richtiger Schlüssel ja, fremder nein", async () => { must(await V.keyMatches(profile, key)); must(!(await V.keyMatches(profile, await V.toKey(crypto.getRandomValues(new Uint8Array(32)))))); });
await t("Datenschlüssel ist nicht exportierbar", () => rejects(crypto.subtle.exportKey("raw", key), ""));
const plain = te.encode("Geheime Notiz ä ö ü €");
const e1 = await V.encryptFile(key, "azunavi.db", plain), e2 = await V.encryptFile(key, "azunavi.db", plain);
await t("Datei: Rundlauf, Kennung, jedes Mal anderer Chiffretext", async () => { must(V.isVaultFile(e1)); must(!same(e1, e2)); must(td.decode(await V.decryptFile(key, "azunavi.db", e1)) === td.decode(plain)); });
await t("Datei: Klartext steht nicht im Chiffretext", () => must(!td.decode(e1).includes("Geheime")));
await t("Datei unter anderem Pfad wird abgelehnt (Austausch)", () => rejects(V.decryptFile(key, "dateien/x.png", e1), "vertauscht"));
await t("manipulierte Datei wird abgelehnt", async () => { const m = e1.slice(); m[m.length - 1] ^= 1; await rejects(V.decryptFile(key, "azunavi.db", m), "entschlüsseln"); });
await t("leere Datei geht", async () => must((await V.decryptFile(key, "a", await V.encryptFile(key, "a", new Uint8Array(0)))).length === 0));
await t("1 MB Datei geht", async () => { const big = new Uint8Array(1 << 20); for (let i = 0; i < big.length; i += 65536) crypto.getRandomValues(big.subarray(i, i + 65536)); must(same(await V.decryptFile(key, "b", await V.encryptFile(key, "b", big)), big)); });
await t("neues Passwort: altes tot, neues gilt, Daten gleich", async () => {
  const p2 = await V.withNewPassword(profile, raw, "ganz-anderes-passwort");
  await rejects(V.openWithPassword(p2, "korrektes-pferd-batterie"), "Falsches"); must(same(await V.openWithPassword(p2, "ganz-anderes-passwort"), raw));
  must(same(await V.openWithRecovery(p2, recoveryKey), raw));
});
await t("kaputte Profil-Datei wird erkannt", () => { try { V.parseProfile(te.encode("{}")); } catch { return; } throw new Error("nicht erkannt"); });
await t("Profil-Datei enthält weder Passwort noch Schlüssel im Klartext", () => { const j = td.decode(V.profileBytes(profile)); must(!j.includes("korrektes") && !j.includes(Buffer.from(raw).toString("base64")) && !j.includes(recoveryKey)); });
await t("manipulierte Rundenzahl wird abgelehnt", () => rejects(V.openWithPassword({ ...profile, kdf: { ...profile.kdf, iter: 1 } }, "korrektes-pferd-batterie"), "beschädigt"));

console.log("dataStore (Browser-Speicher, Ersatz-IndexedDB)");
const id = await D.addBrowser(); await D.resumeLocation(id);
const dbBytes = te.encode("SQLite-Daten-alt"), pic = te.encode("PNGBILD");
await D.writeData("azunavi.db", dbBytes); await D.writeData("dateien/anhang/foto.png", pic);
await t("ohne Profil: Klartext im Speicher, listFiles sieht beide", async () => { must(same(await D.readRaw("azunavi.db"), dbBytes)); must((await D.listFiles()).length === 2); });
const setup = await V.createProfile("Mein Profil", "ein-sehr-langes-passwort");
await D.activateNewProfile(setup.profile, setup.raw);
await t("Übernahme: alte Dateien sind jetzt verschlüsselt, Lesen liefert Klartext", async () => {
  must(V.isVaultFile((await D.readRaw("azunavi.db"))!)); must(V.isVaultFile((await D.readRaw("dateien/anhang/foto.png"))!));
  must(same(await D.readData("azunavi.db"), dbBytes)); must(same(await D.readData("dateien/anhang/foto.png"), pic));
});
await t("profil.json ist ohne legacy-Marke gespeichert", async () => { const p = await D.readProfile(); must(!!p && !p.legacy && p.name === "Mein Profil"); });
await t("neue Datei wird verschlüsselt geschrieben", async () => { await D.writeData("azunavi.db", te.encode("neu")); must(V.isVaultFile((await D.readRaw("azunavi.db"))!)); must(td.decode((await D.readData("azunavi.db"))!) === "neu"); });
await t("fehlende Datei → null", async () => must((await D.readData("gibt-es-nicht")) === null));
await t("Sperrdatei und Profil-Datei bleiben Klartext (auch über writeData)", async () => { await D.writeData("azunavi.lock", te.encode('{"ts":1}')); must(td.decode((await D.readRaw("azunavi.lock"))!) === '{"ts":1}'); must(td.decode((await D.readRaw("profil.json"))!).includes("wrapPw")); });
// gesperrt
const prof = (await D.readProfile())!;
D.setSecure(prof, null);
await t("gesperrt: Lesen und Schreiben schlagen fehl", async () => { await rejects(D.readData("azunavi.db"), "gesperrt"); await rejects(D.writeData("azunavi.db", dbBytes), "gesperrt"); });
await t("falsches Passwort entsperrt nicht", () => rejects(D.unlockWithPassword(prof, "ein-sehr-langes-passwortX"), "Falsches"));
await t("richtiges Passwort entsperrt", async () => { await D.unlockWithPassword(prof, "ein-sehr-langes-passwort"); must(td.decode((await D.readData("azunavi.db"))!) === "neu"); });
await t("Klartext-Datei im geschützten Ordner wird NICHT gelesen (Austausch-Angriff)", async () => { await D.writeRaw("azunavi.db", te.encode("EINGESCHMUGGELT")); await rejects(D.readData("azunavi.db"), "nicht verschlüsselt"); });
await D.writeData("azunavi.db", te.encode("wieder-gut"));
await t("Datei einer anderen Stelle hineinkopiert wird abgelehnt", async () => { await D.writeRaw("azunavi.db", (await D.readRaw("dateien/anhang/foto.png"))!); await rejects(D.readData("azunavi.db"), "vertauscht"); });
await D.writeData("azunavi.db", te.encode("wieder-gut"));
await t("Gerät merken: nach Sperre öffnet der gemerkte Schlüssel", async () => {
  await D.rememberDevice(true); must(await D.isRemembered());
  D.setSecure(prof, null); must(await D.unlockRemembered(prof)); must(td.decode((await D.readData("azunavi.db"))!) === "wieder-gut");
});
await t("Gerät vergessen: gemerkter Schlüssel ist weg", async () => { await D.rememberDevice(false); D.setSecure(prof, null); must(!(await D.unlockRemembered(prof))); });
await t("Passwort vergessen: Wiederherstellung setzt neues Passwort, Daten bleiben", async () => {
  const p = (await D.readProfile())!; D.setSecure(p, null);
  await rejects(D.recoverWithKey(p, V.newRecoveryKey(), "neues-passwort-123"), "Falscher");
  await D.recoverWithKey(p, setup.recoveryKey, "neues-passwort-123");
  const p2 = (await D.readProfile())!; D.setSecure(p2, null);
  await rejects(D.unlockWithPassword(p2, "ein-sehr-langes-passwort"), "Falsches");
  await D.unlockWithPassword(p2, "neues-passwort-123"); must(td.decode((await D.readData("azunavi.db"))!) === "wieder-gut");
});
await t("Passwort ändern im Betrieb", async () => {
  await rejects(D.changePassword("falsch-falsch-falsch", "noch-ein-passwort-1"), "Falsches");
  await D.changePassword("neues-passwort-123", "noch-ein-passwort-1");
  const p = (await D.readProfile())!; D.setSecure(p, null); await D.unlockWithPassword(p, "noch-ein-passwort-1");
});
await t("angefangene Übernahme wird beim nächsten Start fortgesetzt", async () => {
  const p = (await D.readProfile())!; await D.writeRaw("dateien/spaet.png", te.encode("SPAET"));
  await D.writeRaw("profil.json", V.profileBytes({ ...p, legacy: true })); D.setSecure({ ...p, legacy: true }, null);
  await D.unlockWithPassword({ ...p, legacy: true }, "noch-ein-passwort-1");
  must(td.decode((await D.readData("dateien/spaet.png"))!) === "SPAET");   // Klartext wird im Übergang noch gelesen
  await D.finishMigration();
  must(V.isVaultFile((await D.readRaw("dateien/spaet.png"))!)); must(!(await D.readProfile())!.legacy);
});
await t("ohne Passwort-Datenbank: ohne Profil läuft alles wie vorher", async () => { D.setSecure(null, null); await D.writeData("x.bin", te.encode("klar")); must(td.decode((await D.readRaw("x.bin"))!) === "klar"); });
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`); process.exit(bad ? 1 : 0);
