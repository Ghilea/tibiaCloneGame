#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const filePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");

if (!fs.existsSync(filePath)) {
  throw new Error("Missing apps/client/src/game/ThreeWorld.tsx. Run from repository root.");
}

const raw = fs.readFileSync(filePath, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_STREAMING_FIX_V18")) {
  console.log("TibiaGame persistent buffer/GPU warmup fix V18 is already applied.");
  process.exit(0);
}
for (const marker of [
  "TIBIAGAME_STREAMING_FIX_V17",
  "TIBIAGAME_STREAMING_FIX_V16",
  "TIBIAGAME_STREAMING_FIX_V15",
  "TIBIAGAME_STREAMING_FIX_V14",
]) {
  if (!text.includes(marker)) {
    throw new Error(`V18 expects ${marker}. No files were written.`);
  }
}

function replaceOnce(before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

function functionRange(functionName) {
  const needle = `function ${functionName}`;
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`Could not find ${functionName}. No files were written.`);

  const paramsStart = text.indexOf("(", start + needle.length);
  if (paramsStart < 0) throw new Error(`Could not parse ${functionName} parameters.`);

  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let parenDepth = 0;
  let paramsEnd = -1;

  for (let i = paramsStart; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
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
  for (let i = paramsEnd; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
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
  for (let i = bodyStart; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
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

function replaceFunction(functionName, replacement) {
  const { start, end } = functionRange(functionName);
  text = text.slice(0, start) + replacement + text.slice(end);
}

// Helpers are deliberately placed before SceneReady.
const sceneReadyStart = text.indexOf("function SceneReady({");
if (sceneReadyStart < 0) {
  throw new Error("Could not find SceneReady insertion point. No files were written.");
}
text = text.slice(0, sceneReadyStart) + "// TIBIAGAME_STREAMING_FIX_V18\ntype WarmupRenderer = THREE.WebGLRenderer & {\n  compileAsync?: (\n    scene: THREE.Object3D,\n    camera: THREE.Camera,\n  ) => Promise<unknown>;\n};\n\nfunction retainedStaticSceneRoots(scene: THREE.Object3D) {\n  const roots: THREE.Object3D[] = [];\n  scene.traverse((object) => {\n    const data = object.userData;\n    if (\n      typeof data?.streamFloor === \"number\"\n      && typeof data?.streamChunkX === \"number\"\n      && typeof data?.streamChunkY === \"number\"\n    ) {\n      roots.push(object);\n    }\n  });\n  return roots;\n}\n\nfunction withRetainedStaticRootsVisible<T>(\n  scene: THREE.Object3D,\n  work: () => T,\n) {\n  const roots = retainedStaticSceneRoots(scene);\n  const visibility = roots.map((root) => root.visible);\n  roots.forEach((root) => {\n    root.visible = true;\n  });\n\n  try {\n    return work();\n  } finally {\n    roots.forEach((root, index) => {\n      root.visible = visibility[index];\n    });\n  }\n}\n\nfunction initializeWarmupTextures(\n  renderer: THREE.WebGLRenderer,\n  scene: THREE.Object3D,\n) {\n  const seen = new Set<THREE.Texture>();\n  const textureSlots = [\n    \"map\",\n    \"alphaMap\",\n    \"aoMap\",\n    \"bumpMap\",\n    \"displacementMap\",\n    \"emissiveMap\",\n    \"envMap\",\n    \"lightMap\",\n    \"metalnessMap\",\n    \"normalMap\",\n    \"roughnessMap\",\n  ] as const;\n\n  scene.traverseVisible((object) => {\n    const materialValue = (object as THREE.Mesh).material;\n    const materials = Array.isArray(materialValue)\n      ? materialValue\n      : materialValue\n        ? [materialValue]\n        : [];\n\n    for (const material of materials) {\n      const record = material as unknown as Record<string, unknown>;\n      for (const slot of textureSlots) {\n        const texture = record[slot];\n        if (!(texture instanceof THREE.Texture) || seen.has(texture)) continue;\n        seen.add(texture);\n        renderer.initTexture(texture);\n      }\n    }\n  });\n}\n\nfunction compileSceneForWarmup(\n  renderer: WarmupRenderer,\n  scene: THREE.Object3D,\n  camera: THREE.Camera,\n  initializeTextures: boolean,\n) {\n  return withRetainedStaticRootsVisible(scene, () => {\n    if (initializeTextures) initializeWarmupTextures(renderer, scene);\n\n    return renderer.compileAsync\n      ? renderer.compileAsync(scene, camera)\n      : Promise.resolve(renderer.compile(scene, camera));\n  });\n}\n\nfunction StaticSceneWarmup({ revision }: { revision: string }) {\n  const { gl, scene, camera } = useThree();\n  const compiledRevision = useRef(\"\");\n\n  useEffect(() => {\n    if (!revision || compiledRevision.current === revision) return;\n\n    let cancelled = false;\n    let idleHandle: number | null = null;\n    let timeoutHandle: number | null = null;\n\n    const compile = () => {\n      if (cancelled || compiledRevision.current === revision) return;\n      compiledRevision.current = revision;\n      const renderer = gl as WarmupRenderer;\n\n      void compileSceneForWarmup(\n        renderer,\n        scene,\n        camera,\n        false,\n      ).catch(() => undefined);\n    };\n\n    const idleWindow = window as typeof window & {\n      requestIdleCallback?: (\n        callback: (deadline: {\n          didTimeout: boolean;\n          timeRemaining: () => number;\n        }) => void,\n      ) => number;\n      cancelIdleCallback?: (handle: number) => void;\n    };\n\n    const schedule = () => {\n      if (cancelled || compiledRevision.current === revision) return;\n\n      if (idleWindow.requestIdleCallback) {\n        idleHandle = idleWindow.requestIdleCallback((deadline) => {\n          if (cancelled) return;\n          if (deadline.timeRemaining() < 10) {\n            schedule();\n            return;\n          }\n          compile();\n        });\n      } else {\n        timeoutHandle = window.setTimeout(compile, 120);\n      }\n    };\n\n    schedule();\n\n    return () => {\n      cancelled = true;\n      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);\n      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);\n    };\n  }, [camera, gl, revision, scene]);\n\n  return null;\n}" + "\n\n" + text.slice(sceneReadyStart);

replaceFunction("SceneReady", "function SceneReady({\n  armed,\n  onReady,\n}: {\n  armed: boolean;\n  onReady?: () => void;\n}) {\n  const { gl, scene, camera } = useThree();\n  const reported = useRef(false);\n  const armedAt = useRef(0);\n  const lastSignature = useRef(\"\");\n  const stableFrames = useRef(0);\n  const compileStarted = useRef(false);\n  const compileFinished = useRef(false);\n  const onReadyRef = useRef(onReady);\n  onReadyRef.current = onReady;\n\n  useEffect(() => {\n    if (!armed || reported.current) return;\n    armedAt.current = performance.now();\n    lastSignature.current = \"\";\n    stableFrames.current = 0;\n    compileStarted.current = false;\n    compileFinished.current = false;\n  }, [armed]);\n\n  useFrame(() => {\n    if (reported.current || !armed) return;\n\n    const signature = [\n      gl.info.memory.geometries,\n      gl.info.memory.textures,\n      gl.info.programs?.length ?? 0,\n    ].join(\":\");\n\n    if (signature === lastSignature.current) {\n      stableFrames.current += 1;\n    } else {\n      lastSignature.current = signature;\n      stableFrames.current = 0;\n    }\n\n    const elapsed = performance.now() - armedAt.current;\n\n    // TIBIAGAME_STREAMING_FIX_V18\n    // The loading screen already hides initial construction. Use that time to\n    // compile BOTH the active floor and retained hidden stair-target floor\n    // chunks. Also push their already-loaded textures to the GPU now rather\n    // than on the first z-level transition.\n    if (!compileStarted.current && stableFrames.current >= 18 && elapsed >= 600) {\n      compileStarted.current = true;\n      const renderer = gl as WarmupRenderer;\n\n      try {\n        void compileSceneForWarmup(\n          renderer,\n          scene,\n          camera,\n          true,\n        )\n          .catch(() => undefined)\n          .then(() => {\n            compileFinished.current = true;\n            lastSignature.current = \"\";\n            stableFrames.current = 0;\n          });\n      } catch {\n        compileFinished.current = true;\n        lastSignature.current = \"\";\n        stableFrames.current = 0;\n      }\n      return;\n    }\n\n    if (compileFinished.current && stableFrames.current >= 24 && elapsed >= 1_100) {\n      reported.current = true;\n      onReadyRef.current?.();\n    }\n  });\n\n  return null;\n}");
replaceFunction("InstancedTiles", "function InstancedTiles({\n  positions,\n  color,\n  height,\n  y,\n  scale = 0.98,\n  castShadow = false,\n  texture,\n}: {\n  positions: readonly Position[];\n  color: THREE.ColorRepresentation;\n  height: number;\n  y: number;\n  scale?: number;\n  castShadow?: boolean;\n  texture?: THREE.Texture;\n}) {\n  // TIBIAGAME_STREAMING_FIX_V18\n  // V17 kept the InstancedMesh itself stable, but still replaced the complete\n  // instanceMatrix BufferAttribute whenever a streamed terrain slice changed.\n  // Keep one fixed GPU buffer for the component lifetime and only update its\n  // used matrix range.\n  const instanceMatrix = useMemo(() => {\n    const attribute = new THREE.InstancedBufferAttribute(\n      new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16),\n      16,\n    );\n    attribute.setUsage(THREE.DynamicDrawUsage);\n    return attribute;\n  }, []);\n\n  const visibleCount = Math.min(positions.length, TERRAIN_INSTANCE_CAPACITY);\n\n  useMemo(() => {\n    const data = instanceMatrix.array as Float32Array;\n    const matrix = new THREE.Matrix4();\n\n    for (let index = 0; index < visibleCount; index += 1) {\n      const tile = positions[index];\n      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);\n      matrix.toArray(data, index * 16);\n    }\n\n    instanceMatrix.clearUpdateRanges();\n    if (visibleCount > 0) {\n      instanceMatrix.addUpdateRange(0, visibleCount * 16);\n      instanceMatrix.needsUpdate = true;\n    }\n  }, [instanceMatrix, positions, visibleCount, y]);\n\n  return (\n    <instancedMesh\n      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}\n      count={visibleCount}\n      castShadow={castShadow}\n      receiveShadow\n      frustumCulled={false}\n    >\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <boxGeometry args={[scale, height, scale]} />\n      <meshStandardMaterial map={texture} color={color} roughness={0.92} />\n    </instancedMesh>\n  );\n}");
replaceFunction("WaterTiles", "function WaterTiles({ positions }: { positions: readonly Position[] }) {\n  const waterTexture = useWorldTexture(\"/assets/world/aldoria-water-v1.png\");\n  const material = useMemo(() => new THREE.MeshPhysicalMaterial({\n    map: waterTexture,\n    color: \"#277789\",\n    emissive: \"#16424d\",\n    emissiveIntensity: 0.08,\n    metalness: 0.05,\n    roughness: 0.2,\n    transparent: true,\n    opacity: 0.86,\n  }), [waterTexture]);\n\n  // TIBIAGAME_STREAMING_FIX_V18\n  // Keep the water instance attribute alive across terrain-window updates too.\n  const instanceMatrix = useMemo(() => {\n    const attribute = new THREE.InstancedBufferAttribute(\n      new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16),\n      16,\n    );\n    attribute.setUsage(THREE.DynamicDrawUsage);\n    return attribute;\n  }, []);\n\n  const visibleCount = Math.min(positions.length, TERRAIN_INSTANCE_CAPACITY);\n\n  useMemo(() => {\n    const data = instanceMatrix.array as Float32Array;\n    const matrix = new THREE.Matrix4();\n    const quaternion = new THREE.Quaternion().setFromEuler(\n      new THREE.Euler(-Math.PI / 2, 0, 0),\n    );\n    const scale = new THREE.Vector3(1.02, 1.02, 1);\n\n    for (let index = 0; index < visibleCount; index += 1) {\n      const tile = positions[index];\n      matrix.compose(\n        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),\n        quaternion,\n        scale,\n      );\n      matrix.toArray(data, index * 16);\n    }\n\n    instanceMatrix.clearUpdateRanges();\n    if (visibleCount > 0) {\n      instanceMatrix.addUpdateRange(0, visibleCount * 16);\n      instanceMatrix.needsUpdate = true;\n    }\n  }, [instanceMatrix, positions, visibleCount]);\n\n  useEffect(() => () => material.dispose(), [material]);\n  useFrame(({ clock }) => {\n    const wave = Math.sin(clock.elapsedTime * 1.6) * 0.035;\n    material.roughness = 0.2 + wave;\n    material.opacity = 0.84 + Math.sin(clock.elapsedTime * 1.25) * 0.035;\n    material.emissiveIntensity = 0.1 + wave;\n    waterTexture.offset.set(clock.elapsedTime * 0.032, clock.elapsedTime * 0.019);\n  });\n\n  return (\n    <instancedMesh\n      args={[undefined, undefined, TERRAIN_INSTANCE_CAPACITY]}\n      count={visibleCount}\n      receiveShadow\n      frustumCulled={false}\n    >\n      <primitive object={instanceMatrix} attach=\"instanceMatrix\" />\n      <planeGeometry args={[1, 1]} />\n      <primitive object={material} attach=\"material\" />\n    </instancedMesh>\n  );\n}");

replaceOnce(
  '  const staticSceneRevision = `${floor}:${staticChunkX}:${staticChunkY}:${activeStaticChunkCount}:${dynamicMapRevision}`;',
  "  const staticSceneRevision = `${floor}:${staticChunkX}:${staticChunkY}:${activeStaticChunkCount}:${dynamicMapRevision}`;\n\n"
    + "  // TIBIAGAME_STREAMING_FIX_V18\n"
    + "  // Key-set revision catches hidden stair targets and rolling-cache swaps too,\n"
    + "  // even when activeStaticChunkCount happens to remain unchanged.\n"
    + "  const staticGpuWarmupRevision = `${floor}:${dynamicMapRevision}:${retainedStaticChunks\n"
    + "    .map((entry) => entry.key)\n"
    + "    .sort()\n"
    + "    .join(\"|\")}`;",
  "staticSceneRevision",
);

replaceOnce(
  '      <SceneReady armed={initialWorldReady} onReady={onReady} />',
  `      <SceneReady armed={initialWorldReady} onReady={onReady} />
      <StaticSceneWarmup revision={staticGpuWarmupRevision} />`,
  "SceneReady JSX",
);

// V16 removed nativeEvent.preventDefault() but accidentally left this if
// controlling the actual interaction call.
replaceOnce(
  `  const onGround = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button === 2)
    input.interactAt({`,
  `  const onGround = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    input.interactAt({`,
  "V16 dangling ground-event if",
);

for (const functionName of ["InstancedTiles", "WaterTiles"]) {
  const range = functionRange(functionName);
  const block = text.slice(range.start, range.end);
  if (!block.includes("new Float32Array(TERRAIN_INSTANCE_CAPACITY * 16)")) {
    throw new Error(`${functionName} does not use a persistent capacity buffer.`);
  }
  if (!block.includes("clearUpdateRanges()") || !block.includes("addUpdateRange(")) {
    throw new Error(`${functionName} does not limit GPU matrix updates.`);
  }
  if (block.includes("new Float32Array(positions.length * 16)")) {
    throw new Error(`${functionName} still reallocates the matrix buffer by positions.length.`);
  }
  if (block.includes("if (!positions.length) return null")) {
    throw new Error(`${functionName} still unmounts at zero instances.`);
  }
}

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V18",
  "StaticSceneWarmup",
  "compileSceneForWarmup",
  "initializeWarmupTextures",
  "staticGpuWarmupRevision",
  "TERRAIN_RENDER_PADDING = 16",
  "TERRAIN_CHUNK_HYSTERESIS = 4",
  "RETAINED_STATIC_CACHE_LIMIT = 12",
  "RETAINED_STATIC_HARD_LIMIT = 18",
  "pooledWorldGeometry",
]) {
  if (!text.includes(needle)) {
    throw new Error(`V18 safety check failed: missing ${needle}. No files were written.`);
  }
}

if (CHECK_ONLY) {
  console.log("V18 compatibility check passed. No files were changed.");
  console.log("  terrain matrix BufferAttributes: persistent fixed-capacity");
  console.log("  terrain zero-count batches: stay mounted");
  console.log("  loading screen: compiles active + retained hidden floors");
  console.log("  runtime retained shader warmup: requestIdleCallback");
  console.log("  V16 ground interaction dangling-if regression: fixed on apply");
  console.log("  V15/V16/V17 behavior: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame persistent buffer/GPU warmup fix V18.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client.");
