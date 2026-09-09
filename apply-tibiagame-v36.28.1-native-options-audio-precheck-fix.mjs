#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.28.1";

const MAIN = "crates/game-client/src/main.rs";
const SETTINGS = "crates/game-client/src/native_settings.rs";
const TRADE_UI = "crates/game-client/src/native_trade_ui.rs";
const CARGO = "crates/game-client/Cargo.toml";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [MAIN, TRADE_UI, CARGO, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.27.1. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} native options + world music migration...`);
console.log("  regression fix: accept the actual single-line V36.27.1 MovementUiLocks body");

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const target = path.join(ROOT, rel);
  if (!fs.existsSync(target)) {
    pending.set(rel, "");
    eols.set(rel, "\n");
    return "";
  }
  const raw = fs.readFileSync(target, "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) {
    throw new Error(`${label}: expected source anchor not found. No files were written.`);
  }
  return text.replace(before, after);
}

// Cargo: old music uses MP3 and OGG.
let cargo = read(CARGO);
if (!cargo.includes('features = ["webp", "mp3"]')) {
  cargo = replaceOnce(
    cargo,
    'bevy = { version = "0.19.1", features = ["webp"] }',
    'bevy = { version = "0.19.1", features = ["webp", "mp3"] }',
    "Bevy MP3 feature",
  );
}
save(CARGO, cargo);

const settingsSource = `// TIBIAGAME_V36_28_1_NATIVE_OPTIONS_AUDIO
use std::{fs, path::PathBuf};

use bevy::{
    audio::{
        AudioPlayer,
        AudioSink,
        AudioSinkPlayback,
        PlaybackSettings,
        Volume,
    },
    prelude::*,
};
use serde::{Deserialize, Serialize};

use crate::{
    native_map_ui::NativeMapUiState,
    native_ui::NativePanelState,
    state::NativeGameState,
};

const DEFAULT_MASTER: u8 = 100;
const DEFAULT_MUSIC: u8 = 18;
const DEFAULT_EFFECTS: u8 = 80;

const TOWN_TRACK: &str =
    "audio/music/medieval-harvest-season.mp3";
const WILDERNESS_TRACK: &str =
    "audio/music/medieval-exploration.mp3";
const SWAMP_TRACK: &str =
    "audio/music/swamp-theme-loop.ogg";
const BATTLE_TRACK: &str =
    "audio/music/battle-theme.mp3";

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
            warn!(
                "ALDORIA SETTINGS · could not parse {}",
                path.display(),
            );
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

        (self.master_volume as f32 / 100.0)
            * (self.music_volume as f32 / 100.0)
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
    Options,
    Performance,
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
struct NativeMusic {
    mood: MusicMood,
}

pub fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native options"),
            NativeOptionsPanel,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(13.0),
                left: Val::Percent(50.0),
                width: px(560),
                min_height: px(470),
                margin: UiRect::left(px(-280)),
                padding: UiRect::all(px(16)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgba(0.018, 0.026, 0.023, 0.98)),
        ))
        .with_child(settings_text(
            "",
            NativeSettingsText::Options,
            14.0,
            Color::srgb(0.84, 0.86, 0.80),
        ));

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
        state.selected =
            if state.selected == 0 { 5 } else { state.selected - 1 };
    }

    let decrease = keys.just_pressed(KeyCode::ArrowLeft);
    let increase = keys.just_pressed(KeyCode::ArrowRight);

    let mut changed = false;

    match state.selected {
        0 if decrease || increase => {
            changed = adjust_volume(
                &mut state.settings.master_volume,
                increase,
            );
        }
        1 if decrease || increase => {
            changed = adjust_volume(
                &mut state.settings.music_volume,
                increase,
            );
        }
        2 if decrease || increase => {
            changed = adjust_volume(
                &mut state.settings.effects_volume,
                increase,
            );
        }
        3 if keys.just_pressed(KeyCode::Space) => {
            state.settings.muted = !state.settings.muted;
            changed = true;
        }
        4 if keys.just_pressed(KeyCode::Space) => {
            state.settings.reduced_motion =
                !state.settings.reduced_motion;
            changed = true;
        }
        5 if keys.just_pressed(KeyCode::Space) => {
            state.settings.show_performance =
                !state.settings.show_performance;
            changed = true;
        }
        _ => {}
    }

    if changed {
        state.settings.save();
    }
}

