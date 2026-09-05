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

if (text.includes("TIBIAGAME_STREAMING_FIX_V20_2")) {
  console.log("TibiaGame V20.2 JSX syntax fix is already applied.");
  process.exit(0);
}

const bad = "          {/* TIBIAGAME_STREAMING_FIX_V20_1: ground input belongs to Terrain. */}\n";
const count = text.split(bad).length - 1;

if (count !== 1) {
  throw new Error(
    `Expected exactly one invalid V20.1 JSX comment inside RetainedStaticChunk props, found ${count}. No files were written.`,
  );
}

text = text.replace(
  bad,
  "          // TIBIAGAME_STREAMING_FIX_V20_2\n",
);

// A normal JS line comment is also invalid inside JSX props. Remove the marker
// from the tag entirely and keep a marker next to the retained map instead.
text = text.replace(
  "          // TIBIAGAME_STREAMING_FIX_V20_2\n",
  "",
);

const anchor = "      {retainedStaticChunks.map((chunk) => (\n";
if (!text.includes(anchor)) {
  throw new Error("Could not find retainedStaticChunks JSX anchor. No files were written.");
}
text = text.replace(
  anchor,
  `      {/* TIBIAGAME_STREAMING_FIX_V20_2: retained chunks do not receive onGround. */}
      {retainedStaticChunks.map((chunk) => (
`,
);

if (text.includes("{/* TIBIAGAME_STREAMING_FIX_V20_1: ground input belongs to Terrain. */}")) {
  throw new Error("V20.2 safety check failed: invalid JSX comment still remains inside the prop list.");
}
if (!text.includes("TIBIAGAME_STREAMING_FIX_V20_2")) {
  throw new Error("V20.2 safety check failed: marker missing.");
}

if (CHECK_ONLY) {
  console.log("V20.2 compatibility check passed. No files were changed.");
  console.log("  invalid JSX comment inside RetainedStaticChunk props: removable");
  console.log("  retained chunk onGround removal from V20.1: preserved");
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(filePath, output, "utf8");

console.log("Applied TibiaGame V20.2 JSX syntax fix.");
console.log("Changed:");
console.log("  apps/client/src/game/ThreeWorld.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
