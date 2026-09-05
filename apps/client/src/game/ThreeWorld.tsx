import { Canvas, type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { memo, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from "react";
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
import { GabledRoof, HouseDoorway, HouseWindowOpening, InstancedHousePlinths, InstancedHouseWalls, MedievalDoorWall, ShutterWindow } from "./MedievalModels";
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

// TIBIAGAME_STREAMING_FIX_V15
// Terrain gets a wider safety skirt than actors/dynamic entities. A 16-tile
// skirt keeps the camera covered during terrain handoff while the ordinary
// render region stays at its cheaper 8-tile padding.
const TERRAIN_RENDER_PADDING = 16;
// Do not swap terrain exactly on a 32-tile boundary. Server correction can
// otherwise move the logical player one tile back and forth around the border.
const TERRAIN_CHUNK_HYSTERESIS = 4;

// TIBIAGAME_STREAMING_FIX_V17
// 32 + 16*2 = 64 tile terrain window => 4096 unique tile positions.
// Keep a little headroom without changing the visible terrain window.
const TERRAIN_INSTANCE_CAPACITY = 4608;

// TIBIAGAME_STREAMING_FIX_V6
// TIBIAGAME_STREAMING_FIX_V7
const RETAINED_STATIC_CHUNK_SIZE = 24;
// TIBIAGAME_STREAMING_FIX_V11
// TIBIAGAME_STREAMING_FIX_V20
// 9 current chunks + up to 6 frontier chunks + 2 stair targets.
const RETAINED_STATIC_CACHE_LIMIT = 17;
const RETAINED_STATIC_HARD_LIMIT = 18;
const RETAINED_STATIC_CHUNK_HYSTERESIS = 4;
// TIBIAGAME_STREAMING_FIX_V8: superseded by authoritative completeness.
 // TIBIAGAME_STREAMING_FIX_V9: immutable retained chunks require full coverage.

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
        // TIBIAGAME_STREAMING_FIX_V6
        // Dynamic lighting remains enabled. Real-time shadow maps are disabled
        // because rebuilding shadow programs for streamed geometry caused
        // multi-hundred-ms stalls.
        shadows={false}
        dpr={[1, 1.6]}
        camera={{ near: 0.1, far: 180, position: [0, CAMERA_HEIGHT, CAMERA_TOPDOWN_OFFSET], zoom: CAMERA_ZOOM }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          // TIBIAGAME_STREAMING_FIX_V6
          // Keep Three.js lights, but do not run a second shadow render pass.
          gl.shadowMap.enabled = false;
          gl.shadowMap.autoUpdate = false;
          gl.setClearColor(0x0b1210);
        }}
      >
        <Suspense fallback={null}>
          <WorldScene world={world} input={input} onLootHover={setLootHover} onReady={onReady} />
          {showDebug && <ClientPerformanceMonitor label={performanceLabel} positionLabel={positionLabel} world={world} />}

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

// TIBIAGAME_STREAMING_FIX_V18
type WarmupRenderer = THREE.WebGLRenderer & {
  compileAsync?: (
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) => Promise<unknown>;
};

function retainedStaticSceneRoots(scene: THREE.Object3D) {
  const roots: THREE.Object3D[] = [];
  scene.traverse((object) => {
    const data = object.userData;
    if (
      typeof data?.streamFloor === "number"
      && typeof data?.streamChunkX === "number"
      && typeof data?.streamChunkY === "number"
    ) {
      roots.push(object);
    }
  });
  return roots;
}

function withRetainedStaticRootsVisible<T>(
  scene: THREE.Object3D,
  work: () => T,
) {
  const roots = retainedStaticSceneRoots(scene);
  const visibility = roots.map((root) => root.visible);
  roots.forEach((root) => {
    root.visible = true;
  });

  try {
    return work();
  } finally {
    roots.forEach((root, index) => {
      root.visible = visibility[index];
    });
  }
}

function initializeWarmupTextures(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
) {
  const seen = new Set<THREE.Texture>();
  const textureSlots = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
  ] as const;

  scene.traverseVisible((object) => {
    const materialValue = (object as THREE.Mesh).material;
    const materials = Array.isArray(materialValue)
      ? materialValue
      : materialValue
        ? [materialValue]
        : [];

    for (const material of materials) {
      const record = material as unknown as Record<string, unknown>;
      for (const slot of textureSlots) {
        const texture = record[slot];
        if (!(texture instanceof THREE.Texture) || seen.has(texture)) continue;
        seen.add(texture);
        renderer.initTexture(texture);
      }
    }
  });
}

function compileSceneForWarmup(
  renderer: WarmupRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  initializeTextures: boolean,
) {
  // TIBIAGAME_STREAMING_FIX_V18_1
  // Three r185's compileAsync can continue checking material readiness after
  // this streaming scene has changed. That produced:
  //   Cannot read properties of undefined (reading 'isReady')
  //
  // Initial warmup happens behind the loading screen, so prefer the synchronous
  // WebGLRenderer.compile() path. It completes while retained-root visibility
  // is held stable and cannot outlive this function.
  return Promise.resolve(withRetainedStaticRootsVisible(scene, () => {
    if (initializeTextures) initializeWarmupTextures(renderer, scene);
    renderer.compile(scene, camera);
  }));
}

function StaticSceneWarmup({ revision: _revision }: { revision: string }) {
  // TIBIAGAME_STREAMING_FIX_V18_1
  // Disabled during gameplay.
  //
  // V18 scheduled compileAsync every time the retained chunk key set changed.
  // Apart from the Three.js material-readiness crash, that work landed exactly
  // around streaming boundaries and could itself create 100-250ms movement
  // stalls. New-area optimization must be solved with shared/batched static
  // resources, not by compiling the live mutable scene while the player walks.
  return null;
}

function SceneReady({
  armed,
  onReady,
}: {
  armed: boolean;
  onReady?: () => void;
}) {
  const { gl, scene, camera } = useThree();
  const reported = useRef(false);
  const armedAt = useRef(0);
  const lastSignature = useRef("");
  const stableFrames = useRef(0);
  const compileStarted = useRef(false);
  const compileFinished = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!armed || reported.current) return;
    armedAt.current = performance.now();
    lastSignature.current = "";
    stableFrames.current = 0;
    compileStarted.current = false;
    compileFinished.current = false;
  }, [armed]);

  useFrame(() => {
    if (reported.current || !armed) return;

    const signature = [
      gl.info.memory.geometries,
      gl.info.memory.textures,
      gl.info.programs?.length ?? 0,
    ].join(":");

    if (signature === lastSignature.current) {
      stableFrames.current += 1;
    } else {
      lastSignature.current = signature;
      stableFrames.current = 0;
    }

    const elapsed = performance.now() - armedAt.current;

    // TIBIAGAME_STREAMING_FIX_V18
    // The loading screen already hides initial construction. Use that time to
    // compile BOTH the active floor and retained hidden stair-target floor
    // chunks. Also push their already-loaded textures to the GPU now rather
    // than on the first z-level transition.
    if (!compileStarted.current && stableFrames.current >= 18 && elapsed >= 600) {
      compileStarted.current = true;
      const renderer = gl as WarmupRenderer;

      try {
        void compileSceneForWarmup(
          renderer,
          scene,
          camera,
          true,
        )
          .catch(() => undefined)
          .then(() => {
            compileFinished.current = true;
            lastSignature.current = "";
            stableFrames.current = 0;
          });
      } catch {
        compileFinished.current = true;
        lastSignature.current = "";
        stableFrames.current = 0;
      }
      return;
    }

    if (compileFinished.current && stableFrames.current >= 24 && elapsed >= 1_100) {
      reported.current = true;
      onReadyRef.current?.();
    }
  });

  return null;
}

