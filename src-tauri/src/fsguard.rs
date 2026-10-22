// Freigegebene Orte für die Datei-Befehle (ab 0.4.1): Kern ohne Tauri, nur Standardbibliothek (einzeln testbar mit rustc --test).
//
// Die Datei-Befehle (fs_tree, fs_list, fs_move, fs_read, fs_open …) arbeiten nur noch an Orten, die der Nutzer selbst gewählt hat:
//  - Ordner (roots):      vom Nutzer im Ordner-Dialog gewählt (Arbeit, Schule, Cloud-Ordner) – dauerhaft gemerkt. Voller Zugriff darin.
//  - Dateien (files):     einzelne Dateien/Ordner, die der Nutzer zum Verknüpfen gewählt hat – dauerhaft gemerkt. Nur lesen/öffnen/verschieben.
//  - Sitzung (session):   was der Nutzer in dieser Sitzung im Dialog gewählt oder aufs Fenster gezogen hat. Nur lesen/öffnen/verschieben.
//  - Rückweg (undo_dirs): Ordner, aus denen eine Datei verschoben wurde. Darf nur als ZIEL fürs Zurücklegen dienen (nie lesen).
//
// Geprüft wird immer der kanonische Pfad (Verknüpfungen werden aufgelöst): Eine Verknüpfung im Ordner, die nach draußen zeigt,
// ist damit nicht erlaubt. „..“ im noch nicht vorhandenen Rest eines Pfads wird abgelehnt.

use std::path::{Component, Path, PathBuf};

pub const NOT_ALLOWED: &str = "NICHT_FREIGEGEBEN: Auf diesen Ort darf AzuNavi nicht zugreifen. Wähle den Ordner bzw. die Datei in AzuNavi noch einmal aus (Dateien-Seite).";

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Need {
    /// lesen, auflisten, öffnen, anzeigen, als Quelle verschieben
    Read,
    /// anlegen, schreiben, als Ziel verschieben
    Dest,
}

#[derive(Default, Clone, Debug)]
pub struct Grants {
    pub roots: Vec<PathBuf>,
    pub files: Vec<PathBuf>,
    pub undo_dirs: Vec<PathBuf>,
    pub session: Vec<PathBuf>,
}

/// Kanonischer Pfad. Gibt es den Pfad (noch) nicht, wird der tiefste vorhandene Ordner kanonisiert und der Rest angehängt.
pub fn canon_for_check(p: &Path) -> Result<PathBuf, String> {
    if !p.is_absolute() {
        return Err(NOT_ALLOWED.into());
    }
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        match std::fs::symlink_metadata(&cur) {
            Ok(_) => break,
            Err(_) => {
                match cur.components().next_back() {
                    Some(Component::Normal(n)) => rest.push(n.to_os_string()),
                    // „..“, „.“ oder Wurzel im fehlenden Rest: nicht erlaubt
                    _ => return Err(NOT_ALLOWED.into()),
                }
                if !cur.pop() {
                    return Err(NOT_ALLOWED.into());
                }
            }
        }
    }
    let mut out = cur.canonicalize().map_err(|_| NOT_ALLOWED.to_string())?;
    for n in rest.into_iter().rev() {
        out.push(n);
    }
    Ok(out)
}

fn inside(p: &Path, base: &Path) -> bool {
    p.starts_with(base)
}

impl Grants {
    /// Prüft einen Pfad. Bei Erfolg: der Pfad (kanonisch), sonst der Fehler NICHT_FREIGEGEBEN.
    pub fn check(&self, path: &Path, need: Need) -> Result<PathBuf, String> {
        let c = canon_for_check(path)?;
        let ok = match need {
            Need::Read => self.roots.iter().chain(self.files.iter()).chain(self.session.iter()).any(|b| inside(&c, b)),
            Need::Dest => self.roots.iter().chain(self.undo_dirs.iter()).any(|b| inside(&c, b)),
        };
        if ok {
            Ok(c)
        } else {
            Err(NOT_ALLOWED.into())
        }
    }

    #[cfg(test)]
    pub fn allowed(&self, path: &Path, need: Need) -> bool {
        self.check(path, need).is_ok()
    }

    fn push_unique(list: &mut Vec<PathBuf>, p: PathBuf) -> bool {
        if list.iter().any(|x| *x == p) {
            false
        } else {
            list.push(p);
            true
        }
    }

