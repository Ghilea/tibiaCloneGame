#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const players = Number(args.get("players") ?? 100);
const duration = args.get("duration") ?? "60";
const anonymous = args.has("anonymous");
const verbose = args.has("verbose");
const wsUrl = args.get("url") ?? "ws://127.0.0.1:4000/ws";
const apiUrl = args.get("api") ?? "http://127.0.0.1:4000/api";
const accountsFile = ".load-test-accounts.json";
const serverEnv = { ...process.env };
if (anonymous) serverEnv.DATABASE_URL = "";
else if (!serverEnv.DATABASE_URL) delete serverEnv.DATABASE_URL;

if (!Number.isInteger(players) || players < 1 || players > 10_000) throw new Error("--players must be between 1 and 10000");

const server = spawn("cargo", ["run", "-p", "game-server"], {
  cwd: process.cwd(),
  env: serverEnv,
  stdio: verbose ? "inherit" : ["ignore", "ignore", "ignore"],
});

try {
  await waitForHealth(apiUrl.replace(/\/api\/?$/, "") + "/health");
  if (!anonymous) {
    await run(process.execPath, ["scripts/create-load-test-accounts.mjs", `--players=${players}`, `--output=${accountsFile}`, `--api=${apiUrl}`]);
  }
  const testArgs = ["scripts/load-test.mjs", `--players=${players}`, `--duration=${duration}`, `--url=${wsUrl}`];
  if (!anonymous) testArgs.push(`--accounts=${accountsFile}`);
  await run(process.execPath, testArgs);
} finally {
  await rm(accountsFile, { force: true });
  await stopProcess(server);
}

async function waitForHealth(url) {
  process.stdout.write(`Waiting for server health at ${url}`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        console.log(" ready");
        return;
      }
    } catch { /* server is still starting */ }
    process.stdout.write(".");
    await delay(1_000);
  }
  throw new Error("Server did not become healthy within 60 seconds");
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
}
