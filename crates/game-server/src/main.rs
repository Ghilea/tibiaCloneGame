mod auth;
mod content;
mod persistence;
mod world;

use std::{
    env,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use game_protocol::{ClientMessage, ItemDestination, PROTOCOL_VERSION, ServerMessage};
use game_types::PlayerView;
use serde_json::json;
use tokio::sync::{RwLock, broadcast};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{debug, info, warn};
use uuid::Uuid;
use world::World;
use world::WorldEvent;

const WORLD_REGION_RADIUS: i32 = 48;
// Refresh from the last streamed center instead of toggling at global chunk
// borders. Half-radius hysteresis leaves 24 tiles of overlap and prevents a
// player walking back and forth across x/y=32 from rebuilding the client map.
const WORLD_REGION_REFRESH_DISTANCE: i32 = WORLD_REGION_RADIUS / 2;

#[derive(Clone)]
struct AppState {
    world: Arc<RwLock<World>>,
    events: broadcast::Sender<ServerEvent>,
    auth: auth::AuthService,
    database: Option<persistence::Database>,
}

#[derive(Debug, Clone)]
struct ServerEvent {
    recipient: Option<Uuid>,
    message: ServerMessage,
}

impl AppState {
    fn broadcast(&self, message: ServerMessage) {
        let _ = self.events.send(ServerEvent {
            recipient: None,
            message,
        });
    }

    fn private(&self, player_id: Uuid, message: ServerMessage) {
        let _ = self.events.send(ServerEvent {
            recipient: Some(player_id),
            message,
        });
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "game_server=debug,tower_http=info".into()),
        )
        .init();

    let startup_started = Instant::now();
    info!(progress = 0, "server startup: beginning");
    let content = content::ContentCatalog::load()?;
    info!(
        progress = 5,
        elapsed_ms = startup_started.elapsed().as_millis(),
        "server startup: game content validated"
    );
    let database = persistence::Database::connect_from_env().await?;
    info!(
        progress = 15,
        elapsed_ms = startup_started.elapsed().as_millis(),
        "server startup: persistence ready"
    );
    let ground_items = match &database {
        Some(database) => database.load_ground_items().await?,
        None => Vec::new(),
    };
    info!(
        progress = 20,
        elapsed_ms = startup_started.elapsed().as_millis(),
        ground_items = ground_items.len(),
        "server startup: persistent ground state loaded"
    );
    let (events, _) = broadcast::channel(256);
    let (world, loaded_world) = World::from_environment(content, ground_items)?;
    if let Some((name, path)) = loaded_world {
        info!(world = %name, %path, "custom world loaded");
    }
    info!(
        progress = 95,
        elapsed_ms = startup_started.elapsed().as_millis(),
        "server startup: runtime world created"
    );
    let state = AppState {
        world: Arc::new(RwLock::new(world)),
        events,
        auth: auth::AuthService::new(database.clone()),
        database,
    };
    tokio::spawn(world_loop(state.clone()));
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/status", get(status))
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/characters", get(characters).post(create_character))
        .route(
            "/api/characters/{character_id}",
            axum::routing::delete(delete_character),
        )
        .route("/ws", get(websocket))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let address = env::var("GAME_SERVER_ADDR").unwrap_or_else(|_| "127.0.0.1:4000".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    info!(progress = 100, elapsed_ms = startup_started.elapsed().as_millis(), %address, protocol_version = PROTOCOL_VERSION, "game server ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let online = state.world.read().await.views().len();
    Json(
        json!({ "name": "Embers of Aldoria", "protocolVersion": PROTOCOL_VERSION, "online": online, "database": state.auth.database_enabled() }),
    )
}

async fn register(
    State(state): State<AppState>,
    Json(credentials): Json<auth::Credentials>,
) -> Result<Json<auth::AuthResponse>, auth::ApiError> {
    state.auth.register(credentials).await.map(Json)
}

async fn login(
    State(state): State<AppState>,
    Json(credentials): Json<auth::Credentials>,
) -> Result<Json<auth::AuthResponse>, auth::ApiError> {
    state.auth.login(credentials).await.map(Json)
}

async fn characters(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<auth::CharacterListResponse>, auth::ApiError> {
    let token = bearer_token(&headers)?;
    let characters = state.auth.characters(token).await?;
    Ok(Json(auth::CharacterListResponse { characters }))
}

async fn create_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<auth::CreateCharacterRequest>,
) -> Result<(StatusCode, Json<auth::CharacterSummary>), auth::ApiError> {
    let token = bearer_token(&headers)?;
    let spawn = state.world.read().await.player_spawn();
    let character = state
        .auth
        .create_character(token, request.name, request.vocation, spawn)
        .await?;
    Ok((StatusCode::CREATED, Json(character)))
}

async fn delete_character(
    State(state): State<AppState>,
    Path(character_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, auth::ApiError> {
    let token = bearer_token(&headers)?;
    // Resolve ownership before exposing whether an id is currently online.
    state.auth.resolve_character(token, character_id).await?;
    if state.world.read().await.player(character_id).is_some() {
        return Err(auth::ApiError::character_online());
    }
    state.auth.delete_character(token, character_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, auth::ApiError> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(auth::ApiError::unauthorized)
}

async fn websocket(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| session(socket, state))
}

async fn session(mut socket: WebSocket, state: AppState) {
    let Some(Ok(Message::Text(raw))) = socket.next().await else {
        return;
    };
    let Ok(ClientMessage::Hello {
        protocol_version,
        client_version,
        session_token,
        character_id,
        character_name,
    }) = serde_json::from_str(&raw)
    else {
        send(
            &mut socket,
            &ServerMessage::Error {
                code: "hello_required".into(),
                message: "First message must be a valid hello".into(),
            },
        )
        .await;
        return;
    };
    if protocol_version != PROTOCOL_VERSION {
        send(
            &mut socket,
            &ServerMessage::Error {
                code: "protocol_mismatch".into(),
                message: format!("Server expects protocol {PROTOCOL_VERSION}"),
            },
        )
        .await;
        return;
    }
    let world_spawn = state.world.read().await.player_spawn();
    let (
        id,
        name,
        vocation,
        outfit,
        secondary_skills,
        position,
        level,
        experience,
        health,
        mana,
        max_mana,
        sword_skill,
        sword_tries,
        distance_skill,
        distance_tries,
        fletching_skill,
        fletching_tries,
        magic_level,
        magic_tries,
    ) = if state.auth.database_enabled() {
        let (Some(token), Some(character_id)) = (session_token, character_id) else {
            send(
                &mut socket,
                &ServerMessage::Error {
                    code: "authentication_required".into(),
                    message: "Log in and choose a character".into(),
                },
            )
            .await;
            return;
        };
        let Ok(character) = state.auth.resolve_character(&token, character_id).await else {
            send(
                &mut socket,
                &ServerMessage::Error {
                    code: "invalid_session".into(),
                    message: "The session or character is invalid".into(),
                },
            )
            .await;
            return;
        };
        let position = if character.spawn_initialized
            && state.world.read().await.is_walkable(character.position)
        {
            character.position
        } else {
            world_spawn
        };
        if position != character.position {
            state.auth.save_position(character.id, position).await;
            info!(
                character_id = %character.id,
                from = ?character.position,
                to = ?position,
                "repaired persisted character position"
            );
        }
        (
            character.id,
            character.name,
            character.vocation,
            character.outfit,
            character.secondary_skills,
            position,
            u32::try_from(character.level).unwrap_or(1),
            u64::try_from(character.experience).unwrap_or(0),
            u16::try_from(character.health).unwrap_or(150),
            u16::try_from(character.mana).unwrap_or(50),
            u16::try_from(character.max_mana).unwrap_or(50),
            u16::try_from(character.sword_skill).unwrap_or(10),
            u32::try_from(character.sword_tries).unwrap_or(0),
            u16::try_from(character.distance_skill).unwrap_or(10),
            u32::try_from(character.distance_tries).unwrap_or(0),
            u16::try_from(character.fletching_skill).unwrap_or(0),
            u32::try_from(character.fletching_tries).unwrap_or(0),
            u16::try_from(character.magic_level).unwrap_or(0),
            u32::try_from(character.magic_tries).unwrap_or(0),
        )
    } else {
        let name = sanitize_name(character_name.as_deref().unwrap_or_default());
        if name.is_empty() {
            send(
                &mut socket,
                &ServerMessage::Error {
                    code: "invalid_name".into(),
                    message: "Choose a name with 2-20 letters".into(),
                },
            )
            .await;
            return;
        }
        (
            Uuid::new_v4(),
            name,
            "adventurer".to_owned(),
            "knight".to_owned(),
            Vec::new(),
            world_spawn,
            1,
            0,
            150,
            50,
            50,
            10,
            0,
            10,
            0,
            0,
            0,
            0,
            0,
        )
    };

    let vocation_profile = game_types::vocation_profile(&vocation)
        .expect("persisted and ephemeral vocations are validated");

    if state.world.read().await.contains_player(id) {
        send(
            &mut socket,
            &ServerMessage::Error {
                code: "character_online".into(),
                message: "That character is already online".into(),
            },
        )
        .await;
        return;
    }
    let player = world::Player {
        view: PlayerView {
            id,
            name: name.clone(),
            vocation,
            outfit,
            secondary_skills,
            position,
            health: health.min(vocation_profile.max_health),
            max_health: vocation_profile.max_health,
            level,
            experience,
            mana: mana.min(vocation_profile.max_mana),
            max_mana: max_mana.min(vocation_profile.max_mana),
            sword_skill,
            sword_tries,
            distance_skill,
            distance_tries,
            fletching_skill,
            fletching_tries,
            magic_level,
            magic_tries,
        },
        inventory: match &state.database {
            Some(database) => match database.load_inventory(id).await {
                Ok(inventory) => inventory,
                Err(error) => {
                    warn!(%id, %error, "failed to load inventory");
                    send(
                        &mut socket,
                        &ServerMessage::Error {
                            code: "inventory_load_failed".into(),
                            message: "The inventory could not be loaded".into(),
                        },
                    )
                    .await;
                    return;
                }
            },
            None => Vec::new(),
        },
        depot: match &state.database {
            Some(database) => match database.load_depot(id, "greyhaven").await {
                Ok(depot) => depot,
                Err(error) => {
                    warn!(%id, %error, "failed to load depot");
                    send(
                        &mut socket,
                        &ServerMessage::Error {
                            code: "depot_load_failed".into(),
                            message: "The depot could not be loaded".into(),
                        },
                    )
                    .await;
                    return;
                }
            },
            None => Vec::new(),
        },
        max_capacity: f32::from(vocation_profile.capacity),
        last_move: Instant::now() - Duration::from_millis(165),
        last_attack: Instant::now() - Duration::from_millis(700),
        last_item_use: Instant::now() - Duration::from_millis(900),
        last_spell_cast: Instant::now() - Duration::from_millis(900),
        learned_spells: match &state.database {
            Some(database) => match database.load_spells(id).await {
                Ok(spells) => spells.into_iter().collect(),
                Err(error) => {
                    warn!(%id, %error, "failed to load learned spells");
                    send(
                        &mut socket,
                        &ServerMessage::Error {
                            code: "spells_load_failed".into(),
                            message: "Your learned spells could not be loaded".into(),
                        },
                    )
                    .await;
                    return;
                }
            },
            None => Default::default(),
        },
        learned_recipes: match &state.database {
            Some(database) => match database.load_recipes(id).await {
                Ok(recipes) => recipes.into_iter().collect(),
                Err(error) => {
                    warn!(%id, %error, "failed to load learned recipes");
                    send(
                        &mut socket,
                        &ServerMessage::Error {
                            code: "recipes_load_failed".into(),
                            message: "Your learned recipes could not be loaded".into(),
                        },
                    )
                    .await;
                    return;
                }
            },
            None => Default::default(),
        },
        crafting_queue: None,
        last_mana_regen: Instant::now(),
        active_food: None,
        last_food_regen: Instant::now(),
    };
    let (
        players,
        item_definitions,
        rune_recipes,
        spells,
        learned_spell_ids,
        learned_recipe_ids,
        inventory,
        depot,
        inventory_weight,
        max_capacity,
        ground_items,
        creatures,
        npcs,
        map,
    ) = {
        let mut world = state.world.write().await;
        let existing = world.views();
        world.insert_player(player.clone());
        let (inventory, weight, capacity) = world.inventory_state(id).expect("player inserted");
        let depot = world.depot_state(id).expect("player inserted");
        (
            existing,
            world.item_definitions(),
            world.rune_recipes(),
            world.spells(),
            world.learned_spells(id).expect("player inserted"),
            world.learned_recipes(id).expect("player inserted"),
            inventory,
            depot,
            weight,
            capacity,
            world.ground_items_near(position, WORLD_REGION_RADIUS),
            world.creature_views_near(position, WORLD_REGION_RADIUS),
            world.npc_views_near(position, WORLD_REGION_RADIUS),
            world.map_view_near(position, WORLD_REGION_RADIUS),
        )
    };
    info!(%id, %name, %client_version, "player connected");
    send(
        &mut socket,
        &ServerMessage::Welcome {
            protocol_version: PROTOCOL_VERSION,
            player: player.view.clone(),
            players,
            map,
            item_definitions,
            rune_recipes,
            spells,
            learned_spell_ids,
            learned_recipe_ids,
            inventory,
            depot,
            inventory_weight,
            max_capacity,
            ground_items,
            creatures,
            npcs,
        },
    )
    .await;
    state.broadcast(ServerMessage::PlayerJoined {
        player: player.view.clone(),
    });
    let mut streamed_region_center = position;

    let (mut outgoing, mut incoming) = socket.split();
    let mut events = state.events.subscribe();
    let writer = tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            if event.recipient.is_some_and(|recipient| recipient != id) {
                continue;
            }
            if let Ok(text) = serde_json::to_string(&event.message)
                && outgoing.send(Message::Text(text.into())).await.is_err()
            {
                break;
            }
        }
    });

    while let Some(Ok(message)) = incoming.next().await {
        let Message::Text(raw) = message else {
            continue;
        };
        match serde_json::from_str::<ClientMessage>(&raw) {
            Ok(ClientMessage::MoveRequest { sequence, position }) => {
                let result = state.world.write().await.try_move(id, position);
                match result {
                    Ok(position) => {
                        state.broadcast(ServerMessage::PlayerMoved {
                            player_id: id,
                            position,
                            sequence,
                        });
                        if should_refresh_world_region(streamed_region_center, position) {
                            let world = state.world.read().await;
                            let message = world
                                .requires_region_streaming(WORLD_REGION_RADIUS)
                                .then(|| ServerMessage::WorldRegion {
                                    map: world.map_view_near(position, WORLD_REGION_RADIUS),
                                    ground_items: world
                                        .ground_items_near(position, WORLD_REGION_RADIUS),
                                    creatures: world
                                        .creature_views_near(position, WORLD_REGION_RADIUS),
                                    npcs: world.npc_views_near(position, WORLD_REGION_RADIUS),
                                });
                            drop(world);
                            if let Some(message) = message {
                                state.private(id, message);
                            }
                            streamed_region_center = position;
                        }
                    }
                    Err(reason) => {
                        let world = state.world.read().await;
                        let position = world
                            .player(id)
                            .map(|p| p.view.position)
                            .unwrap_or_else(|| world.player_spawn());
                        drop(world);
                        state.private(
                            id,
                            ServerMessage::MoveRejected {
                                player_id: id,
                                position,
                                sequence,
                                reason: reason.into(),
                            },
                        );
                    }
                }
            }
            Ok(ClientMessage::ToggleDoor { door_id }) => {
                match state.world.write().await.toggle_door(id, &door_id) {
                    Ok(door) => state.broadcast(ServerMessage::DoorChanged { door }),
                    Err(reason) => state.private(
                        id,
                        ServerMessage::Error {
                            code: reason.into(),
                            message: match reason {
                                "door_out_of_reach" => "Move closer to use that door",
                                "door_occupied" => {
                                    "The door cannot close while something is in the doorway"
                                }
                                _ => "That door cannot be used",
                            }
                            .into(),
                        },
                    ),
                }
            }
            Ok(ClientMessage::ToggleWindow { window_id }) => {
                match state.world.write().await.toggle_window(id, &window_id) {
                    Ok(window) => state.broadcast(ServerMessage::WindowChanged { window }),
                    Err(reason) => state.private(
                        id,
                        ServerMessage::Error {
                            code: reason.into(),
                            message: if reason == "window_out_of_reach" {
                                "Move closer to use those shutters"
                            } else {
                                "Those shutters cannot be used"
                            }
                            .into(),
                        },
                    ),
                }
            }
            Ok(ClientMessage::Say { text }) if !text.trim().is_empty() => {
                let text: String = text.trim().chars().take(160).collect();
                state.broadcast(ServerMessage::Spoken {
                    player_id: id,
                    player_name: name.clone(),
                    text,
                });
            }
            Ok(ClientMessage::Ping { sent_at }) => {
                state.private(
                    id,
                    ServerMessage::Pong {
                        player_id: id,
                        sent_at,
                    },
                );
            }
            Ok(ClientMessage::SetOutfit { outfit }) => {
                if !matches!(outfit.as_str(), "knight" | "mage" | "ranger" | "rogue") {
                    state.private(
                        id,
                        ServerMessage::Error {
                            code: "invalid_outfit".into(),
                            message: "That outfit is not available".into(),
                        },
                    );
                    continue;
                }
                if let Some(database) = &state.database
                    && let Err(error) = database.save_outfit(id, &outfit).await
                {
                    warn!(%id, %error, "could not save character outfit");
                    state.private(
                        id,
                        ServerMessage::Error {
                            code: "outfit_save_failed".into(),
                            message: "The outfit could not be saved".into(),
                        },
                    );
                    continue;
                }
                if state
                    .world
                    .write()
                    .await
                    .set_player_outfit(id, outfit.clone())
                    .is_ok()
                {
                    state.broadcast(ServerMessage::PlayerOutfitChanged {
                        player_id: id,
                        outfit,
                    });
                }
            }
            Ok(ClientMessage::SetSecondarySkills { skills }) => {
                if !game_types::valid_secondary_skills(&skills) {
                    state.private(
                        id,
                        ServerMessage::Error {
                            code: "invalid_secondary_skills".into(),
                            message: "Choose no more than two different secondary skills".into(),
                        },
                    );
                    continue;
                }
                if let Some(database) = &state.database
                    && let Err(error) = database.save_secondary_skills(id, &skills).await
                {
                    warn!(%id, %error, "could not save secondary skills");
                    state.private(
                        id,
                        ServerMessage::Error {
                            code: "secondary_skills_save_failed".into(),
                            message: "Your secondary skills could not be saved".into(),
                        },
                    );
                    continue;
                }
                if state
                    .world
                    .write()
                    .await
                    .set_player_secondary_skills(id, skills.clone())
                    .is_ok()
                {
                    state.broadcast(ServerMessage::PlayerSecondarySkillsChanged {
                        player_id: id,
                        skills,
                    });
                }
            }
            Ok(ClientMessage::PickupItem { instance_id }) => {
                mutate_item_state(&state, id, ItemMutation::Pickup(instance_id)).await
            }
            Ok(ClientMessage::DropItem { instance_id }) => {
                mutate_item_state(&state, id, ItemMutation::Drop(instance_id)).await
            }
            Ok(ClientMessage::MoveItem {
                instance_id,
                destination,
            }) => mutate_item_state(&state, id, ItemMutation::Move(instance_id, destination)).await,
            Ok(ClientMessage::SplitItem {
                instance_id,
                quantity,
            }) => mutate_item_state(&state, id, ItemMutation::Split(instance_id, quantity)).await,
            Ok(ClientMessage::AttackRequest { target_id }) => {
                attack_target(&state, id, target_id).await
            }
            Ok(ClientMessage::UseItem {
                instance_id,
                target_id,
            }) => use_combat_item(&state, id, instance_id, target_id).await,
            Ok(ClientMessage::EatItem { instance_id }) => eat_item(&state, id, instance_id).await,
            Ok(ClientMessage::RequestTrade { target_id }) => {
                request_trade(&state, id, target_id).await
            }
            Ok(ClientMessage::RespondTrade { trade_id, accept }) => {
                respond_trade(&state, id, trade_id, accept).await
            }
            Ok(ClientMessage::SetTradeOffer { trade_id, item_ids }) => {
                set_trade_offer(&state, id, trade_id, item_ids).await
            }
            Ok(ClientMessage::ConfirmTrade { trade_id }) => {
                confirm_trade(&state, id, trade_id).await
            }
            Ok(ClientMessage::CancelTrade { trade_id }) => cancel_trade(&state, id, trade_id).await,
            Ok(ClientMessage::BuyFromNpc {
                npc_id,
                offer_id,
                quantity,
            }) => buy_from_npc(&state, id, &npc_id, &offer_id, quantity).await,
            Ok(ClientMessage::DepositItem {
                npc_id,
                instance_id,
            }) => move_depot_item(&state, id, &npc_id, instance_id, true).await,
            Ok(ClientMessage::WithdrawItem {
                npc_id,
                instance_id,
            }) => move_depot_item(&state, id, &npc_id, instance_id, false).await,
            Ok(ClientMessage::LearnSpell { npc_id, spell_id }) => {
                learn_spell(&state, id, &npc_id, &spell_id).await
            }
            Ok(ClientMessage::LearnRecipeFromNpc { npc_id, recipe_id }) => {
                learn_recipe(&state, id, Some(&npc_id), Some(&recipe_id), None).await
            }
            Ok(ClientMessage::LearnRecipeFromItem { instance_id }) => {
                learn_recipe(&state, id, None, None, Some(instance_id)).await
            }
            Ok(ClientMessage::CastSpell {
                spell_id,
                target_id,
            }) => cast_spell(&state, id, &spell_id, target_id).await,
            Ok(ClientMessage::StartRuneCrafting {
                recipe_id,
                quantity,
            }) => start_rune_crafting(&state, id, &recipe_id, quantity).await,
            Ok(ClientMessage::CancelRuneCrafting) => cancel_rune_crafting(&state, id).await,
            Ok(ClientMessage::Hello { .. } | ClientMessage::Say { .. }) => {}
            Err(error) => warn!(%id, %error, "invalid client message"),
        }
    }

    writer.abort();
    let final_player = state
        .world
        .read()
        .await
        .player(id)
        .map(|player| player.view.clone());
    if let Some(player) = final_player {
        state.auth.save_position(id, player.position).await;
        if let Some(database) = &state.database
            && let Err(error) = database
                .save_progression(
                    id,
                    player.level,
                    player.experience,
                    player.health,
                    player.mana,
                    player.sword_skill,
                    player.sword_tries,
                    player.distance_skill,
                    player.distance_tries,
                    player.fletching_skill,
                    player.fletching_tries,
                    player.magic_level,
                    player.magic_tries,
                )
                .await
        {
            warn!(%id, %error, "failed to save progression on disconnect");
        }
    }
    let cancelled_trade = state.world.write().await.cancel_trade_for_player(id);
    if let Some((trade_id, partner_id)) = cancelled_trade {
        state.private(
            partner_id,
            ServerMessage::TradeClosed {
                trade_id,
                reason: "partner_disconnected".into(),
            },
        );
    }
    state.world.write().await.remove_player(id);
    state.broadcast(ServerMessage::PlayerLeft { player_id: id });
    info!(%id, "player disconnected");
}

fn should_refresh_world_region(from: game_types::Position, current: game_types::Position) -> bool {
    from.z != current.z
        || (current.x - from.x).abs() >= WORLD_REGION_REFRESH_DISTANCE
        || (current.y - from.y).abs() >= WORLD_REGION_REFRESH_DISTANCE
}

enum ItemMutation {
    Pickup(Uuid),
    Drop(Uuid),
    Move(Uuid, ItemDestination),
    Split(Uuid, u16),
}

async fn request_trade(state: &AppState, requester_id: Uuid, target_id: Uuid) {
    let mut world = state.world.write().await;
    let trade_id = match world.request_trade(requester_id, target_id) {
        Ok(trade_id) => trade_id,
        Err(reason) => {
            send_trade_error(state, requester_id, reason);
            return;
        }
    };
    let views = world.trade_views(trade_id).expect("new trade has views");
    let requester = views[1].partner.clone();
    send_trade_view(state, &views[0]);
    state.private(
        target_id,
        ServerMessage::TradeRequested {
            trade_id,
            requester,
        },
    );
}

async fn respond_trade(state: &AppState, player_id: Uuid, trade_id: Uuid, accept: bool) {
    let mut world = state.world.write().await;
    match world.respond_trade(player_id, trade_id, accept) {
        Ok(world::TradeOutcome::Updated) => {
            let views = world.trade_views(trade_id).expect("active trade has views");
            send_trade_views(state, &views);
        }
        Ok(world::TradeOutcome::Cancelled { player_a, player_b }) => {
            send_trade_closed(state, trade_id, player_a, player_b, "declined");
        }
        Ok(world::TradeOutcome::Completed { .. }) => unreachable!(),
        Err(reason) => send_trade_error(state, player_id, reason),
    }
}

async fn set_trade_offer(state: &AppState, player_id: Uuid, trade_id: Uuid, item_ids: Vec<Uuid>) {
    let mut world = state.world.write().await;
    match world.set_trade_offer(player_id, trade_id, item_ids) {
        Ok(()) => {
            let views = world.trade_views(trade_id).expect("active trade has views");
            send_trade_views(state, &views);
        }
        Err(reason) => send_trade_error(state, player_id, reason),
    }
}

async fn confirm_trade(state: &AppState, player_id: Uuid, trade_id: Uuid) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    match world.confirm_trade(player_id, trade_id) {
        Ok(world::TradeOutcome::Updated) => {
            let views = world.trade_views(trade_id).expect("active trade has views");
            send_trade_views(state, &views);
        }
        Ok(world::TradeOutcome::Completed { player_a, player_b }) => {
            let (inventory_a, weight_a, capacity_a) = world
                .inventory_state(player_a)
                .expect("trade player exists");
            let (inventory_b, weight_b, capacity_b) = world
                .inventory_state(player_b)
                .expect("trade player exists");
            if let Some(database) = &state.database
                && let Err(error) = database
                    .persist_trade_state(
                        player_a,
                        &inventory_a,
                        player_b,
                        &inventory_b,
                        world.ground_items(),
                    )
                    .await
            {
                *world = backup;
                warn!(%trade_id, %error, "trade transaction rolled back");
                send_trade_error(state, player_id, "trade_transaction_failed");
                if let Some(views) = world.trade_views(trade_id) {
                    send_trade_views(state, &views);
                }
                return;
            }
            drop(world);
            state.private(
                player_a,
                ServerMessage::InventoryChanged {
                    player_id: player_a,
                    inventory: inventory_a,
                    inventory_weight: weight_a,
                    max_capacity: capacity_a,
                },
            );
            state.private(
                player_b,
                ServerMessage::InventoryChanged {
                    player_id: player_b,
                    inventory: inventory_b,
                    inventory_weight: weight_b,
                    max_capacity: capacity_b,
                },
            );
            send_trade_closed(state, trade_id, player_a, player_b, "completed");
        }
        Ok(world::TradeOutcome::Cancelled { .. }) => unreachable!(),
        Err(reason) => send_trade_error(state, player_id, reason),
    }
}

