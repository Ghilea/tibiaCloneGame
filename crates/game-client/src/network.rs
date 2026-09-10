use std::{
    env,
    io::{self, Write},
    sync::mpsc::{self, Receiver},
    thread,
};

use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use game_protocol::{
    AuthCredentials, AuthResponse, CharacterListResponse, CharacterSummary, ClientMessage,
    PROTOCOL_VERSION, ServerMessage, WelcomePayload,
};
use reqwest::StatusCode;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::Message,
};

use crate::version;


pub struct NativeSession {
    pub welcome: Box<WelcomePayload>,
    pub outbound: UnboundedSender<ClientMessage>,
    pub incoming: Receiver<ServerMessage>,
}

#[derive(Debug, Clone)]
pub struct NativeLoginResult {
    #[allow(dead_code)]
    pub api_url: String,
    pub ws_url: String,
    pub session_token: String,
    pub characters: Vec<CharacterSummary>,
}

pub fn configured_api_url() -> String {
    env::var("ALDORIA_API_URL")
        .unwrap_or_else(|_| {
            option_env!("ALDORIA_DEFAULT_API_URL")
                .unwrap_or("http://127.0.0.1:4000/api")
                .to_owned()
        })
}

pub fn configured_ws_url() -> String {
    env::var("ALDORIA_WS_URL")
        .unwrap_or_else(|_| {
            option_env!("ALDORIA_DEFAULT_WS_URL")
                .unwrap_or("ws://127.0.0.1:4000/ws")
                .to_owned()
        })
}

pub fn login_and_list_characters(
    username: String,
    password: String,
) -> Result<NativeLoginResult> {
    login_and_list_characters_with_urls(
        configured_api_url(),
        configured_ws_url(),
        username,
        password,
    )
}

pub fn login_and_list_characters_with_urls(
    api_url: String,
    ws_url: String,
    username: String,
    password: String,
) -> Result<NativeLoginResult> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create native launcher network runtime")?;

    runtime.block_on(async move {
        let http = reqwest::Client::builder()
            .user_agent("Embers-of-Aldoria-Native/36.29")
            .build()
            .context("failed to create HTTP client")?;

        let auth_response = http
            .post(format!("{api_url}/auth/login"))
            .json(&AuthCredentials { username, password })
            .send()
            .await
            .context("could not reach the login endpoint")?;

        let auth: AuthResponse =
            decode_api_response(auth_response, "login").await?;

        let characters_response = http
            .get(format!("{api_url}/characters"))
            .bearer_auth(&auth.session_token)
            .send()
            .await
            .context("could not reach the character endpoint")?;

        let characters: CharacterListResponse =
            decode_api_response(characters_response, "character list").await?;

        Ok(NativeLoginResult {
            api_url,
            ws_url,
            session_token: auth.session_token,
            characters: characters.characters,
        })
    })
}



pub fn connect_direct_from_env() -> Result<NativeSession> {
    let session_token = env::var("ALDORIA_SESSION_TOKEN")
        .context("native launcher session token is missing")?;
    let character_id = env::var("ALDORIA_CHARACTER_ID")
        .context("native launcher character id is missing")?
        .parse::<game_types::EntityId>()
        .context("native launcher character id is invalid")?;

    connect_selected_character(
        configured_ws_url(),
        session_token,
        character_id,
    )
}

pub fn connect_selected_character(
    ws_url: String,
    session_token: String,
    character_id: game_types::EntityId,
) -> Result<NativeSession> {
    let (ready_tx, ready_rx) =
        mpsc::sync_channel::<Result<Box<WelcomePayload>, String>>(1);
    let (incoming_tx, incoming_rx) =
        mpsc::channel::<ServerMessage>();
    let (outbound_tx, mut outbound_rx) =
        unbounded_channel::<ClientMessage>();

    thread::Builder::new()
        .name("aldoria-network".into())
        .spawn(move || {
            let runtime =
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_tx.send(Err(format!(
                            "failed to create network runtime: {error}"
                        )));
                        return;
                    }
                };

            runtime.block_on(async move {
                let result = open_selected_session(
                    ws_url,
                    session_token,
                    character_id,
                )
                .await;

                let (mut socket, welcome) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = ready_tx.send(Err(format!("{error:#}")));
                        return;
                    }
                };

                if ready_tx.send(Ok(welcome)).is_err() {
                    return;
                }

                loop {
                    tokio::select! {
                        outgoing = outbound_rx.recv() => {
                            let Some(outgoing) = outgoing else {
                                let _ = socket.close(None).await;
                                break;
                            };

                            match serde_json::to_string(&outgoing) {
                                Ok(json) => {
                                    if socket
                                        .send(Message::Text(json.into()))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                Err(error) => {
                                    eprintln!(
                                        "native protocol encode failed: {error}"
                                    );
                                }
                            }
                        }
                        frame = socket.next() => {
                            let Some(frame) = frame else {
                                break;
                            };

                            let frame = match frame {
                                Ok(frame) => frame,
                                Err(error) => {
                                    eprintln!(
                                        "native WebSocket read failed: {error}"
                                    );
                                    break;
                                }
                            };

                            match frame {
                                Message::Text(text) => {
                                    match serde_json::from_str::<ServerMessage>(
                                        text.as_str(),
                                    ) {
                                        Ok(message) => {
                                            if incoming_tx
                                                .send(message)
                                                .is_err()
                                            {
                                                let _ =
                                                    socket.close(None).await;
                                                break;
                                            }
                                        }
                                        Err(error) => {
                                            eprintln!(
                                                "native protocol decode failed: {error}"
                                            );
                                        }
                                    }
                                }
                                Message::Ping(payload) => {
                                    if socket
                                        .send(Message::Pong(payload))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    }
                }

                eprintln!("native network worker stopped");
            });
        })
        .context("failed to spawn native network thread")?;

    let welcome = ready_rx
        .recv()
        .context("native network thread ended before Welcome")?
        .map_err(anyhow::Error::msg)?;

    Ok(NativeSession {
        welcome,
        outbound: outbound_tx,
        incoming: incoming_rx,
    })
}

