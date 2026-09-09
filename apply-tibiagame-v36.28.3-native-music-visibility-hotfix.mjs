#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.28.3";

const SETTINGS = "crates/game-client/src/native_settings.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [SETTINGS, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.28.2. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} native music visibility hotfix...`);

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

let settings = read(SETTINGS);

if (!settings.includes("pub(crate) struct NativeMusic")) {
  if (!settings.includes("struct NativeMusic")) {
    throw new Error(
      "NativeMusic declaration not found. No files were written.",
    );
  }
  settings = settings.replace(
    "struct NativeMusic",
    "pub(crate) struct NativeMusic",
  );
}

save(SETTINGS, settings);

let versionFile = read(VERSION_FILE);

if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.3";')) {
  // already applied
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.2";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.28.2";',
    'pub const MIGRATION_VERSION: &str = "36.28.3";',
  );
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.28.1";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.28.1";',
    'pub const MIGRATION_VERSION: &str = "36.28.3";',
  );
} else {
  throw new Error(
    `${VERSION_FILE} is not on V36.28.1/V36.28.2. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker = "<!-- TIBIAGAME_V36_28_3_NATIVE_MUSIC_VISIBILITY_HOTFIX -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.28.3 fixes the Bevy private-interface error for native music systems.
NativeMusic is now pub(crate), matching the crate-visible sync_world_music and
apply_audio_settings systems registered from main.rs.

No audio behavior or gameplay logic changes.
`;
    save(DOC, doc);
  }
}

const finalSettings = read(SETTINGS);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalSettings.includes("pub(crate) struct NativeMusic"),
    "NativeMusic is still private",
  ],
  [
    finalSettings.includes("pub fn sync_world_music("),
    "sync_world_music surface changed unexpectedly",
  ],
  [
    finalSettings.includes("pub fn apply_audio_settings("),
    "apply_audio_settings surface changed unexpectedly",
  ],
  [
    finalVersion.includes('pub const MIGRATION_VERSION: &str = "36.28.3";'),
    "version is not V36.28.3",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(`Post-check failed: ${message}. No files were written.`);
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- NativeMusic is pub(crate)");
  console.log("- sync_world_music can be registered from main.rs");
  console.log("- apply_audio_settings can be registered from main.rs");
  console.log("- no gameplay/audio behavior changes");
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
console.log("- Fixed NativeMusic visibility for Bevy system registration.");
