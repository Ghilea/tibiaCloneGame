import type { MapView, Position, TerrainMaterialId } from "../protocol";
import type { WorldState } from "./WorldState";

// TIBIAGAME_V35_13_4_WORLD_MAP_STUTTER_GUARD
export const WORLD_MAP_ATLAS_CELL_SIZE = 4;
const ATLAS_VERSION = 1;
const CAPTURE_DEBOUNCE_MS = 1_000;
const CAPTURE_SLICE_BUDGET_MS = 2.25;

export type WorldMapAtlas = {
  updatedAt: number;
  cells: Map<string, number>;
};

type StoredAtlas = {
  v: number;
  updatedAt: number;
  cells: Record<string, number>;
};

type AtlasCacheEntry = {
  atlas: WorldMapAtlas;
  dirty: boolean;
};

type PendingCapture = {
  world: WorldState;
  playerId: string;
  discovered: ReadonlySet<string>;
};

type CapturePhase =
  | "fill"
  | "terrain"
  | "floors"
  | "roads"
  | "water"
  | "bridges"
  | "houseWalls"
  | "castleWalls"
  | "buildings"
  | "done";

type CaptureJob = {
  playerId: string;
  discovered: ReadonlySet<string>;
  map: MapView;
  cells: Map<string, number>;
  center: Position;
  floorRadius: number;
  minCellX: number;
  maxCellX: number;
  minCellY: number;
  maxCellY: number;
  fillZ: number;
  fillCellX: number;
  fillCellY: number;
  phase: CapturePhase;
  index: number;
  buildingCellX: number | null;
  buildingCellY: number | null;
};

type IdleDeadlineLike = {
  timeRemaining?: () => number;
  didTimeout?: boolean;
};

const atlasCache = new Map<string, AtlasCacheEntry>();
let captureTimer: number | null = null;
let idleHandle: number | null = null;
let pendingCapture: PendingCapture | null = null;
let captureJob: CaptureJob | null = null;

export const WORLD_MAP_PALETTE = [
  "#384833",
  "#554534",
  "#806f54",
  "#27576b",
  "#896443",
  "#645c52",
  "#4a504b",
  "#344b36",
  "#88754f",
  "#73563b",
  "#484a50",
  "#795440",
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

function readStoredAtlas(playerId: string): WorldMapAtlas {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(playerId)) ?? "null",
    ) as StoredAtlas | null;

    if (
      !parsed
      || parsed.v !== ATLAS_VERSION
      || !parsed.cells
      || typeof parsed.cells !== "object"
    ) {
      return { updatedAt: 0, cells: new Map() };
    }

    const cells = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed.cells)) {
      if (
        typeof value === "number"
        && value >= 0
        && value < WORLD_MAP_PALETTE.length
      ) {
        cells.set(key, value);
      }
    }

    return {
      updatedAt: parsed.updatedAt || 0,
      cells,
    };
  } catch {
    return { updatedAt: 0, cells: new Map() };
  }
}

function cacheEntry(playerId: string) {
  let entry = atlasCache.get(playerId);
  if (!entry) {
    entry = {
      atlas: readStoredAtlas(playerId),
      dirty: false,
    };
    atlasCache.set(playerId, entry);
  }
  return entry;
}

export function loadWorldMapAtlas(playerId: string): WorldMapAtlas {
  // Parsing localStorage once per player/session is enough. Previous V35.13
  // reparsed the entire atlas for every background capture.
  return cacheEntry(playerId).atlas;
}

function persistAtlasEntry(playerId: string, entry: AtlasCacheEntry) {
  if (!entry.dirty) return;

  try {
    const cells: Record<string, number> = {};
    for (const [key, value] of entry.atlas.cells) cells[key] = value;

    const payload: StoredAtlas = {
      v: ATLAS_VERSION,
      updatedAt: Date.now(),
      cells,
    };

    localStorage.setItem(storageKey(playerId), JSON.stringify(payload));
    entry.atlas.updatedAt = payload.updatedAt;
    entry.dirty = false;
  } catch {
    // Persistence is a convenience cache. Never affect gameplay.
  }
}