async fn cancel_trade(state: &AppState, player_id: Uuid, trade_id: Uuid) {
    let mut world = state.world.write().await;
    match world.cancel_trade(player_id, trade_id) {
        Ok(world::TradeOutcome::Cancelled { player_a, player_b }) => {
            send_trade_closed(state, trade_id, player_a, player_b, "cancelled");
        }
        Ok(_) => unreachable!(),
        Err(reason) => send_trade_error(state, player_id, reason),
    }
}

fn send_trade_views(state: &AppState, views: &[world::TradeView; 2]) {
    send_trade_view(state, &views[0]);
    send_trade_view(state, &views[1]);
}

fn send_trade_view(state: &AppState, view: &world::TradeView) {
    state.private(
        view.recipient_id,
        ServerMessage::TradeState {
            trade_id: view.trade_id,
            partner: view.partner.clone(),
            your_offer: view.your_offer.clone(),
            their_offer: view.their_offer.clone(),
            you_confirmed: view.you_confirmed,
            partner_confirmed: view.partner_confirmed,
            status: view.status.into(),
        },
    );
}

fn send_trade_closed(
    state: &AppState,
    trade_id: Uuid,
    player_a: Uuid,
    player_b: Uuid,
    reason: &str,
) {
    for player_id in [player_a, player_b] {
        state.private(
            player_id,
            ServerMessage::TradeClosed {
                trade_id,
                reason: reason.into(),
            },
        );
    }
}

