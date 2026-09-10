mod network;
mod state;
mod version;
mod interaction;
mod native_ui;
mod native_ui_theme;
mod native_modal;
mod native_game_menu;
mod native_loading;
mod native_map_ui;
mod native_trade_ui;
mod native_settings;
mod native_launcher;
mod native_updater;
// TIBIAGAME_V36_11_NATIVE_INTERACTION_FOUNDATION
mod creature_sprites;
// TIBIAGAME_V36_7_NATIVE_SPRITE_CREATURE_PIPELINE
mod collision;
mod streaming;
mod world_visuals;
mod world_details;
mod world_architecture;
// TIBIAGAME_V36_13_WORLD_BOUNDARY_FLOOR_PRELOAD
// TIBIAGAME_V36_14_MEDIEVAL_FACADE_CREATURE_WARMUP
// TIBIAGAME_V36_15_1_OPENING_FACADE_RAT_GPU_PREWARM
// TIBIAGAME_V36_9_NATIVE_ARCHITECTURE_BRIDGES
// TIBIAGAME_V36_8_1_NATIVE_WORLD_DETAILS
// TIBIAGAME_V36_8_NATIVE_WORLD_VISUAL_FOUNDATION

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use std::sync::{
    Mutex,
    mpsc::Receiver,
};

use anyhow::Result;
use bevy::{
    animation::{AnimatedBy, AnimationTargetId},
    asset::AssetPlugin,
    camera::ScalingMode,
    diagnostic::FrameTimeDiagnosticsPlugin,
    prelude::*,
    render::{
        RenderPlugin,
        settings::{Backends, WgpuSettings},
    },
    window::{PresentMode, WindowResolution},
    winit::WinitSettings,
};
use game_protocol::{
    ClientMessage, PROTOCOL_VERSION, ServerMessage, WelcomePayload,
};
use game_types::{EntityId, Position};
use tokio::sync::mpsc::UnboundedSender;

const TILE_STEP_SECONDS: f64 = 0.165;
const DIAGONAL_FACTOR: f64 = std::f64::consts::SQRT_2;
const CAMERA_OFFSET: Vec3 = Vec3::new(10.5, 12.5, 10.5);

#[derive(Component)]
struct LocalPlayer;

#[derive(Component)]
struct PlayerModelRoot;

#[derive(Component)]
struct AnimationTemplateRig;

#[derive(Resource)]
struct PlayerAnimationSources {
    general: Handle<Gltf>,
    movement: Handle<Gltf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlayerAnimationState {
    Idle,
    Walk,
}

#[derive(Component)]
struct PlayerAnimationController {
    idle: AnimationNodeIndex,
    walk: AnimationNodeIndex,
    state: PlayerAnimationState,
}

#[derive(Component)]
struct MainCamera;

#[derive(Component)]
struct NativeHud;

#[derive(Component)]
struct WorldStatic;

#[derive(Component)]
struct BuildingRoof {
    floor: i16,
    min_x: f32,
    max_x: f32,
    min_z: f32,
    max_z: f32,
    roof_material: Handle<StandardMaterial>,
    gable_material: Handle<StandardMaterial>,
    opacity: f32,
}

#[derive(Component)]
struct HouseWallOccluder {
    position: Position,
}

#[derive(Component)]
struct CreatureActor(EntityId);

#[derive(Component)]
struct NpcActor(String);

#[derive(Component)]
struct ResourceActor;

#[derive(Resource)]
struct BootstrapWelcome(Option<Box<WelcomePayload>>);

#[derive(Resource)]
struct LocalIdentity {
    id: EntityId,
    name: String,
    outfit: String,
    level: u32,
}

#[derive(Resource)]
struct NativeNetwork {
    outbound: UnboundedSender<ClientMessage>,
    incoming: Mutex<Receiver<ServerMessage>>,
}

#[derive(Resource, Default)]
struct MoveSequence(u32);

#[derive(Resource)]
struct MovementState {
    logical: Position,
    visual: Vec3,
    from: Vec3,
    to: Vec3,
    started_at: f64,
    duration: f64,
    next_step_at: f64,
    last_ack_sequence: u32,
}

impl MovementState {
    fn new(position: Position) -> Self {
        let visual = position_to_world(position);
        Self {
            logical: position,
            visual,
            from: visual,
            to: visual,
            started_at: 0.0,
            duration: TILE_STEP_SECONDS,
            next_step_at: 0.0,
            last_ack_sequence: 0,
        }
    }

