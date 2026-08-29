import { useLoader } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  const object = useMemo(() => {
    const source = gltf.scenes
      .map((scene) => scene.getObjectByName(nodeNames[kind]))
      .find((candidate): candidate is THREE.Object3D => candidate !== undefined);
    if (!source) throw new Error(`Missing medieval asset node: ${nodeNames[kind]}`);
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });
    return clone;
  }, [gltf.scenes, kind]);

  useEffect(() => () => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }, [object]);

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

useLoader.preload(GLTFLoader, MEDIEVAL_VILLAGE_ASSET);
