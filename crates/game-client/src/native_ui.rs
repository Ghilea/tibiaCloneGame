// TIBIAGAME_V36_21_NATIVE_GAMEPLAY_UI
use bevy::{
    input::{ButtonState, keyboard::KeyboardInput},
    prelude::*,
};
use game_protocol::ClientMessage;

use crate::{
    native_modal,
    native_ui_theme as theme,
    state::{NativeGameState, NativeMessageKind},
    NativeNetwork,
};

#[derive(Resource, Default)]
pub struct NativeChatState {
    pub active: bool,
    pub draft: String,
}

#[derive(Resource, Default)]
pub struct NativePanelState {
    pub inventory_open: bool,
    pub character_open: bool,
    pub skills_open: bool,
    pub spells_open: bool,
    pub crafting_open: bool,
    pub npc_open: bool,
    pub selected_item: Option<game_types::EntityId>,
    pub inventory_container_id: Option<game_types::EntityId>,
    pub inventory_search_active: bool,
    pub inventory_search: String,
    pub split_item_id: Option<game_types::EntityId>,
    pub split_quantity: u16,
    pub selected_spell_id: Option<String>,
    pub selected_recipe_id: Option<String>,
    pub crafting_category: usize,
    pub crafting_quantity: u16,
    pub selected_npc_id: Option<String>,
    pub npc_tab: usize,
    pub npc_index: usize,
}

#[derive(Resource, Default)]
pub struct NativePingState {
    pub last_ms: Option<u64>,
    next_ping_at: f64,
}

impl NativePingState {
    pub fn record_pong(&mut self, sent_at: u64, now_seconds: f64) {
        let now_ms = (now_seconds.max(0.0) * 1000.0) as u64;
        self.last_ms = Some(now_ms.saturating_sub(sent_at));
    }
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeUiText {
    WorldHeader,
    Identity,
    Health,
    Mana,
    Experience,
    Capacity,
    Ping,
    Target,
    BattleList,
    ChatLog,
    ChatInput,
    #[allow(dead_code)]
    ActionBar,
    Inventory,
    InventoryDetail,
    Character,
    Skills,
    Spellbook,
    SpellDetail,
    Crafting,
    CraftingDetail,
    Npc,
    NpcDetail,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeUiBar {
    Health,
    Mana,
    Experience,
    Capacity,
    TargetHealth,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeUiPanel {
    Inventory,
    Character,
    Skills,
    Spells,
    Crafting,
    Npc,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativePanelDockButton {
    Character,
    Inventory,
    Skills,
    Spells,
    Crafting,
}

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeActionSlot(pub(crate) usize);

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeActionSlotText(pub(crate) usize);

#[derive(Component, Clone, Copy)]
pub(crate) enum NativePanelCloseButton {
    Inventory,
    Character,
    Skills,
    Spells,
    Crafting,
    Npc,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeCharacterModalText {
    HeaderContext,
    Avatar,
    Identity,
    Health,
    Mana,
    Experience,
    Capacity,
    Melee,
    Distance,
    Shielding,
    Fletching,
    Magic,
    Equipment,
    Professions,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeCharacterModalBar {
    Health,
    Mana,
    Experience,
    Capacity,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeCharacterEquipmentSlot {
    Helmet,
    Amulet,
    Chest,
    Back,
    LeftHand,
    RightHand,
    Backpack,
    Ring,
    Feet,
    Legs,
}

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeCharacterProfessionSlot(
    pub(crate) usize,
);


#[derive(Component, Clone, Copy)]
pub(crate) enum NativeCharacterModalAction {
    Inventory,
    Skills,
    Close,
}


const PANEL: Color = theme::PANEL_BG;
const PANEL_SOFT: Color = theme::PANEL_BG_SOFT;
const PANEL_DEEP: Color = theme::PANEL_BG_DEEP;
const TEXT: Color = theme::TEXT;
const MUTED: Color = theme::MUTED;
const ACCENT: Color = theme::GOLD;
const HP: Color = theme::HP;
const MANA: Color = theme::MANA;
const XP: Color = theme::XP;
const CAP: Color = theme::CAP;
const TARGET_HP: Color = theme::TARGET_HP;

pub fn setup(mut commands: Commands) {
    spawn_world_header(&mut commands);
    spawn_player_frame(&mut commands);
    spawn_target_frame(&mut commands);
    spawn_battle_list(&mut commands);
    spawn_chat(&mut commands);
    spawn_action_bar(&mut commands);
    spawn_panel_dock(&mut commands);
    spawn_inventory_panel(&mut commands);
    spawn_character_panel(&mut commands);
    spawn_skills_panel(&mut commands);
    spawn_spellbook_panel(&mut commands);
    spawn_crafting_panel(&mut commands);
    spawn_npc_panel(&mut commands);
}

fn text_bundle(
    label: impl Into<String>,
    kind: NativeUiText,
    size: f32,
    color: Color,
) -> impl Bundle {
    (
        kind,
        Text::new(label),
        TextFont {
            font_size: FontSize::Px(size),
            ..default()
        },
        TextColor(color),
    )
}

fn spawn_bar(
    parent: &mut ChildSpawnerCommands,
    kind: NativeUiBar,
    color: Color,
) {
    parent
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: px(10),
                margin: UiRect::vertical(px(2)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(3)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.01, 0.014, 0.012, 0.78)),
            BorderColor::all(theme::GOLD_DARK),
        ))
        .with_child((
            kind,
            Node {
                width: Val::Percent(0.0),
                height: Val::Percent(100.0),
                border_radius: BorderRadius::all(px(2)),
                ..default()
            },
            BackgroundColor(color),
        ));
}

fn spawn_world_header(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · world header"),
            Node {
                position_type: PositionType::Absolute,
                top: px(0),
                left: px(0),
                right: px(0),
                height: px(48),
                padding: UiRect::horizontal(px(16)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::SpaceBetween,
                ..default()
            },
            BackgroundColor(PANEL_DEEP),
        ))
        .with_child(text_bundle(
            "",
            NativeUiText::WorldHeader,
            14.0,
            TEXT,
        ));
}

fn spawn_battle_list(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · battle list"),
            Node {
                position_type: PositionType::Absolute,
                top: px(366),
                right: px(14),
                width: px(238),
                min_height: px(168),
                padding: UiRect::all(px(10)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_child(text_bundle(
            "",
            NativeUiText::BattleList,
            12.0,
            TEXT,
        ));
}

fn spawn_panel_dock(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · panel dock"),
            Node {
                position_type: PositionType::Absolute,
                right: px(14),
                bottom: px(14),
                width: px(282),
                min_height: px(58),
                padding: UiRect::all(px(6)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                column_gap: px(5),
                ..default()
            },
            BackgroundColor(PANEL_DEEP),
        ))
        .with_children(|parent| {
            spawn_panel_dock_button(
                parent,
                NativePanelDockButton::Character,
                "C",
                "CHAR",
            );
            spawn_panel_dock_button(
                parent,
                NativePanelDockButton::Inventory,
                "I",
                "INV",
            );
            spawn_panel_dock_button(
                parent,
                NativePanelDockButton::Skills,
                "K",
                "SKILL",
            );
            spawn_panel_dock_button(
                parent,
                NativePanelDockButton::Spells,
                "P",
                "SPELL",
            );
            spawn_panel_dock_button(
                parent,
                NativePanelDockButton::Crafting,
                "B",
                "CRAFT",
            );
        });
}

fn spawn_panel_dock_button(
    parent: &mut ChildSpawnerCommands,
    action: NativePanelDockButton,
    hotkey: &str,
    label: &str,
) {
    parent
        .spawn((
            Button,
            action,
            Node {
                width: px(48),
                height: px(44),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(theme::BUTTON_BG),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_child((
            Text::new(format!("{hotkey}  {label}")),
            TextFont {
                font_size: FontSize::Px(8.5),
                ..default()
            },
            TextColor(TEXT),
        ));
}

fn spawn_player_frame(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · player"),
            Node {
                position_type: PositionType::Absolute,
                top: px(62),
                left: px(14),
                width: px(320),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            parent.spawn(text_bundle("", NativeUiText::Identity, 20.0, TEXT));
            parent.spawn(text_bundle("", NativeUiText::Health, 14.0, TEXT));
            spawn_bar(parent, NativeUiBar::Health, HP);
            parent.spawn(text_bundle("", NativeUiText::Mana, 14.0, TEXT));
            spawn_bar(parent, NativeUiBar::Mana, MANA);
            parent.spawn(text_bundle("", NativeUiText::Experience, 13.0, MUTED));
            spawn_bar(parent, NativeUiBar::Experience, XP);
            parent.spawn(text_bundle("", NativeUiText::Capacity, 13.0, MUTED));
            spawn_bar(parent, NativeUiBar::Capacity, CAP);
            parent.spawn(text_bundle("", NativeUiText::Ping, 12.0, MUTED));
        });
}

fn spawn_target_frame(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · target"),
            Node {
                position_type: PositionType::Absolute,
                top: px(62),
                left: px(348),
                width: px(300),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            parent.spawn(text_bundle(
                "No target",
                NativeUiText::Target,
                16.0,
                TEXT,
            ));
            spawn_bar(parent, NativeUiBar::TargetHealth, TARGET_HP);
        });
}

fn spawn_chat(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · chat"),
            Node {
                position_type: PositionType::Absolute,
                bottom: px(88),
                left: px(14),
                width: px(520),
                min_height: px(166),
                padding: UiRect::all(px(10)),
                flex_direction: FlexDirection::Column,
                justify_content: JustifyContent::FlexEnd,
                ..default()
            },
            BackgroundColor(PANEL_SOFT),
        ))
        .with_children(|parent| {
            parent.spawn(text_bundle(
                "",
                NativeUiText::ChatLog,
                13.0,
                TEXT,
            ));
            parent
                .spawn((
                    Node {
                        width: Val::Percent(100.0),
                        min_height: px(28),
                        margin: UiRect::top(px(7)),
                        padding: UiRect::horizontal(px(8)),
                        align_items: AlignItems::Center,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.48)),
                ))
                .with_child(text_bundle(
                    "Enter to chat",
                    NativeUiText::ChatInput,
                    14.0,
                    MUTED,
                ));
        });
}

fn spawn_action_bar(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · action bar"),
            Node {
                position_type: PositionType::Absolute,
                bottom: px(14),
                left: Val::Percent(50.0),
                width: px(598),
                min_height: px(70),
                margin: UiRect::left(px(-299)),
                padding: UiRect::all(px(7)),
                column_gap: px(5),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            for slot in 0..9 {
                spawn_action_slot(parent, slot);
            }
        });
}

fn spawn_action_slot(
    parent: &mut ChildSpawnerCommands,
    slot: usize,
) {
    parent
        .spawn((
            Button,
            NativeActionSlot(slot),
            Node {
                width: px(58),
                height: px(54),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                padding: UiRect::all(px(3)),
                ..default()
            },
            BackgroundColor(theme::BUTTON_BG),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_child((
            NativeActionSlotText(slot),
            Text::new(""),
            TextFont {
                font_size: FontSize::Px(8.5),
                ..default()
            },
            TextColor(TEXT),
        ));
}




fn spawn_panel_header(
    parent: &mut ChildSpawnerCommands,
    title: &str,
    action: NativePanelCloseButton,
) {
    parent
        .spawn(Node {
            width: Val::Percent(100.0),
            height: px(34),
            margin: UiRect::bottom(px(10)),
            padding: UiRect::horizontal(px(4)),
            align_items: AlignItems::Center,
            justify_content: JustifyContent::SpaceBetween,
            ..default()
        })
        .with_children(|header| {
            header.spawn((
                Text::new(title),
                TextFont {
                    font_size: FontSize::Px(15.0),
                    ..default()
                },
                TextColor(theme::GOLD_BRIGHT),
            ));

            header
                .spawn((
                    Button,
                    action,
                    Node {
                        width: px(28),
                        height: px(26),
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
                    Text::new("X"),
                    TextFont {
                        font_size: FontSize::Px(11.0),
                        ..default()
                    },
                    TextColor(TEXT),
                ));
        });
}

fn spawn_inventory_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · inventory"),
            NativeUiPanel::Inventory,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(12.0),
                left: Val::Percent(50.0),
                width: px(470),
                margin: UiRect::left(px(-235)),
                min_height: px(530),
                max_height: Val::Percent(78.0),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            spawn_panel_header(
                parent,
                "INVENTORY",
                NativePanelCloseButton::Inventory,
            );
            parent.spawn(text_bundle(
                "",
                NativeUiText::Inventory,
                14.0,
                TEXT,
            ));
            parent.spawn(text_bundle(
                "",
                NativeUiText::InventoryDetail,
                13.0,
                MUTED,
            ));
        });
}

fn spawn_character_modal_text(
    parent: &mut ChildSpawnerCommands,
    kind: NativeCharacterModalText,
    value: &str,
    size: f32,
    color: Color,
) {
    parent.spawn((
        kind,
        Text::new(value),
        TextFont { font_size: FontSize::Px(size), ..default() },
        TextColor(color),
    ));
}

fn character_card_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        padding: UiRect::all(px(14)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(8)),
        flex_direction: FlexDirection::Column,
        row_gap: px(8),
        ..default()
    }
}

fn spawn_character_section_title(
    parent: &mut ChildSpawnerCommands,
    title: &str,
    subtitle: &str,
) {
    parent.spawn(Node {
        width: Val::Percent(100.0),
        flex_direction: FlexDirection::Column,
        row_gap: px(2),
        ..default()
    }).with_children(|copy| {
        copy.spawn((
            Text::new(title),
            TextFont { font_size: FontSize::Px(11.5), ..default() },
            TextColor(theme::GOLD),
        ));
        copy.spawn((
            Text::new(subtitle),
            TextFont { font_size: FontSize::Px(9.0), ..default() },
            TextColor(MUTED),
        ));
    });
}