    fn reconcile(&mut self, position: Position, now: f64) {
        self.logical = position;
        self.from = self.visual;
        self.to = position_to_world(position);
        self.started_at = now;
        self.duration = TILE_STEP_SECONDS.min(0.10);
        self.next_step_at = now + TILE_STEP_SECONDS;
    }
}

#[derive(Resource, Default)]
struct FrameProbe {
    sample_started_at: f64,
    frames: u64,
    total_ms: f64,
    max_ms: f64,
    drops_24: u32,
    drops_32: u32,
    last_drop_log_at: f64,
    avg_ms: f64,
    fps: f64,
    last_max_ms: f64,
    last_hud_at: f64,
}

#[derive(Resource, Default)]
struct CreatureWarmupHandles {
    _textures: Vec<Handle<Image>>,
}

#[derive(Resource)]
struct SingleWindowGameBootstrap;

#[derive(Resource)]
struct SingleWindowGameActive;

pub(crate) struct SingleWindowGameplayPlugin;

impl Plugin for SingleWindowGameplayPlugin {
    fn build(&self, app: &mut App) {
        // V36.45.15: Bevy's GPU pipelines live in RenderApp. Mirror their
        // readiness into NativeLoadingState through ExtractSchedule, following
        // Bevy 0.19's official loading-screen pattern.
        if let Some(render_app) =
            app.get_sub_app_mut(
                bevy::render::RenderApp,
            )
        {
            render_app.add_systems(
                bevy::render::ExtractSchedule,
                native_loading::
                    update_render_pipeline_readiness,
            );
        }


        app
            .init_resource::<streaming::RegionStream>()
            .init_resource::<native_ui::NativeChatState>()
            .init_resource::<native_ui::NativePanelState>()
            .init_resource::<native_map_ui::NativeMapUiState>()
            .init_resource::<native_trade_ui::NativeTradeUiState>()
            .init_resource::<native_settings::NativeSettingsState>()
            .init_resource::<native_ui::NativePingState>()
            .init_resource::<MoveSequence>()
            .init_resource::<FrameProbe>()
            .add_plugins(FrameTimeDiagnosticsPlugin::default())
            .add_systems(
                Update,
                (
                    setup,
                    interaction::setup,
                    native_ui::setup,
                    native_map_ui::setup,
                    native_trade_ui::setup,
                    native_settings::setup,
                    native_game_menu::setup,
                    native_loading::setup,
                    finish_single_window_bootstrap,
                )
                    .chain()
                    .run_if(single_window_bootstrap_pending),
            )
            .add_systems(
                Update,
                (
                    pump_network,
                    creature_sprites::reconcile_creature_visuals
                        .after(schedule_tile_movement),
                    creature_sprites::report_creature_render_visibility
                        .after(
                            creature_sprites::reconcile_creature_visuals,
                        ),
                    creature_sprites::interpolate_creature_motion
                        .after(
                            creature_sprites::reconcile_creature_visuals,
                        ),
                    creature_sprites::animate_creature_sprites
                        .after(
                            creature_sprites::reconcile_creature_visuals,
                        ),
                    creature_sprites::face_creature_sprites_to_camera
                        .after(
                            creature_sprites::interpolate_creature_motion,
                        ),
                    setup_player_animation,
                    streaming::apply_streamed_region
                        .after(pump_network),
                    native_loading::update
                        .after(streaming::apply_streamed_region)
                        .before(schedule_tile_movement),
                    native_launcher::sync_single_window_shell
                        .after(native_loading::update),
                    streaming::sync_streamed_floor_visibility
                        .after(streaming::apply_streamed_region)
                        .after(update_building_roofs),
                    streaming::cleanup_old_region_entities
                        .after(
                            streaming::sync_streamed_floor_visibility,
                        ),
                )
                    .distributive_run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                (
                    schedule_tile_movement
                        .run_if(native_loading::gameplay_ready)
                        .run_if(native_game_menu::menu_closed)
                        .after(native_loading::update)
                        .after(pump_network),
                    update_player_facing
                        .after(schedule_tile_movement),
                    interpolate_player
                        .after(schedule_tile_movement),
                    update_player_animation
                        .after(interpolate_player),
                    update_building_roofs
                        .after(interpolate_player),
                    follow_camera
                        .after(interpolate_player),
                    toggle_present_mode,
                    frame_pacing_probe,
                    update_hud
                        .after(frame_pacing_probe),
                )
                    .distributive_run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                (
                    interaction::handle_pointer_interactions
                        .run_if(native_loading::gameplay_ready)
                        .run_if(native_game_menu::menu_closed)
                        .after(native_loading::update)
                        .after(pump_network),
                    interaction::sync_target_visual
                        .after(
                            creature_sprites::interpolate_creature_motion,
                        ),
                    interaction::update_hud
                        .after(pump_network)
                        .after(
                            interaction::handle_pointer_interactions,
                        ),
                )
                    .distributive_run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                (
                    native_ui_theme::apply_once
                    .before(native_ui::update_ui),
                    native_game_menu::handle_input
                    .run_if(native_loading::gameplay_ready),
                    native_ui::handle_chat_input
                    .run_if(native_game_menu::menu_closed)
                    .after(native_game_menu::handle_input),
                    native_map_ui::handle_input
                    .run_if(native_game_menu::menu_closed)
                    .after(native_game_menu::handle_input)
                    .before(schedule_tile_movement),
                    native_trade_ui::handle_input
                    .run_if(native_game_menu::menu_closed)
                    .after(native_map_ui::handle_input)
                    .before(schedule_tile_movement),
                    native_settings::handle_input
                    .run_if(native_game_menu::menu_closed)
                    .after(native_trade_ui::handle_input)
                    .before(schedule_tile_movement),
                    native_settings::handle_buttons
                    .after(native_settings::handle_input),
                    native_ui::handle_panel_hotkeys
                    .run_if(native_game_menu::menu_closed)
                    .after(native_ui::handle_chat_input),
                    native_ui::handle_panel_dock_buttons
                    .run_if(native_game_menu::menu_closed)
                    .after(
                    native_ui::handle_panel_hotkeys,
                    ),
                    native_ui::handle_panel_close_buttons
                    .after(
                    native_ui::handle_panel_dock_buttons,
                    ),
                    native_ui::handle_action_hotkeys
                    .run_if(native_loading::gameplay_ready)
                    .run_if(native_game_menu::menu_closed)
                    .after(native_loading::update)
                    .after(
                    native_ui::handle_panel_close_buttons,
                    ),
                )
                    .distributive_run_if(single_window_game_active),
            )
            // TIBIAGAME_V36_48_1_SPLIT_NATIVE_UI_SCHEDULE
            .add_systems(
                Update,
                (
                    native_ui::handle_action_slot_buttons
                    .run_if(native_loading::gameplay_ready)
                    .run_if(native_game_menu::menu_closed)
                    .after(
                    native_ui::handle_action_hotkeys,
                    ),
                    native_game_menu::handle_buttons
                    .after(native_game_menu::handle_input),
                    native_ui::ping_server,
                    native_ui::update_ui
                    .after(pump_network),
                    native_map_ui::update_ui
                    .after(pump_network),
                    native_trade_ui::update_ui
                    .after(pump_network),
                    native_settings::update_performance_probe,
                    native_settings::update_ui,
                    native_game_menu::update_ui
                    .after(native_settings::update_ui),
                    native_settings::sync_world_music
                    .after(pump_network),
                    native_settings::apply_audio_settings
                    .after(
                    native_settings::sync_world_music,
                    ),
                )
                    .distributive_run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                (
                    native_ui::handle_character_modal_buttons
                        .run_if(native_game_menu::menu_closed)
                        .after(native_ui::handle_panel_close_buttons),
                    native_ui::update_character_modal_ui
                        .after(native_ui::update_ui),
                )
                    .distributive_run_if(single_window_game_active),
            );
    }
}

fn single_window_bootstrap_pending(
    bootstrap: Option<Res<SingleWindowGameBootstrap>>,
) -> bool {
    bootstrap.is_some()
}

fn single_window_game_active(
    active: Option<Res<SingleWindowGameActive>>,
) -> bool {
    active.is_some()
}

fn finish_single_window_bootstrap(
    mut commands: Commands,
    mut windows: Query<&mut Window>,
) {
    commands.remove_resource::<SingleWindowGameBootstrap>();
    commands.remove_resource::<BootstrapWelcome>();
    commands.insert_resource(SingleWindowGameActive);

    if let Ok(mut window) = windows.single_mut() {
        window.title = version::window_title();
        window.resizable = true;
    }

    info!(
        "ALDORIA SINGLE WINDOW · gameplay bootstrap installed"
    );
}

pub(crate) fn install_single_window_session(
    commands: &mut Commands,
    session: network::NativeSession,
) {
    let native_game_state =
        state::NativeGameState::from_welcome(
            session.welcome.as_ref(),
        );

    let initial_position =
        session.welcome.player.position;

    let initial_collision =
        collision::LocalCollision::from_region(
            session.welcome.map.as_ref(),
            &session.welcome.npcs,
        );

    let native_map_state =
        native_map_ui::NativeMapState::from_welcome(
            session.welcome.as_ref(),
        );

    let identity = LocalIdentity {
        id: session.welcome.player.id,
        name: session.welcome.player.name.clone(),
        outfit: session.welcome.player.outfit.clone(),
        level: session.welcome.player.level,
    };

    commands.insert_resource(native_game_state);
    commands.insert_resource(
        BootstrapWelcome(Some(session.welcome)),
    );
    commands.insert_resource(native_map_state);
    commands.insert_resource(identity);
    commands.insert_resource(NativeNetwork {
        outbound: session.outbound,
        incoming: Mutex::new(session.incoming),
    });
    commands.insert_resource(initial_collision);
    commands.insert_resource(
        MovementState::new(initial_position),
    );
    commands.insert_resource(
        native_loading::NativeLoadingState::default(),
    );
    commands.insert_resource(SingleWindowGameBootstrap);

    info!(
        "ALDORIA SINGLE WINDOW · session installed · floor {}",
        initial_position.z,
    );
}

fn main() -> Result<()> {
    if std::env::var("ALDORIA_NATIVE_GAME_SESSION").as_deref() != Ok("1") {
        return native_launcher::run();
    }

    let session = network::connect_direct_from_env()?;
    run_game(session)
}

fn run_game(session: network::NativeSession) -> Result<()> {
    let native_game_state = state::NativeGameState::from_welcome(session.welcome.as_ref());
    let initial_position = session.welcome.player.position;
    let initial_collision = collision::LocalCollision::from_region(
        session.welcome.map.as_ref(),
        &session.welcome.npcs,
    );
    let native_map_state =
        native_map_ui::NativeMapState::from_welcome(session.welcome.as_ref());

    let identity = LocalIdentity {
        id: session.welcome.player.id,
        name: session.welcome.player.name.clone(),
        outfit: session.welcome.player.outfit.clone(),
        level: session.welcome.player.level,
    };

    App::new()
        .insert_resource(WinitSettings::continuous())
        .insert_resource(ClearColor(Color::srgb(0.035, 0.055, 0.045)))
        .insert_resource(native_game_state)
        .insert_resource(BootstrapWelcome(Some(session.welcome)))
        .insert_resource(native_map_state)
        .insert_resource(identity)
        .insert_resource(NativeNetwork {
            outbound: session.outbound,
            incoming: Mutex::new(session.incoming),
        })
        .insert_resource(initial_collision)
        .insert_resource(MovementState::new(initial_position))
        .init_resource::<streaming::RegionStream>()
        .init_resource::<native_ui::NativeChatState>()
        .init_resource::<native_ui::NativePanelState>()
        .init_resource::<native_map_ui::NativeMapUiState>()
        .init_resource::<native_trade_ui::NativeTradeUiState>()
        .init_resource::<native_settings::NativeSettingsState>()
        .init_resource::<native_ui::NativePingState>()
        .init_resource::<native_loading::NativeLoadingState>()
        .init_resource::<MoveSequence>()
        .init_resource::<FrameProbe>()
        .add_plugins(
            DefaultPlugins
                .set(native_render_plugin())
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: version::window_title(),
                        resolution: WindowResolution::new(1280, 800)
                            .with_scale_factor_override(1.0),
                        present_mode: PresentMode::AutoVsync,
                        resizable: true,
                        ..default()
                    }),
                    ..default()
                })
                .set(AssetPlugin {
                    file_path: native_asset_root(),
                    ..default()
                }),
        )
        .add_plugins(FrameTimeDiagnosticsPlugin::default())
        .add_systems(
            Startup,
            (
                setup,
                interaction::setup,
                native_ui::setup,
                native_map_ui::setup,
                native_trade_ui::setup,
                native_settings::setup,
                native_loading::setup.after(native_settings::setup),
            ),
        )
        .add_systems(
            Update,
            (
                pump_network,
                creature_sprites::reconcile_creature_visuals.after(schedule_tile_movement),
                creature_sprites::report_creature_render_visibility
                    .after(creature_sprites::reconcile_creature_visuals),
                creature_sprites::interpolate_creature_motion
                    .after(creature_sprites::reconcile_creature_visuals),
                creature_sprites::animate_creature_sprites
                    .after(creature_sprites::reconcile_creature_visuals),
                creature_sprites::face_creature_sprites_to_camera
                    .after(creature_sprites::interpolate_creature_motion),
                setup_player_animation,
                streaming::apply_streamed_region.after(pump_network),
                native_loading::update
                    .after(streaming::apply_streamed_region)
                    .before(schedule_tile_movement),
                streaming::sync_streamed_floor_visibility
                    .after(streaming::apply_streamed_region)
                    .after(update_building_roofs),
                streaming::cleanup_old_region_entities
                    .after(streaming::sync_streamed_floor_visibility),
                schedule_tile_movement
                    .run_if(native_loading::gameplay_ready)
                    .after(native_loading::update)
                    .after(pump_network),
                update_player_facing.after(schedule_tile_movement),
                interpolate_player.after(schedule_tile_movement),
                update_player_animation.after(interpolate_player),
                update_building_roofs.after(interpolate_player),
                follow_camera.after(interpolate_player),
                toggle_present_mode,
                frame_pacing_probe,
                update_hud.after(frame_pacing_probe),
            ),
        )
        .add_systems(
            Update,
            (
                interaction::handle_pointer_interactions
                    .run_if(native_loading::gameplay_ready)
                    .after(native_loading::update)
                    .after(pump_network),
                interaction::sync_target_visual
                    .after(creature_sprites::interpolate_creature_motion),
                interaction::update_hud
                    .after(pump_network)
                    .after(interaction::handle_pointer_interactions),
            ),
        )
        .add_systems(
            Update,
            (
                native_ui_theme::apply_once.before(native_ui::update_ui),
                native_ui::handle_chat_input,
                native_map_ui::handle_input.before(schedule_tile_movement),
                native_trade_ui::handle_input
                    .after(native_map_ui::handle_input)
                    .before(schedule_tile_movement),
                native_settings::handle_input
                    .after(native_trade_ui::handle_input)
                    .before(schedule_tile_movement),
                native_ui::handle_panel_hotkeys.after(native_ui::handle_chat_input),
                native_ui::handle_panel_dock_buttons
                    .after(native_ui::handle_panel_hotkeys),
                native_ui::handle_panel_close_buttons
                    .after(native_ui::handle_panel_dock_buttons),
                native_ui::handle_action_hotkeys
                    .run_if(native_loading::gameplay_ready)
                    .after(native_loading::update)
                    .after(native_ui::handle_panel_close_buttons),
                native_ui::handle_action_slot_buttons
                    .run_if(native_loading::gameplay_ready)
                    .after(native_ui::handle_action_hotkeys),
                native_ui::ping_server,
                native_ui::update_ui.after(pump_network),
                native_map_ui::update_ui.after(pump_network),
                native_trade_ui::update_ui.after(pump_network),
                native_settings::update_performance_probe,
                native_settings::update_ui,
                native_settings::sync_world_music.after(pump_network),
                native_settings::apply_audio_settings
                    .after(native_settings::sync_world_music),
            ),
        )
        .run();

    Ok(())
}

