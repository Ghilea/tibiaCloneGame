#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const mode = process.argv[2] ?? "baseline";
// TIBIAGAME_V35_22_2_WINDOWS_SPAWN_FIX
const windowsCommandProcessor =
  process.env.ComSpec || process.env.COMSPEC || "cmd.exe";

if (process.platform !== "win32") {
  console.error("This diagnostic runner is Windows/WebView2-specific.");
  process.exit(1);
}

const FIXED_VERSION = "149.0.4022.98";
const CACHE_ROOT = path.join(ROOT, ".webview2-fixed");
const FIXED_ROOT = path.join(CACHE_ROOT, FIXED_VERSION);
const PACKAGE_PATH = path.join(CACHE_ROOT, `webview2-runtime-${FIXED_VERSION}.nupkg`);
const ZIP_PATH = path.join(CACHE_ROOT, `webview2-runtime-${FIXED_VERSION}.zip`);

function findFile(root, filename) {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === filename.toLowerCase()) return full;
    }
  }
  return null;
}

async function ensureFixed149() {
  const existingExe = findFile(FIXED_ROOT, "msedgewebview2.exe");
  if (existingExe) return path.dirname(existingExe);

  fs.mkdirSync(CACHE_ROOT, { recursive: true });

  if (!fs.existsSync(PACKAGE_PATH)) {
    const url =
      `https://www.nuget.org/api/v2/package/WebView2.Runtime.X64/${FIXED_VERSION}`;
    console.log(`Downloading WebView2 Fixed Runtime ${FIXED_VERSION} x64...`);
    console.log("This is a large one-time download.");

    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `WebView2 download failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(PACKAGE_PATH, data);
    console.log(`Downloaded ${(data.length / 1024 / 1024).toFixed(1)} MB.`);
  }

  fs.copyFileSync(PACKAGE_PATH, ZIP_PATH);
  fs.rmSync(FIXED_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXED_ROOT, { recursive: true });

  console.log("Extracting fixed runtime...");
  await new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${ZIP_PATH.replaceAll("'", "''")}' `
          + `-DestinationPath '${FIXED_ROOT.replaceAll("'", "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    ps.on("error", reject);
    ps.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`))
    );
  });

  const exe = findFile(FIXED_ROOT, "msedgewebview2.exe");
  if (!exe) {
    throw new Error(
      "Fixed runtime was extracted, but msedgewebview2.exe was not found.",
    );
  }
  return path.dirname(exe);
}

async function runDesktop(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };

  console.log("");
  console.log(`Starting desktop test: ${mode}`);
  if (env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER) {
    console.log(
      `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=${env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER}`,
    );
  }
  if (env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) {
    console.log(
      `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=${env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS}`,
    );
  }
  console.log("");

  const child = spawn(
    windowsCommandProcessor,
    [
      "/d",
      "/s",
      "/c",
      "npm --prefix apps/client run desktop",
    ],
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  child.on("error", (error) => {
    console.error("Failed to launch Tauri desktop test through cmd.exe:");
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (mode === "baseline") {
  await runDesktop();
} else if (mode === "novsync") {
  const current = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim();
  const args = [current, "--disable-gpu-vsync"].filter(Boolean).join(" ");
  console.warn(
    "DIAGNOSTIC ONLY: browser flag test, not a production setting.",
  );
  await runDesktop({ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: args });
} else if (mode === "fixed149") {
  console.warn(
    `DIAGNOSTIC ONLY: testing historical WebView2 ${FIXED_VERSION}.`,
  );
  const folder = await ensureFixed149();
  await runDesktop({ WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: folder });
} else {
  console.error("Unknown mode. Use: baseline | novsync | fixed149");
  process.exit(2);
}
