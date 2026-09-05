import { Canvas, type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";

import type {
  BuildingView,
  CreatureView,
  DoorView,
  MapView,
  NpcView,
  PlayerView,
  Position,
  ResourceNodeView,
  StairView,
  WindowView,
  WorldObjectView,
} from "../protocol";
import { CastleRatSprite } from "../actors/CastleRatSprite";
import { createActorMotionState, sampleActorMotion, type ActorMotionState } from "../actors/actorMotion";
import { AnimatedCharacter, type CharacterKind } from "./AnimatedCharacter";
import { CreatureModel } from "./CreatureModels";
import { CLIENT_STEP_MS, InputController } from "./InputController";
import { GabledRoof, HangingSign, HouseDoorway, HouseWindowOpening, InstancedHousePlinths, InstancedHouseWalls, MedievalDoorWall, MedievalWall, ShutterWindow } from "./MedievalModels";
import { createHouseDoorwayLayout, createHouseWindowLayout } from "./DoorwayLayout";
import { playerLightProfile, type PlayerLightProfile } from "./PlayerLight";
import { WorldState, type CombatEffectView } from "./WorldState";
import { tileCenter, worldToTile, WORLD_TILE_SIZE } from "./WorldCoordinates";
import { worldEnvironment } from "./worldEnvironment";

const TILE_HEIGHT = 0.12;
// The KayKit actors have broad, rounded silhouettes. The environment uses a
// slightly larger architectural scale so openings and landmarks frame them
// naturally while every footprint still occupies the same gameplay tiles.
const WALL_HEIGHT = 3.2;
const CASTLE_HEIGHT = 4.1;
const DOOR_HEIGHT = 2.2;
const CAMERA_ZOOM = 90;
const CAMERA_HEIGHT = 18;
// About 27 degrees away from straight down: enough to read wall fronts and
// actor silhouettes without returning to the old diagonal isometric view.
const CAMERA_TOPDOWN_OFFSET = 9;
const GROUND_ACTOR_Y = 0.05;
// The bridge top is y=0.16. Keep the same clearance actors have above normal terrain.
const BRIDGE_ACTOR_Y = 0.23;
// TIBIAGAME_STREAMING_FIX_V2
// The network cache is radius 48, but the GPU does not need to own that whole
// payload at once. A 24-tile chunk with 8 tiles of padding is a 40x40 local
// static scene: comfortably larger than the camera while dramatically cheaper
// to construct than the previous worst-case 152x152 scene.
// TIBIAGAME_STREAMING_FIX_V3_1
// TIBIAGAME_STREAMING_FIX_V4
// Align renderer boundaries with the server's 32-tile spatial chunks. The
// 8-tile safety padding keeps the camera covered without rebuilding 68x68.
const RENDER_CHUNK_SIZE = 32;
const RENDER_PADDING = 8;

type ThreeWorldProps = {
  world: WorldState;
  input: InputController;
  onReady?: () => void;
  showDebug?: boolean;
};

export function ThreeWorld({ world, input, onReady, showDebug = true }: ThreeWorldProps) {
  const performanceLabel = useRef<HTMLDivElement>(null);
  const positionLabel = useRef<HTMLDivElement>(null);
  const [lootHover, setLootHover] = useState<{ label: string; x: number; y: number } | null>(null);
  return (
    <>
      <Canvas
        className="three-world"
        onContextMenu={(event) => event.preventDefault()}
        orthographic
        shadows
        dpr={[1, 1.6]}
        camera={{ near: 0.1, far: 180, position: [0, CAMERA_HEIGHT, CAMERA_TOPDOWN_OFFSET], zoom: CAMERA_ZOOM }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFShadowMap;
          // The environment is static. Avoid drawing every wall and tree a
          // second time on every frame just to reproduce the same shadow map.
          gl.shadowMap.autoUpdate = false;
          gl.shadowMap.needsUpdate = true;
          gl.setClearColor(0x0b1210);
        }}
      >
        <Suspense fallback={null}>
          <WorldScene world={world} input={input} onLootHover={setLootHover} />
          {showDebug && <ClientPerformanceMonitor label={performanceLabel} positionLabel={positionLabel} world={world} />}
          <SceneReady onReady={onReady} />
        </Suspense>
      </Canvas>
      {lootHover && <div className="ground-loot-tooltip" style={{ left: lootHover.x + 14, top: lootHover.y + 14 }}><strong>{lootHover.label}</strong><small>Click to interact</small></div>}
      {showDebug && (
        <div className="debug-meter" aria-label="Position and rendering performance">
          <div ref={positionLabel} className="position-meter">x -- · y -- · z --</div>
          <div ref={performanceLabel} className="fps-meter">-- FPS</div>
        </div>
      )}
    </>
  );
}

function SceneReady({ onReady }: { onReady?: () => void }) {
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    onReady?.();
  });
  return null;
}

function StaticShadowMap({
  revision,
  movementKey,
}: {
  revision: MapView;
  movementKey: string;
}) {
  const { gl } = useThree();
  useEffect(() => {
    // TIBIAGAME_STREAMING_FIX_V3_1
    // A tile movement changes movementKey and cancels this timer. The static
    // shadow map is refreshed only after movement has been quiet for 450 ms.
    const handle = window.setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
    }, 450);
    return () => window.clearTimeout(handle);
  }, [gl, revision, movementKey]);
  return null;
}

