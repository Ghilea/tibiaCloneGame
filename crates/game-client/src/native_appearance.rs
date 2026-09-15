// TIBIAGAME_V36_94_CHARACTER_CUSTOMIZATION_UI
// TIBIAGAME_V36_94_1_CHARACTER_CUSTOMIZATION_RECOVERY
// TIBIAGAME_V36_95_AUTHORITATIVE_APPEARANCE
use std::{fs, path::PathBuf};

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use game_protocol::ClientMessage;

use crate::{
    LocalIdentity, NativeNetwork,
    actor_sprites::SpriteDirection,
    native_map_ui::NativeMapUiState,
    native_settings::NativeSettingsState,
    native_ui::{NativeChatState, NativePanelState},
    native_ui_theme as theme,
    player_sprites::{self, LocalCharacterAppearance, LocalPlayerSprite},
    state::NativeGameState,
};

const BODY: [&str; 2] = ["body_01", "body_02"];
const HEAD: [&str; 3] = ["head_01", "head_02", "head_03"];
const FACE: [&str; 3] = ["face_01", "face_02", "face_03"];
const HAIR: [&str; 4] = ["hair_01", "hair_02", "hair_03", "hair_04"];
const FACIAL_HAIR: [&str; 3] = ["none", "beard_01", "beard_02"];
const TORSO: [&str; 3] = ["torso_01", "torso_02", "torso_03"];
const LEGS: [&str; 3] = ["legs_01", "legs_02", "legs_03"];
const FEET: [&str; 2] = ["feet_01", "feet_02"];

const SKIN: [&str; 4] = ["skin_light", "skin_warm", "skin_tan", "skin_deep"];
const HAIR_COLOR: [&str; 5] = [
    "hair_black",
    "hair_brown",
    "hair_auburn",
    "hair_blonde",
    "hair_gray",
];
const CLOTH: [&str; 7] = [
    "cloth_burgundy",
    "cloth_forest",
    "cloth_violet",
    "cloth_charcoal",
    "cloth_navy",
    "cloth_earth",
    "cloth_cream",
];
const LEATHER: [&str; 3] = ["leather_brown", "leather_dark", "leather_tan"];

const PREVIEW_DIRECTIONS: [SpriteDirection; 8] = [
    SpriteDirection::South,
    SpriteDirection::SouthWest,
    SpriteDirection::West,
    SpriteDirection::NorthWest,
    SpriteDirection::North,
    SpriteDirection::NorthEast,
    SpriteDirection::East,
    SpriteDirection::SouthEast,
];

