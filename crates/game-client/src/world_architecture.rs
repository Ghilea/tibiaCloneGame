use bevy::prelude::*;
use game_protocol::{DoorView, WindowView};
use game_types::Position;

use crate::{BuildingRoof, WorldStatic};

// TIBIAGAME_V36_9_4_HOUSE_ALIGNMENT_OPENING_STREAM_PRIORITY

pub const HOUSE_WALL_HEIGHT: f32 = 2.64;
pub const CASTLE_WALL_HEIGHT: f32 = 3.00;
const HOUSE_WALL_THICKNESS: f32 = 0.16;
const CASTLE_WALL_THICKNESS: f32 = 0.24;
const HOUSE_WALL_LENGTH: f32 = 1.00;
const CASTLE_WALL_LENGTH: f32 = 1.00;
const HOUSE_WALL_PANEL_ROWS: usize = 3;
const CASTLE_WALL_PANEL_ROWS: usize = 3;
const WALL_EDGE_OFFSET: f32 = 0.50;
const BUILDING_FLOOR_INSET: f32 = 0.34;
const ROOF_EAVE_Y: f32 = HOUSE_WALL_HEIGHT + 0.02;
const ROOF_ANGLE: f32 = 0.52;
const ROOF_OVERHANG: f32 = 0.34;
const GABLE_STEP_HEIGHT: f32 = 0.34;
const GROUND_CHUNK_TILES: i32 = 16;
const GROUND_CHUNK_SIZE: f32 = GROUND_CHUNK_TILES as f32;

