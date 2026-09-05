import { useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BuildingView, WindowView } from "../protocol";

const MEDIEVAL_VILLAGE_ASSET = "/assets/models/aldoria-medieval-village.glb";
const SOURCE_HEIGHT = 3.1227;
const SOURCE_WIDTH = 2;
const SOURCE_DEPTH = 0.314;
const WINDOW_OPENING_HALF_WIDTH = 0.8;

export type MedievalHouseWallKind = "solid" | "window";

const nodeNames: Record<MedievalHouseWallKind, string> = {
  solid: "Wall_Plaster_Straight",
  window: "Wall_Plaster_Window_Wide_Flat",
};

export function MedievalHouseWallAsset({
  kind,
  position,
  size,
}: {
  kind: MedievalHouseWallKind;
  position: [number, number, number];
  size: [number, number, number];
}) {
  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
  const horizontal = size[0] > size[2];
  const longSize = horizontal ? size[0] : size[2];
  const thickness = horizontal ? size[2] : size[0];
  // The model already has the right medieval timber/plaster geometry. Keep
  // the material simple so the wall reads as construction, not noisy wallpaper.
  const object = useAssetObject(gltf.scenes, nodeNames[kind]);

  return (
    <group
      position={[position[0], 0, position[2]]}
      rotation={[0, horizontal ? 0 : Math.PI / 2, 0]}
      scale={[longSize / SOURCE_WIDTH, size[1] / SOURCE_HEIGHT, Math.max(0.28, thickness / SOURCE_DEPTH)]}
    >
      <primitive object={object} />
    </group>
  );
}

type HouseWallInstance = { position: [number, number, number]; size: [number, number, number] };

/** Batches only the unchanged, solid facade model. Its timber trim is authored
 * on local -Z, so this intentionally retains the source model's original
 * orientation rather than using the door/window facing transform. */
// TIBIAGAME_STREAMING_FIX_V6
// TIBIAGAME_STREAMING_FIX_V20
// V19 batches solid house walls per retained chunk. Reuse the extracted GLTF
// geometry/material parts across every chunk instead of cloning their materials
// again for each chunk mount.
const PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY = 2048;

// TIBIAGAME_STREAMING_FIX_V20_3
function houseWallInstanceCapacity(count: number) {
  if (count <= 1) return 1;
  let value = 1;
  while (
    value < count
    && value < PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY
  ) value *= 2;
  return Math.min(value, PERSISTENT_HOUSE_WALL_INSTANCE_CAPACITY);
}

type SharedHouseWallPart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
};

const sharedHouseWallPartCache = new WeakMap<
  THREE.Group[],
  readonly SharedHouseWallPart[]
>();
const sharedHousePlasterMaterialCache = new WeakMap<
  THREE.Group[],
  THREE.Material
>();

function getSharedHouseWallParts(
  scenes: THREE.Group[],
): readonly SharedHouseWallPart[] {
  const cached = sharedHouseWallPartCache.get(scenes);
  if (cached) return cached;

  const source = scenes
    .map((scene) => scene.getObjectByName(nodeNames.solid))
    .find((candidate): candidate is THREE.Object3D =>
      candidate !== undefined
    );
  if (!source) throw new Error("Missing straight medieval house wall asset");

  source.updateWorldMatrix(true, true);
  const sourceInverse = source.matrixWorld.clone().invert();
  const next: SharedHouseWallPart[] = [];

  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    materials.forEach((material) => next.push({
      geometry: child.geometry,
      material: material.clone(),
      matrix: sourceInverse.clone().multiply(child.matrixWorld),
    }));
  });

  if (!next.length) {
    throw new Error("Straight medieval house wall asset has no mesh parts");
  }

  sharedHouseWallPartCache.set(scenes, next);
  return next;
}

