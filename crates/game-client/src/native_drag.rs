// TIBIAGAME_V36_58_0_RUST_COMBAT_DRAG_PARITY
use std::collections::HashSet;

use bevy::prelude::*;
use game_protocol::{ClientMessage, ItemDestination};
use game_types::EntityId;

use crate::{
    NativeNetwork,
    native_ui::{
        NativeActionSlot, NativeCharacterEquipmentSlot, NativeInventoryButton, NativePanelState,
        NativeSpellbookButton,
    },
    state::NativeGameState,
};

const DRAG_THRESHOLD_PX: f32 = 6.0;

#[derive(Resource, Default)]
pub(crate) struct NativeActionBarState {
    slots: [Option<String>; 8],
    known_learned: HashSet<String>,
    initialized: bool,
}

impl NativeActionBarState {
    pub(crate) fn sync(&mut self, game_state: &NativeGameState) {
        let learned = learned_spells_sorted(game_state);
        let learned_ids: HashSet<String> = learned.iter().map(|(id, _)| id.clone()).collect();

        if !self.initialized {
            for (index, (spell_id, _)) in learned.iter().take(8).enumerate() {
                self.slots[index] = Some(spell_id.clone());
            }
            self.known_learned = learned_ids;
            self.initialized = true;
            return;
        }

        for slot in &mut self.slots {
            if slot
                .as_ref()
                .is_some_and(|spell_id| !learned_ids.contains(spell_id))
            {
                *slot = None;
            }
        }

        // Newly learned spells may fill genuinely empty slots, while spells the
        // player intentionally removed or replaced stay removed.
        for (spell_id, _) in &learned {
            if self.known_learned.contains(spell_id)
                || self
                    .slots
                    .iter()
                    .any(|slot| slot.as_deref() == Some(spell_id.as_str()))
            {
                continue;
            }

            if let Some(slot) = self.slots.iter_mut().find(|slot| slot.is_none()) {
                *slot = Some(spell_id.clone());
            }
        }

        self.known_learned = learned_ids;
    }

    pub(crate) fn spell_id(&self, action_slot: usize) -> Option<&str> {
        action_slot
            .checked_sub(1)
            .and_then(|index| self.slots.get(index))
            .and_then(|spell_id| spell_id.as_deref())
    }

    pub(crate) fn assign(&mut self, action_slot: usize, spell_id: String) {
        let Some(index) = action_slot.checked_sub(1) else {
            return;
        };
        let Some(destination) = self.slots.get_mut(index) else {
            return;
        };
        *destination = Some(spell_id);
    }

    pub(crate) fn clear(&mut self, action_slot: usize) {
        let Some(index) = action_slot.checked_sub(1) else {
            return;
        };
        if let Some(slot) = self.slots.get_mut(index) {
            *slot = None;
        }
    }
}

#[derive(Clone)]
enum NativeDragPayload {
    AttackClick,
    ActionSpell { slot: usize, spell_id: String },
    SpellbookSpell(String),
    Item(EntityId),
}

#[derive(Default)]
pub(crate) struct NativeDragDropState {
    payload: Option<NativeDragPayload>,
    start_cursor: Option<Vec2>,
    moved: bool,
}

