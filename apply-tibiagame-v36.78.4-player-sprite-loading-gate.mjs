#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

const loadingPath = join(root, "crates/game-client/src/native_loading.rs");
const launcherPath = join(root, "crates/game-client/src/native_launcher.rs");
const playerSpritesPath = join(root, "crates/game-client/src/player_sprites.rs");

const MARKER = "TIBIAGAME_V36_78_4_PLAYER_SPRITE_LOADING_GATE";

function fail(message) {
  console.error("\nV36.78.4 PATCH FAILED: " + message);
  process.exit(1);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function replaceOnce(source, needle, replacement, label) {
  const hits = count(source, needle);
  if (hits !== 1) {
    fail(`${label} expected 1 occurrence, found ${hits}`);
  }
  return source.replace(needle, replacement);
}

if (!existsSync(loadingPath) || !existsSync(launcherPath)) {
  fail("Run this patch from the tibiaCloneGame repository root.");
}

if (!existsSync(playerSpritesPath)) {
  fail("player_sprites.rs is missing. Apply V36.78.1/V36.78.2 before V36.78.4.");
}

let loading = readFileSync(loadingPath, "utf8");
let launcher = readFileSync(launcherPath, "utf8");
const playerSprites = readFileSync(playerSpritesPath, "utf8");

if (loading.includes(MARKER)) {
  console.log("V36.78.4 already applied.");
  process.exit(0);
}

if (!playerSprites.includes("pub struct LocalPlayerSprite")) {
  fail("LocalPlayerSprite was not found in player_sprites.rs.");
}

const oldQuery =
`    player_model_roots: Query<Entity, With<crate::PlayerModelRoot>>,`;

const newQuery =
`    // ${MARKER}
    // V36.78 replaced the local GLTF/KayKit PlayerModelRoot with a Mesh3d
    // sprite entity. Startup readiness must therefore inspect that sprite,
    // otherwise visible_player_meshes stays at zero forever.
    player_sprite_roots: Query<Entity, With<crate::player_sprites::LocalPlayerSprite>>,`;

const oldCount =
`    let visible_player_meshes = player_model_roots
        .iter()
        .map(|root| count_visible_descendant_meshes(root, &children, &mesh_visibility))
        .sum::<usize>();`;

const newCount =
`    let visible_player_meshes = player_sprite_roots
        .iter()
        .map(|root| count_visible_descendant_meshes(root, &children, &mesh_visibility))
        .sum::<usize>();`;

const oldFooter =
`Text::new("Connection | world | actors | models | renderer")`;
const newFooter =
`Text::new("Connection | world | actors | sprites | renderer")`;

if (count(loading, oldQuery) !== 1) {
  fail(`old PlayerModelRoot loading query expected 1 occurrence, found ${count(loading, oldQuery)}`);
}
if (count(loading, oldCount) !== 1) {
  fail(`old visible player mesh calculation expected 1 occurrence, found ${count(loading, oldCount)}`);
}

if (checkOnly) {
  console.log("V36.78.4 PRECHECK PASSED");
  console.log("Will make startup visibility readiness inspect LocalPlayerSprite instead of PlayerModelRoot.");
  console.log("This fixes the permanent 91% 'Waiting for rendered world...' gate after the 2D player conversion.");
  if (launcher.includes(oldFooter)) {
    console.log("Will also rename the loading footer from models to sprites.");
  } else {
    console.log("Loading footer text differs from the original; UI text will be left unchanged.");
  }
  process.exit(0);
}

loading = replaceOnce(
  loading,
  oldQuery,
  newQuery,
  "replace PlayerModelRoot readiness query",
);
loading = replaceOnce(
  loading,
  oldCount,
  newCount,
  "replace visible player mesh calculation",
);

if (launcher.includes(oldFooter)) {
  launcher = launcher.replace(oldFooter, newFooter);
}

writeFileSync(loadingPath, loading, "utf8");
writeFileSync(launcherPath, launcher, "utf8");

console.log("V36.78.4 PATCH APPLIED");
console.log("Startup loading now validates the visible 2D player sprite mesh.");
console.log("The 91% visibility gate can complete once world/actors/render pipelines are stable.");
