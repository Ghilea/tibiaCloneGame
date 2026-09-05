#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const medievalPath = path.join(root, "apps", "client", "src", "game", "MedievalModels.tsx");

for (const target of [threePath, medievalPath]) {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing ${path.relative(root, target)}. Run from repository root.`);
  }
}

function normalized(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const threeFile = normalized(threePath);
const medievalFile = normalized(medievalPath);
let three = threeFile.text;
let medieval = medievalFile.text;

if (three.includes("TIBIAGAME_STREAMING_FIX_V19")
    && medieval.includes("TIBIAGAME_STREAMING_FIX_V19")) {
  console.log("TibiaGame static building batching V19 is already applied.");
  process.exit(0);
}

for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V18_1",
  "TIBIAGAME_STREAMING_FIX_V18",
  "TIBIAGAME_STREAMING_FIX_V17",
  "TIBIAGAME_STREAMING_FIX_V16",
  "TIBIAGAME_STREAMING_FIX_V15",
]) {
  if (!three.includes(marker)) {
    throw new Error(`V19 expects ${marker} in ThreeWorld.tsx. No files were written.`);
  }
}

function replaceOnceIn(source, before, after, label) {
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
  const needle = `function ${functionName}`;
  const start = source.indexOf(needle);
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

function replaceFunctionIn(source, functionName, replacement) {
  const { start, end } = functionRange(source, functionName);
  return source.slice(0, start) + replacement + source.slice(end);
}

// -------------------------------------------------------------------------
// ThreeWorld.tsx
// -------------------------------------------------------------------------

// MedievalWall is no longer used once solid keep walls are batched.
const medievalWallToken = ", MedievalWall,";
if ((three.match(/,\s*MedievalWall\s*,/g) ?? []).length !== 1) {
  throw new Error("Expected exactly one MedievalWall import token. No files were written.");
}
three = three.replace(/,\s*MedievalWall\s*,/, ",");

three = replaceOnceIn(
  three,
  `  stairBase: new THREE.MeshStandardMaterial({ color: "#5f432d", roughness: 1 }),
} as const;`,
  `  stairBase: new THREE.MeshStandardMaterial({ color: "#5f432d", roughness: 1 }),
  // TIBIAGAME_STREAMING_FIX_V19
  buildingFloorHouse: new THREE.MeshStandardMaterial({ color: "#765b42", roughness: 0.96 }),
  buildingFloorKeep: new THREE.MeshStandardMaterial({ color: "#666763", roughness: 0.96 }),
  battlement: new THREE.MeshStandardMaterial({ color: "#87908c", roughness: 0.96 }),
  buildingSignArm: new THREE.MeshStandardMaterial({ color: "#35251a", roughness: 1 }),
  buildingSignPost: new THREE.MeshStandardMaterial({ color: "#2d2017", roughness: 1 }),
  buildingSignBoard: new THREE.MeshStandardMaterial({ color: "#785331", roughness: 0.92 }),
} as const;`,
  "pooledWorldMaterial tail",
);

const buildingInsert = three.indexOf("const Building = memo(function Building");
if (buildingInsert < 0) {
  throw new Error("Could not find Building insertion point. No files were written.");
}
three = three.slice(0, buildingInsert) + "// TIBIAGAME_STREAMING_FIX_V19\ntype StaticBuildingWallSegment = {\n  position: [number, number, number];\n  size: [number, number, number];\n  window?: WindowView;\n  door?: DoorView;\n};\n\nfunction staticBuildingWallSegments(\n  building: BuildingView,\n  doors: readonly DoorView[],\n  windows: readonly WindowView[],\n): StaticBuildingWallSegment[] {\n  const height = buildingWallHeight(building);\n  const maxX = building.x + building.width;\n  const maxY = building.y + building.height;\n  const matchingDoors = doors.filter(\n    (door) => door.position.z === building.floor\n      && insideBuilding(door.position, building),\n  );\n  const doorsByKey = new Map(\n    matchingDoors.map((door) => [\n      `${door.position.x}:${door.position.y}`,\n      door,\n    ]),\n  );\n  const matchingWindows = windows.filter(\n    (window) => window.position.z === building.floor\n      && insideBuilding(window.position, building),\n  );\n  const windowsByKey = new Map(\n    matchingWindows.map((window) => [\n      `${window.position.x}:${window.position.y}`,\n      window,\n    ]),\n  );\n\n  const segments: StaticBuildingWallSegment[] = [];\n  for (let x = building.x; x < maxX; x += 1) {\n    segments.push({\n      position: [x + 0.5, height / 2, building.y],\n      size: [1.04, height, 0.13],\n      window: windowsByKey.get(`${x}:${building.y}`),\n      door: doorsByKey.get(`${x}:${building.y}`),\n    });\n    segments.push({\n      position: [x + 0.5, height / 2, maxY],\n      size: [1.04, height, 0.13],\n      window: windowsByKey.get(`${x}:${maxY - 1}`),\n      door: doorsByKey.get(`${x}:${maxY - 1}`),\n    });\n  }\n\n  for (let y = building.y; y < maxY; y += 1) {\n    segments.push({\n      position: [building.x, height / 2, y + 0.5],\n      size: [0.13, height, 1.04],\n      window: windowsByKey.get(`${building.x}:${y}`),\n      door: doorsByKey.get(`${building.x}:${y}`),\n    });\n    segments.push({\n      position: [maxX, height / 2, y + 0.5],\n      size: [0.13, height, 1.04],\n      window: windowsByKey.get(`${maxX - 1}:${y}`),\n      door: doorsByKey.get(`${maxX - 1}:${y}`),\n    });\n  }\n\n  return segments;\n}\n\nfunction BatchedHouseShells({\n  buildings,\n  doors,\n  windows,\n}: {\n  buildings: readonly BuildingView[];\n  doors: readonly DoorView[];\n  windows: readonly WindowView[];\n}) {\n  const { plinths, walls } = useMemo(() => {\n    const nextPlinths: StaticBuildingWallSegment[] = [];\n    const nextWalls: StaticBuildingWallSegment[] = [];\n\n    for (const building of buildings) {\n      if (building.kind !== \"house\") continue;\n      for (const segment of staticBuildingWallSegments(\n        building,\n        doors,\n        windows,\n      )) {\n        if (!segment.door) nextPlinths.push(segment);\n        if (!segment.door && !segment.window) nextWalls.push(segment);\n      }\n    }\n\n    return {\n      plinths: nextPlinths,\n      walls: nextWalls,\n    };\n  }, [buildings, doors, windows]);\n\n  return (\n    <group userData={{ occluder: true }}>\n      <InstancedHousePlinths segments={plinths} />\n      <InstancedHouseWalls segments={walls} />\n    </group>\n  );\n}\n\nfunction BatchedKeepWalls({\n  buildings,\n  doors,\n  windows,\n}: {\n  buildings: readonly BuildingView[];\n  doors: readonly DoorView[];\n  windows: readonly WindowView[];\n}) {\n  const texture = useWorldTexture(\n    \"/assets/world/aldoria-castle-stone-v2.png\",\n  );\n  const material = useMemo(() => new THREE.MeshStandardMaterial({\n    map: texture,\n    color: \"#6d7773\",\n    roughness: 1,\n  }), [texture]);\n\n  const segments = useMemo(() => {\n    const next: StaticBuildingWallSegment[] = [];\n    for (const building of buildings) {\n      if (building.kind === \"house\") continue;\n      for (const segment of staticBuildingWallSegments(\n        building,\n        doors,\n        windows,\n      )) {\n        if (!segment.door) next.push(segment);\n      }\n    }\n    return next;\n  }, [buildings, doors, windows]);\n\n  const mesh = useMemo(() => {\n    if (!segments.length) return null;\n\n    const instance = new THREE.InstancedMesh(\n      pooledWorldGeometry.box,\n      material,\n      segments.length,\n    );\n    instance.castShadow = true;\n    instance.receiveShadow = true;\n    instance.userData.occluder = true;\n    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);\n\n    const matrix = new THREE.Matrix4();\n    const position = new THREE.Vector3();\n    const scale = new THREE.Vector3();\n    const rotation = new THREE.Quaternion();\n\n    segments.forEach((segment, index) => {\n      position.set(...segment.position);\n      scale.set(...segment.size);\n      matrix.compose(position, rotation, scale);\n      instance.setMatrixAt(index, matrix);\n    });\n    instance.instanceMatrix.needsUpdate = true;\n    instance.computeBoundingSphere();\n    return instance;\n  }, [material, segments]);\n\n  useEffect(() => () => material.dispose(), [material]);\n\n  return mesh ? <primitive object={mesh} /> : null;\n}\n\nfunction BatchedBuildingStaticPrimitives({\n  buildings,\n}: {\n  buildings: readonly BuildingView[];\n}) {\n  const batches = useMemo(() => {\n    const result = new Map<string, PooledStaticBatch>();\n\n    for (const building of buildings) {\n      appendPooledPart(\n        result,\n        building.kind === \"keep\"\n          ? \"building:floor:keep\"\n          : \"building:floor:house\",\n        pooledWorldGeometry.box,\n        building.kind === \"keep\"\n          ? pooledWorldMaterial.buildingFloorKeep\n          : pooledWorldMaterial.buildingFloorHouse,\n        pooledMatrix([\n          building.x + building.width / 2,\n          0.035,\n          building.y + building.height / 2,\n        ]),\n        [0, 0, 0],\n        [0, 0, 0],\n        [\n          Math.max(0.2, building.width - 0.18),\n          0.07,\n          Math.max(0.2, building.height - 0.18),\n        ],\n      );\n\n      if (building.kind === \"house\") {\n        const signParent = pooledMatrix(\n          [\n            building.x + building.width - 0.35,\n            buildingWallHeight(building) * 0.72,\n            building.y - 0.18,\n          ],\n          [0, 0, 0],\n          [1.15, 1.15, 1.15],\n        );\n\n        appendPooledPart(\n          result,\n          \"building:sign:arm\",\n          pooledWorldGeometry.box,\n          pooledWorldMaterial.buildingSignArm,\n          signParent,\n          [0, 0.25, 0],\n          [0, 0, 0],\n          [0.55, 0.055, 0.055],\n        );\n        appendPooledPart(\n          result,\n          \"building:sign:post\",\n          pooledWorldGeometry.box,\n          pooledWorldMaterial.buildingSignPost,\n          signParent,\n          [0.2, -0.05, 0],\n          [0, 0, 0],\n          [0.06, 0.55, 0.06],\n        );\n        appendPooledPart(\n          result,\n          \"building:sign:board\",\n          pooledWorldGeometry.box,\n          pooledWorldMaterial.buildingSignBoard,\n          signParent,\n          [0.2, -0.34, 0],\n          [0, 0, 0],\n          [0.52, 0.34, 0.07],\n        );\n      }\n\n      if (building.kind === \"keep\") {\n        const height = buildingWallHeight(building);\n        for (\n          let x = building.x;\n          x <= building.x + building.width;\n          x += 0.65\n        ) {\n          appendPooledPart(\n            result,\n            \"building:battlement\",\n            pooledWorldGeometry.box,\n            pooledWorldMaterial.battlement,\n            pooledMatrix([x, height + 0.24, building.y]),\n            [0, 0, 0],\n            [0, 0, 0],\n            [0.34, 0.48, 0.34],\n          );\n          appendPooledPart(\n            result,\n            \"building:battlement\",\n            pooledWorldGeometry.box,\n            pooledWorldMaterial.battlement,\n            pooledMatrix([\n              x,\n              height + 0.24,\n              building.y + building.height,\n            ]),\n            [0, 0, 0],\n            [0, 0, 0],\n            [0.34, 0.48, 0.34],\n          );\n        }\n\n        for (\n          let y = building.y + 0.65;\n          y < building.y + building.height;\n          y += 0.65\n        ) {\n          appendPooledPart(\n            result,\n            \"building:battlement\",\n            pooledWorldGeometry.box,\n            pooledWorldMaterial.battlement,\n            pooledMatrix([building.x, height + 0.24, y]),\n            [0, 0, 0],\n            [0, 0, 0],\n            [0.34, 0.48, 0.34],\n          );\n          appendPooledPart(\n            result,\n            \"building:battlement\",\n            pooledWorldGeometry.box,\n            pooledWorldMaterial.battlement,\n            pooledMatrix([\n              building.x + building.width,\n              height + 0.24,\n              y,\n            ]),\n            [0, 0, 0],\n            [0, 0, 0],\n            [0.34, 0.48, 0.34],\n          );\n        }\n      }\n    }\n\n    return [...result.values()];\n  }, [buildings]);\n\n  return (\n    <group>\n      {batches.map((batch) => (\n        <PooledStaticBatchMesh key={batch.key} batch={batch} />\n      ))}\n    </group>\n  );\n}" + "\n\n" + three.slice(buildingInsert);

three = replaceOnceIn(
  three,
  `      <mesh position={[building.x + building.width / 2, 0.035, building.y + building.height / 2]} receiveShadow>
        <boxGeometry args={[Math.max(0.2, building.width - 0.18), 0.07, Math.max(0.2, building.height - 0.18)]} />
        <meshStandardMaterial color={building.kind === "keep" ? "#666763" : "#765b42"} roughness={0.96} />
      </mesh>
