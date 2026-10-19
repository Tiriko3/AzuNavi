//! Abgleich verschlüsselter Datensätze. Der Server sieht nur: Datensatz-ID, Größe, Zeitstempel. Kein Klartext.
use crate::{error::AppError, routes::{auth::authenticate, parse_json}, util::*, AppState};
use axum::{body::Bytes, extract::{Query, State}, http::HeaderMap, Json};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Deserialize)] struct PushReq { records: Vec<PushRec> }
#[derive(Deserialize)] struct PushRec { id: String, base_seq: Option<i64>, blob: Option<String>, deleted: Option<bool> }

pub async fn push(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let req: PushReq = parse_json(&body)?;
    if req.records.is_empty() || req.records.len() > 200 { return Err(AppError::BadRequest("bad_record_count")); }
    // Alles prüfen, bevor die Datenbank angefasst wird
    let mut seen = HashSet::new();
    let mut items: Vec<(String, Option<i64>, Vec<u8>, bool)> = Vec::with_capacity(req.records.len());
    for r in req.records {
        if !valid_record_id(&r.id) { return Err(AppError::BadRequest("bad_record_id")); }
        if !seen.insert(r.id.clone()) { return Err(AppError::BadRequest("duplicate_id")); }
        let deleted = r.deleted.unwrap_or(false);
        let blob = if deleted { Vec::new() } else {
            let b = b64_decode(r.blob.as_deref().ok_or(AppError::BadRequest("missing_blob"))?, st.cfg.max_blob, "bad_blob")?;
            if b.len() < 16 { return Err(AppError::BadRequest("bad_blob")); }   // kürzer als Nonce + Tag kann nicht verschlüsselt sein
            b
        };
        items.push((r.id, r.base_seq, blob, deleted));
    }
    let (now, quota) = (st.now(), st.cfg.quota_bytes);
    let out = st.with_db(move |c| {
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (mut next, mut used): (i64, i64) = tx.query_row("SELECT next_seq, used_bytes FROM users WHERE id = ?1", [a.user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let (mut accepted, mut conflicts) = (Vec::new(), Vec::new());
        for (id, base, blob, deleted) in items {
            // user_id kommt aus dem Token: Datensätze anderer Konten sind weder les- noch überschreibbar
            let ex: Option<(i64, i64)> = tx.query_row("SELECT seq, length(blob) FROM records WHERE user_id = ?1 AND record_id = ?2", params![a.user_id, id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            let old_len = match ex {
                Some((seq, len)) => { if base != Some(seq) { conflicts.push(json!({ "id": id, "server_seq": seq })); continue; } len }
                None => 0,
            };
            let new_len = blob.len() as i64;
            if used - old_len + new_len > quota { return Err(AppError::TooLarge("quota_exceeded")); }
            used = used - old_len + new_len;
            tx.execute("INSERT INTO records (user_id, record_id, seq, blob, deleted, updated_at) VALUES (?1,?2,?3,?4,?5,?6)
                        ON CONFLICT(user_id, record_id) DO UPDATE SET seq=excluded.seq, blob=excluded.blob, deleted=excluded.deleted, updated_at=excluded.updated_at",
                params![a.user_id, id, next, blob, deleted as i64, now])?;
            accepted.push(json!({ "id": id, "seq": next }));
            next += 1;
        }
        tx.execute("UPDATE users SET next_seq = ?1, used_bytes = ?2 WHERE id = ?3", params![next, used, a.user_id])?;
        tx.commit()?;
        Ok(json!({ "accepted": accepted, "conflicts": conflicts, "latest_seq": next - 1 }))
    }).await?;
    Ok(Json(out))
}

#[derive(Deserialize)] pub struct PullQ { since: Option<i64>, limit: Option<i64> }

pub async fn pull(State(st): State<AppState>, headers: HeaderMap, Query(q): Query<PullQ>) -> Result<Json<Value>, AppError> {
    let a = authenticate(&st, &headers).await?;
    let since = q.since.unwrap_or(0).max(0);
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let out = st.with_db(move |c| {
        let mut s = c.prepare("SELECT record_id, seq, blob, deleted FROM records WHERE user_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3")?;
        let mut rows = s.query(params![a.user_id, since, limit + 1])?;
        let (mut recs, mut bytes, mut has_more) = (Vec::new(), 0usize, false);
        while let Some(r) = rows.next()? {
            let blob: Vec<u8> = r.get(2)?;
            if recs.len() as i64 >= limit || (!recs.is_empty() && bytes + blob.len() > (4 << 20) - (64 << 10)) { has_more = true; break; }   // Antwort bleibt unter dem Größenlimit
            bytes += blob.len();
            recs.push(json!({ "id": r.get::<_, String>(0)?, "seq": r.get::<_, i64>(1)?, "blob": b64(&blob), "deleted": r.get::<_, i64>(3)? != 0 }));
        }
        let latest: i64 = c.query_row("SELECT next_seq - 1 FROM users WHERE id = ?1", [a.user_id], |r| r.get(0))?;
        Ok(json!({ "records": recs, "has_more": has_more, "latest_seq": latest }))
    }).await?;
    Ok(Json(out))
}
