//! Cloud-Sicherung: die komplette App-Sicherung (ZIP) verschlüsselt auf dem Server ablegen und wieder holen.
//! Zerlegt in Stücke (<= 600 KiB), jedes einzeln verschlüsselt. Ein Meta-Datensatz hält Größe und SHA-256.
//! Schutz vor Überschreiben: Hochladen klappt nur, wenn das Gerät den aktuellen Stand des Servers kennt
//! (sonst Konflikt -> der Nutzer entscheidet). Alte Stücke werden danach gelöscht.
use crate::{Error, Record, Session};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const CHUNK: usize = 600 * 1024;
const META: &str = "bk:meta";

#[derive(Debug, Clone, PartialEq)]
pub struct CloudInfo { pub meta_seq: i64, pub created: i64, pub device: String, pub size: usize }
#[derive(Debug, PartialEq)]
pub enum Upload { Done { meta_seq: i64 }, Conflict { server_meta_seq: i64 } }

fn hex(d: &[u8]) -> String { d.iter().map(|b| format!("{b:02x}")).collect() }

impl Session {
    /// Alle eigenen Datensätze holen (seitenweise)
    async fn pull_all(&mut self) -> Result<Vec<crate::Pulled>, Error> {
        let (mut since, mut all) = (0i64, Vec::new());
        loop {
            let p = self.pull(since).await?;
            if let Some(last) = p.records.last() { since = last.seq; }
            let more = p.has_more && !p.records.is_empty();
            all.extend(p.records);
            if !more { break; }
        }
        Ok(all)
    }

    /// Sicherung hochladen. `known_meta_seq` = Stand des Servers, den dieses Gerät zuletzt gesehen hat (None beim ersten Mal).
    pub async fn upload_backup(&mut self, bytes: &[u8], known_meta_seq: Option<i64>, device: &str, now: i64) -> Result<Upload, Error> {
        if bytes.is_empty() { return Err(Error::BadInput("leere Sicherung")); }
        let mut g = [0u8; 8]; rand::rngs::OsRng.fill_bytes(&mut g);
        let gen = hex(&g);
        let chunks: Vec<&[u8]> = bytes.chunks(CHUNK).collect();
        let recs: Vec<Record> = chunks.iter().enumerate().map(|(i, c)| Record { id: format!("bk:{gen}:{i:05}"), base_seq: None, data: Some(json!({ "b": STANDARD.encode(c) })) }).collect();
        for part in recs.chunks(3) {                                   // 3 Stücke pro Anfrage bleiben unter dem Größenlimit
            let r = self.push(part).await?;
            if !r.conflicts.is_empty() { return Err(Error::Server("Stück-Konflikt".into())); }
        }
        let meta = json!({ "gen": gen, "chunks": chunks.len(), "size": bytes.len(), "sha256": hex(&Sha256::digest(bytes)), "created": now, "device": device });
        let r = self.push(&[Record { id: META.into(), base_seq: known_meta_seq, data: Some(meta) }]).await?;
        if let Some((_, server_seq)) = r.conflicts.first() {
            // Jemand anderes war schneller: unsere Stücke wieder entfernen, nichts überschreiben
            let del: Vec<Record> = recs.iter().map(|x| Record { id: x.id.clone(), base_seq: None, data: None }).collect();
            let _ = self.cleanup(&gen, Some(del)).await;
            return Ok(Upload::Conflict { server_meta_seq: *server_seq });
        }
        let meta_seq = r.accepted.first().map(|(_, s)| *s).ok_or(Error::Server("keine Bestätigung".into()))?;
        self.cleanup(&gen, None).await?;
        Ok(Upload::Done { meta_seq })
    }

    /// Stücke anderer (alter) Sicherungen löschen. `ours` = nur diese löschen (nach einem Konflikt).
    async fn cleanup(&mut self, keep_gen: &str, ours: Option<Vec<Record>>) -> Result<(), Error> {
        let all = self.pull_all().await?;
        let del: Vec<Record> = match ours {
            Some(list) => list.into_iter().filter_map(|r| all.iter().find(|p| p.id == r.id && p.data.is_some()).map(|p| Record { id: p.id.clone(), base_seq: Some(p.seq), data: None })).collect(),
            None => all.iter().filter(|p| p.data.is_some() && p.id.starts_with("bk:") && p.id != META && !p.id.starts_with(&format!("bk:{keep_gen}:")))
                .map(|p| Record { id: p.id.clone(), base_seq: Some(p.seq), data: None }).collect(),
        };
        for part in del.chunks(100) { self.push(part).await?; }
        Ok(())
    }

    /// Neueste Sicherung vom Server holen und prüfen (Größe, SHA-256). None = noch keine da.
    pub async fn download_backup(&mut self) -> Result<Option<(CloudInfo, Zeroizing<Vec<u8>>)>, Error> {
        let all = self.pull_all().await?;
        let Some(meta) = all.iter().find(|p| p.id == META && p.data.is_some()) else { return Ok(None) };
        let m = meta.data.as_ref().unwrap();
        let gen = m["gen"].as_str().ok_or(Error::Tampered)?;
        let n = m["chunks"].as_u64().ok_or(Error::Tampered)? as usize;
        let size = m["size"].as_u64().ok_or(Error::Tampered)? as usize;
        let mut out = Zeroizing::new(Vec::with_capacity(size));
        for i in 0..n {
            let id = format!("bk:{gen}:{i:05}");
            let rec = all.iter().find(|p| p.id == id).and_then(|p| p.data.as_ref()).ok_or(Error::Server("Sicherung unvollständig".into()))?;
            let b = STANDARD.decode(rec["b"].as_str().ok_or(Error::Tampered)?).map_err(|_| Error::Tampered)?;
            out.extend_from_slice(&b);
        }
        if out.len() != size || hex(&Sha256::digest(&out[..])) != m["sha256"].as_str().unwrap_or("") { return Err(Error::Tampered); }
        let info = CloudInfo { meta_seq: meta.seq, created: m["created"].as_i64().unwrap_or(0), device: m["device"].as_str().unwrap_or("").chars().take(64).collect(), size };
        Ok(Some((info, out)))
    }
}

#[allow(dead_code)]
fn _unused(_: Value) {}