function WorldScene({ world, input, onLootHover, onReady }: ThreeWorldProps & { onLootHover: (hover: { label: string; x: number; y: number } | null) => void }) {
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

  // TIBIAGAME_STREAMING_FIX_V15
  // Terrain uses a Schmitt-trigger style anchor instead of following the raw
  // logical 32x32 chunk immediately. This prevents a correction at e.g.
  // y=63/64 from swapping the complete terrain window out and back.
  const terrainAnchorRef = useRef({
    floor,
    chunkX,
    chunkY,
  });
  {
    const positionX = local?.position.x ?? chunkX * RENDER_CHUNK_SIZE;
    const positionY = local?.position.y ?? chunkY * RENDER_CHUNK_SIZE;
    const current = terrainAnchorRef.current;

    if (current.floor !== floor) {
      terrainAnchorRef.current = { floor, chunkX, chunkY };
    } else {
      let nextChunkX = current.chunkX;
      let nextChunkY = current.chunkY;

      while (
        positionX
        < nextChunkX * RENDER_CHUNK_SIZE - TERRAIN_CHUNK_HYSTERESIS
      ) nextChunkX -= 1;
      while (
        positionX
        >= (nextChunkX + 1) * RENDER_CHUNK_SIZE + TERRAIN_CHUNK_HYSTERESIS
      ) nextChunkX += 1;

      while (
        positionY
        < nextChunkY * RENDER_CHUNK_SIZE - TERRAIN_CHUNK_HYSTERESIS
      ) nextChunkY -= 1;
      while (
        positionY
        >= (nextChunkY + 1) * RENDER_CHUNK_SIZE + TERRAIN_CHUNK_HYSTERESIS
      ) nextChunkY += 1;

      if (
        nextChunkX !== current.chunkX
        || nextChunkY !== current.chunkY
      ) {
        terrainAnchorRef.current = {
          floor,
          chunkX: nextChunkX,
          chunkY: nextChunkY,
        };
      }
    }
  }
  const terrainChunkX = terrainAnchorRef.current.chunkX;
  const terrainChunkY = terrainAnchorRef.current.chunkY;

  // TIBIAGAME_STREAMING_FIX_V14
  // Terrain knowledge is monotonic across OVERLAPPING render chunks.
  // V13 cached each 32x32 render key independently, which meant crossing a
  // render-chunk boundary could switch to a different cache entry that did not
  // yet contain a tile the previous overlapping entry had already seen.
  const immediateStreamRegionRevision = world.streamRegionRevision;
  const terrainRegionsRef = useRef(
    new Map<string, ReturnType<typeof createRenderRegion>>(),
  );
  const terrainRegion = useMemo(() => {
    void immediateStreamRegionRevision;
    const source = mapReady ? latestMapRef.current : null;
    if (!source) return null;

    const key = `${floor}:${terrainChunkX}:${terrainChunkY}`;
    const candidate = createRenderRegion(
      source,
      floor,
      terrainChunkX,
      terrainChunkY,
      TERRAIN_RENDER_PADDING,
    );
    const previous = terrainRegionsRef.current.get(key);

    // Preserve everything already known for this exact render chunk, then
    // import terrain knowledge from neighboring cached chunks wherever their
    // padded render bounds overlap the new one. The newest packet remains the
    // authority for conflicts; neighboring entries only fill missing terrain.
    let merged = previous
      ? mergeTerrainRenderRegion(previous, candidate)
      : candidate;

    for (const [knownKey, known] of terrainRegionsRef.current) {
      if (knownKey === key || !knownKey.startsWith(`${floor}:`)) continue;
      if (!terrainRenderBoundsOverlap(known.bounds, candidate.bounds)) continue;
      merged = mergeOverlappingTerrainKnowledge(merged, known, candidate.bounds);
    }

    terrainRegionsRef.current.delete(key);
    terrainRegionsRef.current.set(key, merged);

    // This is CPU-side terrain knowledge, not mounted GPU chunks. Keep enough
    // history to bridge several render boundaries without unbounded growth.
    if (terrainRegionsRef.current.size > 32) {
      const oldestKey = terrainRegionsRef.current.keys().next().value;
      if (oldestKey && oldestKey !== key) {
        terrainRegionsRef.current.delete(oldestKey);
      }
    }

    return merged;
  }, [
    mapReady,
    floor,
    terrainChunkX,
    terrainChunkY,
    immediateStreamRegionRevision,
  ]);

  // TIBIAGAME_STREAMING_FIX_V6
  // TIBIAGAME_STREAMING_FIX_V20
  // Retained structure ownership has its own hysteresis. Terrain already uses
  // the same strategy at 32-tile boundaries.
  const rawStaticChunkX = Math.floor(
    (local?.position.x ?? 0) / RETAINED_STATIC_CHUNK_SIZE,
  );
  const rawStaticChunkY = Math.floor(
    (local?.position.y ?? 0) / RETAINED_STATIC_CHUNK_SIZE,
  );
  const retainedAnchorRef = useRef({
    floor,
    chunkX: rawStaticChunkX,
    chunkY: rawStaticChunkY,
  });

  {
    const current = retainedAnchorRef.current;
    const positionX = local?.position.x ?? 0;
    const positionY = local?.position.y ?? 0;

    if (current.floor !== floor) {
      retainedAnchorRef.current = {
        floor,
        chunkX: rawStaticChunkX,
        chunkY: rawStaticChunkY,
      };
    } else {
      let nextChunkX = current.chunkX;
      let nextChunkY = current.chunkY;

      while (
        positionX
        < nextChunkX * RETAINED_STATIC_CHUNK_SIZE
          - RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkX -= 1;
      while (
        positionX
        >= (nextChunkX + 1) * RETAINED_STATIC_CHUNK_SIZE
          + RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkX += 1;

      while (
        positionY
        < nextChunkY * RETAINED_STATIC_CHUNK_SIZE
          - RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkY -= 1;
      while (
        positionY
        >= (nextChunkY + 1) * RETAINED_STATIC_CHUNK_SIZE
          + RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkY += 1;

      if (
        nextChunkX !== current.chunkX
        || nextChunkY !== current.chunkY
      ) {
        retainedAnchorRef.current = {
          floor,
          chunkX: nextChunkX,
          chunkY: nextChunkY,
        };
      }
    }
  }

  const staticChunkX = retainedAnchorRef.current.chunkX;
  const staticChunkY = retainedAnchorRef.current.chunkY;
  const [retainedStaticChunks, setRetainedStaticChunks] = useState<RetainedStaticChunkData[]>([]);
  const retainedStaticKeys = useRef(new Set<string>());

  useEffect(() => {
    const sourceAtStart = latestMapRef.current;
    if (!sourceAtStart || !local) return;

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    // TIBIAGAME_STREAMING_FIX_V11
    // Only the actually needed 3x3 structure neighborhood is retained.
    // Terrain no longer depends on this scheduler.
    const visibleOffsets: readonly [number, number][] = [
      [0, 0],
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const currentFloorSpecs = visibleOffsets.map(([dx, dy]) => ({
      floor,
      chunkX: staticChunkX + dx,
      chunkY: staticChunkY + dy,
    }));

    // TIBIAGAME_STREAMING_FIX_V20_3
    // Production trace showed that whole React/R3F chunk mounts scheduled from
    // requestIdleCallback become the hitch themselves. Runtime frontier mounts
    // are disabled; normal 3x3 + stair-target loading remains.
    // TIBIAGAME_STREAMING_FIX_V7
    // Network/CPU streaming still preloads adjacent floors. GPU prewarm is
    // limited to actual stair destinations inside the current 3x3 vicinity.
    const stairTargetSpecs = sourceAtStart.stairs
      .flatMap((stair) => {
        const currentEndpoint = stair.from.z === floor
          ? stair.from
          : stair.to.z === floor ? stair.to : null;
        if (!currentEndpoint) return [];

        const endpointChunkX = Math.floor(
          currentEndpoint.x / RETAINED_STATIC_CHUNK_SIZE,
        );
        const endpointChunkY = Math.floor(
          currentEndpoint.y / RETAINED_STATIC_CHUNK_SIZE,
        );
        if (
          Math.abs(endpointChunkX - staticChunkX) > 1
          || Math.abs(endpointChunkY - staticChunkY) > 1
        ) return [];

        const targetEndpoint = stair.from.z === floor ? stair.to : stair.from;
        return [{
          floor: targetEndpoint.z,
          chunkX: Math.floor(targetEndpoint.x / RETAINED_STATIC_CHUNK_SIZE),
          chunkY: Math.floor(targetEndpoint.y / RETAINED_STATIC_CHUNK_SIZE),
        }];
      })
      .filter((spec, index, all) =>
        all.findIndex((candidate) =>
          candidate.floor === spec.floor
          && candidate.chunkX === spec.chunkX
          && candidate.chunkY === spec.chunkY
        ) === index
      )
      .slice(0, 2);

    const addChunk = (spec: { floor: number; chunkX: number; chunkY: number }) => {
      if (cancelled) return;
      const key = retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY);
      if (retainedStaticKeys.current.has(key)) return;

      const source = latestMapRef.current;
      const center = world.streamRegionCenter;
      if (!source || !retainedChunkFullyCovered(
        spec.floor,
        spec.chunkX,
        spec.chunkY,
        center,
        world.streamRegionRadius,
        world.streamRegionFloorRadius,
        source,
      )) return;

      const chunk = createRetainedStaticChunk(
        source,
        spec.floor,
        spec.chunkX,
        spec.chunkY,
      );
      retainedStaticKeys.current.add(key);

      startTransition(() => {
        setRetainedStaticChunks((previous) => {
          const next = [...previous, chunk];
          if (next.length <= RETAINED_STATIC_HARD_LIMIT) return next;

          let removableIndex = -1;
          let bestScore = -1;
          next.forEach((entry, index) => {
            if (
              entry.floor === floor
              && Math.abs(entry.chunkX - staticChunkX) <= 1
              && Math.abs(entry.chunkY - staticChunkY) <= 1
            ) return;
            const floorPenalty = entry.floor === floor ? 0 : 8;
            const score = floorPenalty
              + Math.abs(entry.chunkX - staticChunkX)
              + Math.abs(entry.chunkY - staticChunkY);
            if (score > bestScore) {
              bestScore = score;
              removableIndex = index;
            }
          });
          if (removableIndex < 0) return next;

          const [removed] = next.splice(removableIndex, 1);
          retainedStaticKeys.current.delete(removed.key);
          return next;
        });
      });
    };

    // Login or a completely new floor: mount only the center immediately.
    const centerSpec = currentFloorSpecs[0];
    const centerKey = retainedStaticChunkKey(
      centerSpec.floor,
      centerSpec.chunkX,
      centerSpec.chunkY,
    );
    if (!retainedStaticKeys.current.has(centerKey)) addChunk(centerSpec);

    const pending = [
      ...currentFloorSpecs.slice(1),
      ...stairTargetSpecs,
    ].filter((spec) => !retainedStaticKeys.current.has(
      retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY),
    ));

    let cursor = 0;

    const pump = (deadline?: { timeRemaining(): number }) => {
      if (cancelled || cursor >= pending.length) return;
      if (deadline && deadline.timeRemaining() < 5) {
        schedule();
        return;
      }

      addChunk(pending[cursor++]);
      schedule();
    };

    const schedule = () => {
      if (cancelled || cursor >= pending.length) return;
      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: (deadline: { timeRemaining(): number }) => void,
        ) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(pump);
      } else {
        timeoutHandle = window.setTimeout(() => pump(), 64);
      }
    };

    schedule();

    return () => {
      cancelled = true;
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [floor, staticChunkX, staticChunkY, immediateStreamRegionRevision]);

  // TIBIAGAME_STREAMING_FIX_V16
  // Retire old GPU chunks while moving, but only in browser idle time. The old
  // 650ms stationary timer let retained geometry accumulate for a whole walk.
  useEffect(() => {
    if (!local || retainedStaticChunks.length <= RETAINED_STATIC_CACHE_LIMIT) return;

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const retireOne = () => {
      if (cancelled) return;
      startTransition(() => {
        setRetainedStaticChunks((previous) => {
          if (previous.length <= RETAINED_STATIC_CACHE_LIMIT) return previous;

          let removableIndex = -1;
          let bestScore = -1;
          previous.forEach((entry, index) => {
            if (
              entry.floor === floor
              && Math.abs(entry.chunkX - staticChunkX) <= 1
              && Math.abs(entry.chunkY - staticChunkY) <= 1
            ) return;

            const floorPenalty = entry.floor === floor ? 0 : 8;
            const score = floorPenalty
              + Math.abs(entry.chunkX - staticChunkX)
              + Math.abs(entry.chunkY - staticChunkY);
            if (score > bestScore) {
              bestScore = score;
              removableIndex = index;
            }
          });

          if (removableIndex < 0) return previous;
          const next = [...previous];
          const [removed] = next.splice(removableIndex, 1);
          retainedStaticKeys.current.delete(removed.key);
          return next;
        });
      });
    };

    const idleWindow = window as typeof window & {
      requestIdleCallback?: (
        callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(() => retireOne());
    } else {
      timeoutHandle = window.setTimeout(retireOne, 48);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [
    floor,
    retainedStaticChunks.length,
    staticChunkX,
    staticChunkY,
  ]);

  // Door/window state is genuinely dynamic. Refresh only the local 3x3 on
  // those rare mutations; ordinary world_region packets never replace chunks.
  useEffect(() => {
    if (!dynamicMapRevision) return;
    const source = latestMapRef.current;
    if (!source) return;
    setRetainedStaticChunks((previous) => previous.map((entry) => {
      if (
        entry.floor !== floor
        || Math.abs(entry.chunkX - staticChunkX) > 1
        || Math.abs(entry.chunkY - staticChunkY) > 1
      ) return entry;
      return createRetainedStaticChunk(source, entry.floor, entry.chunkX, entry.chunkY);
    }));
  }, [dynamicMapRevision, floor, staticChunkX, staticChunkY]);

  const activeStaticChunkCount = retainedStaticChunks.reduce(
    (count, entry) => count + (entry.floor === floor ? 1 : 0),
    0,
  );
  const staticSceneRevision = `${floor}:${staticChunkX}:${staticChunkY}:${activeStaticChunkCount}:${dynamicMapRevision}`;

  // TIBIAGAME_STREAMING_FIX_V18
  // Key-set revision catches hidden stair targets and rolling-cache swaps too,
  // even when activeStaticChunkCount happens to remain unchanged.
  const staticGpuWarmupRevision = `${floor}:${dynamicMapRevision}:${retainedStaticChunks
    .map((entry) => entry.key)
    .sort()
    .join("|")}`;

  // TIBIAGAME_STREAMING_FIX_V14
  // Keep the loading screen until every retained structure chunk that can
  // intersect the initial 3x3 neighborhood has been created.
  const retainedStaticKeySet = new Set(retainedStaticChunks.map((entry) => entry.key));
  const initialRequiredStaticKeys: string[] = [];
  if (map) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const requiredChunkX = staticChunkX + dx;
        const requiredChunkY = staticChunkY + dy;
        const minX = requiredChunkX * RETAINED_STATIC_CHUNK_SIZE;
        const minY = requiredChunkY * RETAINED_STATIC_CHUNK_SIZE;
        const maxX = minX + RETAINED_STATIC_CHUNK_SIZE;
        const maxY = minY + RETAINED_STATIC_CHUNK_SIZE;
        if (maxX <= 0 || maxY <= 0 || minX >= map.width || minY >= map.height) continue;
        initialRequiredStaticKeys.push(
          retainedStaticChunkKey(floor, requiredChunkX, requiredChunkY),
        );
      }
    }
  }
  const initialWorldReady = Boolean(
    map
    && region
    && terrainRegion
    && initialRequiredStaticKeys.length > 0
    && initialRequiredStaticKeys.every((key) => retainedStaticKeySet.has(key))
  );

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
      <SceneReady armed={initialWorldReady} onReady={onReady} />
      <StaticSceneWarmup revision={staticGpuWarmupRevision} />
      {/* TIBIAGAME_STREAMING_FIX_V11
          Ground is immediate and independent from background structure chunks. */}
      {terrainRegion && <Terrain
        map={terrainRegion.map}
        floor={floor}
        bounds={terrainRegion.bounds}
        onGround={onGround}
      />}
      {/* TIBIAGAME_STREAMING_FIX_V20_2: retained chunks do not receive onGround. */}
      {retainedStaticChunks.map((chunk) => (
        <RetainedStaticChunk
          key={chunk.key}
          chunk={chunk}
          activeFloor={floor}
          input={input}
          world={world}
          discoveryRevision={world.worldObjectCallout?.key ?? 0}
          indoorBuildingId={indoorBuildingId}
          onHover={onLootHover}
        />
      ))}
      <OcclusionController
        target={local?.position}
        visualTarget={localVisualPosition}
        sceneRevision={staticSceneRevision}
        floor={floor}
        chunkX={staticChunkX}
        chunkY={staticChunkY}
      />
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
            event.stopPropagation();
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
            event.stopPropagation();
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
            event.stopPropagation();
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
            event.stopPropagation();
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
              event.stopPropagation();
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

type RetainedStaticChunkData = {
  key: string;
  floor: number;
  chunkX: number;
  chunkY: number;
  map: MapView;
  bounds: RenderBounds;
  // TIBIAGAME_STREAMING_FIX_V9
  castleWallContext: Position[];
};

function retainedStaticChunkKey(floor: number, chunkX: number, chunkY: number) {
  return `${floor}:${chunkX}:${chunkY}`;
}

const RetainedStaticChunk = memo(function RetainedStaticChunk({
  chunk,
  activeFloor,
  input,
  world,
  discoveryRevision,
  indoorBuildingId,
  onHover,
}: {
  chunk: RetainedStaticChunkData;
  activeFloor: number;
  input: InputController;
  world: WorldState;
  discoveryRevision: number;
  indoorBuildingId: string | null;
  onHover: (hover: { label: string; x: number; y: number } | null) => void;
}) {
  return (
    <group
      visible={chunk.floor === activeFloor}
      userData={{
        streamFloor: chunk.floor,
        streamChunkX: chunk.chunkX,
        streamChunkY: chunk.chunkY,
      }}
    >
      <Suspense fallback={null}>
        <Structures
          map={chunk.map}
          castleWallContext={chunk.castleWallContext}
          input={input}
          world={world}
          discoveryRevision={discoveryRevision}
          floor={chunk.floor}
          indoorBuildingId={chunk.floor === activeFloor ? indoorBuildingId : null}
          onHover={onHover}
        />
      </Suspense>
    </group>
  );
});

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
  // TIBIAGAME_STREAMING_FIX_V18
  // V17 kept the InstancedMesh itself stable, but still replaced the complete
  // instanceMatrix BufferAttribute whenever a streamed terrain slice changed.
  // Keep one fixed GPU buffer for the component lifetime and only update its
  // used matrix range.
  const instanceMatrix = useMemo(() => {
    const attribute = new THREE.InstancedBufferAttribute(
      new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16),
      16,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  }, []);

  const visibleCount = Math.min(positions.length, TERRAIN_INSTANCE_CAPACITY);

  useMemo(() => {
    const data = instanceMatrix.array as Float32Array;
    const matrix = new THREE.Matrix4();

    for (let index = 0; index < visibleCount; index += 1) {
      const tile = positions[index];
      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);
      matrix.toArray(data, index * 16);
    }

    instanceMatrix.clearUpdateRanges();
    if (visibleCount > 0) {
      instanceMatrix.addUpdateRange(0, visibleCount * 16);
      instanceMatrix.needsUpdate = true;
    }
  }, [instanceMatrix, positions, visibleCount, y]);

  return (
    <instancedMesh
      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}
      count={visibleCount}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    >
      <primitive object={instanceMatrix} attach="instanceMatrix" />
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

// TIBIAGAME_STREAMING_FIX_V20
// Remaining static world categories use one immutable geometry/material family
// for every retained chunk. Instance buffers stay allocated for the component
// lifetime, so dynamic refreshes do not reconstruct WebGL objects.
const PERSISTENT_CHUNK_INSTANCE_CAPACITY = 768;
const PERSISTENT_WALL_INSTANCE_CAPACITY = 3072;
const PERSISTENT_BRIDGE_INSTANCE_CAPACITY = 4096;

const persistentStaticGeometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  bridgePost: new THREE.CylinderGeometry(0.07, 0.08, 0.78, 8),
  treeTrunk: new THREE.CylinderGeometry(0.14, 0.2, 1.45, 8),
  forestLower: new THREE.ConeGeometry(0.82, 1.75, 9),
  forestUpper: new THREE.ConeGeometry(0.61, 1.35, 9),
  pineLower: new THREE.ConeGeometry(0.72, 1.9, 7),
  pineUpper: new THREE.ConeGeometry(0.52, 1.5, 7),
  mountainCap: new THREE.DodecahedronGeometry(0.53, 0),
  snowBank: new THREE.DodecahedronGeometry(0.55, 1),
  barrel: new THREE.CylinderGeometry(0.24, 0.28, 0.56, 10),
  torchPost: new THREE.CylinderGeometry(0.035, 0.055, 1.24, 7),
  torchFlame: new THREE.ConeGeometry(0.13, 0.38, 9),
} as const;

const persistentStaticMaterial = {
  houseConnectedWall: new THREE.MeshStandardMaterial({
    color: "#aa987c",
    roughness: 0.98,
  }),
  treeTrunk: new THREE.MeshStandardMaterial({
    color: "#604128",
    roughness: 1,
  }),
  forestLower: new THREE.MeshStandardMaterial({
    color: "#315c38",
    roughness: 0.95,
  }),
  forestUpper: new THREE.MeshStandardMaterial({
    color: "#3b7043",
    roughness: 0.95,
  }),
  pineLower: new THREE.MeshStandardMaterial({
    color: "#285744",
    roughness: 0.95,
  }),
  pineUpper: new THREE.MeshStandardMaterial({
    color: "#346a50",
    roughness: 0.95,
  }),
  snowyLower: new THREE.MeshStandardMaterial({
    color: "#c5dadd",
    roughness: 0.95,
  }),
  snowyUpper: new THREE.MeshStandardMaterial({
    color: "#e0ebea",
    roughness: 0.95,
  }),
  mountainBase: new THREE.MeshStandardMaterial({
    color: "#59615d",
    roughness: 0.98,
  }),
  mountainCap: new THREE.MeshStandardMaterial({
    color: "#778078",
    roughness: 0.98,
  }),
  snowBank: new THREE.MeshStandardMaterial({
    color: "#c9dcdf",
    roughness: 1,
  }),
  barrel: new THREE.MeshStandardMaterial({
    color: "#9b5d2c",
    roughness: 0.85,
  }),
  torchPost: new THREE.MeshStandardMaterial({
    color: "#49301f",
    roughness: 0.92,
  }),
  torchFlame: new THREE.MeshStandardMaterial({
    color: "#ff8b32",
    emissive: "#ff4d10",
    emissiveIntensity: 3,
    toneMapped: false,
  }),
} as const;

const persistentCastleWallMaterials = new Map<string, THREE.MeshStandardMaterial>();
const persistentBridgeMaterials = new Map<string, {
  rail: THREE.MeshStandardMaterial;
  post: THREE.MeshStandardMaterial;
}>();

function usePersistentConnectedWallMaterial(
  castle: boolean,
  texture: THREE.Texture,
) {
  return useMemo(() => {
    if (!castle) return persistentStaticMaterial.houseConnectedWall;
    const key = texture.uuid;
    const cached = persistentCastleWallMaterials.get(key);
    if (cached) return cached;

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: "#d0d0c5",
      roughness: 0.98,
    });
    persistentCastleWallMaterials.set(key, material);
    return material;
  }, [castle, texture]);
}

