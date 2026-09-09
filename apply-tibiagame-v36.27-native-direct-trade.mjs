#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.27";

const MAIN = "crates/game-client/src/main.rs";
const TRADE_UI = "crates/game-client/src/native_trade_ui.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [MAIN, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.26.3. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} native direct-trade migration...`);

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

const tradeUiSource = `// TIBIAGAME_V36_27_NATIVE_DIRECT_TRADE
use bevy::prelude::*;
use game_protocol::ClientMessage;
use game_types::EntityId;

use crate::{
    native_map_ui::NativeMapUiState,
    native_ui::{NativeChatState, NativePanelState},
    state::{NativeGameState, NativeTradeState},
    NativeNetwork,
};

#[derive(Resource, Default)]
pub(crate) struct NativeTradeUiState {
    selected_index: usize,
    pub(crate) block_movement: bool,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeTradeText {
    Header,
    Body,
    Footer,
}

#[derive(Component)]
pub(crate) struct NativeTradePanel;

pub fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native direct trade"),
            NativeTradePanel,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(10.0),
                left: Val::Percent(50.0),
                width: px(720),
                min_height: px(560),
                max_height: Val::Percent(80.0),
                margin: UiRect::left(px(-360)),
                padding: UiRect::all(px(14)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgba(0.018, 0.026, 0.023, 0.98)),
        ))
        .with_children(|parent| {
            parent.spawn(trade_text(
                "",
                NativeTradeText::Header,
                18.0,
                Color::srgb(0.94, 0.91, 0.77),
            ));

            parent.spawn(trade_text(
                "",
                NativeTradeText::Body,
                13.0,
                Color::srgb(0.82, 0.85, 0.79),
            ));

            parent.spawn(trade_text(
                "",
                NativeTradeText::Footer,
                12.0,
                Color::srgb(0.64, 0.69, 0.65),
            ));
        });
}

fn trade_text(
    value: impl Into<String>,
    kind: NativeTradeText,
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
    chat: Res<NativeChatState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut trade_ui: ResMut<NativeTradeUiState>,
    mut panels: ResMut<NativePanelState>,
    mut map_ui: ResMut<NativeMapUiState>,
) {
    if chat.active {
        trade_ui.block_movement = false;
        return;
    }

    let trade_snapshot = game_state.trade.clone();
    trade_ui.block_movement = trade_snapshot.is_some();

    let Some(trade) = trade_snapshot else {
        trade_ui.selected_index = 0;

        if keys.just_pressed(KeyCode::KeyT) {
            let Some((target_id, target_name)) =
                nearest_trade_partner(&game_state)
            else {
                game_state.push_system_message(
                    "No other player is close enough to trade.",
                );
                return;
            };

            close_other_panels(&mut panels, &mut map_ui);

            if network
                .outbound
                .send(ClientMessage::RequestTrade { target_id })
                .is_err()
            {
                game_state.push_system_message(
                    "The game connection is offline.",
                );
            } else {
                game_state.push_system_message(format!(
                    "Trade request sent to {target_name}.",
                ));
            }
        }

        return;
    };

    close_other_panels(&mut panels, &mut map_ui);

    if trade.status == "requested" {
        trade_ui.block_movement = true;

        if keys.just_pressed(KeyCode::KeyY)
            || keys.just_pressed(KeyCode::Enter)
        {
            send_trade_response(
                &network,
                &mut game_state,
                trade.trade_id,
                true,
            );
        }

        if keys.just_pressed(KeyCode::Escape)
            || keys.just_pressed(KeyCode::Backspace)
        {
            send_trade_response(
                &network,
                &mut game_state,
                trade.trade_id,
                false,
            );
        }

        return;
    }

    let eligible = eligible_trade_items(&game_state);

    if eligible.is_empty() {
        trade_ui.selected_index = 0;
    } else {
        trade_ui.selected_index =
            trade_ui.selected_index.min(eligible.len() - 1);

        if keys.just_pressed(KeyCode::ArrowDown) {
            trade_ui.selected_index =
                (trade_ui.selected_index + 1) % eligible.len();
        }

        if keys.just_pressed(KeyCode::ArrowUp) {
            trade_ui.selected_index =
                if trade_ui.selected_index == 0 {
                    eligible.len() - 1
                } else {
                    trade_ui.selected_index - 1
                };
        }

        if keys.just_pressed(KeyCode::Space) {
            let selected_id = eligible[trade_ui.selected_index];
            toggle_trade_item(
                &network,
                &mut game_state,
                &trade,
                selected_id,
            );
        }
    }

    if keys.just_pressed(KeyCode::Enter)
        || keys.just_pressed(KeyCode::KeyY)
    {
        if trade.you_confirmed {
            game_state.push_system_message(
                "You already confirmed this trade.",
            );
        } else if network
            .outbound
            .send(ClientMessage::ConfirmTrade {
                trade_id: trade.trade_id,
            })
            .is_err()
        {
            game_state.push_system_message(
                "The game connection is offline.",
            );
        } else {
            game_state.push_system_message(
                "Trade confirmation sent.",
            );
        }
    }

    if keys.just_pressed(KeyCode::Escape)
        || keys.just_pressed(KeyCode::Backspace)
    {
        if network
            .outbound
            .send(ClientMessage::CancelTrade {
                trade_id: trade.trade_id,
            })
            .is_err()
        {
            game_state.push_system_message(
                "The game connection is offline.",
            );
        } else {
            game_state.push_system_message(
                "Trade cancellation requested.",
            );
        }
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

fn nearest_trade_partner(
    game_state: &NativeGameState,
) -> Option<(EntityId, String)> {
    let player = game_state.local_player()?;
    let origin = player.position;

    game_state
        .players
        .values()
        .filter(|candidate| {
            candidate.id != game_state.local_player_id
                && candidate.position.z == origin.z
        })
        .map(|candidate| {
            let dx = (candidate.position.x - origin.x).abs();
            let dy = (candidate.position.y - origin.y).abs();

            (
                dx.max(dy),
                candidate.id,
                candidate.name.clone(),
            )
        })
        .filter(|(distance, _, _)| *distance <= 2)
        .min_by_key(|(distance, _, _)| *distance)
        .map(|(_, id, name)| (id, name))
}

fn send_trade_response(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    trade_id: EntityId,
    accept: bool,
) {
    if network
        .outbound
        .send(ClientMessage::RespondTrade {
            trade_id,
            accept,
        })
        .is_err()
    {
        game_state.push_system_message(
            "The game connection is offline.",
        );
    } else if accept {
        game_state.push_system_message(
            "Trade request accepted.",
        );
    } else {
        game_state.push_system_message(
            "Trade request declined.",
        );
    }
}

fn eligible_trade_items(
    game_state: &NativeGameState,
) -> Vec<EntityId> {
    let mut items: Vec<_> = game_state
        .inventory
        .iter()
        .filter(|item| {
            item.container_id.is_none()
                && item.equipped_slot.is_none()
                && !game_state
                    .inventory
                    .iter()
                    .any(|child| child.container_id == Some(item.instance_id))
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

        left_name
            .cmp(right_name)
            .then_with(|| left.instance_id.cmp(&right.instance_id))
    });

    items
        .into_iter()
        .map(|item| item.instance_id)
        .collect()
}

fn toggle_trade_item(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    trade: &NativeTradeState,
    selected_id: EntityId,
) {
    let mut item_ids: Vec<_> = trade
        .your_offer
        .iter()
        .map(|item| item.instance_id)
        .collect();

    if let Some(index) =
        item_ids.iter().position(|id| *id == selected_id)
    {
        item_ids.remove(index);
    } else {
        item_ids.push(selected_id);
    }

    if network
        .outbound
        .send(ClientMessage::SetTradeOffer {
            trade_id: trade.trade_id,
            item_ids,
        })
        .is_err()
    {
        game_state.push_system_message(
            "The game connection is offline.",
        );
    } else {
        game_state.push_system_message(
            "Trade offer updated. Confirmation will be reset by the server.",
        );
    }
}

pub fn update_ui(
    game_state: Res<NativeGameState>,
    trade_ui: Res<NativeTradeUiState>,
    mut texts: Query<(&NativeTradeText, &mut Text)>,
    mut panel: Query<
        &mut Visibility,
        With<NativeTradePanel>,
    >,
) {
    let visible = game_state.trade.is_some();

    if let Ok(mut visibility) = panel.single_mut() {
        *visibility = if visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    let Some(trade) = game_state.trade.as_ref() else {
        return;
    };

    let header = if trade.status == "requested" {
        format!(
            "TRADE REQUEST   ·   {}",
            trade.partner.name,
        )
    } else {
        format!(
            "DIRECT TRADE   ·   {}   ·   {}",
            trade.partner.name,
            trade.status,
        )
    };

    let body = if trade.status == "requested" {
        format!(
            "{} wants to trade with you.\\n\\n\
             This is only a request. No items move until both players enter \
             an active trade and both confirm the final server state.\\n\\n\
             Y / Enter   Accept\\n\
             Esc / Backspace   Decline",
            trade.partner.name,
        )
    } else {
        render_active_trade(
            &game_state,
            trade,
            trade_ui.selected_index,
        )
    };

    let footer = if trade.status == "requested" {
        "Incoming trade request".to_owned()
    } else {
        format!(
            "You: {}   ·   {}: {}   ·   Enter/Y confirm   ·   Esc cancel",
            confirmation_label(trade.you_confirmed),
            trade.partner.name,
            confirmation_label(trade.partner_confirmed),
        )
    };

    for (kind, mut text) in &mut texts {
        text.0 = match kind {
            NativeTradeText::Header => header.clone(),
            NativeTradeText::Body => body.clone(),
            NativeTradeText::Footer => footer.clone(),
        };
    }
}

fn render_active_trade(
    game_state: &NativeGameState,
    trade: &NativeTradeState,
    selected_index: usize,
) -> String {
    let mut lines = Vec::new();

    lines.push("YOUR OFFER".into());
    if trade.your_offer.is_empty() {
        lines.push("  — nothing offered —".into());
    } else {
        for item in &trade.your_offer {
            lines.push(format!(
                "  {}",
                item_line(game_state, item),
            ));
        }
    }

    lines.push(String::new());
    lines.push(format!("{}'S OFFER", trade.partner.name.to_uppercase()));

    if trade.their_offer.is_empty() {
        lines.push("  — nothing offered —".into());
    } else {
        for item in &trade.their_offer {
            lines.push(format!(
                "  {}",
                item_line(game_state, item),
            ));
        }
    }

    lines.push(String::new());
    lines.push("YOUR TRADEABLE INVENTORY".into());

    let eligible = eligible_trade_items(game_state);

    if eligible.is_empty() {
        lines.push("  No root inventory items are tradeable.".into());
    } else {
        let safe_index = selected_index.min(eligible.len() - 1);
        let start = safe_index.saturating_sub(7);
        let end = (start + 16).min(eligible.len());

        for (relative, instance_id) in
            eligible[start..end].iter().enumerate()
        {
            let absolute = start + relative;

            let Some(item) = game_state
                .inventory
                .iter()
                .find(|item| item.instance_id == *instance_id)
            else {
                continue;
            };

            let selected =
                if absolute == safe_index { "▶" } else { " " };

            let offered = if trade
                .your_offer
                .iter()
                .any(|offered| offered.instance_id == *instance_id)
            {
                "[OFFERED]"
            } else {
                "         "
            };

            lines.push(format!(
                "{selected} {offered} {}",
                item_line(game_state, item),
            ));
        }
    }

    lines.push(String::new());
    lines.push(
        "↑/↓ Select   ·   Space add/remove item   ·   Enter/Y confirm"
            .into(),
    );

    lines.join("\\n")
}

fn item_line(
    game_state: &NativeGameState,
    item: &game_types::ItemInstance,
) -> String {
    let name = game_state
        .item_definitions
        .get(&item.definition_id)
        .map(|definition| definition.name.as_str())
        .unwrap_or(item.definition_id.as_str());

    if item.quantity > 1 {
        format!("{name} ×{}", item.quantity)
    } else {
        name.to_owned()
    }
}

fn confirmation_label(value: bool) -> &'static str {
    if value {
        "CONFIRMED"
    } else {
        "waiting"
    }
}
`;

