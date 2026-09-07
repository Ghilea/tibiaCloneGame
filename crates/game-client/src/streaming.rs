use std::collections::HashSet;
// TIBIAGAME_V36_9_1_UNUSED_BUILDINGROOF_IMPORT_FIX
use std::time::Instant;

use bevy::prelude::*;
use game_protocol::MapView;
use game_types::{CreatureView, NpcView, Position, ResourceNodeView};

use crate::{creature_sprites, world_architecture, world_details, world_visuals, CreatureActor, NpcActor, ResourceActor, WorldStatic};

const SPAWN_BUDGET_PER_FRAME: usize = 180;
const CLEANUP_BUDGET_PER_FRAME: usize = 180;

#[derive(Component)]
pub struct StreamedRegionEntity {
    generation: u64,
}

#[derive(Resource, Default)]
pub struct RegionStream {
    pending: Option<RegionPayload>,
    build: Option<RegionBuild>,
    assets: Option<StreamAssets>,
    active_generation: u64,
    next_generation: u64,
    cleanup_requested: bool,
}

struct RegionPayload {
    map: Box<MapView>,
    region_center: Position,
    region_radius: i32,
    region_floor_radius: i16,
    creatures: Vec<CreatureView>,
    npcs: Vec<NpcView>,
    resource_nodes: Vec<ResourceNodeView>,
}

struct RegionBuild {
    generation: u64,
    center: Position,
    radius: i32,
    floor_radius: i16,
    specs: Vec<SpawnSpec>,
    cursor: usize,
    started_at: Instant,
}

#[derive(Clone)]
struct StreamAssets {
    cube: Handle<Mesh>,
    floor: Handle<StandardMaterial>,
    ground_underlay: Handle<StandardMaterial>,
    road: Handle<StandardMaterial>,
    water: Handle<StandardMaterial>,
    bridge: Handle<StandardMaterial>,
    house_wall: Handle<StandardMaterial>,
    castle_wall: Handle<StandardMaterial>,
    building_floor: Handle<StandardMaterial>,
    roof: Handle<StandardMaterial>,
    packed_earth: Handle<StandardMaterial>,
    moss_stone: Handle<StandardMaterial>,
    sandstone: Handle<StandardMaterial>,
    mud: Handle<StandardMaterial>,
    gravel: Handle<StandardMaterial>,
    crypt_stone: Handle<StandardMaterial>,
    wood_planks: Handle<StandardMaterial>,
    marsh_grass: Handle<StandardMaterial>,
    ash_soil: Handle<StandardMaterial>,
    npc: Handle<StandardMaterial>,
}

enum SpawnSpec {
    GroundChunk(Vec2),
    Floor(Position),
    Terrain {
        position: Position,
        material: String,
    },
    Road(Position),
    Water(Position),
    Bridge {
        position: Position,
        edges: world_architecture::BridgeEdges,
    },
    HouseWall {
        position: Position,
        axes: world_architecture::WallAxes,
    },
    CastleWall {
        position: Position,
        axes: world_architecture::WallAxes,
    },
    Tree(Position),
    Object {
        id: String,
        kind: String,
        position: Position,
    },
    Door {
        id: String,
        position: Position,
        open: bool,
        horizontal: bool,
    },
    Window {
        id: String,
        position: Position,
        open: bool,
        horizontal: bool,
    },
    Torch(Position),
    Stair {
        id: String,
        position: Position,
        up: bool,
    },
    Building {
        name: String,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    },
    Creature(CreatureView),
    Npc(NpcView),
    Resource(ResourceNodeView),
}

impl RegionStream {
    pub fn queue(
        &mut self,
        map: Box<MapView>,
        region_center: Position,
        region_radius: i32,
        region_floor_radius: i16,
        creatures: Vec<CreatureView>,
        npcs: Vec<NpcView>,
        resource_nodes: Vec<ResourceNodeView>,
    ) {
        // Keep only the newest region while an older build is being committed.
        // With a 16-tile server refresh threshold, one incremental build should
        // normally finish long before the next region is required.
        self.pending = Some(RegionPayload {
            map,
            region_center,
            region_radius,
            region_floor_radius,
            creatures,
            npcs,
            resource_nodes,
        });
    }
}