fn spawn_character_vital(
    parent: &mut ChildSpawnerCommands,
    label: &str,
    text_kind: NativeCharacterModalText,
    bar_kind: NativeCharacterModalBar,
    bar_color: Color,
) {
    parent.spawn(Node {
        width: Val::Percent(100.0),
        flex_direction: FlexDirection::Column,
        row_gap: px(4),
        ..default()
    }).with_children(|root| {
        root.spawn(Node {
            width: Val::Percent(100.0),
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            justify_content: JustifyContent::SpaceBetween,
            ..default()
        }).with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont { font_size: FontSize::Px(9.5), ..default() },
                TextColor(MUTED),
            ));
            spawn_character_modal_text(row, text_kind, "—", 10.5, TEXT);
        });

        root.spawn((
            Node {
                width: Val::Percent(100.0),
                height: px(7),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(3)),
                ..default()
            },
            BackgroundColor(PANEL_DEEP),
            BorderColor::all(theme::GOLD_DARK),
        )).with_child((
            bar_kind,
            Node {
                width: Val::Percent(0.0),
                height: Val::Percent(100.0),
                border_radius: BorderRadius::all(px(2)),
                ..default()
            },
            BackgroundColor(bar_color),
        ));
    });
}

fn spawn_character_skill_row(
    parent: &mut ChildSpawnerCommands,
    label: &str,
    kind: NativeCharacterModalText,
) {
    parent.spawn((
        Node {
            width: Val::Percent(100.0),
            min_height: px(32),
            padding: UiRect::horizontal(px(9)),
            border: UiRect::all(px(1)),
            border_radius: BorderRadius::all(px(5)),
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            justify_content: JustifyContent::SpaceBetween,
            ..default()
        },
        BackgroundColor(PANEL_DEEP),
        BorderColor::all(theme::BUTTON_BORDER),
    )).with_children(|row| {
        row.spawn((
            Text::new(label),
            TextFont { font_size: FontSize::Px(9.5), ..default() },
            TextColor(MUTED),
        ));
        spawn_character_modal_text(row, kind, "—", 10.5, TEXT);
    });
}

fn spawn_character_modal_button(
    parent: &mut ChildSpawnerCommands,
    action: NativeCharacterModalAction,
    label: &str,
    primary: bool,
) {
    parent.spawn((
        Button,
        action,
        native_modal::action_button_node(),
        BackgroundColor(if primary { theme::BUTTON_HOVER } else { theme::BUTTON_BG }),
        BorderColor::all(if primary { theme::GOLD } else { theme::BUTTON_BORDER }),
    )).with_child((
        Text::new(label),
        TextFont { font_size: FontSize::Px(10.5), ..default() },
        TextColor(if primary { theme::GOLD_BRIGHT } else { TEXT }),
    ));
}

fn character_reference_root_node() -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(0),
        right: px(0),
        top: px(0),
        bottom: px(0),
        width: Val::Percent(100.0),
        height: Val::Percent(100.0),
        padding: UiRect::all(px(10)),
        align_items: AlignItems::FlexStart,
        justify_content: JustifyContent::FlexStart,
        ..default()
    }
}

fn character_reference_surface_node() -> Node {
    Node {
        width: px(430),
        height: Val::Percent(100.0),
        max_height: px(820),
        padding: UiRect::all(px(14)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(10)),
        flex_direction: FlexDirection::Column,
        row_gap: px(10),
        ..default()
    }
}

fn character_reference_section_node(
    height: f32,
) -> Node {
    Node {
        width: Val::Percent(100.0),
        height: px(height),
        padding: UiRect::all(px(10)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(7)),
        flex_direction: FlexDirection::Column,
        row_gap: px(7),
        ..default()
    }
}

fn spawn_character_reference_close(
    parent: &mut ChildSpawnerCommands,
) {
    parent
        .spawn((
            Button,
            NativeCharacterModalAction::Close,
            Node {
                width: px(34),
                height: px(34),
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
            Text::new("X"),
            TextFont {
                font_size: FontSize::Px(14.0),
                ..default()
            },
            TextColor(TEXT),
        ));
}

fn spawn_character_avatar(
    parent: &mut ChildSpawnerCommands,
) {
    parent
        .spawn((
            Node {
                width: px(56),
                height: px(56),
                border: UiRect::all(px(3)),
                border_radius: BorderRadius::all(px(28)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(
                Color::srgb(0.74, 0.56, 0.25),
            ),
            BorderColor::all(theme::GOLD_BRIGHT),
        ))
        .with_child((
            NativeCharacterModalText::Avatar,
            Text::new("A"),
            TextFont {
                font_size: FontSize::Px(22.0),
                ..default()
            },
            TextColor(
                Color::srgb(0.10, 0.08, 0.04),
            ),
        ));
}

fn spawn_character_paper_doll(
    parent: &mut ChildSpawnerCommands,
) {
    parent
        .spawn(Node {
            position_type: PositionType::Absolute,
            left: Val::Percent(50.0),
            top: px(58),
            width: px(132),
            height: px(260),
            margin: UiRect::left(px(-66)),
            ..default()
        })
        .with_children(|figure| {
            figure.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(47),
                    top: px(0),
                    width: px(38),
                    height: px(38),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(19)),
                    ..default()
                },
                BackgroundColor(
                    Color::srgba(0.17, 0.23, 0.20, 0.92),
                ),
                BorderColor::all(
                    Color::srgb(0.39, 0.47, 0.42),
                ),
            ));

            figure.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(35),
                    top: px(42),
                    width: px(62),
                    height: px(112),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(9)),
                    ..default()
                },
                BackgroundColor(
                    Color::srgba(0.12, 0.19, 0.16, 0.86),
                ),
                BorderColor::all(
                    Color::srgb(0.39, 0.47, 0.42),
                ),
            ));

            for (left, top, width, height) in [
                (20.0, 50.0, 16.0, 104.0),
                (96.0, 50.0, 16.0, 104.0),
                (42.0, 150.0, 21.0, 104.0),
                (69.0, 150.0, 21.0, 104.0),
            ] {
                figure.spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: px(left),
                        top: px(top),
                        width: px(width),
                        height: px(height),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(8)),
                        ..default()
                    },
                    BackgroundColor(
                        Color::srgba(
                            0.12,
                            0.19,
                            0.16,
                            0.86,
                        ),
                    ),
                    BorderColor::all(
                        Color::srgb(
                            0.39,
                            0.47,
                            0.42,
                        ),
                    ),
                ));
            }

            for (left, top) in [
                (13.0, 148.0),
                (99.0, 148.0),
            ] {
                figure.spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: px(left),
                        top: px(top),
                        width: px(22),
                        height: px(22),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(11)),
                        ..default()
                    },
                    BackgroundColor(
                        Color::srgba(
                            0.12,
                            0.19,
                            0.16,
                            0.86,
                        ),
                    ),
                    BorderColor::all(
                        Color::srgb(
                            0.39,
                            0.47,
                            0.42,
                        ),
                    ),
                ));
            }
        });
}

fn spawn_character_equipment_slot(
    parent: &mut ChildSpawnerCommands,
    slot: NativeCharacterEquipmentSlot,
    label: &str,
    left: Val,
    top: Val,
) {
    parent
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left,
                top,
                width: px(84),
                height: px(70),
                padding: UiRect::all(px(5)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::SpaceBetween,
                ..default()
            },
            BackgroundColor(
                Color::srgba(0.02, 0.045, 0.035, 0.95),
            ),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_children(|card| {
            card.spawn((
                Text::new(label),
                TextFont {
                    font_size: FontSize::Px(8.0),
                    ..default()
                },
                TextColor(MUTED),
            ));

            card.spawn((
                slot,
                Text::new("Empty"),
                TextFont {
                    font_size: FontSize::Px(8.5),
                    ..default()
                },
                TextColor(TEXT),
            ));
        });
}

fn spawn_character_profession_slot(
    parent: &mut ChildSpawnerCommands,
    index: usize,
) {
    parent
        .spawn((
            Node {
                width: Val::Percent(24.0),
                height: px(44),
                padding: UiRect::horizontal(px(7)),
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
            NativeCharacterProfessionSlot(index),
            Text::new("Empty"),
            TextFont {
                font_size: FontSize::Px(8.5),
                ..default()
            },
            TextColor(MUTED),
        ));
}

fn spawn_character_outfit_chip(
    parent: &mut ChildSpawnerCommands,
    label: &str,
    selected: bool,
) {
    parent
        .spawn((
            Node {
                width: Val::Percent(24.0),
                height: px(38),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(
                if selected {
                    Color::srgba(
                        0.28,
                        0.19,
                        0.06,
                        0.92,
                    )
                } else {
                    theme::BUTTON_BG
                },
            ),
            BorderColor::all(
                if selected {
                    theme::GOLD
                } else {
                    theme::BUTTON_BORDER
                },
            ),
        ))
        .with_child((
            Text::new(label),
            TextFont {
                font_size: FontSize::Px(8.5),
                ..default()
            },
            TextColor(
                if selected {
                    theme::GOLD_BRIGHT
                } else {
                    MUTED
                },
            ),
        ));
}

fn spawn_character_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native modal · character · Greyhaven reference"),
            NativeUiPanel::Character,
            native_modal::NativeModalRoot,
            GlobalZIndex(190),
            Visibility::Hidden,
            character_reference_root_node(),
            native_modal::backdrop(),
        ))
        .with_children(|root| {
            root
                .spawn((
                    Name::new("Greyhaven Character interface"),
                    native_modal::NativeModalSurface,
                    character_reference_surface_node(),
                    native_modal::surface(),
                    native_modal::surface_border(),
                ))
                .with_children(|panel| {
                    panel
                        .spawn(Node {
                            width: Val::Percent(100.0),
                            min_height: px(58),
                            padding: UiRect {
                                left: px(6),
                                right: px(0),
                                top: px(0),
                                bottom: px(8),
                            },
                            border: UiRect {
                                left: px(0),
                                right: px(0),
                                top: px(0),
                                bottom: px(1),
                            },
                            flex_direction: FlexDirection::Row,
                            align_items: AlignItems::Center,
                            justify_content: JustifyContent::SpaceBetween,
                            ..default()
                        })
                        .with_children(|header| {
                            header
                                .spawn(Node {
                                    flex_direction: FlexDirection::Column,
                                    row_gap: px(3),
                                    ..default()
                                })
                                .with_children(|copy| {
                                    copy.spawn((
                                        Text::new("GREYHAVEN INTERFACE"),
                                        TextFont {
                                            font_size: FontSize::Px(10.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD),
                                    ));

                                    copy.spawn((
                                        Text::new("CHARACTER"),
                                        TextFont {
                                            font_size: FontSize::Px(21.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD_BRIGHT),
                                    ));
                                });

                            spawn_character_reference_close(header);
                        });

                    panel
                        .spawn((
                            character_reference_section_node(82.0),
                            BackgroundColor(PANEL_SOFT),
                            BorderColor::all(theme::BUTTON_BORDER),
                        ))
                        .with_children(|identity| {
                            identity
                                .spawn(Node {
                                    width: Val::Percent(100.0),
                                    height: Val::Percent(100.0),
                                    flex_direction: FlexDirection::Row,
                                    align_items: AlignItems::Center,
                                    column_gap: px(12),
                                    ..default()
                                })
                                .with_children(|row| {
                                    spawn_character_avatar(row);

                                    row
                                        .spawn(Node {
                                            flex_grow: 1.0,
                                            flex_direction: FlexDirection::Column,
                                            row_gap: px(2),
                                            ..default()
                                        })
                                        .with_children(|copy| {
                                            spawn_character_modal_text(
                                                copy,
                                                NativeCharacterModalText::Identity,
                                                "No local player",
                                                13.0,
                                                theme::GOLD_BRIGHT,
                                            );

                                            copy.spawn((
                                                Text::new(
                                                    "Manage equipment through Inventory",
                                                ),
                                                TextFont {
                                                    font_size: FontSize::Px(9.0),
                                                    ..default()
                                                },
                                                TextColor(MUTED),
                                            ));
                                        });

                                    spawn_character_modal_text(
                                        row,
                                        NativeCharacterModalText::HeaderContext,
                                        "Greyhaven",
                                        8.5,
                                        theme::GOLD,
                                    );
                                });
                        });

                    panel
                        .spawn((
                            Node {
                                width: Val::Percent(100.0),
                                height: px(420),
                                border: UiRect::all(px(1)),
                                border_radius: BorderRadius::all(px(7)),
                                ..default()
                            },
                            BackgroundColor(
                                Color::srgba(
                                    0.015,
                                    0.035,
                                    0.027,
                                    0.95,
                                ),
                            ),
                            BorderColor::all(theme::BUTTON_BORDER),
                        ))
                        .with_children(|equipment| {
                            spawn_character_paper_doll(equipment);

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Helmet,
                                "HELMET",
                                Val::Percent(50.0),
                                px(8),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Amulet,
                                "AMULET",
                                px(304),
                                px(18),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Chest,
                                "CHEST",
                                px(10),
                                px(92),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Back,
                                "BACK",
                                px(304),
                                px(92),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::LeftHand,
                                "LEFT HAND",
                                px(10),
                                px(178),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::RightHand,
                                "RIGHT HAND",
                                px(304),
                                px(178),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Backpack,
                                "BACKPACK",
                                px(10),
                                px(264),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Ring,
                                "RING",
                                px(304),
                                px(264),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Feet,
                                "FEET",
                                Val::Percent(50.0),
                                px(338),
                            );

                            spawn_character_equipment_slot(
                                equipment,
                                NativeCharacterEquipmentSlot::Legs,
                                "LEGS",
                                px(304),
                                px(338),
                            );
                        });

                    panel
                        .spawn((
                            character_reference_section_node(90.0),
                            BackgroundColor(PANEL_SOFT),
                            BorderColor::all(theme::BUTTON_BORDER),
                        ))
                        .with_children(|professions| {
                            professions.spawn((
                                Text::new("PROFESSION SLOTS"),
                                TextFont {
                                    font_size: FontSize::Px(10.0),
                                    ..default()
                                },
                                TextColor(theme::GOLD),
                            ));

                            professions.spawn((
                                Text::new(
                                    "Up to 2 gathering + 2 crafting",
                                ),
                                TextFont {
                                    font_size: FontSize::Px(8.0),
                                    ..default()
                                },
                                TextColor(MUTED),
                            ));

                            professions
                                .spawn(Node {
                                    width: Val::Percent(100.0),
                                    flex_direction: FlexDirection::Row,
                                    justify_content: JustifyContent::SpaceBetween,
                                    column_gap: px(5),
                                    ..default()
                                })
                                .with_children(|slots| {
                                    for index in 0..4usize {
                                        spawn_character_profession_slot(
                                            slots,
                                            index,
                                        );
                                    }
                                });
                        });

                    panel
                        .spawn((
                            character_reference_section_node(74.0),
                            BackgroundColor(PANEL_SOFT),
                            BorderColor::all(theme::BUTTON_BORDER),
                        ))
                        .with_children(|outfit| {
                            outfit.spawn((
                                Text::new("OUTFIT"),
                                TextFont {
                                    font_size: FontSize::Px(10.0),
                                    ..default()
                                },
                                TextColor(theme::GOLD),
                            ));

                            outfit
                                .spawn(Node {
                                    width: Val::Percent(100.0),
                                    flex_direction: FlexDirection::Row,
                                    justify_content: JustifyContent::SpaceBetween,
                                    column_gap: px(5),
                                    ..default()
                                })
                                .with_children(|chips| {
                                    spawn_character_outfit_chip(
                                        chips,
                                        "ARMORED",
                                        true,
                                    );
                                    spawn_character_outfit_chip(
                                        chips,
                                        "WAYFARER",
                                        false,
                                    );
                                    spawn_character_outfit_chip(
                                        chips,
                                        "MYSTIC",
                                        false,
                                    );
                                    spawn_character_outfit_chip(
                                        chips,
                                        "SHADOW",
                                        false,
                                    );
                                });
                        });
                });
        });
}


