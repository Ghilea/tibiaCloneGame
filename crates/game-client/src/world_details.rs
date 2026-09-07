use std::collections::HashMap;

use bevy::prelude::*;
use game_protocol::{DoorView, StairView, WindowView, WorldObjectView};
use game_types::{Position, ResourceNodeView};

use crate::{ResourceActor, WorldStatic};

// TIBIAGAME_V36_8_2_BEVY_WORLDASSET_STREAM_BORROW_FIX

const PROP_MODELS: [(&str, &str); 15] = [
    ("chair", "models/world-props/chair.glb"),
    ("table", "models/world-props/table.glb"),
    ("bench", "models/world-props/bench.glb"),
    ("well", "models/world-props/well.glb"),
    ("barrel", "models/world-props/barrel.glb"),
    ("notice_post", "models/world-props/notice_post.glb"),
    ("wrecked_planks", "models/world-props/wrecked_planks.glb"),
    ("wooden_crate", "models/world-props/wooden_crate.glb"),
    ("grain_sack", "models/world-props/grain_sack.glb"),
    ("bone_pile", "models/world-props/bone_pile.glb"),
    ("rock_pile", "models/world-props/rock_pile.glb"),
    ("mushroom_patch", "models/world-props/mushroom_patch.glb"),
    ("campfire", "models/world-props/campfire.glb"),
    ("hay_bundle", "models/world-props/hay_bundle.glb"),
    ("fence_post", "models/world-props/fence_post.glb"),
];

const COPPER_VEIN: &str = "models/world-props/copper_vein.glb";
const COPPER_VEIN_DEPLETED: &str =
    "models/world-props/copper_vein_depleted.glb";

#[derive(Component)]
pub struct WorldDoor {
    pub id: String,
    horizontal: bool,
}

#[derive(Component)]
pub struct WorldWindow {
    pub id: String,
    horizontal: bool,
}

#[derive(Resource)]
pub struct WorldDetailCatalog {
    prop_scenes: HashMap<String, Handle<WorldAsset>>,
    copper_vein: Handle<WorldAsset>,
    copper_vein_depleted: Handle<WorldAsset>,
    trunk_mesh: Handle<Mesh>,
    foliage_mesh: Handle<Mesh>,
    detail_cube: Handle<Mesh>,
    flame_mesh: Handle<Mesh>,
    wood: Handle<StandardMaterial>,
    foliage: Handle<StandardMaterial>,
    dark_wood: Handle<StandardMaterial>,
    stone: Handle<StandardMaterial>,
    glass: Handle<StandardMaterial>,
    flame: Handle<StandardMaterial>,
    generic: Handle<StandardMaterial>,
}

impl WorldDetailCatalog {
    pub fn new(
        asset_server: &AssetServer,
        meshes: &mut Assets<Mesh>,
        materials: &mut Assets<StandardMaterial>,
    ) -> Self {
        let mut prop_scenes = HashMap::new();

        for (kind, path) in PROP_MODELS {
            prop_scenes.insert(
                kind.to_owned(),
                asset_server.load(
                    GltfAssetLabel::Scene(0).from_asset(path),
                ),
            );
        }

        Self {
            prop_scenes,
            copper_vein: asset_server.load(
                GltfAssetLabel::Scene(0).from_asset(COPPER_VEIN),
            ),
            copper_vein_depleted: asset_server.load(
                GltfAssetLabel::Scene(0).from_asset(COPPER_VEIN_DEPLETED),
            ),
            trunk_mesh: meshes.add(Cylinder::default()),
            foliage_mesh: meshes.add(Cone::default()),
            detail_cube: meshes.add(Cuboid::default()),
            flame_mesh: meshes.add(
                Sphere::new(0.5)
                    .mesh()
                    .ico(2)
                    .expect("native world-detail flame sphere"),
            ),
            wood: materials.add(StandardMaterial {
                base_color: Color::srgb(0.31, 0.18, 0.09),
                perceptual_roughness: 0.92,
                ..default()
            }),
            foliage: materials.add(StandardMaterial {
                base_color: Color::srgb(0.10, 0.31, 0.12),
                perceptual_roughness: 0.96,
                ..default()
            }),
            dark_wood: materials.add(StandardMaterial {
                base_color: Color::srgb(0.17, 0.09, 0.045),
                perceptual_roughness: 0.9,
                ..default()
            }),
            stone: materials.add(StandardMaterial {
                base_color: Color::srgb(0.36, 0.36, 0.34),
                perceptual_roughness: 0.94,
                ..default()
            }),
            glass: materials.add(StandardMaterial {
                base_color: Color::srgba(0.55, 0.77, 0.88, 0.38),
                perceptual_roughness: 0.16,
                alpha_mode: AlphaMode::Blend,
                ..default()
            }),
            flame: materials.add(StandardMaterial {
                base_color: Color::srgb(1.0, 0.46, 0.08),
                perceptual_roughness: 0.42,
                ..default()
            }),
            generic: materials.add(StandardMaterial {
                base_color: Color::srgb(0.79, 0.73, 0.59),
                perceptual_roughness: 0.92,
                ..default()
            }),
        }
    }

