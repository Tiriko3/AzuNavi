// Datenordner (ab 0.4.0): Kern ohne Tauri, nur Standardbibliothek. Dadurch lässt sich diese Datei allein übersetzen und testen
// (rustc --test datadir.rs). Die Tauri-Befehle, die diese Funktionen aufrufen, stehen in data_cmds.rs.
//
// Regeln (Sicherheit):
//  - Gelesen, geschrieben und aufgelistet wird NUR, was AzuNavi selbst anlegt: azunavi.db, profil.json, azunavi.lock
//    und alles unter dateien/. Fremde Dateien im gewählten Ordner (z. B. ein ganzer OneDrive) bleiben unberührt.
//  - Pfade kommen immer relativ zum Datenordner an, mit „/“. Kein „..“, kein „.“, keine leeren Teile, kein Laufwerk,
//    kein Backslash, keine Windows-Sonderzeichen oder -Gerätenamen (CON, NUL, COM1 …), kein Punkt oder Leerzeichen am Ende.
//  - Verknüpfungen (Symlinks, Junctions) werden nie verfolgt. Zusätzlich muss der tiefste vorhandene Ordner des Ziels
//    (kanonisch) im Datenordner liegen.
//  - Schreiben ist atomar: erst in eine Temp-Datei im selben Ordner, auf die Platte zwingen, dann umbenennen.
//    Hält OneDrive oder ein Virenscanner die Datei kurz fest, wird das Umbenennen mehrfach versucht.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const DB_FILE: &str = "azunavi.db";
pub const PROFILE_FILE: &str = "profil.json";
pub const LOCK_FILE: &str = "azunavi.lock";
pub const FILES_DIR: &str = "dateien";
/// Endung der Temp-Dateien beim Schreiben. Solche Dateien werden nie aufgelistet und nie als Pfad angenommen.
pub const TMP_SUFFIX: &str = ".azunavi-tmp";
/// Fehlertext, den das Frontend erkennt: „gibt es nicht“ (kein echter Fehler)
pub const NOT_FOUND: &str = "NICHT_GEFUNDEN";
/// Größte Datei, die auf einmal gelesen wird
pub const MAX_READ: u64 = 512 * 1024 * 1024;

const MAX_REL: usize = 400;
const MAX_PART: usize = 200;
const MAX_DEPTH: usize = 24;

/* ---------- Pfadregeln ---------- */

fn reserved_name(part: &str) -> bool {
    // Windows behandelt „CON“, „con.txt“ und „CON.“ gleich als Gerät. Maßgeblich ist der Teil vor dem ersten Punkt.
    let stem = part.split('.').next().unwrap_or("").trim_end_matches(' ').to_uppercase();
    match stem.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" => return true,
        _ => {}
    }
    let b: Vec<char> = stem.chars().collect();
    if b.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) {
        let d = b[3];
        // 1–9 und die hochgestellten Ziffern ¹ ² ³, die Windows ebenfalls als Gerät behandelt
        return ('1'..='9').contains(&d) || d == '¹' || d == '²' || d == '³';
    }
    false
}

fn check_part(part: &str) -> Result<(), String> {
    if part.is_empty() || part == "." || part == ".." {
        return Err("Ungültiger Pfad.".into());
    }
    if part.chars().count() > MAX_PART {
        return Err("Ein Name im Pfad ist zu lang.".into());
    }
    if part.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}' || "<>:\"|?*\\/".contains(c)) {
        return Err("Der Pfad enthält ein unerlaubtes Zeichen.".into());
    }
    if part.ends_with('.') || part.ends_with(' ') {
        return Err("Ein Name im Pfad darf nicht mit Punkt oder Leerzeichen enden.".into());
    }
    if reserved_name(part) {
        return Err("Dieser Name ist unter Windows für Geräte reserviert.".into());
    }
    if part.ends_with(TMP_SUFFIX) {
        return Err("Dieser Name ist für Zwischendateien reserviert.".into());
    }
    Ok(())
}

