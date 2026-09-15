#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");

const actorReadmePath = join(root, "assets/actors/README.md");
const mainPath = join(root, "crates/game-client/src/main.rs");

const REQUIRED = "TIBIAGAME_V36_85_MIRE_CREATURE_EXPANSION";
const MARKER = "TIBIAGAME_V36_85_1_EOF_AND_DURATION_CLEANUP";

function fail(message) {
  console.error("\nV36.85.1 PATCH FAILED: " + message);
  process.exit(1);
}

if (!existsSync(actorReadmePath) || !existsSync(mainPath)) {
  fail("Run this patch from the tibiaCloneGame repository root.");
}

let docs = readFileSync(actorReadmePath, "utf8");
let main = readFileSync(mainPath, "utf8");

if (!docs.includes(REQUIRED)) {
  fail("V36.85 Mire Creature Expansion marker was not found in assets/actors/README.md.");
}

if (main.includes(MARKER)) {
  console.log("V36.85.1 already applied.");
  process.exit(0);
}

const durationImport = "use std::time::Duration;\n";
const durationImportCrLf = "use std::time::Duration;\r\n";
const durationHits =
  (main.includes(durationImport) ? 1 : 0) +
  (main.includes(durationImportCrLf) ? 1 : 0);

if (durationHits !== 1) {
  fail(`expected exactly one std::time::Duration import, found ${durationHits}`);
}

// Remove only the now-unused import reported by cargo check.
main = main.replace(durationImportCrLf, "").replace(durationImport, "");

// Record the cleanup next to the active V36.82 migration marker without
// touching runtime behavior.
const anchor = "// TIBIAGAME_V36_82_REMOVE_LEGACY_3D_ACTOR_PIPELINE";
if (!main.includes(anchor)) {
  fail("V36.82 migration marker was not found in main.rs.");
}
main = main.replace(
  anchor,
  `${anchor}\n// ${MARKER}`,
);

// Normalize EOF whitespace in both files to exactly one newline.
docs = docs.replace(/[ \t]*(?:\r?\n)+$/u, "\n");
main = main.replace(/[ \t]*(?:\r?\n)+$/u, "\n");

if (checkOnly) {
  console.log("V36.85.1 PRECHECK PASSED");
  console.log("Will remove the unused std::time::Duration import.");
  console.log("Will normalize assets/actors/README.md to exactly one final newline.");
  process.exit(0);
}

writeFileSync(actorReadmePath, docs, "utf8");
writeFileSync(mainPath, main, "utf8");

console.log("V36.85.1 PATCH APPLIED");
console.log("Unused Duration import removed.");
console.log("assets/actors/README.md EOF normalized.");
