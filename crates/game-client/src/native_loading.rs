// TIBIAGAME_V36_41_AUTHORITATIVE_STARTUP_LOADING_SCREEN
use bevy::prelude::*;

use crate::{
    MovementState,
    creature_sprites,
    native_ui_theme as theme,
    streaming,
};

#[derive(Resource)]
pub(crate) struct NativeLoadingState {
    active: bool,
    ready_frames: u8,
    visible_seconds: f32,
    ready_seconds: f32,
    last_streamed_entity_count: usize,
    stable_stream_frames: u8,
    last_world_asset_root_count: usize,
    stable_world_asset_frames: u8,
    stable_render_frames: u8,
    last_stage: &'static str,
}

impl Default for NativeLoadingState {
    fn default() -> Self {
        Self {
            active: true,
            ready_frames: 0,
            visible_seconds: 0.0,
            ready_seconds: 0.0,
            last_streamed_entity_count: 0,
            stable_stream_frames: 0,
            last_world_asset_root_count: 0,
            stable_world_asset_frames: 0,
            stable_render_frames: 0,
            last_stage: "",
        }
    }
}

impl NativeLoadingState {
    pub(crate) fn active(&self) -> bool {
        self.active
    }

    pub(crate) fn stage_label(&self) -> &'static str {
        match self.last_stage {
            "entities" => "Committing world entities...",
            "creatures" => "Preparing creature visuals...",
            "models" => "Loading player and world models...",
            "visibility" => "Waiting for rendered world...",
            "render" => "Finalizing rendered world...",
            _ => "Loading world geometry...",
        }
    }

    pub(crate) fn progress_percent(&self) -> f32 {
        match self.last_stage {
            "entities" => 52.0,
            "creatures" => 66.0,
            "models" => 80.0,
            "visibility" => 91.0,
            "render" => 97.0,
            _ => 30.0,
        }
    }
}

#[derive(Component)]
pub(crate) struct NativeLoadingOverlay;

#[derive(Component)]
pub(crate) struct NativeLoadingStatus;

#[derive(Component)]
pub(crate) struct NativeLoadingProgress;

pub(crate) fn gameplay_ready(
    state: Option<Res<NativeLoadingState>>,
) -> bool {
    let Some(state) = state else {
        return false;
    };

    !state.active()
}

pub(crate) fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native startup loading overlay"),
            NativeLoadingOverlay,
            ZIndex(80),
        Node {
                position_type: PositionType::Absolute,
                left: px(0),
                right: px(0),
                top: px(0),
                bottom: px(0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(
                Color::srgba(0.02, 0.03, 0.04, 0.18),
            ),
        ))
        .with_children(|root| {
            root
                .spawn((
                    Node {
                        width: px(560),
                        min_height: px(250),
                        padding: UiRect::all(px(28)),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(10)),
                        flex_direction: FlexDirection::Column,
                        align_items: AlignItems::Center,
                        justify_content: JustifyContent::Center,
                        row_gap: px(14),
                        ..default()
                    },
                    BackgroundColor(theme::PANEL_BG_DEEP),
                    BorderColor::all(theme::GOLD_DARK),
                ))
                .with_children(|card| {
                    card.spawn((
                        Text::new("EMBERS OF ALDORIA"),
                        TextFont {
                            font_size: FontSize::Px(26.0),
                            ..default()
                        },
                        TextColor(theme::GOLD_BRIGHT),
                    ));

                    card.spawn((
                        Text::new("ENTERING THE WORLD"),
                        TextFont {
                            font_size: FontSize::Px(13.0),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));

                    card.spawn((
                        NativeLoadingStatus,
                        Text::new("Loading world geometry..."),
                        TextFont {
                            font_size: FontSize::Px(15.0),
                            ..default()
                        },
                        TextColor(theme::TEXT),
                    ));

                    card
                        .spawn((
                            Node {
                                width: px(470),
                                height: px(12),
                                border: UiRect::all(px(1)),
                                border_radius: BorderRadius::all(px(4)),
                                ..default()
                            },
                            BackgroundColor(theme::PANEL_BG_SOFT),
                            BorderColor::all(theme::GOLD_DARK),
                        ))
                        .with_child((
                            NativeLoadingProgress,
                            Node {
                                width: Val::Percent(12.0),
                                height: Val::Percent(100.0),
                                border_radius: BorderRadius::all(px(3)),
                                ..default()
                            },
                            BackgroundColor(theme::GOLD),
                        ));

                    card.spawn((
                        Text::new(
                            "World cache | creature assets | interface",
                        ),
                        TextFont {
                            font_size: FontSize::Px(10.5),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));
                });
        });
}