fn send_trade_error(state: &AppState, player_id: Uuid, code: &str) {
    let message = match code {
        "trade_target_offline" => "That player is no longer online",
        "trade_target_too_far" => "Move closer to trade",
        "already_trading" => "You already have an open trade",
        "trade_target_busy" => "That player is already trading",
        "item_not_tradeable" => "Move that item to your main inventory before offering it",
        "item_locked_in_trade" => "That item is locked in your trade offer",
        "trade_capacity_exceeded" => "The trade would exceed a carrying limit",
        "trade_transaction_failed" => "The trade could not be saved and was rolled back",
        _ => "The trade action could not be completed",
    };
    state.private(
        player_id,
        ServerMessage::Error {
            code: code.into(),
            message: message.into(),
        },
    );
}

async fn attack_target(state: &AppState, player_id: Uuid, target_id: Uuid) {
    let mut world = state.world.write().await;
    let inventory_before = world
        .player(player_id)
        .map(|player| player.inventory.clone())
        .unwrap_or_default();
    let backup = world.combat_state_backup(player_id, target_id);
    let events = match world.try_attack(player_id, target_id) {
        Ok(events) => events,
        Err("attack_cooldown" | "target_out_of_range" | "creature_evading") => return,
        Err(reason) => {
            state.private(
                player_id,
                ServerMessage::Error {
                    code: reason.into(),
                    message: attack_error_message(reason).into(),
                },
            );
            return;
        }
    };
    let inventory_changed =
        world.player(player_id).expect("active player").inventory != inventory_before;
    let combat_must_persist = inventory_changed
        || events
            .iter()
            .any(|event| matches!(event, WorldEvent::CreatureDied { .. }));
    let player = world.player(player_id).expect("active player").view.clone();
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    if combat_must_persist && let Some(database) = &state.database {
        let ground = world.ground_items().to_vec();
        if let Err(error) = database
            .persist_combat_state(&player, &inventory, &ground)
            .await
        {
            if let Some(backup) = backup {
                world.restore_combat_state(backup);
            }
            warn!(%player_id, %error, "combat transaction rolled back");
            state.private(
                player_id,
                ServerMessage::Error {
                    code: "combat_transaction_failed".into(),
                    message: "The combat result could not be saved".into(),
                },
            );
            return;
        }
    }
    drop(world);
    if inventory_changed {
        state.private(
            player_id,
            ServerMessage::InventoryChanged {
                player_id,
                inventory,
                inventory_weight,
                max_capacity,
            },
        );
    }
    dispatch_world_events(state, events).await;
}

