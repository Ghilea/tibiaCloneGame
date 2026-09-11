use bevy::prelude::*;
use game_protocol::{BuildingView, DoorView, WindowView};
use game_types::Position;

use crate::{BuildingRoof, HouseWallOccluder, WorldStatic};

// TIBIAGAME_V36_9_4_HOUSE_ALIGNMENT_OPENING_STREAM_PRIORITY
// TIBIAGAME_V36_13_WORLD_BOUNDARY_FLOOR_PRELOAD
// TIBIAGAME_V36_14_MEDIEVAL_FACADE_CREATURE_WARMUP

pub const HOUSE_WALL_HEIGHT: f32 = 2.64;
pub const CASTLE_WALL_HEIGHT: f32 = 3.00;
const HOUSE_WALL_THICKNESS: f32 = 0.16;
const CASTLE_WALL_THICKNESS: f32 = 0.24;
const HOUSE_WALL_LENGTH: f32 = 1.00;
const CASTLE_WALL_LENGTH: f32 = 1.00;
const HOUSE_WALL_PANEL_ROWS: usize = 3;
const CASTLE_WALL_PANEL_ROWS: usize = 3;
const WALL_EDGE_OFFSET: f32 = 0.50;
const BUILDING_FLOOR_INSET: f32 = 0.10;
const ROOF_EAVE_Y: f32 = HOUSE_WALL_HEIGHT + 0.02;
const ROOF_ANGLE: f32 = 0.52;
const ROOF_OVERHANG: f32 = 0.34;
const GABLE_STEP_HEIGHT: f32 = 0.22;
const GROUND_CHUNK_TILES: i32 = 16;

#[derive(Debug, Clone, Copy)]
pub struct BridgeEdges {
    pub north: bool,
    pub south: bool,
    pub west: bool,
    pub east: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct GroundPatch {
    pub center: Vec2,
    pub size: Vec2,
}

#[derive(Debug, Clone, Copy)]
pub struct WallAxes {
    pub horizontal: bool,
    pub vertical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WallEdge {
    North,
    South,
    West,
    East,
}

impl WallEdge {
    pub fn horizontal(self) -> bool {
        matches!(self, Self::North | Self::South)
    }

