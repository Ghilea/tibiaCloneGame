import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BuildingView, DoorView, WindowView } from "../protocol";

const MEDIEVAL_VILLAGE_ASSET = "/assets/models/aldoria-medieval-village.glb";
const SOURCE_HEIGHT = 3.1227;
const SOURCE_WIDTH = 2;
const SOURCE_DEPTH = 0.314;

export type MedievalHouseWallKind = "solid" | "door" | "window";

const nodeNames: Record<MedievalHouseWallKind, string> = {
  solid: "Wall_Plaster_Straight",
  door: "Wall_Plaster_Door_Flat",
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

export function MedievalDoorLeafAsset({
  door,
  building,
  wallHeight,
  onClick,
}: {
  door: DoorView;
  building: BuildingView;
  wallHeight: number;
  onClick: () => void;
}) {
  const gltf = useLoader(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
  const object = useAssetObject(gltf.scenes, "Door_1_Flat", true);
  const hinge = useRef<THREE.Group>(null);
  const transform = wallOpeningTransform(door.position, building);
  useFrame((_, delta) => {
    if (hinge.current) hinge.current.rotation.y = THREE.MathUtils.damp(hinge.current.rotation.y, door.open ? -Math.PI / 2 : 0, 12, delta);
  });
  return (
    <group
      position={[transform.x, 0, transform.z]}
      rotation={[0, transform.rotation, 0]}
      scale={[1.04 / SOURCE_WIDTH, wallHeight / SOURCE_HEIGHT, Math.max(0.28, 0.13 / SOURCE_DEPTH)]}
      onPointerDown={(event) => { event.stopPropagation(); onClick(); }}
    >
      <group ref={hinge} position={[-0.648, 0, 0]}>
        <primitive object={object} scale={[1.17, 1, 1]} />
      </group>
    </group>
  );
}

function useAssetObject(scenes: THREE.Group[], nodeName: string, hideWindowGlass = false) {
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
  }, [hideWindowGlass, nodeName, scenes]);
  useEffect(() => () => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [object]);
  return object;
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
