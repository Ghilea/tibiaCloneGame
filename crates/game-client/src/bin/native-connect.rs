use std::{
    env,
    io::{self, Write},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use game_protocol::{
    AuthCredentials, AuthResponse, CharacterListResponse, CharacterSummary, ClientMessage,
    PROTOCOL_VERSION, ServerMessage,
};
use reqwest::StatusCode;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::Message,
};

const CLIENT_VERSION: &str = "0.1.0-native-v36.1";

#[tokio::main]
async fn main() -> Result<()> {
    println!("Embers of Aldoria — Native server handshake V36.1");
    println!("--------------------------------------------------");

    let api_url = env::var("ALDORIA_API_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4000/api".to_owned());
    let ws_url = env::var("ALDORIA_WS_URL")
        .unwrap_or_else(|_| "ws://127.0.0.1:4000/ws".to_owned());

    println!("API: {api_url}");
    println!("WS:  {ws_url}");
    println!();

    let username = env::var("ALDORIA_USERNAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(prompt_line("Account: ")?);

    let password = match env::var("ALDORIA_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => rpassword::prompt_password("Password: ")
            .context("failed to read password from console")?,
    };

    let http = reqwest::Client::builder()
        .user_agent("Embers-of-Aldoria-Native/36.1")
        .build()
        .context("failed to create HTTP client")?;

    println!();
    println!("1/4 Authenticating...");
    let auth_response = http
        .post(format!("{api_url}/auth/login"))
        .json(&AuthCredentials {
            username,
            password,
        })
        .send()
        .await
        .context("could not reach the login endpoint")?;

    let auth: AuthResponse = decode_api_response(auth_response, "login").await?;
    println!("    session established for account {}", auth.account_id);

    println!("2/4 Loading characters...");
    let characters_response = http
        .get(format!("{api_url}/characters"))
        .bearer_auth(&auth.session_token)
        .send()
        .await
        .context("could not reach the character endpoint")?;
    let characters: CharacterListResponse =
        decode_api_response(characters_response, "character list").await?;

    let character = choose_character(characters.characters)?;
    println!(
        "    selected {} · level {} · {}:{}:{}",
        character.name,
        character.level,
        character.position.x,
        character.position.y,
        character.position.z,
    );

    println!("3/4 Opening native WebSocket...");
    let (mut socket, response) =
        connect_async_with_config(ws_url.as_str(), None, true)
            .await
            .context("failed to connect to the game WebSocket")?;

    println!("    WebSocket HTTP status {}", response.status());

    let hello = ClientMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
        client_version: CLIENT_VERSION.to_owned(),
        session_token: Some(auth.session_token.clone()),
        character_id: Some(character.id),
        character_name: None,
    };
    socket
        .send(Message::Text(
            serde_json::to_string(&hello)
                .context("failed to encode hello")?
                .into(),
        ))
        .await
        .context("failed to send hello")?;

    println!("4/4 Waiting for authoritative Welcome...");
    let mut welcomed = false;
    let mut ping_sent_at = None;

    while let Some(frame) = socket.next().await {
        let frame = frame.context("WebSocket read failed")?;

        match frame {
            Message::Text(text) => {
                let message: ServerMessage = serde_json::from_str(text.as_str())
                    .context("server sent invalid protocol JSON")?;

                match message {
                    ServerMessage::Welcome { payload } => {
                        if payload.player.id != character.id {
                            bail!(
                                "server returned character {}, expected {}",
                                payload.player.id,
                                character.id,
                            );
                        }

                        println!();
                        println!("WELCOME RECEIVED");
                        println!("----------------");
                        println!(
                            "Player:   {} · level {} · hp {}/{} · mana {}/{}",
                            payload.player.name,
                            payload.player.level,
                            payload.player.health,
                            payload.player.max_health,
                            payload.player.mana,
                            payload.player.max_mana,
                        );
                        println!(
                            "Position: {}:{}:{}",
                            payload.player.position.x,
                            payload.player.position.y,
                            payload.player.position.z,
                        );
                        println!(
                            "Region:   center {}:{}:{} · radius {} · floors ±{}",
                            payload.region_center.x,
                            payload.region_center.y,
                            payload.region_center.z,
                            payload.region_radius,
                            payload.region_floor_radius,
                        );
                        println!(
                            "Map:      {}x{} floor {} · roads {} · floors {} · water {} · buildings {}",
                            payload.map.width,
                            payload.map.height,
                            payload.map.floor,
                            payload.map.roads.len(),
                            payload.map.floors.len(),
                            payload.map.water.len(),
                            payload.map.buildings.len(),
                        );
                        println!(
                            "Actors:   players {} · creatures {} · NPCs {} · resources {}",
                            payload.players.len(),
                            payload.creatures.len(),
                            payload.npcs.len(),
                            payload.resource_nodes.len(),
                        );
                        println!(
                            "Content:  item defs {} · spells {} · recipes {} · inventory {}",
                            payload.item_definitions.len(),
                            payload.spells.len(),
                            payload.rune_recipes.len(),
                            payload.inventory.len(),
                        );

                        welcomed = true;
                        let sent_at = unix_millis()?;
                        ping_sent_at = Some(sent_at);
                        socket
                            .send(Message::Text(
                                serde_json::to_string(&ClientMessage::Ping { sent_at })?
                                    .into(),
                            ))
                            .await
                            .context("failed to send native ping")?;
                    }
                    ServerMessage::Pong { sent_at, .. }
                        if welcomed && ping_sent_at == Some(sent_at) =>
                    {
                        let rtt = unix_millis()?.saturating_sub(sent_at);
                        println!("Ping:     {rtt} ms");
                        println!();
                        println!("NATIVE V36.1 HANDSHAKE PASSED");
                        println!(
                            "Shared Rust auth + protocol + WebSocket path is working end-to-end."
                        );

                        let _ = socket.close(None).await;
                        return Ok(());
                    }
                    ServerMessage::Error { code, message } => {
                        bail!("server error {code}: {message}");
                    }
                    _ => {
                        // Movement/world events may arrive between Welcome and Pong.
                    }
                }
            }
            Message::Close(frame) => {
                bail!("server closed the socket before handshake completed: {frame:?}");
            }
            Message::Ping(payload) => {
                socket.send(Message::Pong(payload)).await?;
            }
            _ => {}
        }
    }

    bail!("WebSocket ended before native handshake completed")
}

