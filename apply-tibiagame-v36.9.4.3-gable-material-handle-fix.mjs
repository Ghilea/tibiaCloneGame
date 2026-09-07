#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.9.4.3";

const ARCH = "crates/game-client/src/world_architecture.rs";
const MAIN = "crates/game-client/src/main.rs";
const NETWORK = "crates/game-client/src/network.rs";
const MARKER = "TIBIAGAME_V36_9_4_3_GABLE_MATERIAL_HANDLE_FIX";

for (const rel of [ARCH, MAIN, NETWORK]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} gable material handle fix...`);

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

let arch = read(ARCH);

if (
  !arch.includes("fn spawn_gable_fill(")
  || !arch.includes("wall_material: Handle<StandardMaterial>")
) {
  throw new Error(
    "world_architecture.rs is not the expected V36.9.4.x file. No files were written.",
  );
}

// Each gable pair reuses the same Handle<StandardMaterial>. Clone the handle
// at the call site so neither branch moves the original handle.
let replacements = 0;
arch = arch.replace(
  /(\n\s*spawn_gable_fill\(\n\s*parent,\n\s*catalog,\n\s*)wall_material(\s*,)/g,
  (match, prefix, suffix) => {
    replacements += 1;
    return `${prefix}wall_material.clone()${suffix}`;
  },
);

if (replacements > 0) {
  console.log(`  planned: clone wall_material for ${replacements} gable-fill calls`);
} else if (
  (arch.match(/wall_material\.clone\(\)/g) || []).length >= 4
) {
  console.log("  already: gable-fill material handles are cloned");
} else {
  throw new Error(
    "Could not locate gable-fill wall_material call sites. No files were written.",
  );
}

if (!arch.includes(MARKER)) {
  const anchor = "fn spawn_gable_fill(";
  arch = arch.replace(
    anchor,
    `// ${MARKER}\n${anchor}`,
  );
}

save(ARCH, arch);

let main = read(MAIN)
  .replaceAll("ALDORIA NATIVE V36.9.4.2 ·", "ALDORIA NATIVE V36.9.4.3 ·")
  .replaceAll("ALDORIA NATIVE V36.9.4.1 ·", "ALDORIA NATIVE V36.9.4.3 ·")
  .replaceAll("ALDORIA NATIVE V36.9.4 ·", "ALDORIA NATIVE V36.9.4.3 ·")
  .replaceAll("Native V36.9.4.2 Live World", "Native V36.9.4.3 Live World")
  .replaceAll("Native V36.9.4.1 Live World", "Native V36.9.4.3 Live World")
  .replaceAll("Native V36.9.4 Live World", "Native V36.9.4.3 Live World");
save(MAIN, main);

let network = read(NETWORK)
  .replaceAll("Native client V36.9.4.2", "Native client V36.9.4.3")
  .replaceAll("Native client V36.9.4.1", "Native client V36.9.4.3")
  .replaceAll("Native client V36.9.4", "Native client V36.9.4.3")
  .replaceAll("0.1.0-native-v36.9.4.2", "0.1.0-native-v36.9.4.3")
  .replaceAll("0.1.0-native-v36.9.4.1", "0.1.0-native-v36.9.4.3")
  .replaceAll("0.1.0-native-v36.9.4", "0.1.0-native-v36.9.4.3");
save(NETWORK, network);

const finalArch = read(ARCH);
const finalMain = read(MAIN);
const finalNetwork = read(NETWORK);

for (const [ok, message] of [
  [
    (finalArch.match(/wall_material\.clone\(\)/g) || []).length >= 4,
    "not all four gable-fill material handles are cloned",
  ],
  [
    !/\n\s*spawn_gable_fill\(\n\s*parent,\n\s*catalog,\n\s*wall_material\s*,/.test(finalArch),
    "an un-cloned gable-fill wall_material call remains",
  ],
  [finalArch.includes(MARKER), "V36.9.4.3 marker missing"],
  [
    finalMain.includes("ALDORIA NATIVE V36.9.4.3"),
    "main version not updated",
  ],
  [
    finalNetwork.includes("0.1.0-native-v36.9.4.3"),
    "network version not updated",
  ],
]) {
  if (!ok) {
    throw new Error(`Post-check failed: ${message}. No files were written.`);
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- all four gable-fill calls clone the StandardMaterial handle");
  console.log("- no V36.9.4 rendering/streaming geometry is otherwise changed");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);
  const original = fs.readFileSync(target, "utf8");
  const eol = eols.get(rel) ?? "\n";
  const clean = normalized.replace(/[ \t]+$/gm, "").replace(/\n+$/g, "\n");
  const output = eol === "\r\n" ? clean.replace(/\n/g, "\r\n") : clean;
  if (output !== original) {
    fs.writeFileSync(target, output, "utf8");
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- Fixed moved StandardMaterial handle in both gable pairs.");
