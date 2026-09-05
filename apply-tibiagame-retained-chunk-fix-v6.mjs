#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const files = {
  three: path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx"),
  medieval: path.join(root, "apps", "client", "src", "game", "MedievalModels.tsx"),
  medievalAssets: path.join(root, "apps", "client", "src", "game", "MedievalAssetModels.tsx"),
};

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name}: ${path.relative(root, file)}. Run this from the tibiaCloneGame repository root.`);
  }
}

function read(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n") };
}

function write(file, source) {
  const output = source.eol === "\n" ? source.text : source.text.replace(/\n/g, "\r\n");
  fs.writeFileSync(file, output, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (source.text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  source.text = source.text.slice(0, first) + after + source.text.slice(first + before.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const matches = [...source.text.matchAll(regex)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}. No files were written.`);
  }
  source.text = source.text.replace(regex, replacement);
}

const three = read(files.three);
const medieval = read(files.medieval);
const medievalAssets = read(files.medievalAssets);

if (three.text.includes("TIBIAGAME_STREAMING_FIX_V6")) {
  console.log("TibiaGame retained-chunk fix V6 is already applied.");
  process.exit(0);
}

if (!three.text.includes("TIBIAGAME_STREAMING_FIX_V5")) {
  throw new Error("V6 expects V5 to be applied first. No files were written.");
}
if (!three.text.includes("TIBIAGAME_STREAMING_FIX_V4")) {
  throw new Error("V6 expects V4 to be applied first. No files were written.");
}

// ---------------------------------------------------------------------------
// 1) Keep dynamic lighting but disable expensive real-time shadow-map passes.
//    The V5 logs show multi-hundred-ms resource/program spikes during scene
//    commits. Dynamic directional/point/hemisphere lighting remains active.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `        shadows
        dpr={[1, 1.6]}`,
  `        // TIBIAGAME_STREAMING_FIX_V6
        // Dynamic lighting remains enabled. Real-time shadow maps are disabled
        // because rebuilding shadow programs for streamed geometry caused
        // multi-hundred-ms stalls.
        shadows={false}
        dpr={[1, 1.6]}`,
  "Canvas shadows prop",
);

replaceRegexOnce(
  three,
  /          gl\.shadowMap\.enabled = true;[\s\S]*?          gl\.shadowMap\.needsUpdate = true;\n/g,
  `          // TIBIAGAME_STREAMING_FIX_V6
          // Keep Three.js lights, but do not run a second shadow render pass.
          gl.shadowMap.enabled = false;
          gl.shadowMap.autoUpdate = false;
`,
  "shadowMap initialization block",
);

replaceRegexOnce(
  three,
  /function StaticShadowMap\(\{[\s\S]*?\n\}\n\nfunction WorldScene/g,
  `function WorldScene`,
  "StaticShadowMap function",
);

// ---------------------------------------------------------------------------
// 2) Add retained static chunk constants. 24-tile chunks work well with the
//    existing radius-48 server payload: the complete current 3x3 neighborhood
//    is always already present when a boundary is crossed.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `const RENDER_CHUNK_SIZE = 32;
const RENDER_PADDING = 8;`,
  `const RENDER_CHUNK_SIZE = 32;
const RENDER_PADDING = 8;

