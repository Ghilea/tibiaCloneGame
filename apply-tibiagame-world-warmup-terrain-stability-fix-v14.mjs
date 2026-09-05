#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");

if (!fs.existsSync(threePath)) {
  throw new Error("Missing apps/client/src/game/ThreeWorld.tsx. Run from repository root.");
}

const raw = fs.readFileSync(threePath, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_STREAMING_FIX_V14")) {
  console.log("TibiaGame world warmup/terrain stability fix V14 is already applied.");
  process.exit(0);
}
if (!text.includes("TIBIAGAME_STREAMING_FIX_V13")) {
  throw new Error("V14 expects V13 to be applied first. No files were written.");
}

function replaceOnce(before, after, label) {
  const start = text.indexOf(before);
  if (start < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (text.indexOf(before, start + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  text = text.slice(0, start) + after + text.slice(start + before.length);
}

function functionRange(functionName) {
  const needle = `function ${functionName}`;
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`Could not find ${functionName}. No files were written.`);

  const paramsStart = text.indexOf("(", start + needle.length);
  if (paramsStart < 0) throw new Error(`Could not parse ${functionName} parameters.`);

  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let parenDepth = 0;
  let paramsEnd = -1;

  for (let i = paramsStart; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = i + 1; break; }
    }
  }
  if (paramsEnd < 0) throw new Error(`Could not parse ${functionName} parameter end.`);

  let bodyStart = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = paramsEnd; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") { bodyStart = i; break; }
  }
  if (bodyStart < 0) throw new Error(`Could not find ${functionName} body.`);

  let braceDepth = 0;
  let end = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = bodyStart; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") braceDepth += 1;
    else if (ch === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`Could not parse ${functionName} body end.`);
  return { start, end };
}

function replaceFunction(functionName, replacement) {
  const { start, end } = functionRange(functionName);
  text = text.slice(0, start) + replacement + text.slice(end);
}

function insertAfterFunction(functionName, insertion) {
  const { end } = functionRange(functionName);
  text = text.slice(0, end) + "\n\n" + insertion + text.slice(end);
}

// --- Terrain: make monotonic knowledge cross overlapping render-cache keys. ---
const v13TerrainStart = text.indexOf("  // TIBIAGAME_STREAMING_FIX_V13\n  // Terrain is static world knowledge.");
if (v13TerrainStart < 0) {
  throw new Error("Could not find V13 terrain cache block. No files were written.");
}
const retainedMarker = text.indexOf("  // TIBIAGAME_STREAMING_FIX_V6\n  const staticChunkX", v13TerrainStart);
if (retainedMarker < 0) {
  throw new Error("Could not find retained-static marker after V13 terrain block.");
}
text = text.slice(0, v13TerrainStart)
  + "  // TIBIAGAME_STREAMING_FIX_V14\n  // Terrain knowledge is monotonic across OVERLAPPING render chunks.\n  // V13 cached each 32x32 render key independently, which meant crossing a\n  // render-chunk boundary could switch to a different cache entry that did not\n  // yet contain a tile the previous overlapping entry had already seen.\n  const immediateStreamRegionRevision = world.streamRegionRevision;\n  const terrainRegionsRef = useRef(\n    new Map<string, ReturnType<typeof createRenderRegion>>(),\n  );\n  const terrainRegion = useMemo(() => {\n    void immediateStreamRegionRevision;\n    const source = mapReady ? latestMapRef.current : null;\n    if (!source) return null;\n\n    const key = `${floor}:${chunkX}:${chunkY}`;\n    const candidate = createRenderRegion(source, floor, chunkX, chunkY);\n    const previous = terrainRegionsRef.current.get(key);\n\n    // Preserve everything already known for this exact render chunk, then\n    // import terrain knowledge from neighboring cached chunks wherever their\n    // padded render bounds overlap the new one. The newest packet remains the\n    // authority for conflicts; neighboring entries only fill missing terrain.\n    let merged = previous\n      ? mergeTerrainRenderRegion(previous, candidate)\n      : candidate;\n\n    for (const [knownKey, known] of terrainRegionsRef.current) {\n      if (knownKey === key || !knownKey.startsWith(`${floor}:`)) continue;\n      if (!terrainRenderBoundsOverlap(known.bounds, candidate.bounds)) continue;\n      merged = mergeOverlappingTerrainKnowledge(merged, known, candidate.bounds);\n    }\n\n    terrainRegionsRef.current.delete(key);\n    terrainRegionsRef.current.set(key, merged);\n\n    // This is CPU-side terrain knowledge, not mounted GPU chunks. Keep enough\n    // history to bridge several render boundaries without unbounded growth.\n    if (terrainRegionsRef.current.size > 32) {\n      const oldestKey = terrainRegionsRef.current.keys().next().value;\n      if (oldestKey && oldestKey !== key) {\n        terrainRegionsRef.current.delete(oldestKey);\n      }\n    }\n\n    return merged;\n  }, [\n    mapReady,\n    floor,\n    chunkX,\n    chunkY,\n    immediateStreamRegionRevision,\n  ]);\n\n"
  + text.slice(retainedMarker);

