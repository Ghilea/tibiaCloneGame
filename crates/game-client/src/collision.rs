use std::collections::{HashMap, HashSet};

use bevy::prelude::Resource;
use game_protocol::{DoorView, MapView};
use game_types::{NpcView, Position};

#[derive(Debug, Clone, Copy)]
pub struct PredictedStep {
    pub destination: Position,
}

#[derive(Resource)]
pub struct LocalCollision {
    width: i32,
    height: i32,
    base_floor: i16,
    blocked: HashSet<Position>,
    walkable_upper_tiles: HashSet<Position>,
    house_wall_crossings: HashMap<(Position, Position), Position>,
    house_wall_anchors: HashSet<Position>,
    doors: HashMap<String, DoorView>,
    npc_positions: HashSet<Position>,
    stairs: HashMap<Position, Position>,
}

impl LocalCollision {
    pub fn from_region(map: &MapView, npcs: &[NpcView]) -> Self {
        let mut value = Self {
            width: map.width,
            height: map.height,
            base_floor: map.floor,
            blocked: HashSet::new(),
            walkable_upper_tiles: HashSet::new(),
            house_wall_crossings: HashMap::new(),
            house_wall_anchors: HashSet::new(),
            doors: HashMap::new(),
            npc_positions: HashSet::new(),
            stairs: HashMap::new(),
        };
        value.replace_region(map, npcs);
        value
    }

    pub fn replace_region(&mut self, map: &MapView, npcs: &[NpcView]) {
        self.width = map.width;
        self.height = map.height;
        self.base_floor = map.floor;

        self.blocked.clear();
        self.blocked.extend(map.blocked.iter().copied());

        self.walkable_upper_tiles.clear();
        self.walkable_upper_tiles.extend(
            map.floors
                .iter()
                .chain(map.roads.iter())
                .chain(map.bridges.iter())
                .chain(map.doors.iter().map(|door| &door.position))
                .chain(
                    map.stairs
                        .iter()
                        .flat_map(|stairs| [&stairs.from, &stairs.to]),
                )
                .filter(|position| position.z != map.floor)
                .copied(),
        );

        let (crossings, anchors) = build_house_wall_indexes(map);
        self.house_wall_crossings = crossings;
        self.house_wall_anchors = anchors;

        self.doors.clear();
        self.doors.extend(
            map.doors
                .iter()
                .cloned()
                .map(|door| (door.id.clone(), door)),
        );

        self.npc_positions.clear();
        self.npc_positions
            .extend(npcs.iter().map(|npc| npc.position));

        self.stairs.clear();
        for stair in &map.stairs {
            self.stairs.insert(stair.from, stair.to);
            self.stairs.insert(stair.to, stair.from);
        }
    }

    pub fn update_door(&mut self, door: DoorView) {
        self.doors.insert(door.id.clone(), door);
    }

    pub fn predict_step(
        &self,
        current: Position,
        target: Position,
    ) -> Result<PredictedStep, &'static str> {
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

        Ok(PredictedStep {
            destination: self.stairs.get(&target).copied().unwrap_or(target),
        })
    }

    fn step_is_blocked(&self, from: Position, to: Position) -> bool {
        self.step_block_reason(from, to).is_some()
    }

    fn step_block_reason(&self, from: Position, to: Position) -> Option<&'static str> {
        if !self.is_walkable(to) {
            return Some("tile_blocked");
        }

        if self.npc_positions.contains(&to) {
            return Some("tile_occupied");
        }

        if let Some(anchor) = self.house_wall_crossings.get(&(from, to)).copied() {
            return match self.doors.values().find(|door| door.position == anchor) {
                Some(door) if door.open => None,
                Some(_) => Some("door_closed"),
                None => Some("wall_blocked"),
            };
        }

        self.doors
            .values()
            .any(|door| {
                !door.open
                    && door.position == to
                    && !self.house_wall_anchors.contains(&door.position)
            })
            .then_some("door_closed")
    }

    fn is_walkable(&self, position: Position) -> bool {
        let in_bounds = position.x >= 0
            && position.y >= 0
            && position.x < self.width
            && position.y < self.height;
        let floor_exists =
            position.z == self.base_floor || self.walkable_upper_tiles.contains(&position);

        in_bounds && floor_exists && !self.blocked.contains(&position)
    }
}

fn build_house_wall_indexes(
    map: &MapView,
) -> (HashMap<(Position, Position), Position>, HashSet<Position>) {
    let mut crossings = HashMap::new();
    let mut anchors = HashSet::new();

    let mut add_crossing = |outside: Position, inside: Position, anchor: Position| {
        crossings.insert((outside, inside), anchor);
        crossings.insert((inside, outside), anchor);
        anchors.insert(anchor);
    };

    for building in map
        .buildings
        .iter()
        .filter(|building| building.kind == "house")
    {
        let max_x = building.x + building.width - 1;
        let max_y = building.y + building.height - 1;

        for x in building.x..=max_x {
            let north = Position {
                x,
                y: building.y,
                z: building.floor,
            };
            let south = Position {
                x,
                y: max_y,
                z: building.floor,
            };

            add_crossing(
                Position {
                    y: north.y - 1,
                    ..north
                },
                north,
                north,
            );
            add_crossing(
                Position {
                    y: south.y + 1,
                    ..south
                },
                south,
                south,
            );
        }

        for y in building.y..=max_y {
            let west = Position {
                x: building.x,
                y,
                z: building.floor,
            };
            let east = Position {
                x: max_x,
                y,
                z: building.floor,
            };

            add_crossing(
                Position {
                    x: west.x - 1,
                    ..west
                },
                west,
                west,
            );
            add_crossing(
                Position {
                    x: east.x + 1,
                    ..east
                },
                east,
                east,
            );
        }
    }

    (crossings, anchors)
}