function usePersistentBridgeMaterials(texture: THREE.Texture) {
  return useMemo(() => {
    const key = texture.uuid;
    const cached = persistentBridgeMaterials.get(key);
    if (cached) return cached;

    const materials = {
      rail: new THREE.MeshStandardMaterial({
        map: texture,
        color: "#725334",
        roughness: 0.9,
      }),
      post: new THREE.MeshStandardMaterial({
        map: texture,
        color: "#684a2f",
        roughness: 0.92,
      }),
    };
    persistentBridgeMaterials.set(key, materials);
    return materials;
  }, [texture]);
}

// TIBIAGAME_STREAMING_FIX_V20_3
function retainedInstanceCapacity(count: number, maximum: number) {
  if (count <= 1) return 1;
  let value = 1;
  while (value < count && value < maximum) value *= 2;
  return Math.min(value, maximum);
}

function persistentInstanceMatrix(
  position: readonly number[],
  rotation: readonly number[] = [0, 0, 0],
  scale: readonly number[] = [1, 1, 1],
) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    ),
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  );
}

function PersistentStaticInstances({
  geometry,
  material,
  matrices,
  capacity,
  castShadow = true,
  receiveShadow = true,
  userData,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: readonly THREE.Matrix4[];
  capacity: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  userData?: Record<string, unknown>;
}) {
  const allocationCapacity = retainedInstanceCapacity(
    matrices.length,
    capacity,
  );

  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      geometry,
      material,
      allocationCapacity,
    );
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instance.castShadow = castShadow;
    instance.receiveShadow = receiveShadow;
    instance.frustumCulled = false;
    if (userData) Object.assign(instance.userData, userData);
    return instance;
  }, [
    allocationCapacity,
    castShadow,
    geometry,
    material,
    receiveShadow,
  ]);

  const count = Math.min(matrices.length, allocationCapacity);

  useMemo(() => {
    const target = mesh.instanceMatrix.array as Float32Array;
    for (let index = 0; index < count; index += 1) {
      matrices[index].toArray(target, index * 16);
    }
    mesh.count = count;
    mesh.instanceMatrix.clearUpdateRanges();
    if (count > 0) {
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [count, matrices, mesh]);

  return <primitive object={mesh} dispose={null} />;
}

function InstancedBridgeRails({
  segments,
  texture,
}: {
  segments: readonly {
    key: string;
    position: [number, number, number];
    size: [number, number, number];
  }[];
  texture: THREE.Texture;
}) {
  // TIBIAGAME_STREAMING_FIX_V20
  const materials = usePersistentBridgeMaterials(texture);
  const { horizontal, vertical, posts } = useMemo(() => {
    const horizontalMatrices: THREE.Matrix4[] = [];
    const verticalMatrices: THREE.Matrix4[] = [];
    const postMatrices: THREE.Matrix4[] = [];

    for (const segment of segments) {
      const horizontal = segment.size[0] > segment.size[2];
      const target = horizontal ? horizontalMatrices : verticalMatrices;
      for (const y of [segment.position[1], segment.position[1] + 0.3]) {
        target.push(persistentInstanceMatrix(
          [segment.position[0], y, segment.position[2]],
          [0, 0, 0],
          horizontal ? [0.9, 0.09, 0.09] : [0.09, 0.09, 0.9],
        ));
      }

      if (horizontal) {
        postMatrices.push(
          persistentInstanceMatrix([
            segment.position[0] - 0.38,
            0.48,
            segment.position[2],
          ]),
          persistentInstanceMatrix([
            segment.position[0] + 0.38,
            0.48,
            segment.position[2],
          ]),
        );
      } else {
        postMatrices.push(
          persistentInstanceMatrix([
            segment.position[0],
            0.48,
            segment.position[2] - 0.38,
          ]),
          persistentInstanceMatrix([
            segment.position[0],
            0.48,
            segment.position[2] + 0.38,
          ]),
        );
      }
    }

    return {
      horizontal: horizontalMatrices,
      vertical: verticalMatrices,
      posts: postMatrices,
    };
  }, [segments]);

  return (
    <>
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.box}
        material={materials.rail}
        matrices={horizontal}
        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}
      />
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.box}
        material={materials.rail}
        matrices={vertical}
        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}
      />
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.bridgePost}
        material={materials.post}
        matrices={posts}
        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}
        receiveShadow={false}
      />
    </>
  );
}

