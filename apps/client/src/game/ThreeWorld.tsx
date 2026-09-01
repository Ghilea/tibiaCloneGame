import { Canvas, type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  BuildingView,
  CreatureView,
  DoorView,
  MapView,
  NpcView,
  PlayerView,
  Position,
  WindowView,
} from "../protocol";
import { CastleRatSprite } from "../actors/CastleRatSprite";
import { createActorMotionState, sampleActorMotion, type ActorMotionState } from "../actors/actorMotion";
import { AnimatedCharacter, type CharacterKind } from "./AnimatedCharacter";
import { CreatureModel } from "./CreatureModels";
import { CLIENT_STEP_MS, InputController } from "./InputController";
import { MedievalDoorLeafAsset } from "./MedievalAssetModels";
import { GabledRoof, HangingSign, MedievalDoorWall, MedievalWall, MedievalWindowWall, ShutterWindow } from "./MedievalModels";
import { WorldState, type CombatEffectView } from "./WorldState";
import { tileCenter, worldToTile, WORLD_TILE_SIZE } from "./WorldCoordinates";

const TILE_HEIGHT = 0.12;
// The KayKit actors have broad, rounded silhouettes. The environment uses a
// slightly larger architectural scale so openings and landmarks frame them
// naturally while every footprint still occupies the same gameplay tiles.
const WALL_HEIGHT = 3.2;
const CASTLE_HEIGHT = 4.1;
const DOOR_HEIGHT = 2.2;
const CAMERA_ZOOM = 125;
const CAMERA_HEIGHT = 18;
// About 27 degrees away from straight down: enough to read wall fronts and
// actor silhouettes without returning to the old diagonal isometric view.
const CAMERA_TOPDOWN_OFFSET = 9;
const GROUND_ACTOR_Y = 0.05;
// The bridge top is y=0.16. Keep the same clearance actors have above normal terrain.
const BRIDGE_ACTOR_Y = 0.23;
// The server already streams a radius-48 region. Rebuilding the entire static
// Three.js scene every 16 walked tiles caused a visible main-thread/GPU hitch.
// A 64-tile render chunk consumes the already available streamed payload and
// keeps the default 56x38 map stable for its full lifetime.
const RENDER_CHUNK_SIZE = 64;
const RENDER_PADDING = 20;

type ThreeWorldProps = {
  world: WorldState;
  input: InputController;
  onReady?: () => void;
  showDebug?: boolean;
};

export function ThreeWorld({ world, input, onReady, showDebug = true }: ThreeWorldProps) {
  const performanceLabel = useRef<HTMLDivElement>(null);
  const positionLabel = useRef<HTMLDivElement>(null);
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
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          // The environment is static. Avoid drawing every wall and tree a
          // second time on every frame just to reproduce the same shadow map.
          gl.shadowMap.autoUpdate = false;
          gl.shadowMap.needsUpdate = true;
          gl.setClearColor(0x0b1210);
        }}
      >
        <Suspense fallback={null}>
          <WorldScene world={world} input={input} />
          {showDebug && <ClientPerformanceMonitor label={performanceLabel} positionLabel={positionLabel} world={world} />}
          <SceneReady onReady={onReady} />
        </Suspense>
      </Canvas>
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

function StaticShadowMap({ revision }: { revision: MapView }) {
  const { gl } = useThree();
  useLayoutEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, revision]);
  return null;
}

