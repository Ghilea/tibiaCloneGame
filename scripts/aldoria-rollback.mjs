#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const backupRoot = path.join(repoRoot, '.aldoria-content-backups');
if (!fs.existsSync(backupRoot)) {
  console.error('No .aldoria-content-backups directory found.');
  process.exit(1);
}
const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(backupRoot, entry.name, 'backup.json')))
  .map((entry) => entry.name)
  .sort()
  .reverse();
if (!backups.length) {
  console.error('No Aldoria backups found.');
  process.exit(1);
}
const backupDir = path.join(backupRoot, backups[0]);
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup.json'), 'utf8'));
const created = Array.isArray(manifest.created) ? manifest.created : [];
const backedUp = Array.isArray(manifest.backedUp) ? manifest.backedUp : [];
for (const relative of created) {
  fs.rmSync(path.join(repoRoot, relative), { force: true });
}
for (const relative of backedUp) {
  const source = path.join(backupDir, relative);
  const target = path.join(repoRoot, relative);
  if (!fs.existsSync(source)) {
    console.error(`Backup is incomplete. Missing ${relative}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
manifest.rolledBackAt = new Date().toISOString();
fs.writeFileSync(path.join(backupDir, 'backup.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Restored backup ${backups[0]}.`);
