use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    path::Path,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use anyhow::{Context, bail};
use game_protocol::{
    BuildingView, DoorView, ItemDestination, MapView, StairView, TerrainMaterialView, WindowView,
};
use game_types::{
    CreatureAttack, CreatureView, EntityId, GroundItem, ItemDefinition, ItemInstance, NpcView,
    PlayerView, Position, RuneRecipe, SpellDefinition, vocation_profile,
};
use serde::Deserialize;
use tracing::info;

use crate::content::ContentCatalog;

pub const SPAWN: Position = Position { x: 10, y: 8, z: 7 };
// The client walks at 165 ms. A small acceptance margin prevents ordinary
// packet jitter from compressing two valid steps into a false rejection.
const MOVE_COOLDOWN: Duration = Duration::from_millis(145);
const PLAYER_ATTACK_COOLDOWN: Duration = Duration::from_millis(650);
// A defeated hunting spot should stay cleared long enough for the kill to feel
// meaningful and for players to loot before the same creature returns.
const CREATURE_RESPAWN: Duration = Duration::from_secs(30);
const CORPSE_DECAY: Duration = Duration::from_secs(45);
const EMPTY_CORPSE_DECAY: Duration = Duration::from_secs(10);
const MANA_REGEN_INTERVAL: Duration = Duration::from_secs(2);
const CREATURE_AGGRO_RANGE: i32 = 6;
const CREATURE_LEASH_RANGE: i32 = 8;
const CREATURE_UNREACHABLE_TIMEOUT: Duration = Duration::from_millis(1_500);
const MAX_WORLD_DIMENSION: i32 = 16_384;
static BLOCKED_TILE_SET: OnceLock<HashSet<Position>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct Player {
    pub view: PlayerView,
    pub inventory: Vec<ItemInstance>,
    pub depot: Vec<ItemInstance>,
    pub max_capacity: f32,
    pub last_move: Instant,
    pub last_attack: Instant,
    pub last_item_use: Instant,
    pub last_spell_cast: Instant,
    pub learned_spells: HashSet<String>,
    pub crafting_queue: Option<CraftingQueue>,
    pub last_mana_regen: Instant,
    pub active_food: Option<ActiveFood>,
    pub last_food_regen: Instant,
}

#[derive(Debug, Clone)]
pub struct ActiveFood {
    until: Instant,
    health_per_tick: u16,
    mana_per_tick: u16,
}

#[derive(Debug, Clone)]
pub struct CraftingQueue {
    recipe_id: String,
    remaining: u16,
    ready_at: Instant,
    last_status: &'static str,
}

#[derive(Debug, Clone)]
pub struct CraftingUpdate {
    pub player: PlayerView,
    pub recipe_id: Option<String>,
    pub remaining: u16,
    pub status: &'static str,
    pub inventory_changed: bool,
}

#[derive(Debug, Clone)]
struct TradeSession {
    id: EntityId,
    player_a: EntityId,
    player_b: EntityId,
    offer_a: Vec<EntityId>,
    offer_b: Vec<EntityId>,
    confirmed_a: bool,
    confirmed_b: bool,
    active: bool,
}

#[derive(Debug, Clone)]
pub struct TradeView {
    pub trade_id: EntityId,
    pub recipient_id: EntityId,
    pub partner: PlayerView,
    pub your_offer: Vec<ItemInstance>,
    pub their_offer: Vec<ItemInstance>,
    pub you_confirmed: bool,
    pub partner_confirmed: bool,
    pub status: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TradeOutcome {
    Updated,
    Completed {
        player_a: EntityId,
        player_b: EntityId,
    },
    Cancelled {
        player_a: EntityId,
        player_b: EntityId,
    },
}

#[derive(Debug, Clone)]
struct Creature {
    view: CreatureView,
    spawn_index: usize,
    target: Option<EntityId>,
    last_attack: Instant,
    state: CreatureState,
    unreachable_since: Option<Instant>,
    pending_attack: Option<PendingCreatureAttack>,
}

#[derive(Debug, Clone)]
struct PendingCreatureAttack {
    execute_at: Instant,
    position: Position,
    attack: CreatureAttack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreatureState {
    Idle,
    Chasing,
    Attacking,
    Returning,
}

impl CreatureState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Chasing => "chasing",
            Self::Attacking => "attacking",
            Self::Returning => "returning",
        }
    }
}

#[derive(Debug, Clone)]
struct Spawn {
    definition_id: String,
    position: Position,
    active_id: Option<EntityId>,
    respawn_at: Instant,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldSpawnDocument {
    id: String,
    definition_id: String,
    position: Position,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldDocument {
    version: u16,
    name: String,
    width: i32,
    height: i32,
    floor: i16,
    blocked: Vec<Position>,
    water: Vec<Position>,
    #[serde(default)]
    bridges: Vec<Position>,
    #[serde(default)]
    trees: Vec<Position>,
    roads: Vec<Position>,
    floors: Vec<Position>,
    house_walls: Vec<Position>,
    castle_walls: Vec<Position>,
    #[serde(default)]
    windows: Vec<Position>,
    #[serde(default)]
    torches: Vec<Position>,
    #[serde(default)]
    terrain_materials: Vec<TerrainMaterialView>,
    buildings: Vec<BuildingView>,
    doors: Vec<DoorView>,
    stairs: Vec<StairView>,
    spawns: Vec<WorldSpawnDocument>,
    #[serde(default)]
    npcs: Vec<NpcView>,
    #[serde(default)]
    player_spawn: Option<Position>,
}

#[derive(Debug, Clone)]
struct WorldMap {
    view: MapView,
    blocked: HashSet<Position>,
    walkable_upper_tiles: HashSet<Position>,
    player_spawn: Position,
    spatial: MapSpatialIndex,
}

const MAP_STREAM_CHUNK_SIZE: i32 = 32;
type MapChunkKey = (i16, i32, i32);

#[derive(Debug, Clone, Default)]
struct PositionChunkIndex {
    chunks: HashMap<MapChunkKey, Vec<u32>>,
}

impl PositionChunkIndex {
    fn from_positions(positions: &[Position]) -> Self {
        let mut chunks: HashMap<MapChunkKey, Vec<u32>> = HashMap::new();
        for (index, position) in positions.iter().enumerate() {
            chunks
                .entry((
                    position.z,
                    position.x.div_euclid(MAP_STREAM_CHUNK_SIZE),
                    position.y.div_euclid(MAP_STREAM_CHUNK_SIZE),
                ))
                .or_default()
                .push(u32::try_from(index).expect("world layer exceeds index capacity"));
        }
        Self { chunks }
    }

    fn near<T, F>(&self, entries: &[T], center: Position, radius: i32, position: F) -> Vec<T>
    where
        T: Clone,
        F: Fn(&T) -> Position,
    {
        let min_chunk_x = (center.x - radius).div_euclid(MAP_STREAM_CHUNK_SIZE);
        let max_chunk_x = (center.x + radius).div_euclid(MAP_STREAM_CHUNK_SIZE);
        let min_chunk_y = (center.y - radius).div_euclid(MAP_STREAM_CHUNK_SIZE);
        let max_chunk_y = (center.y + radius).div_euclid(MAP_STREAM_CHUNK_SIZE);
        let mut result = Vec::new();
        for chunk_y in min_chunk_y..=max_chunk_y {
            for chunk_x in min_chunk_x..=max_chunk_x {
                let Some(indices) = self.chunks.get(&(center.z, chunk_x, chunk_y)) else {
                    continue;
                };
                result.extend(indices.iter().filter_map(|index| {
                    let entry = entries.get(*index as usize)?;
                    position_in_region(position(entry), center, radius).then(|| entry.clone())
                }));
            }
        }
        result
    }
}

#[derive(Debug, Clone)]
struct MapSpatialIndex {
    blocked: PositionChunkIndex,
    water: PositionChunkIndex,
    bridges: PositionChunkIndex,
    trees: PositionChunkIndex,
    roads: PositionChunkIndex,
    floors: PositionChunkIndex,
    house_walls: PositionChunkIndex,
    castle_walls: PositionChunkIndex,
    torches: PositionChunkIndex,
    terrain_materials: PositionChunkIndex,
}

impl MapSpatialIndex {
    fn new(view: &MapView) -> Self {
        let terrain_positions: Vec<_> = view
            .terrain_materials
            .iter()
            .map(|entry| entry.position)
            .collect();
        Self {
            blocked: PositionChunkIndex::from_positions(&view.blocked),
            water: PositionChunkIndex::from_positions(&view.water),
            bridges: PositionChunkIndex::from_positions(&view.bridges),
            trees: PositionChunkIndex::from_positions(&view.trees),
            roads: PositionChunkIndex::from_positions(&view.roads),
            floors: PositionChunkIndex::from_positions(&view.floors),
            house_walls: PositionChunkIndex::from_positions(&view.house_walls),
            castle_walls: PositionChunkIndex::from_positions(&view.castle_walls),
            torches: PositionChunkIndex::from_positions(&view.torches),
            terrain_materials: PositionChunkIndex::from_positions(&terrain_positions),
        }
    }
}

impl WorldMap {
    fn default_greyhaven() -> Self {
        Self::from_view(map_view()).expect("built-in Greyhaven map is valid")
    }

    fn from_view(mut view: MapView) -> anyhow::Result<Self> {
        if view.width <= 0
            || view.height <= 0
            || view.width > MAX_WORLD_DIMENSION
            || view.height > MAX_WORLD_DIMENSION
        {
            bail!("world dimensions must be between 1 and {MAX_WORLD_DIMENSION} tiles");
        }
        align_house_buildings_to_authored_walls(&mut view);
        view.buildings.extend(infer_house_buildings(&view));
        let mut object_ids = HashSet::new();
        for (kind, id) in view
            .buildings
            .iter()
            .map(|building| ("building", building.id.as_str()))
            .chain(view.doors.iter().map(|door| ("door", door.id.as_str())))
            .chain(
                view.windows
                    .iter()
                    .map(|window| ("window", window.id.as_str())),
            )
            .chain(
                view.stairs
                    .iter()
                    .map(|stairs| ("stairs", stairs.id.as_str())),
            )
        {
            if id.trim().is_empty() || !object_ids.insert((kind, id)) {
                bail!("{kind} ids must be non-empty and unique: {id}");
            }
        }
        for building in &view.buildings {
            if building.width < 3
                || building.height < 3
                || building.x < 0
                || building.y < 0
                || building.x + building.width > view.width
                || building.y + building.height > view.height
            {
                bail!("building is outside world bounds: {}", building.id);
            }
        }
        if view.terrain_materials.iter().any(|entry| {
            !matches!(
                entry.material.as_str(),
                "packed_earth" | "moss_stone" | "sandstone"
            )
        }) {
            bail!("terrain material must be packed_earth, moss_stone, or sandstone");
        }
        let mut material_positions = HashSet::new();
        if view
            .terrain_materials
            .iter()
            .any(|entry| !material_positions.insert(entry.position))
        {
            bail!("only one terrain material can occupy a tile");
        }
        let water: HashSet<_> = view.water.iter().copied().collect();
        let walls: HashSet<_> = view
            .house_walls
            .iter()
            .chain(view.castle_walls.iter())
            .copied()
            .collect();
        let trees: HashSet<_> = view.trees.iter().copied().collect();
        if view.bridges.iter().any(|position| {
            !water.contains(position) || walls.contains(position) || trees.contains(position)
        }) {
            bail!("bridges must be placed on water without overlapping walls or trees");
        }
        view.blocked.extend(view.water.iter().copied());
        view.blocked.extend(view.house_walls.iter().copied());
        view.blocked.extend(view.castle_walls.iter().copied());
        view.blocked.extend(view.trees.iter().copied());
        let bridges: HashSet<_> = view.bridges.iter().copied().collect();
        view.blocked.retain(|position| !bridges.contains(position));
        let authored_house_walls: HashSet<_> = view.house_walls.iter().copied().collect();
        let mut canonical_house_walls = HashSet::new();
        for building in view
            .buildings
            .iter()
            .filter(|building| building.kind == "house")
        {
            let max_x = building.x + building.width - 1;
            let max_y = building.y + building.height - 1;
            for x in building.x..=max_x {
                for position in [
                    Position {
                        x,
                        y: building.y,
                        z: building.floor,
                    },
                    Position {
                        x,
                        y: max_y,
                        z: building.floor,
                    },
                ] {
                    if authored_house_walls.contains(&position) {
                        canonical_house_walls.insert(position);
                    }
                }
            }
            for y in building.y + 1..max_y {
                for position in [
                    Position {
                        x: building.x,
                        y,
                        z: building.floor,
                    },
                    Position {
                        x: max_x,
                        y,
                        z: building.floor,
                    },
                ] {
                    if authored_house_walls.contains(&position) {
                        canonical_house_walls.insert(position);
                    }
                }
            }
        }
        view.blocked
            .retain(|position| !canonical_house_walls.contains(position));
        sort_positions(&mut view.blocked);
        for position in map_positions(&view) {
            if position.x < 0
                || position.y < 0
                || position.x >= view.width
                || position.y >= view.height
            {
                bail!("map position is outside world bounds: {position:?}");
            }
        }
        let blocked = view.blocked.iter().copied().collect();
        let walkable_upper_tiles = view
            .floors
            .iter()
            .chain(view.roads.iter())
            .chain(view.bridges.iter())
            .chain(view.doors.iter().map(|door| &door.position))
            .chain(
                view.stairs
                    .iter()
                    .flat_map(|stairs| [&stairs.from, &stairs.to]),
            )
            .filter(|position| position.z != view.floor)
            .copied()
            .collect();
        let spatial = MapSpatialIndex::new(&view);
        let mut map = Self {
            view,
            blocked,
            walkable_upper_tiles,
            player_spawn: SPAWN,
            spatial,
        };
        if !map.is_walkable(map.player_spawn) {
            map.player_spawn = map
                .first_safe_base_tile()
                .ok_or_else(|| anyhow::anyhow!("world has no walkable player spawn tile"))?;
        }
        Ok(map)
    }

    fn load(
        path: &Path,
        content: &ContentCatalog,
    ) -> anyhow::Result<(Self, Vec<Spawn>, Vec<NpcView>, String)> {
        let load_started = Instant::now();
        let file_size_mb = fs::metadata(path)
            .map(|metadata| metadata.len() as f64 / 1_048_576.0)
            .unwrap_or(0.0);
        info!(progress = 25, path = %path.display(), file_size_mb = format_args!("{file_size_mb:.1}"), "server startup: reading world file");
        let raw = fs::read_to_string(path)
            .with_context(|| format!("read world document from {}", path.display()))?;
        info!(
            progress = 40,
            elapsed_ms = load_started.elapsed().as_millis(),
            "server startup: world file read, parsing JSON"
        );
        let document: WorldDocument = serde_json::from_str(&raw)
            .with_context(|| format!("parse world document from {}", path.display()))?;
        info!(
            progress = 55,
            elapsed_ms = load_started.elapsed().as_millis(),
            "server startup: JSON parsed, validating geometry"
        );
        if document.version != 1 {
            bail!("unsupported world document version: {}", document.version);
        }
        if document.name.trim().is_empty() {
            bail!("world name cannot be empty");
        }
        let mut spawn_ids = HashSet::new();
        let spawn_documents = document.spawns;
        let requested_player_spawn = document.player_spawn;
        let mut map = Self::from_view(MapView {
            width: document.width,
            height: document.height,
            floor: document.floor,
            blocked: document.blocked,
            water: document.water,
            bridges: document.bridges,
            trees: document.trees,
            roads: document.roads,
            floors: document.floors,
            house_walls: document.house_walls,
            castle_walls: document.castle_walls,
            windows: document
                .windows
                .into_iter()
                .map(|position| WindowView {
                    id: format!("window_{}_{}_{}", position.z, position.x, position.y),
                    position,
                    open: false,
                })
                .collect(),
            torches: document.torches,
            terrain_materials: document.terrain_materials,
            buildings: document.buildings,
            doors: document.doors,
            stairs: document.stairs,
        })?;
        info!(
            progress = 82,
            elapsed_ms = load_started.elapsed().as_millis(),
            "server startup: geometry validated and chunk index built"
        );
        if let Some(player_spawn) = requested_player_spawn {
            if !map.is_walkable(player_spawn) {
                bail!("playerSpawn is not on a walkable tile: {player_spawn:?}");
            }
            map.player_spawn = player_spawn;
        }
        let mut spawns = Vec::with_capacity(spawn_documents.len());
        for spawn in spawn_documents {
            if spawn.id.trim().is_empty() || !spawn_ids.insert(spawn.id.clone()) {
                bail!("spawn ids must be non-empty and unique: {}", spawn.id);
            }
            if content.creature(&spawn.definition_id).is_none() {
                bail!("spawn references unknown creature: {}", spawn.definition_id);
            }
            if !map.is_walkable(spawn.position) {
                bail!("spawn is not on a walkable tile: {}", spawn.id);
            }
            spawns.push(Spawn {
                definition_id: spawn.definition_id,
                position: spawn.position,
                active_id: None,
                respawn_at: Instant::now(),
            });
        }
        if spawns
            .iter()
            .any(|spawn| spawn.position == map.player_spawn)
        {
            bail!("playerSpawn cannot overlap a creature spawn");
        }
        let mut npc_ids = HashSet::new();
        let mut npc_positions = HashSet::new();
        for npc in &document.npcs {
            let stable_id = !npc.id.is_empty()
                && npc.id.chars().all(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
                });
            if !stable_id || !npc_ids.insert(npc.id.clone()) {
                bail!("NPC ids must be stable and unique: {}", npc.id);
            }
            if npc.name.trim().is_empty()
                || npc.title.trim().is_empty()
                || npc.dialogue.trim().is_empty()
                || npc.name.len() > 40
                || npc.title.len() > 80
                || npc.dialogue.len() > 500
                || !matches!(npc.service.as_str(), "shop" | "depot" | "spell_trainer")
            {
                bail!("invalid NPC profile: {}", npc.id);
            }
            if !map.is_walkable(npc.position)
                || npc.position == map.player_spawn
                || spawns.iter().any(|spawn| spawn.position == npc.position)
                || !npc_positions.insert(npc.position)
            {
                bail!("NPC is not on a unique walkable tile: {}", npc.id);
            }
            let mut offer_ids = HashSet::new();
            if npc.offers.iter().any(|offer| {
                npc.service != "shop"
                    || offer.id.trim().is_empty()
                    || !offer_ids.insert(offer.id.clone())
                    || offer.quantity == 0
                    || offer.price == 0
                    || content.item(&offer.item_definition_id).is_none()
            }) {
                bail!("invalid shop offer on NPC: {}", npc.id);
            }
            if npc
                .spell_ids
                .iter()
                .any(|spell_id| npc.service != "spell_trainer" || content.spell(spell_id).is_none())
            {
                bail!("invalid spell list on NPC: {}", npc.id);
            }
        }
        info!(
            progress = 92,
            elapsed_ms = load_started.elapsed().as_millis(),
            spawns = spawns.len(),
            npcs = document.npcs.len(),
            "server startup: world entities validated"
        );
        Ok((map, spawns, document.npcs, document.name))
    }

    fn is_walkable(&self, position: Position) -> bool {
        let in_bounds = position.x >= 0
            && position.y >= 0
            && position.x < self.view.width
            && position.y < self.view.height;
        let floor_exists =
            position.z == self.view.floor || self.walkable_upper_tiles.contains(&position);
        in_bounds && floor_exists && !self.blocked.contains(&position)
    }

    fn house_wall_crossing(&self, from: Position, to: Position) -> Option<Position> {
        if from.z != to.z || (from.x - to.x).abs() + (from.y - to.y).abs() != 1 {
            return None;
        }
        for building in self
            .view
            .buildings
            .iter()
            .filter(|building| building.kind == "house" && building.floor == from.z)
        {
            let max_x = building.x + building.width;
            let max_y = building.y + building.height;
            if from.x == to.x && from.x >= building.x && from.x < max_x {
                if (from.y == building.y - 1 && to.y == building.y)
                    || (to.y == building.y - 1 && from.y == building.y)
                {
                    return Some(Position {
                        x: from.x,
                        y: building.y,
                        z: from.z,
                    });
                }
                if (from.y == max_y - 1 && to.y == max_y) || (to.y == max_y - 1 && from.y == max_y)
                {
                    return Some(Position {
                        x: from.x,
                        y: max_y - 1,
                        z: from.z,
                    });
                }
            }
            if from.y == to.y && from.y >= building.y && from.y < max_y {
                if (from.x == building.x - 1 && to.x == building.x)
                    || (to.x == building.x - 1 && from.x == building.x)
                {
                    return Some(Position {
                        x: building.x,
                        y: from.y,
                        z: from.z,
                    });
                }
                if (from.x == max_x - 1 && to.x == max_x) || (to.x == max_x - 1 && from.x == max_x)
                {
                    return Some(Position {
                        x: max_x - 1,
                        y: from.y,
                        z: from.z,
                    });
                }
            }
        }
        None
    }

    fn is_house_wall_anchor(&self, position: Position) -> bool {
        self.view.buildings.iter().any(|building| {
            if building.kind != "house" || building.floor != position.z {
                return false;
            }
            let max_x = building.x + building.width - 1;
            let max_y = building.y + building.height - 1;
            position.x >= building.x
                && position.x <= max_x
                && position.y >= building.y
                && position.y <= max_y
                && (position.x == building.x
                    || position.x == max_x
                    || position.y == building.y
                    || position.y == max_y)
        })
    }

    fn stair_destination(&self, position: Position) -> Option<Position> {
        self.view
            .stairs
            .iter()
            .find(|stairs| stairs.from == position)
            .map(|stairs| stairs.to)
    }

    fn first_safe_base_tile(&self) -> Option<Position> {
        for y in 0..self.view.height {
            for x in 0..self.view.width {
                let position = Position {
                    x,
                    y,
                    z: self.view.floor,
                };
                if self.is_walkable(position) {
                    return Some(position);
                }
            }
        }
        None
    }
}

fn map_positions(view: &MapView) -> impl Iterator<Item = Position> + '_ {
    view.blocked
        .iter()
        .chain(view.water.iter())
        .chain(view.bridges.iter())
        .chain(view.trees.iter())
        .chain(view.roads.iter())
        .chain(view.floors.iter())
        .chain(view.house_walls.iter())
        .chain(view.castle_walls.iter())
        .chain(view.windows.iter().map(|window| &window.position))
        .chain(view.torches.iter())
        .copied()
        .chain(view.terrain_materials.iter().map(|entry| entry.position))
        .chain(view.doors.iter().map(|door| door.position))
        .chain(
            view.stairs
                .iter()
                .flat_map(|stairs| [stairs.from, stairs.to]),
        )
}