fn spawn_skills_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · skills"),
            NativeUiPanel::Skills,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(12.0),
                left: Val::Percent(50.0),
                width: px(500),
                margin: UiRect::left(px(-250)),
                min_height: px(500),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            spawn_panel_header(
                parent,
                "SKILLS",
                NativePanelCloseButton::Skills,
            );
            parent.spawn(text_bundle(
                "",
                NativeUiText::Skills,
                13.0,
                TEXT,
            ));
        });
}

fn spawn_spellbook_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · spellbook"),
            NativeUiPanel::Spells,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(12.0),
                left: Val::Percent(50.0),
                width: px(500),
                margin: UiRect::left(px(-250)),
                min_height: px(520),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            spawn_panel_header(
                parent,
                "SPELLBOOK",
                NativePanelCloseButton::Spells,
            );
            parent.spawn(text_bundle(
                "",
                NativeUiText::Spellbook,
                13.0,
                TEXT,
            ));
            parent.spawn(text_bundle(
                "",
                NativeUiText::SpellDetail,
                12.0,
                MUTED,
            ));
        });
}


fn spawn_crafting_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · crafting"),
            NativeUiPanel::Crafting,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(10.0),
                left: Val::Percent(50.0),
                width: px(560),
                margin: UiRect::left(px(-280)),
                min_height: px(540),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            spawn_panel_header(
                parent,
                "CRAFTING",
                NativePanelCloseButton::Crafting,
            );
            parent.spawn(text_bundle(
                "",
                NativeUiText::Crafting,
                13.0,
                TEXT,
            ));
            parent.spawn(text_bundle(
                "",
                NativeUiText::CraftingDetail,
                12.0,
                MUTED,
            ));
        });
}


fn spawn_npc_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native gameplay HUD · NPC"),
            NativeUiPanel::Npc,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(9.0),
                left: Val::Percent(50.0),
                width: px(600),
                margin: UiRect::left(px(-300)),
                min_height: px(570),
                max_height: Val::Percent(82.0),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|parent| {
            spawn_panel_header(
                parent,
                "NPC",
                NativePanelCloseButton::Npc,
            );
            parent.spawn(text_bundle(
                "",
                NativeUiText::Npc,
                13.0,
                TEXT,
            ));
            parent.spawn(text_bundle(
                "",
                NativeUiText::NpcDetail,
                12.0,
                MUTED,
            ));
        });
}

