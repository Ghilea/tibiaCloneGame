#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

const MARKER = "TIBIAGAME_V36_87_CRYPT_CREATURE_EXPANSION";
const REQUIRED = "TIBIAGAME_V36_86_SWAMP_CREATURE_EXPANSION";

const indexPath = path.join(root, "assets/actors/creatures/index.json");
const sourcePath = path.join(root, "crates/game-client/src/creature_sprites.rs");

const additions = [
  {
    game_definition_id: "crypt_guard",
    manifest: "actors/creatures/crypt_guard/actor.json",
  },
  {
    game_definition_id: "bone_acolyte",
    manifest: "actors/creatures/bone_acolyte/actor.json",
  },
];

const expectedAssets = new Map([
  ["assets/monsters/crypt_guard/atlases/crypt_guard_idle_albedo_8dir_aldoria_v36_87.png", [288,384]],
  ["assets/monsters/crypt_guard/atlases/crypt_guard_walk_albedo_8dir_aldoria_v36_87.png", [384,384]],
  ["assets/monsters/crypt_guard/atlases/crypt_guard_attack_albedo_8dir_aldoria_v36_87.png", [384,384]],
  ["assets/monsters/crypt_guard/atlases/crypt_guard_hit_albedo_8dir_aldoria_v36_87.png", [192,384]],
  ["assets/monsters/crypt_guard/atlases/crypt_guard_death_albedo_8dir_aldoria_v36_87.png", [384,384]],
  ["assets/monsters/bone_acolyte/atlases/bone_acolyte_idle_albedo_8dir_aldoria_v36_87.png", [288,384]],
  ["assets/monsters/bone_acolyte/atlases/bone_acolyte_walk_albedo_8dir_aldoria_v36_87.png", [384,384]],
  ["assets/monsters/bone_acolyte/atlases/bone_acolyte_attack_albedo_8dir_aldoria_v36_87.png", [384,384]],
  ["assets/monsters/bone_acolyte/atlases/bone_acolyte_hit_albedo_8dir_aldoria_v36_87.png", [192,384]],
  ["assets/monsters/bone_acolyte/atlases/bone_acolyte_death_albedo_8dir_aldoria_v36_87.png", [384,384]],
]);

function fail(message) {
  console.error("\nV36.87 PATCH FAILED: " + message);
  process.exit(1);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${path.relative(root, file)}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0,8).equals(sig) || bytes.toString("ascii",12,16) !== "IHDR") {
    fail(`invalid PNG: ${path.relative(root, file)}`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

if (!fs.existsSync(indexPath) || !fs.existsSync(sourcePath)) {
  fail("Run this patch from the tibiaCloneGame repository root.");
}

let source = fs.readFileSync(sourcePath, "utf8");
if (!source.includes(REQUIRED)) {
  fail("V36.86 Swamp Creature Expansion must be applied before V36.87.");
}

for (const [relative, expected] of expectedAssets) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    fail(`missing V36.87 atlas. Extract the COMPLETE ZIP first: ${relative}`);
  }
  const actual = pngSize(absolute);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    fail(`${relative} is ${actual[0]}x${actual[1]}, expected ${expected[0]}x${expected[1]}`);
  }
}

for (const addition of additions) {
  const file = path.join(root, "assets", ...addition.manifest.split("/"));
  const manifest = readJson(file, addition.game_definition_id + " actor manifest");

  if (manifest.schema !== 1 || manifest.id !== `creature.${addition.game_definition_id}`) {
    fail(`${addition.manifest}: unexpected schema/id`);
  }
  if (
    manifest.authored_directions !== 8 ||
    manifest.atlas_rows !== 8 ||
    manifest.frame_width !== 48 ||
    manifest.frame_height !== 48
  ) {
    fail(`${addition.manifest}: expected 8 directions / 8 rows / 48x48 frames`);
  }
  for (const animation of ["idle","walk","attack","hit","death"]) {
    if (!manifest.animations?.[animation]) {
      fail(`${addition.manifest}: missing '${animation}'`);
    }
  }
}

const index = readJson(indexPath, "creature actor index");
if (index.schema !== 1 || !Array.isArray(index.actors)) {
  fail("assets/actors/creatures/index.json must use schema 1.");
}

for (const existing of [
  "castle_rat",
  "mireling",
  "mire_skulker",
  "reed_stalker",
  "fen_brute",
]) {
  if (!index.actors.some((entry) => entry.game_definition_id === existing)) {
    fail(`V36.86 registry baseline is missing '${existing}'`);
  }
}

const cryptFallback = `        "crypt_guard" => (1.00, 1.38, Color::srgb(0.45, 0.52, 0.60)),
`;
const acolyteFallback = `        "bone_acolyte" => (0.95, 1.32, Color::srgb(0.78, 0.77, 0.67)),
`;

const alreadyRegistered = additions.every((wanted) =>
  index.actors.some(
    (entry) =>
      entry.game_definition_id === wanted.game_definition_id &&
      entry.manifest === wanted.manifest,
  ),
);

if (source.includes(MARKER) && alreadyRegistered) {
  console.log("V36.87 already applied.");
  process.exit(0);
}

if (count(source, cryptFallback) !== 1 || count(source, acolyteFallback) !== 1) {
  fail("expected the pre-V36.87 Crypt Guard/Bone Acolyte fallback rows exactly once");
}

if (checkOnly) {
  console.log("V36.87 PRECHECK PASSED");
  console.log("10 crypt creature atlases are present with exact 48x48 x 8-row contracts.");
  console.log("Will register crypt_guard + bone_acolyte through actor manifests/index.json.");
  console.log("Will remove their old solid-billboard fallback rows from Rust.");
  console.log("Bone Acolyte ranged attacks continue to use the generic Attack actor state.");
  process.exit(0);
}

const byId = new Map(index.actors.map((entry) => [entry.game_definition_id, entry]));
for (const addition of additions) {
  const existing = byId.get(addition.game_definition_id);
  if (existing && existing.manifest !== addition.manifest) {
    fail(`${addition.game_definition_id} is already registered to a different manifest`);
  }
  if (!existing) index.actors.push(addition);
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

source = source.replace(
  `// ${REQUIRED}\n`,
  `// ${REQUIRED}\n// ${MARKER}\n`,
);
source = source.replace(cryptFallback, "");
source = source.replace(acolyteFallback, "");
source = source.replace(/[ \t]*(?:\r?\n)+$/u, "\n");

if (source.includes('"crypt_guard"') || source.includes('"bone_acolyte"')) {
  fail("post-apply validation found a Crypt Guard/Bone Acolyte creature-specific Rust string");
}

fs.writeFileSync(sourcePath, source, "utf8");

console.log("V36.87 PATCH APPLIED");
console.log("crypt_guard + bone_acolyte now use the generic data-driven actor catalog.");
console.log("Their old Rust fallback style rows have been retired.");