insertAfterFunction("mergeTerrainRenderRegion", "// TIBIAGAME_STREAMING_FIX_V14\nfunction terrainRenderBoundsOverlap(a: RenderBounds, b: RenderBounds) {\n  return a.minX < b.minX + b.width\n    && a.minX + a.width > b.minX\n    && a.minY < b.minY + b.height\n    && a.minY + a.height > b.minY;\n}\n\nfunction terrainPositionInsideBounds(position: Position, bounds: RenderBounds) {\n  return position.x >= bounds.minX\n    && position.x < bounds.minX + bounds.width\n    && position.y >= bounds.minY\n    && position.y < bounds.minY + bounds.height;\n}\n\nfunction mergeOverlappingTerrainKnowledge(\n  current: ReturnType<typeof createRenderRegion>,\n  known: ReturnType<typeof createRenderRegion>,\n  bounds: RenderBounds,\n) {\n  const blocked = mergeTerrainPositionLayer(\n    current.map.blocked,\n    known.map.blocked.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const water = mergeTerrainPositionLayer(\n    current.map.water,\n    known.map.water.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const bridges = mergeTerrainPositionLayer(\n    current.map.bridges,\n    known.map.bridges.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const trees = mergeTerrainPositionLayer(\n    current.map.trees,\n    known.map.trees.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const roads = mergeTerrainPositionLayer(\n    current.map.roads,\n    known.map.roads.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const floors = mergeTerrainPositionLayer(\n    current.map.floors,\n    known.map.floors.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const houseWalls = mergeTerrainPositionLayer(\n    current.map.houseWalls,\n    known.map.houseWalls.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n  const castleWalls = mergeTerrainPositionLayer(\n    current.map.castleWalls,\n    known.map.castleWalls.filter((entry) => terrainPositionInsideBounds(entry, bounds)),\n  );\n\n  // Never let an older overlapping cache entry overwrite the current packet's\n  // material choice for a tile. It may only contribute a material not known in\n  // the current render slice yet.\n  const materialKeys = new Set(current.map.terrainMaterials.map((entry) => tileKey(entry.position)));\n  const terrainMaterials = mergeTerrainMaterialLayer(\n    current.map.terrainMaterials,\n    known.map.terrainMaterials.filter((entry) =>\n      terrainPositionInsideBounds(entry.position, bounds)\n      && !materialKeys.has(tileKey(entry.position)),\n    ),\n  );\n\n  const objectIds = new Set(current.map.objects.map((entry) => entry.id));\n  const objects = mergeTerrainObjectMaskLayer(\n    current.map.objects,\n    known.map.objects.filter((entry) =>\n      terrainPositionInsideBounds(entry.position, bounds)\n      && !objectIds.has(entry.id),\n    ),\n  );\n\n  const unchanged =\n    blocked === current.map.blocked\n    && water === current.map.water\n    && bridges === current.map.bridges\n    && trees === current.map.trees\n    && roads === current.map.roads\n    && floors === current.map.floors\n    && houseWalls === current.map.houseWalls\n    && castleWalls === current.map.castleWalls\n    && terrainMaterials === current.map.terrainMaterials\n    && objects === current.map.objects;\n\n  if (unchanged) return current;\n\n  return {\n    ...current,\n    map: {\n      ...current.map,\n      blocked,\n      water,\n      bridges,\n      trees,\n      roads,\n      floors,\n      houseWalls,\n      castleWalls,\n      terrainMaterials,\n      objects,\n    },\n  };\n}\n\n");

// --- Initial loading screen: first frame is NOT world ready. ---
replaceOnce(
  '<WorldScene world={world} input={input} onLootHover={setLootHover} />',
  '<WorldScene world={world} input={input} onLootHover={setLootHover} onReady={onReady} />',
  "WorldScene call",
);