fn infer_house_buildings(view: &MapView) -> Vec<BuildingView> {
    let mut explicit_building_tiles = HashSet::new();
    for building in &view.buildings {
        for y in building.y..building.y + building.height {
            for x in building.x..building.x + building.width {
                explicit_building_tiles.insert(Position {
                    x,
                    y,
                    z: building.floor,
                });
            }
        }
    }
    let walls: HashSet<_> = view
        .house_walls
        .iter()
        .copied()
        .filter(|position| !explicit_building_tiles.contains(position))
        .collect();
    let wall_or_door: HashSet<_> = walls
        .iter()
        .copied()
        .chain(view.doors.iter().map(|door| door.position))
        .collect();
    let mut remaining = walls.clone();
    let mut inferred = Vec::new();
    for first in walls.iter().copied() {
        if !remaining.remove(&first) {
            continue;
        }
        let mut frontier = VecDeque::from([first]);
        let mut component = Vec::new();
        while let Some(current) = frontier.pop_front() {
            component.push(current);
            for adjacent in [
                Position {
                    x: current.x - 1,
                    ..current
                },
                Position {
                    x: current.x + 1,
                    ..current
                },
                Position {
                    y: current.y - 1,
                    ..current
                },
                Position {
                    y: current.y + 1,
                    ..current
                },
            ] {
                if remaining.remove(&adjacent) {
                    frontier.push_back(adjacent);
                }
            }
        }
        let min_x = component
            .iter()
            .map(|position| position.x)
            .min()
            .unwrap_or(0);
        let max_x = component
            .iter()
            .map(|position| position.x)
            .max()
            .unwrap_or(0);
        let min_y = component
            .iter()
            .map(|position| position.y)
            .min()
            .unwrap_or(0);
        let max_y = component
            .iter()
            .map(|position| position.y)
            .max()
            .unwrap_or(0);
        let floor = first.z;
        let width = max_x - min_x + 1;
        let height = max_y - min_y + 1;
        if width < 3 || height < 3 {
            continue;
        }
        let closed =
            rectangular_outline_is_closed(&wall_or_door, floor, min_x, min_y, max_x, max_y);
        if closed {
            inferred.push(BuildingView {
                id: format!("manual_house_{floor}_{min_x}_{min_y}"),
                name: "Authored House".into(),
                kind: "house".into(),
                x: min_x,
                y: min_y,
                width,
                height,
                floor,
            });
        }
    }
    inferred
}

#[derive(Debug, Clone, Copy)]
struct HouseOutline {
    floor: i16,
    min_x: i32,
    min_y: i32,
    max_x: i32,
    max_y: i32,
}

fn align_house_buildings_to_authored_walls(view: &mut MapView) {
    let walls: HashSet<_> = view.house_walls.iter().copied().collect();
    let wall_or_door: HashSet<_> = walls
        .iter()
        .copied()
        .chain(view.doors.iter().map(|door| door.position))
        .collect();
    let mut remaining = walls;
    let mut outlines = Vec::new();
    let wall_seeds: Vec<_> = remaining.iter().copied().collect();
    for first in wall_seeds {
        if !remaining.remove(&first) {
            continue;
        }
        let mut frontier = VecDeque::from([first]);
        let mut component = vec![first];
        while let Some(current) = frontier.pop_front() {
            for adjacent in [
                Position {
                    x: current.x - 1,
                    ..current
                },
                Position {
                    x: current.x + 1,
                    ..current
                },
                Position {
                    y: current.y - 1,
                    ..current
                },
                Position {
                    y: current.y + 1,
                    ..current
                },
            ] {
                if remaining.remove(&adjacent) {
                    component.push(adjacent);
                    frontier.push_back(adjacent);
                }
            }
        }
        let min_x = component
            .iter()
            .map(|position| position.x)
            .min()
            .unwrap_or(first.x);
        let max_x = component
            .iter()
            .map(|position| position.x)
            .max()
            .unwrap_or(first.x);
        let min_y = component
            .iter()
            .map(|position| position.y)
            .min()
            .unwrap_or(first.y);
        let max_y = component
            .iter()
            .map(|position| position.y)
            .max()
            .unwrap_or(first.y);
        if max_x - min_x + 1 < 3 || max_y - min_y + 1 < 3 {
            continue;
        }
        let closed =
            rectangular_outline_is_closed(&wall_or_door, first.z, min_x, min_y, max_x, max_y);
        if closed {
            outlines.push(HouseOutline {
                floor: first.z,
                min_x,
                min_y,
                max_x,
                max_y,
            });
        }
    }

    for building in view
        .buildings
        .iter_mut()
        .filter(|building| building.kind == "house")
    {
        let current_max_x = building.x + building.width - 1;
        let current_max_y = building.y + building.height - 1;
        let Some(outline) = outlines
            .iter()
            .filter(|outline| {
                outline.floor == building.floor
                    && outline.max_x >= building.x - 1
                    && outline.min_x <= current_max_x + 1
                    && outline.max_y >= building.y - 1
                    && outline.min_y <= current_max_y + 1
            })
            .min_by_key(|outline| {
                (outline.min_x - building.x).abs()
                    + (outline.min_y - building.y).abs()
                    + (outline.max_x - current_max_x).abs()
                    + (outline.max_y - current_max_y).abs()
            })
        else {
            continue;
        };
        building.x = outline.min_x;
        building.y = outline.min_y;
        building.width = outline.max_x - outline.min_x + 1;
        building.height = outline.max_y - outline.min_y + 1;
    }
}

fn rectangular_outline_is_closed(
    walls: &HashSet<Position>,
    floor: i16,
    min_x: i32,
    min_y: i32,
    max_x: i32,
    max_y: i32,
) -> bool {
    (min_x..=max_x).all(|x| {
        walls.contains(&Position {
            x,
            y: min_y,
            z: floor,
        }) && walls.contains(&Position {
            x,
            y: max_y,
            z: floor,
        })
    }) && (min_y + 1..max_y).all(|y| {
        walls.contains(&Position {
            x: min_x,
            y,
            z: floor,
        }) && walls.contains(&Position {
            x: max_x,
            y,
            z: floor,
        })
    })
}

fn sort_positions(positions: &mut Vec<Position>) {
    positions.sort_by_key(|position| (position.z, position.y, position.x));
    positions.dedup();
}

#[derive(Debug, Clone)]
pub enum WorldEvent {
    CombatEffect {
        source_id: EntityId,
        target_id: EntityId,
        effect_id: String,
        damage: u16,
        cooldown_ms: u64,
    },
    AreaTelegraph {
        source_id: EntityId,
        position: Position,
        effect_id: String,
        radius: u16,
        duration_ms: u64,
    },
    CreatureSpawned(CreatureView),
    CreatureMoved {
        creature_id: EntityId,
        position: Position,
    },
    CreatureStateChanged {
        creature_id: EntityId,
        state: &'static str,
        immune: bool,
        health: u16,
        max_health: u16,
    },
    CreatureDamaged {
        creature_id: EntityId,
        health: u16,
        max_health: u16,
        damage: u16,
    },
    CreatureDied {
        creature_id: EntityId,
        killer_id: EntityId,
        experience: u64,
    },
    PlayerStats(PlayerView),
    PlayerDied {
        player_id: EntityId,
        killer_id: EntityId,
    },
    GroundItemsChanged(Vec<GroundItem>),
}

#[derive(Debug, Clone)]
pub struct World {
    players: HashMap<EntityId, Player>,
    ground_items: Vec<GroundItem>,
    ground_decay: HashMap<EntityId, Instant>,
    content: ContentCatalog,
    creatures: HashMap<EntityId, Creature>,
    spawns: Vec<Spawn>,
    trades: HashMap<EntityId, TradeSession>,
    npcs: Vec<NpcView>,
    doors: HashMap<String, DoorView>,
    windows: HashMap<String, WindowView>,
    map: Arc<WorldMap>,
}

#[derive(Clone)]
pub struct GroundStateBackup {
    items: Vec<GroundItem>,
    decay: HashMap<EntityId, Instant>,
}

#[derive(Clone)]
pub struct PlayerStateBackup {
    players: HashMap<EntityId, Player>,
}

#[derive(Clone)]
pub struct CombatStateBackup {
    player_id: EntityId,
    player: Player,
    creature_id: EntityId,
    creature: Creature,
    spawn: Spawn,
    ground: GroundStateBackup,
}

impl World {
    pub fn new(content: ContentCatalog, ground_items: Vec<GroundItem>) -> Self {
        Self::with_map(
            content,
            ground_items,
            WorldMap::default_greyhaven(),
            None,
            None,
        )
    }

    pub fn from_environment(
        content: ContentCatalog,
        ground_items: Vec<GroundItem>,
    ) -> anyhow::Result<(Self, Option<(String, String)>)> {
        let Some(path) = env::var_os("WORLD_FILE") else {
            return Ok((Self::new(content, ground_items), None));
        };
        let path = std::path::PathBuf::from(path);
        let (map, spawns, npcs, name) = WorldMap::load(&path, &content)?;
        let display_path = path.display().to_string();
        Ok((
            Self::with_map(content, ground_items, map, Some(spawns), Some(npcs)),
            Some((name, display_path)),
        ))
    }