#[derive(Resource, Default)]
pub(crate) struct NativeAppearanceUiState {
    pub(crate) open: bool,
    loaded_character: Option<String>,
    preview_direction: usize,
    snapshot: Option<SavedAppearance>,
    dirty: bool,
    status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AppearanceField {
    Body,
    Head,
    Face,
    Hair,
    FacialHair,
    Torso,
    Legs,
    Feet,
    SkinTone,
    HairColor,
    TorsoColor,
    LegsColor,
    FeetColor,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum AppearanceAction {
    Previous(AppearanceField),
    Next(AppearanceField),
    RotateLeft,
    RotateRight,
    Reset,
    Save,
    Cancel,
}

#[derive(Component, Clone, Copy)]
pub(crate) struct AppearanceValue(AppearanceField);

#[derive(Component)]
pub(crate) struct AppearanceDirectionText;

#[derive(Component)]
pub(crate) struct AppearanceStatusText;

#[derive(Component)]
pub(crate) struct NativeAppearancePanel;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SavedAppearance {
    body: String,
    head: String,
    face: String,
    hair: String,
    facial_hair: Option<String>,
    torso: String,
    legs: String,
    feet: String,
    skin_tone: String,
    hair_color: String,
    torso_color: String,
    legs_color: String,
    feet_color: String,
    customized: bool,
}

impl Default for SavedAppearance {
    fn default() -> Self {
        Self {
            body: "body_01".to_owned(),
            head: "head_01".to_owned(),
            face: "face_01".to_owned(),
            hair: "hair_01".to_owned(),
            facial_hair: None,
            torso: "torso_01".to_owned(),
            legs: "legs_01".to_owned(),
            feet: "feet_01".to_owned(),
            skin_tone: "skin_warm".to_owned(),
            hair_color: "hair_brown".to_owned(),
            torso_color: "cloth_burgundy".to_owned(),
            legs_color: "cloth_charcoal".to_owned(),
            feet_color: "leather_brown".to_owned(),
            customized: true,
        }
    }
}

impl SavedAppearance {
    fn capture(appearance: &LocalCharacterAppearance) -> Self {
        Self {
            body: appearance.body.clone(),
            head: appearance.head.clone(),
            face: appearance.face.clone(),
            hair: appearance.hair.clone(),
            facial_hair: appearance.facial_hair.clone(),
            torso: appearance.torso.clone(),
            legs: appearance.legs.clone(),
            feet: appearance.feet.clone(),
            skin_tone: appearance.skin_tone.clone(),
            hair_color: appearance.hair_color.clone(),
            torso_color: appearance.torso_color.clone(),
            legs_color: appearance.legs_color.clone(),
            feet_color: appearance.feet_color.clone(),
            customized: appearance.customized,
        }
    }

    fn sanitize(mut self) -> Self {
        self.body = valid_or(&self.body, &BODY, "body_01");
        self.head = valid_or(&self.head, &HEAD, "head_01");
        self.face = valid_or(&self.face, &FACE, "face_01");
        self.hair = valid_or(&self.hair, &HAIR, "hair_01");
        self.torso = valid_or(&self.torso, &TORSO, "torso_01");
        self.legs = valid_or(&self.legs, &LEGS, "legs_01");
        self.feet = valid_or(&self.feet, &FEET, "feet_01");
        self.skin_tone = valid_or(&self.skin_tone, &SKIN, "skin_warm");
        self.hair_color = valid_or(&self.hair_color, &HAIR_COLOR, "hair_brown");
        self.torso_color = valid_or(&self.torso_color, &CLOTH, "cloth_burgundy");
        self.legs_color = valid_or(&self.legs_color, &CLOTH, "cloth_charcoal");
        self.feet_color = valid_or(&self.feet_color, &LEATHER, "leather_brown");
        self.facial_hair = self.facial_hair.and_then(|value| {
            if FACIAL_HAIR[1..].contains(&value.as_str()) {
                Some(value)
            } else {
                None
            }
        });
        self.customized = true;
        self
    }

    fn apply_to(&self, appearance: &mut LocalCharacterAppearance) {
        appearance.body = self.body.clone();
        appearance.head = self.head.clone();
        appearance.face = self.face.clone();
        appearance.hair = self.hair.clone();
        appearance.facial_hair = self.facial_hair.clone();
        appearance.torso = self.torso.clone();
        appearance.legs = self.legs.clone();
        appearance.feet = self.feet.clone();
        appearance.skin_tone = self.skin_tone.clone();
        appearance.hair_color = self.hair_color.clone();
        appearance.torso_color = self.torso_color.clone();
        appearance.legs_color = self.legs_color.clone();
        appearance.feet_color = self.feet_color.clone();
        appearance.customized = self.customized;
    }
}

fn valid_or(value: &str, choices: &[&str], fallback: &str) -> String {
    if choices.contains(&value) {
        value.to_owned()
    } else {
        fallback.to_owned()
    }
}

pub(crate) fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native character appearance"),
            NativeAppearancePanel,
            GlobalZIndex(175),
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: px(18),
                right: px(18),
                width: px(438),
                max_height: Val::Percent(94.0),
                padding: UiRect::all(px(12)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(9)),
                flex_direction: FlexDirection::Column,
                row_gap: px(7),
                ..default()
            },
            BackgroundColor(theme::PANEL_BG_DEEP),
            BorderColor::all(theme::GOLD_DARK),
        ))
        .with_children(|panel| {
            panel
                .spawn(Node {
                    width: Val::Percent(100.0),
                    flex_direction: FlexDirection::Row,
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::SpaceBetween,
                    column_gap: px(10),
                    ..default()
                })
                .with_children(|header| {
                    header
                        .spawn(Node {
                            flex_direction: FlexDirection::Column,
                            row_gap: px(2),
                            ..default()
                        })
                        .with_children(|copy| {
                            copy.spawn((
                                Text::new("CHARACTER APPEARANCE"),
                                TextFont {
                                    font_size: FontSize::Px(19.0),
                                    ..default()
                                },
                                TextColor(theme::GOLD_BRIGHT),
                            ));
                            copy.spawn((
                                Text::new("Live preview uses your in-world character"),
                                TextFont {
                                    font_size: FontSize::Px(9.5),
                                    ..default()
                                },
                                TextColor(theme::MUTED),
                            ));
                        });
                    spawn_button(header, AppearanceAction::Cancel, "X", 36.0);
                });

            panel.spawn((
                Text::new("Parts"),
                TextFont {
                    font_size: FontSize::Px(11.0),
                    ..default()
                },
                TextColor(theme::GOLD),
            ));

            for (field, label) in [
                (AppearanceField::Body, "BODY"),
                (AppearanceField::Head, "HEAD"),
                (AppearanceField::Face, "FACE"),
                (AppearanceField::Hair, "HAIR"),
                (AppearanceField::FacialHair, "FACIAL HAIR"),
                (AppearanceField::Torso, "BASE TORSO"),
                (AppearanceField::Legs, "BASE LEGS"),
                (AppearanceField::Feet, "BASE FEET"),
            ] {
                spawn_selector_row(panel, field, label);
            }

            panel.spawn((
                Text::new("Colours"),
                TextFont {
                    font_size: FontSize::Px(11.0),
                    ..default()
                },
                TextColor(theme::GOLD),
                Node {
                    margin: UiRect::top(px(3)),
                    ..default()
                },
            ));

            for (field, label) in [
                (AppearanceField::SkinTone, "SKIN"),
                (AppearanceField::HairColor, "HAIR COLOUR"),
                (AppearanceField::TorsoColor, "TORSO COLOUR"),
                (AppearanceField::LegsColor, "LEGS COLOUR"),
                (AppearanceField::FeetColor, "FEET COLOUR"),
            ] {
                spawn_selector_row(panel, field, label);
            }

            panel
                .spawn(Node {
                    width: Val::Percent(100.0),
                    margin: UiRect::top(px(4)),
                    flex_direction: FlexDirection::Row,
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::SpaceBetween,
                    column_gap: px(8),
                    ..default()
                })
                .with_children(|row| {
                    row.spawn((
                        Text::new("PREVIEW DIRECTION"),
                        TextFont {
                            font_size: FontSize::Px(9.5),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));

                    row.spawn(Node {
                        flex_direction: FlexDirection::Row,
                        align_items: AlignItems::Center,
                        column_gap: px(6),
                        ..default()
                    })
                    .with_children(|controls| {
                        spawn_button(controls, AppearanceAction::RotateLeft, "<", 34.0);
                        controls.spawn((
                            AppearanceDirectionText,
                            Text::new("SOUTH"),
                            TextFont {
                                font_size: FontSize::Px(10.0),
                                ..default()
                            },
                            TextColor(theme::GOLD_BRIGHT),
                            Node {
                                width: px(72),
                                justify_content: JustifyContent::Center,
                                ..default()
                            },
                        ));
                        spawn_button(controls, AppearanceAction::RotateRight, ">", 34.0);
                    });
                });

            panel.spawn((
                AppearanceStatusText,
                Text::new("F9 opens/closes · Esc cancels · Q/E rotates preview"),
                TextFont {
                    font_size: FontSize::Px(9.0),
                    ..default()
                },
                TextColor(theme::MUTED),
                Node {
                    margin: UiRect::top(px(3)),
                    ..default()
                },
            ));

            panel
                .spawn(Node {
                    width: Val::Percent(100.0),
                    margin: UiRect::top(px(4)),
                    flex_direction: FlexDirection::Row,
                    justify_content: JustifyContent::FlexEnd,
                    column_gap: px(8),
                    ..default()
                })
                .with_children(|footer| {
                    spawn_button(footer, AppearanceAction::Reset, "RESET", 82.0);
                    spawn_button(footer, AppearanceAction::Cancel, "CANCEL", 88.0);
                    spawn_button(footer, AppearanceAction::Save, "SAVE", 92.0);
                });
        });
}