pub fn update_ui(
    game_state: Res<NativeGameState>,
    ping: Res<NativePingState>,
    chat: Res<NativeChatState>,
    panel_state: Res<NativePanelState>,
    mut texts: Query<
        (&NativeUiText, &mut Text, &mut TextColor),
        Without<NativeActionSlotText>,
    >,
    mut action_slot_texts: Query<
        (&NativeActionSlotText, &mut Text),
        Without<NativeUiText>,
    >,
    mut bars: Query<(&NativeUiBar, &mut Node)>,
    mut panels: Query<(&NativeUiPanel, &mut Visibility)>,
) {
    let player = game_state.local_player();
    let target = game_state
        .attack_target_id
        .and_then(|id| game_state.creatures.get(&id));

    let mut learned: Vec<_> = game_state
        .learned_spell_ids
        .iter()
        .filter_map(|id| game_state.spells.get(id))
        .collect();
    learned.sort_by(|a, b| a.name.cmp(&b.name));

    let battle_list_text = match game_state.local_player() {
        Some(local) => {
            let mut nearby: Vec<_> = game_state
                .creatures
                .values()
                .filter(|creature| {
                    creature.position.z == local.position.z
                        && creature.health > 0
                })
                .map(|creature| {
                    let dx =
                        (creature.position.x - local.position.x).abs();
                    let dy =
                        (creature.position.y - local.position.y).abs();
                    (
                        dx.max(dy),
                        creature.id,
                        creature.name.clone(),
                        creature.health,
                        creature.max_health,
                    )
                })
                .filter(|(distance, _, _, _, _)| *distance <= 12)
                .collect();

            nearby.sort_by_key(|entry| entry.0);

            let mut lines = vec!["BATTLE LIST".to_owned()];

            if nearby.is_empty() {
                lines.push("No creatures nearby.".into());
            } else {
                for (_distance, id, name, health, max_health) in
                    nearby.into_iter().take(8)
                {
                    let marker =
                        if game_state.attack_target_id == Some(id) {
                            "▶"
                        } else {
                            " "
                        };

                    lines.push(format!(
                        "{marker} {:<18} {:>3}/{:<3}",
                        name,
                        health,
                        max_health,
                    ));
                }
            }

            lines.join("\n")
        }
        None => "BATTLE LIST\nNo local player.".to_owned(),
    };

    let action_line = action_bar_text(&learned);
    let inventory_text =
        inventory_panel_text(&game_state, &panel_state);
    let inventory_detail =
        inventory_detail_text(&game_state, &panel_state);
    let character_text = character_panel_text(&game_state);
    let skills_text = skills_panel_text(&game_state);
    let spellbook_text =
        spellbook_panel_text(&game_state, panel_state.selected_spell_id.as_deref());
    let spell_detail =
        spell_detail_text(&game_state, panel_state.selected_spell_id.as_deref());
    let crafting_text =
        crafting_panel_text(&game_state, &panel_state);
    let crafting_detail =
        crafting_detail_text(&game_state, &panel_state);
    let npc_text = npc_panel_text(&game_state, &panel_state);
    let npc_detail = npc_detail_text(&game_state, &panel_state);

    let mut chat_lines: Vec<String> = game_state
        .messages
        .iter()
        .rev()
        .take(9)
        .map(|line| format!("{} {}", message_prefix(line.kind), line.text))
        .collect();
    chat_lines.reverse();

    for (kind, mut text, mut color) in &mut texts {
        match kind {
            NativeUiText::WorldHeader => {
                let online = game_state.players.len();
                let ping_text = match ping.last_ms {
                    Some(ms) => format!("{ms} ms"),
                    None => "—".into(),
                };

                text.0 = format!(
                    "EMBERS OF ALDORIA   |   Greyhaven   |   {online} online   |   {ping_text}"
                );
                color.0 = ACCENT;
            }
            NativeUiText::Identity => {
                text.0 = player
                    .map(|p| format!("{}   ·   Level {}", p.name, p.level))
                    .unwrap_or_else(|| "Aldoria".into());
                color.0 = TEXT;
            }
            NativeUiText::Health => {
                text.0 = player
                    .map(|p| format!("Health   {} / {}", p.health, p.max_health))
                    .unwrap_or_else(|| "Health".into());
                color.0 = TEXT;
            }
            NativeUiText::Mana => {
                text.0 = player
                    .map(|p| format!("Mana     {} / {}", p.mana, p.max_mana))
                    .unwrap_or_else(|| "Mana".into());
                color.0 = TEXT;
            }
            NativeUiText::Experience => {
                text.0 = player
                    .map(experience_text)
                    .unwrap_or_else(|| "Experience".into());
                color.0 = MUTED;
            }
            NativeUiText::Capacity => {
                text.0 = format!(
                    "Capacity   {:.1} / {:.1}",
                    game_state.inventory_weight,
                    game_state.max_capacity,
                );
                color.0 = MUTED;
            }
            NativeUiText::Ping => {
                text.0 = match ping.last_ms {
                    Some(ms) => format!("Ping   {ms} ms"),
                    None => "Ping   —".into(),
                };
                color.0 = MUTED;
            }
            NativeUiText::Target => {
                if let Some(creature) = target {
                    text.0 = format!(
                        "{}\nHP {} / {}   ·   {}",
                        creature.name,
                        creature.health,
                        creature.max_health,
                        creature.state,
                    );
                    color.0 = TEXT;
                } else {
                    text.0 = "No target".into();
                    color.0 = MUTED;
                }
            }
            NativeUiText::BattleList => {
                text.0 = battle_list_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::ChatLog => {
                text.0 = chat_lines.join("\n");
                color.0 = TEXT;
            }
            NativeUiText::ChatInput => {
                text.0 = if chat.active {
                    format!("> {}_", chat.draft)
                } else {
                    "Enter to chat".into()
                };
                color.0 = if chat.active { TEXT } else { MUTED };
            }
            NativeUiText::ActionBar => {
                text.0 = action_line.clone();
                color.0 = TEXT;
            }
            NativeUiText::Inventory => {
                text.0 = inventory_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::InventoryDetail => {
                text.0 = inventory_detail.clone();
                color.0 = MUTED;
            }
            NativeUiText::Character => {
                text.0 = character_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::Skills => {
                text.0 = skills_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::Spellbook => {
                text.0 = spellbook_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::SpellDetail => {
                text.0 = spell_detail.clone();
                color.0 = MUTED;
            }
            NativeUiText::Crafting => {
                text.0 = crafting_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::CraftingDetail => {
                text.0 = crafting_detail.clone();
                color.0 = MUTED;
            }
            NativeUiText::Npc => {
                text.0 = npc_text.clone();
                color.0 = TEXT;
            }
            NativeUiText::NpcDetail => {
                text.0 = npc_detail.clone();
                color.0 = MUTED;
            }
        }
    }

    for (slot, mut text) in &mut action_slot_texts {
        text.0 = if slot.0 == 0 {
            "1\nATTACK".into()
        } else {
            let spell_index = slot.0 - 1;
            match learned.get(spell_index) {
                Some(spell) => {
                    format!("{}\n{}", slot.0 + 1, spell.name)
                }
                None => {
                    format!("{}\n—", slot.0 + 1)
                }
            }
        };
    }

    for (kind, mut node) in &mut bars {
        let ratio = match kind {
            NativeUiBar::Health => player
                .map(|p| ratio(p.health as f32, p.max_health as f32))
                .unwrap_or(0.0),
            NativeUiBar::Mana => player
                .map(|p| ratio(p.mana as f32, p.max_mana as f32))
                .unwrap_or(0.0),
            NativeUiBar::Experience => player.map(experience_ratio).unwrap_or(0.0),
            NativeUiBar::Capacity => ratio(
                game_state.inventory_weight,
                game_state.max_capacity,
            ),
            NativeUiBar::TargetHealth => target
                .map(|c| ratio(c.health as f32, c.max_health as f32))
                .unwrap_or(0.0),
        };

        node.width = Val::Percent(ratio * 100.0);
    }

    for (panel, mut visibility) in &mut panels {
        let shown = match panel {
            NativeUiPanel::Inventory => panel_state.inventory_open,
            NativeUiPanel::Character => panel_state.character_open,
            NativeUiPanel::Skills => panel_state.skills_open,
            NativeUiPanel::Spells => panel_state.spells_open,
            NativeUiPanel::Crafting => panel_state.crafting_open,
            NativeUiPanel::Npc => panel_state.npc_open,
        };
        *visibility = if shown {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

}

pub fn handle_chat_input(
    mut keyboard: MessageReader<KeyboardInput>,
    network: Res<NativeNetwork>,
    mut chat: ResMut<NativeChatState>,
    mut game_state: ResMut<NativeGameState>,
) {
    for event in keyboard.read() {
        if event.state != ButtonState::Pressed {
            continue;
        }

        match event.key_code {
            KeyCode::Enter => {
                if !chat.active {
                    chat.active = true;
                    chat.draft.clear();
                    continue;
                }

                let message = chat.draft.trim().to_owned();
                chat.draft.clear();
                chat.active = false;

                if message.is_empty() {
                    continue;
                }

                if network
                    .outbound
                    .send(ClientMessage::Say { text: message })
                    .is_err()
                {
                    game_state.push_system_message("The game connection is offline.");
                }
            }
            KeyCode::Escape if chat.active => {
                chat.draft.clear();
                chat.active = false;
            }
            KeyCode::Backspace if chat.active => {
                chat.draft.pop();
            }
            _ if chat.active => {
                let Some(input) = event.text.as_ref() else {
                    continue;
                };

                for character in input.chars() {
                    if !character.is_control()
                        && chat.draft.chars().count() < 180
                    {
                        chat.draft.push(character);
                    }
                }
            }
            _ => {}
        }
    }
}


pub fn handle_panel_hotkeys(
    keys: Res<ButtonInput<KeyCode>>,
    mut inventory_keyboard: MessageReader<KeyboardInput>,
    chat: Res<NativeChatState>,
    network: Res<NativeNetwork>,
    mut panels: ResMut<NativePanelState>,
    mut game_state: ResMut<NativeGameState>,
) {
    // TIBIAGAME_V36_34_INVENTORY_SEARCH_INPUT
    if chat.active {
        for _ in inventory_keyboard.read() {}
        return;
    }

    if panels.inventory_open && panels.inventory_search_active {
        let mut search_changed = false;

        for event in inventory_keyboard.read() {
            if event.state != ButtonState::Pressed {
                continue;
            }

            match event.key_code {
                KeyCode::Enter => {
                    panels.inventory_search_active = false;
                }
                KeyCode::Escape => {
                    panels.inventory_search_active = false;
                }
                KeyCode::Backspace => {
                    search_changed |= panels.inventory_search.pop().is_some();
                }
                _ => {
                    let Some(input) = event.text.as_ref() else {
                        continue;
                    };

                    for character in input.chars() {
                        if !character.is_control()
                            && panels.inventory_search.chars().count() < 48
                        {
                            panels.inventory_search.push(character);
                            search_changed = true;
                        }
                    }
                }
            }
        }

        if search_changed {
            panels.selected_item = None;
        }

        ensure_inventory_selection(&game_state, &mut panels);
        return;
    }

    // This MessageReader is independent from chat's reader. Drain it while
    // inventory search is inactive so activating search cannot replay old text.
    for _ in inventory_keyboard.read() {}

    if keys.just_pressed(KeyCode::KeyN) {
        toggle_nearest_npc_panel(&mut game_state, &mut panels);
    }

    if panels.npc_open {
        if keys.just_pressed(KeyCode::Escape) {
            panels.npc_open = false;
            panels.selected_npc_id = None;
            return;
        }

        if keys.just_pressed(KeyCode::Tab) {
            cycle_npc_tab(&game_state, &mut panels);
        }
        if keys.just_pressed(KeyCode::ArrowDown) {
            step_npc_selection(&game_state, &mut panels, 1);
        }
        if keys.just_pressed(KeyCode::ArrowUp) {
            step_npc_selection(&game_state, &mut panels, -1);
        }
        if keys.just_pressed(KeyCode::KeyF) {
            npc_primary_action(&network, &mut game_state, &panels);
        }
        if keys.just_pressed(KeyCode::KeyV) {
            npc_sell_selected_item(&network, &mut game_state, &panels);
        }
        if keys.just_pressed(KeyCode::KeyO) {
            npc_deposit_selected_item(&network, &mut game_state, &panels);
        }

        // NPC interaction owns the keyboard until the panel is closed.
        return;
    }

    // TIBIAGAME_V36_34_SPLIT_MODE
    if panels.inventory_open {
        if let Some(split_id) = panels.split_item_id {
            let selected_stack = game_state
                .inventory
                .iter()
                .find(|item| item.instance_id == split_id)
                .cloned();

            let Some(item) = selected_stack else {
                panels.split_item_id = None;
                panels.split_quantity = 0;
                return;
            };

            let max_split = item.quantity.saturating_sub(1);
            if max_split == 0 {
                panels.split_item_id = None;
                panels.split_quantity = 0;
                return;
            }

            panels.split_quantity =
                panels.split_quantity.clamp(1, max_split);

            if keys.just_pressed(KeyCode::ArrowLeft) {
                panels.split_quantity =
                    panels.split_quantity.saturating_sub(1).max(1);
            }

            if keys.just_pressed(KeyCode::ArrowRight) {
                panels.split_quantity =
                    panels.split_quantity.saturating_add(1).min(max_split);
            }

            if keys.just_pressed(KeyCode::Escape)
                || keys.just_pressed(KeyCode::F6)
            {
                panels.split_item_id = None;
                panels.split_quantity = 0;
                return;
            }

            if keys.just_pressed(KeyCode::Enter) {
                let quantity = panels.split_quantity;

                let item_name = game_state
                    .item_definitions
                    .get(&item.definition_id)
                    .map(|definition| definition.name.clone())
                    .unwrap_or_else(|| item.definition_id.clone());

                if network
                    .outbound
                    .send(ClientMessage::SplitItem {
                        instance_id: split_id,
                        quantity,
                    })
                    .is_err()
                {
                    game_state.push_system_message(
                        "The game connection is offline.",
                    );
                } else {
                    game_state.push_system_message(format!(
                        "Split {quantity} from {item_name}.",
                    ));
                }

                panels.split_item_id = None;
                panels.split_quantity = 0;
                return;
            }

            // Split mode owns inventory input until confirmed/cancelled.
            return;
        }
    }

    if keys.just_pressed(KeyCode::KeyI) {
        panels.inventory_open = !panels.inventory_open;
        panels.npc_open = false;
        panels.split_item_id = None;
        panels.split_quantity = 0;
        if panels.inventory_open {
            ensure_inventory_selection(&game_state, &mut panels);
        }
    }

    if keys.just_pressed(KeyCode::KeyC) {
        panels.character_open = !panels.character_open;
        panels.npc_open = false;
    }

    if keys.just_pressed(KeyCode::KeyK) {
        panels.skills_open = !panels.skills_open;
        panels.npc_open = false;
    }

    if keys.just_pressed(KeyCode::KeyP) {
        panels.spells_open = !panels.spells_open;
        panels.npc_open = false;
        if panels.spells_open {
            panels.crafting_open = false;
            ensure_spell_selection(&game_state, &mut panels);
        }
    }

    if keys.just_pressed(KeyCode::KeyB) {
        panels.crafting_open = !panels.crafting_open;
        panels.npc_open = false;
        if panels.crafting_open {
            panels.spells_open = false;
            panels.crafting_quantity = panels.crafting_quantity.max(1);
            normalize_crafting_category(&game_state, &mut panels);
            ensure_recipe_selection(&game_state, &mut panels);
        }
    }

    if keys.just_pressed(KeyCode::Escape)
        && (
            panels.inventory_open
                || panels.character_open
                || panels.skills_open
                || panels.spells_open
                || panels.crafting_open
        )
    {
        panels.inventory_open = false;
        panels.inventory_search_active = false;
        panels.split_item_id = None;
        panels.split_quantity = 0;
        panels.character_open = false;
        panels.skills_open = false;
        panels.spells_open = false;
        panels.crafting_open = false;
        panels.npc_open = false;
        panels.selected_npc_id = None;
        return;
    }

    if panels.spells_open {
        ensure_spell_selection(&game_state, &mut panels);

        if keys.just_pressed(KeyCode::ArrowDown) {
            step_spell_selection(&game_state, &mut panels, 1);
        }
        if keys.just_pressed(KeyCode::ArrowUp) {
            step_spell_selection(&game_state, &mut panels, -1);
        }

        if keys.just_pressed(KeyCode::KeyF) {
            cast_selected_spell(
                &network,
                &mut game_state,
                &panels,
            );
        }
    }

    if panels.crafting_open {
        normalize_crafting_category(&game_state, &mut panels);
        ensure_recipe_selection(&game_state, &mut panels);
        panels.crafting_quantity = panels.crafting_quantity.max(1);

        if keys.just_pressed(KeyCode::Tab) {
            cycle_crafting_category(&game_state, &mut panels);
            ensure_recipe_selection(&game_state, &mut panels);
        }

        if keys.just_pressed(KeyCode::ArrowDown) {
            step_recipe_selection(&game_state, &mut panels, 1);
        }
        if keys.just_pressed(KeyCode::ArrowUp) {
            step_recipe_selection(&game_state, &mut panels, -1);
        }

        if keys.just_pressed(KeyCode::ArrowLeft) {
            panels.crafting_quantity =
                panels.crafting_quantity.saturating_sub(1).max(1);
        }
        if keys.just_pressed(KeyCode::ArrowRight) {
            panels.crafting_quantity =
                panels.crafting_quantity.saturating_add(1).min(99);
        }

        if keys.just_pressed(KeyCode::KeyF) {
            craft_selected_recipe(
                &network,
                &mut game_state,
                &panels,
            );
        }

        if keys.just_pressed(KeyCode::KeyX) {
            if network
                .outbound
                .send(ClientMessage::CancelRuneCrafting)
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message("Cancel crafting requested.");
            }
        }

        // Crafting owns arrows/Tab/F/X while open.
        return;
    }
    if !panels.inventory_open {
        return;
    }

    if keys.just_pressed(KeyCode::Slash) {
        panels.inventory_search_active = true;
        return;
    }

    if keys.just_pressed(KeyCode::Backspace) {
        if let Some(container_id) = panels.inventory_container_id {
            panels.inventory_container_id = game_state
                .inventory
                .iter()
                .find(|item| item.instance_id == container_id)
                .and_then(|container| container.container_id);
            panels.selected_item = None;
            ensure_inventory_selection(&game_state, &mut panels);
            return;
        }
    }

    ensure_inventory_selection(&game_state, &mut panels);

    if keys.just_pressed(KeyCode::ArrowDown) {
        step_inventory_selection(&game_state, &mut panels, 1);
    }
    if keys.just_pressed(KeyCode::ArrowUp) {
        step_inventory_selection(&game_state, &mut panels, -1);
    }

    let Some(instance_id) = panels.selected_item else {
        return;
    };

    if keys.just_pressed(KeyCode::Enter) {
        let selected = game_state
            .inventory
            .iter()
            .find(|item| item.instance_id == instance_id)
            .cloned();

        if let Some(item) = selected {
            let is_container = game_state
                .item_definitions
                .get(&item.definition_id)
                .and_then(|definition| definition.container_slots)
                .is_some();

            if is_container {
                panels.inventory_container_id = Some(instance_id);
                panels.selected_item = None;
                ensure_inventory_selection(&game_state, &mut panels);
                return;
            }
        }
    }

    if keys.just_pressed(KeyCode::F6) {
        let selected = game_state
            .inventory
            .iter()
            .find(|item| item.instance_id == instance_id)
            .cloned();

        let Some(item) = selected else {
            panels.selected_item = None;
            return;
        };

        let stackable = game_state
            .item_definitions
            .get(&item.definition_id)
            .map(|definition| definition.stackable)
            .unwrap_or(false);

        if !stackable || item.quantity <= 1 {
            let item_name = game_state
                .item_definitions
                .get(&item.definition_id)
                .map(|definition| definition.name.clone())
                .unwrap_or_else(|| item.definition_id.clone());

            game_state.push_system_message(format!(
                "{item_name} cannot be split.",
            ));
            return;
        }

        panels.split_item_id = Some(instance_id);
        panels.split_quantity = (item.quantity / 2).max(1);
        return;
    }

    if keys.just_pressed(KeyCode::KeyE) {
        let Some(item) = game_state
            .inventory
            .iter()
            .find(|item| item.instance_id == instance_id)
            .cloned()
        else {
            panels.selected_item = None;
            return;
        };

        if item.equipped_slot.is_some() {
            send_move_item(
                &network,
                &mut game_state,
                instance_id,
                game_protocol::ItemDestination::Root,
                "Unequip",
            );
            return;
        }

        let Some(definition) = game_state.item_definitions.get(&item.definition_id)
        else {
            game_state.push_system_message("Unknown item definition.");
            return;
        };

        // End the immutable ItemDefinition borrow before mutating NativeGameState.
        // Both values are owned from this point onward.
        let item_name = definition.name.clone();
        let equipment_slot = definition.equipment_slot.clone();

        let Some(slot) = equipment_slot else {
            game_state.push_system_message(format!(
                "{} cannot be equipped.",
                item_name,
            ));
            return;
        };
        if network
            .outbound
            .send(ClientMessage::MoveItem {
                instance_id,
                destination: game_protocol::ItemDestination::Equipment {
                    slot,
                },
            })
            .is_err()
        {
            game_state.push_system_message("The game connection is offline.");
        } else {
            game_state.push_system_message(format!("Equip {item_name}."));
        }
    }

    if keys.just_pressed(KeyCode::KeyR) {
        send_move_item(
            &network,
            &mut game_state,
            instance_id,
            game_protocol::ItemDestination::Root,
            "Move to root",
        );
    }

    if keys.just_pressed(KeyCode::Delete) {
        let item_name = item_display_name(&game_state, instance_id)
            .unwrap_or_else(|| "item".into());

        if network
            .outbound
            .send(ClientMessage::DropItem { instance_id })
            .is_err()
        {
            game_state.push_system_message("The game connection is offline.");
        } else {
            game_state.push_system_message(format!("Drop {item_name}."));
        }
    }
}

fn send_move_item(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    instance_id: game_types::EntityId,
    destination: game_protocol::ItemDestination,
    verb: &str,
) {
    let item_name = item_display_name(game_state, instance_id)
        .unwrap_or_else(|| "item".into());

    if network
        .outbound
        .send(ClientMessage::MoveItem {
            instance_id,
            destination,
        })
        .is_err()
    {
        game_state.push_system_message("The game connection is offline.");
    } else {
        game_state.push_system_message(format!("{verb} {item_name}."));
    }
}

fn ensure_inventory_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let ids = selectable_inventory_ids(game_state, panels);

    if ids.is_empty() {
        panels.selected_item = None;
        return;
    }

    if panels
        .selected_item
        .is_some_and(|selected| ids.contains(&selected))
    {
        return;
    }

    panels.selected_item = ids.first().copied();
}

fn step_inventory_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
    delta: isize,
) {
    let ids = selectable_inventory_ids(game_state, panels);

    if ids.is_empty() {
        panels.selected_item = None;
        return;
    }

    let current = panels
        .selected_item
        .and_then(|selected| {
            ids.iter()
                .position(|id| *id == selected)
        })
        .unwrap_or(0) as isize;

    let len = ids.len() as isize;
    let next =
        (current + delta).rem_euclid(len) as usize;

    panels.selected_item = Some(ids[next]);
}

fn selectable_inventory_ids(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Vec<game_types::EntityId> {
    let query =
        panels.inventory_search.trim().to_ascii_lowercase();

    let mut items: Vec<_> = game_state
        .inventory
        .iter()
        .filter(|item| item.definition_id != "gold_coin")
        .filter(|item| {
            if let Some(container_id) =
                panels.inventory_container_id
            {
                item.container_id == Some(container_id)
            } else {
                item.container_id.is_none()
            }
        })
        .filter(|item| {
            if query.is_empty() {
                return true;
            }

            let name = game_state
                .item_definitions
                .get(&item.definition_id)
                .map(|definition| definition.name.as_str())
                .unwrap_or(item.definition_id.as_str());

            name.to_ascii_lowercase().contains(&query)
                || item
                    .definition_id
                    .to_ascii_lowercase()
                    .contains(&query)
        })
        .collect();

    items.sort_by(|left, right| {
        let left_name = game_state
            .item_definitions
            .get(&left.definition_id)
            .map(|definition| definition.name.as_str())
            .unwrap_or(left.definition_id.as_str());

        let right_name = game_state
            .item_definitions
            .get(&right.definition_id)
            .map(|definition| definition.name.as_str())
            .unwrap_or(right.definition_id.as_str());

        left
            .equipped_slot
            .is_none()
            .cmp(&right.equipped_slot.is_none())
            .then_with(|| left_name.cmp(right_name))
    });

    items
        .into_iter()
        .map(|item| item.instance_id)
        .collect()
}


#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeNpcTab {
    Shop,
    Spells,
    Recipes,
    Depot,
}

fn toggle_nearest_npc_panel(
    game_state: &mut NativeGameState,
    panels: &mut NativePanelState,
) {
    if panels.npc_open {
        panels.npc_open = false;
        panels.selected_npc_id = None;
        return;
    }

    let Some(player) = game_state.local_player() else {
        game_state.push_system_message("Local player state is unavailable.");
        return;
    };
    let origin = player.position;

    let nearest = game_state
        .npcs
        .values()
        .filter(|npc| npc.position.z == origin.z)
        .map(|npc| {
            let dx = (npc.position.x - origin.x).abs();
            let dy = (npc.position.y - origin.y).abs();
            (dx.max(dy), npc.id.clone(), npc.name.clone())
        })
        .filter(|(distance, _, _)| *distance <= 2)
        .min_by_key(|(distance, _, _)| *distance);

    let Some((_distance, npc_id, npc_name)) = nearest else {
        game_state.push_system_message("No NPC is close enough.");
        return;
    };

    panels.inventory_open = false;
    panels.character_open = false;
    panels.skills_open = false;
    panels.spells_open = false;
    panels.crafting_open = false;
    panels.npc_open = true;
    panels.selected_npc_id = Some(npc_id);
    panels.npc_index = 0;
    panels.npc_tab = 0;
    normalize_npc_tab(game_state, panels);

    game_state.push_system_message(format!("Talking to {npc_name}."));
}

fn npc_tabs(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Vec<NativeNpcTab> {
    let Some(npc) = selected_npc(game_state, panels) else {
        return Vec::new();
    };

    let mut tabs = Vec::new();
    if !npc.offers.is_empty() {
        tabs.push(NativeNpcTab::Shop);
    }
    if !npc.spell_ids.is_empty() {
        tabs.push(NativeNpcTab::Spells);
    }
    if !npc.recipe_ids.is_empty() {
        tabs.push(NativeNpcTab::Recipes);
    }

    let service = npc.service.to_ascii_lowercase();
    if service.contains("depot")
        || service.contains("bank")
        || service.contains("storage")
        || !game_state.depot.is_empty()
    {
        tabs.push(NativeNpcTab::Depot);
    }

    tabs
}

fn normalize_npc_tab(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let tabs = npc_tabs(game_state, panels);
    if tabs.is_empty() {
        panels.npc_tab = 0;
        panels.npc_index = 0;
        return;
    }

    panels.npc_tab %= tabs.len();
    let count = npc_tab_len(game_state, panels, tabs[panels.npc_tab]);
    panels.npc_index = if count == 0 {
        0
    } else {
        panels.npc_index.min(count - 1)
    };
}

fn cycle_npc_tab(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let tabs = npc_tabs(game_state, panels);
    if tabs.is_empty() {
        panels.npc_tab = 0;
        panels.npc_index = 0;
        return;
    }

    panels.npc_tab = (panels.npc_tab + 1) % tabs.len();
    panels.npc_index = 0;
}

fn step_npc_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
    delta: isize,
) {
    let tabs = npc_tabs(game_state, panels);
    if tabs.is_empty() {
        panels.npc_index = 0;
        return;
    }

    let tab = tabs[panels.npc_tab.min(tabs.len() - 1)];
    let count = npc_tab_len(game_state, panels, tab);
    if count == 0 {
        panels.npc_index = 0;
        return;
    }

    panels.npc_index =
        (panels.npc_index as isize + delta).rem_euclid(count as isize) as usize;
}

fn npc_tab_len(
    game_state: &NativeGameState,
    panels: &NativePanelState,
    tab: NativeNpcTab,
) -> usize {
    let Some(npc) = selected_npc(game_state, panels) else {
        return 0;
    };

    match tab {
        NativeNpcTab::Shop => npc.offers.len(),
        NativeNpcTab::Spells => npc.spell_ids.len(),
        NativeNpcTab::Recipes => npc.recipe_ids.len(),
        NativeNpcTab::Depot => game_state.depot.len(),
    }
}

fn selected_npc<'a>(
    game_state: &'a NativeGameState,
    panels: &NativePanelState,
) -> Option<&'a game_types::NpcView> {
    let npc_id = panels.selected_npc_id.as_deref()?;
    game_state.npcs.get(npc_id)
}

fn current_npc_tab(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Option<NativeNpcTab> {
    let tabs = npc_tabs(game_state, panels);
    tabs.get(panels.npc_tab.min(tabs.len().saturating_sub(1)))
        .copied()
}

fn npc_primary_action(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(npc) = selected_npc(game_state, panels).cloned() else {
        game_state.push_system_message("NPC is no longer available.");
        return;
    };
    let Some(tab) = current_npc_tab(game_state, panels) else {
        game_state.push_system_message("This NPC has no available service.");
        return;
    };

    match tab {
        NativeNpcTab::Shop => {
            let Some(offer) = npc.offers.get(panels.npc_index) else {
                return;
            };
            let offer_id = offer.id.clone();
            let item_name = game_state
                .item_definitions
                .get(&offer.item_definition_id)
                .map(|definition| definition.name.clone())
                .unwrap_or_else(|| offer.item_definition_id.clone());

            if network
                .outbound
                .send(ClientMessage::BuyFromNpc {
                    npc_id: npc.id.clone(),
                    offer_id,
                    quantity: 1,
                })
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message(format!("Buy {item_name}."));
            }
        }
        NativeNpcTab::Spells => {
            let Some(spell_id) = npc.spell_ids.get(panels.npc_index).cloned() else {
                return;
            };

            if game_state.learned_spell_ids.contains(&spell_id) {
                game_state.push_system_message("That spell is already learned.");
                return;
            }

            let spell_name = game_state
                .spells
                .get(&spell_id)
                .map(|spell| spell.name.clone())
                .unwrap_or_else(|| spell_id.clone());

            if network
                .outbound
                .send(ClientMessage::LearnSpell {
                    npc_id: npc.id.clone(),
                    spell_id,
                })
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message(format!("Learn {spell_name}."));
            }
        }
        NativeNpcTab::Recipes => {
            let Some(recipe_id) = npc.recipe_ids.get(panels.npc_index).cloned() else {
                return;
            };

            if game_state.learned_recipe_ids.contains(&recipe_id) {
                game_state.push_system_message("That recipe is already learned.");
                return;
            }

            let recipe_name = game_state
                .rune_recipes
                .get(&recipe_id)
                .map(|recipe| recipe.name.clone())
                .unwrap_or_else(|| recipe_id.clone());

            if network
                .outbound
                .send(ClientMessage::LearnRecipeFromNpc {
                    npc_id: npc.id.clone(),
                    recipe_id,
                })
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message(format!("Learn {recipe_name}."));
            }
        }
        NativeNpcTab::Depot => {
            let Some(item) = game_state.depot.get(panels.npc_index).cloned() else {
                return;
            };
            let item_name = game_state
                .item_definitions
                .get(&item.definition_id)
                .map(|definition| definition.name.clone())
                .unwrap_or_else(|| item.definition_id.clone());

            if network
                .outbound
                .send(ClientMessage::WithdrawItem {
                    npc_id: npc.id.clone(),
                    instance_id: item.instance_id,
                    quantity: 1,
                })
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message(format!("Withdraw {item_name}."));
            }
        }
    }
}

