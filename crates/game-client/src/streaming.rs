use std::collections::HashSet;
// TIBIAGAME_V36_9_1_UNUSED_BUILDINGROOF_IMPORT_FIX
use std::time::Instant;

use bevy::prelude::*;
use game_protocol::MapView;
use game_types::{CreatureView, NpcView, Position, ResourceNodeView};

use crate::{creature_sprites, world_architecture, world_details, world_visuals, NpcActor, ResourceActor, WorldStatic};

const SPAWN_BUDGET_PER_FRAME: usize = 520;
const CLEANUP_BUDGET_PER_FRAME: usize = 180;

#[derive(Component)]
pub struct StreamedRegionEntity {
    generation: u64,
    floor: i16,
}

#[derive(Resource, Default)]
pub struct RegionStream {
    pending: Option<RegionPayload>,
    build: Option<RegionBuild>,
    assets: Option<StreamAssets>,
    active_generation: u64,
    next_generation: u64,
    cleanup_requested: bool,
    ready_floors: HashSet<i16>,
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
    floors: Vec<i16>,
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
    GroundChunk {
        center: Vec2,
        floor: i16,
    },
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
        edges: world_architecture::WallEdges,
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
        edge: world_architecture::WallEdge,
    },
    Window {
        id: String,
        position: Position,
        open: bool,
        edge: world_architecture::WallEdge,
    },
    Torch(Position),
    Stair {
        id: String,
        position: Position,
        up: bool,
    },
    Building {
        name: String,
        floor: i16,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    },
    Creature(CreatureView),
    Npc(NpcView),
    Resource(ResourceNodeView),
}


impl SpawnSpec {
    fn floor(&self) -> i16 {
        match self {
            Self::GroundChunk { floor, .. } => *floor,
            Self::Floor(position)
            | Self::Road(position)
            | Self::Water(position)
            | Self::Tree(position)
            | Self::Torch(position) => position.z,
            Self::Terrain { position, .. }
            | Self::Bridge { position, .. }
            | Self::HouseWall { position, .. }
            | Self::CastleWall { position, .. }
            | Self::Object { position, .. }
            | Self::Door { position, .. }
            | Self::Window { position, .. }
            | Self::Stair { position, .. } => position.z,
            Self::Building { floor, .. } => *floor,
            Self::Creature(creature) => creature.position.z,
            Self::Npc(npc) => npc.position.z,
            Self::Resource(resource) => resource.position.z,
        }
    }
}

impl RegionStream {
    pub fn floor_ready(&self, floor: i16) -> bool {
        self.active_generation != 0 && self.ready_floors.contains(&floor)
    }

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
        let mut floors: Vec<i16> = specs
            .iter()
            .map(SpawnSpec::floor)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        floors.sort_unstable();

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
            floors,
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
                build.floors.clone(),
                build.specs.len(),
                build.started_at.elapsed().as_millis(),
            ));
        }
    }

    if let Some((
        generation,
        center,
        radius,
        floor_radius,
        floors,
        count,
        elapsed_ms,
    )) = completed {
        stream.active_generation = generation;
        stream.ready_floors.clear();
        stream.ready_floors.extend(floors.iter().copied());
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
        info!(
            "ALDORIA FLOOR CACHE READY · gen {} · floors {:?}",
            generation,
            floors,
        );
    }
}

