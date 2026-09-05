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
import { CLIENT_STEP_MS, type InputController } from "./InputController";
import { playerLightProfile } from "./PlayerLight";
import {
  HOUSE_DOOR_PLACEMENT,
  createHouseDoorwayLayout,
  createHouseWindowLayout,
} from "./DoorwayLayout";
import type { WorldState } from "./WorldState";

const NATIVE_RENDER_CHUNK_SIZE = 24;
const NATIVE_RENDER_RADIUS = 44;
const NATIVE_STAGE_BUDGET_MS = 2.5;
const NATIVE_CAMERA_HEIGHT = 18;
const NATIVE_CAMERA_OFFSET = 9;
const NATIVE_CAMERA_ZOOM = 90;

// TIBIAGAME_NATIVE_RENDERER_V23
// TIBIAGAME_NATIVE_RENDERER_V24
// TIBIAGAME_NATIVE_RENDERER_V24_1
// TIBIAGAME_NATIVE_RENDERER_V24_2
// TIBIAGAME_NATIVE_RENDERER_V25
// TIBIAGAME_NATIVE_RENDERER_V25_1
// TIBIAGAME_NATIVE_RENDERER_V26
// TIBIAGAME_NATIVE_RENDERER_V27
// TIBIAGAME_NATIVE_RENDERER_V28
// Native visual parity phase 4: shared-atlas damage text, spell-family VFX,
// resource-family art and imperative canvas hover feedback.

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

  houseWallModels: Transform[];
  looseHouseWalls: Transform[];
  castleWalls: Transform[];
  buildingFloors: Transform[];

  houseRoofsAlongZ: Transform[];
  houseRoofsAlongX: Transform[];
  keepRoofsAlongZ: Transform[];
  keepRoofsAlongX: Transform[];
  keepMerlons: Transform[];
  keepCornerTowers: Transform[];
  keepTowerCaps: Transform[];
  chimneys: Transform[];
  chimneyCaps: Transform[];
  signArms: Transform[];
  signPosts: Transform[];
  signBoards: Transform[];

  doorFacadeSides: Transform[];
  doorFacadeTops: Transform[];
  doorFramesVertical: Transform[];
  doorFramesHorizontal: Transform[];
  doorThresholds: Transform[];
  doorLeaves: Transform[];
  doorKnobs: Transform[];

  windowFacadeSides: Transform[];
  windowFacadeLower: Transform[];
  windowFacadeTops: Transform[];
  windowFramesHorizontal: Transform[];
  windowShuttersOpen: Transform[];
  windowShuttersClosed: Transform[];

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
  roofTiles: THREE.Texture;
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


const MEDIEVAL_VILLAGE_ASSET =
  "/assets/models/aldoria-medieval-village.glb";
const MEDIEVAL_SOURCE_HEIGHT = 3.1227;
const MEDIEVAL_SOURCE_WIDTH = 2;
const MEDIEVAL_SOURCE_DEPTH = 0.314;
const HOUSE_WALL_HEIGHT = 3.2;
const KEEP_WALL_HEIGHT = 4.1;
const HOUSE_WALL_THICKNESS = 0.18;
const HOUSE_WALL_LENGTH = 1.04;

type NativeGltfPart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
};

type NativeMedievalAssets = {
  scenes: readonly THREE.Group[];
  wallParts: readonly NativeGltfPart[];
  shutterOpenParts: readonly NativeGltfPart[];
  shutterClosedParts: readonly NativeGltfPart[];
};

class NativeGltfInstancedSet {
  readonly meshes: THREE.InstancedMesh[];
  private readonly parentMatrix = new THREE.Matrix4();
  private readonly combinedMatrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(
    parts: readonly NativeGltfPart[],
    capacity: number,
  ) {
    this.meshes = parts.map((part) => {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        capacity,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      return mesh;
    });
  }

  setTransforms(
    parts: readonly NativeGltfPart[],
    transforms: readonly Transform[],
  ) {
    const count = Math.min(
      transforms.length,
      this.meshes[0]?.instanceMatrix.count ?? 0,
    );

    for (let instanceIndex = 0; instanceIndex < count; instanceIndex += 1) {
      const [x, y, z, sx, sy, sz, rotationY = 0] =
        transforms[instanceIndex];

      this.translation.set(x, y, z);
      this.scale.set(sx, sy, sz);
      this.euler.set(0, rotationY, 0);
      this.rotation.setFromEuler(this.euler);
      this.parentMatrix.compose(
        this.translation,
        this.rotation,
        this.scale,
      );

      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        this.combinedMatrix
          .copy(this.parentMatrix)
          .multiply(parts[partIndex].localMatrix);
        this.combinedMatrix.toArray(
          this.meshes[partIndex].instanceMatrix.array as Float32Array,
          instanceIndex * 16,
        );
      }
    }

    for (const mesh of this.meshes) {
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count > 0) {
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

function normalizeGltfNodeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findNativeGltfNode(
  scenes: readonly THREE.Group[],
  nodeName: string,
) {
  // TIBIAGAME_NATIVE_RENDERER_V25_1
  // The medieval GLB contains authored nodes in more than one scene. The old
  // R3F loader searched gltf.scenes; V25 accidentally searched gltf.scene only.
  for (const scene of scenes) {
    const exact = scene.getObjectByName(nodeName);
    if (exact) return exact;
  }

  // Be tolerant of exporter punctuation/suffix changes without silently
  // accepting unrelated nodes.
  const wanted = normalizeGltfNodeName(nodeName);
  for (const scene of scenes) {
    let normalizedMatch: THREE.Object3D | null = null;
    scene.traverse((candidate) => {
      if (normalizedMatch) return;
      const normalized = normalizeGltfNodeName(candidate.name);
      if (
        normalized === wanted
        || normalized.startsWith(`${wanted}0`)
        || normalized.startsWith(`${wanted}00`)
      ) {
        normalizedMatch = candidate;
      }
    });
    if (normalizedMatch) return normalizedMatch;
  }

  return null;
}

function extractNativeGltfParts(
  scenes: readonly THREE.Group[],
  nodeName: string,
): readonly NativeGltfPart[] {
  const source = findNativeGltfNode(scenes, nodeName);
  if (!source) {
    const candidates: string[] = [];
    for (const scene of scenes) {
      scene.traverse((candidate) => {
        const normalized = normalizeGltfNodeName(candidate.name);
        if (
          normalized.includes("window")
          || normalized.includes("shutter")
          || normalized.includes("plaster")
        ) {
          candidates.push(candidate.name);
        }
      });
    }

    throw new Error(
      `Native V25.1: missing medieval node ${nodeName}. `
      + `Available related nodes: ${[...new Set(candidates)].slice(0, 40).join(", ")}`,
    );
  }

  // Update the root scene containing this source so matrixWorld is valid.
  const owningScene = scenes.find((scene) => {
    let found = false;
    scene.traverse((candidate) => {
      if (candidate === source) found = true;
    });
    return found;
  });
  owningScene?.updateWorldMatrix(true, true);
  source.updateWorldMatrix(true, true);

  const inverse = source.matrixWorld.clone().invert();
  const parts: NativeGltfPart[] = [];

  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    parts.push({
      geometry: child.geometry,
      material: child.material,
      localMatrix: inverse.clone().multiply(child.matrixWorld),
    });
  });

  if (!parts.length) {
    throw new Error(`Native V25.1: ${nodeName} contains no mesh parts`);
  }
  return parts;
}

async function loadNativeMedievalAssets(): Promise<NativeMedievalAssets> {
  const gltf = await new GLTFLoader().loadAsync(MEDIEVAL_VILLAGE_ASSET);
  const scenes = gltf.scenes.length > 0
    ? gltf.scenes
    : [gltf.scene];

  return {
    scenes,
    wallParts: extractNativeGltfParts(
      scenes,
      "Wall_Plaster_Straight",
    ),
    shutterOpenParts: extractNativeGltfParts(
      scenes,
      "WindowShutters_Wide_Flat_Open",
    ),
    shutterClosedParts: extractNativeGltfParts(
      scenes,
      "WindowShutters_Wide_Flat_Closed",
    ),
  };
}

function disposeNativeMedievalAssets(assets: NativeMedievalAssets) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const scene of assets.scenes) {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const entries = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of entries) {
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

function createUnitGabledRoofGeometry(ridgeAlongZ: boolean) {
  const halfWidth = 0.5;
  const halfDepth = 0.5;
  const rise = 1;

  const vertices = ridgeAlongZ
    ? [
        -halfWidth, 0, -halfDepth,
        -halfWidth, 0, halfDepth,
        0, rise, halfDepth,
        0, rise, -halfDepth,

        halfWidth, 0, halfDepth,
        halfWidth, 0, -halfDepth,
        0, rise, -halfDepth,
        0, rise, halfDepth,

        -halfWidth, 0, -halfDepth,
        0, rise, -halfDepth,
        halfWidth, 0, -halfDepth,

        -halfWidth, 0, halfDepth,
        halfWidth, 0, halfDepth,
        0, rise, halfDepth,
      ]
    : [
        -halfWidth, 0, -halfDepth,
        halfWidth, 0, -halfDepth,
        halfWidth, rise, 0,
        -halfWidth, rise, 0,

        halfWidth, 0, halfDepth,
        -halfWidth, 0, halfDepth,
        -halfWidth, rise, 0,
        halfWidth, rise, 0,

        -halfWidth, 0, -halfDepth,
        -halfWidth, rise, 0,
        -halfWidth, 0, halfDepth,

        halfWidth, 0, -halfDepth,
        halfWidth, 0, halfDepth,
        halfWidth, rise, 0,
      ];

  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10,
    11, 12, 13,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );

  const uvs: number[] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    uvs.push(vertices[index] + 0.5, vertices[index + 1]);
  }
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(uvs, 2),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wallModelTransform(
  x: number,
  z: number,
  rotationY: number,
): Transform {
  return [
    x,
    0,
    z,
    HOUSE_WALL_LENGTH / MEDIEVAL_SOURCE_WIDTH,
    HOUSE_WALL_HEIGHT / MEDIEVAL_SOURCE_HEIGHT,
    Math.max(
      0.28,
      HOUSE_WALL_THICKNESS / MEDIEVAL_SOURCE_DEPTH,
    ),
    rotationY,
  ];
}

function facadePoint(
  originX: number,
  originZ: number,
  rotationY: number,
  localX: number,
  localZ: number,
) {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return {
    x: originX + localX * cosine + localZ * sine,
    z: originZ - localX * sine + localZ * cosine,
  };
}

function facadeBox(
  originX: number,
  originZ: number,
  rotationY: number,
  localX: number,
  y: number,
  localZ: number,
  sx: number,
  sy: number,
  sz: number,
  localRotationY = 0,
): Transform {
  const point = facadePoint(
    originX,
    originZ,
    rotationY,
    localX,
    localZ,
  );
  return [
    point.x,
    y,
    point.z,
    sx,
    sy,
    sz,
    rotationY + localRotationY,
  ];
}

function openingBuilding(
  position: Position,
  buildings: readonly BuildingView[],
) {
  return buildings.find((building) => {
    if (building.floor !== position.z) return false;
    const maxX = building.x + building.width - 1;
    const maxY = building.y + building.height - 1;
    return position.x >= building.x
      && position.x <= maxX
      && position.y >= building.y
      && position.y <= maxY
      && (
        position.x === building.x
        || position.x === maxX
        || position.y === building.y
        || position.y === maxY
      );
  });
}

