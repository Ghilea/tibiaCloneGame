import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BuildingView, DoorView, NpcView, Position, StairView, TerrainMaterialId, TerrainMaterialView } from "../protocol";
import { waterEdgesAt } from "../game/WaterEdges";

type PaintLayer = "erase" | "blocked" | "water" | "bridges" | "trees" | "roads" | "floors" | "packed_earth" | "moss_stone" | "sandstone" | "houseWalls" | "castleWalls" | "house" | "keep" | "removeBuilding" | "door" | "window" | "torch" | "stairs" | "spawn" | "npc" | "playerSpawn";
type ToolGroup = "navigate" | "terrain" | "structures" | "entities";
type SpawnView = { id: string; definitionId: string; position: Position };
type EditorDrag = { kind: "playerSpawn" } | { kind: "door"; id: string } | { kind: "window"; position: Position } | { kind: "torch"; position: Position } | { kind: "stairs"; id: string } | { kind: "spawn"; id: string } | { kind: "npc"; id: string } | { kind: "building"; id: string; offsetX: number; offsetY: number };
type EditorDocument = {
  version: 1; name: string; width: number; height: number; floor: number;
  blocked: Position[]; water: Position[]; bridges: Position[]; trees: Position[]; roads: Position[]; floors: Position[];
  houseWalls: Position[]; castleWalls: Position[]; buildings: BuildingView[];
  windows: Position[]; torches: Position[]; terrainMaterials: TerrainMaterialView[];
  doors: DoorView[]; stairs: StairView[]; spawns: SpawnView[];
  playerSpawn: Position;
  npcs: NpcView[];
};

const tileLayers = ["blocked", "water", "bridges", "trees", "roads", "floors", "houseWalls", "castleWalls"] as const;
const toolGroups: { id: ToolGroup; label: string }[] = [
  { id: "navigate", label: "Select" }, { id: "terrain", label: "Terrain" }, { id: "structures", label: "Build" }, { id: "entities", label: "Life" },
];
const tools: { id: PaintLayer; label: string; swatch: string; group: ToolGroup; description: string }[] = [
  { id: "erase", label: "Erase", swatch: "#171b19", group: "navigate", description: "Paint over tiles and objects to remove them." },
  { id: "roads", label: "Road", swatch: "#716b5f", group: "terrain", description: "Paint walkable cobblestone roads." },
  { id: "floors", label: "Floor", swatch: "#805d3e", group: "terrain", description: "Paint authored floors, including upper and lower levels." },
  { id: "water", label: "Water", swatch: "#245b65", group: "terrain", description: "Paint animated water with automatic shores and collision." },
  { id: "bridges", label: "Bridge", swatch: "#8b6039", group: "terrain", description: "Paint a walkable wooden crossing over existing water." },
  { id: "blocked", label: "Collision", swatch: "#bf4d45", group: "terrain", description: "Mark terrain as impassable without adding a visible object." },
  { id: "packed_earth", label: "Packed earth", swatch: "#76583b", group: "terrain", description: "Paint a compacted earthen terrain material." },
  { id: "moss_stone", label: "Moss stone", swatch: "#4d5740", group: "terrain", description: "Paint old damp flagstones with mossy joints." },
  { id: "sandstone", label: "Sandstone", swatch: "#c9a66c", group: "terrain", description: "Paint warm worn sandstone paving." },
  { id: "trees", label: "Oak tree", swatch: "#47733d", group: "entities", description: "Plant a full-sized oak with automatic collision." },
  { id: "house", label: "House", swatch: "#b9875d", group: "structures", description: "Place a complete timber house using the selected size." },
  { id: "keep", label: "Keep", swatch: "#818b87", group: "structures", description: "Place a complete fortified stone building." },
  { id: "houseWalls", label: "House wall", swatch: "#9a7654", group: "structures", description: "Paint individual timber-and-plaster wall sections." },
  { id: "castleWalls", label: "Castle wall", swatch: "#67706d", group: "structures", description: "Paint individual fortified stone wall sections." },
  { id: "door", label: "Door", swatch: "#c68b4d", group: "structures", description: "Cut a synchronized door into a wall opening." },
  { id: "window", label: "Window", swatch: "#78b8c9", group: "structures", description: "Add a glazed window to a house wall section." },
  { id: "torch", label: "Torch", swatch: "#ef8b35", group: "structures", description: "Place an animated wall torch and local light source." },
  { id: "stairs", label: "Stairs", swatch: "#d7c18e", group: "structures", description: "Connect this tile to another floor." },
  { id: "removeBuilding", label: "Remove building", swatch: "#5c3030", group: "structures", description: "Remove a complete house or keep in one click." },
  { id: "playerSpawn", label: "Player start", swatch: "#f1d16f", group: "entities", description: "Choose the authoritative starting position for players." },
  { id: "npc", label: "NPC", swatch: "#5fc4ad", group: "entities", description: "Place an editable NPC or select an existing one." },
  { id: "spawn", label: "Creature", swatch: "#9b5fd0", group: "entities", description: "Place a server-authoritative creature spawn." },
];
const creatureIds = ["castle_rat", "crypt_guard", "bone_acolyte", "cellar_warden", "mireling", "mire_skulker", "reed_stalker", "fen_brute"];
const itemIds = ["blank_rune", "ember_rune", "traveler_blade", "ashwood_bow", "rough_arrow", "field_backpack", "mire_fiber", "gold_coin", "bog_ichor", "reed_hide", "fen_tusk"];
const spellIds = ["ember_bolt"];
const VIEW_COLUMNS = 40;
const VIEW_ROWS = 28;
const PAN_STEP = 20;
const MAX_WORLD_SIZE = 16_384;
const ISO_TILE_WIDTH = 48;
const ISO_TILE_HEIGHT = 28;