fn count_visible_descendant_meshes(
    root: Entity,
    children: &Query<&Children>,
    mesh_visibility: &Query<
        &ViewVisibility,
        With<Mesh3d>,
    >,
) -> usize {
    let mut pending = vec![root];
    let mut visible = 0usize;

    while let Some(entity) = pending.pop() {
        if mesh_visibility
            .get(entity)
            .is_ok_and(|visibility| visibility.get())
        {
            visible += 1;
        }

        if let Ok(entity_children) = children.get(entity) {
            pending.extend(
                entity_children.iter().copied(),
            );
        }
    }

    visible
}

pub(crate) fn update(
    time: Res<Time>,
    stream: Res<streaming::RegionStream>,
    movement: Res<MovementState>,
    asset_server: Res<AssetServer>,
    creature_catalog:
        Res<creature_sprites::CreatureSpriteCatalog>,
    streamed_entities: Query<
        &streaming::StreamedRegionEntity,
    >,
    streamed_renderables: Query<
        (
            &streaming::StreamedRegionEntity,
            &ViewVisibility,
        ),
        With<Mesh3d>,
    >,
    world_asset_roots: Query<
        (
            &WorldAssetRoot,
            Option<
                &bevy::world_serialization::WorldInstance,
            >,
        ),
    >,
    player_model_roots: Query<
        Entity,
        With<crate::PlayerModelRoot>,
    >,
    children: Query<&Children>,
    mesh_visibility: Query<
        &ViewVisibility,
        With<Mesh3d>,
    >,
    mut state: ResMut<NativeLoadingState>,
    mut overlay: Query<
        &mut Visibility,
        With<NativeLoadingOverlay>,
    >,
    mut status: Query<
        &mut Text,
        With<NativeLoadingStatus>,
    >,
    mut progress: Query<
        &mut Node,
        With<NativeLoadingProgress>,
    >,
) {
    if !state.active {
        return;
    }

    state.visible_seconds +=
        time.delta().as_secs_f32();

    let floor = movement.logical.z;
    let world_ready = stream.floor_ready(floor);
    let active_generation =
        stream.active_generation();

    let streamed_entity_count =
        streamed_entities
            .iter()
            .filter(|entity| {
                entity.belongs_to_active_floor(
                    active_generation,
                    floor,
                )
            })
            .count();

    if streamed_entity_count
        == state.last_streamed_entity_count
        && streamed_entity_count > 0
    {
        state.stable_stream_frames =
            state.stable_stream_frames
                .saturating_add(1);
    } else {
        state.stable_stream_frames = 0;
        state.last_streamed_entity_count =
            streamed_entity_count;
    }

    let streamed_entities_ready =
        world_ready
            && streamed_entity_count > 0
            && state.stable_stream_frames >= 4;

    let visible_world_meshes =
        streamed_renderables
            .iter()
            .filter(|(entity, visibility)| {
                entity.belongs_to_active_floor(
                    active_generation,
                    floor,
                ) && visibility.get()
            })
            .count();

    let visible_player_meshes =
        player_model_roots
            .iter()
            .map(|root| {
                count_visible_descendant_meshes(
                    root,
                    &children,
                    &mesh_visibility,
                )
            })
            .sum::<usize>();

    let creature_assets_ready =
        creature_sprites::floor_transition_creature_assets_ready(
            &asset_server,
            &creature_catalog,
        );

    let mut world_asset_root_count = 0usize;
    let mut world_asset_instance_count = 0usize;
    let mut world_asset_dependencies_ready = true;

    for (root, instance) in &world_asset_roots {
        world_asset_root_count += 1;

        let dependencies_ready =
            asset_server.is_loaded_with_dependencies(
                root.0.id(),
            );

        world_asset_dependencies_ready &=
            dependencies_ready;

        if dependencies_ready
            && instance.is_some()
        {
            world_asset_instance_count += 1;
        }
    }

    if world_asset_root_count
        == state.last_world_asset_root_count
        && world_asset_root_count >= 2
    {
        state.stable_world_asset_frames =
            state.stable_world_asset_frames
                .saturating_add(1);
    } else {
        state.stable_world_asset_frames = 0;
        state.last_world_asset_root_count =
            world_asset_root_count;
    }

    let world_assets_ready =
        world_asset_root_count >= 2
            && world_asset_dependencies_ready
            && world_asset_instance_count
                == world_asset_root_count
            && state.stable_world_asset_frames >= 4;

    let render_visible =
        visible_world_meshes > 0
            && visible_player_meshes > 0;

    if render_visible {
        state.stable_render_frames =
            state.stable_render_frames
                .saturating_add(1);
    } else {
        state.stable_render_frames = 0;
    }

    let render_visibility_ready =
        state.stable_render_frames >= 12;

    let (stage, label, width) =
        if !world_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "world",
                format!(
                    "Loading world cache for floor {floor}..."
                ),
                30.0,
            )
        } else if !streamed_entities_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "entities",
                format!(
                    "Committing world entities... {} ready",
                    streamed_entity_count,
                ),
                52.0,
            )
        } else if !creature_assets_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "creatures",
                "Preparing creature visuals..."
                    .to_owned(),
                66.0,
            )
        } else if !world_assets_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "models",
                format!(
                    "Loading models... {}/{} instantiated",
                    world_asset_instance_count,
                    world_asset_root_count,
                ),
                80.0,
            )
        } else if !render_visibility_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "visibility",
                format!(
                    "Waiting for rendered world... world={} player={} stable={}/12",
                    visible_world_meshes,
                    visible_player_meshes,
                    state.stable_render_frames,
                ),
                91.0,
            )
        } else {
            state.ready_frames =
                state.ready_frames
                    .saturating_add(1);
            state.ready_seconds +=
                time.delta().as_secs_f32();

            (
                "render",
                "Finalizing rendered world..."
                    .to_owned(),
                97.0,
            )
        };

    if stage != state.last_stage {
        info!(
            "ALDORIA STARTUP LOADING · stage {} · floor {} · world_ready={} · streamed={} stable={} · visible_world={} · visible_player={} · creature_assets_ready={} · world_assets={}/{} stable={} · render_stable={}",
            stage,
            floor,
            world_ready,
            streamed_entity_count,
            state.stable_stream_frames,
            visible_world_meshes,
            visible_player_meshes,
            creature_assets_ready,
            world_asset_instance_count,
            world_asset_root_count,
            state.stable_world_asset_frames,
            state.stable_render_frames,
        );

        state.last_stage = stage;
    }

    if let Ok(mut text) = status.single_mut() {
        text.0 = label;
    }

    if let Ok(mut node) = progress.single_mut() {
        node.width = Val::Percent(width);
    }

    if world_ready
        && streamed_entities_ready
        && creature_assets_ready
        && world_assets_ready
        && render_visibility_ready
        && state.ready_frames >= 2
        && state.visible_seconds >= 1.0
        && state.ready_seconds >= 0.85
    {
        state.active = false;

        if let Ok(mut node) = progress.single_mut() {
            node.width = Val::Percent(100.0);
        }

        if let Ok(mut text) = status.single_mut() {
            text.0 = "World ready.".into();
        }

        if let Ok(mut visibility) = overlay.single_mut() {
            *visibility = Visibility::Hidden;
        }

        info!(
            "ALDORIA STARTUP READY · floor {} · streamed {} · visible world meshes {} · visible player meshes {} · world assets {}/{} instantiated",
            floor,
            streamed_entity_count,
            visible_world_meshes,
            visible_player_meshes,
            world_asset_instance_count,
            world_asset_root_count,
        );
    }
}
