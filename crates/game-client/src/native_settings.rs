// TIBIAGAME_V36_28_1_NATIVE_OPTIONS_AUDIO
use std::{fs, path::PathBuf};

use bevy::{
    audio::{AudioPlayer, AudioSink, AudioSinkPlayback, AudioSource, PlaybackSettings, Volume},
    prelude::*,
};
use serde::{Deserialize, Serialize};

use crate::{
    native_map_ui::NativeMapUiState, native_modal, native_ui::NativePanelState,
    native_ui_theme as theme, state::NativeGameState,
};

const DEFAULT_MASTER: u8 = 100;
const DEFAULT_MUSIC: u8 = 18;
const DEFAULT_EFFECTS: u8 = 80;

const TOWN_TRACK: &str = "audio/music/medieval-harvest-season.mp3";
const WILDERNESS_TRACK: &str = "audio/music/medieval-exploration.mp3";
const SWAMP_TRACK: &str = "audio/music/swamp-theme-loop.ogg";
const BATTLE_TRACK: &str = "audio/music/battle-theme.mp3";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct NativeSettings {
    pub(crate) master_volume: u8,
    pub(crate) music_volume: u8,
    pub(crate) effects_volume: u8,
    pub(crate) muted: bool,
    pub(crate) reduced_motion: bool,
    pub(crate) show_performance: bool,
}

impl Default for NativeSettings {
    fn default() -> Self {
        Self {
            master_volume: DEFAULT_MASTER,
            music_volume: DEFAULT_MUSIC,
            effects_volume: DEFAULT_EFFECTS,
            muted: false,
            reduced_motion: false,
            show_performance: false,
        }
    }
}

impl NativeSettings {
    pub(crate) fn load() -> Self {
        let path = settings_path();
        let Ok(raw) = fs::read_to_string(&path) else {
            return Self::default();
        };
        let Ok(mut value) = serde_json::from_str::<Self>(&raw) else {
            warn!("ALDORIA SETTINGS · could not parse {}", path.display(),);
            return Self::default();
        };
        value.normalize();
        value
    }

    fn normalize(&mut self) {
        self.master_volume = self.master_volume.min(100);
        self.music_volume = self.music_volume.min(100);
        self.effects_volume = self.effects_volume.min(100);
    }

    fn save(&self) {
        let path = settings_path();
        if let Some(parent) = path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                warn!(
                    "ALDORIA SETTINGS · could not create {}: {}",
                    parent.display(),
                    error,
                );
                return;
            }
        }

        let Ok(raw) = serde_json::to_string_pretty(self) else {
            return;
        };

        if let Err(error) = fs::write(&path, raw) {
            warn!(
                "ALDORIA SETTINGS · could not write {}: {}",
                path.display(),
                error,
            );
        }
    }

    pub(crate) fn effective_music_volume(&self) -> f32 {
        if self.muted {
            return 0.0;
        }

        (self.master_volume as f32 / 100.0) * (self.music_volume as f32 / 100.0)
    }
}

fn settings_path() -> PathBuf {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return PathBuf::from(app_data)
            .join("Embers of Aldoria")
            .join("native-settings.json");
    }

    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".config")
            .join("embers-of-aldoria")
            .join("native-settings.json");
    }

    PathBuf::from("native-settings.json")
}

#[derive(Resource)]
pub(crate) struct NativeSettingsState {
    pub(crate) settings: NativeSettings,
    pub(crate) options_open: bool,
    selected: usize,
    fps: f64,
    average_ms: f64,
    max_ms: f64,
    sample_frames: u32,
    sample_total_ms: f64,
    sample_max_ms: f64,
    sample_elapsed: f64,
}

