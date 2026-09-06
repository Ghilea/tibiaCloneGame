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

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_3_1")) {
  console.log("TibiaGame V31B.3.1 is already applied.");
  process.exit(0);
}
if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_3")) {
  console.log("TibiaGame V31B.3 is already applied; V31B.3.1 is not needed.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_2",
  "function appendNativeConnectedWalls(",
  "function appendBridge(",
  "NATIVE V31B.2 GPU warmup:",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V31B.3.1 expects installed V31B.2 baseline: missing ${needle}. No files were written.`,
    );
  }
}

const newWallHelper = `function appendNativeConnectedWalls(
  positions: readonly Position[],
  floor: number,
  centerX: number,
  centerY: number,
  height: number,
  thickness: number,
  target: Transform[],
  skip?: (position: Position) => boolean,
) {
  const eligible = positions.filter(
    (position) =>
      position.z === floor
      && !skip?.(position),
  );
  const wallSet = new Set(eligible.map(tileKey));
  const emittedPairs = new Set<string>();
  const jointOverlap = Math.min(0.08, thickness * 0.18);
  const segmentLength = 1 + jointOverlap;

  for (const position of eligible) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;

    let connected = false;
    const neighbors = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ] as const;

    for (const neighbor of neighbors) {
      const nx = position.x + neighbor.dx;
      const ny = position.y + neighbor.dy;
      const neighborKey = \`\${nx}:\${ny}:\${position.z}\`;
      if (!wallSet.has(neighborKey)) continue;

      connected = true;
      const currentKey = tileKey(position);
      const pairKey = currentKey < neighborKey
        ? \`\${currentKey}|\${neighborKey}\`
        : \`\${neighborKey}|\${currentKey}\`;
      if (emittedPairs.has(pairKey)) continue;
      emittedPairs.add(pairKey);

      const horizontal = neighbor.dx !== 0;
      target.push([
        position.x + 0.5 + neighbor.dx * 0.5,
        height / 2,
        position.y + 0.5 + neighbor.dy * 0.5,
        horizontal ? segmentLength : thickness,
        height,
        horizontal ? thickness : segmentLength,
      ]);
    }

    if (!connected) {
      target.push([
        position.x + 0.5,
        height / 2,
        position.y + 0.5,
        1,
        height,
        thickness,
      ]);
    }
  }
}`;

function replaceFunctionByNextFunction(
  functionName,
  nextFunctionName,
  replacement,
) {
  const startToken = `function ${functionName}(`;
  const nextToken = `function ${nextFunctionName}(`;
  const start = source.indexOf(startToken);
  const next = source.indexOf(nextToken, start + startToken.length);

  if (start < 0 || next < 0 || next <= start) {
    throw new Error(
      `V31B.3.1 could not isolate ${functionName}() before ${nextFunctionName}(). No files were written.`,
    );
  }

  const between = source.slice(start, next);
  if (!between.includes("target: Transform[]")) {
    throw new Error(
      `V31B.3.1 found ${functionName}(), but its signature is unexpected. No files were written.`,
    );
  }

  source =
    source.slice(0, start)
    + replacement
    + "\n\n"
    + source.slice(next);
}

replaceFunctionByNextFunction(
  "appendNativeConnectedWalls",
  "appendBridge",
  newWallHelper,
);

// Building floor: tolerate formatting/comment differences, but only replace
// the exact numeric inset values in the appendBuilding floor push.
const buildingFloorPattern =
  /floors\.push\(\[\s*centerX,\s*0\.045,\s*centerY,\s*Math\.max\(0\.5,\s*building\.width\s*-\s*0\.18\),\s*0\.09,\s*Math\.max\(0\.5,\s*building\.height\s*-\s*0\.18\),\s*\]\);/m;

if (!buildingFloorPattern.test(source)) {
  throw new Error(
    "V31B.3.1 could not find the building floor -0.18 inset. No files were written.",
  );
}

source = source.replace(
  buildingFloorPattern,
  `floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width),
    0.09,
    Math.max(0.5, building.height),
  ]);`,
);

// Map floor tiles: tolerate whitespace but require the old 0.98-default call.
const mapFloorPattern =
  /snapshot\.floors\.push\(\s*nativeTile\(\s*position,\s*0\.025,\s*0\.045\s*\)\s*\)/m;

if (!mapFloorPattern.test(source)) {
  throw new Error(
    "V31B.3.1 could not find the old map floor nativeTile(...0.045) call. No files were written.",
  );
}

source = source.replace(
  mapFloorPattern,
  "snapshot.floors.push(nativeTile(position, 0.025, 0.045, 1))",
);

source = source.replace(
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_2\n",
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_2\n// TIBIAGAME_NATIVE_RENDERER_V31_B_3_1\n",
);

source = source.replace(
  "NATIVE WORLD V31B.2 active · connected underground walls + GPU warmup · raw Three.js",
  "NATIVE WORLD V31B.3.1 active · clean wall corners + full floor coverage · raw Three.js",
);

source = source.replace(
  'data-native-world-renderer="v31b.2"',
  'data-native-world-renderer="v31b.3.1"',
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3_1",
  "const emittedPairs = new Set<string>();",
  "const segmentLength = 1 + jointOverlap;",
  "Math.max(0.5, building.width),",
  "Math.max(0.5, building.height),",
  "nativeTile(position, 0.025, 0.045, 1)",
  "NATIVE V31B.2 GPU warmup:",
  "NATIVE WORLD V31B.3.1 active",
  'data-native-world-renderer="v31b.3.1"',
]) {
  if (!source.includes(needle)) {
    throw new Error(`V31B.3.1 safety check failed: missing ${needle}.`);
  }
}

if (source.includes("const wallLength = 1.08;")) {
  throw new Error(
    "V31B.3.1 safety check failed: old centered wall builder still remains.",
  );
}

if (CHECK_ONLY) {
  console.log("V31B.3.1 compatibility check passed. No files were changed.");
  console.log("  V31B.2 helper located structurally, not by exact text");
  console.log("  wall corners: pairwise center-to-center segments");
  console.log("  corner/T-junction protruding crosses: removed");
  console.log("  map floor tiles: full 1.00 coverage");
  console.log("  building floor -0.18 inset: removed");
  console.log("  V31B.2 GPU warmup: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? source
  : source.replace(/\n/g, "\r\n");

fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V31B.3.1 robust wall/floor fix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