fn spawn_selector_row(
    parent: &mut ChildSpawnerCommands,
    field: AppearanceField,
    label: &'static str,
) {
    parent
        .spawn((
            Node {
                width: Val::Percent(100.0),
                min_height: px(32),
                padding: UiRect {
                    left: px(7),
                    right: px(5),
                    top: px(3),
                    bottom: px(3),
                },
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(5)),
                flex_direction: FlexDirection::Row,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::SpaceBetween,
                column_gap: px(8),
                ..default()
            },
            BackgroundColor(theme::PANEL_BG_SOFT),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont {
                    font_size: FontSize::Px(9.5),
                    ..default()
                },
                TextColor(theme::MUTED),
                Node {
                    width: px(105),
                    ..default()
                },
            ));

            row.spawn(Node {
                flex_direction: FlexDirection::Row,
                align_items: AlignItems::Center,
                column_gap: px(5),
                ..default()
            })
            .with_children(|controls| {
                spawn_button(controls, AppearanceAction::Previous(field), "<", 32.0);
                controls.spawn((
                    AppearanceValue(field),
                    Text::new("—"),
                    TextFont {
                        font_size: FontSize::Px(10.0),
                        ..default()
                    },
                    TextColor(theme::TEXT),
                    Node {
                        width: px(174),
                        justify_content: JustifyContent::Center,
                        ..default()
                    },
                ));
                spawn_button(controls, AppearanceAction::Next(field), ">", 32.0);
            });
        });
}