pub fn sync_streamed_floor_visibility(
    stream: Res<RegionStream>,
    movement: Res<crate::MovementState>,
    mut entities: Query<
        (&StreamedRegionEntity, &mut Visibility),
        (
            Without<crate::BuildingRoof>,
            Without<crate::HouseWallOccluder>,
        ),
    >,
) {
    if stream.active_generation == 0 {
        return;
    }

    let visible_floor = movement.logical.z;
    for (streamed, mut visibility) in &mut entities {
        let should_show =
            streamed.generation == stream.active_generation
                && streamed.floor == visible_floor;
        *visibility = if should_show {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
}

pub fn cleanup_old_region_entities(
    mut commands: Commands,
    mut stream: ResMut<RegionStream>,
    entities: Query<(Entity, Option<&StreamedRegionEntity>), Or<(
        With<WorldStatic>,
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
    let center = payload.region_center;
    let floor_radius = payload.region_floor_radius.max(0);
    let min_floor = center.z.saturating_sub(floor_radius);
    let max_floor = center.z.saturating_add(floor_radius);
    let floors: Vec<i16> = (min_floor..=max_floor).collect();

    let ground_chunks = world_architecture::ground_chunk_centers(
        payload.region_center,
        payload.region_radius,
    );
    let map = *payload.map;

    let opening_positions: HashSet<Position> = map
        .doors
        .iter()
        .map(|door| door.position)
        .chain(map.windows.iter().map(|window| window.position))
        .collect();

    let estimated = ground_chunks.len() * floors.len()
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
        + map.stairs.len() * floors.len()
        + map.buildings.len()
        + payload.creatures.len()
        + payload.npcs.len()
        + payload.resource_nodes.len();

    let mut specs = Vec::with_capacity(estimated);

    for floor in floors {
        // Actors first on every cached floor. They are spawned hidden when this
        // is not the visible floor, but their entities/materials already exist.
        specs.extend(
            payload
                .creatures
                .iter()
                .filter(|actor| actor.position.z == floor)
                .cloned()
                .map(SpawnSpec::Creature),
        );
        specs.extend(
            payload
                .npcs
                .iter()
                .filter(|actor| actor.position.z == floor)
                .cloned()
                .map(SpawnSpec::Npc),
        );
        specs.extend(
            payload
                .resource_nodes
                .iter()
                .filter(|actor| actor.position.z == floor)
                .cloned()
                .map(SpawnSpec::Resource),
        );

        specs.extend(
            ground_chunks
                .iter()
                .copied()
                .map(|center| SpawnSpec::GroundChunk { center, floor }),
        );

        specs.extend(
            map.floors
                .iter()
                .filter(|position| position.z == floor)
                .copied()
                .map(SpawnSpec::Floor),
        );
        specs.extend(
            map.terrain_materials
                .iter()
                .filter(|terrain| terrain.position.z == floor)
                .map(|terrain| SpawnSpec::Terrain {
                    position: terrain.position,
                    material: terrain.material.clone(),
                }),
        );
        specs.extend(
            map.roads
                .iter()
                .filter(|position| position.z == floor)
                .copied()
                .map(SpawnSpec::Road),
        );
        specs.extend(
            map.water
                .iter()
                .filter(|position| position.z == floor)
                .copied()
                .map(SpawnSpec::Water),
        );
        specs.extend(
            map.bridges
                .iter()
                .copied()
                .filter(|position| position.z == floor)
                .map(|position| SpawnSpec::Bridge {
                    position,
                    edges: world_architecture::infer_bridge_edges(
                        position,
                        &map.bridges,
                    ),
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
                    edges: world_architecture::infer_house_wall_edges(
                        position,
                        &map.buildings,
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
                .iter()
                .filter(|position| position.z == floor)
                .copied()
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
                    edge: world_architecture::infer_opening_edge(
                        door.position,
                        &map.buildings,
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
                    edge: world_architecture::infer_opening_edge(
                        window.position,
                        &map.buildings,
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
                .iter()
                .filter(|building| building.floor == floor)
                .map(|building| SpawnSpec::Building {
                    name: building.name.clone(),
                    floor: building.floor,
                    x: building.x,
                    y: building.y,
                    width: building.width,
                    height: building.height,
                }),
        );
    }

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
    _catalog: &creature_sprites::CreatureSpriteCatalog,
    details: &world_details::WorldDetailCatalog,
    architecture: &world_architecture::ArchitectureCatalog,
    materials: &mut Assets<StandardMaterial>,
    generation: u64,
    spec: &SpawnSpec,
) {
    let floor = spec.floor();
    match spec {
        SpawnSpec::GroundChunk { center, .. } => {
            let entity = world_architecture::spawn_ground_chunk(
                commands,
                architecture,
                assets.ground_underlay.clone(),
                *center,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Floor(position) => {
            spawn_cube(
                commands,
                assets,
                generation,
                floor,
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
                floor,
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
                floor,
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
                floor,
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
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::HouseWall {
            position,
            edges,
        } => {
            let entity = world_architecture::spawn_house_wall(
                commands,
                architecture,
                assets.house_wall.clone(),
                *position,
                *edges,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
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
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Tree(position) => {
            let entity = world_details::spawn_tree(
                commands,
                details,
                *position,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
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
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Door {
            id,
            position,
            open,
            edge,
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
                *edge,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Window {
            id,
            position,
            open,
            edge,
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
                *edge,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Torch(position) => {
            let entity = world_details::spawn_torch(
                commands,
                details,
                *position,
            );
            commands
                .entity(entity)
                .insert(StreamedRegionEntity { generation, floor });
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
                    .insert(StreamedRegionEntity { generation, floor });
            }
        }
        SpawnSpec::Building {
            name,
            floor: _,
            x,
            y,
            width,
            height,
        } => {
            let (floor_entity, roof_entity) =
                world_architecture::spawn_building(
                    commands,
                    architecture,
                    materials,
                    assets.house_wall.clone(),
                    assets.building_floor.clone(),
                    assets.roof.clone(),
                    name,
                    floor,
                    *x,
                    *y,
                    *width,
                    *height,
                );

            commands
                .entity(floor_entity)
                .insert(StreamedRegionEntity { generation, floor });
            commands
                .entity(roof_entity)
                .insert(StreamedRegionEntity { generation, floor });
        }
        SpawnSpec::Creature(_creature) => {
            // V36.18: Creature visuals are reconciled from NativeGameState.
            // Static floor streaming must not create a second actor lifecycle.
        }
        SpawnSpec::Npc(npc) => {
            commands.spawn((
                Name::new(format!("NPC · {}", npc.name)),
                StreamedRegionEntity { generation, floor },
                NpcActor(npc.id.clone()),
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
                .insert(StreamedRegionEntity { generation, floor });
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
    floor: i16,
    name: impl Into<String>,
    material: Handle<StandardMaterial>,
    translation: Vec3,
    scale: Vec3,
    _kind: EntityKind,
) -> Entity {
    commands.spawn((
        Name::new(name.into()),
        WorldStatic,
        StreamedRegionEntity { generation, floor },
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