    fn with_map(
        content: ContentCatalog,
        ground_items: Vec<GroundItem>,
        map: WorldMap,
        requested_spawns: Option<Vec<Spawn>>,
        requested_npcs: Option<Vec<NpcView>>,
    ) -> Self {
        let ground_decay = ground_items
            .iter()
            .filter(|ground| is_corpse(&ground.item))
            .map(|ground| (ground.item.instance_id, Instant::now() + CORPSE_DECAY))
            .collect();
        let doors = map
            .view
            .doors
            .iter()
            .cloned()
            .map(|door| (door.id.clone(), door))
            .collect();
        let windows = map
            .view
            .windows
            .iter()
            .cloned()
            .map(|window| (window.id.clone(), window))
            .collect();
        let mut world = Self {
            players: HashMap::new(),
            ground_items,
            ground_decay,
            content,
            creatures: HashMap::new(),
            spawns: requested_spawns.unwrap_or_else(|| {
                vec![
                    Spawn {
                        definition_id: "mireling".into(),
                        position: Position { x: 23, y: 8, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mireling".into(),
                        position: Position { x: 23, y: 17, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mireling".into(),
                        position: Position { x: 25, y: 8, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mire_skulker".into(),
                        position: Position { x: 25, y: 10, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mire_skulker".into(),
                        position: Position { x: 28, y: 18, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mire_skulker".into(),
                        position: Position { x: 30, y: 5, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "reed_stalker".into(),
                        position: Position { x: 32, y: 14, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "reed_stalker".into(),
                        position: Position { x: 35, y: 12, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "fen_brute".into(),
                        position: Position { x: 37, y: 6, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "fen_brute".into(),
                        position: Position { x: 37, y: 23, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mire_skulker".into(),
                        position: Position { x: 42, y: 11, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "reed_stalker".into(),
                        position: Position { x: 45, y: 23, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "reed_stalker".into(),
                        position: Position { x: 50, y: 9, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "fen_brute".into(),
                        position: Position { x: 51, y: 25, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "mireling".into(),
                        position: Position { x: 41, y: 34, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "fen_brute".into(),
                        position: Position { x: 52, y: 33, z: 7 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "castle_rat".into(),
                        position: Position { x: 5, y: 6, z: 8 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "crypt_guard".into(),
                        position: Position { x: 11, y: 6, z: 8 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "bone_acolyte".into(),
                        position: Position { x: 15, y: 11, z: 8 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                    Spawn {
                        definition_id: "cellar_warden".into(),
                        position: Position { x: 17, y: 5, z: 8 },
                        active_id: None,
                        respawn_at: Instant::now(),
                    },
                ]
            }),
            trades: HashMap::new(),
            doors,
            windows,
            map: Arc::new(map),
            npcs: requested_npcs.unwrap_or_else(default_npcs),
        };
        world.npcs.retain(|npc| {
            world.map.is_walkable(npc.position) && npc.position != world.map.player_spawn
        });
        for index in 0..world.spawns.len() {
            world.spawn(index);
        }
        world
    }

    pub fn insert_player(&mut self, player: Player) {
        self.players.insert(player.view.id, player);
    }
    pub fn remove_player(&mut self, id: EntityId) {
        self.players.remove(&id);
    }
    pub fn player(&self, id: EntityId) -> Option<&Player> {
        self.players.get(&id)
    }
    pub fn contains_player(&self, id: EntityId) -> bool {
        self.players.contains_key(&id)
    }
    pub fn views(&self) -> Vec<PlayerView> {
        self.players.values().map(|p| p.view.clone()).collect()
    }
    pub fn ground_items(&self) -> &[GroundItem] {
        &self.ground_items
    }

    pub fn ground_state_backup(&self) -> GroundStateBackup {
        GroundStateBackup {
            items: self.ground_items.clone(),
            decay: self.ground_decay.clone(),
        }
    }

    pub fn restore_ground_state(&mut self, backup: GroundStateBackup) {
        self.ground_items = backup.items;
        self.ground_decay = backup.decay;
    }

    pub fn player_state_backup(&self) -> PlayerStateBackup {
        PlayerStateBackup {
            players: self.players.clone(),
        }
    }

    pub fn restore_player_state(&mut self, backup: PlayerStateBackup) {
        self.players = backup.players;
    }

    pub fn combat_state_backup(
        &self,
        player_id: EntityId,
        creature_id: EntityId,
    ) -> Option<CombatStateBackup> {
        let player = self.players.get(&player_id)?.clone();
        let creature = self.creatures.get(&creature_id)?.clone();
        let spawn = self.spawns.get(creature.spawn_index)?.clone();
        Some(CombatStateBackup {
            player_id,
            player,
            creature_id,
            creature,
            spawn,
            ground: self.ground_state_backup(),
        })
    }

    pub fn restore_combat_state(&mut self, backup: CombatStateBackup) {
        let spawn_index = backup.creature.spawn_index;
        self.players.insert(backup.player_id, backup.player);
        self.creatures.insert(backup.creature_id, backup.creature);
        self.spawns[spawn_index] = backup.spawn;
        self.restore_ground_state(backup.ground);
    }
    pub fn item_definitions(&self) -> Vec<ItemDefinition> {
        self.content.item_definitions()
    }
    pub fn rune_recipes(&self) -> Vec<RuneRecipe> {
        self.content.rune_recipes()
    }
    pub fn spells(&self) -> Vec<SpellDefinition> {
        self.content.spells()
    }
    pub fn learned_spells(&self, id: EntityId) -> Option<Vec<String>> {
        let mut spells: Vec<_> = self
            .players
            .get(&id)?
            .learned_spells
            .iter()
            .cloned()
            .collect();
        spells.sort();
        Some(spells)
    }
    #[cfg(test)]
    pub fn creature_views(&self) -> Vec<CreatureView> {
        self.creatures
            .values()
            .map(|creature| creature.view.clone())
            .collect()
    }
    #[cfg(test)]
    pub fn npc_views(&self) -> Vec<NpcView> {
        self.npcs.clone()
    }

    pub fn creature_views_near(&self, center: Position, radius: i32) -> Vec<CreatureView> {
        self.creatures
            .values()
            .filter(|creature| position_in_region(creature.view.position, center, radius))
            .map(|creature| creature.view.clone())
            .collect()
    }

    pub fn npc_views_near(&self, center: Position, radius: i32) -> Vec<NpcView> {
        self.npcs
            .iter()
            .filter(|npc| position_in_region(npc.position, center, radius))
            .cloned()
            .collect()
    }

    pub fn ground_items_near(&self, center: Position, radius: i32) -> Vec<GroundItem> {
        self.ground_items
            .iter()
            .filter(|item| position_in_region(item.position, center, radius))
            .cloned()
            .collect()
    }

    pub fn buy_from_npc(
        &mut self,
        player_id: EntityId,
        npc_id: &str,
        offer_id: &str,
        quantity: u16,
    ) -> Result<(), &'static str> {
        if !(1..=20).contains(&quantity) {
            return Err("invalid_shop_quantity");
        }
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == player_id || trade.player_b == player_id)
        {
            return Err("cannot_shop_while_trading");
        }
        let npc = self
            .npcs
            .iter()
            .find(|npc| npc.id == npc_id)
            .ok_or("npc_not_found")?;
        let offer = npc
            .offers
            .iter()
            .find(|offer| offer.id == offer_id)
            .cloned()
            .ok_or("shop_offer_not_found")?;
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        if !within_reach(player.view.position, npc.position) {
            return Err("npc_out_of_reach");
        }
        let cost = u32::from(offer.price) * u32::from(quantity);
        let gold: u32 = player
            .inventory
            .iter()
            .filter(|item| item.definition_id == "gold_coin")
            .map(|item| u32::from(item.quantity))
            .sum();
        if gold < cost {
            return Err("not_enough_gold");
        }
        let definition = self
            .content
            .item(&offer.item_definition_id)
            .cloned()
            .ok_or("unknown_item_definition")?;
        let mut inventory = player.inventory.clone();
        consume_crafting_material(
            &mut inventory,
            "gold_coin",
            u16::try_from(cost).map_err(|_| "invalid_shop_quantity")?,
        )
        .expect("gold amount was checked");
        add_crafted_output(
            &mut inventory,
            &definition,
            offer.quantity.saturating_mul(quantity),
            (None, None),
        );
        if self.inventory_weight(&inventory) > player.max_capacity + f32::EPSILON {
            return Err("shop_capacity_exceeded");
        }
        self.players
            .get_mut(&player_id)
            .expect("player was checked")
            .inventory = inventory;
        Ok(())
    }

    pub fn learn_spell(
        &mut self,
        player_id: EntityId,
        npc_id: &str,
        spell_id: &str,
    ) -> Result<(), &'static str> {
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == player_id || trade.player_b == player_id)
        {
            return Err("cannot_learn_while_trading");
        }
        let npc = self
            .npcs
            .iter()
            .find(|npc| npc.id == npc_id && npc.service == "spell_trainer")
            .ok_or("spell_trainer_not_found")?;
        if !npc.spell_ids.iter().any(|id| id == spell_id) {
            return Err("spell_not_taught_here");
        }
        let spell = self
            .content
            .spell(spell_id)
            .cloned()
            .ok_or("spell_not_found")?;
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        if !within_reach(player.view.position, npc.position) {
            return Err("npc_out_of_reach");
        }
        if player.learned_spells.contains(spell_id) {
            return Err("spell_already_learned");
        }
        if !spell
            .vocations
            .iter()
            .any(|vocation| vocation == &player.view.vocation)
        {
            return Err("vocation_cannot_learn_spell");
        }
        let gold: u32 = player
            .inventory
            .iter()
            .filter(|item| item.definition_id == "gold_coin")
            .map(|item| u32::from(item.quantity))
            .sum();
        if gold < u32::from(spell.price) {
            return Err("not_enough_gold");
        }
        let mut inventory = player.inventory.clone();
        consume_crafting_material(&mut inventory, "gold_coin", spell.price)
            .expect("gold amount was checked");
        let player = self
            .players
            .get_mut(&player_id)
            .expect("player was checked");
        player.inventory = inventory;
        player.learned_spells.insert(spell.id);
        Ok(())
    }

    pub fn depot_state(&self, id: EntityId) -> Option<Vec<ItemInstance>> {
        Some(self.players.get(&id)?.depot.clone())
    }

    pub fn deposit_item(
        &mut self,
        player_id: EntityId,
        npc_id: &str,
        instance_id: EntityId,
    ) -> Result<(), &'static str> {
        self.validate_depot_access(player_id, npc_id)?;
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let item = player
            .inventory
            .iter()
            .find(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        if item.container_id.is_some() || item.equipped_slot.is_some() {
            return Err("depot_requires_root_item");
        }
        if player
            .depot
            .iter()
            .filter(|item| item.container_id.is_none())
            .count()
            >= 200
        {
            return Err("depot_full");
        }
        let moving = item_tree_ids(&player.inventory, instance_id);
        let player = self
            .players
            .get_mut(&player_id)
            .expect("player was checked");
        let mut transferred = Vec::new();
        player.inventory.retain(|item| {
            if moving.contains(&item.instance_id) {
                transferred.push(item.clone());
                false
            } else {
                true
            }
        });
        player.depot.extend(transferred);
        Ok(())
    }

    pub fn withdraw_item(
        &mut self,
        player_id: EntityId,
        npc_id: &str,
        instance_id: EntityId,
    ) -> Result<(), &'static str> {
        self.validate_depot_access(player_id, npc_id)?;
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let item = player
            .depot
            .iter()
            .find(|item| item.instance_id == instance_id)
            .ok_or("depot_item_not_found")?;
        if item.container_id.is_some() {
            return Err("depot_requires_root_item");
        }
        let moving = item_tree_ids(&player.depot, instance_id);
        let transferred: Vec<_> = player
            .depot
            .iter()
            .filter(|item| moving.contains(&item.instance_id))
            .cloned()
            .collect();
        let mut combined = player.inventory.clone();
        combined.extend(transferred.iter().cloned());
        if self.inventory_weight(&combined) > player.max_capacity + f32::EPSILON {
            return Err("too_heavy");
        }
        let player = self
            .players
            .get_mut(&player_id)
            .expect("player was checked");
        player
            .depot
            .retain(|item| !moving.contains(&item.instance_id));
        player.inventory.extend(transferred);
        Ok(())
    }

    fn validate_depot_access(&self, player_id: EntityId, npc_id: &str) -> Result<(), &'static str> {
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == player_id || trade.player_b == player_id)
        {
            return Err("cannot_use_depot_while_trading");
        }
        let npc = self
            .npcs
            .iter()
            .find(|npc| npc.id == npc_id && npc.service == "depot")
            .ok_or("depot_not_found")?;
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        if !within_reach(player.view.position, npc.position) {
            return Err("npc_out_of_reach");
        }
        Ok(())
    }

    pub fn inventory_state(&self, id: EntityId) -> Option<(Vec<ItemInstance>, f32, f32)> {
        let player = self.players.get(&id)?;
        Some((
            player.inventory.clone(),
            self.inventory_weight(&player.inventory),
            player.max_capacity,
        ))
    }

    pub fn request_trade(
        &mut self,
        requester_id: EntityId,
        target_id: EntityId,
    ) -> Result<EntityId, &'static str> {
        if requester_id == target_id {
            return Err("trade_with_self");
        }
        let requester = self.players.get(&requester_id).ok_or("unknown_player")?;
        let target = self.players.get(&target_id).ok_or("trade_target_offline")?;
        if tile_distance(requester.view.position, target.view.position) > 2 {
            return Err("trade_target_too_far");
        }
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == requester_id || trade.player_b == requester_id)
        {
            return Err("already_trading");
        }
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == target_id || trade.player_b == target_id)
        {
            return Err("trade_target_busy");
        }
        let trade_id = uuid::Uuid::new_v4();
        self.trades.insert(
            trade_id,
            TradeSession {
                id: trade_id,
                player_a: requester_id,
                player_b: target_id,
                offer_a: Vec::new(),
                offer_b: Vec::new(),
                confirmed_a: false,
                confirmed_b: false,
                active: false,
            },
        );
        Ok(trade_id)
    }

    pub fn respond_trade(
        &mut self,
        player_id: EntityId,
        trade_id: EntityId,
        accept: bool,
    ) -> Result<TradeOutcome, &'static str> {
        let trade = self.trades.get(&trade_id).ok_or("trade_not_found")?;
        if trade.player_b != player_id || trade.active {
            return Err("invalid_trade_response");
        }
        if !accept {
            let trade = self.trades.remove(&trade_id).expect("trade exists");
            return Ok(TradeOutcome::Cancelled {
                player_a: trade.player_a,
                player_b: trade.player_b,
            });
        }
        let player_a = self
            .players
            .get(&trade.player_a)
            .ok_or("trade_partner_offline")?;
        let player_b = self
            .players
            .get(&trade.player_b)
            .ok_or("trade_partner_offline")?;
        if tile_distance(player_a.view.position, player_b.view.position) > 2 {
            return Err("trade_target_too_far");
        }
        self.trades.get_mut(&trade_id).expect("trade exists").active = true;
        Ok(TradeOutcome::Updated)
    }

    pub fn set_trade_offer(
        &mut self,
        player_id: EntityId,
        trade_id: EntityId,
        item_ids: Vec<EntityId>,
    ) -> Result<(), &'static str> {
        if item_ids.len() > 20 {
            return Err("trade_offer_too_large");
        }
        let mut unique = item_ids.clone();
        unique.sort_unstable();
        unique.dedup();
        if unique.len() != item_ids.len() {
            return Err("duplicate_trade_item");
        }
        let trade = self.trades.get(&trade_id).ok_or("trade_not_found")?.clone();
        if !trade.active || (trade.player_a != player_id && trade.player_b != player_id) {
            return Err("trade_not_active");
        }
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        for item_id in &item_ids {
            let item = player
                .inventory
                .iter()
                .find(|item| item.instance_id == *item_id)
                .ok_or("item_not_owned")?;
            if item.container_id.is_some()
                || item.equipped_slot.is_some()
                || player
                    .inventory
                    .iter()
                    .any(|child| child.container_id == Some(*item_id))
            {
                return Err("item_not_tradeable");
            }
        }
        let trade = self.trades.get_mut(&trade_id).expect("trade exists");
        if trade.player_a == player_id {
            trade.offer_a = item_ids;
        } else {
            trade.offer_b = item_ids;
        }
        trade.confirmed_a = false;
        trade.confirmed_b = false;
        Ok(())
    }

    pub fn confirm_trade(
        &mut self,
        player_id: EntityId,
        trade_id: EntityId,
    ) -> Result<TradeOutcome, &'static str> {
        let trade = self.trades.get(&trade_id).ok_or("trade_not_found")?.clone();
        if !trade.active || (trade.player_a != player_id && trade.player_b != player_id) {
            return Err("trade_not_active");
        }
        let player_a = self
            .players
            .get(&trade.player_a)
            .ok_or("trade_partner_offline")?;
        let player_b = self
            .players
            .get(&trade.player_b)
            .ok_or("trade_partner_offline")?;
        if tile_distance(player_a.view.position, player_b.view.position) > 2 {
            return Err("trade_target_too_far");
        }
        self.validate_trade_offer(player_a, &trade.offer_a)?;
        self.validate_trade_offer(player_b, &trade.offer_b)?;

        let session = self.trades.get_mut(&trade_id).expect("trade exists");
        if session.player_a == player_id {
            session.confirmed_a = true;
        } else {
            session.confirmed_b = true;
        }
        if !session.confirmed_a || !session.confirmed_b {
            return Ok(TradeOutcome::Updated);
        }

        let mut inventory_a = player_a.inventory.clone();
        let mut inventory_b = player_b.inventory.clone();
        let items_a = take_trade_items(&mut inventory_a, &trade.offer_a)?;
        let items_b = take_trade_items(&mut inventory_b, &trade.offer_b)?;
        inventory_a.extend(items_b.into_iter().map(clear_item_location));
        inventory_b.extend(items_a.into_iter().map(clear_item_location));
        if self.inventory_weight(&inventory_a) > player_a.max_capacity + f32::EPSILON
            || self.inventory_weight(&inventory_b) > player_b.max_capacity + f32::EPSILON
        {
            let session = self.trades.get_mut(&trade_id).expect("trade exists");
            session.confirmed_a = false;
            session.confirmed_b = false;
            return Err("trade_capacity_exceeded");
        }
        self.players
            .get_mut(&trade.player_a)
            .expect("trade player exists")
            .inventory = inventory_a;
        self.players
            .get_mut(&trade.player_b)
            .expect("trade player exists")
            .inventory = inventory_b;
        self.trades.remove(&trade_id);
        Ok(TradeOutcome::Completed {
            player_a: trade.player_a,
            player_b: trade.player_b,
        })
    }

    pub fn cancel_trade(
        &mut self,
        player_id: EntityId,
        trade_id: EntityId,
    ) -> Result<TradeOutcome, &'static str> {
        let trade = self.trades.get(&trade_id).ok_or("trade_not_found")?;
        if trade.player_a != player_id && trade.player_b != player_id {
            return Err("not_trade_participant");
        }
        let trade = self.trades.remove(&trade_id).expect("trade exists");
        Ok(TradeOutcome::Cancelled {
            player_a: trade.player_a,
            player_b: trade.player_b,
        })
    }

    pub fn cancel_trade_for_player(&mut self, player_id: EntityId) -> Option<(EntityId, EntityId)> {
        let trade_id = self
            .trades
            .values()
            .find(|trade| trade.player_a == player_id || trade.player_b == player_id)
            .map(|trade| trade.id)?;
        let trade = self.trades.remove(&trade_id)?;
        let partner = if trade.player_a == player_id {
            trade.player_b
        } else {
            trade.player_a
        };
        Some((trade_id, partner))
    }

    pub fn trade_views(&self, trade_id: EntityId) -> Option<[TradeView; 2]> {
        let trade = self.trades.get(&trade_id)?;
        let player_a = self.players.get(&trade.player_a)?;
        let player_b = self.players.get(&trade.player_b)?;
        let offer_a = offered_items(player_a, &trade.offer_a);
        let offer_b = offered_items(player_b, &trade.offer_b);
        let status = if trade.active { "active" } else { "pending" };
        Some([
            TradeView {
                trade_id,
                recipient_id: trade.player_a,
                partner: player_b.view.clone(),
                your_offer: offer_a.clone(),
                their_offer: offer_b.clone(),
                you_confirmed: trade.confirmed_a,
                partner_confirmed: trade.confirmed_b,
                status,
            },
            TradeView {
                trade_id,
                recipient_id: trade.player_b,
                partner: player_a.view.clone(),
                your_offer: offer_b,
                their_offer: offer_a,
                you_confirmed: trade.confirmed_b,
                partner_confirmed: trade.confirmed_a,
                status,
            },
        ])
    }

    fn validate_trade_offer(
        &self,
        player: &Player,
        item_ids: &[EntityId],
    ) -> Result<(), &'static str> {
        for item_id in item_ids {
            let item = player
                .inventory
                .iter()
                .find(|item| item.instance_id == *item_id)
                .ok_or("trade_item_changed")?;
            if item.container_id.is_some()
                || item.equipped_slot.is_some()
                || player
                    .inventory
                    .iter()
                    .any(|child| child.container_id == Some(*item_id))
            {
                return Err("trade_item_changed");
            }
        }
        Ok(())
    }

    fn item_is_offered(&self, player_id: EntityId, item_id: EntityId) -> bool {
        self.trades.values().any(|trade| {
            (trade.player_a == player_id && trade.offer_a.contains(&item_id))
                || (trade.player_b == player_id && trade.offer_b.contains(&item_id))
        })
    }

    pub fn start_crafting(
        &mut self,
        player_id: EntityId,
        recipe_id: &str,
        quantity: u16,
    ) -> Result<CraftingUpdate, &'static str> {
        if self
            .trades
            .values()
            .any(|trade| trade.player_a == player_id || trade.player_b == player_id)
        {
            return Err("cannot_craft_while_trading");
        }
        if !(1..=20).contains(&quantity) {
            return Err("invalid_craft_quantity");
        }
        let recipe = self
            .content
            .rune_recipe(recipe_id)
            .ok_or("unknown_rune_recipe")?;
        let player = self.players.get_mut(&player_id).ok_or("unknown_player")?;
        let profile = vocation_profile(&player.view.vocation).ok_or("unknown_vocation")?;
        if recipe.craft_kind == "sigils" && !profile.can_craft_sigils {
            return Err("vocation_cannot_craft_sigils");
        }
        let material_count: u32 = player
            .inventory
            .iter()
            .filter(|item| item.definition_id == recipe.input_definition_id)
            .map(|item| u32::from(item.quantity))
            .sum();
        let required_material = u32::from(quantity) * u32::from(recipe.input_quantity);
        if material_count < required_material {
            return Err("missing_craft_material");
        }
        player.crafting_queue = Some(CraftingQueue {
            recipe_id: recipe_id.to_owned(),
            remaining: quantity,
            ready_at: Instant::now() + Duration::from_millis(recipe.craft_time_ms),
            last_status: "queued",
        });
        Ok(CraftingUpdate {
            player: player.view.clone(),
            recipe_id: Some(recipe_id.to_owned()),
            remaining: quantity,
            status: "queued",
            inventory_changed: false,
        })
    }

    pub fn cancel_crafting(&mut self, player_id: EntityId) -> Result<CraftingUpdate, &'static str> {
        let player = self.players.get_mut(&player_id).ok_or("unknown_player")?;
        player.crafting_queue = None;
        Ok(CraftingUpdate {
            player: player.view.clone(),
            recipe_id: None,
            remaining: 0,
            status: "cancelled",
            inventory_changed: false,
        })
    }

    pub fn tick_crafting(&mut self) -> Vec<CraftingUpdate> {
        let now = Instant::now();
        let player_ids: Vec<_> = self.players.keys().copied().collect();
        let mut updates = Vec::new();
        for player_id in player_ids {
            let in_combat = self
                .creatures
                .values()
                .any(|creature| creature.target == Some(player_id));
            let player = self.players.get_mut(&player_id).expect("player exists");
            let elapsed = now.duration_since(player.last_mana_regen);
            let regen_steps = elapsed.as_secs() / MANA_REGEN_INTERVAL.as_secs();
            let old_mana = player.view.mana;
            let old_health = player.view.health;
            if regen_steps > 0 {
                player.view.mana = player
                    .view
                    .mana
                    .saturating_add(u16::try_from(regen_steps).unwrap_or(u16::MAX))
                    .min(player.view.max_mana);
                player.last_mana_regen +=
                    MANA_REGEN_INTERVAL * u32::try_from(regen_steps).unwrap_or(u32::MAX);
            }

            if let Some(food) = &player.active_food {
                let food_until = food.until;
                let effective_now = now.min(food_until);
                let food_steps = effective_now
                    .duration_since(player.last_food_regen.min(effective_now))
                    .as_secs()
                    / MANA_REGEN_INTERVAL.as_secs();
                if food_steps > 0 {
                    let steps = u16::try_from(food_steps).unwrap_or(u16::MAX);
                    player.view.health = player
                        .view
                        .health
                        .saturating_add(food.health_per_tick.saturating_mul(steps))
                        .min(player.view.max_health);
                    player.view.mana = player
                        .view
                        .mana
                        .saturating_add(food.mana_per_tick.saturating_mul(steps))
                        .min(player.view.max_mana);
                    player.last_food_regen +=
                        MANA_REGEN_INTERVAL * u32::try_from(food_steps).unwrap_or(u32::MAX);
                }
                if now >= food_until {
                    player.active_food = None;
                }
            }

            let mut status = if player.view.health != old_health {
                Some("food_regenerated")
            } else if player.view.mana != old_mana {
                Some("mana_regenerated")
            } else {
                None
            };
            let mut inventory_changed = false;
            if let Some(queue) = &mut player.crafting_queue
                && now >= queue.ready_at
            {
                let recipe = self
                    .content
                    .rune_recipe(&queue.recipe_id)
                    .expect("validated recipe");
                let next_status = if in_combat {
                    "paused_combat"
                } else if player.view.mana < recipe.mana_cost {
                    "waiting_mana"
                } else if player
                    .inventory
                    .iter()
                    .filter(|item| item.definition_id == recipe.input_definition_id)
                    .map(|item| u32::from(item.quantity))
                    .sum::<u32>()
                    >= u32::from(recipe.input_quantity)
                {
                    let location = consume_crafting_material(
                        &mut player.inventory,
                        &recipe.input_definition_id,
                        recipe.input_quantity,
                    )
                    .expect("material quantity was checked");
                    let output = self
                        .content
                        .item(&recipe.output_definition_id)
                        .expect("validated output");
                    add_crafted_output(
                        &mut player.inventory,
                        output,
                        recipe.output_quantity,
                        location,
                    );
                    player.view.mana -= recipe.mana_cost;
                    if recipe.craft_kind == "fletching" {
                        advance_skill(
                            &mut player.view.fletching_skill,
                            &mut player.view.fletching_tries,
                            1,
                        );
                    } else {
                        let training = vocation_profile(&player.view.vocation)
                            .expect("player vocation was validated")
                            .magic_training;
                        advance_skill(
                            &mut player.view.magic_level,
                            &mut player.view.magic_tries,
                            training,
                        );
                    }
                    queue.remaining -= 1;
                    queue.ready_at = now + Duration::from_millis(recipe.craft_time_ms);
                    inventory_changed = true;
                    if queue.remaining == 0 {
                        "complete"
                    } else {
                        "crafted"
                    }
                } else {
                    "missing_material"
                };
                if next_status != queue.last_status || inventory_changed {
                    queue.last_status = next_status;
                    status = Some(next_status);
                }
            }
            if player.crafting_queue.as_ref().is_some_and(|queue| {
                queue.remaining == 0 || queue.last_status == "missing_material"
            }) {
                player.crafting_queue = None;
            }
            if let Some(status) = status {
                updates.push(CraftingUpdate {
                    player: player.view.clone(),
                    recipe_id: player
                        .crafting_queue
                        .as_ref()
                        .map(|queue| queue.recipe_id.clone()),
                    remaining: player
                        .crafting_queue
                        .as_ref()
                        .map_or(0, |queue| queue.remaining),
                    status,
                    inventory_changed,
                });
            }
        }
        updates
    }

    pub fn try_move(&mut self, id: EntityId, target: Position) -> Result<Position, &'static str> {
        let current = self.players.get(&id).ok_or("unknown_player")?.view.position;
        if !current.is_adjacent_to(target) {
            return Err("invalid_step");
        }
        let dx = target.x - current.x;
        let dy = target.y - current.y;
        if dx != 0 && dy != 0 {
            let horizontal = Position {
                x: current.x + dx,
                y: current.y,
                z: current.z,
            };
            let vertical = Position {
                x: current.x,
                y: current.y + dy,
                z: current.z,
            };
            if self.step_is_blocked(current, horizontal)
                || self.step_is_blocked(current, vertical)
                || self.step_is_blocked(horizontal, target)
                || self.step_is_blocked(vertical, target)
            {
                return Err("corner_blocked");
            }
        }
        if let Some(reason) = self.step_block_reason(current, target) {
            return Err(reason);
        }
        let destination = self.map.stair_destination(target).unwrap_or(target);
        let player = self.players.get_mut(&id).expect("checked above");
        if player.last_move.elapsed() < MOVE_COOLDOWN {
            return Err("moving_too_fast");
        }
        player.view.position = destination;
        player.last_move = Instant::now();
        Ok(destination)
    }

    fn step_is_blocked(&self, from: Position, to: Position) -> bool {
        self.step_block_reason(from, to).is_some()
    }

    fn step_block_reason(&self, from: Position, to: Position) -> Option<&'static str> {
        if !self.map.is_walkable(to) {
            return Some("tile_blocked");
        }
        if self.npcs.iter().any(|npc| npc.position == to) {
            return Some("tile_occupied");
        }
        if let Some(door_anchor) = self.map.house_wall_crossing(from, to) {
            return match self
                .doors
                .values()
                .find(|door| door.position == door_anchor)
            {
                Some(door) if door.open => None,
                Some(_) => Some("door_closed"),
                None => Some("wall_blocked"),
            };
        }
        self.doors
            .values()
            .any(|door| {
                !door.open && door.position == to && !self.map.is_house_wall_anchor(door.position)
            })
            .then_some("door_closed")
    }

    pub fn toggle_door(
        &mut self,
        player_id: EntityId,
        door_id: &str,
    ) -> Result<DoorView, &'static str> {
        let player_position = self
            .players
            .get(&player_id)
            .ok_or("unknown_player")?
            .view
            .position;
        let door_position = self.doors.get(door_id).ok_or("unknown_door")?.position;
        if !within_reach(player_position, door_position) {
            return Err("door_out_of_reach");
        }
        let closing = self.doors.get(door_id).is_some_and(|door| door.open);
        if closing
            && (self
                .players
                .values()
                .any(|player| player.view.position == door_position)
                || self
                    .creatures
                    .values()
                    .any(|creature| creature.view.position == door_position)
                || self.npcs.iter().any(|npc| npc.position == door_position))
        {
            return Err("door_occupied");
        }
        let changed = {
            let door = self.doors.get_mut(door_id).expect("door checked above");
            door.open = !door.open;
            door.clone()
        };
        Ok(changed)
    }