/// Prüft einen relativen Pfad und gibt seine Teile zurück. Fehler = Pfad ablehnen.
pub fn check_rel(rel: &str) -> Result<Vec<&str>, String> {
    if rel.is_empty() || rel.len() > MAX_REL {
        return Err("Ungültiger Pfad.".into());
    }
    if rel.starts_with('/') || rel.ends_with('/') {
        return Err("Ungültiger Pfad.".into());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > MAX_DEPTH {
        return Err("Der Pfad ist zu tief.".into());
    }
    for p in &parts {
        check_part(p)?;
    }
    Ok(parts)
}

/// Nur diese Pfade gehören AzuNavi: die drei Dateien im Hauptordner und alles unter dateien/
pub fn is_app_path(rel: &str) -> bool {
    rel == DB_FILE || rel == PROFILE_FILE || rel == LOCK_FILE || (rel.starts_with("dateien/") && rel.len() > "dateien/".len())
}

/// Vollständig geprüfter Pfad im Datenordner. `make_dirs`: fehlende Unterordner anlegen (nur zum Schreiben).
pub fn resolve(root: &Path, rel: &str, make_dirs: bool) -> Result<PathBuf, String> {
    if !is_app_path(rel) {
        return Err("Dieser Pfad gehört nicht zu AzuNavi.".into());
    }
    let parts = check_rel(rel)?;
    let canon_root = root.canonicalize().map_err(|e| format!("Datenordner nicht erreichbar: {e}"))?;
    let mut cur = canon_root.clone();
    for (i, part) in parts.iter().enumerate() {
        cur.push(part);
        let last = i + 1 == parts.len();
        match fs::symlink_metadata(&cur) {
            Ok(m) => {
                if m.file_type().is_symlink() {
                    return Err("Verknüpfungen im Datenordner werden nicht verfolgt.".into());
                }
                if !last && !m.is_dir() {
                    return Err("Im Pfad steckt eine Datei, wo ein Ordner sein müsste.".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if last {
                    break;
                }
                if make_dirs {
                    fs::create_dir(&cur).map_err(|e| format!("Ordner konnte nicht angelegt werden: {e}"))?;
                } else {
                    return Err(NOT_FOUND.into());
                }
            }
            Err(e) => return Err(format!("Zugriff nicht möglich: {e}")),
        }
    }
    // cur ist jetzt der volle Zielpfad (jeder Teil wurde einzeln angehängt; nur der letzte darf noch fehlen)
    ensure_inside(&canon_root, &cur)?;
    Ok(cur)
}

/// Zweite Sicherung: der tiefste vorhandene Ordner des Ziels muss (kanonisch) im Datenordner liegen
fn ensure_inside(canon_root: &Path, target: &Path) -> Result<(), String> {
    let mut p = target.to_path_buf();
    loop {
        if fs::symlink_metadata(&p).is_ok() {
            break;
        }
        if !p.pop() {
            return Err("Pfad liegt außerhalb des Datenordners.".into());
        }
    }
    let canon = p.canonicalize().map_err(|e| format!("Zugriff nicht möglich: {e}"))?;
    if canon.starts_with(canon_root) {
        Ok(())
    } else {
        Err("Pfad liegt außerhalb des Datenordners.".into())
    }
}

/* ---------- Lesen, Schreiben, Auflisten ---------- */

pub fn read_file(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let path = resolve(root, rel, false)?;
    let meta = match fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(NOT_FOUND.into()),
        Err(e) => return Err(format!("Datei kann nicht gelesen werden: {e}")),
    };
    if !meta.is_file() {
        return Err("Das ist keine Datei.".into());
    }
    if meta.len() > MAX_READ {
        return Err("Die Datei ist zu groß.".into());
    }
    let mut f = File::open(&path).map_err(|e| format!("Datei kann nicht gelesen werden: {e}"))?;
    let mut buf = Vec::with_capacity(meta.len() as usize);
    f.read_to_end(&mut buf).map_err(|e| format!("Datei kann nicht gelesen werden: {e}"))?;
    Ok(buf)
}

static COUNTER: AtomicU64 = AtomicU64::new(0);
fn unique() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:x}{:x}", std::process::id(), t, n)
}

