#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.50.0";

const UI = "crates/game-client/src/native_ui.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [UI, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(
      `Run from tibiaCloneGame root after V36.49.1. Missing ${rel}`,
    );
  }
}

console.log(
  `Checking TibiaGame V${VERSION} React-faithful Character interface...`,
);

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);

  const target = path.join(ROOT, rel);
  const raw = fs.readFileSync(target, "utf8");

  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");

  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

function blockBounds(text, token) {
  const start = text.indexOf(token);

  if (start === -1) {
    throw new Error(
      `${token}: block not found. No files were written.`,
    );
  }

  const brace = text.indexOf("{", start);

  if (brace === -1) {
    throw new Error(
      `${token}: opening brace missing. No files were written.`,
    );
  }

  let depth = 0;

  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;

      if (depth === 0) {
        return [start, i + 1];
      }
    }
  }

  throw new Error(
    `${token}: closing brace missing. No files were written.`,
  );
}

function replaceBlock(text, token, value) {
  const [start, end] = blockBounds(text, token);

  return (
    text.slice(0, start)
    + value
    + text.slice(end)
  );
}

let ui = read(UI);

// ---------------------------------------------------------------------------
// V36.49.1 already introduced the first structured Character modal.
// V36.50 replaces that generic two-column stats modal with the visual hierarchy
// from the old React client: narrow left-side interface, avatar, paper-doll,
// equipment slots, profession slots and outfit strip.
// ---------------------------------------------------------------------------

// Extend the existing Character display enum with an avatar glyph.
if (!ui.includes(
  "NativeCharacterModalText::Avatar"
)) {
  const anchor =
`pub(crate) enum NativeCharacterModalText {
    HeaderContext,`;

  if (!ui.includes(anchor)) {
    throw new Error(
      "V36.49 Character modal text enum missing. No files were written.",
    );
  }

  ui = ui.replace(
    anchor,
`pub(crate) enum NativeCharacterModalText {
    HeaderContext,
    Avatar,`,
  );
}

// Add structured equipment/profession marker components.
if (!ui.includes(
  "pub(crate) enum NativeCharacterEquipmentSlot"
)) {
  const marker =
`#[derive(Component, Clone, Copy)]
pub(crate) enum NativeCharacterModalBar {`;

  const [start, end] =
    blockBounds(ui, marker);

  const additions = `

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
`;

  ui =
    ui.slice(0, end)
    + additions
    + ui.slice(end);
}

// New reference-faithful helper primitives.
if (!ui.includes(
  "fn character_reference_root_node("
)) {
  const anchor =
    "fn spawn_character_panel(";

  if (!ui.includes(anchor)) {
    throw new Error(
      "spawn_character_panel missing. No files were written.",
    );
  }

  const helpers =
`fn character_reference_root_node() -> Node {
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

`;

  ui = ui.replace(
    anchor,
    helpers + anchor,
  );
}

// ---------------------------------------------------------------------------
// Replace V36.49 generic Character modal with the old-client visual hierarchy.
// ---------------------------------------------------------------------------
const characterPanel =
`fn spawn_character_panel(commands: &mut Commands) {
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
}`;

// Character function must be the V36.49 structured modal, not the old text dump.
{
  const [start, end] =
    blockBounds(ui, "fn spawn_character_panel(");

  const current =
    ui.slice(start, end);

  if (
    !current.includes("Native modal · character")
    && !current.includes("Native gameplay HUD · character")
  ) {
    throw new Error(
      "Unexpected Character panel shape. No files were written.",
    );
  }

  ui =
    ui.slice(0, start)
    + characterPanel
    + ui.slice(end);
}

// ---------------------------------------------------------------------------
// Replace the updater. One ParamSet owns all mutable Text queries so we don't
// reintroduce Bevy B0001 while adding equipment and profession subviews.
// ---------------------------------------------------------------------------
const updateFn =
`pub(crate) fn update_character_modal_ui(
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
                    "LEVEL {}\\n{}",
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
                "{}\\nLv {}",
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
}`;

ui = replaceBlock(
  ui,
  "pub(crate) fn update_character_modal_ui(",
  updateFn,
);

save(UI, ui);

// ---------------------------------------------------------------------------
// Version.
// ---------------------------------------------------------------------------
let versionFile =
  read(VERSION_FILE);