pub fn apply_streamed_region(
    mut commands: Commands,
    mut stream: ResMut<RegionStream>,
    catalog: Res<creature_sprites::CreatureSpriteCatalog>,
    details: Res<world_details::WorldDetailCatalog>,
    architecture: Res<world_architecture::ArchitectureCatalog>,
    asset_server: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    if stream.build.is_none() {
        let Some(payload) = stream.pending.take() else {
            return;
        };

        stream.next_generation = stream.next_generation.saturating_add(1).max(1);
        let generation = stream.next_generation;
        let center = payload.region_center;
        let radius = payload.region_radius;
        let floor_radius = payload.region_floor_radius;
        let specs = build_specs(payload);

        info!(
            "ALDORIA STREAM START · gen {} · center {}:{}:{} · entities {} · spawn budget {}",
            generation,
            center.x,
            center.y,
            center.z,
            specs.len(),
            SPAWN_BUDGET_PER_FRAME,
        );

        stream.build = Some(RegionBuild {
            generation,
            center,
            radius,
            floor_radius,
            specs,
            cursor: 0,
            started_at: Instant::now(),
        });
    }

    if stream.assets.is_none() {
        stream.assets = Some(create_assets(&asset_server, &mut meshes, &mut materials));
    }
    let assets = stream
        .assets
        .as_ref()
        .expect("stream assets initialized")
        .clone();

    let mut completed = None;

    if let Some(build) = stream.build.as_mut() {
        let end = (build.cursor + SPAWN_BUDGET_PER_FRAME).min(build.specs.len());

        for spec in &build.specs[build.cursor..end] {
            spawn_spec(
                &mut commands,
                &assets,
                &catalog,
                &details,
                &architecture,
                &mut materials,
                build.generation,
                spec,
            );
        }

        build.cursor = end;

        if build.cursor >= build.specs.len() {
            completed = Some((
                build.generation,
                build.center,
                build.radius,
                build.floor_radius,
                build.specs.len(),
                build.started_at.elapsed().as_millis(),
            ));
        }
    }

    if let Some((generation, center, radius, floor_radius, count, elapsed_ms)) = completed {
        stream.active_generation = generation;
        stream.cleanup_requested = true;
        stream.build = None;

        info!(
            "ALDORIA STREAM COMMIT · gen {} · center {}:{}:{} · radius {} · floors ±{} · entities {} · staged {}ms",
            generation,
            center.x,
            center.y,
            center.z,
            radius,
            floor_radius,
            count,
            elapsed_ms,
        );
    }
}

pub fn cleanup_old_region_entities(
    mut commands: Commands,
    mut stream: ResMut<RegionStream>,
    entities: Query<(Entity, Option<&StreamedRegionEntity>), Or<(
        With<WorldStatic>,
        With<CreatureActor>,
        With<NpcActor>,
        With<ResourceActor>,
    )>>,
) {
    if !stream.cleanup_requested || stream.active_generation == 0 {
        return;
    }

    let active = stream.active_generation;
    let mut removed = 0usize;
    let mut found_old = false;

    for (entity, generation) in &entities {
        if generation.is_some_and(|generation| generation.generation == active) {
            continue;
        }

        found_old = true;
        commands.entity(entity).despawn();
        removed += 1;

        if removed >= CLEANUP_BUDGET_PER_FRAME {
            break;
        }
    }

    if !found_old {
        stream.cleanup_requested = false;
        info!("ALDORIA STREAM CLEAN · active gen {} · old region retired", active);
    }
}

