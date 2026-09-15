#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const target = path.join(root, "crates/game-client/src/telegraph_visuals.rs");

const REQUIRED = "TIBIAGAME_V36_88_CELLAR_WARDEN_AREA_TELEGRAPH";
const MARKER = "TIBIAGAME_V36_88_1_TELEGRAPH_VISIBILITY_FIX";

function fail(message) {
  console.error("\nV36.88.1 PATCH FAILED: " + message);
  process.exit(1);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function replaceOnce(source, needle, replacement, label) {
  const hits = count(source, needle);
  if (hits !== 1) {
    fail(`${label}: expected 1 occurrence, found ${hits}`);
  }
  return source.replace(needle, replacement);
}

if (!fs.existsSync(target)) {
  fail("crates/game-client/src/telegraph_visuals.rs is missing. V36.88 must be applied first.");
}

let source = fs.readFileSync(target, "utf8");

if (!source.includes(REQUIRED)) {
  fail("V36.88 telegraph marker was not found.");
}

if (source.includes(MARKER)) {
  console.log("V36.88.1 already applied.");
  process.exit(0);
}

for (const expected of [
  "struct AreaTelegraphTile {",
  "struct TelegraphVisualRuntime {",
  "pub fn update(",
]) {
  if (!source.includes(expected)) {
    fail(`unexpected V36.88 source; missing '${expected}'`);
  }
}

if (checkOnly) {
  console.log("V36.88.1 PRECHECK PASSED");
  console.log("Will expose the two Bevy system parameter types as pub(crate).");
  console.log("Will make telegraph_visuals::update explicitly pub(crate).");
  console.log("No telegraph behavior, timing, rendering or creature logic will change.");
  process.exit(0);
}

source = replaceOnce(
  source,
  `// ${REQUIRED}
`,
  `// ${REQUIRED}
// ${MARKER}
`,
  "hotfix marker",
);

source = replaceOnce(
  source,
  "struct AreaTelegraphTile {",
  "pub(crate) struct AreaTelegraphTile {",
  "AreaTelegraphTile visibility",
);

source = replaceOnce(
  source,
  "struct TelegraphVisualRuntime {",
  "pub(crate) struct TelegraphVisualRuntime {",
  "TelegraphVisualRuntime visibility",
);

source = replaceOnce(
  source,
  "pub fn update(",
  "pub(crate) fn update(",
  "update visibility",
);

source = source.replace(/[ \t]*(?:\r?\n)+$/u, "\n");
fs.writeFileSync(target, source, "utf8");

console.log("V36.88.1 PATCH APPLIED");
console.log("Telegraph system parameter visibility now matches its pub(crate) schedule use.");
