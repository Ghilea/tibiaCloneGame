#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const target = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);

if (!fs.existsSync(target)) {
  throw new Error(`Missing ${path.relative(root, target)}.`);
}

const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let source = raw.replace(/\r\n/g, "\n");

if (source.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_3_4")) {
  console.log("TibiaGame V31B.3.4 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3_3",
  "NATIVE WORLD V31B.3.3 active",
  "function initializeNativeLoadedAssetTextures(",
  "const humanizeId = (value: string) => value",
  "const targetAt = (position: Position): PointerTarget =>",
  "NATIVE V31B.2 GPU warmup:",
]) {
  if (!source.includes(needle)) {
    throw new Error(
      `V31B.3.4 expects installed V31B.3.3 baseline: missing ${needle}. No files were written.`,
    );
  }
}

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) {
    throw new Error(
      `V31B.3.4 anchor not found: ${label}. No files were written.`,
    );
  }
  source =
    source.slice(0, index)
    + after
    + source.slice(index + before.length);
}

replaceOnce(
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_3_3\n",
  "// TIBIAGAME_NATIVE_RENDERER_V31_B_3_3\n// TIBIAGAME_NATIVE_RENDERER_V31_B_3_4\n",
  "version marker",
);
replaceOnce(
  "NATIVE WORLD V31B.3.3 active · orientation-correct roof UVs · raw Three.js",
  "NATIVE WORLD V31B.3.4 active · full GPU prewarm + frame profiler · raw Three.js",
  "startup version",
);
replaceOnce(
  'data-native-world-renderer="v31b.3.3"',
  'data-native-world-renderer="v31b.3.4"',
  "renderer version",
);

replaceOnce(
`function initializeNativeLoadedAssetTextures(
  renderer: THREE.WebGLRenderer,
  characters: NativeCharacterAssets,`,
`function initializeNativeLoadedAssetTextures(
  renderer: THREE.WebGLRenderer,
  nativeTextures: NativeTextures,
  characters: NativeCharacterAssets,`,
  "texture prewarm signature",
);
replaceOnce(
`  const textures = new Set<THREE.Texture>();

  const collectRoots =`,
`  const textures = new Set<THREE.Texture>();

  for (const texture of Object.values(nativeTextures)) {
    textures.add(texture);
  }

  const collectRoots =`,
  "native texture prewarm",
);
replaceOnce(
`        initializeNativeLoadedAssetTextures(
          nextRenderer,
          characterAssets,`,
`        initializeNativeLoadedAssetTextures(
          nextRenderer,
          textures,
          characterAssets,`,
  "texture prewarm call",
);

const entityHelper = `      const firstEntityAtPosition = <
        T extends { id: string; position: Position },
      >(
        values: Iterable<T>,
        position: Position,
        skipId?: string,
      ): T | undefined => {
        for (const entry of values) {
          if (skipId && entry.id === skipId) continue;
          if (
            entry.position.x === position.x
            && entry.position.y === position.y
            && entry.position.z === position.z
          ) {
            return entry;
          }
        }
        return undefined;
      };

`;
replaceOnce(
  "      const humanizeId = (value: string) => value",
  entityHelper + "      const humanizeId = (value: string) => value",
  "allocation-free pointer helper",
);

replaceOnce(
`        const npc = [...world.npcs.values()].find((entry) =>
          sameTile(entry.position)
        );`,
`        const npc = firstEntityAtPosition(
          world.npcs.values(),
          position,
        );`,
  "NPC pointer spread",
);
replaceOnce(
`        const creature = [...world.creatures.values()].find((entry) =>
          sameTile(entry.position)
        );`,
`        const creature = firstEntityAtPosition(
          world.creatures.values(),
          position,
        );`,
  "creature pointer spread",
);
replaceOnce(
`        const player = [...world.players.values()].find((entry) =>
          entry.id !== world.localPlayerId && sameTile(entry.position)
        );`,
`        const player = firstEntityAtPosition(
          world.players.values(),
          position,
          world.localPlayerId ?? undefined,
        );`,
  "player pointer spread",
);
replaceOnce(
`        const resource = [...world.resourceNodes.values()].find((entry) =>
          sameTile(entry.position)
        );`,
`        const resource = firstEntityAtPosition(
          world.resourceNodes.values(),
          position,
        );`,
  "resource pointer spread",
);

replaceOnce(
`      const render = (now: number) => {
        if (disposed) return;
        animationFrame = window.requestAnimationFrame(render);

        const frameMs = Math.max(0, now - lastFrameAt);`,
`      const render = (now: number) => {
        if (disposed) return;
        animationFrame = window.requestAnimationFrame(render);

        const frameWorkStartedAt = performance.now();
        let staticWorkMs = 0;
        let actorWorkMs = 0;
        let dynamicWorkMs = 0;

        const frameMs = Math.max(0, now - lastFrameAt);`,
  "frame profiler start",
);

