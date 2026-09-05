import { useFrame, useLoader } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BuildingView, WindowView } from "../protocol";
import { HOUSE_DOOR_PLACEMENT, type DoorwayLayout, type FacadeOpeningLayout } from "./DoorwayLayout";
import { InstancedMedievalHouseWalls, MedievalHouseWallAsset, useHouseFacadePlasterMaterial } from "./MedievalAssetModels";

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

export function InstancedHouseWalls({ segments }: { segments: readonly { position: [number, number, number]; size: [number, number, number] }[] }) {
  return <InstancedMedievalHouseWalls segments={segments} />;
}

export function HousePlinth({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  const texture = useLoader(THREE.TextureLoader, "/assets/world/aldoria-castle-stone-v2.png");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const horizontal = size[0] > size[2];
  return (
    <mesh position={[position[0], 0.27, position[2]]} castShadow receiveShadow>
      <boxGeometry args={horizontal ? [size[0], 0.54, 0.24] : [0.24, 0.54, size[2]]} />
      <meshStandardMaterial map={texture} color="#9fa29a" roughness={0.98} />
    </mesh>
  );
}

export function InstancedHousePlinths({ segments }: { segments: readonly { position: [number, number, number]; size: [number, number, number] }[] }) {
  const texture = useLoader(THREE.TextureLoader, "/assets/world/aldoria-castle-stone-v2.png");
  const horizontal = useMemo(() => segments.filter((segment) => segment.size[0] > segment.size[2]), [segments]);
  const vertical = useMemo(() => segments.filter((segment) => segment.size[0] <= segment.size[2]), [segments]);
  const horizontalMesh = useRef<THREE.InstancedMesh>(null);
  const verticalMesh = useRef<THREE.InstancedMesh>(null);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    horizontal.forEach((segment, index) => {
      if (!horizontalMesh.current) return;
      matrix.makeTranslation(segment.position[0], 0.27, segment.position[2]);
      horizontalMesh.current.setMatrixAt(index, matrix); horizontalMesh.current.instanceMatrix.needsUpdate = true;
    });
    vertical.forEach((segment, index) => {
      if (!verticalMesh.current) return;
      matrix.makeTranslation(segment.position[0], 0.27, segment.position[2]);
      verticalMesh.current.setMatrixAt(index, matrix); verticalMesh.current.instanceMatrix.needsUpdate = true;
    });
    [horizontalMesh.current, verticalMesh.current].forEach((mesh) => mesh?.computeBoundingSphere());
  }, [horizontal, vertical]);
  return <>
    {horizontal.length > 0 && <instancedMesh ref={horizontalMesh} args={[undefined, undefined, horizontal.length]} castShadow receiveShadow><boxGeometry args={[1.04, 0.54, 0.24]} /><meshStandardMaterial map={texture} color="#9fa29a" roughness={0.98} /></instancedMesh>}
    {vertical.length > 0 && <instancedMesh ref={verticalMesh} args={[undefined, undefined, vertical.length]} castShadow receiveShadow><boxGeometry args={[0.24, 0.54, 1.04]} /><meshStandardMaterial map={texture} color="#9fa29a" roughness={0.98} /></instancedMesh>}
  </>;
}

