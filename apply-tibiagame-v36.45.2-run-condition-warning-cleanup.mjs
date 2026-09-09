#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.45.2";

const FILES = {
  main: "crates/game-client/src/main.rs",
  loading: "crates/game-client/src/native_loading.rs",
  network: "crates/game-client/src/network.rs",
  state: "crates/game-client/src/state.rs",
  version: "crates/game-client/src/version.rs",
  ui: "crates/game-client/src/native_ui.rs",
  theme: "crates/game-client/src/native_ui_theme.rs",
  map: "crates/game-client/src/native_map_ui.rs",
  launcher: "crates/game-client/src/native_launcher.rs",
  details: "crates/game-client/src/world_details.rs",
  doc: "docs/native-client-migration.md",
};

for (const rel of Object.values(FILES).filter((rel) => rel !== FILES.doc)) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(
      `Run from tibiaCloneGame root after V36.45.1. Missing ${rel}`,
    );
  }
}

console.log(
  `Checking TibiaGame V${VERSION} startup run-condition + warning cleanup...`,
);

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

function mustContain(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(
      `${label}: expected anchor not found. No files were written.`,
    );
  }
}

function functionBounds(text, functionName) {
  const token = `fn ${functionName}`;
  const start = text.indexOf(token);

  if (start === -1) {
    throw new Error(
      `${functionName}: function not found. No files were written.`,
    );
  }

  const brace = text.indexOf("{", start);
  if (brace === -1) {
    throw new Error(
      `${functionName}: opening brace missing. No files were written.`,
    );
  }

  let depth = 0;

  for (let index = brace; index < text.length; index += 1) {
    const ch = text[index];

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return [start, index + 1];
      }
    }
  }

  throw new Error(
    `${functionName}: closing brace missing. No files were written.`,
  );
}

function replaceFunction(text, functionName, replacement) {
  const [start, end] = functionBounds(text, functionName);

  // Keep any visibility / attributes that begin before the "fn" token only
  // when the replacement itself does not already include them.
  return text.slice(0, start) + replacement + text.slice(end);
}

function addAttributeBefore(text, needle, attribute, label) {
  const decorated = `${attribute}\n${needle}`;

  if (text.includes(decorated)) {
    return text;
  }

  mustContain(text, needle, label);
  return text.replace(needle, decorated);
}

// ===========================================================================
// Runtime ERROR: native_loading::gameplay_ready was Res<NativeLoadingState>.
// In the single-window architecture that resource intentionally does not exist
// during Login / Character Lobby. Bevy validates run conditions independently,
// so the missing resource panicked before SingleWindowGameActive could protect
// the gameplay system. Make the run condition launcher-safe.
// ===========================================================================
let loading = read(FILES.loading);

const safeGameplayReady = `fn gameplay_ready(
    state: Option<Res<NativeLoadingState>>,
) -> bool {
    let Some(state) = state else {
        return false;
    };

    !state.active()
}`;

const [gameplayReadyStart, gameplayReadyEnd] =
  functionBounds(loading, "gameplay_ready");

const gameplayReadyPrefix =
  loading.slice(
    Math.max(0, gameplayReadyStart - 32),
    gameplayReadyStart,
  );

const visibility =
  gameplayReadyPrefix.includes("pub(crate)")
    ? "pub(crate) "
    : "";

loading =
  loading.slice(0, gameplayReadyStart)
  + visibility
  + safeGameplayReady
  + loading.slice(gameplayReadyEnd);

save(FILES.loading, loading);

// ===========================================================================
// Warnings: keep intentional compatibility/state surfaces, but make that intent
// explicit and remove one false-positive ownership warning.
// ===========================================================================

// main.rs: warmup texture handles are retained solely to keep assets alive.
// Rename to underscore rather than suppressing.
let main = read(FILES.main);

if (main.includes("    textures: Vec<Handle<Image>>,")) {
  main = main.replace(
    "    textures: Vec<Handle<Image>>,",
    "    _textures: Vec<Handle<Image>>,",
  );
}

if (main.includes("CreatureWarmupHandles { textures }")) {
  main = main.replaceAll(
    "CreatureWarmupHandles { textures }",
    "CreatureWarmupHandles { _textures: textures }",
  );
}

save(FILES.main, main);

// network.rs: api_url + interactive CLI path are intentionally retained as
// compatibility/debug surfaces after normal launch moved to single-window mode.
let network = read(FILES.network);

network = addAttributeBefore(
  network,
  "    pub api_url: String,",
  "    #[allow(dead_code)]",
  "NativeLoginResult.api_url",
);

