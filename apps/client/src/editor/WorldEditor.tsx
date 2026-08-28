import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BuildingView, DoorView, NpcView, Position, StairView } from "../protocol";

type PaintLayer = "pan" | "move" | "erase" | "blocked" | "water" | "roads" | "floors" | "houseWalls" | "castleWalls" | "house" | "keep" | "removeBuilding" | "door" | "stairs" | "spawn" | "npc" | "playerSpawn";
type SpawnView = { id: string; definitionId: string; position: Position };
type EditorDrag = { kind: "playerSpawn" } | { kind: "door"; id: string } | { kind: "stairs"; id: string } | { kind: "spawn"; id: string } | { kind: "npc"; id: string } | { kind: "building"; id: string; offsetX: number; offsetY: number };
type EditorDocument = {
  version: 1; name: string; width: number; height: number; floor: number;
  blocked: Position[]; water: Position[]; roads: Position[]; floors: Position[];
  houseWalls: Position[]; castleWalls: Position[]; buildings: BuildingView[];
  doors: DoorView[]; stairs: StairView[]; spawns: SpawnView[];
  playerSpawn: Position;
  npcs: NpcView[];
};

const tileLayers = ["blocked", "water", "roads", "floors", "houseWalls", "castleWalls"] as const;
const tools: { id: PaintLayer; label: string; swatch: string }[] = [
  { id: "pan", label: "Pan world", swatch: "#4e7890" }, { id: "move", label: "Move objects", swatch: "#7b9f76" }, { id: "playerSpawn", label: "Player start", swatch: "#f1d16f" }, { id: "npc", label: "NPC", swatch: "#5fc4ad" },
  { id: "erase", label: "Erase", swatch: "#171b19" }, { id: "roads", label: "Road", swatch: "#716b5f" },
  { id: "floors", label: "Floor", swatch: "#805d3e" }, { id: "water", label: "Water", swatch: "#245b65" },
  { id: "houseWalls", label: "House wall", swatch: "#9a7654" }, { id: "castleWalls", label: "Castle wall", swatch: "#67706d" },
  { id: "house", label: "House", swatch: "#b9875d" }, { id: "keep", label: "Keep", swatch: "#818b87" },
  { id: "removeBuilding", label: "Remove building", swatch: "#5c3030" },
  { id: "blocked", label: "Collision", swatch: "#bf4d45" }, { id: "door", label: "Door", swatch: "#c68b4d" },
  { id: "stairs", label: "Stairs", swatch: "#d7c18e" }, { id: "spawn", label: "Creature", swatch: "#9b5fd0" },
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
  return { version: 1, name: "New Aldoria Region", width: 32, height: 24, floor: 7, blocked: [], water: [], roads: [], floors: [], houseWalls: [], castleWalls: [], buildings: [], doors: [], stairs: [], spawns: [], playerSpawn: { x: 1, y: 1, z: 7 }, npcs: [] };
}
const key = (position: Position) => `${position.x}:${position.y}:${position.z}`;
const same = (left: Position, right: Position) => left.x === right.x && left.y === right.y && left.z === right.z;
const saveLocal = (document: EditorDocument) => { try { localStorage.setItem("aldoria-world-editor", JSON.stringify(document)); } catch { /* Large maps can exceed browser storage; JSON export remains available. */ } };