function blankDocument(): EditorDocument {
  return { version: 1, name: "New Aldoria Region", width: 32, height: 24, floor: 7, blocked: [], water: [], bridges: [], trees: [], roads: [], floors: [], houseWalls: [], castleWalls: [], windows: [], torches: [], terrainMaterials: [], buildings: [], doors: [], stairs: [], spawns: [], playerSpawn: { x: 1, y: 1, z: 7 }, npcs: [] };
}
const key = (position: Position) => `${position.x}:${position.y}:${position.z}`;
const same = (left: Position, right: Position) => left.x === right.x && left.y === right.y && left.z === right.z;
const saveLocal = (document: EditorDocument) => { try { localStorage.setItem("aldoria-world-editor", JSON.stringify(document)); } catch { /* Large maps can exceed browser storage; JSON export remains available. */ } };

export function WorldEditor() {
  const [document, setDocument] = useState<EditorDocument>(() => loadLocal());
  const documentRef = useRef(document);
  const [tool, setTool] = useState<PaintLayer>("roads");
  const [toolGroup, setToolGroup] = useState<ToolGroup>("terrain");
  const [activeFloor, setActiveFloor] = useState(7);
  const [destinationFloor, setDestinationFloor] = useState(8);
  const [creatureId, setCreatureId] = useState("castle_rat");
  const [npcService, setNpcService] = useState<NpcView["service"]>("shop");
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [buildingWidth, setBuildingWidth] = useState(6);
  const [buildingHeight, setBuildingHeight] = useState(5);
  const [worldWidth, setWorldWidth] = useState(document.width);
  const [worldHeight, setWorldHeight] = useState(document.height);
  const [viewX, setViewX] = useState(0);
  const [viewY, setViewY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<EditorDocument[]>([]);
  const [future, setFuture] = useState<EditorDocument[]>([]);
  const lastPainted = useRef("");
  const panGesture = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const editorDrag = useRef<EditorDrag | null>(null);
  const [dragTarget, setDragTarget] = useState<Position | null>(null);
  const layerSets = useMemo(() => Object.fromEntries(tileLayers.map((layer) => [layer, new Set(document[layer].filter((tile) => tile.z === activeFloor).map(key))])) as Record<(typeof tileLayers)[number], Set<string>>, [document, activeFloor]);
  const spawnByTile = useMemo(() => new Map(document.spawns.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.spawns, activeFloor]);
  const doorByTile = useMemo(() => new Map(document.doors.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.doors, activeFloor]);
  const stairsByTile = useMemo(() => new Map(document.stairs.filter((entry) => entry.from.z === activeFloor).map((entry) => [key(entry.from), entry])), [document.stairs, activeFloor]);
  const npcByTile = useMemo(() => new Map(document.npcs.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.npcs, activeFloor]);
  const windows = useMemo(() => new Set(document.windows.filter((entry) => entry.z === activeFloor).map(key)), [document.windows, activeFloor]);
  const torches = useMemo(() => new Set(document.torches.filter((entry) => entry.z === activeFloor).map(key)), [document.torches, activeFloor]);
  const terrainByTile = useMemo(() => new Map(document.terrainMaterials.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry.material])), [document.terrainMaterials, activeFloor]);
  const viewportX = Math.max(0, Math.min(viewX, Math.max(0, document.width - VIEW_COLUMNS)));
  const viewportY = Math.max(0, Math.min(viewY, Math.max(0, document.height - VIEW_ROWS)));
  const visibleWidth = Math.min(VIEW_COLUMNS, document.width - viewportX);
  const visibleHeight = Math.min(VIEW_ROWS, document.height - viewportY);
  const waterEdgeClasses = (position: Position) => waterEdgesAt(
    position.x, position.y, document.width, document.height,
    (x, y) => layerSets.water.has(key({ x, y, z: position.z })),
    (x, y) => layerSets.blocked.has(key({ x, y, z: position.z })) && !layerSets.water.has(key({ x, y, z: position.z })),
  ).map((edge) => `water-${edge.kind}-${edge.side}`).join(" ");

  useEffect(() => {
    setViewX((value) => Math.max(0, Math.min(value, Math.max(0, document.width - VIEW_COLUMNS))));
    setViewY((value) => Math.max(0, Math.min(value, Math.max(0, document.height - VIEW_ROWS))));
  }, [document.width, document.height]);

  const commit = (next: EditorDocument, recordHistory = true) => {
    if (recordHistory) setHistory((entries) => [...entries.slice(-19), documentRef.current]);
    setFuture([]); documentRef.current = next; setDocument(next);
    if (recordHistory) saveLocal(next);
  };
  const paint = (x: number, y: number, dragging = false) => {
    const position = { x, y, z: activeFloor }; const positionKey = key(position);
    if (dragging && lastPainted.current === positionKey) return;
    lastPainted.current = positionKey;
    const source = documentRef.current; const next = structuredClone(source);
    if (tool === "erase") {
      for (const layer of tileLayers) next[layer] = next[layer].filter((tile) => !same(tile, position));
      next.doors = next.doors.filter((entry) => !same(entry.position, position)); next.spawns = next.spawns.filter((entry) => !same(entry.position, position)); next.stairs = next.stairs.filter((entry) => !same(entry.from, position));
      next.windows = next.windows.filter((entry) => !same(entry, position)); next.torches = next.torches.filter((entry) => !same(entry, position)); next.terrainMaterials = next.terrainMaterials.filter((entry) => !same(entry.position, position));
    } else if (tool === "removeBuilding") {
      const building = next.buildings.find((entry) => entry.floor === activeFloor && x >= entry.x && y >= entry.y && x < entry.x + entry.width && y < entry.y + entry.height);
      if (!building) return;
      const inside = (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height;
      next.buildings = next.buildings.filter((entry) => entry.id !== building.id);
      next.houseWalls = next.houseWalls.filter((tile) => !inside(tile)); next.castleWalls = next.castleWalls.filter((tile) => !inside(tile)); next.floors = next.floors.filter((tile) => !inside(tile)); next.blocked = next.blocked.filter((tile) => !inside(tile)); next.doors = next.doors.filter((entry) => !inside(entry.position));
      next.windows = next.windows.filter((entry) => !inside(entry)); next.torches = next.torches.filter((entry) => !inside(entry));
    } else if (tool === "bridges") {
      if (!next.water.some((tile) => same(tile, position))) return;
      if (!next.bridges.some((tile) => same(tile, position))) next.bridges.push(position);
      next.blocked = next.blocked.filter((tile) => !same(tile, position));
      next.houseWalls = next.houseWalls.filter((tile) => !same(tile, position));
      next.castleWalls = next.castleWalls.filter((tile) => !same(tile, position));
      next.trees = next.trees.filter((tile) => !same(tile, position));
    } else if (tool === "trees") {
      const insideBuilding = next.buildings.some((entry) => entry.floor === activeFloor && x >= entry.x && y >= entry.y && x < entry.x + entry.width && y < entry.y + entry.height);
      if (insideBuilding || next.water.some((tile) => same(tile, position)) || next.houseWalls.some((tile) => same(tile, position)) || next.castleWalls.some((tile) => same(tile, position))) return;
      if (!next.trees.some((tile) => same(tile, position))) next.trees.push(position);
      if (!next.blocked.some((tile) => same(tile, position))) next.blocked.push(position);
      next.bridges = next.bridges.filter((tile) => !same(tile, position));
    } else if ((tileLayers as readonly string[]).includes(tool)) {
      const layer = tool as (typeof tileLayers)[number];
      if (!next[layer].some((tile) => same(tile, position))) next[layer].push(position);
      if (["water", "houseWalls", "castleWalls"].includes(layer) && !next.blocked.some((tile) => same(tile, position))) next.blocked.push(position);
      if (["blocked", "houseWalls", "castleWalls"].includes(layer)) next.bridges = next.bridges.filter((tile) => !same(tile, position));
    } else if (["packed_earth", "moss_stone", "sandstone"].includes(tool)) {
      next.terrainMaterials = next.terrainMaterials.filter((entry) => !same(entry.position, position));
      next.terrainMaterials.push({ position, material: tool as TerrainMaterialId });
    } else if (tool === "door" && !next.doors.some((entry) => same(entry.position, position))) {
      next.houseWalls = next.houseWalls.filter((tile) => !same(tile, position)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, position)); next.trees = next.trees.filter((tile) => !same(tile, position)); next.blocked = next.blocked.filter((tile) => !same(tile, position));
      next.windows = next.windows.filter((entry) => !same(entry, position));
      next.doors.push({ id: `door_${activeFloor}_${x}_${y}`, position, open: true });
    } else if (tool === "window" && !next.windows.some((entry) => same(entry, position))) {
      const onHouseWall = next.houseWalls.some((tile) => same(tile, position)) || next.buildings.some((building) => building.kind === "house" && building.floor === activeFloor
        && x >= building.x && y >= building.y && x < building.x + building.width && y < building.y + building.height
        && (x === building.x || y === building.y || x === building.x + building.width - 1 || y === building.y + building.height - 1));
      if (!onHouseWall || next.doors.some((entry) => same(entry.position, position))) return;
      next.windows.push(position);
    } else if (tool === "torch" && !next.torches.some((entry) => same(entry, position))) {
      if (next.water.some((tile) => same(tile, position))) return;
      next.torches.push(position);
    } else if (tool === "stairs" && !next.stairs.some((entry) => same(entry.from, position))) {
      next.stairs.push({ id: `stairs_${activeFloor}_${x}_${y}_to_${destinationFloor}`, from: position, to: { x, y, z: destinationFloor } });
    } else if (tool === "spawn" && !next.blocked.some((tile) => same(tile, position)) && !same(next.playerSpawn, position) && !next.npcs.some((entry) => same(entry.position, position)) && !next.spawns.some((entry) => same(entry.position, position))) {
      next.spawns.push({ id: `spawn_${activeFloor}_${x}_${y}`, definitionId: creatureId, position });
    } else if (tool === "npc") {
      const existing = next.npcs.find((entry) => same(entry.position, position));
      if (existing) { setSelectedNpcId(existing.id); return; }
      if (next.blocked.some((tile) => same(tile, position)) || same(next.playerSpawn, position) || next.spawns.some((entry) => same(entry.position, position))) return;
      const id = `npc_${activeFloor}_${x}_${y}`;
      next.npcs.push({ id, name: "New NPC", title: "Greyhaven Citizen", service: npcService, dialogue: "Greetings, traveler.", position, offers: [], spellIds: [] });
      setSelectedNpcId(id);
    } else if (tool === "playerSpawn") {
      next.playerSpawn = position;
      next.blocked = next.blocked.filter((tile) => !same(tile, position)); next.water = next.water.filter((tile) => !same(tile, position)); next.bridges = next.bridges.filter((tile) => !same(tile, position)); next.trees = next.trees.filter((tile) => !same(tile, position)); next.houseWalls = next.houseWalls.filter((tile) => !same(tile, position)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, position)); next.doors = next.doors.filter((door) => !same(door.position, position)); next.spawns = next.spawns.filter((spawn) => !same(spawn.position, position)); next.npcs = next.npcs.filter((npc) => !same(npc.position, position));
      if (activeFloor !== next.floor && !next.floors.some((tile) => same(tile, position))) next.floors.push(position);
    } else if ((tool === "house" || tool === "keep") && !next.buildings.some((entry) => entry.x === x && entry.y === y && entry.floor === activeFloor)) {
      const width = Math.min(buildingWidth, source.width - x); const height = Math.min(buildingHeight, source.height - y);
      if (width < 3 || height < 3) return;
      next.trees = next.trees.filter((tile) => tile.z !== activeFloor || tile.x < x || tile.y < y || tile.x >= x + width || tile.y >= y + height);
      next.buildings.push({ id: `${tool}_${activeFloor}_${x}_${y}`, name: tool === "keep" ? "New Keep" : "New House", kind: tool, x, y, width, height, floor: activeFloor });
      const wallLayer = tool === "keep" ? "castleWalls" : "houseWalls";
      for (let tileY = y; tileY < y + height; tileY += 1) for (let tileX = x; tileX < x + width; tileX += 1) {
        const tile = { x: tileX, y: tileY, z: activeFloor }; const perimeter = tileX === x || tileY === y || tileX === x + width - 1 || tileY === y + height - 1;
        if (!next.floors.some((entry) => same(entry, tile))) next.floors.push(tile);
        if (perimeter) { if (!next[wallLayer].some((entry) => same(entry, tile))) next[wallLayer].push(tile); if (!next.blocked.some((entry) => same(entry, tile))) next.blocked.push(tile); }
      }
    }
    commit(next, !dragging);
  };
  const restore = (next: EditorDocument) => { documentRef.current = next; setDocument(next); saveLocal(next); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [documentRef.current, ...items]); setHistory((items) => items.slice(0, -1)); restore(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, documentRef.current]); setFuture((items) => items.slice(1)); restore(next); };
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.code === "Space" && !editing) { event.preventDefault(); window.document.body.classList.add("editor-space-pan"); }
      if (!editing && event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (!editing && event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (!editing && event.key === "Escape") setSelectedNpcId(null);
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") window.document.body.classList.remove("editor-space-pan"); };
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp);
    return () => { window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.document.body.classList.remove("editor-space-pan"); };
  }, [history, future]);
  const exportWorld = () => { const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }); const anchor = Object.assign(window.document.createElement("a"), { href: URL.createObjectURL(blob), download: `${document.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.world.json` }); anchor.click(); URL.revokeObjectURL(anchor.href); };
  const importWorld = async (file?: File) => { if (!file) return; const parsed = normalizeDocument(JSON.parse(await file.text()) as EditorDocument); if (parsed.version !== 1 || !Array.isArray(parsed.blocked) || !Array.isArray(parsed.spawns) || parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_WORLD_SIZE || parsed.height > MAX_WORLD_SIZE) throw new Error("Unsupported world document"); commit(parsed); setActiveFloor(parsed.floor); setWorldWidth(parsed.width); setWorldHeight(parsed.height); setViewX(0); setViewY(0); };
  const resizeWorld = () => {
    const width = Number.isFinite(worldWidth) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldWidth))) : document.width; const height = Number.isFinite(worldHeight) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldHeight))) : document.height;
    const inBounds = (position: Position) => position.x >= 0 && position.y >= 0 && position.x < width && position.y < height;
    const removed = tileLayers.reduce((count, layer) => count + document[layer].filter((tile) => !inBounds(tile)).length, 0)
      + document.doors.filter((entry) => !inBounds(entry.position)).length + document.stairs.filter((entry) => !inBounds(entry.from) || !inBounds(entry.to)).length
      + document.spawns.filter((entry) => !inBounds(entry.position)).length + document.buildings.filter((entry) => entry.x < 0 || entry.y < 0 || entry.x + entry.width > width || entry.y + entry.height > height).length
      + document.npcs.filter((entry) => !inBounds(entry.position)).length + document.windows.filter((entry) => !inBounds(entry)).length
      + document.torches.filter((entry) => !inBounds(entry)).length + document.terrainMaterials.filter((entry) => !inBounds(entry.position)).length
      + (inBounds(document.playerSpawn) ? 0 : 1);
    if (removed > 0 && !window.confirm(`Shrinking the world removes ${removed} out-of-bounds entries. Continue?`)) return;
    const next = structuredClone(document); next.width = width; next.height = height;
    for (const layer of tileLayers) next[layer] = next[layer].filter(inBounds);
    next.doors = next.doors.filter((entry) => inBounds(entry.position)); next.stairs = next.stairs.filter((entry) => inBounds(entry.from) && inBounds(entry.to)); next.spawns = next.spawns.filter((entry) => inBounds(entry.position)); next.npcs = next.npcs.filter((entry) => inBounds(entry.position)); next.buildings = next.buildings.filter((entry) => entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= width && entry.y + entry.height <= height);
    next.windows = next.windows.filter(inBounds); next.torches = next.torches.filter(inBounds); next.terrainMaterials = next.terrainMaterials.filter((entry) => inBounds(entry.position));
    if (!inBounds(next.playerSpawn)) next.playerSpawn = firstSafeBaseTile(next);
    setWorldWidth(width); setWorldHeight(height); commit(next);
  };
  const panTo = (x: number, y: number) => { const nextX = Number.isFinite(x) ? Math.trunc(x) : viewportX; const nextY = Number.isFinite(y) ? Math.trunc(y) : viewportY; setViewX(Math.max(0, Math.min(nextX, Math.max(0, document.width - VIEW_COLUMNS)))); setViewY(Math.max(0, Math.min(nextY, Math.max(0, document.height - VIEW_ROWS)))); };
  const newWorld = () => { const next = blankDocument(); setWorldWidth(next.width); setWorldHeight(next.height); setActiveFloor(next.floor); setViewX(0); setViewY(0); commit(next); };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => { const spacePan = window.document.body.classList.contains("editor-space-pan"); if (event.button !== 1 && event.button !== 2 && !(event.button === 0 && spacePan)) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewportX, originY: viewportY }; };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => { const gesture = panGesture.current; if (!gesture || gesture.pointerId !== event.pointerId) return; const screenX = event.clientX - gesture.startX; const screenY = event.clientY - gesture.startY; const halfWidth = ISO_TILE_WIDTH * zoom / 2; const halfHeight = ISO_TILE_HEIGHT * zoom / 2; const tileX = (screenX / halfWidth + screenY / halfHeight) / 2; const tileY = (-screenX / halfWidth + screenY / halfHeight) / 2; panTo(gesture.originX - Math.round(tileX), gesture.originY - Math.round(tileY)); };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (panGesture.current?.pointerId !== event.pointerId) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); panGesture.current = null; };
  const objectAt = (position: Position): EditorDrag | null => { if (same(document.playerSpawn, position)) return { kind: "playerSpawn" }; const npc = npcByTile.get(key(position)); if (npc) return { kind: "npc", id: npc.id }; const door = doorByTile.get(key(position)); if (door) return { kind: "door", id: door.id }; if (windows.has(key(position))) return { kind: "window", position }; if (torches.has(key(position))) return { kind: "torch", position }; const stairs = stairsByTile.get(key(position)); if (stairs) return { kind: "stairs", id: stairs.id }; const spawn = spawnByTile.get(key(position)); if (spawn) return { kind: "spawn", id: spawn.id }; const building = document.buildings.find((entry) => entry.floor === position.z && position.x >= entry.x && position.y >= entry.y && position.x < entry.x + entry.width && position.y < entry.y + entry.height && (position.x === entry.x || position.y === entry.y || position.x === entry.x + entry.width - 1 || position.y === entry.y + entry.height - 1)); return building ? { kind: "building", id: building.id, offsetX: position.x - building.x, offsetY: position.y - building.y } : null; };
  const startObjectDrag = (event: ReactDragEvent, object: EditorDrag | null) => { if (!object) { event.preventDefault(); return; } editorDrag.current = object; setDragTarget(null); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", `${object.kind}:${"id" in object ? object.id : "object"}`); };
  const moveObject = (target: Position) => {
    const dragged = editorDrag.current; if (!dragged) return; const next = structuredClone(documentRef.current);
    if (dragged.kind === "playerSpawn") { next.playerSpawn = target; next.blocked = next.blocked.filter((tile) => !same(tile, target)); next.water = next.water.filter((tile) => !same(tile, target)); next.bridges = next.bridges.filter((tile) => !same(tile, target)); next.trees = next.trees.filter((tile) => !same(tile, target)); next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.doors = next.doors.filter((door) => !same(door.position, target)); next.spawns = next.spawns.filter((spawn) => !same(spawn.position, target)); next.npcs = next.npcs.filter((npc) => !same(npc.position, target)); if (target.z !== next.floor && !next.floors.some((tile) => same(tile, target))) next.floors.push(target); }
    else if (dragged.kind === "door") { const door = next.doors.find((entry) => entry.id === dragged.id); if (!door || next.doors.some((entry) => entry.id !== door.id && same(entry.position, target))) return; door.position = target; next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.trees = next.trees.filter((tile) => !same(tile, target)); next.blocked = next.blocked.filter((tile) => !same(tile, target)); }
    else if (dragged.kind === "window") { const onHouseWall = next.houseWalls.some((tile) => same(tile, target)) || next.buildings.some((building) => building.kind === "house" && building.floor === target.z && target.x >= building.x && target.y >= building.y && target.x < building.x + building.width && target.y < building.y + building.height && (target.x === building.x || target.y === building.y || target.x === building.x + building.width - 1 || target.y === building.y + building.height - 1)); if (!onHouseWall || next.doors.some((entry) => same(entry.position, target))) return; next.windows = next.windows.filter((entry) => !same(entry, dragged.position) && !same(entry, target)); next.windows.push(target); }
    else if (dragged.kind === "torch") { if (next.water.some((tile) => same(tile, target))) return; next.torches = next.torches.filter((entry) => !same(entry, dragged.position) && !same(entry, target)); next.torches.push(target); }
    else if (dragged.kind === "spawn") { const spawn = next.spawns.find((entry) => entry.id === dragged.id); if (!spawn || next.blocked.some((tile) => same(tile, target)) || next.spawns.some((entry) => entry.id !== spawn.id && same(entry.position, target))) return; spawn.position = target; }
    else if (dragged.kind === "npc") { const npc = next.npcs.find((entry) => entry.id === dragged.id); if (!npc || next.blocked.some((tile) => same(tile, target)) || same(next.playerSpawn, target) || next.spawns.some((entry) => same(entry.position, target)) || next.npcs.some((entry) => entry.id !== npc.id && same(entry.position, target))) return; npc.position = target; setSelectedNpcId(npc.id); }
    else if (dragged.kind === "stairs") { const stairs = next.stairs.find((entry) => entry.id === dragged.id); if (!stairs || next.stairs.some((entry) => entry.id !== stairs.id && same(entry.from, target))) return; const dx = target.x - stairs.from.x; const dy = target.y - stairs.from.y; stairs.from = target; stairs.to = { x: stairs.to.x + dx, y: stairs.to.y + dy, z: stairs.to.z }; if (stairs.to.x < 0 || stairs.to.y < 0 || stairs.to.x >= next.width || stairs.to.y >= next.height) return; }
    else { const building = next.buildings.find((entry) => entry.id === dragged.id); if (!building) return; const targetX = target.x - dragged.offsetX; const targetY = target.y - dragged.offsetY; const dx = targetX - building.x; const dy = targetY - building.y; if (targetX < 0 || targetY < 0 || targetX + building.width > next.width || targetY + building.height > next.height) return; const inside = (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height; const structural = new Set([...next.houseWalls, ...next.castleWalls].filter(inside).map(key)); const shifted = (tile: Position) => inside(tile) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile; next.houseWalls = next.houseWalls.map(shifted); next.castleWalls = next.castleWalls.map(shifted); next.floors = next.floors.map(shifted); next.blocked = next.blocked.map((tile) => structural.has(key(tile)) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile); next.doors = next.doors.map((door) => inside(door.position) ? { ...door, position: shifted(door.position) } : door); next.windows = next.windows.map(shifted); next.torches = next.torches.map(shifted); building.x = targetX; building.y = targetY; }
    editorDrag.current = null; setDragTarget(null); commit(next);
  };
  const selectedNpc = selectedNpcId ? document.npcs.find((npc) => npc.id === selectedNpcId) : undefined;
  const activeTool = tools.find((entry) => entry.id === tool) ?? tools[0];
  const updateNpc = (npc: NpcView, recordHistory = false) => { const next = structuredClone(documentRef.current); const index = next.npcs.findIndex((entry) => entry.id === selectedNpcId); if (index < 0) return; next.npcs[index] = npc; setSelectedNpcId(npc.id); if (recordHistory) commit(next); else restore(next); };
  const removeNpc = () => { if (!selectedNpcId) return; const next = structuredClone(documentRef.current); next.npcs = next.npcs.filter((npc) => npc.id !== selectedNpcId); setSelectedNpcId(null); commit(next); };
  const dragPreviewIncludes = (position: Position) => {
    const dragged = editorDrag.current;
    if (!dragged || !dragTarget || position.z !== dragTarget.z) return false;
    if (dragged.kind !== "building") return same(position, dragTarget);
    const building = document.buildings.find((entry) => entry.id === dragged.id);
    if (!building) return false;
    const originX = dragTarget.x - dragged.offsetX; const originY = dragTarget.y - dragged.offsetY;
    return position.x >= originX && position.y >= originY && position.x < originX + building.width && position.y < originY + building.height;
  };
  const continuousTool = (value: PaintLayer) => value === "erase" || (tileLayers as readonly string[]).includes(value)
    || ["packed_earth", "moss_stone", "sandstone"].includes(value);

  return <main className="editor-shell">
    <header><div><p>EMBERS OF ALDORIA</p><h1>World Editor</h1></div><input value={document.name} onChange={(event) => restore({ ...document, name: event.target.value })} /><span>{document.width} x {document.height} / z={activeFloor}</span><a className="editor-back-button" href="/" aria-label="Back to character selection"><b aria-hidden="true">←</b> Back to Characters</a></header>
    <aside className="palette">
      <section className="editor-onboarding"><strong>Build naturally</strong><span>Paint with the active tool. Existing objects are always draggable.</span><small>Drag with the right or middle mouse button to pan from any tool. Hold Space for left-button pan. Ctrl+Z/Y handles undo and redo.</small></section>
      <div className="tool-tabs" role="tablist" aria-label="Tool categories">{toolGroups.map((group) => <button role="tab" aria-selected={toolGroup === group.id} className={toolGroup === group.id ? "active" : ""} key={group.id} onClick={() => { setToolGroup(group.id); setTool(tools.find((entry) => entry.group === group.id)?.id ?? "erase"); }}>{group.label}</button>)}</div>
      <div className="tool-grid">{tools.filter((entry) => entry.group === toolGroup).map((entry) => <button title={entry.description} className={tool === entry.id ? "active" : ""} key={entry.id} onClick={() => setTool(entry.id)}><i style={{ background: entry.swatch }} /><span>{entry.label}</span></button>)}</div>
      <section className="tool-context"><div className="tool-context-title"><i style={{ background: activeTool.swatch }} /><div><strong>{activeTool.label}</strong><span>{activeTool.description}</span></div></div>
        {(tool === "house" || tool === "keep") && <label>Building size<span className="number-pair"><input type="number" min="3" max="20" value={buildingWidth} onChange={(event) => setBuildingWidth(Number(event.target.value))} /><b>x</b><input type="number" min="3" max="20" value={buildingHeight} onChange={(event) => setBuildingHeight(Number(event.target.value))} /></span></label>}
        {tool === "npc" && <label>New NPC service<select value={npcService} onChange={(event) => setNpcService(event.target.value as NpcView["service"])}><option value="shop">Shop</option><option value="depot">Depot</option><option value="spell_trainer">Spell trainer</option></select></label>}
        {tool === "spawn" && <label>Creature<select value={creatureId} onChange={(event) => setCreatureId(event.target.value)}>{creatureIds.map((id) => <option key={id}>{id}</option>)}</select></label>}
        {tool === "stairs" && <label>Stairs lead to<select value={destinationFloor} onChange={(event) => setDestinationFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label>}
      </section>
      {selectedNpc && <NpcInspector npc={selectedNpc} onChange={updateNpc} onRemove={removeNpc} />}
      <details className="world-settings"><summary>World settings</summary><label>Map size (tiles)<span className="number-pair"><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldWidth} onChange={(event) => setWorldWidth(Number(event.target.value))} /><b>x</b><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldHeight} onChange={(event) => setWorldHeight(Number(event.target.value))} /></span></label><button className="resize-button" onClick={resizeWorld}>Apply map size</button><small>Maximum {MAX_WORLD_SIZE.toLocaleString()} × {MAX_WORLD_SIZE.toLocaleString()}. Sparse maps only store authored tiles.</small></details>
    </aside>
    <section className="editor-workspace"><nav><span className="history-controls"><button title="Undo (Ctrl+Z)" disabled={!history.length} onClick={undo}>↶ Undo</button><button title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>↷ Redo</button></span><label>Floor<select value={activeFloor} onChange={(event) => setActiveFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label><span className="pan-controls"><button title="Move view west" onClick={() => panTo(viewportX - PAN_STEP, viewportY)}>←</button><button title="Move view north" onClick={() => panTo(viewportX, viewportY - PAN_STEP)}>↑</button><label>X<input type="number" min="0" max={document.width - 1} value={viewportX} onChange={(event) => panTo(Number(event.target.value), viewportY)} /></label><label>Y<input type="number" min="0" max={document.height - 1} value={viewportY} onChange={(event) => panTo(viewportX, Number(event.target.value))} /></label><button title="Move view south" onClick={() => panTo(viewportX, viewportY + PAN_STEP)}>↓</button><button title="Move view east" onClick={() => panTo(viewportX + PAN_STEP, viewportY)}>→</button></span><label>Zoom<input type="range" min="0.6" max="1.6" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><span className="document-controls"><button onClick={newWorld}>New</button><label className="file-button">Import<input type="file" accept=".json" onChange={(event) => void importWorld(event.target.files?.[0]).catch((error) => alert(error))} /></label><button className="primary" onClick={exportWorld}>Export</button></span></nav>
      <div className="map-scroll" onContextMenu={(event) => event.preventDefault()} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
        <div className="editor-grid isometric" style={{ width: (visibleWidth + visibleHeight) * ISO_TILE_WIDTH * zoom / 2, height: (visibleWidth + visibleHeight) * ISO_TILE_HEIGHT * zoom / 2 }}>
          {Array.from({ length: visibleWidth * visibleHeight }, (_, index) => {
            const column = index % visibleWidth; const row = Math.floor(index / visibleWidth);
            const x = viewportX + column; const y = viewportY + row; const position = { x, y, z: activeFloor }; const tileKey = key(position);
            const spawn = spawnByTile.get(tileKey); const npc = npcByTile.get(tileKey); const door = doorByTile.get(tileKey); const stairs = stairsByTile.get(tileKey);
            const playerSpawn = same(document.playerSpawn, position); const editorObject = objectAt(position); const material = terrainByTile.get(tileKey);
            const classes = tileLayers.filter((layer) => layerSets[layer].has(tileKey)).join(" ");
            return <button
              title={npc ? `${npc.name} — ${npc.title}` : `Tile ${x}, ${y}, floor ${activeFloor}`}
              aria-label={`Tile ${x}, ${y}`}
              draggable={Boolean(editorObject)}
              className={`editor-tile ${classes} ${material ? `material-${material}` : ""} ${waterEdgeClasses(position)} ${playerSpawn ? "player-spawn" : ""} ${npc?.id === selectedNpcId ? "npc-selected" : ""} ${editorObject ? "movable" : ""} ${dragPreviewIncludes(position) ? "drag-preview" : ""}`}
              style={{ width: ISO_TILE_WIDTH * zoom, height: ISO_TILE_HEIGHT * zoom, left: (column - row + visibleHeight - 1) * ISO_TILE_WIDTH * zoom / 2, top: (column + row) * ISO_TILE_HEIGHT * zoom / 2, zIndex: column + row }}
              key={tileKey}
              onDragStart={(event) => startObjectDrag(event, editorObject)}
              onDragOver={(event) => { if (editorDrag.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragTarget(position); } }}
              onDrop={(event) => { event.preventDefault(); moveObject(position); }}
              onDragEnd={() => { editorDrag.current = null; setDragTarget(null); }}
              onPointerDown={(event) => { const panning = window.document.body.classList.contains("editor-space-pan"); if (event.button !== 0 || panning || !continuousTool(tool)) return; paint(x, y); }}
              onClick={() => { if (npc) { setSelectedNpcId(npc.id); return; } if (!continuousTool(tool)) paint(x, y); }}
              onPointerEnter={(event) => { if (event.buttons === 1 && !window.document.body.classList.contains("editor-space-pan") && continuousTool(tool)) paint(x, y, true); }}
              onPointerUp={() => { lastPainted.current = ""; saveLocal(documentRef.current); }}
            >{playerSpawn ? "P" : npc ? "N" : door ? "D" : windows.has(tileKey) ? "W" : torches.has(tileKey) ? "T" : stairs ? (stairs.to.z < activeFloor ? "U" : "D") : spawn ? "C" : ""}</button>;
          })}
        </div>
      </div>
    </section>
    <footer><span>{document.width.toLocaleString()} x {document.height.toLocaleString()} / view {viewportX}-{viewportX + visibleWidth - 1}, {viewportY}-{viewportY + visibleHeight - 1}</span><strong>{tool}</strong><span>{document.blocked.length} blocked / {document.doors.length} doors / {document.windows.length} windows / {document.torches.length} lights / {document.spawns.length} spawns / {document.npcs.length} NPCs</span><small>Only the visible editor window is rendered.</small></footer>
  </main>;
}

function NpcInspector({ npc, onChange, onRemove }: { npc: NpcView; onChange: (npc: NpcView, recordHistory?: boolean) => void; onRemove: () => void }) {
  const [offerItem, setOfferItem] = useState("blank_rune"); const [offerQuantity, setOfferQuantity] = useState(1); const [offerPrice, setOfferPrice] = useState(1);
  const updateOffer = (index: number, patch: Partial<NpcView["offers"][number]>) => onChange({ ...npc, offers: npc.offers.map((offer, offerIndex) => offerIndex === index ? { ...offer, ...patch } : offer) });
  const addOffer = () => { let id = offerItem; let suffix = 2; while (npc.offers.some((offer) => offer.id === id)) id = `${offerItem}_${suffix++}`; onChange({ ...npc, offers: [...npc.offers, { id, itemDefinitionId: offerItem, quantity: Math.max(1, offerQuantity), price: Math.max(1, offerPrice) }] }, true); };
  return <section className="npc-inspector"><hr /><h2>Edit NPC</h2><small>Position {npc.position.x}, {npc.position.y}, {npc.position.z}. Use Move objects to relocate.</small><label>Stable ID<input value={npc.id} maxLength={60} onChange={(event) => onChange({ ...npc, id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></label><label>Name<input value={npc.name} maxLength={40} onChange={(event) => onChange({ ...npc, name: event.target.value })} /></label><label>Title<input value={npc.title} maxLength={80} onChange={(event) => onChange({ ...npc, title: event.target.value })} /></label><label>Service<select value={npc.service} onChange={(event) => { const service = event.target.value as NpcView["service"]; onChange({ ...npc, service, offers: service === "shop" ? npc.offers : [], spellIds: service === "spell_trainer" ? npc.spellIds : [] }, true); }}><option value="shop">Shop</option><option value="depot">Depot</option><option value="spell_trainer">Spell trainer</option></select></label><label>Dialogue<textarea value={npc.dialogue} maxLength={500} rows={4} onChange={(event) => onChange({ ...npc, dialogue: event.target.value })} /></label>
    {npc.service === "shop" && <div className="npc-service-editor"><h3>Shop offers</h3>{npc.offers.map((offer, index) => <div className="offer-editor" key={`${offer.id}-${index}`}><input aria-label="Offer id" value={offer.id} onChange={(event) => updateOffer(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /><select aria-label="Offer item" value={offer.itemDefinitionId} onChange={(event) => updateOffer(index, { itemDefinitionId: event.target.value })}>{itemIds.map((id) => <option key={id}>{id}</option>)}</select><input aria-label="Offer quantity" type="number" min="1" value={offer.quantity} onChange={(event) => updateOffer(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} /><input aria-label="Offer price" type="number" min="1" value={offer.price} onChange={(event) => updateOffer(index, { price: Math.max(1, Number(event.target.value) || 1) })} /><button onClick={() => onChange({ ...npc, offers: npc.offers.filter((_, offerIndex) => offerIndex !== index) }, true)}>Remove</button></div>)}<div className="offer-add"><select value={offerItem} onChange={(event) => setOfferItem(event.target.value)}>{itemIds.map((id) => <option key={id}>{id}</option>)}</select><input title="Quantity" type="number" min="1" value={offerQuantity} onChange={(event) => setOfferQuantity(Math.max(1, Number(event.target.value) || 1))} /><input title="Gold price" type="number" min="1" value={offerPrice} onChange={(event) => setOfferPrice(Math.max(1, Number(event.target.value) || 1))} /><button onClick={addOffer}>Add offer</button></div></div>}
    {npc.service === "spell_trainer" && <div className="npc-service-editor"><h3>Teachable spells</h3>{spellIds.map((spellId) => <label className="spell-toggle" key={spellId}><input type="checkbox" checked={npc.spellIds.includes(spellId)} onChange={(event) => onChange({ ...npc, spellIds: event.target.checked ? [...npc.spellIds, spellId] : npc.spellIds.filter((id) => id !== spellId) }, true)} />{spellId}</label>)}</div>}
    <button className="remove-npc" onClick={onRemove}>Remove NPC</button>
  </section>;
}

function firstSafeBaseTile(document: EditorDocument): Position { const blocked = new Set(document.blocked.filter((tile) => tile.z === document.floor).map(key)); const occupied = new Set([...(document.spawns ?? []).map((entry) => key(entry.position)), ...(document.npcs ?? []).map((entry) => key(entry.position))]); for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) { const position = { x, y, z: document.floor }; if (!blocked.has(key(position)) && !occupied.has(key(position))) return position; } return { x: 0, y: 0, z: document.floor }; }
function normalizeDocument(document: EditorDocument): EditorDocument {
  const normalized = { ...document, bridges: document.bridges ?? [], trees: document.trees ?? [], windows: document.windows ?? [], torches: document.torches ?? [], terrainMaterials: document.terrainMaterials ?? [], npcs: document.npcs ?? [], playerSpawn: document.playerSpawn ?? { x: 0, y: 0, z: document.floor } };
  normalized.buildings = alignHouseBuildingsToWalls(normalized);
  if (!document.playerSpawn) normalized.playerSpawn = firstSafeBaseTile(normalized);
  return normalized;
}

function alignHouseBuildingsToWalls(document: EditorDocument): BuildingView[] {
  const remaining = new Map(document.houseWalls.map((position) => [key(position), position]));
  const wallOrDoor = new Set([...remaining.keys(), ...document.doors.map((door) => key(door.position))]);
  const outlines: { floor: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as Position;
    remaining.delete(key(first));
    const frontier = [first]; const component = [first];
    while (frontier.length) {
      const current = frontier.pop()!;
      for (const adjacent of [{ ...current, x: current.x - 1 }, { ...current, x: current.x + 1 }, { ...current, y: current.y - 1 }, { ...current, y: current.y + 1 }]) {
        const found = remaining.get(key(adjacent));
        if (found) { remaining.delete(key(adjacent)); component.push(found); frontier.push(found); }
      }
    }
    const minX = Math.min(...component.map((position) => position.x)); const maxX = Math.max(...component.map((position) => position.x));
    const minY = Math.min(...component.map((position) => position.y)); const maxY = Math.max(...component.map((position) => position.y));
    if (maxX - minX + 1 < 3 || maxY - minY + 1 < 3) continue;
    let closed = true;
    for (let y = minY; y <= maxY && closed; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const perimeter = x === minX || x === maxX || y === minY || y === maxY;
      if (perimeter && !wallOrDoor.has(key({ x, y, z: first.z }))) { closed = false; break; }
    }
    if (closed) outlines.push({ floor: first.z, minX, minY, maxX, maxY });
  }
  return document.buildings.map((building) => {
    if (building.kind !== "house") return building;
    const currentMaxX = building.x + building.width - 1; const currentMaxY = building.y + building.height - 1;
    const outline = outlines.filter((entry) => entry.floor === building.floor && entry.maxX >= building.x - 1 && entry.minX <= currentMaxX + 1 && entry.maxY >= building.y - 1 && entry.minY <= currentMaxY + 1)
      .sort((left, right) => (Math.abs(left.minX - building.x) + Math.abs(left.minY - building.y) + Math.abs(left.maxX - currentMaxX) + Math.abs(left.maxY - currentMaxY)) - (Math.abs(right.minX - building.x) + Math.abs(right.minY - building.y) + Math.abs(right.maxX - currentMaxX) + Math.abs(right.maxY - currentMaxY)))[0];
    return outline ? { ...building, x: outline.minX, y: outline.minY, width: outline.maxX - outline.minX + 1, height: outline.maxY - outline.minY + 1 } : building;
  });
}
function loadLocal(): EditorDocument { try { const saved = localStorage.getItem("aldoria-world-editor"); return saved ? normalizeDocument(JSON.parse(saved) as EditorDocument) : blankDocument(); } catch { return blankDocument(); } }