/// Atomar schreiben: Temp-Datei im selben Ordner, auf die Platte zwingen, dann über das Ziel umbenennen.
/// Ersetzt eine vorhandene Datei. Prüft NICHT, ob der Pfad im Datenordner liegt (das macht `write_file`).
pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if target.is_dir() {
        return Err("Am Ziel liegt ein Ordner.".into());
    }
    let dir = target.parent().ok_or("Ungültiger Pfad.")?;
    let name = target.file_name().ok_or("Ungültiger Pfad.")?.to_string_lossy().to_string();
    let mut tmp = dir.join(format!("{name}.{}{TMP_SUFFIX}", unique()));
    let mut file = None;
    for _ in 0..5 {
        match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => {
                file = Some(f);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => tmp = dir.join(format!("{name}.{}{TMP_SUFFIX}", unique())),
            Err(e) => return Err(format!("Speichern fehlgeschlagen: {e}")),
        }
    }
    let mut f = file.ok_or("Speichern fehlgeschlagen: keine freie Zwischendatei.")?;
    let wrote = f.write_all(bytes).and_then(|_| f.flush()).and_then(|_| f.sync_all());
    drop(f);
    if let Err(e) = wrote {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Speichern fehlgeschlagen: {e}"));
    }
    let mut last = None;
    for i in 0..6u64 {
        match fs::rename(&tmp, target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(40 * (i + 1)));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(format!("Speichern fehlgeschlagen (die Datei ist gerade gesperrt?): {}", last.map(|e| e.to_string()).unwrap_or_default()))
}

pub fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let path = resolve(root, rel, true)?;
    write_atomic(&path, bytes)
}

/// Alle Dateien, die AzuNavi gehören (Pfade mit „/“, sortiert). Fremde Dateien, Verknüpfungen und Zwischendateien fehlen.
pub fn list_app_files(root: &Path) -> Result<Vec<String>, String> {
    let canon = root.canonicalize().map_err(|e| format!("Datenordner nicht erreichbar: {e}"))?;
    let mut out = Vec::new();
    for top in [DB_FILE, PROFILE_FILE, LOCK_FILE] {
        if let Ok(m) = fs::symlink_metadata(canon.join(top)) {
            if m.is_file() {
                out.push(top.to_string());
            }
        }
    }
    fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<String>) {
        if depth > MAX_DEPTH {
            return;
        }
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if check_part(&name).is_err() {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let rel = format!("{prefix}/{name}");
            if ft.is_dir() {
                walk(&e.path(), &rel, depth + 1, out);
            } else if ft.is_file() {
                out.push(rel);
            }
        }
    }
    let files = canon.join(FILES_DIR);
    if fs::symlink_metadata(&files).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false) {
        walk(&files, FILES_DIR, 1, &mut out);
    }
    out.sort();
    Ok(out)
}

/// Nur die Sperrdatei entfernen (beim sauberen Beenden). Gibt es sie nicht, ist das in Ordnung.
pub fn remove_lock(root: &Path) -> Result<(), String> {
    let path = resolve(root, LOCK_FILE, false)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Sperre konnte nicht entfernt werden: {e}")),
    }
}

/// Kann in diesem Ordner geschrieben werden? (legt eine Zwischendatei an und löscht sie wieder)
pub fn probe_writable(root: &Path) -> Result<(), String> {
    let p = root.join(format!("azunavi-probe-{}{TMP_SUFFIX}", unique()));
    let r = OpenOptions::new().write(true).create_new(true).open(&p).and_then(|mut f| f.write_all(b"ok"));
    let _ = fs::remove_file(&p);
    r.map_err(|e| format!("In diesen Ordner kann nicht geschrieben werden: {e}"))
}

/* ---------- Sicherungskopie der alten Datenbank ---------- */

/// Zwei Dateien Byte für Byte vergleichen
pub fn files_equal(a: &Path, b: &Path) -> Result<bool, String> {
    let (ma, mb) = (fs::metadata(a).map_err(|e| e.to_string())?, fs::metadata(b).map_err(|e| e.to_string())?);
    if ma.len() != mb.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (File::open(a).map_err(|e| e.to_string())?, File::open(b).map_err(|e| e.to_string())?);
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let na = read_full(&mut fa, &mut ba).map_err(|e| e.to_string())?;
        let nb = read_full(&mut fb, &mut bb).map_err(|e| e.to_string())?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}