    fn prop_scene(&self, kind: &str) -> Option<Handle<WorldAsset>> {
        self.prop_scenes.get(kind).cloned()
    }
}

pub fn spawn_tree(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    position: Position,
) -> Entity {
    commands
        .spawn((
            Name::new("Tree"),
            WorldStatic,
            Transform::from_xyz(
                position.x as f32,
                0.0,
                position.y as f32,
            ),
            Visibility::default(),
        ))
        .with_children(|parent| {
            parent.spawn((
                Name::new("Tree trunk"),
                Mesh3d(catalog.trunk_mesh.clone()),
                MeshMaterial3d(catalog.wood.clone()),
                Transform {
                    translation: Vec3::new(0.0, 0.78, 0.0),
                    scale: Vec3::new(0.32, 0.78, 0.32),
                    ..default()
                },
            ));

            parent.spawn((
                Name::new("Tree lower crown"),
                Mesh3d(catalog.foliage_mesh.clone()),
                MeshMaterial3d(catalog.foliage.clone()),
                Transform {
                    translation: Vec3::new(0.0, 1.75, 0.0),
                    scale: Vec3::new(1.28, 1.30, 1.28),
                    ..default()
                },
            ));

            parent.spawn((
                Name::new("Tree upper crown"),
                Mesh3d(catalog.foliage_mesh.clone()),
                MeshMaterial3d(catalog.foliage.clone()),
                Transform {
                    translation: Vec3::new(0.0, 2.42, 0.0),
                    scale: Vec3::new(0.92, 1.05, 0.92),
                    ..default()
                },
            ));
        })
        .id()
}

pub fn spawn_world_object(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    object: &WorldObjectView,
) -> Entity {
    let rotation = natural_rotation(object);

    if let Some(scene) = catalog.prop_scene(&object.kind) {
        return commands
            .spawn((
                Name::new(format!(
                    "World Prop · {} · {}",
                    object.kind, object.id
                )),
                WorldStatic,
                WorldAssetRoot(scene),
                Transform {
                    translation: Vec3::new(
                        object.position.x as f32,
                        0.02,
                        object.position.y as f32,
                    ),
                    rotation: Quat::from_rotation_y(rotation),
                    scale: Vec3::splat(prop_scale(&object.kind)),
                },
                Visibility::default(),
            ))
            .id();
    }

    commands
        .spawn((
            Name::new(format!(
                "World Prop Placeholder · {} · {}",
                object.kind, object.id
            )),
            WorldStatic,
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.generic.clone()),
            Transform {
                translation: Vec3::new(
                    object.position.x as f32,
                    0.26,
                    object.position.y as f32,
                ),
                rotation: Quat::from_rotation_y(rotation),
                scale: Vec3::new(0.48, 0.52, 0.48),
            },
        ))
        .id()
}

pub fn spawn_resource(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    resource: &ResourceNodeView,
) -> Entity {
    let scene = if resource.available {
        catalog.copper_vein.clone()
    } else {
        catalog.copper_vein_depleted.clone()
    };

    commands
        .spawn((
            Name::new(format!(
                "Resource Model · {} · {}",
                resource.kind, resource.id
            )),
            ResourceActor,
            WorldAssetRoot(scene),
            Transform {
                translation: Vec3::new(
                    resource.position.x as f32,
                    0.02,
                    resource.position.y as f32,
                ),
                scale: Vec3::splat(0.86),
                ..default()
            },
            Visibility::default(),
        ))
        .id()
}