function WorldScene({ world, input, onLootHover }: ThreeWorldProps & { onLootHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  const subscribeVisual = useCallback((listener: () => void) => world.subscribeVisual(listener), [world]);
  const visualSnapshot = useCallback(() => world.visualRevision, [world]);
  useSyncExternalStore(subscribeVisual, visualSnapshot);
  const map = world.map;
  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
  const localVisualPosition = useRef(new THREE.Vector3(Number.NaN, 0.05, Number.NaN));
  const floor = local?.position.z ?? map?.floor ?? 0;

  // Network regions are cache fills, not render-scene revisions. Keep the most
  // recently delivered payload hot, but do not make its object identity a
  // useMemo dependency. When the player reaches a new render chunk/floor we
  // consume the latest already-prefetched payload.
  // TIBIAGAME_STREAMING_FIX_V4
  const latestMapRef = useRef<MapView | null>(map);
  if (map) latestMapRef.current = map;
  const mapReady = map ? 1 : 0;
  const chunkX = Math.floor((local?.position.x ?? 0) / RENDER_CHUNK_SIZE);
  const chunkY = Math.floor((local?.position.y ?? 0) / RENDER_CHUNK_SIZE);

  // Do not defer chunk coordinates. Under continuous movement React can keep a
  // deferred chunk behind the player, which is exactly how the minimap could
  // show the new region while the rendered world stayed old.
  const dynamicMapRevision = world.dynamicMapRevision;
  const streamRegionRevision = useDeferredValue(world.streamRegionRevision);
  const region = useMemo(() => {
    void dynamicMapRevision;
    void streamRegionRevision;
    const source = mapReady ? latestMapRef.current : null;
    if (!source) return null;

    const startedAt = performance.now();
    const next = createRenderRegion(source, floor, chunkX, chunkY);
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs > 6) {
      console.info(
        `static region slice: ${elapsedMs.toFixed(1)}ms · chunk ${chunkX}:${chunkY} · z ${floor}`,
      );
    }
    return next;
  }, [
    mapReady,
    floor,
    chunkX,
    chunkY,
    dynamicMapRevision,
    streamRegionRevision,
  ]);

  if (!map || !region) return null;
  const bridgeTiles = useMemo(() => new Set(region.map.bridges.map(tileKey)), [region.map.bridges]);
  const actorGroundY = (position: Position) => bridgeTiles.has(tileKey(position)) ? BRIDGE_ACTOR_Y : GROUND_ACTOR_Y;
  const indoorBuildingId = local
    ? region.map.buildings.find((building) => building.floor === floor && insideBuilding(local.position, building))?.id ?? null
    : null;
  const players = [...world.players.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const creatures = [...world.creatures.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const npcs = [...world.npcs.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const resourceNodes = [...world.resourceNodes.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const playerLight = playerLightProfile(world.inventory, world.itemDefinitions);
  const onGround = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button === 2) event.nativeEvent.preventDefault();
    input.interactAt({
      x: Math.max(0, Math.min(map.width - 1, worldToTile(event.point.x))),
      y: Math.max(0, Math.min(map.height - 1, worldToTile(event.point.z))),
      z: floor,
    });
  }, [floor, input, map.height, map.width]);

  return (
    <>
      <Atmosphere torches={region.map.torches} local={local?.position} visualTarget={localVisualPosition} playerLight={playerLight} />
      <FollowCamera target={local?.position} visualTarget={localVisualPosition} mapWidth={map.width} mapHeight={map.height} />
      <Terrain map={region.map} floor={floor} bounds={region.bounds} onGround={onGround} />
      {/* TIBIAGAME_STREAMING_FIX_V5
          Late structure assets may suspend locally, but must never blank the
          terrain, player or entire streamed world. */}
      <Suspense fallback={null}>
        <Structures map={region.map} input={input} world={world} discoveryRevision={world.worldObjectCallout?.key ?? 0} floor={floor} indoorBuildingId={indoorBuildingId} onHover={onLootHover} />
      </Suspense>
      <StaticShadowMap
        revision={region.map}
        movementKey={local ? `${local.position.x}:${local.position.y}:${local.position.z}` : "none"}
      />
      <OcclusionController target={local?.position} visualTarget={localVisualPosition} sceneRevision={region.map} />
      {players.map((player) => (
        <PlayerActor
          key={player.id}
          player={player}
          local={player.id === world.localPlayerId}
          visualPosition={player.id === world.localPlayerId ? localVisualPosition : undefined}
          correctionRevision={player.id === world.localPlayerId ? world.localCorrectionRevision : 0}
          groundY={actorGroundY(player.position)}
          selected={player.id === world.selectedPlayerId}
          onClick={(event) => {
            event.stopPropagation();
            if (player.id !== world.localPlayerId)
              input.interactPlayer(player.id, event.nativeEvent.clientX, event.nativeEvent.clientY);
          }}
          onContextMenu={(event) => {
            event.stopPropagation(); event.nativeEvent.preventDefault();
            if (player.id !== world.localPlayerId)
              input.interactPlayer(player.id, event.nativeEvent.clientX, event.nativeEvent.clientY);
          }}
        />
      ))}
      {creatures.map((creature) => (
        <CreatureActor
          key={creature.id}
          creature={creature}
          groundY={actorGroundY(creature.position)}
          selected={creature.id === world.attackTargetId}
          onClick={(event) => {
            event.stopPropagation();
            input.targetCreature(creature.id);
          }}
          onContextMenu={(event) => {
            event.stopPropagation(); event.nativeEvent.preventDefault();
            input.targetCreature(creature.id);
          }}
        />
      ))}
      {npcs.map((npc) => (
        <NpcActor
          key={npc.id}
          npc={npc}
          groundY={actorGroundY(npc.position)}
          playerPosition={localVisualPosition}
          onClick={(event) => {
            event.stopPropagation();
            input.interactNpc(npc.id);
          }}
          onContextMenu={(event) => {
            event.stopPropagation(); event.nativeEvent.preventDefault();
            input.interactNpc(npc.id);
          }}
        />
      ))}
      {resourceNodes.map((node) => (
        <ResourceNodeActor
          key={node.id}
          node={node}
          onHover={onLootHover}
          onClick={(event) => {
            event.stopPropagation();
            input.interactAt(node.position);
          }}
          onContextMenu={(event) => {
            event.stopPropagation(); event.nativeEvent.preventDefault();
            input.interactAt(node.position);
          }}
        />
      ))}
      {world.groundItems
        .filter((entry) => insideRenderBounds(entry.position, region.bounds))
        .map((entry) => (
          <GroundItemActor
            key={entry.item.instanceId}
            position={entry.position}
            corpse={entry.contents.length > 0}
            lootable={entry.contents.length > 0 || Boolean(world.itemDefinitions.get(entry.item.definitionId)?.pickupable)}
            label={entry.contents.length > 0
              ? `${entry.contents.length} loot ${entry.contents.length === 1 ? "item" : "items"}`
              : world.itemDefinitions.get(entry.item.definitionId)?.name ?? entry.item.definitionId}
            onHover={onLootHover}
            onClick={(event) => {
              event.stopPropagation();
              input.lootAt(entry.position);
            }}
            onContextMenu={(event) => {
              event.stopPropagation(); event.nativeEvent.preventDefault();
              input.lootAt(entry.position);
            }}
          />
        ))}
      {world.combatEffects
        .filter((effect) => effect.position.z === floor)
        .map((effect) => <CombatImpact key={effect.id} effect={effect} localPlayerId={world.localPlayerId} />)}
      <Weather local={local?.position} floor={floor} />
    </>
  );
}

const Terrain = memo(function Terrain({
  map,
  floor,
  bounds,
  onGround,
}: {
  map: NonNullable<WorldState["map"]>;
  floor: number;
  bounds: RenderBounds;
  onGround: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const grassTexture = useWorldTexture("/assets/world/greyhaven-grass.png", Math.max(1, bounds.width / 3), Math.max(1, bounds.height / 3));
  const roadTexture = useWorldTexture("/assets/world/greyhaven-cobble.png");
  const packedEarthTexture = useWorldTexture("/assets/world/aldoria-packed-earth-v1.png");
  const mossStoneTexture = useWorldTexture("/assets/world/aldoria-moss-stone-v1.png");
  const sandstoneTexture = useWorldTexture("/assets/world/aldoria-sandstone-v1.png");
  const mudTexture = useWorldTexture("/assets/world/aldoria-mud-v1.png");
  const gravelTexture = useWorldTexture("/assets/world/aldoria-gravel-v1.png");
  const cryptStoneTexture = useWorldTexture("/assets/world/aldoria-crypt-stone-v1.png");
  const woodPlanksTexture = useWorldTexture("/assets/world/aldoria-wood-planks-floor-v1.png");
  const marshGrassTexture = useWorldTexture("/assets/world/aldoria-marsh-grass-v1.png");
  const ashSoilTexture = useWorldTexture("/assets/world/aldoria-ash-soil-v1.png");
  const bridgeTexture = useWorldTexture("/assets/world/aldoria-bridge-planks-v1.png");
  // createRenderRegion already clips every positional layer to this floor.
  // Group terrain materials once instead of scanning/splitting the complete
  // material list once for every material type.
  const materialTiles = useMemo(() => {
    const grouped = new Map<string, Position[]>();
    for (const entry of map.terrainMaterials) {
      const entries = grouped.get(entry.material);
      if (entries) entries.push(entry.position);
      else grouped.set(entry.material, [entry.position]);
    }
    return grouped;
  }, [map.terrainMaterials]);
  const tilesForMaterial = (id: string) => materialTiles.get(id) ?? [];

  const visibleRocks = useMemo(() => {
    const structuralTiles = new Set([
      ...map.water,
      ...map.trees,
      ...map.houseWalls,
      ...map.castleWalls,
      ...(map.objects ?? [])
        .filter((object) => [
          "mountain_wall",
          "forest_tree",
          "pine_tree",
          "snowy_pine",
          "snow_bank",
          "well",
          "table",
          "wooden_crate",
          "rock_pile",
          "campfire",
          "fence_post",
        ].includes(object.kind))
        .map((object) => object.position),
    ].map(tileKey));
    return map.blocked.filter((tile) => !structuralTiles.has(tileKey(tile)));
  }, [map.blocked, map.castleWalls, map.houseWalls, map.objects, map.trees, map.water]);

  return (
    <group>
      <mesh receiveShadow position={[bounds.minX + bounds.width / 2, -0.12, bounds.minY + bounds.height / 2]} onPointerDown={onGround}>
        <boxGeometry args={[bounds.width, 0.2, bounds.height]} />
        <meshStandardMaterial map={grassTexture} color="#91a477" roughness={0.96} />
      </mesh>
      <InstancedTiles positions={map.roads} color="#b7a889" texture={roadTexture} height={0.035} y={0.015} />
      <InstancedTiles positions={map.floors} color="#aaa18d" texture={mossStoneTexture} height={0.045} y={0.025} />
      <InstancedTiles positions={tilesForMaterial("packed_earth")} color="#b29676" texture={packedEarthTexture} height={0.048} y={0.03} />
      <InstancedTiles positions={tilesForMaterial("moss_stone")} color="#a4ad9a" texture={mossStoneTexture} height={0.052} y={0.034} />
      <InstancedTiles positions={tilesForMaterial("sandstone")} color="#d0ba91" texture={sandstoneTexture} height={0.052} y={0.034} />
      <InstancedTiles positions={tilesForMaterial("mud")} color="#806248" texture={mudTexture} height={0.049} y={0.031} />
      <InstancedTiles positions={tilesForMaterial("gravel")} color="#aaa18f" texture={gravelTexture} height={0.051} y={0.033} />
      <InstancedTiles positions={tilesForMaterial("crypt_stone")} color="#89908a" texture={cryptStoneTexture} height={0.052} y={0.034} />
      <InstancedTiles positions={tilesForMaterial("wood_planks")} color="#a0744d" texture={woodPlanksTexture} height={0.052} y={0.034} />
      <InstancedTiles positions={tilesForMaterial("marsh_grass")} color="#71865d" texture={marshGrassTexture} height={0.05} y={0.032} />
      <InstancedTiles positions={tilesForMaterial("ash_soil")} color="#746d63" texture={ashSoilTexture} height={0.049} y={0.031} />
      <WaterTiles positions={map.water} />
      <BridgeTiles positions={map.bridges} texture={bridgeTexture} />
      <InstancedTiles positions={visibleRocks} color="#626d66" height={0.55} y={0.275} scale={0.72} castShadow />
    </group>
  );
}, (previous, next) => previous.floor === next.floor
  && previous.onGround === next.onGround
  && previous.bounds.minX === next.bounds.minX
  && previous.bounds.minY === next.bounds.minY
  && previous.bounds.width === next.bounds.width
  && previous.bounds.height === next.bounds.height
  && previous.map.width === next.map.width
  && previous.map.height === next.map.height
  && previous.map.blocked === next.map.blocked
  && previous.map.water === next.map.water
  && previous.map.bridges === next.map.bridges
  && previous.map.trees === next.map.trees
  && previous.map.roads === next.map.roads
  && previous.map.floors === next.map.floors
  && previous.map.houseWalls === next.map.houseWalls
  && previous.map.castleWalls === next.map.castleWalls
  && previous.map.terrainMaterials === next.map.terrainMaterials);

function InstancedTiles({
  positions,
  color,
  height,
  y,
  scale = 0.98,
  castShadow = false,
  texture,
}: {
  positions: readonly Position[];
  color: THREE.ColorRepresentation;
  height: number;
  y: number;
  scale?: number;
  castShadow?: boolean;
  texture?: THREE.Texture;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach((tile, index) => {
      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [positions, y]);
  if (!positions.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={[scale, height, scale]} />
      <meshStandardMaterial map={texture} color={color} roughness={0.92} />
    </instancedMesh>
  );
}

function BridgeTiles({ positions, texture }: { positions: readonly Position[]; texture: THREE.Texture }) {
  const bridgeSet = useMemo(() => new Set(positions.map(tileKey)), [positions]);
  const railSegments = useMemo(() => {
    const segments: { key: string; position: [number, number, number]; size: [number, number, number] }[] = [];
    const bridgeByKey = new Map(positions.map((tile) => [tileKey(tile), tile]));
    const visited = new Set<string>();
    for (const start of positions) {
      if (visited.has(tileKey(start))) continue;
      const component: Position[] = [];
      const pending = [start];
      visited.add(tileKey(start));
      while (pending.length > 0) {
        const tile = pending.pop()!;
        component.push(tile);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const neighborKey = `${tile.x + dx}:${tile.y + dy}:${tile.z}`;
          const neighbor = bridgeByKey.get(neighborKey);
          if (neighbor && !visited.has(neighborKey)) {
            visited.add(neighborKey);
            pending.push(neighbor);
          }
        }
      }

      const xSpan = Math.max(...component.map((tile) => tile.x)) - Math.min(...component.map((tile) => tile.x));
      const ySpan = Math.max(...component.map((tile) => tile.y)) - Math.min(...component.map((tile) => tile.y));
      const runsAlongX = xSpan > ySpan;
      for (const tile of component) {
        const x = tile.x + 0.5;
        const z = tile.y + 0.5;
        const edge = (dx: number, dz: number) => !bridgeSet.has(`${tile.x + dx}:${tile.y + dz}:${tile.z}`);
        if (runsAlongX) {
          if (edge(0, -1)) segments.push({ key: `${tileKey(tile)}-n`, position: [x, 0.55, tile.y + 0.06], size: [0.9, 0.09, 0.09] });
          if (edge(0, 1)) segments.push({ key: `${tileKey(tile)}-s`, position: [x, 0.55, tile.y + 0.94], size: [0.9, 0.09, 0.09] });
        } else {
          if (edge(-1, 0)) segments.push({ key: `${tileKey(tile)}-w`, position: [tile.x + 0.06, 0.55, z], size: [0.09, 0.09, 0.9] });
          if (edge(1, 0)) segments.push({ key: `${tileKey(tile)}-e`, position: [tile.x + 0.94, 0.55, z], size: [0.09, 0.09, 0.9] });
        }
      }
    }
    return segments;
  }, [bridgeSet, positions]);
  if (!positions.length) return null;
  return (
    <group>
      <InstancedTiles positions={positions} color="#80603c" texture={texture} height={0.14} y={0.09} />
      <InstancedBridgeRails segments={railSegments} texture={texture} />
    </group>
  );
}

function InstancedBridgeRails({ segments, texture }: { segments: readonly { key: string; position: [number, number, number]; size: [number, number, number] }[]; texture: THREE.Texture }) {
  const horizontal = useMemo(() => segments.filter((segment) => segment.size[0] > segment.size[2]), [segments]);
  const vertical = useMemo(() => segments.filter((segment) => segment.size[0] <= segment.size[2]), [segments]);
  const posts = useMemo(() => segments.flatMap((segment) => segment.size[0] > segment.size[2]
    ? [[segment.position[0] - 0.38, 0.48, segment.position[2]], [segment.position[0] + 0.38, 0.48, segment.position[2]]]
    : [[segment.position[0], 0.48, segment.position[2] - 0.38], [segment.position[0], 0.48, segment.position[2] + 0.38]]) as [number, number, number][], [segments]);
  const horizontalMesh = useRef<THREE.InstancedMesh>(null);
  const verticalMesh = useRef<THREE.InstancedMesh>(null);
  const postMesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    horizontal.forEach((segment, index) => {
      if (!horizontalMesh.current) return;
      for (const y of [segment.position[1], segment.position[1] + 0.3]) {
        matrix.makeTranslation(segment.position[0], y, segment.position[2]);
        horizontalMesh.current.setMatrixAt(index * 2 + (y === segment.position[1] ? 0 : 1), matrix);
      }
      horizontalMesh.current.instanceMatrix.needsUpdate = true;
    });
    vertical.forEach((segment, index) => {
      if (!verticalMesh.current) return;
      for (const y of [segment.position[1], segment.position[1] + 0.3]) {
        matrix.makeTranslation(segment.position[0], y, segment.position[2]);
        verticalMesh.current.setMatrixAt(index * 2 + (y === segment.position[1] ? 0 : 1), matrix);
      }
      verticalMesh.current.instanceMatrix.needsUpdate = true;
    });
    posts.forEach((position, index) => {
      if (!postMesh.current) return;
      matrix.makeTranslation(...position); postMesh.current.setMatrixAt(index, matrix); postMesh.current.instanceMatrix.needsUpdate = true;
    });
    [horizontalMesh.current, verticalMesh.current, postMesh.current].forEach((mesh) => mesh?.computeBoundingSphere());
  }, [horizontal, posts, vertical]);
  return <>
    {horizontal.length > 0 && <instancedMesh ref={horizontalMesh} args={[undefined, undefined, horizontal.length * 2]} castShadow receiveShadow><boxGeometry args={[0.9, 0.09, 0.09]} /><meshStandardMaterial map={texture} color="#725334" roughness={0.9} /></instancedMesh>}
    {vertical.length > 0 && <instancedMesh ref={verticalMesh} args={[undefined, undefined, vertical.length * 2]} castShadow receiveShadow><boxGeometry args={[0.09, 0.09, 0.9]} /><meshStandardMaterial map={texture} color="#725334" roughness={0.9} /></instancedMesh>}
    {posts.length > 0 && <instancedMesh ref={postMesh} args={[undefined, undefined, posts.length]} castShadow><cylinderGeometry args={[0.07, 0.08, 0.78, 8]} /><meshStandardMaterial map={texture} color="#684a2f" roughness={0.92} /></instancedMesh>}
  </>;
}

function WaterTiles({ positions }: { positions: readonly Position[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const waterTexture = useWorldTexture("/assets/world/aldoria-water-v1.png");
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: waterTexture,
    color: "#277789",
    emissive: "#16424d",
    emissiveIntensity: 0.08,
    metalness: 0.05,
    roughness: 0.2,
    transparent: true,
    opacity: 0.86,
  }), [waterTexture]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach((tile, index) => {
      matrix.compose(
        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(1.02, 1.02, 1),
      );
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [positions]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const wave = Math.sin(clock.elapsedTime * 1.6) * 0.035;
    material.roughness = 0.2 + wave;
    material.opacity = 0.84 + Math.sin(clock.elapsedTime * 1.25) * 0.035;
    material.emissiveIntensity = 0.1 + wave;
    waterTexture.offset.set(clock.elapsedTime * 0.032, clock.elapsedTime * 0.019);
  });
  if (!positions.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]} receiveShadow>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}