    pub fn local_offset(self) -> Vec3 {
        match self {
            Self::North => Vec3::new(0.0, 0.0, -WALL_EDGE_OFFSET),
            Self::South => Vec3::new(0.0, 0.0, WALL_EDGE_OFFSET),
            Self::West => Vec3::new(-WALL_EDGE_OFFSET, 0.0, 0.0),
            Self::East => Vec3::new(WALL_EDGE_OFFSET, 0.0, 0.0),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct WallEdges {
    pub north: bool,
    pub south: bool,
    pub west: bool,
    pub east: bool,
}

impl WallEdges {
    pub fn any(self) -> bool {
        self.north || self.south || self.west || self.east
    }

    fn count(self) -> usize {
        self.north as usize + self.south as usize + self.west as usize + self.east as usize
    }
}

#[derive(Resource)]
pub struct ArchitectureCatalog {
    cube: Handle<Mesh>,
    timber: Handle<StandardMaterial>,
    plaster: Handle<StandardMaterial>,
}

impl ArchitectureCatalog {
    pub fn new(meshes: &mut Assets<Mesh>, materials: &mut Assets<StandardMaterial>) -> Self {
        Self {
            cube: meshes.add(Cuboid::default()),
            timber: materials.add(StandardMaterial {
                base_color: Color::srgb(0.27, 0.145, 0.07),
                perceptual_roughness: 0.89,
                ..default()
            }),
            plaster: materials.add(StandardMaterial {
                base_color: Color::srgb(0.79, 0.72, 0.58),
                perceptual_roughness: 0.96,
                ..default()
            }),
        }
    }
}

pub fn has_opening(position: Position, doors: &[DoorView], windows: &[WindowView]) -> bool {
    doors.iter().any(|door| door.position == position)
        || windows.iter().any(|window| window.position == position)
}

pub fn infer_wall_axes(
    position: Position,
    house_walls: &[Position],
    castle_walls: &[Position],
) -> WallAxes {
    let has = |x: i32, y: i32| {
        house_walls
            .iter()
            .chain(castle_walls.iter())
            .any(|wall| wall.z == position.z && wall.x == x && wall.y == y)
    };

    let horizontal = has(position.x - 1, position.y) || has(position.x + 1, position.y);
    let vertical = has(position.x, position.y - 1) || has(position.x, position.y + 1);

    if !horizontal && !vertical {
        WallAxes {
            horizontal: true,
            vertical: false,
        }
    } else {
        WallAxes {
            horizontal,
            vertical,
        }
    }
}

/// House wall positions are logical *inside boundary tiles*. Collision already
/// treats the actual wall as the edge between that tile and the outside tile.
/// The old renderer always used the north/west (-0.5) edge, which placed every
/// south/east wall one whole tile inward. Derive the exact edge from the
/// BuildingView rectangle so rendering, doors and collision share coordinates.
pub fn infer_house_wall_edges(
    position: Position,
    buildings: &[BuildingView],
    house_walls: &[Position],
    castle_walls: &[Position],
) -> WallEdges {
    for building in buildings.iter().filter(|building| {
        building.floor == position.z && building.width > 0 && building.height > 0
    }) {
        let max_x = building.x + building.width - 1;
        let max_y = building.y + building.height - 1;
        if position.x < building.x
            || position.x > max_x
            || position.y < building.y
            || position.y > max_y
        {
            continue;
        }

        let edges = WallEdges {
            north: position.y == building.y,
            south: position.y == max_y,
            west: position.x == building.x,
            east: position.x == max_x,
        };
        if edges.any() {
            return edges;
        }
    }

    // Non-building/free-form legacy walls retain their old convention.
    let axes = infer_wall_axes(position, house_walls, castle_walls);
    WallEdges {
        north: axes.horizontal,
        south: false,
        west: axes.vertical,
        east: false,
    }
}

pub fn infer_opening_edge(
    position: Position,
    buildings: &[BuildingView],
    house_walls: &[Position],
    castle_walls: &[Position],
) -> WallEdge {
    let edges = infer_house_wall_edges(position, buildings, house_walls, castle_walls);

    if edges.count() == 1 {
        if edges.north {
            return WallEdge::North;
        }
        if edges.south {
            return WallEdge::South;
        }
        if edges.west {
            return WallEdge::West;
        }
        return WallEdge::East;
    }

    // A door/window should normally not occupy a corner. If content does place
    // one there, follow the stronger continuous wall axis and then preserve the
    // correct boundary sign from the building rectangle.
    let has = |x: i32, y: i32| {
        house_walls
            .iter()
            .chain(castle_walls.iter())
            .any(|wall| wall.z == position.z && wall.x == x && wall.y == y)
    };
    let horizontal_score =
        has(position.x - 1, position.y) as usize + has(position.x + 1, position.y) as usize;
    let vertical_score =
        has(position.x, position.y - 1) as usize + has(position.x, position.y + 1) as usize;

    if horizontal_score >= vertical_score {
        if edges.north {
            WallEdge::North
        } else if edges.south {
            WallEdge::South
        } else {
            WallEdge::North
        }
    } else if edges.west {
        WallEdge::West
    } else if edges.east {
        WallEdge::East
    } else {
        WallEdge::West
    }
}

pub fn spawn_house_wall(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    position: Position,
    edges: WallEdges,
) -> Entity {
    let root = commands
        .spawn((
            Name::new("House Wall"),
            WorldStatic,
            HouseWallOccluder { position },
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        if edges.north {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::North, false);
        }
        if edges.south {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::South, false);
        }
        if edges.west {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::West, false);
        }
        if edges.east {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::East, false);
        }
    });

