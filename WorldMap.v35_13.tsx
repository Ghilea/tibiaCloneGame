import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type { MapView, Position } from "../protocol";
import type { WorldState } from "./WorldState";
import {
  WORLD_MAP_ATLAS_CELL_SIZE,
  WORLD_MAP_PALETTE,
  loadWorldMapAtlas,
  parseAtlasCellKey,
  type WorldMapAtlas,
} from "./WorldMapAtlas";
import "./WorldMap.css";

// TIBIAGAME_V35_13_WORLD_MAP_V2

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 760;
const LIVE_INDEX_CELL_SIZE = 32;
const ATLAS_INDEX_BUCKET_CELLS = 16;
const MIN_SCALE = 0.02;
const MAX_SCALE = 24;
const DEFAULT_ZONE_SCALE = 4.2;
const DISCOVERY_CHUNK_SIZE = 4;

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  center: Position;
};

type LiveBucket = {
  terrain: MapView["terrainMaterials"];
  floors: Position[];
  roads: Position[];
  water: Position[];
  bridges: Position[];
  blocked: Position[];
  houseWalls: Position[];
  castleWalls: Position[];
  trees: Position[];
  doors: MapView["doors"];
  stairs: MapView["stairs"];
};

type LiveMapIndex = {
  map: MapView;
  buckets: Map<string, LiveBucket>;
  floors: number[];
};

type AtlasCell = {
  z: number;
  cellX: number;
  cellY: number;
  palette: number;
};

type AtlasBucket = {
  cells: AtlasCell[];
  dominantPalette: number;
};

type AtlasIndex = {
  buckets: Map<string, AtlasBucket>;
  floors: number[];
  count: number;
};

const liveIndexCache = new WeakMap<MapView, LiveMapIndex>();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function discoveryKey(position: Position) {
  return `${position.z}:${Math.floor(position.x / DISCOVERY_CHUNK_SIZE)}:${Math.floor(position.y / DISCOVERY_CHUNK_SIZE)}`;
}

function loadDiscovery(playerId: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`aldoria.minimap-discovery.${playerId}`) ?? "[]");
    return new Set<string>(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function liveBucketKey(z: number, x: number, y: number) {
  return `${z}:${Math.floor(x / LIVE_INDEX_CELL_SIZE)}:${Math.floor(y / LIVE_INDEX_CELL_SIZE)}`;
}

function emptyLiveBucket(): LiveBucket {
  return {
    terrain: [],
    floors: [],
    roads: [],
    water: [],
    bridges: [],
    blocked: [],
    houseWalls: [],
    castleWalls: [],
    trees: [],
    doors: [],
    stairs: [],
  };
}

function liveIndex(map: MapView): LiveMapIndex {
  const cached = liveIndexCache.get(map);
  if (cached) return cached;

  const buckets = new Map<string, LiveBucket>();
  const floorSet = new Set<number>([map.floor]);
  const bucketFor = (position: Position) => {
    floorSet.add(position.z);
    const key = liveBucketKey(position.z, position.x, position.y);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = emptyLiveBucket();
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const entry of map.terrainMaterials) bucketFor(entry.position).terrain.push(entry);
  for (const position of map.floors) bucketFor(position).floors.push(position);
  for (const position of map.roads) bucketFor(position).roads.push(position);
  for (const position of map.water) bucketFor(position).water.push(position);
  for (const position of map.bridges) bucketFor(position).bridges.push(position);
  for (const position of map.blocked) bucketFor(position).blocked.push(position);
  for (const position of map.houseWalls) bucketFor(position).houseWalls.push(position);
  for (const position of map.castleWalls) bucketFor(position).castleWalls.push(position);
  for (const position of map.trees) bucketFor(position).trees.push(position);
  for (const door of map.doors) bucketFor(door.position).doors.push(door);
  for (const stair of map.stairs) {
    bucketFor(stair.from).stairs.push(stair);
    floorSet.add(stair.to.z);
  }
  for (const building of map.buildings) floorSet.add(building.floor);

  const result = {
    map,
    buckets,
    floors: [...floorSet].sort((a, b) => a - b),
  };
  liveIndexCache.set(map, result);
  return result;
}

function atlasBucketKey(z: number, cellX: number, cellY: number) {
  return `${z}:${Math.floor(cellX / ATLAS_INDEX_BUCKET_CELLS)}:${Math.floor(cellY / ATLAS_INDEX_BUCKET_CELLS)}`;
}

function buildAtlasIndex(atlas: WorldMapAtlas): AtlasIndex {
  const buckets = new Map<string, AtlasBucket>();
  const floors = new Set<number>();

  for (const [key, palette] of atlas.cells) {
    const parsed = parseAtlasCellKey(key);
    if (!parsed) continue;
    floors.add(parsed.z);
    const bucketKey = atlasBucketKey(parsed.z, parsed.cellX, parsed.cellY);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { cells: [], dominantPalette: palette };
      buckets.set(bucketKey, bucket);
    }
    bucket.cells.push({ ...parsed, palette });
  }

  for (const bucket of buckets.values()) {
    const counts = new Map<number, number>();
    for (const cell of bucket.cells) counts.set(cell.palette, (counts.get(cell.palette) ?? 0) + 1);
    let dominant = bucket.dominantPalette;
    let best = -1;
    for (const [palette, count] of counts) {
      if (count > best) {
        dominant = palette;
        best = count;
      }
    }
    bucket.dominantPalette = dominant;
  }

  return {
    buckets,
    floors: [...floors].sort((a, b) => a - b),
    count: atlas.cells.size,
  };
}