#[derive(Debug, Clone, Copy)]
pub struct BridgeEdges {
    pub north: bool,
    pub south: bool,
    pub west: bool,
    pub east: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct WallAxes {
    pub horizontal: bool,
    pub vertical: bool,
}

#[derive(Resource)]
pub struct ArchitectureCatalog {
    cube: Handle<Mesh>,
    timber: Handle<StandardMaterial>,
}

impl ArchitectureCatalog {
    pub fn new(
        meshes: &mut Assets<Mesh>,
        materials: &mut Assets<StandardMaterial>,
    ) -> Self {
        Self {
            cube: meshes.add(Cuboid::default()),
            timber: materials.add(StandardMaterial {
                base_color: Color::srgb(0.27, 0.145, 0.07),
                perceptual_roughness: 0.89,
                ..default()
            }),
        }
    }
}

pub fn has_opening(
    position: Position,
    doors: &[DoorView],
    windows: &[WindowView],
) -> bool {
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

    let horizontal = has(position.x - 1, position.y)
        || has(position.x + 1, position.y);
    let vertical = has(position.x, position.y - 1)
        || has(position.x, position.y + 1);

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

pub fn spawn_wall(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    position: Position,
    axes: WallAxes,
    castle: bool,
) -> Entity {
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

    let root = commands
        .spawn((
            Name::new(if castle { "Castle Wall" } else { "House Wall" }),
            WorldStatic,
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        if axes.horizontal {
            spawn_wall_axis(
                parent,
                catalog,
                material.clone(),
                true,
                castle,
                height,
                thickness,
                length,
                rows,
            );
        }

        if axes.vertical {
            spawn_wall_axis(
                parent,
                catalog,
                material.clone(),
                false,
                castle,
                height,
                thickness,
                length,
                rows,
            );
        }

        if axes.horizontal && axes.vertical {
            parent.spawn((
                Name::new("Wall corner column"),
                Mesh3d(catalog.cube.clone()),
                MeshMaterial3d(if castle {
                    material.clone()
                } else {
                    catalog.timber.clone()
                }),
                Transform {
                    translation: Vec3::new(
                        -WALL_EDGE_OFFSET,
                        height * 0.5,
                        -WALL_EDGE_OFFSET,
                    ),
                    scale: Vec3::new(
                        thickness + 0.06,
                        height + 0.03,
                        thickness + 0.06,
                    ),
                    ..default()
                },
            ));
        }
    });

    root
}

#[allow(clippy::too_many_arguments)]
fn spawn_wall_axis(
    parent: &mut ChildSpawnerCommands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    horizontal: bool,
    castle: bool,
    height: f32,
    thickness: f32,
    length: f32,
    rows: usize,
) {
    let axis_offset = if horizontal {
        Vec3::new(0.0, 0.0, -WALL_EDGE_OFFSET)
    } else {
        Vec3::new(-WALL_EDGE_OFFSET, 0.0, 0.0)
    };
    let panel_height = height / rows.max(1) as f32;

    for row in 0..rows {
        let y = panel_height * (row as f32 + 0.5);
        parent.spawn((
            Name::new(if castle {
                "Castle wall texture panel"
            } else {
                "House wall texture panel"
            }),
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
        MeshMaterial3d(if castle {
            material.clone()
        } else {
            catalog.timber.clone()
        }),
        Transform {
            translation: axis_offset + Vec3::new(0.0, height - 0.035, 0.0),
            scale: if horizontal {
                Vec3::new(length + 0.02, 0.09, thickness + 0.03)
            } else {
                Vec3::new(thickness + 0.03, 0.09, length + 0.02)
            },
            ..default()
        },
    ));

    if !castle {
        let beam_scale = if horizontal {
            Vec3::new(length + 0.02, 0.07, thickness + 0.03)
        } else {
            Vec3::new(thickness + 0.03, 0.07, length + 0.02)
        };

        for row in 1..rows {
            parent.spawn((
                Name::new("Wall timber beam"),
                Mesh3d(catalog.cube.clone()),
                MeshMaterial3d(catalog.timber.clone()),
                Transform {
                    translation: axis_offset
                        + Vec3::new(0.0, panel_height * row as f32, 0.0),
                    scale: beam_scale,
                    ..default()
                },
            ));
        }
    }
}

pub fn ground_chunk_centers(center: Position, radius: i32) -> Vec<Vec2> {
    let radius = radius.max(1);
    let diameter = radius * 2 + 1;
    let chunks_per_axis = (diameter + GROUND_CHUNK_TILES - 1) / GROUND_CHUNK_TILES;

    let min_x = center.x - radius;
    let min_y = center.y - radius;
    let left = min_x as f32 - 0.5;
    let top = min_y as f32 - 0.5;

    let mut centers =
        Vec::with_capacity((chunks_per_axis * chunks_per_axis) as usize);

    for chunk_y in 0..chunks_per_axis {
        for chunk_x in 0..chunks_per_axis {
            centers.push(Vec2::new(
                left + GROUND_CHUNK_SIZE * (chunk_x as f32 + 0.5),
                top + GROUND_CHUNK_SIZE * (chunk_y as f32 + 0.5),
            ));
        }
    }

    centers
}

pub fn spawn_ground_chunk(
    commands: &mut Commands,
    catalog: &ArchitectureCatalog,
    material: Handle<StandardMaterial>,
    center: Vec2,
) -> Entity {
    commands
        .spawn((
            Name::new("Grass Ground Underlay"),
            WorldStatic,
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(material),
            Transform {
                translation: Vec3::new(center.x, -0.016, center.y),
                scale: Vec3::new(GROUND_CHUNK_SIZE, 0.020, GROUND_CHUNK_SIZE),
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

    BridgeEdges {
        north: !has(position.x, position.y - 1),
        south: !has(position.x, position.y + 1),
        west: !has(position.x - 1, position.y),
        east: !has(position.x + 1, position.y),
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
    wall_material: Handle<StandardMaterial>,
    floor_material: Handle<StandardMaterial>,
    roof_material: Handle<StandardMaterial>,
    name: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (Entity, Entity) {
    let width = width.max(1) as f32;
    let depth = height.max(1) as f32;
    let center_x = x as f32 + (width - 1.0) * 0.5;
    let center_z = y as f32 + (depth - 1.0) * 0.5;
    let floor_scale_x = (width - BUILDING_FLOOR_INSET * 2.0).max(0.58);
    let floor_scale_z = (depth - BUILDING_FLOOR_INSET * 2.0).max(0.58);

    let floor = commands
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
                min_x: center_x - width * 0.5 - 0.05,
                max_x: center_x + width * 0.5 + 0.05,
                min_z: center_z - depth * 0.5 - 0.05,
                max_z: center_z + depth * 0.5 + 0.05,
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

            spawn_gable_fill(
                parent,
                catalog,
                wall_material.clone(),
                Vec3::new(-(width * 0.5), HOUSE_WALL_HEIGHT + 0.18, 0.0),
                false,
                depth - 0.10,
            );
            spawn_gable_fill(
                parent,
                catalog,
                wall_material.clone(),
                Vec3::new(width * 0.5, HOUSE_WALL_HEIGHT + 0.18, 0.0),
                false,
                depth - 0.10,
            );
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

            spawn_gable_fill(
                parent,
                catalog,
                wall_material.clone(),
                Vec3::new(0.0, HOUSE_WALL_HEIGHT + 0.18, -(depth * 0.5)),
                true,
                width - 0.10,
            );
            spawn_gable_fill(
                parent,
                catalog,
                wall_material.clone(),
                Vec3::new(0.0, HOUSE_WALL_HEIGHT + 0.18, depth * 0.5),
                true,
                width - 0.10,
            );
        }
    });

    (floor, roof)
}

// TIBIAGAME_V36_9_4_3_GABLE_MATERIAL_HANDLE_FIX
fn spawn_gable_fill(
    parent: &mut ChildSpawnerCommands,
    catalog: &ArchitectureCatalog,
    wall_material: Handle<StandardMaterial>,
    base_translation: Vec3,
    horizontal: bool,
    span: f32,
) {
    for (index, width_factor) in [0.74f32, 0.48].into_iter().enumerate() {
        parent.spawn((
            Name::new("Gable fill"),
            Mesh3d(catalog.cube.clone()),
            MeshMaterial3d(wall_material.clone()),
            Transform {
                translation: base_translation + Vec3::new(0.0, index as f32 * GABLE_STEP_HEIGHT, 0.0),
                scale: if horizontal {
                    Vec3::new(span * width_factor, GABLE_STEP_HEIGHT + 0.02, HOUSE_WALL_THICKNESS)
                } else {
                    Vec3::new(HOUSE_WALL_THICKNESS, GABLE_STEP_HEIGHT + 0.02, span * width_factor)
                },
                ..default()
            },
        ));
    }
}

pub fn describe() {
    info!(
        "ALDORIA ARCHITECTURE · edge-anchored walls · inset indoor floors · roof/wall alignment · gable fills · true corners · bridge rails/posts"
    );
}
