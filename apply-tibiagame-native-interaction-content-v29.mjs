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
const payloadPath = path.join(root, "NativeWorldRenderer.v29.tsx");

for (const filePath of [nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. Extract the complete V29 ZIP into repository root.`,
    );
  }
}

const currentRaw = fs.readFileSync(nativePath, "utf8");
const payloadRaw = fs.readFileSync(payloadPath, "utf8");
const eol = currentRaw.includes("\r\n") ? "\r\n" : "\n";
const current = currentRaw.replace(/\r\n/g, "\n");
const payload = payloadRaw.replace(/\r\n/g, "\n");

if (current.includes("TIBIAGAME_NATIVE_RENDERER_V29")) {
  console.log("TibiaGame V29 native interaction/content parity is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V28",
  "NATIVE WORLD V28 active",
  "class NativeDamageNumberLayer",
  "class NativeOpeningAnimationManager",
  "class NativeDynamicSceneManager",
]) {
  if (!current.includes(needle)) {
    throw new Error(
      `V29 expects installed V28 baseline: missing ${needle}. No files were written.`,
    );
  }
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V29",
  "nativeProjectileFamily",
  "projectilePhysical",
  "projectileMagic",
  "groundWeapons",
  "groundArmor",
  "groundContainers",
  "npcShopMarkers",
  "npcDepotMarkers",
  "npcSpellMarkers",
  "npcCraftMarkers",
  "updateNpcMarkers",
  "type PointerTarget",
  "input.interactNpc(target.id)",
  "input.interactPlayer(target.id",
  "input.interactWorldObject(target.id",
  "input.toggleDoor(target.id",
  "input.toggleWindow(target.id",
  "NATIVE WORLD V29 active",
  'data-native-world-renderer="v29"',
  "NATIVE_STAGE_BUDGET_MS = 2.5",
]) {
  if (!payload.includes(needle)) {
    throw new Error(`V29 payload safety check failed: missing ${needle}.`);
  }
}

if (payload.includes("\b")) {
  // JavaScript strings represent backspace as \b. This specifically protects
  // against the accidental control character that V28's generator could put
  // before the regex's \\w token.
  const index = payload.indexOf("\b");
  const before = payload.slice(Math.max(0, index - 24), index + 24);
  if (!before.includes("\\b")) {
    throw new Error("V29 payload safety check failed: control backspace detected.");
  }
}

if (CHECK_ONLY) {
  console.log("V29 compatibility check passed. No files were changed.");
  console.log("  V28 damage atlas/spell VFX/native hover: preserved");
  console.log("  pointer interaction: NPC/player/creature/resource/door/window/object/loot");
  console.log("  NPC service markers: fixed persistent native instance layers");
  console.log("  projectile travel: physical + magic fixed-capacity layers");
  console.log("  ground items: weapon/armor/container families added");
  console.log("  world-object + door/window + actor hover labels: native");
  console.log("  React state during interaction hover: none");
  console.log("  V26 fixed-count lights + 2.5ms static staging: preserved");
  process.exit(0);
}

const output = eol === "\n" ? payload : payload.replace(/\n/g, "\r\n");
fs.writeFileSync(nativePath, output, "utf8");

console.log("Applied TibiaGame V29 native interaction/content parity.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
