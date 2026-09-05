#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const root = process.cwd();
const file = path.join(root, "apps", "client", "src", "game", "ThreeWorld.tsx");

if (!fs.existsSync(file)) {
  throw new Error(`Missing ${path.relative(root, file)}. Run this from the tibiaCloneGame repository root.`);
}

const raw = fs.readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_STREAMING_FIX_V3_1")) {
  console.log("TibiaGame streaming stability fix V3.1 is already applied.");
  process.exit(0);
}

function replaceRegexOnce(regex, replacement, label) {
  const matches = [...text.matchAll(regex)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}. No files were written.`);
  }
  text = text.replace(regex, replacement);
}

// V2 used 24-tile chunks. Runtime testing showed that this caused too many
// complete static-scene commits while sprinting. 48 reduces boundary frequency
// by half while remaining much smaller than V1's 128-tile chunk.
replaceRegexOnce(
  /const\s+RENDER_CHUNK_SIZE\s*=\s*24\s*;\s*\nconst\s+RENDER_PADDING\s*=\s*8\s*;/g,
  `// TIBIAGAME_STREAMING_FIX_V3_1
const RENDER_CHUNK_SIZE = 48;
const RENDER_PADDING = 10;`,
  "V2 render chunk constants",
);

// With shadowMap.autoUpdate=false, a new static chunk previously scheduled a
// full shadow pass shortly after every chunk/floor commit. Debounce that pass
// by player movement so continuous running never stacks geometry + shadow work.
replaceRegexOnce(
  /function\s+StaticShadowMap\s*\(\s*\{\s*revision\s*\}\s*:\s*\{\s*revision\s*:\s*MapView\s*\}\s*\)\s*\{[\s\S]*?return\s+null\s*;\s*\n\}/g,
  `function StaticShadowMap({
  revision,
  movementKey,
}: {
  revision: MapView;
  movementKey: string;
}) {
  const { gl } = useThree();
  useEffect(() => {
    // TIBIAGAME_STREAMING_FIX_V3_1
    // A tile movement changes movementKey and cancels this timer. The static
    // shadow map is refreshed only after movement has been quiet for 450 ms.
    const handle = window.setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
    }, 450);
    return () => window.clearTimeout(handle);
  }, [gl, revision, movementKey]);
  return null;
}`,
  "StaticShadowMap function",
);

replaceRegexOnce(
  /<StaticShadowMap\s+revision=\{region\.map\}\s*\/>/g,
  `<StaticShadowMap
        revision={region.map}
        movementKey={local ? \`\${local.position.x}:\${local.position.y}:\${local.position.z}\` : "none"}
      />`,
  "StaticShadowMap render usage",
);

if (CHECK_ONLY) {
  console.log("V3.1 compatibility check passed. No files were changed.");
  console.log(`  would patch ${path.relative(root, file)}`);
  process.exit(0);
}

const output = eol === "\n" ? text : text.replace(/\n/g, "\r\n");
fs.writeFileSync(file, output, "utf8");

console.log("Applied TibiaGame streaming stability fix V3.1.");
console.log(`Changed: ${path.relative(root, file)}`);
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm test");
console.log("  cargo test --workspace");
console.log("");
console.log("Then stress-test continuous movement, large-area boundaries and stairs.");
