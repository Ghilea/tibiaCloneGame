#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "35.13";
const MARKER = "TIBIAGAME_V35_13_WORLD_MAP_V2";

const files = {
  app: "apps/client/src/App.tsx",
  minimap: "apps/client/src/game/GameMinimap.tsx",
  worldMap: "apps/client/src/game/WorldMap.tsx",
  atlas: "apps/client/src/game/WorldMapAtlas.ts",
  css: "apps/client/src/game/WorldMap.css",
};

const bundled = {
  worldMap: path.join(PATCH_DIR, "WorldMap.v35_13.tsx"),
  atlas: path.join(PATCH_DIR, "WorldMapAtlas.v35_13.ts"),
  css: path.join(PATCH_DIR, "WorldMap.v35_13.css"),
};

for (const rel of [files.app, files.minimap, files.worldMap]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame repository root. Missing ${rel}`);
  }
}
for (const source of Object.values(bundled)) {
  if (!fs.existsSync(source)) {
    throw new Error(`Patch bundle is incomplete. Missing ${source}`);
  }
}

const pending = new Map();
const eols = new Map();

function load(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

function bundledText(name) {
  return fs.readFileSync(bundled[name], "utf8").replace(/\r\n/g, "\n");
}

function replaceOnce(rel, oldText, newText, label, already = null) {
  let text = load(rel);
  if (already && text.includes(already)) {
    console.log(`  already: ${label}`);
    return;
  }
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly one match in ${rel}, found ${count}. No files were written.`,
    );
  }
  text = text.replace(oldText, newText);
  save(rel, text);
  console.log(`  planned: ${label}`);
}

console.log(`Checking TibiaGame V${VERSION} World Map V2...`);

// The game already owns the correct M/Escape modal lifecycle. Reuse it.
const app = load(files.app);
for (const [ok, message] of [
  [app.includes('import { WorldMap } from "./game/WorldMap";'), "App.tsx does not import WorldMap"],
  [app.includes('const [worldMapOpen, setWorldMapOpen] = useState(false);'), "worldMapOpen state missing"],
  [app.includes('event.code === "KeyM"'), "M hotkey missing"],
  [app.includes('<WorldMap world={world} onClose={() => setWorldMapOpen(false)} />'), "WorldMap render hook missing"],
]) {
  if (!ok) throw new Error(`Safety check failed: ${message}. No files were written.`);
}
console.log("  verified: M/Escape already controls the WorldMap overlay");

// Replace legacy renderer with the V2 implementation from the bundle.
const oldWorldMap = load(files.worldMap);
const nextWorldMap = bundledText("worldMap");
if (!oldWorldMap.includes(MARKER)) {
  if (
    !oldWorldMap.includes("export function WorldMap")
    || !oldWorldMap.includes("function drawWorldMap")
  ) {
    throw new Error(
      "WorldMap.tsx no longer matches the expected legacy component. No files were written.",
    );
  }
  pending.set(files.worldMap, nextWorldMap);
  eols.set(files.worldMap, eols.get(files.worldMap) ?? "\n");
  console.log("  planned: replace legacy WorldMap with World Map V2");
} else if (oldWorldMap !== nextWorldMap) {
  pending.set(files.worldMap, nextWorldMap);
  console.log("  planned: refresh World Map V2 implementation");
} else {
  console.log("  already: World Map V2 implementation");
}

// Install the persistent coarse exploration atlas.
const nextAtlas = bundledText("atlas");
if (fs.existsSync(path.join(ROOT, files.atlas))) {
  const existing = load(files.atlas);
  if (!existing.includes("WORLD_MAP_ATLAS_CELL_SIZE")) {
    throw new Error(`${files.atlas} exists with unrelated contents. No files were written.`);
  }
  if (existing !== nextAtlas) {
    pending.set(files.atlas, nextAtlas);
    console.log("  planned: refresh world-map atlas cache module");
  } else {
    console.log("  already: world-map atlas cache module");
  }
} else {
  pending.set(files.atlas, nextAtlas);
  eols.set(files.atlas, "\n");
  console.log("  planned: create persistent low-resolution exploration atlas");
}

const nextCss = bundledText("css");
if (fs.existsSync(path.join(ROOT, files.css))) {
  const existing = load(files.css);
  if (!existing.includes(MARKER)) {
    throw new Error(`${files.css} exists with unrelated contents. No files were written.`);
  }
  if (existing !== nextCss) {
    pending.set(files.css, nextCss);
    console.log("  planned: refresh World Map V2 stylesheet");
  } else {
    console.log("  already: World Map V2 stylesheet");
  }
} else {
  pending.set(files.css, nextCss);
  eols.set(files.css, "\n");
  console.log("  planned: create WoW-like full map stylesheet");
}

