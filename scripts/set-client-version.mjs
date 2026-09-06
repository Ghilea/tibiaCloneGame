#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-client-version.mjs 0.1.1");
  process.exit(1);
}

const root = process.cwd();
const packagePath = path.join(root, "apps", "client", "package.json");
const tauriPath = path.join(root, "apps", "client", "src-tauri", "tauri.conf.json");
const cargoPath = path.join(root, "apps", "client", "src-tauri", "Cargo.toml");
const protocolPath = path.join(root, "apps", "client", "src", "protocol.ts");

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");

const tauriJson = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
tauriJson.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(tauriJson, null, 2) + "\n");

let cargo = fs.readFileSync(cargoPath, "utf8");
cargo = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  function (_match, prefix, suffix) {
    return prefix + version + suffix;
  },
);
fs.writeFileSync(cargoPath, cargo);

let protocol = fs.readFileSync(protocolPath, "utf8");
const clientVersionPattern = /export const CLIENT_VERSION = "[^"]+";/;
if (!clientVersionPattern.test(protocol)) {
  throw new Error("CLIENT_VERSION not found in apps/client/src/protocol.ts");
}
protocol = protocol.replace(
  clientVersionPattern,
  'export const CLIENT_VERSION = "' + version + '";',
);
fs.writeFileSync(protocolPath, protocol);

console.log("Aldoria client version set to " + version);
console.log("");
console.log("Next:");
console.log("  npm run check");
console.log("  npm run build");
console.log("  git add apps/client");
console.log('  git commit -m "Release friend client ' + version + '"');
console.log("  git tag client-v" + version);
console.log("  git push origin main client-v" + version);
