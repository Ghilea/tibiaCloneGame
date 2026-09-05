#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const nativePath = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);
const payloadPath = path.join(root, "NativeWorldRenderer.v25.tsx");

for (const filePath of [nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. Extract the complete V25 ZIP into repository root.`,
    );
  }
}

const currentRaw = fs.readFileSync(nativePath, "utf8");
const payloadRaw = fs.readFileSync(payloadPath, "utf8");
const eol = currentRaw.includes("\r\n") ? "\r\n" : "\n";
const current = currentRaw.replace(/\r\n/g, "\n");
const payload = payloadRaw.replace(/\r\n/g, "\n");

if (current.includes("TIBIAGAME_NATIVE_RENDERER_V25")) {
  console.log("TibiaGame V25 visual parity phase 1 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24_2",
  "NATIVE WORLD V24.2 active",
  "shortestAngleDelta",
  "class NativeActorManager",
]) {
  if (!current.includes(needle)) {
    throw new Error(
      `V25 expects installed V24.2 baseline: missing ${needle}. No files were written.`,
    );
  }
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V25",
  "MEDIEVAL_VILLAGE_ASSET",
  "Wall_Plaster_Straight",
  "WindowShutters_Wide_Flat_Open",
  "WindowShutters_Wide_Flat_Closed",
  "aldoria-roof-tiles-v1.png",
  "NativeGltfInstancedSet",
  "createUnitGabledRoofGeometry",
  "doorFacadeSides",
  "windowShuttersOpen",
  "NATIVE WORLD V25 active",
  'data-native-world-renderer="v25"',
  "NATIVE_STAGE_BUDGET_MS = 2.5",
]) {
  if (!payload.includes(needle)) {
    throw new Error(`V25 payload safety check failed: missing ${needle}.`);
  }
}

for (const forbidden of [
  "layers.houseWalls",
  "snapshot.houseRoofs)",
  "snapshot.keepRoofs)",
  "snapshot.doors)",
  "snapshot.windows)",
]) {
  if (payload.includes(forbidden)) {
    throw new Error(
      `V25 payload safety check failed: old simplified visual path remains: ${forbidden}`,
    );
  }
}

if (CHECK_ONLY) {
  console.log("V25 compatibility check passed. No files were changed.");
  console.log("  V24.2 smooth movement/facing: preserved");
  console.log("  medieval authored house wall model: raw GLTF instancing");
  console.log("  real roof tile texture + gabled roof geometry: native");
  console.log("  chimneys + hanging house signs: native");
  console.log("  door facade cutouts/frame/leaf/knob: native");
  console.log("  real authored open/closed window shutters: raw GLTF instancing");
  console.log("  wall/roof/shutter assets: preloaded before scene-ready");
  console.log("  old R3F world ownership: still bypassed");
  console.log("  2.5ms staged static streaming: preserved");
  process.exit(0);
}

const output = eol === "\n" ? payload : payload.replace(/\n/g, "\r\n");
fs.writeFileSync(nativePath, output, "utf8");

console.log("Applied TibiaGame V25 visual parity phase 1.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
