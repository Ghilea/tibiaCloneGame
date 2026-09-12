// TIBIAGAME_V36_63_0_CONNECTION_ERRORS_COPPER_VEINS
use std::collections::HashMap;

use bevy::prelude::*;
use game_protocol::{DoorView, StairView, WindowView, WorldObjectView};
use game_types::{Position, ResourceNodeView};

use crate::{
    ResourceActor, WorldStatic,
    world_architecture::{HOUSE_WALL_HEIGHT, WallEdge},
};

// TIBIAGAME_V36_8_2_BEVY_WORLDASSET_STREAM_BORROW_FIX
// TIBIAGAME_V36_13_WORLD_BOUNDARY_FLOOR_PRELOAD
// TIBIAGAME_V36_15_1_OPENING_FACADE_RAT_GPU_PREWARM
// TIBIAGAME_V36_65_0_MATERIAL_DEPTH_OCCLUDERS_BATTLE_TARGETING

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
const COPPER_VEIN_DEPLETED: &str = "models/world-props/copper_vein_depleted.glb";

#[derive(Component)]
pub struct WorldDoor {
    pub id: String,
    pub open: bool,
    #[allow(dead_code)]
    pub position: Position,
    #[allow(dead_code)]
    pub edge: WallEdge,
}

#[derive(Component)]
pub struct WorldDoorSwing {
    pub id: String,
    edge: WallEdge,
}

#[derive(Component)]
pub struct WorldResource {
    pub id: String,
    #[allow(dead_code)]
    pub position: Position,
}

#[derive(Component)]
pub struct WorldResourceCopperAccent {
    pub id: String,
}

#[derive(Component)]
pub struct WorldObjectActor {
    pub id: String,
    pub position: Position,
}

pub struct WorldOccluderMaterial {
    pub handle: Handle<StandardMaterial>,
    pub tint: Color,
}

#[derive(Component)]
pub struct WorldOccluder {
    pub position: Position,
    pub radius: f32,
    pub faded_opacity: f32,
    pub opacity: f32,
    pub materials: Vec<WorldOccluderMaterial>,
}

#[derive(Component)]
pub struct WorldWindow {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub position: Position,
    #[allow(dead_code)]
    pub edge: WallEdge,
}

#[derive(Component)]
pub struct WorldWindowSwing {
    pub id: String,
    edge: WallEdge,
}

