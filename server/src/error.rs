//! Fehler, die der Server nach außen gibt. Bewusst knapp: nur ein Code, nie Interna, nie Eingaben.
use axum::{http::{header, StatusCode}, response::{IntoResponse, Response}};

#[derive(Debug)]
pub enum AppError {
    BadRequest(&'static str),
    Unauthorized,
    NotFound,
    Conflict(&'static str),
    TooLarge(&'static str),
    TooMany(u64),
    Internal,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, retry) = match self {
            AppError::BadRequest(c) => (StatusCode::BAD_REQUEST, c, None),
            // Immer dieselbe Antwort, egal ob Konto fehlt, Passwort falsch oder Token abgelaufen
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", None),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found", None),
            AppError::Conflict(c) => (StatusCode::CONFLICT, c, None),
            AppError::TooLarge(c) => (StatusCode::PAYLOAD_TOO_LARGE, c, None),
            AppError::TooMany(s) => (StatusCode::TOO_MANY_REQUESTS, "rate_limited", Some(s)),
            AppError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal", None),
        };
        let mut res = (status, [(header::CONTENT_TYPE, "application/json")], format!("{{\"error\":\"{code}\"}}")).into_response();
        if let Some(s) = retry {
            if let Ok(v) = s.to_string().parse() { res.headers_mut().insert(header::RETRY_AFTER, v); }
        }
        res
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        // Inhalte nie loggen, nur die Art des Fehlers
        tracing::error!(kind = "db", "{}", e.to_string().chars().take(80).collect::<String>());
        AppError::Internal
    }
}