replaceOnce(
`          queueStaticSnapshot(
            map,
            floor,
            local.position.x,
            local.position.y,
            signature,
          );
          runStagedTasks();

          const actorDelta =`,
`          const staticWorkStartedAt = performance.now();
          queueStaticSnapshot(
            map,
            floor,
            local.position.x,
            local.position.y,
            signature,
          );
          runStagedTasks();
          staticWorkMs = performance.now() - staticWorkStartedAt;

          const actorDelta =`,
  "static profiler",
);

replaceOnce(
`          const actorDelta = Math.min(frameMs / 1000, 0.05);
          activeActorManager.sync(
            world,
            floor,
            actorDelta,
            now,
            camera,
            layers.creatures,
          );

          // TIBIAGAME_NATIVE_RENDERER_V24_1`,
`          const actorDelta = Math.min(frameMs / 1000, 0.05);
          const actorWorkStartedAt = performance.now();
          activeActorManager.sync(
            world,
            floor,
            actorDelta,
            now,
            camera,
            layers.creatures,
          );
          actorWorkMs = performance.now() - actorWorkStartedAt;

          // TIBIAGAME_NATIVE_RENDERER_V24_1`,
  "actor profiler",
);

replaceOnce(
`          activeOpeningAnimationManager.update(
            map,
            floor,
            local.position,
            now,
          );

          activeDynamicSceneManager.update(
            world,
            map,
            floor,
            local.position,
            visualLocal,
            activeActorManager,
            environment.daylight,
            now,
          );

          camera.position.set(`,
`          const dynamicWorkStartedAt = performance.now();
          activeOpeningAnimationManager.update(
            map,
            floor,
            local.position,
            now,
          );

          activeDynamicSceneManager.update(
            world,
            map,
            floor,
            local.position,
            visualLocal,
            activeActorManager,
            environment.daylight,
            now,
          );
          dynamicWorkMs = performance.now() - dynamicWorkStartedAt;

          camera.position.set(`,
  "dynamic profiler",
);

replaceOnce(
`        nextRenderer.render(scene, camera);

        if (now >= warmupUntil) {`,
`        const rendererWorkStartedAt = performance.now();
        nextRenderer.render(scene, camera);
        const rendererWorkMs =
          performance.now() - rendererWorkStartedAt;
        const totalWorkMs =
          performance.now() - frameWorkStartedAt;

        if (now >= warmupUntil) {`,
  "renderer profiler",
);

replaceOnce(
`              + \`programs \${nextRenderer.info.programs?.length ?? 0} · \`
              + \`textures \${nextRenderer.info.memory.textures} · \`
              + \`geometries \${nextRenderer.info.memory.geometries}\`,
            );`,
`              + \`programs \${nextRenderer.info.programs?.length ?? 0} · \`
              + \`textures \${nextRenderer.info.memory.textures} · \`
              + \`geometries \${nextRenderer.info.memory.geometries} · \`
              + \`work \${totalWorkMs.toFixed(1)}ms \`
              + \`(static \${staticWorkMs.toFixed(1)} · \`
              + \`actors \${actorWorkMs.toFixed(1)} · \`
              + \`dynamic \${dynamicWorkMs.toFixed(1)} · \`
              + \`render \${rendererWorkMs.toFixed(1)})\`,
            );`,
  "long frame log profiler",
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_3_4",
  "Object.values(nativeTextures)",
  "const firstEntityAtPosition = <",
  "const frameWorkStartedAt = performance.now();",
  "work ${totalWorkMs.toFixed(1)}ms",
  "NATIVE V31B.2 GPU warmup:",
  "NATIVE WORLD V31B.3.4 active",
  'data-native-world-renderer="v31b.3.4"',
]) {
  if (!source.includes(needle)) {
    throw new Error(`V31B.3.4 safety check failed: missing ${needle}.`);
  }
}

for (const forbidden of [
  "[...world.npcs.values()]",
  "[...world.creatures.values()]",
  "[...world.players.values()]",
  "[...world.resourceNodes.values()]",
]) {
  if (source.includes(forbidden)) {
    throw new Error(
      `V31B.3.4 safety check failed: pointer allocation remains: ${forbidden}`,
    );
  }
}

if (CHECK_ONLY) {
  console.log("V31B.3.4 compatibility check passed. No files were changed.");
  console.log("  V31B.3.3 roof UV fix: preserved");
  console.log("  all native world textures: explicit GPU pre-init");
  console.log("  pointer hover Map-spread allocations: removed");
  console.log("  50+ ms logs: frame interval vs actual work separated");
  console.log("  phases reported: static / actors / dynamic / render");
  console.log("  V31B.2 startup GPU warmup: preserved");
  process.exit(0);
}

const output = eol === "\n"
  ? source
  : source.replace(/\n/g, "\r\n");

fs.writeFileSync(target, output, "utf8");

console.log("Applied TibiaGame V31B.3.4 full-prewarm/profiler patch.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
