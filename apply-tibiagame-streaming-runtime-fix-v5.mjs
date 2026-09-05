#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const files = {
  three: path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx"),
  sprite: path.join(root, "apps", "client", "src", "actors", "SpriteCreatureRenderer.tsx"),
  assets: path.join(root, "apps", "client", "src", "actors", "CreatureAssetManager.ts"),
  medieval: path.join(root, "apps", "client", "src", "game", "MedievalModels.tsx"),
};

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${name}: ${path.relative(root, file)}. Run this from the tibiaCloneGame repository root.`);
  }
}

function read(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n") };
}

function write(file, source) {
  const out = source.eol === "\n" ? source.text : source.text.replace(/\n/g, "\r\n");
  fs.writeFileSync(file, out, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.text.indexOf(before);
  if (first < 0) throw new Error(`Could not find expected ${label}. No files were written.`);
  if (source.text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found more than one ${label}. No files were written.`);
  }
  source.text = source.text.slice(0, first) + after + source.text.slice(first + before.length);
}

function replaceRegexCount(source, regex, replacement, expected, label) {
  const matches = [...source.text.matchAll(regex)];
  if (matches.length !== expected) {
    throw new Error(`Expected ${expected} ${label} matches, found ${matches.length}. No files were written.`);
  }
  source.text = source.text.replace(regex, replacement);
}

const three = read(files.three);
const sprite = read(files.sprite);
const assets = read(files.assets);
const medieval = read(files.medieval);

const all = [three, sprite, assets, medieval];
if (all.every((source) => source.text.includes("TIBIAGAME_STREAMING_FIX_V5"))) {
  console.log("TibiaGame streaming/runtime stall fix V5 is already applied.");
  process.exit(0);
}
if (all.some((source) => source.text.includes("TIBIAGAME_STREAMING_FIX_V5"))) {
  throw new Error("V5 appears partially applied. Inspect git diff before continuing.");
}

if (!three.text.includes("TIBIAGAME_STREAMING_FIX_V4")) {
  throw new Error("V5 expects V4 to be applied first. No files were written.");
}

// ---------------------------------------------------------------------------
// 1) LOCAL SUSPENSE BOUNDARIES
// A late-loading actor or structure must never suspend the whole WorldScene.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `      <Structures map={region.map} input={input} world={world} discoveryRevision={world.worldObjectCallout?.key ?? 0} floor={floor} indoorBuildingId={indoorBuildingId} onHover={onLootHover} />`,
  `      {/* TIBIAGAME_STREAMING_FIX_V5
          Late structure assets may suspend locally, but must never blank the
          terrain, player or entire streamed world. */}
      <Suspense fallback={null}>
        <Structures map={region.map} input={input} world={world} discoveryRevision={world.worldObjectCallout?.key ?? 0} floor={floor} indoorBuildingId={indoorBuildingId} onHover={onLootHover} />
      </Suspense>`,
  "Structures render",
);

replaceRegexCount(
  three,
  /<AnimatedCharacter kind=\{kind\} position=\{(player|npc)\.position\} moving=\{moving\} \/>/g,
  (match) => `<Suspense fallback={null}>${match}</Suspense>`,
  2,
  "AnimatedCharacter",
);

// ---------------------------------------------------------------------------
// 2) OCCLUSION WITHOUT SHADER RECOMPILE
// V4 spread Box3 CPU work over frames, but material.transparent + needsUpdate
// still causes WebGL shader program recompilation on the next render. Replace
// fading with cheap root visibility toggling. Visual change is less fancy but
// deterministic and does not create hundreds-of-ms compile stalls.
// ---------------------------------------------------------------------------
replaceOnce(
  three,
  `  const faded = useRef(new Map<THREE.Material, { opacity: number; depthWrite: boolean }>());`,
  `  // TIBIAGAME_STREAMING_FIX_V5
  // Visibility toggling avoids changing material shader defines at runtime.
  const hiddenOccluders = useRef(new Map<THREE.Object3D, boolean>());`,
  "occlusion faded-material cache",
);

replaceOnce(
  three,
  `  const next = useMemo(() => new Set<THREE.Material>(), []);`,
  `  const nextHiddenOccluders = useMemo(() => new Set<THREE.Object3D>(), []);`,
  "occlusion next-material set",
);

replaceOnce(
  three,
  `        // Shader/material preparation is spread over the same budget instead
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
        });`,
  `        // TIBIAGAME_STREAMING_FIX_V5
        // Do not mutate transparent/needsUpdate here. That mutation changes
        // WebGL shader defines and can block a later frame during compilation.`,
  "V4 occlusion material preparation",
);

