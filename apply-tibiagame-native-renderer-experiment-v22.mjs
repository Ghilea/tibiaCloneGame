#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const appPath = path.join(root, "apps", "client", "src", "App.tsx");
const threePath = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");
const nativePath = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);
const payloadPath = path.join(root, "NativeWorldRenderer.v22.tsx");

for (const filePath of [appPath, threePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. Unzip the complete V22 archive into the repository root.`,
    );
  }
}

function readNormalized(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const appFile = readNormalized(appPath);
const threeFile = readNormalized(threePath);
const payloadFile = readNormalized(payloadPath);
let app = appFile.text;

if (!threeFile.text.includes("TIBIAGAME_STREAMING_FIX_V21")) {
  throw new Error(
    "V22 experiment expects the V21/V21.1 retained-slot renderer to be present first. No files were written.",
  );
}

if (
  app.includes("TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22")
  && fs.existsSync(nativePath)
) {
  console.log("TibiaGame V22 native renderer experiment is already applied.");
  process.exit(0);
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0) {
    throw new Error(`Could not find ${label}. No files were written.`);
  }
  if (source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

app = replaceOnce(
  app,
  `import { ThreeWorld } from "./game/ThreeWorld";`,
  `import { ThreeWorld } from "./game/ThreeWorld";
import { NativeWorldRenderer } from "./game/NativeWorldRenderer";`,
  "ThreeWorld import",
);

app = replaceOnce(
  app,
  `  const [sceneReady, setSceneReady] = useState(false);`,
  `  const [sceneReady, setSceneReady] = useState(false);
  // TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22
  // Use ?renderer=native in production preview to bypass React Three Fiber for
  // the world scene while keeping the existing React HUD/network/game state.
  const nativeWorldRenderer =
    new URLSearchParams(window.location.search).get("renderer") === "native";
  const handleSceneReady = useCallback(() => setSceneReady(true), []);`,
  "Game sceneReady state",
);

app = replaceOnce(
  app,
  `        <ThreeWorld world={world} input={input} showDebug={showPerformance} onReady={() => setSceneReady(true)} />`,
  `        {nativeWorldRenderer ? (
          <NativeWorldRenderer
            world={world}
            input={input}
            showDebug={showPerformance}
            onReady={handleSceneReady}
          />
        ) : (
          <ThreeWorld
            world={world}
            input={input}
            showDebug={showPerformance}
            onReady={handleSceneReady}
          />
        )}`,
  "ThreeWorld viewport mount",
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22",
  'get("renderer") === "native"',
  "<NativeWorldRenderer",
  "onReady={handleSceneReady}",
]) {
  if (!app.includes(needle)) {
    throw new Error(`V22 safety check failed: missing ${needle}. No files were written.`);
  }
}

for (const needle of [
  "NATIVE WORLD BENCHMARK active",
  "NATIVE LONG FRAME",
  "NATIVE STATIC PREP",
  "NATIVE_STAGE_BUDGET_MS = 2.5",
  "new THREE.WebGLRenderer",
]) {
  if (!payloadFile.text.includes(needle)) {
    throw new Error(`V22 payload safety check failed: missing ${needle}.`);
  }
}

if (CHECK_ONLY) {
  console.log("V22 compatibility check passed. No files were changed.");
  console.log("  existing ThreeWorld/R3F renderer: preserved");
  console.log("  raw Three.js benchmark renderer: ready to install");
  console.log("  selection: ?renderer=native");
  console.log("  React HUD/network/input: preserved");
  console.log("  native world scene: no @react-three/fiber");
  console.log("  static updates: persistent buffers + 2.5ms staged budget");
  console.log("  native performance/long-frame logging: enabled");
  process.exit(0);
}

function denormalize(value, eol) {
  return eol === "\n" ? value : value.replace(/\n/g, "\r\n");
}

fs.writeFileSync(appPath, denormalize(app, appFile.eol), "utf8");
fs.writeFileSync(
  nativePath,
  denormalize(payloadFile.text, appFile.eol),
  "utf8",
);

console.log("Applied TibiaGame V22 native renderer experiment.");
console.log("Changed:");
console.log("  apps/client/src/App.tsx");
console.log("Created:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
console.log("");
console.log("Production benchmark:");
console.log("  cd .\\apps\\client");
console.log("  npx vite preview --host 127.0.0.1 --port 1422");
console.log("  open http://127.0.0.1:1422/?renderer=native");
