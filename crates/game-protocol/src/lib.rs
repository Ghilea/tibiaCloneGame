use game_types::{
    CreatureView, GroundItem, ItemDefinition, ItemInstance, NpcView, PlayerView, Position,
    RuneRecipe, SpellDefinition,
};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 19;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        protocol_version: u16,
        client_version: String,
        session_token: Option<String>,
        character_id: Option<game_types::EntityId>,
        character_name: Option<String>,
    },
    MoveRequest {
        sequence: u32,
        position: Position,
    },
    ToggleDoor {
        door_id: String,
    },
    ToggleWindow {
        window_id: String,
    },
    Say {
        text: String,
    },
    Ping {
        sent_at: u64,
    },
    PickupItem {
        instance_id: game_types::EntityId,
    },
    DropItem {
        instance_id: game_types::EntityId,
    },
    MoveItem {
        instance_id: game_types::EntityId,
        destination: ItemDestination,
    },
    SplitItem {
        instance_id: game_types::EntityId,
        quantity: u16,
    },
    AttackRequest {
        target_id: game_types::EntityId,
    },
    StartRuneCrafting {
        recipe_id: String,
        quantity: u16,
    },
    CancelRuneCrafting,
    UseItem {
        instance_id: game_types::EntityId,
        target_id: game_types::EntityId,
    },
    EatItem {
        instance_id: game_types::EntityId,
    },
    RequestTrade {
        target_id: game_types::EntityId,
    },
    RespondTrade {
        trade_id: game_types::EntityId,
        accept: bool,
    },
    SetTradeOffer {
        trade_id: game_types::EntityId,
        item_ids: Vec<game_types::EntityId>,
    },
    ConfirmTrade {
        trade_id: game_types::EntityId,
    },
    CancelTrade {
        trade_id: game_types::EntityId,
    },
    BuyFromNpc {
        npc_id: String,
        offer_id: String,
        quantity: u16,
    },
    DepositItem {
        npc_id: String,
        instance_id: game_types::EntityId,
    },
    WithdrawItem {
        npc_id: String,
        instance_id: game_types::EntityId,
    },
    LearnSpell {
        npc_id: String,
        spell_id: String,
    },
    CastSpell {
        spell_id: String,
        target_id: game_types::EntityId,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ItemDestination {
    Root,
    Container { container_id: game_types::EntityId },
    Equipment { slot: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        protocol_version: u16,
        player: PlayerView,
        players: Vec<PlayerView>,
        map: MapView,
        item_definitions: Vec<ItemDefinition>,
        rune_recipes: Vec<RuneRecipe>,
        spells: Vec<SpellDefinition>,
        learned_spell_ids: Vec<String>,
        inventory: Vec<ItemInstance>,
        depot: Vec<ItemInstance>,
        inventory_weight: f32,
        max_capacity: f32,
        ground_items: Vec<GroundItem>,
        creatures: Vec<CreatureView>,
        npcs: Vec<NpcView>,
    },
    PlayerJoined {
        player: PlayerView,
    },
    PlayerLeft {
        player_id: game_types::EntityId,
    },
    PlayerMoved {
        player_id: game_types::EntityId,
        position: Position,
        sequence: u32,
    },
    MoveRejected {
        player_id: game_types::EntityId,
        position: Position,
        sequence: u32,
        reason: String,
    },
    DoorChanged {
        door: DoorView,
    },
    WindowChanged {
        window: WindowView,
    },
    Spoken {
        player_id: game_types::EntityId,
        player_name: String,
        text: String,
    },
    Pong {
        player_id: game_types::EntityId,
        sent_at: u64,
    },
    InventoryChanged {
        player_id: game_types::EntityId,
        inventory: Vec<ItemInstance>,
        inventory_weight: f32,
        max_capacity: f32,
    },
    DepotChanged {
        player_id: game_types::EntityId,
        depot: Vec<ItemInstance>,
    },
    SpellsChanged {
        player_id: game_types::EntityId,
        learned_spell_ids: Vec<String>,
    },
    GroundItemsChanged {
        ground_items: Vec<GroundItem>,
    },
    FoodStatus {
        player_id: game_types::EntityId,
        remaining_ms: u64,
    },
    CombatEffect {
        source_id: game_types::EntityId,
        target_id: game_types::EntityId,
        effect_id: String,
        damage: u16,
        cooldown_ms: u64,
    },
    AreaTelegraph {
        source_id: game_types::EntityId,
        position: Position,
        effect_id: String,
        radius: u16,
        duration_ms: u64,
    },
    TradeRequested {
        trade_id: game_types::EntityId,
        requester: PlayerView,
    },
    TradeState {
        trade_id: game_types::EntityId,
        partner: PlayerView,
        your_offer: Vec<ItemInstance>,
        their_offer: Vec<ItemInstance>,
        you_confirmed: bool,
        partner_confirmed: bool,
        status: String,
    },
    TradeClosed {
        trade_id: game_types::EntityId,
        reason: String,
    },
    CreatureSpawned {
        creature: CreatureView,
    },
    CreatureMoved {
        creature_id: game_types::EntityId,
        position: Position,
    },
    CreatureStateChanged {
        creature_id: game_types::EntityId,
        state: String,
        immune: bool,
        health: u16,
        max_health: u16,
    },
    CreatureDamaged {
        creature_id: game_types::EntityId,
        health: u16,
        max_health: u16,
        damage: u16,
    },
    CreatureDied {
        creature_id: game_types::EntityId,
        killer_id: game_types::EntityId,
        experience: u64,
    },
    RuneCraftingChanged {
        player_id: game_types::EntityId,
        recipe_id: Option<String>,
        remaining: u16,
        status: String,
    },
    PlayerStatsChanged {
        player_id: game_types::EntityId,
        health: u16,
        max_health: u16,
        level: u32,
        experience: u64,
        mana: u16,
        max_mana: u16,
        sword_skill: u16,
        sword_tries: u32,
        distance_skill: u16,
        distance_tries: u32,
        fletching_skill: u16,
        fletching_tries: u32,
        magic_level: u16,
        magic_tries: u32,
    },
    PlayerDied {
        player_id: game_types::EntityId,
        killer_id: game_types::EntityId,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapView {
    pub width: i32,
    pub height: i32,
    pub floor: i16,
    pub blocked: Vec<Position>,
    pub water: Vec<Position>,
    pub bridges: Vec<Position>,
    pub trees: Vec<Position>,
    pub roads: Vec<Position>,
    pub floors: Vec<Position>,
    pub house_walls: Vec<Position>,
    pub castle_walls: Vec<Position>,
    #[serde(default)]
    pub windows: Vec<WindowView>,
    #[serde(default)]
    pub torches: Vec<Position>,
    #[serde(default)]
    pub terrain_materials: Vec<TerrainMaterialView>,
    pub buildings: Vec<BuildingView>,
    pub doors: Vec<DoorView>,
    pub stairs: Vec<StairView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainMaterialView {
    pub position: Position,
    pub material: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildingView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub floor: i16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DoorView {
    pub id: String,
    pub position: Position,
    pub open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowView {
    pub id: String,
    pub position: Position,
    pub open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StairView {
    pub id: String,
    pub from: Position,
    pub to: Position,
}
