import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const appliedMarker = "TIBIAGAME_STREAMING_FIX_V1";
const markerPath = path.join(root, "apps/client/src/game/NetworkClient.ts");
if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8").includes(appliedMarker)) {
  console.log("Streaming performance fix is already applied.");
  process.exit(0);
}
const replacements = [
  {
    "file": "crates/game-server/src/world.rs",
    "before": "    }\n\n    /// Small worlds already fit completely inside the initial region payload.",
    "after": "    }\n\n    /// Build one streamed payload containing the current floor plus nearby\n    /// vertical floors. The per-floor spatial index is still used, so this\n    /// does not scan the complete world.\n    pub fn map_view_near_floors(\n        &self,\n        center: Position,\n        radius: i32,\n        floor_radius: i16,\n    ) -> MapView {\n        let floor_radius = floor_radius.max(0);\n        let min_floor = center.z.saturating_sub(floor_radius);\n        let max_floor = center.z.saturating_add(floor_radius);\n        let mut merged = self.map_view_near(center, radius);\n        merged.floor = center.z;\n\n        for floor in min_floor..=max_floor {\n            if floor == center.z {\n                continue;\n            }\n            let mut next = self.map_view_near(Position { z: floor, ..center }, radius);\n            merged.blocked.append(&mut next.blocked);\n            merged.water.append(&mut next.water);\n            merged.bridges.append(&mut next.bridges);\n            merged.trees.append(&mut next.trees);\n            merged.roads.append(&mut next.roads);\n            merged.floors.append(&mut next.floors);\n            merged.house_walls.append(&mut next.house_walls);\n            merged.castle_walls.append(&mut next.castle_walls);\n            merged.windows.append(&mut next.windows);\n            merged.torches.append(&mut next.torches);\n            merged.terrain_materials.append(&mut next.terrain_materials);\n            merged.objects.append(&mut next.objects);\n            merged.buildings.append(&mut next.buildings);\n            merged.doors.append(&mut next.doors);\n            merged.stairs.append(&mut next.stairs);\n        }\n\n        // A staircase can be selected once from each endpoint floor.\n        let mut stair_ids = HashSet::new();\n        merged.stairs.retain(|stairs| stair_ids.insert(stairs.id.clone()));\n        merged\n    }\n\n    pub fn ground_items_near_floors(\n        &self,\n        center: Position,\n        radius: i32,\n        floor_radius: i16,\n    ) -> Vec<GroundItem> {\n        self.ground_items\n            .iter()\n            .filter(|entry| position_in_region_floors(entry.position, center, radius, floor_radius))\n            .cloned()\n            .collect()\n    }\n\n    pub fn creature_views_near_floors(\n        &self,\n        center: Position,\n        radius: i32,\n        floor_radius: i16,\n    ) -> Vec<CreatureView> {\n        self.creatures\n            .values()\n            .filter(|creature| {\n                position_in_region_floors(creature.view.position, center, radius, floor_radius)\n            })\n            .map(|creature| creature.view.clone())\n            .collect()\n    }\n\n    pub fn npc_views_near_floors(\n        &self,\n        center: Position,\n        radius: i32,\n        floor_radius: i16,\n    ) -> Vec<NpcView> {\n        self.npcs\n            .iter()\n            .filter(|npc| position_in_region_floors(npc.position, center, radius, floor_radius))\n            .cloned()\n            .collect()\n    }\n\n    pub fn resource_nodes_near_floors(\n        &self,\n        center: Position,\n        radius: i32,\n        floor_radius: i16,\n    ) -> Vec<ResourceNodeView> {\n        self.resource_nodes\n            .iter()\n            .filter(|node| {\n                position_in_region_floors(\n                    node.document.position,\n                    center,\n                    radius,\n                    floor_radius,\n                )\n            })\n            .map(ResourceNode::view)\n            .collect()\n    }\n\n    /// Small worlds already fit completely inside the initial region payload.",
    "expected": 1,
    "label": "server multi-floor streamed payload"
  },
  {
    "file": "crates/game-server/src/world.rs",
    "before": "fn position_in_region(position: Position, center: Position, radius: i32) -> bool {\n    position.z == center.z\n        && (position.x - center.x).abs() <= radius\n        && (position.y - center.y).abs() <= radius\n}",
    "after": "fn position_in_region(position: Position, center: Position, radius: i32) -> bool {\n    position.z == center.z\n        && (position.x - center.x).abs() <= radius\n        && (position.y - center.y).abs() <= radius\n}\n\nfn position_in_region_floors(\n    position: Position,\n    center: Position,\n    radius: i32,\n    floor_radius: i16,\n) -> bool {\n    (i32::from(position.z) - i32::from(center.z)).abs()\n        <= i32::from(floor_radius.max(0))\n        && (position.x - center.x).abs() <= radius\n        && (position.y - center.y).abs() <= radius\n}",
    "expected": 1,
    "label": "server vertical-region predicate"
  },
  {
    "file": "crates/game-server/src/main.rs",
    "before": "const WORLD_REGION_RADIUS: i32 = 48;\n// Refresh before the player reaches the edge of the current payload. Keeping a",
    "after": "const WORLD_REGION_RADIUS: i32 = 48;\n// Keep the next floor above and below hot in the client cache. This makes a\n// stair transition use already-delivered static geometry and nearby actors.\nconst WORLD_REGION_FLOOR_RADIUS: i16 = 1;\n// Refresh before the player reaches the edge of the current payload. Keeping a",
    "expected": 1,
    "label": "server vertical preload radius"
  },
  {
    "file": "crates/game-server/src/main.rs",
    "before": "            world.ground_items_near(position, WORLD_REGION_RADIUS),\n            world.creature_views_near(position, WORLD_REGION_RADIUS),\n            world.npc_views_near(position, WORLD_REGION_RADIUS),\n            world.resource_nodes_near(position, WORLD_REGION_RADIUS),\n            world.map_view_near(position, WORLD_REGION_RADIUS),",
    "after": "            world.ground_items_near_floors(\n                position,\n                WORLD_REGION_RADIUS,\n                WORLD_REGION_FLOOR_RADIUS,\n            ),\n            world.creature_views_near_floors(\n                position,\n                WORLD_REGION_RADIUS,\n                WORLD_REGION_FLOOR_RADIUS,\n            ),\n            world.npc_views_near_floors(\n                position,\n                WORLD_REGION_RADIUS,\n                WORLD_REGION_FLOOR_RADIUS,\n            ),\n            world.resource_nodes_near_floors(\n                position,\n                WORLD_REGION_RADIUS,\n                WORLD_REGION_FLOOR_RADIUS,\n            ),\n            world.map_view_near_floors(\n                position,\n                WORLD_REGION_RADIUS,\n                WORLD_REGION_FLOOR_RADIUS,\n            ),",
    "expected": 1,
    "label": "welcome multi-floor preload"
  },
  {
    "file": "crates/game-server/src/main.rs",
    "before": "                    Ok(position) => {\n                        // Send a new floor/region before the movement event. The\n                        // control channel is prioritized by the websocket writer,\n                        // so the client can prepare geometry before rendering the\n                        // player on the new floor.\n                        if should_refresh_world_region(streamed_region_center, position) {\n                            let world = state.world.read().await;\n                            let message = world\n                                .requires_region_streaming(WORLD_REGION_RADIUS)\n                                .then(|| ServerMessage::WorldRegion {\n                                    map: Box::new(world.map_view_near(position, WORLD_REGION_RADIUS)),\n                                    ground_items: world.ground_items_near(position, WORLD_REGION_RADIUS),\n                                    creatures: world.creature_views_near(position, WORLD_REGION_RADIUS),\n                                    npcs: world.npc_views_near(position, WORLD_REGION_RADIUS),\n                                    resource_nodes: world.resource_nodes_near(position, WORLD_REGION_RADIUS),\n                                });\n                            drop(world);\n                            if let Some(message) = message {\n                                state.private(id, message);\n                            }\n                            streamed_region_center = position;\n                        }\n                        state\n                            .publish_player_movement(\n                                id,\n                                previous_position.unwrap_or(position),\n                                position,\n                                sequence,\n                            )\n                            .await;\n                    }",
    "after": "                    Ok(position) => {\n                        let refresh_world_region =\n                            should_refresh_world_region(streamed_region_center, position);\n\n                        // Movement is latency-critical. The previous payload has a\n                        // 16-tile XY safety margin and adjacent floors preloaded, so\n                        // publish movement first and stream the heavy replacement\n                        // payload afterwards on the lower-priority update channel.\n                        state\n                            .publish_player_movement(\n                                id,\n                                previous_position.unwrap_or(position),\n                                position,\n                                sequence,\n                            )\n                            .await;\n\n                        if refresh_world_region {\n                            let world = state.world.read().await;\n                            let message = world\n                                .requires_region_streaming(WORLD_REGION_RADIUS)\n                                .then(|| ServerMessage::WorldRegion {\n                                    map: Box::new(world.map_view_near_floors(\n                                        position,\n                                        WORLD_REGION_RADIUS,\n                                        WORLD_REGION_FLOOR_RADIUS,\n                                    )),\n                                    ground_items: world.ground_items_near_floors(\n                                        position,\n                                        WORLD_REGION_RADIUS,\n                                        WORLD_REGION_FLOOR_RADIUS,\n                                    ),\n                                    creatures: world.creature_views_near_floors(\n                                        position,\n                                        WORLD_REGION_RADIUS,\n                                        WORLD_REGION_FLOOR_RADIUS,\n                                    ),\n                                    npcs: world.npc_views_near_floors(\n                                        position,\n                                        WORLD_REGION_RADIUS,\n                                        WORLD_REGION_FLOOR_RADIUS,\n                                    ),\n                                    resource_nodes: world.resource_nodes_near_floors(\n                                        position,\n                                        WORLD_REGION_RADIUS,\n                                        WORLD_REGION_FLOOR_RADIUS,\n                                    ),\n                                });\n                            drop(world);\n                            if let Some(message) = message {\n                                state.publish_update(id, message);\n                            }\n                            streamed_region_center = position;\n                        }\n                    }",
    "expected": 1,
    "label": "movement-first low-priority streaming"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "  private incomingFrame: number | null = null;\n  private incomingMessages: ServerMessage[] = [];\n\n  constructor(private world: WorldState) { }",
    "after": "  // TIBIAGAME_STREAMING_FIX_V1\n  private incomingFrame: number | null = null;\n  private incomingMessages: ServerMessage[] = [];\n  private pendingWorldRegion: Extract<ServerMessage, { type: \"world_region\" }> | null = null;\n  private worldRegionIdleHandle: number | null = null;\n  private regionDecodeWorker: Worker | null = null;\n\n  constructor(private world: WorldState) { }",
    "expected": 1,
    "label": "client region idle queue fields"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "        this.incomingMessages.push(message);\n        if (this.incomingFrame === null) {\n          this.incomingFrame = window.requestAnimationFrame(() => this.flushIncomingMessages());\n        }",
    "after": "        if (message.type === \"world_region\") {\n          // Region packets are large and mostly static. Do not apply them in\n          // the same requestAnimationFrame batch as movement/combat updates.\n          // Coalescing also prevents an old region from being built if the\n          // network briefly catches up with more than one payload queued.\n          this.pendingWorldRegion = message;\n          this.scheduleWorldRegionApply();\n        } else {\n          this.incomingMessages.push(message);\n          if (this.incomingFrame === null) {\n            this.incomingFrame = window.requestAnimationFrame(() => this.flushIncomingMessages());\n          }\n        }",
    "expected": 1,
    "label": "client separate static-region queue"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "      this.stopPingTimer();\n      this.stopAttackTimer();\n      this.world.attackTargetId = null;",
    "after": "      this.stopPingTimer();\n      this.stopAttackTimer();\n      this.cancelWorldRegionApply();\n      this.stopRegionDecodeWorker();\n      this.world.attackTargetId = null;",
    "expected": 1,
    "label": "client cancel region work on socket close"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "    this.incomingFrame = null;\n    this.incomingMessages.length = 0;\n    const socket = this.socket;",
    "after": "    this.incomingFrame = null;\n    this.incomingMessages.length = 0;\n    this.cancelWorldRegionApply();\n    this.stopRegionDecodeWorker();\n    const socket = this.socket;",
    "expected": 1,
    "label": "client cancel region work on disconnect"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "  private flushIncomingMessages() {",
    "after": "  private decodeWorldRegion(raw: string) {\n    if (!this.regionDecodeWorker) {\n      const worker = new Worker(new URL(\"./NetworkDecodeWorker.ts\", import.meta.url), { type: \"module\" });\n      worker.addEventListener(\"message\", (event: MessageEvent<{ ok: boolean; message?: ServerMessage }>) => {\n        const decoded = event.data;\n        if (!decoded.ok || decoded.message?.type !== \"world_region\") {\n          this.world.connection = \"error\";\n          this.world.notify();\n          return;\n        }\n        // Dedicated workers process posted messages in order. Keep only the\n        // newest static region so a network burst cannot build stale geometry.\n        this.pendingWorldRegion = decoded.message;\n        this.scheduleWorldRegionApply();\n      });\n      worker.addEventListener(\"error\", () => {\n        this.world.connection = \"error\";\n        this.world.notify();\n      });\n      this.regionDecodeWorker = worker;\n    }\n    this.regionDecodeWorker.postMessage(raw);\n  }\n\n  private stopRegionDecodeWorker() {\n    this.regionDecodeWorker?.terminate();\n    this.regionDecodeWorker = null;\n  }\n\n  private scheduleWorldRegionApply() {\n    if (this.worldRegionIdleHandle !== null) return;\n    const idleWindow = window as Window & {\n      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;\n    };\n    const apply = () => {\n      this.worldRegionIdleHandle = null;\n      const region = this.pendingWorldRegion;\n      this.pendingWorldRegion = null;\n      if (!region) return;\n\n      const startedAt = performance.now();\n      this.world.apply(region);\n      const elapsedMs = performance.now() - startedAt;\n      if (elapsedMs > 8) {\n        console.info(`world region apply: ${elapsedMs.toFixed(1)}ms`);\n      }\n\n      if (this.pendingWorldRegion) this.scheduleWorldRegionApply();\n    };\n\n    this.worldRegionIdleHandle = idleWindow.requestIdleCallback\n      ? idleWindow.requestIdleCallback(apply, { timeout: 500 })\n      : window.setTimeout(apply, 0);\n  }\n\n  private cancelWorldRegionApply() {\n    if (this.worldRegionIdleHandle !== null) {\n      const idleWindow = window as Window & {\n        cancelIdleCallback?: (handle: number) => void;\n      };\n      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(this.worldRegionIdleHandle);\n      else window.clearTimeout(this.worldRegionIdleHandle);\n    }\n    this.worldRegionIdleHandle = null;\n    this.pendingWorldRegion = null;\n  }\n\n  private flushIncomingMessages() {",
    "expected": 1,
    "label": "client idle/coalesced region application"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "import { mergeGeometries } from \"three/examples/jsm/utils/BufferGeometryUtils.js\";",
    "after": "",
    "expected": 1,
    "label": "remove synchronous geometry merge import"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "  const onFloor = (positions: readonly Position[]) => positions.filter((tile) => tile.z === floor);\n  const materials = new Map(map.terrainMaterials.filter((entry) => entry.position.z === floor).map((entry) => [`${entry.position.x}:${entry.position.y}`, entry.material]));\n  const materialTiles = (id: string) => [...materials.entries()].filter(([, value]) => value === id).map(([key]) => {\n    const [x, y] = key.split(\":\").map(Number);\n    return { x, y, z: floor };\n  });\n  const structuralTiles = new Set([\n    ...map.water,\n    ...map.trees,\n    ...map.houseWalls,\n    ...map.castleWalls,\n    ...(map.objects ?? [])\n      .filter((object) => object.position.z === floor && [\n        \"mountain_wall\",\n        \"forest_tree\",\n        \"pine_tree\",\n        \"snowy_pine\",\n        \"snow_bank\",\n        \"well\",\n        \"table\",\n        \"wooden_crate\",\n        \"rock_pile\",\n        \"campfire\",\n        \"fence_post\",\n      ].includes(object.kind))\n      .map((object) => object.position),\n  ].map(tileKey));\n  const visibleRocks = map.blocked.filter((tile) => tile.z === floor && !structuralTiles.has(tileKey(tile)));",
    "after": "  // createRenderRegion already clips every positional layer to this floor.\n  // Group terrain materials once instead of scanning/splitting the complete\n  // material list once for every material type.\n  const materialTiles = useMemo(() => {\n    const grouped = new Map<string, Position[]>();\n    for (const entry of map.terrainMaterials) {\n      const entries = grouped.get(entry.material);\n      if (entries) entries.push(entry.position);\n      else grouped.set(entry.material, [entry.position]);\n    }\n    return grouped;\n  }, [map.terrainMaterials]);\n  const tilesForMaterial = (id: string) => materialTiles.get(id) ?? [];\n\n  const visibleRocks = useMemo(() => {\n    const structuralTiles = new Set([\n      ...map.water,\n      ...map.trees,\n      ...map.houseWalls,\n      ...map.castleWalls,\n      ...(map.objects ?? [])\n        .filter((object) => [\n          \"mountain_wall\",\n          \"forest_tree\",\n          \"pine_tree\",\n          \"snowy_pine\",\n          \"snow_bank\",\n          \"well\",\n          \"table\",\n          \"wooden_crate\",\n          \"rock_pile\",\n          \"campfire\",\n          \"fence_post\",\n        ].includes(object.kind))\n        .map((object) => object.position),\n    ].map(tileKey));\n    return map.blocked.filter((tile) => !structuralTiles.has(tileKey(tile)));\n  }, [map.blocked, map.castleWalls, map.houseWalls, map.objects, map.trees, map.water]);",
    "expected": 1,
    "label": "terrain single-pass grouping"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={onFloor(map.roads)}",
    "after": "positions={map.roads}",
    "expected": 1,
    "label": "remove redundant roads floor filter"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={onFloor(map.floors)}",
    "after": "positions={map.floors}",
    "expected": 1,
    "label": "remove redundant floors floor filter"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"packed_earth\")}",
    "after": "positions={tilesForMaterial(\"packed_earth\")}",
    "expected": 1,
    "label": "group packed earth once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"moss_stone\")}",
    "after": "positions={tilesForMaterial(\"moss_stone\")}",
    "expected": 1,
    "label": "group moss stone once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"sandstone\")}",
    "after": "positions={tilesForMaterial(\"sandstone\")}",
    "expected": 1,
    "label": "group sandstone once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"mud\")}",
    "after": "positions={tilesForMaterial(\"mud\")}",
    "expected": 1,
    "label": "group mud once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"gravel\")}",
    "after": "positions={tilesForMaterial(\"gravel\")}",
    "expected": 1,
    "label": "group gravel once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"crypt_stone\")}",
    "after": "positions={tilesForMaterial(\"crypt_stone\")}",
    "expected": 1,
    "label": "group crypt stone once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"wood_planks\")}",
    "after": "positions={tilesForMaterial(\"wood_planks\")}",
    "expected": 1,
    "label": "group wood planks once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"marsh_grass\")}",
    "after": "positions={tilesForMaterial(\"marsh_grass\")}",
    "expected": 1,
    "label": "group marsh grass once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={materialTiles(\"ash_soil\")}",
    "after": "positions={tilesForMaterial(\"ash_soil\")}",
    "expected": 1,
    "label": "group ash soil once"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={onFloor(map.water)}",
    "after": "positions={map.water}",
    "expected": 1,
    "label": "remove redundant water floor filter"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "positions={onFloor(map.bridges)}",
    "after": "positions={map.bridges}",
    "expected": 1,
    "label": "remove redundant bridge floor filter"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "  const visibleObjects = useMemo(() => (map.objects ?? []).filter((entry) => entry.position.z === floor), [floor, map.objects]);",
    "after": "  // The region slicer already guarantees that world objects are on `floor`.\n  const visibleObjects = map.objects ?? [];",
    "expected": 1,
    "label": "remove redundant object floor scan"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "...map.trees.filter((tile) => tile.z === floor),",
    "after": "...map.trees,",
    "expected": 1,
    "label": "remove redundant tree floor scan"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "<ConnectedWalls positions={map.castleWalls.filter((tile) => tile.z === floor)} castle />",
    "after": "<ConnectedWalls positions={map.castleWalls} castle />",
    "expected": 1,
    "label": "remove redundant castle-wall floor scan"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "<InstancedTorches positions={map.torches.filter((tile) => tile.z === floor)} />",
    "after": "<InstancedTorches positions={map.torches} />",
    "expected": 1,
    "label": "remove redundant torch floor scan"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "function ConnectedWalls({ positions, castle }: { positions: readonly Position[]; castle: boolean }) {\n  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;\n  const castleTexture = useLoader(THREE.TextureLoader, \"/assets/world/aldoria-castle-stone-v2.png\");\n  castleTexture.wrapS = castleTexture.wrapT = THREE.RepeatWrapping;\n  castleTexture.repeat.set(1.35, 1.35);\n  castleTexture.colorSpace = THREE.SRGBColorSpace;\n  const geometry = useMemo(() => {\n    // BufferGeometryUtils assumes at least one geometry and dereferences\n    // geometries[0]. Empty authored layers are valid, especially on a new map.\n    if (positions.length === 0) return null;\n    const set = new Set(positions.map(tileKey));\n    const thickness = castle ? 0.28 : 0.18;\n    const centerSize = castle ? 0.3 : 0.24;\n    const pieces: THREE.BufferGeometry[] = [];\n    const addBox = (size: [number, number, number], offset: [number, number, number]) => {\n      const box = new THREE.BoxGeometry(...size);\n      box.translate(...offset);\n      pieces.push(box);\n    };\n    positions.forEach((tile) => {\n      const x = tile.x + 0.5; const z = tile.y + 0.5;\n      addBox([centerSize, height, centerSize], [x, height / 2, z]);\n      if (set.has(`${tile.x - 1}:${tile.y}:${tile.z}`)) addBox([0.42, height, thickness], [x - 0.32, height / 2, z]);\n      if (set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)) addBox([0.42, height, thickness], [x + 0.32, height / 2, z]);\n      if (set.has(`${tile.x}:${tile.y - 1}:${tile.z}`)) addBox([thickness, height, 0.42], [x, height / 2, z - 0.32]);\n      if (set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)) addBox([thickness, height, 0.42], [x, height / 2, z + 0.32]);\n      if (castle) addBox([0.25, 0.36, 0.25], [x, height + 0.18, z]);\n    });\n    const merged = pieces.length > 0 ? mergeGeometries(pieces, false) : null;\n    pieces.forEach((piece) => piece.dispose());\n    if (!merged) throw new Error(\"Unable to merge connected wall geometry\");\n    merged.computeBoundingBox();\n    merged.computeBoundingSphere();\n    return merged;\n  }, [castle, height, positions]);\n  useEffect(() => () => geometry?.dispose(), [geometry]);\n  if (!geometry) return null;\n  return <mesh geometry={geometry} castShadow receiveShadow userData={{ occluder: true }}>\n    <meshStandardMaterial map={castle ? castleTexture : undefined} color={castle ? \"#d0d0c5\" : \"#aa987c\"} roughness={0.98} />\n  </mesh>;\n}",
    "after": "function ConnectedWalls({ positions, castle }: { positions: readonly Position[]; castle: boolean }) {\n  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;\n  const castleTexture = useWorldTexture(\"/assets/world/aldoria-castle-stone-v2.png\", 1.35, 1.35);\n  const mesh = useRef<THREE.InstancedMesh>(null);\n  const instances = useMemo(() => {\n    if (positions.length === 0) return [];\n    const set = new Set(positions.map(tileKey));\n    const thickness = castle ? 0.28 : 0.18;\n    const centerSize = castle ? 0.3 : 0.24;\n    const connectorLength = Math.max(0.1, 1 - centerSize);\n    const next: { position: [number, number, number]; scale: [number, number, number] }[] = [];\n\n    for (const tile of positions) {\n      const x = tile.x + 0.5;\n      const z = tile.y + 0.5;\n      next.push({\n        position: [x, height / 2, z],\n        scale: [centerSize, height, centerSize],\n      });\n\n      // Emit each connection once. The old merged geometry emitted both\n      // directions for every neighboring pair, allocating overlapping boxes.\n      if (set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)) {\n        next.push({\n          position: [x + 0.5, height / 2, z],\n          scale: [connectorLength, height, thickness],\n        });\n      }\n      if (set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)) {\n        next.push({\n          position: [x, height / 2, z + 0.5],\n          scale: [thickness, height, connectorLength],\n        });\n      }\n      if (castle) {\n        next.push({\n          position: [x, height + 0.18, z],\n          scale: [0.25, 0.36, 0.25],\n        });\n      }\n    }\n    return next;\n  }, [castle, height, positions]);\n\n  useLayoutEffect(() => {\n    if (!mesh.current) return;\n    const matrix = new THREE.Matrix4();\n    const translation = new THREE.Vector3();\n    const scale = new THREE.Vector3();\n    const rotation = new THREE.Quaternion();\n    instances.forEach((instance, index) => {\n      translation.set(...instance.position);\n      scale.set(...instance.scale);\n      matrix.compose(translation, rotation, scale);\n      mesh.current!.setMatrixAt(index, matrix);\n    });\n    mesh.current.instanceMatrix.needsUpdate = true;\n    mesh.current.computeBoundingSphere();\n  }, [instances]);\n\n  if (instances.length === 0) return null;\n  return <instancedMesh\n    ref={mesh}\n    args={[undefined, undefined, instances.length]}\n    castShadow\n    receiveShadow\n    userData={{ occluder: true }}\n  >\n    <boxGeometry args={[1, 1, 1]} />\n    <meshStandardMaterial\n      map={castle ? castleTexture : undefined}\n      color={castle ? \"#d0d0c5\" : \"#aa987c\"}\n      roughness={0.98}\n    />\n  </instancedMesh>;\n}",
    "expected": 1,
    "label": "replace wall geometry merge with one instanced mesh"
  },
  {
    "file": "apps/client/src/game/ThreeWorld.tsx",
    "before": "shadow-mapSize={[1024, 1024]}",
    "after": "shadow-mapSize={[512, 512]}",
    "expected": 1,
    "label": "reduce one-shot shadow refresh GPU cost"
  },
  {
    "file": "apps/client/src/game/NetworkClient.ts",
    "before": "      try {\n        const message = JSON.parse(event.data) as ServerMessage;",
    "after": "      if (typeof event.data === \"string\"\n        && event.data.slice(0, 96).includes('\"type\":\"world_region\"')) {\n        this.decodeWorldRegion(event.data);\n        return;\n      }\n      try {\n        const message = JSON.parse(event.data) as ServerMessage;",
    "expected": 1,
    "label": "client decode heavy world regions off main thread"
  },
  {
    "file": "apps/client/src/actors/CreatureAssetManager.ts",
    "before": "  /** Dispose the app-lifetime cache when the entire Three.js world is torn down. */",
    "after": "  async preload(id: string): Promise<void> {\n    const definition = await this.load(id);\n    await Promise.all(Object.values(definition.animations).map((animation) => this.loadAnimation(id, animation)));\n  }\n\n  /** Dispose the app-lifetime cache when the entire Three.js world is torn down. */",
    "expected": 1,
    "label": "preload complete sprite animation atlases"
  },
  {
    "file": "apps/client/src/actors/CreatureAssetManager.ts",
    "before": "export const creatureAssetManager = new CreatureAssetManager();",
    "after": "export const creatureAssetManager = new CreatureAssetManager();\n\n// The castle rat is currently the sprite-creature path. Warm its JSON, WebP\n// decode and Three.js texture cache while the player is still entering the\n// world instead of paying that cost at the first on-screen encounter.\nif (typeof window !== \"undefined\") {\n  const idleWindow = window as Window & {\n    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;\n  };\n  const preload = () => {\n    void creatureAssetManager.preload(\"castle_rat\").catch((error) => {\n      console.warn(\"sprite creature preload failed\", error);\n    });\n  };\n  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(preload, { timeout: 1_500 });\n  else window.setTimeout(preload, 0);\n}",
    "expected": 1,
    "label": "warm castle rat assets before first encounter"
  }
];
const createdFiles = {
  "apps/client/src/game/NetworkDecodeWorker.ts": "type DecodeResult =\n  | { ok: true; message: unknown }\n  | { ok: false; error: string };\n\nconst scope = globalThis as unknown as {\n  addEventListener(type: \"message\", listener: (event: MessageEvent<string>) => void): void;\n  postMessage(message: DecodeResult): void;\n};\n\nscope.addEventListener(\"message\", (event) => {\n  try {\n    const message = JSON.parse(event.data) as { type?: string };\n    if (message.type !== \"world_region\") throw new Error(\"unexpected message type\");\n    scope.postMessage({ ok: true, message });\n  } catch (error) {\n    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : \"decode failed\" });\n  }\n});\n"
};

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

