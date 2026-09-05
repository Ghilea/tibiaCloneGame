#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const paths = {
  server: path.join(root, "crates", "game-server", "src", "main.rs"),
  world: path.join(root, "apps", "client", "src", "game", "WorldState.ts"),
  three: path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx"),
  network: path.join(root, "apps", "client", "src", "game", "NetworkClient.ts"),
};

for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name} file: ${path.relative(root, file)}. Run this from the tibiaCloneGame repository root.`);
  }
}

function read(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { eol, text: raw.replace(/\r\n/g, "\n") };
}

function write(file, source) {
  const out = source.eol === "\n" ? source.text : source.text.replace(/\n/g, "\r\n");
  fs.writeFileSync(file, out, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. The repository has changed; no files were written.`);
  if (source.text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected one ${label}, found more than one. Refusing an ambiguous patch.`);
  }
  source.text = source.text.slice(0, first) + after + source.text.slice(first + before.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const matches = [...source.text.matchAll(regex)];
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}. Refusing an ambiguous patch.`);
  source.text = source.text.replace(regex, replacement);
}

const server = read(paths.server);
const world = read(paths.world);
const three = read(paths.three);
const network = read(paths.network);

const markerState = [server.text, world.text, three.text].map((text) => text.includes("TIBIAGAME_STREAMING_FIX_V2"));
if (markerState.every(Boolean)) {
  console.log("TIBIAGAME streaming performance fix V2 is already applied.");
  process.exit(0);
}
if (markerState.some(Boolean)) {
  throw new Error("V2 appears partially applied. Use git diff to inspect the working tree before re-running this script.");
}

// ---------------------------------------------------------------------------
// Server: never build/clone/serialize the replacement world region inline in
// the latency-critical MoveRequest handler. Delay it slightly and invalidate
// stale jobs with a generation counter. The already streamed +/-1 floor is
// therefore used immediately during stair transitions.
// ---------------------------------------------------------------------------
replaceOnce(
  server,
  "    sync::atomic::{AtomicBool, Ordering},",
  "    sync::atomic::{AtomicBool, AtomicU64, Ordering},",
  "AtomicU64 import",
);

replaceOnce(
  server,
  "    let mut streamed_region_center = position;\n\n    let (mut outgoing, mut incoming) = socket.split();",
  `    let mut streamed_region_center = position;\n    // TIBIAGAME_STREAMING_FIX_V2\n    // Region construction is speculative prefetch work. It must never sit on\n    // the MoveRequest critical path or fight the stair-transition frame.\n    let region_stream_generation = Arc::new(AtomicU64::new(0));\n\n    let (mut outgoing, mut incoming) = socket.split();`,
  "region stream generation state",
);

replaceRegexOnce(
  server,
  /                        if\s+refresh_world_region\s*\{\n                            let world = state\.world\.read\(\)\.await;[\s\S]*?                            streamed_region_center = position;\n                        \}/g,
  `                        if refresh_world_region {\n                            // Move immediately using the region/floors already in\n                            // memory. Build the replacement region later on a\n                            // separate task. 100 ms separates CPU/serialization\n                            // work from the movement/stair frame, while the\n                            // radius-48 payload still leaves a large safety margin.\n                            streamed_region_center = position;\n                            let region_state = state.clone();\n                            let generation_counter = Arc::clone(&region_stream_generation);\n                            let generation = generation_counter.fetch_add(1, Ordering::AcqRel) + 1;\n                            tokio::spawn(async move {\n                                tokio::time::sleep(Duration::from_millis(100)).await;\n                                if generation_counter.load(Ordering::Acquire) != generation {\n                                    return;\n                                }\n\n                                let message = {\n                                    let world = region_state.world.read().await;\n                                    world\n                                        .requires_region_streaming(WORLD_REGION_RADIUS)\n                                        .then(|| ServerMessage::WorldRegion {\n                                            map: Box::new(world.map_view_near_floors(\n                                                position,\n                                                WORLD_REGION_RADIUS,\n                                                WORLD_REGION_FLOOR_RADIUS,\n                                            )),\n                                            ground_items: world.ground_items_near_floors(\n                                                position,\n                                                WORLD_REGION_RADIUS,\n                                                WORLD_REGION_FLOOR_RADIUS,\n                                            ),\n                                            creatures: world.creature_views_near_floors(\n                                                position,\n                                                WORLD_REGION_RADIUS,\n                                                WORLD_REGION_FLOOR_RADIUS,\n                                            ),\n                                            npcs: world.npc_views_near_floors(\n                                                position,\n                                                WORLD_REGION_RADIUS,\n                                                WORLD_REGION_FLOOR_RADIUS,\n                                            ),\n                                            resource_nodes: world.resource_nodes_near_floors(\n                                                position,\n                                                WORLD_REGION_RADIUS,\n                                                WORLD_REGION_FLOOR_RADIUS,\n                                            ),\n                                        })\n                                };\n\n                                // A newer requested center supersedes this job.\n                                // This prevents an older async region from arriving\n                                // after a newer one and moving the client cache back.\n                                if generation_counter.load(Ordering::Acquire) != generation {\n                                    return;\n                                }\n                                if let Some(message) = message {\n                                    region_state.publish_update(id, message);\n                                }\n                            });\n                        }`,
  "inline world-region refresh block",
);