pub(crate) fn handle_drag_drop(
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window, With<bevy::window::PrimaryWindow>>,
    chat: Res<crate::native_ui::NativeChatState>,
    panels: Res<NativePanelState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut action_bar: ResMut<NativeActionBarState>,
    action_slots: Query<(&Interaction, &NativeActionSlot), With<Button>>,
    inventory_buttons: Query<(&Interaction, &NativeInventoryButton), With<Button>>,
    spellbook_buttons: Query<(&Interaction, &NativeSpellbookButton), With<Button>>,
    equipment_buttons: Query<(&Interaction, &NativeCharacterEquipmentSlot), With<Button>>,
    mut drag: Local<NativeDragDropState>,
) {
    let Ok(window) = windows.single() else {
        return;
    };

    if chat.active {
        if mouse.just_released(MouseButton::Left) {
            *drag = NativeDragDropState::default();
        }
        return;
    }

    action_bar.sync(&game_state);
    let cursor = window.cursor_position();

    if mouse.just_pressed(MouseButton::Left) {
        let payload = pressed_inventory_item(&inventory_buttons, &game_state, &panels)
            .map(NativeDragPayload::Item)
            .or_else(|| {
                pressed_equipment_item(&equipment_buttons, &game_state).map(NativeDragPayload::Item)
            })
            .or_else(|| {
                pressed_spellbook_spell(&spellbook_buttons, &game_state, &panels)
                    .map(NativeDragPayload::SpellbookSpell)
            })
            .or_else(|| {
                action_slots.iter().find_map(|(interaction, slot)| {
                    if *interaction != Interaction::Pressed {
                        return None;
                    }
                    if slot.0 == 0 {
                        return Some(NativeDragPayload::AttackClick);
                    }
                    action_bar
                        .spell_id(slot.0)
                        .map(|spell_id| NativeDragPayload::ActionSpell {
                            slot: slot.0,
                            spell_id: spell_id.to_owned(),
                        })
                })
            });

        if payload.is_some() {
            drag.payload = payload;
            drag.start_cursor = cursor;
            drag.moved = false;
        }
    }

    if mouse.pressed(MouseButton::Left) {
        if let (Some(start), Some(current)) = (drag.start_cursor, cursor) {
            if current.distance_squared(start) >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX {
                drag.moved = true;
            }
        }
    }

    if !mouse.just_released(MouseButton::Left) {
        return;
    }

    let payload = drag.payload.take();
    let moved = drag.moved;
    drag.start_cursor = None;
    drag.moved = false;

    let Some(payload) = payload else {
        return;
    };

    if !moved {
        match payload {
            NativeDragPayload::AttackClick => {
                crate::native_ui::activate_action_slot(0, &network, &mut game_state, &action_bar);
            }
            NativeDragPayload::ActionSpell { slot, .. } => {
                crate::native_ui::activate_action_slot(
                    slot,
                    &network,
                    &mut game_state,
                    &action_bar,
                );
            }
            NativeDragPayload::SpellbookSpell(_) | NativeDragPayload::Item(_) => {}
        }
        return;
    }

    match payload {
        NativeDragPayload::AttackClick => {}
        NativeDragPayload::SpellbookSpell(spell_id) => {
            if let Some(target_slot) = hovered_action_slot(&action_slots) {
                if target_slot > 0 && game_state.learned_spell_ids.contains(&spell_id) {
                    action_bar.assign(target_slot, spell_id);
                }
            }
        }
        NativeDragPayload::ActionSpell { slot, spell_id } => {
            if let Some(target_slot) = hovered_action_slot(&action_slots) {
                if target_slot > 0 {
                    action_bar.assign(target_slot, spell_id);
                    if target_slot != slot {
                        action_bar.clear(slot);
                    }
                }
            } else {
                // Match the old client: dragging a hotbar spell outside the
                // action bar removes that assignment.
                action_bar.clear(slot);
            }
        }
        NativeDragPayload::Item(instance_id) => {
            if let Some(target_slot) = hovered_equipment_slot(&equipment_buttons) {
                move_item_to_equipment(&network, &mut game_state, instance_id, target_slot);
                return;
            }

            if let Some(target_index) = hovered_inventory_slot(&inventory_buttons) {
                move_item_to_inventory(
                    &network,
                    &mut game_state,
                    &panels,
                    instance_id,
                    target_index,
                );
            }
        }
    }
}

fn hovered_action_slot(
    buttons: &Query<(&Interaction, &NativeActionSlot), With<Button>>,
) -> Option<usize> {
    buttons.iter().find_map(|(interaction, slot)| {
        matches!(*interaction, Interaction::Hovered | Interaction::Pressed).then_some(slot.0)
    })
}

fn hovered_inventory_slot(
    buttons: &Query<(&Interaction, &NativeInventoryButton), With<Button>>,
) -> Option<usize> {
    buttons.iter().find_map(|(interaction, button)| {
        if !matches!(*interaction, Interaction::Hovered | Interaction::Pressed) {
            return None;
        }
        match *button {
            NativeInventoryButton::Slot(index) => Some(index),
            NativeInventoryButton::Action(_) => None,
        }
    })
}

fn hovered_equipment_slot(
    buttons: &Query<(&Interaction, &NativeCharacterEquipmentSlot), With<Button>>,
) -> Option<NativeCharacterEquipmentSlot> {
    buttons.iter().find_map(|(interaction, slot)| {
        matches!(*interaction, Interaction::Hovered | Interaction::Pressed).then_some(*slot)
    })
}