function getSharedHousePlasterMaterial(scenes: THREE.Group[]) {
  const cached = sharedHousePlasterMaterialCache.get(scenes);
  if (cached) return cached;

  const source = scenes
    .map((scene) => scene.getObjectByName(nodeNames.solid))
    .find((candidate): candidate is THREE.Object3D =>
      candidate !== undefined
    );

  let plaster: THREE.Material | undefined;
  source?.traverse((child) => {
    if (plaster || !(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    plaster = materials.find((candidate) =>
      candidate.name.includes("Plaster")
    );
  });

  if (!plaster) {
    throw new Error("Missing plaster material on medieval house wall");
  }

  const shared = plaster.clone();
  sharedHousePlasterMaterialCache.set(scenes, shared);
  return shared;
}

export function InstancedMedievalHouseWalls({
  segments,
}: {
  segments: readonly HouseWallInstance[];
}) {
  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
  const parts = useMemo(
    () => getSharedHouseWallParts(gltf.scenes),
    [gltf.scenes],
  );

  // TIBIAGAME_STREAMING_FIX_V20
  // TIBIAGAME_STREAMING_FIX_V20_3
  const allocationCapacity = houseWallInstanceCapacity(segments.length);
  const meshes = useMemo(() => parts.map((part) => {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      allocationCapacity,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }), [allocationCapacity, parts]);

  const count = Math.min(
    segments.length,
    allocationCapacity,
  );

  useMemo(() => {
    const wallMatrix = new THREE.Matrix4();
    const translation = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);

    for (let instanceIndex = 0; instanceIndex < count; instanceIndex += 1) {
      const segment = segments[instanceIndex];
      const horizontal = segment.size[0] > segment.size[2];
      translation.set(
        segment.position[0],
        0,
        segment.position[2],
      );
      scale.set(
        horizontal
          ? segment.size[0] / SOURCE_WIDTH
          : segment.size[2] / SOURCE_WIDTH,
        segment.size[1] / SOURCE_HEIGHT,
        Math.max(
          0.28,
          (horizontal ? segment.size[2] : segment.size[0])
            / SOURCE_DEPTH,
        ),
      );
      rotation.setFromAxisAngle(
        axis,
        horizontal ? 0 : Math.PI / 2,
      );
      wallMatrix.compose(translation, rotation, scale);

      parts.forEach((part, partIndex) => {
        matrix.copy(wallMatrix).multiply(part.matrix);
        meshSetMatrix(meshes[partIndex], instanceIndex, matrix);
      });
    }

    for (const mesh of meshes) {
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count > 0) {
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }, [count, meshes, parts, segments]);

  return (
    <>
      {meshes.map((mesh, index) => (
        <primitive key={index} object={mesh} dispose={null} />
      ))}
    </>
  );
}

function meshSetMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
) {
  matrix.toArray(
    mesh.instanceMatrix.array as Float32Array,
    index * 16,
  );
}

/** Uses the exact plaster material from the straight house-wall asset. */
export function useHouseFacadePlasterMaterial() {
  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
  // TIBIAGAME_STREAMING_FIX_V20
  // The facade material is immutable. One shared clone is sufficient for every
  // house opening instead of one clone/dispose cycle per door/window component.
  return useMemo(
    () => getSharedHousePlasterMaterial(gltf.scenes),
    [gltf.scenes],
  );
}

export function MedievalWindowShuttersAsset({
  window,
  building,
  wallHeight,
  onClick,
}: {
  window: WindowView;
  building: BuildingView;
  wallHeight: number;
  onClick: () => void;
}) {
  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
  const object = useAssetObject(gltf.scenes, window.open ? "WindowShutters_Wide_Flat_Open" : "WindowShutters_Wide_Flat_Closed");
  const transform = wallOpeningTransform(window.position, building);
  const longSize = 1.04;
  const thickness = 0.13;
  return (
    <group
      position={[transform.x, 0, transform.z]}
      rotation={[0, transform.rotation, 0]}
      scale={[longSize / SOURCE_WIDTH, wallHeight / SOURCE_HEIGHT, Math.max(0.28, thickness / SOURCE_DEPTH)]}
      onPointerDown={(event) => { event.stopPropagation(); onClick(); }}
    >
      <mesh position={[0, 1.78, 0.15]}>
        <planeGeometry args={[1.65, 1.75]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <primitive object={object} />
    </group>
  );
}

function useAssetObject(scenes: THREE.Group[], nodeName: string, hideWindowGlass = false, overrideTexture?: THREE.Texture | null) {
  const object = useMemo(() => {
    const source = scenes
      .map((scene) => scene.getObjectByName(nodeName))
      .find((candidate): candidate is THREE.Object3D => candidate !== undefined);
    if (!source) throw new Error(`Missing medieval asset node: ${nodeName}`);
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
      const clonedMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const plasterMaterial = clonedMaterials.find((material) => material.name.includes("Plaster")) as THREE.MeshStandardMaterial | undefined;
      const woodMaterial = clonedMaterials.find((material) => material.name.includes("WoodTrim")) as THREE.MeshStandardMaterial | undefined;
      clonedMaterials.forEach((material) => {
        if (overrideTexture !== undefined && "map" in material) {
          const standard = material as THREE.MeshStandardMaterial;
          if (overrideTexture) {
            standard.map = overrideTexture;
          } else {
            const shouldUsePlaster = material.name.includes("Plaster")
              || material.name.includes("Brick")
              || material.name.includes("RockTrim");
            const sourceMaterial = shouldUsePlaster
              ? plasterMaterial
              : material.name.includes("WoodTrim") ? woodMaterial : undefined;
            if (sourceMaterial && sourceMaterial !== standard) {
              // Door/window variants have extra brick/rock and worn-wood
              // material slots. Copy the straight wall's material channels so
              // both sides of the opening shade and color identically.
              standard.map = sourceMaterial.map;
              standard.normalMap = sourceMaterial.normalMap;
              standard.roughnessMap = sourceMaterial.roughnessMap;
              standard.metalnessMap = sourceMaterial.metalnessMap;
              standard.color.copy(sourceMaterial.color);
              standard.roughness = sourceMaterial.roughness;
              standard.metalness = sourceMaterial.metalness;
            }
          }
          standard.needsUpdate = true;
        }
      });
      child.geometry = child.geometry.clone();
      widenOpeningGeometry(child.geometry, nodeName);
      if (!hideWindowGlass) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter((material) => material.name.includes("WindowGlass")).forEach((material) => {
        material.transparent = true;
        material.opacity = 0;
        material.depthWrite = false;
        material.colorWrite = false;
      });
    });
    return clone;
  }, [hideWindowGlass, nodeName, overrideTexture, scenes]);
  useEffect(() => () => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [object]);
  return object;
}

