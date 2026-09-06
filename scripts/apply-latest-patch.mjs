#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const explicitArg = args.find((arg) => !arg.startsWith("--")) ?? null;
const packagePath = join(root, "package.json");

function fail(message) {
  console.error("\nPATCH FAILED: " + message);
  process.exit(1);
}

if (
  !existsSync(packagePath)
  || !existsSync(join(root, "apps/client/src/App.tsx"))
) {
  fail("Run this command from the tibiaCloneGame repository root.");
}

function parsePatchVersion(name) {
  const match = /^apply-tibiagame-v(\d+)\.(\d+)(?:\.(\d+))?.*\.mjs$/i.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersion(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function versionText(version) {
  return version[2] ? version.join(".") : version.slice(0, 2).join(".");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function statePath() {
  const gitDir = join(root, ".git");
  return existsSync(gitDir)
    ? join(gitDir, "tibiagame-patch-runner-state.json")
    : join(root, ".tibiagame-patch-runner-state.json");
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { highestAppliedVersion: [0, 0, 0], applied: {} };
  }
}

function saveState(state) {
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function discoverPatch() {
  if (explicitArg) {
    const path = resolve(root, explicitArg);
    if (!existsSync(path)) fail("Patch file not found: " + explicitArg);
    const version = parsePatchVersion(basename(path));
    if (!version) {
      fail("Patch filename must look like apply-tibiagame-v35.4-description.mjs");
    }
    return { path, name: basename(path), version };
  }

  const state = loadState();
  const highestApplied = Array.isArray(state.highestAppliedVersion)
    ? state.highestAppliedVersion
    : [0, 0, 0];

  const candidates = readdirSync(root)
    .map((name) => ({ name, version: parsePatchVersion(name) }))
    .filter((entry) => entry.version)
    .map((entry) => ({
      ...entry,
      path: join(root, entry.name),
    }))
    .filter((entry) => {
      if (compareVersion(entry.version, highestApplied) > 0) return true;
      const hash = sha256(entry.path);
      return !state.applied?.[entry.name] && compareVersion(entry.version, highestApplied) === 0;
    })
    .sort((left, right) => compareVersion(right.version, left.version));

  if (candidates.length === 0) {
    const found = readdirSync(root)
      .filter((name) => parsePatchVersion(name))
      .sort();
    if (found.length > 0) {
      fail(
        "No newer unapplied patch found. Put the new apply-tibiagame-v*.mjs file in the repo root."
      );
    }
    fail("No apply-tibiagame-v*.mjs patch found in the repo root.");
  }

  return candidates[0];
}

// TIBIAGAME_PATCH_RUNNER_V1_1_WINDOWS_CMD
function commandInvocation(command, commandArgs) {
  if (
    process.platform === "win32"
    && (command.toLowerCase() === "npm" || command.toLowerCase() === "npx")
  ) {
    const shell = process.env.ComSpec || "cmd.exe";
    return {
      executable: shell,
      args: ["/d", "/s", "/c", [command, ...commandArgs].join(" ")],
    };
  }

  return { executable: command, args: commandArgs };
}

function run(command, commandArgs, label) {
  console.log("\n> " + command + " " + commandArgs.join(" "));
  const invocation = commandInvocation(command, commandArgs);

  try {
    execFileSync(invocation.executable, invocation.args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: false,
    });
  } catch (error) {
    const detail =
      error && typeof error === "object"
        ? [
            "code" in error && error.code ? "code=" + error.code : "",
            "errno" in error && error.errno ? "errno=" + error.errno : "",
            "syscall" in error && error.syscall ? "syscall=" + error.syscall : "",
          ].filter(Boolean).join(" · ")
        : "";

    fail(
      label
      + " failed."
      + (detail ? " (" + detail + ")" : "")
      + " No later validation steps were run.",
    );
  }
}

const patch = discoverPatch();
const source = readFileSync(patch.path, "utf8");

console.log("TibiaGame patch runner");
console.log("----------------------");
console.log("Patch:   " + patch.name);
console.log("Version: " + versionText(patch.version));
console.log("Mode:    " + (checkOnly ? "check only" : "check + apply + validate"));

run(process.execPath, ["--check", patch.path], "Patch JavaScript syntax check");
run(process.execPath, [patch.path, "--check"], "Patch precheck");

if (checkOnly) {
  console.log("\nPATCH PRECHECK PASSED");
  console.log("No files were changed by the runner.");
  process.exit(0);
}

run(process.execPath, [patch.path], "Patch apply");

console.log("\nValidating changed code...");

const touchesClient = source.includes("apps/client/");
const touchesGameServer =
  source.includes("crates/game-server/") || source.includes("database/migrations/");
const touchesGameTypes = source.includes("crates/game-types/");
const touchesTauri = source.includes("apps/client/src-tauri/");

if (touchesClient) {
  run("npm", ["--prefix", "apps/client", "run", "check"], "Client TypeScript check");
}
if (touchesGameTypes) {
  run("cargo", ["check", "-p", "game-types"], "game-types cargo check");
}
if (touchesGameServer) {
  run("cargo", ["check", "-p", "game-server"], "game-server cargo check");
}
if (touchesTauri) {
  run(
    "cargo",
    ["check", "--manifest-path", "apps/client/src-tauri/Cargo.toml"],
    "Tauri cargo check"
  );
}

run("git", ["diff", "--check"], "git diff --check");

const state = loadState();
state.applied ??= {};
state.applied[patch.name] = {
  version: patch.version,
  sha256: sha256(patch.path),
  appliedAt: new Date().toISOString(),
};
if (
  !Array.isArray(state.highestAppliedVersion)
  || compareVersion(patch.version, state.highestAppliedVersion) > 0
) {
  state.highestAppliedVersion = patch.version;
}
saveState(state);

console.log("\nPATCH APPLIED AND VALIDATED");
console.log("Patch: " + patch.name);
console.log("\nCurrent Git changes:");
run("git", ["status", "--short"], "git status");
