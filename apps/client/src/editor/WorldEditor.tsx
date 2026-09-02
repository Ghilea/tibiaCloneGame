import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BuildingView, DoorView, NpcView, Position, StairView, TerrainMaterialId, TerrainMaterialView, WorldObjectKind, WorldObjectView } from "../protocol";
import { waterEdgesAt } from "../game/WaterEdges";

type PaintLayer = "select" | "blocked" | "water" | "bridges" | "trees" | "roads" | "floors" | "packed_earth" | "moss_stone" | "sandstone" | "houseWalls" | "castleWalls" | "house" | "keep" | "removeBuilding" | "door" | "window" | "torch" | "stairs" | "spawn" | "npc" | "resourceNode" | "playerSpawn" | `object_${WorldObjectKind}`;
type ToolGroup = "navigate" | "terrain" | "structures" | "objects" | "entities";
type SpawnView = { id: string; definitionId: string; position: Position };
type ResourceNodeDocument = { id: string; kind: "copper_vein"; position: Position; respawnMs: number; requiredSkillLevel: number };
type WorldFileHandle = { name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> };
type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<WorldFileHandle> };
type SelectionBounds = { minX: number; minY: number; maxX: number; maxY: number; z: number };
type EditorDrag = { kind: "selection"; bounds: SelectionBounds; origin: Position } | { kind: "playerSpawn" } | { kind: "door"; id: string } | { kind: "window"; position: Position } | { kind: "torch"; position: Position } | { kind: "stairs"; id: string } | { kind: "spawn"; id: string } | { kind: "npc"; id: string } | { kind: "resourceNode"; id: string } | { kind: "building"; id: string; offsetX: number; offsetY: number } | { kind: "tile"; position: Position };
type EditorDocument = {
  version: 1; name: string; width: number; height: number; floor: number;
  blocked: Position[]; water: Position[]; bridges: Position[]; trees: Position[]; roads: Position[]; floors: Position[];
  houseWalls: Position[]; castleWalls: Position[]; buildings: BuildingView[];
  windows: Position[]; torches: Position[]; terrainMaterials: TerrainMaterialView[];
  doors: DoorView[]; stairs: StairView[]; spawns: SpawnView[];
  playerSpawn: Position;
  npcs: NpcView[];
  resourceNodes: ResourceNodeDocument[];
  objects: WorldObjectView[];
};

const tileLayers = ["blocked", "water", "bridges", "trees", "roads", "floors", "houseWalls", "castleWalls"] as const;
const toolGroups: { id: ToolGroup; label: string }[] = [
  { id: "navigate", label: "Select" }, { id: "terrain", label: "Terrain" }, { id: "structures", label: "Build" }, { id: "objects", label: "Object" }, { id: "entities", label: "Life" },
];
const tools: { id: PaintLayer; label: string; swatch: string; group: ToolGroup; description: string }[] = [
  { id: "select", label: "Select", swatch: "#e3bd73", group: "navigate", description: "Drag across tiles to select an area. Drag the area to move it; press Delete to remove it." },
  { id: "roads", label: "Road", swatch: "#716b5f", group: "terrain", description: "Paint walkable cobblestone roads." },
  { id: "floors", label: "Floor", swatch: "#805d3e", group: "terrain", description: "Paint authored floors, including upper and lower levels." },
  { id: "water", label: "Water", swatch: "#245b65", group: "terrain", description: "Paint static water with automatic shores and collision." },
  { id: "bridges", label: "Bridge", swatch: "#8b6039", group: "terrain", description: "Paint a walkable wooden crossing over existing water." },
  { id: "blocked", label: "Collision", swatch: "#bf4d45", group: "terrain", description: "Mark terrain as impassable without adding a visible object." },
  { id: "packed_earth", label: "Packed earth", swatch: "#76583b", group: "terrain", description: "Paint a compacted earthen terrain material." },
  { id: "moss_stone", label: "Moss stone", swatch: "#4d5740", group: "terrain", description: "Paint old damp flagstones with mossy joints." },
  { id: "sandstone", label: "Sandstone", swatch: "#c9a66c", group: "terrain", description: "Paint warm worn sandstone paving." },
  { id: "object_chair", label: "Chair", swatch: "#9d6638", group: "objects", description: "Place a wooden chair." },
  { id: "object_table", label: "Table", swatch: "#704526", group: "objects", description: "Place a solid wooden table." },
  { id: "object_bench", label: "Bench", swatch: "#a66d3f", group: "objects", description: "Place a village bench." },
  { id: "object_well", label: "Well", swatch: "#75817e", group: "objects", description: "Place a stone water well." },
  { id: "object_barrel", label: "Barrel", swatch: "#9e6330", group: "objects", description: "Place a wooden barrel." },
  { id: "object_mountain_wall", label: "Mountain wall", swatch: "#626d70", group: "objects", description: "Place an impassable rocky cliff wall." },
  { id: "object_forest_tree", label: "Forest tree", swatch: "#315d37", group: "objects", description: "Place a broadleaf forest tree." },
  { id: "object_pine_tree", label: "Pine tree", swatch: "#245242", group: "objects", description: "Place a tall pine tree." },
  { id: "object_snowy_pine", label: "Snowy pine", swatch: "#d9e4df", group: "objects", description: "Place a snow-covered pine tree." },
  { id: "object_dirt_path", label: "Dirt path", swatch: "#96734f", group: "objects", description: "Paint a worn country path." },
  { id: "object_snow_ground", label: "Snow ground", swatch: "#e4eee9", group: "objects", description: "Paint crisp snow ground." },
  { id: "object_snow_bank", label: "Snow bank", swatch: "#b9d0d2", group: "objects", description: "Place an impassable snow bank." },
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
  { id: "resourceNode", label: "Copper vein", swatch: "#bd7548", group: "entities", description: "Place a mineable copper vein with configurable respawn and skill requirement." },
];
const creatureIds = ["castle_rat", "crypt_guard", "bone_acolyte", "cellar_warden", "mireling", "mire_skulker", "reed_stalker", "fen_brute"];
const itemIds = ["blank_rune", "ember_rune", "traveler_blade", "ashwood_bow", "rough_arrow", "field_backpack", "mire_fiber", "gold_coin", "field_bread", "smoked_mire_meat", "bog_ichor", "reed_hide", "fen_tusk", "iron_pickaxe", "copper_ore"];
const spellIds = ["ember_bolt"];
const recipeIds = ["mark_ember_sigil", "fletch_rough_arrows", "forge_copper_blade"];
const VIEW_COLUMNS = 40;
const VIEW_ROWS = 28;
const PAN_STEP = 20;
const MAX_WORLD_SIZE = 35_000;
const MAX_LOCAL_AUTOSAVE_ENTRIES = 60_000;
const EDITOR_TILE_SIZE = 32;

function blankDocument(): EditorDocument {
  return { version: 1, name: "New Aldoria Region", width: 32, height: 24, floor: 7, blocked: [], water: [], bridges: [], trees: [], roads: [], floors: [], houseWalls: [], castleWalls: [], windows: [], torches: [], terrainMaterials: [], buildings: [], doors: [], stairs: [], spawns: [], playerSpawn: { x: 1, y: 1, z: 7 }, npcs: [], resourceNodes: [], objects: [] };
}
const key = (position: Position) => `${position.x}:${position.y}:${position.z}`;
const same = (left: Position, right: Position) => left.x === right.x && left.y === right.y && left.z === right.z;
const selectionBounds = (start: Position, end: Position): SelectionBounds => ({ minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y), maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y), z: start.z });
const insideSelection = (position: Position, selection: SelectionBounds) => position.z === selection.z && position.x >= selection.minX && position.x <= selection.maxX && position.y >= selection.minY && position.y <= selection.maxY;
const buildingTouchesSelection = (building: BuildingView, selection: SelectionBounds) => building.floor === selection.z && building.x <= selection.maxX && building.y <= selection.maxY && building.x + building.width - 1 >= selection.minX && building.y + building.height - 1 >= selection.minY;
function hasAuthoredContent(document: EditorDocument, position: Position) {
  return same(document.playerSpawn, position)
    || tileLayers.some((layer) => document[layer].some((tile) => same(tile, position)))
    || document.buildings.some((building) => building.floor === position.z && position.x >= building.x && position.y >= building.y && position.x < building.x + building.width && position.y < building.y + building.height)
    || document.windows.some((entry) => same(entry, position))
    || document.torches.some((entry) => same(entry, position))
    || document.terrainMaterials.some((entry) => same(entry.position, position))
    || document.doors.some((entry) => same(entry.position, position))
    || document.stairs.some((entry) => same(entry.from, position))
    || document.spawns.some((entry) => same(entry.position, position))
    || document.npcs.some((entry) => same(entry.position, position))
    || document.resourceNodes.some((entry) => same(entry.position, position))
    || document.objects.some((entry) => same(entry.position, position));
}
const saveLocal = (document: EditorDocument) => {
  const authoredEntries = tileLayers.reduce((total, layer) => total + document[layer].length, 0)
    + document.windows.length + document.torches.length + document.terrainMaterials.length
    + document.buildings.length + document.doors.length + document.stairs.length + document.objects.length
    + document.spawns.length + document.npcs.length + document.resourceNodes.length;
  if (authoredEntries > MAX_LOCAL_AUTOSAVE_ENTRIES) return;
  try { localStorage.setItem("aldoria-world-editor", JSON.stringify(document)); } catch { /* JSON file saving remains available. */ }
};

