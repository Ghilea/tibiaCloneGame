#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const appPath = path.join(root, "apps", "client", "src", "App.tsx");
const nativePath = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);
const payloadPath = path.join(root, "NativeWorldRenderer.v24.tsx");

for (const filePath of [appPath, nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. V24 requires V23 to be installed and the complete ZIP extracted into repository root.`,
    );
  }
}

const app = fs.readFileSync(appPath, "utf8");
const currentRaw = fs.readFileSync(nativePath, "utf8");
const payloadRaw = fs.readFileSync(payloadPath, "utf8");

const currentEol = currentRaw.includes("\r\n") ? "\r\n" : "\n";
const current = currentRaw.replace(/\r\n/g, "\n");
const payload = payloadRaw.replace(/\r\n/g, "\n");

if (current.includes("TIBIAGAME_NATIVE_RENDERER_V24")) {
  console.log("TibiaGame V24 native actor migration is already applied.");
  process.exit(0);
}

if (!app.includes("TIBIAGAME_NATIVE_RENDERER_V23_DEFAULT")) {
  throw new Error(
    "V24 expects V23 native-default selection in App.tsx. No files were written.",
  );
}
if (
  !current.includes("TIBIAGAME_NATIVE_RENDERER_V23")
  || !current.includes("NATIVE WORLD V23 active")
) {
  throw new Error(
    "V24 expects the installed V23 NativeWorldRenderer baseline. No files were written.",
  );
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V24",
  "NATIVE WORLD V24 active",
  "loadNativeCharacterAssets",
  "loadNativeCreatureAssets",
  "NativeCharacterActor",
  "NativeSpriteCreatureActor",
  "NativeActorManager",
  "createLitSpriteMaterial",
  "CreatureAnimationController",
  "Rig_Medium_General.glb",
  "Rig_Medium_MovementBasic.glb",
  "castle_rat",
  "NATIVE_STAGE_BUDGET_MS = 2.5",
  'data-native-world-renderer="v24"',
]) {
  if (!payload.includes(needle)) {
    throw new Error(`V24 payload safety check failed: missing ${needle}.`);
  }
}

for (const forbidden of [
  "layers.localPlayer",
  "layers.players",
  "layers.npcs",
  "const updateActors = (floor: number)",
]) {
  if (payload.includes(forbidden)) {
    throw new Error(
      `V24 payload safety check failed: old benchmark actor path remains: ${forbidden}`,
    );
  }
}

if (CHECK_ONLY) {
  console.log("V24 compatibility check passed. No files were changed.");
  console.log("  V23 native world/texture renderer: preserved");
  console.log("  player rendering: existing KayKit models, raw Three.js");
  console.log("  player idle/walk: native AnimationMixer");
  console.log("  NPC rendering: existing KayKit models, raw Three.js");
  console.log("  castle rat: real sprite atlases + normal maps");
  console.log("  castle rat idle/walk/attack/hit/death: native animation");
  console.log("  actor assets: preloaded before scene-ready");
  console.log("  React Three Fiber actor ownership: removed from native path");
  console.log("  unsupported monsters: cheap native fallback remains");
  console.log("  2.5ms staged static streaming: preserved");
  process.exit(0);
}

const output = currentEol === "\n"
  ? payload
  : payload.replace(/\n/g, "\r\n");

fs.writeFileSync(nativePath, output, "utf8");

console.log("Applied TibiaGame V24 native actor migration.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
console.log("");
console.log("Production preview:");
console.log("  cd .\\apps\\client");
console.log("  npx vite preview --host 127.0.0.1 --port 1422");
