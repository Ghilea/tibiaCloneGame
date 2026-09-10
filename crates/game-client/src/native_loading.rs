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
    last_visible_world_meshes: usize,
    last_visible_player_meshes: usize,
    last_actor_root_count: usize,
    last_actor_meshes: usize,
    stable_presentation_frames: u16,
    render_pipeline_probe_seen: bool,
    render_pipeline_total: usize,
    render_pipeline_waiting: usize,
    render_pipeline_last_total: usize,
    render_pipeline_stable_frames: u16,
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
            last_visible_world_meshes: 0,
            last_visible_player_meshes: 0,
            last_actor_root_count: 0,
            last_actor_meshes: 0,
            stable_presentation_frames: 0,
            render_pipeline_probe_seen: false,
            render_pipeline_total: 0,
            render_pipeline_waiting: 0,
            render_pipeline_last_total: 0,
            render_pipeline_stable_frames: 0,
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

    pub(crate) fn update_render_pipeline_status(
        &mut self,
        total: usize,
        waiting: usize,
    ) {
        let was_ready =
            self.render_pipelines_ready();

        let counts_changed =
            total != self.render_pipeline_total
                || waiting
                    != self.render_pipeline_waiting;

        self.render_pipeline_probe_seen = true;
        self.render_pipeline_total = total;
        self.render_pipeline_waiting = waiting;

        if total > 0
            && waiting == 0
            && total
                == self.render_pipeline_last_total
        {
            self.render_pipeline_stable_frames =
                self.render_pipeline_stable_frames
                    .saturating_add(1);
        } else {
            self.render_pipeline_stable_frames = 0;
        }

        self.render_pipeline_last_total = total;

        if counts_changed {
            info!(
                "ALDORIA GPU PIPELINES · total={} · waiting={} · stable={}/12",
                total,
                waiting,
                self.render_pipeline_stable_frames,
            );
        }

        if !was_ready
            && self.render_pipelines_ready()
        {
            info!(
                "ALDORIA GPU PIPELINES READY · total={} · waiting=0 · stable={}",
                total,
                self.render_pipeline_stable_frames,
            );
        }
    }

    pub(crate) fn render_pipelines_ready(
        &self,
    ) -> bool {
        // Direct/legacy game mode remains compatible if the RenderApp probe
        // was not installed. In single-window mode the probe runs every
        // ExtractSchedule long before the other startup gates can complete.
        !self.render_pipeline_probe_seen
            || (
                self.render_pipeline_total > 0
                    && self.render_pipeline_waiting == 0
                    && self.render_pipeline_stable_frames
                        >= 12
            )
    }

    pub(crate) fn render_pipeline_waiting(
        &self,
    ) -> usize {
        self.render_pipeline_waiting
    }

    pub(crate) fn render_pipeline_total(
        &self,
    ) -> usize {
        self.render_pipeline_total
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

pub(crate) fn setup(
    mut commands: Commands,
    launcher: Option<
        Res<crate::native_launcher::NativeLauncherState>,
    >,
) {
    if launcher.is_some() {
        // Single-window mode uses the launcher's full-screen loading surface.
        return;
    }
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

fn count_descendant_meshes(
    root: Entity,
    children: &Query<&Children>,
    mesh_visibility: &Query<&ViewVisibility, With<Mesh3d>>,
) -> usize {
    let mut pending = vec![root];
    let mut meshes = 0usize;

    while let Some(entity) = pending.pop() {
        if mesh_visibility.get(entity).is_ok() {
            meshes += 1;
        }

        if let Ok(entity_children) = children.get(entity) {
            pending.extend(entity_children.iter());
        }
    }

    meshes
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
                entity_children.iter(),
            );
        }
    }

    visible
}

