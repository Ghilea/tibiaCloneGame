#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const files = {
  world: path.join(root, "crates", "game-server", "src", "world.rs"),
  three: path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx"),
};

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name}: ${path.relative(root, file)}. Run from the tibiaCloneGame repository root.`);
  }
}

function read(file) {
  const raw = fs.readFileSync(file, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

function write(file, source) {
  const out = source.eol === "\n" ? source.text : source.text.replace(/\n/g, "\r\n");
  fs.writeFileSync(file, out, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  const second = source.text.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(`Found multiple ${label} matches. No files were written.`);
  source.text = source.text.slice(0, first) + after + source.text.slice(first + before.length);
}

const world = read(files.world);
const three = read(files.three);

if (world.text.includes("TIBIAGAME_STREAMING_FIX_V3") &&
    three.text.includes("TIBIAGAME_STREAMING_FIX_V3")) {
  console.log("TibiaGame streaming stability fix V3 is already applied.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Server payload: current floor remains radius 48. Adjacent floors only need
// enough hot data to make stairs seamless; radius 24 cuts worst-case z±1 area
// to one quarter per floor.
// ---------------------------------------------------------------------------
replaceOnce(
  world,
  `            let mut next = self.map_view_near(Position { z: floor, ..center }, radius);`,
  `            // TIBIAGAME_STREAMING_FIX_V3
            // The current floor keeps the full streaming radius. Adjacent
            // floors are prefetch-only: radius 24 is enough to make stairs
            // seamless without tripling every large region payload.
            let adjacent_radius = radius.min(24);
            let mut next =
                self.map_view_near(Position { z: floor, ..center }, adjacent_radius);`,
  "adjacent-floor map preload",
);

replaceOnce(
  world,
  `fn position_in_region_floors(
    position: Position,
    center: Position,
    radius: i32,
    floor_radius: i16,
) -> bool {
    (i32::from(position.z) - i32::from(center.z)).abs()
        <= i32::from(floor_radius.max(0))
        && (position.x - center.x).abs() <= radius
        && (position.y - center.y).abs() <= radius
}`,
  `fn position_in_region_floors(
    position: Position,
    center: Position,
    radius: i32,
    floor_radius: i16,
) -> bool {
    let floor_delta = (i32::from(position.z) - i32::from(center.z)).abs();
    if floor_delta > i32::from(floor_radius.max(0)) {
        return false;
    }
    // TIBIAGAME_STREAMING_FIX_V3
    // Actors/items on adjacent floors are speculative preload data. Keep the
    // full radius on the active floor and a smaller hot window on z +/- 1.
    let effective_radius = if floor_delta == 0 {
        radius
    } else {
        radius.min(24)
    };
    (position.x - center.x).abs() <= effective_radius
        && (position.y - center.y).abs() <= effective_radius
}`,
  "multi-floor region predicate",
);

// ---------------------------------------------------------------------------
// Client static scene: V2's 24-tile chunk was intentionally small, but runtime
// testing shows that it creates too many full React/R3F commits while running.
// 48 + 10 padding stays far below V1's huge 152x152 worst case but halves the
// boundary frequency.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `// TIBIAGAME_STREAMING_FIX_V2
// The network cache is radius 48, but the GPU does not need to own that whole
// payload at once. A 24-tile chunk with 8 tiles of padding is a 40x40 local
// static scene: comfortably larger than the camera while dramatically cheaper
// to construct than the previous worst-case 152x152 scene.
const RENDER_CHUNK_SIZE = 24;
const RENDER_PADDING = 8;`,
  `// TIBIAGAME_STREAMING_FIX_V2
// TIBIAGAME_STREAMING_FIX_V3
// Runtime profiling showed that V2's 24-tile chunk crossed boundaries too
// frequently while sprinting. A 48-tile chunk with 10 tiles of padding keeps
// the local static scene bounded (~68x68) but halves scene-swap frequency.
const RENDER_CHUNK_SIZE = 48;
const RENDER_PADDING = 10;`,
  "V2 render chunk constants",
);

// ---------------------------------------------------------------------------
// Shadow rebuilds are one of the nastiest single-frame GPU spikes. With
// autoUpdate=false, wait until movement has stopped for 450 ms. Every movement
// tile cancels/restarts the timer, so sprinting cannot trigger a shadow pass.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `function StaticShadowMap({ revision }: { revision: MapView }) {
  const { gl } = useThree();
  useEffect(() => {
    // Do not stack the expensive shadow render on the exact frame that mounted
    // a new static chunk/floor. A tiny visual delay is preferable to a hitch.
    const handle = window.setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
    }, 80);
    return () => window.clearTimeout(handle);
  }, [gl, revision]);
  return null;
}`,
  `function StaticShadowMap({
  revision,
  movementKey,
}: {
  revision: MapView;
  movementKey: string;
}) {
  const { gl } = useThree();
  useEffect(() => {
    // TIBIAGAME_STREAMING_FIX_V3
    // Never pay for a complete shadow-map pass while the player is running.
    // movementKey changes every tile and continuously cancels this timer.
    const handle = window.setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
    }, 450);
    return () => window.clearTimeout(handle);
  }, [gl, revision, movementKey]);
  return null;
}`,
  "V2 StaticShadowMap",
);

replaceOnce(
  three,
  `      <StaticShadowMap revision={region.map} />`,
  `      <StaticShadowMap
        revision={region.map}
        movementKey={local ? \`\${local.position.x}:\${local.position.y}:\${local.position.z}\` : "none"}
      />`,
  "StaticShadowMap usage",
);

const changed = [
  [files.world, world],
  [files.three, three],
];

if (CHECK_ONLY) {
  console.log("V3 compatibility check passed. No files were changed.");
  for (const [file] of changed) console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

for (const [file, source] of changed) write(file, source);

console.log("Applied TibiaGame streaming stability fix V3.");
console.log("Changed:");
for (const [file] of changed) console.log(`  ${path.relative(root, file)}`);
console.log("");
console.log("Run:");
console.log("  cargo fmt --all");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Then test sprinting, large-area boundaries and stairs while watching max ms.");