save(TRADE_UI, tradeUiSource);

// ---------------------------------------------------------------------------
// main.rs
// ---------------------------------------------------------------------------
let main = read(MAIN);

if (!main.includes("mod native_trade_ui;")) {
  main = replaceOnce(
    main,
    "mod native_map_ui;\n",
    "mod native_map_ui;\nmod native_trade_ui;\n",
    "native_trade_ui module",
  );
}

if (!main.includes(".init_resource::<native_trade_ui::NativeTradeUiState>()")) {
  main = replaceOnce(
    main,
    `.init_resource::<native_map_ui::NativeMapUiState>()`,
    `.init_resource::<native_map_ui::NativeMapUiState>()
        .init_resource::<native_trade_ui::NativeTradeUiState>()`,
    "NativeTradeUiState init",
  );
}

if (!main.includes("native_trade_ui::setup")) {
  if (!main.includes("native_map_ui::setup))")) {
    throw new Error(
      "Startup native_map_ui::setup anchor missing. No files were written.",
    );
  }

  main = main.replace(
    "native_map_ui::setup))",
    "native_map_ui::setup, native_trade_ui::setup))",
  );
}

if (!main.includes("native_trade_ui::handle_input")) {
  const anchor =
    "native_map_ui::handle_input.before(schedule_tile_movement),";

  if (!main.includes(anchor)) {
    throw new Error(
      "native map input schedule anchor missing. No files were written.",
    );
  }

  main = main.replace(
    anchor,
    `${anchor}
                native_trade_ui::handle_input
                    .after(native_map_ui::handle_input)
                    .before(schedule_tile_movement),`,
  );
}

