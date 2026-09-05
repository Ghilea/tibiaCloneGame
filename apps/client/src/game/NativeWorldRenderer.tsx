import { memo, useEffect, useRef } from "react";
import * as THREE from "three";

import type {
  BuildingView,
  MapView,
  Position,
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
  materialTiles: Transform[];
  walls: Transform[];
  buildingFloors: Transform[];
  roofs: Transform[];
  treeTrunks: Transform[];
  treeCrowns: Transform[];
  mountains: Transform[];
  props: Transform[];
  torches: Transform[];
  stairs: Transform[];
};

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

function nativeObjectTransform(object: WorldObjectView): Transform {
  switch (object.kind) {
    case "mountain_wall":
      return [
        object.position.x + 0.5,
        1.25,
        object.position.y + 0.5,
        0.95,
        2.5,
        0.95,
      ];
    case "barrel":
      return [
        object.position.x + 0.5,
        0.38,
        object.position.y + 0.5,
        0.48,
        0.76,
        0.48,
      ];
    case "well":
      return [
        object.position.x + 0.5,
        0.55,
        object.position.y + 0.5,
        0.9,
        1.1,
        0.9,
      ];
    case "table":
    case "bench":
      return [
        object.position.x + 0.5,
        0.35,
        object.position.y + 0.5,
        0.9,
        0.7,
        0.55,
      ];
    default:
      return [
        object.position.x + 0.5,
        0.32,
        object.position.y + 0.5,
        0.46,
        0.64,
        0.46,
      ];
  }
}

function appendBuilding(
  building: BuildingView,
  floors: Transform[],
  walls: Transform[],
  roofs: Transform[],
) {
  const wallHeight = building.kind === "keep" ? 4.1 : 3.2;
  const wallThickness = building.kind === "keep" ? 0.28 : 0.18;
  const centerX = building.x + building.width / 2;
  const centerY = building.y + building.height / 2;

  floors.push([
    centerX,
    0.045,
    centerY,
    Math.max(0.5, building.width - 0.12),
    0.09,
    Math.max(0.5, building.height - 0.12),
  ]);

  for (let x = building.x; x < building.x + building.width; x += 1) {
    walls.push([
      x + 0.5,
      wallHeight / 2,
      building.y,
      1.04,
      wallHeight,
      wallThickness,
    ]);
    walls.push([
      x + 0.5,
      wallHeight / 2,
      building.y + building.height,
      1.04,
      wallHeight,
      wallThickness,
    ]);
  }

  for (let y = building.y; y < building.y + building.height; y += 1) {
    walls.push([
      building.x,
      wallHeight / 2,
      y + 0.5,
      wallThickness,
      wallHeight,
      1.04,
    ]);
    walls.push([
      building.x + building.width,
      wallHeight / 2,
      y + 0.5,
      wallThickness,
      wallHeight,
      1.04,
    ]);
  }

  roofs.push([
    centerX,
    wallHeight + 0.18,
    centerY,
    building.width + 0.16,
    0.28,
    building.height + 0.16,
  ]);
}