fn npc_sell_selected_item(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(npc) = selected_npc(game_state, panels).cloned() else {
        return;
    };
    let Some(instance_id) = panels.selected_item else {
        game_state.push_system_message(
            "Open inventory first and select an item to choose what to sell.",
        );
        return;
    };
    let Some(item) = game_state
        .inventory
        .iter()
        .find(|item| item.instance_id == instance_id)
        .cloned()
    else {
        game_state.push_system_message("Selected inventory item is unavailable.");
        return;
    };

    if item.equipped_slot.is_some() {
        game_state.push_system_message("Unequip the item before selling it.");
        return;
    }

    let item_name = game_state
        .item_definitions
        .get(&item.definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| item.definition_id.clone());

    if network
        .outbound
        .send(ClientMessage::SellToNpc {
            npc_id: npc.id,
            instance_id,
            quantity: 1,
        })
        .is_err()
    {
        game_state.push_system_message("The game connection is offline.");
    } else {
        game_state.push_system_message(format!("Sell one {item_name}."));
    }
}

fn npc_deposit_selected_item(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(npc) = selected_npc(game_state, panels).cloned() else {
        return;
    };
    let Some(instance_id) = panels.selected_item else {
        game_state.push_system_message(
            "Open inventory first and select an item to choose what to deposit.",
        );
        return;
    };
    let Some(item) = game_state
        .inventory
        .iter()
        .find(|item| item.instance_id == instance_id)
        .cloned()
    else {
        game_state.push_system_message("Selected inventory item is unavailable.");
        return;
    };

    if item.equipped_slot.is_some() {
        game_state.push_system_message("Unequip the item before depositing it.");
        return;
    }

    let item_name = game_state
        .item_definitions
        .get(&item.definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| item.definition_id.clone());

    if network
        .outbound
        .send(ClientMessage::DepositItem {
            npc_id: npc.id,
            instance_id,
        })
        .is_err()
    {
        game_state.push_system_message("The game connection is offline.");
    } else {
        game_state.push_system_message(format!("Deposit {item_name}."));
    }
}

fn npc_panel_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let Some(npc) = selected_npc(game_state, panels) else {
        return "NPC\nNo NPC selected.".into();
    };

    let tabs = npc_tabs(game_state, panels);
    let current_tab = current_npc_tab(game_state, panels);
    let tab_names = tabs
        .iter()
        .map(|tab| match tab {
            NativeNpcTab::Shop => "Shop",
            NativeNpcTab::Spells => "Spells",
            NativeNpcTab::Recipes => "Recipes",
            NativeNpcTab::Depot => "Depot",
        })
        .collect::<Vec<_>>()
        .join("  ·  ");

    let mut lines = vec![
        format!("{}   ·   {}", npc.name, npc.title),
        format!("Service: {}", npc.service),
        npc.dialogue.clone(),
        String::new(),
        if tab_names.is_empty() {
            "No service tabs".into()
        } else {
            format!("Tabs: {tab_names}")
        },
        String::new(),
    ];

    match current_tab {
        Some(NativeNpcTab::Shop) => {
            lines.push("SHOP".into());
            for (index, offer) in npc.offers.iter().enumerate() {
                let name = game_state
                    .item_definitions
                    .get(&offer.item_definition_id)
                    .map(|definition| definition.name.as_str())
                    .unwrap_or(offer.item_definition_id.as_str());
                let marker = if index == panels.npc_index { "▶" } else { " " };
                lines.push(format!(
                    "{marker} {:<22} ×{}   {} gold",
                    name,
                    offer.quantity,
                    offer.price,
                ));
            }
        }
        Some(NativeNpcTab::Spells) => {
            lines.push("SPELL TRAINER".into());
            for (index, spell_id) in npc.spell_ids.iter().enumerate() {
                let marker = if index == panels.npc_index { "▶" } else { " " };
                let learned =
                    if game_state.learned_spell_ids.contains(spell_id) { "✓" } else { " " };
                if let Some(spell) = game_state.spells.get(spell_id) {
                    lines.push(format!(
                        "{marker} {learned} {:<20} ML {:>2}   {} gold",
                        spell.name,
                        spell.required_magic_level,
                        spell.price,
                    ));
                } else {
                    lines.push(format!("{marker} {learned} {spell_id}"));
                }
            }
        }
        Some(NativeNpcTab::Recipes) => {
            lines.push("RECIPE TRAINER".into());
            for (index, recipe_id) in npc.recipe_ids.iter().enumerate() {
                let marker = if index == panels.npc_index { "▶" } else { " " };
                let learned =
                    if game_state.learned_recipe_ids.contains(recipe_id) { "✓" } else { " " };
                if let Some(recipe) = game_state.rune_recipes.get(recipe_id) {
                    lines.push(format!(
                        "{marker} {learned} {:<21} skill {:>2}   {} gold",
                        recipe.name,
                        recipe.required_skill_level,
                        recipe.learn_price,
                    ));
                } else {
                    lines.push(format!("{marker} {learned} {recipe_id}"));
                }
            }
        }
        Some(NativeNpcTab::Depot) => {
            lines.push(format!("DEPOT   ·   {} stacks", game_state.depot.len()));
            if game_state.depot.is_empty() {
                lines.push("Depot is empty.".into());
            } else {
                for (index, item) in game_state.depot.iter().enumerate().take(18) {
                    let marker = if index == panels.npc_index { "▶" } else { " " };
                    let name = game_state
                        .item_definitions
                        .get(&item.definition_id)
                        .map(|definition| definition.name.as_str())
                        .unwrap_or(item.definition_id.as_str());
                    lines.push(format!(
                        "{marker} {:<24} ×{}",
                        name,
                        item.quantity,
                    ));
                }
            }
        }
        None => {
            lines.push("This NPC has dialogue only.".into());
        }
    }

    lines.push(String::new());
    lines.push("Tab Service   ·   ↑/↓ Select   ·   F Primary action".into());
    lines.push("V Sell selected inventory item   ·   O Deposit selected item".into());
    lines.push("N / Esc Close".into());
    lines.join("\n")
}

