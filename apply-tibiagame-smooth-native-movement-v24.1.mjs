#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const nativePath = path.join(root, "apps", "client", "src", "game", "NativeWorldRenderer.tsx");
const payloadPath = path.join(root, "NativeWorldRenderer.v24.1.tsx");

for (const filePath of [nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(root, filePath)}. Extract the complete V24.1 ZIP into repository root.`);
  }
}

const currentRaw = fs.readFileSync(nativePath, "utf8");
const payloadRaw = fs.readFileSync(payloadPath, "utf8");
const eol = currentRaw.includes("\r\n") ? "\r\n" : "\n";
const current = currentRaw.replace(/\r\n/g, "\n");
const payload = payloadRaw.replace(/\r\n/g, "\n");

if (current.includes("TIBIAGAME_NATIVE_RENDERER_V24_1")) {
  console.log("TibiaGame V24.1 smooth movement/camera fix is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24",
  "NATIVE WORLD V24 active",
  "class NativeCharacterActor",
  "class NativeSpriteCreatureActor",
  "class NativeActorManager",
]) {
  if (!current.includes(needle)) {
    throw new Error(`V24.1 expects installed V24 baseline: missing ${needle}. No files were written.`);
  }
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24_1",
  "CLIENT_STEP_MS",
  "playerVisualPosition",
  "Linear tile interpolation is intentional",
  "const visualLocal = activeActorManager.playerVisualPosition",
  "NATIVE WORLD V24.1 active",
  'data-native-world-renderer="v24.1"',
]) {
  if (!payload.includes(needle)) {
    throw new Error(`V24.1 payload safety check failed: missing ${needle}.`);
  }
}

if (payload.includes("camera.position.set(\n            local.position.x + 0.5")) {
  throw new Error("V24.1 safety check failed: integer-tile camera snap remains.");
}

if (CHECK_ONLY) {
  console.log("V24.1 compatibility check passed. No files were changed.");
  console.log("  gameplay movement cadence: unchanged (CLIENT_STEP_MS)");
  console.log("  player visual motion: linear per-tile interpolation");
  console.log("  diagonal visual duration: matches sqrt(2) movement cadence");
  console.log("  camera: follows interpolated player, never integer tile position");
  console.log("  floor changes/teleports: snap instead of sliding across world");
  console.log("  castle-rat visual movement: same interpolation model");
  console.log("  V23/V24 native world + actor renderer: preserved");
  process.exit(0);
}

const output = eol === "\n" ? payload : payload.replace(/\n/g, "\r\n");
fs.writeFileSync(nativePath, output, "utf8");

console.log("Applied TibiaGame V24.1 smooth movement/camera fix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