function WorldScene({ world, input }: ThreeWorldProps) {
  const subscribeVisual = useCallback((listener: () => void) => world.subscribeVisual(listener), [world]);
  const visualSnapshot = useCallback(() => world.visualRevision, [world]);
  useSyncExternalStore(subscribeVisual, visualSnapshot);
  const map = world.map;
  // Region payloads replace MapView in one network message. Keep actor/input
  // updates urgent, but let React prepare the large static Three.js diff as
  // interruptible background work instead of blocking a movement frame.
  const renderMap = useDeferredValue(map);
  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
  const localVisualPosition = useRef(new THREE.Vector3(Number.NaN, 0.05, Number.NaN));
  const floor = local?.position.z ?? map?.floor ?? 0;

  if (!map || !renderMap) return null;
  const chunkX = Math.floor((local?.position.x ?? 0) / RENDER_CHUNK_SIZE);
  const chunkY = Math.floor((local?.position.y ?? 0) / RENDER_CHUNK_SIZE);
  const region = useMemo(
    () => createRenderRegion(renderMap, floor, chunkX, chunkY),
    [renderMap, floor, chunkX, chunkY],
  );
  const bridgeTiles = useMemo(() => new Set(region.map.bridges.map(tileKey)), [region.map.bridges]);
  const actorGroundY = (position: Position) => bridgeTiles.has(tileKey(position)) ? BRIDGE_ACTOR_Y : GROUND_ACTOR_Y;
  const indoorBuildingId = local
    ? region.map.buildings.find((building) => building.floor === floor && insideBuilding(local.position, building))?.id ?? null
    : null;
  const players = [...world.players.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const creatures = [...world.creatures.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
  const npcs = [...world.npcs.values()].filter((entry) => insideRenderBounds(entry.position, region.bounds));
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
      <Atmosphere torches={region.map.torches} local={local?.position} />
      <FollowCamera target={local?.position} visualTarget={localVisualPosition} mapWidth={map.width} mapHeight={map.height} />
      <Terrain map={region.map} floor={floor} bounds={region.bounds} onGround={onGround} />
      <Structures map={region.map} input={input} floor={floor} indoorBuildingId={indoorBuildingId} />
      <StaticShadowMap revision={region.map} />
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
      {world.groundItems
        .filter((entry) => insideRenderBounds(entry.position, region.bounds))
        .map((entry) => (
          <GroundItemActor
            key={entry.item.instanceId}
            position={entry.position}
            corpse={entry.contents.length > 0}
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
  const onFloor = (positions: readonly Position[]) => positions.filter((tile) => tile.z === floor);
  const materials = new Map(map.terrainMaterials.filter((entry) => entry.position.z === floor).map((entry) => [`${entry.position.x}:${entry.position.y}`, entry.material]));
  const materialTiles = (id: string) => [...materials.entries()].filter(([, value]) => value === id).map(([key]) => {
    const [x, y] = key.split(":").map(Number);
    return { x, y, z: floor };
  });
  const structuralTiles = new Set([
    ...map.water,
    ...map.trees,
    ...map.houseWalls,
    ...map.castleWalls,
  ].map(tileKey));
  const visibleRocks = map.blocked.filter((tile) => tile.z === floor && !structuralTiles.has(tileKey(tile)));

  return (
    <group>
      <mesh receiveShadow position={[bounds.minX + bounds.width / 2, -0.12, bounds.minY + bounds.height / 2]} onPointerDown={onGround}>
        <boxGeometry args={[bounds.width, 0.2, bounds.height]} />
        <meshStandardMaterial map={grassTexture} color="#91a477" roughness={0.96} />
      </mesh>
      <InstancedTiles positions={onFloor(map.roads)} color="#b7a889" texture={roadTexture} height={0.035} y={0.015} />
      <InstancedTiles positions={onFloor(map.floors)} color="#aaa18d" texture={mossStoneTexture} height={0.045} y={0.025} />
      <InstancedTiles positions={materialTiles("packed_earth")} color="#b29676" texture={packedEarthTexture} height={0.048} y={0.03} />
      <InstancedTiles positions={materialTiles("moss_stone")} color="#a4ad9a" texture={mossStoneTexture} height={0.052} y={0.034} />
      <InstancedTiles positions={materialTiles("sandstone")} color="#d0ba91" texture={sandstoneTexture} height={0.052} y={0.034} />
      <WaterTiles positions={onFloor(map.water)} />
      <InstancedTiles positions={onFloor(map.bridges)} color="#795334" height={0.14} y={0.09} />
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
    const wave = Math.sin(clock.elapsedTime * 1.15) * 0.035;
    material.roughness = 0.2 + wave;
    material.emissiveIntensity = 0.08 + wave;
    waterTexture.offset.set(clock.elapsedTime * 0.012, clock.elapsedTime * 0.007);
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

const Structures = memo(function Structures({ map, input, floor, indoorBuildingId }: { map: NonNullable<WorldState["map"]>; input: InputController; floor: number; indoorBuildingId: string | null }) {
  const buildings = useMemo(() => map.buildings.filter((entry) => entry.floor === floor), [floor, map.buildings]);
  return (
    <group>
      {buildings.map((building) => <group key={building.id}>
        <Building building={building} doors={map.doors} windows={map.windows} input={input} />
        <GabledRoof building={building} wallHeight={buildingWallHeight(building)} roofVisible={building.id !== indoorBuildingId} roofFade={building.id !== indoorBuildingId ? 1 : 0.08} />
      </group>)}
      <StaticStructures map={map} input={input} floor={floor} buildings={buildings} />
    </group>
  );
});

const StaticStructures = memo(function StaticStructures({ map, input, floor, buildings }: { map: NonNullable<WorldState["map"]>; input: InputController; floor: number; buildings: readonly BuildingView[] }) {
  return <>
      <ConnectedWalls positions={map.castleWalls.filter((tile) => tile.z === floor)} castle />
      {map.trees.filter((tile) => tile.z === floor).map((tile) => <Tree key={tileKey(tile)} position={tile} />)}
      {map.torches.filter((tile) => tile.z === floor).map((tile) => <Torch key={tileKey(tile)} position={tile} />)}
      {map.doors.filter((door) => door.position.z === floor && !insideAnyBuilding(door.position, buildings)).map((door) => <Door key={door.id} door={door} input={input} />)}
    </>;
});

const Building = memo(function Building({ building, doors, windows, input }: { building: BuildingView; doors: readonly DoorView[]; windows: readonly WindowView[]; input: InputController }) {
  const height = buildingWallHeight(building);
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  const matchingDoors = doors.filter((door) => door.position.z === building.floor && insideBuilding(door.position, building));
  const doorKeys = new Set(matchingDoors.map((door) => `${door.position.x}:${door.position.y}`));
  const matchingWindows = windows.filter((window) => window.position.z === building.floor && insideBuilding(window.position, building));
  const windowKeys = new Set(matchingWindows.map((window) => `${window.position.x}:${window.position.y}`));
  const wallSegments: { key: string; position: [number, number, number]; size: [number, number, number]; window: boolean; door: boolean }[] = [];
  for (let x = building.x; x < maxX; x++) {
    wallSegments.push({ key: `n${x}`, position: [x + 0.5, height / 2, building.y], size: [1.04, height, 0.13], window: windowKeys.has(`${x}:${building.y}`), door: doorKeys.has(`${x}:${building.y}`) });
    wallSegments.push({ key: `s${x}`, position: [x + 0.5, height / 2, maxY], size: [1.04, height, 0.13], window: windowKeys.has(`${x}:${maxY - 1}`), door: doorKeys.has(`${x}:${maxY - 1}`) });
  }
  for (let y = building.y; y < maxY; y++) {
    wallSegments.push({ key: `w${y}`, position: [building.x, height / 2, y + 0.5], size: [0.13, height, 1.04], window: windowKeys.has(`${building.x}:${y}`), door: doorKeys.has(`${building.x}:${y}`) });
    wallSegments.push({ key: `e${y}`, position: [maxX, height / 2, y + 0.5], size: [0.13, height, 1.04], window: windowKeys.has(`${maxX - 1}:${y}`), door: doorKeys.has(`${maxX - 1}:${y}`) });
  }
  return (
    <group>
      <mesh position={[building.x + building.width / 2, 0.035, building.y + building.height / 2]} receiveShadow>
        <boxGeometry args={[Math.max(0.2, building.width - 0.18), 0.07, Math.max(0.2, building.height - 0.18)]} />
        <meshStandardMaterial color={building.kind === "keep" ? "#666763" : "#765b42"} roughness={0.96} />
      </mesh>
      <group userData={{ occluder: true }}>
        {wallSegments.map((wall) => (
          wall.door
            ? <MedievalDoorWall key={wall.key} position={wall.position} size={wall.size} keep={building.kind === "keep"} openingHeight={Math.min(height - 0.15, DOOR_HEIGHT) + 0.1} />
            : wall.window && building.kind === "house"
            ? <MedievalWindowWall key={wall.key} position={wall.position} size={wall.size} />
            : <MedievalWall key={wall.key} position={wall.position} size={wall.size} keep={building.kind === "keep"} />
        ))}
        <HangingSign building={building} wallHeight={height} />
        {matchingDoors.map((door) => <Door key={door.id} door={door} building={building} input={input} tall={height} />)}
        {matchingWindows.map((window) => <ShutterWindow key={window.id} window={window} building={building} wallHeight={height} onClick={() => input.toggleWindow(window.id, window.position)} />)}
        {building.kind === "keep" && <Battlements building={building} height={height} />}
      </group>
    </group>
  );
});

function buildingWallHeight(building: BuildingView) {
  return building.kind === "keep" ? CASTLE_HEIGHT : WALL_HEIGHT;
}

function ConnectedWalls({ positions, castle }: { positions: readonly Position[]; castle: boolean }) {
  const set = new Set(positions.map(tileKey));
  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;
  return (
    <group>
      {positions.map((tile) => {
        return (
          <ConnectedWallTile
            key={tileKey(tile)}
            position={[tile.x + 0.5, 0, tile.y + 0.5]}
            height={height}
            castle={castle}
            west={set.has(`${tile.x - 1}:${tile.y}:${tile.z}`)}
            east={set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)}
            north={set.has(`${tile.x}:${tile.y - 1}:${tile.z}`)}
            south={set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)}
          />
        );
      })}
    </group>
  );
}

function ConnectedWallTile({ position, height, castle, west, east, north, south }: {
  position: [number, number, number];
  height: number;
  castle: boolean;
  west: boolean;
  east: boolean;
  north: boolean;
  south: boolean;
}) {
  const geometry = useMemo(() => {
    const thickness = castle ? 0.28 : 0.18;
    const centerSize = castle ? 0.3 : 0.24;
    const pieces: THREE.BufferGeometry[] = [];
    const addBox = (size: [number, number, number], offset: [number, number, number]) => {
      const box = new THREE.BoxGeometry(...size);
      box.translate(...offset);
      pieces.push(box);
    };
    addBox([centerSize, height, centerSize], [0, height / 2, 0]);
    if (west) addBox([0.42, height, thickness], [-0.32, height / 2, 0]);
    if (east) addBox([0.42, height, thickness], [0.32, height / 2, 0]);
    if (north) addBox([thickness, height, 0.42], [0, height / 2, -0.32]);
    if (south) addBox([thickness, height, 0.42], [0, height / 2, 0.32]);
    if (castle) addBox([0.25, 0.36, 0.25], [0, height + 0.18, 0]);
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((piece) => piece.dispose());
    if (!merged) throw new Error("Unable to merge connected wall geometry");
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }, [castle, east, height, north, south, west]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={position} castShadow receiveShadow userData={{ occluder: true }}>
    <meshStandardMaterial color={castle ? "#6d7773" : "#aa987c"} roughness={0.98} />
  </mesh>;
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

function Door({ door, input, building, tall = WALL_HEIGHT }: { door: DoorView; input: InputController; building?: BuildingView; tall?: number }) {
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
  if (building?.kind === "house") return (
    <MedievalDoorLeafAsset
      door={door}
      building={building}
      wallHeight={tall}
      onClick={() => input.toggleDoor(door.id, door.position)}
    />
  );
  return (
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
  );
}

function Tree({ position }: { position: Position }) {
  const phase = stablePhase(tileKey(position));
  return (
    <group position={[position.x + 0.5, 0, position.y + 0.5]} rotation={[0, phase, 0]} scale={[1.18, 1.22, 1.18]} userData={{ occluder: true }}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow><cylinderGeometry args={[0.14, 0.2, 1.45, 8]} /><meshStandardMaterial color="#604128" roughness={1} /></mesh>
      <mesh position={[0, 1.75, 0]} castShadow><coneGeometry args={[0.82, 1.75, 9]} /><meshStandardMaterial color="#315c38" roughness={0.95} /></mesh>
      <mesh position={[0, 2.35, 0]} castShadow><coneGeometry args={[0.61, 1.35, 9]} /><meshStandardMaterial color="#3b7043" roughness={0.95} /></mesh>
    </group>
  );
}

function Torch({ position }: { position: Position }) {
  const flame = useRef<THREE.Mesh>(null);
  const phase = stablePhase(tileKey(position));
  useFrame(({ clock }) => {
    if (!flame.current) return;
    const flicker = 1 + Math.sin(clock.elapsedTime * 10 + phase) * 0.12;
    flame.current.scale.set(flicker, 1 / flicker, flicker);
  });
  return (
    <group position={[position.x + 0.5, 0, position.y + 0.5]} scale={1.15}>
      <mesh position={[0, 0.62, 0]} castShadow><cylinderGeometry args={[0.035, 0.055, 1.24, 7]} /><meshStandardMaterial color="#49301f" /></mesh>
      <mesh ref={flame} position={[0, 1.31, 0]}><coneGeometry args={[0.13, 0.38, 9]} /><meshStandardMaterial color="#ff8b32" emissive="#ff4d10" emissiveIntensity={3} toneMapped={false} /></mesh>
    </group>
  );
}

type ActorClick = (event: ThreeEvent<MouseEvent>) => void;

type PlayerActorProps = { player: PlayerView; local: boolean; visualPosition?: MutableRefObject<THREE.Vector3>; correctionRevision: number; groundY: number; selected: boolean; onClick: ActorClick; onContextMenu: ActorClick };

const PlayerActor = memo(function PlayerActor({ player, local, visualPosition, correctionRevision, groundY, selected, onClick, onContextMenu }: PlayerActorProps) {
  const kind: CharacterKind = player.vocation === "mage" ? "mage" : player.vocation === "ranger" ? "ranger" : "knight";
  const moving = useRef(false);
  return (
    <SmoothActor id={player.id} position={player.position} groundY={groundY} visualPosition={visualPosition} moving={moving} correctionRevision={correctionRevision}>
      <group onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}>
        <SelectionRing active={selected || local} color={local ? "#65b9e8" : "#e2be65"} />
        <AnimatedCharacter kind={kind} position={player.position} moving={moving} />
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
  return <SmoothActor id={npc.id} position={npc.position} groundY={groundY} moving={moving}><group onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}><SelectionRing active color="#d6b65e" /><group ref={presence} rotation={[0, homeFacing, 0]}><AnimatedCharacter kind={kind} position={npc.position} moving={moving} /></group><mesh position={[0, 2.55, 0]}><octahedronGeometry args={[0.11]} /><meshStandardMaterial color="#e7c45f" emissive="#b17f23" emissiveIntensity={1.3} /></mesh>{callout && <SpeechBubble text={callout} />}</group></SmoothActor>;
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

function SpeechBubble({ text }: { text: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(12, 17, 14, .92)";
    context.strokeStyle = "rgba(220, 183, 103, .9)"; context.lineWidth = 5;
    context.beginPath(); context.roundRect(5, 5, 502, 98, 20); context.fill(); context.stroke();
    context.beginPath(); context.moveTo(235, 102); context.lineTo(256, 124); context.lineTo(277, 102); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = "#f5e4bc"; context.font = "600 25px Inter, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(text, 256, 55, 460);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true; return result;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[0, 3.08, 0]} scale={[2.3, 0.58, 1]} renderOrder={20}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} /></sprite>;
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

function GroundItemActor({ position, corpse, onClick, onContextMenu }: { position: Position; corpse: boolean; onClick: ActorClick; onContextMenu: ActorClick }) {
  return (
    <group position={[position.x + 0.5, 0.12, position.y + 0.5]} onPointerDown={(event) => event.stopPropagation()} onClick={onClick} onContextMenu={onContextMenu}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
        {corpse ? <circleGeometry args={[0.34, 14]} /> : <octahedronGeometry args={[0.18]} />}
        <meshStandardMaterial color={corpse ? "#6d3029" : "#d3a84f"} roughness={0.8} />
      </mesh>
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
  const faded = useRef(new Map<THREE.Material, number>());
  const lastCheckAt = useRef(0);
  const lastCheckedTarget = useMemo(() => new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN), []);
  const targetPoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  const next = useMemo(() => new Set<THREE.Material>(), []);
  const occluders = useRef<OccluderIndex>({ all: [], buckets: new Map() });
  useLayoutEffect(() => {
    // Compile occluders for transparency while a streamed region is being
    // prepared. Switching material defines only when the player reaches a
    // wall causes a visible one-frame hitch on many GPUs.
    occluders.current = collectOccluderBounds(scene);
    lastCheckedTarget.set(Number.NaN, Number.NaN, Number.NaN);
    for (const { root } of occluders.current.all) root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material.userData.occlusionPrepared) continue;
        material.userData.occlusionPrepared = true;
        material.transparent = true;
        material.needsUpdate = true;
      }
    });
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
    next.clear();
    for (const root of roots) root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        next.add(material);
        if (!faded.current.has(material)) {
          faded.current.set(material, material.opacity);
        }
        material.userData.occlusionOpacity = 0.28;
        material.opacity = Math.min(material.opacity, 0.28);
      }
    });
    for (const [material, original] of faded.current) {
      if (next.has(material)) continue;
      delete material.userData.occlusionOpacity;
      material.opacity = original;
      faded.current.delete(material);
    }
  });
  useEffect(() => () => {
    for (const [material, original] of faded.current) {
      delete material.userData.occlusionOpacity;
      material.opacity = original;
    }
  }, []);
  return null;
}

type OccluderBounds = { root: THREE.Object3D; bounds: THREE.Box3 };
type OccluderIndex = { all: OccluderBounds[]; buckets: Map<string, OccluderBounds[]> };
const OCCLUDER_BUCKET_SIZE = 8;

function collectOccluderBounds(scene: THREE.Scene): OccluderIndex {
  const roots: OccluderBounds[] = [];
  const visit = (node: THREE.Object3D) => {
    if (node.userData.occluder) {
      const bounds = new THREE.Box3().setFromObject(node);
      if (!bounds.isEmpty()) roots.push({ root: node, bounds });
      return;
    }
    node.children.forEach(visit);
  };
  scene.children.forEach(visit);
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

function Atmosphere({ torches, local }: { torches: readonly Position[]; local?: Position }) {
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
  useFrame(({ clock }) => {
    const cycle = (clock.elapsedTime % 180) / 180;
    const daylight = (Math.cos(cycle * Math.PI * 2 - Math.PI) + 1) / 2;
    if (sun.current) sun.current.intensity = 0.18 + daylight * 2.1;
    if (ambient.current) ambient.current.intensity = 0.22 + daylight * 0.85;
  });
  return (
    <>
      <hemisphereLight ref={ambient} args={["#bfd5cb", "#172019", 0.8]} />
      <directionalLight ref={sun} position={[14, 24, 9]} intensity={1.8} color="#ffe1aa" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-near={1} shadow-camera-far={70} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} />
      {activeTorches.map((torch) => <pointLight key={tileKey(torch)} position={[torch.x + 0.5, 1.55, torch.y + 0.5]} color="#ff6a24" intensity={5.4} distance={6.1} decay={2} />)}
    </>
  );
}

function ClientPerformanceMonitor({ label, positionLabel, world }: {
  label: RefObject<HTMLDivElement | null>;
  positionLabel: RefObject<HTMLDivElement | null>;
  world: WorldState;
}) {
  const { gl } = useThree();
  const sample = useRef({ elapsed: 0, frames: 0, totalMs: 0, maxMs: 0, logElapsed: 0 });
  useFrame((_, delta) => {
    if (document.hidden || delta > 0.5) {
      sample.current = { elapsed: 0, frames: 0, totalMs: 0, maxMs: 0, logElapsed: 0 };
      return;
    }
    const frameMs = delta * 1_000;
    const current = sample.current;
    current.elapsed += delta;
    current.frames += 1;
    current.totalMs += frameMs;
    current.maxMs = Math.max(current.maxMs, frameMs);
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
      label.current.textContent = `${fps} FPS · ${gl.info.render.calls} calls`;
      label.current.dataset.level = fps >= 55 ? "good" : fps >= 30 ? "fair" : "poor";
    }
    if (current.logElapsed >= 5) {
      console.info(`client performance sample: avg=${averageMs.toFixed(1)}ms max=${current.maxMs.toFixed(1)}ms fps=${fps} calls=${gl.info.render.calls} triangles=${gl.info.render.triangles}`);
      current.logElapsed = 0;
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
  useFrame(({ clock }, delta) => {
    if (!points.current || floor !== 0) return;
    const rain = Math.max(0, 1 - Math.abs(((clock.elapsedTime % 180) / 45) - 2.55) / 0.75);
    points.current.visible = rain > 0.02;
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