function persistAllDirtyAtlases() {
  // Deliberately only called while leaving/hiding the game. localStorage and
  // JSON.stringify are synchronous and must not steal frames during gameplay.
  for (const [playerId, entry] of atlasCache) {
    persistAtlasEntry(playerId, entry);
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

function paint(
  job: CaptureJob,
  position: Position,
  palette: number,
) {
  const key = discoveryKey(position);
  if (!job.discovered.has(key)) return false;

  const previous = job.cells.get(key);
  if (previous === palette) return false;

  job.cells.set(key, palette);
  return true;
}

function beginCapture(next: PendingCapture) {
  const map = next.world.map;
  const center = next.world.streamRegionCenter;
  if (!map || !center || next.discovered.size === 0) return;

  const entry = cacheEntry(next.playerId);
  const radius = Math.max(16, next.world.streamRegionRadius || 64);
  const floorRadius = Math.max(0, next.world.streamRegionFloorRadius || 0);

  const minCellX = Math.floor(
    (center.x - radius - 2) / WORLD_MAP_ATLAS_CELL_SIZE,
  );
  const maxCellX = Math.floor(
    (center.x + radius + 2) / WORLD_MAP_ATLAS_CELL_SIZE,
  );
  const minCellY = Math.floor(
    (center.y - radius - 2) / WORLD_MAP_ATLAS_CELL_SIZE,
  );
  const maxCellY = Math.floor(
    (center.y + radius + 2) / WORLD_MAP_ATLAS_CELL_SIZE,
  );

  captureJob = {
    playerId: next.playerId,
    discovered: next.discovered,
    map,
    cells: entry.atlas.cells,
    center: { ...center },
    floorRadius,
    minCellX,
    maxCellX,
    minCellY,
    maxCellY,
    fillZ: center.z - floorRadius,
    fillCellX: minCellX,
    fillCellY: minCellY,
    phase: "fill",
    index: 0,
    buildingCellX: null,
    buildingCellY: null,
  };

  scheduleCaptureSlice();
}

function markDirty(playerId: string) {
  cacheEntry(playerId).dirty = true;
}

function nextArrayPhase(
  job: CaptureJob,
  values: readonly Position[],
  palette: number,
  nextPhase: CapturePhase,
) {
  if (job.index >= values.length) {
    job.index = 0;
    job.phase = nextPhase;
    return false;
  }

  if (paint(job, values[job.index], palette)) markDirty(job.playerId);
  job.index += 1;
  return true;
}

function processOne(job: CaptureJob) {
  if (job.phase === "fill") {
    if (job.fillZ > job.center.z + job.floorRadius) {
      job.phase = "terrain";
      job.index = 0;
      return true;
    }

    const key = atlasCellKey(job.fillZ, job.fillCellX, job.fillCellY);
    if (job.discovered.has(key) && !job.cells.has(key)) {
      job.cells.set(key, 0);
      markDirty(job.playerId);
    }

    job.fillCellX += 1;
    if (job.fillCellX > job.maxCellX) {
      job.fillCellX = job.minCellX;
      job.fillCellY += 1;
    }
    if (job.fillCellY > job.maxCellY) {
      job.fillCellY = job.minCellY;
      job.fillZ += 1;
    }
    return true;
  }

  if (job.phase === "terrain") {
    if (job.index >= job.map.terrainMaterials.length) {
      job.index = 0;
      job.phase = "floors";
      return true;
    }
    const entry = job.map.terrainMaterials[job.index];
    if (paint(job, entry.position, terrainPalette(entry.material))) {
      markDirty(job.playerId);
    }
    job.index += 1;
    return true;
  }

  if (job.phase === "floors") {
    return nextArrayPhase(job, job.map.floors, 5, "roads");
  }
  if (job.phase === "roads") {
    return nextArrayPhase(job, job.map.roads, 2, "water");
  }
  if (job.phase === "water") {
    return nextArrayPhase(job, job.map.water, 3, "bridges");
  }
  if (job.phase === "bridges") {
    return nextArrayPhase(job, job.map.bridges, 4, "houseWalls");
  }
  if (job.phase === "houseWalls") {
    return nextArrayPhase(job, job.map.houseWalls, 6, "castleWalls");
  }
  if (job.phase === "castleWalls") {
    return nextArrayPhase(job, job.map.castleWalls, 6, "buildings");
  }

  if (job.phase === "buildings") {
    if (job.index >= job.map.buildings.length) {
      job.phase = "done";
      return true;
    }

    const building = job.map.buildings[job.index];
    const fromCellX = Math.floor(
      building.x / WORLD_MAP_ATLAS_CELL_SIZE,
    );
    const toCellX = Math.floor(
      (building.x + Math.max(0, building.width - 1))
      / WORLD_MAP_ATLAS_CELL_SIZE,
    );
    const fromCellY = Math.floor(
      building.y / WORLD_MAP_ATLAS_CELL_SIZE,
    );
    const toCellY = Math.floor(
      (building.y + Math.max(0, building.height - 1))
      / WORLD_MAP_ATLAS_CELL_SIZE,
    );

    if (job.buildingCellX === null || job.buildingCellY === null) {
      job.buildingCellX = fromCellX;
      job.buildingCellY = fromCellY;
    }

    const key = atlasCellKey(
      building.floor,
      job.buildingCellX,
      job.buildingCellY,
    );
    if (job.discovered.has(key) && job.cells.get(key) !== 11) {
      job.cells.set(key, 11);
      markDirty(job.playerId);
    }

    job.buildingCellX += 1;
    if (job.buildingCellX > toCellX) {
      job.buildingCellX = fromCellX;
      job.buildingCellY += 1;
    }
    if (job.buildingCellY > toCellY) {
      job.buildingCellX = null;
      job.buildingCellY = null;
      job.index += 1;
    }
    return true;
  }

  return false;
}

function scheduleCaptureSlice() {
  if (idleHandle !== null || !captureJob) return;

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: (deadline: IdleDeadlineLike) => void,
      options?: { timeout: number },
    ) => number;
  };

  const run = (deadline?: IdleDeadlineLike) => {
    idleHandle = null;
    const startedAt = performance.now();

    while (captureJob) {
      const elapsed = performance.now() - startedAt;
      const remaining = deadline?.timeRemaining?.() ?? 4;

      // Never turn an idle callback into a long task. Leave enough room for
      // the renderer/input frame and continue in another idle slice.
      if (
        elapsed >= CAPTURE_SLICE_BUDGET_MS
        || (deadline && !deadline.didTimeout && remaining < 1.25)
      ) {
        scheduleCaptureSlice();
        return;
      }

      if (!processOne(captureJob) || captureJob.phase === "done") {
        captureJob = null;

        // If streaming/discovery changed while this job was running, process
        // only the latest state next rather than queueing every intermediate state.
        const next = pendingCapture;
        pendingCapture = null;
        if (next) beginCapture(next);
        return;
      }
    }
  };

  idleHandle = idleWindow.requestIdleCallback
    ? idleWindow.requestIdleCallback(run, { timeout: 1_500 })
    : window.setTimeout(() => run(), 0);
}