function WaterTiles({ positions }: { positions: readonly Position[] }) {
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

  // TIBIAGAME_STREAMING_FIX_V18
  // Keep the water instance attribute alive across terrain-window updates too.
  const instanceMatrix = useMemo(() => {
    const attribute = new THREE.InstancedBufferAttribute(
      new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16),
      16,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  }, []);

  const visibleCount = Math.min(positions.length, TERRAIN_INSTANCE_CAPACITY);

  useMemo(() => {
    const data = instanceMatrix.array as Float32Array;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    const scale = new THREE.Vector3(1.02, 1.02, 1);

    for (let index = 0; index < visibleCount; index += 1) {
      const tile = positions[index];
      matrix.compose(
        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),
        quaternion,
        scale,
      );
      matrix.toArray(data, index * 16);
    }

    instanceMatrix.clearUpdateRanges();
    if (visibleCount > 0) {
      instanceMatrix.addUpdateRange(0, visibleCount * 16);
      instanceMatrix.needsUpdate = true;
    }
  }, [instanceMatrix, positions, visibleCount]);

  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const wave = Math.sin(clock.elapsedTime * 1.6) * 0.035;
    material.roughness = 0.2 + wave;
    material.opacity = 0.84 + Math.sin(clock.elapsedTime * 1.25) * 0.035;
    material.emissiveIntensity = 0.1 + wave;
    waterTexture.offset.set(clock.elapsedTime * 0.032, clock.elapsedTime * 0.019);
  });

  return (
    <instancedMesh
      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}
      count={visibleCount}
      receiveShadow
      frustumCulled={false}
    >
      <primitive object={instanceMatrix} attach="instanceMatrix" />
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}

const worldTextureCloneCache = new Map<string, THREE.Texture>();

function useWorldTexture(path: string, repeatX = 1, repeatY = 1) {
  const source = useLoader(THREE.TextureLoader, path);
  const { gl } = useThree();
  return useMemo(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const key = `${path}|${repeatX.toFixed(3)}|${repeatY.toFixed(3)}|${anisotropy}`;
    const cached = worldTextureCloneCache.get(key);
    if (cached) return cached;

    const clone = source.clone();
    clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(repeatX, repeatY);
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.anisotropy = anisotropy;
    clone.needsUpdate = true;
    worldTextureCloneCache.set(key, clone);
    return clone;
  }, [gl, path, repeatX, repeatY, source]);
}

const Structures = memo(function Structures({ map, castleWallContext, input, world, discoveryRevision, floor, indoorBuildingId, onHover }: { map: NonNullable<WorldState["map"]>; castleWallContext: readonly Position[]; input: InputController; world: WorldState; discoveryRevision: number; floor: number; indoorBuildingId: string | null; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
  const buildings = useMemo(() => map.buildings.filter((entry) => entry.floor === floor), [floor, map.buildings]);
  return (
    <group>
      {/* TIBIAGAME_STREAMING_FIX_V19: static building shells are chunk batches. */}
      <BatchedBuildingStaticPrimitives buildings={buildings} />
      <BatchedHouseShells buildings={buildings} doors={map.doors} windows={map.windows} />
      <BatchedKeepWalls buildings={buildings} doors={map.doors} windows={map.windows} />
      {buildings.map((building) => <group key={building.id}>
        <Building building={building} doors={map.doors} windows={map.windows} input={input} />
        <GabledRoof building={building} wallHeight={buildingWallHeight(building)} roofVisible={building.id !== indoorBuildingId} roofFade={building.id !== indoorBuildingId ? 1 : 0.08} />
      </group>)}
      <StaticStructures map={map} castleWallContext={castleWallContext} input={input} world={world} discoveryRevision={discoveryRevision} floor={floor} buildings={buildings} onHover={onHover} />
    </group>
  );
});

const StaticStructures = memo(function StaticStructures({ map, castleWallContext, input, world, discoveryRevision: _discoveryRevision, floor, buildings, onHover }: { map: NonNullable<WorldState["map"]>; castleWallContext: readonly Position[]; input: InputController; world: WorldState; discoveryRevision: number; floor: number; buildings: readonly BuildingView[]; onHover: (hover: { label: string; x: number; y: number } | null) => void }) {
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
      <ConnectedWalls positions={map.castleWalls} contextPositions={castleWallContext} castle />
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
  // TIBIAGAME_STREAMING_FIX_V16
  const batches = useMemo(() => {
    const result = new Map<string, PooledStaticBatch>();

    for (const stair of stairs) {
      const position = stair.from.z === floor
        ? stair.from
        : stair.to.z === floor
          ? stair.to
          : null;
      if (!position) continue;

      const parent = pooledMatrix([
        position.x + 0.5,
        0.04,
        position.y + 0.5,
      ]);

      [0, 1, 2, 3].forEach((step) => {
        appendPooledPart(
          result,
          "stairs:step",
          pooledWorldGeometry.box,
          pooledWorldMaterial.stairStep,
          parent,
          [(step - 1.5) * 0.18, step * 0.075, 0],
          [0, 0, 0],
          [0.22, 0.12, 0.78],
        );
      });
      appendPooledPart(
        result,
        "stairs:base",
        pooledWorldGeometry.box,
        pooledWorldMaterial.stairBase,
        parent,
        [0, 0.02, 0],
        [0, 0, 0],
        [0.95, 0.035, 0.95],
      );
    }

    return [...result.values()];
  }, [floor, stairs]);

  return <group>{batches.map((batch) => <PooledStaticBatchMesh key={batch.key} batch={batch} />)}</group>;
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
    onContextMenu={(event) => { event.stopPropagation(); input.interactWorldObject(object.id, object.position); }}
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

// TIBIAGAME_STREAMING_FIX_V16
// Shared immutable primitives for repeated static props. These objects live for
// the renderer lifetime and are referenced by all retained chunks.
const pooledWorldGeometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  bogCircle: new THREE.CircleGeometry(1, 12),
  reedStem: new THREE.CylinderGeometry(0.017, 0.025, 1, 5),
  wellBody: new THREE.CylinderGeometry(0.42, 0.48, 1, 10),
  wellRing: new THREE.TorusGeometry(0.34, 0.09, 6, 10),
  sphere10x8: new THREE.SphereGeometry(1, 10, 8),
  sphere8x7: new THREE.SphereGeometry(1, 8, 7),
  sphere8x6: new THREE.SphereGeometry(1, 8, 6),
  bone: new THREE.CylinderGeometry(0.035, 0.04, 1, 7),
  rock: new THREE.DodecahedronGeometry(1, 0),
  mushroomStem: new THREE.CylinderGeometry(0.025, 0.035, 1, 6),
  campLog: new THREE.CylinderGeometry(0.07, 0.08, 1, 7),
  campFlame: new THREE.ConeGeometry(0.16, 1, 8),
  hayBody: new THREE.CylinderGeometry(0.27, 0.27, 1, 10),
  hayBand: new THREE.TorusGeometry(0.275, 0.018, 5, 12),
} as const;

const pooledWorldMaterial = {
  noticePost: new THREE.MeshStandardMaterial({ color: "#553a24", roughness: 1 }),
  noticeBoard: new THREE.MeshStandardMaterial({ color: "#765038", roughness: 0.95 }),
  noticePaper: new THREE.MeshStandardMaterial({ color: "#d1be8a", roughness: 1 }),
  bog: new THREE.MeshStandardMaterial({ color: "#17231f", roughness: 0.38, metalness: 0.12 }),
  reedStem: new THREE.MeshStandardMaterial({ color: "#526a36", roughness: 0.96 }),
  reedLeaf: new THREE.MeshStandardMaterial({ color: "#6f873f", roughness: 0.92, side: THREE.DoubleSide }),
  plank: new THREE.MeshStandardMaterial({ color: "#66452d", roughness: 1 }),
  plankDark: new THREE.MeshStandardMaterial({ color: "#4d392a", roughness: 1 }),
  wellBody: new THREE.MeshStandardMaterial({ color: "#77807b", roughness: 0.98 }),
  wellRing: new THREE.MeshStandardMaterial({ color: "#58615d", roughness: 0.95 }),
  crate: new THREE.MeshStandardMaterial({ color: "#855833", roughness: 0.92 }),
  crateBand: new THREE.MeshStandardMaterial({ color: "#4f321f", roughness: 1 }),
  sack: new THREE.MeshStandardMaterial({ color: "#b39a6a", roughness: 1 }),
  sackTie: new THREE.MeshStandardMaterial({ color: "#7c6542", roughness: 1 }),
  bone: new THREE.MeshStandardMaterial({ color: "#cfc4a2", roughness: 0.95 }),
  skull: new THREE.MeshStandardMaterial({ color: "#bfb28f", roughness: 0.96 }),
  rock: new THREE.MeshStandardMaterial({ color: "#7a807b", roughness: 0.99 }),
  rockDark: new THREE.MeshStandardMaterial({ color: "#666d69", roughness: 0.99 }),
  mushroomStem: new THREE.MeshStandardMaterial({ color: "#d8c6a1", roughness: 1 }),
  mushroom: new THREE.MeshStandardMaterial({ color: "#9c6048", roughness: 0.9 }),
  mushroomBright: new THREE.MeshStandardMaterial({ color: "#c68155", roughness: 0.9 }),
  log: new THREE.MeshStandardMaterial({ color: "#5d3924", roughness: 1 }),
  flame: new THREE.MeshStandardMaterial({
    color: "#ff9a38",
    emissive: "#e84d16",
    emissiveIntensity: 1.8,
    toneMapped: false,
  }),
  hay: new THREE.MeshStandardMaterial({ color: "#b49543", roughness: 1 }),
  hayBand: new THREE.MeshStandardMaterial({ color: "#6f5930", roughness: 1 }),
  fencePost: new THREE.MeshStandardMaterial({ color: "#6e482d", roughness: 1 }),
  fenceRail: new THREE.MeshStandardMaterial({ color: "#805638", roughness: 1 }),
  furnitureTop: new THREE.MeshStandardMaterial({ color: "#80502d", roughness: 0.9 }),
  furnitureLeg: new THREE.MeshStandardMaterial({ color: "#61391f", roughness: 1 }),
  stairStep: new THREE.MeshStandardMaterial({ color: "#9a6338", roughness: 0.9 }),
  stairBase: new THREE.MeshStandardMaterial({ color: "#5f432d", roughness: 1 }),
  // TIBIAGAME_STREAMING_FIX_V19
  buildingFloorHouse: new THREE.MeshStandardMaterial({ color: "#765b42", roughness: 0.96 }),
  buildingFloorKeep: new THREE.MeshStandardMaterial({ color: "#666763", roughness: 0.96 }),
  battlement: new THREE.MeshStandardMaterial({ color: "#87908c", roughness: 0.96 }),
  buildingSignArm: new THREE.MeshStandardMaterial({ color: "#35251a", roughness: 1 }),
  buildingSignPost: new THREE.MeshStandardMaterial({ color: "#2d2017", roughness: 1 }),
  buildingSignBoard: new THREE.MeshStandardMaterial({ color: "#785331", roughness: 0.92 }),
} as const;

type PooledStaticBatch = {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: number[];
};

function pooledMatrix(
  position: readonly number[],
  rotation: readonly number[] = [0, 0, 0],
  scale: readonly number[] = [1, 1, 1],
) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    ),
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  );
}