// The string construction above deliberately preserves JSX braces. Some Node
// versions make nested template escaping unnecessarily fragile.
replaceOnce("          <SceneReady onReady={onReady} />", "", "first-frame SceneReady call");

replaceOnce(
  "function WorldScene({ world, input, onLootHover }: ThreeWorldProps & { onLootHover:",
  "function WorldScene({ world, input, onLootHover, onReady }: ThreeWorldProps & { onLootHover:",
  "WorldScene destructuring",
);

replaceFunction("SceneReady", "function SceneReady({\n  armed,\n  onReady,\n}: {\n  armed: boolean;\n  onReady?: () => void;\n}) {\n  const { gl, scene, camera } = useThree();\n  const reported = useRef(false);\n  const armedAt = useRef(0);\n  const lastSignature = useRef(\"\");\n  const stableFrames = useRef(0);\n  const compileStarted = useRef(false);\n  const compileFinished = useRef(false);\n  const onReadyRef = useRef(onReady);\n  onReadyRef.current = onReady;\n\n  useEffect(() => {\n    if (!armed || reported.current) return;\n    armedAt.current = performance.now();\n    lastSignature.current = \"\";\n    stableFrames.current = 0;\n    compileStarted.current = false;\n    compileFinished.current = false;\n  }, [armed]);\n\n  useFrame(() => {\n    if (reported.current || !armed) return;\n\n    const signature = [\n      gl.info.memory.geometries,\n      gl.info.memory.textures,\n      gl.info.programs?.length ?? 0,\n    ].join(\":\");\n\n    if (signature === lastSignature.current) {\n      stableFrames.current += 1;\n    } else {\n      lastSignature.current = signature;\n      stableFrames.current = 0;\n    }\n\n    const elapsed = performance.now() - armedAt.current;\n\n    // Wait until the initial 3x3 structure neighborhood has stopped creating\n    // GPU resources, then precompile the currently visible material programs\n    // while the loading screen is still covering the world.\n    if (!compileStarted.current && stableFrames.current >= 18 && elapsed >= 600) {\n      compileStarted.current = true;\n      const renderer = gl as THREE.WebGLRenderer & {\n        compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>;\n      };\n\n      try {\n        const result = renderer.compileAsync\n          ? renderer.compileAsync(scene, camera)\n          : Promise.resolve(renderer.compile(scene, camera));\n        void result\n          .catch(() => undefined)\n          .then(() => {\n            compileFinished.current = true;\n            lastSignature.current = \"\";\n            stableFrames.current = 0;\n          });\n      } catch {\n        compileFinished.current = true;\n        lastSignature.current = \"\";\n        stableFrames.current = 0;\n      }\n      return;\n    }\n\n    // Do not expose the world immediately after compilation either. Require a\n    // second stable window so late texture/geometry uploads remain hidden by\n    // the loading screen instead of visibly popping into the scene.\n    if (compileFinished.current && stableFrames.current >= 24 && elapsed >= 1_100) {\n      reported.current = true;\n      onReadyRef.current?.();\n    }\n  });\n\n  return null;\n}");

const revisionNeedle = "  const staticSceneRevision =";
const revisionStart = text.indexOf(revisionNeedle);
if (revisionStart < 0) throw new Error("Could not find staticSceneRevision.");
const revisionEnd = text.indexOf("\n", revisionStart);
if (revisionEnd < 0) throw new Error("Could not parse staticSceneRevision line.");
const readinessBlock = `

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
  );`;
text = text.slice(0, revisionEnd) + readinessBlock + text.slice(revisionEnd);

const cameraNeedle = '      <FollowCamera target={local?.position} visualTarget={localVisualPosition} mapWidth={map.width} mapHeight={map.height} />';
const cameraIndex = text.indexOf(cameraNeedle);
if (cameraIndex < 0) throw new Error("Could not find FollowCamera render line.");
const cameraEnd = cameraIndex + cameraNeedle.length;
text = text.slice(0, cameraEnd)
  + "\n      <SceneReady armed={initialWorldReady} onReady={onReady} />"
  + text.slice(cameraEnd);

