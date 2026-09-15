import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetRoot = process.env.ALDORIA_ASSET_ROOT?.trim()
  ? path.resolve(process.env.ALDORIA_ASSET_ROOT.trim())
  : path.join(root, 'assets');
const actorsRoot = path.join(assetRoot, 'actors');
const supportedAnimations = new Set(['idle', 'walk', 'attack', 'hit', 'death', 'cast', 'use']);
const errors = [];
const actorIds = new Map();

function fail(message) {
  errors.push(message);
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function safeAssetPath(value, owner) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${owner}: asset path must be a non-empty string`);
    return null;
  }
  if (value.includes('\\') || path.isAbsolute(value)) {
    fail(`${owner}: asset path must be relative and use forward slashes: ${value}`);
    return null;
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail(`${owner}: unsafe asset path: ${value}`);
    return null;
  }
  const resolved = path.join(assetRoot, ...parts);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    fail(`${owner}: referenced file does not exist: ${value}`);
    return null;
  }
  return resolved;
}

function pngDimensions(file, owner) {
  const buffer = fs.readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    fail(`${owner}: invalid PNG: ${relative(file)}`);
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateAtlas(assetPath, columns, rows, frameWidth, frameHeight, owner) {
  const file = safeAssetPath(assetPath, owner);
  if (!file) return;
  if (path.extname(file).toLowerCase() !== '.png') return;
  const dimensions = pngDimensions(file, owner);
  if (!dimensions) return;
  const expectedWidth = columns * frameWidth;
  const expectedHeight = rows * frameHeight;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    fail(
      `${owner}: ${assetPath} is ${dimensions.width}x${dimensions.height}; expected ` +
        `${expectedWidth}x${expectedHeight} (${columns} columns x ${rows} rows, frame ${frameWidth}x${frameHeight})`,
    );
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${relative(file)}: invalid JSON: ${error.message}`);
    return null;
  }
}