function pooledChild(
  parent: THREE.Matrix4,
  position: readonly number[],
  rotation: readonly number[] = [0, 0, 0],
) {
  return new THREE.Matrix4().multiplyMatrices(
    parent,
    pooledMatrix(position, rotation),
  );
}

function appendPooledPart(
  batches: Map<string, PooledStaticBatch>,
  key: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Matrix4,
  position: readonly number[] = [0, 0, 0],
  rotation: readonly number[] = [0, 0, 0],
  scale: readonly number[] = [1, 1, 1],
) {
  let batch = batches.get(key);
  if (!batch) {
    batch = { key, geometry, material, matrices: [] };
    batches.set(key, batch);
  }

  const matrix = new THREE.Matrix4().multiplyMatrices(
    parent,
    pooledMatrix(position, rotation, scale),
  );
  for (const value of matrix.elements) batch.matrices.push(value);
}

function PooledStaticBatchMesh({
  batch,
}: {
  batch: PooledStaticBatch;
}) {
  const mesh = useMemo(() => {
    const count = batch.matrices.length / 16;
    const instance = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      count,
    );
    instance.castShadow = true;
    instance.receiveShadow = true;
    // TIBIAGAME_STREAMING_FIX_V20
    // These chunks are already spatially bounded around the player. Avoid an
    // O(instance-count) bounding-sphere build every time an idle chunk mounts.
    instance.frustumCulled = false;
    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    instance.instanceMatrix.array.set(batch.matrices);
    instance.instanceMatrix.needsUpdate = true;
    return instance;
  }, [batch]);

  return <primitive object={mesh} dispose={null} />;
}

function WorldObjects({ objects }: { objects: readonly WorldObjectView[] }) {
  // TIBIAGAME_STREAMING_FIX_V16
  // Static props are converted to a small set of InstancedMesh batches instead
  // of allocating geometry/material objects for every prop in every chunk.
  const batches = useMemo(() => {
    const result = new Map<string, PooledStaticBatch>();

    for (const object of objects) {
      const x = object.position.x + 0.5;
      const z = object.position.y + 0.5;

      if (object.kind === "notice_post") {
        const parent = pooledMatrix([x, 0, z], [0, 0.28, 0]);
        appendPooledPart(result, "notice:post", pooledWorldGeometry.box, pooledWorldMaterial.noticePost, parent, [0, 0.42, 0], [0, 0, 0], [0.08, 0.84, 0.08]);
        appendPooledPart(result, "notice:board", pooledWorldGeometry.box, pooledWorldMaterial.noticeBoard, parent, [0, 0.67, 0.015], [0, 0, 0], [0.56, 0.38, 0.055]);
        appendPooledPart(result, "notice:paper", pooledWorldGeometry.plane, pooledWorldMaterial.noticePaper, parent, [0, 0.68, 0.047], [0, 0, 0], [0.4, 0.25, 1]);
        continue;
      }

      if (object.kind === "bog_slick") {
        appendPooledPart(result, "bog", pooledWorldGeometry.bogCircle, pooledWorldMaterial.bog, pooledMatrix([x, 0, z]), [0, 0.012, 0], [-Math.PI / 2, 0, 0], [0.46, 0.46, 1]);
        continue;
      }

      if (object.kind === "bent_reeds") {
        const parent = pooledMatrix([x, 0, z], [0, 0.82, -0.18]);
        [-0.23, -0.08, 0.08, 0.22].forEach((offset, index) => {
          const reed = pooledChild(
            parent,
            [offset, 0, (index % 2 - 0.5) * 0.12],
            [0, 0, 0.24 + index * 0.06],
          );
          appendPooledPart(result, "reed:stem", pooledWorldGeometry.reedStem, pooledWorldMaterial.reedStem, reed, [0, 0.34 + index * 0.025, 0], [0, 0, 0], [1, 0.7 + index * 0.05, 1]);
          appendPooledPart(result, "reed:leaf", pooledWorldGeometry.plane, pooledWorldMaterial.reedLeaf, reed, [0.07, 0.61 + index * 0.04, 0], [0, 0, -0.48], [0.18, 0.045, 1]);
        });
        continue;
      }

      if (object.kind === "wrecked_planks") {
        const parent = pooledMatrix([x, 0.08, z], [0, 0.36, 0]);
        [-0.22, 0, 0.22].forEach((offset, index) => {
          appendPooledPart(
            result,
            index === 1 ? "plank:dark" : "plank",
            pooledWorldGeometry.box,
            index === 1 ? pooledWorldMaterial.plankDark : pooledWorldMaterial.plank,
            parent,
            [offset, index * 0.025, (index - 1) * 0.12],
            [0, 0.22 * (index - 1), 0.1 * (index - 1)],
            [0.62, 0.09, 0.16],
          );
        });
        continue;
      }

      if (object.kind === "well") {
        const parent = pooledMatrix([x, 0, z]);
        appendPooledPart(result, "well:body", pooledWorldGeometry.wellBody, pooledWorldMaterial.wellBody, parent, [0, 0.3, 0], [0, 0, 0], [1, 0.55, 1]);
        appendPooledPart(result, "well:ring", pooledWorldGeometry.wellRing, pooledWorldMaterial.wellRing, parent, [0, 0.59, 0]);
        continue;
      }

      if (object.kind === "wooden_crate") {
        const parent = pooledMatrix([x, 0, z]);
        appendPooledPart(result, "crate:body", pooledWorldGeometry.box, pooledWorldMaterial.crate, parent, [0, 0.28, 0], [0, 0, 0], [0.66, 0.56, 0.66]);
        appendPooledPart(result, "crate:band", pooledWorldGeometry.box, pooledWorldMaterial.crateBand, parent, [0, 0.29, 0.35], [0, 0, 0], [0.72, 0.08, 0.06]);
        appendPooledPart(result, "crate:band", pooledWorldGeometry.box, pooledWorldMaterial.crateBand, parent, [0, 0.29, -0.35], [0, 0, 0], [0.72, 0.08, 0.06]);
        continue;
      }

      if (object.kind === "grain_sack") {
        const parent = pooledMatrix([x, 0, z]);
        appendPooledPart(result, "sack", pooledWorldGeometry.sphere10x8, pooledWorldMaterial.sack, parent, [0, 0.3, 0], [0, 0, 0], [0.2652, 0.3672, 0.238]);
        appendPooledPart(result, "sack:tie", pooledWorldGeometry.sphere10x8, pooledWorldMaterial.sackTie, parent, [0, 0.64, 0], [0, 0, 0], [0.09, 0.09, 0.09]);
        continue;
      }

      if (object.kind === "bone_pile") {
        const parent = pooledMatrix([x, 0.08, z]);
        [
          [-0.18, 0.1, -0.08, 0.7],
          [0.13, 0.12, 0.12, -0.55],
          [-0.02, 0.15, 0.2, 1.1],
        ].forEach(([bx, by, bz, rot]) => {
          appendPooledPart(result, "bone", pooledWorldGeometry.bone, pooledWorldMaterial.bone, parent, [bx, by, bz], [Math.PI / 2, rot, 0], [1, 0.48, 1]);
        });
        appendPooledPart(result, "skull", pooledWorldGeometry.sphere8x7, pooledWorldMaterial.skull, parent, [0.22, 0.18, -0.14], [0, 0, 0], [0.14, 0.14, 0.14]);
        continue;
      }

      if (object.kind === "rock_pile") {
        const parent = pooledMatrix([x, 0, z]);
        [
          [-0.18, 0.17, 0.02, 0.24],
          [0.16, 0.2, 0.1, 0.3],
          [0.03, 0.28, -0.14, 0.25],
        ].forEach(([rx, ry, rz, radius], index) => {
          appendPooledPart(
            result,
            index === 1 ? "rock:dark" : "rock",
            pooledWorldGeometry.rock,
            index === 1 ? pooledWorldMaterial.rockDark : pooledWorldMaterial.rock,
            parent,
            [rx, ry, rz],
            [0, 0, 0],
            [radius, radius, radius],
          );
        });
        continue;
      }

      if (object.kind === "mushroom_patch") {
        const parent = pooledMatrix([x, 0, z]);
        [
          [-0.2, 0.12, -0.08, 0.12],
          [0.12, 0.16, 0.05, 0.15],
          [0.24, 0.1, -0.18, 0.1],
        ].forEach(([mx, my, mz, size], index) => {
          appendPooledPart(result, "mushroom:stem", pooledWorldGeometry.mushroomStem, pooledWorldMaterial.mushroomStem, parent, [mx, my * 0.55, mz], [0, 0, 0], [1, my, 1]);
          appendPooledPart(
            result,
            index === 1 ? "mushroom:bright" : "mushroom",
            pooledWorldGeometry.sphere8x6,
            index === 1 ? pooledWorldMaterial.mushroomBright : pooledWorldMaterial.mushroom,
            parent,
            [mx, my + 0.015, mz],
            [0, 0, 0],
            [size, size * 0.45, size],
          );
        });
        continue;
      }

      if (object.kind === "campfire") {
        const parent = pooledMatrix([x, 0, z]);
        appendPooledPart(result, "camp:log", pooledWorldGeometry.campLog, pooledWorldMaterial.log, parent, [0, 0.1, 0], [0, 0.7, Math.PI / 2], [1, 0.62, 1]);
        appendPooledPart(result, "camp:log", pooledWorldGeometry.campLog, pooledWorldMaterial.log, parent, [0, 0.1, 0], [0, -0.7, Math.PI / 2], [1, 0.62, 1]);
        appendPooledPart(result, "camp:flame", pooledWorldGeometry.campFlame, pooledWorldMaterial.flame, parent, [0, 0.37, 0], [0, 0, 0], [1, 0.55, 1]);
        continue;
      }

      if (object.kind === "hay_bundle") {
        const parent = pooledMatrix([x, 0.22, z], [0, 0.25, Math.PI / 2]);
        appendPooledPart(result, "hay:body", pooledWorldGeometry.hayBody, pooledWorldMaterial.hay, parent, [0, 0, 0], [0, 0, 0], [1, 0.68, 1]);
        [-0.2, 0.2].forEach((offset) => {
          appendPooledPart(result, "hay:band", pooledWorldGeometry.hayBand, pooledWorldMaterial.hayBand, parent, [0, offset, 0]);
        });
        continue;
      }

      if (object.kind === "fence_post") {
        const parent = pooledMatrix([x, 0, z]);
        appendPooledPart(result, "fence:post", pooledWorldGeometry.box, pooledWorldMaterial.fencePost, parent, [0, 0.52, 0], [0, 0, 0], [0.13, 1.04, 0.13]);
        appendPooledPart(result, "fence:rail", pooledWorldGeometry.box, pooledWorldMaterial.fenceRail, parent, [0, 0.62, 0], [0, 0, 0], [0.82, 0.11, 0.1]);
        appendPooledPart(result, "fence:rail", pooledWorldGeometry.box, pooledWorldMaterial.fenceRail, parent, [0, 0.34, 0], [0, 0, 0], [0.82, 0.11, 0.1]);
        continue;
      }

      const isTable = object.kind === "table";
      const parent = pooledMatrix([x, 0, z]);
      appendPooledPart(
        result,
        isTable ? "furniture:table" : "furniture:other",
        pooledWorldGeometry.box,
        pooledWorldMaterial.furnitureTop,
        parent,
        [0, isTable ? 0.58 : 0.35, 0],
        [0, 0, 0],
        [isTable ? 0.78 : 0.9, 0.13, isTable ? 0.58 : 0.25],
      );
      if (isTable) {
        [-0.29, 0.29].forEach((dx) => {
          [-0.2, 0.2].forEach((dz) => {
            appendPooledPart(result, "furniture:leg", pooledWorldGeometry.box, pooledWorldMaterial.furnitureLeg, parent, [dx, 0.28, dz], [0, 0, 0], [0.1, 0.56, 0.1]);
          });
        });
      }
    }

    return [...result.values()];
  }, [objects]);

  return <group>{batches.map((batch) => <PooledStaticBatchMesh key={batch.key} batch={batch} />)}</group>;
}

