import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MapView, Position, WorldObjectView } from "../protocol";
import type { WorldState } from "./WorldState";
import { queueWorldMapAtlasCapture, flushWorldMapAtlasCapture } from "./WorldMapAtlas";
import { worldEnvironment, worldTimeLabel } from "./worldEnvironment";

// TIBIAGAME_V35C_MINIMAP_DISCOVERY
// TIBIAGAME_V35_2_MAINTHREAD_OPTIMIZATION
const CANVAS_SIZE = 220;
const DISCOVERY_CHUNK_SIZE = 4;
const DISCOVERY_REVEAL_RADIUS = 8;
const MINIMAP_DRAW_INTERVAL_MS = 100;
const DISCOVERY_SAVE_DEBOUNCE_MS = 1_200;
const MINIMAP_CACHE_CELL_SIZE = 8;

function discoveryKey(position: Position) {
  return `${position.z}:${Math.floor(position.x / DISCOVERY_CHUNK_SIZE)}:${Math.floor(position.y / DISCOVERY_CHUNK_SIZE)}`;
}

function loadDiscovery(playerId: string) {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`aldoria.minimap-discovery.${playerId}`) ?? "[]",
    );
    return new Set<string>(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function GameMinimap({ world }: { world: WorldState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [radius, setRadius] = useState(22);
  const [environment, setEnvironment] = useState(() => worldEnvironment());
  const discoveryOwner = useRef<string | null>(null);
  const discoveredRef = useRef<Set<string>>(new Set());
  const radiusRef = useRef(radius);
  const discoverySaveTimer = useRef<number | null>(null);
  const discoveryIdleHandle = useRef<number | null>(null);

  // React only needs local-player movement/facing. Other world/visual updates are
  // read directly by the low-frequency canvas loop below.
  const playerSnapshot = useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => {
      const current = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      return current
        ? [current.id, current.position.x, current.position.y, current.position.z, world.localPlayerFacing].join(":")
        : "none";
    },
  );
  void playerSnapshot;

  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;

  const cancelQueuedDiscoverySave = () => {
    if (discoverySaveTimer.current !== null) {
      window.clearTimeout(discoverySaveTimer.current);
      discoverySaveTimer.current = null;
    }
    if (discoveryIdleHandle.current !== null) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(discoveryIdleHandle.current);
      else window.clearTimeout(discoveryIdleHandle.current);
      discoveryIdleHandle.current = null;
    }
  };

  const persistDiscoveryNow = () => {
    const owner = discoveryOwner.current;
    if (!owner) return;
    try {
      localStorage.setItem(
        `aldoria.minimap-discovery.${owner}`,
        JSON.stringify([...discoveredRef.current]),
      );
    } catch {
      // Discovery is only a convenience cache. Storage failure must not affect play.
    }
  };

  const queueDiscoverySave = () => {
    if (discoverySaveTimer.current !== null) window.clearTimeout(discoverySaveTimer.current);
    discoverySaveTimer.current = window.setTimeout(() => {
      discoverySaveTimer.current = null;
      const commit = () => {
        discoveryIdleHandle.current = null;
        persistDiscoveryNow();
      };
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      discoveryIdleHandle.current = idleWindow.requestIdleCallback
        ? idleWindow.requestIdleCallback(commit, { timeout: 2_500 })
        : window.setTimeout(commit, 0);
    }, DISCOVERY_SAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);

  useEffect(() => {
    const timer = window.setInterval(() => setEnvironment(worldEnvironment()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!player || discoveryOwner.current === player.id) return;
    cancelQueuedDiscoverySave();
    discoveryOwner.current = player.id;
    discoveredRef.current = loadDiscovery(player.id);
  }, [player?.id]);

  useEffect(() => {
    const map = world.map;
    if (!player || !map || discoveryOwner.current !== player.id) return;

    const current = discoveredRef.current;
    let next: Set<string> | null = null;
    const has = (key: string) => (next ?? current).has(key);

    for (let dy = -DISCOVERY_REVEAL_RADIUS; dy <= DISCOVERY_REVEAL_RADIUS; dy += 1) {
      for (let dx = -DISCOVERY_REVEAL_RADIUS; dx <= DISCOVERY_REVEAL_RADIUS; dx += 1) {
        if (dx * dx + dy * dy > DISCOVERY_REVEAL_RADIUS * DISCOVERY_REVEAL_RADIUS) continue;
        const position = {
          x: player.position.x + dx,
          y: player.position.y + dy,
          z: player.position.z,
        };
        if (
          position.x < 0
          || position.y < 0
          || position.x >= map.width
          || position.y >= map.height
        ) continue;
        const key = discoveryKey(position);
        if (!has(key)) {
          if (!next) next = new Set(current);
          next.add(key);
        }
      }
    }

    if (!next) return;
    discoveredRef.current = next;
    queueDiscoverySave();
    queueWorldMapAtlasCapture(world, player.id, next);
  }, [
    player?.id,
    player?.position.x,
    player?.position.y,
    player?.position.z,
    world.map?.width,
    world.map?.height,
  ]);

  // TIBIAGAME_V35_13_ATLAS_REGION_CAPTURE
  useEffect(() => {
    if (!player || !world.map || discoveryOwner.current !== player.id) return;
    queueWorldMapAtlasCapture(world, player.id, discoveredRef.current);
  }, [player?.id, world.streamRegionRevision, world.dynamicMapRevision]);

  // Normal movement never writes discovery synchronously. We flush on pagehide
  // so the final few seconds are not lost when leaving the client.
  useEffect(() => {
    const flush = () => {
      cancelQueuedDiscoverySave();
      persistDiscoveryNow();
      flushWorldMapAtlasCapture();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // The minimap is HUD information, not the 60 FPS world renderer. Draw it at
  // 10 FPS and read mutable world state directly so map/creature events do not
  // force React commits or full static-map scans every visual tick.
  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let frame: number | null = null;

    const draw = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const currentPlayer = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      if (canvas && context && currentPlayer) {
        drawMinimap(
          context,
          world,
          currentPlayer.position,
          radiusRef.current,
          discoveredRef.current,
        );
      }
      timer = window.setTimeout(() => {
        timer = null;
        frame = window.requestAnimationFrame(draw);
      }, MINIMAP_DRAW_INTERVAL_MS);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [world]);

  const zoom = (direction: -1 | 1) => {
    const levels = [14, 22, 32];
    const index = levels.indexOf(radius);
    setRadius(levels[Math.max(0, Math.min(levels.length - 1, index + direction))]);
  };

  return (
    <section className="game-minimap" aria-label="Minimap">
      <header>
        <strong>{player?.position.z === 7 ? "The First Marches" : `Depth ${player?.position.z ?? 7}`}</strong>
      </header>
      <div className="game-minimap-ring">
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
        <span className="minimap-north">N</span>
        <span className="minimap-east">E</span>
        <span className="minimap-south">S</span>
        <span className="minimap-west">W</span>
      </div>
      <div className="minimap-zoom">
        <button type="button" disabled={radius === 14} onClick={() => zoom(-1)} aria-label="Zoom minimap in">+</button>
        <button type="button" disabled={radius === 32} onClick={() => zoom(1)} aria-label="Zoom minimap out">−</button>
      </div>
      <footer data-period={environment.period.toLowerCase()} data-weather={environment.weather}>
        <span aria-hidden="true">{environment.period === "Night" ? "☾" : environment.weather === "rain" ? "☂" : "☀"}</span>
        <div><strong>{worldTimeLabel(environment)}</strong><small>Day {environment.day} · {environment.period}</small></div>
        <em>{player ? `${player.position.x}, ${player.position.y}` : "—"}</em>
      </footer>
    </section>
  );
}

type MinimapStaticSlice = {
  blocked: Position[];
  terrainMaterials: MapView["terrainMaterials"];
  floors: Position[];
  roads: Position[];
  water: Position[];
  bridges: Position[];
  buildings: MapView["buildings"];
  houseWalls: Position[];
  castleWalls: Position[];
  trees: Position[];
  doors: MapView["doors"];
  objects: WorldObjectView[];
};

type MinimapStaticCache = {
  owner: WorldState;
  key: string;
  slice: MinimapStaticSlice;
};

let minimapStaticCache: MinimapStaticCache | null = null;

function minimapStaticSlice(
  world: WorldState,
  map: MapView,
  center: Position,
  radius: number,
): MinimapStaticSlice {
  const cellX = Math.floor(center.x / MINIMAP_CACHE_CELL_SIZE);
  const cellY = Math.floor(center.y / MINIMAP_CACHE_CELL_SIZE);
  const anchorX = cellX * MINIMAP_CACHE_CELL_SIZE + MINIMAP_CACHE_CELL_SIZE / 2;
  const anchorY = cellY * MINIMAP_CACHE_CELL_SIZE + MINIMAP_CACHE_CELL_SIZE / 2;
  const key = [
    world.streamRegionRevision,
    world.dynamicMapRevision,
    center.z,
    radius,
    cellX,
    cellY,
  ].join(":");

  if (
    minimapStaticCache
    && minimapStaticCache.owner === world
    && minimapStaticCache.key === key
  ) return minimapStaticCache.slice;

  // Enough padding to reuse this slice for every player position in one 8-tile cell.
  const padding = radius + MINIMAP_CACHE_CELL_SIZE + 3;
  const minX = anchorX - padding;
  const maxX = anchorX + padding;
  const minY = anchorY - padding;
  const maxY = anchorY + padding;
  const near = (position: Position) =>
    position.z === center.z
    && position.x >= minX
    && position.x <= maxX
    && position.y >= minY
    && position.y <= maxY;
  const buildingNear = (building: MapView["buildings"][number]) =>
    building.floor === center.z
    && building.x + building.width >= minX
    && building.x <= maxX
    && building.y + building.height >= minY
    && building.y <= maxY;

  const slice: MinimapStaticSlice = {
    blocked: map.blocked.filter(near),
    terrainMaterials: map.terrainMaterials.filter((entry) => near(entry.position)),
    floors: map.floors.filter(near),
    roads: map.roads.filter(near),
    water: map.water.filter(near),
    bridges: map.bridges.filter(near),
    buildings: map.buildings.filter(buildingNear),
    houseWalls: map.houseWalls.filter(near),
    castleWalls: map.castleWalls.filter(near),
    trees: map.trees.filter(near),
    doors: map.doors.filter((entry) => near(entry.position)),
    objects: (map.objects ?? []).filter((entry) => near(entry.position)),
  };
  minimapStaticCache = { owner: world, key, slice };
  return slice;
}

function drawMinimap(
  context: CanvasRenderingContext2D,
  world: WorldState,
  center: Position,
  radius: number,
  discovered: ReadonlySet<string>,
) {
  const map = world.map;
  const staticSlice = map ? minimapStaticSlice(world, map, center, radius) : null;
  const scale = CANVAS_SIZE / (radius * 2 + 1);
  const half = CANVAS_SIZE / 2;
  const toCanvas = (position: Position) => ({
    x: half + (position.x - center.x) * scale,
    y: half + (position.y - center.y) * scale,
  });
  const visible = (position: Position) => position.z === center.z
    && Math.abs(position.x - center.x) <= radius + 2
    && Math.abs(position.y - center.y) <= radius + 2;
  const explored = (position: Position) =>
    position.z === center.z && discovered.has(discoveryKey(position));
  const tile = (position: Position, color: string, size = scale + 0.6) => {
    if (!visible(position) || !explored(position)) return;
    const point = toCanvas(position);
    context.fillStyle = color;
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  };
  const dot = (position: Position, color: string, size: number) => {
    if (!visible(position) || !explored(position)) return;
    const point = toCanvas(position);
    context.beginPath();
    context.fillStyle = color;
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fill();
  };

  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.save();
  context.beginPath();
  context.arc(half, half, half - 3, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#050705";
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (map && staticSlice) {
    for (let y = center.y - radius - 2; y <= center.y + radius + 2; y += 1) {
      for (let x = center.x - radius - 2; x <= center.x + radius + 2; x += 1) {
        const position = { x, y, z: center.z };
        const point = toCanvas(position);
        const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
        context.fillStyle = !inside
          ? "#020302"
          : explored(position)
            ? "#344b35"
            : "#0d120f";
        context.fillRect(
          point.x - scale / 2 - 0.3,
          point.y - scale / 2 - 0.3,
          scale + 0.6,
          scale + 0.6,
        );
      }
    }

    for (const position of staticSlice.blocked) tile(position, "#263128");
    for (const entry of staticSlice.terrainMaterials) {
      const color = entry.material === "packed_earth"
        ? "#76583b"
        : entry.material === "moss_stone"
          ? "#4d5740"
          : "#b6915d";
      tile(entry.position, color);
    }
    for (const position of staticSlice.floors) tile(position, "#735337");
    for (const position of staticSlice.roads) tile(position, "#8f8775");
    for (const position of staticSlice.water) tile(position, "#246779");
    for (const position of staticSlice.bridges) tile(position, "#a16d3d");

    const drawMinX = center.x - radius - 2;
    const drawMaxX = center.x + radius + 2;
    const drawMinY = center.y - radius - 2;
    const drawMaxY = center.y + radius + 2;
    for (const building of staticSlice.buildings) {
      const fromY = Math.max(building.y, drawMinY);
      const toY = Math.min(building.y + building.height - 1, drawMaxY);
      const fromX = Math.max(building.x, drawMinX);
      const toX = Math.min(building.x + building.width - 1, drawMaxX);
      for (let y = fromY; y <= toY; y += 1) {
        for (let x = fromX; x <= toX; x += 1) {
          tile(
            { x, y, z: building.floor },
            building.kind === "keep" ? "#949b98" : "#b38258",
          );
        }
      }
    }

    for (const position of staticSlice.houseWalls) tile(position, "#d7ae72", scale * 0.7);
    for (const position of staticSlice.castleWalls) tile(position, "#d0d7d3", scale * 0.75);
    for (const position of staticSlice.trees) dot(position, "#153f21", Math.max(1.5, scale * 0.55));
    for (const door of staticSlice.doors) dot(door.position, door.open ? "#8ee0b0" : "#ffd166", 2.7);
    for (const object of staticSlice.objects) drawObject(dot, object);

    context.strokeStyle = "#d0a45e";
    context.lineWidth = Math.max(1.25, scale * 0.24);
    context.beginPath();
    const left = half + (0 - center.x - 0.5) * scale;
    const right = half + (map.width - center.x - 0.5) * scale;
    const top = half + (0 - center.y - 0.5) * scale;
    const bottom = half + (map.height - center.y - 0.5) * scale;
    if (left >= 0 && left <= CANVAS_SIZE) { context.moveTo(left, 0); context.lineTo(left, CANVAS_SIZE); }
    if (right >= 0 && right <= CANVAS_SIZE) { context.moveTo(right, 0); context.lineTo(right, CANVAS_SIZE); }
    if (top >= 0 && top <= CANVAS_SIZE) { context.moveTo(0, top); context.lineTo(CANVAS_SIZE, top); }
    if (bottom >= 0 && bottom <= CANVAS_SIZE) { context.moveTo(0, bottom); context.lineTo(CANVAS_SIZE, bottom); }
    context.stroke();
  }

  for (const node of world.resourceNodes.values()) dot(node.position, "#d37c45", 2.2);
  for (const npc of world.npcs.values()) dot(npc.position, "#f2d36e", 2.5);
  for (const creature of world.creatures.values()) {
    dot(
      creature.position,
      creature.id === world.attackTargetId ? "#fff2a0" : "#df554a",
      creature.id === world.attackTargetId ? 3.8 : 2.6,
    );
  }
  for (const other of world.players.values()) {
    if (other.id !== world.localPlayerId) dot(other.position, "#65a8e5", 2.8);
  }

  context.strokeStyle = "#ffffff0c";
  context.lineWidth = 1;
  for (let offset = -radius; offset <= radius; offset += 5) {
    const position = half + offset * scale;
    context.beginPath(); context.moveTo(position, 0); context.lineTo(position, CANVAS_SIZE); context.stroke();
    context.beginPath(); context.moveTo(0, position); context.lineTo(CANVAS_SIZE, position); context.stroke();
  }

  context.translate(half, half);
  context.rotate((4 - world.localPlayerFacing) * (Math.PI / 4));
  context.beginPath();
  context.moveTo(0, -8);
  context.lineTo(6, 7);
  context.lineTo(0, 4);
  context.lineTo(-6, 7);
  context.closePath();
  context.fillStyle = "#f7e2a5";
  context.fill();
  context.strokeStyle = "#332510";
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

function drawObject(
  dot: (position: Position, color: string, size: number) => void,
  object: WorldObjectView,
) {
  if (["forest_tree", "pine_tree", "snowy_pine"].includes(object.kind)) {
    dot(object.position, object.kind === "snowy_pine" ? "#c8ddd4" : "#153f21", 2.3);
  } else if (object.kind === "mountain_wall" || object.kind === "snow_bank") {
    dot(object.position, "#69736f", 2);
  } else if (object.kind === "well") {
    dot(object.position, "#79b8c5", 2.2);
  } else if (object.kind === "bog_slick") {
    dot(object.position, "#17231f", 2.4);
  } else if (object.kind === "bent_reeds") {
    dot(object.position, "#6f873f", 1.8);
  } else if (object.kind === "wrecked_planks") {
    dot(object.position, "#68462e", 1.8);
  } else if (object.kind === "notice_post") {
    dot(object.position, "#d1be8a", 1.6);
  }
}