if (!main.includes("native_trade_ui::update_ui")) {
  const anchor =
    "native_map_ui::update_ui.after(pump_network),";

  if (!main.includes(anchor)) {
    throw new Error(
      "native map UI update anchor missing. No files were written.",
    );
  }

  main = main.replace(
    anchor,
    `${anchor}
                native_trade_ui::update_ui.after(pump_network),`,
  );
}

// Movement guard: direct trade owns gameplay keyboard.
{
  const start = main.indexOf("fn schedule_tile_movement(");
  const end = start >= 0
    ? main.indexOf("\nfn update_player_facing(", start)
    : -1;

  if (start < 0 || end < 0) {
    throw new Error(
      "schedule_tile_movement could not be isolated. No files were written.",
    );
  }

  let block = main.slice(start, end);

  if (!block.includes(
    "trade_ui: Res<native_trade_ui::NativeTradeUiState>",
  )) {
    if (!block.includes(
      "map_ui: Res<native_map_ui::NativeMapUiState>,"
    )) {
      throw new Error(
        "movement map UI resource anchor missing. No files were written.",
      );
    }

    block = block.replace(
      "map_ui: Res<native_map_ui::NativeMapUiState>,",
      `map_ui: Res<native_map_ui::NativeMapUiState>,
    trade_ui: Res<native_trade_ui::NativeTradeUiState>,`,
    );
  }

  if (!block.includes("if trade_ui.block_movement")) {
    const anchor = `    if map_ui.world_map_open {
        return;
    }
`;

    if (!block.includes(anchor)) {
      throw new Error(
        "world map movement guard missing. No files were written.",
      );
    }

    block = block.replace(
      anchor,
      `${anchor}
    if trade_ui.block_movement {
        return;
    }
`,
    );
  }

  main = main.slice(0, start) + block + main.slice(end);
}