export function WorldMap({
  world,
  onClose,
}: {
  world: WorldState;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  const playerId = player?.id ?? "unknown";

  const [scale, setScale] = useState(() => {
    const stored = Number(localStorage.getItem(`aldoria.worldmap-scale.${playerId}`));
    return Number.isFinite(stored) ? clamp(stored, MIN_SCALE, MAX_SCALE) : DEFAULT_ZONE_SCALE;
  });
  const [center, setCenter] = useState<Position>(
    () => player?.position ?? { x: 0, y: 0, z: 7 },
  );
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [showNpcs, setShowNpcs] = useState(true);
  const [showResources, setShowResources] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);

  const atlasRef = useRef<WorldMapAtlas>(loadWorldMapAtlas(playerId));
  const atlasIndexRef = useRef<AtlasIndex>(buildAtlasIndex(atlasRef.current));
  const discoveryRef = useRef<Set<string>>(loadDiscovery(playerId));

  const relevantSnapshot = useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => {
        stopWorld();
        stopVisual();
      };
    },
    () => {
      const current = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      return current
        ? [
            current.position.x,
            current.position.y,
            current.position.z,
            world.streamRegionRevision,
            world.dynamicMapRevision,
            world.npcs.size,
            world.resourceNodes.size,
          ].join(":")
        : "none";
    },
  );

  useEffect(() => {
    localStorage.setItem(`aldoria.worldmap-scale.${playerId}`, String(scale));
  }, [playerId, scale]);

  useEffect(() => {
    if (!player) return;
    setCenter((current) =>
      current.z === player.position.z
        ? current
        : { ...player.position },
    );
  }, [player?.position.z]);

  useEffect(() => {
    atlasRef.current = loadWorldMapAtlas(playerId);
    atlasIndexRef.current = buildAtlasIndex(atlasRef.current);
    discoveryRef.current = loadDiscovery(playerId);
  }, [playerId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !player) return;

    const frame = window.requestAnimationFrame(() => {
      drawWorldMapV2(
        context,
        world,
        center,
        scale,
        player.position,
        atlasIndexRef.current,
        discoveryRef.current,
        { showNpcs, showResources, showBuildings },
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    world,
    relevantSnapshot,
    center.x,
    center.y,
    center.z,
    scale,
    player?.position.x,
    player?.position.y,
    player?.position.z,
    showNpcs,
    showResources,
    showBuildings,
  ]);

  const map = world.map;
  const liveFloors = map ? liveIndex(map).floors : [];
  const allFloors = [...new Set([
    ...atlasIndexRef.current.floors,
    ...liveFloors,
    player?.position.z ?? center.z,
  ])].sort((a, b) => a - b);
  const floorIndex = Math.max(0, allFloors.indexOf(center.z));

  const setFloor = (next: number) => {
    setCenter((current) => ({ ...current, z: next }));
  };

  const centerPlayer = () => {
    if (!player) return;
    setCenter({ ...player.position });
    setScale((current) => Math.max(current, DEFAULT_ZONE_SCALE));
  };

  const zoneView = () => {
    if (!player) return;
    setCenter({ ...player.position });
    setScale(DEFAULT_ZONE_SCALE);
  };

  const worldView = () => {
    if (!map) return;
    setCenter({
      x: map.width / 2,
      y: map.height / 2,
      z: player?.position.z ?? center.z,
    });
    const fit = Math.min(CANVAS_WIDTH / map.width, CANVAS_HEIGHT / map.height) * 0.92;
    setScale(clamp(fit, MIN_SCALE, MAX_SCALE));
  };

  const zoom = (factor: number) => {
    setScale((current) => clamp(current * factor, MIN_SCALE, MAX_SCALE));
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      center: { ...center },
    };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) * CANVAS_WIDTH / Math.max(1, rect.width);
    const canvasY = (event.clientY - rect.top) * CANVAS_HEIGHT / Math.max(1, rect.height);
    setCursor({
      x: center.x + (canvasX - CANVAS_WIDTH / 2) / scale,
      y: center.y + (canvasY - CANVAS_HEIGHT / 2) / scale,
    });

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.x) * CANVAS_WIDTH / Math.max(1, rect.width);
    const dy = (event.clientY - drag.y) * CANVAS_HEIGHT / Math.max(1, rect.height);
    setCenter({
      x: drag.center.x - dx / scale,
      y: drag.center.y - dy / scale,
      z: drag.center.z,
    });
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) * CANVAS_WIDTH / Math.max(1, rect.width);
    const mouseY = (event.clientY - rect.top) * CANVAS_HEIGHT / Math.max(1, rect.height);
    const worldBefore = {
      x: center.x + (mouseX - CANVAS_WIDTH / 2) / scale,
      y: center.y + (mouseY - CANVAS_HEIGHT / 2) / scale,
    };
    const nextScale = clamp(scale * (event.deltaY > 0 ? 0.78 : 1.28), MIN_SCALE, MAX_SCALE);
    setScale(nextScale);
    setCenter((current) => ({
      x: worldBefore.x - (mouseX - CANVAS_WIDTH / 2) / nextScale,
      y: worldBefore.y - (mouseY - CANVAS_HEIGHT / 2) / nextScale,
      z: current.z,
    }));
  };

  return (
    <section className="world-map-layer v3513-world-map-layer" role="dialog" aria-modal="true" aria-label="World map">
      <article className="world-map-card v3513-world-map-card">
        <header className="v3513-world-map-header">
          <span>
            <small>World map</small>
            <strong>{center.z === 7 ? "The First Marches" : `Depth ${center.z}`}</strong>
          </span>
          <nav>
            <button type="button" onClick={zoneView}>Zone</button>
            <button type="button" onClick={worldView}>World</button>
            <button type="button" onClick={centerPlayer}>Player</button>
            <button type="button" className="world-map-close" onClick={onClose} aria-label="Close world map">×</button>
          </nav>
        </header>

        <div className="v3513-world-map-body">
          <aside className="v3513-world-map-sidebar">
            <section>
              <small>Floor</small>
              <div className="v3513-floor-control">
                <button
                  type="button"
                  disabled={floorIndex <= 0}
                  onClick={() => setFloor(allFloors[floorIndex - 1] ?? center.z)}
                  aria-label="Previous floor"
                >▲</button>
                <b>z{center.z}</b>
                <button
                  type="button"
                  disabled={floorIndex >= allFloors.length - 1}
                  onClick={() => setFloor(allFloors[floorIndex + 1] ?? center.z)}
                  aria-label="Next floor"
                >▼</button>
              </div>
            </section>

            <section>
              <small>Map filters</small>
              <label><input type="checkbox" checked={showBuildings} onChange={(event) => setShowBuildings(event.target.checked)} /> Buildings</label>
              <label><input type="checkbox" checked={showNpcs} onChange={(event) => setShowNpcs(event.target.checked)} /> NPCs</label>
              <label><input type="checkbox" checked={showResources} onChange={(event) => setShowResources(event.target.checked)} /> Resources</label>
            </section>

            <section className="v3513-map-legend">
              <small>Legend</small>
              <span><i className="player" /> You</span>
              <span><i className="npc" /> NPC</span>
              <span><i className="resource" /> Resource</span>
              <span><i className="water" /> Water</span>
              <span><i className="road" /> Road</span>
            </section>

            <section className="v3513-chart-status">
              <small>Exploration</small>
              <b>{atlasIndexRef.current.count.toLocaleString()} charted sectors</b>
              <span>Terrain is cached in the background as you explore.</span>
            </section>
          </aside>

          <div className="v3513-world-map-stage">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerLeave={() => {
                if (!dragRef.current) setCursor(null);
              }}
              onWheel={wheel}
            />
            <div className="v3513-map-zoom">
              <button type="button" onClick={() => zoom(1.35)} aria-label="Zoom in">+</button>
              <button type="button" onClick={() => zoom(1 / 1.35)} aria-label="Zoom out">−</button>
            </div>
            <div className="v3513-map-scale">{Math.round(100 / Math.max(0.01, scale))} tiles / 100 px</div>
          </div>
        </div>

        <footer className="v3513-world-map-footer">
          <span>Drag to pan · Wheel to zoom · M / Esc to close</span>
          <b>
            {cursor
              ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)}, z${center.z}`
              : player
                ? `${player.position.x}, ${player.position.y}, z${player.position.z}`
                : "—"}
          </b>
        </footer>
      </article>
    </section>
  );
}

function drawWorldMapV2(
  context: CanvasRenderingContext2D,
  world: WorldState,
  center: Position,
  scale: number,
  player: Position,
  atlas: AtlasIndex,
  discovered: ReadonlySet<string>,
  filters: { showNpcs: boolean; showResources: boolean; showBuildings: boolean },
) {
  const map = world.map;
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  const screen = (x: number, y: number) => ({
    x: halfWidth + (x - center.x) * scale,
    y: halfHeight + (y - center.y) * scale,
  });
  const worldBounds = {
    minX: center.x - halfWidth / scale,
    maxX: center.x + halfWidth / scale,
    minY: center.y - halfHeight / scale,
    maxY: center.y + halfHeight / scale,
  };
  const visible = (position: Position, padding = 3) =>
    position.z === center.z
    && position.x >= worldBounds.minX - padding
    && position.x <= worldBounds.maxX + padding
    && position.y >= worldBounds.minY - padding
    && position.y <= worldBounds.maxY + padding;
  const known = (position: Position) =>
    discovered.has(discoveryKey(position))
    || (
      position.z === player.z
      && Math.abs(position.x - player.x) <= 10
      && Math.abs(position.y - player.y) <= 10
    );

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090d0a";
  context.fillRect(0, 0, width, height);

  // Subtle parchment/grid background.
  context.save();
  context.globalAlpha = 0.18;
  context.strokeStyle = "#8f7c5528";
  context.lineWidth = 1;
  const major = Math.max(64, 256 / Math.max(0.1, scale));
  const startX = Math.floor(worldBounds.minX / major) * major;
  const startY = Math.floor(worldBounds.minY / major) * major;
  for (let x = startX; x <= worldBounds.maxX; x += major) {
    const point = screen(x, 0);
    context.beginPath();
    context.moveTo(point.x, 0);
    context.lineTo(point.x, height);
    context.stroke();
  }
  for (let y = startY; y <= worldBounds.maxY; y += major) {
    const point = screen(0, y);
    context.beginPath();
    context.moveTo(0, point.y);
    context.lineTo(width, point.y);
    context.stroke();
  }
  context.restore();

  // Draw persisted exploration atlas first. At extreme world zoom, use one
  // representative color per 64x64-tile atlas bucket instead of thousands of cells.
  drawAtlas(context, atlas, center, scale);

  if (map) {
    drawWorldBorder(context, map, center, scale);
    drawStreamRegion(context, world, center, scale);

    // Detailed live streamed data is only needed when close enough to benefit.
    if (scale >= 0.7) {
      drawLiveMap(context, world, map, center, scale, known, filters.showBuildings);
    }
  }

  if (filters.showResources && scale >= 1.6) {
    for (const node of world.resourceNodes.values()) {
      if (!node.available || !visible(node.position) || !known(node.position)) continue;
      drawMarker(context, screen(node.position.x + 0.5, node.position.y + 0.5), "#d49350", Math.max(3, scale * 0.28), "◇");
    }
  }

  if (filters.showNpcs && scale >= 1.6) {
    for (const npc of world.npcs.values()) {
      if (!visible(npc.position) || !known(npc.position)) continue;
      drawMarker(context, screen(npc.position.x + 0.5, npc.position.y + 0.5), "#b894df", Math.max(3.5, scale * 0.3), "!");
      if (scale >= 7) {
        const point = screen(npc.position.x + 0.5, npc.position.y + 0.5);
        context.fillStyle = "#d9c8ec";
        context.font = "600 11px system-ui";
        context.fillText(npc.name, point.x + 8, point.y - 7);
      }
    }
  }

  if (player.z === center.z) {
    const point = screen(player.x + 0.5, player.y + 0.5);
    context.save();
    context.shadowColor = "#f2d785";
    context.shadowBlur = 12;
    context.beginPath();
    context.fillStyle = "#f5dc8e";
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "#2c2112";
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.fillStyle = "#fff4c5";
    context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // Edge vignette makes the map feel like a dedicated atlas rather than raw debug canvas.
  const gradient = context.createRadialGradient(
    halfWidth, halfHeight, Math.min(width, height) * 0.28,
    halfWidth, halfHeight, Math.max(width, height) * 0.72,
  );
  gradient.addColorStop(0, "#00000000");
  gradient.addColorStop(1, "#0000008c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawAtlas(
  context: CanvasRenderingContext2D,
  atlas: AtlasIndex,
  center: Position,
  scale: number,
) {
  if (atlas.count === 0) return;

  const halfWidth = CANVAS_WIDTH / 2;
  const halfHeight = CANVAS_HEIGHT / 2;
  const cellWorldSize = WORLD_MAP_ATLAS_CELL_SIZE;
  const bucketCells = ATLAS_INDEX_BUCKET_CELLS;
  const bucketWorldSize = cellWorldSize * bucketCells;
  const minX = center.x - halfWidth / scale;
  const maxX = center.x + halfWidth / scale;
  const minY = center.y - halfHeight / scale;
  const maxY = center.y + halfHeight / scale;

  const minBucketX = Math.floor(minX / bucketWorldSize) - 1;
  const maxBucketX = Math.floor(maxX / bucketWorldSize) + 1;
  const minBucketY = Math.floor(minY / bucketWorldSize) - 1;
  const maxBucketY = Math.floor(maxY / bucketWorldSize) + 1;
  const coarse = cellWorldSize * scale < 0.9;

  for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
      const bucket = atlas.buckets.get(`${center.z}:${bucketX}:${bucketY}`);
      if (!bucket) continue;

      if (coarse) {
        const x = halfWidth + (bucketX * bucketWorldSize - center.x) * scale;
        const y = halfHeight + (bucketY * bucketWorldSize - center.y) * scale;
        context.globalAlpha = 0.84;
        context.fillStyle = WORLD_MAP_PALETTE[bucket.dominantPalette] ?? WORLD_MAP_PALETTE[0];
        context.fillRect(
          x,
          y,
          Math.max(1, bucketWorldSize * scale + 0.6),
          Math.max(1, bucketWorldSize * scale + 0.6),
        );
        context.globalAlpha = 1;
        continue;
      }

      for (const cell of bucket.cells) {
        const x = halfWidth + (cell.cellX * cellWorldSize - center.x) * scale;
        const y = halfHeight + (cell.cellY * cellWorldSize - center.y) * scale;
        const size = Math.max(1, cellWorldSize * scale + 0.8);
        context.fillStyle = WORLD_MAP_PALETTE[cell.palette] ?? WORLD_MAP_PALETTE[0];
        context.fillRect(x, y, size, size);
      }
    }
  }
}

function drawLiveMap(
  context: CanvasRenderingContext2D,
  world: WorldState,
  map: MapView,
  center: Position,
  scale: number,
  known: (position: Position) => boolean,
  showBuildings: boolean,
) {
  const index = liveIndex(map);
  const halfWidth = CANVAS_WIDTH / 2;
  const halfHeight = CANVAS_HEIGHT / 2;
  const minX = center.x - halfWidth / scale;
  const maxX = center.x + halfWidth / scale;
  const minY = center.y - halfHeight / scale;
  const maxY = center.y + halfHeight / scale;
  const minBucketX = Math.floor(minX / LIVE_INDEX_CELL_SIZE) - 1;
  const maxBucketX = Math.floor(maxX / LIVE_INDEX_CELL_SIZE) + 1;
  const minBucketY = Math.floor(minY / LIVE_INDEX_CELL_SIZE) - 1;
  const maxBucketY = Math.floor(maxY / LIVE_INDEX_CELL_SIZE) + 1;

  const screen = (position: Position) => ({
    x: halfWidth + (position.x + 0.5 - center.x) * scale,
    y: halfHeight + (position.y + 0.5 - center.y) * scale,
  });
  const tile = (position: Position, color: string, factor = 1) => {
    if (!known(position)) return;
    const point = screen(position);
    const size = Math.max(1, scale * factor + 0.45);
    context.fillStyle = color;
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  };
  const terrainColor = (material: MapView["terrainMaterials"][number]["material"]) => {
    switch (material) {
      case "mud":
      case "packed_earth":
      case "ash_soil":
        return "#594738";
      case "marsh_grass":
        return "#3d553b";
      case "sandstone":
        return "#89744f";
      case "wood_planks":
        return "#76583b";
      case "crypt_stone":
        return "#4b4d53";
      default:
        return "#51584f";
    }
  };

  for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
      const bucket = index.buckets.get(`${center.z}:${bucketX}:${bucketY}`);
      if (!bucket) continue;

      for (const entry of bucket.terrain) tile(entry.position, terrainColor(entry.material));
      for (const position of bucket.floors) tile(position, "#6a6155");
      for (const position of bucket.roads) tile(position, "#8a795c");
      for (const position of bucket.water) tile(position, "#275a70");
      for (const position of bucket.bridges) tile(position, "#8d6742");
      for (const position of bucket.blocked) tile(position, "#343b36", 0.72);
      for (const position of bucket.houseWalls) tile(position, "#5d554a", 0.75);
      for (const position of bucket.castleWalls) tile(position, "#70736d", 0.82);

      if (scale >= 2.2) {
        for (const position of bucket.trees) {
          if (!known(position)) continue;
          const point = screen(position);
          context.beginPath();
          context.fillStyle = "#1e492b";
          context.arc(point.x, point.y, Math.max(1.5, scale * 0.22), 0, Math.PI * 2);
          context.fill();
        }
        for (const door of bucket.doors) {
          if (!known(door.position)) continue;
          const point = screen(door.position);
          context.fillStyle = door.open ? "#c8a660" : "#e0b65f";
          context.fillRect(point.x - 2, point.y - 2, 4, 4);
        }
        for (const stair of bucket.stairs) {
          if (!known(stair.from)) continue;
          const point = screen(stair.from);
          context.fillStyle = "#d6d2c2";
          context.font = "700 10px system-ui";
          context.fillText(stair.to.z < stair.from.z ? "▲" : "▼", point.x - 4, point.y + 4);
        }
      }
    }
  }

  if (!showBuildings) return;
  for (const building of map.buildings) {
    if (building.floor !== center.z) continue;
    if (
      building.x + building.width < minX
      || building.x > maxX
      || building.y + building.height < minY
      || building.y > maxY
    ) continue;

    const centerPosition = {
      x: building.x + building.width / 2,
      y: building.y + building.height / 2,
      z: building.floor,
    };
    if (!known(centerPosition)) continue;

    const x = halfWidth + (building.x - center.x) * scale;
    const y = halfHeight + (building.y - center.y) * scale;
    context.globalAlpha = 0.76;
    context.fillStyle = building.kind === "keep" ? "#848984" : "#8c6248";
    context.fillRect(
      x,
      y,
      Math.max(2, building.width * scale),
      Math.max(2, building.height * scale),
    );
    context.globalAlpha = 1;

    if (scale >= 5) {
      context.fillStyle = "#ead9b4";
      context.font = `${Math.max(10, Math.min(14, scale * 0.9))}px system-ui`;
      context.fillText(building.name, x + 4, y - 5);
    }
  }

  void world;
}

function drawWorldBorder(
  context: CanvasRenderingContext2D,
  map: MapView,
  center: Position,
  scale: number,
) {
  const x = CANVAS_WIDTH / 2 - center.x * scale;
  const y = CANVAS_HEIGHT / 2 - center.y * scale;
  context.save();
  context.strokeStyle = "#b89a5a55";
  context.lineWidth = 2;
  context.strokeRect(x, y, map.width * scale, map.height * scale);
  context.restore();
}

function drawStreamRegion(
  context: CanvasRenderingContext2D,
  world: WorldState,
  center: Position,
  scale: number,
) {
  const region = world.streamRegionCenter;
  if (!region || region.z !== center.z || world.streamRegionRadius <= 0) return;
  const radius = world.streamRegionRadius;
  const x = CANVAS_WIDTH / 2 + (region.x - radius - center.x) * scale;
  const y = CANVAS_HEIGHT / 2 + (region.y - radius - center.y) * scale;
  const size = radius * 2 * scale;
  context.save();
  context.setLineDash([5, 5]);
  context.strokeStyle = "#d4b56b38";
  context.lineWidth = 1;
  context.strokeRect(x, y, size, size);
  context.restore();
}

function drawMarker(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
  radius: number,
  glyph: string,
) {
  context.save();
  context.beginPath();
  context.fillStyle = "#101411e8";
  context.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.fillStyle = color;
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  if (radius >= 4) {
    context.fillStyle = "#15110b";
    context.font = `700 ${Math.max(7, radius * 1.4)}px system-ui`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(glyph, point.x, point.y + 0.5);
  }
  context.restore();
}
