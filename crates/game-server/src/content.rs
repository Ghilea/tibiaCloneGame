use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::PathBuf,
};

use anyhow::{Context, bail};
use game_types::{
    CreatureDefinition, ItemDefinition, MAX_SKILL_LEVEL, RuneRecipe, SpellDefinition,
};
use tracing::info;

#[derive(Debug, Clone)]
pub struct ContentCatalog {
    items: HashMap<String, ItemDefinition>,
    creatures: HashMap<String, CreatureDefinition>,
    rune_recipes: HashMap<String, RuneRecipe>,
    spells: HashMap<String, SpellDefinition>,
}

impl ContentCatalog {
    pub fn load() -> anyhow::Result<Self> {
        let root = env::var("CONTENT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../content"));
        let path = root.join("items/items.json");
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("read item content from {}", path.display()))?;
        let definitions: Vec<ItemDefinition> =
            serde_json::from_str(&raw).context("parse item definitions")?;
        let creature_path = root.join("creatures/creatures.json");
        let creature_raw = fs::read_to_string(&creature_path)
            .with_context(|| format!("read creature content from {}", creature_path.display()))?;
        let creatures: Vec<CreatureDefinition> =
            serde_json::from_str(&creature_raw).context("parse creature definitions")?;
        let rune_path = root.join("runes/runes.json");
        let rune_raw = fs::read_to_string(&rune_path)
            .with_context(|| format!("read rune content from {}", rune_path.display()))?;
        let rune_recipes: Vec<RuneRecipe> =
            serde_json::from_str(&rune_raw).context("parse rune recipes")?;
        let spell_path = root.join("spells/spells.json");
        let spell_raw = fs::read_to_string(&spell_path)
            .with_context(|| format!("read spell content from {}", spell_path.display()))?;
        let spells: Vec<SpellDefinition> =
            serde_json::from_str(&spell_raw).context("parse spell definitions")?;
        let catalog = Self::from_all_content(definitions, creatures, rune_recipes, spells)?;
        info!(
            items = catalog.items.len(),
            creatures = catalog.creatures.len(),
            rune_recipes = catalog.rune_recipes.len(),
            spells = catalog.spells.len(),
            "content validated"
        );
        Ok(catalog)
    }

    pub fn from_definitions(definitions: Vec<ItemDefinition>) -> anyhow::Result<Self> {
        let mut seen = HashSet::new();
        let mut items = HashMap::new();
        for definition in definitions {
            if definition.id.is_empty()
                || !definition
                    .id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            {
                bail!("invalid stable item id: {}", definition.id);
            }
            if !seen.insert(definition.id.clone()) {
                bail!("duplicate item id: {}", definition.id);
            }
            if definition.name.trim().is_empty()
                || !definition.weight.is_finite()
                || definition.weight < 0.0
            {
                bail!("invalid item definition: {}", definition.id);
            }
            if definition.max_stack == 0 || (!definition.stackable && definition.max_stack != 1) {
                bail!("invalid maxStack for item: {}", definition.id);
            }
            if definition.container_slots == Some(0)
                || definition
                    .equipment_slot
                    .as_ref()
                    .is_some_and(|slot| slot.trim().is_empty())
            {
                bail!("invalid item capabilities: {}", definition.id);
            }
            if definition.combat_effect.as_ref().is_some_and(|effect| {
                effect.damage == 0
                    || effect.range == 0
                    || effect.cooldown_ms < 250
                    || definition.charges.is_none()
            }) {
                bail!("invalid combat effect: {}", definition.id);
            }
            if definition.distance_weapon.as_ref().is_some_and(|weapon| {
                weapon.damage == 0
                    || weapon.range < 2
                    || weapon.cooldown_ms < 250
                    || weapon.ammunition_id.is_empty()
                    || definition.equipment_slot.as_deref() != Some("weapon")
            }) {
                bail!("invalid distance weapon: {}", definition.id);
            }
            if definition.food_effect.as_ref().is_some_and(|food| {
                food.duration_seconds == 0
                    || food.duration_seconds > 600
                    || (food.health_per_tick == 0 && food.mana_per_tick == 0)
            }) {
                bail!("invalid food effect: {}", definition.id);
            }
            if definition.light_source.as_ref().is_some_and(|light| {
                !light.radius.is_finite()
                    || !light.intensity.is_finite()
                    || !(2.0..=40.0).contains(&light.radius)
                    || !(0.1..=20.0).contains(&light.intensity)
                    || definition.equipment_slot.is_none()
            }) {
                bail!("invalid equipped light source: {}", definition.id);
            }
            items.insert(definition.id.clone(), definition);
        }
        if items.is_empty() {
            bail!("at least one item definition is required");
        }
        for definition in items.values() {
            if let Some(weapon) = &definition.distance_weapon
                && !items.contains_key(&weapon.ammunition_id)
            {
                bail!("unknown ammunition on distance weapon: {}", definition.id);
            }
        }
        Ok(Self {
            items,
            creatures: HashMap::new(),
            rune_recipes: HashMap::new(),
            spells: HashMap::new(),
        })
    }

    pub fn from_all(
        items: Vec<ItemDefinition>,
        creatures: Vec<CreatureDefinition>,
    ) -> anyhow::Result<Self> {
        let mut catalog = Self::from_definitions(items)?;
        catalog.validate_creatures(creatures)?;
        Ok(catalog)
    }

    pub fn from_all_with_recipes(
        items: Vec<ItemDefinition>,
        creatures: Vec<CreatureDefinition>,
        recipes: Vec<RuneRecipe>,
    ) -> anyhow::Result<Self> {
        let mut catalog = Self::from_all(items, creatures)?;
        catalog.validate_rune_recipes(recipes)?;
        for definition in catalog.items.values() {
            if let Some(recipe_id) = &definition.teaches_recipe_id
                && !catalog.rune_recipes.contains_key(recipe_id)
            {
                bail!("unknown recipe on learning item: {}", definition.id);
            }
        }
        Ok(catalog)
    }

    pub fn from_all_content(
        items: Vec<ItemDefinition>,
        creatures: Vec<CreatureDefinition>,
        recipes: Vec<RuneRecipe>,
        spells: Vec<SpellDefinition>,
    ) -> anyhow::Result<Self> {
        let mut catalog = Self::from_all_with_recipes(items, creatures, recipes)?;
        catalog.validate_spells(spells)?;
        Ok(catalog)
    }

    pub fn item(&self, id: &str) -> Option<&ItemDefinition> {
        self.items.get(id)
    }
    pub fn item_definitions(&self) -> Vec<ItemDefinition> {
        self.items.values().cloned().collect()
    }

    pub fn creature(&self, id: &str) -> Option<&CreatureDefinition> {
        self.creatures.get(id)
    }

    pub fn rune_recipe(&self, id: &str) -> Option<&RuneRecipe> {
        self.rune_recipes.get(id)
    }
    pub fn rune_recipes(&self) -> Vec<RuneRecipe> {
        self.rune_recipes.values().cloned().collect()
    }

    pub fn spell(&self, id: &str) -> Option<&SpellDefinition> {
        self.spells.get(id)
    }
    pub fn spells(&self) -> Vec<SpellDefinition> {
        self.spells.values().cloned().collect()
    }

    fn validate_spells(&mut self, spells: Vec<SpellDefinition>) -> anyhow::Result<()> {
        for spell in spells {
            let stable_id = !spell.id.is_empty()
                && spell
                    .id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if !stable_id
                || self.spells.contains_key(&spell.id)
                || spell.name.trim().is_empty()
                || spell.description.trim().is_empty()
                || spell.required_magic_level > MAX_SKILL_LEVEL
                || spell.price == 0
                || spell.mana_cost == 0
                || spell.damage == 0
                || spell.range == 0
                || spell.cooldown_ms < 250
            {
                bail!("invalid or duplicate spell: {}", spell.id);
            }
            self.spells.insert(spell.id.clone(), spell);
        }
        if self.spells.is_empty() {
            bail!("at least one spell definition is required");
        }
        Ok(())
    }

    fn validate_rune_recipes(&mut self, recipes: Vec<RuneRecipe>) -> anyhow::Result<()> {
        for recipe in recipes {
            if recipe.id.is_empty()
                || self.rune_recipes.contains_key(&recipe.id)
                || recipe.craft_time_ms < 250
                || recipe.input_quantity == 0
                || recipe.output_quantity == 0
                || !matches!(
                    recipe.craft_kind.as_str(),
                    "sigils" | "fletching" | "mining"
                )
                || recipe.required_skill_level > MAX_SKILL_LEVEL
                || (recipe.craft_kind == "sigils" && recipe.mana_cost == 0)
                || !self.items.contains_key(&recipe.input_definition_id)
                || !self.items.contains_key(&recipe.output_definition_id)
            {
                bail!("invalid or duplicate rune recipe: {}", recipe.id);
            }
            self.rune_recipes.insert(recipe.id.clone(), recipe);
        }
        if self.rune_recipes.is_empty() {
            bail!("at least one rune recipe is required");
        }
        Ok(())
    }

    fn validate_creatures(&mut self, definitions: Vec<CreatureDefinition>) -> anyhow::Result<()> {
        for definition in definitions {
            if self.creatures.contains_key(&definition.id)
                || definition.health == 0
                || definition.attacks.is_empty()
            {
                bail!("invalid or duplicate creature: {}", definition.id);
            }
            let corpse = self
                .items
                .get(&definition.corpse_id)
                .ok_or_else(|| anyhow::anyhow!("unknown corpse on creature: {}", definition.id))?;
            if corpse.container_slots.is_none() || corpse.pickupable {
                bail!(
                    "corpse must be a non-pickupable container: {}",
                    definition.id
                );
            }
            for attack in &definition.attacks {
                if !matches!(attack.attack_type.as_str(), "melee" | "ranged" | "area")
                    || attack.min_damage > attack.max_damage
                    || attack.interval_ms == 0
                    || attack.range == 0
                    || (attack.attack_type == "area"
                        && (attack.radius == 0 || attack.telegraph_ms == 0))
                {
                    bail!("invalid attack on creature: {}", definition.id);
                }
            }
            for loot in &definition.loot {
                if !self.items.contains_key(&loot.definition_id)
                    || !(0.0..=1.0).contains(&loot.chance)
                    || loot.min_quantity == 0
                    || loot.min_quantity > loot.max_quantity
                {
                    bail!("invalid loot on creature: {}", definition.id);
                }
            }
            self.creatures.insert(definition.id.clone(), definition);
        }
        if self.creatures.is_empty() {
            bail!("at least one creature definition is required");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> ItemDefinition {
        ItemDefinition {
            id: id.into(),
            name: "Test".into(),
            weight: 1.0,
            stackable: false,
            max_stack: 1,
            charges: None,
            attack: None,
            container_slots: None,
            equipment_slot: None,
            pickupable: true,
            combat_effect: None,
            distance_weapon: None,
            food_effect: None,
            teaches_recipe_id: None,
            light_source: None,
        }
    }

    #[test]
    fn rejects_duplicate_stable_ids() {
        assert!(
            ContentCatalog::from_definitions(vec![item("test_item"), item("test_item")]).is_err()
        );
    }

    #[test]
    fn loads_project_content() {
        let catalog = ContentCatalog::load().unwrap();
        assert!(catalog.item("blank_rune").is_some());
        assert!(catalog.spell("ember_bolt").is_some());
        assert!(catalog.creature("mire_skulker").is_some());
        assert!(catalog.creature("reed_stalker").is_some());
        assert!(catalog.creature("fen_brute").is_some());
    }
}