// ---------------------------------------------------------------------------
// WorldState: network regions still update collision/actor state, but static
// Three.js geometry gets a separate revision that changes only when geometry
// must visibly react (welcome, doors, windows). This is the key decoupling.
// ---------------------------------------------------------------------------
replaceOnce(
  world,
  "  visualRevision = 0;\n  localCorrectionRevision = 0;",
  `  visualRevision = 0;\n  // TIBIAGAME_STREAMING_FIX_V2\n  // Do not use MapView object identity as a static-scene revision. Region\n  // packets are cache fills; only real structure-state changes need a rebuild.\n  dynamicMapRevision = 0;\n  localCorrectionRevision = 0;`,
  "dynamic map revision field",
);

replaceOnce(
  world,
  "        this.map = message.map;\n        this.rebuildMapIndexes();\n        this.itemDefinitions.clear();",
  "        this.map = message.map;\n        this.dynamicMapRevision += 1;\n        this.rebuildMapIndexes();\n        this.itemDefinitions.clear();",
  "welcome map assignment",
);

replaceOnce(
  world,
  `      case "door_changed":\n        if (this.map) {\n          this.map = { ...this.map, doors: this.map.doors.map((door) => door.id === message.door.id ? message.door : door) };\n          this.doorsByTile.set(positionKey(message.door.position), message.door);\n        }\n        break;\n      case "window_changed":\n        if (this.map) {\n          this.map = { ...this.map, windows: this.map.windows.map((window) => window.id === message.window.id ? message.window : window) };\n          this.windowsByTile.set(positionKey(message.window.position), message.window);\n        }\n        break;`,
  `      case "door_changed":\n        if (this.map) {\n          this.map = { ...this.map, doors: this.map.doors.map((door) => door.id === message.door.id ? message.door : door) };\n          this.doorsByTile.set(positionKey(message.door.position), message.door);\n          this.dynamicMapRevision += 1;\n          notification = "visual";\n        }\n        break;\n      case "window_changed":\n        if (this.map) {\n          this.map = { ...this.map, windows: this.map.windows.map((window) => window.id === message.window.id ? message.window : window) };\n          this.windowsByTile.set(positionKey(message.window.position), message.window);\n          this.dynamicMapRevision += 1;\n          notification = "visual";\n        }\n        break;`,
  "door/window visual invalidation",
);

// ---------------------------------------------------------------------------
// ThreeWorld: keep the newest network MapView in a ref, but rebuild the static
// GPU scene only when the player changes a small render chunk, changes floor,
// or a door/window actually changes. This prevents each cache-fill packet from
// remounting terrain/structures and rebuilding shadows.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `// The server already streams a radius-48 region. Rebuilding the entire static\n// Three.js scene every 16 walked tiles caused a visible main-thread/GPU hitch.\n// Keep the static scene close to the camera. A 64 + 12 + 12 tile region is\n// comfortably larger than the viewport and avoids rebuilding the static\n// Three.js scene whenever the player crosses a small chunk boundary.\nconst RENDER_CHUNK_SIZE = 128;\nconst RENDER_PADDING = 12;`,
  `// TIBIAGAME_STREAMING_FIX_V2\n// The network cache is radius 48, but the GPU does not need to own that whole\n// payload at once. A 24-tile chunk with 8 tiles of padding is a 40x40 local\n// static scene: comfortably larger than the camera while dramatically cheaper\n// to construct than the previous worst-case 152x152 scene.\nconst RENDER_CHUNK_SIZE = 24;\nconst RENDER_PADDING = 8;`,
  "render chunk constants",
);