fn read_full(f: &mut File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        let k = f.read(&mut buf[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    Ok(n)
}

/// Kopie anlegen, die nie etwas überschreibt, und danach Byte für Byte prüfen. Bei einem Fehler wird die Kopie wieder entfernt.
pub fn copy_verified(src: &Path, dst: &Path) -> Result<u64, String> {
    if dst.exists() {
        return Err(format!("Die Sicherungsdatei gibt es schon: {}", dst.display()));
    }
    let n = fs::copy(src, dst).map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
    match files_equal(src, dst) {
        Ok(true) => Ok(n),
        Ok(false) => {
            let _ = fs::remove_file(dst);
            Err("Die Sicherungskopie stimmt nicht mit dem Original überein.".into())
        }
        Err(e) => {
            let _ = fs::remove_file(dst);
            Err(format!("Die Sicherungskopie ließ sich nicht prüfen: {e}"))
        }
    }
}

/* ---------- Kleine Hilfen ---------- */

/// Pfad ohne das „\\?\“-Vorzeichen, das Windows beim Kanonisieren davorsetzt (nur zur Anzeige)
pub fn display_str(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p.to_string()
    }
}
pub fn display_path(p: &Path) -> String {
    display_str(&p.to_string_lossy())
}

/// Prozent-Kodierung rückgängig machen (das Frontend schickt den Pfad mit encodeURIComponent im Header)
pub fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return Err("Ungültiger Pfad.".into());
            }
            let h = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|_| "Ungültiger Pfad.")?;
            out.push(u8::from_str_radix(h, 16).map_err(|_| "Ungültiger Pfad.")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Ungültiger Pfad.".into())
}