// Minimap owns discovery. Feed discovery into the atlas only with debounced idle work.
replaceOnce(
  files.minimap,
  `import type { WorldState } from "./WorldState";
import { worldEnvironment, worldTimeLabel } from "./worldEnvironment";`,
  `import type { WorldState } from "./WorldState";
import { queueWorldMapAtlasCapture, flushWorldMapAtlasCapture } from "./WorldMapAtlas";
import { worldEnvironment, worldTimeLabel } from "./worldEnvironment";`,
  "connect minimap discovery to persistent world-map atlas",
  'from "./WorldMapAtlas"',
);

replaceOnce(
  files.minimap,
  `    discoveredRef.current = next;
    queueDiscoverySave();`,
  `    discoveredRef.current = next;
    queueDiscoverySave();
    queueWorldMapAtlasCapture(world, player.id, next);`,
  "queue atlas capture only when exploration expands",
  "queueWorldMapAtlasCapture(world, player.id, next);",
);

replaceOnce(
  files.minimap,
  `    const flush = () => {
      cancelQueuedDiscoverySave();
      persistDiscoveryNow();
    };`,
  `    const flush = () => {
      cancelQueuedDiscoverySave();
      persistDiscoveryNow();
      flushWorldMapAtlasCapture();
    };`,
  "flush chart cache on pagehide",
  "flushWorldMapAtlasCapture();",
);

let minimap = load(files.minimap);
if (!minimap.includes("TIBIAGAME_V35_13_ATLAS_REGION_CAPTURE")) {
  const anchor = `  // Normal movement never writes discovery synchronously. We flush on pagehide`;
  if (!minimap.includes(anchor)) {
    throw new Error("Could not locate minimap discovery flush anchor. No files were written.");
  }
  const effect = `  // TIBIAGAME_V35_13_ATLAS_REGION_CAPTURE
  useEffect(() => {
    if (!player || !world.map || discoveryOwner.current !== player.id) return;
    queueWorldMapAtlasCapture(world, player.id, discoveredRef.current);
  }, [player?.id, world.streamRegionRevision, world.dynamicMapRevision]);

`;
  minimap = minimap.replace(anchor, effect + anchor);
  save(files.minimap, minimap);
  console.log("  planned: chart newly streamed regions during idle time");
} else {
  console.log("  already: streamed-region atlas capture effect");
}

// Final in-memory assertions.
const worldMapFinal = pending.get(files.worldMap) ?? load(files.worldMap);
const atlasFinal = pending.get(files.atlas) ?? load(files.atlas);
const minimapFinal = load(files.minimap);

for (const [ok, message] of [
  [worldMapFinal.includes(MARKER), "World Map V2 marker missing"],
  [worldMapFinal.includes("buildAtlasIndex"), "atlas spatial index missing"],
  [worldMapFinal.includes("scale >= 0.7"), "live-map LOD guard missing"],
  [worldMapFinal.includes("coarse = cellWorldSize * scale < 0.9"), "far-zoom coarse LOD missing"],
  [atlasFinal.includes("requestIdleCallback"), "idle atlas capture missing"],
  [minimapFinal.includes("queueWorldMapAtlasCapture"), "minimap does not feed atlas cache"],
  [minimapFinal.includes("flushWorldMapAtlasCapture"), "atlas flush missing"],
]) {
  if (!ok) throw new Error(`Post-check failed: ${message}. No files were written.`);
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- M already toggles the map");
  console.log("- map redraws only on relevant state/view changes");
  console.log("- live static data is spatially bucketed");
  console.log("- extreme zoom uses coarse atlas bucket LOD");
  console.log("- discovered terrain persists via debounced idle capture");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);
  const original = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const eol = eols.get(rel) ?? "\n";
  const output = eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  if (output !== original) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- M opens/closes the upgraded WoW-style world map.");
console.log("- Drag pan, pointer-centered wheel zoom, floors and map filters added.");
console.log("- World / Zone / Player views added.");
console.log("- Exploration atlas persists discovered terrain across streamed regions.");
console.log("- No continuous world-map render loop.");
console.log("- Static data is bucket-indexed and extreme zoom uses coarse LOD.");