export function HouseDoorway({
  position,
  size,
  wallRotation,
  layout,
  open,
  onClick,
}: {
  position: [number, number, number];
  size: [number, number, number];
  wallRotation: number;
  layout: DoorwayLayout;
  open: boolean;
  onClick: () => void;
}) {
  const horizontal = size[0] > size[2];
  const thickness = horizontal ? size[2] : size[0];
  const plaster = useLoader(THREE.TextureLoader, "/assets/world/aldoria-timber-plaster-v1.png");
  const stone = useLoader(THREE.TextureLoader, "/assets/world/aldoria-castle-stone-v2.png");
  const hinge = useRef<THREE.Group>(null);
  plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;
  plaster.colorSpace = THREE.SRGBColorSpace;
  stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
  stone.colorSpace = THREE.SRGBColorSpace;
  useFrame((_, delta) => {
    // A right-angle swing keeps the leaf attached to its hinge and within the
    // doorway's immediate reveal; there is intentionally no open-state shift.
    if (hinge.current) hinge.current.rotation.y = THREE.MathUtils.damp(
      hinge.current.rotation.y,
      open ? HOUSE_DOOR_PLACEMENT.outwardOpenAngle : HOUSE_DOOR_PLACEMENT.closedAngle,
      14,
      delta,
    );
  });
  const sideCenter = layout.openingWidth / 2 + layout.wallSideWidth / 2;
  const wallHeightAboveBase = size[1] - layout.plinthHeight;
  return (
    <group position={[position[0], 0, position[2]]} rotation={[0, wallRotation, 0]} onPointerDown={(event) => { event.stopPropagation(); onClick(); }}>
      {/* These five facade pieces are the wall cutout. Nothing is rendered in
          x=-openingWidth/2..openingWidth/2, y=openingBottom..openingTop. */}
      {layout.wallSideWidth > 0 && <>
        <mesh position={[-sideCenter, layout.plinthHeight + wallHeightAboveBase / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[layout.wallSideWidth, wallHeightAboveBase, thickness]} />
          <meshStandardMaterial map={plaster} color="#b79d79" roughness={0.96} />
        </mesh>
        <mesh position={[sideCenter, layout.plinthHeight + wallHeightAboveBase / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[layout.wallSideWidth, wallHeightAboveBase, thickness]} />
          <meshStandardMaterial map={plaster} color="#b79d79" roughness={0.96} />
        </mesh>
        <mesh position={[-sideCenter, layout.plinthHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[layout.wallSideWidth, layout.plinthHeight, thickness + 0.08]} />
          <meshStandardMaterial map={stone} color="#9fa29a" roughness={0.98} />
        </mesh>
        <mesh position={[sideCenter, layout.plinthHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[layout.wallSideWidth, layout.plinthHeight, thickness + 0.08]} />
          <meshStandardMaterial map={stone} color="#9fa29a" roughness={0.98} />
        </mesh>
      </>}
      {layout.wallTopHeight > 0 && <mesh position={[0, layout.openingTop + layout.wallTopHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[layout.openingWidth, layout.wallTopHeight, thickness]} />
        <meshStandardMaterial map={plaster} color="#b79d79" roughness={0.96} />
      </mesh>}
      {/* Frame and threshold derive from the same inner rectangle, rather than
          compensating for a different door-wall asset. */}
      <mesh position={[-layout.openingWidth / 2 - layout.frameThickness / 2, layout.openingBottom + layout.openingHeight / 2, -layout.frameDepth / 2]} castShadow receiveShadow>
        <boxGeometry args={[layout.frameThickness, layout.openingHeight, layout.frameDepth]} /><meshStandardMaterial color="#52361f" roughness={0.9} />
      </mesh>
      <mesh position={[layout.openingWidth / 2 + layout.frameThickness / 2, layout.openingBottom + layout.openingHeight / 2, -layout.frameDepth / 2]} castShadow receiveShadow>
        <boxGeometry args={[layout.frameThickness, layout.openingHeight, layout.frameDepth]} /><meshStandardMaterial color="#52361f" roughness={0.9} />
      </mesh>
      <mesh position={[0, layout.openingTop + layout.frameThickness / 2, -layout.frameDepth / 2]} castShadow receiveShadow>
        <boxGeometry args={[layout.openingWidth + layout.frameThickness * 2, layout.frameThickness, layout.frameDepth]} /><meshStandardMaterial color="#52361f" roughness={0.9} />
      </mesh>
      <mesh position={[0, layout.thresholdHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[layout.openingWidth, layout.thresholdHeight, thickness + 0.13]} /><meshStandardMaterial color="#493321" roughness={0.9} />
      </mesh>
      <group ref={hinge} position={[-layout.leafWidth / 2, layout.openingBottom + 0.04, -layout.leafDepth / 2]} userData={{ hingeSide: HOUSE_DOOR_PLACEMENT.hingeSide, opensOutward: true }}>
        <mesh position={[layout.leafWidth / 2, layout.leafHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[layout.leafWidth, layout.leafHeight, layout.leafDepth]} /><meshStandardMaterial color="#654128" roughness={0.82} />
        </mesh>
        {[0.2, 0.5, 0.8].map((fraction) => <mesh key={fraction} position={[layout.leafWidth / 2, layout.leafHeight * fraction, -layout.leafDepth / 2 - 0.008]} castShadow>
          <boxGeometry args={[layout.leafWidth * 0.9, 0.045, 0.025]} /><meshStandardMaterial color="#3e2719" roughness={0.9} />
        </mesh>)}
        <mesh position={[layout.leafWidth * 0.84, layout.leafHeight * 0.52, -layout.leafDepth / 2 - 0.035]}><sphereGeometry args={[0.04, 10, 8]} /><meshStandardMaterial color="#d6aa54" metalness={0.65} roughness={0.35} /></mesh>
      </group>
      <mesh position={[0, layout.openingBottom + layout.openingHeight / 2, -0.32]}>
        <planeGeometry args={[layout.openingWidth, layout.openingHeight]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

export function HouseWindowOpening({
  position,
  size,
  wallRotation,
  layout,
  open,
  onClick,
}: {
  position: [number, number, number];
  size: [number, number, number];
  wallRotation: number;
  layout: FacadeOpeningLayout;
  open: boolean;
  onClick: () => void;
}) {
  const horizontal = size[0] > size[2];
  const thickness = horizontal ? size[2] : size[0];
  const plaster = useHouseFacadePlasterMaterial();
  const leftShutter = useRef<THREE.Group>(null);
  const rightShutter = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    const angle = open ? Math.PI * 0.58 : 0;
    if (leftShutter.current) leftShutter.current.rotation.y = THREE.MathUtils.damp(leftShutter.current.rotation.y, angle, 14, delta);
    if (rightShutter.current) rightShutter.current.rotation.y = THREE.MathUtils.damp(rightShutter.current.rotation.y, -angle, 14, delta);
  });
  const sideCenter = layout.openingWidth / 2 + layout.wallSideWidth / 2;
  const lowerHeight = layout.openingBottom - layout.plinthHeight;
  const sillY = layout.openingBottom - layout.frameThickness / 2;
  return <group position={[position[0], 0, position[2]]} rotation={[0, wallRotation, 0]} onPointerDown={(event) => { event.stopPropagation(); onClick(); }}>
    {/* The window uses the same explicit opening rectangle as the door: wall
        panels surround it, never sit behind it. */}
    <mesh position={[-sideCenter, layout.plinthHeight + (size[1] - layout.plinthHeight) / 2, 0]} castShadow receiveShadow material={plaster}><boxGeometry args={[layout.wallSideWidth, size[1] - layout.plinthHeight, thickness]} /></mesh>
    <mesh position={[sideCenter, layout.plinthHeight + (size[1] - layout.plinthHeight) / 2, 0]} castShadow receiveShadow material={plaster}><boxGeometry args={[layout.wallSideWidth, size[1] - layout.plinthHeight, thickness]} /></mesh>
    {lowerHeight > 0 && <mesh position={[0, layout.plinthHeight + lowerHeight / 2, 0]} castShadow receiveShadow material={plaster}><boxGeometry args={[layout.openingWidth, lowerHeight, thickness]} /></mesh>}
    {layout.wallTopHeight > 0 && <mesh position={[0, layout.openingTop + layout.wallTopHeight / 2, 0]} castShadow receiveShadow material={plaster}><boxGeometry args={[layout.openingWidth, layout.wallTopHeight, thickness]} /></mesh>}
    <mesh position={[0, sillY, -layout.frameDepth / 2]} castShadow receiveShadow><boxGeometry args={[layout.openingWidth + layout.frameThickness * 2, layout.frameThickness, layout.frameDepth]} /><meshStandardMaterial color="#52361f" roughness={0.9} /></mesh>
    <mesh position={[0, layout.openingTop + layout.frameThickness / 2, -layout.frameDepth / 2]} castShadow receiveShadow><boxGeometry args={[layout.openingWidth + layout.frameThickness * 2, layout.frameThickness, layout.frameDepth]} /><meshStandardMaterial color="#52361f" roughness={0.9} /></mesh>
    {[[-1, leftShutter], [1, rightShutter]].map(([direction, ref]) => <group key={String(direction)} ref={ref as React.RefObject<THREE.Group>} position={[Number(direction) * layout.openingWidth / 2, layout.openingBottom + layout.leafHeight / 2, -layout.leafDepth / 2]}>
      <mesh position={[-Number(direction) * layout.leafWidth / 2, 0, 0]} castShadow receiveShadow><boxGeometry args={[layout.leafWidth, layout.leafHeight, layout.leafDepth]} /><meshStandardMaterial color="#5b3822" roughness={0.85} /></mesh>
    </group>)}
    <mesh position={[0, layout.openingBottom + layout.openingHeight / 2, -0.3]}><planeGeometry args={[layout.openingWidth, layout.openingHeight]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} /></mesh>
  </group>;
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
  const castleTexture = useLoader(THREE.TextureLoader, "/assets/world/aldoria-castle-stone-v2.png");
  castleTexture.wrapS = castleTexture.wrapT = THREE.RepeatWrapping;
  castleTexture.colorSpace = THREE.SRGBColorSpace;
  // House openings are generated by HouseDoorway. This component remains only
  // for the keep's masonry portal.
  if (!keep) return null;
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
        <meshStandardMaterial map={castleTexture} color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={horizontal ? [openingWidth / 2 + sideWidth / 2, size[1] / 2, 0] : [0, size[1] / 2, openingWidth / 2 + sideWidth / 2]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [sideWidth, size[1], size[2]] : [size[0], size[1], sideWidth]} />
        <meshStandardMaterial map={castleTexture} color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={[0, openingHeight + topHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [openingWidth, topHeight, size[2]] : [size[0], topHeight, openingWidth]} />
        <meshStandardMaterial map={castleTexture} color={wallColor} roughness={0.97} />
      </mesh>
      <mesh position={horizontal ? [0, openingHeight, size[2] * 0.6] : [size[0] * 0.6, openingHeight, 0]} castShadow>
        <boxGeometry args={horizontal ? [openingWidth + 0.16, 0.13, 0.08] : [0.08, 0.13, openingWidth + 0.16]} />
        <meshStandardMaterial color={frameColor} roughness={0.94} />
      </mesh>
    </group>
  );
}

function CastleMasonry({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  const texture = useLoader(THREE.TextureLoader, "/assets/world/aldoria-castle-stone-v2.png");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial map={texture} color="#6d7773" roughness={1} />
    </mesh>
  );
}

export const GabledRoof = memo(function GabledRoof({ building, wallHeight, roofVisible = true, roofFade = 1 }: { building: BuildingView; wallHeight: number; roofVisible?: boolean; roofFade?: number }) {
  const geometry = useMemo(() => roofGeometry(building.width + 0.7, building.height + 0.7), [building.width, building.height]);
  const texture = useLoader(THREE.TextureLoader, "/assets/world/aldoria-roof-tiles-v1.png");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    if (!material.current) return;
    const occlusionOpacity = material.current.userData.occlusionOpacity as number | undefined;
    const targetOpacity = Math.min(roofFade, occlusionOpacity ?? 1);
    material.current.opacity = THREE.MathUtils.damp(material.current.opacity, targetOpacity, 10, delta);
    material.current.depthWrite = material.current.opacity > 0.5;
  });
  return (
    <group
      position={[building.x + building.width / 2, wallHeight + 0.02, building.y + building.height / 2]}
      userData={{ occluder: true, occluderKind: "roof", buildingId: building.id }}
    >
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial ref={material} map={texture} color={building.kind === "keep" ? "#45504d" : "#71372d"} roughness={0.91} side={THREE.DoubleSide} transparent opacity={roofFade} />
      </mesh>
      <group visible={roofVisible}><Chimney x={building.width * 0.22} z={-building.height * 0.18} keep={building.kind === "keep"} /></group>
    </group>
  );
});

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
  const uvs: number[] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    uvs.push(vertices[index] / width + 0.5, vertices[index + 1] / rise);
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Chimney({ x, z, keep }: { x: number; z: number; keep: boolean }) {
  return (
    <group position={[x, 0.84, z]}>
      <mesh><boxGeometry args={[0.37, 1.7, 0.37]} /><meshStandardMaterial color={keep ? "#626b68" : "#704938"} roughness={1} /></mesh>
      <mesh position={[0, 0.89, 0]}><boxGeometry args={[0.48, 0.14, 0.48]} /><meshStandardMaterial color="#3c3731" roughness={1} /></mesh>
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
  // Legacy export retained for non-house callers. House facades compose the
  // opening and shutters together through HouseWindowOpening.
  return null;
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


// TIBIAGAME_STREAMING_FIX_V5
[
  "/assets/world/aldoria-castle-stone-v2.png",
  "/assets/world/aldoria-timber-plaster-v1.png",
  "/assets/world/aldoria-roof-tiles-v1.png",
].forEach((assetPath) => useLoader.preload(THREE.TextureLoader, assetPath));