function validateActorManifest(file) {
  const owner = relative(file);
  const actor = readJson(file);
  if (!actor) return;

  if (actor.schema !== 1) fail(`${owner}: schema must be 1`);
  if (typeof actor.id !== 'string' || actor.id.trim() === '') fail(`${owner}: id is required`);
  else if (actorIds.has(actor.id)) fail(`${owner}: duplicate actor id '${actor.id}' also used by ${actorIds.get(actor.id)}`);
  else actorIds.set(actor.id, owner);

  if (![1, 4, 8].includes(actor.authored_directions)) {
    fail(`${owner}: authored_directions must be 1, 4 or 8`);
  }
  const minimumRows = actor.authored_directions === 1 ? 1 : 8;
  if (!Number.isInteger(actor.atlas_rows) || actor.atlas_rows < minimumRows) {
    fail(`${owner}: atlas_rows must be an integer >= ${minimumRows}`);
  }
  for (const [name, value] of [
    ['render_width', actor.render_width],
    ['render_height', actor.render_height],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(`${owner}: ${name} must be > 0`);
  }
  for (const [name, value] of [
    ['frame_width', actor.frame_width],
    ['frame_height', actor.frame_height],
  ]) {
    if (!Number.isInteger(value) || value <= 0) fail(`${owner}: ${name} must be a positive integer`);
  }

  if (!actor.animations || typeof actor.animations !== 'object' || Array.isArray(actor.animations)) {
    fail(`${owner}: animations object is required`);
    return;
  }
  if (!actor.animations.idle) fail(`${owner}: animations.idle is required`);

  for (const [name, animation] of Object.entries(actor.animations)) {
    const animationOwner = `${owner} animations.${name}`;
    if (!supportedAnimations.has(name)) {
      fail(`${animationOwner}: unsupported animation name`);
      continue;
    }
    if (!animation || typeof animation !== 'object' || Array.isArray(animation)) {
      fail(`${animationOwner}: must be an object`);
      continue;
    }
    if (!Number.isInteger(animation.columns) || animation.columns <= 0) fail(`${animationOwner}: columns must be > 0`);
    if (!Number.isInteger(animation.frames) || animation.frames <= 0) fail(`${animationOwner}: frames must be > 0`);
    if (animation.frames > animation.columns) fail(`${animationOwner}: frames cannot exceed columns`);
    if (typeof animation.fps !== 'number' || !Number.isFinite(animation.fps) || animation.fps <= 0) {
      fail(`${animationOwner}: fps must be > 0`);
    }
    for (const field of ['looping', 'lock_until_complete', 'terminal']) {
      if (typeof animation[field] !== 'boolean') fail(`${animationOwner}: ${field} must be boolean`);
    }
    if (animation.looping && (animation.lock_until_complete || animation.terminal)) {
      fail(`${animationOwner}: looping animations cannot be locked or terminal`);
    }
    if (animation.terminal && !animation.lock_until_complete) {
      fail(`${animationOwner}: terminal requires lock_until_complete=true`);
    }

    if (
      Number.isInteger(animation.columns) &&
      animation.columns > 0 &&
      Number.isInteger(actor.atlas_rows) &&
      actor.atlas_rows > 0 &&
      Number.isInteger(actor.frame_width) &&
      Number.isInteger(actor.frame_height)
    ) {
      validateAtlas(
        animation.texture,
        animation.columns,
        actor.atlas_rows,
        actor.frame_width,
        actor.frame_height,
        animationOwner,
      );
      if (animation.normal !== undefined && animation.normal !== null) {
        validateAtlas(
          animation.normal,
          animation.columns,
          actor.atlas_rows,
          actor.frame_width,
          actor.frame_height,
          `${animationOwner} normal`,
        );
      }
    }
  }
}

function validateCreatureIndex(file) {
  const owner = relative(file);
  const index = readJson(file);
  if (!index) return;
  if (index.schema !== 1) fail(`${owner}: schema must be 1`);
  if (!Array.isArray(index.actors)) {
    fail(`${owner}: actors must be an array`);
    return;
  }
  const gameIds = new Set();
  const manifests = new Set();
  for (const [position, entry] of index.actors.entries()) {
    const entryOwner = `${owner} actors[${position}]`;
    if (!entry || typeof entry !== 'object') {
      fail(`${entryOwner}: must be an object`);
      continue;
    }
    if (typeof entry.game_definition_id !== 'string' || entry.game_definition_id.trim() === '') {
      fail(`${entryOwner}: game_definition_id is required`);
    } else if (gameIds.has(entry.game_definition_id)) {
      fail(`${entryOwner}: duplicate game_definition_id '${entry.game_definition_id}'`);
    } else {
      gameIds.add(entry.game_definition_id);
    }
    if (typeof entry.manifest !== 'string' || entry.manifest.trim() === '') {
      fail(`${entryOwner}: manifest is required`);
      continue;
    }
    if (manifests.has(entry.manifest)) fail(`${entryOwner}: duplicate manifest '${entry.manifest}'`);
    manifests.add(entry.manifest);
    safeAssetPath(entry.manifest, entryOwner);
  }
}


// TIBIAGAME_V36_85_MIRE_CREATURE_EXPANSION
function validateCreatureIndexCoverage(file) {
  const index = readJson(file);
  if (!index || !Array.isArray(index.actors)) return;

  const indexed = new Set(
    index.actors
      .filter((entry) => entry && typeof entry.manifest === 'string')
      .map((entry) => entry.manifest),
  );

  const creatureRoot = path.join(actorsRoot, 'creatures');
  const creatureManifests = new Set(
    walk(creatureRoot)
      .filter((candidate) => path.basename(candidate) === 'actor.json')
      .map((candidate) => path.relative(assetRoot, candidate).replaceAll('\\', '/')),
  );

  for (const manifest of creatureManifests) {
    if (!indexed.has(manifest)) {
      fail(`assets/actors/creatures/index.json: creature manifest is not registered: ${manifest}`);
    }
  }

  for (const manifest of indexed) {
    if (!creatureManifests.has(manifest)) {
      fail(`assets/actors/creatures/index.json: registered manifest is not a creature actor.json: ${manifest}`);
    }
  }
}

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(full);
  }
  return output;
}

if (!fs.existsSync(actorsRoot)) {
  console.error(`ACTOR SPRITE VALIDATION FAILED: missing ${actorsRoot}`);
  process.exit(1);
}

const files = walk(actorsRoot);
const actorManifests = files.filter((file) => path.basename(file) === 'actor.json');
if (actorManifests.length === 0) fail('No actor.json manifests were found.');
for (const file of actorManifests) validateActorManifest(file);

const creatureIndex = path.join(actorsRoot, 'creatures', 'index.json');
if (!fs.existsSync(creatureIndex)) fail(`${relative(creatureIndex)} is missing`);
else {
  validateCreatureIndex(creatureIndex);
  validateCreatureIndexCoverage(creatureIndex);
}


// TIBIAGAME_V36_89_NPC_SERVICE_VARIANTS
const npcIndex = path.join(actorsRoot, 'npcs', 'index.json');
if (!fs.existsSync(npcIndex)) fail(relative(npcIndex) + ' is missing');
else validateCreatureIndex(npcIndex);


// TIBIAGAME_V36_90_PLAYER_EQUIPMENT_LAYERS
const playerEquipmentIndex = path.join(actorsRoot, 'players', 'equipment', 'index.json');
if (!fs.existsSync(playerEquipmentIndex)) fail(relative(playerEquipmentIndex) + ' is missing');
else validateCreatureIndex(playerEquipmentIndex);

if (errors.length > 0) {
  console.error('ACTOR SPRITE VALIDATION FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`ACTOR SPRITE VALIDATION PASSED · ${actorManifests.length} manifests · asset root ${assetRoot}`);