export function WorldEditor() {
  const [document, setDocument] = useState<EditorDocument>(() => loadLocal());
  const documentRef = useRef(document);
  const [tool, setTool] = useState<PaintLayer>("select");
  const [toolGroup, setToolGroup] = useState<ToolGroup>("navigate");
  const [activeFloor, setActiveFloor] = useState(7);
  const [destinationFloor, setDestinationFloor] = useState(8);
  const [creatureId, setCreatureId] = useState("castle_rat");
  const [npcService, setNpcService] = useState<NpcView["service"]>("shop");
  const [resourceRespawnSeconds, setResourceRespawnSeconds] = useState(30);
  const [resourceSkillLevel, setResourceSkillLevel] = useState(0);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
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
  const panFrame = useRef<number | null>(null);
  const pendingPan = useRef<{ x: number; y: number } | null>(null);
  const editorDrag = useRef<EditorDrag | null>(null);
  const dragOrigin = useRef<Position | null>(null);
  const marqueeStart = useRef<Position | null>(null);
  const marqueeEnd = useRef<Position | null>(null);
  const suppressSelectClick = useRef(false);
  const worldFileHandle = useRef<WorldFileHandle | null>(null);
  const [dragTarget, setDragTarget] = useState<Position | null>(null);
  const [selectedArea, setSelectedArea] = useState<SelectionBounds | null>(null);
  const [marqueeArea, setMarqueeArea] = useState<SelectionBounds | null>(null);
  const [mapViewport, setMapViewport] = useState({ width: 1280, height: 800 });
  const mapScrollRef = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState("Autosaved locally");
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const layerSets = useMemo(() => Object.fromEntries(tileLayers.map((layer) => [layer, new Set(document[layer].filter((tile) => tile.z === activeFloor).map(key))])) as Record<(typeof tileLayers)[number], Set<string>>, [document, activeFloor]);
  const spawnByTile = useMemo(() => new Map(document.spawns.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.spawns, activeFloor]);
  const doorByTile = useMemo(() => new Map(document.doors.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.doors, activeFloor]);
  const stairsByTile = useMemo(() => new Map(document.stairs.filter((entry) => entry.from.z === activeFloor).map((entry) => [key(entry.from), entry])), [document.stairs, activeFloor]);
  const npcByTile = useMemo(() => new Map(document.npcs.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.npcs, activeFloor]);
  const resourceNodeByTile = useMemo(() => new Map(document.resourceNodes.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.resourceNodes, activeFloor]);
  const windows = useMemo(() => new Set(document.windows.filter((entry) => entry.z === activeFloor).map(key)), [document.windows, activeFloor]);
  const torches = useMemo(() => new Set(document.torches.filter((entry) => entry.z === activeFloor).map(key)), [document.torches, activeFloor]);
  const terrainByTile = useMemo(() => new Map(document.terrainMaterials.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry.material])), [document.terrainMaterials, activeFloor]);
  const worldObjectByTile = useMemo(() => new Map(document.objects.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.objects, activeFloor]);
  const buildingByTile = useMemo(() => {
    const result = new Map<string, BuildingView>();
    for (const building of document.buildings) {
      if (building.floor !== activeFloor) continue;
      for (let y = building.y; y < building.y + building.height; y += 1) {
        for (let x = building.x; x < building.x + building.width; x += 1) {
          result.set(key({ x, y, z: building.floor }), building);
        }
      }
    }
    return result;
  }, [document.buildings, activeFloor]);
  const authoredTileKeys = useMemo(() => {
    const result = new Set<string>();
    for (const layer of tileLayers) for (const tileKey of layerSets[layer]) result.add(tileKey);
    for (const collection of [spawnByTile, doorByTile, stairsByTile, npcByTile, resourceNodeByTile, terrainByTile, worldObjectByTile, buildingByTile]) {
      for (const tileKey of collection.keys()) result.add(tileKey);
    }
    for (const tileKey of windows) result.add(tileKey);
    for (const tileKey of torches) result.add(tileKey);
    if (document.playerSpawn.z === activeFloor) result.add(key(document.playerSpawn));
    return result;
  }, [activeFloor, buildingByTile, document.playerSpawn, doorByTile, layerSets, npcByTile, resourceNodeByTile, spawnByTile, stairsByTile, terrainByTile, torches, windows, worldObjectByTile]);
  const viewportX = Math.max(0, Math.min(viewX, Math.max(0, document.width - VIEW_COLUMNS)));
  const viewportY = Math.max(0, Math.min(viewY, Math.max(0, document.height - VIEW_ROWS)));
  const visibleWidth = Math.min(document.width - viewportX, Math.max(VIEW_COLUMNS, Math.floor((mapViewport.width - 40) / (EDITOR_TILE_SIZE * zoom))));
  const visibleHeight = Math.min(document.height - viewportY, Math.max(VIEW_ROWS, Math.floor((mapViewport.height - 40) / (EDITOR_TILE_SIZE * zoom))));
  const waterEdgeClasses = (position: Position) => waterEdgesAt(
    position.x, position.y, document.width, document.height,
    (x, y) => layerSets.water.has(key({ x, y, z: position.z })),
    (x, y) => layerSets.blocked.has(key({ x, y, z: position.z })) && !layerSets.water.has(key({ x, y, z: position.z })),
  ).map((edge) => `water-${edge.kind}-${edge.side}`).join(" ");

  useEffect(() => {
    setViewX((value) => Math.max(0, Math.min(value, Math.max(0, document.width - VIEW_COLUMNS))));
    setViewY((value) => Math.max(0, Math.min(value, Math.max(0, document.height - VIEW_ROWS))));
  }, [document.width, document.height, visibleWidth, visibleHeight]);

  useEffect(() => {
    const element = mapScrollRef.current;
    if (!element) return;
    const measure = () => setMapViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
  }, []);

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
    if (tool === "select") {
      setSelectedPosition(hasAuthoredContent(source, position) ? position : null);
      return;
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
    } else if (tool.startsWith("object_")) {
      const kind = tool.slice("object_".length) as WorldObjectKind;
      const solid = ["mountain_wall", "forest_tree", "pine_tree", "snowy_pine", "snow_bank", "well", "table"].includes(kind);
      if (same(next.playerSpawn, position) || next.water.some((tile) => same(tile, position))) return;
      next.objects = next.objects.filter((entry) => !same(entry.position, position));
      next.objects.push({ id: `object_${kind}_${activeFloor}_${x}_${y}`, kind, position });
      if (solid && !next.blocked.some((tile) => same(tile, position))) next.blocked.push(position);
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
      next.npcs.push({ id, name: "New NPC", title: "Greyhaven Citizen", service: npcService, dialogue: "Greetings, traveler.", position, offers: [], spellIds: [], recipeIds: [] });
      setSelectedNpcId(id);
    } else if (tool === "resourceNode") {
      if (same(next.playerSpawn, position) || next.resourceNodes.some((entry) => same(entry.position, position)) || next.water.some((tile) => same(tile, position)) || next.spawns.some((entry) => same(entry.position, position)) || next.npcs.some((entry) => same(entry.position, position))) return;
      next.resourceNodes.push({ id: `copper_vein_${activeFloor}_${x}_${y}`, kind: "copper_vein", position, respawnMs: Math.max(1, resourceRespawnSeconds) * 1_000, requiredSkillLevel: Math.max(0, Math.min(100, resourceSkillLevel)) });
    } else if (tool === "playerSpawn") {
      next.playerSpawn = position;
      next.resourceNodes = next.resourceNodes.filter((entry) => !same(entry.position, position));
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
  const removeAt = (position: Position) => {
    const source = documentRef.current;
    if (!hasAuthoredContent(source, position)) return;
    const next = structuredClone(source);
    const building = next.buildings.find((entry) => entry.floor === position.z && position.x >= entry.x && position.y >= entry.y && position.x < entry.x + entry.width && position.y < entry.y + entry.height);
    const insideBuilding = building
      ? (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height
      : () => false;
    if (building) next.buildings = next.buildings.filter((entry) => entry.id !== building.id);
    for (const layer of tileLayers) next[layer] = next[layer].filter((tile) => !insideBuilding(tile) && !same(tile, position));
    next.doors = next.doors.filter((entry) => !insideBuilding(entry.position) && !same(entry.position, position));
    next.stairs = next.stairs.filter((entry) => !same(entry.from, position));
    next.spawns = next.spawns.filter((entry) => !same(entry.position, position));
    next.windows = next.windows.filter((entry) => !insideBuilding(entry) && !same(entry, position));
    next.torches = next.torches.filter((entry) => !insideBuilding(entry) && !same(entry, position));
    next.terrainMaterials = next.terrainMaterials.filter((entry) => !same(entry.position, position));
    next.resourceNodes = next.resourceNodes.filter((entry) => !same(entry.position, position));
    next.objects = next.objects.filter((entry) => !same(entry.position, position));
    next.npcs = next.npcs.filter((entry) => !same(entry.position, position));
    if (same(next.playerSpawn, position)) next.playerSpawn = firstSafeBaseTile(next);
    setSelectedPosition(null); setSelectedNpcId(null); commit(next);
  };
  const removeSelection = (selection: SelectionBounds) => {
    const source = documentRef.current;
    const removedBuildings = source.buildings.filter((building) => buildingTouchesSelection(building, selection));
    const insideRemovedBuilding = (position: Position) => removedBuildings.some((building) => position.z === building.floor && position.x >= building.x && position.y >= building.y && position.x < building.x + building.width && position.y < building.y + building.height);
    const selected = (position: Position) => insideSelection(position, selection) || insideRemovedBuilding(position);
    if (!tileLayers.some((layer) => source[layer].some(selected)) && !source.buildings.some((building) => buildingTouchesSelection(building, selection)) && !source.windows.some(selected) && !source.torches.some(selected) && !source.terrainMaterials.some((entry) => selected(entry.position)) && !source.doors.some((entry) => selected(entry.position)) && !source.stairs.some((entry) => selected(entry.from)) && !source.spawns.some((entry) => selected(entry.position)) && !source.npcs.some((entry) => selected(entry.position)) && !source.resourceNodes.some((entry) => selected(entry.position)) && !source.objects.some((entry) => selected(entry.position)) && !selected(source.playerSpawn)) return;
    const next = structuredClone(source);
    for (const layer of tileLayers) next[layer] = next[layer].filter((entry) => !selected(entry));
    next.buildings = next.buildings.filter((building) => !buildingTouchesSelection(building, selection));
    next.windows = next.windows.filter((entry) => !selected(entry)); next.torches = next.torches.filter((entry) => !selected(entry));
    next.terrainMaterials = next.terrainMaterials.filter((entry) => !selected(entry.position)); next.doors = next.doors.filter((entry) => !selected(entry.position));
    next.stairs = next.stairs.filter((entry) => !selected(entry.from)); next.spawns = next.spawns.filter((entry) => !selected(entry.position));
    next.npcs = next.npcs.filter((entry) => !selected(entry.position)); next.resourceNodes = next.resourceNodes.filter((entry) => !selected(entry.position)); next.objects = next.objects.filter((entry) => !selected(entry.position));
    if (selected(next.playerSpawn)) next.playerSpawn = firstSafeBaseTile(next);
    setSelectedArea(null); setSelectedPosition(null); setSelectedNpcId(null); commit(next);
  };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [documentRef.current, ...items]); setHistory((items) => items.slice(0, -1)); restore(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, documentRef.current]); setFuture((items) => items.slice(1)); restore(next); };
  async function saveWorld(saveAs = false) {
    const current = documentRef.current;
    const fileName = worldFileName(current.name);
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const pickerWindow = window as SavePickerWindow;
    try {
      setSaveStatus("Saving…");
      if (pickerWindow.showSaveFilePicker) {
        if (saveAs || !worldFileHandle.current) worldFileHandle.current = await pickerWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: "Aldoria world map", accept: { "application/json": [".json"] } }],
        });
        const writable = await worldFileHandle.current.createWritable();
        await writable.write(blob); await writable.close();
        setSaveStatus(`Saved to ${worldFileHandle.current.name}`);
        return;
      }
      downloadWorld(blob, fileName);
      setSaveStatus(`Downloaded ${fileName}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") { setSaveStatus("Save cancelled"); return; }
      console.error("Could not save world", error);
      setSaveStatus("Save failed — try Save As");
    }
  }
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.code === "Space" && !editing) { event.preventDefault(); window.document.body.classList.add("editor-space-pan"); }
      if (!editing && event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (!editing && event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveWorld(event.shiftKey); }
      if (!editing && (event.key === "Delete" || event.key === "Backspace")) { if (selectedArea) { event.preventDefault(); removeSelection(selectedArea); } else if (selectedPosition) { event.preventDefault(); removeAt(selectedPosition); } }
      if (!editing && event.key === "Escape") { setSelectedNpcId(null); setSelectedPosition(null); setSelectedArea(null); setMarqueeArea(null); marqueeStart.current = null; marqueeEnd.current = null; }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") window.document.body.classList.remove("editor-space-pan"); };
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp);
    return () => { window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.document.body.classList.remove("editor-space-pan"); };
  }, [history, future, selectedPosition, selectedArea]);
  const importWorld = async (file?: File) => {
    if (!file) return;
    setLoadingMessage(`Reading ${file.name}`);
    await nextBrowserPaint();
    try {
      const raw = await file.text();
      setLoadingMessage("Parsing and validating world data");
      await nextBrowserPaint();
      const parsed = normalizeDocument(JSON.parse(raw) as EditorDocument);
      if (parsed.version !== 1 || !Array.isArray(parsed.blocked) || !Array.isArray(parsed.spawns) || parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_WORLD_SIZE || parsed.height > MAX_WORLD_SIZE) throw new Error("Unsupported world document");
      worldFileHandle.current = null; setSaveStatus(`Imported ${file.name} — choose where to save`); commit(parsed); setActiveFloor(parsed.floor); setWorldWidth(parsed.width); setWorldHeight(parsed.height); setViewX(0); setViewY(0);
    } finally {
      setLoadingMessage(null);
    }
  };
  const resizeWorld = () => {
    const width = Number.isFinite(worldWidth) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldWidth))) : document.width; const height = Number.isFinite(worldHeight) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldHeight))) : document.height;
    const inBounds = (position: Position) => position.x >= 0 && position.y >= 0 && position.x < width && position.y < height;
    const removed = tileLayers.reduce((count, layer) => count + document[layer].filter((tile) => !inBounds(tile)).length, 0)
      + document.doors.filter((entry) => !inBounds(entry.position)).length + document.stairs.filter((entry) => !inBounds(entry.from) || !inBounds(entry.to)).length
      + document.spawns.filter((entry) => !inBounds(entry.position)).length + document.buildings.filter((entry) => entry.x < 0 || entry.y < 0 || entry.x + entry.width > width || entry.y + entry.height > height).length
      + document.npcs.filter((entry) => !inBounds(entry.position)).length + document.windows.filter((entry) => !inBounds(entry)).length
      + document.resourceNodes.filter((entry) => !inBounds(entry.position)).length
      + document.objects.filter((entry) => !inBounds(entry.position)).length
      + document.torches.filter((entry) => !inBounds(entry)).length + document.terrainMaterials.filter((entry) => !inBounds(entry.position)).length
      + (inBounds(document.playerSpawn) ? 0 : 1);
    if (removed > 0 && !window.confirm(`Shrinking the world removes ${removed} out-of-bounds entries. Continue?`)) return;
    const next = structuredClone(document); next.width = width; next.height = height;
    for (const layer of tileLayers) next[layer] = next[layer].filter(inBounds);
    next.doors = next.doors.filter((entry) => inBounds(entry.position)); next.stairs = next.stairs.filter((entry) => inBounds(entry.from) && inBounds(entry.to)); next.spawns = next.spawns.filter((entry) => inBounds(entry.position)); next.npcs = next.npcs.filter((entry) => inBounds(entry.position)); next.buildings = next.buildings.filter((entry) => entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= width && entry.y + entry.height <= height);
    next.windows = next.windows.filter(inBounds); next.torches = next.torches.filter(inBounds); next.terrainMaterials = next.terrainMaterials.filter((entry) => inBounds(entry.position));
    next.resourceNodes = next.resourceNodes.filter((entry) => inBounds(entry.position));
    next.objects = next.objects.filter((entry) => inBounds(entry.position));
    if (!inBounds(next.playerSpawn)) next.playerSpawn = firstSafeBaseTile(next);
    setWorldWidth(width); setWorldHeight(height); commit(next);
  };
  const panTo = (x: number, y: number) => { const nextX = Number.isFinite(x) ? Math.trunc(x) : viewportX; const nextY = Number.isFinite(y) ? Math.trunc(y) : viewportY; setViewX(Math.max(0, Math.min(nextX, Math.max(0, document.width - VIEW_COLUMNS)))); setViewY(Math.max(0, Math.min(nextY, Math.max(0, document.height - VIEW_ROWS)))); };
  const newWorld = () => { const next = blankDocument(); worldFileHandle.current = null; setSaveStatus("New map — choose where to save"); setWorldWidth(next.width); setWorldHeight(next.height); setActiveFloor(next.floor); setViewX(0); setViewY(0); commit(next); };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => { const spacePan = window.document.body.classList.contains("editor-space-pan"); if (event.button !== 1 && event.button !== 2 && !(event.button === 0 && spacePan)) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewportX, originY: viewportY }; };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGesture.current; if (!gesture || gesture.pointerId !== event.pointerId) return;
    const tileX = (event.clientX - gesture.startX) / (EDITOR_TILE_SIZE * zoom); const tileY = (event.clientY - gesture.startY) / (EDITOR_TILE_SIZE * zoom);
    pendingPan.current = { x: gesture.originX - Math.round(tileX), y: gesture.originY - Math.round(tileY) };
    if (panFrame.current !== null) return;
    panFrame.current = requestAnimationFrame(() => {
      panFrame.current = null;
      const target = pendingPan.current; pendingPan.current = null;
      if (target) panTo(target.x, target.y);
    });
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panGesture.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panGesture.current = null;
    const target = pendingPan.current; pendingPan.current = null;
    if (target) panTo(target.x, target.y);
  };
  const objectAt = (position: Position): EditorDrag | null => { const tileKey = key(position); if (same(document.playerSpawn, position)) return { kind: "playerSpawn" }; const npc = npcByTile.get(tileKey); if (npc) return { kind: "npc", id: npc.id }; const resourceNode = resourceNodeByTile.get(tileKey); if (resourceNode) return { kind: "resourceNode", id: resourceNode.id }; const door = doorByTile.get(tileKey); if (door) return { kind: "door", id: door.id }; if (windows.has(tileKey)) return { kind: "window", position }; if (torches.has(tileKey)) return { kind: "torch", position }; const stairs = stairsByTile.get(tileKey); if (stairs) return { kind: "stairs", id: stairs.id }; const spawn = spawnByTile.get(tileKey); if (spawn) return { kind: "spawn", id: spawn.id }; const building = buildingByTile.get(tileKey); return building ? { kind: "building", id: building.id, offsetX: position.x - building.x, offsetY: position.y - building.y } : authoredTileKeys.has(tileKey) ? { kind: "tile", position } : null; };
  const moveObject = (target: Position) => {
    const dragged = editorDrag.current; if (!dragged) return; const next = structuredClone(documentRef.current);
    if (dragged.kind === "selection") {
      const dx = target.x - dragged.origin.x; const dy = target.y - dragged.origin.y; if (dx === 0 && dy === 0) { editorDrag.current = null; setDragTarget(null); return; }
      const selectedBuildings = next.buildings.filter((building) => buildingTouchesSelection(building, dragged.bounds));
      const selected = (position: Position) => insideSelection(position, dragged.bounds) || selectedBuildings.some((building) => position.z === building.floor && position.x >= building.x && position.y >= building.y && position.x < building.x + building.width && position.y < building.y + building.height);
      const shift = (position: Position) => selected(position) ? { x: position.x + dx, y: position.y + dy, z: position.z } : position;
      const inBounds = (position: Position) => position.x >= 0 && position.y >= 0 && position.x < next.width && position.y < next.height;
      const positions = [...tileLayers.flatMap((layer) => next[layer]), ...next.windows, ...next.torches, ...next.terrainMaterials.map((entry) => entry.position), ...next.doors.map((entry) => entry.position), ...next.stairs.map((entry) => entry.from), ...next.spawns.map((entry) => entry.position), ...next.npcs.map((entry) => entry.position), ...next.resourceNodes.map((entry) => entry.position), ...next.objects.map((entry) => entry.position), next.playerSpawn];
      if (positions.some((position) => selected(position) && !inBounds(shift(position))) || selectedBuildings.some((building) => building.x + dx < 0 || building.y + dy < 0 || building.x + dx + building.width > next.width || building.y + dy + building.height > next.height)) return;
      for (const layer of tileLayers) next[layer] = next[layer].map(shift);
      next.buildings = next.buildings.map((building) => selectedBuildings.some((entry) => entry.id === building.id) ? { ...building, x: building.x + dx, y: building.y + dy } : building);
      next.windows = next.windows.map(shift); next.torches = next.torches.map(shift); next.terrainMaterials = next.terrainMaterials.map((entry) => ({ ...entry, position: shift(entry.position) })); next.doors = next.doors.map((entry) => ({ ...entry, position: shift(entry.position) }));
      next.stairs = next.stairs.map((entry) => selected(entry.from) ? { ...entry, from: shift(entry.from), to: { x: entry.to.x + dx, y: entry.to.y + dy, z: entry.to.z } } : entry);
      next.spawns = next.spawns.map((entry) => ({ ...entry, position: shift(entry.position) })); next.npcs = next.npcs.map((entry) => ({ ...entry, position: shift(entry.position) })); next.resourceNodes = next.resourceNodes.map((entry) => ({ ...entry, position: shift(entry.position) })); next.objects = next.objects.map((entry) => ({ ...entry, position: shift(entry.position) })); next.playerSpawn = shift(next.playerSpawn);
      const movedSelection = { ...dragged.bounds, minX: dragged.bounds.minX + dx, maxX: dragged.bounds.maxX + dx, minY: dragged.bounds.minY + dy, maxY: dragged.bounds.maxY + dy }; setSelectedArea(movedSelection); setSelectedPosition(target);
    } else if (dragged.kind === "playerSpawn") { next.playerSpawn = target; next.resourceNodes = next.resourceNodes.filter((entry) => !same(entry.position, target)); next.blocked = next.blocked.filter((tile) => !same(tile, target)); next.water = next.water.filter((tile) => !same(tile, target)); next.bridges = next.bridges.filter((tile) => !same(tile, target)); next.trees = next.trees.filter((tile) => !same(tile, target)); next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.doors = next.doors.filter((door) => !same(door.position, target)); next.spawns = next.spawns.filter((spawn) => !same(spawn.position, target)); next.npcs = next.npcs.filter((npc) => !same(npc.position, target)); if (target.z !== next.floor && !next.floors.some((tile) => same(tile, target))) next.floors.push(target); }
    else if (dragged.kind === "door") { const door = next.doors.find((entry) => entry.id === dragged.id); if (!door || next.doors.some((entry) => entry.id !== door.id && same(entry.position, target))) return; door.position = target; next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.trees = next.trees.filter((tile) => !same(tile, target)); next.blocked = next.blocked.filter((tile) => !same(tile, target)); }
    else if (dragged.kind === "window") { const onHouseWall = next.houseWalls.some((tile) => same(tile, target)) || next.buildings.some((building) => building.kind === "house" && building.floor === target.z && target.x >= building.x && target.y >= building.y && target.x < building.x + building.width && target.y < building.y + building.height && (target.x === building.x || target.y === building.y || target.x === building.x + building.width - 1 || target.y === building.y + building.height - 1)); if (!onHouseWall || next.doors.some((entry) => same(entry.position, target))) return; next.windows = next.windows.filter((entry) => !same(entry, dragged.position) && !same(entry, target)); next.windows.push(target); }
    else if (dragged.kind === "torch") { if (next.water.some((tile) => same(tile, target))) return; next.torches = next.torches.filter((entry) => !same(entry, dragged.position) && !same(entry, target)); next.torches.push(target); }
    else if (dragged.kind === "spawn") { const spawn = next.spawns.find((entry) => entry.id === dragged.id); if (!spawn || next.blocked.some((tile) => same(tile, target)) || next.spawns.some((entry) => entry.id !== spawn.id && same(entry.position, target))) return; spawn.position = target; }
    else if (dragged.kind === "npc") { const npc = next.npcs.find((entry) => entry.id === dragged.id); if (!npc || next.blocked.some((tile) => same(tile, target)) || same(next.playerSpawn, target) || next.spawns.some((entry) => same(entry.position, target)) || next.npcs.some((entry) => entry.id !== npc.id && same(entry.position, target))) return; npc.position = target; setSelectedNpcId(npc.id); }
    else if (dragged.kind === "resourceNode") { const node = next.resourceNodes.find((entry) => entry.id === dragged.id); if (!node || same(next.playerSpawn, target) || next.blocked.some((tile) => same(tile, target)) || next.water.some((tile) => same(tile, target)) || next.spawns.some((entry) => same(entry.position, target)) || next.npcs.some((entry) => same(entry.position, target)) || next.resourceNodes.some((entry) => entry.id !== node.id && same(entry.position, target))) return; node.position = target; }
    else if (dragged.kind === "stairs") { const stairs = next.stairs.find((entry) => entry.id === dragged.id); if (!stairs || next.stairs.some((entry) => entry.id !== stairs.id && same(entry.from, target))) return; const dx = target.x - stairs.from.x; const dy = target.y - stairs.from.y; stairs.from = target; stairs.to = { x: stairs.to.x + dx, y: stairs.to.y + dy, z: stairs.to.z }; if (stairs.to.x < 0 || stairs.to.y < 0 || stairs.to.x >= next.width || stairs.to.y >= next.height) return; }
    else if (dragged.kind === "tile") {
      if (hasAuthoredContent(next, target) && !same(dragged.position, target)) return;
      for (const layer of tileLayers) next[layer] = next[layer].map((tile) => same(tile, dragged.position) ? target : tile);
      next.windows = next.windows.map((entry) => same(entry, dragged.position) ? target : entry);
      next.torches = next.torches.map((entry) => same(entry, dragged.position) ? target : entry);
      next.terrainMaterials = next.terrainMaterials.map((entry) => same(entry.position, dragged.position) ? { ...entry, position: target } : entry);
    } else { const building = next.buildings.find((entry) => entry.id === dragged.id); if (!building) return; const targetX = target.x - dragged.offsetX; const targetY = target.y - dragged.offsetY; const dx = targetX - building.x; const dy = targetY - building.y; if (targetX < 0 || targetY < 0 || targetX + building.width > next.width || targetY + building.height > next.height) return; const inside = (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height; const structural = new Set([...next.houseWalls, ...next.castleWalls].filter(inside).map(key)); const shifted = (tile: Position) => inside(tile) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile; next.houseWalls = next.houseWalls.map(shifted); next.castleWalls = next.castleWalls.map(shifted); next.floors = next.floors.map(shifted); next.blocked = next.blocked.map((tile) => structural.has(key(tile)) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile); next.doors = next.doors.map((door) => inside(door.position) ? { ...door, position: shifted(door.position) } : door); next.windows = next.windows.map(shifted); next.torches = next.torches.map(shifted); building.x = targetX; building.y = targetY; }
    editorDrag.current = null; setDragTarget(null); setSelectedPosition(target); commit(next);
  };
  const selectedNpc = selectedNpcId ? document.npcs.find((npc) => npc.id === selectedNpcId) : undefined;
  const activeTool = tools.find((entry) => entry.id === tool) ?? tools[0];
  const updateNpc = (npc: NpcView, recordHistory = false) => { const next = structuredClone(documentRef.current); const index = next.npcs.findIndex((entry) => entry.id === selectedNpcId); if (index < 0) return; next.npcs[index] = npc; setSelectedNpcId(npc.id); if (recordHistory) commit(next); else restore(next); };
  const removeNpc = () => { if (!selectedNpcId) return; const next = structuredClone(documentRef.current); next.npcs = next.npcs.filter((npc) => npc.id !== selectedNpcId); setSelectedNpcId(null); commit(next); };
  const dragPreviewIncludes = (position: Position) => {
    const dragged = editorDrag.current;
    if (!dragged || !dragTarget || position.z !== dragTarget.z) return false;
    if (dragged.kind === "selection") {
      const dx = dragTarget.x - dragged.origin.x; const dy = dragTarget.y - dragged.origin.y;
      return insideSelection({ x: position.x - dx, y: position.y - dy, z: position.z }, dragged.bounds);
    }
    if (dragged.kind !== "building") return same(position, dragTarget);
    const building = document.buildings.find((entry) => entry.id === dragged.id);
    if (!building) return false;
    const originX = dragTarget.x - dragged.offsetX; const originY = dragTarget.y - dragged.offsetY;
    return position.x >= originX && position.y >= originY && position.x < originX + building.width && position.y < originY + building.height;
  };
  const continuousTool = (value: PaintLayer) => (tileLayers as readonly string[]).includes(value)
    || ["packed_earth", "moss_stone", "sandstone"].includes(value) || value.startsWith("object_");

  return <main className="editor-shell">
    {loadingMessage && <div className="editor-loading" role="status"><i /><strong>Loading world</strong><span>{loadingMessage}</span><small>Large maps stay file-based instead of being duplicated into browser storage.</small></div>}
    <header><div><p>EMBERS OF ALDORIA</p><h1>World Editor</h1></div><input value={document.name} onChange={(event) => restore({ ...document, name: event.target.value })} /><span>{document.width} x {document.height} / z={activeFloor}</span><a className="editor-back-button" href="/" aria-label="Back to character selection"><b aria-hidden="true">←</b> Back to Characters</a></header>
      <aside className="palette">
      <WorldMinimap document={document} floor={activeFloor} viewportX={viewportX} viewportY={viewportY} viewportWidth={visibleWidth} viewportHeight={visibleHeight} onPan={panTo} />
       <div className="tool-tabs" role="tablist" aria-label="Tool categories">{toolGroups.map((group) => <button role="tab" aria-selected={toolGroup === group.id} className={toolGroup === group.id ? "active" : ""} key={group.id} onClick={() => { setToolGroup(group.id); setTool(tools.find((entry) => entry.group === group.id)?.id ?? "select"); }}>{group.label}</button>)}</div>
      <div className="tool-grid">{tools.filter((entry) => entry.group === toolGroup).map((entry) => <button title={entry.description} className={tool === entry.id ? "active" : ""} key={entry.id} onClick={() => setTool(entry.id)}><i style={{ background: entry.swatch }} /><span>{entry.label}</span></button>)}</div>
      <section className="tool-context"><div className="tool-context-title"><i style={{ background: activeTool.swatch }} /><div><strong>{activeTool.label}</strong><span>{activeTool.description}</span></div></div>
        {(tool === "house" || tool === "keep") && <label>Building size<span className="number-pair"><input type="number" min="3" max="20" value={buildingWidth} onChange={(event) => setBuildingWidth(Number(event.target.value))} /><b>x</b><input type="number" min="3" max="20" value={buildingHeight} onChange={(event) => setBuildingHeight(Number(event.target.value))} /></span></label>}
        {tool === "npc" && <label>New NPC service<select value={npcService} onChange={(event) => setNpcService(event.target.value as NpcView["service"])}><option value="shop">Shop</option><option value="depot">Depot</option><option value="spell_trainer">Spell trainer</option><option value="craft_trainer">Craft trainer</option></select></label>}
        {tool === "spawn" && <label>Creature<select value={creatureId} onChange={(event) => setCreatureId(event.target.value)}>{creatureIds.map((id) => <option key={id}>{id}</option>)}</select></label>}
        {tool === "resourceNode" && <><label>Respawn (seconds)<input type="number" min="1" max="3600" value={resourceRespawnSeconds} onChange={(event) => setResourceRespawnSeconds(Math.max(1, Math.min(3600, Number(event.target.value) || 1)))} /></label><label>Required Mining level<input type="number" min="0" max="100" value={resourceSkillLevel} onChange={(event) => setResourceSkillLevel(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label></>}
        {tool === "stairs" && <label>Stairs lead to<select value={destinationFloor} onChange={(event) => setDestinationFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label>}
      </section>
      {selectedNpc && <NpcInspector npc={selectedNpc} onChange={updateNpc} onRemove={removeNpc} />}
      <details className="world-settings"><summary>World settings</summary><label>Map size (tiles)<span className="number-pair"><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldWidth} onChange={(event) => setWorldWidth(Number(event.target.value))} /><b>x</b><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldHeight} onChange={(event) => setWorldHeight(Number(event.target.value))} /></span></label><button className="resize-button" onClick={resizeWorld}>Apply map size</button><small>Maximum {MAX_WORLD_SIZE.toLocaleString()} × {MAX_WORLD_SIZE.toLocaleString()}. Sparse maps only store authored tiles.</small></details>
    </aside>
    <section className="editor-workspace"><nav><span className="history-controls"><button title="Undo (Ctrl+Z)" disabled={!history.length} onClick={undo}>↶ Undo</button><button title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>↷ Redo</button></span><label>Floor<select value={activeFloor} onChange={(event) => setActiveFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label><span className="pan-controls"><button title="Move view west" onClick={() => panTo(viewportX - PAN_STEP, viewportY)}>←</button><button title="Move view north" onClick={() => panTo(viewportX, viewportY - PAN_STEP)}>↑</button><label>X<input type="number" min="0" max={document.width - 1} value={viewportX} onChange={(event) => panTo(Number(event.target.value), viewportY)} /></label><label>Y<input type="number" min="0" max={document.height - 1} value={viewportY} onChange={(event) => panTo(viewportX, Number(event.target.value))} /></label><button title="Move view south" onClick={() => panTo(viewportX, viewportY + PAN_STEP)}>↓</button><button title="Move view east" onClick={() => panTo(viewportX + PAN_STEP, viewportY)}>→</button></span><label>Zoom<input type="range" min="0.6" max="1.6" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><span className="save-status" title={saveStatus}>{saveStatus}</span><span className="document-controls"><button onClick={newWorld}>New</button><label className="file-button">Import<input type="file" accept=".json" onChange={(event) => void importWorld(event.target.files?.[0]).catch((error) => alert(error))} /></label><button title="Choose a new file (Ctrl+Shift+S)" onClick={() => void saveWorld(true)}>Save As</button><button className="primary" title="Save to the current file (Ctrl+S)" onClick={() => void saveWorld()}>Save</button></span></nav>
       <div ref={mapScrollRef} className="map-scroll" onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.max(0.6, Math.min(1.6, current + (event.deltaY < 0 ? 0.1 : -0.1)))); }} onContextMenu={(event) => event.preventDefault()} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
        <div className="editor-grid top-down" style={{ width: visibleWidth * EDITOR_TILE_SIZE * zoom, height: visibleHeight * EDITOR_TILE_SIZE * zoom }}>
          {Array.from({ length: visibleWidth * visibleHeight }, (_, index) => {
            const column = index % visibleWidth; const row = Math.floor(index / visibleWidth);
            const x = viewportX + column; const y = viewportY + row; const position = { x, y, z: activeFloor }; const tileKey = key(position);
            const spawn = spawnByTile.get(tileKey); const npc = npcByTile.get(tileKey); const door = doorByTile.get(tileKey); const stairs = stairsByTile.get(tileKey);
            const resourceNode = resourceNodeByTile.get(tileKey);
            const playerSpawn = same(document.playerSpawn, position); const editorObject = objectAt(position); const material = terrainByTile.get(tileKey); const worldObject = worldObjectByTile.get(tileKey); const selected = selectedPosition ? same(selectedPosition, position) : false; const areaSelected = selectedArea ? insideSelection(position, selectedArea) : false; const marqueeSelected = marqueeArea ? insideSelection(position, marqueeArea) : false;
            const classes = tileLayers.filter((layer) => layerSets[layer].has(tileKey)).join(" ");
            return <button
              title={npc ? `${npc.name} — ${npc.title}` : `Tile ${x}, ${y}, floor ${activeFloor}`}
              aria-label={`Tile ${x}, ${y}`}
              draggable={false}
              className={`editor-tile ${classes} ${material ? `material-${material}` : ""} ${worldObject ? `world-object world-object-${worldObject.kind}` : ""} ${waterEdgeClasses(position)} ${playerSpawn ? "player-spawn" : ""} ${npc?.id === selectedNpcId ? "npc-selected" : ""} ${selected || areaSelected ? "selected" : ""} ${marqueeSelected ? "marquee-selected" : ""} ${editorObject ? "movable" : ""} ${dragPreviewIncludes(position) ? "drag-preview" : ""}`}
              style={{ width: EDITOR_TILE_SIZE * zoom, height: EDITOR_TILE_SIZE * zoom, left: column * EDITOR_TILE_SIZE * zoom, top: row * EDITOR_TILE_SIZE * zoom, zIndex: 1 }}
              key={index}
              onPointerDown={(event) => { const panning = window.document.body.classList.contains("editor-space-pan"); if (event.button !== 0 || panning) return; if (tool === "select") { event.preventDefault(); if (selectedArea && insideSelection(position, selectedArea)) { editorDrag.current = { kind: "selection", bounds: selectedArea, origin: position }; dragOrigin.current = position; setDragTarget(position); return; } marqueeStart.current = position; marqueeEnd.current = position; setMarqueeArea(selectionBounds(position, position)); setSelectedArea(null); setSelectedPosition(null); return; } if (continuousTool(tool)) paint(x, y); }}
              onClick={() => { if (tool === "select") { if (suppressSelectClick.current) { suppressSelectClick.current = false; return; } setSelectedArea(null); setSelectedPosition(authoredTileKeys.has(tileKey) ? position : null); setSelectedNpcId(npc?.id ?? null); return; } if (npc) { setSelectedNpcId(npc.id); return; } if (!continuousTool(tool)) paint(x, y); }}
              onPointerEnter={(event) => { if (event.buttons !== 1 || window.document.body.classList.contains("editor-space-pan")) return; if (tool === "select" && marqueeStart.current) { marqueeEnd.current = position; setMarqueeArea(selectionBounds(marqueeStart.current, position)); return; } if (tool === "select" && editorDrag.current) { setDragTarget(position); return; } if (continuousTool(tool)) paint(x, y, true); }}
              onPointerUp={() => { if (tool === "select" && marqueeStart.current) { const start = marqueeStart.current; const selection = selectionBounds(start, position); marqueeStart.current = null; marqueeEnd.current = null; setMarqueeArea(null); setSelectedArea(authoredTileKeys.has(tileKey) || !same(start, position) ? selection : null); suppressSelectClick.current = true; return; } if (tool === "select" && editorDrag.current) { const origin = dragOrigin.current; if (origin && !same(origin, position)) moveObject(position); else { editorDrag.current = null; setDragTarget(null); suppressSelectClick.current = true; } dragOrigin.current = null; } lastPainted.current = ""; saveLocal(documentRef.current); }}
            >{playerSpawn ? "P" : npc ? "N" : resourceNode ? "⛏" : door ? "D" : windows.has(tileKey) ? "W" : torches.has(tileKey) ? "T" : stairs ? (stairs.to.z < activeFloor ? "U" : "D") : spawn ? "C" : ""}</button>;
          })}
          {selectedArea && <div className="editor-selection-frame" aria-hidden="true" style={{ left: (selectedArea.minX - viewportX) * EDITOR_TILE_SIZE * zoom, top: (selectedArea.minY - viewportY) * EDITOR_TILE_SIZE * zoom, width: (selectedArea.maxX - selectedArea.minX + 1) * EDITOR_TILE_SIZE * zoom, height: (selectedArea.maxY - selectedArea.minY + 1) * EDITOR_TILE_SIZE * zoom }} />}
          {marqueeArea && <div className="editor-marquee" aria-hidden="true" style={{ left: (marqueeArea.minX - viewportX) * EDITOR_TILE_SIZE * zoom, top: (marqueeArea.minY - viewportY) * EDITOR_TILE_SIZE * zoom, width: (marqueeArea.maxX - marqueeArea.minX + 1) * EDITOR_TILE_SIZE * zoom, height: (marqueeArea.maxY - marqueeArea.minY + 1) * EDITOR_TILE_SIZE * zoom }} />}
        </div>
      </div>
    </section>
    <footer><span>{document.width.toLocaleString()} x {document.height.toLocaleString()} / view {viewportX}-{viewportX + visibleWidth - 1}, {viewportY}-{viewportY + visibleHeight - 1}</span><strong>{tool}</strong><span>{document.blocked.length} blocked / {document.doors.length} doors / {document.spawns.length} spawns / {document.resourceNodes.length} resources / {document.npcs.length} NPCs</span><small>Top-down editor · only the visible window is rendered.</small></footer>
  </main>;
}

const MINIMAP_WIDTH = 512;
const MINIMAP_HEIGHT = 280;
const MINIMAP_PADDING = 10;

function WorldMinimap({ document, floor, viewportX, viewportY, viewportWidth, viewportHeight, onPan }: {
  document: EditorDocument;
  floor: number;
  viewportX: number;
  viewportY: number;
  viewportWidth: number;
  viewportHeight: number;
  onPan: (x: number, y: number) => void;
}) {
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const draggingPointer = useRef<number | null>(null);
  const [minimapZoom, setMinimapZoom] = useState(1);
  const [minimapFocus, setMinimapFocus] = useState(() => ({ x: viewportX + viewportWidth / 2, y: viewportY + viewportHeight / 2 }));
  const projection = minimapProjection(document.width, document.height);
  const canvasTransform = minimapCanvasTransform(
    projection,
    minimapFocus.x,
    minimapFocus.y,
    minimapZoom,
  );
  const centerOnViewport = () => setMinimapFocus({ x: viewportX + viewportWidth / 2, y: viewportY + viewportHeight / 2 });
  const changeZoom = (direction: -1 | 1) => {
    centerOnViewport();
    setMinimapZoom((current) => Math.max(1, Math.min(16, direction > 0 ? current * 2 : current / 2)));
  };

  useEffect(() => {
    setMinimapZoom(1);
    setMinimapFocus({ x: viewportX + viewportWidth / 2, y: viewportY + viewportHeight / 2 });
  }, [document.width, document.height]);

  useEffect(() => {
    const canvas = baseCanvas.current; const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    context.fillStyle = "#080d0a"; context.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    context.fillStyle = "#40523d";
    context.fillRect(projection.left, projection.top, document.width * projection.scale, document.height * projection.scale);
    drawMinimapPositions(context, document.blocked, floor, projection, "#252d29", 1);
    drawMinimapMaterials(context, document.terrainMaterials, floor, projection);
    drawMinimapPositions(context, document.water, floor, projection, "#296b7c", 1.25);
    drawMinimapPositions(context, document.roads, floor, projection, "#aaa18b", 1.4);
    drawMinimapPositions(context, document.floors, floor, projection, "#805b3c", 1.2);
    for (const building of document.buildings) {
      if (building.floor !== floor) continue;
      context.fillStyle = building.kind === "keep" ? "#929997" : "#bd8b59";
      context.fillRect(
        projection.left + building.x * projection.scale,
        projection.top + building.y * projection.scale,
        Math.max(1.5, building.width * projection.scale),
        Math.max(1.5, building.height * projection.scale),
      );
    }
    drawMinimapPositions(context, document.houseWalls, floor, projection, "#e0b06d", 1.7);
    drawMinimapPositions(context, document.castleWalls, floor, projection, "#d2d8d5", 1.7);
    drawMinimapPositions(context, document.bridges, floor, projection, "#d49a56", 2);
    drawMinimapPositions(context, document.trees, floor, projection, "#1d7b3c", 1.8);
    drawMinimapPositions(context, document.windows, floor, projection, "#68d7e7", 2);
    drawMinimapPositions(context, document.torches, floor, projection, "#ff832f", 2.2);
    drawMinimapPositions(context, document.doors.map((entry) => entry.position), floor, projection, "#ffe09a", 2.2);
    drawMinimapPositions(context, document.spawns.map((entry) => entry.position), floor, projection, "#b76cff", 2.8);
    drawMinimapPositions(context, document.resourceNodes.map((entry) => entry.position), floor, projection, "#d8854c", 3);
    drawMinimapPositions(context, document.npcs.map((entry) => entry.position), floor, projection, "#55e4be", 3);
    drawMinimapPositions(context, [document.playerSpawn], floor, projection, "#fff176", 3.5);
  }, [document, floor, projection.left, projection.scale, projection.top]);

  useEffect(() => {
    const canvas = overlayCanvas.current; const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const x = projection.left + viewportX * projection.scale;
    const y = projection.top + viewportY * projection.scale;
    const width = Math.max(3, viewportWidth * projection.scale);
    const height = Math.max(3, viewportHeight * projection.scale);
    context.fillStyle = "#f6c66f24"; context.fillRect(x, y, width, height);
    context.strokeStyle = "#ffd47e"; context.lineWidth = 2; context.strokeRect(x, y, width, height);
  }, [projection.left, projection.scale, projection.top, viewportHeight, viewportWidth, viewportX, viewportY]);

  const panFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) * MINIMAP_WIDTH / rect.width;
    const canvasY = (event.clientY - rect.top) * MINIMAP_HEIGHT / rect.height;
    const worldX = (canvasX - projection.left) / projection.scale;
    const worldY = (canvasY - projection.top) / projection.scale;
    onPan(Math.round(worldX - viewportWidth / 2), Math.round(worldY - viewportHeight / 2));
  };
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); draggingPointer.current = event.pointerId; panFromPointer(event);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (draggingPointer.current === event.pointerId) panFromPointer(event); };
  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingPointer.current = null;
  };

  return <section className="editor-minimap">
    <div className="minimap-header"><div><strong>World overview</strong><span>Floor {floor} · View {viewportX}, {viewportY}</span></div><div className="minimap-controls"><button type="button" aria-label="Zoom minimap out" disabled={minimapZoom === 1} onClick={() => changeZoom(-1)}>−</button><output>{minimapZoom}×</output><button type="button" aria-label="Zoom minimap in" disabled={minimapZoom === 16} onClick={() => changeZoom(1)}>+</button><button type="button" aria-label="Center minimap on current view" title="Center on current view" onClick={centerOnViewport}>◎</button></div></div>
    <div className="minimap-canvas" title="Click or drag to move the editor view. Use the mouse wheel to zoom." onWheel={(event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1 : -1); }}>
      <canvas ref={baseCanvas} width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} style={{ transform: canvasTransform }} />
      <canvas ref={overlayCanvas} width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} style={{ transform: canvasTransform }} aria-label="World minimap. Click or drag to move the editor view." onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
    <div className="minimap-legend"><span className="settlement">Buildings</span><span className="water-key">Water</span><span className="road-key">Roads</span><span className="life-key">Life</span></div>
    <small>Click or drag to travel across the map.</small>
  </section>;
}

function minimapProjection(worldWidth: number, worldHeight: number) {
  const scale = Math.min(
    (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / Math.max(1, worldWidth),
    (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / Math.max(1, worldHeight),
  );
  return {
    scale,
    left: (MINIMAP_WIDTH - worldWidth * scale) / 2,
    top: (MINIMAP_HEIGHT - worldHeight * scale) / 2,
  };
}

function minimapCanvasTransform(projection: ReturnType<typeof minimapProjection>, focusX: number, focusY: number, zoom: number) {
  const focusCanvasX = projection.left + focusX * projection.scale;
  const focusCanvasY = projection.top + focusY * projection.scale;
  const translateX = Math.min(0, Math.max(1 - zoom, 0.5 - focusCanvasX / MINIMAP_WIDTH * zoom));
  const translateY = Math.min(0, Math.max(1 - zoom, 0.5 - focusCanvasY / MINIMAP_HEIGHT * zoom));
  return `translate(${translateX * 100}%, ${translateY * 100}%) scale(${zoom})`;
}

function drawMinimapPositions(context: CanvasRenderingContext2D, positions: readonly Position[], floor: number, projection: ReturnType<typeof minimapProjection>, color: string, minimumSize: number) {
  context.fillStyle = color;
  const size = Math.max(minimumSize, projection.scale);
  for (const position of positions) {
    if (position.z !== floor) continue;
    context.fillRect(projection.left + position.x * projection.scale, projection.top + position.y * projection.scale, size, size);
  }
}

function drawMinimapMaterials(context: CanvasRenderingContext2D, entries: readonly TerrainMaterialView[], floor: number, projection: ReturnType<typeof minimapProjection>) {
  const colors: Record<TerrainMaterialId, string> = { packed_earth: "#765739", moss_stone: "#59644e", sandstone: "#c7a269" };
  for (const entry of entries) {
    if (entry.position.z !== floor) continue;
    context.fillStyle = colors[entry.material];
    const size = Math.max(1, projection.scale);
    context.fillRect(projection.left + entry.position.x * projection.scale, projection.top + entry.position.y * projection.scale, size, size);
  }
}

function NpcInspector({ npc, onChange, onRemove }: { npc: NpcView; onChange: (npc: NpcView, recordHistory?: boolean) => void; onRemove: () => void }) {
  const [offerItem, setOfferItem] = useState("blank_rune"); const [offerQuantity, setOfferQuantity] = useState(1); const [offerPrice, setOfferPrice] = useState(1);
  const updateOffer = (index: number, patch: Partial<NpcView["offers"][number]>) => onChange({ ...npc, offers: npc.offers.map((offer, offerIndex) => offerIndex === index ? { ...offer, ...patch } : offer) });
  const addOffer = () => { let id = offerItem; let suffix = 2; while (npc.offers.some((offer) => offer.id === id)) id = `${offerItem}_${suffix++}`; onChange({ ...npc, offers: [...npc.offers, { id, itemDefinitionId: offerItem, quantity: Math.max(1, offerQuantity), price: Math.max(1, offerPrice) }] }, true); };
  return <section className="npc-inspector"><hr /><h2>Edit NPC</h2><small>Position {npc.position.x}, {npc.position.y}, {npc.position.z}. Use Move objects to relocate.</small><label>Stable ID<input value={npc.id} maxLength={60} onChange={(event) => onChange({ ...npc, id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></label><label>Name<input value={npc.name} maxLength={40} onChange={(event) => onChange({ ...npc, name: event.target.value })} /></label><label>Title<input value={npc.title} maxLength={80} onChange={(event) => onChange({ ...npc, title: event.target.value })} /></label><label>Service<select value={npc.service} onChange={(event) => { const service = event.target.value as NpcView["service"]; onChange({ ...npc, service, offers: service === "shop" ? npc.offers : [], spellIds: service === "spell_trainer" ? npc.spellIds : [], recipeIds: service === "craft_trainer" ? npc.recipeIds : [] }, true); }}><option value="shop">Shop</option><option value="depot">Depot</option><option value="spell_trainer">Spell trainer</option><option value="craft_trainer">Craft trainer</option></select></label><label>Dialogue<textarea value={npc.dialogue} maxLength={500} rows={4} onChange={(event) => onChange({ ...npc, dialogue: event.target.value })} /></label>
     {npc.service === "shop" && <div className="npc-service-editor"><div className="shop-offers-heading"><div><h3>Shop offers</h3><small>What this NPC sells and how much it costs.</small></div><span>{npc.offers.length} {npc.offers.length === 1 ? "offer" : "offers"}</span></div>{npc.offers.length === 0 && <p className="empty-offers">No offers yet. Add the first item below.</p>}{npc.offers.map((offer, index) => <div className="offer-editor" key={`${offer.id}-${index}`}><div className="offer-editor-title"><strong>Offer {index + 1}</strong><button type="button" onClick={() => onChange({ ...npc, offers: npc.offers.filter((_, offerIndex) => offerIndex !== index) }, true)}>Remove</button></div><label>Offer ID<input aria-label="Offer id" value={offer.id} onChange={(event) => updateOffer(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></label><label>Item<select aria-label="Offer item" value={offer.itemDefinitionId} onChange={(event) => updateOffer(index, { itemDefinitionId: event.target.value })}>{itemIds.map((id) => <option key={id}>{id}</option>)}</select></label><label>Quantity<input aria-label="Offer quantity" type="number" min="1" value={offer.quantity} onChange={(event) => updateOffer(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} /></label><label>Price in gold<input aria-label="Offer price" type="number" min="1" value={offer.price} onChange={(event) => updateOffer(index, { price: Math.max(1, Number(event.target.value) || 1) })} /></label></div>)}<div className="offer-add"><div className="offer-add-title"><strong>Add offer</strong><small>Create a new item for this shop.</small></div><label>Item<select value={offerItem} onChange={(event) => setOfferItem(event.target.value)}>{itemIds.map((id) => <option key={id}>{id}</option>)}</select></label><label>Quantity<input title="Quantity" aria-label="New offer quantity" type="number" min="1" value={offerQuantity} onChange={(event) => setOfferQuantity(Math.max(1, Number(event.target.value) || 1))} /></label><label>Price in gold<input title="Gold price" aria-label="New offer price" type="number" min="1" value={offerPrice} onChange={(event) => setOfferPrice(Math.max(1, Number(event.target.value) || 1))} /></label><button type="button" onClick={addOffer}>Add offer</button></div></div>}
    {npc.service === "spell_trainer" && <div className="npc-service-editor"><h3>Teachable spells</h3>{spellIds.map((spellId) => <label className="spell-toggle" key={spellId}><input type="checkbox" checked={npc.spellIds.includes(spellId)} onChange={(event) => onChange({ ...npc, spellIds: event.target.checked ? [...npc.spellIds, spellId] : npc.spellIds.filter((id) => id !== spellId) }, true)} />{spellId}</label>)}</div>}
    {npc.service === "craft_trainer" && <div className="npc-service-editor"><h3>Teachable recipes</h3>{recipeIds.map((recipeId) => <label className="spell-toggle" key={recipeId}><input type="checkbox" checked={npc.recipeIds.includes(recipeId)} onChange={(event) => onChange({ ...npc, recipeIds: event.target.checked ? [...npc.recipeIds, recipeId] : npc.recipeIds.filter((id) => id !== recipeId) }, true)} />{recipeId}</label>)}</div>}
    <button className="remove-npc" onClick={onRemove}>Remove NPC</button>
  </section>;
}

function firstSafeBaseTile(document: EditorDocument): Position { const blocked = new Set(document.blocked.filter((tile) => tile.z === document.floor).map(key)); const occupied = new Set([...(document.spawns ?? []).map((entry) => key(entry.position)), ...(document.npcs ?? []).map((entry) => key(entry.position)), ...(document.resourceNodes ?? []).map((entry) => key(entry.position)), ...(document.objects ?? []).filter((entry) => ["mountain_wall", "forest_tree", "pine_tree", "snowy_pine", "snow_bank", "well", "table"].includes(entry.kind)).map((entry) => key(entry.position))]); for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) { const position = { x, y, z: document.floor }; if (!blocked.has(key(position)) && !occupied.has(key(position))) return position; } return { x: 0, y: 0, z: document.floor }; }
function nextBrowserPaint() { return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function normalizeDocument(document: EditorDocument): EditorDocument {
  const normalized = { ...document, bridges: document.bridges ?? [], trees: document.trees ?? [], windows: document.windows ?? [], torches: document.torches ?? [], terrainMaterials: document.terrainMaterials ?? [], objects: document.objects ?? [], npcs: document.npcs ?? [], resourceNodes: document.resourceNodes ?? [], playerSpawn: document.playerSpawn ?? { x: 0, y: 0, z: document.floor } };
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

function worldFileName(name: string) {
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aldoria-world";
  return `${safeName}.world.json`;
}

function downloadWorld(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.hidden = true;
  window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
