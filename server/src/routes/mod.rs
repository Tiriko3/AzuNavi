pub mod auth;
pub mod sync;

use crate::error::AppError;
use serde::de::DeserializeOwned;

pub async fn healthz() -> &'static str { "ok" }

/// JSON streng lesen. Fehler geben nie Eingaben zurück.
pub fn parse_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, AppError> {
    serde_json::from_slice(body).map_err(|_| AppError::BadRequest("bad_json"))
}
