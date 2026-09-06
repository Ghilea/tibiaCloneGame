import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type { Position } from "../protocol";
import type { WorldState } from "./WorldState";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 620;

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  center: Position;
};

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
  const [scale, setScale] = useState(10);
  const [center, setCenter] = useState<Position>(
    () => player?.position ?? { x: 0, y: 0, z: 7 },
  );

  const revision = useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => `${world.revision}:${world.visualRevision}`,
  );

  useEffect(() => {
    if (!player) return;
    setCenter((current) =>
      current.z === player.position.z
        ? current
        : { ...player.position },
    );
  }, [player?.position.z]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !player) return;
    drawWorldMap(context, world, center, scale, player.position);
  }, [world, revision, center, scale, player?.position.x, player?.position.y, player?.position.z]);

  const reset = () => {
    if (player) setCenter({ ...player.position });
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
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCenter({
      x: drag.center.x - (event.clientX - drag.x) / scale,
      y: drag.center.y - (event.clientY - drag.y) / scale,
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
    const factor = event.deltaY > 0 ? 0.84 : 1.18;
    setScale((current) => Math.max(3, Math.min(28, current * factor)));
  };

  return (
    <section className="world-map-layer" role="dialog" aria-modal="true" aria-label="World map">
      <article className="world-map-card">
        <header>
          <span>
            <small>World map</small>
            <strong>{player?.position.z === 7 ? "The First Marches" : `Floor ${player?.position.z ?? center.z}`}</strong>
          </span>
          <div>
            <button type="button" onClick={reset}>Center player</button>
            <button type="button" className="world-map-close" onClick={onClose} aria-label="Close world map">×</button>
          </div>
        </header>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onWheel={wheel}
        />
        <footer>
          <span>Drag to pan · Mouse wheel to zoom · M / Esc to close</span>
          <b>{player ? `${player.position.x}, ${player.position.y}, z${player.position.z}` : "—"}</b>
        </footer>
      </article>
    </section>
  );
}

function drawWorldMap(
  context: CanvasRenderingContext2D,
  world: WorldState,
  center: Position,
  scale: number,
  player: Position,
) {
  const map = world.map;
  const width = context.canvas.width;
  const height = context.canvas.height;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const floor = player.z;

  const screen = (position: Position) => ({
    x: halfWidth + (position.x + 0.5 - center.x) * scale,
    y: halfHeight + (position.y + 0.5 - center.y) * scale,
  });

  const visible = (position: Position) =>
    position.z === floor
    && Math.abs(position.x - center.x) <= width / scale / 2 + 3
    && Math.abs(position.y - center.y) <= height / scale / 2 + 3;

  const tile = (position: Position, color: string, size = scale + 0.4) => {
    if (!visible(position)) return;
    const point = screen(position);
    context.fillStyle = color;
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  };

  const dot = (position: Position, color: string, radius: number) => {
    if (!visible(position)) return;
    const point = screen(position);
    context.beginPath();
    context.fillStyle = color;
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  };

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#070a08";
  context.fillRect(0, 0, width, height);

  if (map) {
    for (const entry of map.terrainMaterials) {
      tile(
        entry.position,
        entry.material === "mud"
          ? "#5c4939"
          : entry.material === "marsh_grass"
            ? "#435c3b"
            : entry.material === "wood_planks"
              ? "#7b5b3d"
              : "#5d5d4e",
      );
    }
    for (const position of map.floors) tile(position, "#6b5948");
    for (const position of map.roads) tile(position, "#8a8376");
    for (const position of map.bridges) tile(position, "#8b623d");
    for (const position of map.water) tile(position, "#225d70");
    for (const position of map.blocked) tile(position, "#303833", Math.max(2, scale * 0.7));

    for (const building of map.buildings) {
      if (building.floor !== floor) continue;
      const topLeft = screen({ x: building.x, y: building.y, z: floor });
      context.fillStyle = building.kind === "keep" ? "#909998" : "#a47450";
      context.fillRect(
        topLeft.x - scale / 2,
        topLeft.y - scale / 2,
        building.width * scale,
        building.height * scale,
      );
      if (scale >= 8) {
        context.fillStyle = "#f0dfbd";
        context.font = `${Math.max(9, Math.min(13, scale))}px system-ui`;
        context.fillText(building.name, topLeft.x, topLeft.y - 4);
      }
    }

    for (const position of map.trees) dot(position, "#1c4829", Math.max(1.5, scale * 0.25));
    for (const door of map.doors) dot(door.position, "#e5b65e", Math.max(2, scale * 0.18));
  }

  for (const node of world.resourceNodes.values()) {
    if (node.available) dot(node.position, "#c57c45", Math.max(2, scale * 0.2));
  }
  for (const npc of world.npcs.values()) {
    dot(npc.position, "#b997e8", Math.max(2.5, scale * 0.22));
  }

  const playerPoint = screen(player);
  context.beginPath();
  context.fillStyle = "#f7e3a8";
  context.arc(playerPoint.x, playerPoint.y, Math.max(4, scale * 0.32), 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#261d12";
  context.lineWidth = 2;
  context.stroke();
}