async fn open_selected_session(
    ws_url: String,
    session_token: String,
    character_id: game_types::EntityId,
) -> Result<(
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Box<WelcomePayload>,
)> {
    let (mut socket, response) =
        connect_async_with_config(ws_url.as_str(), None, true)
            .await
            .context("failed to connect to the game WebSocket")?;

    if response.status().as_u16() != 101 {
        bail!(
            "WebSocket upgrade failed with {}",
            response.status(),
        );
    }

    let hello = ClientMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
        client_version: "0.1.0-native-v36.30".to_owned(),
        session_token: Some(session_token),
        character_id: Some(character_id),
        character_name: None,
    };

    socket
        .send(Message::Text(
            serde_json::to_string(&hello)?.into(),
        ))
        .await
        .context("failed to send native Hello")?;

    while let Some(frame) = socket.next().await {
        let frame =
            frame.context("WebSocket failed during Welcome")?;

        match frame {
            Message::Text(text) => {
                let message: ServerMessage =
                    serde_json::from_str(text.as_str())
                        .context(
                            "server sent invalid protocol JSON",
                        )?;

                match message {
                    ServerMessage::Welcome { payload } => {
                        if payload.player.id != character_id {
                            bail!(
                                "server returned character {}, expected {}",
                                payload.player.id,
                                character_id,
                            );
                        }

                        return Ok((socket, payload));
                    }
                    ServerMessage::Error { code, message } => {
                        bail!("server error {code}: {message}");
                    }
                    _ => {}
                }
            }
            Message::Ping(payload) => {
                socket.send(Message::Pong(payload)).await?;
            }
            Message::Close(frame) => {
                bail!("server closed before Welcome: {frame:?}");
            }
            _ => {}
        }
    }

    bail!("WebSocket ended before Welcome")
}

#[allow(dead_code)]
pub fn connect_interactive() -> Result<NativeSession> {
    println!("Embers of Aldoria — Native client V{}", version::MIGRATION_VERSION);
    println!("--------------------------------------");

    let api_url = configured_api_url();
    let ws_url = configured_ws_url();

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

    let character_hint = env::var("ALDORIA_CHARACTER")
        .ok()
        .filter(|value| !value.trim().is_empty());

    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<Box<WelcomePayload>, String>>(1);
    let (incoming_tx, incoming_rx) = mpsc::channel::<ServerMessage>();
    let (outbound_tx, mut outbound_rx) = unbounded_channel::<ClientMessage>();

    thread::Builder::new()
        .name("aldoria-network".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!(
                        "failed to create network runtime: {error}"
                    )));
                    return;
                }
            };

            runtime.block_on(async move {
                let result = open_session(
                    api_url,
                    ws_url,
                    username,
                    password,
                    character_hint,
                )
                .await;

                let (mut socket, welcome) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = ready_tx.send(Err(format!("{error:#}")));
                        return;
                    }
                };

                if ready_tx.send(Ok(welcome)).is_err() {
                    return;
                }

                loop {
                    tokio::select! {
                        outgoing = outbound_rx.recv() => {
                            let Some(outgoing) = outgoing else {
                                let _ = socket.close(None).await;
                                break;
                            };
                            match serde_json::to_string(&outgoing) {
                                Ok(json) => {
                                    if socket.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(error) => {
                                    eprintln!("native protocol encode failed: {error}");
                                }
                            }
                        }
                        frame = socket.next() => {
                            let Some(frame) = frame else {
                                break;
                            };
                            let frame = match frame {
                                Ok(frame) => frame,
                                Err(error) => {
                                    eprintln!("native WebSocket read failed: {error}");
                                    break;
                                }
                            };

                            match frame {
                                Message::Text(text) => {
                                    match serde_json::from_str::<ServerMessage>(text.as_str()) {
                                        Ok(message) => {
                                            if incoming_tx.send(message).is_err() {
                                                let _ = socket.close(None).await;
                                                break;
                                            }
                                        }
                                        Err(error) => {
                                            eprintln!("native protocol decode failed: {error}");
                                        }
                                    }
                                }
                                Message::Ping(payload) => {
                                    if socket.send(Message::Pong(payload)).await.is_err() {
                                        break;
                                    }
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    }
                }

                eprintln!("native network worker stopped");
            });
        })
        .context("failed to spawn native network thread")?;

    let welcome = ready_rx
        .recv()
        .context("native network thread ended before Welcome")?
        .map_err(anyhow::Error::msg)?;

    Ok(NativeSession {
        welcome,
        outbound: outbound_tx,
        incoming: incoming_rx,
    })
}

