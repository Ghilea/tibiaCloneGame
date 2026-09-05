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

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V30_2_1")) {
  console.log("TibiaGame V30.2.1 startup occlusion hotfix is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V30_2",
  "NATIVE WORLD V30.2 active",
  "class NativeOcclusionFadeController",
  "buildingInteriorAtWorld(",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V30.2.1 expects installed V30.2 baseline: missing ${needle}. No files were written.`,
    );
  }
}

const broken = `        activeOcclusionFadeController.update(
          initialVisualLocal,
          nativeOcclusionEnabled,
        );`;

const fixed = `        activeOcclusionFadeController.update(
          initialVisualLocal,
          nativeOcclusionEnabled,
          false,
        );`;

if (!source.includes(broken)) {
  throw new Error(
    "V30.2.1 did not find the exact two-argument startup occlusion call. No files were written; do not force the patch.",
  );
}

const candidate = source
  .replace(broken, fixed)
  .replace(
    "// TIBIAGAME_NATIVE_RENDERER_V30_2\n",
    "// TIBIAGAME_NATIVE_RENDERER_V30_2\n// TIBIAGAME_NATIVE_RENDERER_V30_2_1\n",
  )
  .replace(
    "NATIVE WORLD V30.2 active · indoor roof/chimney fade + opening clarity · raw Three.js",
    "NATIVE WORLD V30.2.1 active · startup occlusion hotfix · raw Three.js",
  )
  .replace(
    'data-native-world-renderer="v30.2"',
    'data-native-world-renderer="v30.2.1"',
  )
  .replace(
    "NATIVE V30.2 · x ${local.position.x}",
    "NATIVE V30.2.1 · x ${local.position.x}",
  )
  .replace(
    "NATIVE V30.2 · x -- · y -- · z --",
    "NATIVE V30.2.1 · x -- · y -- · z --",
  )
  .replace(
    "Native V30.2 renderer bootstrap failed",
    "Native V30.2.1 renderer bootstrap failed",
  );

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V30_2_1",
  `activeOcclusionFadeController.update(
          initialVisualLocal,
          nativeOcclusionEnabled,
          false,
        );`,
  `activeOcclusionFadeController.update(
            visualLocal,
            nativeOcclusionEnabled,
            Boolean(indoorBuilding),
          );`,
  "NATIVE WORLD V30.2.1 active",
  'data-native-world-renderer="v30.2.1"',
]) {
  if (!candidate.includes(needle)) {
    throw new Error(`V30.2.1 safety check failed: missing ${needle}.`);
  }
}

if (CHECK_ONLY) {
  console.log("V30.2.1 compatibility check passed. No files were changed.");
  console.log("  exact TS2554 startup call: detected");
  console.log("  startup occlusion update: now passes third indoors argument");
  console.log("  runtime indoor detection: unchanged");
  console.log("  roof/chimney fade + opening clarity: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? candidate
  : candidate.replace(/\n/g, "\r\n");

fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V30.2.1 startup occlusion hotfix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
