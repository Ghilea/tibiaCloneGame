import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BuildingView, WindowView } from "../protocol";
import { MedievalHouseWallAsset, MedievalWindowShuttersAsset } from "./MedievalAssetModels";

export function MedievalWall({
  position,
  size,
  keep,
}: {
  position: [number, number, number];
  size: [number, number, number];
  keep: boolean;
}) {
  if (keep) return <CastleMasonry position={position} size={size} />;
  return <MedievalHouseWallAsset kind="solid" position={position} size={size} />;
}

export function MedievalWindowWall({
  position,
  size,
}: {
  position: [number, number, number];
  size: [number, number, number];
}) {
  return <MedievalHouseWallAsset kind="window" position={position} size={size} />;
}

export function MedievalDoorWall({
  position,
  size,
  keep,
  openingHeight,
}: {
  position: [number, number, number];
  size: [number, number, number];
  keep: boolean;
  openingHeight: number;
}) {
  if (!keep) return <MedievalHouseWallAsset kind="door" position={position} size={size} />;
  const horizontal = size[0] > size[2];
  const openingWidth = 0.98;
  const sideWidth = Math.max(0.08, (Math.max(size[0], size[2]) - openingWidth) / 2);
  const topHeight = Math.max(0.12, size[1] - openingHeight);
  const wallColor = keep ? "#6d7773" : "#aa987c";
  const frameColor = keep ? "#4b5552" : "#4b3020";
  return (
    <group position={[position[0], 0, position[2]]}>
      <mesh position={horizontal ? [-openingWidth / 2 - sideWidth / 2, size[1] / 2, 0] : [0, size[1] / 2, -openingWidth / 2 - sideWidth / 2]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [sideWidth, size[1], size[2]] : [size[0], size[1], sideWidth]} />
        <meshStandardMaterial color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={horizontal ? [openingWidth / 2 + sideWidth / 2, size[1] / 2, 0] : [0, size[1] / 2, openingWidth / 2 + sideWidth / 2]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [sideWidth, size[1], size[2]] : [size[0], size[1], sideWidth]} />
        <meshStandardMaterial color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={[0, openingHeight + topHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [openingWidth, topHeight, size[2]] : [size[0], topHeight, openingWidth]} />
        <meshStandardMaterial color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={horizontal ? [0, openingHeight, size[2] * 0.6] : [size[0] * 0.6, openingHeight, 0]} castShadow>
        <boxGeometry args={horizontal ? [openingWidth + 0.16, 0.13, 0.08] : [0.08, 0.13, openingWidth + 0.16]} />
        <meshStandardMaterial color={frameColor} roughness={0.94} />
      </mesh>
    </group>
  );
}

function CastleMasonry({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  const horizontal = size[0] > size[2];
  const courses = Math.max(3, Math.floor(size[1] / 0.38));
  return (
    <group position={position}>
      <mesh castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color="#6d7773" roughness={1} /></mesh>
      {Array.from({ length: courses }, (_, row) => {
        const y = -size[1] / 2 + (row + 1) * (size[1] / (courses + 1));
        return <mesh key={row} position={horizontal ? [0, y, size[2] * 0.54] : [size[0] * 0.54, y, 0]}><boxGeometry args={horizontal ? [size[0] + 0.02, 0.018, 0.025] : [0.025, 0.018, size[2] + 0.02]} /><meshStandardMaterial color="#3f4946" roughness={1} /></mesh>;
      })}
    </group>
  );
}

export function GabledRoof({ building, wallHeight, roofVisible = true, roofFade = 1 }: { building: BuildingView; wallHeight: number; roofVisible?: boolean; roofFade?: number }) {
  const geometry = useMemo(() => roofGeometry(building.width + 0.7, building.height + 0.7), [building.width, building.height]);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    if (!material.current) return;
    material.current.opacity = THREE.MathUtils.damp(material.current.opacity, roofFade, 10, delta);
    material.current.depthWrite = material.current.opacity > 0.5;
  });
  return (
    <group position={[building.x + building.width / 2, wallHeight + 0.02, building.y + building.height / 2]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial ref={material} color={building.kind === "keep" ? "#45504d" : "#71372d"} roughness={0.91} side={THREE.DoubleSide} transparent opacity={roofFade} />
      </mesh>
      {roofVisible && <Chimney x={building.width * 0.22} z={-building.height * 0.18} keep={building.kind === "keep"} />}
    </group>
  );
}

function roofGeometry(width: number, depth: number) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const rise = Math.min(1.65, 0.72 + Math.min(width, depth) * 0.14);
  const ridgeAlongZ = depth >= width;
  const vertices = ridgeAlongZ
    ? [
        -halfWidth, 0, -halfDepth, -halfWidth, 0, halfDepth, 0, rise, halfDepth, 0, rise, -halfDepth,
        halfWidth, 0, halfDepth, halfWidth, 0, -halfDepth, 0, rise, -halfDepth, 0, rise, halfDepth,
        -halfWidth, 0, -halfDepth, 0, rise, -halfDepth, halfWidth, 0, -halfDepth,
        -halfWidth, 0, halfDepth, halfWidth, 0, halfDepth, 0, rise, halfDepth,
      ]
    : [
        -halfWidth, 0, -halfDepth, halfWidth, 0, -halfDepth, halfWidth, rise, 0, -halfWidth, rise, 0,
        halfWidth, 0, halfDepth, -halfWidth, 0, halfDepth, -halfWidth, rise, 0, halfWidth, rise, 0,
        -halfWidth, 0, -halfDepth, -halfWidth, rise, 0, -halfWidth, 0, halfDepth,
        halfWidth, 0, -halfDepth, halfWidth, 0, halfDepth, halfWidth, rise, 0,
      ];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Chimney({ x, z, keep }: { x: number; z: number; keep: boolean }) {
  return (
    <group position={[x, 0.84, z]}>
      <mesh castShadow><boxGeometry args={[0.37, 1.7, 0.37]} /><meshStandardMaterial color={keep ? "#626b68" : "#704938"} roughness={1} /></mesh>
      <mesh position={[0, 0.89, 0]} castShadow><boxGeometry args={[0.48, 0.14, 0.48]} /><meshStandardMaterial color="#3c3731" roughness={1} /></mesh>
    </group>
  );
}

export function ShutterWindow({
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
  return <MedievalWindowShuttersAsset window={window} building={building} wallHeight={wallHeight} onClick={onClick} />;
}

export function HangingSign({ building, wallHeight }: { building: BuildingView; wallHeight: number }) {
  if (building.kind !== "house") return null;
  return (
    <group position={[building.x + building.width - 0.35, wallHeight * 0.72, building.y - 0.18]} scale={1.15}>
      <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[0.55, 0.055, 0.055]} /><meshStandardMaterial color="#35251a" /></mesh>
      <mesh position={[0.2, -0.05, 0]} castShadow><boxGeometry args={[0.06, 0.55, 0.06]} /><meshStandardMaterial color="#2d2017" /></mesh>
      <mesh position={[0.2, -0.34, 0]} castShadow><boxGeometry args={[0.52, 0.34, 0.07]} /><meshStandardMaterial color="#785331" roughness={0.92} /></mesh>
    </group>
  );
}