function useWorldTexture(path: string, repeatX = 1, repeatY = 1) {
  const source = useLoader(THREE.TextureLoader, path);
  const { gl } = useThree();
  const texture = useMemo(() => {
    const clone = source.clone();
    clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(repeatX, repeatY);
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    clone.needsUpdate = true;
    return clone;
  }, [gl, repeatX, repeatY, source]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const Structures = memo(function Structures({ map, input, world, discoveryRevision, floor, indoorBuildingId, onHover }: { map: NonNullable<WorldState["map"]>; input: InputController; world: WorldState; discoveryRevision: number; floor: number; indoorBuildingId: string | null; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  const buildings = useMemo(() => map.buildings.filter((entry) => entry.floor === floor), [floor, map.buildings]);
  return (
    <group>
      {buildings.map((building) => <group key={building.id}>
        <Building building={building} doors={map.doors} windows={map.windows} input={input} />
        <GabledRoof building={building} wallHeight={buildingWallHeight(building)} roofVisible={building.id !== indoorBuildingId} roofFade={building.id !== indoorBuildingId ? 1 : 0.08} />
      </group>)}
      <StaticStructures map={map} input={input} world={world} discoveryRevision={discoveryRevision} floor={floor} buildings={buildings} onHover={onHover} />
    </group>
  );
});

const StaticStructures = memo(function StaticStructures({ map, input, world, discoveryRevision: _discoveryRevision, floor, buildings, onHover }: { map: NonNullable<WorldState["map"]>; input: InputController; world: WorldState; discoveryRevision: number; floor: number; buildings: readonly BuildingView[]; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  // The region slicer already guarantees that world objects are on `floor`.
  const visibleObjects = map.objects ?? [];
  const groupedObjects = useMemo(() => {
    const groups = {
      forestTrees: [] as Position[],
      pineTrees: [] as Position[],
      snowyPines: [] as Position[],
      dirtPaths: [] as Position[],
      snowGround: [] as Position[],
      mountainWalls: [] as Position[],
      snowBanks: [] as Position[],
      barrels: [] as Position[],
      other: [] as WorldObjectView[],
    };
    for (const object of visibleObjects) {
      switch (object.kind) {
        case "forest_tree": groups.forestTrees.push(object.position); break;
        case "pine_tree": groups.pineTrees.push(object.position); break;
        case "snowy_pine": groups.snowyPines.push(object.position); break;
        case "dirt_path": groups.dirtPaths.push(object.position); break;
        case "snow_ground": groups.snowGround.push(object.position); break;
        case "mountain_wall": groups.mountainWalls.push(object.position); break;
        case "snow_bank": groups.snowBanks.push(object.position); break;
        case "barrel": groups.barrels.push(object.position); break;
        default: groups.other.push(object);
      }
    }
    return groups;
  }, [visibleObjects]);
  const forestTrees = useMemo(() => [
    ...map.trees,
    ...groupedObjects.forestTrees,
  ], [floor, groupedObjects.forestTrees, map.trees]);
  return <>
      <ConnectedWalls positions={map.castleWalls} castle />
      <InstancedTiles positions={groupedObjects.dirtPaths} color="#8d6c49" height={0.055} y={0.045} />
      <InstancedTiles positions={groupedObjects.snowGround} color="#e6f0ee" height={0.055} y={0.045} />
      <InstancedTrees positions={forestTrees} variant="forest" />
      <InstancedTrees positions={groupedObjects.pineTrees} variant="pine" />
      <InstancedTrees positions={groupedObjects.snowyPines} variant="snowy" />
      <InstancedMountainWalls positions={groupedObjects.mountainWalls} />
      <InstancedSimpleObjects positions={groupedObjects.snowBanks} kind="snow-bank" />
      <InstancedSimpleObjects positions={groupedObjects.barrels} kind="barrel" />
      <WorldObjects objects={groupedObjects.other} />
      <InspectableWorldObjects objects={visibleObjects.filter((object) => inspectableWorldObjectIds.has(object.id))} input={input} world={world} onHover={onHover} />
      <InstancedTorches positions={map.torches} />
      <Stairs stairs={map.stairs} floor={floor} />
      {map.doors.filter((door) => door.position.z === floor && !insideAnyBuilding(door.position, buildings)).map((door) => <Door key={door.id} door={door} input={input} />)}
    </>;
});

function Stairs({ stairs, floor }: { stairs: readonly StairView[]; floor: number }) {
  return <group>{stairs.map((stair) => {
    const position = stair.from.z === floor ? stair.from : stair.to.z === floor ? stair.to : null;
    if (!position) return null;
    return <group key={`${stair.id}:${floor}`} position={[position.x + 0.5, 0.04, position.y + 0.5]}>
      {[0, 1, 2, 3].map((step) => <mesh key={step} castShadow position={[(step - 1.5) * 0.18, step * 0.075, 0]}>
        <boxGeometry args={[0.22, 0.12, 0.78]} />
        <meshStandardMaterial color="#9a6338" roughness={0.9} />
      </mesh>)}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.95, 0.035, 0.95]} />
        <meshStandardMaterial color="#5f432d" roughness={1} />
      </mesh>
    </group>;
  })}</group>;
}

const inspectableWorldObjectIds = new Set(["rivercross_mire_notice", "mire_drowned_supply_note", "mire_eastward_slick"]);

function InspectableWorldObjects({ objects, input, world, onHover }: { objects: readonly WorldObjectView[]; input: InputController; world: WorldState; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  return <group>{objects.map((object) => <InspectableWorldObject key={object.id} object={object} input={input} world={world} onHover={onHover} />)}</group>;
}

function InspectableWorldObject({ object, input, world, onHover }: { object: WorldObjectView; input: InputController; world: WorldState; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  const [hovered, setHovered] = useState(false);
  const callout = world.worldObjectCallout?.objectId === object.id ? world.worldObjectCallout : null;
  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => world.clearWorldObjectCallout(callout.key), 7_000);
    return () => window.clearTimeout(timer);
  }, [callout?.key, world]);
  useEffect(() => () => {
    document.body.style.cursor = "";
    onHover(null);
  }, [onHover]);
  const label = object.id === "rivercross_mire_notice" ? "Read weathered notice"
    : object.id === "mire_drowned_supply_note" ? "Inspect waterlogged barrel"
    : "Inspect the black water";
  const hitbox: [number, number, number] = object.kind === "notice_post" ? [0.72, 1.15, 0.5]
    : object.kind === "bog_slick" ? [1.05, 0.22, 1.05]
    : [0.86, 0.82, 0.86];
  const hitboxY = object.kind === "notice_post" ? 0.55 : object.kind === "bog_slick" ? 0.1 : 0.4;
  return <group
    position={[object.position.x + 0.5, 0, object.position.y + 0.5]}
    onPointerDown={(event) => event.stopPropagation()}
    onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; onHover({ label, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }); }}
    onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; onHover(null); }}
    onClick={(event) => { event.stopPropagation(); document.body.style.cursor = ""; onHover(null); input.interactWorldObject(object.id, object.position); }}
    onContextMenu={(event) => { event.stopPropagation(); event.nativeEvent.preventDefault(); input.interactWorldObject(object.id, object.position); }}
  >
    <mesh position={[0, hitboxY, 0]}>
      <boxGeometry args={hitbox} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {hovered && <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
      <ringGeometry args={[0.45, 0.54, 32]} />
      <meshBasicMaterial color="#f1c86d" transparent opacity={0.92} depthWrite={false} />
    </mesh>}
    {callout && <SpeechBubble text={callout.text} positionY={object.kind === "notice_post" ? 1.65 : 1.25} wrapped />}
  </group>;
}