impl Default for NativeSettingsState {
    fn default() -> Self {
        Self {
            settings: NativeSettings::load(),
            options_open: false,
            selected: 0,
            fps: 0.0,
            average_ms: 0.0,
            max_ms: 0.0,
            sample_frames: 0,
            sample_total_ms: 0.0,
            sample_max_ms: 0.0,
            sample_elapsed: 0.0,
        }
    }
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeSettingsText {
    Performance,
}

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeSettingsValue(pub(crate) usize);

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeSettingsAction {
    Decrease(usize),
    Increase(usize),
    Toggle(usize),
    Close,
}

#[derive(Component)]
pub(crate) struct NativeOptionsPanel;

#[derive(Component)]
pub(crate) struct NativePerformancePanel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MusicMood {
    Town,
    Wilderness,
    Swamp,
    Battle,
}

#[derive(Component)]
pub(crate) struct NativeMusic {
    mood: MusicMood,
}

pub fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native modal · options"),
            NativeOptionsPanel,
            native_modal::NativeModalRoot,
            GlobalZIndex(180),
            Visibility::Hidden,
            native_modal::root_node(),
            native_modal::backdrop(),
        ))
        .with_children(|root| {
            root.spawn((
                Name::new("Native modal surface · options"),
                native_modal::NativeModalSurface,
                native_modal::panel_node(720.0, 520.0),
                native_modal::surface(),
                native_modal::surface_border(),
            ))
            .with_children(|panel| {
                panel
                    .spawn((native_modal::header_node(), native_modal::divider_border()))
                    .with_children(|header| {
                        header
                            .spawn(native_modal::header_copy_node())
                            .with_children(|copy| {
                                copy.spawn((
                                    Text::new("OPTIONS"),
                                    TextFont {
                                        font_size: FontSize::Px(24.0),
                                        ..default()
                                    },
                                    TextColor(theme::GOLD_BRIGHT),
                                ));

                                copy.spawn((
                                    Text::new("Audio, accessibility and diagnostics"),
                                    TextFont {
                                        font_size: FontSize::Px(11.0),
                                        ..default()
                                    },
                                    TextColor(theme::MUTED),
                                ));
                            });

                        spawn_settings_button(header, NativeSettingsAction::Close, "X", 42.0);
                    });

                panel
                    .spawn(native_modal::body_node())
                    .with_children(|body| {
                        spawn_volume_row(body, 0, "MASTER VOLUME", "Overall output level");

                        spawn_volume_row(body, 1, "MUSIC VOLUME", "World and combat music");

                        spawn_volume_row(body, 2, "EFFECTS VOLUME", "Gameplay sound effects");

                        spawn_toggle_row(
                            body,
                            3,
                            "MUTE ALL AUDIO",
                            "Temporarily silence native audio",
                        );

                        spawn_toggle_row(
                            body,
                            4,
                            "REDUCED MOTION",
                            "Reduce non-essential movement effects",
                        );

                        spawn_toggle_row(
                            body,
                            5,
                            "PERFORMANCE HUD",
                            "Show FPS and frame-time diagnostics",
                        );
                    });

                panel
                    .spawn((native_modal::footer_node(), native_modal::divider_border()))
                    .with_children(|footer| {
                        footer.spawn((
                            Text::new("F10 / Esc closes  |  Arrow keys and Space still work"),
                            TextFont {
                                font_size: FontSize::Px(9.8),
                                ..default()
                            },
                            TextColor(theme::MUTED),
                        ));

                        spawn_settings_button(footer, NativeSettingsAction::Close, "DONE", 118.0);
                    });
            });
        });

    commands
        .spawn((
            Name::new("Native performance HUD"),
            NativePerformancePanel,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: px(14),
                left: Val::Percent(50.0),
                width: px(310),
                margin: UiRect::left(px(-155)),
                padding: UiRect::all(px(7)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.015, 0.020, 0.018, 0.82)),
        ))
        .with_child(settings_text(
            "",
            NativeSettingsText::Performance,
            11.0,
            Color::srgb(0.72, 0.78, 0.73),
        ));
}

fn spawn_settings_button(
    parent: &mut ChildSpawnerCommands,
    action: NativeSettingsAction,
    label: &str,
    width: f32,
) {
    parent
        .spawn((
            Button,
            action,
            Node {
                width: px(width),
                height: px(38),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(theme::BUTTON_BG),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_child((
            Text::new(label),
            TextFont {
                font_size: FontSize::Px(11.0),
                ..default()
            },
            TextColor(theme::TEXT),
        ));
}

fn settings_row_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(58),
        padding: UiRect {
            left: px(12),
            right: px(10),
            top: px(8),
            bottom: px(8),
        },
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(7)),
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        justify_content: JustifyContent::SpaceBetween,
        column_gap: px(12),
        ..default()
    }
}