fn attack_error_message(code: &str) -> &'static str {
    match code {
        "out_of_ammunition" => "You need the correct ammunition for your equipped weapon",
        "line_of_sight_blocked" => "A wall blocks your shot",
        "target_not_found" => "Select a living target first",
        _ => "That target cannot be attacked",
    }
}

async fn use_combat_item(state: &AppState, player_id: Uuid, instance_id: Uuid, target_id: Uuid) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let events = match world.try_use_item(player_id, instance_id, target_id) {
        Ok(events) => events,
        Err("item_cooldown") => return,
        Err(reason) => {
            state.private(
                player_id,
                ServerMessage::Error {
                    code: reason.into(),
                    message: combat_item_error_message(reason).into(),
                },
            );
            return;
        }
    };
    let player = world.player(player_id).expect("active player").view.clone();
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_combat_state(&player, &inventory, world.ground_items())
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "combat item transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "combat_transaction_failed".into(),
                message: "The sigil could not be used safely".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    dispatch_world_events(state, events).await;
}

async fn eat_item(state: &AppState, player_id: Uuid, instance_id: Uuid) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let (player, remaining_ms) = match world.try_eat(player_id, instance_id) {
        Ok(result) => result,
        Err(reason) => {
            state.private(
                player_id,
                ServerMessage::Error {
                    code: reason.into(),
                    message: match reason {
                        "item_not_food" => "That cannot be eaten",
                        "item_locked_in_trade" => "That item is currently offered in a trade",
                        _ => "You cannot eat that item",
                    }
                    .into(),
                },
            );
            return;
        }
    };
    let (inventory, inventory_weight, max_capacity) = world
        .inventory_state(player_id)
        .expect("active player after eating");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_combat_state(&player, &inventory, world.ground_items())
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "food transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "food_transaction_failed".into(),
                message: "The food could not be consumed safely".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    state.private(
        player_id,
        ServerMessage::FoodStatus {
            player_id,
            remaining_ms,
        },
    );
}