function WorldObjects({ objects }: { objects: readonly WorldObjectView[] }) {
  return <group>{objects.map((object) => {
    const [x, z] = [object.position.x + 0.5, object.position.y + 0.5];
    if (object.kind === "notice_post") return <group key={object.id} position={[x, 0, z]} rotation={[0, 0.28, 0]}><mesh castShadow position={[0, 0.42, 0]}><boxGeometry args={[0.08, 0.84, 0.08]} /><meshStandardMaterial color="#553a24" roughness={1} /></mesh><mesh castShadow position={[0, 0.67, 0.015]}><boxGeometry args={[0.56, 0.38, 0.055]} /><meshStandardMaterial color="#765038" roughness={0.95} /></mesh><mesh position={[0, 0.68, 0.047]}><planeGeometry args={[0.4, 0.25]} /><meshStandardMaterial color="#d1be8a" roughness={1} /></mesh></group>;
    if (object.kind === "bog_slick") return <mesh key={object.id} receiveShadow position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.46, 12]} /><meshStandardMaterial color="#17231f" roughness={0.38} metalness={0.12} /></mesh>;
    if (object.kind === "bent_reeds") return <group key={object.id} position={[x, 0, z]} rotation={[0, 0.82, -0.18]}>{[-0.23, -0.08, 0.08, 0.22].map((offset, index) => <group key={offset} position={[offset, 0, (index % 2 - 0.5) * 0.12]} rotation={[0, 0, 0.24 + index * 0.06]}><mesh castShadow position={[0, 0.34 + index * 0.025, 0]}><cylinderGeometry args={[0.017, 0.025, 0.7 + index * 0.05, 5]} /><meshStandardMaterial color="#526a36" roughness={0.96} /></mesh><mesh castShadow position={[0.07, 0.61 + index * 0.04, 0]} rotation={[0, 0, -0.48]}><planeGeometry args={[0.18, 0.045]} /><meshStandardMaterial color="#6f873f" roughness={0.92} side={2} /></mesh></group>)}</group>;
    if (object.kind === "wrecked_planks") return <group key={object.id} position={[x, 0.08, z]} rotation={[0, 0.36, 0]}>{[-0.22, 0, 0.22].map((offset, index) => <mesh key={offset} castShadow position={[offset, index * 0.025, (index - 1) * 0.12]} rotation={[0, 0.22 * (index - 1), 0.1 * (index - 1)]}><boxGeometry args={[0.62, 0.09, 0.16]} /><meshStandardMaterial color={index === 1 ? "#4d392a" : "#66452d"} roughness={1} /></mesh>)}</group>;
    if (object.kind === "well") return <group key={object.id} position={[x, 0, z]}><mesh castShadow position={[0, 0.3, 0]}><cylinderGeometry args={[0.42, 0.48, 0.55, 10]} /><meshStandardMaterial color="#77807b" roughness={0.98} /></mesh><mesh position={[0, 0.59, 0]}><torusGeometry args={[0.34, 0.09, 6, 10]} /><meshStandardMaterial color="#58615d" roughness={0.95} /></mesh></group>;
    if (object.kind === "wooden_crate") return <group key={object.id} position={[x, 0, z]}><mesh castShadow receiveShadow position={[0, 0.28, 0]}><boxGeometry args={[0.66, 0.56, 0.66]} /><meshStandardMaterial color="#855833" roughness={0.92} /></mesh><mesh castShadow position={[0, 0.29, 0.35]}><boxGeometry args={[0.72, 0.08, 0.06]} /><meshStandardMaterial color="#4f321f" roughness={1} /></mesh><mesh castShadow position={[0, 0.29, -0.35]}><boxGeometry args={[0.72, 0.08, 0.06]} /><meshStandardMaterial color="#4f321f" roughness={1} /></mesh></group>;
    if (object.kind === "grain_sack") return <group key={object.id} position={[x, 0, z]}><mesh castShadow position={[0, 0.3, 0]} scale={[0.78, 1.08, 0.7]}><sphereGeometry args={[0.34, 10, 8]} /><meshStandardMaterial color="#b39a6a" roughness={1} /></mesh><mesh castShadow position={[0, 0.64, 0]}><sphereGeometry args={[0.09, 7, 6]} /><meshStandardMaterial color="#7c6542" roughness={1} /></mesh></group>;
    if (object.kind === "bone_pile") return <group key={object.id} position={[x, 0.08, z]}>{[[-0.18,0.1,-0.08,0.7],[0.13,0.12,0.12,-0.55],[-0.02,0.15,0.2,1.1]].map(([bx,by,bz,rot], index) => <mesh key={index} castShadow position={[bx,by,bz]} rotation={[Math.PI / 2, rot, 0]}><cylinderGeometry args={[0.035, 0.04, 0.48, 7]} /><meshStandardMaterial color="#cfc4a2" roughness={0.95} /></mesh>)}<mesh castShadow position={[0.22, 0.18, -0.14]}><sphereGeometry args={[0.14, 8, 7]} /><meshStandardMaterial color="#bfb28f" roughness={0.96} /></mesh></group>;
    if (object.kind === "rock_pile") return <group key={object.id} position={[x, 0, z]}>{[[-0.18,0.17,0.02,0.24],[0.16,0.2,0.1,0.3],[0.03,0.28,-0.14,0.25]].map(([rx,ry,rz,r], index) => <mesh key={index} castShadow receiveShadow position={[rx,ry,rz]}><dodecahedronGeometry args={[r, 0]} /><meshStandardMaterial color={index === 1 ? "#666d69" : "#7a807b"} roughness={0.99} /></mesh>)}</group>;
    if (object.kind === "mushroom_patch") return <group key={object.id} position={[x, 0, z]}>{[[-0.2,0.12,-0.08,0.12],[0.12,0.16,0.05,0.15],[0.24,0.1,-0.18,0.1]].map(([mx,my,mz,size], index) => <group key={index} position={[mx,0,mz]}><mesh castShadow position={[0,my * 0.55,0]}><cylinderGeometry args={[0.025,0.035,my,6]} /><meshStandardMaterial color="#d8c6a1" roughness={1} /></mesh><mesh castShadow position={[0,my + 0.015,0]} scale={[1,0.45,1]}><sphereGeometry args={[size,8,6]} /><meshStandardMaterial color={index === 1 ? "#c68155" : "#9c6048"} roughness={0.9} /></mesh></group>)}</group>;
    if (object.kind === "campfire") return <group key={object.id} position={[x, 0, z]}><mesh castShadow position={[0,0.1,0]} rotation={[0,0.7,Math.PI / 2]}><cylinderGeometry args={[0.07,0.08,0.62,7]} /><meshStandardMaterial color="#5d3924" roughness={1} /></mesh><mesh castShadow position={[0,0.1,0]} rotation={[0,-0.7,Math.PI / 2]}><cylinderGeometry args={[0.07,0.08,0.62,7]} /><meshStandardMaterial color="#5d3924" roughness={1} /></mesh><mesh position={[0,0.37,0]}><coneGeometry args={[0.16,0.55,8]} /><meshStandardMaterial color="#ff9a38" emissive="#e84d16" emissiveIntensity={1.8} toneMapped={false} /></mesh></group>;
    if (object.kind === "hay_bundle") return <group key={object.id} position={[x, 0.22, z]} rotation={[0,0.25,Math.PI / 2]}><mesh castShadow><cylinderGeometry args={[0.27,0.27,0.68,10]} /><meshStandardMaterial color="#b49543" roughness={1} /></mesh>{[-0.2,0.2].map((offset) => <mesh key={offset} position={[0,offset,0]}><torusGeometry args={[0.275,0.018,5,12]} /><meshStandardMaterial color="#6f5930" roughness={1} /></mesh>)}</group>;
    if (object.kind === "fence_post") return <group key={object.id} position={[x,0,z]}><mesh castShadow position={[0,0.52,0]}><boxGeometry args={[0.13,1.04,0.13]} /><meshStandardMaterial color="#6e482d" roughness={1} /></mesh><mesh castShadow position={[0,0.62,0]}><boxGeometry args={[0.82,0.11,0.1]} /><meshStandardMaterial color="#805638" roughness={1} /></mesh><mesh castShadow position={[0,0.34,0]}><boxGeometry args={[0.82,0.11,0.1]} /><meshStandardMaterial color="#805638" roughness={1} /></mesh></group>;
    const isTable = object.kind === "table"; return <group key={object.id} position={[x, 0, z]}><mesh castShadow position={[0, isTable ? 0.58 : 0.35, 0]}><boxGeometry args={[isTable ? 0.78 : 0.9, 0.13, isTable ? 0.58 : 0.25]} /><meshStandardMaterial color="#80502d" roughness={0.9} /></mesh>{isTable && [-0.29, 0.29].flatMap((dx) => [-0.2, 0.2].map((dz) => <mesh key={`${dx}:${dz}`} castShadow position={[dx, 0.28, dz]}><boxGeometry args={[0.1, 0.56, 0.1]} /><meshStandardMaterial color="#61391f" roughness={1} /></mesh>))}</group>;
  })}</group>;
}

const Building = memo(function Building({ building, doors, windows, input }: { building: BuildingView; doors: readonly DoorView[]; windows: readonly WindowView[]; input: InputController }) {
  const height = buildingWallHeight(building);
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  const matchingDoors = doors.filter((door) => door.position.z === building.floor && insideBuilding(door.position, building));
  const doorsByKey = new Map(matchingDoors.map((door) => [`${door.position.x}:${door.position.y}`, door]));
  const matchingWindows = windows.filter((window) => window.position.z === building.floor && insideBuilding(window.position, building));
  const windowsByKey = new Map(matchingWindows.map((window) => [`${window.position.x}:${window.position.y}`, window]));
  const wallSegments: { key: string; position: [number, number, number]; size: [number, number, number]; rotation: number; window?: WindowView; door?: DoorView }[] = [];
  for (let x = building.x; x < maxX; x++) {
    wallSegments.push({ key: `n${x}`, position: [x + 0.5, height / 2, building.y], size: [1.04, height, 0.13], rotation: 0, window: windowsByKey.get(`${x}:${building.y}`), door: doorsByKey.get(`${x}:${building.y}`) });
    wallSegments.push({ key: `s${x}`, position: [x + 0.5, height / 2, maxY], size: [1.04, height, 0.13], rotation: Math.PI, window: windowsByKey.get(`${x}:${maxY - 1}`), door: doorsByKey.get(`${x}:${maxY - 1}`) });
  }
  for (let y = building.y; y < maxY; y++) {
    wallSegments.push({ key: `w${y}`, position: [building.x, height / 2, y + 0.5], size: [0.13, height, 1.04], rotation: Math.PI / 2, window: windowsByKey.get(`${building.x}:${y}`), door: doorsByKey.get(`${building.x}:${y}`) });
    wallSegments.push({ key: `e${y}`, position: [maxX, height / 2, y + 0.5], size: [0.13, height, 1.04], rotation: -Math.PI / 2, window: windowsByKey.get(`${maxX - 1}:${y}`), door: doorsByKey.get(`${maxX - 1}:${y}`) });
  }
  return (
    <group>
      <mesh position={[building.x + building.width / 2, 0.035, building.y + building.height / 2]} receiveShadow>
        <boxGeometry args={[Math.max(0.2, building.width - 0.18), 0.07, Math.max(0.2, building.height - 0.18)]} />
        <meshStandardMaterial color={building.kind === "keep" ? "#666763" : "#765b42"} roughness={0.96} />
      </mesh>
      <group userData={{ occluder: true }}>
        {building.kind === "house" && <InstancedHousePlinths segments={wallSegments.filter((wall) => !wall.door)} />}
        {building.kind === "house" && <InstancedHouseWalls segments={wallSegments.filter((wall) => !wall.door && !wall.window)} />}
        {wallSegments.map((wall) => (
          wall.door
            ? building.kind === "house"
              ? <HouseDoorway key={wall.key} position={wall.position} size={wall.size} wallRotation={wall.rotation} layout={createHouseDoorwayLayout(height, Math.max(wall.size[0], wall.size[2]))} open={wall.door.open} onClick={() => input.toggleDoor(wall.door!.id, wall.door!.position)} />
              : <MedievalDoorWall key={wall.key} position={wall.position} size={wall.size} keep openingHeight={Math.min(height - 0.15, DOOR_HEIGHT) + 0.1} />
            : wall.window && building.kind === "house"
            ? <HouseWindowOpening key={wall.key} position={wall.position} size={wall.size} wallRotation={wall.rotation} layout={createHouseWindowLayout(height, Math.max(wall.size[0], wall.size[2]))} open={wall.window.open} onClick={() => input.toggleWindow(wall.window!.id, wall.window!.position)} />
            : building.kind === "house" ? null : <MedievalWall key={wall.key} position={wall.position} size={wall.size} keep />
        ))}
        <HangingSign building={building} wallHeight={height} />
        {building.kind !== "house" && matchingDoors.map((door) => <Door key={door.id} door={door} building={building} input={input} tall={height} showBeacon={false} />)}
        {building.kind !== "house" && matchingWindows.map((window) => <ShutterWindow key={window.id} window={window} building={building} wallHeight={height} onClick={() => input.toggleWindow(window.id, window.position)} />)}
        {building.kind === "keep" && <Battlements building={building} height={height} />}
      </group>
      {matchingDoors.map((door) => <DoorBeacon key={`beacon-${door.id}`} door={door} building={building} onOpen={() => input.toggleDoor(door.id, door.position)} />)}
    </group>
  );
});

