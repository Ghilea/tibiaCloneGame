use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type EntityId = Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VocationProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub max_health: u16,
    pub max_mana: u16,
    pub capacity: u16,
    pub sword_skill: u16,
    pub distance_skill: u16,
    pub magic_level: u16,
    pub sword_training: u32,
    pub distance_training: u32,
    pub magic_training: u32,
    pub can_craft_sigils: bool,
}

pub fn vocation_profile(id: &str) -> Option<VocationProfile> {
    Some(match id {
        "warrior" => VocationProfile {
            id: "warrior",
            name: "Warrior",
            max_health: 180,
            max_mana: 30,
            capacity: 130,
            sword_skill: 12,
            distance_skill: 8,
            magic_level: 0,
            sword_training: 2,
            distance_training: 1,
            magic_training: 1,
            can_craft_sigils: false,
        },
        "ranger" => VocationProfile {
            id: "ranger",
            name: "Ranger",
            max_health: 145,
            max_mana: 45,
            capacity: 110,
            sword_skill: 10,
            distance_skill: 12,
            magic_level: 0,
            sword_training: 1,
            distance_training: 2,
            magic_training: 1,
            can_craft_sigils: false,
        },
        "mage" => VocationProfile {
            id: "mage",
            name: "Mage",
            max_health: 105,
            max_mana: 120,
            capacity: 80,
            sword_skill: 8,
            distance_skill: 8,
            magic_level: 2,
            sword_training: 1,
            distance_training: 1,
            magic_training: 2,
            can_craft_sigils: true,
        },
        "druid" => VocationProfile {
            id: "druid",
            name: "Druid",
            max_health: 115,
            max_mana: 110,
            capacity: 85,
            sword_skill: 8,
            distance_skill: 8,
            magic_level: 2,
            sword_training: 1,
            distance_training: 1,
            magic_training: 2,
            can_craft_sigils: true,
        },
        "adventurer" => VocationProfile {
            id: "adventurer",
            name: "Adventurer",
            max_health: 150,
            max_mana: 50,
            capacity: 100,
            sword_skill: 10,
            distance_skill: 10,
            magic_level: 0,
            sword_training: 1,
            distance_training: 1,
            magic_training: 1,
            can_craft_sigils: true,
        },
        _ => return None,
    })
}