for (const [needle, label] of [
  ["pub fn connect_interactive(", "connect_interactive"],
  ["async fn open_session(", "open_session"],
  ["fn choose_character(", "choose_character"],
  ["fn prompt_line(", "prompt_line"],
]) {
  network = addAttributeBefore(
    network,
    needle,
    "#[allow(dead_code)]",
    label,
  );
}

save(FILES.network, network);

// state.rs: protocol state is retained for the continuing combat/UI migration.
let state = read(FILES.state);

state = addAttributeBefore(
  state,
  "pub struct NativeAbilityState {",
  "#[allow(dead_code)]",
  "NativeAbilityState",
);

state = addAttributeBefore(
  state,
  "pub struct NativeTelegraphState {",
  "#[allow(dead_code)]",
  "NativeTelegraphState",
);

save(FILES.state, state);

// version.rs: retained compatibility formatter.
let versionFile = read(FILES.version);

versionFile = addAttributeBefore(
  versionFile,
  "pub fn client_version() -> String {",
  "#[allow(dead_code)]",
  "client_version",
);

// Version bump.
if (
  versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.1";',
  )
) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.45.1";',
    'pub const MIGRATION_VERSION: &str = "36.45.2";',
  );
} else if (
  !versionFile.includes(
    'pub const MIGRATION_VERSION: &str = "36.45.2";',
  )
) {
  throw new Error(
    `${FILES.version} is not on V36.45.1. No files were written.`,
  );
}

save(FILES.version, versionFile);

// native_ui.rs: legacy text ActionBar marker is retained while graphical slot
// migration settles.
let ui = read(FILES.ui);

ui = addAttributeBefore(
  ui,
  "    ActionBar,",
  "    #[allow(dead_code)]",
  "NativeUiText::ActionBar",
);

save(FILES.ui, ui);

// native_ui_theme.rs: ROOT_BG is retained as a canonical palette token even
// though the loading overlay now uses a translucent value.
let theme = read(FILES.theme);

theme = addAttributeBefore(
  theme,
  "pub(crate) const ROOT_BG: Color =",
  "#[allow(dead_code)]",
  "ROOT_BG",
);

save(FILES.theme, theme);

// native_map_ui.rs: ASCII MinimapBody fallback remains intentionally available.
let map = read(FILES.map);

map = addAttributeBefore(
  map,
  "    MinimapBody,",
  "    #[allow(dead_code)]",
  "NativeMapText::MinimapBody",
);

save(FILES.map, map);

// native_launcher.rs: old US-keyboard helper is retained as fallback/history.
let launcher = read(FILES.launcher);

launcher = addAttributeBefore(
  launcher,
  "fn append_text_input(",
  "#[allow(dead_code)]",
  "append_text_input",
);

save(FILES.launcher, launcher);

// world_details.rs: fields are authoritative model data retained even where the
// current native renderer has not consumed them yet.
let details = read(FILES.details);

details = addAttributeBefore(
  details,
  "    pub edge: WallEdge,",
  "    #[allow(dead_code)]",
  "WorldDoor.edge",
);

details = addAttributeBefore(
  details,
  "    pub position: Position,",
  "    #[allow(dead_code)]",
  "WorldResource.position",
);

// WorldWindow has id, position and edge. By this point the first "position" and
// first "edge" may already be decorated in earlier structs. Decorate the fields
// within the WorldWindow block directly.
const worldWindowStart = details.indexOf("pub struct WorldWindow {");

if (worldWindowStart === -1) {
  throw new Error(
    "WorldWindow: expected struct not found. No files were written.",
  );
}

const worldWindowEnd = details.indexOf("}", worldWindowStart);

if (worldWindowEnd === -1) {
  throw new Error(
    "WorldWindow: closing brace missing. No files were written.",
  );
}

let worldWindowBlock =
  details.slice(worldWindowStart, worldWindowEnd + 1);

for (const field of [
  "    pub id: String,",
  "    pub position: Position,",
  "    pub edge: WallEdge,",
]) {
  const decorated =
    `    #[allow(dead_code)]\n${field}`;

  if (!worldWindowBlock.includes(decorated)) {
    mustContain(
      worldWindowBlock,
      field,
      `WorldWindow ${field.trim()}`,
    );

    worldWindowBlock =
      worldWindowBlock.replace(
        field,
        decorated,
      );
  }
}

details =
  details.slice(0, worldWindowStart)
  + worldWindowBlock
  + details.slice(worldWindowEnd + 1);

save(FILES.details, details);

