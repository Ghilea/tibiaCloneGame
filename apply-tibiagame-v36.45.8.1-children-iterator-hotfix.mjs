#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.45.8.1";

const LOADING = "crates/game-client/src/native_loading.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [LOADING, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(
      `Run from tibiaCloneGame root after V36.45.8. Missing ${rel}`,
    );
  }
}

console.log(
  `Checking TibiaGame V${VERSION} Children iterator compiler hotfix...`,
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
`            pending.extend(
                entity_children.iter().copied(),
            );`;

const fixed =
`            pending.extend(
                entity_children.iter(),
            );`;

if (loading.includes(broken)) {
  loading = loading.replace(
    broken,
    fixed,
  );
} else if (!loading.includes(fixed)) {
  throw new Error(
    "Expected V36.45.8 Children iterator expression not found. No files were written.",
  );
}

save(LOADING, loading);

let versionFile = read(VERSION_FILE);

if (
  versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.8";',
  )
) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.45.8";',
    'pub const MIGRATION_VERSION: &str = "36.45.8.1";',
  );
} else if (
  !versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.8.1";',
  )
) {
  throw new Error(
    `${VERSION_FILE} is not on V36.45.8. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);

  const marker =
    "<!-- TIBIAGAME_V36_45_8_1_CHILDREN_ITERATOR_HOTFIX -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.45.8.1 fixes the E0271 compiler error in
count_visible_descendant_meshes.

Bevy Children::iter() already yields Entity values for this API, so the extra
.copied() introduced by V36.45.8 attempted to copy an iterator that had already
performed that conversion.

The traversal now extends the pending Entity stack directly from:

  entity_children.iter()

No loading/readiness/render/floor behavior changes.
`;

    save(DOC, doc);
  }
}

const finalLoading = read(LOADING);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    !finalLoading.includes(
      "entity_children.iter().copied()"
    ),
    "redundant Children::iter().copied() remains",
  ],
  [
    finalLoading.includes(
      "pending.extend(\n                entity_children.iter(),\n            );"
    ),
    "direct Children iterator extension missing",
  ],
  [
    finalLoading.includes(
      "fn count_visible_descendant_meshes("
    ),
    "V36.45.8 render visibility helper missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.45.8.1";'
    ),
    "version is not V36.45.8.1",
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
  console.log("- removed redundant .copied() from Bevy Children iterator");
  console.log("- V36.45.8 render-visibility loading gate retained");
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
console.log("- Fixed Bevy Children iterator type mismatch.");
