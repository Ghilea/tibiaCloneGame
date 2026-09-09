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
    last_stage: &'static str,
}

impl Default for NativeLoadingState {
    fn default() -> Self {
        Self {
            active: true,
            ready_frames: 0,
            last_stage: "",
        }
    }
}

impl NativeLoadingState {
    pub(crate) fn active(&self) -> bool {
        self.active
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

pub(crate) fn update(
    stream: Res<streaming::RegionStream>,
    movement: Res<MovementState>,
    asset_server: Res<AssetServer>,
    creature_catalog: Res<creature_sprites::CreatureSpriteCatalog>,
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

    let floor = movement.logical.z;
    let world_ready = stream.floor_ready(floor);
    let creature_assets_ready =
        creature_sprites::floor_transition_creature_assets_ready(
            &asset_server,
            &creature_catalog,
        );

    let (stage, label, width) = if !world_ready {
        state.ready_frames = 0;
        (
            "world",
            format!(
                "Loading world cache for floor {floor}..."
            ),
            38.0,
        )
    } else if !creature_assets_ready {
        state.ready_frames = 0;
        (
            "creatures",
            "Preparing creature visuals...".to_owned(),
            72.0,
        )
    } else {
        state.ready_frames =
            state.ready_frames.saturating_add(1);

        (
            "interface",
            "Synchronizing actors and interface...".to_owned(),
            94.0,
        )
    };

    if stage != state.last_stage {
        info!(
            "ALDORIA STARTUP LOADING · stage {} · floor {} · world_ready={} · creature_assets_ready={}",
            stage,
            floor,
            world_ready,
            creature_assets_ready,
        );
        state.last_stage = stage;
    }

    if let Ok(mut text) = status.single_mut() {
        text.0 = label;
    }

    if let Ok(mut node) = progress.single_mut() {
        node.width = Val::Percent(width);
    }

    // RegionStream marks floor_ready only after its complete staged build has
    // committed. Waiting two additional ready frames gives deferred entity/UI
    // commands a frame to settle before input and world presentation are
    // released.
    if world_ready
        && creature_assets_ready
        && state.ready_frames >= 2
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
            "ALDORIA STARTUP READY · floor {} · world cache + creature assets committed",
            floor,
        );
    }
}