    root
}

/// Free-form/castle walls keep the old axis semantics. House walls should use
/// spawn_house_wall so south/east boundary signs are not lost.
pub fn spawn_wall(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    position: Position,
    axes: WallAxes,
    castle: bool,
) -> Entity {
    let root = commands
        .spawn((
            Name::new(if castle { "Castle Wall" } else { "Legacy Wall" }),
            WorldStatic,
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        if axes.horizontal {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::North, castle);
        }
        if axes.vertical {
            spawn_wall_edge(parent, catalog, material.clone(), WallEdge::West, castle);
        }
    });

    root
}

fn spawn_wall_edge(
    parent: &mut ChildSpawnerCommands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    edge: WallEdge,
    castle: bool,
) {
    let height = if castle {
        CASTLE_WALL_HEIGHT
    } else {
        HOUSE_WALL_HEIGHT
    };
    let thickness = if castle {
        CASTLE_WALL_THICKNESS
    } else {
        HOUSE_WALL_THICKNESS
    };
    let length = if castle {
        CASTLE_WALL_LENGTH
    } else {
        HOUSE_WALL_LENGTH
    };
    let rows = if castle {
        CASTLE_WALL_PANEL_ROWS
    } else {
        HOUSE_WALL_PANEL_ROWS
    };
    let horizontal = edge.horizontal();
    let axis_offset = edge.local_offset();
    let panel_height = height / rows.max(1) as f32;

    if castle {
        for row in 0..rows {
            let y = panel_height * (row as f32 + 0.5);
            parent.spawn((
                Name::new("Castle wall texture panel"),
                Mesh3d(catalog.cube.clone()),
                MeshMaterial3d(material.clone()),
                Transform {
                    translation: axis_offset + Vec3::new(0.0, y, 0.0),
                    scale: if horizontal {
                        Vec3::new(length, panel_height + 0.01, thickness)
                    } else {
                        Vec3::new(thickness, panel_height + 0.01, length)
                    },
                    ..default()
                },
            ));
        }

        parent.spawn((
            Name::new("Wall top cap"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(material),
            Transform {
                translation: axis_offset + Vec3::new(0.0, height - 0.035, 0.0),
                scale: if horizontal {
                    Vec3::new(length + 0.01, 0.09, thickness + 0.02)
                } else {
                    Vec3::new(thickness + 0.02, 0.09, length + 0.01)
                },
                ..default()
            },
        ));
        return;
    }

    // V36.14: replace the noisy/misaligned facade look with a consistent
    // medieval half-timber style. Every house wall uses the same plaster infill
    // and the same timber frame language, regardless of tile orientation.
    parent.spawn((
        Name::new("House wall plaster field"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.plaster.clone()),
        Transform {
            translation: axis_offset + Vec3::new(0.0, height * 0.5, 0.0),
            scale: if horizontal {
                Vec3::new(length, height - 0.02, thickness * 0.90)
            } else {
                Vec3::new(thickness * 0.90, height - 0.02, length)
            },
            ..default()
        },
    ));

    parent.spawn((
        Name::new("House wall sill beam"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.timber.clone()),
        Transform {
            translation: axis_offset + Vec3::new(0.0, 0.10, 0.0),
            scale: if horizontal {
                Vec3::new(length + 0.01, 0.10, thickness + 0.02)
            } else {
                Vec3::new(thickness + 0.02, 0.10, length + 0.01)
            },
            ..default()
        },
    ));

    parent.spawn((
        Name::new("House wall top cap"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.timber.clone()),
        Transform {
            translation: axis_offset + Vec3::new(0.0, height - 0.035, 0.0),
            scale: if horizontal {
                Vec3::new(length + 0.01, 0.09, thickness + 0.02)
            } else {
                Vec3::new(thickness + 0.02, 0.09, length + 0.01)
            },
            ..default()
        },
    ));

    for y in [0.72f32, 1.46, 2.18] {
        parent.spawn((
            Name::new("House wall timber beam"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(catalog.timber.clone()),
            Transform {
                translation: axis_offset + Vec3::new(0.0, y, 0.0),
                scale: if horizontal {
                    Vec3::new(length + 0.01, 0.07, thickness + 0.02)
                } else {
                    Vec3::new(thickness + 0.02, 0.07, length + 0.01)
                },
                ..default()
            },
        ));
    }

    for offset in [-0.34f32, 0.0, 0.34] {
        parent.spawn((
            Name::new("House wall timber stud"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(catalog.timber.clone()),
            Transform {
                translation: axis_offset
                    + if horizontal {
                        Vec3::new(offset, height * 0.5, 0.0)
                    } else {
                        Vec3::new(0.0, height * 0.5, offset)
                    },
                scale: if horizontal {
                    Vec3::new(0.08, height + 0.02, thickness + 0.02)
                } else {
                    Vec3::new(thickness + 0.02, height + 0.02, 0.08)
                },
                ..default()
            },
        ));
    }
}

pub fn ground_patches(center: Position, radius: i32, width: i32, height: i32) -> Vec<GroundPatch> {
    let radius = radius.max(1);
    let min_x = (center.x - radius).max(0);
    let min_y = (center.y - radius).max(0);
    let max_x = (center.x + radius).min(width.saturating_sub(1));
    let max_y = (center.y + radius).min(height.saturating_sub(1));
    if min_x > max_x || min_y > max_y {
        return Vec::new();
    }

    let mut patches = Vec::new();
    let mut start_y = min_y;
    while start_y <= max_y {
        let patch_height = (max_y - start_y + 1).min(GROUND_CHUNK_TILES);
        let mut start_x = min_x;
        while start_x <= max_x {
            let patch_width = (max_x - start_x + 1).min(GROUND_CHUNK_TILES);
            patches.push(GroundPatch {
                center: Vec2::new(
                    start_x as f32 + (patch_width - 1) as f32 * 0.5,
                    start_y as f32 + (patch_height - 1) as f32 * 0.5,
                ),
                size: Vec2::new(patch_width as f32, patch_height as f32),
            });
            start_x += patch_width;
        }
        start_y += patch_height;
    }

    patches
}

pub fn spawn_ground_chunk(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    patch: GroundPatch,
) -> Entity {
    commands
        .spawn((
            Name::new("Grass Ground Underlay"),
            WorldStatic,
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(material),
            Transform {
                translation: Vec3::new(patch.center.x, -0.016, patch.center.y),
                scale: Vec3::new(patch.size.x, 0.020, patch.size.y),
                ..default()
            },
        ))
        .id()
}

pub fn infer_bridge_edges(position: Position, bridges: &[Position]) -> BridgeEdges {
    let has = |x: i32, y: i32| {
        bridges
            .iter()
            .any(|bridge| bridge.z == position.z && bridge.x == x && bridge.y == y)
    };

    // Determine the full connected bridge footprint. Looking only at direct
    // neighbours fails for bridges wider than one tile: an interior tile then
    // appears to run in both directions and receives rails on every edge.
    let mut component = vec![position];
    let mut cursor = 0;
    while cursor < component.len() {
        let tile = component[cursor];
        cursor += 1;
        for candidate in bridges.iter().copied().filter(|candidate| {
            candidate.z == position.z
                && (candidate.x - tile.x).abs() + (candidate.y - tile.y).abs() == 1
        }) {
            if !component.contains(&candidate) {
                component.push(candidate);
            }
        }
    }

    let min_x = component
        .iter()
        .map(|tile| tile.x)
        .min()
        .unwrap_or(position.x);
    let max_x = component
        .iter()
        .map(|tile| tile.x)
        .max()
        .unwrap_or(position.x);
    let min_y = component
        .iter()
        .map(|tile| tile.y)
        .min()
        .unwrap_or(position.y);
    let max_y = component
        .iter()
        .map(|tile| tile.y)
        .max()
        .unwrap_or(position.y);
    let runs_east_west = max_x - min_x >= max_y - min_y;

    // Only exposed edges parallel to the bridge length receive rails. This
    // leaves both entrances open and avoids rails between adjacent deck tiles.
    if runs_east_west {
        BridgeEdges {
            north: !has(position.x, position.y - 1),
            south: !has(position.x, position.y + 1),
            west: false,
            east: false,
        }
    } else {
        BridgeEdges {
            north: false,
            south: false,
            west: !has(position.x - 1, position.y),
            east: !has(position.x + 1, position.y),
        }
    }
}

pub fn spawn_bridge(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    position: Position,
    edges: BridgeEdges,
) -> Entity {
    let root = commands
        .spawn((
            Name::new("Bridge"),
            WorldStatic,
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        parent.spawn((
            Name::new("Bridge deck"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(material),
            Transform {
                translation: Vec3::new(0.0, 0.075, 0.0),
                scale: Vec3::new(0.98, 0.09, 0.98),
                ..default()
            },
        ));

        if edges.north {
            spawn_bridge_rail(parent, catalog, Vec3::new(0.0, 0.48, -0.46), true);
        }
        if edges.south {
            spawn_bridge_rail(parent, catalog, Vec3::new(0.0, 0.48, 0.46), true);
        }
        if edges.west {
            spawn_bridge_rail(parent, catalog, Vec3::new(-0.46, 0.48, 0.0), false);
        }
        if edges.east {
            spawn_bridge_rail(parent, catalog, Vec3::new(0.46, 0.48, 0.0), false);
        }
    });

    root
}

fn spawn_bridge_rail(
    parent: &mut ChildSpawnerCommands,
    catalog: &ArchitectureCatalog,
    offset: Vec3,
    horizontal: bool,
) {
    parent.spawn((
        Name::new("Bridge rail"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.timber.clone()),
        Transform {
            translation: offset,
            scale: if horizontal {
                Vec3::new(0.92, 0.09, 0.08)
            } else {
                Vec3::new(0.08, 0.09, 0.92)
            },
            ..default()
        },
    ));

    let post_a = if horizontal {
        Vec3::new(-0.39, -0.08, 0.0)
    } else {
        Vec3::new(0.0, -0.08, -0.39)
    };
    let post_b = -post_a;

    for post in [post_a, post_b] {
        parent.spawn((
            Name::new("Bridge post"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(catalog.timber.clone()),
            Transform {
                translation: offset + post,
                scale: Vec3::new(0.10, 0.74, 0.10),
                ..default()
            },
        ));
    }
}

pub fn spawn_building(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    materials: &mut Assets<StandardMaterial>,
    wall_material: Handle<StandardMaterial>,
    floor_material: Handle<StandardMaterial>,
    roof_material: Handle<StandardMaterial>,
    name: &str,
    floor: i16,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (Entity, Entity) {
    let width = width.max(1) as f32;
    let depth = height.max(1) as f32;
    let center_x = x as f32 + (width - 1.0) * 0.5;
    let center_z = y as f32 + (depth - 1.0) * 0.5;

    // Per-building material handles are required for selective cutaway. Using
    // the shared world roof/wall handles would fade every house at once.
    let mut roof_material_value = materials
        .get(&roof_material)
        .cloned()
        .expect("world roof material exists before building spawn");
    roof_material_value.alpha_mode = AlphaMode::Blend;
    let roof_material = materials.add(roof_material_value);

    let mut gable_material_value = materials
        .get(&wall_material)
        .cloned()
        .expect("world wall material exists before building spawn");
    gable_material_value.alpha_mode = AlphaMode::Blend;
    let gable_material = materials.add(gable_material_value);

    // Collision boundaries are at +/-0.5 outside the perimeter tile centers.
    // Keep the floor just inside the inner wall faces instead of the old 0.34
    // inset, which made the visible floor edge disagree with collision.
    let floor_scale_x = (width - BUILDING_FLOOR_INSET * 2.0).max(0.58);
    let floor_scale_z = (depth - BUILDING_FLOOR_INSET * 2.0).max(0.58);

    let floor_entity = commands
        .spawn((
            Name::new(format!("Building Floor · {name}")),
            WorldStatic,
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(floor_material),
            Transform {
                translation: Vec3::new(center_x, 0.07, center_z),
                scale: Vec3::new(floor_scale_x, 0.08, floor_scale_z),
                ..default()
            },
        ))
        .id();

    let roof = commands
        .spawn((
            Name::new(format!("Building Roof · {name}")),
            WorldStatic,
            BuildingRoof {
                floor,
                min_x: center_x - width * 0.5 - 0.05,
                max_x: center_x + width * 0.5 + 0.05,
                min_z: center_z - depth * 0.5 - 0.05,
                max_z: center_z + depth * 0.5 + 0.05,
                roof_material: roof_material.clone(),
                gable_material: gable_material.clone(),
                opacity: 1.0,
            },
            Transform::from_xyz(center_x, 0.0, center_z),
            Visibility::Inherited,
        ))
        .id();

    let ridge_along_z = depth >= width;

    commands.entity(roof).with_children(|parent| {
        if ridge_along_z {
            let total_width = width + ROOF_OVERHANG;
            let run = total_width * 0.5;
            let slope_length = run / ROOF_ANGLE.cos();
            let rise = run * ROOF_ANGLE.tan();
            let half_offset = run * 0.5;

            for sign in [-1.0f32, 1.0] {
                parent.spawn((
                    Name::new("Roof slope"),
                    Mesh3d(catalog.cube.clone()),
                    MeshMaterial3d(roof_material.clone()),
                    Transform {
                        translation: Vec3::new(sign * half_offset, ROOF_EAVE_Y + rise * 0.5, 0.0),
                        rotation: Quat::from_rotation_z(-sign * ROOF_ANGLE),
                        scale: Vec3::new(slope_length, 0.14, depth + ROOF_OVERHANG),
                        ..default()
                    },
                ));
            }

            // Ridge runs Z, therefore the gables are the north/south short
            // ends (constant Z) and span X. Fill all the way to the ridge.
            for sign in [-1.0f32, 1.0] {
                spawn_gable_fill(
                    parent,
                    catalog,
                    gable_material.clone(),
                    Vec3::new(0.0, HOUSE_WALL_HEIGHT, sign * depth * 0.5),
                    true,
                    (width - HOUSE_WALL_THICKNESS).max(0.30),
                    rise,
                );
            }
        } else {
            let total_depth = depth + ROOF_OVERHANG;
            let run = total_depth * 0.5;
            let slope_length = run / ROOF_ANGLE.cos();
            let rise = run * ROOF_ANGLE.tan();
            let half_offset = run * 0.5;

            for sign in [-1.0f32, 1.0] {
                parent.spawn((
                    Name::new("Roof slope"),
                    Mesh3d(catalog.cube.clone()),
                    MeshMaterial3d(roof_material.clone()),
                    Transform {
                        translation: Vec3::new(0.0, ROOF_EAVE_Y + rise * 0.5, sign * half_offset),
                        rotation: Quat::from_rotation_x(sign * ROOF_ANGLE),
                        scale: Vec3::new(width + ROOF_OVERHANG, 0.14, slope_length),
                        ..default()
                    },
                ));
            }

            // Ridge runs X, therefore the gables are west/east ends
            // (constant X) and span Z.
            for sign in [-1.0f32, 1.0] {
                spawn_gable_fill(
                    parent,
                    catalog,
                    gable_material.clone(),
                    Vec3::new(sign * width * 0.5, HOUSE_WALL_HEIGHT, 0.0),
                    false,
                    (depth - HOUSE_WALL_THICKNESS).max(0.30),
                    rise,
                );
            }
        }
    });

    (floor_entity, roof)
}

fn spawn_gable_fill(
    parent: &mut ChildSpawnerCommands,
    catalog: &ArchitectureCatalog,
    _wall_material: Handle<StandardMaterial>,
    base_translation: Vec3,
    horizontal: bool,
    span: f32,
    rise: f32,
) {
    let rise = rise.max(GABLE_STEP_HEIGHT);
    let rows = (rise / GABLE_STEP_HEIGHT).ceil().max(1.0) as usize;
    let row_height = rise / rows as f32;

    // V36.16.1: continue the half-timber language into the gable.
    parent.spawn((
        Name::new("Gable timber tie beam"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.timber.clone()),
        Transform {
            translation: base_translation + Vec3::new(0.0, 0.06, 0.0),
            scale: if horizontal {
                Vec3::new(span + 0.02, 0.08, HOUSE_WALL_THICKNESS + 0.02)
            } else {
                Vec3::new(HOUSE_WALL_THICKNESS + 0.02, 0.08, span + 0.02)
            },
            ..default()
        },
    ));

    parent.spawn((
        Name::new("Gable timber center post"),
        Mesh3d(catalog.cube.clone()),
        MeshMaterial3d(catalog.timber.clone()),
        Transform {
            translation: base_translation + Vec3::new(0.0, rise * 0.5, 0.0),
            scale: if horizontal {
                Vec3::new(0.08, rise + 0.02, HOUSE_WALL_THICKNESS + 0.02)
            } else {
                Vec3::new(HOUSE_WALL_THICKNESS + 0.02, rise + 0.02, 0.08)
            },
            ..default()
        },
    ));

    for row in 0..rows {
        let center_y = row_height * (row as f32 + 0.5);
        let normalized_height = center_y / rise;
        let row_span = (span * (1.0 - normalized_height)).max(HOUSE_WALL_THICKNESS * 1.35);

        parent.spawn((
            Name::new("Gable fill"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(catalog.plaster.clone()),
            Transform {
                translation: base_translation + Vec3::new(0.0, center_y, 0.0),
                scale: if horizontal {
                    Vec3::new(row_span, row_height + 0.015, HOUSE_WALL_THICKNESS)
                } else {
                    Vec3::new(HOUSE_WALL_THICKNESS, row_height + 0.015, row_span)
                },
                ..default()
            },
        ));
    }
}

pub fn describe() {
    info!(
        "ALDORIA ARCHITECTURE · edge-anchored walls · inset indoor floors · roof/wall alignment · collision-aligned house edges · full-height end gables · bridge rails/posts"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(x: i32, y: i32) -> Position {
        Position { x, y, z: 7 }
    }

    #[test]
    fn wide_east_west_bridge_only_has_rails_on_long_outer_sides() {
        let bridges = (0..4)
            .flat_map(|x| [tile(x, 0), tile(x, 1)])
            .collect::<Vec<_>>();

        let corner = infer_bridge_edges(tile(0, 0), &bridges);
        assert!(corner.north);
        assert!(!corner.south);
        assert!(!corner.west);
        assert!(!corner.east);

        let opposite = infer_bridge_edges(tile(3, 1), &bridges);
        assert!(!opposite.north);
        assert!(opposite.south);
        assert!(!opposite.west);
        assert!(!opposite.east);
    }

    #[test]
    fn wide_north_south_bridge_only_has_rails_on_long_outer_sides() {
        let bridges = (0..4)
            .flat_map(|y| [tile(0, y), tile(1, y)])
            .collect::<Vec<_>>();

        let corner = infer_bridge_edges(tile(0, 0), &bridges);
        assert!(!corner.north);
        assert!(!corner.south);
        assert!(corner.west);
        assert!(!corner.east);

        let opposite = infer_bridge_edges(tile(1, 3), &bridges);
        assert!(!opposite.north);
        assert!(!opposite.south);
        assert!(!opposite.west);
        assert!(opposite.east);
    }
}
