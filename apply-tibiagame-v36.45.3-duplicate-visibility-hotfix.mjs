#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.45.3";

const LOADING = "crates/game-client/src/native_loading.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [LOADING, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(
      `Run from tibiaCloneGame root after V36.45.2. Missing ${rel}`,
    );
  }
}

console.log(
  `Checking TibiaGame V${VERSION} duplicate visibility hotfix...`,
);

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);

  const target = path.join(ROOT, rel);
  const raw = fs.readFileSync(target, "utf8");

  eols.set(
    rel,
    raw.includes("\r\n") ? "\r\n" : "\n",
  );

  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

let loading = read(LOADING);

const broken =
  "pub(crate) pub(crate) fn gameplay_ready(";
const fixed =
  "pub(crate) fn gameplay_ready(";

if (loading.includes(broken)) {
  loading = loading.replace(
    broken,
    fixed,
  );
} else if (!loading.includes(fixed)) {
  throw new Error(
    "Expected V36.45.2 duplicate gameplay_ready visibility not found. No files were written.",
  );
}

// Verify the actual V36.45.2 runtime fix remains intact.
if (!loading.includes(
  "state: Option<Res<NativeLoadingState>>"
)) {
  throw new Error(
    "V36.45.2 Option<Res<NativeLoadingState>> fix is missing. No files were written.",
  );
}

if (!loading.includes(
  "let Some(state) = state else"
)) {
  throw new Error(
    "V36.45.2 missing-resource guard is missing. No files were written.",
  );
}

save(LOADING, loading);

let versionFile = read(VERSION_FILE);

if (
  versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.2";',
  )
) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.45.2";',
    'pub const MIGRATION_VERSION: &str = "36.45.3";',
  );
} else if (
  !versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.3";',
  )
) {
  throw new Error(
    `${VERSION_FILE} is not on V36.45.2. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);

  const marker =
    "<!-- TIBIAGAME_V36_45_3_DUPLICATE_VISIBILITY_HOTFIX -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.45.3 fixes the malformed Rust declaration introduced by V36.45.2:

  pub(crate) pub(crate) fn gameplay_ready(

It is normalized to:

  pub(crate) fn gameplay_ready(

The V36.45.2 launcher-safe Option<Res<NativeLoadingState>> run-condition logic
is retained unchanged. No gameplay, loading, floor-transition or creature-safety
behavior changes.
`;

    save(DOC, doc);
  }
}

const finalLoading = read(LOADING);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    !finalLoading.includes(
      "pub(crate) pub(crate) fn gameplay_ready("
    ),
    "duplicate pub(crate) still present",
  ],
  [
    finalLoading.includes(
      "pub(crate) fn gameplay_ready("
    ),
    "gameplay_ready visibility missing",
  ],
  [
    finalLoading.includes(
      "state: Option<Res<NativeLoadingState>>"
    ),
    "launcher-safe Option<Res> fix missing",
  ],
  [
    finalLoading.includes(
      "let Some(state) = state else"
    ),
    "missing-resource false guard missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.45.3";'
    ),
    "version is not V36.45.3",
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
  console.log("- duplicate pub(crate) removed");
  console.log("- Option<Res<NativeLoadingState>> runtime fix retained");
  console.log("- no gameplay/loading/floor behavior changes");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);

  const original =
    fs.existsSync(target)
      ? fs.readFileSync(target, "utf8")
      : "";

  const eol =
    eols.get(rel) ?? "\n";

  const clean =
    normalized
      .replace(/[ \t]+$/gm, "")
      .replace(/\n+$/g, "\n");

  const output =
    eol === "\r\n"
      ? clean.replace(/\n/g, "\r\n")
      : clean;

  if (output !== original) {
    fs.writeFileSync(
      target,
      output,
      "utf8",
    );
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- Fixed duplicate gameplay_ready visibility.");
