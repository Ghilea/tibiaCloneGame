#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const assetPath = path.join(root, "apps", "client", "src", "game", "MedievalAssetModels.tsx");
const medievalPath = path.join(root, "apps", "client", "src", "game", "MedievalModels.tsx");

for (const filePath of [threePath, assetPath, medievalPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(root, filePath)}. Run from repository root.`);
  }
}

function load(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const threeFile = load(threePath);
const assetFile = load(assetPath);
const medievalFile = load(medievalPath);

let three = threeFile.text;
let asset = assetFile.text;
let medieval = medievalFile.text;

if (
  three.includes("TIBIAGAME_STREAMING_FIX_V21")
  && asset.includes("TIBIAGAME_STREAMING_FIX_V21")
  && medieval.includes("TIBIAGAME_STREAMING_FIX_V21")
) {
  console.log("TibiaGame V21.1 fixed render-slot ring is already applied.");
  process.exit(0);
}

for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V20",
  "TIBIAGAME_STREAMING_FIX_V20_1",
  "TIBIAGAME_STREAMING_FIX_V20_2",
  "TIBIAGAME_STREAMING_FIX_V20_3",
]) {
  if (!three.includes(marker)) {
    throw new Error(`V21 expects ${marker} in ThreeWorld.tsx. No files were written.`);
  }
}

if (!asset.includes("TIBIAGAME_STREAMING_FIX_V20_3")) {
  throw new Error("V21 expects V20.3 in MedievalAssetModels.tsx.");
}
if (!medieval.includes("InstancedHousePlinths")) {
  throw new Error("V21 could not find InstancedHousePlinths.");
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0) throw new Error(`Could not find ${label}. No files were written.`);
  if (source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function functionRange(source, functionName) {
  const needles = [
    `function ${functionName}`,
    `export function ${functionName}`,
    `const ${functionName} = memo(function ${functionName}`,
  ];

  let start = -1;
  let needle = "";
  for (const candidate of needles) {
    const at = source.indexOf(candidate);
    if (at >= 0 && (start < 0 || at < start)) {
      start = at;
      needle = candidate;
    }
  }
  if (start < 0) {
    throw new Error(`Could not find function/component ${functionName}. No files were written.`);
  }

  const paramsStart = source.indexOf("(", start + needle.length);
  if (paramsStart < 0) throw new Error(`Could not parse ${functionName} parameters.`);

  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let parens = 0;
  let paramsEnd = -1;

  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") parens += 1;
    else if (ch === ")") {
      parens -= 1;
      if (parens === 0) {
        paramsEnd = i + 1;
        break;
      }
    }
  }

  if (paramsEnd < 0) throw new Error(`Could not parse ${functionName} parameter end.`);

  let bodyStart = source.indexOf("{", paramsEnd);
  if (bodyStart < 0) throw new Error(`Could not find ${functionName} body.`);

  let depth = 0;
  let end = -1;
  quote = null;
  escaped = false;
  lineComment = false;
  blockComment = false;

  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        // Include memo component closing `);` if present.
        if (source.slice(end, end + 2) === ");") end += 2;
        break;
      }
    }
  }

  if (end < 0) throw new Error(`Could not parse ${functionName} body end.`);
  return { start, end };
}

function replaceFunction(source, name, replacement) {
  const { start, end } = functionRange(source, name);
  return source.slice(0, start) + replacement + source.slice(end);
}

// -------------------------------------------------------------------------
// THREEWORLD: permanent 3x3 toroidal render slots + 2 hidden stair slots.
// -------------------------------------------------------------------------

three = replaceOnce(
  three,
  `// TIBIAGAME_STREAMING_FIX_V20
// 9 current chunks + up to 6 frontier chunks + 2 stair targets.
const RETAINED_STATIC_CACHE_LIMIT = 17;
const RETAINED_STATIC_HARD_LIMIT = 18;
const RETAINED_STATIC_CHUNK_HYSTERESIS = 4;`,
  `// TIBIAGAME_STREAMING_FIX_V20
// TIBIAGAME_STREAMING_FIX_V21
// A permanent 3x3 toroidal slot ring owns the current floor. World chunk keys
// never become React keys during movement. Two hidden permanent slots are kept
// for actual stair-target prewarm.
const RETAINED_STATIC_RING_SIDE = 3;
const RETAINED_STATIC_RING_SLOT_COUNT = RETAINED_STATIC_RING_SIDE ** 2;
const RETAINED_STATIC_STAIR_SLOT_COUNT = 2;
const RETAINED_STATIC_SLOT_COUNT =
  RETAINED_STATIC_RING_SLOT_COUNT + RETAINED_STATIC_STAIR_SLOT_COUNT;
const RETAINED_STATIC_CHUNK_HYSTERESIS = 4;`,
  "V20 retained cache constants",
);

const stateStart = three.indexOf(
  "  const [retainedStaticChunks, setRetainedStaticChunks] = useState<RetainedStaticChunkData[]>([]);",
);
const doorDynamicMarker = "  // Door/window state is genuinely dynamic.";
const stateEnd = three.indexOf(doorDynamicMarker, stateStart);

if (stateStart < 0 || stateEnd < 0) {
  throw new Error("Could not isolate retained static scheduler block. No files were written.");
}

const slotScheduler = `  // TIBIAGAME_STREAMING_FIX_V21
  const [retainedStaticSlots, setRetainedStaticSlots] = useState<
    Array<RetainedStaticChunkData | null>
  >(() => Array.from({ length: RETAINED_STATIC_SLOT_COUNT }, () => null));
  const retainedStaticSlotKeys = useRef<Array<string | null>>(
    Array.from({ length: RETAINED_STATIC_SLOT_COUNT }, () => null),
  );

  useEffect(() => {
    const sourceAtStart = latestMapRef.current;
    if (!sourceAtStart || !local) return;

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const visibleOffsets: readonly [number, number][] = [
      [0, 0],
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const currentFloorSpecs = visibleOffsets.map(([dx, dy]) => {
      const chunkX = staticChunkX + dx;
      const chunkY = staticChunkY + dy;
      return {
        floor,
        chunkX,
        chunkY,
        slotIndex: retainedStaticRingSlotIndex(chunkX, chunkY),
      };
    });

    // Keep the existing targeted stair prewarm, but put it in two stable hidden
    // slot components instead of adding keyed chunk subtrees.
    const stairTargetSpecs = sourceAtStart.stairs
      .flatMap((stair) => {
        const currentEndpoint = stair.from.z === floor
          ? stair.from
          : stair.to.z === floor ? stair.to : null;
        if (!currentEndpoint) return [];

        const endpointChunkX = Math.floor(
          currentEndpoint.x / RETAINED_STATIC_CHUNK_SIZE,
        );
        const endpointChunkY = Math.floor(
          currentEndpoint.y / RETAINED_STATIC_CHUNK_SIZE,
        );

        if (
          Math.abs(endpointChunkX - staticChunkX) > 1
          || Math.abs(endpointChunkY - staticChunkY) > 1
        ) return [];

        const targetEndpoint = stair.from.z === floor ? stair.to : stair.from;
        return [{
          floor: targetEndpoint.z,
          chunkX: Math.floor(
            targetEndpoint.x / RETAINED_STATIC_CHUNK_SIZE,
          ),
          chunkY: Math.floor(
            targetEndpoint.y / RETAINED_STATIC_CHUNK_SIZE,
          ),
        }];
      })
      .filter((spec, index, all) =>
        all.findIndex((candidate) =>
          candidate.floor === spec.floor
          && candidate.chunkX === spec.chunkX
          && candidate.chunkY === spec.chunkY
        ) === index
      )
      .slice(0, RETAINED_STATIC_STAIR_SLOT_COUNT)
      .map((spec, index) => ({
        ...spec,
        slotIndex: RETAINED_STATIC_RING_SLOT_COUNT + index,
      }));

    type SlotSpec = {
      floor: number;
      chunkX: number;
      chunkY: number;
      slotIndex: number;
    };

    const assignChunkToSlot = (spec: SlotSpec) => {
      if (cancelled) return;

      const key = retainedStaticChunkKey(
        spec.floor,
        spec.chunkX,
        spec.chunkY,
      );
      if (retainedStaticSlotKeys.current[spec.slotIndex] === key) return;

      const source = latestMapRef.current;
      const center = world.streamRegionCenter;
      if (
        !source
        || !retainedChunkFullyCovered(
          spec.floor,
          spec.chunkX,
          spec.chunkY,
          center,
          world.streamRegionRadius,
          world.streamRegionFloorRadius,
          source,
        )
      ) return;

      const startedAt = performance.now();
      const chunk = createRetainedStaticChunk(
        source,
        spec.floor,
        spec.chunkX,
        spec.chunkY,
      );
      const slicedMs = performance.now() - startedAt;
      if (slicedMs > 4) {
        console.info(
          \`retained slot slice: \${slicedMs.toFixed(1)}ms · slot \${spec.slotIndex} · chunk \${key}\`,
        );
      }

      retainedStaticSlotKeys.current[spec.slotIndex] = key;

      startTransition(() => {
        setRetainedStaticSlots((previous) => {
          if (previous[spec.slotIndex]?.key === key) return previous;
          const next = [...previous];
          next[spec.slotIndex] = chunk;
          return next;
        });
      });
    };

    // The center should already be a former neighbor after ordinary movement,
    // so this is normally a no-op. It is immediate only for login/new floor.
    assignChunkToSlot(currentFloorSpecs[0]);

    const pending: SlotSpec[] = [
      ...currentFloorSpecs.slice(1),
      ...stairTargetSpecs,
    ].filter((spec) =>
      retainedStaticSlotKeys.current[spec.slotIndex]
      !== retainedStaticChunkKey(spec.floor, spec.chunkX, spec.chunkY)
    );

    let cursor = 0;

    const pump = (deadline?: { timeRemaining(): number }) => {
      if (cancelled || cursor >= pending.length) return;
      if (deadline && deadline.timeRemaining() < 5) {
        schedule();
        return;
      }

      assignChunkToSlot(pending[cursor]);
      cursor += 1;
      schedule();
    };

    const schedule = () => {
      if (cancelled || cursor >= pending.length) return;
      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: (deadline: { timeRemaining(): number }) => void,
        ) => number;
      };

      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(pump);
      } else {
        timeoutHandle = window.setTimeout(() => pump(), 64);
      }
    };

    schedule();

    return () => {
      cancelled = true;
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [
    floor,
    staticChunkX,
    staticChunkY,
    immediateStreamRegionRevision,
  ]);

`;

three = three.slice(0, stateStart) + slotScheduler + three.slice(stateEnd);

// Replace dynamic retained refresh.
const dynamicStart = three.indexOf(doorDynamicMarker);
const activeCountMarker = "  const activeStaticChunkCount =";
const dynamicEnd = three.indexOf(activeCountMarker, dynamicStart);

if (dynamicStart < 0 || dynamicEnd < 0) {
  throw new Error("Could not isolate dynamic retained refresh.");
}

const dynamicReplacement = `  // Door/window state is genuinely dynamic. Refresh the existing slot payloads
  // in place; never replace the slot component identity.
  useEffect(() => {
    if (!dynamicMapRevision) return;
    const source = latestMapRef.current;
    if (!source) return;

    startTransition(() => {
      setRetainedStaticSlots((previous) => previous.map((entry, slotIndex) => {
        if (!entry) return entry;
        if (slotIndex >= RETAINED_STATIC_RING_SLOT_COUNT) return entry;
        if (
          entry.floor !== floor
          || Math.abs(entry.chunkX - staticChunkX) > 1
          || Math.abs(entry.chunkY - staticChunkY) > 1
        ) return entry;

        return createRetainedStaticChunk(
          source,
          entry.floor,
          entry.chunkX,
          entry.chunkY,
        );
      }));
    });
  }, [dynamicMapRevision, floor, staticChunkX, staticChunkY]);

  const retainedStaticChunks = useMemo(
    () => retainedStaticSlots.filter(
      (entry): entry is RetainedStaticChunkData => entry !== null,
    ),
    [retainedStaticSlots],
  );

`;

three = three.slice(0, dynamicStart) + dynamicReplacement + three.slice(dynamicEnd);

// Fixed slot rendering: key by slot index, not chunk key.
const renderBefore = `      {/* TIBIAGAME_STREAMING_FIX_V20_2: retained chunks do not receive onGround. */}
      {retainedStaticChunks.map((chunk) => (
        <RetainedStaticChunk
          key={chunk.key}
          chunk={chunk}
          activeFloor={floor}
          input={input}
          world={world}
          discoveryRevision={world.worldObjectCallout?.key ?? 0}
          indoorBuildingId={indoorBuildingId}
          onHover={onLootHover}
        />
      ))}`;

const renderAfter = `      {/* TIBIAGAME_STREAMING_FIX_V21: fixed world-slot identities. */}
      {retainedStaticSlots.map((chunk, slotIndex) => (
        <RetainedStaticChunk
          key={\`retained-slot-\${slotIndex}\`}
          chunk={chunk}
          prewarmOnly={slotIndex >= RETAINED_STATIC_RING_SLOT_COUNT}
          activeFloor={floor}
          input={input}
          world={world}
          discoveryRevision={world.worldObjectCallout?.key ?? 0}
          indoorBuildingId={indoorBuildingId}
          onHover={onLootHover}
        />
      ))}`;

three = replaceOnce(
  three,
  renderBefore,
  renderAfter,
  "keyed retained chunk render map",
);

// RetainedStaticChunk becomes a permanent nullable slot.
const retainedComponent = `const RetainedStaticChunk = memo(function RetainedStaticChunk({
  chunk,
  prewarmOnly,
  activeFloor,
  input,
  world,
  discoveryRevision,
  indoorBuildingId,
  onHover,
}: {
  chunk: RetainedStaticChunkData | null;
  prewarmOnly: boolean;
  activeFloor: number;
  input: InputController;
  world: WorldState;
  discoveryRevision: number;
  indoorBuildingId: string | null;
  onHover: (hover: { label: string; x: number; y: number } | null) => void;
}) {
  // TIBIAGAME_STREAMING_FIX_V21
  // This wrapper is keyed by a permanent ring slot, never by chunk.key.
  return (
    <group
      visible={Boolean(
        chunk
        && !prewarmOnly
        && chunk.floor === activeFloor
      )}
      userData={{
        streamFloor: chunk?.floor ?? -999,
        streamChunkX: chunk?.chunkX ?? -999,
        streamChunkY: chunk?.chunkY ?? -999,
      }}
    >
      {chunk && (
        <Suspense fallback={null}>
          <Structures
            map={chunk.map}
            castleWallContext={chunk.castleWallContext}
            input={input}
            world={world}
            discoveryRevision={discoveryRevision}
            floor={chunk.floor}
            indoorBuildingId={
              !prewarmOnly && chunk.floor === activeFloor
                ? indoorBuildingId
                : null
            }
            onHover={onHover}
          />
        </Suspense>
      )}
    </group>
  );
});`;

three = replaceFunction(
  three,
  "RetainedStaticChunk",
  retainedComponent,
);

// Add toroidal slot helper after chunk key function without depending on
// whitespace/layout in the local file.
{
  const range = functionRange(three, "retainedStaticChunkKey");
  const helper = `

// TIBIAGAME_STREAMING_FIX_V21
function retainedStaticRingSlotIndex(chunkX: number, chunkY: number) {
  const x = (
    (chunkX % RETAINED_STATIC_RING_SIDE)
    + RETAINED_STATIC_RING_SIDE
  ) % RETAINED_STATIC_RING_SIDE;
  const y = (
    (chunkY % RETAINED_STATIC_RING_SIDE)
    + RETAINED_STATIC_RING_SIDE
  ) % RETAINED_STATIC_RING_SIDE;
  return y * RETAINED_STATIC_RING_SIDE + x;
}`;
  three = three.slice(0, range.end) + helper + three.slice(range.end);
}

// -------------------------------------------------------------------------
// Fixed buffers now make sense because the slot components survive movement.
// -------------------------------------------------------------------------

// Remove V20.3 adaptive generic capacity helper.
const adaptiveStart = three.indexOf("// TIBIAGAME_STREAMING_FIX_V20_3\nfunction retainedInstanceCapacity");
const adaptiveEnd = three.indexOf("function persistentInstanceMatrix", adaptiveStart);
if (adaptiveStart < 0 || adaptiveEnd < 0) {
  throw new Error("Could not isolate V20.3 retainedInstanceCapacity helper.");
}
three = three.slice(0, adaptiveStart)
  + "// TIBIAGAME_STREAMING_FIX_V21\n// Fixed slot lifetime: allocate each instance buffer once and reuse it.\n"
  + three.slice(adaptiveEnd);

three = replaceOnce(
  three,
  `  const allocationCapacity = retainedInstanceCapacity(
    matrices.length,
    capacity,
  );

  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      geometry,
      material,
      allocationCapacity,
    );`,
  `  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      geometry,
      material,
      capacity,
    );`,
  "adaptive PersistentStaticInstances constructor",
);

three = replaceOnce(
  three,
  `  }, [
    allocationCapacity,
    castShadow,
    geometry,
    material,
    receiveShadow,
  ]);

  const count = Math.min(matrices.length, allocationCapacity);`,
  `  }, [
    capacity,
    castShadow,
    geometry,
    material,
    receiveShadow,
  ]);

  const count = Math.min(matrices.length, capacity);`,
  "adaptive PersistentStaticInstances dependencies/count",
);

// Pooled batches: persistent fixed mesh; rewrite matrix data only.
const pooledReplacement = `function PooledStaticBatchMesh({
  batch,
}: {
  batch: PooledStaticBatch;
}) {
  // TIBIAGAME_STREAMING_FIX_V21
  const mesh = useMemo(() => {
    const instance = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      2048,
    );
    instance.castShadow = true;
    instance.receiveShadow = true;
    instance.frustumCulled = false;
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return instance;
  }, [batch.geometry, batch.material]);

  const count = Math.min(
    Math.floor(batch.matrices.length / 16),
    2048,
  );

  useMemo(() => {
    const target = mesh.instanceMatrix.array as Float32Array;
    const scalarCount = count * 16;
    for (let index = 0; index < scalarCount; index += 1) {
      target[index] = batch.matrices[index];
    }
    mesh.count = count;
    mesh.instanceMatrix.clearUpdateRanges();
    if (count > 0) {
      mesh.instanceMatrix.addUpdateRange(0, scalarCount);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [batch.matrices, count, mesh]);

  return <primitive object={mesh} dispose={null} />;
}`;

three = replaceFunction(
  three,
  "PooledStaticBatchMesh",
  pooledReplacement,
);

// -------------------------------------------------------------------------
// MedievalAssetModels: solid house wall buffers stay fixed inside ring slots.
// -------------------------------------------------------------------------

const houseAdaptiveStart = asset.indexOf(
  "// TIBIAGAME_STREAMING_FIX_V20_3\nfunction houseWallInstanceCapacity",
);
const sharedPartMarker = "type SharedHouseWallPart";
const houseAdaptiveEnd = asset.indexOf(sharedPartMarker, houseAdaptiveStart);

if (houseAdaptiveStart < 0 || houseAdaptiveEnd < 0) {
  throw new Error("Could not isolate V20.3 houseWallInstanceCapacity helper.");
}

asset = asset.slice(0, houseAdaptiveStart)
  + "// TIBIAGAME_STREAMING_FIX_V21\n// Fixed render slots keep these GLTF instance buffers alive across movement.\n"
  + asset.slice(houseAdaptiveEnd);

asset = replaceOnce(
  asset,
  `  // TIBIAGAME_STREAMING_FIX_V20
  // TIBIAGAME_STREAMING_FIX_V20_3
  const allocationCapacity = houseWallInstanceCapacity(segments.length);
  const meshes = useMemo(() => parts.map((part) => {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      allocationCapacity,
    );`,
  `  // TIBIAGAME_STREAMING_FIX_V20
  // TIBIAGAME_STREAMING_FIX_V21
  const meshes = useMemo(() => parts.map((part) => {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,
    );`,
  "adaptive house wall constructor",
);

asset = replaceOnce(
  asset,
  `  }), [allocationCapacity, parts]);

  const count = Math.min(
    segments.length,
    allocationCapacity,
  );`,
  `  }), [parts]);

  const count = Math.min(
    segments.length,
    PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,
  );`,
  "adaptive house wall deps/count",
);

// -------------------------------------------------------------------------
// MedievalModels: persistent house plinth meshes, including zero-count state.
// -------------------------------------------------------------------------

const plinthReplacement = `// TIBIAGAME_STREAMING_FIX_V21
const HOUSE_PLINTH_INSTANCE_CAPACITY = 2048;
const sharedHousePlinthHorizontalGeometry =
  new THREE.BoxGeometry(1.04, 0.54, 0.24);
const sharedHousePlinthVerticalGeometry =
  new THREE.BoxGeometry(0.24, 0.54, 1.04);
const sharedHousePlinthMaterials =
  new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();

export function InstancedHousePlinths({
  segments,
}: {
  segments: readonly {
    position: [number, number, number];
    size: [number, number, number];
  }[];
}) {
  const texture = useLoader(
    THREE.TextureLoader,
    "/assets/world/aldoria-castle-stone-v2.png",
  );
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = useMemo(() => {
    const cached = sharedHousePlinthMaterials.get(texture);
    if (cached) return cached;
    const next = new THREE.MeshStandardMaterial({
      map: texture,
      color: "#9fa29a",
      roughness: 0.98,
    });
    sharedHousePlinthMaterials.set(texture, next);
    return next;
  }, [texture]);

  const horizontalMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(
      sharedHousePlinthHorizontalGeometry,
      material,
      HOUSE_PLINTH_INSTANCE_CAPACITY,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }, [material]);

  const verticalMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(
      sharedHousePlinthVerticalGeometry,
      material,
      HOUSE_PLINTH_INSTANCE_CAPACITY,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }, [material]);

  const horizontal = useMemo(
    () => segments.filter((segment) => segment.size[0] > segment.size[2]),
    [segments],
  );
  const vertical = useMemo(
    () => segments.filter((segment) => segment.size[0] <= segment.size[2]),
    [segments],
  );

  useMemo(() => {
    const matrix = new THREE.Matrix4();

    const horizontalCount = Math.min(
      horizontal.length,
      HOUSE_PLINTH_INSTANCE_CAPACITY,
    );
    for (let index = 0; index < horizontalCount; index += 1) {
      const segment = horizontal[index];
      matrix.makeTranslation(
        segment.position[0],
        0.27,
        segment.position[2],
      );
      matrix.toArray(
        horizontalMesh.instanceMatrix.array as Float32Array,
        index * 16,
      );
    }
    horizontalMesh.count = horizontalCount;
    horizontalMesh.instanceMatrix.clearUpdateRanges();
    if (horizontalCount > 0) {
      horizontalMesh.instanceMatrix.addUpdateRange(
        0,
        horizontalCount * 16,
      );
      horizontalMesh.instanceMatrix.needsUpdate = true;
    }

    const verticalCount = Math.min(
      vertical.length,
      HOUSE_PLINTH_INSTANCE_CAPACITY,
    );
    for (let index = 0; index < verticalCount; index += 1) {
      const segment = vertical[index];
      matrix.makeTranslation(
        segment.position[0],
        0.27,
        segment.position[2],
      );
      matrix.toArray(
        verticalMesh.instanceMatrix.array as Float32Array,
        index * 16,
      );
    }
    verticalMesh.count = verticalCount;
    verticalMesh.instanceMatrix.clearUpdateRanges();
    if (verticalCount > 0) {
      verticalMesh.instanceMatrix.addUpdateRange(
        0,
        verticalCount * 16,
      );
      verticalMesh.instanceMatrix.needsUpdate = true;
    }
  }, [horizontal, horizontalMesh, vertical, verticalMesh]);

  return (
    <>
      <primitive object={horizontalMesh} dispose={null} />
      <primitive object={verticalMesh} dispose={null} />
    </>
  );
}`;

medieval = replaceFunction(
  medieval,
  "InstancedHousePlinths",
  plinthReplacement,
);

// -------------------------------------------------------------------------
// Safety checks.
// -------------------------------------------------------------------------

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V21",
  "RETAINED_STATIC_RING_SLOT_COUNT",
  "RETAINED_STATIC_STAIR_SLOT_COUNT",
  "retainedStaticRingSlotIndex",
  "retainedStaticSlots.map",
  "key={`retained-slot-${slotIndex}`}",
  "prewarmOnly={slotIndex >= RETAINED_STATIC_RING_SLOT_COUNT}",
  "retained slot slice:",
]) {
  if (!three.includes(needle)) {
    throw new Error(`V21 safety check failed: missing ${needle} in ThreeWorld.tsx.`);
  }
}

for (const forbidden of [
  "setRetainedStaticChunks",
  "retainedStaticKeys.current",
  "RETAINED_STATIC_CACHE_LIMIT",
  "RETAINED_STATIC_HARD_LIMIT",
  "retainedInstanceCapacity(",
]) {
  if (three.includes(forbidden)) {
    throw new Error(`V21 safety check failed: old retained path remains: ${forbidden}`);
  }
}

// V20.3's *behavior* must remain: no runtime frontier prefetch path.
// V21 intentionally replaces the V20.3 marker-bearing blocks, so checking the
// literal marker after transformation would be incorrect.
for (const forbidden of [
  "RETAINED_STATIC_FRONTIER_DISTANCE",
  "uniqueFrontierSpecs",
  "frontierSpecs",
]) {
  if (three.includes(forbidden)) {
    throw new Error(`V21.1 safety check failed: V20.3 frontier path returned: ${forbidden}`);
  }
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V21",
  "PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY",
]) {
  if (!asset.includes(needle)) {
    throw new Error(`V21 safety check failed: missing ${needle} in MedievalAssetModels.tsx.`);
  }
}
if (asset.includes("houseWallInstanceCapacity(")) {
  throw new Error("V21 safety check failed: adaptive house wall capacity remains.");
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V21",
  "HOUSE_PLINTH_INSTANCE_CAPACITY",
  "sharedHousePlinthHorizontalGeometry",
  "sharedHousePlinthVerticalGeometry",
]) {
  if (!medieval.includes(needle)) {
    throw new Error(`V21 safety check failed: missing ${needle} in MedievalModels.tsx.`);
  }
}

// Preserve core correctness markers.
for (const needle of [
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "TERRAIN_INSTANCE_CAPACITY = 4608",
  "TIBIAGAME_STREAMING_FIX_V18_1",
]) {
  if (!three.includes(needle)) {
    throw new Error(`V21 safety check failed: lost ${needle}.`);
  }
}

if (CHECK_ONLY) {
  console.log("V21.1 compatibility check passed. No files were changed.");
  console.log("  current-floor retained renderer: permanent 3x3 toroidal slot ring");
  console.log("  React retained keys: fixed slot ids, never chunk keys");
  console.log("  stair prewarm: 2 permanent hidden slots");
  console.log("  generic static buffers: fixed for slot lifetime");
  console.log("  pooled static batches: persistent fixed InstancedMesh");
  console.log("  medieval house-wall buffers: fixed for slot lifetime");
  console.log("  house plinth meshes: persistent, including count=0");
  console.log("  V20.3 runtime frontier prefetch behavior: still disabled");
  console.log("  V15-V20 terrain/building correctness: preserved");
  process.exit(0);
}

function denormalize(text, eol) {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}

fs.writeFileSync(
  threePath,
  denormalize(three, threeFile.eol),
  "utf8",
);
fs.writeFileSync(
  assetPath,
  denormalize(asset, assetFile.eol),
  "utf8",
);
fs.writeFileSync(
  medievalPath,
  denormalize(medieval, medievalFile.eol),
  "utf8",
);

console.log("Applied TibiaGame V21.1 fixed render-slot ring.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("  apps/client/src/game/MedievalAssetModels.tsx");
console.log("  apps/client/src/game/MedievalModels.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