function buildingWallHeight(building: BuildingView) {
  return building.kind === "keep" ? CASTLE_HEIGHT : WALL_HEIGHT;
}

function ConnectedWalls({ positions, castle }: { positions: readonly Position[]; castle: boolean }) {
  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;
  const castleTexture = useWorldTexture("/assets/world/aldoria-castle-stone-v2.png", 1.35, 1.35);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const instances = useMemo(() => {
    if (positions.length === 0) return [];
    const set = new Set(positions.map(tileKey));
    const thickness = castle ? 0.28 : 0.18;
    const centerSize = castle ? 0.3 : 0.24;
    const connectorLength = Math.max(0.1, 1 - centerSize);
    const next: { position: [number, number, number]; scale: [number, number, number] }[] = [];

    for (const tile of positions) {
      const x = tile.x + 0.5;
      const z = tile.y + 0.5;
      next.push({
        position: [x, height / 2, z],
        scale: [centerSize, height, centerSize],
      });

      // Emit each connection once. The old merged geometry emitted both
      // directions for every neighboring pair, allocating overlapping boxes.
      if (set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)) {
        next.push({
          position: [x + 0.5, height / 2, z],
          scale: [connectorLength, height, thickness],
        });
      }
      if (set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)) {
        next.push({
          position: [x, height / 2, z + 0.5],
          scale: [thickness, height, connectorLength],
        });
      }
      if (castle) {
        next.push({
          position: [x, height + 0.18, z],
          scale: [0.25, 0.36, 0.25],
        });
      }
    }
    return next;
  }, [castle, height, positions]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    const translation = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    instances.forEach((instance, index) => {
      translation.set(...instance.position);
      scale.set(...instance.scale);
      matrix.compose(translation, rotation, scale);
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [instances]);

  if (instances.length === 0) return null;
  return <instancedMesh
    ref={mesh}
    args={[undefined, undefined, instances.length]}
    castShadow
    receiveShadow
    userData={{ occluder: true }}
  >
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial
      map={castle ? castleTexture : undefined}
      color={castle ? "#d0d0c5" : "#aa987c"}
      roughness={0.98}
    />
  </instancedMesh>;
}

function Battlements({ building, height }: { building: BuildingView; height: number }) {
  const points: [number, number, number][] = [];
  for (let x = building.x; x <= building.x + building.width; x += 0.65) {
    points.push([x, height + 0.24, building.y], [x, height + 0.24, building.y + building.height]);
  }
  for (let y = building.y + 0.65; y < building.y + building.height; y += 0.65) {
    points.push([building.x, height + 0.24, y], [building.x + building.width, height + 0.24, y]);
  }
  return <>{points.map((point, index) => <mesh key={index} position={point} castShadow><boxGeometry args={[0.34, 0.48, 0.34]} /><meshStandardMaterial color="#87908c" roughness={0.96} /></mesh>)}</>;
}

