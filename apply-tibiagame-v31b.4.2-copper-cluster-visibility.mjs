import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "apps", "client", "src", "game", "NativeWorldRenderer.tsx");
const checkOnly = process.argv.includes("--check");

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`V31B.4.2 exact anchor not found: ${label}. No files were written.`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`V31B.4.2 anchor for ${label} is ambiguous. No files were written.`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

if (!fs.existsSync(target)) throw new Error(`Missing ${target}. Run from repo root.`);
const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");

if (text.includes("TIBIAGAME_NATIVE_RENDERER_V31_B_4_2")) {
  console.log("TibiaGame V31B.4.2 is already applied.");
  process.exit(0);
}

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_4_1",
  `data-native-world-renderer="v31b.4.1"`,
  "NATIVE WORLD V31B.4.1 active · copper rotation typing hotfix · raw Three.js",
  "(transform[6] ?? 0) + 0.3",
  `const resourceCopperGeometry = new THREE.OctahedronGeometry(0.2, 0);`,
]) {
  if (!text.includes(needle)) throw new Error(`V31B.4.2 expects installed V31B.4.1 baseline: missing ${needle}. No files were written.`);
}

text = replaceOnce(text, "// TIBIAGAME_NATIVE_RENDERER_V31_B_4_1\n", "// TIBIAGAME_NATIVE_RENDERER_V31_B_4_1\n// TIBIAGAME_NATIVE_RENDERER_V31_B_4_2\n", "version marker");
text = replaceOnce(text, "        if (renderAvailable) {\n          const pulse = gatheringActive\n            ? 1 + Math.sin(now * 0.014) * 0.08\n            : 1;\n          copper.push([\n            x - 0.18,\n            0.24,\n            z + 0.14,\n            0.74 * pulse,\n            1.08 * pulse,\n            0.74 * pulse,\n            (transform[6] ?? 0) + 0.3,\n          ]);\n          copper.push([\n            x + 0.22,\n            0.29,\n            z - 0.08,\n            0.62 * pulse,\n            0.94 * pulse,\n            0.62 * pulse,\n            (transform[6] ?? 0) + 1.4,\n          ]);\n          copper.push([\n            x + 0.05,\n            0.38,\n            z + 0.2,\n            0.54 * pulse,\n            0.86 * pulse,\n            0.54 * pulse,\n            (transform[6] ?? 0) + 2.25,\n          ]);\n        }\n", "        if (renderAvailable) {\n          const pulse = gatheringActive\n            ? 1 + Math.sin(now * 0.014) * 0.08\n            : 1;\n          const baseRotation = transform[6] ?? 0;\n          copper.push([\n            x - 0.26,\n            0.18,\n            z + 0.2,\n            0.82 * pulse,\n            1.22 * pulse,\n            0.82 * pulse,\n            baseRotation + 0.18,\n          ]);\n          copper.push([\n            x - 0.08,\n            0.3,\n            z + 0.1,\n            0.76 * pulse,\n            1.16 * pulse,\n            0.76 * pulse,\n            baseRotation + 0.62,\n          ]);\n          copper.push([\n            x + 0.18,\n            0.26,\n            z - 0.16,\n            0.74 * pulse,\n            1.08 * pulse,\n            0.74 * pulse,\n            baseRotation + 1.18,\n          ]);\n          copper.push([\n            x + 0.28,\n            0.22,\n            z + 0.02,\n            0.68 * pulse,\n            1.02 * pulse,\n            0.68 * pulse,\n            baseRotation + 1.54,\n          ]);\n          copper.push([\n            x + 0.08,\n            0.42,\n            z + 0.22,\n            0.66 * pulse,\n            1.02 * pulse,\n            0.66 * pulse,\n            baseRotation + 2.02,\n          ]);\n          copper.push([\n            x - 0.18,\n            0.44,\n            z - 0.06,\n            0.62 * pulse,\n            0.96 * pulse,\n            0.62 * pulse,\n            baseRotation + 2.36,\n          ]);\n          copper.push([\n            x + 0.02,\n            0.5,\n            z - 0.22,\n            0.58 * pulse,\n            0.92 * pulse,\n            0.58 * pulse,\n            baseRotation + 2.84,\n          ]);\n          copper.push([\n            x - 0.3,\n            0.28,\n            z - 0.18,\n            0.56 * pulse,\n            0.88 * pulse,\n            0.56 * pulse,\n            baseRotation + 3.18,\n          ]);\n          copper.push([\n            x + 0.24,\n            0.48,\n            z + 0.18,\n            0.52 * pulse,\n            0.84 * pulse,\n            0.52 * pulse,\n            baseRotation + 3.66,\n          ]);\n        }\n", "copper cluster block");
text = replaceOnce(text, "const resourceCopperGeometry = new THREE.OctahedronGeometry(0.2, 0);\n", "const resourceCopperGeometry = new THREE.OctahedronGeometry(0.25, 0);\n", "copper geometry size");
text = replaceOnce(text, "        data-native-world-renderer=\"v31b.4.1\"\n", "        data-native-world-renderer=\"v31b.4.2\"\n", "canvas version tag");
text = replaceOnce(text, "      \"NATIVE WORLD V31B.4.1 active \u00b7 copper rotation typing hotfix \u00b7 raw Three.js\",\n", "      \"NATIVE WORLD V31B.4.2 active \u00b7 larger copper clusters for vein readability \u00b7 raw Three.js\",\n", "console banner");

for (const needle of [
  "TIBIAGAME_NATIVE_RENDERER_V31_B_4_2",
  `data-native-world-renderer="v31b.4.2"`,
  "NATIVE WORLD V31B.4.2 active · larger copper clusters for vein readability · raw Three.js",
  "const baseRotation = transform[6] ?? 0;",
  `const resourceCopperGeometry = new THREE.OctahedronGeometry(0.25, 0);`,
]) {
  if (!text.includes(needle)) throw new Error(`V31B.4.2 safety check failed: missing ${needle}.`);
}

if (checkOnly) {
  console.log("V31B.4.2 compatibility check passed. No files were changed.");
  console.log("  V31B.4.1 baseline: found");
  console.log("  copper clusters increased from 3 to 9 protrusions");
  console.log("  copper crystal geometry enlarged from 0.20 to 0.25");
  console.log("  gather progress preview: preserved");
  process.exit(0);
}

fs.writeFileSync(target, eol === "\n" ? text : text.replace(/\n/g, "\r\n"), "utf8");
console.log("Applied TibiaGame V31B.4.2 larger copper cluster visibility fix.");
console.log("Changed:");
console.log("  apps/client/src/game/NativeWorldRenderer.tsx");
console.log("");
console.log("Run:");
console.log("  npm run check");
console.log("  npm run build");