// TIBIAGAME_STREAMING_FIX_V6
const RETAINED_STATIC_CHUNK_SIZE = 24;
const RETAINED_STATIC_CACHE_LIMIT = 72;`,
  "render chunk constants",
);

// ---------------------------------------------------------------------------
// 3) Retain static GPU chunks instead of replacing Terrain + Structures.
//    Existing chunks stay mounted; only missing edge chunks are added.
//    z +/- 1 chunks are warmed in true browser-idle time and stay mounted
//    hidden, so floor changes can reuse already-created React/Three objects.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `  if (!map || !region) return null;`,
  `  // TIBIAGAME_STREAMING_FIX_V6
  const staticChunkX = Math.floor((local?.position.x ?? 0) / RETAINED_STATIC_CHUNK_SIZE);
  const staticChunkY = Math.floor((local?.position.y ?? 0) / RETAINED_STATIC_CHUNK_SIZE);
  const [retainedStaticChunks, setRetainedStaticChunks] = useState<RetainedStaticChunkData[]>([]);
  const retainedStaticKeys = useRef(new Set<string>());

  useEffect(() => {
    const sourceAtStart = latestMapRef.current;
    if (!sourceAtStart || !local) return;

    let cancelled = false;
    let frameHandle: number | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const offsets: readonly [number, number][] = [
      [0, 0],
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const visibleSpecs = offsets.map(([dx, dy]) => ({
      floor,
      chunkX: staticChunkX + dx,
      chunkY: staticChunkY + dy,
    }));

    const hiddenSpecs = [floor - 1, floor + 1].flatMap((prefetchFloor) =>
      offsets.map(([dx, dy]) => ({
        floor: prefetchFloor,
        chunkX: staticChunkX + dx,
        chunkY: staticChunkY + dy,
      })),
    );

    const addChunk = (spec: { floor: number; chunkX: number; chunkY: number }) => {
      if (cancelled) return;
      const key = retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY);
      if (retainedStaticKeys.current.has(key)) return;

      // Always consume the newest streamed map available at the moment this
      // chunk is built. Existing chunks are intentionally left untouched.
      const source = latestMapRef.current;
      if (!source) return;
      const chunk = createRetainedStaticChunk(source, spec.floor, spec.chunkX, spec.chunkY);
      retainedStaticKeys.current.add(key);

      setRetainedStaticChunks((previous) => {
        const next = [...previous, chunk];
        if (next.length <= RETAINED_STATIC_CACHE_LIMIT) return next;

        // FIFO eviction is deliberately conservative and happens one chunk at
        // a time only after the cache is large. Never evict the current 3x3.
        const removableIndex = next.findIndex((entry) =>
          entry.floor !== floor
          || Math.abs(entry.chunkX - staticChunkX) > 1
          || Math.abs(entry.chunkY - staticChunkY) > 1
        );
        if (removableIndex < 0) return next;
        const [removed] = next.splice(removableIndex, 1);
        retainedStaticKeys.current.delete(removed.key);
        return next;
      });
    };

    let visibleIndex = 0;
    const pumpVisible = () => {
      if (cancelled) return;
      while (visibleIndex < visibleSpecs.length) {
        const spec = visibleSpecs[visibleIndex++];
        const key = retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY);
        if (retainedStaticKeys.current.has(key)) continue;
        addChunk(spec);
        frameHandle = window.requestAnimationFrame(pumpVisible);
        return;
      }
      scheduleHidden();
    };

    let hiddenIndex = 0;
    const pumpHidden = () => {
      if (cancelled) return;
      while (hiddenIndex < hiddenSpecs.length) {
        const spec = hiddenSpecs[hiddenIndex++];
        const key = retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY);
        if (retainedStaticKeys.current.has(key)) continue;
        addChunk(spec);
        scheduleHidden();
        return;
      }
    };

    const scheduleHidden = () => {
      if (cancelled || hiddenIndex >= hiddenSpecs.length) return;
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(pumpHidden);
      } else {
        timeoutHandle = window.setTimeout(pumpHidden, 48);
      }
    };

    pumpVisible();

    return () => {
      cancelled = true;
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [floor, staticChunkX, staticChunkY, streamRegionRevision]);

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
  const staticSceneRevision = \`\${floor}:\${staticChunkX}:\${staticChunkY}:\${activeStaticChunkCount}:\${dynamicMapRevision}\`;

  if (!map || !region) return null;`,
  "WorldScene null guard",
);

