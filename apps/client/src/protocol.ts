export const PROTOCOL_VERSION = 24;
export const CLIENT_VERSION = "0.1.0";

export type Position = { x: number; y: number; z: number };
export type PlayerView = {
  id: string;
  name: string;
  outfit: CharacterOutfit;
  secondarySkills: SecondarySkill[];
  position: Position;
  health: number;
  maxHealth: number;
  level: number;
  experience: number;
  mana: number;
  maxMana: number;
  swordSkill: number;
  swordTries: number;
  distanceSkill: number;
  distanceTries: number;
  fletchingSkill: number;
  fletchingTries: number;
  magicLevel: number;
  magicTries: number;
};
export type CharacterOutfit = "knight" | "mage" | "ranger" | "rogue";
export type SecondarySkill = "alchemy" | "mining" | "woodcutting" | "fishing" | "cooking";
export type CreatureView = { id: string; definitionId: string; name: string; position: Position; health: number; maxHealth: number; state: string; immune: boolean };
export type MapView = {
  width: number;
  height: number;
  floor: number;
  blocked: Position[];
  water: Position[];
  bridges: Position[];
  trees: Position[];
  roads: Position[];
  floors: Position[];
  houseWalls: Position[];
  castleWalls: Position[];
  windows: WindowView[];
  torches: Position[];
  terrainMaterials: TerrainMaterialView[];
  buildings: BuildingView[];
  doors: DoorView[];
  stairs: StairView[];
};
export type TerrainMaterialId = "packed_earth" | "moss_stone" | "sandstone";
export type TerrainMaterialView = { position: Position; material: TerrainMaterialId };
export type BuildingView = { id: string; name: string; kind: "keep" | "house"; x: number; y: number; width: number; height: number; floor: number };
export type DoorView = { id: string; position: Position; open: boolean };
export type WindowView = { id: string; position: Position; open: boolean };
export type StairView = { id: string; from: Position; to: Position };
export type ItemDefinition = { id: string; name: string; weight: number; stackable: boolean; maxStack: number; charges?: number; attack?: number; containerSlots?: number; equipmentSlot?: string; pickupable: boolean; combatEffect?: { damage: number; range: number; cooldownMs: number }; distanceWeapon?: { damage: number; range: number; cooldownMs: number; ammunitionId: string }; foodEffect?: { healthPerTick: number; manaPerTick: number; durationSeconds: number }; teachesRecipeId?: string };
export type ItemInstance = { instanceId: string; definitionId: string; quantity: number; charges?: number; containerId?: string; equippedSlot?: string };
export type GroundItem = { item: ItemInstance; position: Position; contents: ItemInstance[] };
export type ShopOffer = { id: string; itemDefinitionId: string; quantity: number; price: number };
export type NpcView = { id: string; name: string; title: string; service: "shop" | "depot" | "spell_trainer" | "craft_trainer"; dialogue: string; position: Position; offers: ShopOffer[]; spellIds: string[]; recipeIds: string[] };
export type RuneRecipe = { id: string; name: string; craftKind: "sigils" | "fletching"; inputDefinitionId: string; inputQuantity: number; outputDefinitionId: string; outputQuantity: number; manaCost: number; craftTimeMs: number; learnPrice: number; requiredSkillLevel: number };
export type SpellDefinition = { id: string; name: string; description: string; requiredMagicLevel: number; price: number; manaCost: number; damage: number; range: number; cooldownMs: number };