fn combat_item_error_message(code: &str) -> &'static str {
    match code {
        "item_not_owned" => "That sigil is no longer in your inventory",
        "item_not_usable" | "item_has_no_charges" => "That item cannot be used in combat",
        "target_not_found" => "Select a living target first",
        "target_out_of_range" => "The target is out of sigil range",
        "creature_evading" => "The creature is evading and cannot be harmed",
        _ => "The sigil could not be used",
    }
}

async fn buy_from_npc(
    state: &AppState,
    player_id: Uuid,
    npc_id: &str,
    offer_id: &str,
    quantity: u16,
) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    if let Err(reason) = world.buy_from_npc(player_id, npc_id, offer_id, quantity) {
        state.private(
            player_id,
            ServerMessage::Error {
                code: reason.into(),
                message: shop_error_message(reason).into(),
            },
        );
        return;
    }
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_item_state(player_id, &inventory, world.ground_items())
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "NPC purchase transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "shop_transaction_failed".into(),
                message: "The purchase could not be saved".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
}

fn shop_error_message(code: &str) -> &'static str {
    match code {
        "npc_out_of_reach" => "Move next to the merchant before buying",
        "not_enough_gold" => "You do not have enough Gold Coins",
        "shop_capacity_exceeded" => "You cannot carry that purchase",
        "invalid_shop_quantity" => "Choose between 1 and 20 bundles",
        "cannot_shop_while_trading" => "Finish or cancel your trade before shopping",
        "npc_not_found" | "shop_offer_not_found" => "That offer is no longer available",
        _ => "The purchase could not be completed",
    }
}