// TIBIAGAME_V36_5_1_ASSET_ROOT_VISIBILITY_FIX
fn native_asset_root() -> String {
    if let Ok(explicit) = std::env::var("ALDORIA_ASSET_ROOT") {
        if !explicit.trim().is_empty() {
            return explicit;
        }
    }

    let candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/public/assets");

    candidate
        .canonicalize()
        .unwrap_or(candidate)
        .to_string_lossy()
        .into_owned()
}

fn warmup_creature_assets(asset_server: &AssetServer) -> CreatureWarmupHandles {
    let root = PathBuf::from(native_asset_root());
    let search_roots = [
        root.join("sprites/creatures"),
        root.join("textures/creatures"),
        root.join("creatures"),
        root.join("monsters"),
    ];

    let mut textures = Vec::new();
    for directory in search_roots {
        collect_creature_textures(&root, &directory, asset_server, &mut textures);
    }

    info!(
        "ALDORIA CREATURE WARMUP · retained {} texture handles from asset scan",
        textures.len(),
    );

    CreatureWarmupHandles { _textures: textures }
}

fn collect_creature_textures(
    asset_root: &Path,
    directory: &Path,
    asset_server: &AssetServer,
    out: &mut Vec<Handle<Image>>,
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };

    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.is_dir() {
            collect_creature_textures(asset_root, &path, asset_server, out);
            continue;
        }

        let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        let extension = extension.to_ascii_lowercase();
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "ktx2" | "dds" | "basis") {
            continue;
        }

        let Ok(relative) = path.strip_prefix(asset_root) else {
            continue;
        };
        let asset_path = relative.to_string_lossy().replace('\\', "/");
        out.push(asset_server.load(asset_path));
    }
}