    pub fn toggle_window(
        &mut self,
        player_id: EntityId,
        window_id: &str,
    ) -> Result<WindowView, &'static str> {
        let player_position = self
            .players
            .get(&player_id)
            .ok_or("unknown_player")?
            .view
            .position;
        let window = self.windows.get_mut(window_id).ok_or("unknown_window")?;
        if !within_reach(player_position, window.position) {
            return Err("window_out_of_reach");
        }
        window.open = !window.open;
        Ok(window.clone())
    }

    #[cfg(test)]
    pub fn map_view(&self) -> MapView {
        let mut view = self.map.view.clone();
        view.doors = self.door_views();
        view.windows = self.window_views();
        view
    }

    pub fn map_view_near(&self, center: Position, radius: i32) -> MapView {
        let source = &self.map.view;
        MapView {
            width: source.width,
            height: source.height,
            floor: source.floor,
            blocked: self
                .map
                .spatial
                .blocked
                .near(&source.blocked, center, radius, |entry| *entry),
            water: self
                .map
                .spatial
                .water
                .near(&source.water, center, radius, |entry| *entry),
            bridges: self
                .map
                .spatial
                .bridges
                .near(&source.bridges, center, radius, |entry| *entry),
            trees: self
                .map
                .spatial
                .trees
                .near(&source.trees, center, radius, |entry| *entry),
            roads: self
                .map
                .spatial
                .roads
                .near(&source.roads, center, radius, |entry| *entry),
            floors: self
                .map
                .spatial
                .floors
                .near(&source.floors, center, radius, |entry| *entry),
            house_walls: self.map.spatial.house_walls.near(
                &source.house_walls,
                center,
                radius,
                |entry| *entry,
            ),
            castle_walls: self.map.spatial.castle_walls.near(
                &source.castle_walls,
                center,
                radius,
                |entry| *entry,
            ),
            windows: self
                .windows
                .values()
                .filter(|window| position_in_region(window.position, center, radius))
                .cloned()
                .collect(),
            torches: self
                .map
                .spatial
                .torches
                .near(&source.torches, center, radius, |entry| *entry),
            terrain_materials: self.map.spatial.terrain_materials.near(
                &source.terrain_materials,
                center,
                radius,
                |entry| entry.position,
            ),
            buildings: source
                .buildings
                .iter()
                .filter(|building| {
                    building.floor == center.z
                        && building.x <= center.x + radius
                        && building.y <= center.y + radius
                        && building.x + building.width > center.x - radius
                        && building.y + building.height > center.y - radius
                })
                .cloned()
                .collect(),
            doors: self
                .doors
                .values()
                .filter(|door| position_in_region(door.position, center, radius))
                .cloned()
                .collect(),
            stairs: source
                .stairs
                .iter()
                .filter(|stairs| {
                    position_in_region(stairs.from, center, radius)
                        || position_in_region(stairs.to, center, radius)
                })
                .cloned()
                .collect(),
        }
    }

    pub fn is_walkable(&self, position: Position) -> bool {
        self.map.is_walkable(position)
    }

    pub fn player_spawn(&self) -> Position {
        self.map.player_spawn
    }

    #[cfg(test)]
    fn door_views(&self) -> Vec<DoorView> {
        let mut doors: Vec<_> = self.doors.values().cloned().collect();
        doors.sort_by(|left, right| left.id.cmp(&right.id));
        doors
    }

    #[cfg(test)]
    fn window_views(&self) -> Vec<WindowView> {
        let mut windows: Vec<_> = self.windows.values().cloned().collect();
        windows.sort_by(|left, right| left.id.cmp(&right.id));
        windows
    }

    pub fn try_pickup(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
    ) -> Result<(), &'static str> {
        let (ground_index, content_index) = self
            .ground_items
            .iter()
            .enumerate()
            .find_map(|(ground_index, entry)| {
                if entry.item.instance_id == instance_id {
                    Some((ground_index, None))
                } else {
                    entry
                        .contents
                        .iter()
                        .position(|item| item.instance_id == instance_id)
                        .map(|content_index| (ground_index, Some(content_index)))
                }
            })
            .ok_or("item_not_found")?;
        let ground = self.ground_items[ground_index].clone();
        let picked_item = content_index
            .map(|index| ground.contents[index].clone())
            .unwrap_or_else(|| ground.item.clone());
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        if !within_reach(player.view.position, ground.position) {
            return Err("item_out_of_reach");
        }
        let definition = self
            .content
            .item(&picked_item.definition_id)
            .ok_or("unknown_item_definition")?;
        if content_index.is_none() && !definition.pickupable {
            return Err("item_not_pickupable");
        }
        let weight = self.inventory_weight(&player.inventory)
            + definition.weight * f32::from(picked_item.quantity);
        if weight > player.max_capacity + f32::EPSILON {
            return Err("too_heavy");
        }

        let mut picked_item = if let Some(content_index) = content_index {
            self.ground_items[ground_index]
                .contents
                .remove(content_index)
        } else {
            let removed = self.ground_items.remove(ground_index).item;
            self.ground_decay.remove(&removed.instance_id);
            removed
        };
        if content_index.is_some() && self.ground_items[ground_index].contents.is_empty() {
            let corpse_id = self.ground_items[ground_index].item.instance_id;
            let empty_decay = Instant::now() + EMPTY_CORPSE_DECAY;
            self.ground_decay
                .entry(corpse_id)
                .and_modify(|deadline| *deadline = (*deadline).min(empty_decay));
        }
        picked_item.container_id = None;
        picked_item.equipped_slot = None;
        let player = self.players.get_mut(&player_id).expect("checked above");
        if definition.stackable
            && let Some(stack) = player.inventory.iter_mut().find(|item| {
                item.definition_id == picked_item.definition_id
                    && item.charges == picked_item.charges
                    && item.quantity + picked_item.quantity <= definition.max_stack
            })
        {
            stack.quantity += picked_item.quantity;
            return Ok(());
        }
        player.inventory.push(picked_item);
        Ok(())
    }

    pub fn try_drop(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
    ) -> Result<(), &'static str> {
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get_mut(&player_id).ok_or("unknown_player")?;
        let item_index = player
            .inventory
            .iter()
            .position(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        if player
            .inventory
            .iter()
            .any(|item| item.container_id == Some(instance_id))
        {
            return Err("container_not_empty");
        }
        let item = player.inventory.remove(item_index);
        self.ground_items.push(GroundItem {
            item: ItemInstance {
                container_id: None,
                equipped_slot: None,
                ..item
            },
            position: player.view.position,
            contents: Vec::new(),
        });
        Ok(())
    }

    pub fn try_move_item(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
        destination: ItemDestination,
    ) -> Result<(), &'static str> {
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let source = player
            .inventory
            .iter()
            .find(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        let definition = self
            .content
            .item(&source.definition_id)
            .ok_or("unknown_item_definition")?;
        let (container_id, equipped_slot) = match &destination {
            ItemDestination::Root => (None, None),
            ItemDestination::Container { container_id } => {
                if *container_id == instance_id {
                    return Err("container_cycle");
                }
                let container = player
                    .inventory
                    .iter()
                    .find(|item| item.instance_id == *container_id)
                    .ok_or("container_not_owned")?;
                let slots = self
                    .content
                    .item(&container.definition_id)
                    .and_then(|item| item.container_slots)
                    .ok_or("not_a_container")?;
                let used = player
                    .inventory
                    .iter()
                    .filter(|item| {
                        item.container_id == Some(*container_id) && item.instance_id != instance_id
                    })
                    .count();
                if used >= usize::from(slots) {
                    return Err("container_full");
                }
                let mut cursor = container.container_id;
                while let Some(parent_id) = cursor {
                    if parent_id == instance_id {
                        return Err("container_cycle");
                    }
                    cursor = player
                        .inventory
                        .iter()
                        .find(|item| item.instance_id == parent_id)
                        .and_then(|item| item.container_id);
                }
                (Some(*container_id), None)
            }
            ItemDestination::Equipment { slot } => {
                if definition.equipment_slot.as_deref() != Some(slot.as_str()) {
                    return Err("wrong_equipment_slot");
                }
                (None, Some(slot.clone()))
            }
        };

        let merge_target = if equipped_slot.is_none() && definition.stackable {
            player
                .inventory
                .iter()
                .find(|item| {
                    item.instance_id != instance_id
                        && item.definition_id == source.definition_id
                        && item.charges == source.charges
                        && item.container_id == container_id
                        && item.equipped_slot.is_none()
                        && item.quantity + source.quantity <= definition.max_stack
                })
                .map(|item| item.instance_id)
        } else {
            None
        };
        let player = self.players.get_mut(&player_id).expect("checked above");
        if let Some(slot) = &equipped_slot {
            for item in player.inventory.iter_mut().filter(|item| {
                item.instance_id != instance_id
                    && item.equipped_slot.as_deref() == Some(slot.as_str())
            }) {
                item.container_id = None;
                item.equipped_slot = None;
            }
        }
        if let Some(target_id) = merge_target {
            let source_index = player
                .inventory
                .iter()
                .position(|item| item.instance_id == instance_id)
                .expect("checked above");
            let quantity = player.inventory.remove(source_index).quantity;
            player
                .inventory
                .iter_mut()
                .find(|item| item.instance_id == target_id)
                .expect("target exists")
                .quantity += quantity;
        } else {
            let item = player
                .inventory
                .iter_mut()
                .find(|item| item.instance_id == instance_id)
                .expect("checked above");
            item.container_id = container_id;
            item.equipped_slot = equipped_slot;
        }
        Ok(())
    }

    pub fn try_split_item(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
        quantity: u16,
    ) -> Result<EntityId, &'static str> {
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get_mut(&player_id).ok_or("unknown_player")?;
        let source = player
            .inventory
            .iter_mut()
            .find(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        let definition = self
            .content
            .item(&source.definition_id)
            .ok_or("unknown_item_definition")?;
        if !definition.stackable || quantity == 0 || quantity >= source.quantity {
            return Err("invalid_split");
        }
        if source.equipped_slot.is_some() {
            return Err("cannot_split_equipped");
        }
        source.quantity -= quantity;
        let split = ItemInstance {
            instance_id: uuid::Uuid::new_v4(),
            definition_id: source.definition_id.clone(),
            quantity,
            charges: source.charges,
            container_id: source.container_id,
            equipped_slot: None,
        };
        let split_id = split.instance_id;
        player.inventory.push(split);
        Ok(split_id)
    }

    pub fn try_attack(
        &mut self,
        player_id: EntityId,
        target_id: EntityId,
    ) -> Result<Vec<WorldEvent>, &'static str> {
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let creature = self.creatures.get(&target_id).ok_or("target_not_found")?;
        if creature.state == CreatureState::Returning {
            return Err("creature_evading");
        }
        let distance_weapon = player
            .inventory
            .iter()
            .find(|item| item.equipped_slot.as_deref() == Some("weapon"))
            .and_then(|item| self.content.item(&item.definition_id))
            .and_then(|definition| definition.distance_weapon.clone());
        let cooldown = distance_weapon
            .as_ref()
            .map(|weapon| Duration::from_millis(weapon.cooldown_ms))
            .unwrap_or(PLAYER_ATTACK_COOLDOWN);
        if player.last_attack.elapsed() < cooldown {
            return Err("attack_cooldown");
        }
        let ammunition_index = if let Some(weapon) = &distance_weapon {
            if tile_distance(player.view.position, creature.view.position) > i32::from(weapon.range)
            {
                return Err("target_out_of_range");
            }
            if !has_line_of_sight_on(&self.map, player.view.position, creature.view.position) {
                return Err("line_of_sight_blocked");
            }
            Some(
                player
                    .inventory
                    .iter()
                    .enumerate()
                    .find(|(_, item)| {
                        item.definition_id == weapon.ammunition_id
                            && !self.item_is_offered(player_id, item.instance_id)
                    })
                    .map(|(index, _)| index)
                    .ok_or("out_of_ammunition")?,
            )
        } else {
            if !within_reach(player.view.position, creature.view.position) {
                return Err("target_out_of_range");
            }
            None
        };
        let (damage, stats, projectile) = {
            let player = self.players.get_mut(&player_id).expect("checked above");
            player.last_attack = Instant::now();
            let profile =
                vocation_profile(&player.view.vocation).expect("player vocation was validated");
            if let (Some(weapon), Some(ammunition_index)) = (&distance_weapon, ammunition_index) {
                let ammunition_id = player.inventory[ammunition_index].definition_id.clone();
                if player.inventory[ammunition_index].quantity == 1 {
                    player.inventory.remove(ammunition_index);
                } else {
                    player.inventory[ammunition_index].quantity -= 1;
                }
                advance_skill(
                    &mut player.view.distance_skill,
                    &mut player.view.distance_tries,
                    profile.distance_training,
                );
                (
                    weapon
                        .damage
                        .saturating_add(player.view.distance_skill / 2)
                        .saturating_add((player.view.level / 3) as u16),
                    player.view.clone(),
                    Some((ammunition_id, weapon.cooldown_ms)),
                )
            } else {
                advance_skill(
                    &mut player.view.sword_skill,
                    &mut player.view.sword_tries,
                    profile.sword_training,
                );
                (
                    5_u16
                        .saturating_add(player.view.sword_skill / 2)
                        .saturating_add((player.view.level / 3) as u16),
                    player.view.clone(),
                    None,
                )
            }
        };
        let mut events = self.damage_creature(player_id, target_id, damage)?;
        let (effect_id, cooldown_ms) = projectile.unwrap_or_else(|| {
            (
                "melee_hit".to_owned(),
                PLAYER_ATTACK_COOLDOWN.as_millis() as u64,
            )
        });
        events.insert(
            0,
            WorldEvent::CombatEffect {
                source_id: player_id,
                target_id,
                effect_id,
                damage,
                cooldown_ms,
            },
        );
        if !events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerStats(_)))
        {
            events.push(WorldEvent::PlayerStats(stats));
        }
        Ok(events)
    }

    pub fn try_eat(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
    ) -> Result<(PlayerView, u64), &'static str> {
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let item_index = player
            .inventory
            .iter()
            .position(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        let food = self
            .content
            .item(&player.inventory[item_index].definition_id)
            .and_then(|definition| definition.food_effect.clone())
            .ok_or("item_not_food")?;
        let now = Instant::now();
        let player = self.players.get_mut(&player_id).expect("checked above");
        if player.inventory[item_index].quantity == 1 {
            player.inventory.remove(item_index);
        } else {
            player.inventory[item_index].quantity -= 1;
        }
        let current_until = player
            .active_food
            .as_ref()
            .map_or(now, |active| active.until.max(now));
        let until = (current_until + Duration::from_secs(food.duration_seconds))
            .min(now + Duration::from_secs(600));
        player.active_food = Some(ActiveFood {
            until,
            health_per_tick: player
                .active_food
                .as_ref()
                .map_or(food.health_per_tick, |active| {
                    active.health_per_tick.max(food.health_per_tick)
                }),
            mana_per_tick: player
                .active_food
                .as_ref()
                .map_or(food.mana_per_tick, |active| {
                    active.mana_per_tick.max(food.mana_per_tick)
                }),
        });
        player.last_food_regen = now;
        Ok((
            player.view.clone(),
            u64::try_from(until.duration_since(now).as_millis()).unwrap_or(u64::MAX),
        ))
    }

    pub fn try_use_item(
        &mut self,
        player_id: EntityId,
        instance_id: EntityId,
        target_id: EntityId,
    ) -> Result<Vec<WorldEvent>, &'static str> {
        if self.item_is_offered(player_id, instance_id) {
            return Err("item_locked_in_trade");
        }
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        let item_index = player
            .inventory
            .iter()
            .position(|item| item.instance_id == instance_id)
            .ok_or("item_not_owned")?;
        let definition = self
            .content
            .item(&player.inventory[item_index].definition_id)
            .ok_or("unknown_item_definition")?;
        let effect_id = definition.id.clone();
        let effect = definition.combat_effect.clone().ok_or("item_not_usable")?;
        let creature = self.creatures.get(&target_id).ok_or("target_not_found")?;
        if creature.state == CreatureState::Returning {
            return Err("creature_evading");
        }
        if tile_distance(player.view.position, creature.view.position) > i32::from(effect.range) {
            return Err("target_out_of_range");
        }
        if player.last_item_use.elapsed() < Duration::from_millis(effect.cooldown_ms) {
            return Err("item_cooldown");
        }
        let (damage, stats) = {
            let player = self.players.get_mut(&player_id).expect("checked above");
            let charges = player.inventory[item_index]
                .charges
                .ok_or("item_has_no_charges")?;
            if charges <= 1 {
                player.inventory.remove(item_index);
            } else {
                player.inventory[item_index].charges = Some(charges - 1);
            }
            player.last_item_use = Instant::now();
            let training = vocation_profile(&player.view.vocation)
                .expect("player vocation was validated")
                .magic_training;
            advance_skill(
                &mut player.view.magic_level,
                &mut player.view.magic_tries,
                training,
            );
            (
                effect.damage.saturating_add(player.view.magic_level / 2),
                player.view.clone(),
            )
        };
        let mut events = self.damage_creature(player_id, target_id, damage)?;
        events.insert(
            0,
            WorldEvent::CombatEffect {
                source_id: player_id,
                target_id,
                effect_id,
                damage,
                cooldown_ms: effect.cooldown_ms,
            },
        );
        if !events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerStats(_)))
        {
            events.push(WorldEvent::PlayerStats(stats));
        }
        Ok(events)
    }

    pub fn try_cast_spell(
        &mut self,
        player_id: EntityId,
        spell_id: &str,
        target_id: EntityId,
    ) -> Result<Vec<WorldEvent>, &'static str> {
        let spell = self
            .content
            .spell(spell_id)
            .cloned()
            .ok_or("spell_not_found")?;
        let player = self.players.get(&player_id).ok_or("unknown_player")?;
        if !player.learned_spells.contains(spell_id) {
            return Err("spell_not_learned");
        }
        if !spell
            .vocations
            .iter()
            .any(|vocation| vocation == &player.view.vocation)
        {
            return Err("vocation_cannot_cast_spell");
        }
        let creature = self.creatures.get(&target_id).ok_or("target_not_found")?;
        if creature.state == CreatureState::Returning {
            return Err("creature_evading");
        }
        if tile_distance(player.view.position, creature.view.position) > i32::from(spell.range) {
            return Err("target_out_of_range");
        }
        if !has_line_of_sight_on(&self.map, player.view.position, creature.view.position) {
            return Err("line_of_sight_blocked");
        }
        if player.last_spell_cast.elapsed() < Duration::from_millis(spell.cooldown_ms) {
            return Err("spell_cooldown");
        }
        if player.view.mana < spell.mana_cost {
            return Err("not_enough_mana");
        }
        let (damage, stats) = {
            let player = self
                .players
                .get_mut(&player_id)
                .expect("player was checked");
            player.view.mana -= spell.mana_cost;
            player.last_spell_cast = Instant::now();
            let training = vocation_profile(&player.view.vocation)
                .expect("validated vocation")
                .magic_training;
            advance_skill(
                &mut player.view.magic_level,
                &mut player.view.magic_tries,
                training,
            );
            (
                spell.damage.saturating_add(player.view.magic_level / 2),
                player.view.clone(),
            )
        };
        let mut events = self.damage_creature(player_id, target_id, damage)?;
        events.insert(
            0,
            WorldEvent::CombatEffect {
                source_id: player_id,
                target_id,
                effect_id: spell.id,
                damage,
                cooldown_ms: spell.cooldown_ms,
            },
        );
        if !events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerStats(_)))
        {
            events.push(WorldEvent::PlayerStats(stats));
        }
        Ok(events)
    }

    fn damage_creature(
        &mut self,
        player_id: EntityId,
        target_id: EntityId,
        damage: u16,
    ) -> Result<Vec<WorldEvent>, &'static str> {
        let creature = self.creatures.get_mut(&target_id).expect("checked above");
        if creature.view.health > damage {
            creature.view.health -= damage;
            return Ok(vec![WorldEvent::CreatureDamaged {
                creature_id: target_id,
                health: creature.view.health,
                max_health: creature.view.max_health,
                damage,
            }]);
        }

        let dead = self.creatures.remove(&target_id).expect("checked above");
        let definition = self
            .content
            .creature(&dead.view.definition_id)
            .ok_or("unknown_creature_definition")?
            .clone();
        let spawn = &mut self.spawns[dead.spawn_index];
        spawn.active_id = None;
        spawn.respawn_at = Instant::now() + CREATURE_RESPAWN;
        let player = self.players.get_mut(&player_id).expect("checked above");
        player.view.experience = player.view.experience.saturating_add(definition.experience);
        player.view.level = level_for_experience(player.view.experience);
        let stats = player.view.clone();
        let corpse_id = uuid::Uuid::new_v4();
        let mut contents = Vec::new();
        for (index, loot) in definition.loot.iter().enumerate() {
            let roll = deterministic_roll(target_id, index as u64);
            if roll <= loot.chance {
                let range = u64::from(loot.max_quantity - loot.min_quantity) + 1;
                let quantity = loot.min_quantity
                    + (deterministic_hash(target_id, index as u64 + 41) % range) as u16;
                contents.push(ItemInstance {
                    instance_id: uuid::Uuid::new_v4(),
                    definition_id: loot.definition_id.clone(),
                    quantity,
                    charges: None,
                    container_id: Some(corpse_id),
                    equipped_slot: None,
                });
            }
        }
        self.ground_items.push(GroundItem {
            item: ItemInstance {
                instance_id: corpse_id,
                definition_id: definition.corpse_id.clone(),
                quantity: 1,
                charges: None,
                container_id: None,
                equipped_slot: None,
            },
            position: dead.view.position,
            contents,
        });
        self.ground_decay
            .insert(corpse_id, Instant::now() + CORPSE_DECAY);
        Ok(vec![
            WorldEvent::CreatureDamaged {
                creature_id: target_id,
                health: 0,
                max_health: dead.view.max_health,
                damage,
            },
            WorldEvent::CreatureDied {
                creature_id: target_id,
                killer_id: player_id,
                experience: definition.experience,
            },
            WorldEvent::PlayerStats(stats),
            WorldEvent::GroundItemsChanged(self.ground_items.clone()),
        ])
    }

    pub fn tick(&mut self) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let now = Instant::now();
        let expired: HashSet<_> = self
            .ground_decay
            .iter()
            .filter_map(|(id, deadline)| (*deadline <= now).then_some(*id))
            .collect();
        if !expired.is_empty() {
            self.ground_items
                .retain(|ground| !expired.contains(&ground.item.instance_id));
            self.ground_decay.retain(|id, _| !expired.contains(id));
            events.push(WorldEvent::GroundItemsChanged(self.ground_items.clone()));
        }
        for index in 0..self.spawns.len() {
            if self.spawns[index].active_id.is_none()
                && self.spawns[index].respawn_at <= Instant::now()
                && let Some(view) = self.spawn(index)
            {
                events.push(WorldEvent::CreatureSpawned(view));
            }
        }
        let creature_ids: Vec<_> = self.creatures.keys().copied().collect();
        for creature_id in creature_ids {
            let Some(snapshot) = self.creatures.get(&creature_id).cloned() else {
                continue;
            };
            let spawn_position = self.spawns[snapshot.spawn_index].position;
            if let Some(pending) = snapshot.pending_attack.clone() {
                if pending.execute_at > now {
                    continue;
                }
                let victims: Vec<_> = self
                    .players
                    .values()
                    .filter(|player| {
                        tile_distance(player.view.position, pending.position)
                            <= i32::from(pending.attack.radius)
                    })
                    .map(|player| player.view.id)
                    .collect();
                let damage = pending.attack.min_damage
                    + (pending.attack.max_damage - pending.attack.min_damage) / 2;
                let creature = self
                    .creatures
                    .get_mut(&creature_id)
                    .expect("creature exists");
                creature.pending_attack = None;
                creature.last_attack = now;
                for victim_id in victims {
                    self.apply_creature_damage(creature_id, victim_id, damage, &mut events);
                    events.push(WorldEvent::CombatEffect {
                        source_id: creature_id,
                        target_id: victim_id,
                        effect_id: pending.attack.effect_id.clone(),
                        damage,
                        cooldown_ms: pending.attack.interval_ms,
                    });
                }
                continue;
            }
            if snapshot.state == CreatureState::Returning {
                if snapshot.view.position == spawn_position {
                    let creature = self
                        .creatures
                        .get_mut(&creature_id)
                        .expect("creature exists");
                    creature.state = CreatureState::Idle;
                    creature.view.state = CreatureState::Idle.as_str().into();
                    creature.view.immune = false;
                    events.push(creature_state_event(creature));
                } else {
                    let occupied = self.occupied_positions(creature_id, None);
                    if let Some(step) = next_path_step_on(
                        &self.map,
                        snapshot.view.position,
                        spawn_position,
                        &occupied,
                    ) {
                        self.creatures
                            .get_mut(&creature_id)
                            .expect("creature exists")
                            .view
                            .position = step;
                        events.push(WorldEvent::CreatureMoved {
                            creature_id,
                            position: step,
                        });
                    }
                }
                continue;
            }
            let target_id = snapshot
                .target
                .filter(|id| {
                    self.players.get(id).is_some_and(|player| {
                        tile_distance(player.view.position, spawn_position) <= CREATURE_LEASH_RANGE
                    })
                })
                .or_else(|| {
                    self.players
                        .values()
                        .filter(|player| {
                            tile_distance(player.view.position, snapshot.view.position)
                                <= CREATURE_AGGRO_RANGE
                                && tile_distance(player.view.position, spawn_position)
                                    <= CREATURE_LEASH_RANGE
                        })
                        .min_by_key(|player| {
                            tile_distance(player.view.position, snapshot.view.position)
                        })
                        .map(|player| player.view.id)
                });
            self.creatures
                .get_mut(&creature_id)
                .expect("creature exists")
                .target = target_id;
            let Some(target_id) = target_id else {
                if snapshot.view.position != spawn_position || snapshot.state != CreatureState::Idle
                {
                    self.begin_creature_return(creature_id, &mut events);
                }
                continue;
            };
            let target_position = self
                .players
                .get(&target_id)
                .expect("target exists")
                .view
                .position;
            if tile_distance(target_position, spawn_position) > CREATURE_LEASH_RANGE
                || tile_distance(snapshot.view.position, spawn_position) > CREATURE_LEASH_RANGE
            {
                self.begin_creature_return(creature_id, &mut events);
                continue;
            }
            let attack = self
                .content
                .creature(&snapshot.view.definition_id)
                .expect("validated content")
                .attacks[0]
                .clone();
            let can_attack = tile_distance(snapshot.view.position, target_position)
                <= i32::from(attack.range)
                && has_line_of_sight_on(&self.map, snapshot.view.position, target_position);
            if can_attack {
                self.set_creature_state(creature_id, CreatureState::Attacking, &mut events);
                if snapshot.last_attack.elapsed() >= Duration::from_millis(attack.interval_ms) {
                    let damage = attack.min_damage + (attack.max_damage - attack.min_damage) / 2;
                    if attack.attack_type == "area" {
                        self.creatures
                            .get_mut(&creature_id)
                            .expect("creature exists")
                            .pending_attack = Some(PendingCreatureAttack {
                            execute_at: now + Duration::from_millis(attack.telegraph_ms),
                            position: target_position,
                            attack: attack.clone(),
                        });
                        events.push(WorldEvent::AreaTelegraph {
                            source_id: creature_id,
                            position: target_position,
                            effect_id: attack.effect_id.clone(),
                            radius: attack.radius,
                            duration_ms: attack.telegraph_ms,
                        });
                    } else {
                        self.creatures
                            .get_mut(&creature_id)
                            .expect("creature exists")
                            .last_attack = now;
                        self.apply_creature_damage(creature_id, target_id, damage, &mut events);
                        events.push(WorldEvent::CombatEffect {
                            source_id: creature_id,
                            target_id,
                            effect_id: if attack.effect_id.is_empty() {
                                "melee_hit".to_owned()
                            } else {
                                attack.effect_id.clone()
                            },
                            damage,
                            cooldown_ms: attack.interval_ms,
                        });
                    }
                }
            } else {
                let occupied = self.occupied_positions(creature_id, Some(target_id));
                if let Some(step) = next_path_step_on(
                    &self.map,
                    snapshot.view.position,
                    target_position,
                    &occupied,
                ) {
                    self.set_creature_state(creature_id, CreatureState::Chasing, &mut events);
                    let creature = self
                        .creatures
                        .get_mut(&creature_id)
                        .expect("creature exists");
                    creature.unreachable_since = None;
                    creature.view.position = step;
                    events.push(WorldEvent::CreatureMoved {
                        creature_id,
                        position: step,
                    });
                } else {
                    let now = Instant::now();
                    let creature = self
                        .creatures
                        .get_mut(&creature_id)
                        .expect("creature exists");
                    let unreachable_since = creature.unreachable_since.get_or_insert(now);
                    if now.duration_since(*unreachable_since) >= CREATURE_UNREACHABLE_TIMEOUT {
                        self.begin_creature_return(creature_id, &mut events);
                    }
                }
            }
        }
        events
    }

    fn apply_creature_damage(
        &mut self,
        creature_id: EntityId,
        player_id: EntityId,
        damage: u16,
        events: &mut Vec<WorldEvent>,
    ) {
        let respawn_position = self.player_spawn();
        let Some(player) = self.players.get_mut(&player_id) else {
            return;
        };
        if damage >= player.view.health {
            player.view.health = player.view.max_health;
            player.view.position = respawn_position;
            events.push(WorldEvent::PlayerDied {
                player_id,
                killer_id: creature_id,
            });
        } else {
            player.view.health -= damage;
        }
        events.push(WorldEvent::PlayerStats(player.view.clone()));
    }

    fn occupied_positions(
        &self,
        creature_id: EntityId,
        target_id: Option<EntityId>,
    ) -> HashSet<Position> {
        self.creatures
            .values()
            .filter(|creature| creature.view.id != creature_id)
            .map(|creature| creature.view.position)
            .chain(
                self.players
                    .values()
                    .filter(|player| Some(player.view.id) != target_id)
                    .map(|player| player.view.position),
            )
            .chain(
                self.doors
                    .values()
                    .filter(|door| !door.open && !self.map.is_house_wall_anchor(door.position))
                    .map(|door| door.position),
            )
            .collect()
    }

    fn set_creature_state(
        &mut self,
        creature_id: EntityId,
        state: CreatureState,
        events: &mut Vec<WorldEvent>,
    ) {
        let creature = self
            .creatures
            .get_mut(&creature_id)
            .expect("creature exists");
        if creature.state == state {
            return;
        }
        creature.state = state;
        creature.view.state = state.as_str().into();
        creature.view.immune = state == CreatureState::Returning;
        events.push(creature_state_event(creature));
    }

    fn begin_creature_return(&mut self, creature_id: EntityId, events: &mut Vec<WorldEvent>) {
        let creature = self
            .creatures
            .get_mut(&creature_id)
            .expect("creature exists");
        creature.target = None;
        creature.unreachable_since = None;
        creature.view.health = creature.view.max_health;
        if creature.state != CreatureState::Returning {
            creature.state = CreatureState::Returning;
            creature.view.state = CreatureState::Returning.as_str().into();
            creature.view.immune = true;
            events.push(creature_state_event(creature));
        }
    }

    fn spawn(&mut self, spawn_index: usize) -> Option<CreatureView> {
        let spawn = &self.spawns[spawn_index];
        let definition = self.content.creature(&spawn.definition_id)?;
        let id = uuid::Uuid::new_v4();
        let view = CreatureView {
            id,
            definition_id: definition.id.clone(),
            name: definition.name.clone(),
            position: spawn.position,
            health: definition.health,
            max_health: definition.health,
            state: "idle".into(),
            immune: false,
        };
        self.creatures.insert(
            id,
            Creature {
                view: view.clone(),
                spawn_index,
                target: None,
                last_attack: Instant::now(),
                state: CreatureState::Idle,
                unreachable_since: None,
                pending_attack: None,
            },
        );
        self.spawns[spawn_index].active_id = Some(id);
        Some(view)
    }

    fn inventory_weight(&self, inventory: &[ItemInstance]) -> f32 {
        inventory
            .iter()
            .filter_map(|item| {
                self.content
                    .item(&item.definition_id)
                    .map(|definition| definition.weight * f32::from(item.quantity))
            })
            .sum()
    }
}

