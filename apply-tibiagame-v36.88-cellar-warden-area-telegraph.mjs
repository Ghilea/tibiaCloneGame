#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const MARKER = "TIBIAGAME_V36_88_CELLAR_WARDEN_AREA_TELEGRAPH";
const REQUIRED = "TIBIAGAME_V36_87_CRYPT_CREATURE_EXPANSION";

const indexPath = path.join(root, "assets/actors/creatures/index.json");
const creaturePath = path.join(root, "crates/game-client/src/creature_sprites.rs");
const statePath = path.join(root, "crates/game-client/src/state.rs");
const mainPath = path.join(root, "crates/game-client/src/main.rs");
const telegraphPath = path.join(root, "crates/game-client/src/telegraph_visuals.rs");

const manifestEntry = {
  game_definition_id: "cellar_warden",
  manifest: "actors/creatures/cellar_warden/actor.json",
};

const expectedAssets = new Map([
  ["assets/monsters/cellar_warden/atlases/cellar_warden_idle_albedo_8dir_aldoria_v36_88.png", [288,384]],
  ["assets/monsters/cellar_warden/atlases/cellar_warden_walk_albedo_8dir_aldoria_v36_88.png", [384,384]],
  ["assets/monsters/cellar_warden/atlases/cellar_warden_attack_albedo_8dir_aldoria_v36_88.png", [480,384]],
  ["assets/monsters/cellar_warden/atlases/cellar_warden_hit_albedo_8dir_aldoria_v36_88.png", [192,384]],
  ["assets/monsters/cellar_warden/atlases/cellar_warden_death_albedo_8dir_aldoria_v36_88.png", [480,384]],
]);

function fail(message) {
  console.error("\nV36.88 PATCH FAILED: " + message);
  process.exit(1);
}
function count(source, needle) {
  return source.split(needle).length - 1;
}
function replaceOnce(source, needle, replacement, label) {
  const hits = count(source, needle);
  if (hits !== 1) fail(`${label}: expected 1 occurrence, found ${hits}`);
  return source.replace(needle, replacement);
}
function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} missing: ${path.relative(root,file)}`);
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch (error) { fail(`${label} invalid JSON: ${error.message}`); }
}
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0,8).equals(sig) || bytes.toString("ascii",12,16) !== "IHDR") {
    fail(`invalid PNG: ${path.relative(root,file)}`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

for (const file of [indexPath,creaturePath,statePath,mainPath,telegraphPath]) {
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(root,file)}; extract the COMPLETE V36.88 ZIP into repo root first`);
  }
}

let creature = fs.readFileSync(creaturePath,"utf8");
let state = fs.readFileSync(statePath,"utf8");
let main = fs.readFileSync(mainPath,"utf8");

if (!creature.includes(REQUIRED)) {
  fail("V36.87 Crypt Creature Expansion must be applied before V36.88.");
}

for (const [relative, expected] of expectedAssets) {
  const absolute = path.join(root,relative);
  if (!fs.existsSync(absolute)) fail(`missing atlas: ${relative}`);
  const actual = pngSize(absolute);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    fail(`${relative} is ${actual[0]}x${actual[1]}, expected ${expected[0]}x${expected[1]}`);
  }
}

const manifest = readJson(
  path.join(root,"assets/actors/creatures/cellar_warden/actor.json"),
  "Cellar Warden manifest"
);
if (
  manifest.schema !== 1 ||
  manifest.id !== "creature.cellar_warden" ||
  manifest.authored_directions !== 8 ||
  manifest.atlas_rows !== 8 ||
  manifest.frame_width !== 48 ||
  manifest.frame_height !== 48
) fail("Cellar Warden actor contract mismatch.");

for (const animation of ["idle","walk","attack","hit","death"]) {
  if (!manifest.animations?.[animation]) fail(`Cellar Warden missing ${animation}`);
}
if (manifest.animations.attack.frames !== 10 || manifest.animations.attack.fps !== 11) {
  fail("Cellar Warden slam must remain 10 frames @ 11 FPS.");
}

const index = readJson(indexPath,"creature index");
if (index.schema !== 1 || !Array.isArray(index.actors)) fail("creature index schema mismatch");
for (const id of [
  "castle_rat","mireling","mire_skulker","reed_stalker",
  "fen_brute","crypt_guard","bone_acolyte"
]) {
  if (!index.actors.some((entry) => entry.game_definition_id === id)) {
    fail(`V36.87 registry baseline missing '${id}'`);
  }
}

const alreadyRegistered = index.actors.some((entry) =>
  entry.game_definition_id === manifestEntry.game_definition_id &&
  entry.manifest === manifestEntry.manifest
);
if (creature.includes(MARKER) && state.includes(MARKER) && main.includes(MARKER) && alreadyRegistered) {
  console.log("V36.88 already applied.");
  process.exit(0);
}

const fallback = `        "cellar_warden" => (1.15, 1.48, Color::srgb(0.43, 0.36, 0.56)),
`;
if (count(creature,fallback) !== 1) fail("expected Cellar Warden fallback row exactly once");

for (const anchor of [
  "pub struct NativeTelegraphState {",
  "pub last_telegraph: Option<NativeTelegraphState>,",
  "last_telegraph: None,",
  "ServerMessage::AreaTelegraph {"
]) {
  if (!state.includes(anchor)) fail(`state.rs baseline missing '${anchor}'`);
}
if (!main.includes("mod player_sprites;")) fail("main.rs module baseline missing");
if (!main.includes("player_sprites::sync_local_player_outfit")) fail("main.rs schedule baseline missing");

