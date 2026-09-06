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

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_4_1")) {
  console.log("TibiaGame V31B.4.1 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_4",
  "NATIVE WORLD V31B.4 active",
  "Mining copper vein...",
  "transform[6] + 0.3",
  "transform[6] + 1.4",
  "transform[6] + 2.25",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V31B.4.1 expects installed V31B.4 baseline: missing ${needle}. No files were written.`,
    );
  }
}

source = source
  .replace("transform[6] + 0.3", "(transform[6] ?? 0) + 0.3")
  .replace("transform[6] + 1.4", "(transform[6] ?? 0) + 1.4")
  .replace("transform[6] + 2.25", "(transform[6] ?? 0) + 2.25")
  .replace(
    "// TIBIAGAME_NATIVE_RENDERER_V31_B_4\n",
    "// TIBIAGAME_NATIVE_RENDERER_V31_B_4\n// TIBIAGAME_NATIVE_RENDERER_V31_B_4_1\n",
  )
  .replace(
    "NATIVE WORLD V31B.4 active · copper clarity + gather progress preview · raw Three.js",
    "NATIVE WORLD V31B.4.1 active · copper rotation typing hotfix · raw Three.js",
  )
  .replace(
    'data-native-world-renderer="v31b.4"',
    'data-native-world-renderer="v31b.4.1"',
  );

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_4_1",
  "(transform[6] ?? 0) + 0.3",
  "(transform[6] ?? 0) + 1.4",
  "(transform[6] ?? 0) + 2.25",
  "NATIVE WORLD V31B.4.1 active",
  'data-native-world-renderer="v31b.4.1"',
]) {
  if (!source.includes(needle)) {
    throw new Error(`V31B.4.1 safety check failed: missing ${needle}.`);
  }
}

if (CHECK_ONLY) {
  console.log("V31B.4.1 compatibility check passed. No files were changed.");
  console.log("  exact TS2532 copper rotation expressions: detected");
  console.log("  optional Transform rotation now defaults to 0");
  console.log("  copper clarity + gather progress: preserved");
  console.log("  V31B.3.4 profiler/prewarm: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? source
  : source.replace(/\n/g, "\r\n");

fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V31B.4.1 copper rotation typing hotfix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
