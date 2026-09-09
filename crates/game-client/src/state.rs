// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE
// TIBIAGAME_V36_11_NATIVE_INTERACTION_FOUNDATION
use std::collections::{HashMap, HashSet, VecDeque};

use bevy::prelude::Resource;
use game_protocol::{ServerMessage, WelcomePayload};
use game_types::{
    CreatureView, EntityId, GroundItem, ItemDefinition, ItemInstance, NpcView,
    PlayerView, Position, ProfessionSkillView, ResourceNodeView, RuneRecipe,
    SpellDefinition,
};

const MAX_MESSAGE_LINES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeMessageKind {
    Chat,
    System,
    Loot,
    Combat,
    Discovery,
    Error,
}

#[derive(Debug, Clone)]
pub struct NativeMessageLine {
    pub kind: NativeMessageKind,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct NativeCraftingState {
    pub recipe_id: Option<String>,
    pub remaining: u16,
    pub status: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NativeAbilityState {
    pub ability_id: String,
    pub cooldown_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NativeTelegraphState {
    pub source_id: EntityId,
    pub position: Position,
    pub effect_id: String,
    pub radius: u16,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct NativeTradeState {
    pub trade_id: EntityId,
    pub partner: PlayerView,
    pub your_offer: Vec<ItemInstance>,
    pub their_offer: Vec<ItemInstance>,
    pub you_confirmed: bool,
    pub partner_confirmed: bool,
    pub status: String,
}

#[derive(Resource)]
pub struct NativeGameState {
    pub local_player_id: EntityId,
    pub players: HashMap<EntityId, PlayerView>,
    pub region_center: Position,
    pub region_radius: i32,
    pub region_floor_radius: i16,
    pub item_definitions: HashMap<String, ItemDefinition>,
    pub rune_recipes: HashMap<String, RuneRecipe>,
    pub spells: HashMap<String, SpellDefinition>,
    pub learned_spell_ids: HashSet<String>,
    pub learned_recipe_ids: HashSet<String>,
    pub inventory: Vec<ItemInstance>,
    pub depot: Vec<ItemInstance>,
    pub inventory_weight: f32,
    pub max_capacity: f32,
    pub ground_items: Vec<GroundItem>,
    pub creatures: HashMap<EntityId, CreatureView>,
    pub npcs: HashMap<String, NpcView>,
    pub resource_nodes: HashMap<String, ResourceNodeView>,
    pub profession_skills: HashMap<String, ProfessionSkillView>,
    pub discovered_knowledge_ids: HashSet<String>,
    pub food_remaining_ms: u64,
    pub crafting: Option<NativeCraftingState>,
    pub last_ability: Option<NativeAbilityState>,
    pub last_telegraph: Option<NativeTelegraphState>,
    pub trade: Option<NativeTradeState>,
    pub attack_target_id: Option<EntityId>,
    pub focused_npc_id: Option<String>,
    pub messages: VecDeque<NativeMessageLine>,
    pub last_error: Option<(String, String)>,
}

impl NativeGameState {
    pub fn from_welcome(welcome: &WelcomePayload) -> Self {
        let mut players: HashMap<EntityId, PlayerView> = welcome
            .players
            .iter()
            .cloned()
            .map(|player| (player.id, player))
            .collect();
        players.insert(welcome.player.id, welcome.player.clone());

        let mut state = Self {
            local_player_id: welcome.player.id,
            players,
            region_center: welcome.region_center,
            region_radius: welcome.region_radius,
            region_floor_radius: welcome.region_floor_radius,
            item_definitions: welcome
                .item_definitions
                .iter()
                .cloned()
                .map(|definition| (definition.id.clone(), definition))
                .collect(),
            rune_recipes: welcome
                .rune_recipes
                .iter()
                .cloned()
                .map(|recipe| (recipe.id.clone(), recipe))
                .collect(),
            spells: welcome
                .spells
                .iter()
                .cloned()
                .map(|spell| (spell.id.clone(), spell))
                .collect(),
            learned_spell_ids: welcome.learned_spell_ids.iter().cloned().collect(),
            learned_recipe_ids: welcome.learned_recipe_ids.iter().cloned().collect(),
            inventory: welcome.inventory.clone(),
            depot: welcome.depot.clone(),
            inventory_weight: welcome.inventory_weight,
            max_capacity: welcome.max_capacity,
            ground_items: welcome.ground_items.clone(),
            creatures: welcome
                .creatures
                .iter()
                .cloned()
                .map(|creature| (creature.id, creature))
                .collect(),
            npcs: welcome
                .npcs
                .iter()
                .cloned()
                .map(|npc| (npc.id.clone(), npc))
                .collect(),
            resource_nodes: welcome
                .resource_nodes
                .iter()
                .cloned()
                .map(|node| (node.id.clone(), node))
                .collect(),
            profession_skills: welcome
                .profession_skills
                .iter()
                .cloned()
                .map(|skill| (skill.id.clone(), skill))
                .collect(),
            discovered_knowledge_ids: welcome
                .discovered_knowledge_ids
                .iter()
                .cloned()
                .collect(),
            food_remaining_ms: 0,
            crafting: None,
            last_ability: None,
            last_telegraph: None,
            trade: None,
            attack_target_id: None,
            focused_npc_id: None,
            messages: VecDeque::new(),
            last_error: None,
        };

        state.push_message(
            NativeMessageKind::System,
            format!("Connected as {}.", welcome.player.name),
        );
        state
    }

    pub fn local_player(&self) -> Option<&PlayerView> {
        self.players.get(&self.local_player_id)
    }

    pub fn latest_message(&self) -> Option<&NativeMessageLine> {
        self.messages.back()
    }

    pub fn push_system_message(&mut self, text: impl Into<String>) {
        self.push_message(NativeMessageKind::System, text);
    }

    pub fn set_attack_target(&mut self, target_id: Option<EntityId>) {
        self.attack_target_id = target_id;
    }

    pub fn focus_npc(&mut self, npc_id: Option<String>) {
        self.focused_npc_id = npc_id;
    }

    pub fn apply_server_message(&mut self, message: &ServerMessage) {
        match message {
            ServerMessage::Welcome { payload } => {
                *self = Self::from_welcome(payload.as_ref());
            }
            ServerMessage::WorldRegion {
                region_center,
                region_radius,
                region_floor_radius,
                ground_items,
                creatures,
                npcs,
                resource_nodes,
                ..
            } => {
                self.region_center = *region_center;
                self.region_radius = *region_radius;
                self.region_floor_radius = *region_floor_radius;
                self.ground_items = ground_items.clone();
                self.creatures = creatures
                    .iter()
                    .cloned()
                    .map(|creature| (creature.id, creature))
                    .collect();
                if self
                    .attack_target_id
                    .is_some_and(|target_id| !self.creatures.contains_key(&target_id))
                {
                    self.attack_target_id = None;
                }
                self.npcs = npcs
                    .iter()
                    .cloned()
                    .map(|npc| (npc.id.clone(), npc))
                    .collect();
                if self
                    .focused_npc_id
                    .as_ref()
                    .is_some_and(|npc_id| !self.npcs.contains_key(npc_id))
                {
                    self.focused_npc_id = None;
                }
                self.resource_nodes = resource_nodes
                    .iter()
                    .cloned()
                    .map(|node| (node.id.clone(), node))
                    .collect();
            }
            ServerMessage::PlayerJoined { player } => {
                self.players.insert(player.id, player.clone());
                self.push_message(
                    NativeMessageKind::System,
                    format!("{} entered the world.", player.name),
                );
            }
            ServerMessage::PlayerLeft { player_id } => {
                if let Some(player) = self.players.remove(player_id) {
                    self.push_message(
                        NativeMessageKind::System,
                        format!("{} left the world.", player.name),
                    );
                }
            }
            ServerMessage::PlayerMoved {
                player_id,
                position,
                ..
            }
            | ServerMessage::MoveRejected {
                player_id,
                position,
                ..
            } => {
                if let Some(player) = self.players.get_mut(player_id) {
                    player.position = *position;
                }
            }
            ServerMessage::Spoken {
                player_name, text, ..
            } => {
                self.push_message(
                    NativeMessageKind::Chat,
                    format!("{player_name}: {text}"),
                );
            }
            ServerMessage::PlayerOutfitChanged { player_id, outfit } => {
                if let Some(player) = self.players.get_mut(player_id) {
                    player.outfit = outfit.clone();
                }
            }
            ServerMessage::PlayerSecondarySkillsChanged { player_id, skills } => {
                if let Some(player) = self.players.get_mut(player_id) {
                    player.secondary_skills = skills.clone();
                }
            }
            ServerMessage::InventoryChanged {
                player_id,
                inventory,
                inventory_weight,
                max_capacity,
            } if *player_id == self.local_player_id => {
                let previous_gold = definition_quantity(&self.inventory, "gold_coin");
                let next_gold = definition_quantity(inventory, "gold_coin");

                self.inventory = inventory.clone();
                self.inventory_weight = *inventory_weight;
                self.max_capacity = *max_capacity;

                if next_gold > previous_gold {
                    let gained = next_gold - previous_gold;
                    self.push_message(
                        NativeMessageKind::Loot,
                        format!("You received {gained} gold."),
                    );
                }
            }
            ServerMessage::DepotChanged { player_id, depot }
                if *player_id == self.local_player_id =>
            {
                self.depot = depot.clone();
            }
            ServerMessage::SpellsChanged {
                player_id,
                learned_spell_ids,
            } if *player_id == self.local_player_id => {
                self.learned_spell_ids = learned_spell_ids.iter().cloned().collect();
                self.push_message(
                    NativeMessageKind::System,
                    "Your learned spells changed.",
                );
            }
            ServerMessage::RecipesChanged {
                player_id,
                learned_recipe_ids,
            } if *player_id == self.local_player_id => {
                self.learned_recipe_ids = learned_recipe_ids.iter().cloned().collect();
            }
            ServerMessage::ResourceNodesChanged { resource_nodes } => {
                self.resource_nodes = resource_nodes
                    .iter()
                    .cloned()
                    .map(|node| (node.id.clone(), node))
                    .collect();
            }
            ServerMessage::ProfessionSkillsChanged { player_id, skills }
                if *player_id == self.local_player_id =>
            {
                self.profession_skills = skills
                    .iter()
                    .cloned()
                    .map(|skill| (skill.id.clone(), skill))
                    .collect();
            }
            ServerMessage::DiscoveryChanged {
                player_id,
                discovery_id,
                text,
                reward_item_definition_id,
            } if *player_id == self.local_player_id => {
                self.discovered_knowledge_ids.insert(discovery_id.clone());
                let reward = reward_item_definition_id
                    .as_ref()
                    .and_then(|id| self.item_definitions.get(id))
                    .map(|definition| format!(" Reward: {}.", definition.name))
                    .unwrap_or_default();
                self.push_message(
                    NativeMessageKind::Discovery,
                    format!("{text}{reward}"),
                );
            }
            ServerMessage::GroundItemsChanged { ground_items } => {
                self.ground_items = ground_items.clone();
            }
            ServerMessage::FoodStatus {
                player_id,
                remaining_ms,
            } if *player_id == self.local_player_id => {
                self.food_remaining_ms = *remaining_ms;
            }
            ServerMessage::CombatEffect {
                source_id,
                target_id,
                damage,
                ..
            } => {
                if *source_id == self.local_player_id {
                    self.push_message(
                        NativeMessageKind::Combat,
                        format!("You dealt {damage} damage."),
                    );
                } else if *target_id == self.local_player_id {
                    self.push_message(
                        NativeMessageKind::Combat,
                        format!("You took {damage} damage."),
                    );
                }
            }
            ServerMessage::AbilityUsed {
                player_id,
                ability_id,
                cooldown_ms,
                duration_ms,
            } if *player_id == self.local_player_id => {
                self.last_ability = Some(NativeAbilityState {
                    ability_id: ability_id.clone(),
                    cooldown_ms: *cooldown_ms,
                    duration_ms: *duration_ms,
                });
            }
            ServerMessage::AreaTelegraph {
                source_id,
                position,
                effect_id,
                radius,
                duration_ms,
            } => {
                self.last_telegraph = Some(NativeTelegraphState {
                    source_id: *source_id,
                    position: *position,
                    effect_id: effect_id.clone(),
                    radius: *radius,
                    duration_ms: *duration_ms,
                });
            }
            ServerMessage::TradeRequested {
                trade_id,
                requester,
            } => {
                self.trade = Some(NativeTradeState {
                    trade_id: *trade_id,
                    partner: requester.clone(),
                    your_offer: Vec::new(),
                    their_offer: Vec::new(),
                    you_confirmed: false,
                    partner_confirmed: false,
                    status: "requested".into(),
                });
                self.push_message(
                    NativeMessageKind::System,
                    format!("{} requested a trade.", requester.name),
                );
            }
            ServerMessage::TradeState {
                trade_id,
                partner,
                your_offer,
                their_offer,
                you_confirmed,
                partner_confirmed,
                status,
            } => {
                self.trade = Some(NativeTradeState {
                    trade_id: *trade_id,
                    partner: partner.clone(),
                    your_offer: your_offer.clone(),
                    their_offer: their_offer.clone(),
                    you_confirmed: *you_confirmed,
                    partner_confirmed: *partner_confirmed,
                    status: status.clone(),
                });
            }
            ServerMessage::TradeClosed { trade_id, reason } => {
                if self
                    .trade
                    .as_ref()
                    .is_some_and(|trade| trade.trade_id == *trade_id)
                {
                    self.trade = None;
                }
                self.push_message(
                    NativeMessageKind::System,
                    format!("Trade closed: {reason}."),
                );
            }
            ServerMessage::CreatureSpawned { creature } => {
                self.creatures.insert(creature.id, creature.clone());
            }
            ServerMessage::CreatureMoved {
                creature_id,
                position,
            } => {
                if let Some(creature) = self.creatures.get_mut(creature_id) {
                    creature.position = *position;
                }
            }
            ServerMessage::CreatureStateChanged {
                creature_id,
                state,
                immune,
                health,
                max_health,
            } => {
                if let Some(creature) = self.creatures.get_mut(creature_id) {
                    creature.state = state.clone();
                    creature.immune = *immune;
                    creature.health = *health;
                    creature.max_health = *max_health;
                }
                if *health == 0 && self.attack_target_id == Some(*creature_id) {
                    self.attack_target_id = None;
                }
            }
            ServerMessage::CreatureDamaged {
                creature_id,
                health,
                max_health,
                ..
            } => {
                if let Some(creature) = self.creatures.get_mut(creature_id) {
                    creature.health = *health;
                    creature.max_health = *max_health;
                }
            }
            ServerMessage::CreatureDied {
                creature_id,
                killer_id,
                experience,
            } => {
                if let Some(creature) = self.creatures.get_mut(creature_id) {
                    creature.health = 0;
                    creature.state = "dead".into();
                }
                if self.attack_target_id == Some(*creature_id) {
                    self.attack_target_id = None;
                }
                if *killer_id == self.local_player_id && *experience > 0 {
                    self.push_message(
                        NativeMessageKind::Loot,
                        format!("You gained {experience} experience."),
                    );
                }
            }
            ServerMessage::RuneCraftingChanged {
                player_id,
                recipe_id,
                remaining,
                status,
            } if *player_id == self.local_player_id => {
                self.crafting = Some(NativeCraftingState {
                    recipe_id: recipe_id.clone(),
                    remaining: *remaining,
                    status: status.clone(),
                });
            }
            ServerMessage::PlayerStatsChanged {
                player_id,
                health,
                max_health,
                level,
                experience,
                mana,
                max_mana,
                sword_skill,
                sword_tries,
                distance_skill,
                distance_tries,
                shielding_skill,
                shielding_tries,
                fletching_skill,
                fletching_tries,
                magic_level,
                magic_tries,
                max_capacity,
            } => {
                if let Some(player) = self.players.get_mut(player_id) {
                    player.health = *health;
                    player.max_health = *max_health;
                    player.level = *level;
                    player.experience = *experience;
                    player.mana = *mana;
                    player.max_mana = *max_mana;
                    player.sword_skill = *sword_skill;
                    player.sword_tries = *sword_tries;
                    player.distance_skill = *distance_skill;
                    player.distance_tries = *distance_tries;
                    player.shielding_skill = *shielding_skill;
                    player.shielding_tries = *shielding_tries;
                    player.fletching_skill = *fletching_skill;
                    player.fletching_tries = *fletching_tries;
                    player.magic_level = *magic_level;
                    player.magic_tries = *magic_tries;
                }
                if *player_id == self.local_player_id {
                    self.max_capacity = *max_capacity;
                }
            }
            ServerMessage::PlayerDied {
                player_id,
                killer_id: _,
            } => {
                if let Some(player) = self.players.get_mut(player_id) {
                    player.health = 0;
                }
                if *player_id == self.local_player_id {
                    self.attack_target_id = None;
                    self.focused_npc_id = None;
                    self.push_message(
                        NativeMessageKind::System,
                        "You died.",
                    );
                }
            }
            ServerMessage::Error { code, message } => {
                self.last_error = Some((code.clone(), message.clone()));
                self.push_message(
                    NativeMessageKind::Error,
                    format!("{code}: {message}"),
                );
            }

            // These messages are represented by dedicated world/render systems,
            // or do not carry persistent gameplay state.
            ServerMessage::DoorChanged { .. }
            | ServerMessage::WindowChanged { .. }
            | ServerMessage::Pong { .. } => {}

            // Non-local variants of local-only state messages are intentionally
            // ignored after the guarded match arms above.
            ServerMessage::InventoryChanged { .. }
            | ServerMessage::DepotChanged { .. }
            | ServerMessage::SpellsChanged { .. }
            | ServerMessage::RecipesChanged { .. }
            | ServerMessage::ProfessionSkillsChanged { .. }
            | ServerMessage::DiscoveryChanged { .. }
            | ServerMessage::FoodStatus { .. }
            | ServerMessage::AbilityUsed { .. }
            | ServerMessage::RuneCraftingChanged { .. } => {}
        }
    }

    fn push_message(
        &mut self,
        kind: NativeMessageKind,
        text: impl Into<String>,
    ) {
        self.messages.push_back(NativeMessageLine {
            kind,
            text: text.into(),
        });

        while self.messages.len() > MAX_MESSAGE_LINES {
            self.messages.pop_front();
        }
    }
}

fn definition_quantity(items: &[ItemInstance], definition_id: &str) -> u32 {
    items
        .iter()
        .filter(|item| item.definition_id == definition_id)
        .map(|item| u32::from(item.quantity))
        .sum()
}
