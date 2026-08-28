import { Application, Assets, Container, Graphics, Matrix, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import { WorldState } from "./WorldState";
import { CLIENT_STEP_MS, type InputController } from "./InputController";
import { ISO_ANGLE, ISO_VERTICAL_SCALE, projectWorld, unprojectWorld } from "./CameraProjection";

const TILE = 48;
const CREATURE_STEP_MS = 250;
type VisualPosition = { x: number; y: number };
type Facing = 0 | 1 | 2 | 3;
type ActiveCombatEffect = {
  projectile: Container;
  damageText: Text;
  from: VisualPosition;
  to: VisualPosition;
  elapsed: number;
};
type ActiveAreaWarning = { graphic: Graphics; elapsed: number; duration: number };
type WaterSurface = { sprite: TilingSprite; baseX: number; baseY: number; speedX: number; speedY: number };

export class MapRenderer {
  private app = new Application();
  private scene = new Container();
  private terrainLayer = new Container();
  private actorLayer = new Container();
  private effectLayer = new Container();
  private structureNodes: Container[] = [];
  private dynamicNodes: Container[] = [];
  private roofNodes = new Map<string, Container>();
  private creatureNodes = new Map<string, Container>();
  private creatureSprites = new Map<string, Sprite>();
  private creatureFacings = new Map<string, Facing>();
  private playerNodes = new Map<string, Container>();
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
  private waterTexture: Texture | null = null;
  private waterSurfaces: WaterSurface[] = [];
  private creatureFrames: Texture[] = [];
  private cellarCreatureFrames: Texture[] = [];
  private itemFrames: Texture[] = [];
  constructor() {
    this.applyPlaneProjection();
    this.actorLayer.sortableChildren = true;
  }

  async mount(element: HTMLElement, world: WorldState, input: InputController) {
    this.world = world;
    this.input = input;
    try {
      [this.grassTexture, this.cobbleTexture, this.waterTexture] = await Promise.all([
        Assets.load<Texture>("/assets/world/greyhaven-grass.png"),
        Assets.load<Texture>("/assets/world/greyhaven-cobble.png"),
        Assets.load<Texture>("/assets/world/aldoria-water-v1.png"),
      ]);
      this.waterTexture.source.style.addressMode = "repeat";
      this.waterTexture.source.style.scaleMode = "linear";
    } catch {
      this.grassTexture = null;
      this.cobbleTexture = null;
      this.waterTexture = null;
    }
    try {
      const [creatureAtlas, cellarCreatureAtlas, itemAtlas] = await Promise.all([
        Assets.load<Texture>("/assets/sprites/greyhaven-mire-creatures-v4.png"),
        Assets.load<Texture>("/assets/sprites/greyhaven-cellar-creatures-v1.png"),
        Assets.load<Texture>("/assets/sprites/aldoria-items-v2.png"),
      ]);
      // Creature art is scaled and slightly rotated while walking. Nearest
      // sampling prevents the GPU from pulling coloured pixels across a frame
      // boundary, while the inset keeps every direction isolated.
      creatureAtlas.source.style.scaleMode = "nearest";
      cellarCreatureAtlas.source.style.scaleMode = "nearest";
      itemAtlas.source.style.scaleMode = "nearest";
      this.creatureFrames = this.sliceAtlas(creatureAtlas, 4, 4, 12);
      this.cellarCreatureFrames = this.sliceAtlas(cellarCreatureAtlas, 4, 4, 12);
      this.itemFrames = this.sliceAtlas(itemAtlas, 4, 4, 4);
    } catch {
      this.creatureFrames = [];
      this.cellarCreatureFrames = [];
      this.itemFrames = [];
    }
    await this.app.init({ resizeTo: element, background: "#0a0f0d", antialias: true });
    element.appendChild(this.app.canvas);
    this.scene.addChild(this.terrainLayer, this.actorLayer, this.effectLayer);
    this.app.stage.addChild(this.scene);
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.addEventListener("contextmenu", this.preventContextMenu);
    this.unsubscribe = world.subscribe(this.sync);
    this.app.ticker.add(this.animate);
    this.sync();
  }

  destroy() {
    this.unsubscribe?.();
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.removeEventListener("contextmenu", this.preventContextMenu);
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
    }
  };

  private drawTerrain(world: WorldState) {
    this.terrainLayer.removeChildren();
    this.waterSurfaces = [];
    if (!world.map) return;
    const activeFloor = this.activeFloor(world);
    const onFloor = (tile: { z: number }) => tile.z === activeFloor;
    const water = new Set(world.map.water.filter(onFloor).map((tile) => `${tile.x}:${tile.y}`));
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
    const cityGround = new Graphics();
    for (const tile of world.map.roads.filter(onFloor)) {
      const px = tile.x * TILE; const py = tile.y * TILE;
      cityGround.rect(px, py, TILE, TILE).fill(0x656157);
      cityGround.moveTo(px + 2, py + 12).lineTo(px + TILE - 2, py + 12).moveTo(px + 2, py + 27).lineTo(px + TILE - 2, py + 27).stroke({ color: 0x888276, width: 1, alpha: 0.55 });
      cityGround.moveTo(px + 11 + ((tile.y & 1) * 8), py + 1).lineTo(px + 11 + ((tile.y & 1) * 8), py + 12).stroke({ color: 0x4d4b45, width: 1, alpha: 0.6 });
    }
    for (const tile of world.map.floors.filter(onFloor)) {
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
    this.terrainLayer.addChild(cityGround);
    const details = new Graphics();
    // Sparse authored details stay above the animated base textures.
    for (const key of water) {
      const [x, y] = key.split(":").map(Number);
      if ((x + y) % 3 === 0) details.moveTo(x * TILE + 8, y * TILE + 35).lineTo(x * TILE + 5, y * TILE + 19).lineTo(x * TILE + 12, y * TILE + 30).stroke({ color: 0x668054, width: 2, alpha: 0.65 });
    }
    for (const stairs of world.map.stairs.filter((entry) => entry.from.z === activeFloor)) {
      const px = stairs.from.x * TILE; const py = stairs.from.y * TILE;
      details.roundRect(px + 5, py + 6, TILE - 10, TILE - 12, 3).fill(0x342c25).stroke({ color: 0xb09a75, width: 2 });
      for (let step = 0; step < 5; step++) details.rect(px + 8 + step * 3, py + 10 + step * 5, TILE - 16 - step * 6, 3).fill(0x8d806d);
    }
    this.terrainLayer.addChild(details);
    this.drawStructures(world);
    this.drawRoofs(world);
  }

  private drawStructures(world: WorldState) {
    for (const node of this.structureNodes) {
      this.actorLayer.removeChild(node);
      node.destroy({ children: true });
    }
    this.structureNodes = [];
    if (!world.map) return;
    const activeFloor = this.activeFloor(world);
    const water = new Set(world.map.water.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const houses = new Set(world.map.houseWalls.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    const castles = new Set(world.map.castleWalls.filter((tile) => tile.z === activeFloor).map((tile) => `${tile.x}:${tile.y}`));
    for (const tile of world.map.blocked.filter((entry) => entry.z === activeFloor && !water.has(`${entry.x}:${entry.y}`))) {
      const key = `${tile.x}:${tile.y}`;
      const kind = castles.has(key) ? "castle" : houses.has(key) ? "house" : "rock";
      const height = kind === "castle" ? 38 : kind === "house" ? 32 : 21;
      const colors = kind === "castle"
        ? { top: 0x77817e, left: 0x46504f, right: 0x353e3e, edge: 0xa2aaa5 }
        : kind === "house"
          ? { top: 0xb08a62, left: 0x805f42, right: 0x64472f, edge: 0xd0a271 }
          : { top: 0x667269, left: 0x3c4941, right: 0x2b3731, edge: 0x89958d };
      const north = projectWorld(-TILE / 2, -TILE / 2); const east = projectWorld(TILE / 2, -TILE / 2);
      const south = projectWorld(TILE / 2, TILE / 2); const west = projectWorld(-TILE / 2, TILE / 2);
      const lift = (point: VisualPosition) => ({ x: point.x, y: point.y - height });
      const topNorth = lift(north); const topEast = lift(east); const topSouth = lift(south); const topWest = lift(west);
      const graphic = new Graphics()
        .poly([topWest.x, topWest.y, topSouth.x, topSouth.y, south.x, south.y, west.x, west.y]).fill(colors.left).stroke({ color: colors.edge, width: 1, alpha: 0.45 })
        .poly([topSouth.x, topSouth.y, topEast.x, topEast.y, east.x, east.y, south.x, south.y]).fill(colors.right).stroke({ color: colors.edge, width: 1, alpha: 0.35 })
        .poly([topNorth.x, topNorth.y, topEast.x, topEast.y, topSouth.x, topSouth.y, topWest.x, topWest.y]).fill(colors.top).stroke({ color: colors.edge, width: 2, alpha: 0.8 });
      if (kind === "castle") {
        graphic.moveTo(topWest.x + 3, topWest.y + 2).lineTo(topSouth.x - 3, topSouth.y - 2).moveTo(topEast.x - 3, topEast.y + 2).lineTo(topSouth.x + 3, topSouth.y - 2).stroke({ color: 0x252d2c, width: 2, alpha: 0.55 });
        for (const point of [topNorth, topEast, topSouth, topWest]) graphic.rect(point.x - 4, point.y - 7, 8, 8).fill(0x89928f).stroke({ color: 0xb0b7b2, width: 1 });
      } else if (kind === "house") {
        graphic.moveTo(topWest.x + 2, topWest.y + 2).lineTo(west.x + 2, west.y - 2).moveTo(topEast.x - 2, topEast.y + 2).lineTo(east.x - 2, east.y - 2).stroke({ color: 0x46301f, width: 3, alpha: 0.9 });
      }
      const node = new Container(); node.addChild(graphic); this.placeNode(node, tile.x, tile.y); node.zIndex += south.y;
      this.structureNodes.push(node); this.actorLayer.addChild(node);
    }
    for (const door of world.map.doors.filter((entry) => entry.position.z === activeFloor)) {
      const node = new Container(); const graphic = new Graphics(); const height = 33;
      const east = projectWorld(TILE / 2, -TILE / 2); const south = projectWorld(TILE / 2, TILE / 2); const west = projectWorld(-TILE / 2, TILE / 2);
      if (door.open) {
        graphic.poly([-4, -2, east.x - 3, east.y, east.x - 3, east.y - 5, 0, -7]).fill(0x6d4327).stroke({ color: 0xc08b52, width: 2 });
      } else {
        graphic.poly([0, south.y - height, east.x, east.y - height, east.x, east.y, 0, south.y]).fill(0x70452a).stroke({ color: 0xc08b52, width: 2 });
        for (let plank = 1; plank < 4; plank++) { const offset = plank / 4; graphic.moveTo(east.x * offset, south.y - height + (east.y - south.y) * offset).lineTo(east.x * offset, south.y + (east.y - south.y) * offset).stroke({ color: 0x402719, width: 2 }); }
        graphic.circle(east.x * 0.72, south.y - height * 0.48, 3).fill(0xe0bd72);
        graphic.moveTo(west.x, west.y).lineTo(0, south.y).stroke({ color: 0x3a2418, width: 3, alpha: 0.65 });
      }
      node.addChild(graphic); this.placeNode(node, door.position.x, door.position.y); node.zIndex += south.y;
      this.structureNodes.push(node); this.actorLayer.addChild(node);
    }
  }

  private drawRoofs(world: WorldState) {
    this.roofNodes.clear();
    if (!world.map) return;
    const activeFloor = this.activeFloor(world);
    for (const building of world.map.buildings.filter((entry) => entry.floor === activeFloor)) {
      const roof = new Container();
      const graphic = new Graphics();
      const north = projectWorld(building.x * TILE, building.y * TILE);
      const east = projectWorld((building.x + building.width) * TILE, building.y * TILE);
      const south = projectWorld((building.x + building.width) * TILE, (building.y + building.height) * TILE);
      const west = projectWorld(building.x * TILE, (building.y + building.height) * TILE);
      const height = building.kind === "keep" ? 42 : 38;
      const raised = [north, east, south, west].map((point) => ({ x: point.x, y: point.y - height }));
      const [topNorth, topEast, topSouth, topWest] = raised;
      if (building.kind === "keep") {
        graphic.poly([topWest.x, topWest.y, topSouth.x, topSouth.y, south.x, south.y - height + 8, west.x, west.y - height + 8]).fill(0x343d3d);
        graphic.poly([topSouth.x, topSouth.y, topEast.x, topEast.y, east.x, east.y - height + 8, south.x, south.y - height + 8]).fill(0x293231);
        graphic.poly(raised.flatMap((point) => [point.x, point.y])).fill(0x596260).stroke({ color: 0x9aa39f, width: 3 });
        for (const point of raised) graphic.rect(point.x - 6, point.y - 9, 12, 10).fill(0x78817e).stroke({ color: 0xabb2ad, width: 1 });
      } else {
        const apex = { x: (topNorth.x + topEast.x + topSouth.x + topWest.x) / 4, y: (topNorth.y + topEast.y + topSouth.y + topWest.y) / 4 - 28 };
        graphic.poly([topNorth.x, topNorth.y, topEast.x, topEast.y, apex.x, apex.y]).fill(0x8c4537).stroke({ color: 0xc56b4f, width: 2 });
        graphic.poly([topEast.x, topEast.y, topSouth.x, topSouth.y, apex.x, apex.y]).fill(0x71352d).stroke({ color: 0xa85140, width: 2 });
        graphic.poly([topSouth.x, topSouth.y, topWest.x, topWest.y, apex.x, apex.y]).fill(0x5e2d28).stroke({ color: 0x934536, width: 2 });
        graphic.poly([topWest.x, topWest.y, topNorth.x, topNorth.y, apex.x, apex.y]).fill(0xa04e3c).stroke({ color: 0xc86d50, width: 2 });
        graphic.circle(apex.x, apex.y, 4).fill(0xe0a06a);
      }
      roof.addChild(graphic);
      roof.zIndex = south.y;
      this.structureNodes.push(roof);
      this.actorLayer.addChild(roof);
      this.roofNodes.set(building.id, roof);
    }
  }

  private updateRoofVisibility(world: WorldState) {
    if (!world.map || !world.localPlayerId) return;
    const player = world.players.get(world.localPlayerId);
    if (!player) return;
    for (const building of world.map.buildings.filter((entry) => entry.floor === player.position.z)) {
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

  private drawPlayers(world: WorldState) {
    this.playerNodes.clear();
    for (const player of world.players.values()) {
      if (player.position.z !== this.activeFloor(world)) continue;
      const local = player.id === world.localPlayerId;
      const node = new Container();
      if (player.id === world.selectedPlayerId) node.addChild(new Graphics().circle(0, 2, 22).stroke({ color: 0x73c7e8, width: 3 }));
      const cloth = local ? 0xb98a3e : 0x4f8295; const trim = local ? 0xe9c477 : 0x8fc5d4;
      node.addChild(new Graphics()
        .ellipse(3, 13, 15, 7).fill({ color: 0x030504, alpha: 0.5 })
        .ellipse(-6, 10, 4, 6).fill(0x25231f).ellipse(6, 10, 4, 6).fill(0x25231f)
        .poly([-12, 9, -9, -8, 9, -8, 12, 9]).fill(cloth).stroke({ color: trim, width: 2 })
        .circle(0, -13, 8).fill(0xc99c70).stroke({ color: 0x3b291e, width: 2 })
        .circle(-3, -15, 2).fill({ color: 0xf1cc9a, alpha: 0.6 }));
      const label = new Text({ text: player.name, style: { fontFamily: "Georgia", fontSize: 13, fill: 0xf3ead2, stroke: { color: 0x0b100e, width: 4 } } });
      label.anchor.set(0.5, 1); label.position.set(0, -20); node.addChild(label);
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
    const playerStep = Math.min(1, this.app.ticker.deltaMS / CLIENT_STEP_MS);
    const creatureStep = Math.min(1, this.app.ticker.deltaMS / CREATURE_STEP_MS);
    const waterTime = this.app.ticker.lastTime;
    for (const surface of this.waterSurfaces) surface.sprite.tilePosition.set(
      surface.baseX + waterTime * surface.speedX,
      surface.baseY + waterTime * surface.speedY,
    );
    for (const player of world.players.values()) this.animateEntity(player.id, player.position, this.playerNodes.get(player.id), playerStep);
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
    const localId = world.localPlayerId;
    const local = localId ? this.visualPositions.get(localId) : null;
    if (local) {
      const position = this.screenPosition(local.x, local.y);
      this.scene.position.set(this.app.screen.width / 2 - position.x, this.app.screen.height / 2 - position.y);
    }
  };

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

  private animateEntity(id: string, target: VisualPosition, node: Container | undefined, maxStep: number) {
    const visual = this.ensureVisual(id, target);
    visual.x = approach(visual.x, target.x, maxStep);
    visual.y = approach(visual.y, target.y, maxStep);
    if (node) this.placeNode(node, visual.x, visual.y);
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

function distanceToProjected(point: VisualPosition, tileX: number, tileY: number) {
  const projected = projectWorld((tileX + 0.5) * TILE, (tileY + 0.5) * TILE);
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

function creatureFrameIndex(definitionId: string, facing: Facing, rows: readonly string[]) {
  const row = rows.indexOf(definitionId);
  return row < 0 ? -1 : row * 4 + facing;
}

function facingFromMovement(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  const projected = projectWorld(dx, dy);
  if (Math.abs(projected.x) >= Math.abs(projected.y)) return projected.x >= 0 ? 1 : 3;
  return projected.y >= 0 ? 2 : 0;
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