const byFile = new Map();
for (const replacement of replacements) {
  const list = byFile.get(replacement.file) ?? [];
  list.push(replacement);
  byFile.set(replacement.file, list);
}

let changedFiles = 0;
for (const [relative, edits] of byFile) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing ${relative}. Run this from the tibiaCloneGame repository root.`);
  }
  const originalText = fs.readFileSync(absolute, "utf8");
  const usesCrLf = originalText.includes("\r\n");
  let text = originalText.replace(/\r\n/g, "\n");
  let changed = false;

  for (const edit of edits) {
    const count = countOccurrences(text, edit.before);
    if (count !== edit.expected) {
      // Idempotence: if the replacement is already present, treat it as done.
      const alreadyApplied = edit.after && countOccurrences(text, edit.after) >= edit.expected;
      if (alreadyApplied && count === 0) {
        console.log(`already applied: ${edit.label}`);
        continue;
      }
      throw new Error(
        `${relative}: expected ${edit.expected} occurrence(s) for "${edit.label}", found ${count}. ` +
        `The repository has probably changed; aborting without writing this file.`
      );
    }
    text = text.replace(edit.before, edit.after);
    changed = true;
    console.log(`${checkOnly ? "would apply" : "applied"}: ${edit.label}`);
  }

  if (changed) {
    changedFiles += 1;
    if (!checkOnly) fs.writeFileSync(absolute, usesCrLf ? text.replace(/\n/g, "\r\n") : text, "utf8");
  }
}

for (const [relative, content] of Object.entries(createdFiles)) {
  const absolute = path.join(root, relative);
  if (fs.existsSync(absolute)) {
    const existing = fs.readFileSync(absolute, "utf8").replace(/\r\n/g, "\n");
    if (existing !== content) {
      throw new Error(`${relative} already exists with different content; refusing to overwrite it.`);
    }
    console.log(`already present: ${relative}`);
  } else if (checkOnly) {
    changedFiles += 1;
    console.log(`would create: ${relative}`);
  } else {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
    changedFiles += 1;
    console.log(`created: ${relative}`);
  }
}

console.log("");
if (checkOnly) {
  console.log(`Streaming performance fix validated against ${changedFiles} file(s); no files were written.`);
} else {
  console.log(`Streaming performance fix applied to ${changedFiles} file(s).`);
  console.log("Recommended validation:");
  console.log("  npm run check");
  console.log("  npm test");
  console.log("  cargo fmt --check");
  console.log("  cargo test --workspace");
  console.log("");
  console.log("If cargo fmt --check reports formatting only, run: cargo fmt");
}