export function WorldEditor() {
  const [document, setDocument] = useState<EditorDocument>(() => loadLocal());
  const documentRef = useRef(document);
  const [tool, setTool] = useState<PaintLayer>("roads");
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
  const layerSets = useMemo(() => Object.fromEntries(tileLayers.map((layer) => [layer, new Set(document[layer].filter((tile) => tile.z === activeFloor).map(key))])) as Record<(typeof tileLayers)[number], Set<string>>, [document, activeFloor]);
  const spawnByTile = useMemo(() => new Map(document.spawns.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.spawns, activeFloor]);
  const doorByTile = useMemo(() => new Map(document.doors.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.doors, activeFloor]);
  const stairsByTile = useMemo(() => new Map(document.stairs.filter((entry) => entry.from.z === activeFloor).map((entry) => [key(entry.from), entry])), [document.stairs, activeFloor]);
  const npcByTile = useMemo(() => new Map(document.npcs.filter((entry) => entry.position.z === activeFloor).map((entry) => [key(entry.position), entry])), [document.npcs, activeFloor]);
  const viewportX = Math.max(0, Math.min(viewX, Math.max(0, document.width - VIEW_COLUMNS)));
  const viewportY = Math.max(0, Math.min(viewY, Math.max(0, document.height - VIEW_ROWS)));
  const visibleWidth = Math.min(VIEW_COLUMNS, document.width - viewportX);
  const visibleHeight = Math.min(VIEW_ROWS, document.height - viewportY);

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
    if (tool === "pan" || tool === "move") return;
    if (tool === "erase") {
      for (const layer of tileLayers) next[layer] = next[layer].filter((tile) => !same(tile, position));
      next.doors = next.doors.filter((entry) => !same(entry.position, position)); next.spawns = next.spawns.filter((entry) => !same(entry.position, position)); next.stairs = next.stairs.filter((entry) => !same(entry.from, position));
    } else if (tool === "removeBuilding") {
      const building = next.buildings.find((entry) => entry.floor === activeFloor && x >= entry.x && y >= entry.y && x < entry.x + entry.width && y < entry.y + entry.height);
      if (!building) return;
      const inside = (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height;
      next.buildings = next.buildings.filter((entry) => entry.id !== building.id);
      next.houseWalls = next.houseWalls.filter((tile) => !inside(tile)); next.castleWalls = next.castleWalls.filter((tile) => !inside(tile)); next.floors = next.floors.filter((tile) => !inside(tile)); next.blocked = next.blocked.filter((tile) => !inside(tile)); next.doors = next.doors.filter((entry) => !inside(entry.position));
    } else if ((tileLayers as readonly string[]).includes(tool)) {
      const layer = tool as (typeof tileLayers)[number];
      if (!next[layer].some((tile) => same(tile, position))) next[layer].push(position);
      if (["water", "houseWalls", "castleWalls"].includes(layer) && !next.blocked.some((tile) => same(tile, position))) next.blocked.push(position);
    } else if (tool === "door" && !next.doors.some((entry) => same(entry.position, position))) {
      next.houseWalls = next.houseWalls.filter((tile) => !same(tile, position)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, position)); next.blocked = next.blocked.filter((tile) => !same(tile, position));
      next.doors.push({ id: `door_${activeFloor}_${x}_${y}`, position, open: true });
    } else if (tool === "stairs" && !next.stairs.some((entry) => same(entry.from, position))) {
      next.stairs.push({ id: `stairs_${activeFloor}_${x}_${y}_to_${destinationFloor}`, from: position, to: { x, y, z: destinationFloor } });
    } else if (tool === "spawn" && !same(next.playerSpawn, position) && !next.npcs.some((entry) => same(entry.position, position)) && !next.spawns.some((entry) => same(entry.position, position))) {
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
      next.blocked = next.blocked.filter((tile) => !same(tile, position)); next.water = next.water.filter((tile) => !same(tile, position)); next.houseWalls = next.houseWalls.filter((tile) => !same(tile, position)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, position)); next.doors = next.doors.filter((door) => !same(door.position, position)); next.spawns = next.spawns.filter((spawn) => !same(spawn.position, position)); next.npcs = next.npcs.filter((npc) => !same(npc.position, position));
      if (activeFloor !== next.floor && !next.floors.some((tile) => same(tile, position))) next.floors.push(position);
    } else if ((tool === "house" || tool === "keep") && !next.buildings.some((entry) => entry.x === x && entry.y === y && entry.floor === activeFloor)) {
      const width = Math.min(buildingWidth, source.width - x); const height = Math.min(buildingHeight, source.height - y);
      if (width < 3 || height < 3) return;
      next.buildings.push({ id: `${tool}_${activeFloor}_${x}_${y}`, name: tool === "keep" ? "New Keep" : "New House", kind: tool, x, y, width, height, floor: activeFloor });
      const wallLayer = tool === "keep" ? "castleWalls" : "houseWalls";
      for (let tileY = y; tileY < y + height; tileY += 1) for (let tileX = x; tileX < x + width; tileX += 1) {
        const tile = { x: tileX, y: tileY, z: activeFloor }; const perimeter = tileX === x || tileY === y || tileX === x + width - 1 || tileY === y + height - 1;
        if (perimeter) { if (!next[wallLayer].some((entry) => same(entry, tile))) next[wallLayer].push(tile); if (!next.blocked.some((entry) => same(entry, tile))) next.blocked.push(tile); }
        else if (!next.floors.some((entry) => same(entry, tile))) next.floors.push(tile);
      }
    }
    commit(next, !dragging);
  };
  const restore = (next: EditorDocument) => { documentRef.current = next; setDocument(next); saveLocal(next); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [documentRef.current, ...items]); setHistory((items) => items.slice(0, -1)); restore(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, documentRef.current]); setFuture((items) => items.slice(1)); restore(next); };
  const exportWorld = () => { const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }); const anchor = Object.assign(window.document.createElement("a"), { href: URL.createObjectURL(blob), download: `${document.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.world.json` }); anchor.click(); URL.revokeObjectURL(anchor.href); };
  const importWorld = async (file?: File) => { if (!file) return; const parsed = normalizeDocument(JSON.parse(await file.text()) as EditorDocument); if (parsed.version !== 1 || !Array.isArray(parsed.blocked) || !Array.isArray(parsed.spawns) || parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_WORLD_SIZE || parsed.height > MAX_WORLD_SIZE) throw new Error("Unsupported world document"); commit(parsed); setActiveFloor(parsed.floor); setWorldWidth(parsed.width); setWorldHeight(parsed.height); setViewX(0); setViewY(0); };
  const resizeWorld = () => {
    const width = Number.isFinite(worldWidth) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldWidth))) : document.width; const height = Number.isFinite(worldHeight) ? Math.max(8, Math.min(MAX_WORLD_SIZE, Math.trunc(worldHeight))) : document.height;
    const inBounds = (position: Position) => position.x >= 0 && position.y >= 0 && position.x < width && position.y < height;
    const removed = tileLayers.reduce((count, layer) => count + document[layer].filter((tile) => !inBounds(tile)).length, 0)
      + document.doors.filter((entry) => !inBounds(entry.position)).length + document.stairs.filter((entry) => !inBounds(entry.from) || !inBounds(entry.to)).length
      + document.spawns.filter((entry) => !inBounds(entry.position)).length + document.buildings.filter((entry) => entry.x < 0 || entry.y < 0 || entry.x + entry.width > width || entry.y + entry.height > height).length
      + document.npcs.filter((entry) => !inBounds(entry.position)).length
      + (inBounds(document.playerSpawn) ? 0 : 1);
    if (removed > 0 && !window.confirm(`Shrinking the world removes ${removed} out-of-bounds entries. Continue?`)) return;
    const next = structuredClone(document); next.width = width; next.height = height;
    for (const layer of tileLayers) next[layer] = next[layer].filter(inBounds);
    next.doors = next.doors.filter((entry) => inBounds(entry.position)); next.stairs = next.stairs.filter((entry) => inBounds(entry.from) && inBounds(entry.to)); next.spawns = next.spawns.filter((entry) => inBounds(entry.position)); next.npcs = next.npcs.filter((entry) => inBounds(entry.position)); next.buildings = next.buildings.filter((entry) => entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= width && entry.y + entry.height <= height);
    if (!inBounds(next.playerSpawn)) next.playerSpawn = firstSafeBaseTile(next);
    setWorldWidth(width); setWorldHeight(height); commit(next);
  };
  const panTo = (x: number, y: number) => { const nextX = Number.isFinite(x) ? Math.trunc(x) : viewportX; const nextY = Number.isFinite(y) ? Math.trunc(y) : viewportY; setViewX(Math.max(0, Math.min(nextX, Math.max(0, document.width - VIEW_COLUMNS)))); setViewY(Math.max(0, Math.min(nextY, Math.max(0, document.height - VIEW_ROWS)))); };
  const newWorld = () => { const next = blankDocument(); setWorldWidth(next.width); setWorldHeight(next.height); setActiveFloor(next.floor); setViewX(0); setViewY(0); commit(next); };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 1 && !(tool === "pan" && event.button === 0)) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewportX, originY: viewportY }; };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => { const gesture = panGesture.current; if (!gesture || gesture.pointerId !== event.pointerId) return; const screenX = event.clientX - gesture.startX; const screenY = event.clientY - gesture.startY; const halfWidth = ISO_TILE_WIDTH * zoom / 2; const halfHeight = ISO_TILE_HEIGHT * zoom / 2; const tileX = (screenX / halfWidth + screenY / halfHeight) / 2; const tileY = (-screenX / halfWidth + screenY / halfHeight) / 2; panTo(gesture.originX - Math.round(tileX), gesture.originY - Math.round(tileY)); };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (panGesture.current?.pointerId !== event.pointerId) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); panGesture.current = null; };
  const objectAt = (position: Position): EditorDrag | null => { if (same(document.playerSpawn, position)) return { kind: "playerSpawn" }; const npc = npcByTile.get(key(position)); if (npc) return { kind: "npc", id: npc.id }; const door = doorByTile.get(key(position)); if (door) return { kind: "door", id: door.id }; const stairs = stairsByTile.get(key(position)); if (stairs) return { kind: "stairs", id: stairs.id }; const spawn = spawnByTile.get(key(position)); if (spawn) return { kind: "spawn", id: spawn.id }; const building = document.buildings.find((entry) => entry.floor === position.z && position.x >= entry.x && position.y >= entry.y && position.x < entry.x + entry.width && position.y < entry.y + entry.height); return building ? { kind: "building", id: building.id, offsetX: position.x - building.x, offsetY: position.y - building.y } : null; };
  const startObjectDrag = (event: ReactDragEvent, object: EditorDrag | null) => { if (tool !== "move" || !object) { event.preventDefault(); return; } editorDrag.current = object; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", `${object.kind}:${"id" in object ? object.id : "start"}`); };
  const moveObject = (target: Position) => {
    const dragged = editorDrag.current; if (!dragged) return; const next = structuredClone(documentRef.current);
    if (dragged.kind === "playerSpawn") { next.playerSpawn = target; next.blocked = next.blocked.filter((tile) => !same(tile, target)); next.water = next.water.filter((tile) => !same(tile, target)); next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.doors = next.doors.filter((door) => !same(door.position, target)); next.spawns = next.spawns.filter((spawn) => !same(spawn.position, target)); next.npcs = next.npcs.filter((npc) => !same(npc.position, target)); if (target.z !== next.floor && !next.floors.some((tile) => same(tile, target))) next.floors.push(target); }
    else if (dragged.kind === "door") { const door = next.doors.find((entry) => entry.id === dragged.id); if (!door || next.doors.some((entry) => entry.id !== door.id && same(entry.position, target))) return; door.position = target; next.houseWalls = next.houseWalls.filter((tile) => !same(tile, target)); next.castleWalls = next.castleWalls.filter((tile) => !same(tile, target)); next.blocked = next.blocked.filter((tile) => !same(tile, target)); }
    else if (dragged.kind === "spawn") { const spawn = next.spawns.find((entry) => entry.id === dragged.id); if (!spawn || next.spawns.some((entry) => entry.id !== spawn.id && same(entry.position, target))) return; spawn.position = target; }
    else if (dragged.kind === "npc") { const npc = next.npcs.find((entry) => entry.id === dragged.id); if (!npc || next.blocked.some((tile) => same(tile, target)) || same(next.playerSpawn, target) || next.spawns.some((entry) => same(entry.position, target)) || next.npcs.some((entry) => entry.id !== npc.id && same(entry.position, target))) return; npc.position = target; setSelectedNpcId(npc.id); }
    else if (dragged.kind === "stairs") { const stairs = next.stairs.find((entry) => entry.id === dragged.id); if (!stairs || next.stairs.some((entry) => entry.id !== stairs.id && same(entry.from, target))) return; const dx = target.x - stairs.from.x; const dy = target.y - stairs.from.y; stairs.from = target; stairs.to = { x: stairs.to.x + dx, y: stairs.to.y + dy, z: stairs.to.z }; if (stairs.to.x < 0 || stairs.to.y < 0 || stairs.to.x >= next.width || stairs.to.y >= next.height) return; }
    else { const building = next.buildings.find((entry) => entry.id === dragged.id); if (!building) return; const targetX = target.x - dragged.offsetX; const targetY = target.y - dragged.offsetY; const dx = targetX - building.x; const dy = targetY - building.y; if (targetX < 0 || targetY < 0 || targetX + building.width > next.width || targetY + building.height > next.height) return; const inside = (tile: Position) => tile.z === building.floor && tile.x >= building.x && tile.y >= building.y && tile.x < building.x + building.width && tile.y < building.y + building.height; const structural = new Set([...next.houseWalls, ...next.castleWalls].filter(inside).map(key)); const shifted = (tile: Position) => inside(tile) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile; next.houseWalls = next.houseWalls.map(shifted); next.castleWalls = next.castleWalls.map(shifted); next.floors = next.floors.map(shifted); next.blocked = next.blocked.map((tile) => structural.has(key(tile)) ? { x: tile.x + dx, y: tile.y + dy, z: tile.z } : tile); next.doors = next.doors.map((door) => inside(door.position) ? { ...door, position: shifted(door.position) } : door); building.x = targetX; building.y = targetY; }
    editorDrag.current = null; commit(next);
  };
  const selectedNpc = selectedNpcId ? document.npcs.find((npc) => npc.id === selectedNpcId) : undefined;
  const updateNpc = (npc: NpcView, recordHistory = false) => { const next = structuredClone(documentRef.current); const index = next.npcs.findIndex((entry) => entry.id === selectedNpcId); if (index < 0) return; next.npcs[index] = npc; setSelectedNpcId(npc.id); if (recordHistory) commit(next); else restore(next); };
  const removeNpc = () => { if (!selectedNpcId) return; const next = structuredClone(documentRef.current); next.npcs = next.npcs.filter((npc) => npc.id !== selectedNpcId); setSelectedNpcId(null); commit(next); };

  return <main className="editor-shell">
    <header><div><p>EMBERS OF ALDORIA</p><h1>World Editor</h1></div><input value={document.name} onChange={(event) => restore({ ...document, name: event.target.value })} /><span>{document.width} x {document.height} / z={activeFloor}</span><a href="/">Open game</a></header>
    <aside className="palette"><h2>World</h2><label>Map size (tiles)<span className="number-pair"><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldWidth} onChange={(event) => setWorldWidth(Number(event.target.value))} /><b>x</b><input type="number" min="8" max={MAX_WORLD_SIZE} value={worldHeight} onChange={(event) => setWorldHeight(Number(event.target.value))} /></span></label><button className="resize-button" onClick={resizeWorld}>Resize world</button><small>Maximum {MAX_WORLD_SIZE.toLocaleString()} x {MAX_WORLD_SIZE.toLocaleString()}. Only authored tiles are stored.</small><hr /><h2>Terrain & objects</h2>{tools.map((entry) => <button className={tool === entry.id ? "active" : ""} key={entry.id} onClick={() => setTool(entry.id)}><i style={{ background: entry.swatch }} />{entry.label}</button>)}<hr /><label>New NPC service<select value={npcService} onChange={(event) => setNpcService(event.target.value as NpcView["service"])}><option value="shop">Shop</option><option value="depot">Depot</option><option value="spell_trainer">Spell trainer</option></select></label><label>Building size<span className="number-pair"><input type="number" min="3" max="20" value={buildingWidth} onChange={(event) => setBuildingWidth(Number(event.target.value))} /><b>x</b><input type="number" min="3" max="20" value={buildingHeight} onChange={(event) => setBuildingHeight(Number(event.target.value))} /></span></label><label>Creature<select value={creatureId} onChange={(event) => setCreatureId(event.target.value)}>{creatureIds.map((id) => <option key={id}>{id}</option>)}</select></label><label>Stairs lead to<select value={destinationFloor} onChange={(event) => setDestinationFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label>{selectedNpc && <NpcInspector npc={selectedNpc} onChange={updateNpc} onRemove={removeNpc} />}</aside>
    <section className="editor-workspace"><nav><button disabled={!history.length} onClick={undo}>Undo</button><button disabled={!future.length} onClick={redo}>Redo</button><label>Floor<select value={activeFloor} onChange={(event) => setActiveFloor(Number(event.target.value))}>{[6, 7, 8, 9].map((floor) => <option key={floor}>{floor}</option>)}</select></label><span className="pan-controls"><button onClick={() => panTo(viewportX - PAN_STEP, viewportY)}>W</button><button onClick={() => panTo(viewportX, viewportY - PAN_STEP)}>N</button><label>X<input type="number" min="0" max={document.width - 1} value={viewportX} onChange={(event) => panTo(Number(event.target.value), viewportY)} /></label><label>Y<input type="number" min="0" max={document.height - 1} value={viewportY} onChange={(event) => panTo(viewportX, Number(event.target.value))} /></label><button onClick={() => panTo(viewportX, viewportY + PAN_STEP)}>S</button><button onClick={() => panTo(viewportX + PAN_STEP, viewportY)}>E</button></span><label>Zoom<input type="range" min="0.5" max="1.5" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><button onClick={newWorld}>New</button><label className="file-button">Import<input type="file" accept=".json" onChange={(event) => void importWorld(event.target.files?.[0]).catch((error) => alert(error))} /></label><button className="primary" onClick={exportWorld}>Export JSON</button></nav>
      <div className={`map-scroll ${tool === "pan" ? "pan-mode" : ""}`} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}><div className="editor-grid isometric" style={{ width: (visibleWidth + visibleHeight) * ISO_TILE_WIDTH * zoom / 2, height: (visibleWidth + visibleHeight) * ISO_TILE_HEIGHT * zoom / 2 }}>{Array.from({ length: visibleWidth * visibleHeight }, (_, index) => { const column = index % visibleWidth; const row = Math.floor(index / visibleWidth); const x = viewportX + column; const y = viewportY + row; const position = { x, y, z: activeFloor }; const tileKey = key(position); const spawn = spawnByTile.get(tileKey); const npc = npcByTile.get(tileKey); const door = doorByTile.get(tileKey); const stairs = stairsByTile.get(tileKey); const playerSpawn = same(document.playerSpawn, position); const editorObject = objectAt(position); const classes = tileLayers.filter((layer) => layerSets[layer].has(tileKey)).join(" "); return <button title={npc ? `${npc.name} - ${npc.title}` : `${x}, ${y}, ${activeFloor}`} aria-label={`Tile ${x}, ${y}`} draggable={tool === "move" && Boolean(editorObject)} className={`editor-tile ${classes} ${playerSpawn ? "player-spawn" : ""} ${npc?.id === selectedNpcId ? "npc-selected" : ""} ${tool === "move" && editorObject ? "movable" : ""}`} style={{ width: ISO_TILE_WIDTH * zoom, height: ISO_TILE_HEIGHT * zoom, left: (column - row + visibleHeight - 1) * ISO_TILE_WIDTH * zoom / 2, top: (column + row) * ISO_TILE_HEIGHT * zoom / 2, zIndex: column + row }} key={tileKey} onDragStart={(event) => startObjectDrag(event, editorObject)} onDragOver={(event) => { if (editorDrag.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); moveObject(position); }} onDragEnd={() => { editorDrag.current = null; }} onPointerDown={(event) => { if (event.button === 0 && tool !== "pan") paint(x, y); if (event.button === 0 && npc) setSelectedNpcId(npc.id); }} onPointerEnter={(event) => { if (event.buttons === 1 && !["pan", "move", "door", "stairs", "spawn", "npc", "playerSpawn", "house", "keep", "removeBuilding"].includes(tool)) paint(x, y, true); }} onPointerUp={() => { lastPainted.current = ""; saveLocal(documentRef.current); }}>{playerSpawn ? "P" : npc ? "N" : door ? "D" : stairs ? (stairs.to.z < activeFloor ? "U" : "D") : spawn ? "C" : ""}</button>; })}</div></div>
    </section>
    <footer><span>{document.width.toLocaleString()} x {document.height.toLocaleString()} / view {viewportX}-{viewportX + visibleWidth - 1}, {viewportY}-{viewportY + visibleHeight - 1}</span><strong>{tool}</strong><span>{document.blocked.length} blocked / {document.doors.length} doors / {document.spawns.length} spawns / {document.npcs.length} NPCs</span><small>Only the visible editor window is rendered.</small></footer>
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
function normalizeDocument(document: EditorDocument): EditorDocument { const normalized = { ...document, npcs: document.npcs ?? [], playerSpawn: document.playerSpawn ?? { x: 0, y: 0, z: document.floor } }; if (!document.playerSpawn) normalized.playerSpawn = firstSafeBaseTile(normalized); return normalized; }
function loadLocal(): EditorDocument { try { const saved = localStorage.getItem("aldoria-world-editor"); return saved ? normalizeDocument(JSON.parse(saved) as EditorDocument) : blankDocument(); } catch { return blankDocument(); } }
