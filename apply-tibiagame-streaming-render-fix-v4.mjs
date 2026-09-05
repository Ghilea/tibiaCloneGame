#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const files = {
  world: path.join(root, "apps", "client", "src", "game", "WorldState.ts"),
  three: path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx"),
};

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name}: ${path.relative(root, file)}. Run from the tibiaCloneGame repository root.`);
  }
}

function read(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n") };
}

function write(file, source) {
  const output = source.eol === "\n" ? source.text : source.text.replace(/\n/g, "\r\n");
  fs.writeFileSync(file, output, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (source.text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found more than one ${label}. No files were written.`);
  }
  source.text = source.text.slice(0, first) + after + source.text.slice(first + before.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const matches = [...source.text.matchAll(regex)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}. No files were written.`);
  }
  source.text = source.text.replace(regex, replacement);
}

const world = read(files.world);
const three = read(files.three);

const markerState = [
  world.text.includes("TIBIAGAME_STREAMING_FIX_V4"),
  three.text.includes("TIBIAGAME_STREAMING_FIX_V4"),
];
if (markerState.every(Boolean)) {
  console.log("TibiaGame streaming/render fix V4 is already applied.");
  process.exit(0);
}
if (markerState.some(Boolean)) {
  throw new Error("V4 appears partially applied. Inspect git diff before continuing.");
}

if (!three.text.includes("TIBIAGAME_STREAMING_FIX_V3_1")) {
  throw new Error("V4 expects V3.1 to be applied first. No files were written.");
}
if (!world.text.includes("TIBIAGAME_STREAMING_FIX_V2")) {
  throw new Error("V4 expects V2/V2.1 WorldState changes to be present. No files were written.");
}

// ---------------------------------------------------------------------------
// WorldState: distinguish incoming streamed-map freshness from rare dynamic
// structure invalidation (doors/windows). V2 intentionally omitted this,
// which let the minimap advance while ThreeWorld kept an older map slice.
// ---------------------------------------------------------------------------
replaceOnce(
  world,
  `  dynamicMapRevision = 0;
  localCorrectionRevision = 0;`,
  `  dynamicMapRevision = 0;
  // TIBIAGAME_STREAMING_FIX_V4
  // Advances whenever a fresh streamed MapView is installed. ThreeWorld uses
  // this as a deferred data-freshness signal, separate from movement.
  streamRegionRevision = 0;
  localCorrectionRevision = 0;`,
  "WorldState revision fields",
);

replaceOnce(
  world,
  `        this.map = message.map;
        this.dynamicMapRevision += 1;
        this.rebuildMapIndexes();`,
  `        this.map = message.map;
        this.dynamicMapRevision += 1;
        this.streamRegionRevision += 1;
        this.rebuildMapIndexes();`,
  "welcome map revision",
);

replaceOnce(
  world,
  `      case "world_region":
        this.map = message.map;
        this.rebuildMapIndexes();`,
  `      case "world_region":
        this.map = message.map;
        this.streamRegionRevision += 1;
        this.rebuildMapIndexes();`,
  "world_region map revision",
);

// ---------------------------------------------------------------------------
// ThreeWorld sizing: 32 matches the server's spatial streaming chunk size.
// 32 + 8 + 8 => 48x48 maximum local static slice: large enough for camera,
// materially smaller than V3.1's 68x68 rebuild.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  three,
  /\/\/ TIBIAGAME_STREAMING_FIX_V3_1\s*\nconst\s+RENDER_CHUNK_SIZE\s*=\s*48\s*;\s*\nconst\s+RENDER_PADDING\s*=\s*10\s*;/g,
  `// TIBIAGAME_STREAMING_FIX_V3_1
// TIBIAGAME_STREAMING_FIX_V4
// Align renderer boundaries with the server's 32-tile spatial chunks. The
// 8-tile safety padding keeps the camera covered without rebuilding 68x68.
const RENDER_CHUNK_SIZE = 32;
const RENDER_PADDING = 8;`,
  "V3.1 render chunk constants",
);

// ---------------------------------------------------------------------------
// Fix stale-world regression:
// - chunk coordinates are no longer deferred. Crossing a render boundary must
//   immediately select the new already-prefetched static slice.
// - streamed map freshness itself is deferred, so normal world_region cache
//   fills do not compete with movement.
// - if movement crosses first, the chunk dependency immediately consumes the
//   latest MapView ref, so minimap/world cannot diverge at the boundary.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  three,
  /  const latestMapRef = useRef<MapView \| null>\(map\);[\s\S]*?  if \(!map \|\| !region\) return null;/g,
  `  // TIBIAGAME_STREAMING_FIX_V4
  const latestMapRef = useRef<MapView | null>(map);
  if (map) latestMapRef.current = map;
  const mapReady = map ? 1 : 0;
  const chunkX = Math.floor((local?.position.x ?? 0) / RENDER_CHUNK_SIZE);
  const chunkY = Math.floor((local?.position.y ?? 0) / RENDER_CHUNK_SIZE);

  // Do not defer chunk coordinates. Under continuous movement React can keep a
  // deferred chunk behind the player, which is exactly how the minimap could
  // show the new region while the rendered world stayed old.
  const dynamicMapRevision = world.dynamicMapRevision;
  const streamRegionRevision = useDeferredValue(world.streamRegionRevision);
  const region = useMemo(() => {
    void dynamicMapRevision;
    void streamRegionRevision;
    const source = mapReady ? latestMapRef.current : null;
    if (!source) return null;

    const startedAt = performance.now();
    const next = createRenderRegion(source, floor, chunkX, chunkY);
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs > 6) {
      console.info(
        \`static region slice: \${elapsedMs.toFixed(1)}ms · chunk \${chunkX}:\${chunkY} · z \${floor}\`,
      );
    }
    return next;
  }, [
    mapReady,
    floor,
    chunkX,
    chunkY,
    dynamicMapRevision,
    streamRegionRevision,
  ]);

  if (!map || !region) return null;`,
  "V2 cached WorldScene region block",
);

// ---------------------------------------------------------------------------
// Occlusion was a hidden main-thread spike:
// old useLayoutEffect synchronously Box3-scanned every occluder and touched all
// materials before paint. Replace it with a ~2.5ms/frame incremental builder.
// The previous index remains usable until the new one is complete.
// ---------------------------------------------------------------------------
replaceRegexOnce(
  three,
  /  useLayoutEffect\(\(\) => \{\s*\/\/ Compile occluders for transparency while a streamed region is being\s*[\s\S]*?  \}, \[scene, sceneRevision\]\);/g,
  `  useEffect(() => {
    // TIBIAGAME_STREAMING_FIX_V4
    // Building Box3 bounds for a whole streamed scene inside useLayoutEffect
    // blocked paint and produced large max-ms spikes. Build the replacement
    // index in small frame-budgeted slices instead.
    let cancelled = false;
    let frame: number | null = null;
    let workMs = 0;
    const roots: THREE.Object3D[] = [];

    const visit = (node: THREE.Object3D) => {
      if (node.userData.occluder) {
        roots.push(node);
        return;
      }
      node.children.forEach(visit);
    };
    scene.children.forEach(visit);

    const indexed: OccluderBounds[] = [];
    let cursor = 0;
    const step = () => {
      if (cancelled) return;
      const sliceStarted = performance.now();

      while (cursor < roots.length && performance.now() - sliceStarted < 2.5) {
        const root = roots[cursor++];
        const bounds = new THREE.Box3().setFromObject(root);
        if (!bounds.isEmpty()) indexed.push({ root, bounds });

        // Shader/material preparation is spread over the same budget instead
        // of invalidating every material in one pre-paint layout effect.
        root.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) {
            if (material.userData.occlusionPrepared) continue;
            material.userData.occlusionPrepared = true;
            material.transparent = true;
            material.needsUpdate = true;
          }
        });
      }

      workMs += performance.now() - sliceStarted;
      if (cursor < roots.length) {
        frame = window.requestAnimationFrame(step);
        return;
      }

      occluders.current = indexOccluderBounds(indexed);
      lastCheckedTarget.set(Number.NaN, Number.NaN, Number.NaN);
      if (workMs > 6) {
        console.info(
          \`occlusion index work: \${workMs.toFixed(1)}ms across frames · \${indexed.length} roots\`,
        );
      }
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [scene, sceneRevision]);`,
  "synchronous occlusion layout effect",
);

// Replace the old monolithic collector with a pure indexing helper used after
// incremental bounds creation. Avoid an unused function under noUnusedLocals.
replaceRegexOnce(
  three,
  /function collectOccluderBounds\(scene: THREE\.Scene\): OccluderIndex \{[\s\S]*?  return \{ all: roots, buckets \};\s*\n\}/g,
  `function indexOccluderBounds(roots: OccluderBounds[]): OccluderIndex {
  const buckets = new Map<string, OccluderBounds[]>();
  for (const entry of roots) {
    const minX = Math.floor(entry.bounds.min.x / OCCLUDER_BUCKET_SIZE);
    const maxX = Math.floor(entry.bounds.max.x / OCCLUDER_BUCKET_SIZE);
    const minZ = Math.floor(entry.bounds.min.z / OCCLUDER_BUCKET_SIZE);
    const maxZ = Math.floor(entry.bounds.max.z / OCCLUDER_BUCKET_SIZE);
    for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
      const key = \`\${x}:\${z}\`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }
  }
  return { all: roots, buckets };
}`,
  "monolithic collectOccluderBounds helper",
);

const changed = [
  [files.world, world],
  [files.three, three],
];

if (CHECK_ONLY) {
  console.log("V4 compatibility check passed. No files were changed.");
  for (const [file] of changed) console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

for (const [file, source] of changed) write(file, source);

console.log("Applied TibiaGame streaming/render fix V4.");
console.log("Changed:");
for (const [file] of changed) console.log(`  ${path.relative(root, file)}`);
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Runtime logs worth watching:");
console.log("  world region apply: ...ms");
console.log("  static region slice: ...ms");
console.log("  occlusion index work: ...ms across frames");
