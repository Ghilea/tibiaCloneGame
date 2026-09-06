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

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_3")) {
  console.log("TibiaGame V31B.3 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_2",
  "NATIVE WORLD V31B.2 active",
  "function appendNativeConnectedWalls(",
  "NATIVE V31B.2 GPU warmup:",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V31B.3 expects installed V31B.2 baseline: missing ${needle}. No files were written.`,
    );
  }
}

const oldHelper = `function appendNativeConnectedWalls(
  positions: readonly Position[],
  floor: number,
  centerX: number,
  centerY: number,
  height: number,
  thickness: number,
  target: Transform[],
  skip?: (position: Position) => boolean,
) {
  const wallSet = new Set(
    positions
      .filter((position) => position.z === floor)
      .map(tileKey),
  );
  const wallLength = 1.08;

  for (const position of positions) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    if (skip?.(position)) continue;

    const west = wallSet.has(
      \`\${position.x - 1}:\${position.y}:\${position.z}\`,
    );
    const east = wallSet.has(
      \`\${position.x + 1}:\${position.y}:\${position.z}\`,
    );
    const north = wallSet.has(
      \`\${position.x}:\${position.y - 1}:\${position.z}\`,
    );
    const south = wallSet.has(
      \`\${position.x}:\${position.y + 1}:\${position.z}\`,
    );

    const horizontal = west || east;
    const vertical = north || south;
    const x = position.x + 0.5;
    const z = position.y + 0.5;

    // At corners/T-junctions/crossings, emit both axes. Their slight overlap
    // deliberately closes the seam instead of leaving the old pillar gaps.
    if (horizontal) {
      target.push([
        x,
        height / 2,
        z,
        wallLength,
        height,
        thickness,
      ]);
    }
    if (vertical) {
      target.push([
        x,
        height / 2,
        z,
        thickness,
        height,
        wallLength,
      ]);
    }

    // An isolated authored wall tile is still a wall segment, never a post.
    if (!horizontal && !vertical) {
      target.push([
        x,
        height / 2,
        z,
        wallLength,
        height,
        thickness,
      ]);
    }
  }
}`;

const newHelper = `function appendNativeConnectedWalls(
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

    // Keep single loose wall markers useful, but do not turn connected corner
    // nodes into full-length crosses that protrude through each other.
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

const oldBuildingFloor = `  floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width - 0.18),
    0.09,
    Math.max(0.5, building.height - 0.18),
  ]);`;

const newBuildingFloor = `  // Let the floor continue underneath the wall footprint. The old -0.18
  // inset left a visible dark border around some rooms, especially downstairs.
  floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width),
    0.09,
    Math.max(0.5, building.height),
  ]);`;

const oldMapFloor = `  for (const position of map.floors) {
    if (nativeInside(position, floor, centerX, centerY))
      snapshot.floors.push(nativeTile(position, 0.025, 0.045));
  }`;

const newMapFloor = `  for (const position of map.floors) {
    if (nativeInside(position, floor, centerX, centerY))
      // 1.0 closes the old 0.02-tile seam without overlapping coplanar tiles.
      snapshot.floors.push(nativeTile(position, 0.025, 0.045, 1));
  }`;

function replaceExact(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(
      `V31B.3 exact anchor not found: ${label}. No files were written.`,
    );
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(
      `V31B.3 anchor not unique: ${label}. No files were written.`,
    );
  }
  source =
    source.slice(0, first)
    + after
    + source.slice(first + before.length);
}

replaceExact(oldHelper, newHelper, "connected wall builder");
replaceExact(oldBuildingFloor, newBuildingFloor, "building floor inset");
replaceExact(oldMapFloor, newMapFloor, "map floor tile scale");

replaceExact(
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_2\n",
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_2\n// TIBIAGAME_NATIVE_RENDERER_V31_B_3\n",
  "V31B.3 marker",
);
replaceExact(
  "NATIVE WORLD V31B.2 active · connected underground walls + GPU warmup · raw Three.js",
  "NATIVE WORLD V31B.3 active · clean wall corners + full floor coverage · raw Three.js",
  "startup label",
);
replaceExact(
  'data-native-world-renderer="v31b.2"',
  'data-native-world-renderer="v31b.3"',
  "renderer version",
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3",
  "const emittedPairs = new Set<string>();",
  "const segmentLength = 1 + jointOverlap;",
  "Math.max(0.5, building.width),",
  "nativeTile(position, 0.025, 0.045, 1)",
  "NATIVE V31B.2 GPU warmup:",
  "NATIVE WORLD V31B.3 active",
  'data-native-world-renderer="v31b.3"',
]) {
  if (!source.includes(needle)) {
    throw new Error(`V31B.3 safety check failed: missing ${needle}.`);
  }
}

if (source.includes("const wallLength = 1.08;")) {
  throw new Error(
    "V31B.3 safety check failed: old centered full-wall corner builder remains.",
  );
}

if (CHECK_ONLY) {
  console.log("V31B.3 compatibility check passed. No files were changed.");
  console.log("  V31B.2 gameplay GPU warmup: preserved");
  console.log("  wall corners: pairwise center-to-center segments");
  console.log("  corner/T-junction protruding crosses: removed");
  console.log("  wall joints: tiny overlap only to prevent seams");
  console.log("  map floor tiles: 0.98 -> 1.00 coverage");
  console.log("  building floor inset: removed");
  console.log("  atmosphere + authored props + copper vein: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? source
  : source.replace(/\n/g, "\r\n");
fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V31B.3 wall-corner/floor-coverage fix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