async fn learn_spell(state: &AppState, player_id: Uuid, npc_id: &str, spell_id: &str) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    if let Err(reason) = world.learn_spell(player_id, npc_id, spell_id) {
        state.private(
            player_id,
            ServerMessage::Error {
                code: reason.into(),
                message: spell_learning_error_message(reason).into(),
            },
        );
        return;
    }
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    let learned_spell_ids = world.learned_spells(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_spell_learning(player_id, &inventory, spell_id)
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "spell learning transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "spell_learning_transaction_failed".into(),
                message: "The lesson could not be saved; no gold was spent".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    state.private(
        player_id,
        ServerMessage::SpellsChanged {
            player_id,
            learned_spell_ids,
        },
    );
}

async fn learn_recipe(
    state: &AppState,
    player_id: Uuid,
    npc_id: Option<&str>,
    recipe_id: Option<&str>,
    instance_id: Option<Uuid>,
) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let learned_recipe_id = match (npc_id, recipe_id, instance_id) {
        (Some(npc_id), Some(recipe_id), None) => world
            .learn_recipe_from_npc(player_id, npc_id, recipe_id)
            .map(|()| recipe_id.to_owned()),
        (None, None, Some(instance_id)) => world.learn_recipe_from_item(player_id, instance_id),
        _ => Err("invalid_recipe_source"),
    };
    let learned_recipe_id = match learned_recipe_id {
        Ok(recipe_id) => recipe_id,
        Err(reason) => {
            state.private(
                player_id,
                ServerMessage::Error {
                    code: reason.into(),
                    message: recipe_learning_error_message(reason).into(),
                },
            );
            return;
        }
    };
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    let learned_recipe_ids = world.learned_recipes(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_recipe_learning(player_id, &inventory, &learned_recipe_id)
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "recipe learning transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "recipe_learning_transaction_failed".into(),
                message: "The recipe could not be saved; nothing was consumed".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    state.private(
        player_id,
        ServerMessage::RecipesChanged {
            player_id,
            learned_recipe_ids,
        },
    );
}

fn recipe_learning_error_message(code: &str) -> &'static str {
    match code {
        "npc_out_of_reach" => "Move next to the crafting trainer first",
        "not_enough_gold" => "You do not have enough Gold Coins for this lesson",
        "recipe_already_learned" => "You have already learned that recipe",
        "cannot_learn_while_trading" => "Finish or cancel your trade before learning a recipe",
        "item_does_not_teach_recipe" => "That item does not contain a recipe",
        _ => "That recipe cannot be learned here",
    }
}

fn spell_learning_error_message(code: &str) -> &'static str {
    match code {
        "npc_out_of_reach" => "Move next to the spell trainer first",
        "not_enough_gold" => "You do not have enough Gold Coins for this lesson",
        "spell_already_learned" => "You have already learned that spell",
        "vocation_cannot_learn_spell" => "Your vocation cannot learn that spell",
        "cannot_learn_while_trading" => "Finish or cancel your trade before learning a spell",
        _ => "That spell cannot be learned here",
    }
}

async fn cast_spell(state: &AppState, player_id: Uuid, spell_id: &str, target_id: Uuid) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let events = match world.try_cast_spell(player_id, spell_id, target_id) {
        Ok(events) => events,
        Err("spell_cooldown") => return,
        Err(reason) => {
            state.private(
                player_id,
                ServerMessage::Error {
                    code: reason.into(),
                    message: spell_cast_error_message(reason).into(),
                },
            );
            return;
        }
    };
    let player = world.player(player_id).expect("active player").view.clone();
    let (inventory, _, _) = world.inventory_state(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_combat_state(&player, &inventory, world.ground_items())
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "spell transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "spell_transaction_failed".into(),
                message: "The spell could not be cast safely".into(),
            },
        );
        return;
    }
    drop(world);
    dispatch_world_events(state, events).await;
}

fn spell_cast_error_message(code: &str) -> &'static str {
    match code {
        "spell_not_learned" => "You have not learned that spell",
        "not_enough_mana" => "You do not have enough mana",
        "target_not_found" => "Select a living target first",
        "target_out_of_range" => "The target is out of spell range",
        "line_of_sight_blocked" => "A wall blocks your spell",
        "creature_evading" => "The creature is evading and cannot be harmed",
        _ => "The spell could not be cast",
    }
}

async fn move_depot_item(
    state: &AppState,
    player_id: Uuid,
    npc_id: &str,
    instance_id: Uuid,
    deposit: bool,
) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let result = if deposit {
        world.deposit_item(player_id, npc_id, instance_id)
    } else {
        world.withdraw_item(player_id, npc_id, instance_id)
    };
    if let Err(reason) = result {
        state.private(
            player_id,
            ServerMessage::Error {
                code: reason.into(),
                message: depot_error_message(reason).into(),
            },
        );
        return;
    }
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    let depot = world.depot_state(player_id).expect("active player");
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_depot_state(player_id, "greyhaven", &inventory, &depot)
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "depot transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "depot_transaction_failed".into(),
                message: "The depot transfer could not be saved".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    state.private(player_id, ServerMessage::DepotChanged { player_id, depot });
}

