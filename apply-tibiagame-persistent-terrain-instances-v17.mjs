#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const filePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");

if (!fs.existsSync(filePath)) {
  throw new Error("Missing apps/client/src/game/ThreeWorld.tsx. Run from repository root.");
}

const raw = fs.readFileSync(filePath, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_STREAMING_FIX_V17")) {
  console.log("TibiaGame persistent terrain instance fix V17 is already applied.");
  process.exit(0);
}
if (!text.includes("TIBIAGAME_STREAMING_FIX_V16")) {
  throw new Error("V17 expects V16 to be applied first. No files were written.");
}
if (!text.includes("TIBIAGAME_STREAMING_FIX_V15")) {
  throw new Error("V17 safety check failed: V15 terrain fix is missing.");
}

function replaceOnce(before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  text = text.slice(0, first) + after + text.slice(first + before.length);
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

replaceOnce(
  "const TERRAIN_CHUNK_HYSTERESIS = 4;",
  `const TERRAIN_CHUNK_HYSTERESIS = 4;

// TIBIAGAME_STREAMING_FIX_V17
// 32 + 16*2 = 64 tile terrain window => 4096 unique tile positions.
// Keep a little headroom without changing the visible terrain window.
const TERRAIN_INSTANCE_CAPACITY = 4608;`,
  "terrain hysteresis constant",
);

replaceFunction("InstancedTiles", "function InstancedTiles({\n  positions,\n  color,\n  height,\n  y,\n  scale = 0.98,\n  castShadow = false,\n  texture,\n}: {\n  positions: readonly Position[];\n  color: THREE.ColorRepresentation;\n  height: number;\n  y: number;\n  scale?: number;\n  castShadow?: boolean;\n  texture?: THREE.Texture;\n}) {\n  // TIBIAGAME_STREAMING_FIX_V17\n  // Keep the InstancedMesh constructor args constant across terrain-window\n  // handoffs. V14 used positions.length as the constructor count, so R3F had\n  // to reconstruct the mesh whenever a road/floor/material batch changed size.\n  //\n  // The matrix attribute may still be replaced atomically in the same commit,\n  // but geometry/material/InstancedMesh objects stay alive.\n  const instanceMatrix = useMemo(() => {\n    const data = new Float32Array(positions.length * 16);\n    const matrix = new THREE.Matrix4();\n    positions.forEach((tile, index) => {\n      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);\n      matrix.toArray(data, index * 16);\n    });\n    const attribute = new THREE.InstancedBufferAttribute(data, 16);\n    attribute.setUsage(THREE.DynamicDrawUsage);\n    return attribute;\n  }, [positions, y]);\n\n  if (!positions.length) return null;\n  return (\n    <instancedMesh\n      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}\n      count={positions.length}\n      castShadow={castShadow}\n      receiveShadow\n      frustumCulled={false}\n    >\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <boxGeometry args={[scale, height, scale]} />\n      <meshStandardMaterial map={texture} color={color} roughness={0.92} />\n    </instancedMesh>\n  );\n}");
replaceFunction("WaterTiles", "function WaterTiles({ positions }: { positions: readonly Position[] }) {\n  const waterTexture = useWorldTexture(\"/assets/world/aldoria-water-v1.png\");\n  const material = useMemo(() => new THREE.MeshPhysicalMaterial({\n    map: waterTexture,\n    color: \"#277789\",\n    emissive: \"#16424d\",\n    emissiveIntensity: 0.08,\n    metalness: 0.05,\n    roughness: 0.2,\n    transparent: true,\n    opacity: 0.86,\n  }), [waterTexture]);\n\n  // TIBIAGAME_STREAMING_FIX_V17\n  // Same persistent-capacity strategy as InstancedTiles. Disabling mesh-level\n  // frustum culling is intentional: the whole terrain window is already local\n  // to the player, while stale InstancedMesh bounds during a matrix swap can\n  // hide an otherwise valid water/terrain batch for a frame.\n  const instanceMatrix = useMemo(() => {\n    const data = new Float32Array(positions.length * 16);\n    const matrix = new THREE.Matrix4();\n    const quaternion = new THREE.Quaternion().setFromEuler(\n      new THREE.Euler(-Math.PI / 2, 0, 0),\n    );\n    const scale = new THREE.Vector3(1.02, 1.02, 1);\n    positions.forEach((tile, index) => {\n      matrix.compose(\n        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),\n        quaternion,\n        scale,\n      );\n      matrix.toArray(data, index * 16);\n    });\n    const attribute = new THREE.InstancedBufferAttribute(data, 16);\n    attribute.setUsage(THREE.DynamicDrawUsage);\n    return attribute;\n  }, [positions]);\n\n  useEffect(() => () => material.dispose(), [material]);\n  useFrame(({ clock }) => {\n    const wave = Math.sin(clock.elapsedTime * 1.6) * 0.035;\n    material.roughness = 0.2 + wave;\n    material.opacity = 0.84 + Math.sin(clock.elapsedTime * 1.25) * 0.035;\n    material.emissiveIntensity = 0.1 + wave;\n    waterTexture.offset.set(clock.elapsedTime * 0.032, clock.elapsedTime * 0.019);\n  });\n\n  if (!positions.length) return null;\n  return (\n    <instancedMesh\n      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}\n      count={positions.length}\n      receiveShadow\n      frustumCulled={false}\n    >\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <planeGeometry args={[1, 1]} />\n      <primitive object={material} attach=\"material\" />\n    </instancedMesh>\n  );\n}");

for (const functionName of ["InstancedTiles", "WaterTiles"]) {
  const range = functionRange(functionName);
  const block = text.slice(range.start, range.end);
  if (block.includes("args={[undefined, undefined, positions.length]}")) {
    throw new Error(`${functionName} still reconstructs by positions.length.`);
  }
  if (!block.includes("frustumCulled={false}")) {
    throw new Error(`${functionName} is missing terrain frustum-culling safety.`);
  }
  if (!block.includes("TERRAIN_INSTANCE_CAPACITY")) {
    throw new Error(`${functionName} is missing fixed instance capacity.`);
  }
}

if (!text.includes("RETAINED_STATIC_CACHE_LIMIT = 12")
    || !text.includes("RETAINED_STATIC_HARD_LIMIT = 18")) {
  throw new Error("V17 safety check failed: V16 retained cache settings were lost.");
}
if (!text.includes("pooledWorldGeometry")) {
  throw new Error("V17 safety check failed: V16 GPU resource pool is missing.");
}
if (!text.includes("TERRAIN_RENDER_PADDING = 16")
    || !text.includes("TERRAIN_CHUNK_HYSTERESIS = 4")) {
  throw new Error("V17 safety check failed: V15 terrain stability settings were lost.");
}

if (CHECK_ONLY) {
  console.log("V17 compatibility check passed. No files were changed.");
  console.log("  terrain/water InstancedMesh constructor capacity: fixed");
  console.log("  actual instance count: positions.length");
  console.log("  terrain mesh frustum culling: disabled");
  console.log("  V16 retained cache/pooling: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame persistent terrain instance fix V17.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client and test 32-tile terrain boundaries.");
