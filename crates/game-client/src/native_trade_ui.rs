// TIBIAGAME_V36_27_NATIVE_DIRECT_TRADE
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use game_protocol::ClientMessage;
use game_types::EntityId;

use crate::{
    NativeNetwork,
    native_map_ui::NativeMapUiState,
    native_settings::NativeSettingsState,
    native_ui::{NativeChatState, NativePanelState},
    state::{NativeGameState, NativeTradeState},
};

#[derive(SystemParam)]
pub(crate) struct MovementUiLocks<'w> {
    map_ui: Res<'w, NativeMapUiState>,
    trade_ui: Res<'w, NativeTradeUiState>,
    settings_ui: Res<'w, NativeSettingsState>,
}

impl MovementUiLocks<'_> {
    pub(crate) fn blocks_movement(&self) -> bool {
        self.map_ui.world_map_open || self.trade_ui.block_movement || self.settings_ui.options_open
    }
}

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
            let Some((target_id, target_name)) = nearest_trade_partner(&game_state) else {
                game_state.push_system_message("No other player is close enough to trade.");
                return;
            };

            close_other_panels(&mut panels, &mut map_ui);

            if network
                .outbound
                .send(ClientMessage::RequestTrade { target_id })
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message(format!("Trade request sent to {target_name}.",));
            }
        }

        return;
    };

    close_other_panels(&mut panels, &mut map_ui);

    if trade.status == "requested" {
        trade_ui.block_movement = true;

        if keys.just_pressed(KeyCode::KeyY) || keys.just_pressed(KeyCode::Enter) {
            send_trade_response(&network, &mut game_state, trade.trade_id, true);
        }

        if keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::Backspace) {
            send_trade_response(&network, &mut game_state, trade.trade_id, false);
        }

        return;
    }

    let eligible = eligible_trade_items(&game_state);

    if eligible.is_empty() {
        trade_ui.selected_index = 0;
    } else {
        trade_ui.selected_index = trade_ui.selected_index.min(eligible.len() - 1);

        if keys.just_pressed(KeyCode::ArrowDown) {
            trade_ui.selected_index = (trade_ui.selected_index + 1) % eligible.len();
        }

        if keys.just_pressed(KeyCode::ArrowUp) {
            trade_ui.selected_index = if trade_ui.selected_index == 0 {
                eligible.len() - 1
            } else {
                trade_ui.selected_index - 1
            };
        }

        if keys.just_pressed(KeyCode::Space) {
            let selected_id = eligible[trade_ui.selected_index];
            toggle_trade_item(&network, &mut game_state, &trade, selected_id);
        }
    }

    if keys.just_pressed(KeyCode::Enter) || keys.just_pressed(KeyCode::KeyY) {
        if trade.you_confirmed {
            game_state.push_system_message("You already confirmed this trade.");
        } else if network
            .outbound
            .send(ClientMessage::ConfirmTrade {
                trade_id: trade.trade_id,
            })
            .is_err()
        {
            game_state.push_system_message("The game connection is offline.");
        } else {
            game_state.push_system_message("Trade confirmation sent.");
        }
    }

    if keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::Backspace) {
        if network
            .outbound
            .send(ClientMessage::CancelTrade {
                trade_id: trade.trade_id,
            })
            .is_err()
        {
            game_state.push_system_message("The game connection is offline.");
        } else {
            game_state.push_system_message("Trade cancellation requested.");
        }
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

fn nearest_trade_partner(game_state: &NativeGameState) -> Option<(EntityId, String)> {
    let player = game_state.local_player()?;
    let origin = player.position;

    game_state
        .players
        .values()
        .filter(|candidate| {
            candidate.id != game_state.local_player_id && candidate.position.z == origin.z
        })
        .map(|candidate| {
            let dx = (candidate.position.x - origin.x).abs();
            let dy = (candidate.position.y - origin.y).abs();

            (dx.max(dy), candidate.id, candidate.name.clone())
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
        .send(ClientMessage::RespondTrade { trade_id, accept })
        .is_err()
    {
        game_state.push_system_message("The game connection is offline.");
    } else if accept {
        game_state.push_system_message("Trade request accepted.");
    } else {
        game_state.push_system_message("Trade request declined.");
    }
}

fn eligible_trade_items(game_state: &NativeGameState) -> Vec<EntityId> {
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

    items.into_iter().map(|item| item.instance_id).collect()
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

    if let Some(index) = item_ids.iter().position(|id| *id == selected_id) {
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
        game_state.push_system_message("The game connection is offline.");
    } else {
        game_state
            .push_system_message("Trade offer updated. Confirmation will be reset by the server.");
    }
}

pub fn update_ui(
    game_state: Res<NativeGameState>,
    trade_ui: Res<NativeTradeUiState>,
    mut texts: Query<(&NativeTradeText, &mut Text)>,
    mut panel: Query<&mut Visibility, With<NativeTradePanel>>,
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
        format!("TRADE REQUEST   ·   {}", trade.partner.name,)
    } else {
        format!(
            "DIRECT TRADE   ·   {}   ·   {}",
            trade.partner.name, trade.status,
        )
    };

    let body = if trade.status == "requested" {
        format!(
            "{} wants to trade with you.\n\n             This is only a request. No items move until both players enter              an active trade and both confirm the final server state.\n\n             Y / Enter   Accept\n             Esc / Backspace   Decline",
            trade.partner.name,
        )
    } else {
        render_active_trade(&game_state, trade, trade_ui.selected_index)
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
            lines.push(format!("  {}", item_line(game_state, item),));
        }
    }

    lines.push(String::new());
    lines.push(format!("{}'S OFFER", trade.partner.name.to_uppercase()));

    if trade.their_offer.is_empty() {
        lines.push("  — nothing offered —".into());
    } else {
        for item in &trade.their_offer {
            lines.push(format!("  {}", item_line(game_state, item),));
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

        for (relative, instance_id) in eligible[start..end].iter().enumerate() {
            let absolute = start + relative;

            let Some(item) = game_state
                .inventory
                .iter()
                .find(|item| item.instance_id == *instance_id)
            else {
                continue;
            };

            let selected = if absolute == safe_index { "▶" } else { " " };

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
    lines.push("↑/↓ Select   ·   Space add/remove item   ·   Enter/Y confirm".into());

    lines.join("\n")
}

fn item_line(game_state: &NativeGameState, item: &game_types::ItemInstance) -> String {
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
    if value { "CONFIRMED" } else { "waiting" }
}