fn npc_detail_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let Some(npc) = selected_npc(game_state, panels) else {
        return String::new();
    };

    match current_npc_tab(game_state, panels) {
        Some(NativeNpcTab::Shop) => npc
            .offers
            .get(panels.npc_index)
            .map(|offer| {
                let definition = game_state.item_definitions.get(&offer.item_definition_id);
                let name = definition
                    .map(|definition| definition.name.clone())
                    .unwrap_or_else(|| offer.item_definition_id.clone());
                let weight = definition.map(|definition| definition.weight).unwrap_or(0.0);
                format!(
                    "{name}\nOffer quantity {}   ·   Price {} gold   ·   Unit weight {:.1}",
                    offer.quantity,
                    offer.price,
                    weight,
                )
            })
            .unwrap_or_default(),
        Some(NativeNpcTab::Spells) => npc
            .spell_ids
            .get(panels.npc_index)
            .and_then(|id| game_state.spells.get(id))
            .map(|spell| {
                format!(
                    "{}\n{}\nMana {}   ·   Damage {}   ·   Range {}   ·   Cooldown {:.2}s",
                    spell.name,
                    spell.description,
                    spell.mana_cost,
                    spell.damage,
                    spell.range,
                    spell.cooldown_ms as f32 / 1000.0,
                )
            })
            .unwrap_or_default(),
        Some(NativeNpcTab::Recipes) => npc
            .recipe_ids
            .get(panels.npc_index)
            .and_then(|id| game_state.rune_recipes.get(id))
            .map(|recipe| {
                format!(
                    "{}\n{}   ·   Mana {}   ·   Time {:.2}s   ·   Required skill {}",
                    recipe.name,
                    title_case(&recipe.craft_kind),
                    recipe.mana_cost,
                    recipe.craft_time_ms as f32 / 1000.0,
                    recipe.required_skill_level,
                )
            })
            .unwrap_or_default(),
        Some(NativeNpcTab::Depot) => game_state
            .depot
            .get(panels.npc_index)
            .map(|item| {
                let name = game_state
                    .item_definitions
                    .get(&item.definition_id)
                    .map(|definition| definition.name.clone())
                    .unwrap_or_else(|| item.definition_id.clone());
                format!(
                    "{name}\nQuantity {}   ·   F withdraw one",
                    item.quantity,
                )
            })
            .unwrap_or_default(),
        None => String::new(),
    }
}

fn crafting_categories(
    game_state: &NativeGameState,
) -> Vec<String> {
    let mut categories = vec!["all".to_owned()];

    let mut kinds: Vec<_> = game_state
        .rune_recipes
        .values()
        .map(|recipe| recipe.craft_kind.trim().to_ascii_lowercase())
        .filter(|kind| !kind.is_empty())
        .collect();

    kinds.sort();
    kinds.dedup();

    categories.extend(kinds);
    categories
}

fn normalize_crafting_category(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let categories = crafting_categories(game_state);

    if categories.is_empty() {
        panels.crafting_category = 0;
        return;
    }

    panels.crafting_category %= categories.len();
}

fn cycle_crafting_category(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let categories = crafting_categories(game_state);

    if categories.is_empty() {
        panels.crafting_category = 0;
        panels.selected_recipe_id = None;
        return;
    }

    panels.crafting_category =
        (panels.crafting_category + 1) % categories.len();
    panels.selected_recipe_id = None;
}

fn current_crafting_category<'a>(
    game_state: &'a NativeGameState,
    panels: &NativePanelState,
) -> String {
    let categories = crafting_categories(game_state);

    categories
        .get(panels.crafting_category.min(categories.len().saturating_sub(1)))
        .cloned()
        .unwrap_or_else(|| "all".into())
}

fn recipes_sorted(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Vec<(String, String)> {
    let category =
        current_crafting_category(game_state, panels);

    let mut recipes: Vec<_> = game_state
        .rune_recipes
        .values()
        .filter(|recipe| {
            category == "all"
                || recipe
                    .craft_kind
                    .trim()
                    .eq_ignore_ascii_case(&category)
        })
        .map(|recipe| {
            (recipe.id.clone(), recipe.name.clone())
        })
        .collect();

    recipes.sort_by(|left, right| left.1.cmp(&right.1));
    recipes
}

fn ensure_recipe_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let recipes = recipes_sorted(game_state, panels);

    if recipes.is_empty() {
        panels.selected_recipe_id = None;
        return;
    }

    if panels
        .selected_recipe_id
        .as_ref()
        .is_some_and(|selected| {
            recipes.iter().any(|(id, _)| id == selected)
        })
    {
        return;
    }

    let first_learned = recipes
        .iter()
        .find(|(id, _)| {
            game_state.learned_recipe_ids.contains(id)
        })
        .or_else(|| recipes.first());

    panels.selected_recipe_id =
        first_learned.map(|(id, _)| id.clone());
}

fn step_recipe_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
    delta: isize,
) {
    let recipes = recipes_sorted(game_state, panels);

    if recipes.is_empty() {
        panels.selected_recipe_id = None;
        return;
    }

    let current = panels
        .selected_recipe_id
        .as_ref()
        .and_then(|selected| {
            recipes
                .iter()
                .position(|(id, _)| id == selected)
        })
        .unwrap_or(0) as isize;

    let len = recipes.len() as isize;
    let next =
        (current + delta).rem_euclid(len) as usize;

    panels.selected_recipe_id =
        Some(recipes[next].0.clone());
}

fn craft_selected_recipe(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(recipe_id) =
        panels.selected_recipe_id.clone()
    else {
        game_state.push_system_message(
            "No recipe selected.",
        );
        return;
    };

    if !game_state
        .learned_recipe_ids
        .contains(&recipe_id)
    {
        game_state.push_system_message(
            "That recipe has not been learned.",
        );
        return;
    }

    let Some(recipe) =
        game_state.rune_recipes.get(&recipe_id)
    else {
        game_state.push_system_message(
            "Unknown recipe.",
        );
        return;
    };

    let quantity =
        panels.crafting_quantity.max(1);

    let recipe_name = recipe.name.clone();
    let input_definition_id =
        recipe.input_definition_id.clone();
    let input_quantity = recipe.input_quantity;
    let mana_cost = recipe.mana_cost;

    let required_items =
        u64::from(input_quantity)
            .saturating_mul(u64::from(quantity));

    let carried =
        inventory_definition_quantity(
            game_state,
            &input_definition_id,
        );

    if carried < required_items {
        game_state.push_system_message(format!(
            "Not enough materials for {quantity} × {recipe_name}.",
        ));
        return;
    }

    let required_mana =
        u64::from(mana_cost)
            .saturating_mul(u64::from(quantity));

    let mana = game_state
        .local_player()
        .map(|player| u64::from(player.mana))
        .unwrap_or(0);

    if mana < required_mana {
        game_state.push_system_message(format!(
            "Not enough mana for {quantity} × {recipe_name}.",
        ));
        return;
    }

    if network
        .outbound
        .send(ClientMessage::StartRuneCrafting {
            recipe_id,
            quantity,
        })
        .is_err()
    {
        game_state.push_system_message(
            "The game connection is offline.",
        );
    } else {
        game_state.push_system_message(format!(
            "Crafting {quantity} × {recipe_name}.",
        ));
    }
}

fn crafting_panel_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let categories =
        crafting_categories(game_state);
    let category =
        current_crafting_category(game_state, panels);

    let recipes =
        recipes_sorted(game_state, panels);

    let learned = game_state
        .rune_recipes
        .keys()
        .filter(|id| {
            game_state.learned_recipe_ids.contains(*id)
        })
        .count();

    let category_tabs = categories
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let label =
                if value == "all" {
                    "All".into()
                } else {
                    title_case(value)
                };

            if index == panels.crafting_category {
                format!("[{label}]")
            } else {
                label
            }
        })
        .collect::<Vec<_>>()
        .join("  ·  ");

    let mut lines = vec![
        format!(
            "CRAFTING   ·   Learned {} / {}",
            learned,
            game_state.rune_recipes.len(),
        ),
        format!("Categories: {category_tabs}"),
        format!(
            "Category: {}   ·   Quantity ×{}",
            if category == "all" {
                "All".into()
            } else {
                title_case(&category)
            },
            panels.crafting_quantity.max(1),
        ),
        String::new(),
    ];

    if recipes.is_empty() {
        lines.push(
            "No recipes in this category.".into(),
        );
    } else {
        for (id, name) in recipes {
            let Some(recipe) =
                game_state.rune_recipes.get(&id)
            else {
                continue;
            };

            let marker =
                if panels
                    .selected_recipe_id
                    .as_deref()
                    == Some(id.as_str())
                {
                    "▶"
                } else {
                    " "
                };

            let learned_marker =
                if game_state
                    .learned_recipe_ids
                    .contains(&id)
                {
                    "✓"
                } else {
                    "×"
                };

            let input_name = game_state
                .item_definitions
                .get(&recipe.input_definition_id)
                .map(|definition| {
                    definition.name.as_str()
                })
                .unwrap_or(
                    recipe.input_definition_id.as_str(),
                );

            let output_name = game_state
                .item_definitions
                .get(&recipe.output_definition_id)
                .map(|definition| {
                    definition.name.as_str()
                })
                .unwrap_or(
                    recipe.output_definition_id.as_str(),
                );

            lines.push(format!(
                "{marker} {learned_marker} {:<19}  {}× {} → {}× {}",
                name,
                recipe.input_quantity,
                input_name,
                recipe.output_quantity,
                output_name,
            ));
        }
    }

    if let Some(crafting) =
        game_state.crafting.as_ref()
    {
        lines.push(String::new());

        let recipe_name = crafting
            .recipe_id
            .as_ref()
            .and_then(|id| {
                game_state.rune_recipes.get(id)
            })
            .map(|recipe| recipe.name.clone())
            .unwrap_or_else(|| {
                crafting
                    .recipe_id
                    .clone()
                    .unwrap_or_else(|| "Crafting".into())
            });

        lines.push(format!(
            "ACTIVE: {}   ·   remaining {}   ·   {}",
            recipe_name,
            crafting.remaining,
            title_case(&crafting.status),
        ));
    }

    lines.push(String::new());
    lines.push(
        "Tab Category   ·   ↑/↓ Recipe   ·   ←/→ Quantity"
            .into(),
    );
    lines.push(
        "F Craft selected quantity   ·   X Cancel"
            .into(),
    );
    lines.push("B Crafting   ·   Esc Close".into());

    lines.join("\n")
}

fn crafting_detail_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let Some(recipe_id) =
        panels.selected_recipe_id.as_deref()
    else {
        return String::new();
    };

    let Some(recipe) =
        game_state.rune_recipes.get(recipe_id)
    else {
        return String::new();
    };

    let quantity =
        panels.crafting_quantity.max(1);

    let input_name = game_state
        .item_definitions
        .get(&recipe.input_definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| {
            recipe.input_definition_id.clone()
        });

    let output_name = game_state
        .item_definitions
        .get(&recipe.output_definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| {
            recipe.output_definition_id.clone()
        });

    let carried =
        inventory_definition_quantity(
            game_state,
            &recipe.input_definition_id,
        );

    let required_items =
        u64::from(recipe.input_quantity)
            .saturating_mul(u64::from(quantity));

    let required_mana =
        u64::from(recipe.mana_cost)
            .saturating_mul(u64::from(quantity));

    let total_output =
        u64::from(recipe.output_quantity)
            .saturating_mul(u64::from(quantity));

    let learned =
        game_state
            .learned_recipe_ids
            .contains(recipe_id);

    format!(
        "{}\n{}\nBatch ×{}\nInput: {} × {}   ·   carried {}   ·   required {}\nOutput total: {} × {}\nMana total {}   ·   time/craft {:.2}s   ·   required skill {}   ·   {}",
        recipe.name,
        title_case(&recipe.craft_kind),
        quantity,
        recipe.input_quantity,
        input_name,
        carried,
        required_items,
        total_output,
        output_name,
        required_mana,
        recipe.craft_time_ms as f32 / 1000.0,
        recipe.required_skill_level,
        if learned {
            "Learned"
        } else {
            "Not learned"
        },
    )
}

fn inventory_definition_quantity(
    game_state: &NativeGameState,
    definition_id: &str,
) -> u64 {
    game_state
        .inventory
        .iter()
        .filter(|item| item.definition_id == definition_id)
        .map(|item| u64::from(item.quantity))
        .sum()
}

fn skills_panel_text(game_state: &NativeGameState) -> String {
    let Some(player) = game_state.local_player() else {
        return "SKILLS\nNo local player.".into();
    };

    let mut lines = vec![
        format!("SKILLS   ·   {}", player.name),
        String::new(),
        "COMBAT".into(),
        format!("Melee       {:>3}   ·   {:>8} tries", player.sword_skill, player.sword_tries),
        format!("Distance    {:>3}   ·   {:>8} tries", player.distance_skill, player.distance_tries),
        format!("Shielding   {:>3}   ·   {:>8} tries", player.shielding_skill, player.shielding_tries),
        format!("Fletching   {:>3}   ·   {:>8} tries", player.fletching_skill, player.fletching_tries),
        format!("Magic       {:>3}   ·   {:>8} tries", player.magic_level, player.magic_tries),
        String::new(),
        "PROFESSIONS".into(),
    ];

    if player.secondary_skills.is_empty() {
        lines.push("No secondary professions selected.".into());
    } else {
        for skill_id in &player.secondary_skills {
            let skill = game_state.profession_skills.get(skill_id);
            let level = skill.map(|skill| skill.level).unwrap_or(0);
            let tries = skill.map(|skill| skill.tries).unwrap_or(0);
            let mastery = game_types::skill_mastery_cost(level);

            lines.push(format!(
                "{:<14} {:>3}   ·   {:>8} tries   ·   mastery {}",
                title_case(skill_id),
                level,
                tries,
                mastery,
            ));
        }
    }

    lines.push(String::new());
    lines.push("Mastery is free through 50 and increasingly costly above it.".into());
    lines.push("K Skills   ·   P Spellbook   ·   Esc Close".into());
    lines.join("\n")
}

fn learned_spells_sorted(
    game_state: &NativeGameState,
) -> Vec<(String, String)> {
    let mut spells: Vec<_> = game_state
        .learned_spell_ids
        .iter()
        .filter_map(|id| {
            game_state
                .spells
                .get(id)
                .map(|spell| (spell.id.clone(), spell.name.clone()))
        })
        .collect();

    spells.sort_by(|left, right| left.1.cmp(&right.1));
    spells
}

fn ensure_spell_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let spells = learned_spells_sorted(game_state);

    if spells.is_empty() {
        panels.selected_spell_id = None;
        return;
    }

    if panels
        .selected_spell_id
        .as_ref()
        .is_some_and(|selected| spells.iter().any(|(id, _)| id == selected))
    {
        return;
    }

    panels.selected_spell_id = Some(spells[0].0.clone());
}

