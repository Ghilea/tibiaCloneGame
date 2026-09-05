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

if (text.includes("TIBIAGAME_STREAMING_FIX_V18_1")) {
  console.log("TibiaGame safe GPU warmup V18.1 is already applied.");
  process.exit(0);
}

for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V18",
  "TIBIAGAME_STREAMING_FIX_V17",
  "TIBIAGAME_STREAMING_FIX_V16",
  "TIBIAGAME_STREAMING_FIX_V15",
]) {
  if (!text.includes(marker)) {
    throw new Error(`V18.1 expects ${marker}. No files were written.`);
  }
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
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
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
  quote = null;
  escaped = false;
  lineComment = false;
  blockComment = false;

  for (let i = paramsEnd; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
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
  quote = null;
  escaped = false;
  lineComment = false;
  blockComment = false;

  for (let i = bodyStart; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
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

replaceFunction("compileSceneForWarmup", "function compileSceneForWarmup(\n  renderer: WarmupRenderer,\n  scene: THREE.Object3D,\n  camera: THREE.Camera,\n  initializeTextures: boolean,\n) {\n  // TIBIAGAME_STREAMING_FIX_V18_1\n  // Three r185's compileAsync can continue checking material readiness after\n  // this streaming scene has changed. That produced:\n  //   Cannot read properties of undefined (reading 'isReady')\n  //\n  // Initial warmup happens behind the loading screen, so prefer the synchronous\n  // WebGLRenderer.compile() path. It completes while retained-root visibility\n  // is held stable and cannot outlive this function.\n  return Promise.resolve(withRetainedStaticRootsVisible(scene, () => {\n    if (initializeTextures) initializeWarmupTextures(renderer, scene);\n    renderer.compile(scene, camera);\n  }));\n}");
replaceFunction("StaticSceneWarmup", "function StaticSceneWarmup({ revision: _revision }: { revision: string }) {\n  // TIBIAGAME_STREAMING_FIX_V18_1\n  // Disabled during gameplay.\n  //\n  // V18 scheduled compileAsync every time the retained chunk key set changed.\n  // Apart from the Three.js material-readiness crash, that work landed exactly\n  // around streaming boundaries and could itself create 100-250ms movement\n  // stalls. New-area optimization must be solved with shared/batched static\n  // resources, not by compiling the live mutable scene while the player walks.\n  return null;\n}");

// Ensure the unsafe runtime path is gone from these functions.
{
  const compileRange = functionRange("compileSceneForWarmup");
  const compileBlock = text.slice(compileRange.start, compileRange.end);
  if (compileBlock.includes("compileAsync(")) {
    throw new Error("V18.1 safety check failed: compileSceneForWarmup still calls compileAsync.");
  }
  if (!compileBlock.includes("renderer.compile(scene, camera)")) {
    throw new Error("V18.1 safety check failed: synchronous compile is missing.");
  }

  const runtimeRange = functionRange("StaticSceneWarmup");
  const runtimeBlock = text.slice(runtimeRange.start, runtimeRange.end);
  if (runtimeBlock.includes("requestIdleCallback")
      || runtimeBlock.includes("compileSceneForWarmup(")
      || runtimeBlock.includes(".compile(")) {
    throw new Error("V18.1 safety check failed: runtime scene compilation still exists.");
  }
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V18_1",
  "new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16)",
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "RETAINED_STATIC_CACHE_LIMIT = 12",
  "RETAINED_STATIC_HARD_LIMIT = 18",
  "pooledWorldGeometry",
  "<StaticSceneWarmup revision={staticGpuWarmupRevision} />",
]) {
  if (!text.includes(needle)) {
    throw new Error(`V18.1 safety check failed: missing ${needle}. No files were written.`);
  }
}

if (CHECK_ONLY) {
  console.log("V18.1 compatibility check passed. No files were changed.");
  console.log("  unsafe runtime compileAsync: removed");
  console.log("  initial loading-screen warmup: synchronous safe compile");
  console.log("  runtime StaticSceneWarmup: disabled");
  console.log("  V18 persistent terrain buffers: preserved");
  console.log("  V17 tile-flicker fix: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame safe GPU warmup V18.1.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client.");
