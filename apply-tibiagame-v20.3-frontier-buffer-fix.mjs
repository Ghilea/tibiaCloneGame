#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const assetPath = path.join(root, "apps", "client", "src", "game", "MedievalAssetModels.tsx");

for (const filePath of [threePath, assetPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(root, filePath)}. Run from repository root.`);
  }
}

function load(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n") };
}

const threeFile = load(threePath);
const assetFile = load(assetPath);
let three = threeFile.text;
let asset = assetFile.text;

if (three.includes("TIBIAGAME_STREAMING_FIX_V20_3") &&
    asset.includes("TIBIAGAME_STREAMING_FIX_V20_3")) {
  console.log("TibiaGame V20.3 is already applied.");
  process.exit(0);
}

for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V20",
  "TIBIAGAME_STREAMING_FIX_V20_1",
  "TIBIAGAME_STREAMING_FIX_V20_2",
]) {
  if (!three.includes(marker)) {
    throw new Error(`V20.3 expects ${marker}. No files were written.`);
  }
}
if (!asset.includes("TIBIAGAME_STREAMING_FIX_V20")) {
  throw new Error("V20.3 expects V20 in MedievalAssetModels.tsx.");
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0) throw new Error(`Could not find ${label}. No files were written.`);
  if (source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

// ---------------------------------------------------------------------
// 1. Remove V20 runtime frontier mounts.
// ---------------------------------------------------------------------
const frontierStartMarker = `    // TIBIAGAME_STREAMING_FIX_V20
    // Prepare only the strip(s) the player is approaching. This is a narrow
    // frontier, not a blanket 5x5 GPU prewarm.`;
const frontierStart = three.indexOf(frontierStartMarker);
const frontierEnd = three.indexOf("    // TIBIAGAME_STREAMING_FIX_V7", frontierStart);
if (frontierStart < 0 || frontierEnd < 0) {
  throw new Error("Could not isolate the V20 frontier-prefetch block.");
}

three = three.slice(0, frontierStart) + `    // TIBIAGAME_STREAMING_FIX_V20_3
    // Production trace showed that whole React/R3F chunk mounts scheduled from
    // requestIdleCallback become the hitch themselves. Runtime frontier mounts
    // are disabled; normal 3x3 + stair-target loading remains.
` + three.slice(frontierEnd);

three = replaceOnce(
  three,
  `    const pending = [
      ...currentFloorSpecs.slice(1),
      ...uniqueFrontierSpecs,
      ...stairTargetSpecs,
    ].filter((spec) => !retainedStaticKeys.current.has(`,
  `    const pending = [
      ...currentFloorSpecs.slice(1),
      ...stairTargetSpecs,
    ].filter((spec) => !retainedStaticKeys.current.has(`,
  "frontier entry in retained pending queue",
);

three = replaceOnce(
  three,
  "const RETAINED_STATIC_FRONTIER_DISTANCE = 10;\n",
  "",
  "frontier distance constant",
);

// ---------------------------------------------------------------------
// 2. Right-size per-retained-chunk InstancedMesh allocations.
// ---------------------------------------------------------------------
const matrixAnchor = "function persistentInstanceMatrix";
const matrixAt = three.indexOf(matrixAnchor);
if (matrixAt < 0) throw new Error("Could not find persistentInstanceMatrix.");

three = three.slice(0, matrixAt) + `// TIBIAGAME_STREAMING_FIX_V20_3
function retainedInstanceCapacity(count: number, maximum: number) {
  if (count <= 1) return 1;
  let value = 1;
  while (value < count && value < maximum) value *= 2;
  return Math.min(value, maximum);
}

` + three.slice(matrixAt);

three = replaceOnce(
  three,
  `  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      geometry,
      material,
      capacity,
    );`,
  `  const allocationCapacity = retainedInstanceCapacity(
    matrices.length,
    capacity,
  );

  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      geometry,
      material,
      allocationCapacity,
    );`,
  "PersistentStaticInstances constructor capacity",
);

three = replaceOnce(
  three,
  `  }, [
    capacity,
    castShadow,
    geometry,
    material,
    receiveShadow,
  ]);`,
  `  }, [
    allocationCapacity,
    castShadow,
    geometry,
    material,
    receiveShadow,
  ]);`,
  "PersistentStaticInstances dependencies",
);

three = replaceOnce(
  three,
  "  const count = Math.min(matrices.length, capacity);",
  "  const count = Math.min(matrices.length, allocationCapacity);",
  "PersistentStaticInstances count",
);

// ---------------------------------------------------------------------
// 3. Right-size medieval solid house-wall buffers.
// ---------------------------------------------------------------------
const houseCap = "const PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY = 2048;";
if (!asset.includes(houseCap)) {
  throw new Error("Could not find house-wall capacity.");
}

asset = asset.replace(
  houseCap,
  `${houseCap}

// TIBIAGAME_STREAMING_FIX_V20_3
function houseWallInstanceCapacity(count: number) {
  if (count <= 1) return 1;
  let value = 1;
  while (
    value < count
    && value < PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY
  ) value *= 2;
  return Math.min(value, PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY);
}`,
);

asset = replaceOnce(
  asset,
  `  // TIBIAGAME_STREAMING_FIX_V20
  const meshes = useMemo(() => parts.map((part) => {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,
    );`,
  `  // TIBIAGAME_STREAMING_FIX_V20
  // TIBIAGAME_STREAMING_FIX_V20_3
  const allocationCapacity = houseWallInstanceCapacity(segments.length);
  const meshes = useMemo(() => parts.map((part) => {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      allocationCapacity,
    );`,
  "house-wall constructor capacity",
);

asset = replaceOnce(
  asset,
  `  }), [parts]);

  const count = Math.min(
    segments.length,
    PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,
  );`,
  `  }), [allocationCapacity, parts]);

  const count = Math.min(
    segments.length,
    allocationCapacity,
  );`,
  "house-wall dependencies/count",
);

// Safety
if (three.includes("uniqueFrontierSpecs") ||
    three.includes("RETAINED_STATIC_FRONTIER_DISTANCE")) {
  throw new Error("V20.3 safety check failed: frontier runtime code remains.");
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V20_3",
  "retainedInstanceCapacity",
  "RETAINED_STATIC_CACHE_LIMIT = 17",
  "RETAINED_STATIC_HARD_LIMIT = 18",
  "RETAINED_STATIC_CHUNK_HYSTERESIS = 4",
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
]) {
  if (!three.includes(needle)) throw new Error(`Missing preserved V20/V15 feature: ${needle}`);
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V20_3",
  "houseWallInstanceCapacity",
  "PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY = 2048",
]) {
  if (!asset.includes(needle)) throw new Error(`Missing V20.3 asset feature: ${needle}`);
}

if (CHECK_ONLY) {
  console.log("V20.3 compatibility check passed. No files were changed.");
  console.log("  runtime frontier retained-chunk mounts: disabled");
  console.log("  retained 4-tile hysteresis: preserved");
  console.log("  cache: 17 soft / 18 hard preserved");
  console.log("  static per-chunk instance buffers: right-sized");
  console.log("  medieval solid house-wall buffers: right-sized");
  console.log("  terrain/z/building correctness: preserved");
  process.exit(0);
}

function denormalize(text, eol) {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}
fs.writeFileSync(threePath, denormalize(three, threeFile.eol), "utf8");
fs.writeFileSync(assetPath, denormalize(asset, assetFile.eol), "utf8");

console.log("Applied TibiaGame V20.3 frontier/buffer fix.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("  apps/client/src/game/MedievalAssetModels.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