function DoorBeacon({ door, building, onOpen }: { door: DoorView; building?: BuildingView; onOpen: () => void }) {
  const transform = doorTransform(door, building);
  return (
    <group
      position={[transform.x, 0, transform.z]}
      onPointerDown={(event) => { event.stopPropagation(); onOpen(); }}
      userData={{ doorBeacon: true }}
    >
      <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={16}>
        <ringGeometry args={[0.39, 0.52, 28]} />
        <meshBasicMaterial color={door.open ? "#8ee0b0" : "#f2c45d"} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.74, 0]} rotation={[0, Math.PI / 4, Math.PI / 4]} renderOrder={17}>
        <octahedronGeometry args={[0.13]} />
        <meshStandardMaterial color={door.open ? "#b5f0ca" : "#ffe08a"} emissive={door.open ? "#2f9b5b" : "#bd7424"} emissiveIntensity={1.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Door({ door, input, building, tall = WALL_HEIGHT, showBeacon = true }: { door: DoorView; input: InputController; building?: BuildingView; tall?: number; showBeacon?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const transform = doorTransform(door, building);
  const leafHeight = Math.min(tall - 0.15, DOOR_HEIGHT);
  const leafWidth = 0.98;
  const hingeX = -leafWidth / 2;
  useFrame((_, delta) => {
    if (!group.current) return;
    const target = door.open ? transform.openAngle : 0;
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, target, 12, delta);
  });
  return (
    <>
    <group position={[transform.x, 0, transform.z]} rotation={[0, transform.rotation, 0]} onPointerDown={(event) => { event.stopPropagation(); input.toggleDoor(door.id, door.position); }}>
      <>
        <mesh position={[-0.49, leafHeight / 2, 0]} castShadow><boxGeometry args={[0.1, leafHeight + 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
        <mesh position={[0.49, leafHeight / 2, 0]} castShadow><boxGeometry args={[0.1, leafHeight + 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
        <mesh position={[0, leafHeight + 0.04, 0]} castShadow><boxGeometry args={[1.08, 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
      </>
      <group ref={group} position={[hingeX, 0, 0]}>
        <mesh position={[leafWidth / 2, leafHeight / 2, 0]} castShadow>
          <boxGeometry args={[leafWidth, leafHeight, 0.09]} />
          <meshStandardMaterial color="#654128" roughness={0.8} />
        </mesh>
        <mesh position={[leafWidth * 0.84, leafHeight * 0.52, 0.07]}><sphereGeometry args={[0.045, 10, 8]} /><meshStandardMaterial color="#d6aa54" metalness={0.65} /></mesh>
      </group>
    </group>
    {showBeacon && <DoorBeacon door={door} building={building} onOpen={() => input.toggleDoor(door.id, door.position)} />}
    </>
  );
}

const TREE_OCCLUSION_BUCKET_SIZE = 6;

function InstancedTrees({ positions, variant = "forest" }: { positions: readonly Position[]; variant?: "forest" | "pine" | "snowy" }) {
  const batches = useMemo(() => {
    const grouped = new Map<string, Position[]>();
    for (const position of positions) {
      const key = `${Math.floor(position.x / TREE_OCCLUSION_BUCKET_SIZE)}:${Math.floor(position.y / TREE_OCCLUSION_BUCKET_SIZE)}:${position.z}`;
      const batch = grouped.get(key);
      if (batch) batch.push(position);
      else grouped.set(key, [position]);
    }
    return [...grouped.entries()];
  }, [positions]);
  return <group>{batches.map(([key, batch]) => (
    <InstancedTreeBatch key={key} positions={batch} variant={variant} />
  ))}</group>;
}

function InstancedTreeBatch({ positions, variant }: { positions: readonly Position[]; variant: "forest" | "pine" | "snowy" }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const lowerCanopies = useRef<THREE.InstancedMesh>(null);
  const upperCanopies = useRef<THREE.InstancedMesh>(null);
  const pine = variant !== "forest";
  const snowy = variant === "snowy";
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4(); const quaternion = new THREE.Quaternion(); const location = new THREE.Vector3(); const scale = pine ? new THREE.Vector3(1.04, 1.18, 1.04) : new THREE.Vector3(1.18, 1.22, 1.18);
    positions.forEach((position, index) => {
      location.set(position.x + 0.5, 0, position.y + 0.5);
      quaternion.setFromEuler(new THREE.Euler(0, stablePhase(tileKey(position)), 0));
      for (const [mesh, y] of [[trunks.current, 0.72], [lowerCanopies.current, 1.75], [upperCanopies.current, 2.35]] as const) {
        if (!mesh) continue;
        location.y = y;
        matrix.compose(location, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
    [trunks.current, lowerCanopies.current, upperCanopies.current].forEach((mesh) => mesh?.computeBoundingSphere());
  }, [pine, positions]);
  if (!positions.length) return null;
  // Occlusion operates on a small spatial batch. This keeps tree rendering
  // instanced without fading every tree in the streamed region at once.
  return <group userData={{ occluder: true }}>
    <instancedMesh ref={trunks} args={[undefined, undefined, positions.length]} castShadow receiveShadow><cylinderGeometry args={[0.14, 0.2, 1.45, 8]} /><meshStandardMaterial color="#604128" roughness={1} transparent={false} opacity={1} /></instancedMesh>
    <instancedMesh ref={lowerCanopies} args={[undefined, undefined, positions.length]} castShadow><coneGeometry args={[pine ? 0.72 : 0.82, pine ? 1.9 : 1.75, pine ? 7 : 9]} /><meshStandardMaterial color={snowy ? "#c5dadd" : pine ? "#285744" : "#315c38"} roughness={0.95} transparent={false} opacity={1} /></instancedMesh>
    <instancedMesh ref={upperCanopies} args={[undefined, undefined, positions.length]} castShadow><coneGeometry args={[pine ? 0.52 : 0.61, pine ? 1.5 : 1.35, pine ? 7 : 9]} /><meshStandardMaterial color={snowy ? "#e0ebea" : pine ? "#346a50" : "#3b7043"} roughness={0.95} transparent={false} opacity={1} /></instancedMesh>
  </group>;
}

function InstancedMountainWalls({ positions }: { positions: readonly Position[] }) {
  const bases = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x + 0.5, 0.78, position.y + 0.5);
      bases.current?.setMatrixAt(index, matrix);
      matrix.makeTranslation(position.x + 0.32, 1.62, position.y + 0.55);
      caps.current?.setMatrixAt(index, matrix);
    });
    for (const mesh of [bases.current, caps.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [positions]);
  if (!positions.length) return null;
  return <group>
    <instancedMesh ref={bases} args={[undefined, undefined, positions.length]} castShadow receiveShadow><boxGeometry args={[1, 1.56, 0.9]} /><meshStandardMaterial color="#59615d" roughness={0.98} /></instancedMesh>
    <instancedMesh ref={caps} args={[undefined, undefined, positions.length]} castShadow><dodecahedronGeometry args={[0.53, 0]} /><meshStandardMaterial color="#778078" roughness={0.98} /></instancedMesh>
  </group>;
}

function InstancedSimpleObjects({ positions, kind }: { positions: readonly Position[]; kind: "snow-bank" | "barrel" }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x + 0.5, kind === "barrel" ? 0.28 : 0.22, position.y + 0.5);
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [kind, positions]);
  if (!positions.length) return null;
  return <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]} castShadow receiveShadow>
    {kind === "barrel" ? <cylinderGeometry args={[0.24, 0.28, 0.56, 10]} /> : <dodecahedronGeometry args={[0.55, 1]} />}
    <meshStandardMaterial color={kind === "barrel" ? "#9b5d2c" : "#c9dcdf"} roughness={kind === "barrel" ? 0.85 : 1} />
  </instancedMesh>;
}

function InstancedTorches({ positions }: { positions: readonly Position[] }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const flames = useRef<THREE.InstancedMesh>(null);
  const flameMaterial = useRef<THREE.MeshStandardMaterial>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4(); const location = new THREE.Vector3(); const scale = new THREE.Vector3(1.15, 1.15, 1.15);
    positions.forEach((position, index) => {
      for (const [mesh, y] of [[posts.current, 0.62], [flames.current, 1.31]] as const) {
        if (!mesh) continue;
        location.set(position.x + 0.5, y, position.y + 0.5);
        matrix.compose(location, new THREE.Quaternion(), scale);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
    [posts.current, flames.current].forEach((mesh) => mesh?.computeBoundingSphere());
  }, [positions]);
  useFrame(({ clock }) => {
    if (flameMaterial.current) flameMaterial.current.emissiveIntensity = 2.8 + Math.sin(clock.elapsedTime * 9) * 0.25;
  });
  if (!positions.length) return null;
  return <>
    <instancedMesh ref={posts} args={[undefined, undefined, positions.length]} castShadow><cylinderGeometry args={[0.035, 0.055, 1.24, 7]} /><meshStandardMaterial color="#49301f" /></instancedMesh>
    <instancedMesh ref={flames} args={[undefined, undefined, positions.length]}><coneGeometry args={[0.13, 0.38, 9]} /><meshStandardMaterial ref={flameMaterial} color="#ff8b32" emissive="#ff4d10" emissiveIntensity={3} toneMapped={false} /></instancedMesh>
  </>;
}

type ActorClick = (event: ThreeEvent<MouseEvent>) => void;

type PlayerActorProps = { player: PlayerView; local: boolean; visualPosition?: MutableRefObject<THREE.Vector3>; correctionRevision: number; groundY: number; selected: boolean; onClick: ActorClick; onContextMenu: ActorClick };

const PlayerActor = memo(function PlayerActor({ player, local, visualPosition, correctionRevision, groundY, selected, onClick, onContextMenu }: PlayerActorProps) {
  const kind: CharacterKind = player.outfit;
  const moving = useRef(false);
  return (
    <SmoothActor id={player.id} position={player.position} groundY={groundY} visualPosition={visualPosition} moving={moving} correctionRevision={correctionRevision}>
      <group onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}>
        <SelectionRing active={selected || local} color={local ? "#65b9e8" : "#e2be65"} />
        <Suspense fallback={null}><AnimatedCharacter kind={kind} position={player.position} moving={moving} /></Suspense>
      </group>
    </SmoothActor>
  );
}, actorPropsEqual);

type NpcActorProps = { npc: NpcView; groundY: number; playerPosition: MutableRefObject<THREE.Vector3>; onClick: ActorClick; onContextMenu: ActorClick };

const NpcActor = memo(function NpcActor({ npc, groundY, playerPosition, onClick, onContextMenu }: NpcActorProps) {
  const kind: CharacterKind = npc.service === "spell_trainer" ? "mage" : npc.service === "depot" ? "knight" : "rogue";
  const moving = useRef(false);
  const presence = useRef<THREE.Group>(null);
  const nearby = useRef(false);
  const nextCallAt = useRef(Number.POSITIVE_INFINITY);
  const hideCallAt = useRef(0);
  const callIndex = useRef(Math.floor(stablePhase(npc.id) * 10));
  const [callout, setCallout] = useState<string | null>(null);
  const calls = npcCalls(npc);
  const homeFacing = stablePhase(npc.id);
  useFrame(({ clock }, delta) => {
    const player = playerPosition.current;
    const hasPlayer = Number.isFinite(player.x) && Number.isFinite(player.z);
    const dx = hasPlayer ? player.x - npc.position.x - 0.5 : 0;
    const dz = hasPlayer ? player.z - npc.position.y - 0.5 : 0;
    const isNearby = hasPlayer && dx * dx + dz * dz <= 25;
    const desired = isNearby ? Math.atan2(dx, dz) : homeFacing;
    if (presence.current) {
      const turn = Math.atan2(Math.sin(desired - presence.current.rotation.y), Math.cos(desired - presence.current.rotation.y));
      presence.current.rotation.y += turn * (1 - Math.exp(-delta * (isNearby ? 7 : 2)));
    }
    if (isNearby && !nearby.current) nextCallAt.current = clock.elapsedTime + 0.45;
    if (!isNearby && nearby.current) {
      nextCallAt.current = Number.POSITIVE_INFINITY;
      hideCallAt.current = 0;
      setCallout(null);
    }
    nearby.current = isNearby;
    if (isNearby && clock.elapsedTime >= nextCallAt.current) {
      const message = calls[callIndex.current % calls.length];
      callIndex.current += 1;
      setCallout(message);
      hideCallAt.current = clock.elapsedTime + 3.6;
      nextCallAt.current = clock.elapsedTime + 15 + stablePhase(`${npc.id}-${callIndex.current}`) / (Math.PI * 2) * 8;
    } else if (callout && clock.elapsedTime >= hideCallAt.current) {
      hideCallAt.current = 0;
      setCallout(null);
    }
  });
  return <SmoothActor id={npc.id} position={npc.position} groundY={groundY} moving={moving}><group onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}><SelectionRing active color="#d6b65e" /><group ref={presence} rotation={[0, homeFacing, 0]}><Suspense fallback={null}><AnimatedCharacter kind={kind} position={npc.position} moving={moving} /></Suspense></group><mesh position={[0, 2.55, 0]}><octahedronGeometry args={[0.11]} /><meshStandardMaterial color="#e7c45f" emissive="#b17f23" emissiveIntensity={1.3} /></mesh>{callout && <SpeechBubble text={callout} />}</group></SmoothActor>;
}, (previous, next) => previous.npc === next.npc && previous.groundY === next.groundY && previous.playerPosition === next.playerPosition);

type CreatureActorProps = { creature: CreatureView; groundY: number; selected: boolean; onClick: ActorClick; onContextMenu: ActorClick };

const CreatureActor = memo(function CreatureActor({ creature, groundY, selected, onClick, onContextMenu }: CreatureActorProps) {
  const moving = useRef(false);
  const motion = useRef<ActorMotionState>(createActorMotionState());
  return (
    <SmoothActor id={creature.id} position={creature.position} groundY={groundY} moving={moving} motion={motion}>
      <group onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}>
        <SelectionRing active={selected} color="#dc594c" />
        <TargetMarker active={selected} />
        {creature.definitionId === "castle_rat"
          ? <Suspense fallback={null}>
              <CastleRatSprite motion={motion} state={creature.state} health={creature.health} immune={creature.immune} />
            </Suspense>
          : <CreatureModel definitionId={creature.definitionId} immune={creature.immune} moving={moving} />}
      </group>
    </SmoothActor>
  );
}, (previous, next) => previous.creature === next.creature && previous.groundY === next.groundY && previous.selected === next.selected);

function SpeechBubble({ text, positionY = 3.08, wrapped = false }: { text: string; positionY?: number; wrapped?: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = wrapped ? 768 : 512; canvas.height = wrapped ? 256 : 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(12, 17, 14, .92)";
    context.strokeStyle = "rgba(220, 183, 103, .9)"; context.lineWidth = 5;
    const width = canvas.width;
    const bodyBottom = wrapped ? 210 : 98;
    context.beginPath(); context.roundRect(5, 5, width - 10, bodyBottom, 20); context.fill(); context.stroke();
    context.beginPath(); context.moveTo(width / 2 - 21, bodyBottom + 4); context.lineTo(width / 2, canvas.height - 4); context.lineTo(width / 2 + 21, bodyBottom + 4); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = "#f5e4bc"; context.font = `600 ${wrapped ? 25 : 25}px Inter, sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    if (wrapped) {
      const words = text.split(/\s+/); const lines: string[] = []; let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= width - 70) line = candidate;
        else { if (line) lines.push(line); line = word; }
      }
      if (line) lines.push(line);
      const shown = lines.slice(0, 4);
      shown.forEach((entry, index) => context.fillText(entry, width / 2, 48 + index * 42, width - 70));
    } else context.fillText(text, width / 2, 55, width - 52);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true; return result;
  }, [text, wrapped]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[0, positionY, 0]} scale={wrapped ? [4.6, 1.55, 1] : [2.8, 0.7, 1]} renderOrder={20}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite>;
}

function npcCalls(npc: NpcView) {
  if (npc.service === "shop") return [`Welcome, traveler!`, `Supplies for the road!`, `Take a look at my wares.`];
  if (npc.service === "depot") return [`Your belongings are safe here.`, `Travel light, traveler.`, `The vaults stand ready.`];
  if (npc.service === "spell_trainer") return [`Knowledge rewards the patient.`, `Come, sharpen your mind.`, `Magic takes discipline.`];
  return [`Good day, traveler.`, `Stay safe beyond the walls.`, `Have you heard the latest news?`];
}

function actorPropsEqual(previous: PlayerActorProps, next: PlayerActorProps) {
  return previous.player === next.player
    && previous.local === next.local
    && previous.visualPosition === next.visualPosition
    && previous.correctionRevision === next.correctionRevision
    && previous.groundY === next.groundY
    && previous.selected === next.selected;
}

function SmoothActor({ id, position, groundY = GROUND_ACTOR_Y, visualPosition, moving, motion, correctionRevision = 0, children }: { id: string; position: Position; groundY?: number; visualPosition?: MutableRefObject<THREE.Vector3>; moving?: MutableRefObject<boolean>; motion?: MutableRefObject<ActorMotionState>; correctionRevision?: number; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3(tileCenter(position.x), groundY, tileCenter(position.y)));
  const segmentStart = useRef(current.current.clone());
  const segmentTarget = useRef(current.current.clone());
  const segmentStartedAt = useRef(performance.now());
  const segmentDurationMs = useRef(170);
  const lastTargetAt = useRef(performance.now());
  const lastCorrectionRevision = useRef(correctionRevision);
  const previousVisualPosition = useRef(current.current.clone());
  const target = useMemo(() => new THREE.Vector3(tileCenter(position.x), groundY, tileCenter(position.y)), [position.x, position.y, groundY]);
  useLayoutEffect(() => {
    if (target.equals(segmentTarget.current)) return;
    const now = performance.now();
    const dx = target.x - segmentTarget.current.x;
    const dz = target.z - segmentTarget.current.z;
    const distance = current.current.distanceTo(target);
    const correcting = correctionRevision !== lastCorrectionRevision.current;
    lastCorrectionRevision.current = correctionRevision;
    if (!correcting && Math.abs(dx) + Math.abs(dz) > 0.01 && group.current) group.current.rotation.y = Math.atan2(dx, dz);
    if (distance > 3) {
      current.current.copy(target);
      previousVisualPosition.current.copy(target);
      segmentStart.current.copy(target);
      segmentTarget.current.copy(target);
      if (group.current) group.current.position.copy(target);
      visualPosition?.current.copy(target);
      if (moving) moving.current = false;
    } else {
      segmentStart.current.copy(current.current);
      segmentTarget.current.copy(target);
      segmentStartedAt.current = now;
      segmentDurationMs.current = actorSegmentDuration(now - lastTargetAt.current);
    }
    lastTargetAt.current = now;
  }, [target, visualPosition, correctionRevision]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const progress = THREE.MathUtils.clamp((performance.now() - segmentStartedAt.current) / segmentDurationMs.current, 0, 1);
    current.current.lerpVectors(segmentStart.current, segmentTarget.current, progress);
    const visualDx = current.current.x - previousVisualPosition.current.x;
    const visualDz = current.current.z - previousVisualPosition.current.z;
    if (motion) sampleActorMotion(motion.current, visualDx, visualDz, delta);
    previousVisualPosition.current.copy(current.current);
    group.current.position.copy(current.current);
    visualPosition?.current.copy(current.current);
    if (moving) moving.current = motion ? motion.current.moving : progress < 1;
  }, -1);
  return <group ref={group} name={id} position={current.current}>{children}</group>;
}

export function actorSegmentDuration(updateIntervalMs: number) {
  const cadence = updateIntervalMs >= 70 && updateIntervalMs <= 600 ? updateIntervalMs : CLIENT_STEP_MS;
  // Keep a small visual buffer beyond the expected logical update. Finishing
  // early made the actor stop for a few milliseconds on every tile, and a
  // delayed browser timer made that pause much more visible. The overlap is
  // deliberately small enough that collision still appears aligned.
  return THREE.MathUtils.clamp(Math.max(185, cadence * 1.08), 185, 650);
}

function SelectionRing({ active, color }: { active: boolean; color: string }) {
  if (!active) return null;
  return <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}><ringGeometry args={[0.36, 0.48, 32]} /><meshBasicMaterial color={color} transparent opacity={0.82} depthTest depthWrite={false} /></mesh>;
}

function TargetMarker({ active }: { active: boolean }) {
  const marker = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame(({ clock }) => {
    if (!marker.current) return;
    marker.current.position.y = 2.18 + Math.sin(clock.elapsedTime * 4.5 + phase.current) * 0.09;
    marker.current.rotation.y = clock.elapsedTime * 1.8;
  });
  if (!active) return null;
  return <group ref={marker} position={[0, 2.18, 0]} renderOrder={15}>
    <mesh rotation={[0, 0, Math.PI]}><coneGeometry args={[0.18, 0.38, 4]} /><meshBasicMaterial color="#ff5148" depthTest={false} depthWrite={false} /></mesh>
  </group>;
}

function CombatImpact({ effect, localPlayerId }: { effect: CombatEffectView; localPlayerId: string | null }) {
  const root = useRef<THREE.Group>(null);
  const burst = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const outgoing = effect.sourceId === localPlayerId;
  const incoming = effect.targetId === localPlayerId;
  const color = incoming ? "#ff4e46" : outgoing ? "#ffd268" : "#f18a56";
  const texture = useMemo(() => damageTexture(effect.damage, color), [color, effect.damage]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const age = performance.now() - effect.createdAt;
    const progress = THREE.MathUtils.clamp(age / 850, 0, 1);
    if (root.current) { root.current.visible = age < 850; root.current.position.y = 0.35 + progress * 1.25; }
    if (burst.current) burst.current.scale.setScalar(0.25 + progress * 1.1);
    const burstMaterial = burst.current?.material as THREE.MeshBasicMaterial | undefined;
    if (burstMaterial) burstMaterial.opacity = Math.max(0, 0.8 - progress);
    const ringMaterial = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (ringMaterial) ringMaterial.opacity = Math.max(0, 0.72 - progress);
    if (ring.current) ring.current.scale.setScalar(0.55 + progress * 1.3);
  });
  return <group position={[effect.position.x + 0.5, 0.35, effect.position.y + 0.5]}>
    <mesh ref={ring} position={[0, -0.29, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={16}><ringGeometry args={[0.24, 0.34, 20]} /><meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} /></mesh>
    <mesh ref={burst} position={[0, 0.38, 0]} renderOrder={16}><icosahedronGeometry args={[0.22, 0]} /><meshBasicMaterial color={color} transparent opacity={0.8} depthTest={false} depthWrite={false} wireframe /></mesh>
    <group ref={root}><sprite scale={[0.82, 0.38, 1]} renderOrder={18}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite></group>
  </group>;
}

function damageTexture(damage: number, color: string) {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 112;
  const context = canvas.getContext("2d")!;
  context.font = "900 66px Inter, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.lineWidth = 12; context.strokeStyle = "rgba(12, 8, 7, .95)"; context.strokeText(`-${damage}`, 128, 55);
  context.fillStyle = color; context.fillText(`-${damage}`, 128, 55);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

function GroundItemActor({ position, corpse, lootable, label, onHover, onClick, onContextMenu }: { position: Position; corpse: boolean; lootable: boolean; label: string; onHover: (hover: { label: string; x: number; y: number } | null) => void; onClick: ActorClick; onContextMenu: ActorClick }) {
  const lootBeacon = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => () => {
    document.body.style.cursor = "";
    onHover(null);
  }, [onHover]);
  useFrame(({ clock }) => {
    if (!lootBeacon.current || !lootable) return;
    lootBeacon.current.position.y = 0.64 + Math.sin(clock.elapsedTime * 3.2 + position.x + position.y) * 0.08;
    lootBeacon.current.rotation.y = clock.elapsedTime * 1.4;
  });
  return (
    <group position={[position.x + 0.5, 0.12, position.y + 0.5]} onPointerDown={(event) => event.stopPropagation()} onPointerOver={(event) => { event.stopPropagation(); if (!lootable) return; setHovered(true); document.body.style.cursor = "pointer"; onHover({ label, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }); }} onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; onHover(null); }} onClick={(event) => { document.body.style.cursor = ""; onHover(null); onClick(event); }} onContextMenu={onContextMenu}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow scale={hovered ? 1.16 : 1}>
        {corpse ? <circleGeometry args={[0.34, 14]} /> : <octahedronGeometry args={[0.18]} />}
        <meshStandardMaterial color={corpse ? "#6d3029" : "#d3a84f"} roughness={0.8} />
      </mesh>
      {lootable && <>
        <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={17}>
          <ringGeometry args={[0.39, 0.47, 28]} />
          <meshBasicMaterial color={hovered ? "#fff1a8" : "#f0bc55"} transparent opacity={hovered ? 0.95 : 0.72} depthWrite={false} />
        </mesh>
        <group ref={lootBeacon} position={[0, 0.64, 0]} renderOrder={18}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[0.105]} />
            <meshStandardMaterial color="#ffd879" emissive="#d98a25" emissiveIntensity={2.4} roughness={0.35} depthWrite={false} />
          </mesh>
        </group>
      </>}
    </group>
  );
}

function ResourceNodeActor({ node, onHover, onClick, onContextMenu }: { node: ResourceNodeView; onHover: (hover: { label: string; x: number; y: number } | null) => void; onClick: ActorClick; onContextMenu: ActorClick }) {
  const [hovered, setHovered] = useState(false);
  useEffect(() => () => {
    document.body.style.cursor = "";
    onHover(null);
  }, [onHover]);
  const label = node.available ? `Copper vein · Mining ${node.requiredSkillLevel}` : "Depleted copper vein";
  return (
    <group
      position={[node.position.x + 0.5, node.available ? 0.25 : 0.1, node.position.y + 0.5]}
      scale={hovered ? 1.08 : 1}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; onHover({ label, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }); }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; onHover(null); }}
      onClick={(event) => { document.body.style.cursor = ""; onHover(null); onClick(event); }}
      onContextMenu={onContextMenu}
    >
      <mesh castShadow rotation={[0.08, 0.35, -0.12]} scale={node.available ? [0.72, 0.62, 0.68] : [0.68, 0.16, 0.62]}>
        <dodecahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color={node.available ? (hovered ? "#d98d55" : "#956342") : "#51473e"} roughness={0.88} emissive={hovered && node.available ? "#5d2413" : "#000000"} emissiveIntensity={0.65} />
      </mesh>
      {node.available && <mesh position={[0.12, 0.18, 0.24]} rotation={[-0.4, 0.2, 0.4]}>
        <octahedronGeometry args={[0.14]} />
        <meshStandardMaterial color="#e09554" metalness={0.42} roughness={0.48} />
      </mesh>}
      {hovered && <mesh position={[0, -0.19, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={17}>
        <ringGeometry args={[0.44, 0.51, 28]} />
        <meshBasicMaterial color={node.available ? "#f0a15e" : "#918276"} transparent opacity={0.82} depthWrite={false} />
      </mesh>}
    </group>
  );
}

function FollowCamera({ target, visualTarget, mapWidth, mapHeight }: { target?: Position; visualTarget: MutableRefObject<THREE.Vector3>; mapWidth: number; mapHeight: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const rendered = visualTarget.current;
    const hasRenderedTarget = Number.isFinite(rendered.x) && Number.isFinite(rendered.z);
    const x = hasRenderedTarget ? rendered.x : tileCenter(target?.x ?? mapWidth / 2);
    const z = hasRenderedTarget ? rendered.z : tileCenter(target?.y ?? mapHeight / 2);
    camera.position.set(x, CAMERA_HEIGHT * WORLD_TILE_SIZE, z + CAMERA_TOPDOWN_OFFSET * WORLD_TILE_SIZE);
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
  });
  return null;
}

function OcclusionController({ target, visualTarget, sceneRevision }: { target?: Position; visualTarget: MutableRefObject<THREE.Vector3>; sceneRevision: MapView }) {
  const { camera, scene } = useThree();
  const ray = useMemo(() => new THREE.Ray(), []);
  // TIBIAGAME_STREAMING_FIX_V5
  // Visibility toggling avoids changing material shader defines at runtime.
  const hiddenOccluders = useRef(new Map<THREE.Object3D, boolean>());
  const lastCheckAt = useRef(0);
  const lastCheckedTarget = useMemo(() => new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN), []);
  const targetPoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  const nextHiddenOccluders = useMemo(() => new Set<THREE.Object3D>(), []);
  const occluders = useRef<OccluderIndex>({ all: [], buckets: new Map() });
  useEffect(() => {
    // TIBIAGAME_STREAMING_FIX_V4
    // Building Box3 bounds for a whole streamed scene inside useLayoutEffect
    // blocked paint and produced large max-ms spikes. Build the replacement
    // index in small frame-budgeted slices instead.
    let cancelled = false;
    let frame: number | null = null;
    let workMs = 0;
    const roots: THREE.Object3D[] = [];

    const visit = (node: THREE.Object3D) => {
      if (node.userData.occluder) {
        roots.push(node);
        return;
      }
      node.children.forEach(visit);
    };
    scene.children.forEach(visit);

    const indexed: OccluderBounds[] = [];
    let cursor = 0;
    const step = () => {
      if (cancelled) return;
      const sliceStarted = performance.now();

      while (cursor < roots.length && performance.now() - sliceStarted < 2.5) {
        const root = roots[cursor++];
        const bounds = new THREE.Box3().setFromObject(root);
        if (!bounds.isEmpty()) indexed.push({ root, bounds });

        // TIBIAGAME_STREAMING_FIX_V5
        // Do not mutate transparent/needsUpdate here. That mutation changes
        // WebGL shader defines and can block a later frame during compilation.
      }

      workMs += performance.now() - sliceStarted;
      if (cursor < roots.length) {
        frame = window.requestAnimationFrame(step);
        return;
      }

      occluders.current = indexOccluderBounds(indexed);
      lastCheckedTarget.set(Number.NaN, Number.NaN, Number.NaN);
      if (workMs > 6) {
        console.info(
          `occlusion index work: ${workMs.toFixed(1)}ms across frames · ${indexed.length} roots`,
        );
      }
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [scene, sceneRevision]);
  useFrame(({ clock }) => {
    if (!target || clock.elapsedTime - lastCheckAt.current < 0.15) return;
    const rendered = visualTarget.current;
    const x = Number.isFinite(rendered.x) ? rendered.x : target.x + 0.5;
    const z = Number.isFinite(rendered.z) ? rendered.z : target.y + 0.5;
    targetPoint.set(x, 1.05, z);
    // Camera and target are fixed while idle, so repeating the same broad
    // raycast only steals time from rendering.
    if (Number.isFinite(lastCheckedTarget.x) && lastCheckedTarget.distanceToSquared(targetPoint) < 0.0064) return;
    lastCheckAt.current = clock.elapsedTime;
    lastCheckedTarget.copy(targetPoint);

    const roots = new Set<THREE.Object3D>();
    direction.copy(targetPoint).sub(camera.position);
    const targetDistance = Math.max(0, direction.length() - 0.35);
    ray.set(camera.position, direction.normalize());
    for (const { root, bounds } of nearbyOccluders(occluders.current, targetPoint)) {
      const hit = ray.intersectBox(bounds, intersection);
      if (hit && hit.distanceTo(camera.position) < targetDistance) roots.add(root);
    }
    nextHiddenOccluders.clear();
    for (const root of roots) {
      nextHiddenOccluders.add(root);
      if (!hiddenOccluders.current.has(root)) {
        hiddenOccluders.current.set(root, root.visible);
        root.visible = false;
      }
    }
    for (const [root, originalVisible] of hiddenOccluders.current) {
      if (nextHiddenOccluders.has(root)) continue;
      root.visible = originalVisible;
      hiddenOccluders.current.delete(root);
    }
  });
  useEffect(() => () => {
    for (const [root, originalVisible] of hiddenOccluders.current) {
      root.visible = originalVisible;
    }
    hiddenOccluders.current.clear();
  }, []);
  return null;
}

type OccluderBounds = { root: THREE.Object3D; bounds: THREE.Box3 };
type OccluderIndex = { all: OccluderBounds[]; buckets: Map<string, OccluderBounds[]> };
const OCCLUDER_BUCKET_SIZE = 8;

function indexOccluderBounds(roots: OccluderBounds[]): OccluderIndex {
  const buckets = new Map<string, OccluderBounds[]>();
  for (const entry of roots) {
    const minX = Math.floor(entry.bounds.min.x / OCCLUDER_BUCKET_SIZE);
    const maxX = Math.floor(entry.bounds.max.x / OCCLUDER_BUCKET_SIZE);
    const minZ = Math.floor(entry.bounds.min.z / OCCLUDER_BUCKET_SIZE);
    const maxZ = Math.floor(entry.bounds.max.z / OCCLUDER_BUCKET_SIZE);
    for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
      const key = `${x}:${z}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }
  }
  return { all: roots, buckets };
}