function cancelQueuedCapture() {
  if (captureTimer !== null) {
    window.clearTimeout(captureTimer);
    captureTimer = null;
  }

  if (idleHandle !== null) {
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(idleHandle);
    } else {
      window.clearTimeout(idleHandle);
    }
    idleHandle = null;
  }
}

export function queueWorldMapAtlasCapture(
  world: WorldState,
  playerId: string,
  discovered: ReadonlySet<string>,
) {
  // Keep only the latest desired capture. Stream packets and movement may
  // arrive faster than the atlas needs to update.
  pendingCapture = {
    world,
    playerId,
    discovered,
  };

  if (captureJob) return;

  if (captureTimer !== null) window.clearTimeout(captureTimer);
  captureTimer = window.setTimeout(() => {
    captureTimer = null;
    const next = pendingCapture;
    pendingCapture = null;
    if (next) beginCapture(next);
  }, CAPTURE_DEBOUNCE_MS);
}

function finishCaptureSynchronously() {
  // Only used while hiding/leaving. Gameplay never enters this path.
  let guard = 0;
  while (captureJob && guard < 5_000_000) {
    processOne(captureJob);
    guard += 1;
    if (captureJob.phase === "done") captureJob = null;
  }

  const next = pendingCapture;
  pendingCapture = null;
  if (next) {
    beginCapture(next);
    if (idleHandle !== null) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
      idleHandle = null;
    }

    guard = 0;
    while (captureJob && guard < 5_000_000) {
      processOne(captureJob);
      guard += 1;
      if (captureJob.phase === "done") captureJob = null;
    }
  }
}

export function flushWorldMapAtlasCapture() {
  cancelQueuedCapture();
  finishCaptureSynchronously();
  persistAllDirtyAtlases();
}
