import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Position, WorldObjectView } from "../protocol";
import type { WorldState } from "./WorldState";
import { worldEnvironment, worldTimeLabel } from "./worldEnvironment";

// TIBIAGAME_V35C_MINIMAP_DISCOVERY
const CANVAS_SIZE = 220;
const DISCOVERY_CHUNK_SIZE = 4;
const DISCOVERY_REVEAL_RADIUS = 8;

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
  const [discovered, setDiscovered] = useState<Set<string>>(() => new Set());
  const discoveryOwner = useRef<string | null>(null);
  const revision = useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => `${world.revision}:${world.visualRevision}`,
  );
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;

  useEffect(() => {
    const timer = window.setInterval(() => setEnvironment(worldEnvironment()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!player) return;
    if (discoveryOwner.current === player.id) return;
    discoveryOwner.current = player.id;
    setDiscovered(loadDiscovery(player.id));
  }, [player?.id]);

  useEffect(() => {
    // TIBIAGAME_V35_0_1_MINIMAP_NULLABILITY
    // Capture the narrowed map reference before entering the setState callback.
    // TypeScript cannot safely retain a mutable property narrowing for world.map
    // across the closure boundary.
    const map = world.map;
    if (!player || !map || discoveryOwner.current !== player.id) return;
    setDiscovered((current) => {
      const next = new Set(current);
      let changed = false;
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
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
      }
      if (!changed) return current;
      localStorage.setItem(
        `aldoria.minimap-discovery.${player.id}`,
        JSON.stringify([...next]),
      );
      return next;
    });
  }, [
    player?.id,
    player?.position.x,
    player?.position.y,
    player?.position.z,
    world.map?.width,
    world.map?.height,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !player) return;
    drawMinimap(context, world, player.position, radius, discovered);
  }, [
    player?.position.x,
    player?.position.y,
    player?.position.z,
    radius,
    revision,
    world,
    discovered,
  ]);

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

function drawMinimap(
  context: CanvasRenderingContext2D,
  world: WorldState,
  center: Position,
  radius: number,
  discovered: ReadonlySet<string>,
) {
  const map = world.map;
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

  if (map) {
    // Explicitly paint every minimap cell first. This makes both fog-of-war and
    // the real finite world boundary impossible to confuse with grass.
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

    for (const position of map.blocked) tile(position, "#263128");
    for (const entry of map.terrainMaterials) {
      const color = entry.material === "packed_earth"
        ? "#76583b"
        : entry.material === "moss_stone"
          ? "#4d5740"
          : "#b6915d";
      tile(entry.position, color);
    }
    for (const position of map.floors) tile(position, "#735337");
    for (const position of map.roads) tile(position, "#8f8775");
    for (const position of map.water) tile(position, "#246779");
    for (const position of map.bridges) tile(position, "#a16d3d");

    for (const building of map.buildings) {
      if (building.floor !== center.z) continue;
      for (let y = building.y; y < building.y + building.height; y += 1) {
        for (let x = building.x; x < building.x + building.width; x += 1) {
          tile(
            { x, y, z: building.floor },
            building.kind === "keep" ? "#949b98" : "#b38258",
          );
        }
      }
    }

    for (const position of map.houseWalls) tile(position, "#d7ae72", scale * 0.7);
    for (const position of map.castleWalls) tile(position, "#d0d7d3", scale * 0.75);
    for (const position of map.trees) dot(position, "#153f21", Math.max(1.5, scale * 0.55));
    for (const door of map.doors) dot(door.position, door.open ? "#8ee0b0" : "#ffd166", 2.7);
    for (const object of map.objects ?? []) drawObject(dot, object);

    // Draw the exact finite map boundary when any edge enters this minimap view.
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