replaceOnce(
  three,
  `    next.clear();
    for (const root of roots) root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        next.add(material);
        if (!faded.current.has(material)) {
          faded.current.set(material, {
            opacity: material.opacity,
            depthWrite: material.depthWrite,
          });
        }
        material.userData.occlusionOpacity = 0.28;
        material.opacity = Math.min(material.opacity, 0.28);
        material.depthWrite = false;
      }
    });
    for (const [material, original] of faded.current) {
      if (next.has(material)) continue;
      delete material.userData.occlusionOpacity;
      material.opacity = original.opacity;
      material.depthWrite = original.depthWrite;
      faded.current.delete(material);
    }`,
  `    nextHiddenOccluders.clear();
    for (const root of roots) {
      nextHiddenOccluders.add(root);
      if (!hiddenOccluders.current.has(root)) {
        hiddenOccluders.current.set(root, root.visible);
        root.visible = false;
      }
    }
    for (const [root, originalVisible] of hiddenOccluders.current) {
      if (nextHiddenOccluders.has(root)) continue;
      root.visible = originalVisible;
      hiddenOccluders.current.delete(root);
    }`,
  "occlusion material fade block",
);

replaceOnce(
  three,
  `  useEffect(() => () => {
    for (const [material, original] of faded.current) {
      delete material.userData.occlusionOpacity;
      material.opacity = original.opacity;
      material.depthWrite = original.depthWrite;
    }
  }, []);`,
  `  useEffect(() => () => {
    for (const [root, originalVisible] of hiddenOccluders.current) {
      root.visible = originalVisible;
    }
    hiddenOccluders.current.clear();
  }, []);`,
  "occlusion cleanup",
);

// Add a focused long-frame log with renderer memory/program state.
replaceOnce(
  three,
  `    const frameMs = delta * 1_000;
    const current = sample.current;`,
  `    const frameMs = delta * 1_000;
    // TIBIAGAME_STREAMING_FIX_V5
    if (frameMs >= 80) {
      const player = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
      const programs = (gl.info as unknown as { programs?: unknown[] }).programs?.length ?? -1;
      console.warn(
        \`LONG FRAME \${frameMs.toFixed(1)}ms · pos \${player ? \`\${player.position.x}:\${player.position.y}:\${player.position.z}\` : "unknown"} · calls \${gl.info.render.calls} · tris \${gl.info.render.triangles} · programs \${programs} · textures \${gl.info.memory.textures} · geometries \${gl.info.memory.geometries}\`,
      );
    }
    const current = sample.current;`,
  "performance monitor frame sample",
);

// ---------------------------------------------------------------------------
// 3) SPRITE CREATURE ASSETS: NO DECODE STORM, NO RECOMPILE PER ANIMATION
// Render as soon as idle is ready; load walk/attack/hit/death one at a time in
// browser-idle windows. Missing animation atlases temporarily fall back to an
// already loaded atlas rather than throwing.
// ---------------------------------------------------------------------------
replaceOnce(
  sprite,
  `  useEffect(() => {
    let cancelled = false;
    void creatureAssetManager.load(props.definitionId).then(async (definition) => {
      const names = REQUIRED_ANIMATIONS.filter((name) => definition.animations[name]);
      const pairs = await Promise.all(names.map(async (name) => [name, await creatureAssetManager.loadAnimation(definition.id, definition.animations[name])] as const));
      if (!cancelled) setLoaded({ definition, atlases: new Map(pairs) });
    });
    return () => { cancelled = true; };
  }, [props.definitionId]);`,
  `  useEffect(() => {
    let cancelled = false;
    // TIBIAGAME_STREAMING_FIX_V5
    // Never decode every atlas at once. Make the creature visible after idle
    // is ready, then warm remaining animations one-at-a-time in idle windows.
    void (async () => {
      const definition = await creatureAssetManager.load(props.definitionId);
      const names = REQUIRED_ANIMATIONS.filter((name) => definition.animations[name]);
      const atlases = new Map<string, CreatureAtlasPair>();

      for (let index = 0; index < names.length; index += 1) {
        if (index > 0) await waitForAssetIdle();
        if (cancelled) return;
        const name = names[index];
        const pair = await creatureAssetManager.loadAnimation(
          definition.id,
          definition.animations[name],
        );
        if (cancelled) return;
        atlases.set(name, pair);
        setLoaded({ definition, atlases: new Map(atlases) });
      }
    })().catch((error) => {
      console.warn(\`sprite creature load failed: \${props.definitionId}\`, error);
    });
    return () => { cancelled = true; };
  }, [props.definitionId]);`,
  "sprite creature concurrent load effect",
);

replaceOnce(
  sprite,
  `    const desired = dead.current ? "death" : requestedOneShot.current ? requestedOneShot.current : motion.current.moving ? "walk" : "idle";
    controller.play(desired);`,
  `    const requested = dead.current ? "death" : requestedOneShot.current ? requestedOneShot.current : motion.current.moving ? "walk" : "idle";
    // TIBIAGAME_STREAMING_FIX_V5
    // Optional atlases arrive incrementally. Until then use walk/idle instead
    // of stalling or throwing.
    const desired = atlases.has(requested)
      ? requested
      : motion.current.moving && atlases.has("walk") ? "walk" : "idle";
    controller.play(desired);`,
  "sprite desired animation",
);

