import type { Position, TerrainMaterialId } from "../protocol";
import type { WorldState } from "./WorldState";

export const WORLD_MAP_ATLAS_CELL_SIZE = 4;
const ATLAS_VERSION = 1;
const CAPTURE_DEBOUNCE_MS = 900;

export type WorldMapAtlas = {
  updatedAt: number;
  cells: Map<string, number>;
};

type StoredAtlas = {
  v: number;
  updatedAt: number;
  cells: Record<string, number>;
};

type PendingCapture = {
  world: WorldState;
  playerId: string;
  discovered: ReadonlySet<string>;
};

let captureTimer: number | null = null;
let idleHandle: number | null = null;
let pendingCapture: PendingCapture | null = null;

export const WORLD_MAP_PALETTE = [
  "#384833", // 0 grass/default
  "#554534", // 1 mud/earth
  "#806f54", // 2 road
  "#27576b", // 3 water
  "#896443", // 4 bridge/wood
  "#645c52", // 5 built floor
  "#4a504b", // 6 stone/wall
  "#344b36", // 7 marsh
  "#88754f", // 8 sandstone
  "#73563b", // 9 planks
  "#484a50", // 10 crypt
  "#795440", // 11 building
] as const;

export function atlasCellKey(z: number, cellX: number, cellY: number) {
  return `${z}:${cellX}:${cellY}`;
}

export function parseAtlasCellKey(key: string) {
  const [z, cellX, cellY] = key.split(":").map(Number);
  if (![z, cellX, cellY].every(Number.isFinite)) return null;
  return { z, cellX, cellY };
}

function storageKey(playerId: string) {
  return `aldoria.worldmap-atlas.${playerId}`;
}

export function loadWorldMapAtlas(playerId: string): WorldMapAtlas {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(playerId)) ?? "null") as StoredAtlas | null;
    if (!parsed || parsed.v !== ATLAS_VERSION || !parsed.cells || typeof parsed.cells !== "object") {
      return { updatedAt: 0, cells: new Map() };
    }
    const cells = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed.cells)) {
      if (typeof value === "number" && value >= 0 && value < WORLD_MAP_PALETTE.length) {
        cells.set(key, value);
      }
    }
    return { updatedAt: parsed.updatedAt || 0, cells };
  } catch {
    return { updatedAt: 0, cells: new Map() };
  }
}

function saveWorldMapAtlas(playerId: string, atlas: WorldMapAtlas) {
  try {
    const cells: Record<string, number> = {};
    for (const [key, value] of atlas.cells) cells[key] = value;
    const payload: StoredAtlas = {
      v: ATLAS_VERSION,
      updatedAt: Date.now(),
      cells,
    };
    localStorage.setItem(storageKey(playerId), JSON.stringify(payload));
  } catch {
    // The atlas is a client-side exploration cache. Failure must never block gameplay.
  }
}

function discoveryKey(position: Position) {
  return `${position.z}:${Math.floor(position.x / WORLD_MAP_ATLAS_CELL_SIZE)}:${Math.floor(position.y / WORLD_MAP_ATLAS_CELL_SIZE)}`;
}

function terrainPalette(material: TerrainMaterialId) {
  switch (material) {
    case "mud":
    case "packed_earth":
    case "ash_soil":
      return 1;
    case "marsh_grass":
      return 7;
    case "sandstone":
      return 8;
    case "wood_planks":
      return 9;
    case "crypt_stone":
      return 10;
    case "moss_stone":
    case "gravel":
    default:
      return 6;
  }
}

function captureNow({ world, playerId, discovered }: PendingCapture) {
  const map = world.map;
  const center = world.streamRegionCenter;
  if (!map || !center || discovered.size === 0) return;

  const atlas = loadWorldMapAtlas(playerId);
  const cells = atlas.cells;
  const radius = Math.max(16, world.streamRegionRadius || 64);
  const floorRadius = Math.max(0, world.streamRegionFloorRadius || 0);

  const minCellX = Math.floor((center.x - radius - 2) / WORLD_MAP_ATLAS_CELL_SIZE);
  const maxCellX = Math.floor((center.x + radius + 2) / WORLD_MAP_ATLAS_CELL_SIZE);
  const minCellY = Math.floor((center.y - radius - 2) / WORLD_MAP_ATLAS_CELL_SIZE);
  const maxCellY = Math.floor((center.y + radius + 2) / WORLD_MAP_ATLAS_CELL_SIZE);

  // Start with a cheap neutral chart cell only for chunks the player has actually discovered.
  for (let z = center.z - floorRadius; z <= center.z + floorRadius; z += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const key = atlasCellKey(z, cellX, cellY);
        if (discovered.has(key) && !cells.has(key)) cells.set(key, 0);
      }
    }
  }

  const paint = (position: Position, palette: number) => {
    const key = discoveryKey(position);
    if (!discovered.has(key)) return;
    cells.set(key, palette);
  };

  for (const entry of map.terrainMaterials) paint(entry.position, terrainPalette(entry.material));
  for (const position of map.floors) paint(position, 5);
  for (const position of map.roads) paint(position, 2);
  for (const position of map.water) paint(position, 3);
  for (const position of map.bridges) paint(position, 4);
  for (const position of map.houseWalls) paint(position, 6);
  for (const position of map.castleWalls) paint(position, 6);

  // Buildings are sparse, so marking their coarse footprint is cheap and makes
  // towns remain visible after their streamed region is unloaded.
  for (const building of map.buildings) {
    const fromCellX = Math.floor(building.x / WORLD_MAP_ATLAS_CELL_SIZE);
    const toCellX = Math.floor((building.x + Math.max(0, building.width - 1)) / WORLD_MAP_ATLAS_CELL_SIZE);
    const fromCellY = Math.floor(building.y / WORLD_MAP_ATLAS_CELL_SIZE);
    const toCellY = Math.floor((building.y + Math.max(0, building.height - 1)) / WORLD_MAP_ATLAS_CELL_SIZE);
    for (let cellY = fromCellY; cellY <= toCellY; cellY += 1) {
      for (let cellX = fromCellX; cellX <= toCellX; cellX += 1) {
        const key = atlasCellKey(building.floor, cellX, cellY);
        if (discovered.has(key)) cells.set(key, 11);
      }
    }
  }

  saveWorldMapAtlas(playerId, { updatedAt: Date.now(), cells });
}

function cancelCapture() {
  if (captureTimer !== null) {
    window.clearTimeout(captureTimer);
    captureTimer = null;
  }
  if (idleHandle !== null) {
    const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
    if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
    else window.clearTimeout(idleHandle);
    idleHandle = null;
  }
}

export function queueWorldMapAtlasCapture(
  world: WorldState,
  playerId: string,
  discovered: ReadonlySet<string>,
) {
  pendingCapture = { world, playerId, discovered };
  if (captureTimer !== null) window.clearTimeout(captureTimer);

  captureTimer = window.setTimeout(() => {
    captureTimer = null;
    const run = () => {
      idleHandle = null;
      const next = pendingCapture;
      pendingCapture = null;
      if (next) captureNow(next);
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    idleHandle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(run, { timeout: 3_000 })
      : window.setTimeout(run, 0);
  }, CAPTURE_DEBOUNCE_MS);
}

export function flushWorldMapAtlasCapture() {
  const next = pendingCapture;
  pendingCapture = null;
  cancelCapture();
  if (next) captureNow(next);
}