fn depot_error_message(code: &str) -> &'static str {
    match code {
        "npc_out_of_reach" => "Move next to the vaultkeeper to use your depot",
        "item_not_owned" | "depot_item_not_found" => "That item is no longer available",
        "depot_requires_root_item" => "Move the item to your main inventory first",
        "item_locked_in_trade" | "cannot_use_depot_while_trading" => {
            "Finish or cancel your trade before using the depot"
        }
        "depot_full" => "Your Greyhaven depot is full",
        "too_heavy" => "You cannot carry that item",
        "depot_not_found" => "That vault is not available",
        _ => "The depot transfer could not be completed",
    }
}

async fn start_rune_crafting(state: &AppState, player_id: Uuid, recipe_id: &str, quantity: u16) {
    let result = state
        .world
        .write()
        .await
        .start_crafting(player_id, recipe_id, quantity);
    match result {
        Ok(update) => send_crafting_update(state, update).await,
        Err(reason) => state.private(
            player_id,
            ServerMessage::Error {
                code: reason.into(),
                message: crafting_error_message(reason).into(),
            },
        ),
    }
}

async fn cancel_rune_crafting(state: &AppState, player_id: Uuid) {
    if let Ok(update) = state.world.write().await.cancel_crafting(player_id) {
        send_crafting_update(state, update).await;
    }
}

async fn process_crafting(state: &AppState) {
    let mut world = state.world.write().await;
    // Crafting only mutates players (mana, queue and inventory). Copying the
    // complete map here used to freeze a large world four times per second.
    let backup = world.player_state_backup();
    let updates = world.tick_crafting();
    for update in &updates {
        if update.inventory_changed
            && let Some(database) = &state.database
        {
            let (inventory, _, _) = world
                .inventory_state(update.player.id)
                .expect("crafting player exists");
            if let Err(error) = database
                .persist_crafting_state(&update.player, &inventory, world.ground_items())
                .await
            {
                world.restore_player_state(backup);
                warn!(player_id = %update.player.id, %error, "crafting transaction rolled back");
                state.private(
                    update.player.id,
                    ServerMessage::Error {
                        code: "crafting_transaction_failed".into(),
                        message: "Sigil crafting could not be saved".into(),
                    },
                );
                return;
            }
        }
    }
    drop(world);
    for update in updates {
        send_crafting_update(state, update).await;
    }
}

async fn send_crafting_update(state: &AppState, update: world::CraftingUpdate) {
    state.private(
        update.player.id,
        ServerMessage::PlayerStatsChanged {
            player_id: update.player.id,
            health: update.player.health,
            max_health: update.player.max_health,
            level: update.player.level,
            experience: update.player.experience,
            mana: update.player.mana,
            max_mana: update.player.max_mana,
            sword_skill: update.player.sword_skill,
            sword_tries: update.player.sword_tries,
            distance_skill: update.player.distance_skill,
            distance_tries: update.player.distance_tries,
            fletching_skill: update.player.fletching_skill,
            fletching_tries: update.player.fletching_tries,
            magic_level: update.player.magic_level,
            magic_tries: update.player.magic_tries,
        },
    );
    if update.inventory_changed {
        let world = state.world.read().await;
        if let Some((inventory, inventory_weight, max_capacity)) =
            world.inventory_state(update.player.id)
        {
            state.private(
                update.player.id,
                ServerMessage::InventoryChanged {
                    player_id: update.player.id,
                    inventory,
                    inventory_weight,
                    max_capacity,
                },
            );
        }
    }
    state.private(
        update.player.id,
        ServerMessage::RuneCraftingChanged {
            player_id: update.player.id,
            recipe_id: update.recipe_id,
            remaining: update.remaining,
            status: update.status.into(),
        },
    );
}

fn crafting_error_message(code: &str) -> &'static str {
    match code {
        "cannot_craft_while_trading" => "Finish or cancel your trade before crafting",
        "vocation_cannot_craft_sigils" => "Only Mages and Druids can craft sigils",
        "missing_craft_material" => "You do not have enough crafting materials",
        "invalid_craft_quantity" => "Choose between 1 and 20 sigils",
        "unknown_rune_recipe" => "That recipe does not exist",
        _ => "Sigil crafting could not be started",
    }
}

async fn world_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    let mut next_performance_sample = Instant::now();
    loop {
        interval.tick().await;
        let cycle_started = Instant::now();
        let events = {
            let mut world = state.world.write().await;
            // Only ground items participate in the persistence transaction.
            // Cloning the complete world also cloned a multi-hundred-megabyte
            // map every 250 ms and stalled movement while holding this lock.
            let ground_backup = world.ground_state_backup();
            let mut events = world.tick();
            let ground_changed = events
                .iter()
                .any(|event| matches!(event, WorldEvent::GroundItemsChanged(_)));
            if ground_changed
                && let Some(database) = &state.database
                && let Err(error) = database.persist_ground_items(world.ground_items()).await
            {
                world.restore_ground_state(ground_backup);
                events.retain(|event| !matches!(event, WorldEvent::GroundItemsChanged(_)));
                warn!(%error, "corpse decay transaction rolled back");
            }
            events
        };
        dispatch_world_events(&state, events).await;
        process_crafting(&state).await;
        let cycle_ms = cycle_started.elapsed().as_millis();
        if cycle_ms >= 200 {
            warn!(cycle_ms, "slow world cycle");
        }
        if Instant::now() >= next_performance_sample {
            debug!(cycle_ms, "world performance sample");
            next_performance_sample = Instant::now() + Duration::from_secs(5);
        }
    }
}