pub(crate) fn update_render_pipeline_readiness(
    mut main_world:
        ResMut<bevy::render::MainWorld>,
    pipelines: Res<
        bevy::render::render_resource::PipelineCache,
    >,
) {
    let total =
        pipelines.pipelines().count();

    let waiting =
        pipelines.waiting_pipelines().count();

    if let Some(mut loading) =
        main_world
            .get_resource_mut::<NativeLoadingState>()
    {
        loading.update_render_pipeline_status(
            total,
            waiting,
        );
    }
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
            Entity,
            &WorldAssetRoot,
            Option<
                &bevy::world_serialization::WorldInstance,
            >,
            Option<&crate::AnimationTemplateRig>,
        ),
    >,
    player_model_roots: Query<
        Entity,
        With<crate::PlayerModelRoot>,
    >,
    actor_roots: Query<
        Entity,
        Or<(
            With<crate::CreatureActor>,
            With<crate::NpcActor>,
            With<crate::ResourceActor>,
        )>,
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

    let actor_root_count = actor_roots.iter().count();

    let mut actor_roots_with_mesh = 0usize;
    let mut actor_meshes = 0usize;

    for root in &actor_roots {
        let meshes =
            count_descendant_meshes(
                root,
                &children,
                &mesh_visibility,
            );

        actor_meshes += meshes;

        if meshes > 0 {
            actor_roots_with_mesh += 1;
        }
    }

    let presentation_unchanged =
        visible_world_meshes == state.last_visible_world_meshes
            && visible_player_meshes == state.last_visible_player_meshes
            && actor_root_count == state.last_actor_root_count
            && actor_meshes == state.last_actor_meshes
            && visible_world_meshes > 0
            && visible_player_meshes > 0;

    if presentation_unchanged {
        state.stable_presentation_frames =
            state.stable_presentation_frames.saturating_add(1);
    } else {
        state.stable_presentation_frames = 0;
        state.last_visible_world_meshes = visible_world_meshes;
        state.last_visible_player_meshes = visible_player_meshes;
        state.last_actor_root_count = actor_root_count;
        state.last_actor_meshes = actor_meshes;
    }

    let actors_instantiated =
        actor_roots_with_mesh
            == actor_root_count;
    let presentation_stable =
        actors_instantiated && state.stable_presentation_frames >= 120;

    let creature_assets_ready =
        creature_sprites::floor_transition_creature_assets_ready(
            &asset_server,
            &creature_catalog,
        );

    let mut world_asset_root_count = 0usize;
    let mut world_asset_instance_count = 0usize;
    let mut world_asset_render_root_count = 0usize;
    let mut world_asset_roots_with_mesh = 0usize;
    let mut world_asset_dependencies_ready = true;

    for (
        entity,
        root,
        instance,
        animation_template,
    ) in &world_asset_roots
    {
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

        // AnimationTemplateRig is deliberately hidden and exists only to
        // provide animation sources. Every other WorldAssetRoot represents
        // presentation that should have produced at least one mesh.
        if animation_template.is_none() {
            world_asset_render_root_count += 1;

            if count_descendant_meshes(
                entity,
                &children,
                &mesh_visibility,
            ) > 0
            {
                world_asset_roots_with_mesh += 1;
            }
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
            && world_asset_render_root_count > 0
            && world_asset_roots_with_mesh
                == world_asset_render_root_count
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
        state.stable_render_frames >= 12
            && actors_instantiated
            && presentation_stable;

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
                    "Loading models... instances={}/{} meshes={}/{}",
                    world_asset_instance_count,
                    world_asset_root_count,
                    world_asset_roots_with_mesh,
                    world_asset_render_root_count,
                ),
                80.0,
            )
        } else if !render_visibility_ready {
            state.ready_frames = 0;
            state.ready_seconds = 0.0;

            (
                "visibility",
                format!(
                    "Waiting for complete presentation... world={} player={} actors={}/{} render={}/12 presentation={}/120",
                    visible_world_meshes,
                    visible_player_meshes,
                    actor_meshes,
                    actor_root_count,
                    state.stable_render_frames,
                    state.stable_presentation_frames,
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

    // ALDORIA GPU PIPELINE GATE

    // ViewVisibility does not imply that wgpu has finished compiling the

    // StandardMaterial / mesh pipelines needed to draw the scene.

    if world_ready

        && streamed_entities_ready

        && creature_assets_ready

        && world_assets_ready

        && render_visibility_ready

        && !state.render_pipelines_ready()

    {

        state.ready_frames = 0;

        state.ready_seconds = 0.0;


        if let Ok(mut text) = status.single_mut() {

            text.0 = format!(

                "Compiling GPU pipelines... {} waiting / {} total",

                state.render_pipeline_waiting(),

                state.render_pipeline_total(),

            );

        }


        if let Ok(mut node) = progress.single_mut() {

            node.width = Val::Percent(98.0);

        }

    }



    if world_ready
        && streamed_entities_ready
        && creature_assets_ready
        && world_assets_ready
        && render_visibility_ready
        && state.render_pipelines_ready()
        && state.ready_frames >= 2
        && state.visible_seconds >= 1.0
        && state.ready_seconds >= 2.50
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