fn step_spell_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
    delta: isize,
) {
    let spells = learned_spells_sorted(game_state);
    if spells.is_empty() {
        panels.selected_spell_id = None;
        return;
    }

    let current = panels
        .selected_spell_id
        .as_ref()
        .and_then(|selected| spells.iter().position(|(id, _)| id == selected))
        .unwrap_or(0) as isize;

    let len = spells.len() as isize;
    let next = (current + delta).rem_euclid(len) as usize;
    panels.selected_spell_id = Some(spells[next].0.clone());
}

fn cast_selected_spell(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(spell_id) = panels.selected_spell_id.clone() else {
        game_state.push_system_message("No learned spell selected.");
        return;
    };

    let Some(target_id) = game_state.attack_target_id else {
        game_state.push_system_message("Select a target first.");
        return;
    };

    let spell_name = game_state
        .spells
        .get(&spell_id)
        .map(|spell| spell.name.clone())
        .unwrap_or_else(|| spell_id.clone());

    if network
        .outbound
        .send(ClientMessage::CastSpell {
            spell_id,
            target_id,
        })
        .is_err()
    {
        game_state.push_system_message("The game connection is offline.");
    } else {
        game_state.push_system_message(format!("Casting {spell_name}."));
    }
}

fn spellbook_panel_text(
    game_state: &NativeGameState,
    selected_spell_id: Option<&str>,
) -> String {
    let Some(player) = game_state.local_player() else {
        return "SPELLBOOK\nNo local player.".into();
    };

    let learned = learned_spells_sorted(game_state);
    let mut all: Vec<_> = game_state.spells.values().collect();
    all.sort_by(|left, right| left.name.cmp(&right.name));

    let mut lines = vec![
        format!(
            "SPELLBOOK   ·   ML {}   ·   Mana {}/{}",
            player.magic_level,
            player.mana,
            player.max_mana,
        ),
        format!("Learned {} / {}", learned.len(), all.len()),
        String::new(),
        "LEARNED".into(),
    ];

    if learned.is_empty() {
        lines.push("No spells learned.".into());
    } else {
        for (id, name) in &learned {
            let marker = if selected_spell_id == Some(id.as_str()) {
                "▶"
            } else {
                " "
            };

            if let Some(spell) = game_state.spells.get(id) {
                lines.push(format!(
                    "{marker} {:<20} mana {:>3}   range {:>2}",
                    name,
                    spell.mana_cost,
                    spell.range,
                ));
            } else {
                lines.push(format!("{marker} {name}"));
            }
        }
    }

    let locked: Vec<_> = all
        .into_iter()
        .filter(|spell| !game_state.learned_spell_ids.contains(&spell.id))
        .collect();

    if !locked.is_empty() {
        lines.push(String::new());
        lines.push("NOT LEARNED".into());
        for spell in locked.into_iter().take(8) {
            lines.push(format!(
                "  {:<20} ML {:>2}   price {}",
                spell.name,
                spell.required_magic_level,
                spell.price,
            ));
        }
    }

    lines.push(String::new());
    lines.push("↑/↓ Select   ·   F Cast selected spell".into());
    lines.push("P Spellbook   ·   K Skills   ·   Esc Close".into());
    lines.join("\n")
}

fn spell_detail_text(
    game_state: &NativeGameState,
    selected_spell_id: Option<&str>,
) -> String {
    let Some(spell_id) = selected_spell_id else {
        return String::new();
    };
    let Some(spell) = game_state.spells.get(spell_id) else {
        return String::new();
    };

    format!(
        "{}\n{}\nMana {}   ·   Damage {}   ·   Range {}   ·   Cooldown {:.2}s   ·   Required ML {}",
        spell.name,
        spell.description,
        spell.mana_cost,
        spell.damage,
        spell.range,
        spell.cooldown_ms as f32 / 1000.0,
        spell.required_magic_level,
    )
}

fn inventory_panel_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let gold: u64 = game_state
        .inventory
        .iter()
        .filter(|item| item.definition_id == "gold_coin")
        .map(|item| u64::from(item.quantity))
        .sum();

    let items =
        selectable_inventory_ids(game_state, panels);

    let selected_index = panels
        .selected_item
        .and_then(|id| {
            items
                .iter()
                .position(|candidate| *candidate == id)
        })
        .unwrap_or(0);

    let location = panels
        .inventory_container_id
        .and_then(|container_id| {
            game_state
                .inventory
                .iter()
                .find(|item| {
                    item.instance_id == container_id
                })
        })
        .map(|container| {
            game_state
                .item_definitions
                .get(&container.definition_id)
                .map(|definition| definition.name.clone())
                .unwrap_or_else(|| {
                    container.definition_id.clone()
                })
        })
        .unwrap_or_else(|| "Root".into());

    let mut lines = vec![
        format!("INVENTORY   ·   {location}"),
        format!(
            "Gold {}   ·   {:.1}/{:.1} cap",
            gold,
            game_state.inventory_weight,
            game_state.max_capacity,
        ),
    ];

    if panels.inventory_search_active {
        lines.push(format!(
            "Search: {}_",
            panels.inventory_search,
        ));
    } else if panels.inventory_search.is_empty() {
        lines.push("/ Search".into());
    } else {
        lines.push(format!(
            "Filter: \"{}\"   ·   / edit",
            panels.inventory_search,
        ));
    }

    lines.push(String::new());

    if items.is_empty() {
        lines.push(
            if panels.inventory_search.is_empty() {
                "This container is empty.".into()
            } else {
                "No items match the filter.".into()
            },
        );
    } else {
        let start =
            selected_index.saturating_sub(7);
        let end =
            (start + 16).min(items.len());

        for instance_id in &items[start..end] {
            let Some(item) = game_state
                .inventory
                .iter()
                .find(|item| {
                    item.instance_id == *instance_id
                })
            else {
                continue;
            };

            let definition =
                game_state
                    .item_definitions
                    .get(&item.definition_id);

            let name = definition
                .map(|definition| {
                    definition.name.as_str()
                })
                .unwrap_or(
                    item.definition_id.as_str(),
                );

            let marker =
                if Some(*instance_id)
                    == panels.selected_item
                {
                    "▶"
                } else {
                    " "
                };

            let quantity =
                if item.quantity > 1 {
                    format!(" ×{}", item.quantity)
                } else {
                    String::new()
                };

            let location_marker =
                if let Some(slot) =
                    item.equipped_slot.as_deref()
                {
                    format!("  [{slot}]")
                } else if definition
                    .and_then(|definition| {
                        definition.container_slots
                    })
                    .is_some()
                {
                    "  [container]".into()
                } else {
                    String::new()
                };

            lines.push(format!(
                "{marker} {name}{quantity}{location_marker}"
            ));
        }
    }

    lines.push(String::new());

    if panels.split_item_id.is_some() {
        lines.push(
            "←/→ Split amount   ·   Enter Confirm   ·   F6/Esc Cancel"
                .into(),
        );
    } else {
        lines.push(
            "↑/↓ Select   ·   Enter Open container   ·   Backspace Parent"
                .into(),
        );
        lines.push(
            "E Equip/unequip   ·   R Root   ·   F6 Split   ·   Del Drop"
                .into(),
        );
    }

    lines.join("\n")
}

fn inventory_detail_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let Some(instance_id) =
        panels.selected_item
    else {
        return String::new();
    };

    let Some(item) = game_state
        .inventory
        .iter()
        .find(|item| {
            item.instance_id == instance_id
        })
    else {
        return String::new();
    };

    let Some(definition) =
        game_state
            .item_definitions
            .get(&item.definition_id)
    else {
        return item.definition_id.clone();
    };

    let mut facts = Vec::new();

    facts.push(format!(
        "{}   ·   {:.1} wt",
        definition.name,
        definition.weight * f32::from(item.quantity),
    ));

    if let Some(attack) = definition.attack {
        facts.push(format!("Attack {attack}"));
    }

    if let Some(defense) = definition.defense {
        facts.push(format!("Defense {defense}"));
    }

    if let Some(charges) = item.charges {
        facts.push(format!("Charges {charges}"));
    }

    if let Some(slots) = definition.container_slots {
        facts.push(format!(
            "Container {slots} slots   ·   Enter open"
        ));
    }

    if let Some(slot) =
        definition.equipment_slot.as_deref()
    {
        facts.push(format!(
            "Equipment slot: {slot}"
        ));
    }

    if panels.split_item_id == Some(instance_id) {
        facts.push(format!(
            "SPLIT {} of {}",
            panels.split_quantity,
            item.quantity,
        ));
    }

    facts.join("   ·   ")
}

pub(crate) fn handle_character_modal_buttons(
    game_state: Res<NativeGameState>,
    mut panels: ResMut<NativePanelState>,
    mut buttons: Query<
        (
            &Interaction,
            &NativeCharacterModalAction,
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
                if !panels.character_open { continue; }

                match *action {
                    NativeCharacterModalAction::Inventory => {
                        panels.character_open = false;
                        panels.skills_open = false;
                        panels.inventory_open = true;
                        panels.npc_open = false;
                        panels.split_item_id = None;
                        panels.split_quantity = 0;
                        ensure_inventory_selection(&game_state, &mut panels);
                    }
                    NativeCharacterModalAction::Skills => {
                        panels.character_open = false;
                        panels.inventory_open = false;
                        panels.skills_open = true;
                        panels.npc_open = false;
                    }
                    NativeCharacterModalAction::Close => {
                        panels.character_open = false;
                    }
                }
            }
        }
    }
}