function nearbyOccluders(index: OccluderIndex, target: THREE.Vector3): Set<OccluderBounds> {
  const result = new Set<OccluderBounds>();
  // The camera is nine tiles south of the target. Two tiles of side padding
  // covers wide trees/walls while excluding the rest of the streamed region.
  const minX = Math.floor((target.x - 2) / OCCLUDER_BUCKET_SIZE);
  const maxX = Math.floor((target.x + 2) / OCCLUDER_BUCKET_SIZE);
  const minZ = Math.floor((target.z - 2) / OCCLUDER_BUCKET_SIZE);
  const maxZ = Math.floor((target.z + CAMERA_TOPDOWN_OFFSET + 2) / OCCLUDER_BUCKET_SIZE);
  for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
    for (const entry of index.buckets.get(`${x}:${z}`) ?? []) result.add(entry);
  }
  return result;
}

function Atmosphere({ torches, local, visualTarget, playerLight }: { torches: readonly Position[]; local?: Position; visualTarget: MutableRefObject<THREE.Vector3>; playerLight: PlayerLightProfile }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const activeTorches = useMemo(() => {
    if (!local) return torches.slice(0, 10);
    return [...torches].sort((a, b) => distanceSquared(a, local) - distanceSquared(b, local)).slice(0, 10);
  }, [torches, local?.x, local?.y]);
  useEffect(() => {
    const previousBackground = scene.background;
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x718079, 0.012);
    return () => {
      scene.background = previousBackground;
      scene.fog = null;
    };
  }, [scene]);
  useFrame(() => {
    const daylight = worldEnvironment().daylight;
    if (sun.current) sun.current.intensity = 0.18 + daylight * 2.1;
    if (ambient.current) ambient.current.intensity = 0.22 + daylight * 0.85;
  });
  return (
    <>
      <hemisphereLight ref={ambient} args={["#bfd5cb", "#172019", 0.8]} />
      <directionalLight ref={sun} position={[14, 24, 9]} intensity={1.8} color="#ffe1aa" castShadow shadow-mapSize={[512, 512]} shadow-camera-near={1} shadow-camera-far={70} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} />
      <PlayerLight target={local} visualTarget={visualTarget} profile={playerLight} />
      {activeTorches.map((torch) => <pointLight key={tileKey(torch)} position={[torch.x + 0.5, 1.55, torch.y + 0.5]} color="#ff6a24" intensity={5.4} distance={6.1} decay={2} />)}
    </>
  );
}