// ===========================================================================
// Docs.
// ===========================================================================
if (fs.existsSync(path.join(ROOT, FILES.doc))) {
  let doc = read(FILES.doc);

  const marker =
    "<!-- TIBIAGAME_V36_45_2_RUN_CONDITION_WARNING_CLEANUP -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

V36.45.2 fixes the single-window launcher runtime panic caused by
native_loading::gameplay_ready requiring Res<NativeLoadingState> before a
character session has installed that resource. The run condition now accepts
Option<Res<NativeLoadingState>> and returns false while the launcher has no game
session.

The 16 warnings reported after V36.45.1 are also cleaned up. Creature warmup
handles use an underscore field because retaining the handles is their purpose.
Compatibility/debug helpers, protocol state surfaces and legacy UI fallback
markers that are intentionally retained are marked with targeted allow(dead_code)
attributes instead of using a crate-wide lint suppression.

No server protocol, gameplay authority, loading readiness, floor-transition gate
or creature-visibility safety is weakened.
`;

    save(FILES.doc, doc);
  }
}

// ===========================================================================
// Structural checks.
// ===========================================================================
const finalLoading = read(FILES.loading);
const finalMain = read(FILES.main);
const finalNetwork = read(FILES.network);
const finalState = read(FILES.state);
const finalVersion = read(FILES.version);
const finalUi = read(FILES.ui);
const finalTheme = read(FILES.theme);
const finalMap = read(FILES.map);
const finalLauncher = read(FILES.launcher);
const finalDetails = read(FILES.details);

const checks = [
  [
    finalLoading.includes(
      "state: Option<Res<NativeLoadingState>>"
    ),
    "launcher-safe gameplay_ready Option<Res> missing",
  ],
  [
    finalLoading.includes(
      "let Some(state) = state else"
    ),
    "missing-resource false branch missing",
  ],
  [
    finalMain.includes(
      "_textures: Vec<Handle<Image>>"
    ),
    "CreatureWarmupHandles underscore field missing",
  ],
  [
    finalMain.includes(
      "CreatureWarmupHandles { _textures: textures }"
    ),
    "CreatureWarmupHandles construction not updated",
  ],
  [
    finalNetwork.includes(
      "#[allow(dead_code)]\n    pub api_url: String,"
    ),
    "api_url warning cleanup missing",
  ],
  [
    finalNetwork.includes(
      "#[allow(dead_code)]\npub fn connect_interactive("
    ),
    "connect_interactive warning cleanup missing",
  ],
  [
    finalNetwork.includes(
      "#[allow(dead_code)]\nasync fn open_session("
    ),
    "open_session warning cleanup missing",
  ],
  [
    finalNetwork.includes(
      "#[allow(dead_code)]\nfn choose_character("
    ),
    "choose_character warning cleanup missing",
  ],
  [
    finalNetwork.includes(
      "#[allow(dead_code)]\nfn prompt_line("
    ),
    "prompt_line warning cleanup missing",
  ],
  [
    finalState.includes(
      "#[allow(dead_code)]\npub struct NativeAbilityState"
    ),
    "NativeAbilityState warning cleanup missing",
  ],
  [
    finalState.includes(
      "#[allow(dead_code)]\npub struct NativeTelegraphState"
    ),
    "NativeTelegraphState warning cleanup missing",
  ],
  [
    finalVersion.includes(
      "#[allow(dead_code)]\npub fn client_version()"
    ),
    "client_version warning cleanup missing",
  ],
  [
    finalUi.includes(
      "#[allow(dead_code)]\n    ActionBar,"
    ),
    "ActionBar warning cleanup missing",
  ],
  [
    finalTheme.includes(
      "#[allow(dead_code)]\npub(crate) const ROOT_BG"
    ),
    "ROOT_BG warning cleanup missing",
  ],
  [
    finalMap.includes(
      "#[allow(dead_code)]\n    MinimapBody,"
    ),
    "MinimapBody warning cleanup missing",
  ],
  [
    finalLauncher.includes(
      "#[allow(dead_code)]\nfn append_text_input("
    ),
    "append_text_input warning cleanup missing",
  ],
  [
    finalDetails.includes(
      "#[allow(dead_code)]\n    pub id: String,"
    ),
    "WorldWindow.id warning cleanup missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.45.2";'
    ),
    "version is not V36.45.2",
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
  console.log("- gameplay_ready tolerates missing NativeLoadingState in launcher");
  console.log("- all 16 reported warning sites handled");
  console.log("- no crate-wide lint suppression");
  console.log("- floor/creature/loading safety behavior retained");
  process.exit(0);
}

// Write only after all validation succeeds.
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
console.log("- Fixed launcher-safe loading run condition and warning set.");
