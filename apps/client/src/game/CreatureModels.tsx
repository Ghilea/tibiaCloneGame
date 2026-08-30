import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type CreatureModelProps = {
  definitionId: string;
  immune: boolean;
  moving: MutableRefObject<boolean>;
};

export function CreatureModel({ definitionId, immune, moving }: CreatureModelProps) {
  if (definitionId === "castle_rat") return <RatModel immune={immune} moving={moving} />;
  if (["crypt_guard", "bone_acolyte", "cellar_warden"].includes(definitionId))
    return <UndeadModel kind={definitionId} immune={immune} moving={moving} />;
  return <MireBeastModel kind={definitionId} immune={immune} moving={moving} />;
}

function MireBeastModel({ kind, immune, moving }: { kind: string; immune: boolean; moving: MutableRefObject<boolean> }) {
  const root = useRef<THREE.Group>(null);
  const frontLegs = useRef<THREE.Group>(null);
  const backLegs = useRef<THREE.Group>(null);
  const phase = stablePhase(kind);
  const brute = kind === "fen_brute";
  const stalker = kind === "reed_stalker";
  const scale = brute ? 1.25 : stalker ? 1.05 : kind === "mire_skulker" ? 0.9 : 0.78;
  const skin = immune ? "#7f8b85" : brute ? "#536637" : stalker ? "#496f4b" : "#527944";

  useFrame(({ clock }, delta) => {
    const pace = moving.current ? Math.sin(clock.elapsedTime * 11 + phase) : Math.sin(clock.elapsedTime * 2.2 + phase) * 0.08;
    if (frontLegs.current) frontLegs.current.rotation.x = THREE.MathUtils.damp(frontLegs.current.rotation.x, pace * 0.42, 15, delta);
    if (backLegs.current) backLegs.current.rotation.x = THREE.MathUtils.damp(backLegs.current.rotation.x, -pace * 0.42, 15, delta);
    if (root.current) root.current.position.y = 0.03 + Math.abs(pace) * (moving.current ? 0.035 : 0.012);
  });

  return <group ref={root} scale={scale}>
    <mesh position={[0, 0.66, 0]} scale={[0.72, 0.58, 0.9]} castShadow receiveShadow>
      <sphereGeometry args={[0.55, 10, 8]} /><meshStandardMaterial color={skin} roughness={0.92} />
    </mesh>
    <mesh position={[0, 0.69, 0.55]} scale={[0.8, 0.72, 0.72]} castShadow>
      <dodecahedronGeometry args={[0.46, 1]} /><meshStandardMaterial color={skin} roughness={0.9} />
    </mesh>
    <mesh position={[0, 0.96, 0.26]} rotation={[0.45, 0, 0]} castShadow>
      <coneGeometry args={[0.2, 0.52, 7]} /><meshStandardMaterial color={immune ? "#88938e" : "#425833"} roughness={1} />
    </mesh>
    <MireFace brute={brute} />
    <group ref={frontLegs} position={[0, 0.48, 0.38]}><BeastLeg x={-0.35} /><BeastLeg x={0.35} /></group>
    <group ref={backLegs} position={[0, 0.48, -0.38]}><BeastLeg x={-0.35} /><BeastLeg x={0.35} /></group>
    {stalker && <>
      <mesh position={[-0.46, 1.02, 0.45]} rotation={[0.25, 0, -0.55]} castShadow><coneGeometry args={[0.09, 0.65, 7]} /><meshStandardMaterial color="#829066" roughness={1} /></mesh>
      <mesh position={[0.46, 1.02, 0.45]} rotation={[0.25, 0, 0.55]} castShadow><coneGeometry args={[0.09, 0.65, 7]} /><meshStandardMaterial color="#829066" roughness={1} /></mesh>
    </>}
  </group>;
}

