#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const filePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");

if (!fs.existsSync(filePath)) {
  throw new Error("Missing apps/client/src/game/ThreeWorld.tsx. Run this from the repository root.");
}

const raw = fs.readFileSync(filePath, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_STREAMING_FIX_V15")) {
  console.log("TibiaGame terrain boundary handoff fix V15 is already applied.");
  process.exit(0);
}

if (!text.includes("TIBIAGAME_STREAMING_FIX_V14")) {
  throw new Error("V15 expects V14 to be applied first. No files were written.");
}

function replaceOnce(before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) {
    throw new Error(`Could not find expected ${label}. No files were written.`);
  }
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

replaceOnce(
  "const RENDER_PADDING = 8;",
  `const RENDER_PADDING = 8;

// TIBIAGAME_STREAMING_FIX_V15
// Terrain gets a wider safety skirt than actors/dynamic entities. A 16-tile
// skirt keeps the camera covered during terrain handoff while the ordinary
// render region stays at its cheaper 8-tile padding.
const TERRAIN_RENDER_PADDING = 16;
// Do not swap terrain exactly on a 32-tile boundary. Server correction can
// otherwise move the logical player one tile back and forth around the border.
const TERRAIN_CHUNK_HYSTERESIS = 4;`,
  "RENDER_PADDING constant",
);

const terrainMarker = `  // TIBIAGAME_STREAMING_FIX_V14
  // Terrain knowledge is monotonic across OVERLAPPING render chunks.`;

const terrainMarkerIndex = text.indexOf(terrainMarker);
if (terrainMarkerIndex < 0) {
  throw new Error("Could not find the V14 terrain block. No files were written.");
}

const terrainAnchorBlock = `  // TIBIAGAME_STREAMING_FIX_V15
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

`;

text = text.slice(0, terrainMarkerIndex) + terrainAnchorBlock + text.slice(terrainMarkerIndex);

const terrainStart = text.indexOf(terrainMarker);
const terrainEndMarker = "  // TIBIAGAME_STREAMING_FIX_V6\n  const staticChunkX";
const terrainEnd = text.indexOf(terrainEndMarker, terrainStart);
if (terrainStart < 0 || terrainEnd < 0) {
  throw new Error("Could not isolate the V14 terrain block. No files were written.");
}

let terrainBlock = text.slice(terrainStart, terrainEnd);

function replaceInTerrain(before, after, label) {
  const first = terrainBlock.indexOf(before);
  if (first < 0) {
    throw new Error(`Could not find ${label} inside the V14 terrain block. No files were written.`);
  }
  if (terrainBlock.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches inside the V14 terrain block. No files were written.`);
  }
  terrainBlock =
    terrainBlock.slice(0, first)
    + after
    + terrainBlock.slice(first + before.length);
}

replaceInTerrain(
  "    const key = `${floor}:${chunkX}:${chunkY}`;",
  "    const key = `${floor}:${terrainChunkX}:${terrainChunkY}`;",
  "terrain cache key",
);

replaceInTerrain(
  "    const candidate = createRenderRegion(source, floor, chunkX, chunkY);",
  `    const candidate = createRenderRegion(
      source,
      floor,
      terrainChunkX,
      terrainChunkY,
      TERRAIN_RENDER_PADDING,
    );`,
  "terrain render-region creation",
);

replaceInTerrain(
  `    chunkX,
    chunkY,
    immediateStreamRegionRevision,`,
  `    terrainChunkX,
    terrainChunkY,
    immediateStreamRegionRevision,`,
  "terrain useMemo dependencies",
);

text = text.slice(0, terrainStart) + terrainBlock + text.slice(terrainEnd);

replaceOnce(
  "function createRenderRegion(map: MapView, floor: number, chunkX: number, chunkY: number) {",
  `function createRenderRegion(
  map: MapView,
  floor: number,
  chunkX: number,
  chunkY: number,
  padding = RENDER_PADDING,
) {`,
  "createRenderRegion signature",
);

const createStart = text.indexOf("function createRenderRegion(");
const createEnd = text.indexOf("\nfunction insideRenderBounds(", createStart);
if (createStart < 0 || createEnd < 0) {
  throw new Error("Could not isolate createRenderRegion. No files were written.");
}
let createBlock = text.slice(createStart, createEnd);

const expectedPaddingPatterns = [
  "chunkX * RENDER_CHUNK_SIZE - RENDER_PADDING",
  "chunkY * RENDER_CHUNK_SIZE - RENDER_PADDING",
  "(chunkX + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING",
  "(chunkY + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING",
];
for (const pattern of expectedPaddingPatterns) {
  if (!createBlock.includes(pattern)) {
    throw new Error(`Missing expected createRenderRegion padding expression: ${pattern}`);
  }
}
createBlock = createBlock
  .replace("chunkX * RENDER_CHUNK_SIZE - RENDER_PADDING", "chunkX * RENDER_CHUNK_SIZE - padding")
  .replace("chunkY * RENDER_CHUNK_SIZE - RENDER_PADDING", "chunkY * RENDER_CHUNK_SIZE - padding")
  .replace("(chunkX + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING", "(chunkX + 1) * RENDER_CHUNK_SIZE + padding")
  .replace("(chunkY + 1) * RENDER_CHUNK_SIZE + RENDER_PADDING", "(chunkY + 1) * RENDER_CHUNK_SIZE + padding");

text = text.slice(0, createStart) + createBlock + text.slice(createEnd);

for (const needle of [
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "terrainAnchorRef",
  "mergeOverlappingTerrainKnowledge",
  "terrainChunkX",
  "terrainChunkY",
  "padding = RENDER_PADDING",
]) {
  if (!text.includes(needle)) {
    throw new Error(`V15 safety check failed: missing ${needle}. No files were written.`);
  }
}

const ordinaryRegionCall = "const next = createRenderRegion(source, floor, chunkX, chunkY);";
if (!text.includes(ordinaryRegionCall)) {
  throw new Error(
    "V15 safety check failed: the ordinary dynamic render region no longer uses its original 8-tile default.",
  );
}

if (CHECK_ONLY) {
  console.log("V15 compatibility check passed. No files were changed.");
  console.log("  terrain padding: 16 tiles (dynamic region remains 8)");
  console.log("  terrain boundary hysteresis: 4 tiles");
  console.log("  V14 overlapping terrain cache: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame terrain boundary handoff fix V15.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client and test around 32-tile boundaries.");
