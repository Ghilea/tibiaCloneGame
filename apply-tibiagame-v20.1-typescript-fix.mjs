#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const testPath = path.join(root, "apps", "client", "src", "game", "WorldState.test.ts");

for (const filePath of [threePath, testPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(root, filePath)}. Run from repository root.`);
  }
}

function load(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const threeFile = load(threePath);
const testFile = load(testPath);
let three = threeFile.text;
let test = testFile.text;

if (three.includes("TIBIAGAME_STREAMING_FIX_V20_1")) {
  console.log("TibiaGame V20.1 TypeScript fix is already applied.");
  process.exit(0);
}
if (!three.includes("TIBIAGAME_STREAMING_FIX_V20")) {
  throw new Error("V20.1 expects V20 to be applied first. No files were written.");
}

function functionRange(source, functionName) {
  const needles = [`function ${functionName}`, `export function ${functionName}`];
  let start = -1;
  let needle = "";
  for (const candidate of needles) {
    const at = source.indexOf(candidate);
    if (at >= 0 && (start < 0 || at < start)) {
      start = at;
      needle = candidate;
    }
  }
  if (start < 0) throw new Error(`Could not find ${functionName}. No files were written.`);

  const paramsStart = source.indexOf("(", start + needle.length);
  if (paramsStart < 0) throw new Error(`Could not parse ${functionName}.`);

  let quote = null, escaped = false, lineComment = false, blockComment = false;
  let parenDepth = 0, paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
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
  if (paramsEnd < 0) throw new Error(`Could not parse ${functionName} parameters.`);

  let bodyStart = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = paramsEnd; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
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

  let depth = 0, end = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
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
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`Could not parse ${functionName} body.`);
  return { start, end };
}

function replaceFunction(source, name, replacement) {
  const { start, end } = functionRange(source, name);
  return source.slice(0, start) + replacement + source.slice(end);
}

three = replaceFunction(three, "mergeTerrainPositionLayer", "function mergeTerrainPositionLayer(\n  previous: Position[],\n  incoming: readonly Position[],\n): Position[] {\n  // TIBIAGAME_STREAMING_FIX_V20_1\n  // MapView owns mutable arrays. Keeping only incoming readonly avoids widening\n  // the merged region into readonly Position[].\n  if (incoming.length === 0) return previous;\n  const known = new Set(previous.map(tileKey));\n  let merged: Position[] | null = null;\n\n  for (const entry of incoming) {\n    const key = tileKey(entry);\n    if (known.has(key)) continue;\n    known.add(key);\n    if (!merged) merged = [...previous];\n    merged.push(entry);\n  }\n\n  return merged ?? previous;\n}");
three = replaceFunction(three, "mergeTerrainObjectMaskLayer", "function mergeTerrainObjectMaskLayer(\n  previous: MapView[\"objects\"],\n  incoming: MapView[\"objects\"],\n): WorldObjectView[] {\n  // TIBIAGAME_STREAMING_FIX_V20_1\n  // MapView.objects is optional for sparse/legacy authored regions.\n  const previousObjects = previous ?? [];\n  const incomingObjects = incoming ?? [];\n  if (incomingObjects.length === 0) return previousObjects;\n\n  const known = new Set(previousObjects.map((entry) => entry.id));\n  let merged: WorldObjectView[] | null = null;\n\n  for (const entry of incomingObjects) {\n    if (known.has(entry.id)) continue;\n    known.add(entry.id);\n    if (!merged) merged = [...previousObjects];\n    merged.push(entry);\n  }\n\n  return merged ?? previousObjects;\n}");

// Replace the unsafe optional objects access by locating the exact start/end
// statements rather than depending on whitespace or local type annotations.
{
  const startNeedle = "  const objectIds = new Set(current.map.objects.map(";
  const start = three.indexOf(startNeedle);
  if (start < 0) throw new Error("Could not find unsafe current.map.objects access.");

  const endNeedle = "  );";
  const end = three.indexOf(endNeedle, three.indexOf("const objects =", start));
  if (end < 0) throw new Error("Could not isolate overlapping object merge.");
  const endPos = end + endNeedle.length;

  const replacement = `  const currentObjects = current.map.objects ?? [];
  const knownObjects = known.map.objects ?? [];
  const objectIds = new Set(currentObjects.map((entry) => entry.id));
  const objects = mergeTerrainObjectMaskLayer(
    currentObjects,
    knownObjects.filter((entry) =>
      terrainPositionInsideBounds(entry.position, bounds)
      && !objectIds.has(entry.id),
    ),
  );`;
  three = three.slice(0, start) + replacement + three.slice(endPos);
}

// Remove only the prop inside the retained-chunk map.
{
  const start = three.indexOf("      {retainedStaticChunks.map((chunk) => (");
  const end = three.indexOf("      ))}", start);
  if (start < 0 || end < 0) throw new Error("Could not isolate RetainedStaticChunk JSX.");
  let block = three.slice(start, end);
  const line = "          onGround={onGround}\n";
  if (!block.includes(line)) {
    throw new Error("Could not find obsolete RetainedStaticChunk onGround prop.");
  }
  block = block.replace(
    line,
    `          {/* TIBIAGAME_STREAMING_FIX_V20_1: ground input belongs to Terrain. */}\n`,
  );
  three = three.slice(0, start) + block + three.slice(end);
}

// Update the single old protocol-v28 test fixture.
{
  const pattern = /world\.applyBatch\(\[\{\s*\n\s*type: "world_region", map, ground_items: \[\], creatures: \[\], npcs: \[\], resource_nodes: \[\],\s*\n\s*\}\]\);/;
  const matches = [...test.matchAll(new RegExp(pattern.source, "g"))];
  if (matches.length !== 1) {
    throw new Error(`Expected one old world_region test fixture, found ${matches.length}.`);
  }
  test = test.replace(pattern, `world.applyBatch([{
      type: "world_region",
      map,
      region_center: position(100, 100),
      region_radius: 64,
      region_floor_radius: 1,
      ground_items: [],
      creatures: [],
      npcs: [],
      resource_nodes: [],
    }]);`);
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V20_1",
  "previous: Position[]",
  "): WorldObjectView[]",
  "const currentObjects = current.map.objects ?? []",
  "const knownObjects = known.map.objects ?? []",
]) {
  if (!three.includes(needle)) throw new Error(`V20.1 safety check failed: missing ${needle}.`);
}
if (three.includes("current.map.objects.map(") || three.includes("known.map.objects.filter(")) {
  throw new Error("V20.1 safety check failed: unsafe optional objects access remains.");
}
for (const needle of [
  "region_center: position(100, 100)",
  "region_radius: 64",
  "region_floor_radius: 1",
]) {
  if (!test.includes(needle)) throw new Error(`V20.1 safety check failed: missing ${needle}.`);
}

if (CHECK_ONLY) {
  console.log("V20.1 compatibility check passed. No files were changed.");
  console.log("  terrain merge arrays: mutable MapView-compatible");
  console.log("  optional MapView.objects: handled");
  console.log("  RetainedStaticChunk onGround mismatch: fixed on apply");
  console.log("  protocol v28 test fixture metadata: fixed on apply");
  console.log("  V20 renderer architecture: unchanged");
  process.exit(0);
}

function denormalize(text, eol) {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}
fs.writeFileSync(threePath, denormalize(three, threeFile.eol), "utf8");
fs.writeFileSync(testPath, denormalize(test, testFile.eol), "utf8");

console.log("Applied TibiaGame V20.1 TypeScript fix.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("  apps/client/src/game/WorldState.test.ts");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("  npm run build");