pub fn spawn_door(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    door: &DoorView,
    horizontal: bool,
) -> Entity {
    let root = commands
        .spawn((
            Name::new(format!("Door · {}", door.id)),
            WorldStatic,
            Transform::from_xyz(door.position.x as f32, 0.0, door.position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        let edge_offset = if horizontal {
            Vec3::new(0.0, 0.0, -0.50)
        } else {
            Vec3::new(-0.50, 0.0, 0.0)
        };
        let leaf_scale = if horizontal {
            Vec3::new(0.82, 1.28, 0.10)
        } else {
            Vec3::new(0.10, 1.28, 0.82)
        };

        parent.spawn((
            Name::new(format!("Door wall header · {}", door.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.generic.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 2.04, 0.0),
                scale: if horizontal {
                    Vec3::new(1.00, 0.82, 0.12)
                } else {
                    Vec3::new(0.12, 0.82, 1.00)
                },
                ..default()
            },
        ));

        parent.spawn((
            Name::new(format!("Door Leaf · {}", door.id)),
            WorldDoor {
                id: door.id.clone(),
                horizontal,
            },
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.dark_wood.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 0.68, 0.0),
                rotation: door_rotation(horizontal, door.open),
                scale: leaf_scale,
            },
        ));

        let side_scale = if horizontal {
            Vec3::new(0.10, 1.48, 0.14)
        } else {
            Vec3::new(0.14, 1.48, 0.10)
        };
        let side_offset = if horizontal {
            Vec3::new(0.48, 0.76, -0.50)
        } else {
            Vec3::new(-0.50, 0.76, 0.48)
        };

        for sign in [-1.0f32, 1.0] {
            parent.spawn((
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.wood.clone()),
                Transform {
                    translation: side_offset * sign,
                    scale: side_scale,
                    ..default()
                },
            ));
        }

        parent.spawn((
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.wood.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 1.49, 0.0),
                scale: if horizontal {
                    Vec3::new(1.06, 0.10, 0.14)
                } else {
                    Vec3::new(0.14, 0.10, 1.06)
                },
                ..default()
            },
        ));
    });

    root
}

pub fn spawn_window(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    window: &WindowView,
    horizontal: bool,
) -> Entity {
    let root = commands
        .spawn((
            Name::new(format!("Window · {}", window.id)),
            WorldStatic,
            Transform::from_xyz(window.position.x as f32, 0.0, window.position.y as f32),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        let edge_offset = if horizontal {
            Vec3::new(0.0, 0.0, -0.50)
        } else {
            Vec3::new(-0.50, 0.0, 0.0)
        };

        parent.spawn((
            Name::new(format!("Window wall lower · {}", window.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.generic.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 0.24, 0.0),
                scale: if horizontal {
                    Vec3::new(0.98, 0.44, 0.12)
                } else {
                    Vec3::new(0.12, 0.44, 0.98)
                },
                ..default()
            },
        ));

        parent.spawn((
            Name::new(format!("Window wall upper · {}", window.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.generic.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 1.92, 0.0),
                scale: if horizontal {
                    Vec3::new(0.98, 0.72, 0.12)
                } else {
                    Vec3::new(0.12, 0.72, 0.98)
                },
                ..default()
            },
        ));

        parent.spawn((
            Name::new(format!("Window Glass · {}", window.id)),
            WorldWindow {
                id: window.id.clone(),
                horizontal,
            },
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.glass.clone()),
            Transform {
                translation: edge_offset + Vec3::new(0.0, 0.92, 0.0),
                rotation: window_rotation(horizontal, window.open),
                scale: if horizontal {
                    Vec3::new(0.68, 0.62, 0.055)
                } else {
                    Vec3::new(0.055, 0.62, 0.68)
                },
            },
        ));

        let frame = if horizontal {
            [
                (Vec3::new(-0.39, 0.92, -0.50), Vec3::new(0.08, 0.78, 0.10)),
                (Vec3::new(0.39, 0.92, -0.50), Vec3::new(0.08, 0.78, 0.10)),
                (Vec3::new(0.0, 0.53, -0.50), Vec3::new(0.86, 0.08, 0.10)),
                (Vec3::new(0.0, 1.31, -0.50), Vec3::new(0.86, 0.08, 0.10)),
            ]
        } else {
            [
                (Vec3::new(-0.50, 0.92, -0.39), Vec3::new(0.10, 0.78, 0.08)),
                (Vec3::new(-0.50, 0.92, 0.39), Vec3::new(0.10, 0.78, 0.08)),
                (Vec3::new(-0.50, 0.53, 0.0), Vec3::new(0.10, 0.08, 0.86)),
                (Vec3::new(-0.50, 1.31, 0.0), Vec3::new(0.10, 0.08, 0.86)),
            ]
        };

        for (translation, scale) in frame {
            parent.spawn((
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.dark_wood.clone()),
                Transform {
                    translation,
                    scale,
                    ..default()
                },
            ));
        }
    });

    root
}


// TIBIAGAME_V36_9_4_2_DUPLICATE_FUNCTION_SIGNATURE_FIX
pub fn spawn_torch(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    position: Position,
) -> Entity {
    commands
        .spawn((
            Name::new("Torch"),
            WorldStatic,
            Transform::from_xyz(
                position.x as f32,
                0.0,
                position.y as f32,
            ),
            Visibility::default(),
        ))
        .with_children(|parent| {
            parent.spawn((
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.dark_wood.clone()),
                Transform {
                    translation: Vec3::new(0.0, 0.70, 0.0),
                    scale: Vec3::new(0.08, 1.10, 0.08),
                    ..default()
                },
            ));

            parent.spawn((
                Name::new("Torch Flame"),
                Mesh3d(catalog.flame_mesh.clone()),
                MeshMaterial3d(catalog.flame.clone()),
                Transform {
                    translation: Vec3::new(0.0, 1.33, 0.0),
                    scale: Vec3::splat(0.18),
                    ..default()
                },
            ));

            parent.spawn((
                PointLight {
                    intensity: 850.0,
                    range: 5.0,
                    radius: 0.12,
                    shadow_maps_enabled: false,
                    ..default()
                },
                Transform::from_xyz(0.0, 1.34, 0.0),
            ));
        })
        .id()
}