if (checkOnly) {
  console.log("V36.88 PRECHECK PASSED");
  console.log("5 Cellar Warden atlases match the exact 8-direction actor contract.");
  console.log("Will register cellar_warden and remove its final solid fallback row.");
  console.log("Will add generic sequenced AreaTelegraph warning tiles and telegraphed Attack facing.");
  console.log("No warden_slam special-case branch will be added.");
  process.exit(0);
}

// Data-driven registration.
const existing = index.actors.find((entry) => entry.game_definition_id === "cellar_warden");
if (existing && existing.manifest !== manifestEntry.manifest) fail("cellar_warden already registered differently");
if (!existing) index.actors.push(manifestEntry);
fs.writeFileSync(indexPath,JSON.stringify(index,null,2)+"\n");

// Generic creature helper.
creature = replaceOnce(
  creature,
  `// ${REQUIRED}\n`,
  `// ${REQUIRED}\n// ${MARKER}\n`,
  "creature marker"
);
creature = creature.replace(fallback,"");

const attackFunction = `pub fn trigger_attack(sprite: &mut CreatureSprite, now: f64) {
    if sprite.animation != SpriteAnimation::Death {
        set_animation(sprite, SpriteAnimation::Attack, now);
    }
}
`;
if (!creature.includes("pub fn trigger_telegraphed_attack(")) {
  creature = replaceOnce(
    creature,
    attackFunction,
    `${attackFunction}
pub fn trigger_telegraphed_attack(
    sprite: &mut CreatureSprite,
    target: Position,
    now: f64,
) {
    if sprite.animation == SpriteAnimation::Death {
        return;
    }

    sprite.direction = SpriteDirection::from_delta(
        target.x - sprite.logical_position.x,
        target.y - sprite.logical_position.y,
        sprite.direction,
    );
    set_animation(sprite, SpriteAnimation::Attack, now);
}
`,
    "telegraphed attack helper"
  );
}
creature = creature.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
if (creature.includes('"cellar_warden"')) fail("cellar_warden special-case remained in creature runtime");
fs.writeFileSync(creaturePath,creature,"utf8");

// Generic repeated telegraph sequencing.
if (!state.includes(MARKER)) {
  state = `// ${MARKER}\n` + state;
  state = replaceOnce(
    state,
    `pub struct NativeTelegraphState {
    pub source_id: EntityId,
`,
    `pub struct NativeTelegraphState {
    pub sequence: u64,
    pub source_id: EntityId,
`,
    "NativeTelegraphState sequence"
  );
  state = replaceOnce(
    state,
    `    pub last_telegraph: Option<NativeTelegraphState>,
`,
    `    pub telegraph_visual_sequence: u64,
    pub last_telegraph: Option<NativeTelegraphState>,
`,
    "NativeGameState telegraph sequence"
  );
  state = replaceOnce(
    state,
    `            last_telegraph: None,
`,
    `            telegraph_visual_sequence: 0,
            last_telegraph: None,
`,
    "telegraph sequence initialization"
  );
  state = replaceOnce(
    state,
    `            } => {
                self.last_telegraph = Some(NativeTelegraphState {
                    source_id: *source_id,
                    position: *position,
                    effect_id: effect_id.clone(),
                    radius: *radius,
                    duration_ms: *duration_ms,
                });
            }
`,
    `            } => {
                self.telegraph_visual_sequence =
                    self.telegraph_visual_sequence.saturating_add(1);
                self.last_telegraph = Some(NativeTelegraphState {
                    sequence: self.telegraph_visual_sequence,
                    source_id: *source_id,
                    position: *position,
                    effect_id: effect_id.clone(),
                    radius: *radius,
                    duration_ms: *duration_ms,
                });
            }
`,
    "AreaTelegraph sequencing"
  );
}
state = state.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
fs.writeFileSync(statePath,state,"utf8");

// Separate systems avoid the existing large Bevy tuples.
if (!main.includes(MARKER)) {
  main = replaceOnce(
    main,
    `mod player_sprites;
`,
    `mod player_sprites;
mod telegraph_visuals;
// ${MARKER}
`,
    "telegraph module"
  );

  const single = `            .add_systems(
                Update,
                player_sprites::sync_local_player_outfit
                    .after(pump_network)
                    .run_if(single_window_game_active),
            )
`;
  main = replaceOnce(
    main,
    single,
    `${single}            .add_systems(
                Update,
                telegraph_visuals::update
                    .after(pump_network)
                    .before(creature_sprites::animate_creature_sprites)
                    .run_if(single_window_game_active),
            )
`,
    "single-window telegraph schedule"
  );

  const direct = `        .add_systems(Update, player_sprites::sync_local_player_outfit.after(pump_network))
`;
  main = replaceOnce(
    main,
    direct,
    `${direct}        .add_systems(
            Update,
            telegraph_visuals::update
                .after(pump_network)
                .before(creature_sprites::animate_creature_sprites),
        )
`,
    "direct telegraph schedule"
  );
}
main = main.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
fs.writeFileSync(mainPath,main,"utf8");

console.log("V36.88 PATCH APPLIED");
console.log("Cellar Warden is now fully data-driven.");
console.log("Generic sequenced AreaTelegraph warning tiles + source attack-facing are active.");
