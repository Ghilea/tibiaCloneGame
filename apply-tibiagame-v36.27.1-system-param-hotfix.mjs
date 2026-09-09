#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.27.1";

const MAIN = "crates/game-client/src/main.rs";
const TRADE_UI = "crates/game-client/src/native_trade_ui.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [MAIN, TRADE_UI, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.27. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} Bevy system-param hotfix...`);

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const target = path.join(ROOT, rel);
  const raw = fs.readFileSync(target, "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) {
    throw new Error(`${label}: expected source anchor not found. No files were written.`);
  }
  return text.replace(before, after);
}

// ---------------------------------------------------------------------------
// native_trade_ui.rs: group map + trade movement locks into one SystemParam.
// This reduces schedule_tile_movement from 17 Bevy system params to 16.
// ---------------------------------------------------------------------------
let trade = read(TRADE_UI);

if (!trade.includes("use bevy::ecs::system::SystemParam;")) {
  trade = replaceOnce(
    trade,
    "use bevy::prelude::*;\n",
    "use bevy::prelude::*;\nuse bevy::ecs::system::SystemParam;\n",
    "SystemParam import",
  );
}

const movementLocks = `
#[derive(SystemParam)]
pub(crate) struct MovementUiLocks<'w> {
    map_ui: Res<'w, NativeMapUiState>,
    trade_ui: Res<'w, NativeTradeUiState>,
}

impl MovementUiLocks<'_> {
    pub(crate) fn blocks_movement(&self) -> bool {
        self.map_ui.world_map_open || self.trade_ui.block_movement
    }
}

`;

if (!trade.includes("pub(crate) struct MovementUiLocks<'w>")) {
  const anchor = "#[derive(Resource, Default)]\npub(crate) struct NativeTradeUiState {";
  if (!trade.includes(anchor)) {
    throw new Error(
      "NativeTradeUiState anchor missing. No files were written.",
    );
  }
  trade = trade.replace(anchor, movementLocks + anchor);
}

save(TRADE_UI, trade);

// ---------------------------------------------------------------------------
// main.rs: replace two Res<T> params with one grouped SystemParam.
// ---------------------------------------------------------------------------
let main = read(MAIN);

const oldParams = `    map_ui: Res<native_map_ui::NativeMapUiState>,
    trade_ui: Res<native_trade_ui::NativeTradeUiState>,`;

const newParam = `    movement_ui_locks: native_trade_ui::MovementUiLocks,`;

if (!main.includes(newParam)) {
  if (!main.includes(oldParams)) {
    throw new Error(
      "Expected V36.27 movement map/trade params not found. No files were written.",
    );
  }
  main = main.replace(oldParams, newParam);
}

const oldGuards = `    if map_ui.world_map_open {
        return;
    }

    if trade_ui.block_movement {
        return;
    }`;

const newGuard = `    if movement_ui_locks.blocks_movement() {
        return;
    }`;

if (!main.includes(newGuard)) {
  if (!main.includes(oldGuards)) {
    throw new Error(
      "Expected V36.27 map/trade movement guards not found. No files were written.",
    );
  }
  main = main.replace(oldGuards, newGuard);
}

save(MAIN, main);

// ---------------------------------------------------------------------------
// version/docs
// ---------------------------------------------------------------------------
let versionFile = read(VERSION_FILE);

if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.27.1";')) {
  // already applied
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.27";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.27";',
    'pub const MIGRATION_VERSION: &str = "36.27.1";',
  );
} else {
  throw new Error(
    `${VERSION_FILE} does not contain V36.27. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker = "<!-- TIBIAGAME_V36_27_1_SYSTEM_PARAM_GROUPING -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.27.1 fixes the Bevy system-conversion failure introduced when direct-trade
movement locking pushed schedule_tile_movement to 17 system parameters.

NativeMapUiState + NativeTradeUiState are now grouped behind a single derived
SystemParam, MovementUiLocks. schedule_tile_movement therefore returns to the
supported Bevy system-parameter arity while preserving the same world-map and
trade movement locks.

No gameplay semantics are changed.
`;
    save(DOC, doc);
  }
}

// ---------------------------------------------------------------------------
// structural checks
// ---------------------------------------------------------------------------
const finalMain = read(MAIN);
const finalTrade = read(TRADE_UI);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalTrade.includes("use bevy::ecs::system::SystemParam;"),
    "SystemParam import missing",
  ],
  [
    finalTrade.includes("#[derive(SystemParam)]"),
    "MovementUiLocks is not a derived SystemParam",
  ],
  [
    finalTrade.includes("pub(crate) struct MovementUiLocks<'w>"),
    "MovementUiLocks missing",
  ],
  [
    finalTrade.includes("map_ui: Res<'w, NativeMapUiState>"),
    "map UI lock field missing",
  ],
  [
    finalTrade.includes("trade_ui: Res<'w, NativeTradeUiState>"),
    "trade UI lock field missing",
  ],
  [
    finalTrade.includes("self.map_ui.world_map_open || self.trade_ui.block_movement"),
    "combined movement-lock logic missing",
  ],
  [
    finalMain.includes("movement_ui_locks: native_trade_ui::MovementUiLocks,"),
    "schedule_tile_movement does not use grouped UI locks",
  ],
  [
    !finalMain.includes("trade_ui: Res<native_trade_ui::NativeTradeUiState>,"),
    "old standalone trade_ui system param remains",
  ],
  [
    !finalMain.includes("map_ui: Res<native_map_ui::NativeMapUiState>,"),
    "old standalone map_ui system param remains",
  ],
  [
    finalMain.includes("if movement_ui_locks.blocks_movement()"),
    "grouped movement guard missing",
  ],
  [
    finalVersion.includes('pub const MIGRATION_VERSION: &str = "36.27.1";'),
    "version is not V36.27.1",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(`Post-check failed: ${message}. No files were written.`);
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- map + trade movement locks grouped into one SystemParam");
  console.log("- schedule_tile_movement loses one Bevy system parameter");
  console.log("- .before/.after system registration becomes valid again");
  console.log("- no gameplay behavior changes");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);
  const original = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : "";

  const eol = eols.get(rel) ?? "\n";
  const clean = normalized
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "\n");

  const output =
    eol === "\r\n"
      ? clean.replace(/\n/g, "\r\n")
      : clean;

  if (output !== original) {
    fs.writeFileSync(target, output, "utf8");
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- Grouped map/trade movement locks into one Bevy SystemParam.");