async fn dispatch_world_events(state: &AppState, events: Vec<WorldEvent>) {
    for event in events {
        match event {
            WorldEvent::CombatEffect {
                source_id,
                target_id,
                effect_id,
                damage,
                cooldown_ms,
            } => state.broadcast(ServerMessage::CombatEffect {
                source_id,
                target_id,
                effect_id,
                damage,
                cooldown_ms,
            }),
            WorldEvent::AreaTelegraph {
                source_id,
                position,
                effect_id,
                radius,
                duration_ms,
            } => state.broadcast(ServerMessage::AreaTelegraph {
                source_id,
                position,
                effect_id,
                radius,
                duration_ms,
            }),
            WorldEvent::CreatureSpawned(creature) => {
                state.broadcast(ServerMessage::CreatureSpawned { creature })
            }
            WorldEvent::CreatureMoved {
                creature_id,
                position,
            } => state.broadcast(ServerMessage::CreatureMoved {
                creature_id,
                position,
            }),
            WorldEvent::CreatureStateChanged {
                creature_id,
                state: creature_state,
                immune,
                health,
                max_health,
            } => state.broadcast(ServerMessage::CreatureStateChanged {
                creature_id,
                state: creature_state.into(),
                immune,
                health,
                max_health,
            }),
            WorldEvent::CreatureDamaged {
                creature_id,
                health,
                max_health,
                damage,
            } => state.broadcast(ServerMessage::CreatureDamaged {
                creature_id,
                health,
                max_health,
                damage,
            }),
            WorldEvent::CreatureDied {
                creature_id,
                killer_id,
                experience,
            } => state.broadcast(ServerMessage::CreatureDied {
                creature_id,
                killer_id,
                experience,
            }),
            WorldEvent::PlayerStats(player) => {
                if let Some(database) = &state.database
                    && let Err(error) = database
                        .save_progression(
                            player.id,
                            player.level,
                            player.experience,
                            player.health,
                            player.mana,
                            player.sword_skill,
                            player.sword_tries,
                            player.distance_skill,
                            player.distance_tries,
                            player.fletching_skill,
                            player.fletching_tries,
                            player.magic_level,
                            player.magic_tries,
                        )
                        .await
                {
                    warn!(player_id = %player.id, %error, "failed to persist player stats");
                }
                state.broadcast(ServerMessage::PlayerStatsChanged {
                    player_id: player.id,
                    health: player.health,
                    max_health: player.max_health,
                    level: player.level,
                    experience: player.experience,
                    mana: player.mana,
                    max_mana: player.max_mana,
                    sword_skill: player.sword_skill,
                    sword_tries: player.sword_tries,
                    distance_skill: player.distance_skill,
                    distance_tries: player.distance_tries,
                    fletching_skill: player.fletching_skill,
                    fletching_tries: player.fletching_tries,
                    magic_level: player.magic_level,
                    magic_tries: player.magic_tries,
                });
            }
            WorldEvent::PlayerDied {
                player_id,
                killer_id,
            } => {
                let world = state.world.read().await;
                let respawn_position = world
                    .player(player_id)
                    .map(|player| player.view.position)
                    .unwrap_or_else(|| world.player_spawn());
                drop(world);
                state.auth.save_position(player_id, respawn_position).await;
                state.broadcast(ServerMessage::PlayerDied {
                    player_id,
                    killer_id,
                });
                state.broadcast(ServerMessage::PlayerMoved {
                    player_id,
                    position: respawn_position,
                    sequence: 0,
                });
            }
            WorldEvent::GroundItemsChanged(ground_items) => {
                state.broadcast(ServerMessage::GroundItemsChanged { ground_items })
            }
        }
    }
}

async fn mutate_item_state(state: &AppState, player_id: Uuid, mutation: ItemMutation) {
    let mut world = state.world.write().await;
    let backup = world.clone();
    let result = match mutation {
        ItemMutation::Pickup(instance_id) => world.try_pickup(player_id, instance_id),
        ItemMutation::Drop(instance_id) => world.try_drop(player_id, instance_id),
        ItemMutation::Move(instance_id, destination) => {
            world.try_move_item(player_id, instance_id, destination)
        }
        ItemMutation::Split(instance_id, quantity) => world
            .try_split_item(player_id, instance_id, quantity)
            .map(|_| ()),
    };
    if let Err(reason) = result {
        state.private(
            player_id,
            ServerMessage::Error {
                code: reason.into(),
                message: item_error_message(reason).into(),
            },
        );
        return;
    }
    let (inventory, inventory_weight, max_capacity) =
        world.inventory_state(player_id).expect("active player");
    let ground_items = world.ground_items().to_vec();
    if let Some(database) = &state.database
        && let Err(error) = database
            .persist_item_state(player_id, &inventory, &ground_items)
            .await
    {
        *world = backup;
        warn!(%player_id, %error, "item transaction rolled back");
        state.private(
            player_id,
            ServerMessage::Error {
                code: "item_transaction_failed".into(),
                message: "The item operation could not be saved".into(),
            },
        );
        return;
    }
    drop(world);
    state.private(
        player_id,
        ServerMessage::InventoryChanged {
            player_id,
            inventory,
            inventory_weight,
            max_capacity,
        },
    );
    state.broadcast(ServerMessage::GroundItemsChanged { ground_items });
}

fn item_error_message(code: &str) -> &'static str {
    match code {
        "item_locked_in_trade" => "That item is locked in your trade offer",
        "item_not_pickupable" => "That item cannot be picked up",
        "item_out_of_reach" => "That item is too far away",
        "too_heavy" => "You cannot carry any more weight",
        "item_not_owned" => "That item is not in your inventory",
        "container_full" => "That container is full",
        "container_cycle" => "A container cannot contain itself",
        "container_not_empty" => "Empty the container before dropping it",
        "backpack_required" => "Equip a backpack before carrying items",
        "backpack_in_use" => "Empty your inventory before removing that backpack",
        "inventory_full" => "Your backpack has no free slots",
        "wrong_equipment_slot" => "That item does not fit this equipment slot",
        "equipment_slot_occupied" => "That equipment slot is occupied",
        "invalid_split" => "That stack cannot be split this way",
        _ => "That item cannot be moved",
    }
}

async fn send(socket: &mut WebSocket, message: &ServerMessage) {
    if let Ok(text) = serde_json::to_string(message) {
        let _ = socket.send(Message::Text(text.into())).await;
    }
}

fn sanitize_name(value: &str) -> String {
    let trimmed = value.trim();
    if (2..=20).contains(&trimmed.chars().count())
        && trimmed.chars().all(|c| c.is_alphabetic() || c == ' ')
    {
        trimmed.to_owned()
    } else {
        String::new()
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler")
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    info!("shutdown requested");
}

#[cfg(test)]
mod region_streaming_tests {
    use super::*;
    use game_types::Position;

    #[test]
    fn region_refresh_has_hysteresis_around_old_chunk_boundaries() {
        let center = Position { x: 31, y: 10, z: 7 };
        assert!(!should_refresh_world_region(
            center,
            Position { x: 32, y: 10, z: 7 }
        ));
        assert!(!should_refresh_world_region(
            center,
            Position { x: 30, y: 10, z: 7 }
        ));
        assert!(should_refresh_world_region(
            center,
            Position { x: 55, y: 10, z: 7 }
        ));
        assert!(should_refresh_world_region(
            center,
            Position { x: 31, y: 10, z: 6 }
        ));
    }
}