fn spawn_button(
    parent: &mut ChildSpawnerCommands,
    action: AppearanceAction,
    label: &'static str,
    width: f32,
) {
    parent
        .spawn((
            Button,
            action,
            Node {
                width: px(width),
                height: px(29),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(5)),
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
                font_size: FontSize::Px(9.5),
                ..default()
            },
            TextColor(theme::TEXT),
        ));
}

pub(crate) fn hydrate_saved_appearance(
    identity: Res<LocalIdentity>,
    game_state: Res<NativeGameState>,
    network: Res<NativeNetwork>,
    appearance: Option<ResMut<LocalCharacterAppearance>>,
    mut ui: ResMut<NativeAppearanceUiState>,
) {
    let Some(mut appearance) = appearance else {
        return;
    };

    let character_key = identity.id.to_string();
    if ui.loaded_character.as_deref() == Some(character_key.as_str()) {
        return;
    }
    ui.loaded_character = Some(character_key);

    let Some(player) = game_state.local_player() else {
        return;
    };
    let path = appearance_path(&identity);
    let Ok(raw) = fs::read_to_string(&path) else {
        return;
    };

    let server_legacy = game_types::CharacterAppearance::from_legacy_outfit(&player.outfit);
    if player.appearance != server_legacy {
        let _ = fs::remove_file(&path);
        info!(
            "ALDORIA APPEARANCE · discarded stale V36.94 local file; server appearance is authoritative"
        );
        return;
    }

    let Ok(saved) = serde_json::from_str::<SavedAppearance>(&raw) else {
        warn!("ALDORIA APPEARANCE · invalid legacy saved appearance {}", path.display());
        return;
    };

    saved.sanitize().apply_to(&mut appearance);
    appearance.customized = true;
    let authoritative = player_sprites::authoritative_appearance_from_local(&appearance);

    if network
        .outbound
        .send(ClientMessage::SetAppearance {
            appearance: authoritative,
        })
        .is_err()
    {
        ui.status = "Could not migrate the old local appearance to the server.".to_owned();
        return;
    }

    let _ = fs::remove_file(&path);
    ui.status = "Migrated your previous local appearance to the server.".to_owned();
    info!(
        "ALDORIA APPEARANCE · migrated V36.94 local customization for {}",
        identity.name,
    );
}

