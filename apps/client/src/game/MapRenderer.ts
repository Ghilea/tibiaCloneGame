import { Application, Assets, Container, Graphics, Matrix, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import { WorldState } from "./WorldState";
import type { InputController } from "./InputController";
import { ISO_ANGLE, ISO_VERTICAL_SCALE, projectWorld, unprojectWorld } from "./CameraProjection";
import { waterEdgesAt, type WaterEdgeSide } from "./WaterEdges";
import { createBuildingGeometry, type BuildingGeometry, type BuildingPoint, type WallEdge } from "./BuildingGeometry";

const TILE = 48;
const CAMERA_ZOOM = 2.8;
const CREATURE_STEP_MS = 250;
const PLAYER_FACING_X: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0];
type VisualPosition = { x: number; y: number };
type MotionState = { x: number; y: number };
type CardinalFacing = 0 | 1 | 2 | 3;
type PlayerFacing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ActiveCombatEffect = {
  projectile: Container;
  damageText: Text;
  from: VisualPosition;
  to: VisualPosition;
  elapsed: number;
};
type ActiveAreaWarning = { graphic: Graphics; elapsed: number; duration: number };
type WaterSurface = { sprite: TilingSprite; baseX: number; baseY: number; speedX: number; speedY: number };
type Occluder = { node: Container; kind: "wall" | "tree" | "roof" };
type RoofFootprint = { id: string; kind: "house" | "keep"; x: number; y: number; width: number; height: number; floor: number };

export class MapRenderer {
  private app = new Application();
  private scene = new Container();
  private terrainLayer = new Container();
  private actorLayer = new Container();
  private effectLayer = new Container();
  private buildingDebugLayer = new Container();
  private atmosphereLayer = new Container();
  private atmosphereShade = new Graphics();
  private weatherGraphics = new Graphics();
  private lightGraphics = new Graphics();
  private structureNodes: Container[] = [];
  private occluders: Occluder[] = [];
  private dynamicNodes: Container[] = [];
  private roofNodes = new Map<string, Container>();
  private creatureNodes = new Map<string, Container>();
  private creatureSprites = new Map<string, Sprite>();
  private creatureFacings = new Map<string, CardinalFacing>();
  private playerNodes = new Map<string, Container>();
  private playerSprites = new Map<string, Sprite>();
  private playerFacings = new Map<string, PlayerFacing>();
  private playerVelocities = new Map<string, MotionState>();
  private visualPositions = new Map<string, VisualPosition>();
  private seenCombatEffects = new Set<string>();
  private activeCombatEffects: ActiveCombatEffect[] = [];
  private seenAreaWarnings = new Set<string>();
  private activeAreaWarnings: ActiveAreaWarning[] = [];
  private unsubscribe: (() => void) | null = null;
  private world: WorldState | null = null;
  private input: InputController | null = null;
  private mapSignature = "";
  private grassTexture: Texture | null = null;
  private cobbleTexture: Texture | null = null;
  private packedEarthTexture: Texture | null = null;
  private mossStoneTexture: Texture | null = null;
  private sandstoneTexture: Texture | null = null;
  private waterTexture: Texture | null = null;
  private timberWallTexture: Texture | null = null;
  private castleWallTexture: Texture | null = null;
  private roofTexture: Texture | null = null;
  private treeTexture: Texture | null = null;
  private waterSurfaces: WaterSurface[] = [];
  private torchFlames: { flame: Graphics; phase: number }[] = [];
  private creatureFrames: Texture[] = [];
  private cellarCreatureFrames: Texture[] = [];
  private itemFrames: Texture[] = [];
  private playerFrames: Texture[] = [];
  private buildingDebug = false;
  private showLegacyWalls = true;
  private showCanonicalWalls = true;
  private showBuildingRoofs = true;
  private showBuildingFloors = true;
  constructor() {
    this.applyPlaneProjection();
    this.scene.scale.set(CAMERA_ZOOM);
    this.actorLayer.sortableChildren = true;
  }

  async mount(element: HTMLElement, world: WorldState, input: InputController) {
    this.world = world;
    this.input = input;
    try {
      [this.grassTexture, this.cobbleTexture, this.packedEarthTexture, this.mossStoneTexture, this.sandstoneTexture, this.waterTexture, this.timberWallTexture, this.castleWallTexture, this.roofTexture, this.treeTexture] = await Promise.all([
        Assets.load<Texture>("/assets/world/greyhaven-grass.png"),
        Assets.load<Texture>("/assets/world/greyhaven-cobble.png"),
        Assets.load<Texture>("/assets/world/aldoria-packed-earth-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-moss-stone-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-sandstone-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-water-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-timber-plaster-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-castle-stone-v2.png"),
        Assets.load<Texture>("/assets/world/aldoria-roof-tiles-v1.png"),
        Assets.load<Texture>("/assets/world/aldoria-oak-v1.png"),
      ]);
      this.waterTexture.source.style.addressMode = "repeat";
      this.waterTexture.source.style.scaleMode = "linear";
    } catch {
      this.grassTexture = null;
      this.cobbleTexture = null;
      this.packedEarthTexture = null;
      this.mossStoneTexture = null;
      this.sandstoneTexture = null;
      this.waterTexture = null;
      this.timberWallTexture = null;
      this.castleWallTexture = null;
      this.roofTexture = null;
      this.treeTexture = null;
    }
    try {
      const [creatureAtlas, cellarCreatureAtlas, itemAtlas, playerAtlas] = await Promise.all([
        Assets.load<Texture>("/assets/sprites/greyhaven-mire-creatures-v4.png"),
        Assets.load<Texture>("/assets/sprites/greyhaven-cellar-creatures-v1.png"),
        Assets.load<Texture>("/assets/sprites/aldoria-items-v2.png"),
        Assets.load<Texture>("/assets/sprites/aldoria-adventurer-v2.png"),
      ]);
      // Creature art is scaled and slightly rotated while walking. Nearest
      // sampling prevents the GPU from pulling coloured pixels across a frame
      // boundary, while the inset keeps every direction isolated.
      creatureAtlas.source.style.scaleMode = "nearest";
      cellarCreatureAtlas.source.style.scaleMode = "nearest";
      itemAtlas.source.style.scaleMode = "nearest";
      playerAtlas.source.style.scaleMode = "linear";
      this.creatureFrames = this.sliceAtlas(creatureAtlas, 4, 4, 12);
      this.cellarCreatureFrames = this.sliceAtlas(cellarCreatureAtlas, 4, 4, 12);
      this.itemFrames = this.sliceAtlas(itemAtlas, 4, 4, 4);
      this.playerFrames = this.slicePlayerAtlas(playerAtlas);
    } catch {
      this.creatureFrames = [];
      this.cellarCreatureFrames = [];
      this.itemFrames = [];
      this.playerFrames = [];
    }
    await this.app.init({ resizeTo: element, background: "#0a0f0d", antialias: true });
    element.appendChild(this.app.canvas);
    this.scene.addChild(this.terrainLayer, this.actorLayer, this.effectLayer, this.buildingDebugLayer);
    this.atmosphereLayer.eventMode = "none";
    this.lightGraphics.blendMode = "screen";
    this.atmosphereLayer.addChild(this.atmosphereShade, this.weatherGraphics, this.lightGraphics);
    this.app.stage.addChild(this.scene, this.atmosphereLayer);
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.addEventListener("contextmenu", this.preventContextMenu);
    window.addEventListener("keydown", this.onDebugKey);
    this.unsubscribe = world.subscribe(this.sync);
    this.app.ticker.add(this.animate);
    this.sync();
  }