fn offered_items(player: &Player, item_ids: &[EntityId]) -> Vec<ItemInstance> {
    item_ids
        .iter()
        .filter_map(|item_id| {
            player
                .inventory
                .iter()
                .find(|item| item.instance_id == *item_id)
                .cloned()
        })
        .collect()
}

fn item_tree_ids(items: &[ItemInstance], root_id: EntityId) -> HashSet<EntityId> {
    let mut ids = HashSet::from([root_id]);
    loop {
        let before = ids.len();
        for item in items {
            if item
                .container_id
                .is_some_and(|parent| ids.contains(&parent))
            {
                ids.insert(item.instance_id);
            }
        }
        if ids.len() == before {
            return ids;
        }
    }
}

fn is_corpse(item: &ItemInstance) -> bool {
    item.definition_id.ends_with("_remains")
}

fn take_trade_items(
    inventory: &mut Vec<ItemInstance>,
    item_ids: &[EntityId],
) -> Result<Vec<ItemInstance>, &'static str> {
    let mut items = Vec::with_capacity(item_ids.len());
    for item_id in item_ids {
        let index = inventory
            .iter()
            .position(|item| item.instance_id == *item_id)
            .ok_or("trade_item_changed")?;
        items.push(inventory.remove(index));
    }
    Ok(items)
}

fn clear_item_location(item: ItemInstance) -> ItemInstance {
    ItemInstance {
        container_id: None,
        equipped_slot: None,
        ..item
    }
}

fn creature_state_event(creature: &Creature) -> WorldEvent {
    WorldEvent::CreatureStateChanged {
        creature_id: creature.view.id,
        state: creature.state.as_str(),
        immune: creature.view.immune,
        health: creature.view.health,
        max_health: creature.view.max_health,
    }
}

fn next_path_step_on(
    map: &WorldMap,
    start: Position,
    goal: Position,
    occupied: &HashSet<Position>,
) -> Option<Position> {
    if start.z != goal.z || start == goal {
        return None;
    }
    // Creature targets are local (aggro/leash range). Bounding the search
    // prevents an unreachable target from making BFS scan a continent-sized map.
    let padding = CREATURE_LEASH_RANGE + 2;
    let min_x = start.x.min(goal.x) - padding;
    let max_x = start.x.max(goal.x) + padding;
    let min_y = start.y.min(goal.y) - padding;
    let max_y = start.y.max(goal.y) + padding;
    let mut frontier = VecDeque::from([start]);
    let mut previous = HashMap::from([(start, start)]);
    while let Some(current) = frontier.pop_front() {
        for (dx, dy) in [
            (0, -1),
            (1, 0),
            (0, 1),
            (-1, 0),
            (1, -1),
            (1, 1),
            (-1, 1),
            (-1, -1),
        ] {
            let next = Position {
                x: current.x + dx,
                y: current.y + dy,
                z: current.z,
            };
            if next.x < min_x
                || next.x > max_x
                || next.y < min_y
                || next.y > max_y
                || previous.contains_key(&next)
                || !map.is_walkable(next)
                || map
                    .house_wall_crossing(current, next)
                    .is_some_and(|anchor| {
                        !map.view
                            .doors
                            .iter()
                            .any(|door| door.position == anchor && door.open)
                    })
                || (next != goal && occupied.contains(&next))
            {
                continue;
            }
            if dx != 0
                && dy != 0
                && ({
                    let horizontal = Position {
                        x: current.x + dx,
                        y: current.y,
                        z: current.z,
                    };
                    let vertical = Position {
                        x: current.x,
                        y: current.y + dy,
                        z: current.z,
                    };
                    !map.is_walkable(horizontal)
                        || !map.is_walkable(vertical)
                        || map
                            .house_wall_crossing(current, horizontal)
                            .is_some_and(|anchor| {
                                !map.view
                                    .doors
                                    .iter()
                                    .any(|door| door.position == anchor && door.open)
                            })
                        || map
                            .house_wall_crossing(current, vertical)
                            .is_some_and(|anchor| {
                                !map.view
                                    .doors
                                    .iter()
                                    .any(|door| door.position == anchor && door.open)
                            })
                        || map
                            .house_wall_crossing(horizontal, next)
                            .is_some_and(|anchor| {
                                !map.view
                                    .doors
                                    .iter()
                                    .any(|door| door.position == anchor && door.open)
                            })
                        || map
                            .house_wall_crossing(vertical, next)
                            .is_some_and(|anchor| {
                                !map.view
                                    .doors
                                    .iter()
                                    .any(|door| door.position == anchor && door.open)
                            })
                        || occupied.contains(&horizontal)
                        || occupied.contains(&vertical)
                })
            {
                continue;
            }
            previous.insert(next, current);
            if next == goal {
                let mut cursor = next;
                while previous[&cursor] != start {
                    cursor = previous[&cursor];
                }
                return Some(cursor);
            }
            frontier.push_back(next);
        }
    }
    None
}

pub fn skill_tries_required(level: u16) -> u32 {
    5 + u32::from(level) * 2
}

fn advance_skill(level: &mut u16, tries: &mut u32, amount: u32) -> bool {
    *tries = tries.saturating_add(amount);
    let mut advanced = false;
    while *tries >= skill_tries_required(*level) {
        *tries -= skill_tries_required(*level);
        *level = level.saturating_add(1);
        advanced = true;
    }
    advanced
}

fn consume_crafting_material(
    inventory: &mut Vec<ItemInstance>,
    definition_id: &str,
    quantity: u16,
) -> Option<(Option<EntityId>, Option<String>)> {
    let location = inventory
        .iter()
        .find(|item| item.definition_id == definition_id)
        .map(|item| (item.container_id, item.equipped_slot.clone()))?;
    let mut remaining = quantity;
    for item in inventory.iter_mut() {
        if item.definition_id != definition_id || remaining == 0 {
            continue;
        }
        let consumed = item.quantity.min(remaining);
        item.quantity -= consumed;
        remaining -= consumed;
    }
    inventory.retain(|item| item.quantity > 0);
    (remaining == 0).then_some(location)
}

fn add_crafted_output(
    inventory: &mut Vec<ItemInstance>,
    definition: &ItemDefinition,
    quantity: u16,
    location: (Option<EntityId>, Option<String>),
) {
    let mut remaining = quantity;
    if definition.stackable {
        for item in inventory.iter_mut().filter(|item| {
            item.definition_id == definition.id
                && item.charges == definition.charges
                && item.container_id == location.0
                && item.equipped_slot == location.1
                && item.quantity < definition.max_stack
        }) {
            let added = remaining.min(definition.max_stack - item.quantity);
            item.quantity += added;
            remaining -= added;
            if remaining == 0 {
                return;
            }
        }
    }
    while remaining > 0 {
        let stack_quantity = if definition.stackable {
            remaining.min(definition.max_stack)
        } else {
            1
        };
        inventory.push(ItemInstance {
            instance_id: uuid::Uuid::new_v4(),
            definition_id: definition.id.clone(),
            quantity: stack_quantity,
            charges: definition.charges,
            container_id: location.0,
            equipped_slot: if definition.stackable {
                location.1.clone()
            } else {
                None
            },
        });
        remaining -= stack_quantity;
    }
}

fn level_for_experience(experience: u64) -> u32 {
    let mut level = 1_u32;
    while experience >= u64::from(level).pow(2) * 100 {
        level += 1;
    }
    level
}

fn tile_distance(first: Position, second: Position) -> i32 {
    if first.z != second.z {
        return i32::MAX;
    }
    (first.x - second.x).abs().max((first.y - second.y).abs())
}

fn position_in_region(position: Position, center: Position, radius: i32) -> bool {
    position.z == center.z
        && (position.x - center.x).abs() <= radius
        && (position.y - center.y).abs() <= radius
}