function PlayerLight({ target, visualTarget, profile }: { target?: Position; visualTarget: MutableRefObject<THREE.Vector3>; profile: PlayerLightProfile }) {
  const lightRing = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!lightRing.current || !target) return;
    const rendered = visualTarget.current;
    const x = Number.isFinite(rendered.x) ? rendered.x : tileCenter(target.x);
    const z = Number.isFinite(rendered.z) ? rendered.z : tileCenter(target.y);
    lightRing.current.position.set(x, 0, z);
  }, -0.5);
  // A tight ring approximates one circular player-centered light without
  // placing a high-intensity point directly inside the character model.
  const ringRadius = 1.15 * WORLD_TILE_SIZE;
  const lightCount = 8;
  const lightIntensity = profile.intensity * 1.5 / lightCount;
  return (
    <group ref={lightRing}>
      {Array.from({ length: lightCount }, (_, index) => {
        const angle = index / lightCount * Math.PI * 2;
        return <pointLight
          key={index}
          position={[Math.cos(angle) * ringRadius, 0.55, Math.sin(angle) * ringRadius]}
          color="#ffd49a"
          intensity={lightIntensity}
          distance={profile.radius}
          decay={1.65}
        />;
      })}
    </group>
  );
}

function ClientPerformanceMonitor({ label, positionLabel, world }: {
  label: RefObject<HTMLDivElement | null>;
  positionLabel: RefObject<HTMLDivElement | null>;
  world: WorldState;
}) {
  const { gl } = useThree();
  const sample = useRef({ elapsed: 0, frames: 0, totalMs: 0, maxMs: 0, logElapsed: 0, logMaxMs: 0 });
  useFrame((_, delta) => {
    if (document.hidden || delta > 0.5) {
      sample.current = { elapsed: 0, frames: 0, totalMs: 0, maxMs: 0, logElapsed: 0, logMaxMs: 0 };
      return;
    }
    const frameMs = delta * 1_000;
    // TIBIAGAME_STREAMING_FIX_V5
    if (frameMs >= 80) {
      const player = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
      const programs = (gl.info as unknown as { programs?: unknown[] }).programs?.length ?? -1;
      console.warn(
        `LONG FRAME ${frameMs.toFixed(1)}ms · pos ${player ? `${player.position.x}:${player.position.y}:${player.position.z}` : "unknown"} · calls ${gl.info.render.calls} · tris ${gl.info.render.triangles} · programs ${programs} · textures ${gl.info.memory.textures} · geometries ${gl.info.memory.geometries}`,
      );
    }
    const current = sample.current;
    current.elapsed += delta;
    current.frames += 1;
    current.totalMs += frameMs;
    current.maxMs = Math.max(current.maxMs, frameMs);
    current.logMaxMs = Math.max(current.logMaxMs, frameMs);
    current.logElapsed += delta;
    if (current.elapsed < 0.5) return;
    const averageMs = current.totalMs / Math.max(1, current.frames);
    const fps = Math.round(1_000 / averageMs);
    const player = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
    if (positionLabel.current && player) {
      const { x, y, z } = player.position;
      positionLabel.current.textContent = `x ${x} · y ${y} · z ${z}`;
    }
    if (label.current) {
      label.current.textContent = `${fps} FPS · ${current.maxMs.toFixed(0)} ms max · ${gl.info.render.calls} calls`;
      label.current.dataset.level = fps >= 55 && current.maxMs <= 22
        ? "good"
        : fps >= 30 && current.maxMs <= 40
          ? "fair"
          : "poor";
    }
    if (current.logElapsed >= 5) {
      console.info(`client performance sample: avg=${averageMs.toFixed(1)}ms max=${current.logMaxMs.toFixed(1)}ms fps=${fps} calls=${gl.info.render.calls} triangles=${gl.info.render.triangles}`);
      current.logElapsed = 0;
      current.logMaxMs = 0;
    }
    current.elapsed = 0;
    current.frames = 0;
    current.totalMs = 0;
    current.maxMs = 0;
  });
  return null;
}

function Weather({ local, floor }: { local?: Position; floor: number }) {
  const points = useRef<THREE.Points>(null);
  const drops = useMemo(() => {
    const values = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      values[i * 3] = (Math.random() - 0.5) * 22;
      values[i * 3 + 1] = Math.random() * 14;
      values[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    return values;
  }, []);
  useFrame((_, delta) => {
    if (!points.current || floor !== 0) return;
    const rain = worldEnvironment().weather === "rain";
    points.current.visible = rain;
    const attribute = points.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) {
      const next = attribute.getY(i) - delta * 12;
      attribute.setY(i, next < 0 ? 14 : next);
    }
    attribute.needsUpdate = true;
    points.current.position.set(local?.x ?? 0, 0, local?.y ?? 0);
  });
  return <points ref={points} visible={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[drops, 3]} /></bufferGeometry><pointsMaterial color="#b9d7e2" size={0.045} transparent opacity={0.7} depthWrite={false} /></points>;
}

type RenderBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  floor: number;
};

function createRenderRegion(map: MapView, floor: number, chunkX: number, chunkY: number) {
  const minX = Math.max(0, chunkX * RENDER_CHUNK_SIZE - RENDER_PADDING);
  const minY = Math.max(0, chunkY * RENDER_CHUNK_SIZE - RENDER_PADDING);
  const maxX = Math.min(map.width, (chunkX + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING);
  const maxY = Math.min(map.height, (chunkY + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING);
  const bounds: RenderBounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    floor,
  };
  const positions = (entries: readonly Position[]) => entries.filter((entry) => insideRenderBounds(entry, bounds));
  const buildings = map.buildings.filter((building) => building.floor === floor
    && building.x < maxX
    && building.y < maxY
    && building.x + building.width > minX
    && building.y + building.height > minY);
  const belongsToVisibleBuilding = (position: Position) => buildings.some((building) => insideBuilding(position, building));
  const regionMap: MapView = {
    ...map,
    blocked: positions(map.blocked),
    water: positions(map.water),
    bridges: positions(map.bridges),
    trees: positions(map.trees),
    roads: positions(map.roads),
    floors: positions(map.floors),
    houseWalls: positions(map.houseWalls),
    castleWalls: positions(map.castleWalls),
    windows: map.windows.filter((entry) => insideRenderBounds(entry.position, bounds) || belongsToVisibleBuilding(entry.position)),
    torches: positions(map.torches),
    terrainMaterials: map.terrainMaterials.filter((entry) => insideRenderBounds(entry.position, bounds)),
    objects: (map.objects ?? []).filter((entry) => insideRenderBounds(entry.position, bounds)),
    buildings,
    doors: map.doors.filter((entry) => insideRenderBounds(entry.position, bounds) || belongsToVisibleBuilding(entry.position)),
    stairs: map.stairs.filter((entry) => insideRenderBounds(entry.from, bounds) || insideRenderBounds(entry.to, bounds)),
  };
  return { map: regionMap, bounds };
}

function insideRenderBounds(position: Position, bounds: RenderBounds) {
  return position.z === bounds.floor
    && position.x >= bounds.minX
    && position.x < bounds.maxX
    && position.y >= bounds.minY
    && position.y < bounds.maxY;
}

function insideBuilding(position: Position, building: BuildingView) {
  return position.x >= building.x && position.x < building.x + building.width
    && position.y >= building.y && position.y < building.y + building.height;
}

function insideAnyBuilding(position: Position, buildings: readonly BuildingView[]) {
  return buildings.some((building) => insideBuilding(position, building));
}

function doorTransform(door: DoorView, building?: BuildingView) {
  if (!building) return {
    x: door.position.x + 0.5,
    z: door.position.y + 0.5,
    rotation: 0,
    openAngle: Math.PI / 2,
  };
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  if (door.position.y === building.y) return {
    x: door.position.x + 0.5,
    z: building.y,
    rotation: 0,
    openAngle: Math.PI / 2,
  };
  if (door.position.y === maxY - 1) return {
    x: door.position.x + 0.5,
    z: maxY,
    rotation: Math.PI,
    openAngle: Math.PI / 2,
  };
  if (door.position.x === building.x) return {
    x: building.x,
    z: door.position.y + 0.5,
    rotation: Math.PI / 2,
    openAngle: Math.PI / 2,
  };
  return {
    x: maxX,
    z: door.position.y + 0.5,
    rotation: -Math.PI / 2,
    openAngle: Math.PI / 2,
  };
}

function tileKey(position: Position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function distanceSquared(a: Position, b: Position) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function stablePhase(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash % 628) / 100;
}