// TIBIAGAME_STREAMING_FIX_V19
type StaticBuildingWallSegment = {
  position: [number, number, number];
  size: [number, number, number];
  window?: WindowView;
  door?: DoorView;
};

function staticBuildingWallSegments(
  building: BuildingView,
  doors: readonly DoorView[],
  windows: readonly WindowView[],
): StaticBuildingWallSegment[] {
  const height = buildingWallHeight(building);
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  const matchingDoors = doors.filter(
    (door) => door.position.z === building.floor
      && insideBuilding(door.position, building),
  );
  const doorsByKey = new Map(
    matchingDoors.map((door) => [
      `${door.position.x}:${door.position.y}`,
      door,
    ]),
  );
  const matchingWindows = windows.filter(
    (window) => window.position.z === building.floor
      && insideBuilding(window.position, building),
  );
  const windowsByKey = new Map(
    matchingWindows.map((window) => [
      `${window.position.x}:${window.position.y}`,
      window,
    ]),
  );

  const segments: StaticBuildingWallSegment[] = [];
  for (let x = building.x; x < maxX; x += 1) {
    segments.push({
      position: [x + 0.5, height / 2, building.y],
      size: [1.04, height, 0.13],
      window: windowsByKey.get(`${x}:${building.y}`),
      door: doorsByKey.get(`${x}:${building.y}`),
    });
    segments.push({
      position: [x + 0.5, height / 2, maxY],
      size: [1.04, height, 0.13],
      window: windowsByKey.get(`${x}:${maxY - 1}`),
      door: doorsByKey.get(`${x}:${maxY - 1}`),
    });
  }

  for (let y = building.y; y < maxY; y += 1) {
    segments.push({
      position: [building.x, height / 2, y + 0.5],
      size: [0.13, height, 1.04],
      window: windowsByKey.get(`${building.x}:${y}`),
      door: doorsByKey.get(`${building.x}:${y}`),
    });
    segments.push({
      position: [maxX, height / 2, y + 0.5],
      size: [0.13, height, 1.04],
      window: windowsByKey.get(`${maxX - 1}:${y}`),
      door: doorsByKey.get(`${maxX - 1}:${y}`),
    });
  }

  return segments;
}

function BatchedHouseShells({
  buildings,
  doors,
  windows,
}: {
  buildings: readonly BuildingView[];
  doors: readonly DoorView[];
  windows: readonly WindowView[];
}) {
  const { plinths, walls } = useMemo(() => {
    const nextPlinths: StaticBuildingWallSegment[] = [];
    const nextWalls: StaticBuildingWallSegment[] = [];

    for (const building of buildings) {
      if (building.kind !== "house") continue;
      for (const segment of staticBuildingWallSegments(
        building,
        doors,
        windows,
      )) {
        if (!segment.door) nextPlinths.push(segment);
        if (!segment.door && !segment.window) nextWalls.push(segment);
      }
    }

    return {
      plinths: nextPlinths,
      walls: nextWalls,
    };
  }, [buildings, doors, windows]);

  return (
    <group userData={{ occluder: true }}>
      <InstancedHousePlinths segments={plinths} />
      <InstancedHouseWalls segments={walls} />
    </group>
  );
}

function BatchedKeepWalls({
  buildings,
  doors,
  windows,
}: {
  buildings: readonly BuildingView[];
  doors: readonly DoorView[];
  windows: readonly WindowView[];
}) {
  const texture = useWorldTexture(
    "/assets/world/aldoria-castle-stone-v2.png",
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    map: texture,
    color: "#6d7773",
    roughness: 1,
  }), [texture]);

  const segments = useMemo(() => {
    const next: StaticBuildingWallSegment[] = [];
    for (const building of buildings) {
      if (building.kind === "house") continue;
      for (const segment of staticBuildingWallSegments(
        building,
        doors,
        windows,
      )) {
        if (!segment.door) next.push(segment);
      }
    }
    return next;
  }, [buildings, doors, windows]);

  const mesh = useMemo(() => {
    if (!segments.length) return null;

    const instance = new THREE.InstancedMesh(
      pooledWorldGeometry.box,
      material,
      segments.length,
    );
    instance.castShadow = true;
    instance.receiveShadow = true;
    instance.userData.occluder = true;
    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();

    segments.forEach((segment, index) => {
      position.set(...segment.position);
      scale.set(...segment.size);
      matrix.compose(position, rotation, scale);
      instance.setMatrixAt(index, matrix);
    });
    instance.instanceMatrix.needsUpdate = true;
    // TIBIAGAME_STREAMING_FIX_V20
    instance.frustumCulled = false;
    return instance;
  }, [material, segments]);

  useEffect(() => () => material.dispose(), [material]);

  return mesh ? <primitive object={mesh} /> : null;
}

function BatchedBuildingStaticPrimitives({
  buildings,
}: {
  buildings: readonly BuildingView[];
}) {
  const batches = useMemo(() => {
    const result = new Map<string, PooledStaticBatch>();

    for (const building of buildings) {
      appendPooledPart(
        result,
        building.kind === "keep"
          ? "building:floor:keep"
          : "building:floor:house",
        pooledWorldGeometry.box,
        building.kind === "keep"
          ? pooledWorldMaterial.buildingFloorKeep
          : pooledWorldMaterial.buildingFloorHouse,
        pooledMatrix([
          building.x + building.width / 2,
          0.035,
          building.y + building.height / 2,
        ]),
        [0, 0, 0],
        [0, 0, 0],
        [
          Math.max(0.2, building.width - 0.18),
          0.07,
          Math.max(0.2, building.height - 0.18),
        ],
      );

      if (building.kind === "house") {
        const signParent = pooledMatrix(
          [
            building.x + building.width - 0.35,
            buildingWallHeight(building) * 0.72,
            building.y - 0.18,
          ],
          [0, 0, 0],
          [1.15, 1.15, 1.15],
        );

        appendPooledPart(
          result,
          "building:sign:arm",
          pooledWorldGeometry.box,
          pooledWorldMaterial.buildingSignArm,
          signParent,
          [0, 0.25, 0],
          [0, 0, 0],
          [0.55, 0.055, 0.055],
        );
        appendPooledPart(
          result,
          "building:sign:post",
          pooledWorldGeometry.box,
          pooledWorldMaterial.buildingSignPost,
          signParent,
          [0.2, -0.05, 0],
          [0, 0, 0],
          [0.06, 0.55, 0.06],
        );
        appendPooledPart(
          result,
          "building:sign:board",
          pooledWorldGeometry.box,
          pooledWorldMaterial.buildingSignBoard,
          signParent,
          [0.2, -0.34, 0],
          [0, 0, 0],
          [0.52, 0.34, 0.07],
        );
      }

      if (building.kind === "keep") {
        const height = buildingWallHeight(building);
        for (
          let x = building.x;
          x <= building.x + building.width;
          x += 0.65
        ) {
          appendPooledPart(
            result,
            "building:battlement",
            pooledWorldGeometry.box,
            pooledWorldMaterial.battlement,
            pooledMatrix([x, height + 0.24, building.y]),
            [0, 0, 0],
            [0, 0, 0],
            [0.34, 0.48, 0.34],
          );
          appendPooledPart(
            result,
            "building:battlement",
            pooledWorldGeometry.box,
            pooledWorldMaterial.battlement,
            pooledMatrix([
              x,
              height + 0.24,
              building.y + building.height,
            ]),
            [0, 0, 0],
            [0, 0, 0],
            [0.34, 0.48, 0.34],
          );
        }

        for (
          let y = building.y + 0.65;
          y < building.y + building.height;
          y += 0.65
        ) {
          appendPooledPart(
            result,
            "building:battlement",
            pooledWorldGeometry.box,
            pooledWorldMaterial.battlement,
            pooledMatrix([building.x, height + 0.24, y]),
            [0, 0, 0],
            [0, 0, 0],
            [0.34, 0.48, 0.34],
          );
          appendPooledPart(
            result,
            "building:battlement",
            pooledWorldGeometry.box,
            pooledWorldMaterial.battlement,
            pooledMatrix([
              building.x + building.width,
              height + 0.24,
              y,
            ]),
            [0, 0, 0],
            [0, 0, 0],
            [0.34, 0.48, 0.34],
          );
        }
      }
    }

    return [...result.values()];
  }, [buildings]);

  return (
    <group>
      {batches.map((batch) => (
        <PooledStaticBatchMesh key={batch.key} batch={batch} />
      ))}
    </group>
  );
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
      <group userData={{ occluder: true }}>
        {wallSegments.map((wall) => (
          wall.door
            ? building.kind === "house"
              ? <HouseDoorway key={wall.key} position={wall.position} size={wall.size} wallRotation={wall.rotation} layout={createHouseDoorwayLayout(height, Math.max(wall.size[0], wall.size[2]))} open={wall.door.open} onClick={() => input.toggleDoor(wall.door!.id, wall.door!.position)} />
              : <MedievalDoorWall key={wall.key} position={wall.position} size={wall.size} keep openingHeight={Math.min(height - 0.15, DOOR_HEIGHT) + 0.1} />
            : wall.window && building.kind === "house"
            ? <HouseWindowOpening key={wall.key} position={wall.position} size={wall.size} wallRotation={wall.rotation} layout={createHouseWindowLayout(height, Math.max(wall.size[0], wall.size[2]))} open={wall.window.open} onClick={() => input.toggleWindow(wall.window!.id, wall.window!.position)} />
            : null
        ))}
        {building.kind !== "house" && matchingDoors.map((door) => <Door key={door.id} door={door} building={building} input={input} tall={height} showBeacon={false} />)}
        {building.kind !== "house" && matchingWindows.map((window) => <ShutterWindow key={window.id} window={window} building={building} wallHeight={height} onClick={() => input.toggleWindow(window.id, window.position)} />)}
      </group>
      {matchingDoors.map((door) => <DoorBeacon key={`beacon-${door.id}`} door={door} building={building} onOpen={() => input.toggleDoor(door.id, door.position)} />)}
    </group>
  );
});

