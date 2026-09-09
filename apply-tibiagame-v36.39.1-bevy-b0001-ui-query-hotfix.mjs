#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.39.1";

const UI = "crates/game-client/src/native_ui.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [UI, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.39. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} Bevy B0001 UI query hotfix...`);

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

let ui = read(UI);

const oldQueries = `    mut texts: Query<(&NativeUiText, &mut Text, &mut TextColor)>,
    mut action_slot_texts: Query<(&NativeActionSlotText, &mut Text)>,`;

const newQueries = `    mut texts: Query<
        (&NativeUiText, &mut Text, &mut TextColor),
        Without<NativeActionSlotText>,
    >,
    mut action_slot_texts: Query<
        (&NativeActionSlotText, &mut Text),
        Without<NativeUiText>,
    >,`;

if (!ui.includes(newQueries)) {
  if (!ui.includes(oldQueries)) {
    throw new Error(
      "Expected V36.38/V36.39 update_ui Text query pair not found. No files were written.",
    );
  }

  ui = ui.replace(oldQueries, newQueries);
}

save(UI, ui);

let versionFile = read(VERSION_FILE);

if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.39.1";')) {
  // already applied
} else if (versionFile.includes('pub const MIGRATION_VERSION: &str = "36.39";')) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.39";',
    'pub const MIGRATION_VERSION: &str = "36.39.1";',
  );
} else {
  throw new Error(
    `${VERSION_FILE} is not on V36.39. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker =
    "<!-- TIBIAGAME_V36_39_1_BEVY_B0001_UI_QUERY_HOTFIX -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.39.1 fixes the runtime Bevy error B0001 introduced by the clickable native
action bar.

native_ui::update_ui had two simultaneous mutable Text queries:
one for NativeUiText and one for NativeActionSlotText. Although those entities
are logically separate, Bevy cannot assume that from the original query
signatures and rejects the system at runtime.

The two queries are now explicitly disjoint with complementary Without filters:
the normal UI-text query excludes NativeActionSlotText and the action-slot query
excludes NativeUiText.

No visible UI, protocol, combat, movement, minimap, updater, world renderer,
floor gate or creature-safety behavior changes.
`;
    save(DOC, doc);
  }
}

const finalUi = read(UI);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalUi.includes("Without<NativeActionSlotText>"),
    "normal UI Text query does not exclude action-slot text",
  ],
  [
    finalUi.includes("Without<NativeUiText>"),
    "action-slot Text query does not exclude normal UI text",
  ],
  [
    !finalUi.includes(oldQueries),
    "conflicting mutable Text query pair still present",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.39.1";'
    ),
    "version is not V36.39.1",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(
      `Post-check failed: ${message}. No files were written.`,
    );
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- native_ui::update_ui Text queries are explicitly disjoint");
  console.log("- fixes Bevy runtime error B0001");
  console.log("- no UI behavior/gameplay/world/floor changes");
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
console.log("- Fixed Bevy B0001 conflicting mutable Text queries.");