fn settings_row_copy(parent: &mut ChildSpawnerCommands, title: &str, detail: &str) {
    parent
        .spawn(Node {
            flex_grow: 1.0,
            flex_direction: FlexDirection::Column,
            row_gap: px(3),
            ..default()
        })
        .with_children(|copy| {
            copy.spawn((
                Text::new(title),
                TextFont {
                    font_size: FontSize::Px(12.0),
                    ..default()
                },
                TextColor(theme::TEXT),
            ));

            copy.spawn((
                Text::new(detail),
                TextFont {
                    font_size: FontSize::Px(9.5),
                    ..default()
                },
                TextColor(theme::MUTED),
            ));
        });
}

fn spawn_volume_row(parent: &mut ChildSpawnerCommands, index: usize, title: &str, detail: &str) {
    parent
        .spawn((
            settings_row_node(),
            BackgroundColor(theme::PANEL_BG_SOFT),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_children(|row| {
            settings_row_copy(row, title, detail);

            row.spawn(Node {
                flex_direction: FlexDirection::Row,
                align_items: AlignItems::Center,
                column_gap: px(6),
                ..default()
            })
            .with_children(|controls| {
                spawn_settings_button(controls, NativeSettingsAction::Decrease(index), "-", 38.0);

                controls.spawn((
                    NativeSettingsValue(index),
                    Text::new("0%"),
                    TextFont {
                        font_size: FontSize::Px(12.0),
                        ..default()
                    },
                    TextColor(theme::GOLD_BRIGHT),
                    Node {
                        width: px(54),
                        justify_content: JustifyContent::Center,
                        ..default()
                    },
                ));

                spawn_settings_button(controls, NativeSettingsAction::Increase(index), "+", 38.0);
            });
        });
}

fn spawn_toggle_row(parent: &mut ChildSpawnerCommands, index: usize, title: &str, detail: &str) {
    parent
        .spawn((
            settings_row_node(),
            BackgroundColor(theme::PANEL_BG_SOFT),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_children(|row| {
            settings_row_copy(row, title, detail);

            row.spawn((
                Button,
                NativeSettingsAction::Toggle(index),
                Node {
                    width: px(92),
                    height: px(38),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(6)),
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    ..default()
                },
                BackgroundColor(theme::BUTTON_BG),
                BorderColor::all(theme::BUTTON_BORDER),
            ))
            .with_child((
                NativeSettingsValue(index),
                Text::new("OFF"),
                TextFont {
                    font_size: FontSize::Px(11.0),
                    ..default()
                },
                TextColor(theme::TEXT),
            ));
        });
}

fn settings_text(
    value: impl Into<String>,
    kind: NativeSettingsText,
    size: f32,
    color: Color,
) -> impl Bundle {
    (
        kind,
        Text::new(value),
        TextFont {
            font_size: FontSize::Px(size),
            ..default()
        },
        TextColor(color),
    )
}

pub fn handle_input(
    keys: Res<ButtonInput<KeyCode>>,
    game_state: Res<NativeGameState>,
    mut state: ResMut<NativeSettingsState>,
    mut panels: ResMut<NativePanelState>,
    mut map_ui: ResMut<NativeMapUiState>,
) {
    if keys.just_pressed(KeyCode::F10) {
        if game_state.trade.is_some() {
            return;
        }

        state.options_open = !state.options_open;
        if state.options_open {
            close_other_panels(&mut panels, &mut map_ui);
        }
        return;
    }

    if !state.options_open {
        return;
    }

    if keys.just_pressed(KeyCode::Escape) {
        state.options_open = false;
        return;
    }

    if keys.just_pressed(KeyCode::ArrowDown) {
        state.selected = (state.selected + 1) % 6;
    }

    if keys.just_pressed(KeyCode::ArrowUp) {
        state.selected = if state.selected == 0 {
            5
        } else {
            state.selected - 1
        };
    }

    let decrease = keys.just_pressed(KeyCode::ArrowLeft);
    let increase = keys.just_pressed(KeyCode::ArrowRight);

    let mut changed = false;

    match state.selected {
        0 if decrease || increase => {
            changed = adjust_volume(&mut state.settings.master_volume, increase);
        }
        1 if decrease || increase => {
            changed = adjust_volume(&mut state.settings.music_volume, increase);
        }
        2 if decrease || increase => {
            changed = adjust_volume(&mut state.settings.effects_volume, increase);
        }
        3 if keys.just_pressed(KeyCode::Space) => {
            state.settings.muted = !state.settings.muted;
            changed = true;
        }
        4 if keys.just_pressed(KeyCode::Space) => {
            state.settings.reduced_motion = !state.settings.reduced_motion;
            changed = true;
        }
        5 if keys.just_pressed(KeyCode::Space) => {
            state.settings.show_performance = !state.settings.show_performance;
            changed = true;
        }
        _ => {}
    }

    if changed {
        state.settings.save();
    }
}

fn close_other_panels(panels: &mut NativePanelState, map_ui: &mut NativeMapUiState) {
    panels.inventory_open = false;
    panels.character_open = false;
    panels.skills_open = false;
    panels.spells_open = false;
    panels.crafting_open = false;
    panels.npc_open = false;
    map_ui.world_map_open = false;
}

fn adjust_volume(value: &mut u8, increase: bool) -> bool {
    let before = *value;

    if increase {
        *value = value.saturating_add(5).min(100);
    } else {
        *value = value.saturating_sub(5);
    }

    *value != before
}

pub(crate) fn handle_buttons(
    mut state: ResMut<NativeSettingsState>,
    mut buttons: Query<
        (
            &Interaction,
            &NativeSettingsAction,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (interaction, action, mut background, mut border) in &mut buttons {
        match *interaction {
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                if !state.options_open {
                    continue;
                }

                let mut changed = false;

                match *action {
                    NativeSettingsAction::Decrease(index) => {
                        changed = adjust_setting_index(&mut state, index, false);
                    }
                    NativeSettingsAction::Increase(index) => {
                        changed = adjust_setting_index(&mut state, index, true);
                    }
                    NativeSettingsAction::Toggle(index) => {
                        changed = toggle_setting_index(&mut state, index);
                    }
                    NativeSettingsAction::Close => {
                        state.options_open = false;
                    }
                }

                if changed {
                    state.settings.save();
                }
            }
        }
    }
}

fn adjust_setting_index(state: &mut NativeSettingsState, index: usize, increase: bool) -> bool {
    state.selected = index.min(5);

    match index {
        0 => adjust_volume(&mut state.settings.master_volume, increase),
        1 => adjust_volume(&mut state.settings.music_volume, increase),
        2 => adjust_volume(&mut state.settings.effects_volume, increase),
        _ => false,
    }
}

fn toggle_setting_index(state: &mut NativeSettingsState, index: usize) -> bool {
    state.selected = index.min(5);

    match index {
        3 => {
            state.settings.muted = !state.settings.muted;
            true
        }
        4 => {
            state.settings.reduced_motion = !state.settings.reduced_motion;
            true
        }
        5 => {
            state.settings.show_performance = !state.settings.show_performance;
            true
        }
        _ => false,
    }
}

pub fn update_performance_probe(time: Res<Time>, mut state: ResMut<NativeSettingsState>) {
    let frame_seconds = time.delta().as_secs_f64();
    let frame_ms = frame_seconds * 1000.0;

    state.sample_frames += 1;
    state.sample_total_ms += frame_ms;
    state.sample_max_ms = state.sample_max_ms.max(frame_ms);
    state.sample_elapsed += frame_seconds;

    if state.sample_elapsed < 0.5 {
        return;
    }

    let elapsed = state.sample_elapsed.max(0.001);
    let frames = state.sample_frames.max(1) as f64;

    state.fps = frames / elapsed;
    state.average_ms = state.sample_total_ms / frames;
    state.max_ms = state.sample_max_ms;

    state.sample_frames = 0;
    state.sample_total_ms = 0.0;
    state.sample_max_ms = 0.0;
    state.sample_elapsed = 0.0;
}

pub fn update_ui(
    state: Res<NativeSettingsState>,
    mut queries: ParamSet<(
        Query<(&NativeSettingsText, &mut Text)>,
        Query<(&NativeSettingsValue, &mut Text, &mut TextColor)>,
        Query<&mut Visibility, With<NativeOptionsPanel>>,
        Query<&mut Visibility, With<NativePerformancePanel>>,
    )>,
) {
    for mut visibility in &mut queries.p2() {
        *visibility = if state.options_open {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    for mut visibility in &mut queries.p3() {
        *visibility = if state.settings.show_performance {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    let performance = format!(
        "FPS {:>5.1}   |   avg {:>5.2} ms   |   max {:>5.2} ms",
        state.fps, state.average_ms, state.max_ms,
    );

    for (kind, mut text) in &mut queries.p0() {
        match kind {
            NativeSettingsText::Performance => {
                text.0 = performance.clone();
            }
        }
    }

    for (value, mut text, mut color) in &mut queries.p1() {
        text.0 = settings_value_label(&state, value.0);

        color.0 = if state.selected == value.0 {
            theme::GOLD_BRIGHT
        } else {
            theme::TEXT
        };
    }
}

fn settings_value_label(state: &NativeSettingsState, index: usize) -> String {
    match index {
        0 => {
            format!("{}%", state.settings.master_volume,)
        }
        1 => {
            format!("{}%", state.settings.music_volume,)
        }
        2 => {
            format!("{}%", state.settings.effects_volume,)
        }
        3 => toggle_label(state.settings.muted).into(),
        4 => toggle_label(state.settings.reduced_motion).into(),
        5 => toggle_label(state.settings.show_performance).into(),
        _ => String::new(),
    }
}

fn toggle_label(value: bool) -> &'static str {
    if value { "ON" } else { "OFF" }
}

pub fn sync_world_music(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    game_state: Res<NativeGameState>,
    settings: Res<NativeSettingsState>,
    current: Query<(Entity, &NativeMusic)>,
) {
    let mood = resolve_music_mood(&game_state);
    let current_music = current.iter().next();

    if current_music
        .as_ref()
        .is_some_and(|(_, music)| music.mood == mood)
    {
        return;
    }

    for (entity, _) in &current {
        commands.entity(entity).despawn();
    }

    let track = match mood {
        MusicMood::Town => TOWN_TRACK,
        MusicMood::Wilderness => WILDERNESS_TRACK,
        MusicMood::Swamp => SWAMP_TRACK,
        MusicMood::Battle => BATTLE_TRACK,
    };

    let initial_volume = Volume::Linear(settings.settings.effective_music_volume());

    let playback = if mood == MusicMood::Swamp {
        PlaybackSettings::LOOP.with_volume(initial_volume)
    } else {
        PlaybackSettings::ONCE.with_volume(initial_volume)
    };

    commands.spawn((
        Name::new(format!("Native world music · {mood:?}")),
        NativeMusic { mood },
        AudioPlayer::<AudioSource>(asset_server.load::<AudioSource>(track)),
        playback,
    ));
}

pub fn apply_audio_settings(
    state: Res<NativeSettingsState>,
    mut sinks: Query<&mut AudioSink, With<NativeMusic>>,
) {
    let volume = Volume::Linear(state.settings.effective_music_volume());

    for mut sink in &mut sinks {
        sink.set_volume(volume);

        if state.settings.muted {
            sink.mute();
        } else {
            sink.unmute();
        }
    }
}

fn resolve_music_mood(game_state: &NativeGameState) -> MusicMood {
    if game_state.attack_target_id.is_some() {
        return MusicMood::Battle;
    }

    let Some(player) = game_state.local_player() else {
        return MusicMood::Wilderness;
    };

    let position = player.position;

    let swamp = game_state.creatures.values().any(|creature| {
        creature.position.z == position.z
            && matches!(
                creature.definition_id.as_str(),
                "mireling" | "mire_skulker" | "reed_stalker" | "fen_brute"
            )
            && (creature.position.x - position.x).abs() <= 18
            && (creature.position.y - position.y).abs() <= 18
    });

    if swamp {
        return MusicMood::Swamp;
    }

    let town = game_state.npcs.values().any(|npc| {
        npc.position.z == position.z
            && (npc.position.x - position.x).abs() <= 14
            && (npc.position.y - position.y).abs() <= 14
    });

    if town {
        MusicMood::Town
    } else {
        MusicMood::Wilderness
    }
}