fn has_line_of_sight_on(map: &WorldMap, start: Position, end: Position) -> bool {
    if start.z != end.z {
        return false;
    }
    let mut x = start.x;
    let mut y = start.y;
    let dx = (end.x - start.x).abs();
    let dy = -(end.y - start.y).abs();
    let step_x = if start.x < end.x { 1 } else { -1 };
    let step_y = if start.y < end.y { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        if x == end.x && y == end.y {
            return true;
        }
        let previous = Position { x, y, z: start.z };
        let doubled = error * 2;
        if doubled >= dy {
            error += dy;
            x += step_x;
        }
        if doubled <= dx {
            error += dx;
            y += step_y;
        }
        let current = Position { x, y, z: start.z };
        let crosses_house_wall = map.house_wall_crossing(previous, current).is_some()
            || (previous.x != current.x
                && previous.y != current.y
                && ({
                    let horizontal = Position {
                        x: current.x,
                        y: previous.y,
                        z: start.z,
                    };
                    let vertical = Position {
                        x: previous.x,
                        y: current.y,
                        z: start.z,
                    };
                    map.house_wall_crossing(previous, horizontal).is_some()
                        || map.house_wall_crossing(previous, vertical).is_some()
                        || map.house_wall_crossing(horizontal, current).is_some()
                        || map.house_wall_crossing(vertical, current).is_some()
                }));
        if crosses_house_wall {
            return false;
        }
        if (x != end.x || y != end.y) && !map.is_walkable(Position { x, y, z: start.z }) {
            return false;
        }
    }
}

#[cfg(test)]
fn has_line_of_sight(start: Position, end: Position) -> bool {
    has_line_of_sight_on(&WorldMap::default_greyhaven(), start, end)
}

fn deterministic_hash(id: EntityId, salt: u64) -> u64 {
    let bytes = id.as_bytes();
    bytes
        .iter()
        .fold(0xcbf29ce484222325_u64 ^ salt, |hash, byte| {
            hash.wrapping_mul(0x100000001b3) ^ u64::from(*byte)
        })
}

fn deterministic_roll(id: EntityId, salt: u64) -> f32 {
    (deterministic_hash(id, salt) % 10_000) as f32 / 10_000.0
}

fn within_reach(origin: Position, target: Position) -> bool {
    origin.z == target.z && (origin.x - target.x).abs() <= 1 && (origin.y - target.y).abs() <= 1
}

fn default_npcs() -> Vec<NpcView> {
    serde_json::from_str(include_str!("../../../content/npcs/npcs.json"))
        .expect("built-in NPC content must be valid")
}

pub fn map_view() -> MapView {
    map_view_with_doors(default_doors())
}

fn map_view_with_doors(doors: Vec<DoorView>) -> MapView {
    MapView {
        width: 56,
        height: 38,
        floor: 7,
        blocked: blocked_tiles(),
        water: water_tiles(),
        bridges: Vec::new(),
        trees: tree_tiles(),
        roads: road_tiles(),
        floors: floor_tiles(),
        house_walls: house_wall_tiles(),
        castle_walls: castle_wall_tiles(),
        windows: vec![
            WindowView {
                id: "west_house_window".into(),
                position: Position { x: 3, y: 11, z: 7 },
                open: false,
            },
            WindowView {
                id: "east_house_window".into(),
                position: Position { x: 15, y: 12, z: 7 },
                open: false,
            },
            WindowView {
                id: "south_house_window".into(),
                position: Position { x: 4, y: 18, z: 7 },
                open: false,
            },
        ],
        torches: vec![
            Position { x: 8, y: 7, z: 7 },
            Position { x: 11, y: 7, z: 7 },
            Position { x: 8, y: 13, z: 8 },
            Position { x: 16, y: 13, z: 8 },
        ],
        terrain_materials: vec![],
        buildings: building_views(),
        doors,
        stairs: stair_views(),
    }
}

fn building_views() -> Vec<BuildingView> {
    vec![
        BuildingView {
            id: "greyhaven_keep".into(),
            name: "Greyhaven Keep".into(),
            kind: "keep".into(),
            x: 3,
            y: 2,
            width: 11,
            height: 5,
            floor: 7,
        },
        BuildingView {
            id: "west_house".into(),
            name: "Vault House".into(),
            kind: "house".into(),
            x: 2,
            y: 11,
            width: 6,
            height: 6,
            floor: 7,
        },
        BuildingView {
            id: "east_house".into(),
            name: "Merchant House".into(),
            kind: "house".into(),
            x: 12,
            y: 12,
            width: 7,
            height: 6,
            floor: 7,
        },
        BuildingView {
            id: "south_house".into(),
            name: "Craftsman's Lodge".into(),
            kind: "house".into(),
            x: 3,
            y: 18,
            width: 6,
            height: 6,
            floor: 7,
        },
        BuildingView {
            id: "greyhaven_keep_upper".into(),
            name: "Greyhaven Keep - Upper Hall".into(),
            kind: "keep".into(),
            x: 3,
            y: 2,
            width: 11,
            height: 5,
            floor: 6,
        },
    ]
}

fn default_doors() -> Vec<DoorView> {
    [
        ("keep_west_door", 9, 6),
        ("keep_east_door", 10, 6),
        ("vault_house_door", 7, 13),
        ("merchant_house_door", 12, 14),
        ("craftsman_lodge_door", 6, 18),
    ]
    .into_iter()
    .map(|(id, x, y)| DoorView {
        id: id.into(),
        position: Position { x, y, z: 7 },
        open: true,
    })
    .collect()
}

fn stair_views() -> Vec<StairView> {
    vec![
        StairView {
            id: "keep_stairs_up".into(),
            from: Position { x: 5, y: 4, z: 7 },
            to: Position { x: 5, y: 4, z: 6 },
        },
        StairView {
            id: "keep_stairs_down".into(),
            from: Position { x: 6, y: 4, z: 6 },
            to: Position { x: 6, y: 4, z: 7 },
        },
        StairView {
            id: "keep_cellar_down".into(),
            from: Position { x: 11, y: 4, z: 7 },
            to: Position { x: 11, y: 4, z: 8 },
        },
        StairView {
            id: "keep_cellar_up".into(),
            from: Position { x: 10, y: 4, z: 8 },
            to: Position { x: 10, y: 4, z: 7 },
        },
    ]
}

fn build_blocked_tiles() -> Vec<Position> {
    let mut tiles = Vec::new();
    for x in 0..56 {
        tiles.push(Position { x, y: 0, z: 7 });
        tiles.push(Position { x, y: 37, z: 7 });
    }
    for y in 1..37 {
        tiles.push(Position { x: 0, y, z: 7 });
        tiles.push(Position { x: 55, y, z: 7 });
    }
    tiles.extend(castle_wall_tiles());
    tiles.extend(house_wall_tiles());
    tiles.extend(water_tiles());
    tiles.sort_by_key(|tile| (tile.z, tile.y, tile.x));
    tiles.dedup();
    tiles
}

fn blocked_tile_set() -> &'static HashSet<Position> {
    BLOCKED_TILE_SET.get_or_init(|| build_blocked_tiles().into_iter().collect())
}

fn blocked_tiles() -> Vec<Position> {
    let mut tiles: Vec<_> = blocked_tile_set().iter().copied().collect();
    // Stable ordering keeps the serialized map deterministic for clients and
    // avoids needless terrain redraws if a welcome payload is compared.
    tiles.sort_by_key(|tile| (tile.z, tile.y, tile.x));
    tiles
}

fn rectangle_tiles(start_x: i32, end_x: i32, start_y: i32, end_y: i32) -> Vec<Position> {
    let mut tiles = Vec::new();
    for y in start_y..=end_y {
        for x in start_x..=end_x {
            tiles.push(Position { x, y, z: 7 });
        }
    }
    tiles
}

fn perimeter_tiles(
    start_x: i32,
    end_x: i32,
    start_y: i32,
    end_y: i32,
    openings: &[(i32, i32)],
) -> Vec<Position> {
    rectangle_tiles(start_x, end_x, start_y, end_y)
        .into_iter()
        .filter(|tile| {
            (tile.x == start_x || tile.x == end_x || tile.y == start_y || tile.y == end_y)
                && !openings.contains(&(tile.x, tile.y))
        })
        .collect()
}

fn castle_wall_tiles() -> Vec<Position> {
    let mut tiles = perimeter_tiles(1, 20, 1, 25, &[(20, 8), (20, 9), (9, 25), (10, 25)]);
    // Greyhaven Keep overlooks the market from the north-western quarter.
    tiles.extend(perimeter_tiles(3, 13, 2, 6, &[(9, 6), (10, 6)]));
    tiles.extend(
        perimeter_tiles(3, 13, 2, 6, &[])
            .into_iter()
            .map(|tile| Position { z: 6, ..tile }),
    );
    tiles.extend(dungeon_wall_tiles());
    tiles
}

fn dungeon_wall_tiles() -> Vec<Position> {
    let mut tiles: Vec<_> = perimeter_tiles(2, 19, 2, 13, &[])
        .into_iter()
        .map(|tile| Position { z: 8, ..tile })
        .collect();
    for y in 3..=10 {
        if y != 6 {
            tiles.push(Position { x: 8, y, z: 8 });
        }
    }
    for x in 9..=18 {
        if x != 14 {
            tiles.push(Position { x, y: 9, z: 8 });
        }
    }
    tiles
}

fn house_wall_tiles() -> Vec<Position> {
    let mut tiles = perimeter_tiles(2, 7, 11, 16, &[(7, 13)]);
    tiles.extend(perimeter_tiles(12, 18, 12, 17, &[(12, 14)]));
    tiles.extend(perimeter_tiles(3, 8, 18, 23, &[(6, 18)]));
    tiles
}

fn floor_tiles() -> Vec<Position> {
    let mut tiles = rectangle_tiles(4, 12, 3, 5);
    tiles.extend(rectangle_tiles(3, 6, 12, 15));
    tiles.extend(rectangle_tiles(13, 17, 13, 16));
    tiles.extend(rectangle_tiles(4, 7, 19, 22));
    tiles.extend(
        rectangle_tiles(4, 12, 3, 5)
            .into_iter()
            .map(|tile| Position { z: 6, ..tile }),
    );
    tiles.extend(
        rectangle_tiles(3, 18, 3, 12)
            .into_iter()
            .map(|tile| Position { z: 8, ..tile }),
    );
    tiles
}

fn road_tiles() -> Vec<Position> {
    let mut tiles = rectangle_tiles(6, 14, 7, 10);
    tiles.extend(rectangle_tiles(14, 54, 8, 9));
    tiles.extend(rectangle_tiles(9, 10, 10, 36));
    tiles.extend(rectangle_tiles(7, 11, 13, 14));
    tiles.extend(rectangle_tiles(6, 11, 18, 19));
    tiles.sort_by_key(|tile| (tile.z, tile.y, tile.x));
    tiles.dedup();
    tiles
}

fn water_tiles() -> Vec<Position> {
    let mut tiles = Vec::new();
    for (start_x, end_x, start_y, end_y) in [
        (24, 27, 3, 6),
        (25, 29, 12, 15),
        (31, 34, 7, 10),
        (34, 37, 17, 20),
        (43, 47, 3, 6),
        (46, 51, 14, 18),
        (39, 43, 27, 31),
    ] {
        for x in start_x..=end_x {
            for y in start_y..=end_y {
                tiles.push(Position { x, y, z: 7 });
            }
        }
    }
    tiles
}

fn tree_tiles() -> Vec<Position> {
    [
        (23, 2),
        (29, 4),
        (40, 3),
        (49, 7),
        (23, 13),
        (31, 18),
        (44, 21),
        (27, 27),
        (36, 29),
        (48, 31),
        (21, 33),
        (52, 34),
    ]
    .into_iter()
    .map(|(x, y)| Position { x, y, z: 7 })
    .collect()
}

