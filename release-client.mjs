#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const dryRun = process.argv.includes("--check") || process.argv.includes("--dry-run");
const skipChecks = process.argv.includes("--skip-checks");
const explicit = process.argv.find((argument) => /^\d+\.\d+\.\d+$/.test(argument));
const releasePath = "crates/game-client/release.json";

function run(command, args = [], capture = false) {
  const executable = process.platform === "win32" && command === "npm"
    ? process.env.ComSpec || "cmd.exe"
    : command;
  const finalArgs = executable === command ? args : ["/d", "/s", "/c", [command, ...args].join(" ")];
  return (execFileSync(executable, finalArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  }) ?? "").trim();
}

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid client version '${version}'.`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const a = parts(left);
  const b = parts(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function nextPatch(version) {
  const [major, minor, patch] = parts(version);
  return `${major}.${minor}.${patch + 1}`;
}

const release = JSON.parse(readFileSync(releasePath, "utf8"));
parts(release.version);
const versions = run("git", ["tag", "--list", "client-v*"], true)
  .split(/\r?\n/)
  .map((tag) => tag.replace(/^client-v/, ""))
  .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
const baseline = [...versions, release.version].sort(compare).at(-1);
const version = explicit ?? nextPatch(baseline);
if (compare(version, baseline) <= 0) throw new Error(`Release ${version} must be newer than ${baseline}.`);
const tag = `client-v${version}`;

if (run("git", ["diff", "--cached", "--name-only"], true)) {
  throw new Error("The git index already contains staged files.");
}

release.version = version;
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");

try {
  run("git", ["diff", "--check"]);
  if (!skipChecks) {
    run("cargo", ["check", "-p", "game-client", "--bin", "game-client"]);
    run("npm", ["--prefix", "apps/world-editor", "run", "check"]);
  }
  if (dryRun) {
    release.version = baseline;
    writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
    console.log(`Release preflight passed. A normal run will create ${tag}.`);
    process.exit(0);
  }

  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", `Release native client v${version}`]);
  run("git", ["tag", "-a", tag, "-m", `Embers of Aldoria native v${version}`]);
  run("git", ["push", "--atomic", "origin", "main", tag]);
  console.log(`Published ${tag}; GitHub Actions will build the self-contained native package.`);
} catch (error) {
  if (dryRun) {
    release.version = baseline;
    writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
  }
  throw error;
}