#[derive(Resource)]
pub struct WorldDetailCatalog {
    prop_scenes: HashMap<String, Handle<WorldAsset>>,
    copper_vein: Handle<WorldAsset>,
    copper_vein_depleted: Handle<WorldAsset>,
    trunk_mesh: Handle<Mesh>,
    foliage_mesh: Handle<Mesh>,
    rock_mesh: Handle<Mesh>,
    detail_cube: Handle<Mesh>,
    flame_mesh: Handle<Mesh>,
    wood: Handle<StandardMaterial>,
    foliage: Handle<StandardMaterial>,
    pine_foliage: Handle<StandardMaterial>,
    snow: Handle<StandardMaterial>,
    dark_wood: Handle<StandardMaterial>,
    stone: Handle<StandardMaterial>,
    dark_stone: Handle<StandardMaterial>,
    dirt: Handle<StandardMaterial>,
    reeds: Handle<StandardMaterial>,
    bog: Handle<StandardMaterial>,
    glass: Handle<StandardMaterial>,
    flame: Handle<StandardMaterial>,
    copper_ore: Handle<StandardMaterial>,
    facade_plaster: Handle<StandardMaterial>,
    facade_timber: Handle<StandardMaterial>,
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
                asset_server.load(GltfAssetLabel::Scene(0).from_asset(path)),
            );
        }

        Self {
            prop_scenes,
            copper_vein: asset_server.load(GltfAssetLabel::Scene(0).from_asset(COPPER_VEIN)),
            copper_vein_depleted: asset_server
                .load(GltfAssetLabel::Scene(0).from_asset(COPPER_VEIN_DEPLETED)),
            trunk_mesh: meshes.add(Cylinder::default()),
            foliage_mesh: meshes.add(Cone::default()),
            rock_mesh: meshes.add(
                Sphere::new(0.5)
                    .mesh()
                    .ico(2)
                    .expect("native world-detail rock sphere"),
            ),
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
            pine_foliage: materials.add(StandardMaterial {
                base_color: Color::srgb(0.055, 0.22, 0.14),
                perceptual_roughness: 0.98,
                ..default()
            }),
            snow: materials.add(StandardMaterial {
                base_color: Color::srgb(0.82, 0.88, 0.90),
                perceptual_roughness: 0.86,
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
            dark_stone: materials.add(StandardMaterial {
                base_color: Color::srgb(0.22, 0.235, 0.23),
                perceptual_roughness: 0.98,
                ..default()
            }),
            dirt: materials.add(StandardMaterial {
                base_color: Color::srgb(0.31, 0.22, 0.13),
                perceptual_roughness: 1.0,
                ..default()
            }),
            reeds: materials.add(StandardMaterial {
                base_color: Color::srgb(0.39, 0.34, 0.12),
                perceptual_roughness: 0.98,
                ..default()
            }),
            bog: materials.add(StandardMaterial {
                base_color: Color::srgba(0.075, 0.15, 0.10, 0.82),
                perceptual_roughness: 0.72,
                alpha_mode: AlphaMode::Blend,
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
            copper_ore: materials.add(StandardMaterial {
                base_color: Color::srgb(0.92, 0.36, 0.09),
                metallic: 0.48,
                perceptual_roughness: 0.31,
                ..default()
            }),
            facade_plaster: materials.add(StandardMaterial {
                // Same values as ArchitectureCatalog::plaster.
                base_color: Color::srgb(0.79, 0.72, 0.58),
                perceptual_roughness: 0.96,
                ..default()
            }),
            facade_timber: materials.add(StandardMaterial {
                // Same values as ArchitectureCatalog::timber.
                base_color: Color::srgb(0.27, 0.145, 0.07),
                perceptual_roughness: 0.89,
                ..default()
            }),
        }
    }

    fn prop_scene(&self, kind: &str) -> Option<Handle<WorldAsset>> {
        self.prop_scenes.get(kind).cloned()
    }

    pub fn resource_scene(&self, available: bool) -> Handle<WorldAsset> {
        if available {
            self.copper_vein.clone()
        } else {
            self.copper_vein_depleted.clone()
        }
    }
}

pub fn spawn_tree(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    materials: &mut Assets<StandardMaterial>,
    position: Position,
) -> Entity {
    let (wood, wood_tracked) = fading_material(materials, &catalog.wood);
    let (foliage, foliage_tracked) = fading_material(materials, &catalog.foliage);
    commands
        .spawn((
            Name::new("Tree"),
            WorldStatic,
            Transform {
                translation: Vec3::new(position.x as f32, 0.0, position.y as f32),
                scale: Vec3::splat(1.8),
                ..default()
            },
            Visibility::default(),
            WorldOccluder {
                position,
                radius: 1.05,
                faded_opacity: 0.24,
                opacity: 1.0,
                materials: vec![wood_tracked, foliage_tracked],
            },
        ))
        .with_children(|parent| {
            spawn_tree_geometry(parent, catalog, TreeStyle::Forest, wood, foliage, None)
        })
        .id()
}

pub fn spawn_world_object(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    materials: &mut Assets<StandardMaterial>,
    object: &WorldObjectView,
) -> Entity {
    let rotation = natural_rotation(object);

    if matches!(
        object.kind.as_str(),
        "forest_tree" | "pine_tree" | "snowy_pine"
    ) {
        let style = match object.kind.as_str() {
            "pine_tree" => TreeStyle::Pine,
            "snowy_pine" => TreeStyle::SnowyPine,
            _ => TreeStyle::Forest,
        };
        let (wood, wood_tracked) = fading_material(materials, &catalog.wood);
        let foliage_source = match style {
            TreeStyle::Forest => &catalog.foliage,
            TreeStyle::Pine | TreeStyle::SnowyPine => &catalog.pine_foliage,
        };
        let (foliage, foliage_tracked) = fading_material(materials, foliage_source);
        let (snow, snow_tracked) = if matches!(style, TreeStyle::SnowyPine) {
            let (handle, tracked) = fading_material(materials, &catalog.snow);
            (Some(handle), Some(tracked))
        } else {
            (None, None)
        };
        let mut tracked_materials = vec![wood_tracked, foliage_tracked];
        tracked_materials.extend(snow_tracked);
        return commands
            .spawn((
                Name::new(format!("World tree: {}: {}", object.kind, object.id)),
                WorldStatic,
                WorldObjectActor {
                    id: object.id.clone(),
                    position: object.position,
                },
                Transform {
                    translation: Vec3::new(object.position.x as f32, 0.0, object.position.y as f32),
                    rotation: Quat::from_rotation_y(rotation),
                    scale: Vec3::splat(1.8),
                    ..default()
                },
                Visibility::default(),
                WorldOccluder {
                    position: object.position,
                    radius: 1.05,
                    faded_opacity: 0.24,
                    opacity: 1.0,
                    materials: tracked_materials,
                },
            ))
            .with_children(|parent| {
                spawn_tree_geometry(parent, catalog, style, wood, foliage, snow)
            })
            .id();
    }

    if object.kind == "mountain_wall" {
        return spawn_rock_formation(commands, catalog, materials, object, true);
    }

    if object.kind == "snow_bank" {
        return spawn_rock_formation(commands, catalog, materials, object, false);
    }

    if matches!(
        object.kind.as_str(),
        "dirt_path" | "snow_ground" | "bog_slick"
    ) {
        let material = match object.kind.as_str() {
            "snow_ground" => catalog.snow.clone(),
            "bog_slick" => catalog.bog.clone(),
            _ => catalog.dirt.clone(),
        };
        return commands
            .spawn((
                Name::new(format!("Ground detail: {}: {}", object.kind, object.id)),
                WorldStatic,
                WorldObjectActor {
                    id: object.id.clone(),
                    position: object.position,
                },
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(material),
                Transform {
                    translation: Vec3::new(
                        object.position.x as f32,
                        0.018,
                        object.position.y as f32,
                    ),
                    rotation: Quat::from_rotation_y(rotation),
                    scale: Vec3::new(0.96, 0.025, 0.96),
                },
            ))
            .id();
    }

    if object.kind == "bent_reeds" {
        return spawn_reeds(commands, catalog, object);
    }

    if let Some(scene) = catalog.prop_scene(&object.kind) {
        return commands
            .spawn((
                Name::new(format!("World Prop · {} · {}", object.kind, object.id)),
                WorldStatic,
                WorldObjectActor {
                    id: object.id.clone(),
                    position: object.position,
                },
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
                "World detail fallback · {} · {}",
                object.kind, object.id
            )),
            WorldStatic,
            WorldObjectActor {
                id: object.id.clone(),
                position: object.position,
            },
            Mesh3d(catalog.rock_mesh.clone()),
            MeshMaterial3d(catalog.stone.clone()),
            Transform {
                translation: Vec3::new(object.position.x as f32, 0.26, object.position.y as f32),
                rotation: Quat::from_rotation_y(rotation),
                scale: Vec3::new(0.72, 0.48, 0.66),
            },
        ))
        .id()
}

pub fn spawn_resource(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    resource: &ResourceNodeView,
) -> Entity {
    let scene = catalog.resource_scene(resource.available);

    commands
        .spawn((
            Name::new(format!(
                "Resource Model · {} · {}",
                resource.kind, resource.id
            )),
            ResourceActor,
            WorldResource {
                id: resource.id.clone(),
                position: resource.position,
            },
            WorldAssetRoot(scene),
            Transform::from_xyz(resource.position.x as f32, 0.02, resource.position.y as f32)
                .with_scale(Vec3::splat(0.86)),
            Visibility::default(),
        ))
        .with_children(|parent| {
            // The authored GLB has a CopperGlow mesh, but at the gameplay camera
            // angle it can disappear into the stone. These small ore outcrops
            // deliberately read from above and from both diagonal camera sides.
            for (index, (translation, scale)) in [
                (Vec3::new(-0.18, 0.46, -0.08), Vec3::new(0.18, 0.10, 0.13)),
                (Vec3::new(0.12, 0.49, 0.05), Vec3::new(0.15, 0.09, 0.12)),
                (Vec3::new(0.27, 0.31, -0.13), Vec3::new(0.12, 0.08, 0.10)),
                (Vec3::new(-0.28, 0.29, 0.14), Vec3::new(0.13, 0.08, 0.11)),
                (Vec3::new(0.02, 0.36, 0.25), Vec3::new(0.11, 0.07, 0.10)),
            ]
            .into_iter()
            .enumerate()
            {
                parent.spawn((
                    Name::new(format!("Copper ore accent · {} · {index}", resource.id)),
                    WorldResourceCopperAccent {
                        id: resource.id.clone(),
                    },
                    Mesh3d(catalog.rock_mesh.clone()),
                    MeshMaterial3d(catalog.copper_ore.clone()),
                    Transform {
                        translation,
                        rotation: Quat::from_rotation_y(index as f32 * 0.73),
                        scale,
                    },
                    if resource.available {
                        Visibility::Visible
                    } else {
                        Visibility::Hidden
                    },
                ));
            }
        })
        .id()
}

#[derive(Clone, Copy)]
enum TreeStyle {
    Forest,
    Pine,
    SnowyPine,
}

fn spawn_tree_geometry(
    parent: &mut ChildSpawnerCommands,
    catalog: &WorldDetailCatalog,
    style: TreeStyle,
    wood: Handle<StandardMaterial>,
    foliage: Handle<StandardMaterial>,
    snow: Option<Handle<StandardMaterial>>,
) {
    parent.spawn((
        Name::new("Tree trunk"),
        Mesh3d(catalog.trunk_mesh.clone()),
        MeshMaterial3d(wood.clone()),
        Transform {
            translation: Vec3::new(0.0, 0.78, 0.0),
            scale: Vec3::new(0.28, 0.82, 0.28),
            ..default()
        },
    ));

    for (index, (translation, rotation)) in [
        (Vec3::new(-0.20, 1.18, 0.0), Quat::from_rotation_z(0.82)),
        (Vec3::new(0.17, 1.38, 0.10), Quat::from_rotation_z(-0.72)),
        (Vec3::new(0.0, 1.52, -0.16), Quat::from_rotation_x(0.76)),
    ]
    .into_iter()
    .enumerate()
    {
        parent.spawn((
            Name::new(format!("Tree branch {index}")),
            Mesh3d(catalog.trunk_mesh.clone()),
            MeshMaterial3d(wood.clone()),
            Transform {
                translation,
                rotation,
                scale: Vec3::new(0.09, 0.42, 0.09),
            },
        ));
    }

    let crowns = match style {
        TreeStyle::Forest => [
            (Vec3::new(0.0, 1.72, 0.0), Vec3::new(1.20, 1.10, 1.20)),
            (Vec3::new(-0.26, 2.18, 0.10), Vec3::new(0.92, 0.94, 0.92)),
            (Vec3::new(0.30, 2.12, -0.08), Vec3::new(0.86, 0.88, 0.86)),
        ],
        TreeStyle::Pine | TreeStyle::SnowyPine => [
            (Vec3::new(0.0, 1.48, 0.0), Vec3::new(1.28, 1.08, 1.28)),
            (Vec3::new(0.0, 2.02, 0.0), Vec3::new(0.98, 1.10, 0.98)),
            (Vec3::new(0.0, 2.57, 0.0), Vec3::new(0.65, 0.92, 0.65)),
        ],
    };
    for (index, (translation, scale)) in crowns.into_iter().enumerate() {
        let crown_mesh = if matches!(style, TreeStyle::Forest) {
            catalog.rock_mesh.clone()
        } else {
            catalog.foliage_mesh.clone()
        };
        parent.spawn((
            Name::new(format!("Tree crown {index}")),
            Mesh3d(crown_mesh),
            MeshMaterial3d(foliage.clone()),
            Transform {
                translation,
                scale,
                ..default()
            },
        ));
        if matches!(style, TreeStyle::SnowyPine) {
            parent.spawn((
                Name::new(format!("Snowy tree crown {index}")),
                Mesh3d(catalog.foliage_mesh.clone()),
                MeshMaterial3d(
                    snow.clone()
                        .expect("snowy pine creates a fading snow material"),
                ),
                Transform {
                    translation: translation + Vec3::Y * 0.08,
                    scale: scale * Vec3::new(1.035, 0.25, 1.035),
                    ..default()
                },
            ));
        }
    }
}

fn spawn_rock_formation(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    materials: &mut Assets<StandardMaterial>,
    object: &WorldObjectView,
    wall: bool,
) -> Entity {
    let source = if object.kind == "snow_bank" {
        catalog.snow.clone()
    } else {
        catalog.stone.clone()
    };
    let (material, main_tracked) = if wall {
        let (handle, tracked) = fading_material(materials, &source);
        (handle, Some(tracked))
    } else {
        (source, None)
    };
    let (dark_material, dark_tracked) = if wall {
        let (handle, tracked) = fading_material(materials, &catalog.dark_stone);
        (handle, Some(tracked))
    } else {
        (catalog.dark_stone.clone(), None)
    };
    let entity = commands
        .spawn((
            Name::new(format!("Rock formation: {}: {}", object.kind, object.id)),
            WorldStatic,
            WorldObjectActor {
                id: object.id.clone(),
                position: object.position,
            },
            Transform::from_xyz(object.position.x as f32, 0.0, object.position.y as f32),
            Visibility::default(),
        ))
        .with_children(|parent| {
            if wall {
                parent.spawn((
                    Name::new("Cliff wall mass"),
                    Mesh3d(catalog.detail_cube.clone()),
                    MeshMaterial3d(material.clone()),
                    Transform {
                        translation: Vec3::new(0.0, 0.45, 0.0),
                        scale: Vec3::new(1.02, 0.90, 0.88),
                        ..default()
                    },
                ));
                parent.spawn((
                    Name::new("Cliff dark foundation"),
                    Mesh3d(catalog.detail_cube.clone()),
                    MeshMaterial3d(dark_material.clone()),
                    Transform {
                        translation: Vec3::new(0.0, 0.13, 0.0),
                        scale: Vec3::new(1.04, 0.22, 0.91),
                        ..default()
                    },
                ));

                for (index, x) in [-0.34f32, 0.0, 0.34].into_iter().enumerate() {
                    parent.spawn((
                        Name::new(format!("Cliff crown {index}")),
                        Mesh3d(catalog.rock_mesh.clone()),
                        MeshMaterial3d(material.clone()),
                        Transform {
                            translation: Vec3::new(x, 0.91 + (index % 2) as f32 * 0.07, -0.03),
                            rotation: Quat::from_euler(
                                EulerRot::YXZ,
                                index as f32 * 0.77,
                                0.12,
                                0.0,
                            ),
                            scale: Vec3::new(0.72, 0.46 + (index % 2) as f32 * 0.10, 0.78),
                        },
                    ));
                }

                for (index, (x, y)) in [(-0.31f32, 0.34f32), (0.16, 0.52)].into_iter().enumerate() {
                    parent.spawn((
                        Name::new(format!("Cliff face stone {index}")),
                        Mesh3d(catalog.rock_mesh.clone()),
                        MeshMaterial3d(dark_material.clone()),
                        Transform {
                            translation: Vec3::new(x, y, -0.43),
                            rotation: Quat::from_rotation_z(index as f32 * 0.48),
                            scale: Vec3::new(0.42, 0.26, 0.16),
                        },
                    ));
                }
            } else {
                for index in 0..3 {
                    let offset = index as f32 - 1.0;
                    parent.spawn((
                        Name::new(format!("Rock {index}")),
                        Mesh3d(catalog.rock_mesh.clone()),
                        MeshMaterial3d(material.clone()),
                        Transform {
                            translation: Vec3::new(
                                offset * 0.18,
                                0.14,
                                ((index * 7) % 3) as f32 * 0.11 - 0.11,
                            ),
                            rotation: Quat::from_euler(
                                EulerRot::YXZ,
                                index as f32 * 0.71,
                                0.10 * (index % 3) as f32,
                                0.0,
                            ),
                            scale: Vec3::new(0.50, 0.32, 0.45),
                        },
                    ));
                }
            }
        })
        .id();

    if wall {
        commands.entity(entity).insert(WorldOccluder {
            position: object.position,
            radius: 0.72,
            faded_opacity: 0.20,
            opacity: 1.0,
            materials: main_tracked.into_iter().chain(dark_tracked).collect(),
        });
    }

    entity
}

fn fading_material(
    materials: &mut Assets<StandardMaterial>,
    source: &Handle<StandardMaterial>,
) -> (Handle<StandardMaterial>, WorldOccluderMaterial) {
    let mut material = materials
        .get(source)
        .cloned()
        .expect("world detail material exists before occluder spawn");
    let tint = material.base_color;
    // Most occluders never cross the player sight line. Start in the cheaper
    // opaque pass and switch only the few actively fading materials to Blend.
    material.alpha_mode = AlphaMode::Opaque;
    material.cull_mode = None;
    let handle = materials.add(material);
    (
        handle.clone(),
        WorldOccluderMaterial { handle, tint },
    )
}

fn spawn_reeds(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    object: &WorldObjectView,
) -> Entity {
    commands
        .spawn((
            Name::new(format!("Bent reeds: {}", object.id)),
            WorldStatic,
            WorldObjectActor {
                id: object.id.clone(),
                position: object.position,
            },
            Transform::from_xyz(object.position.x as f32, 0.0, object.position.y as f32),
            Visibility::default(),
        ))
        .with_children(|parent| {
            for index in 0..7 {
                let x = (index % 3) as f32 * 0.20 - 0.20;
                let z = (index / 3) as f32 * 0.18 - 0.16;
                parent.spawn((
                    Name::new(format!("Reed {index}")),
                    Mesh3d(catalog.trunk_mesh.clone()),
                    MeshMaterial3d(catalog.reeds.clone()),
                    Transform {
                        translation: Vec3::new(x, 0.25 + index as f32 * 0.012, z),
                        rotation: Quat::from_rotation_z((index as f32 - 3.0) * 0.045),
                        scale: Vec3::new(0.025, 0.27, 0.025),
                    },
                ));
            }
        })
        .id()
}

pub fn spawn_door(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    door: &DoorView,
    edge: WallEdge,
) -> Entity {
    let horizontal = edge.horizontal();
    let boundary = edge.local_offset();
    let tangent = if horizontal { Vec3::X } else { Vec3::Z };
    let leaf_half = 0.38;

    let root = commands
        .spawn((
            Name::new(format!("Door · {}", door.id)),
            WorldStatic,
            WorldDoor {
                id: door.id.clone(),
                open: door.open,
                position: door.position,
                edge,
            },
            Transform::from_xyz(
                door.position.x as f32 + boundary.x,
                0.0,
                door.position.y as f32 + boundary.z,
            ),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        // Continue the same plaster field used by the surrounding facade.
        parent.spawn((
            Name::new(format!("Door facade plaster header · {}", door.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.facade_plaster.clone()),
            Transform {
                translation: Vec3::new(0.0, 2.10, 0.0),
                scale: if horizontal {
                    Vec3::new(1.00, 0.88, 0.11)
                } else {
                    Vec3::new(0.11, 0.88, 1.00)
                },
                ..default()
            },
        ));

        // V36.16.1: subdivide the plaster above the door so the opening tile
        // follows the same half-timber rhythm as its neighboring wall tiles.
        for sign in [-1.0f32, 1.0] {
            parent.spawn((
                Name::new(format!("Door facade upper stud · {}", door.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: if horizontal {
                        Vec3::new(0.24 * sign, 2.10, 0.0)
                    } else {
                        Vec3::new(0.0, 2.10, 0.24 * sign)
                    },
                    scale: if horizontal {
                        Vec3::new(0.06, 0.82, 0.12)
                    } else {
                        Vec3::new(0.12, 0.82, 0.06)
                    },
                    ..default()
                },
            ));
        }

        // Match the house horizontal beam rhythm above the opening.
        for y in [1.60f32, 2.18] {
            parent.spawn((
                Name::new(format!("Door facade beam · {}", door.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: Vec3::new(0.0, y, 0.0),
                    scale: if horizontal {
                        Vec3::new(1.04, 0.07, 0.13)
                    } else {
                        Vec3::new(0.13, 0.07, 1.04)
                    },
                    ..default()
                },
            ));
        }

        let leaf_scale = if horizontal {
            Vec3::new(0.76, 1.38, 0.10)
        } else {
            Vec3::new(0.10, 1.38, 0.76)
        };

        parent
            .spawn((
                Name::new(format!("Door Hinge · {}", door.id)),
                WorldDoorSwing {
                    id: door.id.clone(),
                    edge,
                },
                Transform {
                    // Lift the complete hinge/leaf assembly slightly.
                    translation: tangent * -leaf_half + Vec3::Y * 0.06,
                    rotation: door_rotation(edge, door.open),
                    ..default()
                },
                Visibility::default(),
            ))
            .with_child((
                Name::new(format!("Door Leaf · {}", door.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.dark_wood.clone()),
                Transform {
                    translation: tangent * leaf_half + Vec3::Y * 0.75,
                    scale: leaf_scale,
                    ..default()
                },
            ));

        let post_scale = if horizontal {
            Vec3::new(0.09, 1.58, 0.13)
        } else {
            Vec3::new(0.13, 1.58, 0.09)
        };
        for sign in [-1.0f32, 1.0] {
            parent.spawn((
                Name::new(format!("Door frame post · {}", door.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: tangent * (0.48 * sign) + Vec3::Y * 0.81,
                    scale: post_scale,
                    ..default()
                },
            ));
        }
    });

    root
}

pub fn spawn_window(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    window: &WindowView,
    edge: WallEdge,
) -> Entity {
    let horizontal = edge.horizontal();
    let boundary = edge.local_offset();
    let tangent = if horizontal { Vec3::X } else { Vec3::Z };
    let glass_half = 0.32;

    let root = commands
        .spawn((
            Name::new(format!("Window · {}", window.id)),
            WorldStatic,
            WorldWindow {
                id: window.id.clone(),
                position: window.position,
                edge,
            },
            Transform::from_xyz(
                window.position.x as f32 + boundary.x,
                0.0,
                window.position.y as f32 + boundary.z,
            ),
            Visibility::default(),
        ))
        .id();

    commands.entity(root).with_children(|parent| {
        // Same plaster above and below the window as the rest of the facade.
        parent.spawn((
            Name::new(format!("Window facade plaster lower · {}", window.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.facade_plaster.clone()),
            Transform {
                translation: Vec3::new(0.0, 0.25, 0.0),
                scale: if horizontal {
                    Vec3::new(0.98, 0.46, 0.11)
                } else {
                    Vec3::new(0.11, 0.46, 0.98)
                },
                ..default()
            },
        ));

        parent.spawn((
            Name::new(format!("Window facade plaster upper · {}", window.id)),
            Mesh3d(catalog.detail_cube.clone()),
            MeshMaterial3d(catalog.facade_plaster.clone()),
            Transform {
                translation: Vec3::new(0.0, 1.98, 0.0),
                scale: if horizontal {
                    Vec3::new(0.98, 0.76, 0.11)
                } else {
                    Vec3::new(0.11, 0.76, 0.98)
                },
                ..default()
            },
        ));

        // V36.16.1: break up the plaster above and below the window with short
        // center studs. This makes those areas continue the surrounding facade
        // instead of reading as two separate flat panels.
        for (label, y, height) in [("lower", 0.27f32, 0.42f32), ("upper", 2.02f32, 0.68f32)] {
            parent.spawn((
                Name::new(format!(
                    "Window facade center stud · {} · {}",
                    window.id, label,
                )),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: Vec3::new(0.0, y, 0.0),
                    scale: if horizontal {
                        Vec3::new(0.06, height, 0.12)
                    } else {
                        Vec3::new(0.12, height, 0.06)
                    },
                    ..default()
                },
            ));
        }

        // Continue the same regular timber pattern through this tile.
        for y in [0.72f32, 1.46, 2.18] {
            parent.spawn((
                Name::new(format!("Window facade beam · {}", window.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: Vec3::new(0.0, y, 0.0),
                    scale: if horizontal {
                        Vec3::new(1.02, 0.07, 0.13)
                    } else {
                        Vec3::new(0.13, 0.07, 1.02)
                    },
                    ..default()
                },
            ));
        }

        for sign in [-1.0f32, 1.0] {
            let stud_offset = 0.34 * sign;
            parent.spawn((
                Name::new(format!("Window facade stud · {}", window.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: if horizontal {
                        Vec3::new(stud_offset, HOUSE_WALL_HEIGHT * 0.5, 0.0)
                    } else {
                        Vec3::new(0.0, HOUSE_WALL_HEIGHT * 0.5, stud_offset)
                    },
                    scale: if horizontal {
                        Vec3::new(0.07, HOUSE_WALL_HEIGHT + 0.02, 0.13)
                    } else {
                        Vec3::new(0.13, HOUSE_WALL_HEIGHT + 0.02, 0.07)
                    },
                    ..default()
                },
            ));
        }

        parent
            .spawn((
                Name::new(format!("Window Hinge · {}", window.id)),
                WorldWindowSwing {
                    id: window.id.clone(),
                    edge,
                },
                Transform {
                    translation: tangent * -glass_half,
                    rotation: window_rotation(edge, window.open),
                    ..default()
                },
                Visibility::default(),
            ))
            .with_child((
                Name::new(format!("Window Glass · {}", window.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.glass.clone()),
                Transform {
                    translation: tangent * glass_half + Vec3::Y * 1.05,
                    scale: if horizontal {
                        Vec3::new(0.64, 0.58, 0.055)
                    } else {
                        Vec3::new(0.055, 0.58, 0.64)
                    },
                    ..default()
                },
            ));

        let post_scale = if horizontal {
            Vec3::new(0.08, 0.74, 0.10)
        } else {
            Vec3::new(0.10, 0.74, 0.08)
        };
        for sign in [-1.0f32, 1.0] {
            parent.spawn((
                Name::new(format!("Window frame side · {}", window.id)),
                Mesh3d(catalog.detail_cube.clone()),
                MeshMaterial3d(catalog.facade_timber.clone()),
                Transform {
                    translation: tangent * (0.39 * sign) + Vec3::Y * 1.05,
                    scale: post_scale,
                    ..default()
                },
            ));
        }
    });

    root
}

// V36.15.2: V36.15.1 replaced the door/window section using
// apply_door_change as the end anchor. spawn_torch and spawn_stair lived
// between spawn_window and apply_door_change and were accidentally removed.
pub fn spawn_torch(
    commands: &mut Commands,
    catalog: &WorldDetailCatalog,
    position: Position,
) -> Entity {
    commands
        .spawn((
            Name::new("Torch"),
            WorldStatic,
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
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
            Transform::from_xyz(position.x as f32, 0.0, position.y as f32),
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
                    translation: Vec3::new(0.0, 0.075 + t * 0.11, direction * (-0.30 + t * 0.20)),
                    scale: Vec3::new(0.86, 0.15 + t * 0.04, 0.28),
                    ..default()
                },
            ));
        }
    });

    Some(root)
}

pub fn apply_door_change(door: &DoorView, doors: &mut Query<(&WorldDoorSwing, &mut Transform)>) {
    for (visual, mut transform) in doors.iter_mut() {
        if visual.id != door.id {
            continue;
        }
        transform.rotation = door_rotation(visual.edge, door.open);
    }
}

pub fn apply_door_state(door: &DoorView, doors: &mut Query<&mut WorldDoor>) {
    for mut world_door in doors.iter_mut() {
        if world_door.id == door.id {
            world_door.open = door.open;
        }
    }
}

pub fn apply_window_change(
    window: &WindowView,
    windows: &mut Query<(&WorldWindowSwing, &mut Transform)>,
) {
    for (visual, mut transform) in windows.iter_mut() {
        if visual.id != window.id {
            continue;
        }
        transform.rotation = window_rotation(visual.edge, window.open);
    }
}

fn opening_angle(edge: WallEdge, amount: f32) -> f32 {
    // Swing toward the building interior for all four boundary signs.
    match edge {
        WallEdge::North => -amount,
        WallEdge::South => amount,
        WallEdge::West => amount,
        WallEdge::East => -amount,
    }
}

fn door_rotation(edge: WallEdge, open: bool) -> Quat {
    if open {
        Quat::from_rotation_y(opening_angle(edge, std::f32::consts::FRAC_PI_2))
    } else {
        Quat::IDENTITY
    }
}

fn window_rotation(edge: WallEdge, open: bool) -> Quat {
    if open {
        Quat::from_rotation_y(opening_angle(edge, 0.72))
    } else {
        Quat::IDENTITY
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
        let quarter = (object.position.x * 13 + object.position.y * 7).rem_euclid(4);
        quarter as f32 * std::f32::consts::FRAC_PI_2
    } else {
        0.0
    }
}

pub fn describe() {
    info!(
        "ALDORIA WORLD DETAILS · authored GLB props/resources · procedural trees · sight-line fading trees/cliffs · collision-aligned hinged doors/windows · stairs · torch point lights"
    );
}
