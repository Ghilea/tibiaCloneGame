#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-client-version.mjs 0.1.1");
  process.exit(1);
}

const root = process.cwd();
const releasePath = path.join(root, "crates", "game-client", "release.json");
const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
release.version = version;
fs.writeFileSync(releasePath, JSON.stringify(release, null, 2) + "\n");

console.log("Aldoria client version set to " + version);
console.log("");
console.log("Next:");
console.log("  npm run native:check");
console.log("  git add crates/game-client/release.json");
console.log('  git commit -m "Release friend client ' + version + '"');
console.log("  git tag client-v" + version);
console.log("  git push origin main client-v" + version);