save(MAIN, main);

// ---------------------------------------------------------------------------
// version/docs
// ---------------------------------------------------------------------------
let versionFile = read(VERSION_FILE);

if (!versionFile.includes(
  'pub const MIGRATION_VERSION: &str = "36.27";'
)) {
  const candidates = ["36.26.3", "36.26.2", "36.26.1"];
  let updated = false;

  for (const candidate of candidates) {
    const before =
      `pub const MIGRATION_VERSION: &str = "${candidate}";`;

    if (!versionFile.includes(before)) continue;

    versionFile = versionFile.replace(
      before,
      'pub const MIGRATION_VERSION: &str = "36.27";',
    );

    updated = true;
    break;
  }

  if (!updated) {
    throw new Error(
      `${VERSION_FILE} is not on an expected V36.26.x version. No files were written.`,
    );
  }
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker =
    "<!-- TIBIAGAME_V36_27_NATIVE_DIRECT_TRADE -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.27 migrates direct player trade into native Bevy UI using the existing
authoritative trade protocol.

T requests trade with the nearest other player within two tiles. Incoming
TradeRequested state is shown as a modal request; Y/Enter sends RespondTrade
accept=true and Escape/Backspace declines.

During active TradeState, Up/Down selects an eligible root inventory item,
Space sends the complete SetTradeOffer item-id set, Enter/Y sends ConfirmTrade,
and Escape/Backspace sends CancelTrade. Both authoritative offers and both
confirmation states are rendered from NativeGameState.trade.

The client never transfers inventory optimistically. Item movement and final
trade completion remain fully server-authoritative.
`;
    save(DOC, doc);
  }
}

// ---------------------------------------------------------------------------
// structural checks
// ---------------------------------------------------------------------------
const finalMain = read(MAIN);
const finalTrade = read(TRADE_UI);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalMain.includes("mod native_trade_ui;"),
    "native_trade_ui module missing",
  ],
  [
    finalMain.includes(
      ".init_resource::<native_trade_ui::NativeTradeUiState>()"
    ),
    "trade UI state not initialized",
  ],
  [
    finalMain.includes("native_trade_ui::setup"),
    "trade UI setup not scheduled",
  ],
  [
    finalMain.includes("native_trade_ui::handle_input"),
    "trade input system not scheduled",
  ],
  [
    finalMain.includes("native_trade_ui::update_ui"),
    "trade update system not scheduled",
  ],
  [
    finalMain.includes("if trade_ui.block_movement"),
    "trade movement lock missing",
  ],
  [
    finalTrade.includes("ClientMessage::RequestTrade"),
    "RequestTrade missing",
  ],
  [
    finalTrade.includes("ClientMessage::RespondTrade"),
    "RespondTrade missing",
  ],
  [
    finalTrade.includes("ClientMessage::SetTradeOffer"),
    "SetTradeOffer missing",
  ],
  [
    finalTrade.includes("ClientMessage::ConfirmTrade"),
    "ConfirmTrade missing",
  ],
  [
    finalTrade.includes("ClientMessage::CancelTrade"),
    "CancelTrade missing",
  ],
  [
    finalTrade.includes("game_state.trade.clone()"),
    "authoritative trade state read missing",
  ],
  [
    finalTrade.includes("trade.your_offer"),
    "your authoritative offer rendering missing",
  ],
  [
    finalTrade.includes("trade.their_offer"),
    "partner authoritative offer rendering missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.27";'
    ),
    "version is not V36.27",
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
  console.log("- T request nearest-player trade");
  console.log("- incoming request accept/decline");
  console.log("- authoritative dual-offer trade window");
  console.log("- Space offer toggle / Enter confirm / Esc cancel");
  console.log("- movement locked while trade state is active");
  console.log("- no client-side optimistic item transfer");
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
console.log("- Native direct player trade UI + protocol controls added.");