function MireFace({ brute }: { brute: boolean }) {
  return <>
    <mesh position={[-0.18, 0.78, 0.93]}><sphereGeometry args={[0.055, 9, 7]} /><meshStandardMaterial color="#ff7b42" emissive="#a52d15" emissiveIntensity={2} /></mesh>
    <mesh position={[0.18, 0.78, 0.93]}><sphereGeometry args={[0.055, 9, 7]} /><meshStandardMaterial color="#ff7b42" emissive="#a52d15" emissiveIntensity={2} /></mesh>
    <mesh position={[0, 0.58, 0.96]} scale={[1.3, 0.5, 0.45]}><sphereGeometry args={[0.13, 8, 6]} /><meshStandardMaterial color="#273124" roughness={1} /></mesh>
    {brute && <>
      <mesh position={[-0.22, 0.48, 0.98]} rotation={[-0.2, 0, 0.13]}><coneGeometry args={[0.06, 0.34, 7]} /><meshStandardMaterial color="#d5c49b" roughness={0.75} /></mesh>
      <mesh position={[0.22, 0.48, 0.98]} rotation={[-0.2, 0, -0.13]}><coneGeometry args={[0.06, 0.34, 7]} /><meshStandardMaterial color="#d5c49b" roughness={0.75} /></mesh>
    </>}
  </>;
}

function BeastLeg({ x }: { x: number }) {
  return <group position={[x, 0, 0]}>
    <mesh position={[0, -0.2, 0]} castShadow><cylinderGeometry args={[0.1, 0.13, 0.48, 7]} /><meshStandardMaterial color="#3e5233" roughness={1} /></mesh>
    <mesh position={[0, -0.43, 0.08]} scale={[1.2, 0.55, 1.65]} castShadow><sphereGeometry args={[0.12, 7, 5]} /><meshStandardMaterial color="#283425" roughness={1} /></mesh>
  </group>;
}

function RatModel({ immune, moving }: { immune: boolean; moving: MutableRefObject<boolean> }) {
  const root = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const skin = immune ? "#7d8883" : "#695a4c";
  const tailCurve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.22, -0.36), new THREE.Vector3(0.25, 0.17, -0.67), new THREE.Vector3(0.42, 0.12, -0.9), new THREE.Vector3(0.25, 0.1, -1.05),
  ]), []);
  useFrame(({ clock }) => {
    if (root.current) root.current.position.y = 0.02 + Math.abs(Math.sin(clock.elapsedTime * (moving.current ? 15 : 3))) * (moving.current ? 0.035 : 0.008);
    if (tail.current) tail.current.rotation.y = Math.sin(clock.elapsedTime * 4) * 0.14;
  });
  return <group ref={root} scale={0.86}>
    <mesh position={[0, 0.31, 0]} scale={[0.58, 0.46, 0.82]} castShadow><sphereGeometry args={[0.45, 12, 8]} /><meshStandardMaterial color={skin} roughness={1} /></mesh>
    <mesh position={[0, 0.34, 0.43]} scale={[0.48, 0.45, 0.58]} castShadow><sphereGeometry args={[0.36, 10, 7]} /><meshStandardMaterial color={skin} roughness={1} /></mesh>
    {[-1, 1].map((side) => <group key={side}>
      <mesh position={[side * 0.22, 0.62, 0.39]} rotation={[0.12, 0, side * -0.18]} castShadow><sphereGeometry args={[0.14, 8, 6]} /><meshStandardMaterial color={skin} roughness={1} /></mesh>
      <mesh position={[side * 0.22, 0.62, 0.4]} scale={0.62}><sphereGeometry args={[0.14, 8, 6]} /><meshStandardMaterial color="#bd887d" roughness={0.9} /></mesh>
      <mesh position={[side * 0.12, 0.42, 0.72]}><sphereGeometry args={[0.035, 8, 6]} /><meshStandardMaterial color="#e9b34f" emissive="#9c521f" emissiveIntensity={1.4} /></mesh>
    </group>)}
    <mesh position={[0, 0.3, 0.78]}><sphereGeometry args={[0.065, 8, 6]} /><meshStandardMaterial color="#281d1a" roughness={0.8} /></mesh>
    <group ref={tail}><mesh><tubeGeometry args={[tailCurve, 12, 0.035, 6, false]} /><meshStandardMaterial color="#a3766d" roughness={1} /></mesh></group>
  </group>;
}