pub(crate) fn handle_input(
    keys: Res<ButtonInput<KeyCode>>,
    chat: Res<NativeChatState>,
    game_state: Res<NativeGameState>,
    identity: Res<LocalIdentity>,
    network: Res<NativeNetwork>,
    appearance: Option<ResMut<LocalCharacterAppearance>>,
    mut ui: ResMut<NativeAppearanceUiState>,
    mut panels: ResMut<NativePanelState>,
    mut map_ui: ResMut<NativeMapUiState>,
    mut settings: ResMut<NativeSettingsState>,
) {
    let Some(mut appearance) = appearance else {
        return;
    };

    if game_state.trade.is_some() {
        if ui.open {
            cancel_changes(&mut appearance, &mut ui);
        }
        return;
    }

    if settings.options_open && ui.open {
        cancel_changes(&mut appearance, &mut ui);
        return;
    }

    if chat.active {
        return;
    }

    if keys.just_pressed(KeyCode::F9) {
        if ui.open {
            cancel_changes(&mut appearance, &mut ui);
        } else {
            open_editor(
                &appearance,
                &mut ui,
                &mut panels,
                &mut map_ui,
                &mut settings,
            );
        }
        return;
    }

    if !ui.open {
        return;
    }

    if keys.just_pressed(KeyCode::Escape) {
        cancel_changes(&mut appearance, &mut ui);
        return;
    }

    if keys.just_pressed(KeyCode::KeyQ) {
        rotate_preview(&mut ui, -1);
    }
    if keys.just_pressed(KeyCode::KeyE) {
        rotate_preview(&mut ui, 1);
    }

    if keys.just_pressed(KeyCode::Enter)
        && (keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight))
    {
        if save_current(&identity, &network, &mut appearance, &mut ui) {
            ui.open = false;
        }
    }
}

pub(crate) fn handle_buttons(
    mut interactions: Query<
        (&Interaction, &AppearanceAction, &mut BackgroundColor),
        (Changed<Interaction>, With<Button>),
    >,
    identity: Res<LocalIdentity>,
    network: Res<NativeNetwork>,
    appearance: Option<ResMut<LocalCharacterAppearance>>,
    mut ui: ResMut<NativeAppearanceUiState>,
) {
    let Some(mut appearance) = appearance else {
        return;
    };

    for (interaction, action, mut background) in &mut interactions {
        match *interaction {
            Interaction::None => background.0 = theme::BUTTON_BG,
            Interaction::Hovered => background.0 = theme::BUTTON_HOVER,
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                if !ui.open {
                    continue;
                }

                match *action {
                    AppearanceAction::Previous(field) => {
                        cycle_field(&mut appearance, field, -1);
                        mark_dirty(&mut appearance, &mut ui);
                    }
                    AppearanceAction::Next(field) => {
                        cycle_field(&mut appearance, field, 1);
                        mark_dirty(&mut appearance, &mut ui);
                    }
                    AppearanceAction::RotateLeft => rotate_preview(&mut ui, -1),
                    AppearanceAction::RotateRight => rotate_preview(&mut ui, 1),
                    AppearanceAction::Reset => {
                        *appearance = LocalCharacterAppearance::customization_default(&identity.outfit);
                        appearance.customized = true;
                        ui.dirty = true;
                        ui.status = "Preview reset to a neutral customizable base.".to_owned();
                    }
                    AppearanceAction::Save => {
                        if save_current(&identity, &network, &mut appearance, &mut ui) {
                            ui.open = false;
                        }
                    }
                    AppearanceAction::Cancel => cancel_changes(&mut appearance, &mut ui),
                }
            }
        }
    }
}

fn open_editor(
    appearance: &LocalCharacterAppearance,
    ui: &mut NativeAppearanceUiState,
    panels: &mut NativePanelState,
    map_ui: &mut NativeMapUiState,
    settings: &mut NativeSettingsState,
) {
    ui.snapshot = Some(SavedAppearance::capture(appearance));
    ui.preview_direction = 0;
    ui.dirty = false;
    ui.status = "Live preview active. SAVE commits this appearance locally.".to_owned();
    ui.open = true;

    panels.inventory_open = false;
    panels.character_open = false;
    panels.skills_open = false;
    panels.spells_open = false;
    panels.crafting_open = false;
    panels.npc_open = false;
    map_ui.world_map_open = false;
    settings.options_open = false;
}

fn cancel_changes(
    appearance: &mut LocalCharacterAppearance,
    ui: &mut NativeAppearanceUiState,
) {
    if let Some(snapshot) = ui.snapshot.take() {
        snapshot.apply_to(appearance);
    }
    ui.open = false;
    ui.dirty = false;
    ui.status = "Changes cancelled.".to_owned();
}

fn mark_dirty(
    appearance: &mut LocalCharacterAppearance,
    ui: &mut NativeAppearanceUiState,
) {
    appearance.customized = true;
    ui.dirty = true;
    ui.status = "Unsaved appearance changes.".to_owned();
}