pub fn playable_vocation(id: &str) -> Option<VocationProfile> {
    let profile = vocation_profile(id)?;
    (profile.id != "adventurer").then_some(profile)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDefinition {
    pub id: String,
    pub name: String,
    pub weight: f32,
    pub stackable: bool,
    pub max_stack: u16,
    #[serde(default)]
    pub charges: Option<u16>,
    #[serde(default)]
    pub attack: Option<u16>,
    #[serde(default)]
    pub container_slots: Option<u16>,
    #[serde(default)]
    pub equipment_slot: Option<String>,
    #[serde(default = "default_true")]
    pub pickupable: bool,
    #[serde(default)]
    pub combat_effect: Option<ItemCombatEffect>,
    #[serde(default)]
    pub distance_weapon: Option<DistanceWeapon>,
    #[serde(default)]
    pub food_effect: Option<FoodEffect>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoodEffect {
    pub health_per_tick: u16,
    pub mana_per_tick: u16,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistanceWeapon {
    pub damage: u16,
    pub range: u16,
    pub cooldown_ms: u64,
    pub ammunition_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCombatEffect {
    pub damage: u16,
    pub range: u16,
    pub cooldown_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInstance {
    pub instance_id: Uuid,
    pub definition_id: String,
    pub quantity: u16,
    pub charges: Option<u16>,
    #[serde(default)]
    pub container_id: Option<Uuid>,
    #[serde(default)]
    pub equipped_slot: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundItem {
    pub item: ItemInstance,
    pub position: Position,
    #[serde(default)]
    pub contents: Vec<ItemInstance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcView {
    pub id: String,
    pub name: String,
    pub title: String,
    pub service: String,
    pub dialogue: String,
    pub position: Position,
    pub offers: Vec<ShopOffer>,
    #[serde(default)]
    pub spell_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub vocations: Vec<String>,
    pub price: u16,
    pub mana_cost: u16,
    pub damage: u16,
    pub range: u16,
    pub cooldown_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopOffer {
    pub id: String,
    pub item_definition_id: String,
    pub quantity: u16,
    pub price: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Position {
    pub x: i32,
    pub y: i32,
    pub z: i16,
}

impl Position {
    pub fn is_adjacent_to(self, other: Self) -> bool {
        self.z == other.z
            && (self.x - other.x).abs() <= 1
            && (self.y - other.y).abs() <= 1
            && self != other
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub id: EntityId,
    pub name: String,
    pub vocation: String,
    pub position: Position,
    pub health: u16,
    pub max_health: u16,
    pub level: u32,
    pub experience: u64,
    pub mana: u16,
    pub max_mana: u16,
    pub sword_skill: u16,
    pub sword_tries: u32,
    pub distance_skill: u16,
    pub distance_tries: u32,
    pub fletching_skill: u16,
    pub fletching_tries: u32,
    pub magic_level: u16,
    pub magic_tries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneRecipe {
    pub id: String,
    pub name: String,
    #[serde(default = "default_sigils_kind")]
    pub craft_kind: String,
    pub input_definition_id: String,
    #[serde(default = "default_quantity")]
    pub input_quantity: u16,
    pub output_definition_id: String,
    #[serde(default = "default_quantity")]
    pub output_quantity: u16,
    pub mana_cost: u16,
    pub craft_time_ms: u64,
}

fn default_sigils_kind() -> String {
    "sigils".into()
}

fn default_quantity() -> u16 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureDefinition {
    pub id: String,
    pub name: String,
    pub health: u16,
    pub experience: u64,
    pub speed: u16,
    pub attacks: Vec<CreatureAttack>,
    #[serde(default)]
    pub loot: Vec<LootEntry>,
    pub corpse_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureAttack {
    #[serde(rename = "type")]
    pub attack_type: String,
    pub min_damage: u16,
    pub max_damage: u16,
    #[serde(default = "default_attack_interval")]
    pub interval_ms: u64,
    #[serde(default = "default_attack_range")]
    pub range: u16,
    #[serde(default)]
    pub radius: u16,
    #[serde(default)]
    pub telegraph_ms: u64,
    #[serde(default)]
    pub effect_id: String,
}

fn default_attack_interval() -> u64 {
    1_200
}

fn default_attack_range() -> u16 {
    1
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LootEntry {
    pub definition_id: String,
    pub chance: f32,
    pub min_quantity: u16,
    pub max_quantity: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureView {
    pub id: EntityId,
    pub definition_id: String,
    pub name: String,
    pub position: Position,
    pub health: u16,
    pub max_health: u16,
    pub state: String,
    pub immune: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacency_includes_diagonals_but_not_other_floors() {
        let origin = Position { x: 5, y: 5, z: 7 };
        assert!(origin.is_adjacent_to(Position { x: 6, y: 6, z: 7 }));
        assert!(!origin.is_adjacent_to(Position { x: 7, y: 5, z: 7 }));
        assert!(!origin.is_adjacent_to(Position { x: 5, y: 6, z: 8 }));
    }

    #[test]
    fn playable_vocations_have_distinct_resource_profiles() {
        let warrior = playable_vocation("warrior").unwrap();
        let mage = playable_vocation("mage").unwrap();
        assert!(warrior.max_health > mage.max_health);
        assert!(warrior.capacity > mage.capacity);
        assert!(mage.max_mana > warrior.max_mana);
        assert_eq!(playable_vocation("ranger").unwrap().distance_training, 2);
        assert!(playable_vocation("ranger").unwrap().distance_skill > warrior.distance_skill);
        assert!(!warrior.can_craft_sigils);
        assert!(mage.can_craft_sigils);
        assert!(playable_vocation("adventurer").is_none());
    }
}