fn build_specs(payload: RegionPayload) -> Vec<SpawnSpec> {
    let floor = payload.region_center.z;
    let ground_chunks = world_architecture::ground_chunk_centers(
        payload.region_center,
        payload.region_radius,
    );
    let map = *payload.map;

    let estimated = ground_chunks.len()
        + map.floors.len()
        + map.terrain_materials.len()
        + map.roads.len()
        + map.water.len()
        + map.bridges.len()
        + map.house_walls.len()
        + map.castle_walls.len()
        + map.trees.len()
        + map.objects.len()
        + map.doors.len()
        + map.windows.len()
        + map.torches.len()
        + map.stairs.len()
        + map.buildings.len()
        + payload.creatures.len()
        + payload.npcs.len()
        + payload.resource_nodes.len();

    let mut specs = Vec::with_capacity(estimated);

    specs.extend(ground_chunks.into_iter().map(SpawnSpec::GroundChunk));

    let opening_positions: HashSet<Position> = map
        .doors
        .iter()
        .map(|door| door.position)
        .chain(map.windows.iter().map(|window| window.position))
        .collect();

    specs.extend(
        map.floors
            .into_iter()
            .filter(|position| position.z == floor)
            .map(SpawnSpec::Floor),
    );
    specs.extend(
        map.terrain_materials
            .into_iter()
            .filter(|terrain| terrain.position.z == floor)
            .map(|terrain| SpawnSpec::Terrain {
                position: terrain.position,
                material: terrain.material,
            }),
    );
    specs.extend(
        map.roads
            .into_iter()
            .filter(|position| position.z == floor)
            .map(SpawnSpec::Road),
    );
    specs.extend(
        map.water
            .into_iter()
            .filter(|position| position.z == floor)
            .map(SpawnSpec::Water),
    );

    // Actors are intentionally prioritized before the heavy building/wall pass
    // so floor swaps (e.g. the rat cellar) become visible almost immediately.
    specs.extend(
        payload
            .creatures
            .into_iter()
            .filter(|actor| actor.position.z == floor)
            .map(SpawnSpec::Creature),
    );
    specs.extend(
        payload
            .npcs
            .into_iter()
            .filter(|actor| actor.position.z == floor)
            .map(SpawnSpec::Npc),
    );
    specs.extend(
        payload
            .resource_nodes
            .into_iter()
            .filter(|actor| actor.position.z == floor)
            .map(SpawnSpec::Resource),
    );

    specs.extend(
        map.bridges
            .iter()
            .copied()
            .filter(|position| position.z == floor)
            .map(|position| SpawnSpec::Bridge {
                position,
                edges: world_architecture::infer_bridge_edges(position, &map.bridges),
            }),
    );
    specs.extend(
        map.house_walls
            .iter()
            .copied()
            .filter(|position| position.z == floor)
            .filter(|position| !opening_positions.contains(position))
            .map(|position| SpawnSpec::HouseWall {
                position,
                axes: world_architecture::infer_wall_axes(
                    position,
                    &map.house_walls,
                    &map.castle_walls,
                ),
            }),
    );
    specs.extend(
        map.castle_walls
            .iter()
            .copied()
            .filter(|position| position.z == floor)
            .filter(|position| !opening_positions.contains(position))
            .map(|position| SpawnSpec::CastleWall {
                position,
                axes: world_architecture::infer_wall_axes(
                    position,
                    &map.house_walls,
                    &map.castle_walls,
                ),
            }),
    );
    specs.extend(
        map.trees
            .into_iter()
            .filter(|position| position.z == floor)
            .map(SpawnSpec::Tree),
    );
    specs.extend(
        map.objects
            .iter()
            .filter(|object| object.position.z == floor)
            .map(|object| SpawnSpec::Object {
                id: object.id.clone(),
                kind: object.kind.clone(),
                position: object.position,
            }),
    );
    specs.extend(
        map.doors
            .iter()
            .filter(|door| door.position.z == floor)
            .map(|door| SpawnSpec::Door {
                id: door.id.clone(),
                position: door.position,
                open: door.open,
                horizontal: world_details::infer_wall_horizontal(
                    door.position,
                    &map.house_walls,
                    &map.castle_walls,
                ),
            }),
    );
    specs.extend(
        map.windows
            .iter()
            .filter(|window| window.position.z == floor)
            .map(|window| SpawnSpec::Window {
                id: window.id.clone(),
                position: window.position,
                open: window.open,
                horizontal: world_details::infer_wall_horizontal(
                    window.position,
                    &map.house_walls,
                    &map.castle_walls,
                ),
            }),
    );
    specs.extend(
        map.torches
            .iter()
            .filter(|position| position.z == floor)
            .copied()
            .map(SpawnSpec::Torch),
    );
    specs.extend(map.stairs.iter().filter_map(|stair| {
        let position = if stair.from.z == floor {
            stair.from
        } else if stair.to.z == floor {
            stair.to
        } else {
            return None;
        };

        Some(SpawnSpec::Stair {
            id: stair.id.clone(),
            position,
            up: if stair.from.z == floor {
                stair.to.z < stair.from.z
            } else {
                stair.from.z < stair.to.z
            },
        })
    }));
    specs.extend(
        map.buildings
            .into_iter()
            .filter(|building| building.floor == floor)
            .map(|building| SpawnSpec::Building {
                name: building.name,
                x: building.x,
                y: building.y,
                width: building.width,
                height: building.height,
            }),
    );

    specs
}


