#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.28.2";

const SETTINGS = "crates/game-client/src/native_settings.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [SETTINGS, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.28.1. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} Bevy AudioPlayer type hotfix...`);

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

let settings = read(SETTINGS);

// Explicitly import AudioSource so the default source type is not left to inference.
if (!settings.includes("AudioSource,")) {
  settings = replaceOnce(
    settings,
    `        AudioSink,
        AudioSinkPlayback,`,
    `        AudioSink,
        AudioSinkPlayback,
        AudioSource,`,
    "AudioSource import",
  );
}

// Bevy 0.19.1 could not infer AudioPlayer's generic Source from AssetServer::load.
if (!settings.includes("AudioPlayer::<AudioSource>(")) {
  settings = replaceOnce(
    settings,
    `        AudioPlayer(asset_server.load(track)),`,
    `        AudioPlayer::<AudioSource>(asset_server.load::<AudioSource>(track)),`,
    "AudioPlayer explicit source type",
  );
}

save(SETTINGS, settings);

let versionFile = read(VERSION_FILE);

if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.2";')) {
  // already applied
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.1";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.28.1";',
    'pub const MIGRATION_VERSION: &str = "36.28.2";',
  );
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.28";',
    'pub const MIGRATION_VERSION: &str = "36.28.2";',
  );
} else {
  throw new Error(
    `${VERSION_FILE} is not on V36.28/V36.28.1. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker = "<!-- TIBIAGAME_V36_28_2_AUDIOPLAYER_SOURCE_HOTFIX -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.28.2 fixes Bevy 0.19.1 E0283 in native_settings::sync_world_music.
AudioPlayer and AssetServer::load now explicitly use bevy::audio::AudioSource,
so the generic audio source type no longer depends on inference.

No settings, music-mood, movement, map, floor or creature behavior changes.
`;
    save(DOC, doc);
  }
}

const finalSettings = read(SETTINGS);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalSettings.includes("AudioSource,"),
    "AudioSource import missing",
  ],
  [
    finalSettings.includes("AudioPlayer::<AudioSource>(asset_server.load::<AudioSource>(track))"),
    "AudioPlayer source type is still inferred",
  ],
  [
    !finalSettings.includes("AudioPlayer(asset_server.load(track))"),
    "old ambiguous AudioPlayer call remains",
  ],
  [
    finalVersion.includes('pub const MIGRATION_VERSION: &str = "36.28.2";'),
    "version is not V36.28.2",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(`Post-check failed: ${message}. No files were written.`);
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- imports bevy::audio::AudioSource");
  console.log("- AudioPlayer::<AudioSource> is explicit");
  console.log("- AssetServer::load::<AudioSource> is explicit");
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
console.log("- Explicit Bevy AudioSource typing added.");