fn pressed_inventory_item(
    buttons: &Query<(&Interaction, &NativeInventoryButton), With<Button>>,
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Option<EntityId> {
    let ids = visible_inventory_ids(game_state, panels);
    buttons.iter().find_map(|(interaction, button)| {
        if *interaction != Interaction::Pressed {
            return None;
        }
        match *button {
            NativeInventoryButton::Slot(index) => ids.get(index).copied(),
            NativeInventoryButton::Action(_) => None,
        }
    })
}

fn pressed_equipment_item(
    buttons: &Query<(&Interaction, &NativeCharacterEquipmentSlot), With<Button>>,
    game_state: &NativeGameState,
) -> Option<EntityId> {
    buttons.iter().find_map(|(interaction, slot)| {
        if *interaction != Interaction::Pressed {
            return None;
        }
        equipped_item_id(game_state, *slot)
    })
}

fn pressed_spellbook_spell(
    buttons: &Query<(&Interaction, &NativeSpellbookButton), With<Button>>,
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Option<String> {
    if !panels.spells_open {
        return None;
    }

    let learned = learned_spells_sorted(game_state);
    buttons.iter().find_map(|(interaction, button)| {
        if *interaction != Interaction::Pressed {
            return None;
        }
        match *button {
            NativeSpellbookButton::Learned(index) => learned.get(index).map(|(id, _)| id.clone()),
            _ => None,
        }
    })
}

fn learned_spells_sorted(game_state: &NativeGameState) -> Vec<(String, String)> {
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

fn visible_inventory_ids(game_state: &NativeGameState, panels: &NativePanelState) -> Vec<EntityId> {
    let query = panels.inventory_search.trim().to_ascii_lowercase();

    let mut items: Vec<_> = game_state
        .inventory
        .iter()
        .filter(|item| item.definition_id != "gold_coin")
        .filter(|item| {
            if let Some(container_id) = panels.inventory_container_id {
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
                || item.definition_id.to_ascii_lowercase().contains(&query)
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

        left.equipped_slot
            .is_none()
            .cmp(&right.equipped_slot.is_none())
            .then_with(|| left_name.cmp(right_name))
    });

    items
        .into_iter()
        .take(12)
        .map(|item| item.instance_id)
        .collect()
}

fn move_item_to_inventory(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
    instance_id: EntityId,
    target_index: usize,
) {
    let visible = visible_inventory_ids(game_state, panels);

    let destination = visible
        .get(target_index)
        .copied()
        .filter(|target_id| *target_id != instance_id)
        .and_then(|target_id| {
            let target = game_state
                .inventory
                .iter()
                .find(|item| item.instance_id == target_id)?;
            let is_container = game_state
                .item_definitions
                .get(&target.definition_id)
                .and_then(|definition| definition.container_slots)
                .is_some();
            is_container.then_some(ItemDestination::Container {
                container_id: target_id,
            })
        })
        .or_else(|| {
            panels
                .inventory_container_id
                .filter(|container_id| *container_id != instance_id)
                .map(|container_id| ItemDestination::Container { container_id })
        })
        .unwrap_or(ItemDestination::Root);

    send_move_item(network, game_state, instance_id, destination);
}

fn move_item_to_equipment(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    instance_id: EntityId,
    target_slot: NativeCharacterEquipmentSlot,
) {
    let Some(item) = game_state
        .inventory
        .iter()
        .find(|item| item.instance_id == instance_id)
        .cloned()
    else {
        return;
    };

    let Some(definition) = game_state.item_definitions.get(&item.definition_id) else {
        game_state.push_system_message("Unknown item definition.");
        return;
    };

    let item_name = definition.name.clone();
    let Some(slot) = definition.equipment_slot.clone() else {
        game_state.push_system_message(format!("{item_name} cannot be equipped."));
        return;
    };

    if !equipment_slot_aliases(target_slot)
        .iter()
        .any(|alias| slot.eq_ignore_ascii_case(alias))
    {
        game_state.push_system_message(format!("{item_name} does not fit that equipment slot."));
        return;
    }

    send_move_item(
        network,
        game_state,
        instance_id,
        ItemDestination::Equipment { slot },
    );
}

fn send_move_item(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    instance_id: EntityId,
    destination: ItemDestination,
) {
    let item_name = game_state
        .inventory
        .iter()
        .find(|item| item.instance_id == instance_id)
        .and_then(|item| {
            game_state
                .item_definitions
                .get(&item.definition_id)
                .map(|definition| definition.name.clone())
                .or_else(|| Some(item.definition_id.clone()))
        })
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
        game_state.push_system_message(format!("Move {item_name}."));
    }
}

fn equipped_item_id(
    game_state: &NativeGameState,
    slot: NativeCharacterEquipmentSlot,
) -> Option<EntityId> {
    let aliases = equipment_slot_aliases(slot);
    game_state
        .inventory
        .iter()
        .find(|item| {
            item.equipped_slot.as_deref().is_some_and(|equipped| {
                aliases
                    .iter()
                    .any(|alias| equipped.eq_ignore_ascii_case(alias))
            })
        })
        .map(|item| item.instance_id)
}

fn equipment_slot_aliases(slot: NativeCharacterEquipmentSlot) -> &'static [&'static str] {
    match slot {
        NativeCharacterEquipmentSlot::Helmet => &["helmet", "head"],
        NativeCharacterEquipmentSlot::Amulet => &["amulet", "neck"],
        NativeCharacterEquipmentSlot::Chest => &["chest", "armor", "body"],
        NativeCharacterEquipmentSlot::Back => &["back", "cape"],
        NativeCharacterEquipmentSlot::LeftHand => &["left_hand", "lefthand", "off_hand", "offhand"],
        NativeCharacterEquipmentSlot::RightHand => {
            &["right_hand", "righthand", "main_hand", "mainhand", "weapon"]
        }
        NativeCharacterEquipmentSlot::Backpack => &["backpack", "bag"],
        NativeCharacterEquipmentSlot::Ring => &["ring"],
        NativeCharacterEquipmentSlot::Feet => &["feet", "boots", "shoes"],
        NativeCharacterEquipmentSlot::Legs => &["legs", "pants"],
    }
}