#[cfg(test)]
pub fn is_walkable(position: Position) -> bool {
    let within_floor = match position.z {
        7 => position.x > 0 && position.x < 55 && position.y > 0 && position.y < 37,
        6 => position.x > 3 && position.x < 13 && position.y > 2 && position.y < 6,
        8 => position.x > 2 && position.x < 19 && position.y > 2 && position.y < 13,
        _ => false,
    };
    within_floor && !blocked_tile_set().contains(&position)
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_types::{CreatureAttack, CreatureDefinition, LootEntry, RuneRecipe};
    use uuid::Uuid;

    fn catalog(weight: f32) -> ContentCatalog {
        ContentCatalog::from_definitions(vec![ItemDefinition {
            id: "test_item".into(),
            name: "Test".into(),
            weight,
            stackable: true,
            max_stack: 100,
            charges: None,
            attack: None,
            container_slots: None,
            equipment_slot: None,
            pickupable: true,
            combat_effect: None,
            distance_weapon: None,
            food_effect: None,
        }])
        .unwrap()
    }
    fn test_player(id: EntityId, capacity: f32) -> Player {
        Player {
            view: PlayerView {
                id,
                name: "Test".into(),
                vocation: "adventurer".into(),
                position: SPAWN,
                health: 150,
                max_health: 150,
                level: 1,
                experience: 0,
                mana: 50,
                max_mana: 50,
                sword_skill: 10,
                sword_tries: 0,
                distance_skill: 10,
                distance_tries: 0,
                fletching_skill: 0,
                fletching_tries: 0,
                magic_level: 0,
                magic_tries: 0,
            },
            inventory: vec![],
            depot: vec![],
            max_capacity: capacity,
            last_move: Instant::now() - MOVE_COOLDOWN,
            last_attack: Instant::now() - PLAYER_ATTACK_COOLDOWN,
            last_item_use: Instant::now() - Duration::from_secs(1),
            last_spell_cast: Instant::now() - Duration::from_secs(1),
            learned_spells: HashSet::new(),
            crafting_queue: None,
            last_mana_regen: Instant::now(),
            active_food: None,
            last_food_regen: Instant::now(),
        }
    }

    #[test]
    fn spell_trainer_charges_gold_and_casting_spends_mana() {
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.vocation = "mage".into();
        player.view.position = Position { x: 10, y: 6, z: 7 };
        player.view.mana = 50;
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "gold_coin".into(),
            quantity: 20,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(ContentCatalog::load().unwrap(), vec![]);
        world.insert_player(player);

        world
            .learn_spell(player_id, "seraphine_arcanist", "ember_bolt")
            .unwrap();
        assert!(
            world
                .player(player_id)
                .unwrap()
                .learned_spells
                .contains("ember_bolt")
        );
        assert_eq!(world.player(player_id).unwrap().inventory[0].quantity, 5);
        assert_eq!(
            world.learn_spell(player_id, "seraphine_arcanist", "ember_bolt"),
            Err("spell_already_learned")
        );

        world.players.get_mut(&player_id).unwrap().view.position = Position { x: 10, y: 7, z: 7 };
        let creature_id = *world.creatures.keys().next().unwrap();
        world.creatures.get_mut(&creature_id).unwrap().view.position =
            Position { x: 13, y: 7, z: 7 };
        let health = world.creatures[&creature_id].view.health;
        let events = world
            .try_cast_spell(player_id, "ember_bolt", creature_id)
            .unwrap();
        assert!(events.iter().any(|event| matches!(event, WorldEvent::CombatEffect { effect_id, .. } if effect_id == "ember_bolt")));
        assert_eq!(world.player(player_id).unwrap().view.mana, 32);
        assert!(world.creatures[&creature_id].view.health < health);
        assert!(matches!(
            world.try_cast_spell(player_id, "ember_bolt", creature_id),
            Err("spell_cooldown")
        ));
    }
    fn item(quantity: u16) -> ItemInstance {
        ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "test_item".into(),
            quantity,
            charges: None,
            container_id: None,
            equipped_slot: None,
        }
    }

    fn advanced_catalog() -> ContentCatalog {
        ContentCatalog::from_definitions(vec![
            ItemDefinition {
                id: "test_item".into(),
                name: "Stack".into(),
                weight: 1.0,
                stackable: true,
                max_stack: 100,
                charges: None,
                attack: None,
                container_slots: None,
                equipment_slot: None,
                pickupable: true,
                combat_effect: None,
                distance_weapon: None,
                food_effect: None,
            },
            ItemDefinition {
                id: "bag".into(),
                name: "Bag".into(),
                weight: 2.0,
                stackable: false,
                max_stack: 1,
                charges: None,
                attack: None,
                container_slots: Some(3),
                equipment_slot: None,
                pickupable: true,
                combat_effect: None,
                distance_weapon: None,
                food_effect: None,
            },
            ItemDefinition {
                id: "blade".into(),
                name: "Blade".into(),
                weight: 5.0,
                stackable: false,
                max_stack: 1,
                charges: None,
                attack: Some(5),
                container_slots: None,
                equipment_slot: Some("weapon".into()),
                pickupable: true,
                combat_effect: None,
                distance_weapon: None,
                food_effect: None,
            },
        ])
        .unwrap()
    }

    fn combat_catalog() -> ContentCatalog {
        ContentCatalog::from_all_with_recipes(
            vec![
                ItemDefinition {
                    id: "mire_fiber".into(),
                    name: "Fiber".into(),
                    weight: 1.0,
                    stackable: true,
                    max_stack: 100,
                    charges: None,
                    attack: None,
                    container_slots: None,
                    equipment_slot: None,
                    pickupable: true,
                    combat_effect: None,
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "gold_coin".into(),
                    name: "Gold Coin".into(),
                    weight: 0.1,
                    stackable: true,
                    max_stack: 100,
                    charges: None,
                    attack: None,
                    container_slots: None,
                    equipment_slot: None,
                    pickupable: true,
                    combat_effect: None,
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "mireling_remains".into(),
                    name: "Mireling Remains".into(),
                    weight: 30.0,
                    stackable: false,
                    max_stack: 1,
                    charges: None,
                    attack: None,
                    container_slots: Some(8),
                    equipment_slot: None,
                    pickupable: false,
                    combat_effect: None,
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "blank_rune".into(),
                    name: "Blank".into(),
                    weight: 1.2,
                    stackable: true,
                    max_stack: 100,
                    charges: None,
                    attack: None,
                    container_slots: None,
                    equipment_slot: None,
                    pickupable: true,
                    combat_effect: None,
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "ember_rune".into(),
                    name: "Ember".into(),
                    weight: 1.2,
                    stackable: false,
                    max_stack: 1,
                    charges: Some(5),
                    attack: None,
                    container_slots: None,
                    equipment_slot: None,
                    pickupable: true,
                    combat_effect: Some(game_types::ItemCombatEffect {
                        damage: 12,
                        range: 5,
                        cooldown_ms: 800,
                    }),
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "rough_arrow".into(),
                    name: "Arrow".into(),
                    weight: 0.7,
                    stackable: true,
                    max_stack: 100,
                    charges: None,
                    attack: None,
                    container_slots: None,
                    equipment_slot: None,
                    pickupable: true,
                    combat_effect: None,
                    distance_weapon: None,
                    food_effect: None,
                },
                ItemDefinition {
                    id: "ashwood_bow".into(),
                    name: "Bow".into(),
                    weight: 19.0,
                    stackable: false,
                    max_stack: 1,
                    charges: None,
                    attack: None,
                    container_slots: None,
                    equipment_slot: Some("weapon".into()),
                    pickupable: true,
                    combat_effect: None,
                    distance_weapon: Some(game_types::DistanceWeapon {
                        damage: 4,
                        range: 6,
                        cooldown_ms: 750,
                        ammunition_id: "rough_arrow".into(),
                    }),
                    food_effect: None,
                },
            ],
            vec![CreatureDefinition {
                id: "mireling".into(),
                name: "Mireling".into(),
                health: 20,
                experience: 120,
                speed: 80,
                attacks: vec![CreatureAttack {
                    attack_type: "melee".into(),
                    min_damage: 4,
                    max_damage: 8,
                    interval_ms: 1000,
                    range: 1,
                    radius: 0,
                    telegraph_ms: 0,
                    effect_id: String::new(),
                }],
                loot: vec![LootEntry {
                    definition_id: "mire_fiber".into(),
                    chance: 1.0,
                    min_quantity: 2,
                    max_quantity: 2,
                }],
                corpse_id: "mireling_remains".into(),
            }],
            vec![
                RuneRecipe {
                    id: "mark_ember_sigil".into(),
                    name: "Mark Ember Sigil".into(),
                    craft_kind: "sigils".into(),
                    input_definition_id: "blank_rune".into(),
                    input_quantity: 1,
                    output_definition_id: "ember_rune".into(),
                    output_quantity: 1,
                    mana_cost: 35,
                    craft_time_ms: 1500,
                },
                RuneRecipe {
                    id: "fletch_rough_arrows".into(),
                    name: "Fletch Rough Arrows".into(),
                    craft_kind: "fletching".into(),
                    input_definition_id: "mire_fiber".into(),
                    input_quantity: 1,
                    output_definition_id: "rough_arrow".into(),
                    output_quantity: 10,
                    mana_cost: 0,
                    craft_time_ms: 500,
                },
            ],
        )
        .unwrap()
    }

    fn instance(definition_id: &str) -> ItemInstance {
        ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: definition_id.into(),
            quantity: 1,
            charges: None,
            container_id: None,
            equipped_slot: None,
        }
    }

    #[test]
    fn movement_is_validated_by_world() {
        let id = Uuid::new_v4();
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(test_player(id, 100.0));
        assert!(world.try_move(id, Position { x: 11, y: 8, z: 7 }).is_ok());
        assert_eq!(
            world.try_move(id, Position { x: 14, y: 8, z: 7 }),
            Err("invalid_step")
        );
    }

    #[test]
    fn diagonal_movement_cannot_cut_through_a_blocked_corner() {
        let id = Uuid::new_v4();
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(test_player(id, 100.0));
        let side = Position { x: 11, y: 8, z: 7 };
        let target = Position { x: 11, y: 9, z: 7 };
        assert!(world.map.is_walkable(side));
        assert!(world.map.is_walkable(target));
        Arc::make_mut(&mut world.map).blocked.insert(side);
        assert_eq!(world.try_move(id, target), Err("corner_blocked"));
    }

    #[test]
    fn npc_shop_spends_physical_gold_and_delivers_bundles() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        let mut coins = instance("gold_coin");
        coins.quantity = 5;
        player.inventory.push(coins);
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);

        world
            .buy_from_npc(id, "mara_quartermaster", "rough_arrows", 1)
            .unwrap();

        let inventory = &world.player(id).unwrap().inventory;
        assert_eq!(
            inventory
                .iter()
                .filter(|item| item.definition_id == "gold_coin")
                .map(|item| item.quantity)
                .sum::<u16>(),
            2
        );
        assert_eq!(
            inventory
                .iter()
                .filter(|item| item.definition_id == "rough_arrow")
                .map(|item| item.quantity)
                .sum::<u16>(),
            10
        );
    }

    #[test]
    fn rejected_npc_purchases_leave_inventory_unchanged() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        let mut coins = instance("gold_coin");
        coins.quantity = 2;
        player.inventory.push(coins);
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let before = world.player(id).unwrap().inventory.clone();

        assert_eq!(
            world.buy_from_npc(id, "mara_quartermaster", "rough_arrows", 1),
            Err("not_enough_gold")
        );
        assert_eq!(world.player(id).unwrap().inventory, before);

        world.players.get_mut(&id).unwrap().view.position = Position { x: 16, y: 8, z: 7 };
        assert_eq!(
            world.buy_from_npc(id, "mara_quartermaster", "blank_sigil", 1),
            Err("npc_out_of_reach")
        );
        assert_eq!(world.player(id).unwrap().inventory, before);
    }

    #[test]
    fn npc_purchase_capacity_check_is_atomic() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 0.3);
        let mut coins = instance("gold_coin");
        coins.quantity = 2;
        player.inventory.push(coins);
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let before = world.player(id).unwrap().inventory.clone();

        assert_eq!(
            world.buy_from_npc(id, "mara_quartermaster", "blank_sigil", 1),
            Err("shop_capacity_exceeded")
        );
        assert_eq!(world.player(id).unwrap().inventory, before);
    }

    #[test]
    fn players_cannot_walk_through_npcs() {
        let id = Uuid::new_v4();
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(test_player(id, 100.0));

        assert_eq!(
            world.try_move(id, Position { x: 9, y: 8, z: 7 }),
            Err("tile_occupied")
        );
        assert_eq!(world.player(id).unwrap().view.position, SPAWN);
    }

    #[test]
    fn doors_are_server_authoritative_and_cannot_close_on_entities() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 8, y: 13, z: 7 };
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(player);

        let closed = world.toggle_door(id, "vault_house_door").unwrap();
        assert!(!closed.open);
        assert_eq!(
            world.try_move(id, Position { x: 7, y: 13, z: 7 }),
            Err("door_closed")
        );

        assert!(world.toggle_door(id, "vault_house_door").unwrap().open);
        world.players.get_mut(&id).unwrap().last_move = Instant::now() - MOVE_COOLDOWN;
        world.try_move(id, Position { x: 7, y: 13, z: 7 }).unwrap();
        assert_eq!(
            world.toggle_door(id, "vault_house_door"),
            Err("door_occupied")
        );
    }

    #[test]
    fn shutters_are_server_authoritative_and_require_reach() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 3, y: 12, z: 7 };
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(player);

        let opened = world.toggle_window(id, "west_house_window").unwrap();
        assert!(opened.open);
        assert!(
            world
                .map_view()
                .windows
                .iter()
                .find(|window| window.id == opened.id)
                .unwrap()
                .open
        );

        world.players.get_mut(&id).unwrap().view.position = Position { x: 30, y: 30, z: 7 };
        assert_eq!(
            world.toggle_window(id, "west_house_window"),
            Err("window_out_of_reach")
        );
    }

    #[test]
    fn keep_stairs_move_players_between_real_floors() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 4, y: 4, z: 7 };
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(player);

        assert_eq!(
            world.try_move(id, Position { x: 5, y: 4, z: 7 }),
            Ok(Position { x: 5, y: 4, z: 6 })
        );
        world.players.get_mut(&id).unwrap().last_move = Instant::now() - MOVE_COOLDOWN;
        assert_eq!(
            world.try_move(id, Position { x: 6, y: 4, z: 6 }),
            Ok(Position { x: 6, y: 4, z: 7 })
        );
        world.players.get_mut(&id).unwrap().view.position = Position { x: 10, y: 4, z: 7 };
        world.players.get_mut(&id).unwrap().last_move = Instant::now() - MOVE_COOLDOWN;
        assert_eq!(
            world.try_move(id, Position { x: 11, y: 4, z: 7 }),
            Ok(Position { x: 11, y: 4, z: 8 })
        );
        world.players.get_mut(&id).unwrap().last_move = Instant::now() - MOVE_COOLDOWN;
        assert_eq!(
            world.try_move(id, Position { x: 10, y: 4, z: 8 }),
            Ok(Position { x: 10, y: 4, z: 7 })
        );
        assert!(!is_walkable(Position { x: 14, y: 4, z: 6 }));
        assert!(!is_walkable(Position { x: 8, y: 5, z: 8 }));
    }

    #[test]
    fn depot_moves_container_tree_without_changing_item_ids() {
        let id = Uuid::new_v4();
        let mut bag = instance("bag");
        let bag_id = bag.instance_id;
        let mut contents = item(4);
        let contents_id = contents.instance_id;
        contents.container_id = Some(bag_id);
        bag.container_id = None;
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 8, y: 8, z: 7 };
        player.inventory = vec![bag, contents];
        let mut world = World::new(advanced_catalog(), vec![]);
        world.insert_player(player);

        world
            .deposit_item(id, "aldren_vaultkeeper", bag_id)
            .unwrap();
        assert!(world.player(id).unwrap().inventory.is_empty());
        assert_eq!(
            world
                .player(id)
                .unwrap()
                .depot
                .iter()
                .map(|item| item.instance_id)
                .collect::<HashSet<_>>(),
            HashSet::from([bag_id, contents_id])
        );

        world
            .withdraw_item(id, "aldren_vaultkeeper", bag_id)
            .unwrap();
        assert!(world.player(id).unwrap().depot.is_empty());
        assert_eq!(
            world
                .player(id)
                .unwrap()
                .inventory
                .iter()
                .map(|item| item.instance_id)
                .collect::<HashSet<_>>(),
            HashSet::from([bag_id, contents_id])
        );
    }

    #[test]
    fn overweight_depot_withdrawal_is_atomic() {
        let id = Uuid::new_v4();
        let heavy = item(1);
        let heavy_id = heavy.instance_id;
        let mut player = test_player(id, 5.0);
        player.view.position = Position { x: 8, y: 8, z: 7 };
        player.depot.push(heavy);
        let mut world = World::new(catalog(10.0), vec![]);
        world.insert_player(player);

        assert_eq!(
            world.withdraw_item(id, "aldren_vaultkeeper", heavy_id),
            Err("too_heavy")
        );
        assert!(world.player(id).unwrap().inventory.is_empty());
        assert_eq!(world.player(id).unwrap().depot[0].instance_id, heavy_id);
    }

    #[test]
    fn depot_requires_the_physical_vaultkeeper() {
        let id = Uuid::new_v4();
        let stored = item(1);
        let stored_id = stored.instance_id;
        let mut player = test_player(id, 100.0);
        player.depot.push(stored);
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(player);

        assert_eq!(
            world.withdraw_item(id, "aldren_vaultkeeper", stored_id),
            Err("npc_out_of_reach")
        );
        assert_eq!(world.player(id).unwrap().depot[0].instance_id, stored_id);
    }

    #[test]
    fn pickup_and_drop_preserve_exactly_one_item() {
        let id = Uuid::new_v4();
        let ground_item = item(3);
        let instance_id = ground_item.instance_id;
        let mut world = World::new(
            catalog(2.0),
            vec![GroundItem {
                item: ground_item,
                position: Position { x: 11, y: 8, z: 7 },
                contents: Vec::new(),
            }],
        );
        world.insert_player(test_player(id, 10.0));
        world.try_pickup(id, instance_id).unwrap();
        assert!(world.ground_items().is_empty());
        assert_eq!(world.player(id).unwrap().inventory.len(), 1);
        world.try_drop(id, instance_id).unwrap();
        assert_eq!(world.ground_items().len(), 1);
        assert!(world.player(id).unwrap().inventory.is_empty());
    }

    #[test]
    fn expired_corpses_decay_without_removing_dropped_items() {
        let corpse = instance("mireling_remains");
        let corpse_id = corpse.instance_id;
        let dropped = instance("rough_arrow");
        let dropped_id = dropped.instance_id;
        let mut world = World::new(
            combat_catalog(),
            vec![
                GroundItem {
                    item: corpse,
                    position: SPAWN,
                    contents: Vec::new(),
                },
                GroundItem {
                    item: dropped,
                    position: SPAWN,
                    contents: Vec::new(),
                },
            ],
        );
        world
            .ground_decay
            .insert(corpse_id, Instant::now() - Duration::from_millis(1));

        let events = world.tick();

        assert!(
            !world
                .ground_items()
                .iter()
                .any(|ground| ground.item.instance_id == corpse_id)
        );
        assert!(
            world
                .ground_items()
                .iter()
                .any(|ground| ground.item.instance_id == dropped_id)
        );
        assert!(events.iter().any(|event| matches!(event, WorldEvent::GroundItemsChanged(items) if items.iter().all(|ground| ground.item.instance_id != corpse_id))));
    }

    #[test]
    fn overweight_pickup_is_atomic() {
        let id = Uuid::new_v4();
        let ground_item = item(3);
        let instance_id = ground_item.instance_id;
        let mut world = World::new(
            catalog(5.0),
            vec![GroundItem {
                item: ground_item,
                position: SPAWN,
                contents: Vec::new(),
            }],
        );
        world.insert_player(test_player(id, 10.0));
        assert_eq!(world.try_pickup(id, instance_id), Err("too_heavy"));
        assert_eq!(world.ground_items().len(), 1);
        assert!(world.player(id).unwrap().inventory.is_empty());
    }

    #[test]
    fn containers_and_split_preserve_quantity_and_reject_cycles() {
        let id = Uuid::new_v4();
        let first_bag = instance("bag");
        let first_bag_id = first_bag.instance_id;
        let second_bag = instance("bag");
        let second_bag_id = second_bag.instance_id;
        let stack = item(20);
        let stack_id = stack.instance_id;
        let mut player = test_player(id, 100.0);
        player.inventory = vec![first_bag, second_bag, stack];
        let mut world = World::new(advanced_catalog(), vec![]);
        world.insert_player(player);
        world
            .try_move_item(
                id,
                stack_id,
                ItemDestination::Container {
                    container_id: first_bag_id,
                },
            )
            .unwrap();
        world.try_split_item(id, stack_id, 7).unwrap();
        let inventory = &world.player(id).unwrap().inventory;
        assert_eq!(
            inventory
                .iter()
                .filter(|item| item.definition_id == "test_item")
                .map(|item| item.quantity)
                .sum::<u16>(),
            20
        );
        assert!(
            inventory
                .iter()
                .filter(|item| item.definition_id == "test_item")
                .all(|item| item.container_id == Some(first_bag_id))
        );
        world
            .try_move_item(
                id,
                second_bag_id,
                ItemDestination::Container {
                    container_id: first_bag_id,
                },
            )
            .unwrap();
        assert_eq!(
            world.try_move_item(
                id,
                first_bag_id,
                ItemDestination::Container {
                    container_id: second_bag_id
                }
            ),
            Err("container_cycle")
        );
    }

    #[test]
    fn equipment_slot_swaps_compatible_items() {
        let id = Uuid::new_v4();
        let first = instance("blade");
        let first_id = first.instance_id;
        let second = instance("blade");
        let second_id = second.instance_id;
        let mut player = test_player(id, 100.0);
        player.inventory = vec![first, second];
        let mut world = World::new(advanced_catalog(), vec![]);
        world.insert_player(player);
        world
            .try_move_item(
                id,
                first_id,
                ItemDestination::Equipment {
                    slot: "weapon".into(),
                },
            )
            .unwrap();
        world
            .try_move_item(
                id,
                second_id,
                ItemDestination::Equipment {
                    slot: "weapon".into(),
                },
            )
            .unwrap();
        let inventory = &world.player(id).unwrap().inventory;
        assert_eq!(
            inventory
                .iter()
                .find(|item| item.instance_id == first_id)
                .unwrap()
                .equipped_slot,
            None
        );
        assert_eq!(
            inventory
                .iter()
                .find(|item| item.instance_id == second_id)
                .unwrap()
                .equipped_slot
                .as_deref(),
            Some("weapon")
        );
    }

    #[test]
    fn direct_trade_resets_confirmation_and_transfers_each_item_once() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let item_a = item(7);
        let item_a_id = item_a.instance_id;
        let item_b = item(3);
        let item_b_id = item_b.instance_id;
        let mut first = test_player(player_a, 100.0);
        first.view.name = "First".into();
        first.inventory.push(item_a);
        let mut second = test_player(player_b, 100.0);
        second.view.name = "Second".into();
        second.inventory.push(item_b);
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(first);
        world.insert_player(second);

        let trade_id = world.request_trade(player_a, player_b).unwrap();
        assert_eq!(
            world.respond_trade(player_b, trade_id, true),
            Ok(TradeOutcome::Updated)
        );
        world
            .set_trade_offer(player_a, trade_id, vec![item_a_id])
            .unwrap();
        assert_eq!(
            world.confirm_trade(player_a, trade_id),
            Ok(TradeOutcome::Updated)
        );
        assert!(world.trades[&trade_id].confirmed_a);
        world
            .set_trade_offer(player_b, trade_id, vec![item_b_id])
            .unwrap();
        assert!(!world.trades[&trade_id].confirmed_a);
        assert!(!world.trades[&trade_id].confirmed_b);

        world.confirm_trade(player_a, trade_id).unwrap();
        assert_eq!(
            world.confirm_trade(player_b, trade_id),
            Ok(TradeOutcome::Completed { player_a, player_b })
        );
        assert!(!world.trades.contains_key(&trade_id));
        let first_items = &world.player(player_a).unwrap().inventory;
        let second_items = &world.player(player_b).unwrap().inventory;
        assert_eq!(first_items.len(), 1);
        assert_eq!(second_items.len(), 1);
        assert_eq!(first_items[0].instance_id, item_b_id);
        assert_eq!(second_items[0].instance_id, item_a_id);
    }

    #[test]
    fn overweight_trade_is_atomic_and_keeps_the_session_open() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let heavy = item(1);
        let heavy_id = heavy.instance_id;
        let mut first = test_player(player_a, 100.0);
        first.inventory.push(heavy);
        let second = test_player(player_b, 50.0);
        let mut world = World::new(catalog(60.0), vec![]);
        world.insert_player(first);
        world.insert_player(second);
        let trade_id = world.request_trade(player_a, player_b).unwrap();
        world.respond_trade(player_b, trade_id, true).unwrap();
        world
            .set_trade_offer(player_a, trade_id, vec![heavy_id])
            .unwrap();
        world.confirm_trade(player_a, trade_id).unwrap();

        assert!(matches!(
            world.confirm_trade(player_b, trade_id),
            Err("trade_capacity_exceeded")
        ));
        assert_eq!(
            world.player(player_a).unwrap().inventory[0].instance_id,
            heavy_id
        );
        assert!(world.player(player_b).unwrap().inventory.is_empty());
        assert!(!world.trades[&trade_id].confirmed_a);
        assert!(!world.trades[&trade_id].confirmed_b);
    }

    #[test]
    fn disconnect_cancels_trade_without_moving_items() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let mut world = World::new(catalog(1.0), vec![]);
        world.insert_player(test_player(player_a, 100.0));
        world.insert_player(test_player(player_b, 100.0));
        let trade_id = world.request_trade(player_a, player_b).unwrap();

        assert_eq!(
            world.cancel_trade_for_player(player_a),
            Some((trade_id, player_b))
        );
        assert!(!world.trades.contains_key(&trade_id));
    }

    #[test]
    fn combat_kill_awards_xp_and_physical_loot() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 22, y: 8, z: 7 };
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;
        world.try_attack(id, creature_id).unwrap();
        world.players.get_mut(&id).unwrap().last_attack = Instant::now() - PLAYER_ATTACK_COOLDOWN;
        let events = world.try_attack(id, creature_id).unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect { effect_id, target_id, .. }
                if effect_id == "melee_hit" && *target_id == creature_id
        )));
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::CreatureDied { .. }))
        );
        assert_eq!(world.player(id).unwrap().view.experience, 120);
        assert_eq!(world.player(id).unwrap().view.level, 2);
        assert_eq!(world.player(id).unwrap().view.sword_tries, 2);
        let corpse = world
            .ground_items()
            .iter()
            .find(|item| item.item.definition_id == "mireling_remains")
            .unwrap();
        let corpse_id = corpse.item.instance_id;
        let loot_id = corpse.contents[0].instance_id;
        assert_eq!(corpse.contents[0].definition_id, "mire_fiber");
        assert_eq!(corpse.contents[0].quantity, 2);
        assert_eq!(corpse.contents[0].container_id, Some(corpse_id));
        assert_eq!(world.try_pickup(id, corpse_id), Err("item_not_pickupable"));
        world.try_pickup(id, loot_id).unwrap();
        assert!(world.ground_items()[0].contents.is_empty());
        let looted = world
            .player(id)
            .unwrap()
            .inventory
            .iter()
            .find(|item| item.instance_id == loot_id)
            .unwrap();
        assert_eq!(looted.container_id, None);
    }

    #[test]
    fn ember_sigil_deals_ranged_damage_and_consumes_charges() {
        let player_id = Uuid::new_v4();
        let sigil_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.vocation = "warrior".into();
        player.view.position = Position { x: 18, y: 8, z: 7 };
        player.inventory.push(ItemInstance {
            instance_id: sigil_id,
            definition_id: "ember_rune".into(),
            quantity: 1,
            charges: Some(2),
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;

        let events = world
            .try_use_item(player_id, sigil_id, creature_id)
            .unwrap();

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect {
                source_id,
                target_id,
                effect_id,
                damage: 12,
                cooldown_ms: 800,
            } if *source_id == player_id && *target_id == creature_id && effect_id == "ember_rune"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CreatureDamaged {
                health: 8,
                damage: 12,
                ..
            }
        )));
        assert_eq!(
            world.player(player_id).unwrap().inventory[0].charges,
            Some(1)
        );
        assert_eq!(world.player(player_id).unwrap().view.magic_tries, 1);
        world.players.get_mut(&player_id).unwrap().last_item_use =
            Instant::now() - Duration::from_secs(1);
        let events = world
            .try_use_item(player_id, sigil_id, creature_id)
            .unwrap();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::CreatureDied { .. }))
        );
        assert!(world.player(player_id).unwrap().inventory.is_empty());
    }

    #[test]
    fn ember_sigil_rejects_distant_target_without_spending_a_charge() {
        let player_id = Uuid::new_v4();
        let sigil_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.inventory.push(ItemInstance {
            instance_id: sigil_id,
            definition_id: "ember_rune".into(),
            quantity: 1,
            charges: Some(5),
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;

        assert!(matches!(
            world.try_use_item(player_id, sigil_id, creature_id),
            Err("target_out_of_range")
        ));
        assert_eq!(
            world.player(player_id).unwrap().inventory[0].charges,
            Some(5)
        );
    }

    #[test]
    fn ranger_attack_consumes_ammunition_and_trains_distance() {
        let player_id = Uuid::new_v4();
        let bow_id = Uuid::new_v4();
        let arrow_id = Uuid::new_v4();
        let mut player = test_player(player_id, 110.0);
        player.view.vocation = "ranger".into();
        player.view.distance_skill = 12;
        player.view.position = Position { x: 18, y: 8, z: 7 };
        player.last_attack = Instant::now() - Duration::from_secs(1);
        player.inventory.extend([
            ItemInstance {
                instance_id: bow_id,
                definition_id: "ashwood_bow".into(),
                quantity: 1,
                charges: None,
                container_id: None,
                equipped_slot: Some("weapon".into()),
            },
            ItemInstance {
                instance_id: arrow_id,
                definition_id: "rough_arrow".into(),
                quantity: 2,
                charges: None,
                container_id: None,
                equipped_slot: None,
            },
        ]);
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;

        let events = world.try_attack(player_id, creature_id).unwrap();

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect { effect_id, damage: 10, cooldown_ms: 750, .. }
                if effect_id == "rough_arrow"
        )));
        let player = world.player(player_id).unwrap();
        assert_eq!(player.view.distance_tries, 2);
        assert_eq!(player.view.sword_tries, 0);
        assert_eq!(
            player
                .inventory
                .iter()
                .find(|item| item.instance_id == arrow_id)
                .unwrap()
                .quantity,
            1
        );
    }

    #[test]
    fn distance_attack_requires_ammunition_and_clear_sight() {
        assert!(!has_line_of_sight(
            Position { x: 5, y: 10, z: 7 },
            Position { x: 5, y: 12, z: 7 }
        ));
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 110.0);
        player.view.vocation = "ranger".into();
        player.view.position = Position { x: 18, y: 8, z: 7 };
        player.last_attack = Instant::now() - Duration::from_secs(1);
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "ashwood_bow".into(),
            quantity: 1,
            charges: None,
            container_id: None,
            equipped_slot: Some("weapon".into()),
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;

        assert!(matches!(
            world.try_attack(player_id, creature_id),
            Err("out_of_ammunition")
        ));
        assert_eq!(world.player(player_id).unwrap().view.distance_tries, 0);
    }

    #[test]
    fn creature_tick_deals_deterministic_melee_damage() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.position = Position { x: 22, y: 8, z: 7 };
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        for creature in world.creatures.values_mut() {
            creature.last_attack = Instant::now() - Duration::from_secs(2);
        }
        let events = world.tick();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::PlayerStats(_)))
        );
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect { effect_id, target_id, .. }
                if effect_id == "melee_hit" && *target_id == id
        )));
        assert_eq!(world.player(id).unwrap().view.health, 144);
    }

    #[test]
    fn eating_consumes_food_and_regenerates_health_and_mana_over_time() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.view.health = 100;
        player.view.mana = 10;
        let food_id = Uuid::new_v4();
        player.inventory.push(ItemInstance {
            instance_id: food_id,
            definition_id: "field_bread".into(),
            quantity: 2,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(ContentCatalog::load().unwrap(), vec![]);
        world.insert_player(player);

        let (_, remaining_ms) = world.try_eat(id, food_id).unwrap();
        assert!(remaining_ms >= 59_000);
        assert_eq!(world.player(id).unwrap().inventory[0].quantity, 1);
        world.players.get_mut(&id).unwrap().last_food_regen =
            Instant::now() - Duration::from_secs(4);
        world.tick_crafting();
        let player = world.player(id).unwrap();
        assert!(player.view.health >= 104);
        assert!(player.view.mana >= 14);
    }

    #[test]
    fn bone_acolyte_attacks_at_range_with_a_projectile_effect() {
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.position = Position { x: 14, y: 11, z: 8 };
        let mut world = World::new(ContentCatalog::load().unwrap(), vec![]);
        let acolyte_id = world
            .creatures
            .values()
            .find(|creature| creature.view.definition_id == "bone_acolyte")
            .unwrap()
            .view
            .id;
        world.creatures.retain(|id, _| *id == acolyte_id);
        world.creatures.get_mut(&acolyte_id).unwrap().last_attack =
            Instant::now() - Duration::from_secs(2);
        world.insert_player(player);

        let events = world.tick();

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect { source_id, target_id, effect_id, .. }
                if *source_id == acolyte_id && *target_id == player_id && effect_id == "bone_bolt"
        )));
        assert_eq!(world.player(player_id).unwrap().view.health, 138);
    }

    #[test]
    fn cellar_warden_telegraph_can_be_dodged_before_it_resolves() {
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.position = Position { x: 16, y: 5, z: 8 };
        let mut world = World::new(ContentCatalog::load().unwrap(), vec![]);
        let warden_id = world
            .creatures
            .values()
            .find(|creature| creature.view.definition_id == "cellar_warden")
            .unwrap()
            .view
            .id;
        world.creatures.retain(|id, _| *id == warden_id);
        world.creatures.get_mut(&warden_id).unwrap().last_attack =
            Instant::now() - Duration::from_secs(3);
        world.insert_player(player);

        let warning_events = world.tick();
        assert!(warning_events.iter().any(|event| matches!(
            event,
            WorldEvent::AreaTelegraph { source_id, effect_id, radius: 1, .. }
                if *source_id == warden_id && effect_id == "warden_slam"
        )));

        world.players.get_mut(&player_id).unwrap().view.position = Position { x: 14, y: 5, z: 8 };
        world
            .creatures
            .get_mut(&warden_id)
            .unwrap()
            .pending_attack
            .as_mut()
            .unwrap()
            .execute_at = Instant::now() - Duration::from_millis(1);
        let resolution_events = world.tick();

        assert_eq!(world.player(player_id).unwrap().view.health, 150);
        assert!(!resolution_events.iter().any(|event| matches!(
            event,
            WorldEvent::CombatEffect { effect_id, .. } if effect_id == "warden_slam"
        )));
    }

    #[test]
    fn rune_queue_consumes_mana_and_material_into_charged_sigil() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 100.0);
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "blank_rune".into(),
            quantity: 2,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        world.start_crafting(id, "mark_ember_sigil", 1).unwrap();
        world
            .players
            .get_mut(&id)
            .unwrap()
            .crafting_queue
            .as_mut()
            .unwrap()
            .ready_at = Instant::now() - Duration::from_millis(1);
        let updates = world.tick_crafting();
        assert!(updates.iter().any(|update| update.status == "complete"));
        let player = world.player(id).unwrap();
        assert_eq!(player.view.mana, 15);
        assert_eq!(player.view.magic_tries, 1);
        assert_eq!(
            player
                .inventory
                .iter()
                .find(|item| item.definition_id == "blank_rune")
                .unwrap()
                .quantity,
            1
        );
        assert!(
            player
                .inventory
                .iter()
                .any(|item| { item.definition_id == "ember_rune" && item.charges == Some(5) })
        );
    }

    #[test]
    fn physical_vocations_must_trade_for_sigils() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 130.0);
        player.view.vocation = "warrior".into();
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "blank_rune".into(),
            quantity: 1,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);

        assert!(matches!(
            world.start_crafting(id, "mark_ember_sigil", 1),
            Err("vocation_cannot_craft_sigils")
        ));
    }

    #[test]
    fn magical_vocations_train_magic_faster_while_crafting() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 80.0);
        player.view.vocation = "mage".into();
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "blank_rune".into(),
            quantity: 1,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        world.start_crafting(id, "mark_ember_sigil", 1).unwrap();
        world
            .players
            .get_mut(&id)
            .unwrap()
            .crafting_queue
            .as_mut()
            .unwrap()
            .ready_at = Instant::now() - Duration::from_millis(1);

        world.tick_crafting();

        assert_eq!(world.player(id).unwrap().view.magic_tries, 2);
    }

    #[test]
    fn fletching_turns_creature_material_into_stackable_ammunition() {
        let id = Uuid::new_v4();
        let mut player = test_player(id, 130.0);
        player.view.vocation = "warrior".into();
        player.inventory.push(ItemInstance {
            instance_id: Uuid::new_v4(),
            definition_id: "mire_fiber".into(),
            quantity: 2,
            charges: None,
            container_id: None,
            equipped_slot: None,
        });
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        world.start_crafting(id, "fletch_rough_arrows", 2).unwrap();
        for _ in 0..2 {
            world
                .players
                .get_mut(&id)
                .unwrap()
                .crafting_queue
                .as_mut()
                .unwrap()
                .ready_at = Instant::now() - Duration::from_millis(1);
            world.tick_crafting();
        }

        let player = world.player(id).unwrap();
        assert_eq!(player.view.mana, 50);
        assert_eq!(player.view.fletching_tries, 2);
        assert!(
            !player
                .inventory
                .iter()
                .any(|item| item.definition_id == "mire_fiber")
        );
        assert_eq!(
            player
                .inventory
                .iter()
                .filter(|item| item.definition_id == "rough_arrow")
                .map(|item| item.quantity)
                .sum::<u16>(),
            20
        );
    }

    #[test]
    fn walls_are_not_walkable() {
        assert!(!is_walkable(Position { x: 4, y: 2, z: 7 }));
        assert!(is_walkable(SPAWN));
    }

    #[test]
    fn greyhaven_mire_expands_the_world_with_water_and_tiered_spawns() {
        let map = map_view();
        assert_eq!((map.width, map.height), (56, 38));
        assert!(!map.water.is_empty());
        assert!(!map.roads.is_empty());
        assert!(!map.floors.is_empty());
        assert!(!map.house_walls.is_empty());
        assert!(!map.castle_walls.is_empty());
        assert!(
            map.water
                .iter()
                .all(|tile| map.blocked.contains(tile) && !is_walkable(*tile))
        );
        assert!(
            map.house_walls
                .iter()
                .chain(map.castle_walls.iter())
                .all(|tile| map.blocked.contains(tile) && !is_walkable(*tile))
        );
        assert!(is_walkable(Position { x: 20, y: 8, z: 7 }));
        assert!(is_walkable(Position { x: 9, y: 25, z: 7 }));

        let world = World::new(ContentCatalog::load().unwrap(), vec![]);
        assert!(
            world
                .npc_views()
                .iter()
                .all(|npc| is_walkable(npc.position))
        );
        assert!(
            world
                .creature_views()
                .iter()
                .all(|creature| is_walkable(creature.position))
        );
        let definitions: HashSet<_> = world
            .creature_views()
            .into_iter()
            .map(|creature| creature.definition_id)
            .collect();
        assert_eq!(world.creatures.len(), 20);
        assert!(definitions.contains("mireling"));
        assert!(definitions.contains("mire_skulker"));
        assert!(definitions.contains("reed_stalker"));
        assert!(definitions.contains("fen_brute"));
        assert!(definitions.contains("castle_rat"));
        assert!(definitions.contains("crypt_guard"));
        assert!(definitions.contains("bone_acolyte"));
        assert!(definitions.contains("cellar_warden"));
    }

    #[test]
    fn editor_world_document_loads_collision_stairs_and_spawns() {
        let path = std::env::temp_dir().join(format!("aldoria-{}.world.json", Uuid::new_v4()));
        let json = r#"{
          "version": 1,
          "name": "Test Region",
          "width": 4,
          "height": 4,
          "floor": 7,
          "blocked": [{"x":0,"y":0,"z":7}],
          "water": [],
          "roads": [],
          "floors": [{"x":1,"y":1,"z":8}],
          "houseWalls": [],
          "castleWalls": [],
          "windows": [{"x":1,"y":0,"z":7}],
          "buildings": [],
          "doors": [],
          "stairs": [{"id":"down","from":{"x":1,"y":1,"z":7},"to":{"x":1,"y":1,"z":8}}],
          "spawns": [{"id":"rat","definitionId":"castle_rat","position":{"x":2,"y":2,"z":7}}],
          "npcs": [{"id":"test_merchant","name":"Tess","title":"Test Merchant","service":"shop","dialogue":"Supplies for the road.","position":{"x":3,"y":2,"z":7},"offers":[{"id":"coins","itemDefinitionId":"gold_coin","quantity":1,"price":1}],"spellIds":[]}],
          "playerSpawn": {"x":3,"y":3,"z":7}
        }"#;
        fs::write(&path, json).unwrap();

        let loaded = WorldMap::load(&path, &ContentCatalog::load().unwrap());
        fs::remove_file(&path).unwrap();
        let (map, spawns, npcs, name) = loaded.unwrap();

        assert_eq!(name, "Test Region");
        assert_eq!(spawns.len(), 1);
        assert_eq!(npcs.len(), 1);
        assert_eq!(npcs[0].name, "Tess");
        assert_eq!(spawns[0].definition_id, "castle_rat");
        assert_eq!(map.player_spawn, Position { x: 3, y: 3, z: 7 });
        assert!(!map.is_walkable(Position { x: 0, y: 0, z: 7 }));
        assert!(map.is_walkable(Position { x: 1, y: 1, z: 8 }));
        assert_eq!(
            map.stair_destination(Position { x: 1, y: 1, z: 7 }),
            Some(Position { x: 1, y: 1, z: 8 })
        );
        assert_eq!(map.view.windows[0].id, "window_7_1_0");
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.position = Position { x: 1, y: 1, z: 7 };
        let mut world = World::with_map(
            ContentCatalog::load().unwrap(),
            vec![],
            map,
            Some(spawns),
            Some(npcs),
        );
        world.insert_player(player);
        assert!(world.toggle_window(player_id, "window_7_1_0").unwrap().open);
    }

    #[test]
    fn world_map_rejects_dimensions_above_editor_limit() {
        let mut view = map_view();
        view.width = MAX_WORLD_DIMENSION + 1;
        assert!(WorldMap::from_view(view).is_err());
    }

    #[test]
    fn bridge_overrides_water_collision_but_requires_water() {
        let mut view = map_view();
        let bridge = view
            .water
            .iter()
            .copied()
            .find(|position| {
                !view.house_walls.contains(position) && !view.castle_walls.contains(position)
            })
            .expect("built-in world has bridgeable water");
        view.bridges.push(bridge);
        let map = WorldMap::from_view(view).unwrap();
        assert!(map.is_walkable(bridge));
        assert!(map.view.water.contains(&bridge));
        assert!(!map.view.blocked.contains(&bridge));

        let mut invalid = map_view();
        invalid.bridges.push(SPAWN);
        assert!(WorldMap::from_view(invalid).is_err());
    }

    #[test]
    fn authored_trees_are_server_authoritative_obstacles() {
        let mut view = map_view();
        let tree = Position { x: 22, y: 2, z: 7 };
        view.trees.push(tree);
        let map = WorldMap::from_view(view).unwrap();
        assert!(!map.is_walkable(tree));
        assert!(map.view.blocked.contains(&tree));
    }

    #[test]
    fn authored_atmosphere_decorations_and_materials_survive_validation() {
        let mut view = map_view();
        let window = WindowView {
            id: "test_window".into(),
            position: Position { x: 3, y: 11, z: 7 },
            open: false,
        };
        let torch = Position { x: 4, y: 12, z: 7 };
        let material_position = Position { x: 5, y: 12, z: 7 };
        view.windows = vec![window.clone()];
        view.torches = vec![torch];
        view.terrain_materials = vec![TerrainMaterialView {
            position: material_position,
            material: "moss_stone".into(),
        }];
        let map = WorldMap::from_view(view).unwrap();
        assert_eq!(map.view.windows, vec![window]);
        assert_eq!(map.view.torches, vec![torch]);
        assert_eq!(map.view.terrain_materials[0].position, material_position);

        let mut invalid = map_view();
        invalid.terrain_materials.push(TerrainMaterialView {
            position: material_position,
            material: "lava".into(),
        });
        assert!(WorldMap::from_view(invalid).is_err());
    }

    #[test]
    fn canonical_house_walls_block_edges_instead_of_whole_tiles() {
        let map = WorldMap::default_greyhaven();
        let outside = Position { x: 3, y: 10, z: 7 };
        let inside = Position { x: 3, y: 11, z: 7 };
        assert!(map.is_walkable(outside));
        assert!(map.is_walkable(inside));
        assert!(map.is_house_wall_anchor(inside));
        assert!(!map.is_house_wall_anchor(Position { x: 4, y: 12, z: 7 }));
        assert_eq!(map.house_wall_crossing(outside, inside), Some(inside));
        assert_eq!(
            map.house_wall_crossing(inside, Position { x: 4, y: 11, z: 7 }),
            None
        );
        let outside_corner = Position { x: 1, y: 10, z: 7 };
        let corner_inside = Position { x: 2, y: 11, z: 7 };
        let horizontal = Position { x: 2, y: 10, z: 7 };
        let vertical = Position { x: 1, y: 11, z: 7 };
        assert_eq!(
            map.house_wall_crossing(horizontal, corner_inside),
            Some(corner_inside)
        );
        assert_eq!(
            map.house_wall_crossing(vertical, corner_inside),
            Some(corner_inside)
        );
        assert_eq!(map.house_wall_crossing(outside_corner, horizontal), None);
        assert_eq!(map.house_wall_crossing(outside_corner, vertical), None);
    }

    #[test]
    fn authored_wall_outline_repairs_stale_editor_building_footprint() {
        let mut view = map_view();
        let expected = view
            .buildings
            .iter()
            .find(|building| building.id == "west_house")
            .cloned()
            .unwrap();
        let stale = view
            .buildings
            .iter_mut()
            .find(|building| building.id == "west_house")
            .unwrap();
        stale.x += 1;
        stale.y -= 1;
        stale.width -= 1;

        align_house_buildings_to_authored_walls(&mut view);

        let repaired = view
            .buildings
            .iter()
            .find(|building| building.id == "west_house")
            .unwrap();
        assert_eq!((repaired.x, repaired.y), (expected.x, expected.y));
        assert_eq!(
            (repaired.width, repaired.height),
            (expected.width, expected.height)
        );
    }

    #[test]
    fn skill_requirements_increase_after_level_up() {
        let mut level = 0;
        let mut tries = 0;
        for _ in 0..skill_tries_required(level) {
            advance_skill(&mut level, &mut tries, 1);
        }
        assert_eq!(level, 1);
        assert_eq!(tries, 0);
        assert_eq!(skill_tries_required(level), 7);
    }

    #[test]
    fn pathfinding_routes_around_the_wall() {
        let map = WorldMap::default_greyhaven();
        let goal = Position { x: 5, y: 12, z: 7 };
        let mut current = Position { x: 5, y: 10, z: 7 };
        let mut steps = Vec::new();
        for _ in 0..20 {
            if current == goal {
                break;
            }
            current = next_path_step_on(&map, current, goal, &HashSet::new()).expect("path exists");
            assert!(map.is_walkable(current));
            steps.push(current);
        }
        assert_eq!(current, goal);
        assert!(steps.iter().any(|step| step.x > 7));
    }

    #[test]
    fn world_region_contains_only_nearby_map_payload() {
        let world = World::new(combat_catalog(), vec![]);
        let full = world.map_view();
        let region = world.map_view_near(SPAWN, 3);
        let nearby = |position: &Position| position_in_region(*position, SPAWN, 3);

        let expected = |positions: &[Position]| {
            positions
                .iter()
                .filter(|position| nearby(position))
                .copied()
                .collect::<HashSet<_>>()
        };

        assert_eq!(
            region.blocked.iter().copied().collect::<HashSet<_>>(),
            expected(&full.blocked)
        );
        assert_eq!(
            region.water.iter().copied().collect::<HashSet<_>>(),
            expected(&full.water)
        );
        assert_eq!(
            region.floors.iter().copied().collect::<HashSet<_>>(),
            expected(&full.floors)
        );
        assert!(region.blocked.len() < full.blocked.len());
        assert_eq!((region.width, region.height), (full.width, full.height));
    }

    #[test]
    fn leashed_creature_returns_immune_and_resets_health() {
        let player_id = Uuid::new_v4();
        let mut player = test_player(player_id, 100.0);
        player.view.position = Position { x: 8, y: 8, z: 7 };
        let mut world = World::new(combat_catalog(), vec![]);
        world.insert_player(player);
        let creature_id = world
            .creature_views()
            .into_iter()
            .find(|creature| creature.position == Position { x: 23, y: 8, z: 7 })
            .unwrap()
            .id;
        let creature = world.creatures.get_mut(&creature_id).unwrap();
        creature.target = Some(player_id);
        creature.state = CreatureState::Chasing;
        creature.view.state = "chasing".into();
        creature.view.health = 4;

        let events = world.tick();

        let creature = world.creatures.get(&creature_id).unwrap();
        assert_eq!(creature.state, CreatureState::Returning);
        assert!(creature.view.immune);
        assert_eq!(creature.view.health, creature.view.max_health);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::CreatureStateChanged {
                state: "returning",
                immune: true,
                ..
            }
        )));
        world.players.get_mut(&player_id).unwrap().view.position = Position { x: 22, y: 8, z: 7 };
        assert!(matches!(
            world.try_attack(player_id, creature_id),
            Err("creature_evading")
        ));
    }
}