/// Zeitstempel fürs Sichern: nur Ziffern und Bindestrich
pub fn valid_stamp(s: &str) -> bool {
    (8..=24).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let p = std::env::temp_dir().join(format!("azunavi-test-{tag}-{}", unique()));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn p(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn gute_pfade() {
        for ok in ["azunavi.db", "profil.json", "dateien/attachments/1700000_0_bild.png", "dateien/portraits/ä_ö_ü_Straße.webp", "dateien/templates/vorlage.docx", "dateien/a b/c d.txt"] {
            assert!(check_rel(ok).is_ok(), "sollte gehen: {ok}");
        }
    }

    #[test]
    fn schlechte_pfade() {
        let long = format!("dateien/{}", "a".repeat(300));
        let deep = format!("dateien/{}", vec!["a"; 40].join("/"));
        let bad = [
            "", "/etc/passwd", "dateien/", "../x", "dateien/../x", "dateien/./x", "dateien//x", "C:/x", "dateien/C:", "dateien\\x", "dateien/a\\b",
            "dateien/a:b", "dateien/CON", "dateien/con.txt", "dateien/NUL.", "dateien/Aux.png", "dateien/COM1.png", "dateien/lpt9", "dateien/COM¹", "dateien/x ", "dateien/x.",
            "dateien/..", "dateien/.. /x", "dateien/...", "dateien/a?b", "dateien/a*b", "dateien/a<b", "dateien/a|b", "dateien/a\"b", "dateien/a\u{0}b", "dateien/a\nb",
            "dateien/x.azunavi-tmp", &long, &deep,
        ];
        for b in bad {
            assert!(check_rel(b).is_err(), "sollte abgelehnt werden: {b:?}");
        }
    }

    #[test]
    fn nur_eigene_dateien() {
        assert!(is_app_path("azunavi.db") && is_app_path("profil.json") && is_app_path("azunavi.lock") && is_app_path("dateien/x"));
        for no in ["dateien", "dateien/", "desktop.ini", "andere/x", "azunavi.db.bak", "Dateien/x", "azunavi.db/x"] {
            assert!(!is_app_path(no), "{no}");
        }
        let t = Tmp::new("fremd");
        assert!(write_file(t.p(), "desktop.ini", b"x").is_err());
        assert!(read_file(t.p(), "../x").is_err());
    }

    #[test]
    fn schreiben_lesen_ersetzen() {
        let t = Tmp::new("rw");
        write_file(t.p(), "azunavi.db", b"eins").unwrap();
        assert_eq!(read_file(t.p(), "azunavi.db").unwrap(), b"eins");
        write_file(t.p(), "azunavi.db", b"zwei und mehr").unwrap();
        assert_eq!(read_file(t.p(), "azunavi.db").unwrap(), b"zwei und mehr");
        write_file(t.p(), "dateien/attachments/1_0_ä.png", &[1, 2, 3, 255, 0]).unwrap();
        assert_eq!(read_file(t.p(), "dateien/attachments/1_0_ä.png").unwrap(), vec![1, 2, 3, 255, 0]);
        // keine Zwischendateien übrig
        let left: Vec<_> = list_all(t.p()).into_iter().filter(|n| n.ends_with(TMP_SUFFIX)).collect();
        assert!(left.is_empty(), "Zwischendateien übrig: {left:?}");
        // groß
        let big = vec![7u8; 6 * 1024 * 1024];
        write_file(t.p(), "dateien/big.bin", &big).unwrap();
        assert_eq!(read_file(t.p(), "dateien/big.bin").unwrap().len(), big.len());
    }

    fn list_all(root: &Path) -> Vec<String> {
        let mut v = Vec::new();
        fn w(d: &Path, v: &mut Vec<String>) {
            for e in fs::read_dir(d).unwrap().flatten() {
                v.push(e.file_name().to_string_lossy().to_string());
                if e.file_type().unwrap().is_dir() {
                    w(&e.path(), v);
                }
            }
        }
        w(root, &mut v);
        v
    }

    #[test]
    fn fehlt_ist_nicht_gefunden() {
        let t = Tmp::new("fehlt");
        assert_eq!(read_file(t.p(), "azunavi.db").unwrap_err(), NOT_FOUND);
        assert_eq!(read_file(t.p(), "dateien/gibt/es/nicht.png").unwrap_err(), NOT_FOUND);
        assert_eq!(read_file(t.p(), "profil.json").unwrap_err(), NOT_FOUND);
    }

    #[test]
    fn ordner_statt_datei() {
        let t = Tmp::new("ordner");
        write_file(t.p(), "dateien/a/b.txt", b"x").unwrap();
        assert!(write_file(t.p(), "dateien/a", b"x").is_err());
        assert!(read_file(t.p(), "dateien/a").is_err());
        assert!(write_file(t.p(), "dateien/a/b.txt/c", b"x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn verknuepfungen_werden_nicht_verfolgt() {
        use std::os::unix::fs::symlink;
        let t = Tmp::new("sym");
        let out = Tmp::new("aussen");
        fs::write(out.p().join("geheim.txt"), b"geheim").unwrap();
        // Unterordner ist ein Link nach außen
        symlink(out.p(), t.p().join("dateien")).unwrap();
        assert!(write_file(t.p(), "dateien/x.txt", b"x").is_err());
        assert!(read_file(t.p(), "dateien/geheim.txt").is_err());
        assert!(!out.p().join("x.txt").exists(), "außerhalb darf nichts entstehen");
        assert!(list_app_files(t.p()).unwrap().is_empty());
        fs::remove_file(t.p().join("dateien")).unwrap();
        // Datei ist ein Link nach außen
        fs::create_dir(t.p().join("dateien")).unwrap();
        symlink(out.p().join("geheim.txt"), t.p().join("dateien").join("l.txt")).unwrap();
        assert!(read_file(t.p(), "dateien/l.txt").is_err());
        assert!(write_file(t.p(), "dateien/l.txt", b"zerstoert").is_err());
        assert_eq!(fs::read(out.p().join("geheim.txt")).unwrap(), b"geheim");
        assert!(!list_app_files(t.p()).unwrap().iter().any(|f| f.ends_with("l.txt")));
        // Datenbank-Datei ist ein Link nach außen
        symlink(out.p().join("geheim.txt"), t.p().join("azunavi.db")).unwrap();
        assert!(read_file(t.p(), "azunavi.db").is_err());
        assert!(write_file(t.p(), "azunavi.db", b"x").is_err());
        // Der Datenordner selbst darf über einen Link erreicht werden (so legt man ihn eben ab)
        let via = Tmp::new("via");
        let linkroot = via.p().join("ordner");
        symlink(t.p(), &linkroot).unwrap();
        fs::remove_file(t.p().join("azunavi.db")).unwrap();
        write_file(&linkroot, "azunavi.db", b"ok").unwrap();
        assert_eq!(read_file(t.p(), "azunavi.db").unwrap(), b"ok");
    }

    #[test]
    fn auflisten_nur_eigenes() {
        let t = Tmp::new("liste");
        write_file(t.p(), "azunavi.db", b"1").unwrap();
        write_file(t.p(), "profil.json", b"2").unwrap();
        write_file(t.p(), "dateien/attachments/a.png", b"3").unwrap();
        write_file(t.p(), "dateien/templates/vorlage.docx", b"4").unwrap();
        fs::write(t.p().join("desktop.ini"), b"fremd").unwrap();
        fs::write(t.p().join("Urlaub.pdf"), b"fremd").unwrap();
        fs::create_dir_all(t.p().join("Fotos")).unwrap();
        fs::write(t.p().join("Fotos").join("a.jpg"), b"fremd").unwrap();
        fs::write(t.p().join("dateien").join(format!("rest.{TMP_SUFFIX}")), b"x").unwrap();
        fs::write(t.p().join("dateien").join("CON"), b"x").ok(); // unter Linux möglich, wird ignoriert
        let l = list_app_files(t.p()).unwrap();
        assert_eq!(l, vec!["azunavi.db", "dateien/attachments/a.png", "dateien/templates/vorlage.docx", "profil.json"]);
    }

    #[test]
    fn sperre_entfernen() {
        let t = Tmp::new("lock");
        remove_lock(t.p()).unwrap(); // gibt es nicht: ok
        write_file(t.p(), "azunavi.lock", b"{}").unwrap();
        write_file(t.p(), "azunavi.db", b"daten").unwrap();
        remove_lock(t.p()).unwrap();
        assert_eq!(read_file(t.p(), "azunavi.lock").unwrap_err(), NOT_FOUND);
        assert_eq!(read_file(t.p(), "azunavi.db").unwrap(), b"daten");
    }

    #[test]
    fn schreibprobe() {
        let t = Tmp::new("probe");
        probe_writable(t.p()).unwrap();
        assert!(list_all(t.p()).is_empty());
        assert!(probe_writable(&t.p().join("gibt-es-nicht")).is_err());
    }

    #[test]
    fn sicherung_ueberschreibt_nie() {
        let t = Tmp::new("sich");
        let a = t.p().join("persona.db");
        let b = t.p().join("kopie.db");
        let data: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&a, &data).unwrap();
        assert_eq!(copy_verified(&a, &b).unwrap(), data.len() as u64);
        assert!(files_equal(&a, &b).unwrap());
        assert!(copy_verified(&a, &b).is_err(), "vorhandene Sicherung darf nicht überschrieben werden");
        let c = t.p().join("andere.db");
        let mut other = data.clone();
        other[299_999] ^= 1;
        fs::write(&c, &other).unwrap();
        assert!(!files_equal(&a, &c).unwrap());
        fs::write(t.p().join("kurz.db"), &data[..10]).unwrap();
        assert!(!files_equal(&a, &t.p().join("kurz.db")).unwrap());
        assert!(copy_verified(&t.p().join("fehlt.db"), &t.p().join("x.db")).is_err());
        assert!(!t.p().join("x.db").exists());
    }

    #[test]
    fn hilfen() {
        assert_eq!(percent_decode("dateien%2Fattachments%2F1_0_%C3%A4.png").unwrap(), "dateien/attachments/1_0_ä.png");
        assert_eq!(percent_decode("azunavi.db").unwrap(), "azunavi.db");
        assert!(percent_decode("a%2").is_err());
        assert!(percent_decode("a%zz").is_err());
        assert!(percent_decode("%").is_err());
        assert!(percent_decode("%C3%28").is_err()); // kein gültiges UTF-8
        assert_eq!(display_str(r"\\?\C:\Users\x\OneDrive"), r"C:\Users\x\OneDrive");
        assert_eq!(display_str(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(display_str("/home/x"), "/home/x");
        assert!(valid_stamp("20261022-101530") && !valid_stamp("../x") && !valid_stamp("1") && !valid_stamp("2026 1022"));
    }
}