fn native_render_plugin() -> RenderPlugin {
    let backends = if cfg!(target_os = "windows") {
        Backends::DX12
    } else {
        Backends::PRIMARY
    };

    RenderPlugin {
        render_creation: WgpuSettings {
            backends: Some(backends),
            ..default()
        }
        .into(),
        ..default()
    }
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut bootstrap: ResMut<BootstrapWelcome>,
    movement: Res<MovementState>,
    identity: Res<LocalIdentity>,
    mut region_stream: ResMut<streaming::RegionStream>,
) {
    let welcome = bootstrap
        .0
        .take()
        .expect("V36.2 BootstrapWelcome must exist exactly once");

    info!(
        "ALDORIA NATIVE V{} · Bevy 0.19.1 · protocol {} · DX12 · LIVE SERVER",
        version::MIGRATION_VERSION,
        PROTOCOL_VERSION,
    );
    info!("ALDORIA ASSET ROOT · {}", native_asset_root());
    info!(
        "Player {} · level {} · {}:{}:{}",
        identity.name,
        identity.level,
        movement.logical.x,
        movement.logical.y,
        movement.logical.z,
    );

    let creature_sprite_catalog =
        creature_sprites::CreatureSpriteCatalog::new(
            &asset_server,
            &mut meshes,
        );
    creature_sprites::spawn_creature_render_warmup(
        &mut commands,
        &mut materials,
        &creature_sprite_catalog,
    );
    let world_detail_catalog =
        world_details::WorldDetailCatalog::new(
            &asset_server,
            &mut meshes,
            &mut materials,
        );
    let architecture_catalog =
        world_architecture::ArchitectureCatalog::new(
            &mut meshes,
            &mut materials,
        );
    let creature_warmup = warmup_creature_assets(&asset_server);
    world_architecture::describe();
    world_details::describe();
    creature_sprites::describe_catalog();

    // V36.17: Welcome already contains region_floor_radius data. Start building
    // the complete current/adjacent floor cache immediately at startup.
    region_stream.queue(
        welcome.map.clone(),
        welcome.region_center,
        welcome.region_radius,
        welcome.region_floor_radius,
        welcome.creatures.clone(),
        welcome.npcs.clone(),
        welcome.resource_nodes.clone(),
    );

    spawn_live_world(
        &mut commands,
        &mut meshes,
        &mut materials,
        &asset_server,
        &creature_sprite_catalog,
        &world_detail_catalog,
        &architecture_catalog,
        &welcome,
    );

    commands.insert_resource(creature_warmup);
    commands.insert_resource(creature_sprite_catalog);
    commands.insert_resource(world_detail_catalog);
    commands.insert_resource(architecture_catalog);
// TIBIAGAME_V36_5_NATIVE_PLAYER_MODEL
    let general_animation_path =
        "models/kaykit-adventurers/Rig_Medium_General.glb";
    let movement_animation_path =
        "models/kaykit-adventurers/Rig_Medium_MovementBasic.glb";

    let general_gltf: Handle<Gltf> = asset_server.load(general_animation_path);
    let movement_gltf: Handle<Gltf> = asset_server.load(movement_animation_path);

    commands.insert_resource(PlayerAnimationSources {
        general: general_gltf,
        movement: movement_gltf,
    });

    // The KayKit animation clips live in separate rig-only GLBs. Spawn the
    // General rig invisibly so Bevy creates the exact AnimationTargetId values
    // used by those clips. V36.6 copies those IDs to the matching model bones.
    commands.spawn((
        Name::new("KayKit animation target template"),
        AnimationTemplateRig,
        WorldAssetRoot(
            asset_server.load(
                GltfAssetLabel::Scene(0).from_asset(general_animation_path),
            ),
        ),
        Transform::from_xyz(0.0, -10_000.0, 0.0),
        Visibility::Hidden,
    ));

    let model_path = player_model_path(&identity.outfit);
    let model_scale = player_model_scale(&identity.outfit);
    let model_scene = asset_server.load(
        GltfAssetLabel::Scene(0).from_asset(model_path),
    );

    commands
        .spawn((
            Name::new(format!("Local Player · {}", identity.name)),
            LocalPlayer,
            Transform::from_translation(movement.visual),
            Visibility::default(),
        ))
        .with_child((
            Name::new(format!("{} model", identity.outfit)),
            PlayerModelRoot,
            WorldAssetRoot(model_scene),
            Transform::from_translation(Vec3::new(0.0, -0.575, 0.0))
                .with_scale(Vec3::splat(model_scale))
                .with_rotation(Quat::from_rotation_y(std::f32::consts::PI)),
        ));

    commands.spawn((
        Name::new("Sun"),
        DirectionalLight {
            illuminance: 7_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(
            movement.visual.x + 8.0,
            14.0,
            movement.visual.z + 6.0,
        )
        .looking_at(movement.visual, Vec3::Y),
    ));

    commands.spawn((
        Name::new("Warm Point Light"),
        PointLight {
            color: Color::srgb(1.0, 0.67, 0.32),
            intensity: 160_000.0,
            range: 9.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_translation(movement.visual + Vec3::new(3.0, 3.0, 3.0)),
    ));

    let target = movement.visual - Vec3::Y * 0.5;
    commands.spawn((
        Name::new("Main Camera"),
        MainCamera,
        Camera3d::default(),
        Projection::from(OrthographicProjection {
            scaling_mode: ScalingMode::FixedVertical {
                viewport_height: 18.0,
            },
            ..OrthographicProjection::default_3d()
        }),
        Transform::from_translation(target + CAMERA_OFFSET).looking_at(target, Vec3::Y),
    ));

    commands.spawn((
        NativeHud,
        Visibility::Hidden,
        Text::new("Aldoria native live world starting…"),
        TextFont {
            font_size: FontSize::Px(16.0),
            ..default()
        },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            top: px(12),
            left: px(12),
            ..default()
        },
    ));
}

fn spawn_live_world(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    asset_server: &AssetServer,
    creature_sprite_catalog: &creature_sprites::CreatureSpriteCatalog,
    world_detail_catalog: &world_details::WorldDetailCatalog,
    architecture_catalog: &world_architecture::ArchitectureCatalog,
    welcome: &WelcomePayload,
) {
    let map = &welcome.map;
    let floor = welcome.player.position.z;

    let tile_mesh = meshes.add(Cuboid::new(0.98, 0.045, 0.98));
    let actor_mesh = meshes.add(Cuboid::new(0.62, 0.95, 0.62));

    let world_materials =
        world_visuals::create_materials(asset_server, materials);
    world_visuals::describe();

    let floor_material = world_materials.floor.clone();
    let road_material = world_materials.road.clone();
    let water_material = world_materials.water.clone();
    let bridge_material = world_materials.bridge.clone();
    let house_wall_material = world_materials.house_wall.clone();
    let castle_wall_material = world_materials.castle_wall.clone();

    let npc_material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.75, 0.58, 0.16),
        perceptual_roughness: 0.7,
        ..default()
    });
    for center in world_architecture::ground_chunk_centers(
        welcome.region_center,
        welcome.region_radius,
    ) {
        world_architecture::spawn_ground_chunk(
            commands,
            architecture_catalog,
            world_materials.ground_underlay.clone(),
            center,
        );
    }

    spawn_tile_positions(
        commands,
        &map.floors,
        floor,
        &tile_mesh,
        &floor_material,
        0.015,
        "Floor",
    );
    for terrain in map
        .terrain_materials
        .iter()
        .filter(|terrain| terrain.position.z == floor)
    {
        commands.spawn((
            Name::new("Terrain Material"),
            WorldStatic,
            Mesh3d(tile_mesh.clone()),
            MeshMaterial3d(world_materials.terrain(&terrain.material)),
            Transform::from_translation(Vec3::new(
                terrain.position.x as f32,
                0.028,
                terrain.position.y as f32,
            )),
        ));
    }

    spawn_tile_positions(
        commands,
        &map.roads,
        floor,
        &tile_mesh,
        &road_material,
        0.045,
        "Road",
    );
    spawn_tile_positions(
        commands,
        &map.water,
        floor,
        &tile_mesh,
        &water_material,
        0.03,
        "Water",
    );
    for position in map
        .bridges
        .iter()
        .filter(|position| position.z == floor)
    {
        let edges = world_architecture::infer_bridge_edges(
            *position,
            &map.bridges,
        );
        world_architecture::spawn_bridge(
            commands,
            architecture_catalog,
            bridge_material.clone(),
            *position,
            edges,
        );
    }

    for position in map
        .house_walls
        .iter()
        .filter(|position| position.z == floor)
    {
        if world_architecture::has_opening(
            *position,
            &map.doors,
            &map.windows,
        ) {
            continue;
        }

        let edges = world_architecture::infer_house_wall_edges(
            *position,
            &map.buildings,
            &map.house_walls,
            &map.castle_walls,
        );

        world_architecture::spawn_house_wall(
            commands,
            architecture_catalog,
            house_wall_material.clone(),
            *position,
            edges,
        );
    }

    for position in map
        .castle_walls
        .iter()
        .filter(|position| position.z == floor)
    {
        if world_architecture::has_opening(
            *position,
            &map.doors,
            &map.windows,
        ) {
            continue;
        }

        let axes = world_architecture::infer_wall_axes(
            *position,
            &map.house_walls,
            &map.castle_walls,
        );

        world_architecture::spawn_wall(
            commands,
            architecture_catalog,
            castle_wall_material.clone(),
            *position,
            axes,
            true,
        );
    }

    for position in map.trees.iter().filter(|position| position.z == floor) {
        world_details::spawn_tree(
            commands,
            world_detail_catalog,
            *position,
        );
    }

    for object in map
        .objects
        .iter()
        .filter(|object| object.position.z == floor)
    {
        world_details::spawn_world_object(
            commands,
            world_detail_catalog,
            object,
        );
    }

    for door in map
        .doors
        .iter()
        .filter(|door| door.position.z == floor)
    {
        let edge = world_architecture::infer_opening_edge(
            door.position,
            &map.buildings,
            &map.house_walls,
            &map.castle_walls,
        );
        world_details::spawn_door(
            commands,
            world_detail_catalog,
            door,
            edge,
        );
    }

    for window in map
        .windows
        .iter()
        .filter(|window| window.position.z == floor)
    {
        let edge = world_architecture::infer_opening_edge(
            window.position,
            &map.buildings,
            &map.house_walls,
            &map.castle_walls,
        );
        world_details::spawn_window(
            commands,
            world_detail_catalog,
            window,
            edge,
        );
    }

    for position in map
        .torches
        .iter()
        .filter(|position| position.z == floor)
    {
        world_details::spawn_torch(
            commands,
            world_detail_catalog,
            *position,
        );
    }

    for stair in &map.stairs {
        world_details::spawn_stair(
            commands,
            world_detail_catalog,
            stair,
            floor,
        );
    }

    for building in map
        .buildings
        .iter()
        .filter(|building| building.floor == floor)
    {
        world_architecture::spawn_building(
            commands,
            architecture_catalog,
            materials,
            world_materials.house_wall.clone(),
            world_materials.building_floor.clone(),
            world_materials.roof.clone(),
            &building.name,
            building.floor,
            building.x,
            building.y,
            building.width,
            building.height,
        );
    }

    for creature in welcome
        .creatures
        .iter()
        .filter(|creature| creature.position.z == floor)
    {
        creature_sprites::spawn_creature_sprite(
            commands,
            materials,
            creature_sprite_catalog,
            creature,
        );
    }

    for npc in welcome.npcs.iter().filter(|npc| npc.position.z == floor) {
        commands.spawn((
            Name::new(format!("NPC · {}", npc.name)),
            NpcActor(npc.id.clone()),
            Mesh3d(actor_mesh.clone()),
            MeshMaterial3d(npc_material.clone()),
            Transform::from_translation(position_to_world(npc.position)),
        ));
    }

    for resource in welcome
        .resource_nodes
        .iter()
        .filter(|resource| resource.position.z == floor)
    {
        world_details::spawn_resource(
            commands,
            world_detail_catalog,
            resource,
        );
    }

    info!(
        "ALDORIA LIVE MAP · floor {} · floors {} · roads {} · water {} · walls {} · trees {} · buildings {}",
        floor,
        count_floor(&map.floors, floor),
        count_floor(&map.roads, floor),
        count_floor(&map.water, floor),
        count_floor(&map.house_walls, floor) + count_floor(&map.castle_walls, floor),
        count_floor(&map.trees, floor),
        map.buildings.iter().filter(|building| building.floor == floor).count(),
    );
    info!(
        "ALDORIA LIVE ACTORS · creatures {} · NPCs {} · resources {}",
        welcome
            .creatures
            .iter()
            .filter(|actor| actor.position.z == floor)
            .count(),
        welcome
            .npcs
            .iter()
            .filter(|actor| actor.position.z == floor)
            .count(),
        welcome
            .resource_nodes
            .iter()
            .filter(|actor| actor.position.z == floor)
            .count(),
    );
}

