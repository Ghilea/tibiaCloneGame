use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use game_types::{EntityId, Position};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::persistence::{CharacterRecord, Database};

const SESSION_LIFETIME: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Clone)]
pub struct AuthService {
    database: Option<Database>,
    sessions: Arc<RwLock<HashMap<String, Session>>>,
}

#[derive(Clone)]
struct Session {
    account_id: EntityId,
    expires_at: Instant,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCharacterRequest {
    pub name: String,
    pub vocation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub session_token: String,
    pub account_id: EntityId,
}

#[derive(Debug, Serialize)]
pub struct CharacterListResponse {
    pub characters: Vec<CharacterSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSummary {
    pub id: EntityId,
    pub name: String,
    pub vocation: String,
    pub level: i32,
    pub position: Position,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "invalid_session",
            "The session is missing or has expired",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "code": self.code, "message": self.message })),
        )
            .into_response()
    }
}

impl AuthService {
    pub fn new(database: Option<Database>) -> Self {
        Self {
            database,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn database_enabled(&self) -> bool {
        self.database.is_some()
    }

    fn database(&self) -> Result<&Database, ApiError> {
        self.database.as_ref().ok_or_else(|| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "database_unavailable",
                "The account database is not enabled on this server",
            )
        })
    }

    pub async fn register(&self, credentials: Credentials) -> Result<AuthResponse, ApiError> {
        let username = normalize_username(&credentials.username)?;
        validate_password(&credentials.password)?;
        let password = credentials.password;
        let hash = tokio::task::spawn_blocking(move || hash_password(&password))
            .await
            .map_err(internal_error)??;
        let account_id = self
            .database()?
            .create_account(&username, &hash)
            .await
            .map_err(|error| {
                if error
                    .as_database_error()
                    .is_some_and(|db| db.is_unique_violation())
                {
                    ApiError::new(
                        StatusCode::CONFLICT,
                        "username_taken",
                        "That account name is already in use",
                    )
                } else {
                    internal_error(error)
                }
            })?;
        Ok(self.create_session(account_id).await)
    }

    pub async fn login(&self, credentials: Credentials) -> Result<AuthResponse, ApiError> {
        let username = normalize_username(&credentials.username)?;
        let account = self
            .database()?
            .account_by_username(&username)
            .await
            .map_err(internal_error)?
            .ok_or_else(invalid_credentials)?;
        let password = credentials.password;
        let hash = account.password_hash;
        let valid = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
            .await
            .map_err(internal_error)?;
        if !valid {
            return Err(invalid_credentials());
        }
        Ok(self.create_session(account.id).await)
    }

    pub async fn characters(&self, token: &str) -> Result<Vec<CharacterSummary>, ApiError> {
        let account_id = self.account_for_token(token).await?;
        let characters = self
            .database()?
            .characters_for_account(account_id)
            .await
            .map_err(internal_error)?;
        Ok(characters.into_iter().map(CharacterSummary::from).collect())
    }

    pub async fn create_character(
        &self,
        token: &str,
        name: String,
        vocation: String,
    ) -> Result<CharacterSummary, ApiError> {
        let account_id = self.account_for_token(token).await?;
        let name = validate_character_name(&name)?;
        let vocation = game_types::playable_vocation(&vocation)
            .map(|profile| profile.id)
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_vocation",
                    "Choose Warrior, Ranger, Mage, or Druid",
                )
            })?;
        if self
            .database()?
            .characters_for_account(account_id)
            .await
            .map_err(internal_error)?
            .len()
            >= 4
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "character_limit",
                "This account already has four characters",
            ));
        }
        let character = self
            .database()?
            .create_character(account_id, &name, vocation)
            .await
            .map_err(|error| {
                if error
                    .as_database_error()
                    .is_some_and(|db| db.is_unique_violation())
                {
                    ApiError::new(
                        StatusCode::CONFLICT,
                        "character_name_taken",
                        "That character name is already in use",
                    )
                } else {
                    internal_error(error)
                }
            })?;
        Ok(character.into())
    }

    pub async fn resolve_character(
        &self,
        token: &str,
        character_id: EntityId,
    ) -> Result<CharacterRecord, ApiError> {
        let account_id = self.account_for_token(token).await?;
        self.database()?
            .character_for_account(account_id, character_id)
            .await
            .map_err(internal_error)?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::FORBIDDEN,
                    "character_forbidden",
                    "That character does not belong to this account",
                )
            })
    }

    pub async fn save_position(&self, character_id: EntityId, position: Position) {
        let Some(database) = &self.database else {
            return;
        };
        if let Err(error) = database.save_position(character_id, position).await {
            tracing::error!(%character_id, %error, "failed to save character position");
        }
    }

    async fn create_session(&self, account_id: EntityId) -> AuthResponse {
        let token = Uuid::new_v4().to_string();
        let mut sessions = self.sessions.write().await;
        sessions.retain(|_, session| {
            session.account_id != account_id && session.expires_at > Instant::now()
        });
        sessions.insert(
            token.clone(),
            Session {
                account_id,
                expires_at: Instant::now() + SESSION_LIFETIME,
            },
        );
        AuthResponse {
            session_token: token,
            account_id,
        }
    }

    async fn account_for_token(&self, token: &str) -> Result<EntityId, ApiError> {
        let sessions = self.sessions.read().await;
        sessions
            .get(token)
            .filter(|session| session.expires_at > Instant::now())
            .map(|session| session.account_id)
            .ok_or_else(ApiError::unauthorized)
    }
}

impl From<CharacterRecord> for CharacterSummary {
    fn from(value: CharacterRecord) -> Self {
        Self {
            id: value.id,
            name: value.name,
            vocation: value.vocation,
            level: value.level,
            position: value.position,
        }
    }
}

fn normalize_username(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    if (3..=24).contains(&value.len())
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        Ok(value)
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_username",
            "Account names must contain 3–24 characters: a–z, 0–9, or _",
        ))
    }
}

fn validate_password(value: &str) -> Result<(), ApiError> {
    if (10..=128).contains(&value.chars().count()) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_password",
            "Passwords must contain 10–128 characters",
        ))
    }
}

fn validate_character_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if (2..=20).contains(&value.chars().count())
        && value.chars().all(|c| c.is_alphabetic() || c == ' ')
    {
        Ok(value.to_owned())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_character_name",
            "Character names must contain 2–20 letters",
        ))
    }
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|hash| hash.to_string())
        .map_err(internal_error)
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
}

fn invalid_credentials() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_credentials",
        "Incorrect account name or password",
    )
}

fn internal_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "authentication operation failed");
    ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "The server could not complete the request",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_are_hashed_and_verified() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert_ne!(hash, "correct horse battery staple");
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }

    #[test]
    fn validates_public_names() {
        assert_eq!(normalize_username("  Player_42 ").unwrap(), "player_42");
        assert!(normalize_username("bad name").is_err());
        assert!(validate_character_name("Éowyn").is_ok());
        assert!(validate_character_name("x!").is_err());
    }
}