fn save_current(
    identity: &LocalIdentity,
    network: &NativeNetwork,
    appearance: &mut LocalCharacterAppearance,
    ui: &mut NativeAppearanceUiState,
) -> bool {
    appearance.customized = true;
    let authoritative = player_sprites::authoritative_appearance_from_local(appearance);

    if !authoritative.is_valid() {
        ui.status = "The selected appearance is invalid.".to_owned();
        return false;
    }

    if network
        .outbound
        .send(ClientMessage::SetAppearance {
            appearance: authoritative,
        })
        .is_err()
    {
        ui.status = "Could not send the appearance to the server.".to_owned();
        return false;
    }

    ui.snapshot = Some(SavedAppearance::capture(appearance));
    ui.dirty = false;
    ui.status = format!("Appearance saved on the server for {}.", identity.name);
    info!(
        "ALDORIA APPEARANCE · submitted authoritative customization for {}",
        identity.name,
    );
    true
}

fn appearance_path(identity: &LocalIdentity) -> PathBuf {
    let base = if let Some(app_data) = std::env::var_os("APPDATA") {
        PathBuf::from(app_data).join("Embers of Aldoria")
    } else if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home)
            .join(".config")
            .join("embers-of-aldoria")
    } else {
        PathBuf::from(".")
    };

    base.join("appearance")
        .join(format!("{}.json", identity.id))
}

fn rotate_preview(ui: &mut NativeAppearanceUiState, delta: i32) {
    let count = PREVIEW_DIRECTIONS.len() as i32;
    ui.preview_direction =
        (ui.preview_direction as i32 + delta).rem_euclid(count) as usize;
}

pub(crate) fn apply_preview_direction(
    ui: Res<NativeAppearanceUiState>,
    mut players: Query<&mut LocalPlayerSprite>,
) {
    if !ui.open {
        return;
    }
    let direction = PREVIEW_DIRECTIONS[ui.preview_direction];
    for mut player in &mut players {
        player.set_preview_direction(direction);
    }
}