fn spawn_tile_positions(
    commands: &mut Commands,
    positions: &[Position],
    floor: i16,
    mesh: &Handle<Mesh>,
    material: &Handle<StandardMaterial>,
    y: f32,
    label: &'static str,
) {
    for position in positions.iter().filter(|position| position.z == floor) {
        commands.spawn((
            Name::new(label),
            WorldStatic,
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            Transform::from_translation(
                Vec3::new(position.x as f32, y, position.y as f32),
            ),
        ));
    }
}

fn count_floor(positions: &[Position], floor: i16) -> usize {
    positions.iter().filter(|position| position.z == floor).count()
}

// TIBIAGAME_V36_8_4_PUMP_NETWORK_PARAMSET_FIX
// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE
fn pump_network(
    network: Res<NativeNetwork>,
    mut ping_state: ResMut<native_ui::NativePingState>,
    identity: Res<LocalIdentity>,
    mut game_state: ResMut<state::NativeGameState>,
    time: Res<Time>,
    mut region_stream: ResMut<streaming::RegionStream>,
    mut map_state: ResMut<native_map_ui::NativeMapState>,
    mut collision: ResMut<collision::LocalCollision>,
    mut movement: ResMut<MovementState>,
    mut actor_queries: ParamSet<(
        Query<(&world_details::WorldDoorSwing, &mut Transform)>,
        Query<(&world_details::WorldWindowSwing, &mut Transform)>,
        Query<(
            &CreatureActor,
            &mut Transform,
            &mut creature_sprites::CreatureSprite,
            &mut creature_sprites::CreatureMotion,
        )>,
    )>,
) {
    let messages: Vec<ServerMessage> = {
        let Ok(receiver) = network.incoming.lock() else {
            error!("native network receiver lock poisoned");
            return;
        };
        receiver.try_iter().take(256).collect()
    };

    for message in messages {
        game_state.apply_server_message(&message);
        match message {
            ServerMessage::PlayerMoved {
                player_id,
                position,
                sequence,
            } if player_id == identity.id => {
                movement.last_ack_sequence = movement.last_ack_sequence.max(sequence);
                if movement.logical != position {
                    warn!(
                        "ALDORIA MOVE RECONCILE · seq {} · predicted {}:{}:{} · server {}:{}:{}",
                        sequence,
                        movement.logical.x,
                        movement.logical.y,
                        movement.logical.z,
                        position.x,
                        position.y,
                        position.z,
                    );
                    movement.reconcile(position, time.elapsed_secs_f64());
                }
            }
            ServerMessage::MoveRejected {
                player_id,
                position,
                sequence,
                reason,
            } if player_id == identity.id => {
                warn!(
                    "ALDORIA MOVE REJECTED · seq {} · {} · authoritative {}:{}:{}",
                    sequence,
                    reason,
                    position.x,
                    position.y,
                    position.z,
                );
                movement.last_ack_sequence = movement.last_ack_sequence.max(sequence);
                movement.reconcile(position, time.elapsed_secs_f64());
            }
            ServerMessage::CreatureMoved {
                creature_id,
                position,
            } => {
                let now = time.elapsed_secs_f64();
                let mut creatures = actor_queries.p2();
                for (actor, transform, mut sprite, mut motion) in &mut creatures {
                    if actor.0 == creature_id {
                        creature_sprites::begin_creature_move(
                            &mut sprite,
                            &mut motion,
                            &transform,
                            position,
                            now,
                        );
                        break;
                    }
                }
            }
            ServerMessage::WorldRegion {
                map,
                region_center,
                region_radius,
                region_floor_radius,
                ground_items: _,
                creatures,
                npcs,
                resource_nodes,
            } => {
                // TIBIAGAME_V36_3_NATIVE_STREAMED_REGION_SWAP
                // Coalesce to the newest authoritative region. The streaming
                // module stages the replacement across multiple Bevy frames,
                // commits the new generation first, then retires the old one.
                map_state.replace_region(
                    map.clone(),
                    region_center,
                    region_radius,
                    region_floor_radius,
                );
                collision.replace_region(map.as_ref(), &npcs);
                region_stream.queue(
                    map,
                    region_center,
                    region_radius,
                    region_floor_radius,
                    creatures,
                    npcs,
                    resource_nodes,
                );
            }
            ServerMessage::DoorChanged { door } => {
                {
                    let mut doors = actor_queries.p0();
                    world_details::apply_door_change(
                        &door,
                        &mut doors,
                    );
                }
                collision.update_door(door);
            }
            ServerMessage::WindowChanged { window } => {
                let mut windows = actor_queries.p1();
                world_details::apply_window_change(
                    &window,
                    &mut windows,
                );
            }
            ServerMessage::CombatEffect { source_id, .. } => {
                let now = time.elapsed_secs_f64();
                let mut creatures = actor_queries.p2();
                for (actor, _, mut sprite, _) in &mut creatures {
                    if actor.0 == source_id {
                        creature_sprites::trigger_attack(&mut sprite, now);
                        break;
                    }
                }
            }
            ServerMessage::CreatureDamaged { creature_id, .. } => {
                let now = time.elapsed_secs_f64();
                let mut creatures = actor_queries.p2();
                for (actor, _, mut sprite, _) in &mut creatures {
                    if actor.0 == creature_id {
                        creature_sprites::trigger_hit(&mut sprite, now);
                        break;
                    }
                }
            }
            ServerMessage::CreatureDied { creature_id, .. } => {
                let now = time.elapsed_secs_f64();
                let mut creatures = actor_queries.p2();
                for (actor, _, mut sprite, _) in &mut creatures {
                    if actor.0 == creature_id {
                        creature_sprites::trigger_death(&mut sprite, now);
                        break;
                    }
                }
            }
            ServerMessage::Pong { sent_at, .. } => {
                ping_state.record_pong(sent_at, time.elapsed_secs_f64());
            }
            ServerMessage::Error { code, message } => {
                error!("ALDORIA SERVER ERROR · {code}: {message}");
            }
            _ => {}
        }
    }
}

