import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Position, WorldObjectView } from "../protocol";
import type { WorldState } from "./WorldState";
import { worldEnvironment, worldTimeLabel } from "./worldEnvironment";

const CANVAS_SIZE = 220;

export function GameMinimap({ world }: { world: WorldState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [radius, setRadius] = useState(22);
  const [environment, setEnvironment] = useState(() => worldEnvironment());
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
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !player) return;
    drawMinimap(context, world, player.position, radius);
  }, [player?.position.x, player?.position.y, player?.position.z, radius, revision, world]);

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

function drawMinimap(context: CanvasRenderingContext2D, world: WorldState, center: Position, radius: number) {
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
  const tile = (position: Position, color: string, size = scale + 0.6) => {
    if (!visible(position)) return;
    const point = toCanvas(position);
    context.fillStyle = color;
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  };
  const dot = (position: Position, color: string, size: number) => {
    if (!visible(position)) return;
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
  context.fillStyle = "#344b35";
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (map) {
    for (const position of map.blocked) tile(position, "#263128");
    for (const entry of map.terrainMaterials) {
      const color = entry.material === "packed_earth" ? "#76583b" : entry.material === "moss_stone" ? "#4d5740" : "#b6915d";
      tile(entry.position, color);
    }
    for (const position of map.floors) tile(position, "#735337");
    for (const position of map.roads) tile(position, "#8f8775");
    for (const position of map.water) tile(position, "#246779");
    for (const position of map.bridges) tile(position, "#a16d3d");
    for (const building of map.buildings) {
      if (building.floor !== center.z) continue;
      const topLeft = toCanvas({ x: building.x, y: building.y, z: building.floor });
      context.fillStyle = building.kind === "keep" ? "#949b98" : "#b38258";
      context.fillRect(
        topLeft.x - scale / 2,
        topLeft.y - scale / 2,
        Math.max(scale, building.width * scale),
        Math.max(scale, building.height * scale),
      );
    }
    for (const position of map.houseWalls) tile(position, "#d7ae72", scale * 0.7);
    for (const position of map.castleWalls) tile(position, "#d0d7d3", scale * 0.75);
    for (const position of map.trees) dot(position, "#153f21", Math.max(1.5, scale * 0.55));
    for (const door of map.doors) dot(door.position, door.open ? "#8ee0b0" : "#ffd166", 2.7);
    for (const object of map.objects ?? []) drawObject(dot, object);
  }

  for (const node of world.resourceNodes.values()) dot(node.position, "#d37c45", 2.2);
  for (const npc of world.npcs.values()) dot(npc.position, "#f2d36e", 2.5);
  for (const creature of world.creatures.values()) dot(creature.position, creature.id === world.attackTargetId ? "#fff2a0" : "#df554a", creature.id === world.attackTargetId ? 3.8 : 2.6);
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
  // Facing 4 is north; canvas rotation increases clockwise.
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
  }
}
