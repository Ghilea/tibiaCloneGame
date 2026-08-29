import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BuildingView, WindowView } from "../protocol";
import { MedievalHouseWallAsset } from "./MedievalAssetModels";

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

export function GabledRoof({ building, wallHeight }: { building: BuildingView; wallHeight: number }) {
  const geometry = useMemo(() => roofGeometry(building.width + 0.55, building.height + 0.55), [building.width, building.height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group position={[building.x + building.width / 2, wallHeight + 0.02, building.y + building.height / 2]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={building.kind === "keep" ? "#45504d" : "#71372d"} roughness={0.91} side={THREE.DoubleSide} />
      </mesh>
      <Chimney x={building.width * 0.22} z={-building.height * 0.18} keep={building.kind === "keep"} />
    </group>
  );
}

function roofGeometry(width: number, depth: number) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const rise = Math.min(1.35, 0.62 + Math.min(width, depth) * 0.12);
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
    <group position={[x, 0.72, z]}>
      <mesh castShadow><boxGeometry args={[0.32, 1.45, 0.32]} /><meshStandardMaterial color={keep ? "#626b68" : "#704938"} roughness={1} /></mesh>
      <mesh position={[0, 0.76, 0]} castShadow><boxGeometry args={[0.42, 0.12, 0.42]} /><meshStandardMaterial color="#3c3731" roughness={1} /></mesh>
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
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const side = windowSide(window, building);
  const transform = windowTransform(window, building, side);
  useFrame((_, delta) => {
    const angle = window.open ? 1.42 : 0;
    if (left.current) left.current.rotation.y = THREE.MathUtils.damp(left.current.rotation.y, -angle, 11, delta);
    if (right.current) right.current.rotation.y = THREE.MathUtils.damp(right.current.rotation.y, angle, 11, delta);
  });
  return (
    <group position={[transform.x, wallHeight * 0.58, transform.z]} rotation={[0, transform.rotation, 0]} onPointerDown={(event) => { event.stopPropagation(); onClick(); }}>
      <mesh position={[0, 0, 0.16]}>
        <planeGeometry args={[0.78, 0.92]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <group ref={left} position={[-0.33, 0, 0.09]}>
        <ShutterLeaf offset={0.15} braceDirection={-1} />
      </group>
      <group ref={right} position={[0.33, 0, 0.09]}>
        <ShutterLeaf offset={-0.15} braceDirection={1} />
      </group>
    </group>
  );
}

function ShutterLeaf({ offset, braceDirection }: { offset: number; braceDirection: -1 | 1 }) {
  return (
    <group position={[offset, 0, 0]}>
      <mesh castShadow><boxGeometry args={[0.3, 0.72, 0.075]} /><meshStandardMaterial color="#5c3822" roughness={0.97} /></mesh>
      {[-0.23, 0, 0.23].map((y) => <mesh key={y} position={[0, y, 0.045]}><boxGeometry args={[0.32, 0.045, 0.035]} /><meshStandardMaterial color="#2f2118" /></mesh>)}
      <mesh position={[0, 0, 0.05]} rotation={[0, 0, braceDirection * 0.62]}><boxGeometry args={[0.72, 0.045, 0.035]} /><meshStandardMaterial color="#39271b" /></mesh>
    </group>
  );
}

export function HangingSign({ building, wallHeight }: { building: BuildingView; wallHeight: number }) {
  if (building.kind !== "house") return null;
  return (
    <group position={[building.x + building.width - 0.35, wallHeight * 0.72, building.y - 0.18]}>
      <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[0.55, 0.055, 0.055]} /><meshStandardMaterial color="#35251a" /></mesh>
      <mesh position={[0.2, -0.05, 0]} castShadow><boxGeometry args={[0.06, 0.55, 0.06]} /><meshStandardMaterial color="#2d2017" /></mesh>
      <mesh position={[0.2, -0.34, 0]} castShadow><boxGeometry args={[0.52, 0.34, 0.07]} /><meshStandardMaterial color="#785331" roughness={0.92} /></mesh>
    </group>
  );
}

function windowSide(window: WindowView, building: BuildingView) {
  if (window.position.y === building.y) return "north";
  if (window.position.y === building.y + building.height - 1) return "south";
  if (window.position.x === building.x) return "west";
  return "east";
}

function windowTransform(window: WindowView, building: BuildingView, side: ReturnType<typeof windowSide>) {
  if (side === "north") return { x: window.position.x + 0.5, z: building.y - 0.075, rotation: Math.PI };
  if (side === "south") return { x: window.position.x + 0.5, z: building.y + building.height + 0.075, rotation: 0 };
  if (side === "west") return { x: building.x - 0.075, z: window.position.y + 0.5, rotation: -Math.PI / 2 };
  return { x: building.x + building.width + 0.075, z: window.position.y + 0.5, rotation: Math.PI / 2 };
}