replaceOnce(
  sprite,
  `      material.map = atlas.albedo;
      material.normalMap = atlas.normal;
      material.needsUpdate = true;
      lastAnimation.current = animationName;`,
  `      const shaderShapeChanged = Boolean(material.normalMap) !== Boolean(atlas.normal);
      material.map = atlas.albedo;
      material.normalMap = atlas.normal;
      // TIBIAGAME_STREAMING_FIX_V5
      // Swapping one non-null map/normalMap for another only changes uniforms.
      // needsUpdate recompiles the shader and was causing animation-transition
      // stalls for every individual creature material.
      if (shaderShapeChanged) material.needsUpdate = true;
      lastAnimation.current = animationName;`,
  "sprite material animation switch",
);

sprite.text += `

// TIBIAGAME_STREAMING_FIX_V5
function waitForAssetIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(resolve);
    else window.setTimeout(resolve, 32);
  });
}
`;

// ---------------------------------------------------------------------------
// 4) GLOBAL CREATURE WARMUP: remove forced 1.5s timeout and Promise.all-style
// pressure. Each animation waits for another browser-idle window.
// ---------------------------------------------------------------------------
replaceOnce(
  assets,
  `  async preload(id: string): Promise<void> {
    const definition = await this.load(id);
    await Promise.all(Object.values(definition.animations).map((animation) => this.loadAnimation(id, animation)));
  }`,
  `  async preload(id: string): Promise<void> {
    const definition = await this.load(id);
    // TIBIAGAME_STREAMING_FIX_V5
    // Decode/upload at most one animation atlas pair per idle window.
    for (const animation of Object.values(definition.animations)) {
      await waitForTextureIdle();
      await this.loadAnimation(id, animation);
    }
  }`,
  "CreatureAssetManager preload",
);

replaceOnce(
  assets,
  `    const loading = Promise.all([
      this.loadTexture(\`\${root}\${animation.albedo}\`, true),
      animation.normal ? this.loadTexture(\`\${root}\${animation.normal}\`, false) : Promise.resolve(null),
    ]).then(([albedo, normal]) => ({ albedo, normal }));`,
  `    const loading = (async () => {
      // TIBIAGAME_STREAMING_FIX_V5
      // Avoid decoding a large albedo and normal WebP at exactly the same time.
      const albedo = await this.loadTexture(\`\${root}\${animation.albedo}\`, true);
      const normal = animation.normal
        ? await this.loadTexture(\`\${root}\${animation.normal}\`, false)
        : null;
      return { albedo, normal };
    })();`,
  "CreatureAssetManager atlas Promise.all",
);

replaceOnce(
  assets,
  `  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(preload, { timeout: 1_500 });
  else window.setTimeout(preload, 0);`,
  `  // TIBIAGAME_STREAMING_FIX_V5
  // No timeout: a timeout forces heavy WebP decode even during active movement.
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(preload);
  else window.setTimeout(preload, 64);`,
  "forced creature preload timeout",
);

assets.text += `

// TIBIAGAME_STREAMING_FIX_V5
function waitForTextureIdle(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(resolve);
    else window.setTimeout(resolve, 32);
  });
}
`;

// ---------------------------------------------------------------------------
// 5) STATIC BUILDING TEXTURES
// These components are conditional. Without preload, entering the first area
// that contains one can suspend Structures. Start the fixed asset requests as
// soon as the module is imported. The local Suspense boundary above ensures a
// slow asset can never blank the rest of the world.
// ---------------------------------------------------------------------------
medieval.text += `

// TIBIAGAME_STREAMING_FIX_V5
[
  "/assets/world/aldoria-castle-stone-v2.png",
  "/assets/world/aldoria-timber-plaster-v1.png",
  "/assets/world/aldoria-roof-tiles-v1.png",
].forEach((assetPath) => useLoader.preload(THREE.TextureLoader, assetPath));
`;

const changed = [
  [files.three, three],
  [files.sprite, sprite],
  [files.assets, assets],
  [files.medieval, medieval],
];

if (CHECK_ONLY) {
  console.log("V5 compatibility check passed. No files were changed.");
  for (const [file] of changed) console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

for (const [file, source] of changed) write(file, source);

console.log("Applied TibiaGame streaming/runtime stall fix V5.");
console.log("Changed:");
for (const [file] of changed) console.log(`  ${path.relative(root, file)}`);
console.log("");
console.log("Validate:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Runtime: watch for LONG FRAME lines and compare programs/textures/geometries.");