replaceOnce(
  three,
  `function StaticShadowMap({ revision }: { revision: MapView }) {\n  const { gl } = useThree();\n  useLayoutEffect(() => {\n    gl.shadowMap.needsUpdate = true;\n  }, [gl, revision]);\n  return null;\n}`,
  `function StaticShadowMap({ revision }: { revision: MapView }) {\n  const { gl } = useThree();\n  useEffect(() => {\n    // Do not stack the expensive shadow render on the exact frame that mounted\n    // a new static chunk/floor. A tiny visual delay is preferable to a hitch.\n    const handle = window.setTimeout(() => {\n      gl.shadowMap.needsUpdate = true;\n    }, 80);\n    return () => window.clearTimeout(handle);\n  }, [gl, revision]);\n  return null;\n}`,
  "deferred shadow-map refresh",
);

replaceOnce(
  three,
  `  const map = world.map;\n  // Region payloads replace MapView in one network message. Keep actor/input\n  // updates urgent, but let React prepare the large static Three.js diff as\n  // interruptible background work instead of blocking a movement frame.\n  const renderMap = useDeferredValue(map);\n  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;\n  const localVisualPosition = useRef(new THREE.Vector3(Number.NaN, 0.05, Number.NaN));\n  const floor = local?.position.z ?? map?.floor ?? 0;\n\n  if (!map || !renderMap) return null;\n  const chunkX = Math.floor((local?.position.x ?? 0) / RENDER_CHUNK_SIZE);\n  const chunkY = Math.floor((local?.position.y ?? 0) / RENDER_CHUNK_SIZE);\n  const region = useMemo(\n    () => createRenderRegion(renderMap, floor, chunkX, chunkY),\n    [renderMap, floor, chunkX, chunkY],\n  );`,
  `  const map = world.map;\n  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;\n  const localVisualPosition = useRef(new THREE.Vector3(Number.NaN, 0.05, Number.NaN));\n  const floor = local?.position.z ?? map?.floor ?? 0;\n\n  // Network regions are cache fills, not render-scene revisions. Keep the most\n  // recently delivered payload hot, but do not make its object identity a\n  // useMemo dependency. When the player reaches a new render chunk/floor we\n  // consume the latest already-prefetched payload.\n  const latestMapRef = useRef<MapView | null>(map);\n  if (map) latestMapRef.current = map;\n  const mapReady = map ? 1 : 0;\n  const chunkX = Math.floor((local?.position.x ?? 0) / RENDER_CHUNK_SIZE);\n  const chunkY = Math.floor((local?.position.y ?? 0) / RENDER_CHUNK_SIZE);\n  const renderChunkX = useDeferredValue(chunkX);\n  const renderChunkY = useDeferredValue(chunkY);\n  const dynamicMapRevision = world.dynamicMapRevision;\n  const region = useMemo(() => {\n    // Reading the revision here documents the intentional dependency: doors and\n    // windows invalidate the local static scene, ordinary region packets do not.\n    void dynamicMapRevision;\n    const source = mapReady ? latestMapRef.current : null;\n    return source ? createRenderRegion(source, floor, renderChunkX, renderChunkY) : null;\n  }, [mapReady, floor, renderChunkX, renderChunkY, dynamicMapRevision]);\n\n  if (!map || !region) return null;`,
  "WorldScene region cache",
);

// ---------------------------------------------------------------------------
// Network: the prefetch margin is several seconds of walking. Give the browser
// longer to find a genuinely idle slot before forcing WorldState.apply().
// ---------------------------------------------------------------------------
replaceOnce(
  network,
  "      ? idleWindow.requestIdleCallback(apply, { timeout: 500 })",
  "      ? idleWindow.requestIdleCallback(apply, { timeout: 1200 })",
  "world-region idle timeout",
);

const changed = [
  [paths.server, server],
  [paths.world, world],
  [paths.three, three],
  [paths.network, network],
];

if (CHECK_ONLY) {
  console.log("V2.1 compatibility check passed. No files were changed.");
  for (const [file] of changed) console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

for (const [file, source] of changed) write(file, source);

console.log("Applied TIBIAGAME streaming performance fix V2 (patcher 2.1).");
console.log("Changed:");
for (const [file] of changed) console.log(`  ${path.relative(root, file)}`);
console.log("\nNext run:");
console.log("  cargo fmt --all");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("\nThen inspect:");
console.log("  git diff -- crates/game-server/src/main.rs apps/client/src/game/WorldState.ts apps/client/src/game/ThreeWorld.tsx apps/client/src/game/NetworkClient.ts");
