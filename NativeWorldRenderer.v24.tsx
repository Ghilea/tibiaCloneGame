import { memo, useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { createLitSpriteMaterial } from "../rendering/createLitSpriteMaterial";
import { CreatureAnimationController } from "../actors/CreatureAnimationController";
import type {
  CardinalDirection,
  CreatureAnimationDefinition,
  SpriteCreatureDefinition,
} from "../actors/spriteTypes";
import type {
  BuildingView,
  CharacterOutfit,
  CreatureView,
  MapView,
  NpcView,
  PlayerView,
  Position,
  TerrainMaterialId,
  WorldObjectKind,
  WorldObjectView,
} from "../protocol";
import type { InputController } from "./InputController";
import type { WorldState } from "./WorldState";

const NATIVE_RENDER_CHUNK_SIZE = 24;
const NATIVE_RENDER_RADIUS = 44;
const NATIVE_STAGE_BUDGET_MS = 2.5;
const NATIVE_CAMERA_HEIGHT = 18;
const NATIVE_CAMERA_OFFSET = 9;
const NATIVE_CAMERA_ZOOM = 90;

// TIBIAGAME_NATIVE_RENDERER_V23
// TIBIAGAME_NATIVE_RENDERER_V24
// Phase 2 production migration: real imperative actors. Player/NPC models and
// castle-rat sprite animation are owned directly by Three.js, not by React/R3F.

type NativeWorldRendererProps = {
  world: WorldState;
  input: InputController;
  onReady?: () => void;
  showDebug?: boolean;
};

type Transform = readonly [
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rotationY?: number,
];

type StaticSnapshot = {
  signature: string;
  floor: number;
  centerX: number;
  centerY: number;

  roads: Transform[];
  floors: Transform[];
  water: Transform[];
  bridges: Transform[];
  bridgeRails: Transform[];
  bridgePosts: Transform[];
  rocks: Transform[];

  terrain: Record<TerrainMaterialId, Transform[]>;

  houseWalls: Transform[];
  castleWalls: Transform[];
  buildingFloors: Transform[];
  houseRoofs: Transform[];
  keepRoofs: Transform[];
  doors: Transform[];
  windows: Transform[];

  treeTrunks: Transform[];
  forestLower: Transform[];
  forestUpper: Transform[];
  pineLower: Transform[];
  pineUpper: Transform[];
  snowyLower: Transform[];
  snowyUpper: Transform[];

  mountains: Transform[];
  mountainCaps: Transform[];
  snowBanks: Transform[];
  barrels: Transform[];
  woodenProps: Transform[];
  stoneProps: Transform[];
  organicProps: Transform[];
  torches: Transform[];
  torchFlames: Transform[];
  stairs: Transform[];
};

type NativeTextures = {
  grass: THREE.Texture;
  road: THREE.Texture;
  packedEarth: THREE.Texture;
  mossStone: THREE.Texture;
  sandstone: THREE.Texture;
  mud: THREE.Texture;
  gravel: THREE.Texture;
  cryptStone: THREE.Texture;
  woodPlanks: THREE.Texture;
  marshGrass: THREE.Texture;
  ashSoil: THREE.Texture;
  water: THREE.Texture;
  bridge: THREE.Texture;
  castleStone: THREE.Texture;
  timberPlaster: THREE.Texture;
};

const TERRAIN_IDS: readonly TerrainMaterialId[] = [
  "packed_earth",
  "moss_stone",
  "sandstone",
  "mud",
  "gravel",
  "crypt_stone",
  "wood_planks",
  "marsh_grass",
  "ash_soil",
];

const WOODEN_PROP_KINDS = new Set<WorldObjectKind>([
  "chair",
  "table",
  "bench",
  "notice_post",
  "wrecked_planks",
  "wooden_crate",
  "fence_post",
]);

const STONE_PROP_KINDS = new Set<WorldObjectKind>([
  "well",
  "rock_pile",
  "bone_pile",
]);

const ORGANIC_PROP_KINDS = new Set<WorldObjectKind>([
  "bent_reeds",
  "bog_slick",
  "mushroom_patch",
  "hay_bundle",
  "grain_sack",
  "campfire",
]);

class NativeInstancedLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    castShadow = false,
    receiveShadow = true,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.count = 0;
  }

  setTransforms(transforms: readonly Transform[]) {
    const count = Math.min(transforms.length, this.mesh.instanceMatrix.count);
    const target = this.mesh.instanceMatrix.array as Float32Array;

    for (let index = 0; index < count; index += 1) {
      const [x, y, z, sx, sy, sz, rotationY = 0] = transforms[index];
      this.translation.set(x, y, z);
      this.scale.set(sx, sy, sz);
      this.euler.set(0, rotationY, 0);
      this.rotation.setFromEuler(this.euler);
      this.matrix.compose(this.translation, this.rotation, this.scale);
      this.matrix.toArray(target, index * 16);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    if (count > 0) {
      this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function nativeInside(
  position: Position,
  floor: number,
  centerX: number,
  centerY: number,
) {
  return position.z === floor
    && Math.abs(position.x - centerX) <= NATIVE_RENDER_RADIUS
    && Math.abs(position.y - centerY) <= NATIVE_RENDER_RADIUS;
}

function tileKey(position: Position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function nativeTile(
  position: Position,
  y: number,
  height: number,
  scale = 0.98,
): Transform {
  return [
    position.x + 0.5,
    y,
    position.y + 0.5,
    scale,
    height,
    scale,
  ];
}

function appendBridge(
  map: MapView,
  floor: number,
  centerX: number,
  centerY: number,
  tiles: Transform[],
  rails: Transform[],
  posts: Transform[],
) {
  const visible = map.bridges.filter((position) =>
    nativeInside(position, floor, centerX, centerY)
  );
  const set = new Set(map.bridges.map(tileKey));

  for (const tile of visible) {
    tiles.push(nativeTile(tile, 0.09, 0.14));

    const x = tile.x + 0.5;
    const z = tile.y + 0.5;
    const north = !set.has(`${tile.x}:${tile.y - 1}:${tile.z}`);
    const south = !set.has(`${tile.x}:${tile.y + 1}:${tile.z}`);
    const west = !set.has(`${tile.x - 1}:${tile.y}:${tile.z}`);
    const east = !set.has(`${tile.x + 1}:${tile.y}:${tile.z}`);

    if (north) {
      rails.push([x, 0.55, tile.y + 0.06, 0.9, 0.09, 0.09]);
      posts.push([tile.x + 0.1, 0.48, tile.y + 0.06, 0.12, 0.78, 0.12]);
      posts.push([tile.x + 0.9, 0.48, tile.y + 0.06, 0.12, 0.78, 0.12]);
    }
    if (south) {
      rails.push([x, 0.55, tile.y + 0.94, 0.9, 0.09, 0.09]);
      posts.push([tile.x + 0.1, 0.48, tile.y + 0.94, 0.12, 0.78, 0.12]);
      posts.push([tile.x + 0.9, 0.48, tile.y + 0.94, 0.12, 0.78, 0.12]);
    }
    if (west) {
      rails.push([tile.x + 0.06, 0.55, z, 0.09, 0.09, 0.9]);
      posts.push([tile.x + 0.06, 0.48, tile.y + 0.1, 0.12, 0.78, 0.12]);
      posts.push([tile.x + 0.06, 0.48, tile.y + 0.9, 0.12, 0.78, 0.12]);
    }
    if (east) {
      rails.push([tile.x + 0.94, 0.55, z, 0.09, 0.09, 0.9]);
      posts.push([tile.x + 0.94, 0.48, tile.y + 0.1, 0.12, 0.78, 0.12]);
      posts.push([tile.x + 0.94, 0.48, tile.y + 0.9, 0.12, 0.78, 0.12]);
    }
  }
}

function appendBuilding(
  building: BuildingView,
  houseWalls: Transform[],
  castleWalls: Transform[],
  floors: Transform[],
  houseRoofs: Transform[],
  keepRoofs: Transform[],
) {
  const wallHeight = building.kind === "keep" ? 4.1 : 3.2;
  const wallThickness = building.kind === "keep" ? 0.28 : 0.18;
  const targetWalls = building.kind === "keep" ? castleWalls : houseWalls;
  const centerX = building.x + building.width / 2;
  const centerY = building.y + building.height / 2;

  floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width - 0.18),
    0.09,
    Math.max(0.5, building.height - 0.18),
  ]);

  for (let x = building.x; x < building.x + building.width; x += 1) {
    targetWalls.push([
      x + 0.5,
      wallHeight / 2,
      building.y,
      1.04,
      wallHeight,
      wallThickness,
    ]);
    targetWalls.push([
      x + 0.5,
      wallHeight / 2,
      building.y + building.height,
      1.04,
      wallHeight,
      wallThickness,
    ]);
  }

  for (let y = building.y; y < building.y + building.height; y += 1) {
    targetWalls.push([
      building.x,
      wallHeight / 2,
      y + 0.5,
      wallThickness,
      wallHeight,
      1.04,
    ]);
    targetWalls.push([
      building.x + building.width,
      wallHeight / 2,
      y + 0.5,
      wallThickness,
      wallHeight,
      1.04,
    ]);
  }

  const roof: Transform = [
    centerX,
    wallHeight + 0.36,
    centerY,
    building.width + 0.22,
    building.kind === "keep" ? 0.42 : 0.72,
    building.height + 0.22,
  ];
  if (building.kind === "keep") keepRoofs.push(roof);
  else houseRoofs.push(roof);
}

function appendTree(
  position: Position,
  kind: "forest" | "pine" | "snowy",
  snapshot: StaticSnapshot,
) {
  snapshot.treeTrunks.push([
    position.x + 0.5,
    0.72,
    position.y + 0.5,
    1,
    1,
    1,
  ]);

  if (kind === "forest") {
    snapshot.forestLower.push([
      position.x + 0.5,
      1.55,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
    snapshot.forestUpper.push([
      position.x + 0.5,
      2.25,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
  } else if (kind === "pine") {
    snapshot.pineLower.push([
      position.x + 0.5,
      1.62,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
    snapshot.pineUpper.push([
      position.x + 0.5,
      2.33,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
  } else {
    snapshot.snowyLower.push([
      position.x + 0.5,
      1.62,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
    snapshot.snowyUpper.push([
      position.x + 0.5,
      2.33,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
  }
}

function prepareNativeSnapshot(
  map: MapView,
  floor: number,
  centerX: number,
  centerY: number,
  signature: string,
): StaticSnapshot {
  const terrain = Object.fromEntries(
    TERRAIN_IDS.map((id) => [id, [] as Transform[]]),
  ) as Record<TerrainMaterialId, Transform[]>;

  const snapshot: StaticSnapshot = {
    signature,
    floor,
    centerX,
    centerY,

    roads: [],
    floors: [],
    water: [],
    bridges: [],
    bridgeRails: [],
    bridgePosts: [],
    rocks: [],

    terrain,

    houseWalls: [],
    castleWalls: [],
    buildingFloors: [],
    houseRoofs: [],
    keepRoofs: [],
    doors: [],
    windows: [],

    treeTrunks: [],
    forestLower: [],
    forestUpper: [],
    pineLower: [],
    pineUpper: [],
    snowyLower: [],
    snowyUpper: [],

    mountains: [],
    mountainCaps: [],
    snowBanks: [],
    barrels: [],
    woodenProps: [],
    stoneProps: [],
    organicProps: [],
    torches: [],
    torchFlames: [],
    stairs: [],
  };

  for (const position of map.roads) {
    if (nativeInside(position, floor, centerX, centerY))
      snapshot.roads.push(nativeTile(position, 0.015, 0.035));
  }

  for (const position of map.floors) {
    if (nativeInside(position, floor, centerX, centerY))
      snapshot.floors.push(nativeTile(position, 0.025, 0.045));
  }

  for (const position of map.water) {
    if (nativeInside(position, floor, centerX, centerY))
      snapshot.water.push(nativeTile(position, 0.015, 0.03, 1.02));
  }

  for (const entry of map.terrainMaterials) {
    if (nativeInside(entry.position, floor, centerX, centerY))
      snapshot.terrain[entry.material].push(
        nativeTile(entry.position, 0.032, 0.052),
      );
  }

  appendBridge(
    map,
    floor,
    centerX,
    centerY,
    snapshot.bridges,
    snapshot.bridgeRails,
    snapshot.bridgePosts,
  );

  const structuralTiles = new Set<string>();
  for (const position of map.water) structuralTiles.add(tileKey(position));
  for (const position of map.trees) structuralTiles.add(tileKey(position));
  for (const position of map.houseWalls) structuralTiles.add(tileKey(position));
  for (const position of map.castleWalls) structuralTiles.add(tileKey(position));

  for (const object of map.objects ?? []) {
    if ([
      "mountain_wall",
      "forest_tree",
      "pine_tree",
      "snowy_pine",
      "snow_bank",
      "well",
      "table",
      "wooden_crate",
      "rock_pile",
      "campfire",
      "fence_post",
    ].includes(object.kind)) {
      structuralTiles.add(tileKey(object.position));
    }
  }

  for (const position of map.blocked) {
    if (
      nativeInside(position, floor, centerX, centerY)
      && !structuralTiles.has(tileKey(position))
    ) {
      snapshot.rocks.push([
        position.x + 0.5,
        0.275,
        position.y + 0.5,
        0.72,
        0.55,
        0.72,
      ]);
    }
  }

  for (const position of map.houseWalls) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    snapshot.houseWalls.push([
      position.x + 0.5,
      1.6,
      position.y + 0.5,
      0.24,
      3.2,
      0.24,
    ]);
  }

  for (const position of map.castleWalls) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    snapshot.castleWalls.push([
      position.x + 0.5,
      2.05,
      position.y + 0.5,
      0.3,
      4.1,
      0.3,
    ]);
  }

  for (const building of map.buildings) {
    if (building.floor !== floor) continue;
    if (
      building.x > centerX + NATIVE_RENDER_RADIUS
      || building.y > centerY + NATIVE_RENDER_RADIUS
      || building.x + building.width < centerX - NATIVE_RENDER_RADIUS
      || building.y + building.height < centerY - NATIVE_RENDER_RADIUS
    ) continue;

    appendBuilding(
      building,
      snapshot.houseWalls,
      snapshot.castleWalls,
      snapshot.buildingFloors,
      snapshot.houseRoofs,
      snapshot.keepRoofs,
    );
  }

  for (const door of map.doors) {
    if (!nativeInside(door.position, floor, centerX, centerY)) continue;
    snapshot.doors.push([
      door.position.x + 0.5,
      1.05,
      door.position.y + 0.5,
      door.open ? 0.14 : 0.78,
      2.1,
      door.open ? 0.78 : 0.12,
      door.open ? Math.PI / 2 : 0,
    ]);
  }

  for (const window of map.windows) {
    if (!nativeInside(window.position, floor, centerX, centerY)) continue;
    snapshot.windows.push([
      window.position.x + 0.5,
      1.62,
      window.position.y + 0.5,
      window.open ? 0.62 : 0.78,
      0.9,
      0.08,
      window.open ? Math.PI * 0.2 : 0,
    ]);
  }

  for (const position of map.trees) {
    if (nativeInside(position, floor, centerX, centerY))
      appendTree(position, "forest", snapshot);
  }

  for (const object of map.objects ?? []) {
    if (!nativeInside(object.position, floor, centerX, centerY)) continue;

    if (object.kind === "forest_tree") {
      appendTree(object.position, "forest", snapshot);
      continue;
    }
    if (object.kind === "pine_tree") {
      appendTree(object.position, "pine", snapshot);
      continue;
    }
    if (object.kind === "snowy_pine") {
      appendTree(object.position, "snowy", snapshot);
      continue;
    }
    if (object.kind === "mountain_wall") {
      snapshot.mountains.push([
        object.position.x + 0.5,
        1.25,
        object.position.y + 0.5,
        0.92,
        2.5,
        0.92,
      ]);
      snapshot.mountainCaps.push([
        object.position.x + 0.5,
        2.35,
        object.position.y + 0.5,
        1,
        1,
        1,
      ]);
      continue;
    }
    if (object.kind === "snow_bank") {
      snapshot.snowBanks.push([
        object.position.x + 0.5,
        0.18,
        object.position.y + 0.5,
        1,
        0.55,
        1,
      ]);
      continue;
    }
    if (object.kind === "barrel") {
      snapshot.barrels.push([
        object.position.x + 0.5,
        0.28,
        object.position.y + 0.5,
        1,
        1,
        1,
      ]);
      continue;
    }
    if (object.kind === "dirt_path") {
      snapshot.terrain.packed_earth.push(
        nativeTile(object.position, 0.034, 0.055),
      );
      continue;
    }
    if (object.kind === "snow_ground") {
      snapshot.floors.push(nativeTile(object.position, 0.034, 0.055));
      continue;
    }

    const transform: Transform = [
      object.position.x + 0.5,
      0.34,
      object.position.y + 0.5,
      0.58,
      0.68,
      0.58,
    ];

    if (WOODEN_PROP_KINDS.has(object.kind)) {
      snapshot.woodenProps.push(transform);
    } else if (STONE_PROP_KINDS.has(object.kind)) {
      snapshot.stoneProps.push(transform);
    } else if (ORGANIC_PROP_KINDS.has(object.kind)) {
      snapshot.organicProps.push(transform);
    } else {
      snapshot.woodenProps.push(transform);
    }
  }

  for (const position of map.torches) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    snapshot.torches.push([
      position.x + 0.5,
      0.62,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
    snapshot.torchFlames.push([
      position.x + 0.5,
      1.42,
      position.y + 0.5,
      1,
      1,
      1,
    ]);
  }

  for (const stair of map.stairs) {
    const position = stair.from.z === floor
      ? stair.from
      : stair.to.z === floor
        ? stair.to
        : null;
    if (!position || !nativeInside(position, floor, centerX, centerY)) continue;
    snapshot.stairs.push([
      position.x + 0.5,
      0.12,
      position.y + 0.5,
      0.9,
      0.24,
      0.9,
    ]);
  }

  return snapshot;
}

async function loadNativeTextures(
  renderer: THREE.WebGLRenderer,
): Promise<NativeTextures> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const load = async (path: string, repeat = true) => {
    const texture = await loader.loadAsync(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = repeat
      ? THREE.RepeatWrapping
      : THREE.ClampToEdgeWrapping;
    texture.anisotropy = anisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };

  const [
    grass,
    road,
    packedEarth,
    mossStone,
    sandstone,
    mud,
    gravel,
    cryptStone,
    woodPlanks,
    marshGrass,
    ashSoil,
    water,
    bridge,
    castleStone,
    timberPlaster,
  ] = await Promise.all([
    load("/assets/world/greyhaven-grass.png"),
    load("/assets/world/greyhaven-cobble.png"),
    load("/assets/world/aldoria-packed-earth-v1.png"),
    load("/assets/world/aldoria-moss-stone-v1.png"),
    load("/assets/world/aldoria-sandstone-v1.png"),
    load("/assets/world/aldoria-mud-v1.png"),
    load("/assets/world/aldoria-gravel-v1.png"),
    load("/assets/world/aldoria-crypt-stone-v1.png"),
    load("/assets/world/aldoria-wood-planks-floor-v1.png"),
    load("/assets/world/aldoria-marsh-grass-v1.png"),
    load("/assets/world/aldoria-ash-soil-v1.png"),
    load("/assets/world/aldoria-water-v1.png"),
    load("/assets/world/aldoria-bridge-planks-v1.png"),
    load("/assets/world/aldoria-castle-stone-v2.png"),
    load("/assets/world/aldoria-timber-plaster-v1.png"),
  ]);

  grass.repeat.set(30, 30);

  return {
    grass,
    road,
    packedEarth,
    mossStone,
    sandstone,
    mud,
    gravel,
    cryptStone,
    woodPlanks,
    marshGrass,
    ashSoil,
    water,
    bridge,
    castleStone,
    timberPlaster,
  };
}

function materialWithTexture(
  texture: THREE.Texture,
  color: THREE.ColorRepresentation,
  roughness = 0.94,
) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color,
    roughness,
  });
}


const CHARACTER_MODEL_ROOT = "/assets/models/kaykit-adventurers";

const CHARACTER_FILES: Record<CharacterOutfit, string> = {
  knight: "Knight.glb",
  mage: "Mage.glb",
  ranger: "Ranger.glb",
  rogue: "Rogue_Hooded.glb",
};

const CHARACTER_SCALE: Record<CharacterOutfit, number> = {
  knight: 0.727,
  mage: 0.697,
  ranger: 0.814,
  rogue: 0.852,
};

type NativeCharacterAssets = {
  templates: Record<CharacterOutfit, THREE.Group>;
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
};

type NativeCreatureAtlasPair = {
  albedo: THREE.Texture;
  normal: THREE.Texture | null;
};

type NativeCreatureAssets = {
  definition: SpriteCreatureDefinition;
  atlases: Map<string, NativeCreatureAtlasPair>;
};

async function loadNativeCharacterAssets(): Promise<NativeCharacterAssets> {
  const loader = new GLTFLoader();
  const templates = {} as Record<CharacterOutfit, THREE.Group>;

  // Decode during the loading screen, never on first encounter while walking.
  for (const outfit of Object.keys(CHARACTER_FILES) as CharacterOutfit[]) {
    const gltf = await loader.loadAsync(
      `${CHARACTER_MODEL_ROOT}/${CHARACTER_FILES[outfit]}`,
    );
    templates[outfit] = gltf.scene;
  }

  const general = await loader.loadAsync(
    `${CHARACTER_MODEL_ROOT}/Rig_Medium_General.glb`,
  );
  const movement = await loader.loadAsync(
    `${CHARACTER_MODEL_ROOT}/Rig_Medium_MovementBasic.glb`,
  );

  const idle = THREE.AnimationClip.findByName(general.animations, "Idle_A");
  const walk = THREE.AnimationClip.findByName(
    movement.animations,
    "Walking_A",
  );
  if (!idle || !walk) {
    throw new Error("Native V24: KayKit Idle_A/Walking_A animation missing");
  }

  return { templates, idle, walk };
}

async function loadNativeCreatureAssets(
  id: string,
): Promise<NativeCreatureAssets> {
  const response = await fetch(`/assets/monsters/${id}/${id}.json`);
  if (!response.ok) {
    throw new Error(
      `Native V24: unable to load sprite creature ${id}: ${response.status}`,
    );
  }

  const definition = await response.json() as SpriteCreatureDefinition;
  if (definition.id !== id || definition.type !== "spriteCreature") {
    throw new Error(`Native V24: invalid sprite creature definition ${id}`);
  }

  const loader = new THREE.TextureLoader();
  const atlases = new Map<string, NativeCreatureAtlasPair>();

  // Load every currently required animation before the loading overlay leaves.
  // This deliberately trades a little startup time for zero first-use decode
  // stalls during movement/combat.
  for (const name of ["idle", "walk", "attack", "hit", "death"]) {
    const animation = definition.animations[name];
    if (!animation) continue;

    const albedo = await loader.loadAsync(
      `/assets/monsters/${id}/${animation.albedo}`,
    );
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
    albedo.generateMipmaps = false;
    albedo.minFilter = THREE.LinearFilter;
    albedo.magFilter = THREE.LinearFilter;
    albedo.needsUpdate = true;

    let normal: THREE.Texture | null = null;
    if (animation.normal) {
      normal = await loader.loadAsync(
        `/assets/monsters/${id}/${animation.normal}`,
      );
      normal.colorSpace = THREE.NoColorSpace;
      normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
      normal.generateMipmaps = false;
      normal.minFilter = THREE.LinearFilter;
      normal.magFilter = THREE.LinearFilter;
      normal.needsUpdate = true;
    }

    atlases.set(name, { albedo, normal });
  }

  if (!atlases.has("idle")) {
    throw new Error(`Native V24: ${id} has no loaded idle atlas`);
  }

  return { definition, atlases };
}

function disposeCharacterTemplates(assets: NativeCharacterAssets) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const template of Object.values(assets.templates)) {
    template.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry) geometries.add(object.geometry);
      const entries = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of entries) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function disposeCreatureAssets(assets: NativeCreatureAssets) {
  const textures = new Set<THREE.Texture>();
  for (const atlas of assets.atlases.values()) {
    textures.add(atlas.albedo);
    if (atlas.normal) textures.add(atlas.normal);
  }
  for (const texture of textures) texture.dispose();
}

function npcOutfit(npc: NpcView): CharacterOutfit {
  switch (npc.service) {
    case "spell_trainer":
      return "mage";
    case "craft_trainer":
      return "ranger";
    case "shop":
      return "rogue";
    case "depot":
    default:
      return "knight";
  }
}

class NativeCharacterActor {
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction;
  private readonly walkAction: THREE.AnimationAction;
  private active: "idle" | "walk" = "idle";
  private targetX = 0;
  private targetZ = 0;
  private targetFloor = -999;
  private facingAngle = 0;
  private movingUntil = 0;
  private initialized = false;

  constructor(
    scene: THREE.Scene,
    template: THREE.Group,
    scale: number,
    idle: THREE.AnimationClip,
    walk: THREE.AnimationClip,
  ) {
    this.root = cloneSkeleton(template) as THREE.Group;
    this.root.scale.setScalar(scale);
    this.root.visible = false;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = true;
      object.frustumCulled = false;
    });

    this.mixer = new THREE.AnimationMixer(this.root);
    this.idleAction = this.mixer.clipAction(idle);
    this.walkAction = this.mixer.clipAction(walk);
    this.walkAction.timeScale = 1.08;
    this.idleAction.reset().play();

    scene.add(this.root);
  }

  setTarget(position: Position, floor: number, now: number) {
    const nextX = position.x + 0.5;
    const nextZ = position.y + 0.5;

    if (!this.initialized) {
      this.root.position.set(nextX, 0.05, nextZ);
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = position.z;
      this.initialized = true;
    } else if (nextX !== this.targetX || nextZ !== this.targetZ) {
      const dx = nextX - this.targetX;
      const dz = nextZ - this.targetZ;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        this.facingAngle = Math.atan2(dx, dz);
      }
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = position.z;
      this.movingUntil = now + 240;
    }

    this.root.visible = position.z === floor;
  }

  hide() {
    this.root.visible = false;
  }

  update(delta: number, now: number) {
    if (!this.root.visible || !this.initialized) return;

    this.root.position.x = THREE.MathUtils.damp(
      this.root.position.x,
      this.targetX,
      16,
      delta,
    );
    this.root.position.z = THREE.MathUtils.damp(
      this.root.position.z,
      this.targetZ,
      16,
      delta,
    );
    this.root.rotation.y = THREE.MathUtils.damp(
      this.root.rotation.y,
      this.facingAngle,
      18,
      delta,
    );

    const moving = now < this.movingUntil
      || Math.abs(this.root.position.x - this.targetX) > 0.015
      || Math.abs(this.root.position.z - this.targetZ) > 0.015;
    const next = moving ? "walk" : "idle";

    if (next !== this.active) {
      if (this.active === "idle") this.idleAction.fadeOut(0.1);
      else this.walkAction.fadeOut(0.1);

      if (next === "idle") this.idleAction.reset().fadeIn(0.1).play();
      else this.walkAction.reset().fadeIn(0.1).play();
      this.active = next;
    }

    this.mixer.update(Math.min(delta, 0.05));
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

function cardinalDirectionFromDelta(
  dx: number,
  dy: number,
  fallback: CardinalDirection,
): CardinalDirection {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function applyNativeSpriteFrame(
  geometry: THREE.PlaneGeometry,
  animation: CreatureAnimationDefinition,
  requestedDirection: CardinalDirection,
  frame: number,
  mirrorEastFromWest: boolean,
) {
  const mirrored = requestedDirection === "east" && mirrorEastFromWest;
  const direction = mirrored ? "west" : requestedDirection;
  const row =
    animation.directionRows[direction]
    ?? animation.directionRows.south
    ?? 0;

  const atlasWidth = animation.columns * animation.frameWidth;
  const atlasHeight = animation.rows * animation.frameHeight;
  const column = Math.min(frame, animation.framesPerDirection - 1);

  let u0 = (column * animation.frameWidth + 0.5) / atlasWidth;
  let u1 = ((column + 1) * animation.frameWidth - 0.5) / atlasWidth;
  if (mirrored) [u0, u1] = [u1, u0];

  const vTop =
    1 - (row * animation.frameHeight + 0.5) / atlasHeight;
  const vBottom =
    1 - ((row + 1) * animation.frameHeight - 0.5) / atlasHeight;

  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, u0, vTop);
  uv.setXY(1, u1, vTop);
  uv.setXY(2, u0, vBottom);
  uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
}

class NativeSpriteCreatureActor {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshStandardMaterial
  >;
  private readonly shadow: THREE.Mesh;
  private readonly controller: CreatureAnimationController;
  private readonly definition: SpriteCreatureDefinition;
  private readonly atlases: Map<string, NativeCreatureAtlasPair>;

  private targetX = 0;
  private targetZ = 0;
  private movingUntil = 0;
  private facing: CardinalDirection = "south";
  private previousHealth = Number.POSITIVE_INFINITY;
  private previousState = "";
  private lastAnimation = "";
  private lastFrame = -1;
  private lastFacing: CardinalDirection = "south";
  private initialized = false;

  constructor(
    scene: THREE.Scene,
    assets: NativeCreatureAssets,
  ) {
    this.definition = assets.definition;
    this.atlases = assets.atlases;
    this.controller = new CreatureAnimationController(this.definition);

    const idleAtlas = this.atlases.get("idle");
    if (!idleAtlas) {
      throw new Error(`${this.definition.id}: native idle atlas missing`);
    }

    const geometry = new THREE.PlaneGeometry(
      this.definition.renderSize.width,
      this.definition.renderSize.height,
    );
    geometry.translate(
      (0.5 - this.definition.anchor.x) * this.definition.renderSize.width,
      (0.5 - this.definition.anchor.y) * this.definition.renderSize.height,
      0,
    );
    applyNativeSpriteFrame(
      geometry,
      this.definition.animations.idle,
      this.facing,
      0,
      this.definition.mirrorEastFromWest,
    );

    const material = createLitSpriteMaterial(
      idleAtlas.albedo,
      idleAtlas.normal,
      this.definition.material.roughness,
      this.definition.material.alphaTest,
      this.definition.material.normalStrength,
    );

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = 0.05;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    const shadowGeometry = new THREE.PlaneGeometry(
      this.definition.shadow.width,
      this.definition.shadow.depth,
    );
    shadowGeometry.rotateX(-Math.PI / 2);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: this.definition.shadow.opacity,
      depthTest: true,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.position.y = 0.006;
    this.root.add(this.shadow);

    this.root.visible = false;
    scene.add(this.root);
  }

  setTarget(
    creature: CreatureView,
    floor: number,
    now: number,
  ) {
    const nextX = creature.position.x + 0.5;
    const nextZ = creature.position.y + 0.5;

    if (!this.initialized) {
      this.root.position.set(nextX, 0, nextZ);
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.previousHealth = creature.health;
      this.previousState = creature.state;
      this.initialized = true;
    } else if (nextX !== this.targetX || nextZ !== this.targetZ) {
      const dx = nextX - this.targetX;
      const dz = nextZ - this.targetZ;
      this.facing = cardinalDirectionFromDelta(
        dx,
        dz,
        this.facing,
      );
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.movingUntil = now + 240;
    }

    if (creature.health <= 0 && this.previousHealth > 0) {
      if (this.atlases.has("death")) this.controller.play("death", true);
    } else if (creature.health < this.previousHealth) {
      if (this.atlases.has("hit")) this.controller.play("hit", true);
    } else if (
      creature.state === "attacking"
      && this.previousState !== "attacking"
      && this.atlases.has("attack")
    ) {
      this.controller.play("attack", true);
    }

    this.previousHealth = creature.health;
    this.previousState = creature.state;
    this.root.visible = creature.position.z === floor;
  }

  hide() {
    this.root.visible = false;
  }

  update(
    delta: number,
    now: number,
    camera: THREE.Camera,
  ) {
    if (!this.root.visible || !this.initialized) return;

    this.root.position.x = THREE.MathUtils.damp(
      this.root.position.x,
      this.targetX,
      16,
      delta,
    );
    this.root.position.z = THREE.MathUtils.damp(
      this.root.position.z,
      this.targetZ,
      16,
      delta,
    );

    const moving = now < this.movingUntil
      || Math.abs(this.root.position.x - this.targetX) > 0.015
      || Math.abs(this.root.position.z - this.targetZ) > 0.015;

    if (this.controller.isFinished && this.controller.currentAnimation !== "death") {
      this.controller.play(moving && this.atlases.has("walk") ? "walk" : "idle");
    } else if (
      ["idle", "walk"].includes(this.controller.currentAnimation)
    ) {
      this.controller.play(
        moving && this.atlases.has("walk") ? "walk" : "idle",
      );
    }

    this.controller.update(delta);

    const animationName = this.controller.currentAnimation;
    const frame = this.controller.currentFrame;
    const animationChanged = animationName !== this.lastAnimation;

    if (animationChanged) {
      const atlas = this.atlases.get(animationName)
        ?? this.atlases.get("idle");
      if (!atlas) return;

      const shaderShapeChanged =
        Boolean(this.mesh.material.normalMap) !== Boolean(atlas.normal);
      this.mesh.material.map = atlas.albedo;
      this.mesh.material.normalMap = atlas.normal;
      if (shaderShapeChanged) this.mesh.material.needsUpdate = true;
      this.lastAnimation = animationName;
    }

    if (
      animationChanged
      || frame !== this.lastFrame
      || this.facing !== this.lastFacing
    ) {
      const animation =
        this.definition.animations[animationName]
        ?? this.definition.animations.idle;
      applyNativeSpriteFrame(
        this.mesh.geometry,
        animation,
        this.facing,
        frame,
        this.definition.mirrorEastFromWest,
      );
      this.lastFrame = frame;
      this.lastFacing = this.facing;
    }

    this.mesh.quaternion.copy(camera.quaternion);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();

    const shadowGeometry = this.shadow.geometry;
    const shadowMaterial = this.shadow.material;
    shadowGeometry.dispose();
    if (Array.isArray(shadowMaterial)) {
      for (const material of shadowMaterial) material.dispose();
    } else {
      shadowMaterial.dispose();
    }
  }
}

class NativeActorManager {
  private readonly players = new Map<string, NativeCharacterActor>();
  private readonly npcs = new Map<string, NativeCharacterActor>();
  private readonly creatures = new Map<string, NativeSpriteCreatureActor>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly characters: NativeCharacterAssets,
    private readonly castleRat: NativeCreatureAssets,
  ) {}

  private createCharacter(
    outfit: CharacterOutfit,
  ) {
    return new NativeCharacterActor(
      this.scene,
      this.characters.templates[outfit],
      CHARACTER_SCALE[outfit],
      this.characters.idle,
      this.characters.walk,
    );
  }

  sync(
    world: WorldState,
    floor: number,
    delta: number,
    now: number,
    camera: THREE.Camera,
    fallbackCreatureLayer: NativeInstancedLayer,
  ) {
    for (const actor of this.players.values()) actor.hide();
    for (const actor of this.npcs.values()) actor.hide();
    for (const actor of this.creatures.values()) actor.hide();

    for (const player of world.players.values()) {
      let actor = this.players.get(player.id);
      if (!actor) {
        actor = this.createCharacter(player.outfit);
        this.players.set(player.id, actor);
      }
      actor.setTarget(player.position, floor, now);
      actor.update(delta, now);
    }

    for (const npc of world.npcs.values()) {
      let actor = this.npcs.get(npc.id);
      if (!actor) {
        actor = this.createCharacter(npcOutfit(npc));
        this.npcs.set(npc.id, actor);
      }
      actor.setTarget(npc.position, floor, now);
      actor.update(delta, now);
    }

    const fallbackCreatures: Transform[] = [];
    for (const creature of world.creatures.values()) {
      if (creature.definitionId === this.castleRat.definition.id) {
        let actor = this.creatures.get(creature.id);
        if (!actor) {
          actor = new NativeSpriteCreatureActor(
            this.scene,
            this.castleRat,
          );
          this.creatures.set(creature.id, actor);
        }
        actor.setTarget(creature, floor, now);
        actor.update(delta, now, camera);
        continue;
      }

      if (creature.position.z === floor) {
        fallbackCreatures.push([
          creature.position.x + 0.5,
          0.42,
          creature.position.y + 0.5,
          0.66,
          0.84,
          0.66,
        ]);
      }
    }
    fallbackCreatureLayer.setTransforms(fallbackCreatures);
  }

  dispose() {
    for (const actor of this.players.values()) {
      actor.dispose(this.scene);
    }
    for (const actor of this.npcs.values()) {
      actor.dispose(this.scene);
    }
    for (const actor of this.creatures.values()) {
      actor.dispose(this.scene);
    }
    this.players.clear();
    this.npcs.clear();
    this.creatures.clear();
  }
}

export const NativeWorldRenderer = memo(function NativeWorldRenderer({
  world,
  input,
  onReady,
  showDebug = true,
}: NativeWorldRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const performanceRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupInput: (() => void) | null = null;
    let actorManager: NativeActorManager | null = null;
    let loadedCharacterAssets: NativeCharacterAssets | null = null;
    let loadedCreatureAssets: NativeCreatureAssets | null = null;
    const disposables: Array<{ dispose(): void }> = [];

    console.info(
      "NATIVE WORLD V24 active · raw Three.js actors · R3F world bypassed",
    );

    const bootstrap = async () => {
      const nextRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer = nextRenderer;
      nextRenderer.outputColorSpace = THREE.SRGBColorSpace;
      nextRenderer.shadowMap.enabled = false;
      nextRenderer.shadowMap.autoUpdate = false;
      nextRenderer.setClearColor(0x0b1210);
      nextRenderer.info.autoReset = true;

      const textures = await loadNativeTextures(nextRenderer);
      const characterAssets = await loadNativeCharacterAssets();
      const castleRatAssets = await loadNativeCreatureAssets("castle_rat");
      loadedCharacterAssets = characterAssets;
      loadedCreatureAssets = castleRatAssets;

      if (disposed) {
        for (const texture of Object.values(textures)) texture.dispose();
        disposeCharacterTemplates(characterAssets);
        disposeCreatureAssets(castleRatAssets);
        loadedCharacterAssets = null;
        loadedCreatureAssets = null;
        nextRenderer.dispose();
        return;
      }
      disposables.push(...Object.values(textures));

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1210);

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 180);
      camera.zoom = NATIVE_CAMERA_ZOOM;

      const hemisphere = new THREE.HemisphereLight(0xc8d7c7, 0x19231d, 1.75);
      scene.add(hemisphere);
      const sun = new THREE.DirectionalLight(0xffe4b8, 1.2);
      sun.position.set(10, 24, 8);
      scene.add(sun);

      const box = new THREE.BoxGeometry(1, 1, 1);
      const bridgePostGeometry = new THREE.CylinderGeometry(0.07, 0.08, 0.78, 8);
      const treeTrunkGeometry = new THREE.CylinderGeometry(0.14, 0.2, 1.45, 8);
      const forestLowerGeometry = new THREE.ConeGeometry(0.82, 1.75, 9);
      const forestUpperGeometry = new THREE.ConeGeometry(0.61, 1.35, 9);
      const pineLowerGeometry = new THREE.ConeGeometry(0.72, 1.9, 7);
      const pineUpperGeometry = new THREE.ConeGeometry(0.52, 1.5, 7);
      const mountainCapGeometry = new THREE.DodecahedronGeometry(0.53, 0);
      const snowBankGeometry = new THREE.DodecahedronGeometry(0.55, 1);
      const barrelGeometry = new THREE.CylinderGeometry(0.24, 0.28, 0.56, 10);
      const torchPostGeometry = new THREE.CylinderGeometry(0.035, 0.055, 1.24, 7);
      const torchFlameGeometry = new THREE.ConeGeometry(0.13, 0.38, 9);

      disposables.push(
        box,
        bridgePostGeometry,
        treeTrunkGeometry,
        forestLowerGeometry,
        forestUpperGeometry,
        pineLowerGeometry,
        pineUpperGeometry,
        mountainCapGeometry,
        snowBankGeometry,
        barrelGeometry,
        torchPostGeometry,
        torchFlameGeometry,
      );

      const materials = {
        grass: materialWithTexture(textures.grass, "#91a477", 0.96),
        road: materialWithTexture(textures.road, "#b7a889", 0.92),
        floor: materialWithTexture(textures.mossStone, "#aaa18d", 0.92),
        packedEarth: materialWithTexture(textures.packedEarth, "#b29676", 0.92),
        mossStone: materialWithTexture(textures.mossStone, "#a4ad9a", 0.92),
        sandstone: materialWithTexture(textures.sandstone, "#d0ba91", 0.92),
        mud: materialWithTexture(textures.mud, "#806248", 0.94),
        gravel: materialWithTexture(textures.gravel, "#aaa18f", 0.94),
        cryptStone: materialWithTexture(textures.cryptStone, "#89908a", 0.94),
        woodPlanks: materialWithTexture(textures.woodPlanks, "#a0744d", 0.92),
        marshGrass: materialWithTexture(textures.marshGrass, "#71865d", 0.96),
        ashSoil: materialWithTexture(textures.ashSoil, "#746d63", 0.96),
        water: new THREE.MeshStandardMaterial({
          map: textures.water,
          color: "#277789",
          emissive: "#16424d",
          emissiveIntensity: 0.08,
          roughness: 0.24,
          transparent: true,
          opacity: 0.86,
        }),
        bridge: materialWithTexture(textures.bridge, "#80603c", 0.9),
        bridgeRail: materialWithTexture(textures.bridge, "#725334", 0.9),
        bridgePost: materialWithTexture(textures.bridge, "#684a2f", 0.92),
        rock: new THREE.MeshStandardMaterial({ color: "#626d66", roughness: 0.98 }),

        houseWall: materialWithTexture(textures.timberPlaster, "#b79d79", 0.96),
        castleWall: materialWithTexture(textures.castleStone, "#d0d0c5", 0.98),
        buildingFloor: materialWithTexture(textures.mossStone, "#aaa18d", 0.96),
        houseRoof: new THREE.MeshStandardMaterial({ color: "#71513f", roughness: 0.94 }),
        keepRoof: materialWithTexture(textures.castleStone, "#8c918b", 0.98),
        door: new THREE.MeshStandardMaterial({ color: "#654128", roughness: 0.82 }),
        window: new THREE.MeshStandardMaterial({ color: "#5b3822", roughness: 0.85 }),

        treeTrunk: new THREE.MeshStandardMaterial({ color: "#604128", roughness: 1 }),
        forestLower: new THREE.MeshStandardMaterial({ color: "#315c38", roughness: 0.95 }),
        forestUpper: new THREE.MeshStandardMaterial({ color: "#3b7043", roughness: 0.95 }),
        pineLower: new THREE.MeshStandardMaterial({ color: "#285744", roughness: 0.95 }),
        pineUpper: new THREE.MeshStandardMaterial({ color: "#346a50", roughness: 0.95 }),
        snowyLower: new THREE.MeshStandardMaterial({ color: "#c5dadd", roughness: 0.95 }),
        snowyUpper: new THREE.MeshStandardMaterial({ color: "#e0ebea", roughness: 0.95 }),

        mountain: new THREE.MeshStandardMaterial({ color: "#59615d", roughness: 0.98 }),
        mountainCap: new THREE.MeshStandardMaterial({ color: "#778078", roughness: 0.98 }),
        snowBank: new THREE.MeshStandardMaterial({ color: "#c9dcdf", roughness: 1 }),
        barrel: new THREE.MeshStandardMaterial({ color: "#9b5d2c", roughness: 0.85 }),
        woodenProp: new THREE.MeshStandardMaterial({ color: "#795235", roughness: 0.95 }),
        stoneProp: new THREE.MeshStandardMaterial({ color: "#767a74", roughness: 0.98 }),
        organicProp: new THREE.MeshStandardMaterial({ color: "#67704a", roughness: 0.98 }),
        torch: new THREE.MeshStandardMaterial({ color: "#49301f", roughness: 0.92 }),
        torchFlame: new THREE.MeshStandardMaterial({
          color: "#ff8b32",
          emissive: "#ff4d10",
          emissiveIntensity: 3,
          toneMapped: false,
        }),
        stair: new THREE.MeshStandardMaterial({ color: "#8c877d", roughness: 0.96 }),

        creature: new THREE.MeshStandardMaterial({
          color: "#a9685f",
          roughness: 0.9,
        }),
      };
      disposables.push(...Object.values(materials));

      const ground = new THREE.Mesh(box, materials.grass);
      ground.receiveShadow = true;
      ground.position.y = -0.12;
      scene.add(ground);

      const layers = {
        roads: new NativeInstancedLayer(box, materials.road, 8192),
        floors: new NativeInstancedLayer(box, materials.floor, 8192),
        water: new NativeInstancedLayer(box, materials.water, 8192),
        bridges: new NativeInstancedLayer(box, materials.bridge, 4096),
        bridgeRails: new NativeInstancedLayer(box, materials.bridgeRail, 8192),
        bridgePosts: new NativeInstancedLayer(bridgePostGeometry, materials.bridgePost, 8192),
        rocks: new NativeInstancedLayer(box, materials.rock, 4096),

        packedEarth: new NativeInstancedLayer(box, materials.packedEarth, 8192),
        mossStone: new NativeInstancedLayer(box, materials.mossStone, 8192),
        sandstone: new NativeInstancedLayer(box, materials.sandstone, 8192),
        mud: new NativeInstancedLayer(box, materials.mud, 8192),
        gravel: new NativeInstancedLayer(box, materials.gravel, 8192),
        cryptStone: new NativeInstancedLayer(box, materials.cryptStone, 8192),
        woodPlanks: new NativeInstancedLayer(box, materials.woodPlanks, 8192),
        marshGrass: new NativeInstancedLayer(box, materials.marshGrass, 8192),
        ashSoil: new NativeInstancedLayer(box, materials.ashSoil, 8192),

        houseWalls: new NativeInstancedLayer(box, materials.houseWall, 8192),
        castleWalls: new NativeInstancedLayer(box, materials.castleWall, 8192),
        buildingFloors: new NativeInstancedLayer(box, materials.buildingFloor, 4096),
        houseRoofs: new NativeInstancedLayer(box, materials.houseRoof, 2048),
        keepRoofs: new NativeInstancedLayer(box, materials.keepRoof, 1024),
        doors: new NativeInstancedLayer(box, materials.door, 2048),
        windows: new NativeInstancedLayer(box, materials.window, 4096),

        treeTrunks: new NativeInstancedLayer(treeTrunkGeometry, materials.treeTrunk, 4096),
        forestLower: new NativeInstancedLayer(forestLowerGeometry, materials.forestLower, 4096),
        forestUpper: new NativeInstancedLayer(forestUpperGeometry, materials.forestUpper, 4096),
        pineLower: new NativeInstancedLayer(pineLowerGeometry, materials.pineLower, 4096),
        pineUpper: new NativeInstancedLayer(pineUpperGeometry, materials.pineUpper, 4096),
        snowyLower: new NativeInstancedLayer(pineLowerGeometry, materials.snowyLower, 4096),
        snowyUpper: new NativeInstancedLayer(pineUpperGeometry, materials.snowyUpper, 4096),

        mountains: new NativeInstancedLayer(box, materials.mountain, 4096),
        mountainCaps: new NativeInstancedLayer(mountainCapGeometry, materials.mountainCap, 4096),
        snowBanks: new NativeInstancedLayer(snowBankGeometry, materials.snowBank, 4096),
        barrels: new NativeInstancedLayer(barrelGeometry, materials.barrel, 2048),
        woodenProps: new NativeInstancedLayer(box, materials.woodenProp, 4096),
        stoneProps: new NativeInstancedLayer(box, materials.stoneProp, 4096),
        organicProps: new NativeInstancedLayer(box, materials.organicProp, 4096),
        torches: new NativeInstancedLayer(torchPostGeometry, materials.torch, 2048),
        torchFlames: new NativeInstancedLayer(torchFlameGeometry, materials.torchFlame, 2048, false, false),
        stairs: new NativeInstancedLayer(box, materials.stair, 1024),

        // Unsupported creature definitions keep a cheap native fallback.
        creatures: new NativeInstancedLayer(
          box,
          materials.creature,
          512,
        ),
      };

      for (const layer of Object.values(layers)) scene.add(layer.mesh);

      actorManager = new NativeActorManager(
        scene,
        characterAssets,
        castleRatAssets,
      );
      const activeActorManager = actorManager;

      let lastFrameAt = performance.now();
      let warmupUntil = lastFrameAt + 1_500;
      let lastStaticSignature = "";
      let pendingStaticSignature = "";
      let staticGeneration = 0;
      let stagedTasks: Array<{
        generation: number;
        label: string;
        run: () => void;
      }> = [];
      let readyReported = false;

      let sampleFrames = 0;
      let sampleTotal = 0;
      let sampleMax = 0;

      const resize = () => {
        const parent = canvas.parentElement;
        const width = Math.max(1, parent?.clientWidth ?? canvas.clientWidth ?? 1);
        const height = Math.max(1, parent?.clientHeight ?? canvas.clientHeight ?? 1);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);

        nextRenderer.setPixelRatio(pixelRatio);
        nextRenderer.setSize(width, height, false);

        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
        camera.zoom = NATIVE_CAMERA_ZOOM;
        camera.updateProjectionMatrix();
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas.parentElement ?? canvas);
      resize();

      const queueStaticSnapshot = (
        map: MapView,
        floor: number,
        playerX: number,
        playerY: number,
        signature: string,
      ) => {
        if (
          signature === pendingStaticSignature
          || signature === lastStaticSignature
        ) return;

        pendingStaticSignature = signature;
        const generation = ++staticGeneration;
        const prepareStarted = performance.now();
        const snapshot = prepareNativeSnapshot(
          map,
          floor,
          playerX,
          playerY,
          signature,
        );
        const prepareMs = performance.now() - prepareStarted;

        if (prepareMs > 4) {
          console.info(
            `NATIVE STATIC PREP ${prepareMs.toFixed(1)}ms · pos ${playerX}:${playerY}:${floor}`,
          );
        }

        const tasks: Array<{
          generation: number;
          label: string;
          run: () => void;
        }> = [];

        const stage = (
          label: string,
          run: () => void,
        ) => tasks.push({ generation, label, run });

        stage("ground", () => {
          const size = NATIVE_RENDER_RADIUS * 2 + 4;
          ground.position.set(playerX + 0.5, -0.12, playerY + 0.5);
          ground.scale.set(size, 0.2, size);
          ground.updateMatrix();
        });

        stage("roads", () => layers.roads.setTransforms(snapshot.roads));
        stage("floors", () => layers.floors.setTransforms(snapshot.floors));
        stage("water", () => layers.water.setTransforms(snapshot.water));
        stage("bridges", () => layers.bridges.setTransforms(snapshot.bridges));
        stage("bridge rails", () => layers.bridgeRails.setTransforms(snapshot.bridgeRails));
        stage("bridge posts", () => layers.bridgePosts.setTransforms(snapshot.bridgePosts));
        stage("rocks", () => layers.rocks.setTransforms(snapshot.rocks));

        stage("packed earth", () => layers.packedEarth.setTransforms(snapshot.terrain.packed_earth));
        stage("moss stone", () => layers.mossStone.setTransforms(snapshot.terrain.moss_stone));
        stage("sandstone", () => layers.sandstone.setTransforms(snapshot.terrain.sandstone));
        stage("mud", () => layers.mud.setTransforms(snapshot.terrain.mud));
        stage("gravel", () => layers.gravel.setTransforms(snapshot.terrain.gravel));
        stage("crypt stone", () => layers.cryptStone.setTransforms(snapshot.terrain.crypt_stone));
        stage("wood planks", () => layers.woodPlanks.setTransforms(snapshot.terrain.wood_planks));
        stage("marsh grass", () => layers.marshGrass.setTransforms(snapshot.terrain.marsh_grass));
        stage("ash soil", () => layers.ashSoil.setTransforms(snapshot.terrain.ash_soil));

        stage("building floors", () => layers.buildingFloors.setTransforms(snapshot.buildingFloors));
        stage("house walls", () => layers.houseWalls.setTransforms(snapshot.houseWalls));
        stage("castle walls", () => layers.castleWalls.setTransforms(snapshot.castleWalls));
        stage("house roofs", () => layers.houseRoofs.setTransforms(snapshot.houseRoofs));
        stage("keep roofs", () => layers.keepRoofs.setTransforms(snapshot.keepRoofs));
        stage("doors", () => layers.doors.setTransforms(snapshot.doors));
        stage("windows", () => layers.windows.setTransforms(snapshot.windows));

        stage("tree trunks", () => layers.treeTrunks.setTransforms(snapshot.treeTrunks));
        stage("forest lower", () => layers.forestLower.setTransforms(snapshot.forestLower));
        stage("forest upper", () => layers.forestUpper.setTransforms(snapshot.forestUpper));
        stage("pine lower", () => layers.pineLower.setTransforms(snapshot.pineLower));
        stage("pine upper", () => layers.pineUpper.setTransforms(snapshot.pineUpper));
        stage("snowy lower", () => layers.snowyLower.setTransforms(snapshot.snowyLower));
        stage("snowy upper", () => layers.snowyUpper.setTransforms(snapshot.snowyUpper));

        stage("mountains", () => layers.mountains.setTransforms(snapshot.mountains));
        stage("mountain caps", () => layers.mountainCaps.setTransforms(snapshot.mountainCaps));
        stage("snow banks", () => layers.snowBanks.setTransforms(snapshot.snowBanks));
        stage("barrels", () => layers.barrels.setTransforms(snapshot.barrels));
        stage("wooden props", () => layers.woodenProps.setTransforms(snapshot.woodenProps));
        stage("stone props", () => layers.stoneProps.setTransforms(snapshot.stoneProps));
        stage("organic props", () => layers.organicProps.setTransforms(snapshot.organicProps));
        stage("torches", () => layers.torches.setTransforms(snapshot.torches));
        stage("torch flames", () => layers.torchFlames.setTransforms(snapshot.torchFlames));
        stage("stairs", () => layers.stairs.setTransforms(snapshot.stairs));

        stage("commit", () => {
          if (generation !== staticGeneration) return;
          lastStaticSignature = snapshot.signature;
          pendingStaticSignature = "";
          if (!readyReported) {
            readyReported = true;
            queueMicrotask(() => onReadyRef.current?.());
          }
        });

        stagedTasks = tasks;
      };

      const runStagedTasks = () => {
        const startedAt = performance.now();

        while (stagedTasks.length > 0) {
          const task = stagedTasks.shift();
          if (!task) break;
          if (task.generation !== staticGeneration) continue;

          const taskStarted = performance.now();
          task.run();
          const taskMs = performance.now() - taskStarted;

          if (taskMs > 4) {
            console.info(
              `NATIVE STATIC TASK ${task.label}: ${taskMs.toFixed(1)}ms`,
            );
          }

          if (performance.now() - startedAt >= NATIVE_STAGE_BUDGET_MS) break;
        }
      };

      const raycaster = new THREE.Raycaster();
      const interactionPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        0,
      );
      const interactionPoint = new THREE.Vector3();

      const interactAtPointer = (event: PointerEvent | MouseEvent) => {
        const localPlayer = world.localPlayerId
          ? world.players.get(world.localPlayerId)
          : undefined;
        const map = world.map;
        if (!localPlayer || !map) return;

        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -(((event.clientY - rect.top) / rect.height) * 2 - 1),
        );
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(interactionPlane, interactionPoint))
          return;

        input.interactAt({
          x: Math.max(
            0,
            Math.min(map.width - 1, Math.floor(interactionPoint.x)),
          ),
          y: Math.max(
            0,
            Math.min(map.height - 1, Math.floor(interactionPoint.z)),
          ),
          z: localPlayer.position.z,
        });
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        interactAtPointer(event);
      };
      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        interactAtPointer(event);
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("contextmenu", onContextMenu);
      cleanupInput = () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("contextmenu", onContextMenu);
      };

      // Instantiate actors already present in the first streamed region before
      // shader compilation, so their first material/skin/sprite programs are not
      // paid for during movement.
      const initialLocal = world.localPlayerId
        ? world.players.get(world.localPlayerId)
        : undefined;
      if (initialLocal) {
        activeActorManager.sync(
          world,
          initialLocal.position.z,
          0,
          performance.now(),
          camera,
          layers.creatures,
        );
      }

      // Compile every world + actor material family while loading is still up.
      nextRenderer.compile(scene, camera);

      const render = (now: number) => {
        if (disposed) return;
        animationFrame = window.requestAnimationFrame(render);

        const frameMs = Math.max(0, now - lastFrameAt);
        lastFrameAt = now;

        const map = world.map;
        const local = world.localPlayerId
          ? world.players.get(world.localPlayerId)
          : undefined;

        if (map && local) {
          const floor = local.position.z;
          const chunkX = Math.floor(
            local.position.x / NATIVE_RENDER_CHUNK_SIZE,
          );
          const chunkY = Math.floor(
            local.position.y / NATIVE_RENDER_CHUNK_SIZE,
          );
          const signature = [
            floor,
            chunkX,
            chunkY,
            world.streamRegionRevision,
            world.dynamicMapRevision,
          ].join(":");

          queueStaticSnapshot(
            map,
            floor,
            local.position.x,
            local.position.y,
            signature,
          );
          runStagedTasks();

          const actorDelta = Math.min(frameMs / 1000, 0.05);
          activeActorManager.sync(
            world,
            floor,
            actorDelta,
            now,
            camera,
            layers.creatures,
          );

          camera.position.set(
            local.position.x + 0.5,
            NATIVE_CAMERA_HEIGHT,
            local.position.y + 0.5 + NATIVE_CAMERA_OFFSET,
          );
          camera.lookAt(
            local.position.x + 0.5,
            0,
            local.position.y + 0.5,
          );

          textures.water.offset.set(
            now * 0.000032,
            now * 0.000019,
          );

          if (positionRef.current) {
            positionRef.current.textContent =
              `NATIVE V24 · x ${local.position.x} · y ${local.position.y} · z ${floor}`;
          }
        }

        nextRenderer.render(scene, camera);

        if (now >= warmupUntil) {
          sampleFrames += 1;
          sampleTotal += frameMs;
          sampleMax = Math.max(sampleMax, frameMs);

          if (frameMs >= 50 && local) {
            console.info(
              `NATIVE LONG FRAME ${frameMs.toFixed(1)}ms · pos `
              + `${local.position.x}:${local.position.y}:${local.position.z} · `
              + `calls ${nextRenderer.info.render.calls} · `
              + `tris ${nextRenderer.info.render.triangles} · `
              + `programs ${nextRenderer.info.programs?.length ?? 0} · `
              + `textures ${nextRenderer.info.memory.textures} · `
              + `geometries ${nextRenderer.info.memory.geometries}`,
            );
          }

          if (sampleFrames >= 180) {
            const average = sampleTotal / sampleFrames;
            const fps = average > 0 ? 1000 / average : 0;
            const message =
              `NATIVE performance sample: avg=${average.toFixed(1)}ms `
              + `max=${sampleMax.toFixed(1)}ms fps=${fps.toFixed(0)} `
              + `calls=${nextRenderer.info.render.calls} `
              + `triangles=${nextRenderer.info.render.triangles}`;

            console.info(message);
            if (performanceRef.current) {
              performanceRef.current.textContent =
                `${fps.toFixed(0)} FPS · avg ${average.toFixed(1)}ms · max ${sampleMax.toFixed(1)}ms`;
            }

            sampleFrames = 0;
            sampleTotal = 0;
            sampleMax = 0;
          }
        }
      };

      animationFrame = window.requestAnimationFrame((now) => {
        lastFrameAt = now;
        warmupUntil = now + 1_500;
        render(now);
      });
    };

    void bootstrap().catch((error) => {
      console.error("Native V24 renderer bootstrap failed", error);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      cleanupInput?.();

      actorManager?.dispose();
      actorManager = null;

      renderer?.setAnimationLoop(null);
      renderer?.dispose();

      for (const disposable of disposables) disposable.dispose();

      if (loadedCharacterAssets) {
        disposeCharacterTemplates(loadedCharacterAssets);
        loadedCharacterAssets = null;
      }
      if (loadedCreatureAssets) {
        disposeCreatureAssets(loadedCreatureAssets);
        loadedCreatureAssets = null;
      }
    };
  }, [input, world]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="three-world"
        data-native-world-renderer="v24"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {showDebug && (
        <div className="debug-meter" aria-label="Native renderer performance">
          <div ref={positionRef} className="position-meter">
            NATIVE V24 · x -- · y -- · z --
          </div>
          <div ref={performanceRef} className="fps-meter">
            Native renderer loading world + actors…
          </div>
        </div>
      )}
    </>
  );
});