  destroy() {
    this.unsubscribe?.();
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.removeEventListener("contextmenu", this.preventContextMenu);
    window.removeEventListener("keydown", this.onDebugKey);
    this.app.ticker.remove(this.animate);
    this.app.destroy(true, { children: true });
    this.world = null;
    this.input = null;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.world || !this.input) return;
    const activeFloor = this.activeFloor(this.world);
    const rect = this.app.canvas.getBoundingClientRect();
    const local = this.scene.toLocal({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const npc = [...this.world.npcs.values()].find((entry) => entry.position.z === activeFloor &&
      distanceToProjected(local, entry.position.x, entry.position.y) <= 25,
    );
    if (npc) {
      event.preventDefault();
      this.input.interactNpc(npc.id);
      return;
    }
    const player = [...this.world.players.values()].find((entry) => {
      if (entry.id === this.world?.localPlayerId || entry.position.z !== activeFloor) return false;
      const visual = this.visualPositions.get(entry.id) ?? entry.position;
      return distanceToProjected(local, visual.x, visual.y) <= 24;
    });
    if (player) {
      event.preventDefault();
      this.input.interactPlayer(player.id, event.clientX, event.clientY);
      return;
    }
    const creature = [...this.world.creatures.values()].find((entry) => {
      if (entry.position.z !== activeFloor) return false;
      const visual = this.visualPositions.get(entry.id) ?? entry.position;
      return distanceToProjected(local, visual.x, visual.y) <= 24;
    });
    if (creature) {
      this.input.targetCreature(creature.id);
      return;
    }
    this.world.closePlayerContext();
    const tile = unprojectWorld(local.x, local.y);
    this.input.interactAt({ x: Math.floor(tile.x / TILE), y: Math.floor(tile.y / TILE), z: activeFloor });
  };

  private applyPlaneProjection() {
    const cosine = Math.cos(ISO_ANGLE); const sine = Math.sin(ISO_ANGLE);
    const matrix = new Matrix(cosine, sine * ISO_VERTICAL_SCALE, -sine, cosine * ISO_VERTICAL_SCALE, 0, 0);
    this.terrainLayer.setFromMatrix(matrix);
  }

  private screenPosition(x: number, y: number) {
    return projectWorld((x + 0.5) * TILE, (y + 0.5) * TILE);
  }

  private placeNode(node: Container, x: number, y: number) {
    const position = this.screenPosition(x, y);
    node.position.set(position.x, position.y);
    node.zIndex = position.y;
  }

  private addDynamicNode(node: Container) {
    this.dynamicNodes.push(node);
    this.actorLayer.addChild(node);
  }

  private clearDynamicNodes() {
    for (const node of this.dynamicNodes) {
      this.actorLayer.removeChild(node);
      node.destroy({ children: true });
    }
    this.dynamicNodes = [];
  }

  private preventContextMenu = (event: Event) => event.preventDefault();

  private onDebugKey = (event: KeyboardEvent) => {
    if (!["F3", "F4", "F5", "F6", "F7"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "F3") { this.buildingDebug = !this.buildingDebug; this.drawBuildingDebug(); return; }
    if (event.key === "F4") this.showLegacyWalls = !this.showLegacyWalls;
    if (event.key === "F5") this.showCanonicalWalls = !this.showCanonicalWalls;
    if (event.key === "F6") this.showBuildingRoofs = !this.showBuildingRoofs;
    if (event.key === "F7") this.showBuildingFloors = !this.showBuildingFloors;
    this.mapSignature = ""; this.sync();
  };

  private sync = () => {
    const world = this.world;
    if (!world?.map) return;
    const signature = `${this.activeFloor(world)}:${JSON.stringify(world.map)}`;
    if (signature !== this.mapSignature) {
      this.mapSignature = signature;
      this.drawTerrain(world);
    }
    this.clearDynamicNodes();
    this.drawItems(world);
    this.drawNpcs(world);
    this.drawCreatures(world);
    this.drawPlayers(world);
    this.updateRoofVisibility(world);
    this.spawnCombatEffects(world);
    this.spawnAreaWarnings(world);
    const liveIds = new Set([...world.players.keys(), ...world.creatures.keys()]);
    for (const id of this.visualPositions.keys()) if (!liveIds.has(id)) {
      this.visualPositions.delete(id);
      this.creatureFacings.delete(id);
      this.playerFacings.delete(id);
      this.playerVelocities.delete(id);
    }
  };

  private drawTerrain(world: WorldState) {
    this.terrainLayer.removeChildren();
    this.waterSurfaces = [];
    if (!world.map) return;
    const activeFloor = this.activeFloor(world);
    const onFloor = (tile: { z: number }) => tile.z === activeFloor;
    const mapWidth = world.map.width * TILE; const mapHeight = world.map.height * TILE;
    const ground = new Graphics().rect(0, 0, mapWidth, mapHeight).fill(activeFloor === 7 ? 0x344536 : 0x080b0c);
    this.terrainLayer.addChild(ground);
    if (activeFloor === 7 && this.grassTexture) {
      const grass = new TilingSprite({ texture: this.grassTexture, width: mapWidth, height: mapHeight, tileScale: { x: 0.19, y: 0.19 } });
      grass.alpha = 0.72; this.terrainLayer.addChild(grass);
    }
    const mireGround = new Graphics();
    if (activeFloor === 7 && world.map.width === 56 && world.map.height === 38) mireGround.rect(TILE * 22, 0, mapWidth - TILE * 22, mapHeight).fill({ color: 0x283a2d, alpha: 0.7 }).rect(TILE * 22, TILE * 7, mapWidth - TILE * 22, TILE * 3).fill({ color: 0x584b32, alpha: 0.7 });
    for (const tile of world.map.water.filter(onFloor)) {
      const px = tile.x * TILE; const py = tile.y * TILE;
      mireGround.rect(px, py, TILE, TILE).fill(0x123f49);
    }
    this.terrainLayer.addChild(mireGround);
    if (this.waterTexture) {
      const waterLayer = new Container();
      const primary = new TilingSprite({ texture: this.waterTexture, width: mapWidth, height: mapHeight });
      primary.tileScale.set(0.1); primary.alpha = 0.7;
      const highlights = new TilingSprite({ texture: this.waterTexture, width: mapWidth, height: mapHeight });
      highlights.tileScale.set(0.065); highlights.alpha = 0.18; highlights.tint = 0x8cdde0;
      waterLayer.addChild(primary, highlights);
      const waterMask = new Graphics();
      for (const tile of world.map.water.filter(onFloor)) waterMask.rect(tile.x * TILE, tile.y * TILE, TILE, TILE);
      waterMask.fill(0xffffff);
      waterLayer.mask = waterMask;
      this.terrainLayer.addChild(waterLayer, waterMask);
      this.waterSurfaces.push(
        { sprite: primary, baseX: 0, baseY: 0, speedX: 0.004, speedY: 0.0015 },
        { sprite: highlights, baseX: 0, baseY: 0, speedX: -0.0022, speedY: 0.003 },
      );
    }
    this.terrainLayer.addChild(this.drawWaterEdges(world, activeFloor));
    const cityGround = new Graphics();
    const terrainTextures = {
      packed_earth: this.packedEarthTexture,
      moss_stone: this.mossStoneTexture,
      sandstone: this.sandstoneTexture,
    } as const;
    const buildingFootprints = this.roofFootprints(world, activeFloor);
    for (const building of this.showBuildingFloors ? buildingFootprints : []) {
      const geometry = this.buildingGeometry(building);
      for (const tile of geometry.floorTiles) {
        cityGround.rect(tile.x * TILE, tile.y * TILE, TILE, TILE).fill(0x76583c);
        cityGround.moveTo(tile.x * TILE, tile.y * TILE + 9).lineTo((tile.x + 1) * TILE, tile.y * TILE + 9)
          .moveTo(tile.x * TILE, tile.y * TILE + 25).lineTo((tile.x + 1) * TILE, tile.y * TILE + 25)
          .stroke({ color: 0xa47a4f, width: 1.5, alpha: 0.5 });
      }
    }
    for (const tile of world.map.roads.filter(onFloor)) {
      const px = tile.x * TILE; const py = tile.y * TILE;
      cityGround.rect(px, py, TILE, TILE).fill(this.cobbleTexture
        ? { texture: this.cobbleTexture, textureSpace: "global", matrix: new Matrix().scale(0.19, 0.19) }
        : 0x656157);
      cityGround.moveTo(px + 2, py + 12).lineTo(px + TILE - 2, py + 12).moveTo(px + 2, py + 27).lineTo(px + TILE - 2, py + 27).stroke({ color: 0x888276, width: 1, alpha: 0.55 });
      cityGround.moveTo(px + 11 + ((tile.y & 1) * 8), py + 1).lineTo(px + 11 + ((tile.y & 1) * 8), py + 12).stroke({ color: 0x4d4b45, width: 1, alpha: 0.6 });
    }
    for (const tile of world.map.floors.filter(onFloor)) {
      const canonicalFloor = this.showBuildingFloors && buildingFootprints.some((building) => tile.x >= building.x && tile.y >= building.y
        && tile.x < building.x + building.width && tile.y < building.y + building.height);
      if (canonicalFloor) continue;
      const px = tile.x * TILE; const py = tile.y * TILE;
      if (activeFloor === 8) {
        cityGround.rect(px, py, TILE, TILE).fill(0x303331);
        cityGround.moveTo(px, py + 16).lineTo(px + TILE, py + 16).moveTo(px, py + 34).lineTo(px + TILE, py + 34).stroke({ color: 0x4c504b, width: 1, alpha: 0.75 });
        cityGround.moveTo(px + 13 + ((tile.y & 1) * 10), py).lineTo(px + 13 + ((tile.y & 1) * 10), py + 16).stroke({ color: 0x202421, width: 1, alpha: 0.8 });
      } else {
        cityGround.rect(px, py, TILE, TILE).fill(0x76583c);
        cityGround.moveTo(px, py + 9).lineTo(px + TILE, py + 9).moveTo(px, py + 24).lineTo(px + TILE, py + 24).stroke({ color: 0xa47a4f, width: 2, alpha: 0.55 });
      }
    }
    // Explicit material paint is the final ground choice and can therefore
    // restyle roads, courtyards, or authored building floors.
    for (const entry of world.map.terrainMaterials.filter((entry) => entry.position.z === activeFloor)) {
      const texture = terrainTextures[entry.material];
      const px = entry.position.x * TILE; const py = entry.position.y * TILE;
      cityGround.rect(px, py, TILE, TILE).fill(texture
        ? { texture, textureSpace: "global", matrix: new Matrix().scale(0.19, 0.19) }
        : entry.material === "packed_earth" ? 0x76583b : entry.material === "moss_stone" ? 0x4d5740 : 0xc9a66c);
    }
    this.terrainLayer.addChild(cityGround);
    this.terrainLayer.addChild(this.drawBridges(world, activeFloor));
    const details = new Graphics();
    for (const stairs of world.map.stairs.filter((entry) => entry.from.z === activeFloor)) {
      const px = stairs.from.x * TILE; const py = stairs.from.y * TILE;
      details.roundRect(px + 5, py + 6, TILE - 10, TILE - 12, 3).fill(0x342c25).stroke({ color: 0xb09a75, width: 2 });
      for (let step = 0; step < 5; step++) details.rect(px + 8 + step * 3, py + 10 + step * 5, TILE - 16 - step * 6, 3).fill(0x8d806d);
    }
    this.terrainLayer.addChild(details);
    this.drawStructures(world);
    this.drawRoofs(world);
    this.drawBuildingDebug();
  }

  private drawWaterEdges(world: WorldState, activeFloor: number) {
    const edges = new Graphics();
    if (!world.map) return edges;
    const water = new Set(world.map.water.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const blocked = new Set(world.map.blocked.filter((tile) => tile.z === activeFloor && !water.has(`${tile.x}:${tile.y}`)).map((tile) => `${tile.x}:${tile.y}`));
    const isWater = (x: number, y: number) => water.has(`${x}:${y}`);
    const isBlocked = (x: number, y: number) => blocked.has(`${x}:${y}`);
    for (const tile of world.map.water.filter((entry) => entry.z === activeFloor)) {
      for (const edge of waterEdgesAt(tile.x, tile.y, world.map.width, world.map.height, isWater, isBlocked)) {
        const px = tile.x * TILE; const py = tile.y * TILE;
        const inset = edge.kind === "cliff" ? 10 : 7;
        const band = waterEdgeBand(px, py, edge.side, inset);
        const inner = waterEdgeLine(px, py, edge.side, inset);
        if (edge.kind === "cliff") {
          edges.poly(band).fill(0x4b514b).stroke({ color: 0x747b72, width: 2, alpha: 0.9 });
          edges.moveTo(inner[0], inner[1]).lineTo(inner[2], inner[3]).stroke({ color: 0x252d2a, width: 3, alpha: 0.85 });
          const midpointX = (inner[0] + inner[2]) / 2; const midpointY = (inner[1] + inner[3]) / 2;
          edges.circle(midpointX, midpointY, 2.5).fill(0x8a8e80);
        } else {
          edges.poly(band).fill(0xb8a56e).stroke({ color: 0xd2c28b, width: 1.5, alpha: 0.95 });
          edges.moveTo(inner[0], inner[1]).lineTo(inner[2], inner[3]).stroke({ color: 0x6f805f, width: 2, alpha: 0.65 });
        }
      }
    }
    return edges;
  }

  private drawBridges(world: WorldState, activeFloor: number) {
    const graphics = new Graphics();
    if (!world.map) return graphics;
    const bridges = new Set(world.map.bridges.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    for (const tile of world.map.bridges.filter((entry) => entry.z === activeFloor)) {
      const px = tile.x * TILE; const py = tile.y * TILE;
      const connectedX = bridges.has(`${tile.x - 1}:${tile.y}`) || bridges.has(`${tile.x + 1}:${tile.y}`);
      const connectedY = bridges.has(`${tile.x}:${tile.y - 1}`) || bridges.has(`${tile.x}:${tile.y + 1}`);
      const runsAlongX = connectedX || !connectedY;
      graphics.rect(px, py, TILE, TILE).fill(0x765033).stroke({ color: 0x3a281c, width: 2 });
      for (let offset = 8; offset < TILE; offset += 8) {
        if (runsAlongX) graphics.moveTo(px + offset, py + 2).lineTo(px + offset, py + TILE - 2);
        else graphics.moveTo(px + 2, py + offset).lineTo(px + TILE - 2, py + offset);
      }
      graphics.stroke({ color: 0x49301f, width: 1.5, alpha: 0.9 });
      if (runsAlongX) {
        graphics.moveTo(px, py + 5).lineTo(px + TILE, py + 5).moveTo(px, py + TILE - 5).lineTo(px + TILE, py + TILE - 5);
      } else {
        graphics.moveTo(px + 5, py).lineTo(px + 5, py + TILE).moveTo(px + TILE - 5, py).lineTo(px + TILE - 5, py + TILE);
      }
      graphics.stroke({ color: 0xb08350, width: 3, alpha: 0.95 });
    }
    return graphics;
  }

  private drawStructures(world: WorldState) {
    for (const node of this.structureNodes) {
      this.actorLayer.removeChild(node);
      node.destroy({ children: true });
    }
    this.structureNodes = [];
    this.occluders = [];
    this.torchFlames = [];
    if (!world.map) return;
    const activeFloor = this.activeFloor(world);
    const water = new Set(world.map.water.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const houses = new Set(world.map.houseWalls.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const castles = new Set(world.map.castleWalls.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const trees = new Set(world.map.trees.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const buildings = this.roofFootprints(world, activeFloor);
    const ownsPerimeterTile = (building: RoofFootprint, x: number, y: number) => x >= building.x && y >= building.y
      && x < building.x + building.width && y < building.y + building.height
      && (x === building.x || y === building.y || x === building.x + building.width - 1 || y === building.y + building.height - 1);
    for (const tile of world.map.blocked.filter((entry) => entry.z === activeFloor && !water.has(`${entry.x}:${entry.y}`) && !trees.has(`${entry.x}:${entry.y}`))) {
      const key = `${tile.x}:${tile.y}`;
      const kind = castles.has(key) ? "castle" : houses.has(key) ? "house" : "rock";
      // House walls have exactly one visual representation: the canonical
      // building renderer below. Never fall back to the old tile-prism wall,
      // even while diagnostic wall toggles are being used.
      if (kind === "house") continue;
      if (kind !== "rock") {
        const belongsToCanonicalBuilding = buildings.some((building) => ownsPerimeterTile(building, tile.x, tile.y));
        if ((belongsToCanonicalBuilding && this.showCanonicalWalls) || !this.showLegacyWalls) continue;
      }
      const height = kind === "castle" ? 82 : 24;
      const colors = kind === "castle"
        ? { top: 0x77817e, left: 0x46504f, right: 0x353e3e, edge: 0xa2aaa5 }
        : { top: 0x667269, left: 0x3c4941, right: 0x2b3731, edge: 0x89958d };
      const material = kind === "castle" ? this.castleWallTexture : null;
      const textured = (tint: number) => material ? { texture: material, textureSpace: "local" as const, color: tint } : tint;
      const graphic = new Graphics();
      let baseDepth = 0;
      const addPrism = (minX: number, maxX: number, minY: number, maxY: number) => {
        const north = projectWorld(minX, minY); const east = projectWorld(maxX, minY);
        const south = projectWorld(maxX, maxY); const west = projectWorld(minX, maxY);
        baseDepth = Math.max(baseDepth, north.y, east.y, south.y, west.y);
        const lift = (point: VisualPosition) => ({ x: point.x, y: point.y - height });
        const topNorth = lift(north); const topEast = lift(east); const topSouth = lift(south); const topWest = lift(west);
        graphic.poly([topWest.x, topWest.y, topSouth.x, topSouth.y, south.x, south.y, west.x, west.y]).fill(textured(material ? 0xb8b8b8 : colors.left)).stroke({ color: colors.edge, width: 1, alpha: 0.48 });
        graphic.poly([topSouth.x, topSouth.y, topEast.x, topEast.y, east.x, east.y, south.x, south.y]).fill(textured(material ? 0x929292 : colors.right)).stroke({ color: colors.edge, width: 1, alpha: 0.42 });
        graphic.poly([topNorth.x, topNorth.y, topEast.x, topEast.y, topSouth.x, topSouth.y, topWest.x, topWest.y]).fill(textured(material ? 0xd7d7d7 : colors.top)).stroke({ color: colors.edge, width: 1.5, alpha: 0.8 });
      };
      if (kind === "rock") {
        addPrism(-TILE / 2, TILE / 2, -TILE / 2, TILE / 2);
      } else {
        const wallSet = castles;
        const thickness = 8;
        // A small post owns the turn. Each arm only reaches halfway to an
        // actual neighbour; the matching half is drawn by that neighbour.
        // This avoids the long symmetric prisms that crossed past corners.
        addPrism(-thickness, thickness, -thickness, thickness);
        if (wallSet.has(`${tile.x - 1}:${tile.y}`)) addPrism(-TILE / 2 - 1, 0, -thickness, thickness);
        if (wallSet.has(`${tile.x + 1}:${tile.y}`)) addPrism(0, TILE / 2 + 1, -thickness, thickness);
        if (wallSet.has(`${tile.x}:${tile.y - 1}`)) addPrism(-thickness, thickness, -TILE / 2 - 1, 0);
        if (wallSet.has(`${tile.x}:${tile.y + 1}`)) addPrism(-thickness, thickness, 0, TILE / 2 + 1);
        if (kind === "castle") {
          for (const [offsetX, offsetY] of [[-12, 3], [0, 0], [12, -3]] as const) {
            graphic.roundRect(offsetX - 5, offsetY - height - 10, 10, 12, 1.5).fill(0x7d8682).stroke({ color: 0xb0b7b2, width: 1 });
          }
          graphic.moveTo(-17, -height + 2).lineTo(17, -height - 6).stroke({ color: 0xc0c5c0, width: 2, alpha: 0.75 });
          graphic.roundRect(-2.5, -height + 27, 5, 17, 2).fill(0x202726).stroke({ color: 0x8e9792, width: 1 });
        }
      }
      const node = new Container(); node.addChild(graphic); this.placeNode(node, tile.x, tile.y); node.zIndex += baseDepth;
      this.structureNodes.push(node); this.occluders.push({ node, kind: "wall" }); this.actorLayer.addChild(node);
    }
    if (this.showCanonicalWalls) for (const building of buildings) this.drawCanonicalBuildingWalls(world, building);
    for (const tile of world.map.trees.filter((entry) => entry.z === activeFloor)) {
      const node = new Container();
      node.addChild(new Graphics().ellipse(0, 0, 15, 3).fill({ color: 0x071008, alpha: 0.16 }));
      if (this.treeTexture) {
        const sprite = new Sprite(this.treeTexture);
        // The painted trunk lands right of the bitmap's transparent centre.
        // Anchor the root contact point, then place it directly in its shadow.
        sprite.anchor.set(0.55, 1);
        sprite.y = 0;
        const targetHeight = 112 + (stablePhase(`${tile.x}:${tile.y}`) % 7);
        sprite.scale.set(targetHeight / sprite.texture.height);
        sprite.tint = ((tile.x * 13 + tile.y * 7) & 1) ? 0xf2f5df : 0xffffff;
        node.addChild(sprite);
      } else {
        node.addChild(new Graphics().rect(-5, -42, 10, 48).fill(0x5a3c25).circle(0, -58, 34).fill(0x355f35));
      }
      this.placeNode(node, tile.x, tile.y); node.zIndex += 12;
      this.structureNodes.push(node); this.occluders.push({ node, kind: "tree" }); this.actorLayer.addChild(node);
    }
    for (const tile of world.map.torches.filter((entry) => entry.z === activeFloor)) {
      const node = new Container(); const fixture = new Graphics();
      fixture.moveTo(-7, -17).lineTo(0, -12).lineTo(7, -17).stroke({ color: 0x2b211a, width: 3 })
        .rect(-2, -29, 4, 18).fill(0x5b3a22).stroke({ color: 0x21160f, width: 1 });
      const flame = new Graphics().ellipse(0, -35, 5, 10).fill(0xf05a24).ellipse(0, -34, 2.5, 6).fill(0xffd56b);
      node.addChild(fixture, flame); this.placeNode(node, tile.x, tile.y); node.zIndex += 18;
      this.torchFlames.push({ flame, phase: stablePhase(`${tile.x}:${tile.y}:${tile.z}`) });
      this.structureNodes.push(node); this.actorLayer.addChild(node);
    }
    for (const door of world.map.doors.filter((entry) => entry.position.z === activeFloor
      && !(this.showCanonicalWalls && buildings.some((building) => ownsPerimeterTile(building, entry.position.x, entry.position.y))))) {
      const node = new Container(); const graphic = new Graphics();
      const adjacentX = houses.has(`${door.position.x - 1}:${door.position.y}`) || houses.has(`${door.position.x + 1}:${door.position.y}`)
        || castles.has(`${door.position.x - 1}:${door.position.y}`) || castles.has(`${door.position.x + 1}:${door.position.y}`);
      const castleDoor = castles.has(`${door.position.x - 1}:${door.position.y}`) || castles.has(`${door.position.x + 1}:${door.position.y}`)
        || castles.has(`${door.position.x}:${door.position.y - 1}`) || castles.has(`${door.position.x}:${door.position.y + 1}`);
      const frameHeight = castleDoor ? 78 : 68; const leafHeight = frameHeight - 8;
      const hinge = adjacentX ? projectWorld(-TILE / 2, 0) : projectWorld(0, -TILE / 2);
      const closedEnd = adjacentX ? projectWorld(TILE / 2, 0) : projectWorld(0, TILE / 2);
      const openEnd = adjacentX ? projectWorld(-TILE / 2, TILE * 0.82) : projectWorld(TILE * 0.82, -TILE / 2);
      const leafEnd = door.open ? openEnd : closedEnd;
      graphic.poly([hinge.x, hinge.y - leafHeight, leafEnd.x, leafEnd.y - leafHeight, leafEnd.x, leafEnd.y, hinge.x, hinge.y])
        .fill(door.open ? 0x825333 : 0x70452a).stroke({ color: 0x2e1c12, width: 2 });
      for (let plank = 1; plank < 5; plank++) {
        const ratio = plank / 5; const px = hinge.x + (leafEnd.x - hinge.x) * ratio; const py = hinge.y + (leafEnd.y - hinge.y) * ratio;
        graphic.moveTo(px, py - leafHeight).lineTo(px, py).stroke({ color: 0x3f2719, width: 1.5, alpha: 0.85 });
      }
      graphic.moveTo(hinge.x, hinge.y).lineTo(hinge.x, hinge.y - frameHeight)
        .moveTo(closedEnd.x, closedEnd.y).lineTo(closedEnd.x, closedEnd.y - frameHeight)
        .moveTo(hinge.x, hinge.y - frameHeight).lineTo(closedEnd.x, closedEnd.y - frameHeight)
        .stroke({ color: castleDoor ? 0x747d79 : 0x49301f, width: 5 });
      const handleX = hinge.x + (leafEnd.x - hinge.x) * 0.82; const handleY = hinge.y + (leafEnd.y - hinge.y) * 0.82 - leafHeight * 0.48;
      graphic.circle(handleX, handleY, 2.5).fill(0xe0bd72).stroke({ color: 0x54381e, width: 1 });
      if (door.open) graphic.moveTo(hinge.x, hinge.y + 2).lineTo(leafEnd.x, leafEnd.y + 2).stroke({ color: 0x100c08, width: 3, alpha: 0.35 });
      const south = projectWorld(TILE / 2, TILE / 2);
      node.addChild(graphic); this.placeNode(node, door.position.x, door.position.y); node.zIndex += south.y;
      this.structureNodes.push(node); this.occluders.push({ node, kind: "wall" }); this.actorLayer.addChild(node);
    }
  }

  private drawCanonicalBuildingWalls(world: WorldState, building: RoofFootprint) {
    if (!world.map) return;
    const geometry = this.buildingGeometry(building);
    const material = building.kind === "keep" ? this.castleWallTexture : this.timberWallTexture;
    const wallFill = material ? { texture: material, textureSpace: "local" as const, color: building.kind === "keep" ? 0xa8a8a8 : 0xb7a184 } : building.kind === "keep" ? 0x58615e : 0x805f42;
    const edgeColor = building.kind === "keep" ? 0xa2aaa5 : 0xd0a271;
    const wallHeight = geometry.top.north.z - geometry.base.north.z;
    const maxX = building.x + building.width; const maxY = building.y + building.height;
    const doorSide = (position: { x: number; y: number }): WallEdge["side"] | null => {
      if (position.y === building.y) return "north";
      if (position.y === maxY - 1) return "south";
      if (position.x === building.x) return "west";
      if (position.x === maxX - 1) return "east";
      return null;
    };
    const doors = world.map.doors.filter((door) => door.position.z === building.floor
      && door.position.x >= building.x && door.position.x < maxX && door.position.y >= building.y && door.position.y < maxY
      && doorSide(door.position));
    const windows = world.map.windows.filter((position) => position.z === building.floor
      && position.x >= building.x && position.x < maxX && position.y >= building.y && position.y < maxY
      && doorSide(position));
    const pointOnEdge = (side: WallEdge["side"], value: number, z: number): BuildingPoint => {
      if (side === "north") return { x: value, y: building.y, z };
      if (side === "south") return { x: value, y: maxY, z };
      if (side === "west") return { x: building.x, y: value, z };
      return { x: maxX, y: value, z };
    };
    for (const edge of geometry.walls) {
      const horizontal = edge.side === "north" || edge.side === "south";
      const start = horizontal ? building.x : building.y; const end = horizontal ? maxX : maxY;
      const openings = doors.filter((door) => doorSide(door.position) === edge.side)
        .map((door) => ({ start: horizontal ? door.position.x : door.position.y, end: (horizontal ? door.position.x : door.position.y) + 1, door }))
        .sort((left, right) => left.start - right.start);
      let cursor = start;
      const renderPanel = (from: number, to: number) => {
        if (to - from < 0.001) return;
        for (let moduleStart = from; moduleStart < to - 0.001; moduleStart += 1) {
          const moduleEnd = Math.min(to, moduleStart + 1);
          const baseStart = this.projectBuildingPoint(pointOnEdge(edge.side, moduleStart, building.floor), geometry);
          const baseEnd = this.projectBuildingPoint(pointOnEdge(edge.side, moduleEnd, building.floor), geometry);
          const topStart = this.projectBuildingPoint(pointOnEdge(edge.side, moduleStart, building.floor + wallHeight), geometry);
          const topEnd = this.projectBuildingPoint(pointOnEdge(edge.side, moduleEnd, building.floor + wallHeight), geometry);
          const graphic = new Graphics().poly([topStart.x, topStart.y, topEnd.x, topEnd.y, baseEnd.x, baseEnd.y, baseStart.x, baseStart.y])
            .fill(wallFill).stroke({ color: edgeColor, width: 1.25, alpha: 0.75 });
          if (building.kind === "house") {
            graphic.moveTo(topStart.x, topStart.y).lineTo(baseStart.x, baseStart.y).moveTo(topEnd.x, topEnd.y).lineTo(baseEnd.x, baseEnd.y).stroke({ color: 0x46301f, width: 2.5 });
            const braceTop = { x: topStart.x + (topEnd.x - topStart.x) * 0.18, y: topStart.y + (topEnd.y - topStart.y) * 0.18 };
            const braceBase = { x: baseStart.x + (baseEnd.x - baseStart.x) * 0.82, y: baseStart.y + (baseEnd.y - baseStart.y) * 0.82 };
            graphic.moveTo(braceTop.x, braceTop.y + 8).lineTo(braceBase.x, braceBase.y - 8).stroke({ color: 0x5a3823, width: 2, alpha: 0.8 });
            const window = windows.some((position) => doorSide(position) === edge.side
              && (horizontal ? position.x : position.y) === Math.floor(moduleStart));
            if (window) {
              const point = (along: number, down: number) => {
                const top = { x: topStart.x + (topEnd.x - topStart.x) * along, y: topStart.y + (topEnd.y - topStart.y) * along };
                const base = { x: baseStart.x + (baseEnd.x - baseStart.x) * along, y: baseStart.y + (baseEnd.y - baseStart.y) * along };
                return { x: top.x + (base.x - top.x) * down, y: top.y + (base.y - top.y) * down };
              };
              const a = point(0.25, 0.3); const b = point(0.75, 0.3); const c = point(0.75, 0.72); const d = point(0.25, 0.72);
              graphic.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(0x5f91a2).stroke({ color: 0x3c291c, width: 4 });
              const verticalTop = point(0.5, 0.3); const verticalBottom = point(0.5, 0.72);
              const horizontalLeft = point(0.25, 0.51); const horizontalRight = point(0.75, 0.51);
              graphic.moveTo(verticalTop.x, verticalTop.y).lineTo(verticalBottom.x, verticalBottom.y)
                .moveTo(horizontalLeft.x, horizontalLeft.y).lineTo(horizontalRight.x, horizontalRight.y)
                .stroke({ color: 0xc3d7d4, width: 1.5, alpha: 0.9 });
              graphic.circle(a.x + (b.x - a.x) * 0.3, a.y + (d.y - a.y) * 0.28, 2).fill({ color: 0xe6f5e9, alpha: 0.7 });
            }
          } else {
            const middleTop = { x: (topStart.x + topEnd.x) / 2, y: (topStart.y + topEnd.y) / 2 };
            const middleBase = { x: (baseStart.x + baseEnd.x) / 2, y: (baseStart.y + baseEnd.y) / 2 };
            const slitTop = { x: middleTop.x + (middleBase.x - middleTop.x) * 0.34, y: middleTop.y + (middleBase.y - middleTop.y) * 0.34 };
            const slitBottom = { x: middleTop.x + (middleBase.x - middleTop.x) * 0.67, y: middleTop.y + (middleBase.y - middleTop.y) * 0.67 };
            graphic.moveTo(slitTop.x, slitTop.y).lineTo(slitBottom.x, slitBottom.y).stroke({ color: 0x1d2423, width: 4 });
            for (const along of [0.18, 0.5, 0.82]) {
              const x = topStart.x + (topEnd.x - topStart.x) * along; const y = topStart.y + (topEnd.y - topStart.y) * along;
              graphic.roundRect(x - 5, y - 10, 10, 11, 1.5).fill(0x747d79).stroke({ color: 0xaeb5b0, width: 1 });
            }
          }
          const node = new Container(); node.addChild(graphic); node.zIndex = Math.max(baseStart.y, baseEnd.y);
          this.structureNodes.push(node); this.occluders.push({ node, kind: "wall" }); this.actorLayer.addChild(node);
        }
      };
      for (const opening of openings) {
        renderPanel(cursor, Math.max(cursor, opening.start));
        this.drawCanonicalDoor(opening.door, edge.side, pointOnEdge(edge.side, opening.start, building.floor), pointOnEdge(edge.side, opening.end, building.floor), geometry, building.kind === "keep");
        cursor = Math.max(cursor, opening.end);
      }
      renderPanel(cursor, end);
    }
  }

  private drawCanonicalDoor(door: { open: boolean }, side: WallEdge["side"], start: BuildingPoint, end: BuildingPoint, geometry: BuildingGeometry, stone: boolean) {
    const frameHeight = stone ? 78 : 68; const leafHeight = frameHeight - 8;
    const baseStart = this.projectBuildingPoint(start, geometry); const baseEnd = this.projectBuildingPoint(end, geometry);
    const topStart = this.projectBuildingPoint({ ...start, z: start.z + frameHeight }, geometry);
    const topEnd = this.projectBuildingPoint({ ...end, z: end.z + frameHeight }, geometry);
    const normal = side === "north" ? { x: 0, y: 0.82 } : side === "south" ? { x: 0, y: -0.82 }
      : side === "west" ? { x: 0.82, y: 0 } : { x: -0.82, y: 0 };
    const leafWorldEnd = door.open ? { x: start.x + normal.x, y: start.y + normal.y, z: start.z } : end;
    const leafBaseEnd = this.projectBuildingPoint(leafWorldEnd, geometry);
    const leafTopStart = this.projectBuildingPoint({ ...start, z: start.z + leafHeight }, geometry);
    const leafTopEnd = this.projectBuildingPoint({ ...leafWorldEnd, z: leafWorldEnd.z + leafHeight }, geometry);
    const graphic = new Graphics().poly([leafTopStart.x, leafTopStart.y, leafTopEnd.x, leafTopEnd.y, leafBaseEnd.x, leafBaseEnd.y, baseStart.x, baseStart.y])
      .fill(door.open ? 0x825333 : 0x70452a).stroke({ color: 0x2e1c12, width: 2 });
    for (let plank = 1; plank < 5; plank++) {
      const ratio = plank / 5; const bx = baseStart.x + (leafBaseEnd.x - baseStart.x) * ratio; const by = baseStart.y + (leafBaseEnd.y - baseStart.y) * ratio;
      const tx = leafTopStart.x + (leafTopEnd.x - leafTopStart.x) * ratio; const ty = leafTopStart.y + (leafTopEnd.y - leafTopStart.y) * ratio;
      graphic.moveTo(tx, ty).lineTo(bx, by).stroke({ color: 0x3f2719, width: 1.5 });
    }
    graphic.moveTo(baseStart.x, baseStart.y).lineTo(topStart.x, topStart.y).moveTo(baseEnd.x, baseEnd.y).lineTo(topEnd.x, topEnd.y)
      .moveTo(topStart.x, topStart.y).lineTo(topEnd.x, topEnd.y).stroke({ color: stone ? 0x747d79 : 0x49301f, width: 5 });
    const node = new Container(); node.addChild(graphic); node.zIndex = Math.max(baseStart.y, baseEnd.y, leafBaseEnd.y) + 0.5;
    this.structureNodes.push(node); this.occluders.push({ node, kind: "wall" }); this.actorLayer.addChild(node);
  }

  private drawRoofs(world: WorldState) {
    this.roofNodes.clear();
    if (!world.map || !this.showBuildingRoofs) return;
    const activeFloor = this.activeFloor(world);
    for (const building of this.roofFootprints(world, activeFloor)) {
      const roof = new Container();
      const graphic = new Graphics();
      const geometry = this.buildingGeometry(building);
      const topNorth = this.projectBuildingPoint(geometry.roof.eaves.north, geometry);
      const topEast = this.projectBuildingPoint(geometry.roof.eaves.east, geometry);
      const topSouth = this.projectBuildingPoint(geometry.roof.eaves.south, geometry);
      const topWest = this.projectBuildingPoint(geometry.roof.eaves.west, geometry);
      const ridgeStart = this.projectBuildingPoint(geometry.roof.ridgeStart, geometry);
      const ridgeEnd = this.projectBuildingPoint(geometry.roof.ridgeEnd, geometry);
      if (building.kind === "keep") {
        const stone = this.castleWallTexture;
        const raised = [topNorth, topEast, topSouth, topWest];
        graphic.poly(raised.flatMap((point) => [point.x, point.y])).fill(stone ? { texture: stone, textureSpace: "local", color: 0xbcbcbc } : 0x596260).stroke({ color: 0x9aa39f, width: 3 });
        for (const point of raised) graphic.rect(point.x - 6, point.y - 9, 12, 10).fill(0x78817e).stroke({ color: 0xabb2ad, width: 1 });
      } else {
        const roofFill = (tint: number) => this.roofTexture ? { texture: this.roofTexture, textureSpace: "local" as const, color: tint } : tint;
        if (building.width >= building.height) {
          graphic.poly([topNorth.x, topNorth.y, topEast.x, topEast.y, ridgeEnd.x, ridgeEnd.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(this.roofTexture ? 0xd6d6d6 : 0xa04e3c)).stroke({ color: 0xc86d50, width: 2 });
          graphic.poly([topWest.x, topWest.y, topSouth.x, topSouth.y, ridgeEnd.x, ridgeEnd.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(this.roofTexture ? 0x989898 : 0x5e2d28)).stroke({ color: 0x934536, width: 2 });
          graphic.poly([topNorth.x, topNorth.y, topWest.x, topWest.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(0xb8b8b8)).stroke({ color: 0xa85140, width: 2 });
          graphic.poly([topEast.x, topEast.y, topSouth.x, topSouth.y, ridgeEnd.x, ridgeEnd.y]).fill(roofFill(0x8f8f8f)).stroke({ color: 0x934536, width: 2 });
        } else {
          graphic.poly([topNorth.x, topNorth.y, topWest.x, topWest.y, ridgeEnd.x, ridgeEnd.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(this.roofTexture ? 0xd6d6d6 : 0xa04e3c)).stroke({ color: 0xc86d50, width: 2 });
          graphic.poly([topEast.x, topEast.y, topSouth.x, topSouth.y, ridgeEnd.x, ridgeEnd.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(this.roofTexture ? 0x989898 : 0x5e2d28)).stroke({ color: 0x934536, width: 2 });
          graphic.poly([topNorth.x, topNorth.y, topEast.x, topEast.y, ridgeStart.x, ridgeStart.y]).fill(roofFill(0xb8b8b8)).stroke({ color: 0xa85140, width: 2 });
          graphic.poly([topWest.x, topWest.y, topSouth.x, topSouth.y, ridgeEnd.x, ridgeEnd.y]).fill(roofFill(0x8f8f8f)).stroke({ color: 0x934536, width: 2 });
        }
        graphic.moveTo(ridgeStart.x, ridgeStart.y).lineTo(ridgeEnd.x, ridgeEnd.y).stroke({ color: 0xe0a06a, width: 3 });
      }
      roof.addChild(graphic);
      roof.zIndex = this.projectBuildingPoint(geometry.base.south, geometry).y + 1;
      this.structureNodes.push(roof);
      this.occluders.push({ node: roof, kind: "roof" });
      this.actorLayer.addChild(roof);
      this.roofNodes.set(building.id, roof);
    }
  }

  private roofFootprints(world: WorldState, activeFloor: number): RoofFootprint[] {
    if (!world.map) return [];
    const explicit: RoofFootprint[] = world.map.buildings
      .filter((entry) => entry.floor === activeFloor)
      .map((entry) => ({ ...entry }));
    const insideExplicit = (x: number, y: number) => explicit.some((building) =>
      x >= building.x && y >= building.y && x < building.x + building.width && y < building.y + building.height,
    );
    const walls = new Set(world.map.houseWalls
      .filter((tile) => tile.z === activeFloor && !insideExplicit(tile.x, tile.y))
      .map((tile) => `${tile.x}:${tile.y}`));
    const wallOrDoor = new Set([
      ...walls,
      ...world.map.doors.filter((door) => door.position.z === activeFloor).map((door) => `${door.position.x}:${door.position.y}`),
    ]);
    const remaining = new Set(walls);
    const inferred: RoofFootprint[] = [];
    while (remaining.size) {
      const first = remaining.values().next().value as string;
      const stack = [first]; const component: { x: number; y: number }[] = [];
      remaining.delete(first);
      while (stack.length) {
        const current = stack.pop()!; const [x, y] = current.split(":").map(Number);
        component.push({ x, y });
        for (const adjacent of [`${x - 1}:${y}`, `${x + 1}:${y}`, `${x}:${y - 1}`, `${x}:${y + 1}`]) {
          if (remaining.delete(adjacent)) stack.push(adjacent);
        }
      }
      const xs = component.map((tile) => tile.x); const ys = component.map((tile) => tile.y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const width = maxX - minX + 1; const height = maxY - minY + 1;
      if (width < 3 || height < 3) continue;
      let closed = true;
      for (let y = minY; y <= maxY && closed; y++) for (let x = minX; x <= maxX; x++) {
        const perimeter = x === minX || x === maxX || y === minY || y === maxY;
        if (perimeter && !wallOrDoor.has(`${x}:${y}`)) { closed = false; break; }
      }
      if (closed) inferred.push({ id: `manual_house_${activeFloor}_${minX}_${minY}`, kind: "house", x: minX, y: minY, width, height, floor: activeFloor });
    }
    return [...explicit, ...inferred];
  }

  private buildingGeometry(building: RoofFootprint) {
    const wallHeight = building.kind === "keep" ? 82 : 70;
    return createBuildingGeometry(
      { originX: building.x, originY: building.y, width: building.width, depth: building.height, baseZ: building.floor },
      wallHeight,
      building.kind === "keep" ? 0.22 : 0.2,
      building.kind === "keep" ? 18 : 46,
    );
  }

  private projectBuildingPoint(point: BuildingPoint, geometry: BuildingGeometry) {
    const projected = projectWorld(point.x * TILE, point.y * TILE);
    return { x: projected.x, y: projected.y - (point.z - geometry.footprint.baseZ) };
  }

  private drawBuildingDebug() {
    for (const child of this.buildingDebugLayer.removeChildren()) child.destroy({ children: true });
    const world = this.world;
    if (!this.buildingDebug || !world?.map) return;
    const activeFloor = this.activeFloor(world);
    for (const building of this.roofFootprints(world, activeFloor)) {
      const geometry = this.buildingGeometry(building); const graphic = new Graphics();
      const projected = (point: BuildingPoint) => this.projectBuildingPoint(point, geometry);
      const loop = (points: BuildingPoint[], color: number) => {
        const screen = points.map(projected); graphic.moveTo(screen[0].x, screen[0].y);
        for (const point of screen.slice(1)) graphic.lineTo(point.x, point.y);
        graphic.lineTo(screen[0].x, screen[0].y).stroke({ color, width: 2.5, alpha: 0.95 });
      };
      loop([geometry.base.north, geometry.base.east, geometry.base.south, geometry.base.west], 0x55ff8a);
      loop([geometry.top.north, geometry.top.east, geometry.top.south, geometry.top.west], 0x53d9ff);
      loop([geometry.roof.eaves.north, geometry.roof.eaves.east, geometry.roof.eaves.south, geometry.roof.eaves.west], 0xffd45a);
      const ridgeStart = projected(geometry.roof.ridgeStart); const ridgeEnd = projected(geometry.roof.ridgeEnd);
      graphic.moveTo(ridgeStart.x, ridgeStart.y).lineTo(ridgeEnd.x, ridgeEnd.y).stroke({ color: 0xff5fc8, width: 3 });
      this.buildingDebugLayer.addChild(graphic);
      const markers: [string, BuildingPoint, number][] = [
        ["A base", geometry.base.north, 0x55ff8a], ["B base", geometry.base.east, 0x55ff8a],
        ["C base", geometry.base.south, 0x55ff8a], ["D base", geometry.base.west, 0x55ff8a],
        ["A top", geometry.top.north, 0x53d9ff], ["roof NW", geometry.roof.eaves.north, 0xffd45a],
        ["ridge A", geometry.roof.ridgeStart, 0xff5fc8], ["ridge B", geometry.roof.ridgeEnd, 0xff5fc8],
      ];
      for (const [label, point, color] of markers) {
        const screen = projected(point); const text = new Text({ text: label, style: { fontFamily: "Inter", fontSize: 8, fill: color, stroke: { color: 0x07100b, width: 2 } } });
        text.position.set(screen.x + 3, screen.y - 3); this.buildingDebugLayer.addChild(text);
      }
    }
  }

  private updateRoofVisibility(world: WorldState) {
    if (!world.map || !world.localPlayerId) return;
    const player = world.players.get(world.localPlayerId);
    if (!player) return;
    for (const building of this.roofFootprints(world, player.position.z)) {
      const roof = this.roofNodes.get(building.id);
      if (!roof) continue;
      const inside = player.position.x > building.x
        && player.position.x < building.x + building.width - 1
        && player.position.y > building.y
        && player.position.y < building.y + building.height - 1;
      roof.alpha = inside ? 0.1 : 0.96;
    }
  }

  private activeFloor(world: WorldState) {
    const local = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
    return local?.position.z ?? world.map?.floor ?? 7;
  }

  private drawItems(world: WorldState) {
    for (const entry of world.groundItems) {
      if (entry.position.z !== this.activeFloor(world)) continue;
      const node = new Container();
      const corpse = entry.contents.length > 0 || entry.item.definitionId.endsWith("_remains");
      node.addChild(new Graphics().ellipse(3, 9, 17, 7).fill({ color: 0x050705, alpha: 0.42 }));
      const frame = this.itemFrames[itemFrameIndex(entry.item.definitionId)];
      if (frame) {
        const sprite = new Sprite(frame);
        sprite.anchor.set(0.5, 0.72);
        const target = corpse ? 45 : 34;
        sprite.scale.set(Math.min(target / sprite.texture.width, target / sprite.texture.height));
        node.addChild(sprite);
      } else {
        node.addChild(corpse
          ? new Graphics().ellipse(0, 5, 17, 10).fill(0x4d2f25).stroke({ color: 0x8d5d45, width: 2 })
          : new Graphics().roundRect(-11, -11, 22, 22, 5).fill(0xb6853f).stroke({ color: 0xf0cf82, width: 2 }));
      }
      const count = corpse ? entry.contents.length : entry.item.quantity;
      if (count > 1) {
        const quantity = new Text({ text: String(count), style: { fontFamily: "Inter", fontSize: 11, fill: 0xffffff, stroke: { color: 0x111111, width: 3 } } });
        quantity.anchor.set(1, 1); quantity.position.set(14, 16); node.addChild(quantity);
      }
      this.placeNode(node, entry.position.x, entry.position.y);
      this.addDynamicNode(node);
    }
  }

  private drawCreatures(world: WorldState) {
    this.creatureNodes.clear(); this.creatureSprites.clear();
    for (const creature of world.creatures.values()) {
      if (creature.position.z !== this.activeFloor(world)) continue;
      const node = new Container();
      const visual = this.ensureVisual(creature.id, creature.position);
      const previousFacing = this.creatureFacings.get(creature.id) ?? 2;
      const facing = facingFromMovement(creature.position.x - visual.x, creature.position.y - visual.y, previousFacing);
      this.creatureFacings.set(creature.id, facing);
      if (creature.id === world.attackTargetId) node.addChild(new Graphics().circle(0, 3, 22).stroke({ color: 0xe8b04f, width: 3 }));
      node.addChild(new Graphics().ellipse(2, 4, 18, 7).fill({ color: 0x030504, alpha: 0.48 }));
      const style = creature.definitionId === "fen_brute"
        ? { color: 0x70432e, edge: 0xc07a4c, width: 22, height: 18 }
        : creature.definitionId === "reed_stalker"
          ? { color: 0x3f5835, edge: 0x85a66f, width: 18, height: 17 }
          : creature.definitionId === "mire_skulker"
            ? { color: 0x485d45, edge: 0x8caf7f, width: 16, height: 13 }
            : { color: 0x76523c, edge: 0xb98a62, width: 17, height: 14 };
      const healthWidth = 34 * (creature.health / creature.maxHealth);
      const targetHeight = creature.definitionId === "cellar_warden" ? 76
        : creature.definitionId === "fen_brute" ? 70
          : creature.definitionId === "bone_acolyte" || creature.definitionId === "reed_stalker" ? 62
            : creature.definitionId === "crypt_guard" ? 60
              : creature.definitionId === "castle_rat" ? 44 : 54;
      const overheadY = -Math.max(48, Math.round(targetHeight * 0.82));
      const cellarFrameIndex = creatureFrameIndex(creature.definitionId, facing, ["castle_rat", "crypt_guard", "bone_acolyte", "cellar_warden"]);
      const mireFrameIndex = creatureFrameIndex(creature.definitionId, facing, ["mireling", "mire_skulker", "reed_stalker", "fen_brute"]);
      const frame = cellarFrameIndex >= 0 ? this.cellarCreatureFrames[cellarFrameIndex] : this.creatureFrames[mireFrameIndex];
      if (frame) {
        const sprite = new Sprite(frame);
        sprite.anchor.set(0.5, 0.72);
        sprite.scale.set(targetHeight / sprite.texture.height);
        sprite.alpha = creature.immune ? 0.55 : 1;
        node.addChild(sprite);
        this.creatureSprites.set(creature.id, sprite);
      } else {
        const body = new Graphics().ellipse(0, 2, style.width, style.height).fill(creature.immune ? 0x59635e : style.color).stroke({ color: creature.immune ? 0xaab5af : style.edge, width: 2 }).ellipse(-5, -3, 5, 3).fill({ color: 0xd2a178, alpha: 0.42 });
        if (creature.definitionId === "fen_brute") body.poly([-18, -8, -27, -16, -21, -2]).fill(0xd1b184).poly([18, -8, 27, -16, 21, -2]).fill(0xd1b184);
        if (creature.definitionId === "reed_stalker") body.moveTo(-13, -8).lineTo(-18, -22).moveTo(-5, -10).lineTo(-7, -25).moveTo(9, -9).lineTo(15, -23).stroke({ color: 0x789360, width: 3 });
        node.addChild(body);
      }
      node.addChild(new Graphics().rect(-17, overheadY, 34, 4).fill(0x2b1714).rect(-17, overheadY, healthWidth, 4).fill(0xb8493f));
      const label = new Text({ text: creature.name, style: { fontFamily: "Georgia", fontSize: 12, fill: 0xe0c5aa, stroke: { color: 0x0b100e, width: 4 } } });
      label.anchor.set(0.5, 1); label.position.set(0, overheadY - 3); node.addChild(label);
      if (creature.state === "returning") {
        const evade = new Text({ text: "Evading · Immune", style: { fontFamily: "Inter", fontSize: 9, fill: 0xc7d0cb, stroke: { color: 0x0b100e, width: 3 } } });
        evade.anchor.set(0.5, 0); evade.position.set(0, 10); node.addChild(evade);
      }
      this.placeNode(node, visual.x, visual.y);
      this.creatureNodes.set(creature.id, node); this.addDynamicNode(node);
    }
  }

  private drawNpcs(world: WorldState) {
    for (const npc of world.npcs.values()) {
      if (npc.position.z !== this.activeFloor(world)) continue;
      const node = new Container();
      node.addChild(
        new Graphics()
          .ellipse(3, 12, 15, 7).fill({ color: 0x030504, alpha: 0.48 })
          .poly([-13, 10, -9, -9, 9, -9, 14, 10]).fill(npc.service === "depot" ? 0x3f5264 : 0x5d4933).stroke({ color: 0xb49562, width: 2 })
          .circle(0, -13, 8).fill(0xc49a6c).stroke({ color: 0x39281d, width: 2 })
          .circle(-3, -15, 2).fill({ color: 0xf0c993, alpha: 0.55 })
          .roundRect(-12, 10, 24, 5, 2).fill(npc.service === "depot" ? 0x536d83 : 0x41624f),
      );
      const label = new Text({ text: npc.name, style: { fontFamily: "Georgia", fontSize: 13, fill: 0xf0d79e, stroke: { color: 0x0b100e, width: 4 } } });
      label.anchor.set(0.5, 1); label.position.set(0, -21); node.addChild(label);
      const marker = new Text({ text: "!", style: { fontFamily: "Inter", fontSize: 14, fontWeight: "700", fill: 0xf4cc72, stroke: { color: 0x1c1408, width: 3 } } });
      marker.anchor.set(0.5, 1); marker.position.set(0, -38); node.addChild(marker);
      this.placeNode(node, npc.position.x, npc.position.y);
      this.addDynamicNode(node);
    }
  }

  private sliceAtlas(atlas: Texture, columns: number, rows: number, gutter = 0) {
    const frames: Texture[] = [];
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const left = Math.floor(column * atlas.width / columns);
      const top = Math.floor(row * atlas.height / rows);
      const right = Math.floor((column + 1) * atlas.width / columns);
      const bottom = Math.floor((row + 1) * atlas.height / rows);
      frames.push(new Texture({
        source: atlas.source,
        frame: new Rectangle(left + gutter, top + gutter, right - left - gutter * 2, bottom - top - gutter * 2),
      }));
    }
    return frames;
  }

  private slicePlayerAtlas(atlas: Texture) {
    // The hand-painted v2 sheet intentionally gives wide poses more room, so
    // its transparent gutters are not a mathematically uniform grid. Slice at
    // the actual gutters to keep neighbouring heads and cloaks out of a frame.
    if (atlas.width !== 1672 || atlas.height !== 941) return this.sliceAtlas(atlas, 8, 3, 6);
    const columnStops = [0, 221, 435, 651, 867, 1080, 1287, 1481, 1672];
    const rowStops = [0, 344, 656, 941];
    const frames: Texture[] = [];
    for (let row = 0; row < 3; row++) for (let column = 0; column < 8; column++) {
      const left = columnStops[column]; const right = columnStops[column + 1];
      const top = rowStops[row]; const bottom = rowStops[row + 1];
      frames.push(new Texture({
        source: atlas.source,
        frame: new Rectangle(left, top, right - left, bottom - top),
      }));
    }
    return frames;
  }

  private drawPlayers(world: WorldState) {
    this.playerNodes.clear(); this.playerSprites.clear();
    for (const player of world.players.values()) {
      if (player.position.z !== this.activeFloor(world)) continue;
      const local = player.id === world.localPlayerId;
      const node = new Container();
      if (player.id === world.selectedPlayerId) node.addChild(new Graphics().circle(0, 2, 22).stroke({ color: 0x73c7e8, width: 3 }));
      node.addChild(new Graphics().ellipse(2, 7, 14, 6).fill({ color: 0x030504, alpha: 0.46 }));
      const facing = this.playerFacings.get(player.id) ?? 0;
      const frame = this.playerFrames[facing];
      if (frame) {
        const sprite = new Sprite(frame);
        sprite.anchor.set(0.5, 1);
        sprite.y = 5;
        sprite.x = PLAYER_FACING_X[facing];
        sprite.scale.set(58 / sprite.texture.height);
        node.addChild(sprite);
        this.playerSprites.set(player.id, sprite);
      } else {
        const cloth = local ? 0xb98a3e : 0x4f8295; const trim = local ? 0xe9c477 : 0x8fc5d4;
        node.addChild(new Graphics()
          .ellipse(-6, 10, 4, 6).fill(0x25231f).ellipse(6, 10, 4, 6).fill(0x25231f)
          .poly([-12, 9, -9, -8, 9, -8, 12, 9]).fill(cloth).stroke({ color: trim, width: 2 })
          .circle(0, -13, 8).fill(0xc99c70).stroke({ color: 0x3b291e, width: 2 }));
      }
      const label = new Text({ text: player.name, style: { fontFamily: "Georgia", fontSize: 13, fill: 0xf3ead2, stroke: { color: 0x0b100e, width: 4 } } });
      label.anchor.set(0.5, 1); label.position.set(0, -52); node.addChild(label);
      const visual = this.ensureVisual(player.id, player.position);
      this.placeNode(node, visual.x, visual.y);
      this.playerNodes.set(player.id, node); this.addDynamicNode(node);
    }
  }

  private spawnCombatEffects(world: WorldState) {
    const retained = new Set(world.combatEffects.map((effect) => effect.id));
    for (const id of this.seenCombatEffects) if (!retained.has(id)) this.seenCombatEffects.delete(id);
    for (const effect of world.combatEffects) {
      if (this.seenCombatEffects.has(effect.id)) continue;
      const source = this.visualPositions.get(effect.sourceId)
        ?? world.players.get(effect.sourceId)?.position
        ?? world.creatures.get(effect.sourceId)?.position;
      const target = this.visualPositions.get(effect.targetId)
        ?? world.creatures.get(effect.targetId)?.position
        ?? world.players.get(effect.targetId)?.position;
      this.seenCombatEffects.add(effect.id);
      if (!source || !target) continue;

      const projectile = new Container();
      const isArrow = effect.effectId === "rough_arrow";
      const isBoneBolt = effect.effectId === "bone_bolt";
      if (isArrow) {
        const projectedSource = this.screenPosition(source.x, source.y);
        const projectedTarget = this.screenPosition(target.x, target.y);
        const angle = Math.atan2(projectedTarget.y - projectedSource.y, projectedTarget.x - projectedSource.x);
        projectile.addChild(
          new Graphics()
            .moveTo(-9, 0).lineTo(8, 0).stroke({ color: 0xd8c49b, width: 3 })
            .moveTo(8, 0).lineTo(3, -4).moveTo(8, 0).lineTo(3, 4).stroke({ color: 0xe6d7b7, width: 2 })
            .moveTo(-8, 0).lineTo(-4, -4).moveTo(-8, 0).lineTo(-4, 4).stroke({ color: 0x9f7046, width: 2 }),
        );
        projectile.rotation = angle;
      } else {
        const outer = isBoneBolt ? 0x7fd4e8 : 0xff6a2b;
        const middle = isBoneBolt ? 0x9ee9ef : 0xff8a35;
        const core = isBoneBolt ? 0xe8ffff : 0xffe0a0;
        projectile.addChild(
          new Graphics()
            .circle(0, 0, 10).fill({ color: outer, alpha: 0.16 })
            .circle(0, 0, 6).fill({ color: middle, alpha: 0.72 })
            .circle(0, 0, 3).fill(core),
        );
      }
      this.placeNode(projectile, source.x, source.y);
      const damageText = new Text({
        text: `-${effect.damage}`,
        style: { fontFamily: "Inter", fontSize: 18, fontWeight: "700", fill: isArrow ? 0xf1dfb5 : 0xffb06a, stroke: { color: isArrow ? 0x1c211c : 0x32130b, width: 5 } },
      });
      damageText.anchor.set(0.5, 1);
      damageText.alpha = 0;
      this.placeNode(damageText, target.x, target.y);
      damageText.y -= 18;
      this.effectLayer.addChild(projectile, damageText);
      this.activeCombatEffects.push({ projectile, damageText, from: { ...source }, to: { ...target }, elapsed: 0 });
    }
  }

  private spawnAreaWarnings(world: WorldState) {
    const retained = new Set(world.areaWarnings.map((warning) => warning.id));
    for (const id of this.seenAreaWarnings) if (!retained.has(id)) this.seenAreaWarnings.delete(id);
    for (const warning of world.areaWarnings) {
      if (this.seenAreaWarnings.has(warning.id)) continue;
      this.seenAreaWarnings.add(warning.id);
      if (warning.position.z !== this.activeFloor(world)) continue;
      const size = (warning.radius * 2 + 1) * TILE;
      const north = projectWorld(-size / 2, -size / 2);
      const east = projectWorld(size / 2, -size / 2);
      const south = projectWorld(size / 2, size / 2);
      const west = projectWorld(-size / 2, size / 2);
      const graphic = new Graphics()
        .poly([north.x, north.y, east.x, east.y, south.x, south.y, west.x, west.y])
        .fill({ color: 0xc33c2f, alpha: 0.16 })
        .stroke({ color: 0xff8c57, width: 3, alpha: 0.85 });
      this.placeNode(graphic, warning.position.x, warning.position.y);
      this.effectLayer.addChild(graphic);
      this.activeAreaWarnings.push({ graphic, elapsed: 0, duration: warning.durationMs });
    }
  }

  private animate = () => {
    const world = this.world;
    if (!world) return;
    const creatureStep = Math.min(1, this.app.ticker.deltaMS / CREATURE_STEP_MS);
    const waterTime = this.app.ticker.lastTime;
    for (const surface of this.waterSurfaces) surface.sprite.tilePosition.set(
      surface.baseX + waterTime * surface.speedX,
      surface.baseY + waterTime * surface.speedY,
    );
    for (const torch of this.torchFlames) {
      const flicker = 1 + Math.sin(waterTime * 0.018 + torch.phase * 4) * 0.1;
      torch.flame.scale.set(1 / flicker, flicker);
      torch.flame.alpha = 0.88 + Math.sin(waterTime * 0.031 + torch.phase) * 0.1;
    }
    for (const player of world.players.values()) {
      const moving = this.animatePlayerEntity(player.id, player.position, this.playerNodes.get(player.id), this.app.ticker.deltaMS);
      const facing = this.playerFacings.get(player.id) ?? 0;
      const sprite = this.playerSprites.get(player.id);
      if (sprite && this.playerFrames.length >= 24) {
        const row = moving ? 1 + (Math.floor((this.app.ticker.lastTime + stablePhase(player.id) * 100) / 145) % 2) : 0;
        sprite.texture = this.playerFrames[row * 8 + facing];
        sprite.x = PLAYER_FACING_X[facing];
        sprite.scale.set(58 / sprite.texture.height);
      }
    }
    for (const creature of world.creatures.values()) {
      const visual = this.visualPositions.get(creature.id);
      const moving = visual ? Math.abs(visual.x - creature.position.x) > 0.01 || Math.abs(visual.y - creature.position.y) > 0.01 : false;
      this.animateEntity(creature.id, creature.position, this.creatureNodes.get(creature.id), creatureStep);
      const sprite = this.creatureSprites.get(creature.id);
      if (sprite) {
        const phase = this.app.ticker.lastTime / (moving ? 105 : 480) + stablePhase(creature.id);
        // Keep the feet planted. Horizontal weight shift and a tiny lean read
        // as movement without making the creature hover over its shadow.
        sprite.x = Math.sin(phase) * (moving ? 1.1 : 0.2);
        sprite.y = 0;
        sprite.rotation = moving ? Math.sin(phase * 0.8) * 0.025 : 0;
      }
    }
    this.animateCombatEffects(this.app.ticker.deltaMS);
    this.animateAreaWarnings(this.app.ticker.deltaMS);
    this.updateOcclusion(this.app.ticker.deltaMS);
    const localId = world.localPlayerId;
    const local = localId ? this.visualPositions.get(localId) : null;
    if (local) {
      const position = this.screenPosition(local.x, local.y);
      this.scene.position.set(
        this.app.screen.width / 2 - position.x * CAMERA_ZOOM,
        this.app.screen.height / 2 - position.y * CAMERA_ZOOM,
      );
    }
    this.animateAtmosphere(world, waterTime);
  };

  private animateAtmosphere(world: WorldState, time: number) {
    const width = this.app.screen.width; const height = this.app.screen.height;
    const seconds = Date.now() / 1000;
    const daylight = (Math.cos((seconds % 180) / 180 * Math.PI * 2 - Math.PI) + 1) / 2;
    const underground = this.activeFloor(world) > 7;
    const darkness = underground ? 0.58 : 0.58 * (1 - daylight) ** 1.35;
    this.atmosphereShade.clear().rect(0, 0, width, height).fill({ color: underground ? 0x071019 : 0x0b1730, alpha: darkness });

    const weatherPosition = (seconds % 180) / 45;
    const pulse = (center: number, radius = 0.8) => Math.max(0, 1 - Math.abs(weatherPosition - center) / radius);
    const fog = underground ? 0 : Math.max(pulse(1.15), pulse(3.85, 0.35)) * 0.2;
    const rain = underground ? 0 : pulse(2.55, 0.75);
    this.weatherGraphics.clear();
    if (fog > 0.01) {
      for (let index = 0; index < 7; index++) {
        const x = ((index * 241 + time * 0.012) % (width + 420)) - 210;
        const y = height * (0.16 + (index % 4) * 0.22);
        this.weatherGraphics.ellipse(x, y, 230, 48).fill({ color: 0xb8c7c0, alpha: fog * (0.32 + (index % 3) * 0.08) });
      }
    }
    if (rain > 0.01) {
      for (let index = 0; index < 72; index++) {
        const x = (index * 83 + time * 0.28) % (width + 80) - 40;
        const y = (index * 47 + time * (0.55 + (index % 5) * 0.04)) % (height + 100) - 50;
        this.weatherGraphics.moveTo(x, y).lineTo(x - 8, y + 24);
      }
      this.weatherGraphics.stroke({ color: 0x9fc7d8, width: 1.2, alpha: rain * 0.48 });
      this.weatherGraphics.rect(0, 0, width, height).fill({ color: 0x405b66, alpha: rain * 0.07 });
    }

    this.lightGraphics.clear();
    if (darkness > 0.08 && world.map) {
      for (const torch of world.map.torches.filter((entry) => entry.z === this.activeFloor(world))) {
        const local = this.screenPosition(torch.x, torch.y); const screen = this.scene.toGlobal({ x: local.x, y: local.y - 30 });
        const flicker = 1 + Math.sin(time * 0.014 + stablePhase(`${torch.x}:${torch.y}`) * 5) * 0.08;
        this.lightGraphics.circle(screen.x, screen.y, 74 * flicker).fill({ color: 0xf0903e, alpha: darkness * 0.09 });
        this.lightGraphics.circle(screen.x, screen.y, 38 * flicker).fill({ color: 0xffbd5f, alpha: darkness * 0.16 });
        this.lightGraphics.circle(screen.x, screen.y, 14).fill({ color: 0xffe2a1, alpha: darkness * 0.32 });
      }
    }
  }

  private animateCombatEffects(deltaMs: number) {
    for (let index = this.activeCombatEffects.length - 1; index >= 0; index--) {
      const effect = this.activeCombatEffects[index];
      effect.elapsed += deltaMs;
      const flight = Math.min(1, effect.elapsed / 260);
      const eased = 1 - Math.pow(1 - flight, 3);
      const projectilePosition = this.screenPosition(
        effect.from.x + (effect.to.x - effect.from.x) * eased,
        effect.from.y + (effect.to.y - effect.from.y) * eased,
      );
      effect.projectile.position.set(projectilePosition.x, projectilePosition.y - Math.sin(flight * Math.PI) * 14);
      effect.projectile.scale.set(1 + Math.sin(effect.elapsed / 35) * 0.12);
      effect.projectile.alpha = flight < 0.9 ? 1 : Math.max(0, (1 - flight) * 10);
      const textAge = Math.max(0, effect.elapsed - 150);
      effect.damageText.alpha = Math.min(1, textAge / 80) * Math.max(0, 1 - textAge / 650);
      const targetPosition = this.screenPosition(effect.to.x, effect.to.y);
      effect.damageText.position.set(targetPosition.x, targetPosition.y - 18 - textAge * 0.035);
      if (effect.elapsed >= 800) {
        this.effectLayer.removeChild(effect.projectile, effect.damageText);
        effect.projectile.destroy({ children: true });
        effect.damageText.destroy();
        this.activeCombatEffects.splice(index, 1);
      }
    }
  }

  private animateAreaWarnings(deltaMs: number) {
    for (let index = this.activeAreaWarnings.length - 1; index >= 0; index--) {
      const warning = this.activeAreaWarnings[index];
      warning.elapsed += deltaMs;
      const progress = Math.min(1, warning.elapsed / warning.duration);
      warning.graphic.alpha = 0.45 + Math.sin(warning.elapsed / 55) * 0.2 + progress * 0.25;
      warning.graphic.scale.set(0.94 + progress * 0.06);
      if (progress >= 1) {
        this.effectLayer.removeChild(warning.graphic);
        warning.graphic.destroy();
        this.activeAreaWarnings.splice(index, 1);
      }
    }
  }

  private updateOcclusion(deltaMs: number) {
    const world = this.world; const localId = world?.localPlayerId;
    const playerNode = localId ? this.playerNodes.get(localId) : undefined;
    if (!playerNode) return;
    const playerBounds = playerNode.getBounds().rectangle;
    for (const occluder of this.occluders) {
      const bounds = occluder.node.getBounds().rectangle;
      const overlaps = bounds.x < playerBounds.x + playerBounds.width
        && bounds.x + bounds.width > playerBounds.x
        && bounds.y < playerBounds.y + playerBounds.height
        && bounds.y + bounds.height > playerBounds.y;
      const inFront = occluder.node.zIndex > playerNode.zIndex;
      const fadedAlpha = occluder.kind === "roof" ? 0.2 : occluder.kind === "tree" ? 0.34 : 0.4;
      const targetAlpha = overlaps && inFront ? fadedAlpha : 0.96;
      occluder.node.alpha += (targetAlpha - occluder.node.alpha) * Math.min(1, deltaMs / 85);
    }
  }

  private animateEntity(id: string, target: VisualPosition, node: Container | undefined, maxStep: number) {
    const visual = this.ensureVisual(id, target);
    visual.x = approach(visual.x, target.x, maxStep);
    visual.y = approach(visual.y, target.y, maxStep);
    if (node) this.placeNode(node, visual.x, visual.y);
  }

  private animatePlayerEntity(id: string, target: VisualPosition, node: Container | undefined, deltaMs: number) {
    const visual = this.ensureVisual(id, target);
    let velocity = this.playerVelocities.get(id);
    if (!velocity) { velocity = { x: 0, y: 0 }; this.playerVelocities.set(id, velocity); }
    const dx = target.x - visual.x; const dy = target.y - visual.y;
    const distance = Math.hypot(dx, dy);
    const maxSpeed = 1 / 160;
    const acceleration = 0.00018;
    const deceleration = 0.00014;
    const desiredSpeed = distance > 0.0005 ? Math.min(maxSpeed, Math.sqrt(2 * deceleration * distance)) : 0;
    const desiredX = distance > 0 ? dx / distance * desiredSpeed : 0;
    const desiredY = distance > 0 ? dy / distance * desiredSpeed : 0;
    const currentSpeed = Math.hypot(velocity.x, velocity.y);
    const rate = desiredSpeed > currentSpeed ? acceleration : deceleration;
    velocity.x = approach(velocity.x, desiredX, rate * deltaMs);
    velocity.y = approach(velocity.y, desiredY, rate * deltaMs);
    const stepX = velocity.x * deltaMs; const stepY = velocity.y * deltaMs;
    if (distance <= Math.hypot(stepX, stepY) || (dx * (dx - stepX) + dy * (dy - stepY) <= 0)) {
      visual.x = target.x; visual.y = target.y; velocity.x = 0; velocity.y = 0;
    } else {
      visual.x += stepX; visual.y += stepY;
    }
    const moving = Math.hypot(velocity.x, velocity.y) > 0.00035 || distance > 0.025;
    // Face the requested direction immediately; inertia may still point the
    // velocity toward the previous tile briefly when the player turns.
    if (moving) this.playerFacings.set(id, playerFacingFromMovement(dx || velocity.x, dy || velocity.y, this.playerFacings.get(id) ?? 0));
    if (node) this.placeNode(node, visual.x, visual.y);
    return moving;
  }

  private ensureVisual(id: string, target: VisualPosition) {
    let visual = this.visualPositions.get(id);
    if (!visual) { visual = { x: target.x, y: target.y }; this.visualPositions.set(id, visual); }
    return visual;
  }
}

function approach(value: number, target: number, maxStep: number) {
  const distance = target - value;
  return Math.abs(distance) <= maxStep ? target : value + Math.sign(distance) * maxStep;
}

function waterEdgeBand(px: number, py: number, side: WaterEdgeSide, inset: number) {
  if (side === "north") return [px, py, px + TILE, py, px + TILE, py + inset, px, py + inset];
  if (side === "east") return [px + TILE - inset, py, px + TILE, py, px + TILE, py + TILE, px + TILE - inset, py + TILE];
  if (side === "south") return [px, py + TILE - inset, px + TILE, py + TILE - inset, px + TILE, py + TILE, px, py + TILE];
  return [px, py, px + inset, py, px + inset, py + TILE, px, py + TILE];
}

function waterEdgeLine(px: number, py: number, side: WaterEdgeSide, inset: number): [number, number, number, number] {
  if (side === "north") return [px, py + inset, px + TILE, py + inset];
  if (side === "east") return [px + TILE - inset, py, px + TILE - inset, py + TILE];
  if (side === "south") return [px, py + TILE - inset, px + TILE, py + TILE - inset];
  return [px + inset, py, px + inset, py + TILE];
}

function distanceToProjected(point: VisualPosition, tileX: number, tileY: number) {
  const projected = projectWorld((tileX + 0.5) * TILE, (tileY + 0.5) * TILE);
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

function creatureFrameIndex(definitionId: string, facing: CardinalFacing, rows: readonly string[]) {
  const row = rows.indexOf(definitionId);
  return row < 0 ? -1 : row * 4 + facing;
}

function facingFromMovement(dx: number, dy: number, fallback: CardinalFacing): CardinalFacing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  const projected = projectWorld(dx, dy);
  if (Math.abs(projected.x) >= Math.abs(projected.y)) return projected.x >= 0 ? 1 : 3;
  return projected.y >= 0 ? 2 : 0;
}

export function playerFacingFromMovement(dx: number, dy: number, fallback: PlayerFacing): PlayerFacing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  const projected = projectWorld(dx, dy);
  const sector = Math.round(Math.atan2(projected.y, projected.x) / (Math.PI / 4));
  return ((2 - sector + 8) % 8) as PlayerFacing;
}

function stablePhase(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash % 628) / 100;
}

function itemFrameIndex(definitionId: string) {
  return [
    "blank_rune", "ember_rune", "traveler_blade", "ashwood_bow",
    "rough_arrow", "field_backpack", "mire_fiber", "gold_coin",
    "mireling_remains", "bog_ichor", "reed_hide", "fen_tusk",
    "mire_skulker_remains", "reed_stalker_remains", "fen_brute_remains",
  ].indexOf(definitionId);
}