pub fn spawn_stair(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    stair: &StairView,
    floor: i16,
) -> Option<Entity> {
    let position = if stair.from.z == floor {
        stair.from
    } else if stair.to.z == floor {
        stair.to
    } else {
        return None;
    };

    let up = if stair.from.z == floor {
        stair.to.z < stair.from.z
    } else {
        stair.from.z < stair.to.z
    };

    let direction = if up { 1.0 } else { -1.0 };

    let root = commands
        .spawn((
            Name::new(format!("Stair · {}", stair.id)),
            WorldStatic,
            Transform::from_xyz(
                position.x as f32,
                0.0,
                position.y as f32,
            ),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        for index in 0..4 {
            let t = index as f32;
            parent.spawn((
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.stone.clone()),
                Transform {
                    translation: Vec3::new(
                        0.0,
                        0.075 + t * 0.11,
                        direction * (-0.30 + t * 0.20),
                    ),
                    scale: Vec3::new(0.86, 0.15 + t * 0.04, 0.28),
                    ..default()
                },
            ));
        }
    });

    Some(root)
}

pub fn infer_wall_horizontal(
    position: Position,
    house_walls: &[Position],
    castle_walls: &[Position],
) -> bool {
    let has = |x: i32, y: i32| {
        house_walls
            .iter()
            .chain(castle_walls.iter())
            .any(|wall| {
                wall.z == position.z
                    && wall.x == x
                    && wall.y == y
            })
    };

    let horizontal_score =
        i32::from(has(position.x - 1, position.y))
        + i32::from(has(position.x + 1, position.y));
    let vertical_score =
        i32::from(has(position.x, position.y - 1))
        + i32::from(has(position.x, position.y + 1));

    horizontal_score >= vertical_score
}

pub fn apply_door_change(
    door: &DoorView,
    doors: &mut Query<(&WorldDoor, &mut Transform)>,
) {
    for (visual, mut transform) in doors.iter_mut() {
        if visual.id != door.id {
            continue;
        }

        transform.rotation =
            door_rotation(visual.horizontal, door.open);
    }
}

pub fn apply_window_change(
    window: &WindowView,
    windows: &mut Query<(&WorldWindow, &mut Transform)>,
) {
    for (visual, mut transform) in windows.iter_mut() {
        if visual.id != window.id {
            continue;
        }

        transform.rotation =
            window_rotation(visual.horizontal, window.open);
    }
}

fn door_rotation(horizontal: bool, open: bool) -> Quat {
    if !open {
        Quat::IDENTITY
    } else if horizontal {
        Quat::from_rotation_y(std::f32::consts::FRAC_PI_2)
    } else {
        Quat::from_rotation_y(-std::f32::consts::FRAC_PI_2)
    }
}

fn window_rotation(horizontal: bool, open: bool) -> Quat {
    if !open {
        Quat::IDENTITY
    } else if horizontal {
        Quat::from_rotation_y(0.72)
    } else {
        Quat::from_rotation_y(-0.72)
    }
}

fn prop_scale(kind: &str) -> f32 {
    match kind {
        "chair" => 0.82,
        "table" => 0.92,
        "bench" => 0.90,
        "well" => 0.96,
        "barrel" => 0.72,
        "notice_post" => 0.88,
        "wrecked_planks" => 0.92,
        "wooden_crate" => 0.74,
        "grain_sack" => 0.72,
        "bone_pile" => 0.78,
        "rock_pile" => 0.80,
        "mushroom_patch" => 0.74,
        "campfire" => 0.76,
        "hay_bundle" => 0.80,
        "fence_post" => 0.86,
        _ => 0.82,
    }
}

fn natural_rotation(object: &WorldObjectView) -> f32 {
    if matches!(
        object.kind.as_str(),
        "wrecked_planks"
            | "grain_sack"
            | "bone_pile"
            | "rock_pile"
            | "mushroom_patch"
            | "campfire"
            | "hay_bundle"
    ) {
        let quarter =
            (object.position.x * 13 + object.position.y * 7)
                .rem_euclid(4);
        quarter as f32 * std::f32::consts::FRAC_PI_2
    } else {
        0.0
    }
}

pub fn describe() {
    info!(
        "ALDORIA WORLD DETAILS · authored GLB props/resources · procedural trees/doors/windows/stairs · torch point lights"
    );
}