function UndeadModel({ kind, immune, moving }: { kind: string; immune: boolean; moving: MutableRefObject<boolean> }) {
  const root = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null); const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null); const rightArm = useRef<THREE.Group>(null);
  const warden = kind === "cellar_warden"; const acolyte = kind === "bone_acolyte";
  const bone = immune ? "#8c9691" : "#d4ccb0";
  useFrame(({ clock }, delta) => {
    const stride = moving.current ? Math.sin(clock.elapsedTime * (warden ? 7 : 9)) * 0.48 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = THREE.MathUtils.damp(leftLeg.current.rotation.x, stride, 14, delta);
    if (rightLeg.current) rightLeg.current.rotation.x = THREE.MathUtils.damp(rightLeg.current.rotation.x, -stride, 14, delta);
    if (leftArm.current) leftArm.current.rotation.x = THREE.MathUtils.damp(leftArm.current.rotation.x, -stride * 0.65, 12, delta);
    if (rightArm.current) rightArm.current.rotation.x = THREE.MathUtils.damp(rightArm.current.rotation.x, stride * 0.65, 12, delta);
    if (root.current) root.current.position.y = Math.abs(stride) * 0.025;
  });
  return <group ref={root} scale={warden ? 1.12 : 0.94}>
    <group ref={leftLeg} position={[-0.15, 0.62, 0]}><Bone length={0.63} color={bone} /><mesh position={[0, -0.32, 0.08]} scale={[1, 0.6, 1.7]}><boxGeometry args={[0.16, 0.1, 0.2]} /><meshStandardMaterial color={bone} /></mesh></group>
    <group ref={rightLeg} position={[0.15, 0.62, 0]}><Bone length={0.63} color={bone} /><mesh position={[0, -0.32, 0.08]} scale={[1, 0.6, 1.7]}><boxGeometry args={[0.16, 0.1, 0.2]} /><meshStandardMaterial color={bone} /></mesh></group>
    <mesh position={[0, 1.08, 0]} scale={[0.8, 1, 0.48]} castShadow><dodecahedronGeometry args={[0.38, 0]} /><meshStandardMaterial color={warden ? "#4d5350" : acolyte ? "#4a334d" : "#4b5050"} roughness={0.85} metalness={warden ? 0.55 : 0.15} /></mesh>
    <mesh position={[0, 1.58, 0.03]} scale={[0.86, 1, 0.84]} castShadow><sphereGeometry args={[0.3, 10, 8]} /><meshStandardMaterial color={bone} roughness={0.9} /></mesh>
    <mesh position={[0, 1.49, 0.26]} scale={[0.8, 0.48, 0.42]}><boxGeometry args={[0.31, 0.19, 0.2]} /><meshStandardMaterial color={bone} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.11, 1.64, 0.27]}><sphereGeometry args={[0.055, 8, 6]} /><meshStandardMaterial color="#78d6b0" emissive="#21835d" emissiveIntensity={2.2} /></mesh>)}
    <group ref={leftArm} position={[-0.4, 1.25, 0]} rotation={[0, 0, -0.13]}><Bone length={0.72} color={bone} /></group>
    <group ref={rightArm} position={[0.4, 1.25, 0]} rotation={[0, 0, 0.13]}><Bone length={0.72} color={bone} />{!acolyte && <mesh position={[0, -0.57, 0.19]} rotation={[Math.PI / 2, 0, 0]} castShadow><boxGeometry args={[0.08, 0.12, 0.85]} /><meshStandardMaterial color="#9ca6a4" metalness={0.8} roughness={0.35} /></mesh>}</group>
    {acolyte && <group position={[0.5, 0.85, 0.12]} rotation={[0, 0, -0.08]}><mesh><cylinderGeometry args={[0.035, 0.045, 1.75, 7]} /><meshStandardMaterial color="#513823" /></mesh><mesh position={[0, 0.93, 0]}><octahedronGeometry args={[0.14]} /><meshStandardMaterial color="#7ad9b4" emissive="#248767" emissiveIntensity={2} /></mesh></group>}
    {warden && <mesh position={[0, 1.9, -0.01]} castShadow><coneGeometry args={[0.36, 0.4, 8]} /><meshStandardMaterial color="#363c3b" metalness={0.6} roughness={0.55} /></mesh>}
  </group>;
}

function Bone({ length, color }: { length: number; color: string }) {
  return <mesh position={[0, -length / 2, 0]} castShadow><cylinderGeometry args={[0.055, 0.07, length, 7]} /><meshStandardMaterial color={color} roughness={0.88} /></mesh>;
}

function stablePhase(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash % 628) / 100;
}