function buildingWallHeight(building: BuildingView) {
  return building.kind === "keep" ? CASTLE_HEIGHT : WALL_HEIGHT;
}

function ConnectedWalls({
  positions,
  contextPositions = positions,
  castle,
}: {
  positions: readonly Position[];
  contextPositions?: readonly Position[];
  castle: boolean;
}) {
  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;
  const castleTexture = useWorldTexture(
    "/assets/world/aldoria-castle-stone-v2.png",
    1.35,
    1.35,
  );
  const material = usePersistentConnectedWallMaterial(
    castle,
    castleTexture,
  );

  // TIBIAGAME_STREAMING_FIX_V20
  const matrices = useMemo(() => {
    if (positions.length === 0) return [] as THREE.Matrix4[];

    const set = new Set(contextPositions.map(tileKey));
    const thickness = castle ? 0.28 : 0.18;
    const centerSize = castle ? 0.3 : 0.24;
    const connectorLength = Math.max(0.1, 1 - centerSize);
    const next: THREE.Matrix4[] = [];

    for (const tile of positions) {
      const x = tile.x + 0.5;
      const z = tile.y + 0.5;
      next.push(persistentInstanceMatrix(
        [x, height / 2, z],
        [0, 0, 0],
        [centerSize, height, centerSize],
      ));

      if (set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)) {
        next.push(persistentInstanceMatrix(
          [x + 0.5, height / 2, z],
          [0, 0, 0],
          [connectorLength, height, thickness],
        ));
      }
      if (set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)) {
        next.push(persistentInstanceMatrix(
          [x, height / 2, z + 0.5],
          [0, 0, 0],
          [thickness, height, connectorLength],
        ));
      }
      if (castle) {
        next.push(persistentInstanceMatrix(
          [x, height + 0.18, z],
          [0, 0, 0],
          [0.25, 0.36, 0.25],
        ));
      }
    }

    return next;
  }, [castle, contextPositions, height, positions]);

  return (
    <PersistentStaticInstances
      geometry={persistentStaticGeometry.box}
      material={material}
      matrices={matrices}
      capacity={PERSISTENT_WALL_INSTANCE_CAPACITY}
      userData={{ occluder: true }}
    />
  );
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

function InstancedTrees({
  positions,
  variant = "forest",
}: {
  positions: readonly Position[];
  variant?: "forest" | "pine" | "snowy";
}) {
  // TIBIAGAME_STREAMING_FIX_V20
  // Occlusion has been disabled since V11. The old 6x6 occlusion buckets were
  // still multiplying mesh/components per retained chunk for no visual benefit.
  return <InstancedTreeBatch positions={positions} variant={variant} />;
}

function InstancedTreeBatch({
  positions,
  variant,
}: {
  positions: readonly Position[];
  variant: "forest" | "pine" | "snowy";
}) {
  const pine = variant !== "forest";
  const snowy = variant === "snowy";

  // TIBIAGAME_STREAMING_FIX_V20
  const { trunks, lower, upper } = useMemo(() => {
    const trunkMatrices: THREE.Matrix4[] = [];
    const lowerMatrices: THREE.Matrix4[] = [];
    const upperMatrices: THREE.Matrix4[] = [];
    const scale = pine
      ? [1.04, 1.18, 1.04] as const
      : [1.18, 1.22, 1.18] as const;

    for (const position of positions) {
      const rotation = [0, stablePhase(tileKey(position)), 0] as const;
      trunkMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 0.72, position.y + 0.5],
        rotation,
        scale,
      ));
      lowerMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 1.75, position.y + 0.5],
        rotation,
        scale,
      ));
      upperMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 2.35, position.y + 0.5],
        rotation,
        scale,
      ));
    }

    return {
      trunks: trunkMatrices,
      lower: lowerMatrices,
      upper: upperMatrices,
    };
  }, [pine, positions]);

  return (
    <group userData={{ occluder: true }}>
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.treeTrunk}
        material={persistentStaticMaterial.treeTrunk}
        matrices={trunks}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
      />
      <PersistentStaticInstances
        geometry={pine
          ? persistentStaticGeometry.pineLower
          : persistentStaticGeometry.forestLower}
        material={snowy
          ? persistentStaticMaterial.snowyLower
          : pine
            ? persistentStaticMaterial.pineLower
            : persistentStaticMaterial.forestLower}
        matrices={lower}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
        receiveShadow={false}
      />
      <PersistentStaticInstances
        geometry={pine
          ? persistentStaticGeometry.pineUpper
          : persistentStaticGeometry.forestUpper}
        material={snowy
          ? persistentStaticMaterial.snowyUpper
          : pine
            ? persistentStaticMaterial.pineUpper
            : persistentStaticMaterial.forestUpper}
        matrices={upper}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
        receiveShadow={false}
      />
    </group>
  );
}

function InstancedMountainWalls({
  positions,
}: {
  positions: readonly Position[];
}) {
  // TIBIAGAME_STREAMING_FIX_V20
  const { bases, caps } = useMemo(() => {
    const baseMatrices: THREE.Matrix4[] = [];
    const capMatrices: THREE.Matrix4[] = [];

    for (const position of positions) {
      baseMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 0.78, position.y + 0.5],
        [0, 0, 0],
        [1, 1.56, 0.9],
      ));
      capMatrices.push(persistentInstanceMatrix(
        [position.x + 0.32, 1.62, position.y + 0.55],
      ));
    }

    return {
      bases: baseMatrices,
      caps: capMatrices,
    };
  }, [positions]);

  return (
    <group>
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.box}
        material={persistentStaticMaterial.mountainBase}
        matrices={bases}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
      />
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.mountainCap}
        material={persistentStaticMaterial.mountainCap}
        matrices={caps}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
        receiveShadow={false}
      />
    </group>
  );
}

function InstancedSimpleObjects({
  positions,
  kind,
}: {
  positions: readonly Position[];
  kind: "snow-bank" | "barrel";
}) {
  // TIBIAGAME_STREAMING_FIX_V20
  const matrices = useMemo(() => positions.map((position) =>
    persistentInstanceMatrix([
      position.x + 0.5,
      kind === "barrel" ? 0.28 : 0.22,
      position.y + 0.5,
    ])
  ), [kind, positions]);

  return (
    <PersistentStaticInstances
      geometry={kind === "barrel"
        ? persistentStaticGeometry.barrel
        : persistentStaticGeometry.snowBank}
      material={kind === "barrel"
        ? persistentStaticMaterial.barrel
        : persistentStaticMaterial.snowBank}
      matrices={matrices}
      capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
    />
  );
}

function InstancedTorches({
  positions,
}: {
  positions: readonly Position[];
}) {
  // TIBIAGAME_STREAMING_FIX_V20
  // Shared materials/geometries remove one geometry/material pair and one
  // useFrame callback per retained chunk. Lighting still comes from Atmosphere.
  const { posts, flames } = useMemo(() => {
    const postMatrices: THREE.Matrix4[] = [];
    const flameMatrices: THREE.Matrix4[] = [];

    for (const position of positions) {
      postMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 0.62, position.y + 0.5],
        [0, 0, 0],
        [1.15, 1.15, 1.15],
      ));
      flameMatrices.push(persistentInstanceMatrix(
        [position.x + 0.5, 1.31, position.y + 0.5],
        [0, 0, 0],
        [1.15, 1.15, 1.15],
      ));
    }

    return {
      posts: postMatrices,
      flames: flameMatrices,
    };
  }, [positions]);

  return (
    <>
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.torchPost}
        material={persistentStaticMaterial.torchPost}
        matrices={posts}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
        receiveShadow={false}
      />
      <PersistentStaticInstances
        geometry={persistentStaticGeometry.torchFlame}
        material={persistentStaticMaterial.torchFlame}
        matrices={flames}
        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}
        castShadow={false}
        receiveShadow={false}
      />
    </>
  );
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