function widenOpeningGeometry(geometry: THREE.BufferGeometry, nodeName: string) {
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) return;
  if (nodeName === "Wall_Plaster_Window_Wide_Flat") {
    remapOpeningEdges(position, 0.6, WINDOW_OPENING_HALF_WIDTH);
  } else if (nodeName === "WindowShutters_Wide_Flat_Closed") {
    for (let index = 0; index < position.count; index += 1) position.setX(index, position.getX(index) * 1.2);
  } else if (nodeName === "WindowShutters_Wide_Flat_Open") {
    const shift = WINDOW_OPENING_HALF_WIDTH - 0.6;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      position.setX(index, x + Math.sign(x) * shift);
    }
  } else {
    return;
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function remapOpeningEdges(position: THREE.BufferAttribute, sourceHalfWidth: number, targetHalfWidth: number) {
  const remainingSourceWall = 1 - sourceHalfWidth;
  const remainingTargetWall = 1 - targetHalfWidth;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const absoluteX = Math.abs(x);
    if (absoluteX < 0.001 || absoluteX > 1.001) continue;
    const distanceIntoWall = Math.max(0, absoluteX - sourceHalfWidth);
    const remapped = targetHalfWidth + distanceIntoWall * (remainingTargetWall / remainingSourceWall);
    position.setX(index, Math.sign(x) * Math.min(1, remapped));
  }
}

function wallOpeningTransform(position: { x: number; y: number }, building: BuildingView) {
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  if (position.y === building.y) return { x: position.x + 0.5, z: building.y, rotation: Math.PI };
  if (position.y === maxY - 1) return { x: position.x + 0.5, z: maxY, rotation: 0 };
  if (position.x === building.x) return { x: building.x, z: position.y + 0.5, rotation: -Math.PI / 2 };
  return { x: maxX, z: position.y + 0.5, rotation: Math.PI / 2 };
}

useLoader.preload(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
