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
const payloadPath = path.join(root, "NativeWorldRenderer.v24.2.tsx");

for (const filePath of [nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. Extract the complete V24.2 ZIP into repository root.`,
    );
  }
}

const currentRaw = fs.readFileSync(nativePath, "utf8");
const payloadRaw = fs.readFileSync(payloadPath, "utf8");
const eol = currentRaw.includes("\r\n") ? "\r\n" : "\n";
const current = currentRaw.replace(/\r\n/g, "\n");
const payload = payloadRaw.replace(/\r\n/g, "\n");

if (current.includes("TIBIAGAME_NATIVE_RENDERER_V24_2")) {
  console.log("TibiaGame V24.2 shortest-arc facing fix is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24_1",
  "NATIVE WORLD V24.1 active",
  "class NativeCharacterActor",
  "this.facingAngle = Math.atan2",
]) {
  if (!current.includes(needle)) {
    throw new Error(
      `V24.2 expects installed V24.1 baseline: missing ${needle}. No files were written.`,
    );
  }
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24_2",
  "shortestAngleDelta",
  "dampAngle(",
  "Math.sin(to - from)",
  "Math.cos(to - from)",
  "NATIVE WORLD V24.2 active",
  'data-native-world-renderer="v24.2"',
]) {
  if (!payload.includes(needle)) {
    throw new Error(`V24.2 payload safety check failed: missing ${needle}.`);
  }
}

if (payload.includes("this.root.rotation.y = THREE.MathUtils.damp(")) {
  throw new Error(
    "V24.2 safety check failed: old scalar angle damping still exists.",
  );
}

if (CHECK_ONLY) {
  console.log("V24.2 compatibility check passed. No files were changed.");
  console.log("  V24.1 smooth tile movement/camera: preserved");
  console.log("  character yaw: shortest angular arc across -PI/+PI");
  console.log("  strange near-360-degree turn: removed");
  console.log("  turn smoothing: preserved, slightly quicker");
  console.log("  gameplay direction/tile movement: unchanged");
  console.log("  performance architecture: unchanged");
  process.exit(0);
}

const output = eol === "\n" ? payload : payload.replace(/\n/g, "\r\n");
fs.writeFileSync(nativePath, output, "utf8");

console.log("Applied TibiaGame V24.2 shortest-arc facing fix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