function OcclusionController({
  target: _target,
  visualTarget: _visualTarget,
  sceneRevision: _sceneRevision,
  floor: _floor,
  chunkX: _chunkX,
  chunkY: _chunkY,
}: {
  target?: Position;
  visualTarget: MutableRefObject<THREE.Vector3>;
  sceneRevision: string;
  floor: number;
  chunkX: number;
  chunkY: number;
}) {
  // TIBIAGAME_STREAMING_FIX_V11
  // Disabled while the renderer is stabilized.
  //
  // V5's `visible = false` made loaded world geometry look missing.
  // V10's attempt to prepare every occluder as transparent caused shader
  // program count to explode (7 -> ~139 in the supplied trace) and produced
  // severe stalls, especially across floors.
  //
  // The eventual fade implementation must use a small shared set of
  // precompiled fade materials/shaders. It must not mutate every source
  // material's `transparent` define at runtime.
  return null;
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

// TIBIAGAME_STREAMING_FIX_V9
const RETAINED_STATIC_CONTEXT_MARGIN = 1;

// TIBIAGAME_STREAMING_FIX_V13
function mergeTerrainPositionLayer(
  previous: Position[],
  incoming: readonly Position[],
): Position[] {
  // TIBIAGAME_STREAMING_FIX_V20_1
  // MapView owns mutable arrays. Keeping only incoming readonly avoids widening
  // the merged region into readonly Position[].
  if (incoming.length === 0) return previous;
  const known = new Set(previous.map(tileKey));
  let merged: Position[] | null = null;

  for (const entry of incoming) {
    const key = tileKey(entry);
    if (known.has(key)) continue;
    known.add(key);
    if (!merged) merged = [...previous];
    merged.push(entry);
  }

  return merged ?? previous;
}

function mergeTerrainMaterialLayer(
  previous: MapView["terrainMaterials"],
  incoming: MapView["terrainMaterials"],
) {
  if (incoming.length === 0) return previous;

  const indexByPosition = new Map(
    previous.map((entry, index) => [tileKey(entry.position), index]),
  );
  let merged: MapView["terrainMaterials"] | null = null;

  for (const entry of incoming) {
    const key = tileKey(entry.position);
    const existingIndex = indexByPosition.get(key);

    if (existingIndex === undefined) {
      if (!merged) merged = [...previous];
      indexByPosition.set(key, merged.length);
      merged.push(entry);
      continue;
    }

    const existing = (merged ?? previous)[existingIndex];
    if (existing.material === entry.material) continue;

    if (!merged) merged = [...previous];
    merged[existingIndex] = entry;
  }

  return merged ?? previous;
}

function mergeTerrainObjectMaskLayer(
  previous: MapView["objects"],
  incoming: MapView["objects"],
): WorldObjectView[] {
  // TIBIAGAME_STREAMING_FIX_V20_1
  // MapView.objects is optional for sparse/legacy authored regions.
  const previousObjects = previous ?? [];
  const incomingObjects = incoming ?? [];
  if (incomingObjects.length === 0) return previousObjects;

  const known = new Set(previousObjects.map((entry) => entry.id));
  let merged: WorldObjectView[] | null = null;

  for (const entry of incomingObjects) {
    if (known.has(entry.id)) continue;
    known.add(entry.id);
    if (!merged) merged = [...previousObjects];
    merged.push(entry);
  }

  return merged ?? previousObjects;
}

function mergeTerrainRenderRegion(
  previous: ReturnType<typeof createRenderRegion>,
  incoming: ReturnType<typeof createRenderRegion>,
) {
  const blocked = mergeTerrainPositionLayer(
    previous.map.blocked,
    incoming.map.blocked,
  );
  const water = mergeTerrainPositionLayer(
    previous.map.water,
    incoming.map.water,
  );
  const bridges = mergeTerrainPositionLayer(
    previous.map.bridges,
    incoming.map.bridges,
  );
  const trees = mergeTerrainPositionLayer(
    previous.map.trees,
    incoming.map.trees,
  );
  const roads = mergeTerrainPositionLayer(
    previous.map.roads,
    incoming.map.roads,
  );
  const floors = mergeTerrainPositionLayer(
    previous.map.floors,
    incoming.map.floors,
  );
  const houseWalls = mergeTerrainPositionLayer(
    previous.map.houseWalls,
    incoming.map.houseWalls,
  );
  const castleWalls = mergeTerrainPositionLayer(
    previous.map.castleWalls,
    incoming.map.castleWalls,
  );
  const terrainMaterials = mergeTerrainMaterialLayer(
    previous.map.terrainMaterials,
    incoming.map.terrainMaterials,
  );
  const objects = mergeTerrainObjectMaskLayer(
    previous.map.objects,
    incoming.map.objects,
  );

  const unchanged =
    blocked === previous.map.blocked
    && water === previous.map.water
    && bridges === previous.map.bridges
    && trees === previous.map.trees
    && roads === previous.map.roads
    && floors === previous.map.floors
    && houseWalls === previous.map.houseWalls
    && castleWalls === previous.map.castleWalls
    && terrainMaterials === previous.map.terrainMaterials
    && objects === previous.map.objects;

  if (unchanged) return previous;

  return {
    ...incoming,
    map: {
      ...incoming.map,
      blocked,
      water,
      bridges,
      trees,
      roads,
      floors,
      houseWalls,
      castleWalls,
      terrainMaterials,
      objects,
    },
  };
}

// TIBIAGAME_STREAMING_FIX_V14
function terrainRenderBoundsOverlap(a: RenderBounds, b: RenderBounds) {
  return a.minX < b.minX + b.width
    && a.minX + a.width > b.minX
    && a.minY < b.minY + b.height
    && a.minY + a.height > b.minY;
}

function terrainPositionInsideBounds(position: Position, bounds: RenderBounds) {
  return position.x >= bounds.minX
    && position.x < bounds.minX + bounds.width
    && position.y >= bounds.minY
    && position.y < bounds.minY + bounds.height;
}

function mergeOverlappingTerrainKnowledge(
  current: ReturnType<typeof createRenderRegion>,
  known: ReturnType<typeof createRenderRegion>,
  bounds: RenderBounds,
) {
  const blocked = mergeTerrainPositionLayer(
    current.map.blocked,
    known.map.blocked.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const water = mergeTerrainPositionLayer(
    current.map.water,
    known.map.water.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const bridges = mergeTerrainPositionLayer(
    current.map.bridges,
    known.map.bridges.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const trees = mergeTerrainPositionLayer(
    current.map.trees,
    known.map.trees.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const roads = mergeTerrainPositionLayer(
    current.map.roads,
    known.map.roads.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const floors = mergeTerrainPositionLayer(
    current.map.floors,
    known.map.floors.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const houseWalls = mergeTerrainPositionLayer(
    current.map.houseWalls,
    known.map.houseWalls.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );
  const castleWalls = mergeTerrainPositionLayer(
    current.map.castleWalls,
    known.map.castleWalls.filter((entry) => terrainPositionInsideBounds(entry, bounds)),
  );

  // Never let an older overlapping cache entry overwrite the current packet's
  // material choice for a tile. It may only contribute a material not known in
  // the current render slice yet.
  const materialKeys = new Set(current.map.terrainMaterials.map((entry) => tileKey(entry.position)));
  const terrainMaterials = mergeTerrainMaterialLayer(
    current.map.terrainMaterials,
    known.map.terrainMaterials.filter((entry) =>
      terrainPositionInsideBounds(entry.position, bounds)
      && !materialKeys.has(tileKey(entry.position)),
    ),
  );

  const currentObjects = current.map.objects ?? [];
  const knownObjects = known.map.objects ?? [];
  const objectIds = new Set(currentObjects.map((entry) => entry.id));
  const objects = mergeTerrainObjectMaskLayer(
    currentObjects,
    knownObjects.filter((entry) =>
      terrainPositionInsideBounds(entry.position, bounds)
      && !objectIds.has(entry.id),
    ),
  );

  const unchanged =
    blocked === current.map.blocked
    && water === current.map.water
    && bridges === current.map.bridges
    && trees === current.map.trees
    && roads === current.map.roads
    && floors === current.map.floors
    && houseWalls === current.map.houseWalls
    && castleWalls === current.map.castleWalls
    && terrainMaterials === current.map.terrainMaterials
    && objects === current.map.objects;

  if (unchanged) return current;

  return {
    ...current,
    map: {
      ...current.map,
      blocked,
      water,
      bridges,
      trees,
      roads,
      floors,
      houseWalls,
      castleWalls,
      terrainMaterials,
      objects,
    },
  };
}



// TIBIAGAME_STREAMING_FIX_V12
function renderBoundsFullyCovered(
  bounds: RenderBounds,
  floor: number,
  center: Position | null,
  radius: number,
  floorRadius: number,
  map: MapView,
) {
  if (!center || radius <= 0) return false;
  if (Math.abs(floor - center.z) > floorRadius) return false;

  const minTileX = Math.max(0, bounds.minX);
  const minTileY = Math.max(0, bounds.minY);
  const maxTileX = Math.min(map.width - 1, bounds.minX + bounds.width - 1);
  const maxTileY = Math.min(map.height - 1, bounds.minY + bounds.height - 1);

  const regionMinX = Math.max(0, center.x - radius);
  const regionMinY = Math.max(0, center.y - radius);
  const regionMaxX = Math.min(map.width - 1, center.x + radius);
  const regionMaxY = Math.min(map.height - 1, center.y + radius);

  return minTileX >= regionMinX
    && minTileY >= regionMinY
    && maxTileX <= regionMaxX
    && maxTileY <= regionMaxY;
}

function retainedChunkFullyCovered(
  floor: number,
  chunkX: number,
  chunkY: number,
  center: Position | null,
  radius: number,
  floorRadius: number,
  map: MapView,
) {
  if (!center || radius <= 0) return false;
  if (Math.abs(floor - center.z) > floorRadius) return false;

  const minTileX = Math.max(
    0,
    chunkX * RETAINED_STATIC_CHUNK_SIZE - RETAINED_STATIC_CONTEXT_MARGIN,
  );
  const minTileY = Math.max(
    0,
    chunkY * RETAINED_STATIC_CHUNK_SIZE - RETAINED_STATIC_CONTEXT_MARGIN,
  );
  const maxTileX = Math.min(
    map.width - 1,
    (chunkX + 1) * RETAINED_STATIC_CHUNK_SIZE - 1 + RETAINED_STATIC_CONTEXT_MARGIN,
  );
  const maxTileY = Math.min(
    map.height - 1,
    (chunkY + 1) * RETAINED_STATIC_CHUNK_SIZE - 1 + RETAINED_STATIC_CONTEXT_MARGIN,
  );

  const regionMinX = Math.max(0, center.x - radius);
  const regionMinY = Math.max(0, center.y - radius);
  const regionMaxX = Math.min(map.width - 1, center.x + radius);
  const regionMaxY = Math.min(map.height - 1, center.y + radius);

  return minTileX >= regionMinX
    && minTileY >= regionMinY
    && maxTileX <= regionMaxX
    && maxTileY <= regionMaxY;
}

function createRetainedStaticChunk(
  map: MapView,
  floor: number,
  chunkX: number,
  chunkY: number,
): RetainedStaticChunkData {
  const minX = Math.max(0, chunkX * RETAINED_STATIC_CHUNK_SIZE);
  const minY = Math.max(0, chunkY * RETAINED_STATIC_CHUNK_SIZE);
  const maxX = Math.min(map.width, (chunkX + 1) * RETAINED_STATIC_CHUNK_SIZE);
  const maxY = Math.min(map.height, (chunkY + 1) * RETAINED_STATIC_CHUNK_SIZE);
  const bounds: RenderBounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    floor,
  };

  const positions = (entries: readonly Position[]) =>
    entries.filter((entry) => insideRenderBounds(entry, bounds));

  // TIBIAGAME_STREAMING_FIX_V9
  // Context is data-only. It is not rendered by this chunk; ConnectedWalls
  // uses it only to detect neighbors across the core boundary.
  const castleWallContext = map.castleWalls.filter((entry) =>
    entry.z === floor
    && entry.x >= Math.max(0, minX - RETAINED_STATIC_CONTEXT_MARGIN)
    && entry.x < Math.min(map.width, maxX + RETAINED_STATIC_CONTEXT_MARGIN)
    && entry.y >= Math.max(0, minY - RETAINED_STATIC_CONTEXT_MARGIN)
    && entry.y < Math.min(map.height, maxY + RETAINED_STATIC_CONTEXT_MARGIN)
  );

  // A building is owned by the chunk containing its origin. It may extend
  // across a chunk boundary, but is rendered exactly once.
  const buildings = map.buildings.filter((building) =>
    building.floor === floor
    && building.x >= minX
    && building.x < maxX
    && building.y >= minY
    && building.y < maxY
  );
  const belongsToOwnedBuilding = (position: Position) =>
    buildings.some((building) => insideBuilding(position, building));

  const chunkMap: MapView = {
    ...map,
    blocked: positions(map.blocked),
    water: positions(map.water),
    bridges: positions(map.bridges),
    trees: positions(map.trees),
    roads: positions(map.roads),
    floors: positions(map.floors),
    houseWalls: positions(map.houseWalls),
    castleWalls: positions(map.castleWalls),
    windows: map.windows.filter((entry) =>
      insideRenderBounds(entry.position, bounds) || belongsToOwnedBuilding(entry.position)
    ),
    torches: positions(map.torches),
    terrainMaterials: map.terrainMaterials.filter((entry) =>
      insideRenderBounds(entry.position, bounds)
    ),
    objects: (map.objects ?? []).filter((entry) =>
      insideRenderBounds(entry.position, bounds)
    ),
    buildings,
    doors: map.doors.filter((entry) =>
      insideRenderBounds(entry.position, bounds) || belongsToOwnedBuilding(entry.position)
    ),
    stairs: map.stairs.filter((entry) =>
      insideRenderBounds(entry.from, bounds) || insideRenderBounds(entry.to, bounds)
    ),
  };

  return {
    key: retainedStaticChunkKey(floor, chunkX, chunkY),
    floor,
    chunkX,
    chunkY,
    map: chunkMap,
    bounds,
    castleWallContext,
  };
}

function createRenderRegion(
  map: MapView,
  floor: number,
  chunkX: number,
  chunkY: number,
  padding = RENDER_PADDING,
) {
  const minX = Math.max(0, chunkX * RENDER_CHUNK_SIZE - padding);
  const minY = Math.max(0, chunkY * RENDER_CHUNK_SIZE - padding);
  const maxX = Math.min(map.width, (chunkX + 1) * RENDER_CHUNK_SIZE + padding);
  const maxY = Math.min(map.height, (chunkY + 1) * RENDER_CHUNK_SIZE + padding);
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