fn close_other_panels(
    panels: &mut NativePanelState,
    map_ui: &mut NativeMapUiState,
) {
    panels.inventory_open = false;
    panels.character_open = false;
    panels.skills_open = false;
    panels.spells_open = false;
    panels.crafting_open = false;
    panels.npc_open = false;
    map_ui.world_map_open = false;
}

fn adjust_volume(
    value: &mut u8,
    increase: bool,
) -> bool {
    let before = *value;

    if increase {
        *value = value.saturating_add(5).min(100);
    } else {
        *value = value.saturating_sub(5);
    }

    *value != before
}

pub fn update_performance_probe(
    time: Res<Time>,
    mut state: ResMut<NativeSettingsState>,
) {
    let frame_seconds = time.delta().as_secs_f64();
    let frame_ms = frame_seconds * 1000.0;

    state.sample_frames += 1;
    state.sample_total_ms += frame_ms;
    state.sample_max_ms =
        state.sample_max_ms.max(frame_ms);
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
    mut texts: Query<(&NativeSettingsText, &mut Text)>,
    mut options_panel: Query<
        &mut Visibility,
        (
            With<NativeOptionsPanel>,
            Without<NativePerformancePanel>,
        ),
    >,
    mut performance_panel: Query<
        &mut Visibility,
        (
            With<NativePerformancePanel>,
            Without<NativeOptionsPanel>,
        ),
    >,
) {
    if let Ok(mut visibility) = options_panel.single_mut() {
        *visibility = if state.options_open {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if let Ok(mut visibility) = performance_panel.single_mut() {
        *visibility = if state.settings.show_performance {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    let options = render_options(&state);
    let performance = format!(
        "FPS {:>5.1}   ·   avg {:>5.2} ms   ·   max {:>5.2} ms",
        state.fps,
        state.average_ms,
        state.max_ms,
    );

    for (kind, mut text) in &mut texts {
        text.0 = match kind {
            NativeSettingsText::Options => options.clone(),
            NativeSettingsText::Performance => performance.clone(),
        };
    }
}

fn render_options(
    state: &NativeSettingsState,
) -> String {
    let row = |index: usize, label: &str, value: String| {
        let marker =
            if state.selected == index { "▶" } else { " " };
        format!("{marker} {label:<22} {value}")
    };

    [
        "OPTIONS".to_owned(),
        String::new(),
        row(
            0,
            "Master volume",
            format!("{}%", state.settings.master_volume),
        ),
        row(
            1,
            "Music volume",
            format!("{}%", state.settings.music_volume),
        ),
        row(
            2,
            "Effects volume",
            format!("{}%", state.settings.effects_volume),
        ),
        row(
            3,
            "Mute all audio",
            toggle_label(state.settings.muted).into(),
        ),
        row(
            4,
            "Reduced motion",
            toggle_label(state.settings.reduced_motion).into(),
        ),
        row(
            5,
            "Performance HUD",
            toggle_label(state.settings.show_performance).into(),
        ),
        String::new(),
        "↑/↓ Select   ·   ←/→ Volume   ·   Space Toggle".into(),
        "F10 / Esc Close".into(),
        String::new(),
        "Settings persist per Windows user.".into(),
    ]
    .join("\\n")
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

    let initial_volume =
        Volume::Linear(settings.settings.effective_music_volume());

    let playback = if mood == MusicMood::Swamp {
        PlaybackSettings::LOOP.with_volume(initial_volume)
    } else {
        PlaybackSettings::ONCE.with_volume(initial_volume)
    };

    commands.spawn((
        Name::new(format!("Native world music · {mood:?}")),
        NativeMusic { mood },
        AudioPlayer(asset_server.load(track)),
        playback,
    ));
}

pub fn apply_audio_settings(
    state: Res<NativeSettingsState>,
    mut sinks: Query<&mut AudioSink, With<NativeMusic>>,
) {
    let volume =
        Volume::Linear(state.settings.effective_music_volume());

    for mut sink in &mut sinks {
        sink.set_volume(volume);

        if state.settings.muted {
            sink.mute();
        } else {
            sink.unmute();
        }
    }
}

fn resolve_music_mood(
    game_state: &NativeGameState,
) -> MusicMood {
    if game_state.attack_target_id.is_some() {
        return MusicMood::Battle;
    }

    let Some(player) = game_state.local_player() else {
        return MusicMood::Wilderness;
    };

    let position = player.position;

    let swamp = game_state
        .creatures
        .values()
        .any(|creature| {
            creature.position.z == position.z
                && matches!(
                    creature.definition_id.as_str(),
                    "mireling"
                        | "mire_skulker"
                        | "reed_stalker"
                        | "fen_brute"
                )
                && (creature.position.x - position.x).abs() <= 18
                && (creature.position.y - position.y).abs() <= 18
        });

    if swamp {
        return MusicMood::Swamp;
    }

    let town = game_state
        .npcs
        .values()
        .any(|npc| {
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
`;

save(SETTINGS, settingsSource);

// Extend existing MovementUiLocks, avoiding another movement system parameter.
let trade = read(TRADE_UI);

if (!trade.includes("native_settings::NativeSettingsState")) {
  trade = replaceOnce(
    trade,
    `use crate::{
    native_map_ui::NativeMapUiState,`,
    `use crate::{
    native_map_ui::NativeMapUiState,
    native_settings::NativeSettingsState,`,
    "NativeSettingsState import",
  );
}

if (!trade.includes("settings_ui: Res<'w, NativeSettingsState>")) {
  trade = replaceOnce(
    trade,
    `    trade_ui: Res<'w, NativeTradeUiState>,
}`,
    `    trade_ui: Res<'w, NativeTradeUiState>,
    settings_ui: Res<'w, NativeSettingsState>,
}`,
    "MovementUiLocks settings field",
  );
}

if (!trade.includes("|| self.settings_ui.options_open")) {
  const lockCandidates = [
    `        self.map_ui.world_map_open || self.trade_ui.block_movement`,
    `        self.map_ui.world_map_open
            || self.trade_ui.block_movement`,
  ];

  let changed = false;

  for (const before of lockCandidates) {
    if (!trade.includes(before)) continue;

    const after = `        self.map_ui.world_map_open
            || self.trade_ui.block_movement
            || self.settings_ui.options_open`;

    trade = trade.replace(before, after);
    changed = true;
    break;
  }

  if (!changed) {
    throw new Error(
      "MovementUiLocks options lock: expected V36.27.1 blocks_movement body not found. No files were written.",
    );
  }
}
save(TRADE_UI, trade);

// main.rs
let main = read(MAIN);

if (!main.includes("mod native_settings;")) {
  main = replaceOnce(
    main,
    "mod native_trade_ui;\n",
    "mod native_trade_ui;\nmod native_settings;\n",
    "native_settings module",
  );
}

if (!main.includes(".init_resource::<native_settings::NativeSettingsState>()")) {
  main = replaceOnce(
    main,
    `.init_resource::<native_trade_ui::NativeTradeUiState>()`,
    `.init_resource::<native_trade_ui::NativeTradeUiState>()
        .init_resource::<native_settings::NativeSettingsState>()`,
    "NativeSettingsState init",
  );
}

if (!main.includes("native_settings::setup")) {
  const startupAnchor =
    "native_map_ui::setup, native_trade_ui::setup))";

  if (!main.includes(startupAnchor)) {
    throw new Error(
      "V36.27 startup setup anchor missing. No files were written.",
    );
  }

  main = main.replace(
    startupAnchor,
    "native_map_ui::setup, native_trade_ui::setup, native_settings::setup))",
  );
}

if (!main.includes("native_settings::handle_input")) {
  const inputAnchor =
    `native_trade_ui::handle_input
                    .after(native_map_ui::handle_input)
                    .before(schedule_tile_movement),`;

  if (!main.includes(inputAnchor)) {
    throw new Error(
      "V36.27 trade input schedule anchor missing. No files were written.",
    );
  }

  main = main.replace(
    inputAnchor,
    `${inputAnchor}
                native_settings::handle_input
                    .after(native_trade_ui::handle_input)
                    .before(schedule_tile_movement),`,
  );
}

if (!main.includes("native_settings::update_performance_probe")) {
  const updateAnchor =
    "native_trade_ui::update_ui.after(pump_network),";

  if (!main.includes(updateAnchor)) {
    throw new Error(
      "V36.27 trade update anchor missing. No files were written.",
    );
  }

  main = main.replace(
    updateAnchor,
    `${updateAnchor}
                native_settings::update_performance_probe,
                native_settings::update_ui,
                native_settings::sync_world_music.after(pump_network),
                native_settings::apply_audio_settings
                    .after(native_settings::sync_world_music),`,
  );
}
save(MAIN, main);

// version/docs
let versionFile = read(VERSION_FILE);

if (!versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.1";')) {
  const candidates = ["36.27.1", "36.27"];
  let updated = false;

  for (const candidate of candidates) {
    const before =
      `pub const MIGRATION_VERSION: &str = "${candidate}";`;

    if (!versionFile.includes(before)) continue;

    versionFile = versionFile.replace(
      before,
      'pub const MIGRATION_VERSION: &str = "36.28.1";',
    );
    updated = true;
    break;
  }

  if (!updated) {
    throw new Error(
      `${VERSION_FILE} is not on V36.27.x. No files were written.`,
    );
  }
}
save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker =
    "<!-- TIBIAGAME_V36_28_1_NATIVE_OPTIONS_AUDIO -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.28.1 migrates native options, persistent audio settings, a lightweight
performance HUD and world-music moods. F10 opens Options.

Defaults match the React client: master 100, music 18, effects 80, unmuted.
World music priority is battle, swamp, town, wilderness and uses the same legacy
audio assets. Bevy MP3 support is enabled because the old soundtrack mixes MP3
and OGG.

MovementUiLocks is extended with options_open rather than adding another
schedule_tile_movement parameter.
`;
    save(DOC, doc);
  }
}

const finalMain = read(MAIN);
const finalSettings = read(SETTINGS);
const finalTrade = read(TRADE_UI);
const finalCargo = read(CARGO);
const finalVersion = read(VERSION_FILE);

const checks = [
  [finalCargo.includes('features = ["webp", "mp3"]'), "Bevy MP3 support missing"],
  [finalMain.includes("mod native_settings;"), "native_settings module missing"],
  [finalMain.includes(".init_resource::<native_settings::NativeSettingsState>()"), "settings resource missing"],
  [finalMain.includes("native_settings::setup"), "settings setup missing"],
  [finalMain.includes("native_settings::handle_input"), "settings input missing"],
  [finalMain.includes("native_settings::sync_world_music"), "world music system missing"],
  [finalMain.includes("native_settings::apply_audio_settings"), "audio apply system missing"],
  [finalSettings.includes("master_volume: DEFAULT_MASTER"), "master default missing"],
  [finalSettings.includes("music_volume: DEFAULT_MUSIC"), "music default missing"],
  [finalSettings.includes("effects_volume: DEFAULT_EFFECTS"), "effects default missing"],
  [finalSettings.includes("KeyCode::F10"), "F10 options toggle missing"],
  [finalSettings.includes("AudioPlayer(asset_server.load(track))"), "AudioPlayer integration missing"],
  [finalSettings.includes("MusicMood::Battle"), "battle mood missing"],
  [finalSettings.includes("MusicMood::Swamp"), "swamp mood missing"],
  [finalSettings.includes("MusicMood::Town"), "town mood missing"],
  [finalSettings.includes("MusicMood::Wilderness"), "wilderness mood missing"],
  [finalTrade.includes("settings_ui: Res<'w, NativeSettingsState>"), "settings movement lock field missing"],
  [finalTrade.includes("|| self.settings_ui.options_open"), "settings movement lock missing"],
  [finalVersion.includes('pub const MIGRATION_VERSION: &str = "36.28.1";'), "version is not V36.28.1"],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(`Post-check failed: ${message}. No files were written.`);
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- F10 native options");
  console.log("- persistent master/music/effects/mute settings");
  console.log("- reduced-motion + performance HUD toggles");
  console.log("- MP3 + OGG world music");
  console.log("- battle/swamp/town/wilderness mood switching");
  console.log("- movement blocked while Options is open");
  console.log("- V36.20 floor/creature renderer untouched");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);
  const original = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : "";
  const eol = eols.get(rel) ?? "\n";
  const clean = normalized
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "\n");
  const output =
    eol === "\r\n"
      ? clean.replace(/\n/g, "\r\n")
      : clean;

  if (output !== original) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- Native options + persistent audio + world music added.");