// TIBIAGAME_V36_9_4_1_CREATE_ASSETS_DELIMITER_FIX
fn create_assets(
    asset_server: &AssetServer,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
) -> StreamAssets {
    let world = world_visuals::create_materials(asset_server, materials);

    StreamAssets {
        cube: meshes.add(Cuboid::new(1.0, 1.0, 1.0)),
        floor: world.floor,
        ground_underlay: world.ground_underlay,
        road: world.road,
        water: world.water,
        bridge: world.bridge,
        house_wall: world.house_wall,
        castle_wall: world.castle_wall,
        building_floor: world.building_floor,
        roof: world.roof,
        packed_earth: world.packed_earth,
        moss_stone: world.moss_stone,
        sandstone: world.sandstone,
        mud: world.mud,
        gravel: world.gravel,
        crypt_stone: world.crypt_stone,
        wood_planks: world.wood_planks,
        marsh_grass: world.marsh_grass,
        ash_soil: world.ash_soil,
        npc: materials.add(StandardMaterial {
            base_color: Color::srgb(0.75, 0.58, 0.16),
            perceptual_roughness: 0.7,
            ..default()
        }),
    }
}

fn spawn_spec(
    commands: &mut Commands,
    assets: &StreamAssets,
    catalog: &creature_sprites::CreatureSpriteCatalog,
    details: &world_details::WorldDetailCatalog,
    architecture: &world_architecture::ArchitectureCatalog,
    materials: &mut Assets<StandardMaterial>,
    generation: u64,
    spec: &SpawnSpec,
) {
    match spec {
        SpawnSpec::GroundChunk(center) => {
            let entity = world_architecture::spawn_ground_chunk(
                commands,
                architecture,
                assets.ground_underlay.clone(),
                *center,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Floor(position) => {
            spawn_cube(
                commands,
                assets,
                generation,
                "Stream Floor",
                assets.floor.clone(),
                Vec3::new(position.x as f32, 0.015, position.y as f32),
                Vec3::new(0.98, 0.03, 0.98),
                EntityKind::Static,
            );
        }
        SpawnSpec::Terrain { position, material } => {
            let material = match material.as_str() {
                "packed_earth" => assets.packed_earth.clone(),
                "moss_stone" => assets.moss_stone.clone(),
                "sandstone" => assets.sandstone.clone(),
                "mud" => assets.mud.clone(),
                "gravel" => assets.gravel.clone(),
                "crypt_stone" => assets.crypt_stone.clone(),
                "wood_planks" => assets.wood_planks.clone(),
                "marsh_grass" => assets.marsh_grass.clone(),
                "ash_soil" => assets.ash_soil.clone(),
                _ => assets.floor.clone(),
            };

            spawn_cube(
                commands,
                assets,
                generation,
                "Stream Terrain",
                material,
                Vec3::new(position.x as f32, 0.028, position.y as f32),
                Vec3::new(0.98, 0.03, 0.98),
                EntityKind::Static,
            );
        }
        SpawnSpec::Road(position) => {
            spawn_cube(
                commands,
                assets,
                generation,
                "Stream Road",
                assets.road.clone(),
                Vec3::new(position.x as f32, 0.045, position.y as f32),
                Vec3::new(0.98, 0.04, 0.98),
                EntityKind::Static,
            );
        }
        SpawnSpec::Water(position) => {
            spawn_cube(
                commands,
                assets,
                generation,
                "Stream Water",
                assets.water.clone(),
                Vec3::new(position.x as f32, 0.03, position.y as f32),
                Vec3::new(0.98, 0.035, 0.98),
                EntityKind::Static,
            );
        }
        SpawnSpec::Bridge { position, edges } => {
            let entity = world_architecture::spawn_bridge(
                commands,
                architecture,
                assets.bridge.clone(),
                *position,
                *edges,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::HouseWall {
            position,
            axes,
        } => {
            let entity = world_architecture::spawn_wall(
                commands,
                architecture,
                assets.house_wall.clone(),
                *position,
                *axes,
                false,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::CastleWall {
            position,
            axes,
        } => {
            let entity = world_architecture::spawn_wall(
                commands,
                architecture,
                assets.castle_wall.clone(),
                *position,
                *axes,
                true,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Tree(position) => {
            let entity = world_details::spawn_tree(
                commands,
                details,
                *position,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Object {
            id,
            kind,
            position,
        } => {
            let object = game_protocol::WorldObjectView {
                id: id.clone(),
                kind: kind.clone(),
                position: *position,
            };
            let entity = world_details::spawn_world_object(
                commands,
                details,
                &object,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Door {
            id,
            position,
            open,
            horizontal,
        } => {
            let door = game_protocol::DoorView {
                id: id.clone(),
                position: *position,
                open: *open,
            };
            let entity = world_details::spawn_door(
                commands,
                details,
                &door,
                *horizontal,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Window {
            id,
            position,
            open,
            horizontal,
        } => {
            let window = game_protocol::WindowView {
                id: id.clone(),
                position: *position,
                open: *open,
            };
            let entity = world_details::spawn_window(
                commands,
                details,
                &window,
                *horizontal,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Torch(position) => {
            let entity = world_details::spawn_torch(
                commands,
                details,
                *position,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Stair {
            id,
            position,
            up,
        } => {
            let destination_z = if *up {
                position.z - 1
            } else {
                position.z + 1
            };
            let stair = game_protocol::StairView {
                id: id.clone(),
                from: *position,
                to: Position {
                    x: position.x,
                    y: position.y,
                    z: destination_z,
                },
            };

            if let Some(entity) = world_details::spawn_stair(
                commands,
                details,
                &stair,
                position.z,
            ) {
                commands
                    .entity(entity)
                    .insert(StreamedRegionEntity { generation });
            }
        }
        SpawnSpec::Building {
            name,
            x,
            y,
            width,
            height,
        } => {
            let (floor_entity, roof_entity) =
                world_architecture::spawn_building(
                    commands,
                    architecture,
                    assets.house_wall.clone(),
                    assets.building_floor.clone(),
                    assets.roof.clone(),
                    name,
                    *x,
                    *y,
                    *width,
                    *height,
                );

            commands
                .entity(floor_entity)
                .insert(StreamedRegionEntity { generation });
            commands
                .entity(roof_entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Creature(creature) => {
            let entity = creature_sprites::spawn_creature_sprite(
                commands,
                materials,
                catalog,
                creature,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
        SpawnSpec::Npc(npc) => {
            commands.spawn((
                Name::new(format!("NPC · {}", npc.name)),
                StreamedRegionEntity { generation },
                NpcActor,
                Mesh3d(assets.cube.clone()),
                MeshMaterial3d(assets.npc.clone()),
                Transform {
                    translation: world_position(npc.position),
                    scale: Vec3::new(0.62, 0.95, 0.62),
                    ..default()
                },
            ));
        }
        SpawnSpec::Resource(resource) => {
            let entity = world_details::spawn_resource(
                commands,
                details,
                resource,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation });
        }
    }
}

enum EntityKind {
    Static,
}

fn spawn_cube(
    commands: &mut Commands,
    assets: &StreamAssets,
    generation: u64,
    name: impl Into<String>,
    material: Handle<StandardMaterial>,
    translation: Vec3,
    scale: Vec3,
    _kind: EntityKind,
) -> Entity {
    commands.spawn((
        Name::new(name.into()),
        WorldStatic,
        StreamedRegionEntity { generation },
        Mesh3d(assets.cube.clone()),
        MeshMaterial3d(material),
        Transform {
            translation,
            scale,
            ..default()
        },
    ))
    .id()
}

fn world_position(position: Position) -> Vec3 {
    Vec3::new(position.x as f32, 0.575, position.y as f32)
}