fn schedule_tile_movement(
    keys: Res<ButtonInput<KeyCode>>,
    chat_state: Res<native_ui::NativeChatState>,
    panel_state: Res<native_ui::NativePanelState>,
    movement_ui_locks: native_trade_ui::MovementUiLocks,
    time: Res<Time>,
    network: Res<NativeNetwork>,
    collision: Res<collision::LocalCollision>,
    asset_server: Res<AssetServer>,
    creature_catalog: Res<creature_sprites::CreatureSpriteCatalog>,
    region_stream: Res<streaming::RegionStream>,
    game_state: Res<state::NativeGameState>,
    creature_visuals: Query<
        &CreatureActor,
        With<creature_sprites::PersistentCreatureVisual>,
    >,
    mut floor_visual_ready_since: Local<Option<(i16, f64)>>,
    mut floor_asset_wait_logged: Local<bool>,
    mut sequence: ResMut<MoveSequence>,
    mut movement: ResMut<MovementState>,
) {
    if chat_state.active {
        return;
    }

    if movement_ui_locks.blocks_movement() {
        return;
    }

    if panel_state.npc_open {
        return;
    }

    if (panel_state.inventory_open
        || panel_state.spells_open
        || panel_state.crafting_open)
        && (
            keys.pressed(KeyCode::ArrowUp)
                || keys.pressed(KeyCode::ArrowDown)
                || keys.pressed(KeyCode::ArrowLeft)
                || keys.pressed(KeyCode::ArrowRight)
        )
    {
        return;
    }

    let dx = i32::from(keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight))
        - i32::from(keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft));
    let dy = i32::from(keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown))
        - i32::from(keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp));

    let now = time.elapsed_secs_f64();
    if dx == 0 && dy == 0 {
        movement.next_step_at = now;
        return;
    }

    if movement.next_step_at == 0.0 {
        movement.next_step_at = now;
    }
    if now + 0.000_001 < movement.next_step_at {
        return;
    }

    let duration = TILE_STEP_SECONDS
        * if dx != 0 && dy != 0 {
            DIAGONAL_FACTOR
        } else {
            1.0
        };

    let previous_deadline = movement.next_step_at;
    movement.next_step_at = if now - previous_deadline > duration {
        now + duration
    } else {
        previous_deadline + duration
    };

    let target = Position {
        x: movement.logical.x + dx,
        y: movement.logical.y + dy,
        z: movement.logical.z,
    };

    let predicted_step = match collision.predict_step(movement.logical, target) {
        Ok(step) => step,
        Err(_) => {
            // TIBIAGAME_V36_4_NATIVE_LOCAL_COLLISION_PREDICTION
            // Static/NPC/door/corner collision is already known locally.
            // Do not send a request that the authoritative server must reject.
            return;
        }
    };

    // V36.16.1: do not cross floors until creature visuals are ready.
    // The authoritative server never sees the stair/floor MoveRequest while
    // assets are still loading, so enemies cannot damage an invisible player
    // on the destination floor.
    if predicted_step.destination.z != movement.logical.z {
        let destination_floor = predicted_step.destination.z;
        let assets_ready =
            creature_sprites::floor_transition_creature_assets_ready(
                &asset_server,
                &creature_catalog,
            );
        let floor_ready = region_stream.floor_ready(destination_floor);

        let expected_actor_count = game_state
            .creatures
            .values()
            .filter(|creature| {
                creature.position.z == destination_floor && creature.health > 0
            })
            .count();

        let cached_actor_count = game_state
            .creatures
            .values()
            .filter(|creature| {
                creature.position.z == destination_floor
                    && creature.health > 0
                    && creature_visuals
                        .iter()
                        .any(|actor| actor.0 == creature.id)
            })
            .count();

        let actor_cache_ready = cached_actor_count == expected_actor_count;

        // Once all entities exist, leave them in the Bevy world for a few
        // frames before allowing the authoritative floor change. Startup GPU
        // probes already warm the atlas/material path; this settle period also
        // gives deferred actor spawns/extraction time to land.
        let visual_settled = if assets_ready && floor_ready && actor_cache_ready {
            match *floor_visual_ready_since {
                Some((floor, since)) if floor == destination_floor => {
                    now - since >= 0.30
                }
                _ => {
                    *floor_visual_ready_since = Some((destination_floor, now));
                    false
                }
            }
        } else {
            *floor_visual_ready_since = None;
            false
        };

        if !assets_ready
            || !floor_ready
            || !actor_cache_ready
            || !visual_settled
        {
            if !*floor_asset_wait_logged {
                info!(
                    "ALDORIA FLOOR PRELOAD WAIT · destination floor {} · assets={} · static_cache={} · actors={}/{} · settled={}",
                    destination_floor,
                    assets_ready,
                    floor_ready,
                    cached_actor_count,
                    expected_actor_count,
                    visual_settled,
                );
                *floor_asset_wait_logged = true;
            }

            movement.next_step_at = now + 0.05;
            return;
        }

        if *floor_asset_wait_logged {
            info!(
                "ALDORIA FLOOR PRELOAD READY · destination floor {} · static + assets + actors {}/{} ready",
                destination_floor,
                cached_actor_count,
                expected_actor_count,
            );
            *floor_asset_wait_logged = false;
        }
        *floor_visual_ready_since = None;
    }

    sequence.0 = sequence.0.wrapping_add(1).max(1);
    let outgoing = ClientMessage::MoveRequest {
        sequence: sequence.0,
        position: target,
    };

    if network.outbound.send(outgoing).is_err() {
        error!("native network channel is offline");
        return;
    }

    // Match the legacy client's local prediction: animate immediately, then
    // reconcile only when the authoritative server disagrees.
    movement.from = movement.visual;
    movement.logical = predicted_step.destination;
    movement.to = position_to_world(predicted_step.destination);
    movement.started_at = now;
    movement.duration = duration;
}