// Replace the old monolithic static region render with retained chunks.
replaceRegexOnce(
  three,
  /      <Terrain map=\{region\.map\} floor=\{floor\} bounds=\{region\.bounds\} onGround=\{onGround\} \/>\n      \{\/\* TIBIAGAME_STREAMING_FIX_V5[\s\S]*?      <\/Suspense>\n      <StaticShadowMap[\s\S]*?      \/>\n      <OcclusionController target=\{local\?\.position\} visualTarget=\{localVisualPosition\} sceneRevision=\{region\.map\} \/>/g,
  `      {retainedStaticChunks.map((chunk) => (
        <RetainedStaticChunk
          key={chunk.key}
          chunk={chunk}
          activeFloor={floor}
          input={input}
          world={world}
          discoveryRevision={world.worldObjectCallout?.key ?? 0}
          indoorBuildingId={indoorBuildingId}
          onHover={onLootHover}
          onGround={onGround}
        />
      ))}
      <OcclusionController
        target={local?.position}
        visualTarget={localVisualPosition}
        sceneRevision={staticSceneRevision}
        floor={floor}
        chunkX={staticChunkX}
        chunkY={staticChunkY}
      />`,
  "old Terrain/Structures/Shadow/Occlusion render block",
);

// ---------------------------------------------------------------------------
// 4) Occlusion only indexes nearby active-floor retained chunks.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  three,
  /function OcclusionController\(\{ target, visualTarget, sceneRevision \}: \{ target\?: Position; visualTarget: MutableRefObject<THREE\.Vector3>; sceneRevision: MapView \}\) \{/g,
  `function OcclusionController({
  target,
  visualTarget,
  sceneRevision,
  floor,
  chunkX,
  chunkY,
}: {
  target?: Position;
  visualTarget: MutableRefObject<THREE.Vector3>;
  sceneRevision: string;
  floor: number;
  chunkX: number;
  chunkY: number;
}) {`,
  "OcclusionController signature",
);

replaceOnce(
  three,
  `    const visit = (node: THREE.Object3D) => {
      if (node.userData.occluder) {`,
  `    const visit = (node: THREE.Object3D) => {
      const streamFloor = node.userData.streamFloor;
      if (typeof streamFloor === "number" && streamFloor !== floor) return;
      const streamChunkX = node.userData.streamChunkX;
      const streamChunkY = node.userData.streamChunkY;
      if (
        typeof streamChunkX === "number"
        && typeof streamChunkY === "number"
        && (
          Math.abs(streamChunkX - chunkX) > 1
          || Math.abs(streamChunkY - chunkY) > 1
        )
      ) return;
      if (node.userData.occluder) {`,
  "OcclusionController visit",
);

replaceOnce(
  three,
  `  }, [scene, sceneRevision]);`,
  `  }, [chunkX, chunkY, floor, scene, sceneRevision]);`,
  "OcclusionController effect dependencies",
);

// ---------------------------------------------------------------------------
// 5) Shared world texture clones.
//    Previously every Terrain remount cloned/disposed the same GPU textures.
//    Retained chunks use identical repeat values, so cache by path+repeat.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  three,
  /function useWorldTexture\(path: string, repeatX = 1, repeatY = 1\) \{[\s\S]*?\n\}/g,
  `const worldTextureCloneCache = new Map<string, THREE.Texture>();

function useWorldTexture(path: string, repeatX = 1, repeatY = 1) {
  const source = useLoader(THREE.TextureLoader, path);
  const { gl } = useThree();
  return useMemo(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const key = \`\${path}|\${repeatX.toFixed(3)}|\${repeatY.toFixed(3)}|\${anisotropy}\`;
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
}`,
  "useWorldTexture implementation",
);

