#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const assetPath = path.join(root, "apps", "client", "src", "game", "MedievalAssetModels.tsx");

for (const target of [threePath, assetPath]) {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing ${path.relative(root, target)}. Run from repository root.`);
  }
}

function readNormalized(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const threeFile = readNormalized(threePath);
const assetFile = readNormalized(assetPath);
let three = threeFile.text;
let asset = assetFile.text;

if (three.includes("TIBIAGAME_STREAMING_FIX_V20")
    && asset.includes("TIBIAGAME_STREAMING_FIX_V20")) {
  console.log("TibiaGame persistent static renderer V20 is already applied.");
  process.exit(0);
}

for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V19",
  "TIBIAGAME_STREAMING_FIX_V18_1",
  "TIBIAGAME_STREAMING_FIX_V18",
  "TIBIAGAME_STREAMING_FIX_V17",
  "TIBIAGAME_STREAMING_FIX_V16",
  "TIBIAGAME_STREAMING_FIX_V15",
]) {
  if (!three.includes(marker)) {
    throw new Error(`V20 expects ${marker} in ThreeWorld.tsx. No files were written.`);
  }
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`Could not find expected ${label}. No files were written.`);
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function functionRange(source, functionName) {
  const patterns = [
    `function ${functionName}`,
    `export function ${functionName}`,
  ];
  let start = -1;
  let needle = "";
  for (const candidate of patterns) {
    const candidateStart = source.indexOf(candidate);
    if (candidateStart >= 0 && (start < 0 || candidateStart < start)) {
      start = candidateStart;
      needle = candidate;
    }
  }
  if (start < 0) throw new Error(`Could not find function ${functionName}.`);

  const paramsStart = source.indexOf("(", start + needle.length);
  if (paramsStart < 0) throw new Error(`Could not parse ${functionName} parameters.`);

  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let parenDepth = 0;
  let paramsEnd = -1;

  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = i + 1; break; }
    }
  }
  if (paramsEnd < 0) throw new Error(`Could not parse ${functionName} parameter end.`);

  let bodyStart = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = paramsEnd; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") { bodyStart = i; break; }
  }
  if (bodyStart < 0) throw new Error(`Could not find ${functionName} body.`);

  let braceDepth = 0;
  let end = -1;
  quote = null; escaped = false; lineComment = false; blockComment = false;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") braceDepth += 1;
    else if (ch === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`Could not parse ${functionName} body end.`);
  return { start, end };
}

function replaceFunction(source, functionName, replacement) {
  const { start, end } = functionRange(source, functionName);
  return source.slice(0, start) + replacement + source.slice(end);
}

// -------------------------------------------------------------------------
// THREEWORLD: frontier scheduling + shared persistent static renderer.
// -------------------------------------------------------------------------

three = replaceOnce(
  three,
  `// TIBIAGAME_STREAMING_FIX_V16: compact rolling GPU cache.
const RETAINED_STATIC_CACHE_LIMIT = 12;
const RETAINED_STATIC_HARD_LIMIT = 18;`,
  `// TIBIAGAME_STREAMING_FIX_V20
// 9 current chunks + up to 6 frontier chunks + 2 stair targets.
const RETAINED_STATIC_CACHE_LIMIT = 17;
const RETAINED_STATIC_HARD_LIMIT = 18;
const RETAINED_STATIC_CHUNK_HYSTERESIS = 4;
const RETAINED_STATIC_FRONTIER_DISTANCE = 10;`,
  "V16 retained cache constants",
);

three = replaceOnce(
  three,
  `  const staticChunkX = Math.floor((local?.position.x ?? 0) / RETAINED_STATIC_CHUNK_SIZE);
  const staticChunkY = Math.floor((local?.position.y ?? 0) / RETAINED_STATIC_CHUNK_SIZE);`,
  `  // TIBIAGAME_STREAMING_FIX_V20
  // Retained structure ownership has its own hysteresis. Terrain already uses
  // the same strategy at 32-tile boundaries.
  const rawStaticChunkX = Math.floor(
    (local?.position.x ?? 0) / RETAINED_STATIC_CHUNK_SIZE,
  );
  const rawStaticChunkY = Math.floor(
    (local?.position.y ?? 0) / RETAINED_STATIC_CHUNK_SIZE,
  );
  const retainedAnchorRef = useRef({
    floor,
    chunkX: rawStaticChunkX,
    chunkY: rawStaticChunkY,
  });

  {
    const current = retainedAnchorRef.current;
    const positionX = local?.position.x ?? 0;
    const positionY = local?.position.y ?? 0;

    if (current.floor !== floor) {
      retainedAnchorRef.current = {
        floor,
        chunkX: rawStaticChunkX,
        chunkY: rawStaticChunkY,
      };
    } else {
      let nextChunkX = current.chunkX;
      let nextChunkY = current.chunkY;

      while (
        positionX
        < nextChunkX * RETAINED_STATIC_CHUNK_SIZE
          - RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkX -= 1;
      while (
        positionX
        >= (nextChunkX + 1) * RETAINED_STATIC_CHUNK_SIZE
          + RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkX += 1;

      while (
        positionY
        < nextChunkY * RETAINED_STATIC_CHUNK_SIZE
          - RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkY -= 1;
      while (
        positionY
        >= (nextChunkY + 1) * RETAINED_STATIC_CHUNK_SIZE
          + RETAINED_STATIC_CHUNK_HYSTERESIS
      ) nextChunkY += 1;

      if (
        nextChunkX !== current.chunkX
        || nextChunkY !== current.chunkY
      ) {
        retainedAnchorRef.current = {
          floor,
          chunkX: nextChunkX,
          chunkY: nextChunkY,
        };
      }
    }
  }

  const staticChunkX = retainedAnchorRef.current.chunkX;
  const staticChunkY = retainedAnchorRef.current.chunkY;`,
  "retained static raw chunk coordinates",
);

three = replaceOnce(
  three,
  `    const currentFloorSpecs = visibleOffsets.map(([dx, dy]) => ({
      floor,
      chunkX: staticChunkX + dx,
      chunkY: staticChunkY + dy,
    }));

    // TIBIAGAME_STREAMING_FIX_V7`,
  `    const currentFloorSpecs = visibleOffsets.map(([dx, dy]) => ({
      floor,
      chunkX: staticChunkX + dx,
      chunkY: staticChunkY + dy,
    }));

    // TIBIAGAME_STREAMING_FIX_V20
    // Prepare only the strip(s) the player is approaching. This is a narrow
    // frontier, not a blanket 5x5 GPU prewarm.
    const frontierSpecs: {
      floor: number;
      chunkX: number;
      chunkY: number;
    }[] = [];
    const offsetX = local.position.x
      - staticChunkX * RETAINED_STATIC_CHUNK_SIZE;
    const offsetY = local.position.y
      - staticChunkY * RETAINED_STATIC_CHUNK_SIZE;

    const addVerticalFrontier = (chunkX: number) => {
      for (let dy = -1; dy <= 1; dy += 1) {
        frontierSpecs.push({
          floor,
          chunkX,
          chunkY: staticChunkY + dy,
        });
      }
    };
    const addHorizontalFrontier = (chunkY: number) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        frontierSpecs.push({
          floor,
          chunkX: staticChunkX + dx,
          chunkY,
        });
      }
    };

    if (
      offsetX
      >= RETAINED_STATIC_CHUNK_SIZE - RETAINED_STATIC_FRONTIER_DISTANCE
    ) addVerticalFrontier(staticChunkX + 2);
    if (offsetX <= RETAINED_STATIC_FRONTIER_DISTANCE) {
      addVerticalFrontier(staticChunkX - 2);
    }
    if (
      offsetY
      >= RETAINED_STATIC_CHUNK_SIZE - RETAINED_STATIC_FRONTIER_DISTANCE
    ) addHorizontalFrontier(staticChunkY + 2);
    if (offsetY <= RETAINED_STATIC_FRONTIER_DISTANCE) {
      addHorizontalFrontier(staticChunkY - 2);
    }

    const uniqueFrontierSpecs = frontierSpecs.filter((spec, index, all) =>
      all.findIndex((candidate) =>
        candidate.floor === spec.floor
        && candidate.chunkX === spec.chunkX
        && candidate.chunkY === spec.chunkY
      ) === index
    );

    // TIBIAGAME_STREAMING_FIX_V7`,
  "currentFloorSpecs/frontier insertion",
);

three = replaceOnce(
  three,
  `    const pending = [
      ...currentFloorSpecs.slice(1),
      ...stairTargetSpecs,
    ].filter((spec) => !retainedStaticKeys.current.has(`,
  `    const pending = [
      ...currentFloorSpecs.slice(1),
      ...uniqueFrontierSpecs,
      ...stairTargetSpecs,
    ].filter((spec) => !retainedStaticKeys.current.has(`,
  "retained pending queue",
);

const bridgeRange = functionRange(three, "InstancedBridgeRails");
three = three.slice(0, bridgeRange.start)
  + "// TIBIAGAME_STREAMING_FIX_V20\n// Remaining static world categories use one immutable geometry/material family\n// for every retained chunk. Instance buffers stay allocated for the component\n// lifetime, so dynamic refreshes do not reconstruct WebGL objects.\nconst PERSISTENT_CHUNK_INSTANCE_CAPACITY = 768;\nconst PERSISTENT_WALL_INSTANCE_CAPACITY = 3072;\nconst PERSISTENT_BRIDGE_INSTANCE_CAPACITY = 4096;\n\nconst persistentStaticGeometry = {\n  box: new THREE.BoxGeometry(1, 1, 1),\n  bridgePost: new THREE.CylinderGeometry(0.07, 0.08, 0.78, 8),\n  treeTrunk: new THREE.CylinderGeometry(0.14, 0.2, 1.45, 8),\n  forestLower: new THREE.ConeGeometry(0.82, 1.75, 9),\n  forestUpper: new THREE.ConeGeometry(0.61, 1.35, 9),\n  pineLower: new THREE.ConeGeometry(0.72, 1.9, 7),\n  pineUpper: new THREE.ConeGeometry(0.52, 1.5, 7),\n  mountainCap: new THREE.DodecahedronGeometry(0.53, 0),\n  snowBank: new THREE.DodecahedronGeometry(0.55, 1),\n  barrel: new THREE.CylinderGeometry(0.24, 0.28, 0.56, 10),\n  torchPost: new THREE.CylinderGeometry(0.035, 0.055, 1.24, 7),\n  torchFlame: new THREE.ConeGeometry(0.13, 0.38, 9),\n} as const;\n\nconst persistentStaticMaterial = {\n  houseConnectedWall: new THREE.MeshStandardMaterial({\n    color: \"#aa987c\",\n    roughness: 0.98,\n  }),\n  treeTrunk: new THREE.MeshStandardMaterial({\n    color: \"#604128\",\n    roughness: 1,\n  }),\n  forestLower: new THREE.MeshStandardMaterial({\n    color: \"#315c38\",\n    roughness: 0.95,\n  }),\n  forestUpper: new THREE.MeshStandardMaterial({\n    color: \"#3b7043\",\n    roughness: 0.95,\n  }),\n  pineLower: new THREE.MeshStandardMaterial({\n    color: \"#285744\",\n    roughness: 0.95,\n  }),\n  pineUpper: new THREE.MeshStandardMaterial({\n    color: \"#346a50\",\n    roughness: 0.95,\n  }),\n  snowyLower: new THREE.MeshStandardMaterial({\n    color: \"#c5dadd\",\n    roughness: 0.95,\n  }),\n  snowyUpper: new THREE.MeshStandardMaterial({\n    color: \"#e0ebea\",\n    roughness: 0.95,\n  }),\n  mountainBase: new THREE.MeshStandardMaterial({\n    color: \"#59615d\",\n    roughness: 0.98,\n  }),\n  mountainCap: new THREE.MeshStandardMaterial({\n    color: \"#778078\",\n    roughness: 0.98,\n  }),\n  snowBank: new THREE.MeshStandardMaterial({\n    color: \"#c9dcdf\",\n    roughness: 1,\n  }),\n  barrel: new THREE.MeshStandardMaterial({\n    color: \"#9b5d2c\",\n    roughness: 0.85,\n  }),\n  torchPost: new THREE.MeshStandardMaterial({\n    color: \"#49301f\",\n    roughness: 0.92,\n  }),\n  torchFlame: new THREE.MeshStandardMaterial({\n    color: \"#ff8b32\",\n    emissive: \"#ff4d10\",\n    emissiveIntensity: 3,\n    toneMapped: false,\n  }),\n} as const;\n\nconst persistentCastleWallMaterials = new Map<string, THREE.MeshStandardMaterial>();\nconst persistentBridgeMaterials = new Map<string, {\n  rail: THREE.MeshStandardMaterial;\n  post: THREE.MeshStandardMaterial;\n}>();\n\nfunction usePersistentConnectedWallMaterial(\n  castle: boolean,\n  texture: THREE.Texture,\n) {\n  return useMemo(() => {\n    if (!castle) return persistentStaticMaterial.houseConnectedWall;\n    const key = texture.uuid;\n    const cached = persistentCastleWallMaterials.get(key);\n    if (cached) return cached;\n\n    const material = new THREE.MeshStandardMaterial({\n      map: texture,\n      color: \"#d0d0c5\",\n      roughness: 0.98,\n    });\n    persistentCastleWallMaterials.set(key, material);\n    return material;\n  }, [castle, texture]);\n}\n\nfunction usePersistentBridgeMaterials(texture: THREE.Texture) {\n  return useMemo(() => {\n    const key = texture.uuid;\n    const cached = persistentBridgeMaterials.get(key);\n    if (cached) return cached;\n\n    const materials = {\n      rail: new THREE.MeshStandardMaterial({\n        map: texture,\n        color: \"#725334\",\n        roughness: 0.9,\n      }),\n      post: new THREE.MeshStandardMaterial({\n        map: texture,\n        color: \"#684a2f\",\n        roughness: 0.92,\n      }),\n    };\n    persistentBridgeMaterials.set(key, materials);\n    return materials;\n  }, [texture]);\n}\n\nfunction persistentInstanceMatrix(\n  position: readonly number[],\n  rotation: readonly number[] = [0, 0, 0],\n  scale: readonly number[] = [1, 1, 1],\n) {\n  return new THREE.Matrix4().compose(\n    new THREE.Vector3(position[0], position[1], position[2]),\n    new THREE.Quaternion().setFromEuler(\n      new THREE.Euler(rotation[0], rotation[1], rotation[2]),\n    ),\n    new THREE.Vector3(scale[0], scale[1], scale[2]),\n  );\n}\n\nfunction PersistentStaticInstances({\n  geometry,\n  material,\n  matrices,\n  capacity,\n  castShadow = true,\n  receiveShadow = true,\n  userData,\n}: {\n  geometry: THREE.BufferGeometry;\n  material: THREE.Material;\n  matrices: readonly THREE.Matrix4[];\n  capacity: number;\n  castShadow?: boolean;\n  receiveShadow?: boolean;\n  userData?: Record<string, unknown>;\n}) {\n  const mesh = useMemo(() => {\n    const instance = new THREE.InstancedMesh(\n      geometry,\n      material,\n      capacity,\n    );\n    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    instance.castShadow = castShadow;\n    instance.receiveShadow = receiveShadow;\n    instance.frustumCulled = false;\n    if (userData) Object.assign(instance.userData, userData);\n    return instance;\n  }, [\n    capacity,\n    castShadow,\n    geometry,\n    material,\n    receiveShadow,\n  ]);\n\n  const count = Math.min(matrices.length, capacity);\n\n  useMemo(() => {\n    const target = mesh.instanceMatrix.array as Float32Array;\n    for (let index = 0; index < count; index += 1) {\n      matrices[index].toArray(target, index * 16);\n    }\n    mesh.count = count;\n    mesh.instanceMatrix.clearUpdateRanges();\n    if (count > 0) {\n      mesh.instanceMatrix.addUpdateRange(0, count * 16);\n      mesh.instanceMatrix.needsUpdate = true;\n    }\n  }, [count, matrices, mesh]);\n\n  return <primitive object={mesh} dispose={null} />;\n}" + "\n\n"
  + three.slice(bridgeRange.start);

three = replaceFunction(three, "InstancedBridgeRails", "function InstancedBridgeRails({\n  segments,\n  texture,\n}: {\n  segments: readonly {\n    key: string;\n    position: [number, number, number];\n    size: [number, number, number];\n  }[];\n  texture: THREE.Texture;\n}) {\n  // TIBIAGAME_STREAMING_FIX_V20\n  const materials = usePersistentBridgeMaterials(texture);\n  const { horizontal, vertical, posts } = useMemo(() => {\n    const horizontalMatrices: THREE.Matrix4[] = [];\n    const verticalMatrices: THREE.Matrix4[] = [];\n    const postMatrices: THREE.Matrix4[] = [];\n\n    for (const segment of segments) {\n      const horizontal = segment.size[0] > segment.size[2];\n      const target = horizontal ? horizontalMatrices : verticalMatrices;\n      for (const y of [segment.position[1], segment.position[1] + 0.3]) {\n        target.push(persistentInstanceMatrix(\n          [segment.position[0], y, segment.position[2]],\n          [0, 0, 0],\n          horizontal ? [0.9, 0.09, 0.09] : [0.09, 0.09, 0.9],\n        ));\n      }\n\n      if (horizontal) {\n        postMatrices.push(\n          persistentInstanceMatrix([\n            segment.position[0] - 0.38,\n            0.48,\n            segment.position[2],\n          ]),\n          persistentInstanceMatrix([\n            segment.position[0] + 0.38,\n            0.48,\n            segment.position[2],\n          ]),\n        );\n      } else {\n        postMatrices.push(\n          persistentInstanceMatrix([\n            segment.position[0],\n            0.48,\n            segment.position[2] - 0.38,\n          ]),\n          persistentInstanceMatrix([\n            segment.position[0],\n            0.48,\n            segment.position[2] + 0.38,\n          ]),\n        );\n      }\n    }\n\n    return {\n      horizontal: horizontalMatrices,\n      vertical: verticalMatrices,\n      posts: postMatrices,\n    };\n  }, [segments]);\n\n  return (\n    <>\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.box}\n        material={materials.rail}\n        matrices={horizontal}\n        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}\n      />\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.box}\n        material={materials.rail}\n        matrices={vertical}\n        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}\n      />\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.bridgePost}\n        material={materials.post}\n        matrices={posts}\n        capacity={PERSISTENT_BRIDGE_INSTANCE_CAPACITY}\n        receiveShadow={false}\n      />\n    </>\n  );\n}");
three = replaceFunction(three, "ConnectedWalls", "function ConnectedWalls({\n  positions,\n  contextPositions = positions,\n  castle,\n}: {\n  positions: readonly Position[];\n  contextPositions?: readonly Position[];\n  castle: boolean;\n}) {\n  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;\n  const castleTexture = useWorldTexture(\n    \"/assets/world/aldoria-castle-stone-v2.png\",\n    1.35,\n    1.35,\n  );\n  const material = usePersistentConnectedWallMaterial(\n    castle,\n    castleTexture,\n  );\n\n  // TIBIAGAME_STREAMING_FIX_V20\n  const matrices = useMemo(() => {\n    if (positions.length === 0) return [] as THREE.Matrix4[];\n\n    const set = new Set(contextPositions.map(tileKey));\n    const thickness = castle ? 0.28 : 0.18;\n    const centerSize = castle ? 0.3 : 0.24;\n    const connectorLength = Math.max(0.1, 1 - centerSize);\n    const next: THREE.Matrix4[] = [];\n\n    for (const tile of positions) {\n      const x = tile.x + 0.5;\n      const z = tile.y + 0.5;\n      next.push(persistentInstanceMatrix(\n        [x, height / 2, z],\n        [0, 0, 0],\n        [centerSize, height, centerSize],\n      ));\n\n      if (set.has(`${tile.x + 1}:${tile.y}:${tile.z}`)) {\n        next.push(persistentInstanceMatrix(\n          [x + 0.5, height / 2, z],\n          [0, 0, 0],\n          [connectorLength, height, thickness],\n        ));\n      }\n      if (set.has(`${tile.x}:${tile.y + 1}:${tile.z}`)) {\n        next.push(persistentInstanceMatrix(\n          [x, height / 2, z + 0.5],\n          [0, 0, 0],\n          [thickness, height, connectorLength],\n        ));\n      }\n      if (castle) {\n        next.push(persistentInstanceMatrix(\n          [x, height + 0.18, z],\n          [0, 0, 0],\n          [0.25, 0.36, 0.25],\n        ));\n      }\n    }\n\n    return next;\n  }, [castle, contextPositions, height, positions]);\n\n  return (\n    <PersistentStaticInstances\n      geometry={persistentStaticGeometry.box}\n      material={material}\n      matrices={matrices}\n      capacity={PERSISTENT_WALL_INSTANCE_CAPACITY}\n      userData={{ occluder: true }}\n    />\n  );\n}");
three = replaceFunction(three, "InstancedTrees", "function InstancedTrees({\n  positions,\n  variant = \"forest\",\n}: {\n  positions: readonly Position[];\n  variant?: \"forest\" | \"pine\" | \"snowy\";\n}) {\n  // TIBIAGAME_STREAMING_FIX_V20\n  // Occlusion has been disabled since V11. The old 6x6 occlusion buckets were\n  // still multiplying mesh/components per retained chunk for no visual benefit.\n  return <InstancedTreeBatch positions={positions} variant={variant} />;\n}");
three = replaceFunction(three, "InstancedTreeBatch", "function InstancedTreeBatch({\n  positions,\n  variant,\n}: {\n  positions: readonly Position[];\n  variant: \"forest\" | \"pine\" | \"snowy\";\n}) {\n  const pine = variant !== \"forest\";\n  const snowy = variant === \"snowy\";\n\n  // TIBIAGAME_STREAMING_FIX_V20\n  const { trunks, lower, upper } = useMemo(() => {\n    const trunkMatrices: THREE.Matrix4[] = [];\n    const lowerMatrices: THREE.Matrix4[] = [];\n    const upperMatrices: THREE.Matrix4[] = [];\n    const scale = pine\n      ? [1.04, 1.18, 1.04] as const\n      : [1.18, 1.22, 1.18] as const;\n\n    for (const position of positions) {\n      const rotation = [0, stablePhase(tileKey(position)), 0] as const;\n      trunkMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 0.72, position.y + 0.5],\n        rotation,\n        scale,\n      ));\n      lowerMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 1.75, position.y + 0.5],\n        rotation,\n        scale,\n      ));\n      upperMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 2.35, position.y + 0.5],\n        rotation,\n        scale,\n      ));\n    }\n\n    return {\n      trunks: trunkMatrices,\n      lower: lowerMatrices,\n      upper: upperMatrices,\n    };\n  }, [pine, positions]);\n\n  return (\n    <group userData={{ occluder: true }}>\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.treeTrunk}\n        material={persistentStaticMaterial.treeTrunk}\n        matrices={trunks}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n      />\n      <PersistentStaticInstances\n        geometry={pine\n          ? persistentStaticGeometry.pineLower\n          : persistentStaticGeometry.forestLower}\n        material={snowy\n          ? persistentStaticMaterial.snowyLower\n          : pine\n            ? persistentStaticMaterial.pineLower\n            : persistentStaticMaterial.forestLower}\n        matrices={lower}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n        receiveShadow={false}\n      />\n      <PersistentStaticInstances\n        geometry={pine\n          ? persistentStaticGeometry.pineUpper\n          : persistentStaticGeometry.forestUpper}\n        material={snowy\n          ? persistentStaticMaterial.snowyUpper\n          : pine\n            ? persistentStaticMaterial.pineUpper\n            : persistentStaticMaterial.forestUpper}\n        matrices={upper}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n        receiveShadow={false}\n      />\n    </group>\n  );\n}");
three = replaceFunction(three, "InstancedMountainWalls", "function InstancedMountainWalls({\n  positions,\n}: {\n  positions: readonly Position[];\n}) {\n  // TIBIAGAME_STREAMING_FIX_V20\n  const { bases, caps } = useMemo(() => {\n    const baseMatrices: THREE.Matrix4[] = [];\n    const capMatrices: THREE.Matrix4[] = [];\n\n    for (const position of positions) {\n      baseMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 0.78, position.y + 0.5],\n        [0, 0, 0],\n        [1, 1.56, 0.9],\n      ));\n      capMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.32, 1.62, position.y + 0.55],\n      ));\n    }\n\n    return {\n      bases: baseMatrices,\n      caps: capMatrices,\n    };\n  }, [positions]);\n\n  return (\n    <group>\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.box}\n        material={persistentStaticMaterial.mountainBase}\n        matrices={bases}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n      />\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.mountainCap}\n        material={persistentStaticMaterial.mountainCap}\n        matrices={caps}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n        receiveShadow={false}\n      />\n    </group>\n  );\n}");
three = replaceFunction(three, "InstancedSimpleObjects", "function InstancedSimpleObjects({\n  positions,\n  kind,\n}: {\n  positions: readonly Position[];\n  kind: \"snow-bank\" | \"barrel\";\n}) {\n  // TIBIAGAME_STREAMING_FIX_V20\n  const matrices = useMemo(() => positions.map((position) =>\n    persistentInstanceMatrix([\n      position.x + 0.5,\n      kind === \"barrel\" ? 0.28 : 0.22,\n      position.y + 0.5,\n    ])\n  ), [kind, positions]);\n\n  return (\n    <PersistentStaticInstances\n      geometry={kind === \"barrel\"\n        ? persistentStaticGeometry.barrel\n        : persistentStaticGeometry.snowBank}\n      material={kind === \"barrel\"\n        ? persistentStaticMaterial.barrel\n        : persistentStaticMaterial.snowBank}\n      matrices={matrices}\n      capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n    />\n  );\n}");
three = replaceFunction(three, "InstancedTorches", "function InstancedTorches({\n  positions,\n}: {\n  positions: readonly Position[];\n}) {\n  // TIBIAGAME_STREAMING_FIX_V20\n  // Shared materials/geometries remove one geometry/material pair and one\n  // useFrame callback per retained chunk. Lighting still comes from Atmosphere.\n  const { posts, flames } = useMemo(() => {\n    const postMatrices: THREE.Matrix4[] = [];\n    const flameMatrices: THREE.Matrix4[] = [];\n\n    for (const position of positions) {\n      postMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 0.62, position.y + 0.5],\n        [0, 0, 0],\n        [1.15, 1.15, 1.15],\n      ));\n      flameMatrices.push(persistentInstanceMatrix(\n        [position.x + 0.5, 1.31, position.y + 0.5],\n        [0, 0, 0],\n        [1.15, 1.15, 1.15],\n      ));\n    }\n\n    return {\n      posts: postMatrices,\n      flames: flameMatrices,\n    };\n  }, [positions]);\n\n  return (\n    <>\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.torchPost}\n        material={persistentStaticMaterial.torchPost}\n        matrices={posts}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n        receiveShadow={false}\n      />\n      <PersistentStaticInstances\n        geometry={persistentStaticGeometry.torchFlame}\n        material={persistentStaticMaterial.torchFlame}\n        matrices={flames}\n        capacity={PERSISTENT_CHUNK_INSTANCE_CAPACITY}\n        castShadow={false}\n        receiveShadow={false}\n      />\n    </>\n  );\n}");
three = replaceFunction(three, "PooledStaticBatchMesh", "function PooledStaticBatchMesh({\n  batch,\n}: {\n  batch: PooledStaticBatch;\n}) {\n  const mesh = useMemo(() => {\n    const count = batch.matrices.length / 16;\n    const instance = new THREE.InstancedMesh(\n      batch.geometry,\n      batch.material,\n      count,\n    );\n    instance.castShadow = true;\n    instance.receiveShadow = true;\n    // TIBIAGAME_STREAMING_FIX_V20\n    // These chunks are already spatially bounded around the player. Avoid an\n    // O(instance-count) bounding-sphere build every time an idle chunk mounts.\n    instance.frustumCulled = false;\n    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);\n    instance.instanceMatrix.array.set(batch.matrices);\n    instance.instanceMatrix.needsUpdate = true;\n    return instance;\n  }, [batch]);\n\n  return <primitive object={mesh} dispose={null} />;\n}");

// V19's keep-wall batch is already one mesh. Do not rebuild its bounding
// sphere; the retained chunk itself is the spatial culling unit.
{
  const range = functionRange(three, "BatchedKeepWalls");
  let block = three.slice(range.start, range.end);
  if (!block.includes("instance.computeBoundingSphere();")) {
    throw new Error("Could not find V19 BatchedKeepWalls bounding-sphere build.");
  }
  block = block.replace(
    "    instance.computeBoundingSphere();",
    `    // TIBIAGAME_STREAMING_FIX_V20
    instance.frustumCulled = false;`,
  );
  three = three.slice(0, range.start) + block + three.slice(range.end);
}

// -------------------------------------------------------------------------
// MEDIEVAL ASSET MODEL: share GLTF solid-wall resources across chunks.
// -------------------------------------------------------------------------

const houseWallStart = asset.indexOf("export function InstancedMedievalHouseWalls");
if (houseWallStart < 0) {
  throw new Error("Could not find InstancedMedievalHouseWalls insertion point.");
}
asset = asset.slice(0, houseWallStart)
  + "// TIBIAGAME_STREAMING_FIX_V20\n// V19 batches solid house walls per retained chunk. Reuse the extracted GLTF\n// geometry/material parts across every chunk instead of cloning their materials\n// again for each chunk mount.\nconst PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY = 2048;\n\ntype SharedHouseWallPart = {\n  geometry: THREE.BufferGeometry;\n  material: THREE.Material;\n  matrix: THREE.Matrix4;\n};\n\nconst sharedHouseWallPartCache = new WeakMap<\n  THREE.Group[],\n  readonly SharedHouseWallPart[]\n>();\nconst sharedHousePlasterMaterialCache = new WeakMap<\n  THREE.Group[],\n  THREE.Material\n>();\n\nfunction getSharedHouseWallParts(\n  scenes: THREE.Group[],\n): readonly SharedHouseWallPart[] {\n  const cached = sharedHouseWallPartCache.get(scenes);\n  if (cached) return cached;\n\n  const source = scenes\n    .map((scene) => scene.getObjectByName(nodeNames.solid))\n    .find((candidate): candidate is THREE.Object3D =>\n      candidate !== undefined\n    );\n  if (!source) throw new Error(\"Missing straight medieval house wall asset\");\n\n  source.updateWorldMatrix(true, true);\n  const sourceInverse = source.matrixWorld.clone().invert();\n  const next: SharedHouseWallPart[] = [];\n\n  source.traverse((child) => {\n    if (!(child instanceof THREE.Mesh)) return;\n    const materials = Array.isArray(child.material)\n      ? child.material\n      : [child.material];\n\n    materials.forEach((material) => next.push({\n      geometry: child.geometry,\n      material: material.clone(),\n      matrix: sourceInverse.clone().multiply(child.matrixWorld),\n    }));\n  });\n\n  if (!next.length) {\n    throw new Error(\"Straight medieval house wall asset has no mesh parts\");\n  }\n\n  sharedHouseWallPartCache.set(scenes, next);\n  return next;\n}\n\nfunction getSharedHousePlasterMaterial(scenes: THREE.Group[]) {\n  const cached = sharedHousePlasterMaterialCache.get(scenes);\n  if (cached) return cached;\n\n  const source = scenes\n    .map((scene) => scene.getObjectByName(nodeNames.solid))\n    .find((candidate): candidate is THREE.Object3D =>\n      candidate !== undefined\n    );\n\n  let plaster: THREE.Material | undefined;\n  source?.traverse((child) => {\n    if (plaster || !(child instanceof THREE.Mesh)) return;\n    const materials = Array.isArray(child.material)\n      ? child.material\n      : [child.material];\n    plaster = materials.find((candidate) =>\n      candidate.name.includes(\"Plaster\")\n    );\n  });\n\n  if (!plaster) {\n    throw new Error(\"Missing plaster material on medieval house wall\");\n  }\n\n  const shared = plaster.clone();\n  sharedHousePlasterMaterialCache.set(scenes, shared);\n  return shared;\n}" + "\n\n"
  + asset.slice(houseWallStart);

asset = replaceFunction(
  asset,
  "InstancedMedievalHouseWalls",
  "export function InstancedMedievalHouseWalls({\n  segments,\n}: {\n  segments: readonly HouseWallInstance[];\n}) {\n  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);\n  const parts = useMemo(\n    () => getSharedHouseWallParts(gltf.scenes),\n    [gltf.scenes],\n  );\n\n  // TIBIAGAME_STREAMING_FIX_V20\n  const meshes = useMemo(() => parts.map((part) => {\n    const mesh = new THREE.InstancedMesh(\n      part.geometry,\n      part.material,\n      PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,\n    );\n    mesh.castShadow = true;\n    mesh.receiveShadow = true;\n    mesh.frustumCulled = false;\n    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n    return mesh;\n  }), [parts]);\n\n  const count = Math.min(\n    segments.length,\n    PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY,\n  );\n\n  useMemo(() => {\n    const wallMatrix = new THREE.Matrix4();\n    const translation = new THREE.Vector3();\n    const scale = new THREE.Vector3();\n    const matrix = new THREE.Matrix4();\n    const rotation = new THREE.Quaternion();\n    const axis = new THREE.Vector3(0, 1, 0);\n\n    for (let instanceIndex = 0; instanceIndex < count; instanceIndex += 1) {\n      const segment = segments[instanceIndex];\n      const horizontal = segment.size[0] > segment.size[2];\n      translation.set(\n        segment.position[0],\n        0,\n        segment.position[2],\n      );\n      scale.set(\n        horizontal\n          ? segment.size[0] / SOURCE_WIDTH\n          : segment.size[2] / SOURCE_WIDTH,\n        segment.size[1] / SOURCE_HEIGHT,\n        Math.max(\n          0.28,\n          (horizontal ? segment.size[2] : segment.size[0])\n            / SOURCE_DEPTH,\n        ),\n      );\n      rotation.setFromAxisAngle(\n        axis,\n        horizontal ? 0 : Math.PI / 2,\n      );\n      wallMatrix.compose(translation, rotation, scale);\n\n      parts.forEach((part, partIndex) => {\n        matrix.copy(wallMatrix).multiply(part.matrix);\n        meshSetMatrix(meshes[partIndex], instanceIndex, matrix);\n      });\n    }\n\n    for (const mesh of meshes) {\n      mesh.count = count;\n      mesh.instanceMatrix.clearUpdateRanges();\n      if (count > 0) {\n        mesh.instanceMatrix.addUpdateRange(0, count * 16);\n        mesh.instanceMatrix.needsUpdate = true;\n      }\n    }\n  }, [count, meshes, parts, segments]);\n\n  return (\n    <>\n      {meshes.map((mesh, index) => (\n        <primitive key={index} object={mesh} dispose={null} />\n      ))}\n    </>\n  );\n}\n\nfunction meshSetMatrix(\n  mesh: THREE.InstancedMesh,\n  index: number,\n  matrix: THREE.Matrix4,\n) {\n  matrix.toArray(\n    mesh.instanceMatrix.array as Float32Array,\n    index * 16,\n  );\n}",
);
asset = replaceFunction(
  asset,
  "useHouseFacadePlasterMaterial",
  "export function useHouseFacadePlasterMaterial() {\n  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);\n  // TIBIAGAME_STREAMING_FIX_V20\n  // The facade material is immutable. One shared clone is sufficient for every\n  // house opening instead of one clone/dispose cycle per door/window component.\n  return useMemo(\n    () => getSharedHousePlasterMaterial(gltf.scenes),\n    [gltf.scenes],\n  );\n}",
);

// -------------------------------------------------------------------------
// Safety.
// -------------------------------------------------------------------------

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V20",
  "RETAINED_STATIC_CACHE_LIMIT = 17",
  "RETAINED_STATIC_FRONTIER_DISTANCE = 10",
  "retainedAnchorRef",
  "uniqueFrontierSpecs",
  "PersistentStaticInstances",
  "persistentStaticGeometry",
  "PERSISTENT_WALL_INSTANCE_CAPACITY",
  "frustumCulled = false",
]) {
  if (!three.includes(needle)) {
    throw new Error(`V20 safety check failed: missing ${needle} in ThreeWorld.tsx.`);
  }
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V20",
  "sharedHouseWallPartCache",
  "PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY",
  "getSharedHousePlasterMaterial",
  "frustumCulled = false",
]) {
  if (!asset.includes(needle)) {
    throw new Error(`V20 safety check failed: missing ${needle} in MedievalAssetModels.tsx.`);
  }
}

