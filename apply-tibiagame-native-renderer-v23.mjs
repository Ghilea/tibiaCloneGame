#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();

const appPath = path.join(root, "apps", "client", "src", "App.tsx");
const nativePath = path.join(
  root,
  "apps",
  "client",
  "src",
  "game",
  "NativeWorldRenderer.tsx",
);
const payloadPath = path.join(root, "NativeWorldRenderer.v23.tsx");

for (const filePath of [appPath, nativePath, payloadPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(root, filePath)}. V23 requires V22 to be installed and the complete V23 ZIP extracted into repository root.`,
    );
  }
}

function load(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
    text: raw.replace(/\r\n/g, "\n"),
  };
}

const appFile = load(appPath);
const nativeFile = load(nativePath);
const payloadFile = load(payloadPath);

let app = appFile.text;

if (
  app.includes("TIBIAGAME_NATIVE_RENDERER_V23_DEFAULT")
  && nativeFile.text.includes("TIBIAGAME_NATIVE_RENDERER_V23")
) {
  console.log("TibiaGame V23 native renderer phase 1 is already applied.");
  process.exit(0);
}

if (!app.includes("TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22")) {
  throw new Error("V23 expects the V22 App renderer switch. No files were written.");
}
if (!nativeFile.text.includes("NATIVE WORLD BENCHMARK active")) {
  throw new Error("V23 expects the V22 NativeWorldRenderer baseline. No files were written.");
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0) throw new Error(`Could not find ${label}. No files were written.`);
  if (source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`Found multiple ${label} matches. No files were written.`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

// Native is now the default production renderer. R3F stays available as a
// temporary comparison/fallback with ?renderer=r3f.
app = replaceOnce(
  app,
  `  // TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22
  // Use ?renderer=native in production preview to bypass React Three Fiber for
  // the world scene while keeping the existing React HUD/network/game state.
  const nativeWorldRenderer =
    new URLSearchParams(window.location.search).get("renderer") === "native";`,
  `  // TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22
  // TIBIAGAME_NATIVE_RENDERER_V23_DEFAULT
  // Native raw Three.js is now the default world renderer. Keep the old R3F
  // path only as a temporary A/B fallback with ?renderer=r3f.
  const nativeWorldRenderer =
    new URLSearchParams(window.location.search).get("renderer") !== "r3f";`,
  "V22 renderer query switch",
);

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V23",
  "NATIVE WORLD V23 active",
  "greyhaven-grass.png",
  "aldoria-packed-earth-v1.png",
  "aldoria-water-v1.png",
  "aldoria-bridge-planks-v1.png",
  "aldoria-castle-stone-v2.png",
  "aldoria-timber-plaster-v1.png",
  "NATIVE_STAGE_BUDGET_MS = 2.5",
  "nextRenderer.compile(scene, camera)",
]) {
  if (!payloadFile.text.includes(needle)) {
    throw new Error(`V23 payload safety check failed: missing ${needle}.`);
  }
}

if (!app.includes('get("renderer") !== "r3f"')) {
  throw new Error("V23 safety check failed: native default renderer switch missing.");
}

if (CHECK_ONLY) {
  console.log("V23 compatibility check passed. No files were changed.");
  console.log("  raw Three.js world renderer: becomes default");
  console.log("  old R3F world renderer: preserved as ?renderer=r3f");
  console.log("  real terrain/world textures: enabled");
  console.log("  roads/water/bridges/terrain material families: native");
  console.log("  houses/castle walls/doors/windows: native phase-1 representation");
  console.log("  forest/pine/snow trees/mountains/props/torches/stairs: native");
  console.log("  startup texture load + shader compile: before scene-ready");
  console.log("  static streaming: persistent buffers + 2.5ms staged updates");
  process.exit(0);
}

function denormalize(text, eol) {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}

fs.writeFileSync(
  appPath,
  denormalize(app, appFile.eol),
  "utf8",
);
fs.writeFileSync(
  nativePath,
  denormalize(payloadFile.text, nativeFile.eol),
  "utf8",
);

console.log("Applied TibiaGame V23 native renderer phase 1.");
console.log("Changed:");
console.log("  apps/client/src/App.tsx");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Native renderer is now the default.");
console.log("Temporary old renderer fallback:");
console.log("  http://127.0.0.1:1422/?renderer=r3f");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
