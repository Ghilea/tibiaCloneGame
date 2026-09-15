#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

const MARKER = "TIBIAGAME_V36_86_SWAMP_CREATURE_EXPANSION";
const REQUIRED = "TIBIAGAME_V36_85_MIRE_CREATURE_EXPANSION";

const indexPath = path.join(root, "assets/actors/creatures/index.json");
const sourcePath = path.join(root, "crates/game-client/src/creature_sprites.rs");

const additions = [
  {
    game_definition_id: "reed_stalker",
    manifest: "actors/creatures/reed_stalker/actor.json",
  },
  {
    game_definition_id: "fen_brute",
    manifest: "actors/creatures/fen_brute/actor.json",
  },
];

const expectedAssets = new Map([
  ["assets/monsters/reed_stalker/atlases/reed_stalker_idle_albedo_8dir_aldoria_v36_86.png", [288,384]],
  ["assets/monsters/reed_stalker/atlases/reed_stalker_walk_albedo_8dir_aldoria_v36_86.png", [384,384]],
  ["assets/monsters/reed_stalker/atlases/reed_stalker_attack_albedo_8dir_aldoria_v36_86.png", [384,384]],
  ["assets/monsters/reed_stalker/atlases/reed_stalker_hit_albedo_8dir_aldoria_v36_86.png", [192,384]],
  ["assets/monsters/reed_stalker/atlases/reed_stalker_death_albedo_8dir_aldoria_v36_86.png", [384,384]],
  ["assets/monsters/fen_brute/atlases/fen_brute_idle_albedo_8dir_aldoria_v36_86.png", [288,384]],
  ["assets/monsters/fen_brute/atlases/fen_brute_walk_albedo_8dir_aldoria_v36_86.png", [384,384]],
  ["assets/monsters/fen_brute/atlases/fen_brute_attack_albedo_8dir_aldoria_v36_86.png", [384,384]],
  ["assets/monsters/fen_brute/atlases/fen_brute_hit_albedo_8dir_aldoria_v36_86.png", [192,384]],
  ["assets/monsters/fen_brute/atlases/fen_brute_death_albedo_8dir_aldoria_v36_86.png", [384,384]],
]);

function fail(message) {
  console.error("\nV36.86 PATCH FAILED: " + message);
  process.exit(1);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0,8).equals(sig) || bytes.toString("ascii",12,16) !== "IHDR") {
    fail(`invalid PNG: ${path.relative(root, file)}`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${path.relative(root, file)}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

if (!fs.existsSync(indexPath) || !fs.existsSync(sourcePath)) {
  fail("V36.85 baseline was not found. Run from the tibiaCloneGame repository root.");
}

let source = fs.readFileSync(sourcePath, "utf8");
if (!source.includes(REQUIRED)) {
  fail("V36.85 Mire Creature Expansion must be applied before V36.86.");
}

for (const [relative, expected] of expectedAssets) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    fail(`missing V36.86 atlas. Extract the complete ZIP first: ${relative}`);
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

for (const existing of ["castle_rat", "mireling", "mire_skulker"]) {
  if (!index.actors.some((entry) => entry.game_definition_id === existing)) {
    fail(`V36.85 creature registry baseline is missing '${existing}'`);
  }
}

const reedFallback = `        "reed_stalker" => (0.95, 1.28, Color::srgb(0.48, 0.58, 0.25)),
`;
const fenFallback = `        "fen_brute" => (1.30, 1.55, Color::srgb(0.50, 0.36, 0.23)),
`;

const alreadyRegistered = additions.every((wanted) =>
  index.actors.some(
    (entry) =>
      entry.game_definition_id === wanted.game_definition_id &&
      entry.manifest === wanted.manifest,
  ),
);

if (source.includes(MARKER) && alreadyRegistered) {
  console.log("V36.86 already applied.");
  process.exit(0);
}

if (count(source, reedFallback) !== 1 || count(source, fenFallback) !== 1) {
  fail("expected the pre-V36.86 Reed Stalker/Fen Brute fallback rows exactly once");
}

if (checkOnly) {
  console.log("V36.86 PRECHECK PASSED");
  console.log("10 swamp creature atlases are present with exact 48x48 x 8-row contracts.");
  console.log("Will register reed_stalker + fen_brute via actor manifests/index.json.");
  console.log("Will remove their old solid-billboard fallback style rows from Rust.");
  console.log("No new creature-specific runtime branch will be added.");
  process.exit(0);
}

const byId = new Map(index.actors.map((entry) => [entry.game_definition_id, entry]));
for (const addition of additions) {
  const existing = byId.get(addition.game_definition_id);
  if (existing && existing.manifest !== addition.manifest) {
    fail(`${addition.game_definition_id} is already registered to a different manifest`);
  }
  if (!existing) {
    index.actors.push(addition);
  }
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

source = source.replace(
  `// ${REQUIRED}\n`,
  `// ${REQUIRED}\n// ${MARKER}\n`,
);
source = source.replace(reedFallback, "");
source = source.replace(fenFallback, "");
source = source.replace(/[ \t]*(?:\r?\n)+$/u, "\n");

if (source.includes('"reed_stalker"') || source.includes('"fen_brute"')) {
  fail("post-apply validation found a Reed Stalker/Fen Brute creature-specific Rust string");
}

fs.writeFileSync(sourcePath, source, "utf8");

console.log("V36.86 PATCH APPLIED");
console.log("reed_stalker + fen_brute now use the generic data-driven actor catalog.");
console.log("Their old Rust fallback style rows have been retired.");