    /// Ordner dauerhaft freigeben. Liegt er schon in einem freigegebenen Ordner, ändert sich nichts.
    pub fn add_root(&mut self, canon: PathBuf) -> bool {
        if self.roots.iter().any(|r| inside(&canon, r)) {
            return false;
        }
        self.roots.retain(|r| !inside(r, &canon));
        Self::push_unique(&mut self.roots, canon)
    }
    pub fn add_file(&mut self, canon: PathBuf) -> bool {
        if self.roots.iter().any(|r| inside(&canon, r)) {
            return false;
        }
        Self::push_unique(&mut self.files, canon)
    }
    pub fn add_session(&mut self, canon: PathBuf) {
        Self::push_unique(&mut self.session, canon);
    }
    /// Quellordner einer Verschiebung merken, damit „Rückgängig“ auch nach einem Neustart zurücklegen darf (höchstens 50)
    pub fn add_undo_dir(&mut self, canon: PathBuf) -> bool {
        if self.roots.iter().any(|r| inside(&canon, r)) {
            return false;
        }
        let new = Self::push_unique(&mut self.undo_dirs, canon);
        while self.undo_dirs.len() > 50 {
            self.undo_dirs.remove(0);
        }
        new
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn uniq() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        format!("{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed))
    }
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let p = std::env::temp_dir().join(format!("azunavi-guard-{tag}-{}", uniq())).canonicalize_or_create();
            Tmp(p)
        }
        fn p(&self) -> &Path {
            &self.0
        }
    }
    trait Mk {
        fn canonicalize_or_create(self) -> PathBuf;
    }
    impl Mk for PathBuf {
        fn canonicalize_or_create(self) -> PathBuf {
            fs::create_dir_all(&self).unwrap();
            self.canonicalize().unwrap()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn grants(root: &Path) -> Grants {
        let mut g = Grants::default();
        g.add_root(root.to_path_buf());
        g
    }

    #[test]
    fn im_freigegebenen_ordner() {
        let t = Tmp::new("in");
        let root = t.p().join("Arbeit");
        fs::create_dir_all(root.join("Unter/Tiefer")).unwrap();
        fs::write(root.join("Unter/a.txt"), b"x").unwrap();
        let g = grants(&root);
        for p in [root.clone(), root.join("Unter"), root.join("Unter/a.txt"), root.join("Unter/Tiefer")] {
            assert!(g.allowed(&p, Need::Read), "{p:?}");
            assert!(g.allowed(&p, Need::Dest), "{p:?}");
        }
        // noch nicht vorhanden (neuer Ordner, neue Datei) ist innen erlaubt
        assert!(g.allowed(&root.join("Neu/Noch tiefer/datei.pdf"), Need::Dest));
    }

    #[test]
    fn ausserhalb_und_aehnlicher_name() {
        let t = Tmp::new("aus");
        let root = t.p().join("Arbeit");
        let other = t.p().join("Arbeit2");        // gleicher Anfang, anderer Ordner
        let down = t.p().join("Downloads");
        for d in [&root, &other, &down] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(down.join("x.pdf"), b"x").unwrap();
        let g = grants(&root);
        for p in [other.clone(), other.join("a"), down.clone(), down.join("x.pdf"), t.p().to_path_buf(), t.p().parent().unwrap().to_path_buf()] {
            assert!(!g.allowed(&p, Need::Read), "{p:?}");
            assert!(!g.allowed(&p, Need::Dest), "{p:?}");
        }
        assert!(g.check(&down, Need::Read).unwrap_err().starts_with("NICHT_FREIGEGEBEN"));
    }

    #[test]
    fn punkte_und_relative_pfade() {
        let t = Tmp::new("dots");
        let root = t.p().join("Arbeit");
        fs::create_dir_all(root.join("Unter")).unwrap();
        fs::create_dir_all(t.p().join("Geheim")).unwrap();
        let g = grants(&root);
        // aus dem Ordner herauslaufen
        assert!(!g.allowed(&root.join("Unter/../../Geheim"), Need::Read));
        assert!(!g.allowed(&root.join("../Geheim"), Need::Read));
        // „..“ im noch nicht vorhandenen Rest
        assert!(!g.allowed(&root.join("gibtsnicht/../../Geheim/x"), Need::Dest));
        assert!(!g.allowed(&root.join("gibtsnicht/.."), Need::Dest));
        // relativ
        assert!(!g.allowed(Path::new("Arbeit/a.txt"), Need::Read));
        assert!(!g.allowed(Path::new(""), Need::Read));
        // „..“, das innen bleibt, ist in Ordnung (wird aufgelöst)
        assert!(g.allowed(&root.join("Unter/../Unter"), Need::Read));
    }

    #[cfg(unix)]
    #[test]
    fn verknuepfungen_nach_draussen() {
        use std::os::unix::fs::symlink;
        let t = Tmp::new("sym");
        let root = t.p().join("Arbeit");
        let out = t.p().join("Draussen");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("geheim.txt"), b"g").unwrap();
        symlink(&out, root.join("Link")).unwrap();
        symlink(out.join("geheim.txt"), root.join("l.txt")).unwrap();
        let g = grants(&root);
        assert!(!g.allowed(&root.join("Link"), Need::Read));
        assert!(!g.allowed(&root.join("Link/geheim.txt"), Need::Read));
        assert!(!g.allowed(&root.join("Link/neu.txt"), Need::Dest), "auch nicht Neues hinter einer Verknüpfung anlegen");
        assert!(!g.allowed(&root.join("l.txt"), Need::Read));
        // Ordner liegt selbst hinter einer Verknüpfung: freigegeben wird der echte Ort
        let via = t.p().join("Abkuerzung");
        symlink(&root, &via).unwrap();
        assert!(g.allowed(&via.join("x.txt"), Need::Read), "echter Ort liegt im freigegebenen Ordner");
    }

    #[test]
    fn einzelne_dateien_und_sitzung() {
        let t = Tmp::new("einzel");
        let down = t.p().join("Downloads");
        fs::create_dir_all(down.join("Ordner")).unwrap();
        fs::write(down.join("a.pdf"), b"a").unwrap();
        fs::write(down.join("b.pdf"), b"b").unwrap();
        fs::write(down.join("Ordner/c.txt"), b"c").unwrap();
        let mut g = Grants::default();
        g.add_file(down.join("a.pdf").canonicalize().unwrap());
        assert!(g.allowed(&down.join("a.pdf"), Need::Read));
        assert!(!g.allowed(&down.join("b.pdf"), Need::Read), "andere Datei im selben Ordner bleibt zu");
        assert!(!g.allowed(&down, Need::Read), "der Ordner darüber auch");
        assert!(!g.allowed(&down.join("a.pdf"), Need::Dest), "Einzeldatei ist keine Schreib-Freigabe");
        g.add_session(down.join("Ordner").canonicalize().unwrap());
        assert!(g.allowed(&down.join("Ordner"), Need::Read));
        assert!(g.allowed(&down.join("Ordner/c.txt"), Need::Read), "gewählter Ordner enthält seine Dateien");
        assert!(!g.allowed(&down.join("Ordner"), Need::Dest));
    }

    #[test]
    fn rueckweg_nur_als_ziel() {
        let t = Tmp::new("undo");
        let root = t.p().join("Arbeit");
        let down = t.p().join("Downloads");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&down).unwrap();
        fs::write(down.join("geheim.pdf"), b"g").unwrap();
        let mut g = grants(&root);
        assert!(g.add_undo_dir(down.canonicalize().unwrap()));
        assert!(g.allowed(&down, Need::Dest), "zurücklegen erlaubt");
        assert!(g.allowed(&down.join("a.pdf"), Need::Dest));
        assert!(!g.allowed(&down, Need::Read), "aber nichts darin lesen");
        assert!(!g.allowed(&down.join("geheim.pdf"), Need::Read));
        // Ordner innerhalb eines freigegebenen Ordners wird nicht extra gemerkt
        assert!(!g.add_undo_dir(root.join("x")));
        // Begrenzung
        for i in 0..80 {
            let d = t.p().join(format!("d{i}"));
            fs::create_dir_all(&d).unwrap();
            g.add_undo_dir(d.canonicalize().unwrap());
        }
        assert!(g.undo_dirs.len() <= 50);
    }

    #[test]
    fn freigaben_verwalten() {
        let t = Tmp::new("verw");
        let a = t.p().join("A");
        let ab = a.join("B");
        fs::create_dir_all(&ab).unwrap();
        let mut g = Grants::default();
        assert!(g.add_root(ab.clone()));
        assert!(!g.add_root(ab.clone()), "doppelt");
        assert!(!g.add_root(ab.join("C")), "liegt schon in einem freigegebenen Ordner");
        assert!(g.add_root(a.clone()), "größerer Ordner ersetzt den kleineren");
        assert_eq!(g.roots, vec![a.clone()]);
        assert!(!g.add_file(a.join("x.txt")), "Datei in freigegebenem Ordner braucht keine eigene Freigabe");
        assert!(!Grants::default().allowed(&a, Need::Read), "ohne Freigaben ist nichts erlaubt");
    }
}
