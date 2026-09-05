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

if (text.includes("TIBIAGAME_STREAMING_FIX_V16")) {
  console.log("TibiaGame GPU pool/retained fix V16 is already applied.");
  process.exit(0);
}
if (!text.includes("TIBIAGAME_STREAMING_FIX_V15")) {
  throw new Error("V16 expects V15 to be applied first. No files were written.");
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

replaceOnce(
  `const RETAINED_STATIC_CACHE_LIMIT = 24;
const RETAINED_STATIC_HARD_LIMIT = 40;`,
  `// TIBIAGAME_STREAMING_FIX_V16: compact rolling GPU cache.
const RETAINED_STATIC_CACHE_LIMIT = 12;
const RETAINED_STATIC_HARD_LIMIT = 18;`,
  "retained cache limits",
);

const evictionStartNeedle = `  // V6 could evict an old chunk in the same React commit that mounted a new
  // one. Release at most one old GPU chunk only after movement has been quiet.`;
const evictionStart = text.indexOf(evictionStartNeedle);
if (evictionStart < 0) {
  throw new Error("Could not find V15 retained eviction effect. No files were written.");
}
const evictionEndNeedle = "  // Door/window state is genuinely dynamic.";
const evictionEnd = text.indexOf(evictionEndNeedle, evictionStart);
if (evictionEnd < 0) {
  throw new Error("Could not find retained eviction effect end. No files were written.");
}
text = text.slice(0, evictionStart) + "  // TIBIAGAME_STREAMING_FIX_V16\n  // Retire old GPU chunks while moving, but only in browser idle time. The old\n  // 650ms stationary timer let retained geometry accumulate for a whole walk.\n  useEffect(() => {\n    if (!local || retainedStaticChunks.length <= RETAINED_STATIC_CACHE_LIMIT) return;\n\n    let cancelled = false;\n    let idleHandle: number | null = null;\n    let timeoutHandle: number | null = null;\n\n    const retireOne = () => {\n      if (cancelled) return;\n      startTransition(() => {\n        setRetainedStaticChunks((previous) => {\n          if (previous.length <= RETAINED_STATIC_CACHE_LIMIT) return previous;\n\n          let removableIndex = -1;\n          let bestScore = -1;\n          previous.forEach((entry, index) => {\n            if (\n              entry.floor === floor\n              && Math.abs(entry.chunkX - staticChunkX) <= 1\n              && Math.abs(entry.chunkY - staticChunkY) <= 1\n            ) return;\n\n            const floorPenalty = entry.floor === floor ? 0 : 8;\n            const score = floorPenalty\n              + Math.abs(entry.chunkX - staticChunkX)\n              + Math.abs(entry.chunkY - staticChunkY);\n            if (score > bestScore) {\n              bestScore = score;\n              removableIndex = index;\n            }\n          });\n\n          if (removableIndex < 0) return previous;\n          const next = [...previous];\n          const [removed] = next.splice(removableIndex, 1);\n          retainedStaticKeys.current.delete(removed.key);\n          return next;\n        });\n      });\n    };\n\n    const idleWindow = window as typeof window & {\n      requestIdleCallback?: (\n        callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,\n      ) => number;\n      cancelIdleCallback?: (handle: number) => void;\n    };\n\n    if (idleWindow.requestIdleCallback) {\n      idleHandle = idleWindow.requestIdleCallback(() => retireOne());\n    } else {\n      timeoutHandle = window.setTimeout(retireOne, 48);\n    }\n\n    return () => {\n      cancelled = true;\n      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);\n      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);\n    };\n  }, [\n    floor,\n    retainedStaticChunks.length,\n    staticChunkX,\n    staticChunkY,\n  ]);" + "\n\n" + text.slice(evictionEnd);

const worldRange = functionRange("WorldObjects");
text = text.slice(0, worldRange.start) + "// TIBIAGAME_STREAMING_FIX_V16\n// Shared immutable primitives for repeated static props. These objects live for\n// the renderer lifetime and are referenced by all retained chunks.\nconst pooledWorldGeometry = {\n  box: new THREE.BoxGeometry(1, 1, 1),\n  plane: new THREE.PlaneGeometry(1, 1),\n  bogCircle: new THREE.CircleGeometry(1, 12),\n  reedStem: new THREE.CylinderGeometry(0.017, 0.025, 1, 5),\n  wellBody: new THREE.CylinderGeometry(0.42, 0.48, 1, 10),\n  wellRing: new THREE.TorusGeometry(0.34, 0.09, 6, 10),\n  sphere10x8: new THREE.SphereGeometry(1, 10, 8),\n  sphere8x7: new THREE.SphereGeometry(1, 8, 7),\n  sphere8x6: new THREE.SphereGeometry(1, 8, 6),\n  bone: new THREE.CylinderGeometry(0.035, 0.04, 1, 7),\n  rock: new THREE.DodecahedronGeometry(1, 0),\n  mushroomStem: new THREE.CylinderGeometry(0.025, 0.035, 1, 6),\n  campLog: new THREE.CylinderGeometry(0.07, 0.08, 1, 7),\n  campFlame: new THREE.ConeGeometry(0.16, 1, 8),\n  hayBody: new THREE.CylinderGeometry(0.27, 0.27, 1, 10),\n  hayBand: new THREE.TorusGeometry(0.275, 0.018, 5, 12),\n} as const;\n\nconst pooledWorldMaterial = {\n  noticePost: new THREE.MeshStandardMaterial({ color: \"#553a24\", roughness: 1 }),\n  noticeBoard: new THREE.MeshStandardMaterial({ color: \"#765038\", roughness: 0.95 }),\n  noticePaper: new THREE.MeshStandardMaterial({ color: \"#d1be8a\", roughness: 1 }),\n  bog: new THREE.MeshStandardMaterial({ color: \"#17231f\", roughness: 0.38, metalness: 0.12 }),\n  reedStem: new THREE.MeshStandardMaterial({ color: \"#526a36\", roughness: 0.96 }),\n  reedLeaf: new THREE.MeshStandardMaterial({ color: \"#6f873f\", roughness: 0.92, side: THREE.DoubleSide }),\n  plank: new THREE.MeshStandardMaterial({ color: \"#66452d\", roughness: 1 }),\n  plankDark: new THREE.MeshStandardMaterial({ color: \"#4d392a\", roughness: 1 }),\n  wellBody: new THREE.MeshStandardMaterial({ color: \"#77807b\", roughness: 0.98 }),\n  wellRing: new THREE.MeshStandardMaterial({ color: \"#58615d\", roughness: 0.95 }),\n  crate: new THREE.MeshStandardMaterial({ color: \"#855833\", roughness: 0.92 }),\n  crateBand: new THREE.MeshStandardMaterial({ color: \"#4f321f\", roughness: 1 }),\n  sack: new THREE.MeshStandardMaterial({ color: \"#b39a6a\", roughness: 1 }),\n  sackTie: new THREE.MeshStandardMaterial({ color: \"#7c6542\", roughness: 1 }),\n  bone: new THREE.MeshStandardMaterial({ color: \"#cfc4a2\", roughness: 0.95 }),\n  skull: new THREE.MeshStandardMaterial({ color: \"#bfb28f\", roughness: 0.96 }),\n  rock: new THREE.MeshStandardMaterial({ color: \"#7a807b\", roughness: 0.99 }),\n  rockDark: new THREE.MeshStandardMaterial({ color: \"#666d69\", roughness: 0.99 }),\n  mushroomStem: new THREE.MeshStandardMaterial({ color: \"#d8c6a1\", roughness: 1 }),\n  mushroom: new THREE.MeshStandardMaterial({ color: \"#9c6048\", roughness: 0.9 }),\n  mushroomBright: new THREE.MeshStandardMaterial({ color: \"#c68155\", roughness: 0.9 }),\n  log: new THREE.MeshStandardMaterial({ color: \"#5d3924\", roughness: 1 }),\n  flame: new THREE.MeshStandardMaterial({\n    color: \"#ff9a38\",\n    emissive: \"#e84d16\",\n    emissiveIntensity: 1.8,\n    toneMapped: false,\n  }),\n  hay: new THREE.MeshStandardMaterial({ color: \"#b49543\", roughness: 1 }),\n  hayBand: new THREE.MeshStandardMaterial({ color: \"#6f5930\", roughness: 1 }),\n  fencePost: new THREE.MeshStandardMaterial({ color: \"#6e482d\", roughness: 1 }),\n  fenceRail: new THREE.MeshStandardMaterial({ color: \"#805638\", roughness: 1 }),\n  furnitureTop: new THREE.MeshStandardMaterial({ color: \"#80502d\", roughness: 0.9 }),\n  furnitureLeg: new THREE.MeshStandardMaterial({ color: \"#61391f\", roughness: 1 }),\n  stairStep: new THREE.MeshStandardMaterial({ color: \"#9a6338\", roughness: 0.9 }),\n  stairBase: new THREE.MeshStandardMaterial({ color: \"#5f432d\", roughness: 1 }),\n} as const;\n\ntype PooledStaticBatch = {\n  key: string;\n  geometry: THREE.BufferGeometry;\n  material: THREE.Material;\n  matrices: number[];\n};\n\nfunction pooledMatrix(\n  position: readonly number[],\n  rotation: readonly number[] = [0, 0, 0],\n  scale: readonly number[] = [1, 1, 1],\n) {\n  return new THREE.Matrix4().compose(\n    new THREE.Vector3(position[0], position[1], position[2]),\n    new THREE.Quaternion().setFromEuler(\n      new THREE.Euler(rotation[0], rotation[1], rotation[2]),\n    ),\n    new THREE.Vector3(scale[0], scale[1], scale[2]),\n  );\n}\n\nfunction pooledChild(\n  parent: THREE.Matrix4,\n  position: readonly number[],\n  rotation: readonly number[] = [0, 0, 0],\n) {\n  return new THREE.Matrix4().multiplyMatrices(\n    parent,\n    pooledMatrix(position, rotation),\n  );\n}\n\nfunction appendPooledPart(\n  batches: Map<string, PooledStaticBatch>,\n  key: string,\n  geometry: THREE.BufferGeometry,\n  material: THREE.Material,\n  parent: THREE.Matrix4,\n  position: readonly number[] = [0, 0, 0],\n  rotation: readonly number[] = [0, 0, 0],\n  scale: readonly number[] = [1, 1, 1],\n) {\n  let batch = batches.get(key);\n  if (!batch) {\n    batch = { key, geometry, material, matrices: [] };\n    batches.set(key, batch);\n  }\n\n  const matrix = new THREE.Matrix4().multiplyMatrices(\n    parent,\n    pooledMatrix(position, rotation, scale),\n  );\n  for (const value of matrix.elements) batch.matrices.push(value);\n}\n\nfunction PooledStaticBatchMesh({ batch }: { batch: PooledStaticBatch }) {\n  const mesh = useMemo(() => {\n    const count = batch.matrices.length / 16;\n    const instance = new THREE.InstancedMesh(\n      batch.geometry,\n      batch.material,\n      count,\n    );\n    instance.castShadow = true;\n    instance.receiveShadow = true;\n    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);\n    instance.instanceMatrix.array.set(batch.matrices);\n    instance.instanceMatrix.needsUpdate = true;\n    instance.computeBoundingSphere();\n    return instance;\n  }, [batch]);\n\n  return <primitive object={mesh} />;\n}" + "\n\n" + text.slice(worldRange.start);
replaceFunction("WorldObjects", "function WorldObjects({ objects }: { objects: readonly WorldObjectView[] }) {\n  // TIBIAGAME_STREAMING_FIX_V16\n  // Static props are converted to a small set of InstancedMesh batches instead\n  // of allocating geometry/material objects for every prop in every chunk.\n  const batches = useMemo(() => {\n    const result = new Map<string, PooledStaticBatch>();\n\n    for (const object of objects) {\n      const x = object.position.x + 0.5;\n      const z = object.position.y + 0.5;\n\n      if (object.kind === \"notice_post\") {\n        const parent = pooledMatrix([x, 0, z], [0, 0.28, 0]);\n        appendPooledPart(result, \"notice:post\", pooledWorldGeometry.box, pooledWorldMaterial.noticePost, parent, [0, 0.42, 0], [0, 0, 0], [0.08, 0.84, 0.08]);\n        appendPooledPart(result, \"notice:board\", pooledWorldGeometry.box, pooledWorldMaterial.noticeBoard, parent, [0, 0.67, 0.015], [0, 0, 0], [0.56, 0.38, 0.055]);\n        appendPooledPart(result, \"notice:paper\", pooledWorldGeometry.plane, pooledWorldMaterial.noticePaper, parent, [0, 0.68, 0.047], [0, 0, 0], [0.4, 0.25, 1]);\n        continue;\n      }\n\n      if (object.kind === \"bog_slick\") {\n        appendPooledPart(result, \"bog\", pooledWorldGeometry.bogCircle, pooledWorldMaterial.bog, pooledMatrix([x, 0, z]), [0, 0.012, 0], [-Math.PI / 2, 0, 0], [0.46, 0.46, 1]);\n        continue;\n      }\n\n      if (object.kind === \"bent_reeds\") {\n        const parent = pooledMatrix([x, 0, z], [0, 0.82, -0.18]);\n        [-0.23, -0.08, 0.08, 0.22].forEach((offset, index) => {\n          const reed = pooledChild(\n            parent,\n            [offset, 0, (index % 2 - 0.5) * 0.12],\n            [0, 0, 0.24 + index * 0.06],\n          );\n          appendPooledPart(result, \"reed:stem\", pooledWorldGeometry.reedStem, pooledWorldMaterial.reedStem, reed, [0, 0.34 + index * 0.025, 0], [0, 0, 0], [1, 0.7 + index * 0.05, 1]);\n          appendPooledPart(result, \"reed:leaf\", pooledWorldGeometry.plane, pooledWorldMaterial.reedLeaf, reed, [0.07, 0.61 + index * 0.04, 0], [0, 0, -0.48], [0.18, 0.045, 1]);\n        });\n        continue;\n      }\n\n      if (object.kind === \"wrecked_planks\") {\n        const parent = pooledMatrix([x, 0.08, z], [0, 0.36, 0]);\n        [-0.22, 0, 0.22].forEach((offset, index) => {\n          appendPooledPart(\n            result,\n            index === 1 ? \"plank:dark\" : \"plank\",\n            pooledWorldGeometry.box,\n            index === 1 ? pooledWorldMaterial.plankDark : pooledWorldMaterial.plank,\n            parent,\n            [offset, index * 0.025, (index - 1) * 0.12],\n            [0, 0.22 * (index - 1), 0.1 * (index - 1)],\n            [0.62, 0.09, 0.16],\n          );\n        });\n        continue;\n      }\n\n      if (object.kind === \"well\") {\n        const parent = pooledMatrix([x, 0, z]);\n        appendPooledPart(result, \"well:body\", pooledWorldGeometry.wellBody, pooledWorldMaterial.wellBody, parent, [0, 0.3, 0], [0, 0, 0], [1, 0.55, 1]);\n        appendPooledPart(result, \"well:ring\", pooledWorldGeometry.wellRing, pooledWorldMaterial.wellRing, parent, [0, 0.59, 0]);\n        continue;\n      }\n\n      if (object.kind === \"wooden_crate\") {\n        const parent = pooledMatrix([x, 0, z]);\n        appendPooledPart(result, \"crate:body\", pooledWorldGeometry.box, pooledWorldMaterial.crate, parent, [0, 0.28, 0], [0, 0, 0], [0.66, 0.56, 0.66]);\n        appendPooledPart(result, \"crate:band\", pooledWorldGeometry.box, pooledWorldMaterial.crateBand, parent, [0, 0.29, 0.35], [0, 0, 0], [0.72, 0.08, 0.06]);\n        appendPooledPart(result, \"crate:band\", pooledWorldGeometry.box, pooledWorldMaterial.crateBand, parent, [0, 0.29, -0.35], [0, 0, 0], [0.72, 0.08, 0.06]);\n        continue;\n      }\n\n      if (object.kind === \"grain_sack\") {\n        const parent = pooledMatrix([x, 0, z]);\n        appendPooledPart(result, \"sack\", pooledWorldGeometry.sphere10x8, pooledWorldMaterial.sack, parent, [0, 0.3, 0], [0, 0, 0], [0.2652, 0.3672, 0.238]);\n        appendPooledPart(result, \"sack:tie\", pooledWorldGeometry.sphere10x8, pooledWorldMaterial.sackTie, parent, [0, 0.64, 0], [0, 0, 0], [0.09, 0.09, 0.09]);\n        continue;\n      }\n\n      if (object.kind === \"bone_pile\") {\n        const parent = pooledMatrix([x, 0.08, z]);\n        [\n          [-0.18, 0.1, -0.08, 0.7],\n          [0.13, 0.12, 0.12, -0.55],\n          [-0.02, 0.15, 0.2, 1.1],\n        ].forEach(([bx, by, bz, rot]) => {\n          appendPooledPart(result, \"bone\", pooledWorldGeometry.bone, pooledWorldMaterial.bone, parent, [bx, by, bz], [Math.PI / 2, rot, 0], [1, 0.48, 1]);\n        });\n        appendPooledPart(result, \"skull\", pooledWorldGeometry.sphere8x7, pooledWorldMaterial.skull, parent, [0.22, 0.18, -0.14], [0, 0, 0], [0.14, 0.14, 0.14]);\n        continue;\n      }\n\n      if (object.kind === \"rock_pile\") {\n        const parent = pooledMatrix([x, 0, z]);\n        [\n          [-0.18, 0.17, 0.02, 0.24],\n          [0.16, 0.2, 0.1, 0.3],\n          [0.03, 0.28, -0.14, 0.25],\n        ].forEach(([rx, ry, rz, radius], index) => {\n          appendPooledPart(\n            result,\n            index === 1 ? \"rock:dark\" : \"rock\",\n            pooledWorldGeometry.rock,\n            index === 1 ? pooledWorldMaterial.rockDark : pooledWorldMaterial.rock,\n            parent,\n            [rx, ry, rz],\n            [0, 0, 0],\n            [radius, radius, radius],\n          );\n        });\n        continue;\n      }\n\n      if (object.kind === \"mushroom_patch\") {\n        const parent = pooledMatrix([x, 0, z]);\n        [\n          [-0.2, 0.12, -0.08, 0.12],\n          [0.12, 0.16, 0.05, 0.15],\n          [0.24, 0.1, -0.18, 0.1],\n        ].forEach(([mx, my, mz, size], index) => {\n          appendPooledPart(result, \"mushroom:stem\", pooledWorldGeometry.mushroomStem, pooledWorldMaterial.mushroomStem, parent, [mx, my * 0.55, mz], [0, 0, 0], [1, my, 1]);\n          appendPooledPart(\n            result,\n            index === 1 ? \"mushroom:bright\" : \"mushroom\",\n            pooledWorldGeometry.sphere8x6,\n            index === 1 ? pooledWorldMaterial.mushroomBright : pooledWorldMaterial.mushroom,\n            parent,\n            [mx, my + 0.015, mz],\n            [0, 0, 0],\n            [size, size * 0.45, size],\n          );\n        });\n        continue;\n      }\n\n      if (object.kind === \"campfire\") {\n        const parent = pooledMatrix([x, 0, z]);\n        appendPooledPart(result, \"camp:log\", pooledWorldGeometry.campLog, pooledWorldMaterial.log, parent, [0, 0.1, 0], [0, 0.7, Math.PI / 2], [1, 0.62, 1]);\n        appendPooledPart(result, \"camp:log\", pooledWorldGeometry.campLog, pooledWorldMaterial.log, parent, [0, 0.1, 0], [0, -0.7, Math.PI / 2], [1, 0.62, 1]);\n        appendPooledPart(result, \"camp:flame\", pooledWorldGeometry.campFlame, pooledWorldMaterial.flame, parent, [0, 0.37, 0], [0, 0, 0], [1, 0.55, 1]);\n        continue;\n      }\n\n      if (object.kind === \"hay_bundle\") {\n        const parent = pooledMatrix([x, 0.22, z], [0, 0.25, Math.PI / 2]);\n        appendPooledPart(result, \"hay:body\", pooledWorldGeometry.hayBody, pooledWorldMaterial.hay, parent, [0, 0, 0], [0, 0, 0], [1, 0.68, 1]);\n        [-0.2, 0.2].forEach((offset) => {\n          appendPooledPart(result, \"hay:band\", pooledWorldGeometry.hayBand, pooledWorldMaterial.hayBand, parent, [0, offset, 0]);\n        });\n        continue;\n      }\n\n      if (object.kind === \"fence_post\") {\n        const parent = pooledMatrix([x, 0, z]);\n        appendPooledPart(result, \"fence:post\", pooledWorldGeometry.box, pooledWorldMaterial.fencePost, parent, [0, 0.52, 0], [0, 0, 0], [0.13, 1.04, 0.13]);\n        appendPooledPart(result, \"fence:rail\", pooledWorldGeometry.box, pooledWorldMaterial.fenceRail, parent, [0, 0.62, 0], [0, 0, 0], [0.82, 0.11, 0.1]);\n        appendPooledPart(result, \"fence:rail\", pooledWorldGeometry.box, pooledWorldMaterial.fenceRail, parent, [0, 0.34, 0], [0, 0, 0], [0.82, 0.11, 0.1]);\n        continue;\n      }\n\n      const isTable = object.kind === \"table\";\n      const parent = pooledMatrix([x, 0, z]);\n      appendPooledPart(\n        result,\n        isTable ? \"furniture:table\" : \"furniture:other\",\n        pooledWorldGeometry.box,\n        pooledWorldMaterial.furnitureTop,\n        parent,\n        [0, isTable ? 0.58 : 0.35, 0],\n        [0, 0, 0],\n        [isTable ? 0.78 : 0.9, 0.13, isTable ? 0.58 : 0.25],\n      );\n      if (isTable) {\n        [-0.29, 0.29].forEach((dx) => {\n          [-0.2, 0.2].forEach((dz) => {\n            appendPooledPart(result, \"furniture:leg\", pooledWorldGeometry.box, pooledWorldMaterial.furnitureLeg, parent, [dx, 0.28, dz], [0, 0, 0], [0.1, 0.56, 0.1]);\n          });\n        });\n      }\n    }\n\n    return [...result.values()];\n  }, [objects]);\n\n  return <group>{batches.map((batch) => <PooledStaticBatchMesh key={batch.key} batch={batch} />)}</group>;\n}");
replaceFunction("Stairs", "function Stairs({ stairs, floor }: { stairs: readonly StairView[]; floor: number }) {\n  // TIBIAGAME_STREAMING_FIX_V16\n  const batches = useMemo(() => {\n    const result = new Map<string, PooledStaticBatch>();\n\n    for (const stair of stairs) {\n      const position = stair.from.z === floor\n        ? stair.from\n        : stair.to.z === floor\n          ? stair.to\n          : null;\n      if (!position) continue;\n\n      const parent = pooledMatrix([\n        position.x + 0.5,\n        0.04,\n        position.y + 0.5,\n      ]);\n\n      [0, 1, 2, 3].forEach((step) => {\n        appendPooledPart(\n          result,\n          \"stairs:step\",\n          pooledWorldGeometry.box,\n          pooledWorldMaterial.stairStep,\n          parent,\n          [(step - 1.5) * 0.18, step * 0.075, 0],\n          [0, 0, 0],\n          [0.22, 0.12, 0.78],\n        );\n      });\n      appendPooledPart(\n        result,\n        \"stairs:base\",\n        pooledWorldGeometry.box,\n        pooledWorldMaterial.stairBase,\n        parent,\n        [0, 0.02, 0],\n        [0, 0, 0],\n        [0.95, 0.035, 0.95],\n      );\n    }\n\n    return [...result.values()];\n  }, [floor, stairs]);\n\n  return <group>{batches.map((batch) => <PooledStaticBatchMesh key={batch.key} batch={batch} />)}</group>;\n}");

const nativePreventDefaultCount =
  (text.match(/event\.nativeEvent\.preventDefault\(\);/g) ?? []).length;
if (nativePreventDefaultCount === 0) {
  throw new Error("Expected R3F nativeEvent.preventDefault calls. No files were written.");
}
text = text.replace(/\s*event\.nativeEvent\.preventDefault\(\);/g, "");

for (const needle of [
  "TIBIAGAME_STREAMING_FIX_V16",
  "RETAINED_STATIC_CACHE_LIMIT = 12",
  "RETAINED_STATIC_HARD_LIMIT = 18",
  "requestIdleCallback",
  "pooledWorldGeometry",
  "PooledStaticBatchMesh",
  "function WorldObjects",
  "function Stairs",
]) {
  if (!text.includes(needle)) {
    throw new Error(`V16 safety check failed: missing ${needle}. No files were written.`);
  }
}

if (!text.includes("TERRAIN_RENDER_PADDING = 16")
    || !text.includes("TERRAIN_CHUNK_HYSTERESIS = 4")) {
  throw new Error("V16 safety check failed: V15 terrain settings were lost.");
}
if (!text.includes("function SceneReady(")) {
  throw new Error("V16 safety check failed: V14 loading warmup was lost.");
}

if (CHECK_ONLY) {
  console.log("V16 compatibility check passed. No files were changed.");
  console.log("  retained cache: 12 soft / 18 hard");
  console.log("  old chunks: one-at-a-time idle retirement during movement");
  console.log("  WorldObjects: shared resources + InstancedMesh batches");
  console.log("  Stairs: shared resources + InstancedMesh batches");
  console.log(`  passive native preventDefault calls removed on apply: ${nativePreventDefaultCount}`);
  console.log("  V15 terrain stability: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame GPU pool/retained fix V16.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Restart the client and walk a long route while watching geometries/programs.");