function wallOpeningTransform(
  position: Position,
  building: BuildingView,
) {
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;

  if (position.y === building.y) {
    return {
      x: position.x + 0.5,
      z: building.y,
      rotation: Math.PI,
    };
  }
  if (position.y === maxY - 1) {
    return {
      x: position.x + 0.5,
      z: maxY,
      rotation: 0,
    };
  }
  if (position.x === building.x) {
    return {
      x: building.x,
      z: position.y + 0.5,
      rotation: -Math.PI / 2,
    };
  }
  return {
    x: maxX,
    z: position.y + 0.5,
    rotation: Math.PI / 2,
  };
}

function buildingWallOwnsPosition(
  position: Position,
  buildings: readonly BuildingView[],
) {
  return Boolean(openingBuilding(position, buildings));
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
  openingKeys: ReadonlySet<string>,
  houseWallModels: Transform[],
  castleWalls: Transform[],
  floors: Transform[],
  houseRoofsAlongZ: Transform[],
  houseRoofsAlongX: Transform[],
  keepRoofsAlongZ: Transform[],
  keepRoofsAlongX: Transform[],
  chimneys: Transform[],
  chimneyCaps: Transform[],
  signArms: Transform[],
  signPosts: Transform[],
  signBoards: Transform[],
) {
  const wallHeight =
    building.kind === "keep" ? KEEP_WALL_HEIGHT : HOUSE_WALL_HEIGHT;
  const centerX = building.x + building.width / 2;
  const centerY = building.y + building.height / 2;
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;

  floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width - 0.18),
    0.09,
    Math.max(0.5, building.height - 0.18),
  ]);

  const addWall = (
    position: Position,
    x: number,
    z: number,
    horizontal: boolean,
  ) => {
    if (openingKeys.has(tileKey(position))) return;

    if (building.kind === "house") {
      houseWallModels.push(
        wallModelTransform(
          x,
          z,
          horizontal ? 0 : Math.PI / 2,
        ),
      );
    } else {
      castleWalls.push([
        x,
        wallHeight / 2,
        z,
        horizontal ? HOUSE_WALL_LENGTH : 0.28,
        wallHeight,
        horizontal ? 0.28 : HOUSE_WALL_LENGTH,
      ]);
    }
  };

  for (let x = building.x; x < maxX; x += 1) {
    addWall(
      { x, y: building.y, z: building.floor },
      x + 0.5,
      building.y,
      true,
    );
    addWall(
      { x, y: maxY - 1, z: building.floor },
      x + 0.5,
      maxY,
      true,
    );
  }

  for (let y = building.y; y < maxY; y += 1) {
    addWall(
      { x: building.x, y, z: building.floor },
      building.x,
      y + 0.5,
      false,
    );
    addWall(
      { x: maxX - 1, y, z: building.floor },
      maxX,
      y + 0.5,
      false,
    );
  }

  const roofWidth = building.width + 0.7;
  const roofDepth = building.height + 0.7;
  const roofRise = Math.min(
    1.65,
    0.72 + Math.min(roofWidth, roofDepth) * 0.14,
  );
  const roof: Transform = [
    centerX,
    wallHeight + 0.02,
    centerY,
    roofWidth,
    roofRise,
    roofDepth,
  ];

  const alongZ = roofDepth >= roofWidth;
  if (building.kind === "keep") {
    (alongZ ? keepRoofsAlongZ : keepRoofsAlongX).push(roof);
  } else {
    (alongZ ? houseRoofsAlongZ : houseRoofsAlongX).push(roof);
  }

  const chimneyX = centerX + building.width * 0.22;
  const chimneyZ = centerY - building.height * 0.18;
  chimneys.push([
    chimneyX,
    wallHeight + 0.86,
    chimneyZ,
    0.37,
    1.7,
    0.37,
  ]);
  chimneyCaps.push([
    chimneyX,
    wallHeight + 1.75,
    chimneyZ,
    0.48,
    0.14,
    0.48,
  ]);

  if (building.kind === "house") {
    const signX = building.x + building.width - 0.35;
    const signZ = building.y - 0.18;
    const signY = wallHeight * 0.72;

    signArms.push([
      signX,
      signY + 0.29,
      signZ,
      0.6325,
      0.06325,
      0.06325,
    ]);
    signPosts.push([
      signX + 0.23,
      signY - 0.0575,
      signZ,
      0.069,
      0.6325,
      0.069,
    ]);
    signBoards.push([
      signX + 0.23,
      signY - 0.391,
      signZ,
      0.598,
      0.391,
      0.0805,
    ]);
  }
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

    houseWallModels: [],
    looseHouseWalls: [],
    castleWalls: [],
    buildingFloors: [],

    houseRoofsAlongZ: [],
    houseRoofsAlongX: [],
    keepRoofsAlongZ: [],
    keepRoofsAlongX: [],
    keepMerlons: [],
    keepCornerTowers: [],
    keepTowerCaps: [],
    chimneys: [],
    chimneyCaps: [],
    signArms: [],
    signPosts: [],
    signBoards: [],

    doorFacadeSides: [],
    doorFacadeTops: [],
    doorFramesVertical: [],
    doorFramesHorizontal: [],
    doorThresholds: [],
    doorLeaves: [],
    doorKnobs: [],

    windowFacadeSides: [],
    windowFacadeLower: [],
    windowFacadeTops: [],
    windowFramesHorizontal: [],
    windowShuttersOpen: [],
    windowShuttersClosed: [],

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

  const openingKeys = new Set([
    ...map.doors.map((entry) => tileKey(entry.position)),
    ...map.windows.map((entry) => tileKey(entry.position)),
  ]);

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
    if (buildingWallOwnsPosition(position, map.buildings)) continue;
    snapshot.looseHouseWalls.push([
      position.x + 0.5,
      HOUSE_WALL_HEIGHT / 2,
      position.y + 0.5,
      0.24,
      HOUSE_WALL_HEIGHT,
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
      openingKeys,
      snapshot.houseWallModels,
      snapshot.castleWalls,
      snapshot.buildingFloors,
      snapshot.houseRoofsAlongZ,
      snapshot.houseRoofsAlongX,
      snapshot.keepRoofsAlongZ,
      snapshot.keepRoofsAlongX,
      snapshot.chimneys,
      snapshot.chimneyCaps,
      snapshot.signArms,
      snapshot.signPosts,
      snapshot.signBoards,
    );

    if (building.kind === "keep") {
      const maxX = building.x + building.width;
      const maxY = building.y + building.height;
      const merlonY = KEEP_WALL_HEIGHT + 0.32;

      for (let x = building.x; x < maxX; x += 1) {
        snapshot.keepMerlons.push([
          x + 0.5,
          merlonY,
          building.y,
          0.42,
          0.64,
          0.38,
        ]);
        snapshot.keepMerlons.push([
          x + 0.5,
          merlonY,
          maxY,
          0.42,
          0.64,
          0.38,
        ]);
      }

      for (let y = building.y; y < maxY; y += 1) {
        snapshot.keepMerlons.push([
          building.x,
          merlonY,
          y + 0.5,
          0.38,
          0.64,
          0.42,
        ]);
        snapshot.keepMerlons.push([
          maxX,
          merlonY,
          y + 0.5,
          0.38,
          0.64,
          0.42,
        ]);
      }

      const corners = [
        [building.x, building.y],
        [maxX, building.y],
        [building.x, maxY],
        [maxX, maxY],
      ] as const;

      for (const [towerX, towerZ] of corners) {
        snapshot.keepCornerTowers.push([
          towerX,
          KEEP_WALL_HEIGHT * 0.54,
          towerZ,
          1,
          1,
          1,
        ]);
        snapshot.keepTowerCaps.push([
          towerX,
          KEEP_WALL_HEIGHT + 1.02,
          towerZ,
          1,
          1,
          1,
        ]);
      }
    }
  }

  for (const door of map.doors) {
    if (!nativeInside(door.position, floor, centerX, centerY)) continue;
    const building = openingBuilding(door.position, map.buildings);
    if (!building || building.kind !== "house") continue;

    const transform = wallOpeningTransform(door.position, building);
    const layout = createHouseDoorwayLayout(
      HOUSE_WALL_HEIGHT,
      HOUSE_WALL_LENGTH,
    );
    const sideCenter =
      layout.openingWidth / 2 + layout.wallSideWidth / 2;
    const wallHeightAboveBase =
      HOUSE_WALL_HEIGHT - layout.plinthHeight;

    for (const direction of [-1, 1] as const) {
      snapshot.doorFacadeSides.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          direction * sideCenter,
          layout.plinthHeight + wallHeightAboveBase / 2,
          0,
          layout.wallSideWidth,
          wallHeightAboveBase,
          HOUSE_WALL_THICKNESS,
        ),
      );
      snapshot.doorFacadeSides.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          direction * sideCenter,
          layout.plinthHeight / 2,
          0,
          layout.wallSideWidth,
          layout.plinthHeight,
          HOUSE_WALL_THICKNESS + 0.08,
        ),
      );

      snapshot.doorFramesVertical.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          direction * (
            layout.openingWidth / 2
            + layout.frameThickness / 2
          ),
          layout.openingBottom + layout.openingHeight / 2,
          -layout.frameDepth / 2,
          layout.frameThickness,
          layout.openingHeight,
          layout.frameDepth,
        ),
      );
    }

    if (layout.wallTopHeight > 0) {
      snapshot.doorFacadeTops.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          0,
          layout.openingTop + layout.wallTopHeight / 2,
          0,
          layout.openingWidth,
          layout.wallTopHeight,
          HOUSE_WALL_THICKNESS,
        ),
      );
    }

    snapshot.doorFramesHorizontal.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        0,
        layout.openingTop + layout.frameThickness / 2,
        -layout.frameDepth / 2,
        layout.openingWidth + layout.frameThickness * 2,
        layout.frameThickness,
        layout.frameDepth,
      ),
    );
    snapshot.doorThresholds.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        0,
        layout.thresholdHeight / 2,
        0,
        layout.openingWidth,
        layout.thresholdHeight,
        HOUSE_WALL_THICKNESS + 0.13,
      ),
    );

    const openAngle = door.open
      ? HOUSE_DOOR_PLACEMENT.outwardOpenAngle
      : HOUSE_DOOR_PLACEMENT.closedAngle;
    const hingeX = -layout.leafWidth / 2;
    const hingeZ = -layout.leafDepth / 2;
    const halfLeafX = layout.leafWidth / 2;
    const leafLocalX =
      hingeX
      + halfLeafX * Math.cos(openAngle);
    const leafLocalZ =
      hingeZ
      - halfLeafX * Math.sin(openAngle);

    snapshot.doorLeaves.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        leafLocalX,
        layout.openingBottom + 0.04 + layout.leafHeight / 2,
        leafLocalZ,
        layout.leafWidth,
        layout.leafHeight,
        layout.leafDepth,
        openAngle,
      ),
    );

    const knobAlongLeaf = layout.leafWidth * 0.34;
    const knobLocalX =
      hingeX
      + knobAlongLeaf * Math.cos(openAngle);
    const knobLocalZ =
      hingeZ
      - knobAlongLeaf * Math.sin(openAngle)
      - 0.04;
    snapshot.doorKnobs.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        knobLocalX,
        layout.openingBottom + layout.leafHeight * 0.52,
        knobLocalZ,
        0.08,
        0.08,
        0.08,
      ),
    );
  }

  for (const window of map.windows) {
    if (!nativeInside(window.position, floor, centerX, centerY)) continue;
    const building = openingBuilding(window.position, map.buildings);
    if (!building || building.kind !== "house") continue;

    const transform = wallOpeningTransform(window.position, building);
    const layout = createHouseWindowLayout(
      HOUSE_WALL_HEIGHT,
      HOUSE_WALL_LENGTH,
    );
    const sideCenter =
      layout.openingWidth / 2 + layout.wallSideWidth / 2;
    const lowerHeight =
      layout.openingBottom - layout.plinthHeight;
    const sillY =
      layout.openingBottom - layout.frameThickness / 2;

    for (const direction of [-1, 1] as const) {
      snapshot.windowFacadeSides.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          direction * sideCenter,
          layout.plinthHeight
            + (HOUSE_WALL_HEIGHT - layout.plinthHeight) / 2,
          0,
          layout.wallSideWidth,
          HOUSE_WALL_HEIGHT - layout.plinthHeight,
          HOUSE_WALL_THICKNESS,
        ),
      );
    }

    if (lowerHeight > 0) {
      snapshot.windowFacadeLower.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          0,
          layout.plinthHeight + lowerHeight / 2,
          0,
          layout.openingWidth,
          lowerHeight,
          HOUSE_WALL_THICKNESS,
        ),
      );
    }
    if (layout.wallTopHeight > 0) {
      snapshot.windowFacadeTops.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          0,
          layout.openingTop + layout.wallTopHeight / 2,
          0,
          layout.openingWidth,
          layout.wallTopHeight,
          HOUSE_WALL_THICKNESS,
        ),
      );
    }

    snapshot.windowFramesHorizontal.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        0,
        sillY,
        -layout.frameDepth / 2,
        layout.openingWidth + layout.frameThickness * 2,
        layout.frameThickness,
        layout.frameDepth,
      ),
    );
    snapshot.windowFramesHorizontal.push(
      facadeBox(
        transform.x,
        transform.z,
        transform.rotation,
        0,
        layout.openingTop + layout.frameThickness / 2,
        -layout.frameDepth / 2,
        layout.openingWidth + layout.frameThickness * 2,
        layout.frameThickness,
        layout.frameDepth,
      ),
    );

    const shutterTransform: Transform = [
      transform.x,
      0,
      transform.z,
      HOUSE_WALL_LENGTH / MEDIEVAL_SOURCE_WIDTH,
      HOUSE_WALL_HEIGHT / MEDIEVAL_SOURCE_HEIGHT,
      Math.max(
        0.28,
        0.13 / MEDIEVAL_SOURCE_DEPTH,
      ),
      transform.rotation,
    ];

    if (window.open) {
      snapshot.windowShuttersOpen.push(shutterTransform);
    } else {
      snapshot.windowShuttersClosed.push(shutterTransform);
    }
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
    roofTiles,
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
    load("/assets/world/aldoria-roof-tiles-v1.png"),
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
    roofTiles,
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