pub(crate) fn update_character_modal_ui(
    game_state: Res<NativeGameState>,
    panels: Res<NativePanelState>,
    mut text_queries: ParamSet<(
        Query<
            (
                &NativeCharacterModalText,
                &mut Text,
                &mut TextColor,
            ),
        >,
        Query<
            (
                &NativeCharacterEquipmentSlot,
                &mut Text,
                &mut TextColor,
            ),
        >,
        Query<
            (
                &NativeCharacterProfessionSlot,
                &mut Text,
                &mut TextColor,
            ),
        >,
    )>,
) {
    if !panels.character_open {
        return;
    }

    let Some(player) =
        game_state.local_player()
    else {
        for (_, mut text, mut color)
            in &mut text_queries.p0()
        {
            text.0 = "—".into();
            color.0 = MUTED;
        }

        for (_, mut text, mut color)
            in &mut text_queries.p1()
        {
            text.0 = "Empty".into();
            color.0 = MUTED;
        }

        for (_, mut text, mut color)
            in &mut text_queries.p2()
        {
            text.0 = "Empty".into();
            color.0 = MUTED;
        }

        return;
    };

    for (
        kind,
        mut text,
        mut color,
    ) in &mut text_queries.p0()
    {
        match kind {
            NativeCharacterModalText::HeaderContext => {
                text.0 = format!(
                    "{}:{}:{}",
                    player.position.x,
                    player.position.y,
                    player.position.z,
                );
                color.0 = theme::GOLD;
            }
            NativeCharacterModalText::Avatar => {
                text.0 = player
                    .name
                    .chars()
                    .next()
                    .map(|value| {
                        value
                            .to_uppercase()
                            .collect::<String>()
                    })
                    .unwrap_or_else(|| {
                        "A".into()
                    });
                color.0 =
                    Color::srgb(
                        0.10,
                        0.08,
                        0.04,
                    );
            }
            NativeCharacterModalText::Identity => {
                text.0 = format!(
                    "LEVEL {}\n{}",
                    player.level,
                    player.name.to_uppercase(),
                );
                color.0 = theme::GOLD_BRIGHT;
            }

            // These variants belonged to the first V36.49 generic Character
            // modal. Keep them valid during the migration even though the new
            // reference-faithful layout does not spawn them.
            NativeCharacterModalText::Health => {
                text.0 = format!(
                    "{} / {}",
                    player.health,
                    player.max_health,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Mana => {
                text.0 = format!(
                    "{} / {}",
                    player.mana,
                    player.max_mana,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Experience => {
                text.0 = experience_text(player);
                color.0 = TEXT;
            }
            NativeCharacterModalText::Capacity => {
                text.0 = format!(
                    "{:.1} / {:.1}",
                    game_state.inventory_weight,
                    game_state.max_capacity,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Melee => {
                text.0 = format!(
                    "{} | {} tries",
                    player.sword_skill,
                    player.sword_tries,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Distance => {
                text.0 = format!(
                    "{} | {} tries",
                    player.distance_skill,
                    player.distance_tries,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Shielding => {
                text.0 = format!(
                    "{} | {} tries",
                    player.shielding_skill,
                    player.shielding_tries,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Fletching => {
                text.0 = format!(
                    "{} | {} tries",
                    player.fletching_skill,
                    player.fletching_tries,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Magic => {
                text.0 = format!(
                    "{} | {} tries",
                    player.magic_level,
                    player.magic_tries,
                );
                color.0 = TEXT;
            }
            NativeCharacterModalText::Equipment => {
                text.0.clear();
                color.0 = TEXT;
            }
            NativeCharacterModalText::Professions => {
                text.0.clear();
                color.0 = TEXT;
            }
        }
    }

    for (
        slot,
        mut text,
        mut color,
    ) in &mut text_queries.p1()
    {
        if let Some(name) =
            character_equipment_slot_name(
                &game_state,
                *slot,
            )
        {
            text.0 = name;
            color.0 = theme::GOLD_BRIGHT;
        } else {
            text.0 = "Empty".into();
            color.0 = MUTED;
        }
    }

    for (
        slot,
        mut text,
        mut color,
    ) in &mut text_queries.p2()
    {
        if let Some(skill_id) =
            player.secondary_skills.get(slot.0)
        {
            let level = game_state
                .profession_skills
                .get(skill_id)
                .map(|skill| skill.level)
                .unwrap_or(0);

            text.0 = format!(
                "{}\nLv {}",
                title_case(skill_id),
                level,
            );
            color.0 = theme::GOLD_BRIGHT;
        } else {
            text.0 = "Empty".into();
            color.0 = MUTED;
        }
    }
}

fn character_equipment_slot_name(
    game_state: &NativeGameState,
    slot: NativeCharacterEquipmentSlot,
) -> Option<String> {
    let aliases: &[&str] =
        match slot {
            NativeCharacterEquipmentSlot::Helmet => {
                &["helmet", "head"]
            }
            NativeCharacterEquipmentSlot::Amulet => {
                &["amulet", "neck"]
            }
            NativeCharacterEquipmentSlot::Chest => {
                &["chest", "armor", "body"]
            }
            NativeCharacterEquipmentSlot::Back => {
                &["back", "cape"]
            }
            NativeCharacterEquipmentSlot::LeftHand => {
                &[
                    "left_hand",
                    "lefthand",
                    "off_hand",
                    "offhand",
                ]
            }
            NativeCharacterEquipmentSlot::RightHand => {
                &[
                    "right_hand",
                    "righthand",
                    "main_hand",
                    "mainhand",
                    "weapon",
                ]
            }
            NativeCharacterEquipmentSlot::Backpack => {
                &[
                    "backpack",
                    "bag",
                ]
            }
            NativeCharacterEquipmentSlot::Ring => {
                &["ring"]
            }
            NativeCharacterEquipmentSlot::Feet => {
                &[
                    "feet",
                    "boots",
                    "shoes",
                ]
            }
            NativeCharacterEquipmentSlot::Legs => {
                &[
                    "legs",
                    "pants",
                ]
            }
        };

    game_state
        .inventory
        .iter()
        .find(|item| {
            let Some(value) =
                item.equipped_slot.as_deref()
            else {
                return false;
            };

            aliases
                .iter()
                .any(|alias| {
                    value.eq_ignore_ascii_case(alias)
                })
        })
        .map(|item| {
            game_state
                .item_definitions
                .get(&item.definition_id)
                .map(|definition| {
                    definition.name.clone()
                })
                .unwrap_or_else(|| {
                    item.definition_id.clone()
                })
        })
}

fn character_equipment_summary(game_state: &NativeGameState) -> String {
    let mut equipped: Vec<_> = game_state.inventory.iter().filter_map(|item| {
        item.equipped_slot.as_deref().map(|slot| {
            let name = game_state.item_definitions
                .get(&item.definition_id)
                .map(|definition| definition.name.clone())
                .unwrap_or_else(|| item.definition_id.clone());
            (slot.to_owned(), name)
        })
    }).collect();

    equipped.sort_by(|a, b| a.0.cmp(&b.0));

    if equipped.is_empty() {
        return "No equipment currently equipped.".into();
    }

    equipped.into_iter().map(|(slot, name)| {
        format!("{:<13} {}", title_case(&slot.replace('_', " ")), name)
    }).collect::<Vec<_>>().join("\n")
}

fn character_professions_summary(game_state: &NativeGameState) -> String {
    let Some(player) = game_state.local_player() else {
        return "No professions selected.".into();
    };

    if player.secondary_skills.is_empty() {
        return "No secondary professions selected.".into();
    }

    player.secondary_skills.iter().map(|skill_id| {
        let skill = game_state.profession_skills.get(skill_id);
        let level = skill.map(|value| value.level).unwrap_or(0);
        let tries = skill.map(|value| value.tries).unwrap_or(0);
        format!("{}   Lv {}   |   {} tries", title_case(skill_id), level, tries)
    }).collect::<Vec<_>>().join("\n")
}

fn character_panel_text(game_state: &NativeGameState) -> String {
    let Some(player) = game_state.local_player() else {
        return "CHARACTER\nNo local player.".into();
    };

    let equipped_count = game_state
        .inventory
        .iter()
        .filter(|item| item.equipped_slot.is_some())
        .count();

    let mut lines = vec![
        format!("CHARACTER   ·   {}", player.name),
        format!(
            "Level {}   ·   {} XP",
            player.level,
            player.experience,
        ),
        format!(
            "HP {}/{}   ·   Mana {}/{}",
            player.health,
            player.max_health,
            player.mana,
            player.max_mana,
        ),
        format!(
            "Capacity {:.1}/{:.1}   ·   Equipped {}",
            game_state.inventory_weight,
            game_state.max_capacity,
            equipped_count,
        ),
        String::new(),
        "COMBAT SKILLS".into(),
        format!("Melee       {:>3}   ·   {} tries", player.sword_skill, player.sword_tries),
        format!("Distance    {:>3}   ·   {} tries", player.distance_skill, player.distance_tries),
        format!("Shielding   {:>3}   ·   {} tries", player.shielding_skill, player.shielding_tries),
        format!("Fletching   {:>3}   ·   {} tries", player.fletching_skill, player.fletching_tries),
        format!("Magic       {:>3}   ·   {} tries", player.magic_level, player.magic_tries),
        String::new(),
        "EQUIPMENT".into(),
    ];

    for (label, aliases) in [
        ("Helmet", &["helmet", "head"][..]),
        ("Chest", &["chest", "torso", "body"][..]),
        ("Back", &["back", "cape"][..]),
        ("Amulet", &["amulet", "neck"][..]),
        ("Left hand", &["left_hand", "offhand", "shield"][..]),
        ("Right hand", &["right_hand", "mainhand", "weapon"][..]),
        ("Legs", &["legs"][..]),
        ("Feet", &["boots", "feet"][..]),
        ("Ring", &["ring"][..]),
        ("Belt", &["belt"][..]),
        ("Backpack", &["backpack"][..]),
    ] {
        let item = game_state.inventory.iter().find(|item| {
            item.equipped_slot
                .as_deref()
                .is_some_and(|slot| aliases.contains(&slot))
        });

        let name = item
            .and_then(|item| game_state.item_definitions.get(&item.definition_id))
            .map(|definition| definition.name.as_str())
            .unwrap_or("—");

        lines.push(format!("{label:<11} {name}"));
    }

    if !player.secondary_skills.is_empty() {
        lines.push(String::new());
        lines.push("PROFESSIONS".into());
        for skill_id in &player.secondary_skills {
            let skill = game_state.profession_skills.get(skill_id);
            let level = skill.map(|skill| skill.level).unwrap_or(0);
            let tries = skill.map(|skill| skill.tries).unwrap_or(0);
            lines.push(format!(
                "{:<12} {:>3}   ·   {} tries",
                title_case(skill_id),
                level,
                tries,
            ));
        }
    }

    lines.push(String::new());
    lines.push("I Inventory   ·   C Character   ·   Esc Close".into());
    lines.join("\n")
}

fn item_display_name(
    game_state: &NativeGameState,
    instance_id: game_types::EntityId,
) -> Option<String> {
    let item = game_state
        .inventory
        .iter()
        .find(|item| item.instance_id == instance_id)?;

    Some(
        game_state
            .item_definitions
            .get(&item.definition_id)
            .map(|definition| definition.name.clone())
            .unwrap_or_else(|| item.definition_id.clone()),
    )
}

fn title_case(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut uppercase = true;

    for character in value.chars() {
        if character == '_' {
            result.push(' ');
            uppercase = true;
        } else if uppercase {
            result.extend(character.to_uppercase());
            uppercase = false;
        } else {
            result.push(character);
        }
    }

    result
}

pub fn handle_panel_close_buttons(
    mut buttons: Query<
        (
            &Interaction,
            &NativePanelCloseButton,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
    mut panels: ResMut<NativePanelState>,
) {
    for (interaction, action, mut background, mut border) in &mut buttons {
        match *interaction {
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                match action {
                    NativePanelCloseButton::Inventory => {
                        panels.inventory_open = false;
                        panels.inventory_search_active = false;
                        panels.split_item_id = None;
                        panels.split_quantity = 0;
                    }
                    NativePanelCloseButton::Character => {
                        panels.character_open = false;
                    }
                    NativePanelCloseButton::Skills => {
                        panels.skills_open = false;
                    }
                    NativePanelCloseButton::Spells => {
                        panels.spells_open = false;
                    }
                    NativePanelCloseButton::Crafting => {
                        panels.crafting_open = false;
                    }
                    NativePanelCloseButton::Npc => {
                        panels.npc_open = false;
                        panels.selected_npc_id = None;
                    }
                }
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
        }
    }
}

pub fn handle_panel_dock_buttons(
    mut buttons: Query<
        (
            &Interaction,
            &NativePanelDockButton,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
    mut panels: ResMut<NativePanelState>,
) {
    for (interaction, action, mut background, mut border) in &mut buttons {
        match *interaction {
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                let was_open = match action {
                    NativePanelDockButton::Character => {
                        panels.character_open
                    }
                    NativePanelDockButton::Inventory => {
                        panels.inventory_open
                    }
                    NativePanelDockButton::Skills => {
                        panels.skills_open
                    }
                    NativePanelDockButton::Spells => {
                        panels.spells_open
                    }
                    NativePanelDockButton::Crafting => {
                        panels.crafting_open
                    }
                };

                panels.inventory_open = false;
                panels.character_open = false;
                panels.skills_open = false;
                panels.spells_open = false;
                panels.crafting_open = false;
                panels.npc_open = false;
                panels.selected_npc_id = None;

                if !was_open {
                    match action {
                        NativePanelDockButton::Character => {
                            panels.character_open = true;
                        }
                        NativePanelDockButton::Inventory => {
                            panels.inventory_open = true;
                        }
                        NativePanelDockButton::Skills => {
                            panels.skills_open = true;
                        }
                        NativePanelDockButton::Spells => {
                            panels.spells_open = true;
                        }
                        NativePanelDockButton::Crafting => {
                            panels.crafting_open = true;
                            panels.crafting_quantity =
                                panels.crafting_quantity.max(1);
                        }
                    }
                }
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
        }
    }
}

pub fn handle_action_hotkeys(
    keys: Res<ButtonInput<KeyCode>>,
    chat: Res<NativeChatState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
) {
    if chat.active {
        return;
    }

    let slot = [
        KeyCode::Digit1,
        KeyCode::Digit2,
        KeyCode::Digit3,
        KeyCode::Digit4,
        KeyCode::Digit5,
        KeyCode::Digit6,
        KeyCode::Digit7,
        KeyCode::Digit8,
        KeyCode::Digit9,
    ]
    .into_iter()
    .position(|key| keys.just_pressed(key));

    let Some(slot) = slot else {
        return;
    };

    activate_action_slot(
        slot,
        &network,
        &mut game_state,
    );
}

pub fn handle_action_slot_buttons(
    chat: Res<NativeChatState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut buttons: Query<
        (
            &Interaction,
            &NativeActionSlot,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (interaction, slot, mut background, mut border) in &mut buttons {
        match *interaction {
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                if !chat.active {
                    activate_action_slot(
                        slot.0,
                        &network,
                        &mut game_state,
                    );
                }
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
        }
    }
}

fn activate_action_slot(
    slot: usize,
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
) {
    let Some(target_id) = game_state.attack_target_id else {
        game_state.push_system_message(
            "Select a target first.",
        );
        return;
    };

    if slot == 0 {
        if network
            .outbound
            .send(ClientMessage::AttackRequest { target_id })
            .is_err()
        {
            game_state.push_system_message(
                "The game connection is offline.",
            );
        }
        return;
    }

    let mut learned: Vec<_> = game_state
        .learned_spell_ids
        .iter()
        .filter_map(|id| game_state.spells.get(id))
        .collect();

    learned.sort_by(|a, b| a.name.cmp(&b.name));

    let spell_index = slot - 1;

    let Some(spell) = learned.get(spell_index) else {
        return;
    };

    let spell_id = spell.id.clone();
    let spell_name = spell.name.clone();

    if network
        .outbound
        .send(ClientMessage::CastSpell {
            spell_id,
            target_id,
        })
        .is_err()
    {
        game_state.push_system_message(
            "The game connection is offline.",
        );
    } else {
        game_state.push_system_message(format!(
            "Casting {spell_name}.",
        ));
    }
}

pub fn ping_server(
    time: Res<Time>,
    network: Res<NativeNetwork>,
    mut ping: ResMut<NativePingState>,
) {
    let now = time.elapsed_secs_f64();
    if now < ping.next_ping_at {
        return;
    }

    let sent_at = (now.max(0.0) * 1000.0) as u64;
    if network
        .outbound
        .send(ClientMessage::Ping { sent_at })
        .is_ok()
    {
        ping.next_ping_at = now + 1.0;
    } else {
        ping.next_ping_at = now + 2.0;
    }
}

fn action_bar_text(spells: &[&game_types::SpellDefinition]) -> String {
    let mut slots = vec!["[1] Attack".to_owned()];

    for (index, spell) in spells.iter().take(8).enumerate() {
        slots.push(format!("[{}] {}", index + 2, spell.name));
    }

    slots.join("    ")
}

fn experience_text(player: &game_types::PlayerView) -> String {
    let current_level = player.level.saturating_sub(1);
    let current_level_xp = u64::from(current_level).pow(2) * 100;
    let next_level_xp = u64::from(player.level).pow(2) * 100;
    let earned = player.experience.saturating_sub(current_level_xp);
    let needed = next_level_xp.saturating_sub(current_level_xp).max(1);
    let remaining = next_level_xp.saturating_sub(player.experience);

    format!(
        "XP   {} / {}   ·   {} to level {}",
        earned,
        needed,
        remaining,
        player.level + 1,
    )
}

fn experience_ratio(player: &game_types::PlayerView) -> f32 {
    let current_level = player.level.saturating_sub(1);
    let current_level_xp = u64::from(current_level).pow(2) * 100;
    let next_level_xp = u64::from(player.level).pow(2) * 100;
    let earned = player.experience.saturating_sub(current_level_xp);
    let needed = next_level_xp.saturating_sub(current_level_xp).max(1);

    ratio(earned as f32, needed as f32)
}

fn ratio(value: f32, max: f32) -> f32 {
    if !value.is_finite() || !max.is_finite() || max <= 0.0 {
        return 0.0;
    }

    (value / max).clamp(0.0, 1.0)
}

fn message_prefix(kind: NativeMessageKind) -> &'static str {
    match kind {
        NativeMessageKind::Chat => "[Say]",
        NativeMessageKind::System => "[System]",
        NativeMessageKind::Loot => "[Loot]",
        NativeMessageKind::Combat => "[Combat]",
        NativeMessageKind::Discovery => "[Discovery]",
        NativeMessageKind::Error => "[Error]",
    }
}