for (const preserved of [
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16)",
  "TIBIAGAME_STREAMING_FIX_V18_1",
  "BatchedHouseShells",
  "sharedRoofGeometry",
]) {
  if (!three.includes(preserved) && !asset.includes(preserved)) {
    // sharedRoofGeometry lives in MedievalModels.tsx, so only validate V19's
    // local marker instead of opening a third file.
    if (preserved === "sharedRoofGeometry" && three.includes("TIBIAGAME_STREAMING_FIX_V19")) {
      continue;
    }
    throw new Error(`V20 safety check failed: lost ${preserved}.`);
  }
}

if (three.includes("TREE_OCCLUSION_BUCKET_SIZE")) {
  // The constant may remain above the replaced function. Remove it only if it
  // is now unused, avoiding an unnecessary TypeScript noUnusedLocals failure.
  const useCount = (three.match(/TREE_OCCLUSION_BUCKET_SIZE/g) ?? []).length;
  if (useCount === 1) {
    three = three.replace(
      "const TREE_OCCLUSION_BUCKET_SIZE = 6;\n\n",
      "",
    );
  }
}

if (CHECK_ONLY) {
  console.log("V20 compatibility check passed. No files were changed.");
  console.log("  retained cache: 17 soft / 18 hard");
  console.log("  retained handoff hysteresis: 4 tiles");
  console.log("  directional frontier prefetch: 10 tiles");
  console.log("  walls/bridges/trees/mountains/simple props/torches: persistent shared renderer resources");
  console.log("  tree occlusion buckets: removed");
  console.log("  pooled batch bounding-sphere rebuilds: removed");
  console.log("  medieval solid house GLTF materials: shared across retained chunks");
  console.log("  V15-V19 terrain/loading/building behavior: preserved");
  process.exit(0);
}

function denormalize(value, eol) {
  return eol === "\n" ? value : value.replace(/\n/g, "\r\n");
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

console.log("Applied TibiaGame persistent static renderer V20.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("  apps/client/src/game/MedievalAssetModels.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("  npm run build");
console.log("");
console.log("Restart the client and repeat the long traversal test.");