export type ClientMessage =
  | { type: "hello"; protocol_version: number; client_version: string; session_token?: string; character_id?: string; character_name?: string }
  | { type: "move_request"; sequence: number; position: Position }
  | { type: "toggle_door"; door_id: string }
  | { type: "toggle_window"; window_id: string }
  | { type: "say"; text: string }
  | { type: "ping"; sent_at: number }
  | { type: "set_outfit"; outfit: CharacterOutfit }
  | { type: "set_secondary_skills"; skills: SecondarySkill[] }
  | { type: "pickup_item"; instance_id: string }
  | { type: "drop_item"; instance_id: string }
  | { type: "move_item"; instance_id: string; destination: { kind: "root" } | { kind: "container"; container_id: string } | { kind: "equipment"; slot: string } }
  | { type: "split_item"; instance_id: string; quantity: number }
  | { type: "attack_request"; target_id: string }
  | { type: "start_rune_crafting"; recipe_id: string; quantity: number }
  | { type: "cancel_rune_crafting" }
  | { type: "use_item"; instance_id: string; target_id: string }
  | { type: "eat_item"; instance_id: string }
  | { type: "request_trade"; target_id: string }
  | { type: "respond_trade"; trade_id: string; accept: boolean }
  | { type: "set_trade_offer"; trade_id: string; item_ids: string[] }
  | { type: "confirm_trade"; trade_id: string }
  | { type: "cancel_trade"; trade_id: string }
  | { type: "buy_from_npc"; npc_id: string; offer_id: string; quantity: number }
  | { type: "deposit_item"; npc_id: string; instance_id: string }
  | { type: "withdraw_item"; npc_id: string; instance_id: string }
  | { type: "learn_spell"; npc_id: string; spell_id: string }
  | { type: "learn_recipe_from_npc"; npc_id: string; recipe_id: string }
  | { type: "learn_recipe_from_item"; instance_id: string }
  | { type: "cast_spell"; spell_id: string; target_id: string };

export type ServerMessage =
  | { type: "welcome"; protocol_version: number; player: PlayerView; players: PlayerView[]; map: MapView; item_definitions: ItemDefinition[]; rune_recipes: RuneRecipe[]; spells: SpellDefinition[]; learned_spell_ids: string[]; learned_recipe_ids: string[]; inventory: ItemInstance[]; depot: ItemInstance[]; inventory_weight: number; max_capacity: number; ground_items: GroundItem[]; creatures: CreatureView[]; npcs: NpcView[] }
  | { type: "world_region"; map: MapView; ground_items: GroundItem[]; creatures: CreatureView[]; npcs: NpcView[] }
  | { type: "player_joined"; player: PlayerView }
  | { type: "player_left"; player_id: string }
  | { type: "player_moved"; player_id: string; position: Position; sequence: number }
  | { type: "move_rejected"; player_id: string; position: Position; sequence: number; reason: string }
  | { type: "door_changed"; door: DoorView }
  | { type: "window_changed"; window: WindowView }
  | { type: "spoken"; player_id: string; player_name: string; text: string }
  | { type: "pong"; player_id: string; sent_at: number }
  | { type: "player_outfit_changed"; player_id: string; outfit: CharacterOutfit }
  | { type: "player_secondary_skills_changed"; player_id: string; skills: SecondarySkill[] }
  | { type: "inventory_changed"; player_id: string; inventory: ItemInstance[]; inventory_weight: number; max_capacity: number }
  | { type: "depot_changed"; player_id: string; depot: ItemInstance[] }
  | { type: "spells_changed"; player_id: string; learned_spell_ids: string[] }
  | { type: "recipes_changed"; player_id: string; learned_recipe_ids: string[] }
  | { type: "ground_items_changed"; ground_items: GroundItem[] }
  | { type: "food_status"; player_id: string; remaining_ms: number }
  | { type: "combat_effect"; source_id: string; target_id: string; effect_id: string; damage: number; cooldown_ms: number }
  | { type: "area_telegraph"; source_id: string; position: Position; effect_id: string; radius: number; duration_ms: number }
  | { type: "trade_requested"; trade_id: string; requester: PlayerView }
  | { type: "trade_state"; trade_id: string; partner: PlayerView; your_offer: ItemInstance[]; their_offer: ItemInstance[]; you_confirmed: boolean; partner_confirmed: boolean; status: "pending" | "active" }
  | { type: "trade_closed"; trade_id: string; reason: string }
  | { type: "creature_spawned"; creature: CreatureView }
  | { type: "creature_moved"; creature_id: string; position: Position }
  | { type: "creature_state_changed"; creature_id: string; state: string; immune: boolean; health: number; max_health: number }
  | { type: "creature_damaged"; creature_id: string; health: number; max_health: number; damage: number }
  | { type: "creature_died"; creature_id: string; killer_id: string; experience: number }
  | { type: "player_stats_changed"; player_id: string; health: number; max_health: number; level: number; experience: number; mana: number; max_mana: number; sword_skill: number; sword_tries: number; distance_skill: number; distance_tries: number; fletching_skill: number; fletching_tries: number; magic_level: number; magic_tries: number }
  | { type: "rune_crafting_changed"; player_id: string; recipe_id: string | null; remaining: number; status: string }
  | { type: "player_died"; player_id: string; killer_id: string }
  | { type: "error"; code: string; message: string };