fn update_player_facing(
    movement: Res<MovementState>,
    mut model: Query<&mut Transform, With<PlayerModelRoot>>,
) {
    // TIBIAGAME_V36_6_1_NATIVE_PLAYER_FACING_DIRECTION
    let delta = movement.to - movement.from;
    let dx = delta.x;
    let dz = delta.z;

    // Keep the last facing direction while idle or during purely vertical
    // floor transitions.
    if dx.abs() < 0.001 && dz.abs() < 0.001 {
        return;
    }

    let yaw = dx.atan2(dz);

    for mut transform in &mut model {
        transform.rotation = Quat::from_rotation_y(yaw);
    }
}

fn interpolate_player(
    time: Res<Time>,
    mut movement: ResMut<MovementState>,
    mut player: Query<&mut Transform, With<LocalPlayer>>,
) {
    let now = time.elapsed_secs_f64();
    let t = if movement.duration <= f64::EPSILON {
        1.0
    } else {
        ((now - movement.started_at) / movement.duration).clamp(0.0, 1.0) as f32
    };
    let eased = t * t * (3.0 - 2.0 * t);
    movement.visual = movement.from.lerp(movement.to, eased);

    let Ok(mut transform) = player.single_mut() else {
        return;
    };
    // TIBIAGAME_V36_6_NATIVE_PLAYER_IDLE_WALK_ANIMATION
    // Skeletal Idle_A now supplies idle motion; keep the entity origin stable.
    transform.translation = movement.visual;
}

fn setup_player_animation(
    mut commands: Commands,
    sources: Res<PlayerAnimationSources>,
    gltfs: Res<Assets<Gltf>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    children: Query<&Children>,
    names: Query<&Name>,
    animation_targets: Query<&AnimationTargetId>,
    model_roots: Query<
        Entity,
        (With<PlayerModelRoot>, Without<PlayerAnimationController>),
    >,
    template_roots: Query<Entity, With<AnimationTemplateRig>>,
) {
    let Some(general) = gltfs.get(&sources.general) else {
        return;
    };
    let Some(movement) = gltfs.get(&sources.movement) else {
        return;
    };

    let Some(idle_clip) = general.named_animations.get("Idle_A").cloned() else {
        return;
    };
    let Some(walk_clip) = movement.named_animations.get("Walking_A").cloned() else {
        return;
    };

    let Some(template_root) = template_roots.iter().next() else {
        return;
    };

    let mut targets_by_name = HashMap::<String, AnimationTargetId>::new();
    for entity in children.iter_descendants(template_root) {
        let (Ok(name), Ok(target)) =
            (names.get(entity), animation_targets.get(entity))
        else {
            continue;
        };
        targets_by_name.insert(name.as_str().to_owned(), *target);
    }

    if targets_by_name.is_empty() {
        return;
    }

    for model_root in &model_roots {
        let mut matched_targets = Vec::new();

        for entity in children.iter_descendants(model_root) {
            let Ok(name) = names.get(entity) else {
                continue;
            };
            let Some(target) = targets_by_name.get(name.as_str()).copied() else {
                continue;
            };
            matched_targets.push((entity, target));
        }

        // Do not mark the model as configured until the spawned glTF hierarchy
        // actually contains enough corresponding rig bones.
        if matched_targets.len() < 8 {
            continue;
        }

        let mut graph = AnimationGraph::new();
        let idle = graph.add_clip(idle_clip.clone(), 1.0, graph.root);
        let walk = graph.add_clip(walk_clip.clone(), 1.0, graph.root);
        let graph_handle = graphs.add(graph);

        let mut player = AnimationPlayer::default();
        let mut transitions = AnimationTransitions::new();
        transitions
            .play(&mut player, idle, Duration::ZERO)
            .repeat();

        commands.entity(model_root).insert((
            player,
            AnimationGraphHandle(graph_handle),
            transitions,
            PlayerAnimationController {
                idle,
                walk,
                state: PlayerAnimationState::Idle,
            },
        ));

        for (entity, target) in matched_targets.iter().copied() {
            commands
                .entity(entity)
                .insert((target, AnimatedBy(model_root)));
        }

        info!(
            "ALDORIA PLAYER ANIMATION BOUND · Idle_A + Walking_A · {} matched targets",
            matched_targets.len(),
        );
    }
}

fn update_player_animation(
    time: Res<Time>,
    movement: Res<MovementState>,
    mut animations: Query<(
        &mut AnimationPlayer,
        &mut AnimationTransitions,
        &mut PlayerAnimationController,
    )>,
) {
    let moving = movement.from != movement.to
        && time.elapsed_secs_f64()
            < movement.started_at + movement.duration + 0.045;

    let desired = if moving {
        PlayerAnimationState::Walk
    } else {
        PlayerAnimationState::Idle
    };

    for (mut player, mut transitions, mut controller) in &mut animations {
        if controller.state == desired {
            continue;
        }

        let node = match desired {
            PlayerAnimationState::Idle => controller.idle,
            PlayerAnimationState::Walk => controller.walk,
        };

        let active = transitions.play(
            &mut player,
            node,
            Duration::from_millis(140),
        );
        active.repeat();

        if desired == PlayerAnimationState::Walk {
            // Match the legacy Three.js AnimatedCharacter walk cadence.
            active.set_speed(1.08);
        }

        controller.state = desired;
    }
}

