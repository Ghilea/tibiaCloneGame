#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueAfter = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(valueAfter('--repo') ?? process.cwd());
const packageRoot = path.resolve(valueAfter('--package-root') ?? scriptDir);
const dryRun = flag('--dry-run');
const skipChecks = flag('--skip-checks');
const force = flag('--force');
const PACK_ID = 'aldoria-item-restyle-v3';
const backupRoot = path.join(repoRoot, '.aldoria-content-backups');
const standaloneSpriteIds = new Set(["copper_ore", "mire_fiber", "bog_ichor", "gold_coin", "reed_hide", "fen_tusk", "field_bread", "smoked_mire_meat", "field_backpack", "ember_sigil_formula", "iron_pickaxe", "wooden_buckler", "worn_cap", "patched_tunic", "frayed_trousers", "work_boots", "mireling_remains", "mire_skulker_remains", "reed_stalker_remains", "fen_brute_remains", "castle_rat_remains", "crypt_guard_remains", "bone_acolyte_remains", "cellar_warden_remains"]);

function fail(message) {
  console.error(`\n[${PACK_ID}] ERROR: ${message}`);
  process.exit(1);
}

function assertRepo() {
  const required = [
    'package.json',
    'Cargo.toml',
    'content/items/items.json',
    'apps/client/src/App.tsx',
  ];
  for (const relative of required) {
    if (!fs.existsSync(path.join(repoRoot, relative))) {
      fail(`Run the installer from the tibiaCloneGame repository root. Missing ${relative}`);
    }
  }
  for (const id of standaloneSpriteIds) {
    const sprite = path.join(packageRoot, 'sprites', `${id}.png`);
    if (!fs.existsSync(sprite)) fail(`Missing sprite payload: ${sprite}`);
  }
}

function normalizeText(buffer) {
  const raw = buffer.toString('utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { text: raw.replace(/\r\n/g, '\n'), eol };
}
function denormalizeText(text, eol) {
  return Buffer.from(eol === '\n' ? text : text.replace(/\n/g, '\r\n'), 'utf8');
}

const staged = new Map();

function stageText(relative, transform) {
  const target = path.join(repoRoot, relative);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const { text, eol } = original ? normalizeText(original) : { text: '', eol: '\n' };
  const nextText = transform(text);
  const updated = denormalizeText(nextText, eol);
  if (!original || !original.equals(updated)) staged.set(relative, { original, updated });
}

function stageCopy(source, targetRelative) {
  const updated = fs.readFileSync(source);
  const target = path.join(repoRoot, targetRelative);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (!original || !original.equals(updated)) staged.set(targetRelative, { original, updated });
}

function patchAppTsx(text) {
  const setPattern = /const standaloneItemSpriteIds = new Set\(\[([\s\S]*?)\]\);/m;
  const fnPattern = /function ItemIcon\(\{ definitionId \}: \{ definitionId: string \}\) \{/m;

  if (setPattern.test(text)) {
    const match = text.match(setPattern);
    const ids = [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
    const merged = [...new Set([...ids, ...standaloneSpriteIds])];
    return text.replace(setPattern, `const standaloneItemSpriteIds = new Set([${merged.map((id) => `"${id}"`).join(', ')}]);`);
  }

  const marker = 'function ItemIcon({ definitionId }: { definitionId: string }) {';
  const index = text.indexOf(marker);
  if (index < 0) fail('Could not find ItemIcon in apps/client/src/App.tsx');

  const insertion = `const standaloneItemSpriteIds = new Set([${[...standaloneSpriteIds].map((id) => `"${id}"`).join(', ')}]);\nfunction ItemIcon({ definitionId }: { definitionId: string }) {\n  if (standaloneItemSpriteIds.has(definitionId)) return <i className="item-icon" style={ backgroundImage: \`url('/assets/sprites/items/${definitionId}.png')\`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" } />;`;
  return text.slice(0, index) + insertion + text.slice(index + marker.length);
}

function stageAll() {
  stageText('apps/client/src/App.tsx', patchAppTsx);
  for (const id of standaloneSpriteIds) {
    stageCopy(path.join(packageRoot, 'sprites', `${id}.png`), `apps/client/public/assets/sprites/items/${id}.png`);
  }
}

function backupTimestamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function createBackup() {
  fs.mkdirSync(backupRoot, { recursive: true });
  let backupDir = path.join(backupRoot, backupTimestamp());
  let suffix = 1;
  while (fs.existsSync(backupDir)) backupDir = path.join(backupRoot, `${backupTimestamp()}-${suffix++}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const created = [];
  const backedUp = [];
  for (const [relative, change] of staged) {
    if (change.original === null) created.push(relative);
    else {
      backedUp.push(relative);
      const backupPath = path.join(backupDir, relative);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, change.original);
    }
  }
  const manifest = { pack: PACK_ID, createdAt: new Date().toISOString(), created, backedUp };
  fs.writeFileSync(path.join(backupDir, 'backup.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { backupDir, manifest };
}

function restoreBackup(backupDir, manifest) {
  console.error(`\n[${PACK_ID}] Validation failed. Restoring ${path.basename(backupDir)} automatically...`);
  for (const relative of manifest.created) {
    const target = path.join(repoRoot, relative);
    try { fs.rmSync(target, { force: true, recursive: false }); } catch {}
  }
  for (const relative of manifest.backedUp) {
    const source = path.join(backupDir, relative);
    const target = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function atomicWrite(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, target);
}

function runCheck(command, args) {
  let result;
  if (process.platform === 'win32' && command === 'npm') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    result = spawnSync(comspec, ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')], { cwd: repoRoot, encoding: 'utf8' });
  } else {
    result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const rendered = [command, ...args].join(' ');
    fail(`Command failed: ${rendered} (exit ${result.status ?? 'unknown'})`);
  }
}

assertRepo();
stageAll();

if (!staged.size) {
  console.log(`[${PACK_ID}] No changes were necessary.`);
  process.exit(0);
}

console.log(`[${PACK_ID}] Will change ${staged.size} files:`);
for (const relative of staged.keys()) console.log(`  - ${relative}`);

if (dryRun) {
  console.log(`\n[${PACK_ID}] Dry run only. No files were written.`);
  process.exit(0);
}

const { backupDir, manifest } = createBackup();
for (const [relative, change] of staged) {
  atomicWrite(path.join(repoRoot, relative), change.updated);
}

if (!skipChecks) {
  try {
    console.log(`\n[${PACK_ID}] Running npm run check...\n`);
    runCheck('npm', ['run', 'check']);
    console.log(`\n[${PACK_ID}] Running cargo check --workspace...\n`);
    runCheck('cargo', ['check', '--workspace']);
  } catch (error) {
    restoreBackup(backupDir, manifest);
    fail('Validation failed and the project was automatically restored. The backup was kept for inspection.');
  }
}

console.log(`\n[${PACK_ID}] Installed successfully. Backup: ${backupDir}`);