async fn decode_api_response<T>(
    response: reqwest::Response,
    operation: &str,
) -> Result<T>
where
    T: serde::de::DeserializeOwned,
{
    let status = response.status();
    if status.is_success() {
        return response
            .json::<T>()
            .await
            .with_context(|| format!("{operation} returned invalid JSON"));
    }

    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            let code = value.get("code")?.as_str().unwrap_or("request_failed");
            let message = value
                .get("message")
                .and_then(|entry| entry.as_str())
                .unwrap_or("request failed");
            Some(format!("{code}: {message}"))
        })
        .unwrap_or_else(|| body.trim().to_owned());

    if status == StatusCode::UNAUTHORIZED {
        bail!("{operation} rejected: {detail}");
    }
    bail!("{operation} failed with HTTP {status}: {detail}");
}

fn choose_character(characters: Vec<CharacterSummary>) -> Result<CharacterSummary> {
    if characters.is_empty() {
        bail!(
            "this account has no characters; create one in the existing client before V36.2"
        );
    }

    if let Some(wanted) = env::var("ALDORIA_CHARACTER")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        let wanted = wanted.trim();
        return characters
            .into_iter()
            .find(|character| {
                character.name.eq_ignore_ascii_case(wanted)
                    || character.id.to_string().eq_ignore_ascii_case(wanted)
            })
            .with_context(|| format!("character '{wanted}' was not found on this account"));
    }

    if characters.len() == 1 {
        return Ok(characters.into_iter().next().expect("one character"));
    }

    println!();
    println!("Characters:");
    for (index, character) in characters.iter().enumerate() {
        println!(
            "  {}) {} · level {} · {}:{}:{}",
            index + 1,
            character.name,
            character.level,
            character.position.x,
            character.position.y,
            character.position.z,
        );
    }

    loop {
        let input = prompt_line("Choose character number: ")?;
        let Ok(index) = input.parse::<usize>() else {
            println!("Enter a number from 1 to {}.", characters.len());
            continue;
        };
        if (1..=characters.len()).contains(&index) {
            return Ok(characters[index - 1].clone());
        }
        println!("Enter a number from 1 to {}.", characters.len());
    }
}

fn prompt_line(label: &str) -> Result<String> {
    print!("{label}");
    io::stdout().flush().context("failed to flush console")?;

    let mut value = String::new();
    io::stdin()
        .read_line(&mut value)
        .context("failed to read console input")?;

    let value = value.trim().to_owned();
    if value.is_empty() {
        bail!("input cannot be empty");
    }
    Ok(value)
}

fn unix_millis() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before Unix epoch")?
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX))
}