fn update_building_roofs(
    time: Res<Time>,
    movement: Res<MovementState>,
    camera: Query<&Transform, (With<MainCamera>, Without<BuildingRoof>)>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut roofs: Query<(&mut BuildingRoof, &mut Visibility)>,
    mut walls: Query<(&HouseWallOccluder, &mut Visibility), Without<BuildingRoof>>,
) {
    let Ok(camera) = camera.single() else {
        return;
    };

    let player_2d = Vec2::new(movement.visual.x, movement.visual.z);
    let camera_2d = Vec2::new(camera.translation.x, camera.translation.z);
    let active_floor = movement.logical.z;
    let fade_step = (time.delta_secs() * 9.0).clamp(0.0, 1.0);

    for (mut roof, mut visibility) in &mut roofs {
        if roof.floor != active_floor {
            *visibility = Visibility::Hidden;
            continue;
        }

        *visibility = Visibility::Visible;

        let inside =
            player_2d.x >= roof.min_x
                && player_2d.x <= roof.max_x
                && player_2d.y >= roof.min_z
                && player_2d.y <= roof.max_z;

        let between_camera_and_player = segment_samples_rect(
            player_2d,
            camera_2d,
            Vec2::new(roof.min_x - 0.12, roof.min_z - 0.12),
            Vec2::new(roof.max_x + 0.12, roof.max_z + 0.12),
        );

        let target_opacity =
            if inside || between_camera_and_player { 0.14 } else { 1.0 };
        roof.opacity += (target_opacity - roof.opacity) * fade_step;

        for handle in [&roof.roof_material, &roof.gable_material] {
            if let Some(mut material) = materials.get_mut(handle) {
                material.alpha_mode = AlphaMode::Blend;
                material.base_color =
                    Color::srgba(1.0, 1.0, 1.0, roof.opacity);
            }
        }
    }

    // Roof fade solves the large obstruction. A wall edge can still sit
    // directly between the camera and the player, so perform a Tibia-style
    // local cutaway only on house-wall roots crossed by that sight segment.
    for (wall, mut visibility) in &mut walls {
        if wall.position.z != active_floor {
            *visibility = Visibility::Hidden;
            continue;
        }

        let point = Vec2::new(wall.position.x as f32, wall.position.y as f32);
        let occluding =
            point_segment_distance_squared(point, player_2d, camera_2d)
                <= 0.68 * 0.68;

        *visibility = if occluding {
            Visibility::Hidden
        } else {
            Visibility::Visible
        };
    }
}

fn segment_samples_rect(
    start: Vec2,
    end: Vec2,
    min: Vec2,
    max: Vec2,
) -> bool {
    // Houses are several tiles wide, so a short deterministic sample is both
    // cheaper and less error-prone than maintaining a custom ray/AABB solver.
    // Skip t=0 so merely standing beside a house does not count as occlusion.
    for index in 1..=24 {
        let t = index as f32 / 24.0;
        let point = start.lerp(end, t);
        if point.x >= min.x
            && point.x <= max.x
            && point.y >= min.y
            && point.y <= max.y
        {
            return true;
        }
    }
    false
}

fn point_segment_distance_squared(
    point: Vec2,
    start: Vec2,
    end: Vec2,
) -> f32 {
    let segment = end - start;
    let length_squared = segment.length_squared();
    if length_squared <= f32::EPSILON {
        return point.distance_squared(start);
    }

    let t = ((point - start).dot(segment) / length_squared).clamp(0.0, 1.0);
    point.distance_squared(start + segment * t)
}

fn follow_camera(
    movement: Res<MovementState>,
    mut camera: Query<&mut Transform, (With<MainCamera>, Without<LocalPlayer>)>,
) {
    let Ok(mut transform) = camera.single_mut() else {
        return;
    };
    let target = movement.visual - Vec3::Y * 0.5;
    *transform = Transform::from_translation(target + CAMERA_OFFSET).looking_at(target, Vec3::Y);
}

fn toggle_present_mode(
    keys: Res<ButtonInput<KeyCode>>,
    mut window: Single<&mut Window>,
) {
    if !keys.just_pressed(KeyCode::KeyV) {
        return;
    }

    window.present_mode = if matches!(window.present_mode, PresentMode::AutoVsync) {
        PresentMode::AutoNoVsync
    } else {
        PresentMode::AutoVsync
    };
    info!("ALDORIA NATIVE PRESENT MODE · {:?}", window.present_mode);
}

fn frame_pacing_probe(time: Res<Time>, mut probe: ResMut<FrameProbe>) {
    let now = time.elapsed_secs_f64();
    let frame_ms = time.delta_secs_f64() * 1_000.0;

    if probe.sample_started_at == 0.0 {
        probe.sample_started_at = now;
    }

    probe.frames += 1;
    probe.total_ms += frame_ms;
    probe.max_ms = probe.max_ms.max(frame_ms);

    if frame_ms >= 24.0 {
        probe.drops_24 += 1;
        if now - probe.last_drop_log_at >= 0.75 {
            warn!("ALDORIA NATIVE FRAME DROP · {frame_ms:.2}ms");
            probe.last_drop_log_at = now;
        }
    }
    if frame_ms >= 32.0 {
        probe.drops_32 += 1;
    }

    let elapsed = now - probe.sample_started_at;
    if elapsed < 2.0 {
        return;
    }

    probe.avg_ms = probe.total_ms / probe.frames.max(1) as f64;
    probe.fps = probe.frames as f64 / elapsed.max(f64::EPSILON);
    probe.last_max_ms = probe.max_ms;

    info!(
        "ALDORIA NATIVE PERF · avg={:.2}ms max={:.2}ms fps={:.1} drops24={} drops32={}",
        probe.avg_ms,
        probe.last_max_ms,
        probe.fps,
        probe.drops_24,
        probe.drops_32,
    );

    probe.sample_started_at = now;
    probe.frames = 0;
    probe.total_ms = 0.0;
    probe.max_ms = 0.0;
    probe.drops_24 = 0;
    probe.drops_32 = 0;
}

fn update_hud(
    time: Res<Time>,
    movement: Res<MovementState>,
    identity: Res<LocalIdentity>,
    sequence: Res<MoveSequence>,
    mut probe: ResMut<FrameProbe>,
    window: Single<&Window>,
    mut hud: Query<&mut Text, With<NativeHud>>,
) {
    let now = time.elapsed_secs_f64();
    if now - probe.last_hud_at < 0.2 {
        return;
    }
    probe.last_hud_at = now;

    let Ok(mut text) = hud.single_mut() else {
        return;
    };

    text.0 = format!(
        "ALDORIA NATIVE V{} · LIVE SERVER · protocol {}\n\
         {} · level {} · pos {}:{}:{} · sent {} · ack {}\n\
         present {:?} · avg {:.2}ms · max {:.2}ms · {:.1} FPS\n\
         WASD/arrows move · V toggles vsync",
        version::MIGRATION_VERSION,
        PROTOCOL_VERSION,
        identity.name,
        identity.level,
        movement.logical.x,
        movement.logical.y,
        movement.logical.z,
        sequence.0,
        movement.last_ack_sequence,
        window.present_mode,
        probe.avg_ms,
        probe.last_max_ms,
        probe.fps,
    );
}

fn player_model_path(outfit: &str) -> &'static str {
    match outfit {
        "mage" => "models/kaykit-adventurers/Mage.glb",
        "ranger" => "models/kaykit-adventurers/Ranger.glb",
        "rogue" => "models/kaykit-adventurers/Rogue_Hooded.glb",
        _ => "models/kaykit-adventurers/Knight.glb",
    }
}

fn player_model_scale(outfit: &str) -> f32 {
    match outfit {
        "mage" => 0.697,
        "ranger" => 0.814,
        "rogue" => 0.852,
        _ => 0.727,
    }
}

fn position_to_world(position: Position) -> Vec3 {
    Vec3::new(position.x as f32, 0.575, position.y as f32)
}