`,
  "",
  "per-building floor mesh",
);

three = replaceOnceIn(
  three,
  `        {building.kind === "house" && <InstancedHousePlinths segments={wallSegments.filter((wall) => !wall.door)} />}
        {building.kind === "house" && <InstancedHouseWalls segments={wallSegments.filter((wall) => !wall.door && !wall.window)} />}
`,
  "",
  "per-building house shell batches",
);

three = replaceOnceIn(
  three,
  `            : building.kind === "house" ? null : <MedievalWall key={wall.key} position={wall.position} size={wall.size} keep />`,
  `            : null`,
  "per-segment keep wall",
);

three = replaceOnceIn(
  three,
  `        <HangingSign building={building} wallHeight={height} />
`,
  "",
  "per-building hanging sign",
);

three = replaceOnceIn(
  three,
  `        {building.kind === "keep" && <Battlements building={building} height={height} />}
`,
  "",
  "per-building battlements",
);

three = replaceOnceIn(
  three,
  `    <group>
      {buildings.map((building) => <group key={building.id}>`,
  `    <group>
      {/* TIBIAGAME_STREAMING_FIX_V19: static building shells are chunk batches. */}
      <BatchedBuildingStaticPrimitives buildings={buildings} />
      <BatchedHouseShells buildings={buildings} doors={map.doors} windows={map.windows} />
      <BatchedKeepWalls buildings={buildings} doors={map.doors} windows={map.windows} />
      {buildings.map((building) => <group key={building.id}>`,
  "Structures building map",
);

// After the changes above Battlements must be unused. Remove the function so
// its old per-point declarative mesh tree cannot accidentally return later.
{
  const battlements = functionRange(three, "Battlements");
  three = three.slice(0, battlements.start) + three.slice(battlements.end);
}

if (three.includes("<MedievalWall ")) {
  throw new Error("V19 safety check failed: unbatched MedievalWall usage remains.");
}
if (three.includes("<Battlements ")) {
  throw new Error("V19 safety check failed: per-building Battlements usage remains.");
}
if (three.includes("<HangingSign ")) {
  throw new Error("V19 safety check failed: per-building HangingSign usage remains.");
}

// HangingSign is now unused too.
if ((three.match(/\bHangingSign\b/g) ?? []).length !== 1) {
  throw new Error("Expected HangingSign only in its import after batching.");
}
three = three.replace(/GabledRoof,\s*HangingSign,\s*/, "GabledRoof, ");

// -------------------------------------------------------------------------
// MedievalModels.tsx
// -------------------------------------------------------------------------
const roofInsert = medieval.indexOf("export const GabledRoof = memo(function GabledRoof");
if (roofInsert < 0) {
  throw new Error("Could not find GabledRoof insertion point. No files were written.");
}
medieval = medieval.slice(0, roofInsert) + "// TIBIAGAME_STREAMING_FIX_V19\n// Roofs used to allocate a unique BufferGeometry plus two chimney geometries\n// for every building mount. Retained chunks churn those objects while moving.\n// Cache roof topology by footprint and reuse one unit box for all chimneys.\nconst sharedRoofGeometryCache = new Map<string, THREE.BufferGeometry>();\nconst sharedMedievalUnitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);\nconst sharedChimneyHouseMaterial = new THREE.MeshStandardMaterial({\n  color: \"#704938\",\n  roughness: 1,\n});\nconst sharedChimneyKeepMaterial = new THREE.MeshStandardMaterial({\n  color: \"#626b68\",\n  roughness: 1,\n});\nconst sharedChimneyCapMaterial = new THREE.MeshStandardMaterial({\n  color: \"#3c3731\",\n  roughness: 1,\n});\n\nfunction sharedRoofGeometry(width: number, depth: number) {\n  const key = `${width.toFixed(3)}:${depth.toFixed(3)}`;\n  const cached = sharedRoofGeometryCache.get(key);\n  if (cached) return cached;\n\n  const geometry = roofGeometry(width, depth);\n  sharedRoofGeometryCache.set(key, geometry);\n  return geometry;\n}" + "\n\n" + medieval.slice(roofInsert);

medieval = replaceOnceIn(
  medieval,
  `  const geometry = useMemo(() => roofGeometry(building.width + 0.7, building.height + 0.7), [building.width, building.height]);`,
  `  // TIBIAGAME_STREAMING_FIX_V19
  const geometry = useMemo(
    () => sharedRoofGeometry(building.width + 0.7, building.height + 0.7),
    [building.height, building.width],
  );`,
  "GabledRoof geometry allocation",
);

medieval = replaceOnceIn(
  medieval,
  `  useEffect(() => () => geometry.dispose(), [geometry]);
`,
  "",
  "GabledRoof per-mount geometry disposal",
);

medieval = replaceFunctionIn(medieval, "Chimney", "function Chimney({ x, z, keep }: { x: number; z: number; keep: boolean }) {\n  return (\n    <group position={[x, 0.84, z]}>\n      <mesh\n        geometry={sharedMedievalUnitBoxGeometry}\n        material={keep\n          ? sharedChimneyKeepMaterial\n          : sharedChimneyHouseMaterial}\n        scale={[0.37, 1.7, 0.37]}\n        castShadow\n      />\n      <mesh\n        geometry={sharedMedievalUnitBoxGeometry}\n        material={sharedChimneyCapMaterial}\n        position={[0, 0.89, 0]}\n        scale={[0.48, 0.14, 0.48]}\n        castShadow\n      />\n    </group>\n  );\n}");

// Structural checks.
for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V19",
  "BatchedHouseShells",
  "BatchedKeepWalls",
  "BatchedBuildingStaticPrimitives",
  "building:floor:house",
  "building:battlement",
  "sharedRoofGeometryCache",
  "sharedMedievalUnitBoxGeometry",
]) {
  if (!three.includes(needle) && !medieval.includes(needle)) {
    throw new Error(`V19 safety check failed: missing ${needle}. No files were written.`);
  }
}

for (const preserved of [
  "TIBIAGAME_STREAMING_FIX_V18_1",
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "RETAINED_STATIC_CACHE_LIMIT = 12",
  "RETAINED_STATIC_HARD_LIMIT = 18",
  "new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16)",
]) {
  if (!three.includes(preserved)) {
    throw new Error(`V19 safety check failed: lost ${preserved}. No files were written.`);
  }
}

if (!medieval.includes("HouseDoorway")
    || !medieval.includes("HouseWindowOpening")) {
  throw new Error("V19 safety check failed: dynamic house openings were lost.");
}

if (CHECK_ONLY) {
  console.log("V19 compatibility check passed. No files were changed.");
  console.log("  house solid walls/plinths: per retained-chunk batches");
  console.log("  keep solid walls: one InstancedMesh per retained chunk");
  console.log("  floors/signs/battlements: shared pooled batches");
  console.log("  roofs: shared geometry cache by footprint");
  console.log("  chimneys: shared geometry/materials");
  console.log("  doors/windows/beacons: preserved as dynamic components");
  console.log("  V15-V18.1 terrain/loading/cache behavior: preserved");
  process.exit(0);
}

function denormalize(value, eol) {
  return eol === "\n" ? value : value.replace(/\n/g, "\r\n");
}

fs.writeFileSync(threePath, denormalize(three, threeFile.eol), "utf8");
fs.writeFileSync(medievalPath, denormalize(medieval, medievalFile.eol), "utf8");

console.log("Applied TibiaGame static building batching V19.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("  apps/client/src/game/MedievalModels.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client and test dense building areas.");