// ---------------------------------------------------------------------------
// 6) Insert retained chunk types/component/helper before Terrain.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `const Terrain = memo(function Terrain({`,
  `type RetainedStaticChunkData = {
  key: string;
  floor: number;
  chunkX: number;
  chunkY: number;
  map: MapView;
  bounds: RenderBounds;
};

function retainedStaticChunkKey(floor: number, chunkX: number, chunkY: number) {
  return \`\${floor}:\${chunkX}:\${chunkY}\`;
}

const RetainedStaticChunk = memo(function RetainedStaticChunk({
  chunk,
  activeFloor,
  input,
  world,
  discoveryRevision,
  indoorBuildingId,
  onHover,
  onGround,
}: {
  chunk: RetainedStaticChunkData;
  activeFloor: number;
  input: InputController;
  world: WorldState;
  discoveryRevision: number;
  indoorBuildingId: string | null;
  onHover: (hover: { label: string; x: number; y: number } | null) => void;
  onGround: (event: ThreeEvent<PointerEvent>) => void;
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
      <Terrain
        map={chunk.map}
        floor={chunk.floor}
        bounds={chunk.bounds}
        onGround={onGround}
      />
      <Suspense fallback={null}>
        <Structures
          map={chunk.map}
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

const Terrain = memo(function Terrain({`,
  "Terrain declaration",
);

// Insert exact retained chunk slicer before the old padded createRenderRegion.
replaceOnce(
  three,
  `function createRenderRegion(map: MapView, floor: number, chunkX: number, chunkY: number) {`,
  `function createRetainedStaticChunk(
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
  };
}

function createRenderRegion(map: MapView, floor: number, chunkX: number, chunkY: number) {`,
  "createRenderRegion declaration",
);

// ---------------------------------------------------------------------------
// 7) Move known instanced-matrix work out of commitLayoutEffects.
//    Retained chunks are created ahead of the camera; one-frame-later matrix
//    upload is preferable to blocking React's commitRoot.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  medieval,
  /  useLayoutEffect\(\(\) => \{\n    const matrix = new THREE\.Matrix4\(\);[\s\S]*?  \}, \[horizontal, vertical\]\);/g,
  (match) => match.replace("useLayoutEffect", "useEffect")
                   .replace("// TIBIAGAME_STREAMING_FIX_V6", ""),
  "InstancedHousePlinths layout effect",
);

// Add marker in a harmless comment so compatibility is visible.
replaceOnce(
  medieval,
  `export function InstancedHousePlinths`,
  `// TIBIAGAME_STREAMING_FIX_V6
export function InstancedHousePlinths`,
  "MedievalModels V6 marker",
);

if (!medieval.text.includes("useLayoutEffect(")) {
  medieval.text = medieval.text.replace(
    `import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";`,
    `import { memo, useEffect, useMemo, useRef } from "react";`,
  );
}

replaceRegexOnce(
  medievalAssets,
  /  useLayoutEffect\(\(\) => \{\n    const wallMatrix = new THREE\.Matrix4\(\);[\s\S]*?  \}, \[parts, segments\]\);/g,
  (match) => match.replace("useLayoutEffect", "useEffect"),
  "InstancedMedievalHouseWalls layout effect",
);

replaceOnce(
  medievalAssets,
  `export function InstancedMedievalHouseWalls`,
  `// TIBIAGAME_STREAMING_FIX_V6
export function InstancedMedievalHouseWalls`,
  "MedievalAssetModels V6 marker",
);

if (!medievalAssets.text.includes("useLayoutEffect(")) {
  medievalAssets.text = medievalAssets.text.replace(
    `import { useEffect, useLayoutEffect, useMemo, useRef } from "react";`,
    `import { useEffect, useMemo, useRef } from "react";`,
  );
}

const changed = [
  [files.three, three],
  [files.medieval, medieval],
  [files.medievalAssets, medievalAssets],
];

if (CHECK_ONLY) {
  console.log("V6 compatibility check passed. No files were changed.");
  for (const [file] of changed) console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

for (const [file, source] of changed) write(file, source);

console.log("Applied TibiaGame retained-chunk fix V6.");
console.log("Changed:");
for (const [file] of changed) console.log(`  ${path.relative(root, file)}`);
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Runtime target:");
console.log("  - programs/textures/geometries should stop collapsing/rebuilding at boundaries");
console.log("  - returning to a visited floor should reuse retained GPU chunks");
console.log("  - LONG FRAME spikes should be materially lower");