pub(crate) fn update_ui(
    ui: Res<NativeAppearanceUiState>,
    appearance: Option<Res<LocalCharacterAppearance>>,
    mut panel: Query<&mut Visibility, With<NativeAppearancePanel>>,
    mut values: Query<(&AppearanceValue, &mut Text, &mut TextColor)>,
    mut direction_text: Query<
        &mut Text,
        (
            With<AppearanceDirectionText>,
            Without<AppearanceValue>,
            Without<AppearanceStatusText>,
        ),
    >,
    mut status_text: Query<
        &mut Text,
        (
            With<AppearanceStatusText>,
            Without<AppearanceValue>,
            Without<AppearanceDirectionText>,
        ),
    >,
) {
    if let Ok(mut visibility) = panel.single_mut() {
        *visibility = if ui.open {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    let Some(appearance) = appearance else {
        return;
    };

    for (field, mut text, mut color) in &mut values {
        let (value, tint) = field_value_and_color(&appearance, field.0);
        text.0 = value;
        color.0 = tint;
    }

    if let Ok(mut text) = direction_text.single_mut() {
        text.0 = direction_label(PREVIEW_DIRECTIONS[ui.preview_direction]).to_owned();
    }

    if let Ok(mut text) = status_text.single_mut() {
        text.0 = if ui.status.is_empty() {
            "F9 opens/closes · Esc cancels · Q/E rotates preview".to_owned()
        } else if ui.dirty {
            format!("{}  ·  unsaved", ui.status)
        } else {
            ui.status.clone()
        };
    }
}

fn field_value_and_color(
    appearance: &LocalCharacterAppearance,
    field: AppearanceField,
) -> (String, Color) {
    match field {
        AppearanceField::Body => (pretty(&appearance.body), theme::TEXT),
        AppearanceField::Head => (pretty(&appearance.head), theme::TEXT),
        AppearanceField::Face => (pretty(&appearance.face), theme::TEXT),
        AppearanceField::Hair => (pretty(&appearance.hair), theme::TEXT),
        AppearanceField::FacialHair => (
            appearance
                .facial_hair
                .as_deref()
                .map(pretty)
                .unwrap_or_else(|| "None".to_owned()),
            theme::TEXT,
        ),
        AppearanceField::Torso => (pretty(&appearance.torso), theme::TEXT),
        AppearanceField::Legs => (pretty(&appearance.legs), theme::TEXT),
        AppearanceField::Feet => (pretty(&appearance.feet), theme::TEXT),
        AppearanceField::SkinTone => (
            pretty(&appearance.skin_tone),
            crate::player_sprites::appearance_color(&appearance.skin_tone),
        ),
        AppearanceField::HairColor => (
            pretty(&appearance.hair_color),
            crate::player_sprites::appearance_color(&appearance.hair_color),
        ),
        AppearanceField::TorsoColor => (
            pretty(&appearance.torso_color),
            crate::player_sprites::appearance_color(&appearance.torso_color),
        ),
        AppearanceField::LegsColor => (
            pretty(&appearance.legs_color),
            crate::player_sprites::appearance_color(&appearance.legs_color),
        ),
        AppearanceField::FeetColor => (
            pretty(&appearance.feet_color),
            crate::player_sprites::appearance_color(&appearance.feet_color),
        ),
    }
}

fn pretty(value: &str) -> String {
    let mut words = value.split('_');
    let first = words.next().unwrap_or_default();
    let rest = words.collect::<Vec<_>>().join(" ");
    let mut first_chars = first.chars();
    let first_pretty = match first_chars.next() {
        Some(ch) => ch.to_uppercase().collect::<String>() + first_chars.as_str(),
        None => String::new(),
    };
    if rest.is_empty() {
        first_pretty
    } else {
        format!("{first_pretty} {rest}")
    }
}

fn direction_label(direction: SpriteDirection) -> &'static str {
    match direction {
        SpriteDirection::North => "NORTH",
        SpriteDirection::NorthEast => "NORTH-EAST",
        SpriteDirection::East => "EAST",
        SpriteDirection::SouthEast => "SOUTH-EAST",
        SpriteDirection::South => "SOUTH",
        SpriteDirection::SouthWest => "SOUTH-WEST",
        SpriteDirection::West => "WEST",
        SpriteDirection::NorthWest => "NORTH-WEST",
    }
}

fn cycle_field(
    appearance: &mut LocalCharacterAppearance,
    field: AppearanceField,
    delta: i32,
) {
    match field {
        AppearanceField::Body => appearance.body = cycle(&appearance.body, &BODY, delta).to_owned(),
        AppearanceField::Head => appearance.head = cycle(&appearance.head, &HEAD, delta).to_owned(),
        AppearanceField::Face => appearance.face = cycle(&appearance.face, &FACE, delta).to_owned(),
        AppearanceField::Hair => appearance.hair = cycle(&appearance.hair, &HAIR, delta).to_owned(),
        AppearanceField::FacialHair => {
            let current = appearance.facial_hair.as_deref().unwrap_or("none");
            let next = cycle(current, &FACIAL_HAIR, delta);
            appearance.facial_hair = if next == "none" {
                None
            } else {
                Some(next.to_owned())
            };
        }
        AppearanceField::Torso => appearance.torso = cycle(&appearance.torso, &TORSO, delta).to_owned(),
        AppearanceField::Legs => appearance.legs = cycle(&appearance.legs, &LEGS, delta).to_owned(),
        AppearanceField::Feet => appearance.feet = cycle(&appearance.feet, &FEET, delta).to_owned(),
        AppearanceField::SkinTone => appearance.skin_tone = cycle(&appearance.skin_tone, &SKIN, delta).to_owned(),
        AppearanceField::HairColor => appearance.hair_color = cycle(&appearance.hair_color, &HAIR_COLOR, delta).to_owned(),
        AppearanceField::TorsoColor => appearance.torso_color = cycle(&appearance.torso_color, &CLOTH, delta).to_owned(),
        AppearanceField::LegsColor => appearance.legs_color = cycle(&appearance.legs_color, &CLOTH, delta).to_owned(),
        AppearanceField::FeetColor => appearance.feet_color = cycle(&appearance.feet_color, &LEATHER, delta).to_owned(),
    }
}

fn cycle<'a>(current: &str, choices: &'a [&'a str], delta: i32) -> &'a str {
    let index = choices
        .iter()
        .position(|candidate| *candidate == current)
        .unwrap_or(0) as i32;
    let next = (index + delta).rem_euclid(choices.len() as i32) as usize;
    choices[next]
}