function prepareNativeSnapshot(
  world: WorldState,
  map: MapView,
  floor: number,
  centerX: number,
  centerY: number,
  signature: string,
): StaticSnapshot {
  const roads: Transform[] = [];
  const floors: Transform[] = [];
  const water: Transform[] = [];
  const materialTiles: Transform[] = [];
  const walls: Transform[] = [];
  const buildingFloors: Transform[] = [];
  const roofs: Transform[] = [];
  const treeTrunks: Transform[] = [];
  const treeCrowns: Transform[] = [];
  const mountains: Transform[] = [];
  const props: Transform[] = [];
  const torches: Transform[] = [];
  const stairs: Transform[] = [];

  for (const position of map.roads) {
    if (nativeInside(position, floor, centerX, centerY))
      roads.push(nativeTile(position, 0.018, 0.04));
  }
  for (const position of map.floors) {
    if (nativeInside(position, floor, centerX, centerY))
      floors.push(nativeTile(position, 0.025, 0.05));
  }
  for (const position of map.water) {
    if (nativeInside(position, floor, centerX, centerY))
      water.push(nativeTile(position, 0.01, 0.025, 1.02));
  }
  for (const entry of map.terrainMaterials) {
    if (nativeInside(entry.position, floor, centerX, centerY))
      materialTiles.push(nativeTile(entry.position, 0.03, 0.055));
  }

  for (const position of [...map.houseWalls, ...map.castleWalls]) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    const castle = map.castleWalls.includes(position);
    walls.push([
      position.x + 0.5,
      castle ? 2.05 : 1.6,
      position.y + 0.5,
      castle ? 0.3 : 0.24,
      castle ? 4.1 : 3.2,
      castle ? 0.3 : 0.24,
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
    appendBuilding(building, buildingFloors, walls, roofs);
  }

  const treePositions: Position[] = [...map.trees];
  for (const object of map.objects ?? []) {
    if (!nativeInside(object.position, floor, centerX, centerY)) continue;
    if (
      object.kind === "forest_tree"
      || object.kind === "pine_tree"
      || object.kind === "snowy_pine"
    ) {
      treePositions.push(object.position);
      continue;
    }
    if (object.kind === "mountain_wall") {
      mountains.push(nativeObjectTransform(object));
      continue;
    }
    if (object.kind === "dirt_path" || object.kind === "snow_ground") {
      materialTiles.push(nativeTile(object.position, 0.032, 0.055));
      continue;
    }
    props.push(nativeObjectTransform(object));
  }

  for (const position of treePositions) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    treeTrunks.push([
      position.x + 0.5,
      0.65,
      position.y + 0.5,
      0.22,
      1.3,
      0.22,
    ]);
    treeCrowns.push([
      position.x + 0.5,
      1.75,
      position.y + 0.5,
      1.25,
      1.6,
      1.25,
    ]);
  }

  for (const position of map.torches) {
    if (!nativeInside(position, floor, centerX, centerY)) continue;
    torches.push([
      position.x + 0.5,
      0.55,
      position.y + 0.5,
      0.08,
      1.1,
      0.08,
    ]);
  }

  for (const stair of map.stairs) {
    const position = stair.from.z === floor
      ? stair.from
      : stair.to.z === floor
        ? stair.to
        : null;
    if (!position || !nativeInside(position, floor, centerX, centerY)) continue;
    stairs.push([
      position.x + 0.5,
      0.12,
      position.y + 0.5,
      0.9,
      0.24,
      0.9,
    ]);
  }

  void world;
  return {
    signature,
    floor,
    centerX,
    centerY,
    roads,
    floors,
    water,
    materialTiles,
    walls,
    buildingFloors,
    roofs,
    treeTrunks,
    treeCrowns,
    mountains,
    props,
    torches,
    stairs,
  };
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

    console.info(
      "NATIVE WORLD BENCHMARK active · raw Three.js · no React Three Fiber world scene",
    );

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x0b1210);
    renderer.info.autoReset = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1210);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 180);
    camera.zoom = NATIVE_CAMERA_ZOOM;

    const hemisphere = new THREE.HemisphereLight(0xc8d7c7, 0x19231d, 1.8);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe4b8, 1.25);
    sun.position.set(10, 24, 8);
    scene.add(sun);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const crown = new THREE.DodecahedronGeometry(0.5, 0);
    const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);

    const materials = {
      grass: new THREE.MeshStandardMaterial({ color: 0x718a5e, roughness: 0.98 }),
      road: new THREE.MeshStandardMaterial({ color: 0xa99578, roughness: 0.96 }),
      floor: new THREE.MeshStandardMaterial({ color: 0xaaa18d, roughness: 0.96 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x277789,
        emissive: 0x12343c,
        emissiveIntensity: 0.08,
        roughness: 0.3,
      }),
      material: new THREE.MeshStandardMaterial({ color: 0x8f765c, roughness: 0.98 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xb9a98f, roughness: 0.98 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x71513f, roughness: 0.95 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x59422d, roughness: 1 }),
      crown: new THREE.MeshStandardMaterial({ color: 0x496b43, roughness: 1 }),
      mountain: new THREE.MeshStandardMaterial({ color: 0x66706b, roughness: 1 }),
      prop: new THREE.MeshStandardMaterial({ color: 0x7b6047, roughness: 0.98 }),
      torch: new THREE.MeshStandardMaterial({
        color: 0xc88a3d,
        emissive: 0x9d4c13,
        emissiveIntensity: 1.5,
      }),
      stair: new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.96 }),
      localPlayer: new THREE.MeshStandardMaterial({ color: 0xe5c46d, roughness: 0.8 }),
      player: new THREE.MeshStandardMaterial({ color: 0x83a9cf, roughness: 0.8 }),
      creature: new THREE.MeshStandardMaterial({ color: 0xa9685f, roughness: 0.9 }),
      npc: new THREE.MeshStandardMaterial({ color: 0x9b83be, roughness: 0.9 }),
    };

    const ground = new THREE.Mesh(box, materials.grass);
    ground.receiveShadow = true;
    ground.position.y = -0.12;
    scene.add(ground);

    const layers = {
      roads: new NativeInstancedLayer(box, materials.road, 8192),
      floors: new NativeInstancedLayer(box, materials.floor, 8192),
      water: new NativeInstancedLayer(box, materials.water, 8192),
      materialTiles: new NativeInstancedLayer(box, materials.material, 8192),
      walls: new NativeInstancedLayer(box, materials.wall, 8192),
      buildingFloors: new NativeInstancedLayer(box, materials.floor, 2048),
      roofs: new NativeInstancedLayer(box, materials.roof, 2048),
      treeTrunks: new NativeInstancedLayer(cylinder, materials.trunk, 4096),
      treeCrowns: new NativeInstancedLayer(crown, materials.crown, 4096),
      mountains: new NativeInstancedLayer(box, materials.mountain, 4096),
      props: new NativeInstancedLayer(box, materials.prop, 4096),
      torches: new NativeInstancedLayer(cylinder, materials.torch, 2048),
      stairs: new NativeInstancedLayer(box, materials.stair, 1024),
      localPlayer: new NativeInstancedLayer(box, materials.localPlayer, 1),
      players: new NativeInstancedLayer(box, materials.player, 128),
      creatures: new NativeInstancedLayer(box, materials.creature, 512),
      npcs: new NativeInstancedLayer(box, materials.npc, 256),
    };

    for (const layer of Object.values(layers)) scene.add(layer.mesh);

    let disposed = false;
    let animationFrame = 0;
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

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);

      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.zoom = NATIVE_CAMERA_ZOOM;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement ?? canvas);
    resize();

    const queueStaticSnapshot = (
      map: MapView,
      floor: number,
      playerX: number,
      playerY: number,
      signature: string,
    ) => {
      if (signature === pendingStaticSignature || signature === lastStaticSignature)
        return;

      pendingStaticSignature = signature;
      const generation = ++staticGeneration;
      const prepareStarted = performance.now();
      const snapshot = prepareNativeSnapshot(
        world,
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

      stagedTasks = [
        {
          generation,
          label: "ground",
          run: () => {
            const size = NATIVE_RENDER_RADIUS * 2 + 4;
            ground.position.set(playerX + 0.5, -0.12, playerY + 0.5);
            ground.scale.set(size, 0.2, size);
            ground.updateMatrix();
          },
        },
        { generation, label: "roads", run: () => layers.roads.setTransforms(snapshot.roads) },
        { generation, label: "floors", run: () => layers.floors.setTransforms(snapshot.floors) },
        { generation, label: "water", run: () => layers.water.setTransforms(snapshot.water) },
        { generation, label: "materials", run: () => layers.materialTiles.setTransforms(snapshot.materialTiles) },
        { generation, label: "building floors", run: () => layers.buildingFloors.setTransforms(snapshot.buildingFloors) },
        { generation, label: "walls", run: () => layers.walls.setTransforms(snapshot.walls) },
        { generation, label: "roofs", run: () => layers.roofs.setTransforms(snapshot.roofs) },
        { generation, label: "tree trunks", run: () => layers.treeTrunks.setTransforms(snapshot.treeTrunks) },
        { generation, label: "tree crowns", run: () => layers.treeCrowns.setTransforms(snapshot.treeCrowns) },
        { generation, label: "mountains", run: () => layers.mountains.setTransforms(snapshot.mountains) },
        { generation, label: "props", run: () => layers.props.setTransforms(snapshot.props) },
        { generation, label: "torches", run: () => layers.torches.setTransforms(snapshot.torches) },
        { generation, label: "stairs", run: () => layers.stairs.setTransforms(snapshot.stairs) },
        {
          generation,
          label: "commit",
          run: () => {
            if (generation !== staticGeneration) return;
            lastStaticSignature = snapshot.signature;
            pendingStaticSignature = "";
            if (!readyReported) {
              readyReported = true;
              queueMicrotask(() => onReadyRef.current?.());
            }
          },
        },
      ];
    };

    const updateActors = (floor: number) => {
      const local = world.localPlayerId
        ? world.players.get(world.localPlayerId)
        : undefined;

      layers.localPlayer.setTransforms(
        local && local.position.z === floor
          ? [[
              local.position.x + 0.5,
              0.62,
              local.position.y + 0.5,
              0.58,
              1.24,
              0.58,
            ]]
          : [],
      );

      const playerTransforms: Transform[] = [];
      for (const player of world.players.values()) {
        if (player.id === world.localPlayerId || player.position.z !== floor) continue;
        playerTransforms.push([
          player.position.x + 0.5,
          0.62,
          player.position.y + 0.5,
          0.58,
          1.24,
          0.58,
        ]);
      }
      layers.players.setTransforms(playerTransforms);

      const creatureTransforms: Transform[] = [];
      for (const creature of world.creatures.values()) {
        if (creature.position.z !== floor) continue;
        creatureTransforms.push([
          creature.position.x + 0.5,
          0.42,
          creature.position.y + 0.5,
          0.66,
          0.84,
          0.66,
        ]);
      }
      layers.creatures.setTransforms(creatureTransforms);

      const npcTransforms: Transform[] = [];
      for (const npc of world.npcs.values()) {
        if (npc.position.z !== floor) continue;
        npcTransforms.push([
          npc.position.x + 0.5,
          0.62,
          npc.position.y + 0.5,
          0.58,
          1.24,
          0.58,
        ]);
      }
      layers.npcs.setTransforms(npcTransforms);
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
    const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
      if (!raycaster.ray.intersectPlane(interactionPlane, interactionPoint)) return;

      input.interactAt({
        x: Math.max(0, Math.min(map.width - 1, Math.floor(interactionPoint.x))),
        y: Math.max(0, Math.min(map.height - 1, Math.floor(interactionPoint.z))),
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
        const chunkX = Math.floor(local.position.x / NATIVE_RENDER_CHUNK_SIZE);
        const chunkY = Math.floor(local.position.y / NATIVE_RENDER_CHUNK_SIZE);
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
        updateActors(floor);

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

        if (positionRef.current) {
          positionRef.current.textContent =
            `NATIVE · x ${local.position.x} · y ${local.position.y} · z ${floor}`;
        }
      }

      renderer.render(scene, camera);

      if (now >= warmupUntil) {
        sampleFrames += 1;
        sampleTotal += frameMs;
        sampleMax = Math.max(sampleMax, frameMs);

        if (frameMs >= 50 && local) {
          console.info(
            `NATIVE LONG FRAME ${frameMs.toFixed(1)}ms · pos `
            + `${local.position.x}:${local.position.y}:${local.position.z} · `
            + `calls ${renderer.info.render.calls} · `
            + `tris ${renderer.info.render.triangles} · `
            + `programs ${renderer.info.programs?.length ?? 0} · `
            + `textures ${renderer.info.memory.textures} · `
            + `geometries ${renderer.info.memory.geometries}`,
          );
        }

        if (sampleFrames >= 180) {
          const average = sampleTotal / sampleFrames;
          const fps = average > 0 ? 1000 / average : 0;
          const message =
            `NATIVE performance sample: avg=${average.toFixed(1)}ms `
            + `max=${sampleMax.toFixed(1)}ms fps=${fps.toFixed(0)} `
            + `calls=${renderer.info.render.calls} `
            + `triangles=${renderer.info.render.triangles}`;

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

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("contextmenu", onContextMenu);

      renderer.setAnimationLoop(null);
      renderer.dispose();

      box.dispose();
      crown.dispose();
      cylinder.dispose();
      for (const material of Object.values(materials)) material.dispose();
    };
  }, [input, world]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="three-world"
        data-native-world-renderer="true"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {showDebug && (
        <div className="debug-meter" aria-label="Native renderer performance">
          <div ref={positionRef} className="position-meter">
            NATIVE · x -- · y -- · z --
          </div>
          <div ref={performanceRef} className="fps-meter">
            Native renderer starting…
          </div>
        </div>
      )}
    </>
  );
});