if (
  versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.49.1";',
  )
) {
  versionFile =
    versionFile.replace(
      'pub const MIGRATION_VERSION: &str = "36.49.1";',
      'pub const MIGRATION_VERSION: &str = "36.50.0";',
    );
} else if (
  !versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.50.0";',
  )
) {
  throw new Error(
    `${VERSION_FILE} is not on V36.49.1. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

// ---------------------------------------------------------------------------
// Docs.
// ---------------------------------------------------------------------------
if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);

  const marker =
    "<!-- TIBIAGAME_V36_50_0_REACT_CHARACTER_REFERENCE -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.50.0 changes the Character migration strategy: the old React client is now
the visual source of truth rather than a generic native modal interpretation.

The in-game Character window now follows the Greyhaven reference:
- narrow left-side panel instead of a large centered stats window
- GREYHAVEN INTERFACE eyebrow + serif-style hierarchy
- circular character initial/avatar
- compact level/name identity card
- central paper-doll silhouette
- ten equipment slots arranged around the body
- live equipped item names per slot
- four profession slots driven by secondary_skills
- outfit preset strip matching the old visual hierarchy
- close button in the header

Combat skills and vitals remain available in the HUD/Skills interface rather
than being duplicated in Character, matching the old client separation.

The outfit strip is presentation-only until server appearance switching has a
protocol contract; no fake network action is introduced.

No server authority, loading/GPU gate, movement, floor-transition or creature
safety behavior changes.
`;

    save(DOC, doc);
  }
}

// ---------------------------------------------------------------------------
// Structural validation.
// ---------------------------------------------------------------------------
const finalUi = read(UI);
const finalVersion = read(VERSION_FILE);

const [charStart, charEnd] =
  blockBounds(
    finalUi,
    "fn spawn_character_panel(",
  );

const character =
  finalUi.slice(charStart, charEnd);

const [updateStart, updateEnd] =
  blockBounds(
    finalUi,
    "pub(crate) fn update_character_modal_ui(",
  );

const updater =
  finalUi.slice(updateStart, updateEnd);

const checks = [
  [
    character.includes(
      '"GREYHAVEN INTERFACE"'
    )
      && character.includes(
        '"CHARACTER"'
      ),
    "reference header missing",
  ],
  [
    character.includes(
      "spawn_character_paper_doll"
    ),
    "paper-doll silhouette missing",
  ],
  [
    character.includes(
      "NativeCharacterEquipmentSlot::Helmet"
    )
      && character.includes(
        "NativeCharacterEquipmentSlot::RightHand"
      )
      && character.includes(
        "NativeCharacterEquipmentSlot::Backpack"
      )
      && character.includes(
        "NativeCharacterEquipmentSlot::Legs"
      ),
    "equipment layout incomplete",
  ],
  [
    character.includes(
      '"PROFESSION SLOTS"'
    )
      && character.includes(
        "for index in 0..4usize"
      ),
    "profession slots missing",
  ],
  [
    character.includes(
      '"ARMORED"'
    )
      && character.includes(
        '"WAYFARER"'
      )
      && character.includes(
        '"MYSTIC"'
      )
      && character.includes(
        '"SHADOW"'
      ),
    "outfit strip missing",
  ],
  [
    updater.includes(
      "mut text_queries: ParamSet<("
    )
      && updater.includes(
        "text_queries.p0()"
      )
      && updater.includes(
        "text_queries.p1()"
      )
      && updater.includes(
        "text_queries.p2()"
      ),
    "B0001-safe text ParamSet missing",
  ],
  [
    finalUi.includes(
      "fn character_equipment_slot_name("
    ),
    "live equipment slot resolver missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.50.0";'
    ),
    "version is not V36.50.0",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(
      `Post-check failed: ${message}. No files were written.`,
    );
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- old React Character hierarchy is now the visual target");
  console.log("- narrow Greyhaven side panel");
  console.log("- paper doll + 10 equipment slots");
  console.log("- live profession slots + outfit strip");
  console.log("- ParamSet protects new Text queries from B0001");
  console.log("- no loading/gameplay/floor safety changes");
  process.exit(0);
}

// Write only after all checks pass.
for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);

  const original =
    fs.existsSync(target)
      ? fs.readFileSync(target, "utf8")
      : "";

  const eol =
    eols.get(rel) ?? "\n";

  const clean =
    normalized
      .replace(/[ \t]+$/gm, "")
      .replace(/\n+$/g, "\n");

  const output =
    eol === "\r\n"
      ? clean.replace(/\n/g, "\r\n")
      : clean;

  if (output !== original) {
    fs.writeFileSync(
      target,
      output,
      "utf8",
    );
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- React-faithful Greyhaven Character interface installed.");