#[allow(dead_code)]
async fn open_session(
    api_url: String,
    ws_url: String,
    username: String,
    password: String,
    character_hint: Option<String>,
) -> Result<(
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Box<WelcomePayload>,
)> {
    let http = reqwest::Client::builder()
        .user_agent(format!("Embers-of-Aldoria-Native/{}", version::MIGRATION_VERSION))
        .build()
        .context("failed to create HTTP client")?;

    let auth_response = http
        .post(format!("{api_url}/auth/login"))
        .json(&AuthCredentials { username, password })
        .send()
        .await
        .context("could not reach the login endpoint")?;
    let auth: AuthResponse = decode_api_response(auth_response, "login").await?;

    let characters_response = http
        .get(format!("{api_url}/characters"))
        .bearer_auth(&auth.session_token)
        .send()
        .await
        .context("could not reach the character endpoint")?;
    let characters: CharacterListResponse =
        decode_api_response(characters_response, "character list").await?;

    let character = choose_character(characters.characters, character_hint)?;
    println!(
        "Connecting as {} · level {} · {}:{}:{}",
        character.name,
        character.level,
        character.position.x,
        character.position.y,
        character.position.z,
    );

    let (mut socket, response) =
        connect_async_with_config(ws_url.as_str(), None, true)
            .await
            .context("failed to connect to the game WebSocket")?;

    // TIBIAGAME_V36_2_2_WEBSOCKET_101_FIX
    // A successful WebSocket HTTP upgrade is 101 Switching Protocols, not 2xx.
    // StatusCode::is_success() only covers 200..=299 and therefore rejected a
    // perfectly valid WebSocket connection.
    if response.status().as_u16() != 101 {
        bail!("WebSocket upgrade failed with {}", response.status());
    }

    let hello = ClientMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
        client_version: version::client_version(),
        session_token: Some(auth.session_token),
        character_id: Some(character.id),
        character_name: None,
    };
    socket
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await
        .context("failed to send native Hello")?;

    while let Some(frame) = socket.next().await {
        let frame = frame.context("WebSocket failed during Welcome")?;
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
                        println!(
                            "Welcome: {} · {}:{}:{} · map {}x{} · {} creatures",
                            payload.player.name,
                            payload.player.position.x,
                            payload.player.position.y,
                            payload.player.position.z,
                            payload.map.width,
                            payload.map.height,
                            payload.creatures.len(),
                        );
                        return Ok((socket, payload));
                    }
                    ServerMessage::Error { code, message } => {
                        bail!("server error {code}: {message}");
                    }
                    _ => {}
                }
            }
            Message::Ping(payload) => {
                socket.send(Message::Pong(payload)).await?;
            }
            Message::Close(frame) => {
                bail!("server closed before Welcome: {frame:?}");
            }
            _ => {}
        }
    }

    bail!("WebSocket ended before Welcome")
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

#[allow(dead_code)]
fn choose_character(
    characters: Vec<CharacterSummary>,
    character_hint: Option<String>,
) -> Result<CharacterSummary> {
    if characters.is_empty() {
        bail!("this account has no characters");
    }

    if let Some(wanted) = character_hint {
        let wanted = wanted.trim();
        return characters
            .into_iter()
            .find(|character| {
                character.name.eq_ignore_ascii_case(wanted)
                    || character.id.to_string().eq_ignore_ascii_case(wanted)
            })
            .with_context(|| format!("character '{wanted}' was not found"));
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

#[allow(dead_code)]
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