function shortestAngleDelta(from: number, to: number) {
  return Math.atan2(
    Math.sin(to - from),
    Math.cos(to - from),
  );
}

function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number,
) {
  const difference = shortestAngleDelta(current, target);
  const factor = 1 - Math.exp(-lambda * delta);
  return current + difference * factor;
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
  private moveStartX = 0;
  private moveStartZ = 0;
  private moveStartedAt = 0;
  private moveDurationMs = CLIENT_STEP_MS;
  private facingAngle = 0;
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

  get visualPosition() {
    return this.root.position;
  }

  setTarget(position: Position, floor: number, now: number) {
    const nextX = position.x + 0.5;
    const nextZ = position.y + 0.5;
    const floorChanged = this.initialized && position.z !== this.targetFloor;

    if (!this.initialized || floorChanged) {
      // Floor changes/teleports must never interpolate through unrelated world
      // space. Snap once, then resume normal tile interpolation.
      this.root.position.set(nextX, 0.05, nextZ);
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = position.z;
      this.moveStartX = nextX;
      this.moveStartZ = nextZ;
      this.moveStartedAt = now;
      this.moveDurationMs = 0;
      this.initialized = true;
    } else if (nextX !== this.targetX || nextZ !== this.targetZ) {
      const logicalDx = nextX - this.targetX;
      const logicalDz = nextZ - this.targetZ;
      const logicalDistance = Math.hypot(logicalDx, logicalDz);

      if (logicalDistance > Math.SQRT2 + 0.05) {
        // Large authoritative corrections behave like teleports, not walks.
        this.root.position.set(nextX, 0.05, nextZ);
        this.moveStartX = nextX;
        this.moveStartZ = nextZ;
        this.moveDurationMs = 0;
      } else {
        this.moveStartX = this.root.position.x;
        this.moveStartZ = this.root.position.z;
        this.moveStartedAt = now;
        this.moveDurationMs = CLIENT_STEP_MS * Math.max(1, logicalDistance);
      }

      if (logicalDistance > 0.001) {
        this.facingAngle = Math.atan2(logicalDx, logicalDz);
      }
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = position.z;
    }

    this.root.visible = position.z === floor;
  }

  hide() {
    this.root.visible = false;
  }

  update(delta: number, now: number) {
    if (!this.root.visible || !this.initialized) return;

    const progress = this.moveDurationMs <= 0
      ? 1
      : THREE.MathUtils.clamp(
          (now - this.moveStartedAt) / this.moveDurationMs,
          0,
          1,
        );

    // Linear tile interpolation is intentional. Exponential damp restarts its
    // velocity on every 165 ms tile update and feels like repeated tiny lunges.
    this.root.position.x = THREE.MathUtils.lerp(
      this.moveStartX,
      this.targetX,
      progress,
    );
    this.root.position.z = THREE.MathUtils.lerp(
      this.moveStartZ,
      this.targetZ,
      progress,
    );
    // TIBIAGAME_NATIVE_RENDERER_V24_2
    // MathUtils.damp treats angles as ordinary numbers. Around -PI/+PI that
    // makes a tiny direction change look like an almost full rotation.
    this.root.rotation.y = dampAngle(
      this.root.rotation.y,
      this.facingAngle,
      22,
      delta,
    );

    const moving = progress < 1;
    const next = moving ? "walk" : "idle";

    if (next !== this.active) {
      if (this.active === "idle") this.idleAction.fadeOut(0.1);
      else this.walkAction.fadeOut(0.1);

      if (next === "idle") this.idleAction.reset().fadeIn(0.1).play();
      else this.walkAction.reset().fadeIn(0.1).play();
      this.active = next;
    }

    this.mixer.update(Math.min(delta, 0.05));

    if (Math.abs(this.root.rotation.y) > Math.PI * 4) {
      this.root.rotation.y = THREE.MathUtils.euclideanModulo(
        this.root.rotation.y + Math.PI,
        Math.PI * 2,
      ) - Math.PI;
    }
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
  private targetFloor = -999;
  private moveStartX = 0;
  private moveStartZ = 0;
  private moveStartedAt = 0;
  private moveDurationMs = CLIENT_STEP_MS;
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

  get visualPosition() {
    return this.root.position;
  }

  setTarget(
    creature: CreatureView,
    floor: number,
    now: number,
  ) {
    const nextX = creature.position.x + 0.5;
    const nextZ = creature.position.y + 0.5;
    const floorChanged =
      this.initialized && creature.position.z !== this.targetFloor;

    if (!this.initialized || floorChanged) {
      this.root.position.set(nextX, 0, nextZ);
      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = creature.position.z;
      this.moveStartX = nextX;
      this.moveStartZ = nextZ;
      this.moveStartedAt = now;
      this.moveDurationMs = 0;
      this.previousHealth = creature.health;
      this.previousState = creature.state;
      this.initialized = true;
    } else if (nextX !== this.targetX || nextZ !== this.targetZ) {
      const logicalDx = nextX - this.targetX;
      const logicalDz = nextZ - this.targetZ;
      const logicalDistance = Math.hypot(logicalDx, logicalDz);

      this.facing = cardinalDirectionFromDelta(
        logicalDx,
        logicalDz,
        this.facing,
      );

      if (logicalDistance > Math.SQRT2 + 0.05) {
        this.root.position.set(nextX, 0, nextZ);
        this.moveStartX = nextX;
        this.moveStartZ = nextZ;
        this.moveDurationMs = 0;
      } else {
        this.moveStartX = this.root.position.x;
        this.moveStartZ = this.root.position.z;
        this.moveStartedAt = now;
        this.moveDurationMs = CLIENT_STEP_MS * Math.max(1, logicalDistance);
      }

      this.targetX = nextX;
      this.targetZ = nextZ;
      this.targetFloor = creature.position.z;
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

    const progress = this.moveDurationMs <= 0
      ? 1
      : THREE.MathUtils.clamp(
          (now - this.moveStartedAt) / this.moveDurationMs,
          0,
          1,
        );
    this.root.position.x = THREE.MathUtils.lerp(
      this.moveStartX,
      this.targetX,
      progress,
    );
    this.root.position.z = THREE.MathUtils.lerp(
      this.moveStartZ,
      this.targetZ,
      progress,
    );

    const moving = progress < 1;

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

  playerVisualPosition(playerId: string | null) {
    if (!playerId) return null;
    return this.players.get(playerId)?.visualPosition ?? null;
  }

  entityVisualPosition(entityId: string | null) {
    if (!entityId) return null;
    return this.players.get(entityId)?.visualPosition
      ?? this.npcs.get(entityId)?.visualPosition
      ?? this.creatures.get(entityId)?.visualPosition
      ?? null;
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


const NATIVE_PLAYER_LIGHT_COUNT = 8;
const NATIVE_TORCH_LIGHT_COUNT = 10;
const NATIVE_COMBAT_EFFECT_LIFETIME_MS = 850;

type NativeDynamicLayers = {
  groundItems: NativeInstancedLayer;
  groundEquipment: NativeInstancedLayer;
  groundConsumables: NativeInstancedLayer;
  groundRunes: NativeInstancedLayer;
  groundCoins: NativeInstancedLayer;
  corpses: NativeInstancedLayer;
  lootRings: NativeInstancedLayer;
  resourceAvailable: NativeInstancedLayer;
  resourceDepleted: NativeInstancedLayer;
  resourceCopper: NativeInstancedLayer;
  resourceWood: NativeInstancedLayer;
  resourceHerb: NativeInstancedLayer;
  resourceWater: NativeInstancedLayer;
  combatIncoming: NativeInstancedLayer;
  combatOutgoing: NativeInstancedLayer;
  combatOther: NativeInstancedLayer;
  combatRings: NativeInstancedLayer;
  combatFire: NativeInstancedLayer;
  combatPoison: NativeInstancedLayer;
  combatIce: NativeInstancedLayer;
  combatArcane: NativeInstancedLayer;
  areaWarnings: NativeInstancedLayer;
};


type NativeGroundItemFamily =
  | "generic"
  | "equipment"
  | "consumable"
  | "rune"
  | "coin";

function nativeGroundItemFamily(
  definitionId: string,
  definition: {
    name: string;
    stackable: boolean;
    charges?: number;
    attack?: number;
    defense?: number;
    equipmentSlot?: string;
    combatEffect?: unknown;
    distanceWeapon?: unknown;
    foodEffect?: unknown;
    teachesRecipeId?: string;
  } | undefined,
): NativeGroundItemFamily {
  if (!definition) return "generic";

  const identity = `${definitionId} ${definition.name}`.toLowerCase();
  if (
    identity.includes("coin")
    || identity.includes("gold")
    || identity.includes("silver")
  ) {
    return "coin";
  }

  if (
    definition.combatEffect
    || definition.teachesRecipeId
    || definition.charges
    || identity.includes("rune")
    || identity.includes("sigil")
  ) {
    return "rune";
  }

  if (
    definition.foodEffect
    || identity.includes("potion")
    || identity.includes("flask")
    || identity.includes("vial")
  ) {
    return "consumable";
  }

  if (
    definition.equipmentSlot
    || definition.attack
    || definition.defense
    || definition.distanceWeapon
  ) {
    return "equipment";
  }

  return "generic";
}


const DAMAGE_ATLAS_GLYPHS = "-0123456789";
const DAMAGE_NUMBER_CAPACITY = 320;

function createDamageGlyphAtlas() {
  const cellWidth = 64;
  const cellHeight = 72;
  const canvas = document.createElement("canvas");
  canvas.width = DAMAGE_ATLAS_GLYPHS.length * cellWidth;
  canvas.height = cellHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Native V28: 2D canvas unavailable for damage atlas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '700 52px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.lineWidth = 8;
  context.lineJoin = "round";

  for (let index = 0; index < DAMAGE_ATLAS_GLYPHS.length; index += 1) {
    const x = index * cellWidth + cellWidth / 2;
    const y = cellHeight / 2 - 2;
    const glyph = DAMAGE_ATLAS_GLYPHS[index];

    context.strokeStyle = "rgba(12, 8, 7, 0.92)";
    context.strokeText(glyph, x, y);
    context.fillStyle = "#ffffff";
    context.fillText(glyph, x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

class NativeDamageNumberLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly atlas: THREE.CanvasTexture;
  private readonly glyphAttribute: THREE.InstancedBufferAttribute;
  private readonly tintAttribute: THREE.InstancedBufferAttribute;
  private readonly alphaAttribute: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.atlas = createDamageGlyphAtlas();
    this.geometry = new THREE.PlaneGeometry(0.34, 0.46);

    this.glyphAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(DAMAGE_NUMBER_CAPACITY),
      1,
    );
    this.tintAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(DAMAGE_NUMBER_CAPACITY * 3),
      3,
    );
    this.alphaAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(DAMAGE_NUMBER_CAPACITY),
      1,
    );

    this.geometry.setAttribute("instanceGlyph", this.glyphAttribute);
    this.geometry.setAttribute("instanceTint", this.tintAttribute);
    this.geometry.setAttribute("instanceAlpha", this.alphaAttribute);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        glyphAtlas: { value: this.atlas },
        glyphCount: { value: DAMAGE_ATLAS_GLYPHS.length },
      },
      vertexShader: `
        attribute float instanceGlyph;
        attribute vec3 instanceTint;
        attribute float instanceAlpha;

        uniform float glyphCount;

        varying vec2 vGlyphUv;
        varying vec3 vTint;
        varying float vAlpha;

        void main() {
          float cellWidth = 1.0 / glyphCount;
          vGlyphUv = vec2(
            (instanceGlyph + uv.x) * cellWidth,
            uv.y
          );
          vTint = instanceTint;
          vAlpha = instanceAlpha;

          vec4 localPosition = instanceMatrix * vec4(position, 1.0);
          gl_Position =
            projectionMatrix * modelViewMatrix * localPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D glyphAtlas;

        varying vec2 vGlyphUv;
        varying vec3 vTint;
        varying float vAlpha;

        void main() {
          vec4 glyph = texture2D(glyphAtlas, vGlyphUv);
          float alpha = glyph.a * vAlpha;
          if (alpha < 0.035) discard;
          gl_FragColor = vec4(glyph.rgb * vTint, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      DAMAGE_NUMBER_CAPACITY,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  setEffects(
    world: WorldState,
    floor: number,
    now: number,
    camera: THREE.Camera,
  ) {
    let instance = 0;
    const glyphArray = this.glyphAttribute.array as Float32Array;
    const tintArray = this.tintAttribute.array as Float32Array;
    const alphaArray = this.alphaAttribute.array as Float32Array;

    this.rotation.copy(camera.quaternion);

    for (const effect of world.combatEffects) {
      if (effect.position.z !== floor) continue;
      const age = now - effect.createdAt;
      if (age < 0 || age >= NATIVE_COMBAT_EFFECT_LIFETIME_MS) continue;

      const progress = THREE.MathUtils.clamp(
        age / NATIVE_COMBAT_EFFECT_LIFETIME_MS,
        0,
        1,
      );
      const alpha = 1 - THREE.MathUtils.smoothstep(progress, 0.52, 1);
      const text = `-${effect.damage}`;
      const totalWidth = text.length * 0.235;

      const tint = effect.targetId === world.localPlayerId
        ? [1, 0.305, 0.274]
        : effect.sourceId === world.localPlayerId
          ? [1, 0.824, 0.408]
          : [0.945, 0.542, 0.337];

      for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
        if (instance >= DAMAGE_NUMBER_CAPACITY) break;
        const glyphIndex = DAMAGE_ATLAS_GLYPHS.indexOf(text[charIndex]);
        if (glyphIndex < 0) continue;

        const horizontal =
          charIndex * 0.235 - totalWidth / 2 + 0.1175;
        this.translation.set(
          effect.position.x + 0.5 + horizontal,
          1.08 + progress * 1.18,
          effect.position.y + 0.5,
        );
        const pulse = 0.88 + Math.sin(progress * Math.PI) * 0.18;
        this.scale.setScalar(pulse);
        this.matrix.compose(
          this.translation,
          this.rotation,
          this.scale,
        );
        this.matrix.toArray(
          this.mesh.instanceMatrix.array as Float32Array,
          instance * 16,
        );

        glyphArray[instance] = glyphIndex;
        tintArray[instance * 3] = tint[0];
        tintArray[instance * 3 + 1] = tint[1];
        tintArray[instance * 3 + 2] = tint[2];
        alphaArray[instance] = alpha;
        instance += 1;
      }
    }

    this.mesh.count = instance;
    if (instance > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.glyphAttribute.needsUpdate = true;
      this.tintAttribute.needsUpdate = true;
      this.alphaAttribute.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}

type NativeSpellEffectFamily =
  | "fire"
  | "poison"
  | "ice"
  | "arcane"
  | null;

function nativeSpellEffectFamily(effectId: string): NativeSpellEffectFamily {
  const id = effectId.toLowerCase();

  if (
    id.includes("fire")
    || id.includes("flame")
    || id.includes("burn")
  ) {
    return "fire";
  }
  if (
    id.includes("poison")
    || id.includes("venom")
    || id.includes("toxic")
  ) {
    return "poison";
  }
  if (
    id.includes("ice")
    || id.includes("frost")
    || id.includes("cold")
  ) {
    return "ice";
  }
  if (
    id !== "melee_hit"
    && (
      id.includes("spell")
      || id.includes("magic")
      || id.includes("arcane")
      || id.includes("rune")
      || id.includes("sigil")
    )
  ) {
    return "arcane";
  }

  return null;
}

type NativeResourceFamily =
  | "ore"
  | "wood"
  | "herb"
  | "water"
  | "generic";

function nativeResourceFamily(kind: string): NativeResourceFamily {
  const id = kind.toLowerCase();

  if (
    id.includes("ore")
    || id.includes("vein")
    || id.includes("stone")
    || id.includes("rock")
  ) {
    return "ore";
  }
  if (
    id.includes("wood")
    || id.includes("tree")
    || id.includes("log")
  ) {
    return "wood";
  }
  if (
    id.includes("herb")
    || id.includes("plant")
    || id.includes("flower")
  ) {
    return "herb";
  }
  if (
    id.includes("fish")
    || id.includes("water")
    || id.includes("pond")
  ) {
    return "water";
  }

  return "generic";
}

class NativeDynamicSceneManager {
  private readonly attackRing: THREE.Mesh;
  private readonly selectionRing: THREE.Mesh;
  private readonly attackArrow: THREE.Mesh;
  private readonly hoverRing: THREE.Mesh;
  private readonly markerGeometry: THREE.RingGeometry;
  private readonly selectedGeometry: THREE.RingGeometry;
  private readonly hoverGeometry: THREE.RingGeometry;
  private readonly arrowGeometry: THREE.ConeGeometry;
  private readonly damageNumbers: NativeDamageNumberLayer;
  private readonly attackMaterial: THREE.MeshBasicMaterial;
  private readonly selectionMaterial: THREE.MeshBasicMaterial;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;

  private readonly playerLights: THREE.PointLight[] = [];
  private readonly torchLights: THREE.PointLight[] = [];
  private lastDynamicSignature = "";
  private lastTorchSignature = "";

  constructor(
    private readonly scene: THREE.Scene,
    private readonly layers: NativeDynamicLayers,
    private readonly camera: THREE.Camera,
    dynamicLightsEnabled: boolean,
  ) {
    this.markerGeometry = new THREE.RingGeometry(0.46, 0.55, 32);
    this.markerGeometry.rotateX(-Math.PI / 2);
    this.selectedGeometry = new THREE.RingGeometry(0.5, 0.58, 32);
    this.selectedGeometry.rotateX(-Math.PI / 2);
    this.hoverGeometry = new THREE.RingGeometry(0.45, 0.54, 32);
    this.hoverGeometry.rotateX(-Math.PI / 2);
    this.arrowGeometry = new THREE.ConeGeometry(0.18, 0.38, 4);

    this.attackMaterial = new THREE.MeshBasicMaterial({
      color: "#ff5148",
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: true,
    });
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: "#70b8ff",
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: true,
    });
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: "#f0bc55",
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      depthTest: true,
    });
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      color: "#ff5148",
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.attackRing = new THREE.Mesh(
      this.markerGeometry,
      this.attackMaterial,
    );
    this.attackRing.visible = false;
    this.attackRing.renderOrder = 18;
    this.attackRing.position.y = 0.035;

    this.selectionRing = new THREE.Mesh(
      this.selectedGeometry,
      this.selectionMaterial,
    );
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 17;
    this.selectionRing.position.y = 0.03;

    this.hoverRing = new THREE.Mesh(
      this.hoverGeometry,
      this.hoverMaterial,
    );
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 20;
    this.hoverRing.position.y = 0.04;

    this.attackArrow = new THREE.Mesh(
      this.arrowGeometry,
      this.arrowMaterial,
    );
    this.attackArrow.visible = false;
    this.attackArrow.renderOrder = 19;
    this.attackArrow.rotation.z = Math.PI;

    scene.add(
      this.attackRing,
      this.selectionRing,
      this.hoverRing,
      this.attackArrow,
    );

    this.damageNumbers = new NativeDamageNumberLayer(scene);

    // Keep light count fixed for the complete runtime. Changing the number of
    // active Three.js lights changes shader program shape, which is exactly the
    // kind of first-use stall the native renderer is designed to avoid.
    if (dynamicLightsEnabled) {
      for (let index = 0; index < NATIVE_PLAYER_LIGHT_COUNT; index += 1) {
        const light = new THREE.PointLight(
          "#ffd49a",
          0,
          34,
          2,
        );
        light.castShadow = false;
        this.playerLights.push(light);
        scene.add(light);
      }

      for (let index = 0; index < NATIVE_TORCH_LIGHT_COUNT; index += 1) {
        const light = new THREE.PointLight(
          "#ff6a24",
          0,
          6.1,
          2,
        );
        light.castShadow = false;
        this.torchLights.push(light);
        scene.add(light);
      }
    }
  }

  setHover(
    position: Position | null,
    kind: "loot" | "resource" | "npc" | null,
  ) {
    if (!position || !kind) {
      this.hoverRing.visible = false;
      return;
    }

    this.hoverRing.visible = true;
    this.hoverRing.position.set(
      position.x + 0.5,
      0.04,
      position.y + 0.5,
    );
    this.hoverMaterial.color.set(
      kind === "loot"
        ? "#f0bc55"
        : kind === "resource"
          ? "#75d887"
          : "#b793e8",
    );
  }

  private logicalEntityPosition(
    world: WorldState,
    entityId: string | null,
  ) {
    if (!entityId) return null;
    return world.players.get(entityId)?.position
      ?? world.creatures.get(entityId)?.position
      ?? world.npcs.get(entityId)?.position
      ?? null;
  }

  private updateGroundAndResources(
    world: WorldState,
    floor: number,
    local: Position,
  ) {
    const signature = [
      world.revision,
      world.streamRegionRevision,
      floor,
    ].join(":");
    if (signature === this.lastDynamicSignature) return;
    this.lastDynamicSignature = signature;

    const items: Transform[] = [];
    const equipment: Transform[] = [];
    const consumables: Transform[] = [];
    const runes: Transform[] = [];
    const coins: Transform[] = [];
    const corpses: Transform[] = [];
    const lootRings: Transform[] = [];

    for (const entry of world.groundItems) {
      if (!nativeInside(entry.position, floor, local.x, local.y)) continue;

      const x = entry.position.x + 0.5;
      const z = entry.position.y + 0.5;
      const corpse = entry.contents.length > 0;
      const pickupable = Boolean(
        world.itemDefinitions.get(entry.item.definitionId)?.pickupable,
      );

      if (corpse) {
        corpses.push([x, 0.12, z, 1, 1, 1]);
      } else {
        const definition = world.itemDefinitions.get(
          entry.item.definitionId,
        );
        const family = nativeGroundItemFamily(
          entry.item.definitionId,
          definition,
        );
        const rotation =
          (entry.position.x * 0.77 + entry.position.y * 0.37) % Math.PI;

        switch (family) {
          case "equipment":
            equipment.push([
              x,
              0.22,
              z,
              0.72,
              0.12,
              0.22,
              rotation,
            ]);
            break;
          case "consumable":
            consumables.push([
              x,
              0.22,
              z,
              1,
              1,
              1,
            ]);
            break;
          case "rune":
            runes.push([
              x,
              0.14,
              z,
              1,
              1,
              1,
              rotation,
            ]);
            break;
          case "coin":
            coins.push([
              x,
              0.105,
              z,
              1,
              1,
              1,
              rotation,
            ]);
            break;
          default:
            items.push([x, 0.24, z, 1, 1, 1]);
            break;
        }
      }

      if (corpse || pickupable) {
        lootRings.push([x, 0.035, z, 1, 1, 1]);
      }
    }

    const availableResources: Transform[] = [];
    const depletedResources: Transform[] = [];
    const copper: Transform[] = [];
    const wood: Transform[] = [];
    const herbs: Transform[] = [];
    const waterResources: Transform[] = [];

    for (const node of world.resourceNodes.values()) {
      if (!nativeInside(node.position, floor, local.x, local.y)) continue;

      const x = node.position.x + 0.5;
      const z = node.position.y + 0.5;
      const transform: Transform = [
        x,
        0.34,
        z,
        1,
        1,
        1,
        (node.position.x * 0.73 + node.position.y * 0.31) % Math.PI,
      ];

      if (node.available) {
        switch (nativeResourceFamily(node.kind)) {
          case "ore":
            availableResources.push(transform);
            if (node.kind === "copper_vein") {
              copper.push([
                x + 0.08,
                0.48,
                z - 0.05,
                1,
                1,
                1,
              ]);
            }
            break;
          case "wood":
            wood.push([
              x,
              0.38,
              z,
              1,
              1,
              1,
              transform[6],
            ]);
            break;
          case "herb":
            herbs.push([
              x,
              0.29,
              z,
              1,
              1,
              1,
              transform[6],
            ]);
            break;
          case "water":
            waterResources.push([
              x,
              0.055,
              z,
              1,
              1,
              1,
            ]);
            break;
          default:
            availableResources.push(transform);
            break;
        }
      } else {
        depletedResources.push(transform);
      }
    }

    this.layers.groundItems.setTransforms(items);
    this.layers.groundEquipment.setTransforms(equipment);
    this.layers.groundConsumables.setTransforms(consumables);
    this.layers.groundRunes.setTransforms(runes);
    this.layers.groundCoins.setTransforms(coins);
    this.layers.corpses.setTransforms(corpses);
    this.layers.lootRings.setTransforms(lootRings);
    this.layers.resourceAvailable.setTransforms(availableResources);
    this.layers.resourceDepleted.setTransforms(depletedResources);
    this.layers.resourceCopper.setTransforms(copper);
    this.layers.resourceWood.setTransforms(wood);
    this.layers.resourceHerb.setTransforms(herbs);
    this.layers.resourceWater.setTransforms(waterResources);
  }

  private updateEffects(
    world: WorldState,
    floor: number,
    now: number,
  ) {
    const incoming: Transform[] = [];
    const outgoing: Transform[] = [];
    const other: Transform[] = [];
    const rings: Transform[] = [];
    const fire: Transform[] = [];
    const poison: Transform[] = [];
    const ice: Transform[] = [];
    const arcane: Transform[] = [];

    for (const effect of world.combatEffects) {
      if (effect.position.z !== floor) continue;
      const age = now - effect.createdAt;
      if (age < 0 || age >= NATIVE_COMBAT_EFFECT_LIFETIME_MS) continue;

      const progress = THREE.MathUtils.clamp(
        age / NATIVE_COMBAT_EFFECT_LIFETIME_MS,
        0,
        1,
      );
      const scale = 0.25 + progress * 1.1;
      const transform: Transform = [
        effect.position.x + 0.5,
        0.35 + progress * 1.25,
        effect.position.y + 0.5,
        scale,
        scale,
        scale,
      ];

      if (effect.targetId === world.localPlayerId) {
        incoming.push(transform);
      } else if (effect.sourceId === world.localPlayerId) {
        outgoing.push(transform);
      } else {
        other.push(transform);
      }

      const ringScale = 0.55 + progress * 0.85;
      rings.push([
        effect.position.x + 0.5,
        0.045,
        effect.position.y + 0.5,
        ringScale,
        1,
        ringScale,
      ]);

      const family = nativeSpellEffectFamily(effect.effectId);
      if (family) {
        const spellScale =
          0.34 + Math.sin(progress * Math.PI) * 0.82;
        const spellTransform: Transform = [
          effect.position.x + 0.5,
          0.46 + progress * 0.58,
          effect.position.y + 0.5,
          spellScale,
          spellScale,
          spellScale,
          progress * Math.PI * 2,
        ];

        switch (family) {
          case "fire":
            fire.push(spellTransform);
            break;
          case "poison":
            poison.push(spellTransform);
            break;
          case "ice":
            ice.push(spellTransform);
            break;
          case "arcane":
            arcane.push(spellTransform);
            break;
        }
      }
    }

    const warnings: Transform[] = [];
    for (const warning of world.areaWarnings) {
      if (warning.position.z !== floor) continue;
      const age = now - warning.createdAt;
      if (age < 0 || age >= warning.durationMs) continue;

      const pulse =
        1 + Math.sin((age / Math.max(1, warning.durationMs)) * Math.PI * 8)
          * 0.035;
      const radius = Math.max(0.5, warning.radius) * pulse;
      warnings.push([
        warning.position.x + 0.5,
        0.05,
        warning.position.y + 0.5,
        radius,
        1,
        radius,
      ]);
    }

    this.layers.combatIncoming.setTransforms(incoming);
    this.layers.combatOutgoing.setTransforms(outgoing);
    this.layers.combatOther.setTransforms(other);
    this.layers.combatRings.setTransforms(rings);
    this.layers.combatFire.setTransforms(fire);
    this.layers.combatPoison.setTransforms(poison);
    this.layers.combatIce.setTransforms(ice);
    this.layers.combatArcane.setTransforms(arcane);
    this.layers.areaWarnings.setTransforms(warnings);

    this.damageNumbers.setEffects(
      world,
      floor,
      now,
      this.camera,
    );
  }

  private updateMarkers(
    world: WorldState,
    floor: number,
    actorManager: NativeActorManager,
    now: number,
  ) {
    const attackId = world.attackTargetId;
    const attackLogical = this.logicalEntityPosition(world, attackId);
    const attackVisual = actorManager.entityVisualPosition(attackId);

    if (attackLogical?.z === floor) {
      const x = attackVisual?.x ?? attackLogical.x + 0.5;
      const z = attackVisual?.z ?? attackLogical.y + 0.5;
      const pulse = 1 + Math.sin(now * 0.008) * 0.055;

      this.attackRing.visible = true;
      this.attackRing.position.set(x, 0.035, z);
      this.attackRing.scale.set(pulse, 1, pulse);

      this.attackArrow.visible = true;
      this.attackArrow.position.set(x, 2.2, z);
      this.attackArrow.rotation.y = now * 0.0012;
    } else {
      this.attackRing.visible = false;
      this.attackArrow.visible = false;
    }

    const selectedId = world.selectedPlayerId;
    const selectedLogical = this.logicalEntityPosition(world, selectedId);
    const selectedVisual = actorManager.entityVisualPosition(selectedId);

    if (
      selectedId
      && selectedId !== attackId
      && selectedLogical?.z === floor
    ) {
      const x = selectedVisual?.x ?? selectedLogical.x + 0.5;
      const z = selectedVisual?.z ?? selectedLogical.y + 0.5;
      this.selectionRing.visible = true;
      this.selectionRing.position.set(x, 0.03, z);
    } else {
      this.selectionRing.visible = false;
    }
  }

  private updateLights(
    world: WorldState,
    map: MapView,
    floor: number,
    local: Position,
    visualLocal: THREE.Vector3 | null,
    now: number,
  ) {
    if (!this.playerLights.length && !this.torchLights.length) return;

    const profile = playerLightProfile(
      world.inventory,
      world.itemDefinitions,
    );
    const centerX = visualLocal?.x ?? local.x + 0.5;
    const centerZ = visualLocal?.z ?? local.y + 0.5;
    const ringRadius = 1.15;
    const playerIntensity =
      profile.intensity * 1.5 / NATIVE_PLAYER_LIGHT_COUNT;

    for (let index = 0; index < this.playerLights.length; index += 1) {
      const angle =
        index / NATIVE_PLAYER_LIGHT_COUNT * Math.PI * 2;
      const light = this.playerLights[index];
      light.position.set(
        centerX + Math.cos(angle) * ringRadius,
        0.55,
        centerZ + Math.sin(angle) * ringRadius,
      );
      light.intensity = playerIntensity;
      light.distance = profile.radius;
    }

    const torchSignature = [
      floor,
      local.x,
      local.y,
      world.streamRegionRevision,
      world.dynamicMapRevision,
    ].join(":");

    if (torchSignature !== this.lastTorchSignature) {
      this.lastTorchSignature = torchSignature;
      const nearest = map.torches
        .filter((torch) => torch.z === floor)
        .map((torch) => ({
          torch,
          distance:
            (torch.x - local.x) ** 2
            + (torch.y - local.y) ** 2,
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, NATIVE_TORCH_LIGHT_COUNT);

      for (let index = 0; index < this.torchLights.length; index += 1) {
        const light = this.torchLights[index];
        const entry = nearest[index];
        if (!entry) {
          light.userData.active = false;
          light.intensity = 0;
          continue;
        }

        light.userData.active = true;
        light.position.set(
          entry.torch.x + 0.5,
          1.55,
          entry.torch.y + 0.5,
        );
        light.distance = 6.1;
      }
    }

    for (let index = 0; index < this.torchLights.length; index += 1) {
      const light = this.torchLights[index];
      if (!light.userData.active) continue;
      // Intensity-only flicker does not change shader shape or allocate objects.
      light.intensity =
        5.25 + Math.sin(now * 0.0075 + index * 1.91) * 0.28;
    }
  }

  update(
    world: WorldState,
    map: MapView,
    floor: number,
    local: Position,
    visualLocal: THREE.Vector3 | null,
    actorManager: NativeActorManager,
    now: number,
  ) {
    this.updateGroundAndResources(world, floor, local);
    this.updateEffects(world, floor, now);
    this.updateMarkers(world, floor, actorManager, now);
    this.updateLights(
      world,
      map,
      floor,
      local,
      visualLocal,
      now,
    );
  }

  dispose() {
    this.scene.remove(
      this.attackRing,
      this.selectionRing,
      this.hoverRing,
      this.attackArrow,
    );
    this.damageNumbers.dispose(this.scene);

    for (const light of this.playerLights) {
      this.scene.remove(light);
    }
    for (const light of this.torchLights) {
      this.scene.remove(light);
    }

    this.markerGeometry.dispose();
    this.selectedGeometry.dispose();
    this.hoverGeometry.dispose();
    this.arrowGeometry.dispose();
    this.attackMaterial.dispose();
    this.selectionMaterial.dispose();
    this.hoverMaterial.dispose();
    this.arrowMaterial.dispose();
  }
}


const NATIVE_DOOR_ANIMATION_MS = 190;
const NATIVE_SHUTTER_ANIMATION_MS = 170;

type NativeOpeningProgress = {
  value: number;
  target: number;
  updatedAt: number;
  seenAt: number;
};

function advanceOpeningProgress(
  state: NativeOpeningProgress,
  target: number,
  now: number,
  durationMs: number,
) {
  const elapsed = Math.max(0, now - state.updatedAt);
  state.updatedAt = now;
  state.target = target;
  state.seenAt = now;

  const step = elapsed / Math.max(1, durationMs);
  if (state.value < target) {
    state.value = Math.min(target, state.value + step);
  } else if (state.value > target) {
    state.value = Math.max(target, state.value - step);
  }

  return THREE.MathUtils.smoothstep(state.value, 0, 1);
}

class NativeOpeningAnimationManager {
  private readonly doors = new Map<string, NativeOpeningProgress>();
  private readonly windows = new Map<string, NativeOpeningProgress>();

  constructor(
    private readonly doorLeaves: NativeInstancedLayer,
    private readonly doorKnobs: NativeInstancedLayer,
    private readonly shutterOpen: NativeGltfInstancedSet,
    private readonly shutterClosed: NativeGltfInstancedSet,
    private readonly shutterOpenParts: readonly NativeGltfPart[],
    private readonly shutterClosedParts: readonly NativeGltfPart[],
  ) {}

  update(
    map: MapView,
    floor: number,
    center: Position,
    now: number,
  ) {
    const doorLeaves: Transform[] = [];
    const doorKnobs: Transform[] = [];

    for (const door of map.doors) {
      if (!nativeInside(door.position, floor, center.x, center.y)) continue;
      const building = openingBuilding(door.position, map.buildings);
      if (!building || building.kind !== "house") continue;

      const target = door.open ? 1 : 0;
      let state = this.doors.get(door.id);
      if (!state) {
        state = {
          value: target,
          target,
          updatedAt: now,
          seenAt: now,
        };
        this.doors.set(door.id, state);
      }

      const progress = advanceOpeningProgress(
        state,
        target,
        now,
        NATIVE_DOOR_ANIMATION_MS,
      );
      const transform = wallOpeningTransform(door.position, building);
      const layout = createHouseDoorwayLayout(
        HOUSE_WALL_HEIGHT,
        HOUSE_WALL_LENGTH,
      );
      const angle = THREE.MathUtils.lerp(
        HOUSE_DOOR_PLACEMENT.closedAngle,
        HOUSE_DOOR_PLACEMENT.outwardOpenAngle,
        progress,
      );

      const hingeX = -layout.leafWidth / 2;
      const hingeZ = -layout.leafDepth / 2;
      const halfLeafX = layout.leafWidth / 2;
      const leafLocalX =
        hingeX + halfLeafX * Math.cos(angle);
      const leafLocalZ =
        hingeZ - halfLeafX * Math.sin(angle);

      doorLeaves.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          leafLocalX,
          layout.openingBottom + 0.04 + layout.leafHeight / 2,
          leafLocalZ,
          layout.leafWidth,
          layout.leafHeight,
          layout.leafDepth,
          angle,
        ),
      );

      const knobAlongLeaf = layout.leafWidth * 0.34;
      const knobLocalX =
        hingeX + knobAlongLeaf * Math.cos(angle);
      const knobLocalZ =
        hingeZ - knobAlongLeaf * Math.sin(angle) - 0.04;
      doorKnobs.push(
        facadeBox(
          transform.x,
          transform.z,
          transform.rotation,
          knobLocalX,
          layout.openingBottom + layout.leafHeight * 0.52,
          knobLocalZ,
          0.08,
          0.08,
          0.08,
        ),
      );
    }

    this.doorLeaves.setTransforms(doorLeaves);
    this.doorKnobs.setTransforms(doorKnobs);

    const openTransforms: Transform[] = [];
    const closedTransforms: Transform[] = [];

    for (const window of map.windows) {
      if (!nativeInside(window.position, floor, center.x, center.y)) continue;
      const building = openingBuilding(window.position, map.buildings);
      if (!building || building.kind !== "house") continue;

      const target = window.open ? 1 : 0;
      let state = this.windows.get(window.id);
      if (!state) {
        state = {
          value: target,
          target,
          updatedAt: now,
          seenAt: now,
        };
        this.windows.set(window.id, state);
      }

      const progress = advanceOpeningProgress(
        state,
        target,
        now,
        NATIVE_SHUTTER_ANIMATION_MS,
      );
      const transform = wallOpeningTransform(window.position, building);

      const baseScaleX =
        HOUSE_WALL_LENGTH / MEDIEVAL_SOURCE_WIDTH;
      const baseScaleY =
        HOUSE_WALL_HEIGHT / MEDIEVAL_SOURCE_HEIGHT;
      const baseScaleZ = Math.max(
        0.28,
        0.13 / MEDIEVAL_SOURCE_DEPTH,
      );

      // The GLB contains authored open/closed shutter poses rather than a
      // hinge rig. Fold the old pose down on X while folding the new pose up.
      // This keeps the authored silhouettes and removes the single-frame snap.
      const closedFold = 1 - progress;
      const openFold = progress;

      if (closedFold > 0.015) {
        closedTransforms.push([
          transform.x,
          0,
          transform.z,
          baseScaleX * closedFold,
          baseScaleY,
          baseScaleZ,
          transform.rotation,
        ]);
      }
      if (openFold > 0.015) {
        openTransforms.push([
          transform.x,
          0,
          transform.z,
          baseScaleX * openFold,
          baseScaleY,
          baseScaleZ,
          transform.rotation,
        ]);
      }
    }

    this.shutterOpen.setTransforms(
      this.shutterOpenParts,
      openTransforms,
    );
    this.shutterClosed.setTransforms(
      this.shutterClosedParts,
      closedTransforms,
    );

    const pruneBefore = now - 3_000;
    for (const [id, state] of this.doors) {
      if (state.seenAt < pruneBefore) this.doors.delete(id);
    }
    for (const [id, state] of this.windows) {
      if (state.seenAt < pruneBefore) this.windows.delete(id);
    }
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
  const hoverRef = useRef<HTMLDivElement>(null);
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
    let dynamicSceneManager: NativeDynamicSceneManager | null = null;
    let openingAnimationManager: NativeOpeningAnimationManager | null = null;
    let loadedCharacterAssets: NativeCharacterAssets | null = null;
    let loadedCreatureAssets: NativeCreatureAssets | null = null;
    let loadedMedievalAssets: NativeMedievalAssets | null = null;
    const disposables: Array<{ dispose(): void }> = [];

    console.info(
      "NATIVE WORLD V28 active · damage atlas · richer VFX/hover",
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
      const medievalAssets = await loadNativeMedievalAssets();
      loadedCharacterAssets = characterAssets;
      loadedCreatureAssets = castleRatAssets;
      loadedMedievalAssets = medievalAssets;

      if (disposed) {
        for (const texture of Object.values(textures)) texture.dispose();
        disposeCharacterTemplates(characterAssets);
        disposeCreatureAssets(castleRatAssets);
        disposeNativeMedievalAssets(medievalAssets);
        loadedCharacterAssets = null;
        loadedCreatureAssets = null;
        loadedMedievalAssets = null;
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
      const roofAlongZGeometry = createUnitGabledRoofGeometry(true);
      const roofAlongXGeometry = createUnitGabledRoofGeometry(false);
      const doorKnobGeometry = new THREE.SphereGeometry(0.5, 10, 8);

      const groundItemGeometry = new THREE.OctahedronGeometry(0.18, 0);
      const corpseGeometry = new THREE.CylinderGeometry(
        0.34,
        0.34,
        0.05,
        14,
      );
      const lootRingGeometry = new THREE.RingGeometry(0.39, 0.47, 28);
      lootRingGeometry.rotateX(-Math.PI / 2);

      const resourceRockGeometry = new THREE.DodecahedronGeometry(0.38, 0);
      const resourceCopperGeometry = new THREE.OctahedronGeometry(0.2, 0);

      const combatBurstGeometry = new THREE.IcosahedronGeometry(0.25, 1);
      const combatRingGeometry = new THREE.RingGeometry(0.16, 0.23, 24);
      combatRingGeometry.rotateX(-Math.PI / 2);
      const areaWarningGeometry = new THREE.RingGeometry(0.86, 1, 48);
      areaWarningGeometry.rotateX(-Math.PI / 2);

      const keepTowerGeometry = new THREE.CylinderGeometry(
        0.62,
        0.68,
        KEEP_WALL_HEIGHT + 0.7,
        12,
      );
      const keepTowerCapGeometry = new THREE.ConeGeometry(
        0.82,
        1.2,
        12,
      );

      const groundEquipmentGeometry = new THREE.BoxGeometry(1, 1, 1);
      const groundConsumableGeometry = new THREE.CylinderGeometry(
        0.105,
        0.14,
        0.36,
        9,
      );
      const groundRuneGeometry = new THREE.CylinderGeometry(
        0.2,
        0.2,
        0.055,
        12,
      );
      const groundCoinGeometry = new THREE.CylinderGeometry(
        0.17,
        0.17,
        0.055,
        14,
      );

      const resourceWoodGeometry = new THREE.CylinderGeometry(
        0.22,
        0.3,
        0.72,
        9,
      );
      const resourceHerbGeometry = new THREE.ConeGeometry(
        0.34,
        0.62,
        7,
      );
      const resourceWaterGeometry = new THREE.RingGeometry(
        0.28,
        0.42,
        28,
      );
      resourceWaterGeometry.rotateX(-Math.PI / 2);

      const spellFireGeometry = new THREE.ConeGeometry(0.3, 0.74, 8);
      const spellPoisonGeometry = new THREE.IcosahedronGeometry(0.31, 1);
      const spellIceGeometry = new THREE.OctahedronGeometry(0.38, 1);
      const spellArcaneGeometry = new THREE.TorusKnotGeometry(
        0.24,
        0.065,
        32,
        6,
      );

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
        roofAlongZGeometry,
        roofAlongXGeometry,
        doorKnobGeometry,
        groundItemGeometry,
        corpseGeometry,
        lootRingGeometry,
        resourceRockGeometry,
        resourceCopperGeometry,
        combatBurstGeometry,
        combatRingGeometry,
        areaWarningGeometry,
        keepTowerGeometry,
        keepTowerCapGeometry,
        groundEquipmentGeometry,
        groundConsumableGeometry,
        groundRuneGeometry,
        groundCoinGeometry,
        resourceWoodGeometry,
        resourceHerbGeometry,
        resourceWaterGeometry,
        spellFireGeometry,
        spellPoisonGeometry,
        spellIceGeometry,
        spellArcaneGeometry,
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

        looseHouseWall: materialWithTexture(textures.timberPlaster, "#b79d79", 0.96),
        facadePlaster: materialWithTexture(textures.timberPlaster, "#b79d79", 0.96),
        facadeStone: materialWithTexture(textures.castleStone, "#9fa29a", 0.98),
        facadeFrame: new THREE.MeshStandardMaterial({ color: "#52361f", roughness: 0.9 }),
        castleWall: materialWithTexture(textures.castleStone, "#6d7773", 0.98),
        buildingFloor: materialWithTexture(textures.mossStone, "#aaa18d", 0.96),
        houseRoof: new THREE.MeshStandardMaterial({
          map: textures.roofTiles,
          color: "#71372d",
          roughness: 0.91,
          side: THREE.DoubleSide,
        }),
        keepRoof: new THREE.MeshStandardMaterial({
          map: textures.roofTiles,
          color: "#45504d",
          roughness: 0.91,
          side: THREE.DoubleSide,
        }),
        keepDetail: materialWithTexture(
          textures.castleStone,
          "#69736f",
          0.98,
        ),
        keepCap: new THREE.MeshStandardMaterial({
          map: textures.roofTiles,
          color: "#3f4947",
          roughness: 0.93,
        }),
        chimneyHouse: new THREE.MeshStandardMaterial({ color: "#704938", roughness: 1 }),
        chimneyKeep: new THREE.MeshStandardMaterial({ color: "#626b68", roughness: 1 }),
        chimneyCap: new THREE.MeshStandardMaterial({ color: "#3c3731", roughness: 1 }),
        signDark: new THREE.MeshStandardMaterial({ color: "#35251a", roughness: 0.96 }),
        signWood: new THREE.MeshStandardMaterial({ color: "#785331", roughness: 0.92 }),
        door: new THREE.MeshStandardMaterial({ color: "#654128", roughness: 0.82 }),
        doorKnob: new THREE.MeshStandardMaterial({
          color: "#d6aa54",
          metalness: 0.65,
          roughness: 0.35,
        }),

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

        groundItem: new THREE.MeshStandardMaterial({
          color: "#d3a84f",
          roughness: 0.8,
        }),
        groundEquipment: new THREE.MeshStandardMaterial({
          color: "#9b8871",
          metalness: 0.32,
          roughness: 0.54,
        }),
        groundConsumable: new THREE.MeshStandardMaterial({
          color: "#78a6b8",
          emissive: "#18343e",
          emissiveIntensity: 0.14,
          roughness: 0.36,
        }),
        groundRune: new THREE.MeshStandardMaterial({
          color: "#8c75b6",
          emissive: "#332357",
          emissiveIntensity: 0.46,
          roughness: 0.72,
        }),
        groundCoin: new THREE.MeshStandardMaterial({
          color: "#d2a43e",
          metalness: 0.72,
          roughness: 0.3,
        }),
        corpse: new THREE.MeshStandardMaterial({
          color: "#6d3029",
          roughness: 0.9,
        }),
        lootRing: new THREE.MeshBasicMaterial({
          color: "#f0bc55",
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          toneMapped: false,
        }),
        resourceAvailable: new THREE.MeshStandardMaterial({
          color: "#5f6864",
          roughness: 0.96,
        }),
        resourceDepleted: new THREE.MeshStandardMaterial({
          color: "#383f3c",
          roughness: 1,
        }),
        resourceCopper: new THREE.MeshStandardMaterial({
          color: "#b86b3c",
          emissive: "#5c2413",
          emissiveIntensity: 0.34,
          metalness: 0.28,
          roughness: 0.58,
        }),
        resourceWood: new THREE.MeshStandardMaterial({
          color: "#79502f",
          roughness: 0.96,
        }),
        resourceHerb: new THREE.MeshStandardMaterial({
          color: "#4e8a50",
          emissive: "#18351d",
          emissiveIntensity: 0.1,
          roughness: 0.92,
        }),
        resourceWater: new THREE.MeshBasicMaterial({
          color: "#62b9cf",
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          toneMapped: false,
        }),
        combatIncoming: new THREE.MeshBasicMaterial({
          color: "#ff4e46",
          transparent: true,
          opacity: 0.68,
          depthWrite: false,
          toneMapped: false,
        }),
        combatOutgoing: new THREE.MeshBasicMaterial({
          color: "#ffd268",
          transparent: true,
          opacity: 0.68,
          depthWrite: false,
          toneMapped: false,
        }),
        combatOther: new THREE.MeshBasicMaterial({
          color: "#f18a56",
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          toneMapped: false,
        }),
        combatRing: new THREE.MeshBasicMaterial({
          color: "#ffd46e",
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          toneMapped: false,
        }),
        combatFire: new THREE.MeshBasicMaterial({
          color: "#ff7a32",
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
        combatPoison: new THREE.MeshBasicMaterial({
          color: "#6bd15f",
          transparent: true,
          opacity: 0.76,
          depthWrite: false,
          toneMapped: false,
        }),
        combatIce: new THREE.MeshBasicMaterial({
          color: "#78d9f5",
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
        combatArcane: new THREE.MeshBasicMaterial({
          color: "#bd86ff",
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          toneMapped: false,
        }),
        areaWarning: new THREE.MeshBasicMaterial({
          color: "#ff4d43",
          transparent: true,
          opacity: 0.44,
          depthWrite: false,
          toneMapped: false,
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

        looseHouseWalls: new NativeInstancedLayer(box, materials.looseHouseWall, 4096),
        castleWalls: new NativeInstancedLayer(box, materials.castleWall, 8192),
        buildingFloors: new NativeInstancedLayer(box, materials.buildingFloor, 4096),

        houseRoofsAlongZ: new NativeInstancedLayer(roofAlongZGeometry, materials.houseRoof, 2048),
        houseRoofsAlongX: new NativeInstancedLayer(roofAlongXGeometry, materials.houseRoof, 2048),
        keepRoofsAlongZ: new NativeInstancedLayer(roofAlongZGeometry, materials.keepRoof, 1024),
        keepRoofsAlongX: new NativeInstancedLayer(roofAlongXGeometry, materials.keepRoof, 1024),
        keepMerlons: new NativeInstancedLayer(box, materials.keepDetail, 4096),
        keepCornerTowers: new NativeInstancedLayer(
          keepTowerGeometry,
          materials.keepDetail,
          512,
        ),
        keepTowerCaps: new NativeInstancedLayer(
          keepTowerCapGeometry,
          materials.keepCap,
          512,
        ),
        chimneys: new NativeInstancedLayer(box, materials.chimneyHouse, 2048),
        chimneyCaps: new NativeInstancedLayer(box, materials.chimneyCap, 2048),
        signArms: new NativeInstancedLayer(box, materials.signDark, 2048),
        signPosts: new NativeInstancedLayer(box, materials.signDark, 2048),
        signBoards: new NativeInstancedLayer(box, materials.signWood, 2048),

        doorFacadeSides: new NativeInstancedLayer(box, materials.facadePlaster, 4096),
        doorFacadeTops: new NativeInstancedLayer(box, materials.facadePlaster, 2048),
        doorFramesVertical: new NativeInstancedLayer(box, materials.facadeFrame, 4096),
        doorFramesHorizontal: new NativeInstancedLayer(box, materials.facadeFrame, 2048),
        doorThresholds: new NativeInstancedLayer(box, materials.facadeFrame, 2048),
        doorLeaves: new NativeInstancedLayer(box, materials.door, 2048),
        doorKnobs: new NativeInstancedLayer(doorKnobGeometry, materials.doorKnob, 2048),

        windowFacadeSides: new NativeInstancedLayer(box, materials.facadePlaster, 4096),
        windowFacadeLower: new NativeInstancedLayer(box, materials.facadePlaster, 2048),
        windowFacadeTops: new NativeInstancedLayer(box, materials.facadePlaster, 2048),
        windowFramesHorizontal: new NativeInstancedLayer(box, materials.facadeFrame, 4096),

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

        groundItems: new NativeInstancedLayer(
          groundItemGeometry,
          materials.groundItem,
          512,
          false,
          true,
        ),
        groundEquipment: new NativeInstancedLayer(
          groundEquipmentGeometry,
          materials.groundEquipment,
          512,
          false,
          true,
        ),
        groundConsumables: new NativeInstancedLayer(
          groundConsumableGeometry,
          materials.groundConsumable,
          512,
          false,
          true,
        ),
        groundRunes: new NativeInstancedLayer(
          groundRuneGeometry,
          materials.groundRune,
          512,
          false,
          true,
        ),
        groundCoins: new NativeInstancedLayer(
          groundCoinGeometry,
          materials.groundCoin,
          512,
          false,
          true,
        ),
        corpses: new NativeInstancedLayer(
          corpseGeometry,
          materials.corpse,
          256,
          false,
          true,
        ),
        lootRings: new NativeInstancedLayer(
          lootRingGeometry,
          materials.lootRing,
          512,
          false,
          false,
        ),
        resourceAvailable: new NativeInstancedLayer(
          resourceRockGeometry,
          materials.resourceAvailable,
          512,
          false,
          true,
        ),
        resourceDepleted: new NativeInstancedLayer(
          resourceRockGeometry,
          materials.resourceDepleted,
          512,
          false,
          true,
        ),
        resourceCopper: new NativeInstancedLayer(
          resourceCopperGeometry,
          materials.resourceCopper,
          512,
          false,
          true,
        ),
        resourceWood: new NativeInstancedLayer(
          resourceWoodGeometry,
          materials.resourceWood,
          512,
          false,
          true,
        ),
        resourceHerb: new NativeInstancedLayer(
          resourceHerbGeometry,
          materials.resourceHerb,
          512,
          false,
          true,
        ),
        resourceWater: new NativeInstancedLayer(
          resourceWaterGeometry,
          materials.resourceWater,
          512,
          false,
          false,
        ),
        combatIncoming: new NativeInstancedLayer(
          combatBurstGeometry,
          materials.combatIncoming,
          32,
          false,
          false,
        ),
        combatOutgoing: new NativeInstancedLayer(
          combatBurstGeometry,
          materials.combatOutgoing,
          32,
          false,
          false,
        ),
        combatOther: new NativeInstancedLayer(
          combatBurstGeometry,
          materials.combatOther,
          32,
          false,
          false,
        ),
        combatRings: new NativeInstancedLayer(
          combatRingGeometry,
          materials.combatRing,
          64,
          false,
          false,
        ),
        combatFire: new NativeInstancedLayer(
          spellFireGeometry,
          materials.combatFire,
          32,
          false,
          false,
        ),
        combatPoison: new NativeInstancedLayer(
          spellPoisonGeometry,
          materials.combatPoison,
          32,
          false,
          false,
        ),
        combatIce: new NativeInstancedLayer(
          spellIceGeometry,
          materials.combatIce,
          32,
          false,
          false,
        ),
        combatArcane: new NativeInstancedLayer(
          spellArcaneGeometry,
          materials.combatArcane,
          32,
          false,
          false,
        ),
        areaWarnings: new NativeInstancedLayer(
          areaWarningGeometry,
          materials.areaWarning,
          20,
          false,
          false,
        ),
      };

      for (const layer of Object.values(layers)) scene.add(layer.mesh);

      layers.lootRings.mesh.renderOrder = 17;
      layers.combatIncoming.mesh.renderOrder = 18;
      layers.combatOutgoing.mesh.renderOrder = 18;
      layers.combatOther.mesh.renderOrder = 18;
      layers.combatRings.mesh.renderOrder = 17;
      layers.combatFire.mesh.renderOrder = 19;
      layers.combatPoison.mesh.renderOrder = 19;
      layers.combatIce.mesh.renderOrder = 19;
      layers.combatArcane.mesh.renderOrder = 19;
      layers.resourceWater.mesh.renderOrder = 14;
      layers.areaWarnings.mesh.renderOrder = 16;

      const medievalLayers = {
        houseWalls: new NativeGltfInstancedSet(
          medievalAssets.wallParts,
          8192,
        ),
        shuttersOpen: new NativeGltfInstancedSet(
          medievalAssets.shutterOpenParts,
          2048,
        ),
        shuttersClosed: new NativeGltfInstancedSet(
          medievalAssets.shutterClosedParts,
          2048,
        ),
      };
      for (const set of Object.values(medievalLayers)) {
        for (const mesh of set.meshes) scene.add(mesh);
      }

      openingAnimationManager = new NativeOpeningAnimationManager(
        layers.doorLeaves,
        layers.doorKnobs,
        medievalLayers.shuttersOpen,
        medievalLayers.shuttersClosed,
        medievalAssets.shutterOpenParts,
        medievalAssets.shutterClosedParts,
      );
      const activeOpeningAnimationManager = openingAnimationManager;

      actorManager = new NativeActorManager(
        scene,
        characterAssets,
        castleRatAssets,
      );
      const activeActorManager = actorManager;

      const dynamicLightsEnabled =
        new URLSearchParams(window.location.search).get("lights") !== "off";
      dynamicSceneManager = new NativeDynamicSceneManager(
        scene,
        {
          groundItems: layers.groundItems,
          groundEquipment: layers.groundEquipment,
          groundConsumables: layers.groundConsumables,
          groundRunes: layers.groundRunes,
          groundCoins: layers.groundCoins,
          corpses: layers.corpses,
          lootRings: layers.lootRings,
          resourceAvailable: layers.resourceAvailable,
          resourceDepleted: layers.resourceDepleted,
          resourceCopper: layers.resourceCopper,
          resourceWood: layers.resourceWood,
          resourceHerb: layers.resourceHerb,
          resourceWater: layers.resourceWater,
          combatIncoming: layers.combatIncoming,
          combatOutgoing: layers.combatOutgoing,
          combatOther: layers.combatOther,
          combatRings: layers.combatRings,
          combatFire: layers.combatFire,
          combatPoison: layers.combatPoison,
          combatIce: layers.combatIce,
          combatArcane: layers.combatArcane,
          areaWarnings: layers.areaWarnings,
        },
        camera,
        dynamicLightsEnabled,
      );
      const activeDynamicSceneManager = dynamicSceneManager;

      console.info(
        `NATIVE V26 dynamic lights: ${dynamicLightsEnabled ? "enabled" : "disabled"}`,
      );

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
        stage("authored house walls", () => medievalLayers.houseWalls.setTransforms(
          medievalAssets.wallParts,
          snapshot.houseWallModels,
        ));
        stage("loose house walls", () => layers.looseHouseWalls.setTransforms(snapshot.looseHouseWalls));
        stage("castle walls", () => layers.castleWalls.setTransforms(snapshot.castleWalls));

        stage("house roofs z", () => layers.houseRoofsAlongZ.setTransforms(snapshot.houseRoofsAlongZ));
        stage("house roofs x", () => layers.houseRoofsAlongX.setTransforms(snapshot.houseRoofsAlongX));
        stage("keep roofs z", () => layers.keepRoofsAlongZ.setTransforms(snapshot.keepRoofsAlongZ));
        stage("keep roofs x", () => layers.keepRoofsAlongX.setTransforms(snapshot.keepRoofsAlongX));
        stage("keep merlons", () => layers.keepMerlons.setTransforms(snapshot.keepMerlons));
        stage("keep corner towers", () => layers.keepCornerTowers.setTransforms(snapshot.keepCornerTowers));
        stage("keep tower caps", () => layers.keepTowerCaps.setTransforms(snapshot.keepTowerCaps));
        stage("chimneys", () => layers.chimneys.setTransforms(snapshot.chimneys));
        stage("chimney caps", () => layers.chimneyCaps.setTransforms(snapshot.chimneyCaps));
        stage("sign arms", () => layers.signArms.setTransforms(snapshot.signArms));
        stage("sign posts", () => layers.signPosts.setTransforms(snapshot.signPosts));
        stage("sign boards", () => layers.signBoards.setTransforms(snapshot.signBoards));

        stage("door facade sides", () => layers.doorFacadeSides.setTransforms(snapshot.doorFacadeSides));
        stage("door facade tops", () => layers.doorFacadeTops.setTransforms(snapshot.doorFacadeTops));
        stage("door frame vertical", () => layers.doorFramesVertical.setTransforms(snapshot.doorFramesVertical));
        stage("door frame horizontal", () => layers.doorFramesHorizontal.setTransforms(snapshot.doorFramesHorizontal));
        stage("door thresholds", () => layers.doorThresholds.setTransforms(snapshot.doorThresholds));
        stage("window facade sides", () => layers.windowFacadeSides.setTransforms(snapshot.windowFacadeSides));
        stage("window facade lower", () => layers.windowFacadeLower.setTransforms(snapshot.windowFacadeLower));
        stage("window facade tops", () => layers.windowFacadeTops.setTransforms(snapshot.windowFacadeTops));
        stage("window frames", () => layers.windowFramesHorizontal.setTransforms(snapshot.windowFramesHorizontal));
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

      const pointerTile = (
        event: PointerEvent | MouseEvent,
      ): Position | null => {
        const localPlayer = world.localPlayerId
          ? world.players.get(world.localPlayerId)
          : undefined;
        const map = world.map;
        if (!localPlayer || !map) return null;

        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -(((event.clientY - rect.top) / rect.height) * 2 - 1),
        );
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(interactionPlane, interactionPoint))
          return null;

        return {
          x: Math.max(
            0,
            Math.min(map.width - 1, Math.floor(interactionPoint.x)),
          ),
          y: Math.max(
            0,
            Math.min(map.height - 1, Math.floor(interactionPoint.z)),
          ),
          z: localPlayer.position.z,
        };
      };

      const interactAtPointer = (event: PointerEvent | MouseEvent) => {
        const position = pointerTile(event);
        if (position) input.interactAt(position);
      };

      const hideHover = () => {
        activeDynamicSceneManager.setHover(null, null);
        canvas.style.cursor = "";
        if (hoverRef.current) hoverRef.current.style.display = "none";
      };

      const onPointerMove = (event: PointerEvent) => {
        const position = pointerTile(event);
        if (!position) {
          hideHover();
          return;
        }

        const sameTile = (entry: Position) =>
          entry.x === position.x
          && entry.y === position.y
          && entry.z === position.z;

        const groundItem = world.groundItems.find((entry) =>
          sameTile(entry.position)
        );
        if (groundItem) {
          const definition = world.itemDefinitions.get(
            groundItem.item.definitionId,
          );
          const label = groundItem.contents.length > 0
            ? `${groundItem.contents.length} loot ${
                groundItem.contents.length === 1 ? "item" : "items"
              }`
            : definition?.name ?? groundItem.item.definitionId;

          activeDynamicSceneManager.setHover(position, "loot");
          canvas.style.cursor = "pointer";
          if (hoverRef.current) {
            hoverRef.current.textContent = label;
            hoverRef.current.style.display = "block";
            hoverRef.current.style.left = `${event.clientX + 14}px`;
            hoverRef.current.style.top = `${event.clientY + 14}px`;
          }
          return;
        }

        const resource = [...world.resourceNodes.values()].find((entry) =>
          sameTile(entry.position)
        );
        if (resource) {
          const name = resource.kind
            .replaceAll("_", " ")
            .replace(/\w/g, (character) => character.toUpperCase());
          activeDynamicSceneManager.setHover(position, "resource");
          canvas.style.cursor = resource.available ? "pointer" : "";
          if (hoverRef.current) {
            hoverRef.current.textContent = resource.available
              ? name
              : `${name} · depleted`;
            hoverRef.current.style.display = "block";
            hoverRef.current.style.left = `${event.clientX + 14}px`;
            hoverRef.current.style.top = `${event.clientY + 14}px`;
          }
          return;
        }

        const npc = [...world.npcs.values()].find((entry) =>
          sameTile(entry.position)
        );
        if (npc) {
          activeDynamicSceneManager.setHover(position, "npc");
          canvas.style.cursor = "pointer";
          if (hoverRef.current) {
            hoverRef.current.textContent = npc.title
              ? `${npc.name} · ${npc.title}`
              : npc.name;
            hoverRef.current.style.display = "block";
            hoverRef.current.style.left = `${event.clientX + 14}px`;
            hoverRef.current.style.top = `${event.clientY + 14}px`;
          }
          return;
        }

        hideHover();
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
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", hideHover);
      canvas.addEventListener("contextmenu", onContextMenu);
      cleanupInput = () => {
        hideHover();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", hideHover);
        canvas.removeEventListener("contextmenu", onContextMenu);
      };

      // Instantiate actors already present in the first streamed region before
      // shader compilation, so their first material/skin/sprite programs are not
      // paid for during movement.
      const initialLocal = world.localPlayerId
        ? world.players.get(world.localPlayerId)
        : undefined;
      if (initialLocal) {
        const initialNow = performance.now();
        activeActorManager.sync(
          world,
          initialLocal.position.z,
          0,
          initialNow,
          camera,
          layers.creatures,
        );
        if (world.map) {
          activeOpeningAnimationManager.update(
            world.map,
            initialLocal.position.z,
            initialLocal.position,
            initialNow,
          );
          activeDynamicSceneManager.update(
            world,
            world.map,
            initialLocal.position.z,
            initialLocal.position,
            activeActorManager.playerVisualPosition(world.localPlayerId),
            activeActorManager,
            initialNow,
          );
        }
      }

      // Compile every world + actor + dynamic-light material family while the
      // loading overlay is still up.
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

          // TIBIAGAME_NATIVE_RENDERER_V24_1
          // Never follow the integer gameplay tile directly. That made the
          // whole world jump one tile every CLIENT_STEP_MS even though the
          // player mesh itself was interpolated.
          const visualLocal = activeActorManager.playerVisualPosition(
            world.localPlayerId,
          );
          const cameraX = visualLocal?.x ?? local.position.x + 0.5;
          const cameraZ = visualLocal?.z ?? local.position.y + 0.5;

          activeOpeningAnimationManager.update(
            map,
            floor,
            local.position,
            now,
          );

          activeDynamicSceneManager.update(
            world,
            map,
            floor,
            local.position,
            visualLocal,
            activeActorManager,
            now,
          );

          camera.position.set(
            cameraX,
            NATIVE_CAMERA_HEIGHT,
            cameraZ + NATIVE_CAMERA_OFFSET,
          );
          camera.lookAt(
            cameraX,
            0,
            cameraZ,
          );

          textures.water.offset.set(
            now * 0.000032,
            now * 0.000019,
          );

          if (positionRef.current) {
            positionRef.current.textContent =
              `NATIVE V28 · x ${local.position.x} · y ${local.position.y} · z ${floor}`;
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
      console.error("Native V28 renderer bootstrap failed", error);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      cleanupInput?.();

      openingAnimationManager = null;

      dynamicSceneManager?.dispose();
      dynamicSceneManager = null;

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
      if (loadedMedievalAssets) {
        disposeNativeMedievalAssets(loadedMedievalAssets);
        loadedMedievalAssets = null;
      }
    };
  }, [input, world]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="three-world"
        data-native-world-renderer="v28"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <div
        ref={hoverRef}
        className="ground-loot-tooltip"
        style={{
          display: "none",
          position: "fixed",
          pointerEvents: "none",
          zIndex: 50,
        }}
      />
      {showDebug && (
        <div className="debug-meter" aria-label="Native renderer performance">
          <div ref={positionRef} className="position-meter">
            NATIVE V28 · x -- · y -- · z --
          </div>
          <div ref={performanceRef} className="fps-meter">
            Native renderer loading world + actors…
          </div>
        </div>
      )}
    </>
  );
});
