#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--check') || process.argv.includes('--dry-run');
const SKIP_CHECKS = process.argv.includes('--skip-checks');
const EXPLICIT = process.argv.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));

const paths = {
  tauri: resolve(ROOT, 'apps/client/src-tauri/tauri.conf.json'),
  packageJson: resolve(ROOT, 'apps/client/package.json'),
  packageLock: resolve(ROOT, 'apps/client/package-lock.json'),
  cargoToml: resolve(ROOT, 'apps/client/src-tauri/Cargo.toml'),
  cargoLockRoot: resolve(ROOT, 'Cargo.lock'),
  cargoLockClient: resolve(ROOT, 'apps/client/src-tauri/Cargo.lock'),
};

function fail(message) {
  throw new Error(message);
}

function printable(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args = [], { capture = false } = {}) {
  console.log(`> ${printable(command, args)}`);

  let executable = command;
  let finalArgs = args;

  // npm on Windows is a .cmd shim. execFileSync cannot execute .cmd files
  // directly without cmd.exe, even though the same command works in PowerShell.
  if (process.platform === 'win32' && command.toLowerCase() === 'npm') {
    executable = process.env.ComSpec || 'cmd.exe';
    finalArgs = ['/d', '/s', '/c', ['npm', ...args].join(' ')];
  }

  try {
    const result = execFileSync(executable, finalArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    return capture ? (result ?? '').trim() : '';
  } catch (error) {
    if (capture) {
      const stdout = error?.stdout?.toString?.() ?? '';
      const stderr = error?.stderr?.toString?.() ?? '';
      if (stdout.trim()) console.error(stdout.trimEnd());
      if (stderr.trim()) console.error(stderr.trimEnd());
    }
    const code = error?.status ?? error?.code ?? 'unknown';
    fail(`Command failed (${code}): ${printable(command, args)}`);
  }
}

function capture(command, args = []) {
  return run(command, args, { capture: true });
}

function requireFile(path, label) {
  if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) fail(`Invalid semantic version: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersion(a, b) {
  const aa = parseVersion(a);
  const bb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
}

function maxVersion(versions) {
  const valid = versions.filter(Boolean);
  if (!valid.length) fail('Could not determine a client version.');
  return [...valid].sort(compareVersion).at(-1);
}

function bumpPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Could not parse JSON ${path}: ${error.message}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updateCargoToml(path, nextVersion) {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/(\[package\][\s\S]*?\nversion\s*=\s*")(\d+\.\d+\.\d+)(")/);
  if (!match) fail('Could not find [package] version in apps/client/src-tauri/Cargo.toml');
  writeFileSync(path, source.replace(match[0], `${match[1]}${nextVersion}${match[3]}`), 'utf8');
}

function updateCargoLock(path, nextVersion) {
  if (!existsSync(path)) return false;
  const source = readFileSync(path, 'utf8');
  const pattern = /(\[\[package\]\]\s*\nname\s*=\s*"aldoria-client"\s*\nversion\s*=\s*")(\d+\.\d+\.\d+)(")/m;
  if (!pattern.test(source)) return false;
  writeFileSync(path, source.replace(pattern, `$1${nextVersion}$3`), 'utf8');
  return true;
}

function restoreFiles(backups) {
  for (const [path, content] of backups) writeFileSync(path, content, 'utf8');
}

function committedTauriVersion() {
  const raw = capture('git', ['show', 'HEAD:apps/client/src-tauri/tauri.conf.json']);
  try {
    return JSON.parse(raw).version;
  } catch (error) {
    fail(`Could not read committed Tauri version from HEAD: ${error.message}`);
  }
}

function localReleaseTags() {
  const text = capture('git', ['tag', '--list', 'client-v*']);
  return text
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.replace(/^client-v/, ''))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
}

async function main() {
  console.log('\nEmbers of Aldoria - automatic client release\n');

  for (const [key, path] of Object.entries(paths)) {
    if (['cargoLockRoot', 'cargoLockClient'].includes(key)) continue;
    requireFile(path, key);
  }

  const repoRoot = capture('git', ['rev-parse', '--show-toplevel']);
  if (resolve(repoRoot) !== resolve(ROOT)) {
    fail(`Run this script from the repository root. Git root is: ${repoRoot}`);
  }

  const branch = capture('git', ['branch', '--show-current']);
  if (branch !== 'main') fail(`Releases must be created from main. Current branch is '${branch}'.`);

  const remotes = capture('git', ['remote']);
  if (!remotes.split(/\r?\n/).includes('origin')) fail("Git remote 'origin' is missing.");

  // Avoid changing an index the user already prepared manually. Unstaged work is fine;
  // it is deliberately included in the release after all checks pass.
  const initiallyStaged = capture('git', ['diff', '--cached', '--name-only']);
  if (initiallyStaged) {
    fail('There are already staged files. Commit or unstage them before running the automatic release script.');
  }

  console.log('Fetching latest main and release tags...');
  run('git', ['fetch', 'origin', 'main', '--tags']);

  console.log('Synchronizing local main with origin/main...');
  run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);

  const tauri = readJson(paths.tauri);
  const packageJson = readJson(paths.packageJson);
  const packageLock = readJson(paths.packageLock);
  const committedVersion = committedTauriVersion();
  const tagVersions = localReleaseTags();
  const highestPublishedOrCommitted = maxVersion([committedVersion, ...tagVersions]);
  const automaticNext = bumpPatch(highestPublishedOrCommitted);
  const nextVersion = EXPLICIT ?? automaticNext;
  const tagName = `client-v${nextVersion}`;

  parseVersion(tauri.version);
  parseVersion(packageJson.version);
  parseVersion(packageLock.version);
  if (packageLock.packages?.['']?.version) parseVersion(packageLock.packages[''].version);

  if (compareVersion(nextVersion, highestPublishedOrCommitted) <= 0) {
    fail(`Requested version ${nextVersion} must be newer than committed/tagged version ${highestPublishedOrCommitted}.`);
  }

  const existingTag = capture('git', ['tag', '--list', tagName]);
  if (existingTag) fail(`Tag ${tagName} already exists.`);

  // Recovery from the previous v1 script: if it already changed the working files
  // to automaticNext but failed before commit/tag, keep that same version.
  if (
    !EXPLICIT &&
    compareVersion(tauri.version, committedVersion) !== 0 &&
    compareVersion(tauri.version, automaticNext) !== 0
  ) {
    fail(
      `Working Tauri version is ${tauri.version}, while HEAD is ${committedVersion} and the next automatic release is ${automaticNext}. ` +
      'Resolve the manual version change or pass an explicit X.Y.Z version.'
    );
  }

  console.log(`\nCommitted Tauri version : ${committedVersion}`);
  console.log(`Highest committed/tagged: ${highestPublishedOrCommitted}`);
  console.log(`Working Tauri version   : ${tauri.version}`);
  console.log(`Next release            : ${nextVersion}`);
  console.log(`Git tag                 : ${tagName}\n`);

  const backupPaths = [paths.tauri, paths.packageJson, paths.packageLock, paths.cargoToml];
  if (existsSync(paths.cargoLockRoot)) backupPaths.push(paths.cargoLockRoot);
  if (existsSync(paths.cargoLockClient)) backupPaths.push(paths.cargoLockClient);
  const backups = backupPaths.map((path) => [path, readFileSync(path, 'utf8')]);

  let commitCreated = false;

  try {
    tauri.version = nextVersion;
    packageJson.version = nextVersion;
    packageLock.version = nextVersion;
    if (!packageLock.packages?.['']) fail('package-lock.json is missing packages[""] metadata.');
    packageLock.packages[''].version = nextVersion;

    writeJson(paths.tauri, tauri);
    writeJson(paths.packageJson, packageJson);
    writeJson(paths.packageLock, packageLock);
    updateCargoToml(paths.cargoToml, nextVersion);
    updateCargoLock(paths.cargoLockRoot, nextVersion);
    updateCargoLock(paths.cargoLockClient, nextVersion);

    console.log('Version files synchronized.');
    run('git', ['diff', '--check']);

    if (!SKIP_CHECKS) {
      console.log('\nRunning release preflight checks...');
      run('npm', ['--prefix', 'apps/client', 'run', 'check']);
      run('cargo', ['check', '--manifest-path', 'apps/client/src-tauri/Cargo.toml', '--features', 'friend-updater']);
      run('git', ['diff', '--check']);
    } else {
      console.log('\nWARNING: --skip-checks was used. TypeScript/Rust preflight was skipped.');
    }

    if (DRY_RUN) {
      restoreFiles(backups);
      console.log('\nCHECK PASSED. No release was created and version files were restored.');
      console.log(`A normal run will create ${tagName}.\n`);
      return;
    }

    console.log('\nStaging the current working tree plus the version bump...');
    run('git', ['add', '-A']);

    const staged = capture('git', ['diff', '--cached', '--name-only']);
    if (!staged) fail('Nothing is staged for release.');

    console.log('\nFiles included in this release:');
    for (const file of staged.split(/\r?\n/).filter(Boolean)) console.log(`  - ${file}`);

    run('git', ['commit', '-m', `Release client v${nextVersion}`]);
    commitCreated = true;

    run('git', ['tag', '-a', tagName, '-m', `Embers of Aldoria v${nextVersion}`]);

    console.log('\nPushing main and the release tag atomically...');
    run('git', ['push', '--atomic', 'origin', 'main', tagName]);

    console.log('\n==============================================');
    console.log(`Release ${tagName} has been triggered.`);
    console.log('GitHub Actions will build, sign and publish the updater assets.');
    console.log('Actions:  https://github.com/Ghilea/tibiaCloneGame/actions');
    console.log('Releases: https://github.com/Ghilea/tibiaCloneGame/releases');
    console.log('==============================================\n');
  } catch (error) {
    if (!commitCreated) {
      // Nothing has been committed yet. Remove anything this script staged and
      // put version files back exactly as they were when this run started.
      try { run('git', ['reset']); } catch {}
      restoreFiles(backups);
      console.error('\nRelease was NOT created. Version files were restored to their pre-run state.');
    } else {
      console.error('\nA release commit was created locally, but a later step failed. Do not create a second version yet.');
      console.error(`Local release target: ${tagName}`);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}\n`);
  process.exitCode = 1;
});