// --- Terrain matrices: no one-frame post-commit gap. ---
replaceFunction("InstancedTiles", "function InstancedTiles({\n  positions,\n  color,\n  height,\n  y,\n  scale = 0.98,\n  castShadow = false,\n  texture,\n}: {\n  positions: readonly Position[];\n  color: THREE.ColorRepresentation;\n  height: number;\n  y: number;\n  scale?: number;\n  castShadow?: boolean;\n  texture?: THREE.Texture;\n}) {\n  // TIBIAGAME_STREAMING_FIX_V14\n  // Build instance matrices during render, not in a post-commit effect. V7's\n  // useEffect conversion removed layout stalls but allowed a freshly resized\n  // instanced mesh to be painted for one frame before its matrices were ready.\n  const instanceMatrix = useMemo(() => {\n    const data = new Float32Array(positions.length * 16);\n    const matrix = new THREE.Matrix4();\n    positions.forEach((tile, index) => {\n      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);\n      matrix.toArray(data, index * 16);\n    });\n    return new THREE.InstancedBufferAttribute(data, 16);\n  }, [positions, y]);\n\n  if (!positions.length) return null;\n  return (\n    <instancedMesh args={[undefined, undefined, positions.length]} castShadow={castShadow} receiveShadow>\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <boxGeometry args={[scale, height, scale]} />\n      <meshStandardMaterial map={texture} color={color} roughness={0.92} />\n    </instancedMesh>\n  );\n}");
replaceFunction("WaterTiles", "function WaterTiles({ positions }: { positions: readonly Position[] }) {\n  const waterTexture = useWorldTexture(\"/assets/world/aldoria-water-v1.png\");\n  const material = useMemo(() => new THREE.MeshPhysicalMaterial({\n    map: waterTexture,\n    color: \"#277789\",\n    emissive: \"#16424d\",\n    emissiveIntensity: 0.08,\n    metalness: 0.05,\n    roughness: 0.2,\n    transparent: true,\n    opacity: 0.86,\n  }), [waterTexture]);\n\n  // TIBIAGAME_STREAMING_FIX_V14\n  // Like ground tiles, water matrices must exist before the first painted frame.\n  const instanceMatrix = useMemo(() => {\n    const data = new Float32Array(positions.length * 16);\n    const matrix = new THREE.Matrix4();\n    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));\n    const scale = new THREE.Vector3(1.02, 1.02, 1);\n    positions.forEach((tile, index) => {\n      matrix.compose(\n        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),\n        quaternion,\n        scale,\n      );\n      matrix.toArray(data, index * 16);\n    });\n    return new THREE.InstancedBufferAttribute(data, 16);\n  }, [positions]);\n\n  useEffect(() => () => material.dispose(), [material]);\n  useFrame(({ clock }) => {\n    const wave = Math.sin(clock.elapsedTime * 1.6) * 0.035;\n    material.roughness = 0.2 + wave;\n    material.opacity = 0.84 + Math.sin(clock.elapsedTime * 1.25) * 0.035;\n    material.emissiveIntensity = 0.1 + wave;\n    waterTexture.offset.set(clock.elapsedTime * 0.032, clock.elapsedTime * 0.019);\n  });\n  if (!positions.length) return null;\n  return (\n    <instancedMesh args={[undefined, undefined, positions.length]} receiveShadow>\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <planeGeometry args={[1, 1]} />\n      <primitive object={material} attach=\"material\" />\n    </instancedMesh>\n  );\n}");

// Structural safety checks.
for (const needle of [
  "mergeOverlappingTerrainKnowledge",
  "SceneReady armed={initialWorldReady}",
  "new THREE.InstancedBufferAttribute(data, 16)",
  "compileFinished.current",
]) {
  if (!text.includes(needle)) throw new Error(`V14 safety check failed: missing ${needle}`);
}

const instancedRange = functionRange("InstancedTiles");
const instancedBlock = text.slice(instancedRange.start, instancedRange.end);
if (instancedBlock.includes("useEffect(") || instancedBlock.includes("useLayoutEffect(")) {
  throw new Error("V14 safety check failed: InstancedTiles still has a post-commit matrix effect.");
}

if (CHECK_ONLY) {
  console.log("V14 compatibility check passed. No files were changed.");
  console.log("  loading screen: waits for initial 3x3 + GPU stability + scene compile");
  console.log("  terrain cache: monotonic across overlapping render keys");
  console.log("  ground/water instance matrices: prepared before commit");
  console.log("  V10 5x5 prefetch/transparency changes: not restored");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(threePath, output, "utf8");

console.log("Applied TibiaGame world warmup/terrain stability fix V14.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart client (and preferably server for a clean test).");
