#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const target = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);

if (!fs.existsSync(target)) {
  throw new Error(`Missing ${path.relative(root, target)}.`);
}

const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let source = raw.replace(/\r\n/g, "\n");

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_3_2")) {
  console.log("TibiaGame V31B.3.2 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3_1",
  "function appendNativeConnectedWalls(",
  "const emittedPairs = new Set<string>();",
  "nativeTile(position, 0.025, 0.045, 1)",
  "NATIVE V31B.2 GPU warmup:",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V31B.3.2 expects installed V31B.3.1 baseline: missing ${needle}. No files were written.`,
    );
  }
}

const helperAnchor = `function appendNativeConnectedWalls(
  positions: readonly Position[],`;

const floorHelper = `function appendNativeFloorCoverage(
  position: Position,
  structuralTiles: ReadonlySet<string>,
  target: Transform[],
) {
  const x = position.x;
  const y = position.y;
  const z = position.z;
  const centerX = x + 0.5;
  const centerZ = y + 0.5;

  target.push([
    centerX,
    0.025,
    centerZ,
    1,
    0.045,
    1,
  ]);

  const north = structuralTiles.has(\`\${x}:\${y - 1}:\${z}\`);
  const south = structuralTiles.has(\`\${x}:\${y + 1}:\${z}\`);
  const west = structuralTiles.has(\`\${x - 1}:\${y}:\${z}\`);
  const east = structuralTiles.has(\`\${x + 1}:\${y}:\${z}\`);

  if (north) {
    target.push([
      centerX,
      0.025,
      y - 0.25,
      1,
      0.045,
      0.5,
    ]);
  }
  if (south) {
    target.push([
      centerX,
      0.025,
      y + 1.25,
      1,
      0.045,
      0.5,
    ]);
  }
  if (west) {
    target.push([
      x - 0.25,
      0.025,
      centerZ,
      0.5,
      0.045,
      1,
    ]);
  }
  if (east) {
    target.push([
      x + 1.25,
      0.025,
      centerZ,
      0.5,
      0.045,
      1,
    ]);
  }

  if (north && west) {
    target.push([
      x - 0.25,
      0.025,
      y - 0.25,
      0.5,
      0.045,
      0.5,
    ]);
  }
  if (north && east) {
    target.push([
      x + 1.25,
      0.025,
      y - 0.25,
      0.5,
      0.045,
      0.5,
    ]);
  }
  if (south && west) {
    target.push([
      x - 0.25,
      0.025,
      y + 1.25,
      0.5,
      0.045,
      0.5,
    ]);
  }
  if (south && east) {
    target.push([
      x + 1.25,
      0.025,
      y + 1.25,
      0.5,
      0.045,
      0.5,
    ]);
  }
}

`;

if (source.includes("function appendNativeFloorCoverage(")) {
  throw new Error(
    "V31B.3.2 found an unexpected existing floor-coverage helper. No files were written.",
  );
}

const helperIndex = source.indexOf(helperAnchor);
if (helperIndex < 0) {
  throw new Error(
    "V31B.3.2 could not locate appendNativeConnectedWalls(). No files were written.",
  );
}
source =
  source.slice(0, helperIndex)
  + floorHelper
  + source.slice(helperIndex);

// Match the V31B.3.1 floor loop structurally rather than requiring all
// surrounding whitespace to be identical.
const floorLoopPattern =
  /  for \(const position of map\.floors\) \{\s*if \(!nativeInside\(position, floor, centerX, centerY\)\) continue;\s*snapshot\.floors\.push\(nativeTile\(position, 0\.025, 0\.045, 1\)\);\s*\}/m;

const alternateFloorLoopPattern =
  /  for \(const position of map\.floors\) \{\s*if \(nativeInside\(position, floor, centerX, centerY\)\)\s*snapshot\.floors\.push\(nativeTile\(position, 0\.025, 0\.045, 1\)\);\s*\}/m;

const replacementFloorLoop = `  const floorStructuralTiles = new Set([
    ...map.houseWalls,
    ...map.castleWalls,
    ...map.doors.map((entry) => entry.position),
    ...map.windows.map((entry) => entry.position),
  ]
    .filter((position) => position.z === floor)
    .map(tileKey));

  for (const position of map.floors) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    appendNativeFloorCoverage(
      position,
      floorStructuralTiles,
      snapshot.floors,
    );
  }`;

if (floorLoopPattern.test(source)) {
  source = source.replace(floorLoopPattern, replacementFloorLoop);
} else if (alternateFloorLoopPattern.test(source)) {
  source = source.replace(
    alternateFloorLoopPattern,
    replacementFloorLoop,
  );
} else {
  throw new Error(
    "V31B.3.2 could not locate the V31B.3.1 map floor loop. No files were written.",
  );
}

source = source.replace(
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_3_1\n",
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_3_1\n// TIBIAGAME_NATIVE_RENDERER_V31_B_3_2\n",
);
source = source.replace(
  "NATIVE WORLD V31B.3.1 active · clean wall corners + full floor coverage · raw Three.js",
  "NATIVE WORLD V31B.3.2 active · wall-edge floor coverage · raw Three.js",
);
source = source.replace(
  'data-native-world-renderer="v31b.3.1"',
  'data-native-world-renderer="v31b.3.2"',
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3_2",
  "function appendNativeFloorCoverage(",
  "const floorStructuralTiles = new Set([",
  "if (north && west)",
  "if (south && east)",
  "appendNativeFloorCoverage(",
  "NATIVE V31B.2 GPU warmup:",
  "NATIVE WORLD V31B.3.2 active",
  'data-native-world-renderer="v31b.3.2"',
]) {
  if (!source.includes(needle)) {
    throw new Error(`V31B.3.2 safety check failed: missing ${needle}.`);
  }
}

if (CHECK_ONLY) {
  console.log("V31B.3.2 compatibility check passed. No files were changed.");
  console.log("  V31B.3.1 clean wall corners: preserved");
  console.log("  floor tiles remain exact 1.00 tiles");
  console.log("  wall-adjacent floor half-strips: enabled");
  console.log("  inside-corner quarter fills: enabled");
  console.log("  door/window wall positions included");
  console.log("  same floor InstancedMesh: no additional draw calls");
  console.log("  V31B.2 GPU warmup: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? source
  : source.replace(/\n/g, "\r\n");

fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V31B.3.2 wall-edge floor coverage.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
