import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  BuildingView,
  CreatureView,
  DoorView,
  NpcView,
  PlayerView,
  Position,
  WindowView,
} from "../protocol";
import { InputController } from "./InputController";
import { GabledRoof, HangingSign, MedievalDoorWall, MedievalWall, MedievalWindowWall, ShutterWindow } from "./MedievalModels";
import { WorldState } from "./WorldState";

const TILE_HEIGHT = 0.12;
const WALL_HEIGHT = 2.75;
const CASTLE_HEIGHT = 3.25;
const CAMERA_ZOOM = 135;

type ThreeWorldProps = {
  world: WorldState;
  input: InputController;
};

export function ThreeWorld({ world, input }: ThreeWorldProps) {
  return (
    <Canvas
      className="three-world"
      orthographic
      shadows
      dpr={[1, 1.6]}
      camera={{ near: 0.1, far: 180, position: [12, 16, 12], zoom: CAMERA_ZOOM }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.setClearColor(0x0b1210);
      }}
    >
      <WorldScene world={world} input={input} />
    </Canvas>
  );
}

function WorldScene({ world, input }: ThreeWorldProps) {
  const map = world.map;
  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : undefined;
  const floor = local?.position.z ?? map?.floor ?? 0;
  const players = [...world.players.values()].filter((entry) => entry.position.z === floor);
  const creatures = [...world.creatures.values()].filter((entry) => entry.position.z === floor);
  const npcs = [...world.npcs.values()].filter((entry) => entry.position.z === floor);

  useEffect(() => input.attach(), [input]);

  if (!map) return null;
  const onGround = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    input.interactAt({
      x: Math.max(0, Math.min(map.width - 1, Math.floor(event.point.x))),
      y: Math.max(0, Math.min(map.height - 1, Math.floor(event.point.z))),
      z: floor,
    });
  }, [floor, input, map.height, map.width]);

  return (
    <>
      <Atmosphere torches={map.torches.filter((tile) => tile.z === floor)} local={local?.position} />
      <FollowCamera target={local?.position} mapWidth={map.width} mapHeight={map.height} />
      <Terrain map={map} floor={floor} onGround={onGround} />
      <Suspense fallback={null}>
        <Structures map={map} input={input} floor={floor} />
      </Suspense>
      <OcclusionController target={local?.position} />
      {players.map((player) => (
        <PlayerActor
          key={player.id}
          player={player}
          local={player.id === world.localPlayerId}
          selected={player.id === world.selectedPlayerId}
          onClick={(event) => {
            event.stopPropagation();
            if (player.id !== world.localPlayerId)
              input.interactPlayer(player.id, event.nativeEvent.clientX, event.nativeEvent.clientY);
          }}
        />
      ))}
      {creatures.map((creature) => (
        <CreatureActor
          key={creature.id}
          creature={creature}
          selected={creature.id === world.attackTargetId}
          onClick={(event) => {
            event.stopPropagation();
            input.targetCreature(creature.id);
          }}
        />
      ))}
      {npcs.map((npc) => (
        <NpcActor
          key={npc.id}
          npc={npc}
          onClick={(event) => {
            event.stopPropagation();
            input.interactNpc(npc.id);
          }}
        />
      ))}
      {world.groundItems
        .filter((entry) => entry.position.z === floor)
        .map((entry) => (
          <GroundItemActor
            key={entry.item.instanceId}
            position={entry.position}
            corpse={entry.contents.length > 0}
            onClick={(event) => {
              event.stopPropagation();
              input.interactAt(entry.position);
            }}
          />
        ))}
      <Weather local={local?.position} floor={floor} />
    </>
  );
}

const Terrain = memo(function Terrain({
  map,
  floor,
  onGround,
}: {
  map: NonNullable<WorldState["map"]>;
  floor: number;
  onGround: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const onFloor = (positions: readonly Position[]) => positions.filter((tile) => tile.z === floor);
  const materials = new Map(map.terrainMaterials.filter((entry) => entry.position.z === floor).map((entry) => [`${entry.position.x}:${entry.position.y}`, entry.material]));
  const materialTiles = (id: string) => [...materials.entries()].filter(([, value]) => value === id).map(([key]) => {
    const [x, y] = key.split(":").map(Number);
    return { x, y, z: floor };
  });
  const blocked = new Set(map.blocked.filter((tile) => tile.z === floor).map(tileKey));
  const visibleRocks = map.blocked.filter((tile) => tile.z === floor && !blockedByStructure(map, tile));

  return (
    <group>
      <mesh receiveShadow position={[map.width / 2, -0.12, map.height / 2]} onPointerDown={onGround}>
        <boxGeometry args={[map.width, 0.2, map.height]} />
        <meshStandardMaterial color="#4e7047" roughness={0.96} />
      </mesh>
      <InstancedTiles positions={onFloor(map.roads)} color="#7b674a" height={0.035} y={0.015} />
      <InstancedTiles positions={onFloor(map.floors)} color="#827a68" height={0.045} y={0.025} />
      <InstancedTiles positions={materialTiles("packed_earth")} color="#73573d" height={0.048} y={0.03} />
      <InstancedTiles positions={materialTiles("moss_stone")} color="#59665b" height={0.052} y={0.034} />
      <InstancedTiles positions={materialTiles("sandstone")} color="#ad976e" height={0.052} y={0.034} />
      <WaterTiles positions={onFloor(map.water)} />
      <InstancedTiles positions={onFloor(map.bridges)} color="#795334" height={0.14} y={0.09} />
      <InstancedTiles positions={visibleRocks} color="#626d66" height={0.55} y={0.275} scale={0.72} castShadow />
    </group>
  );
}, (previous, next) => previous.floor === next.floor
  && previous.onGround === next.onGround
  && previous.map.width === next.map.width
  && previous.map.height === next.map.height
  && previous.map.blocked === next.map.blocked
  && previous.map.water === next.map.water
  && previous.map.bridges === next.map.bridges
  && previous.map.trees === next.map.trees
  && previous.map.roads === next.map.roads
  && previous.map.floors === next.map.floors
  && previous.map.houseWalls === next.map.houseWalls
  && previous.map.castleWalls === next.map.castleWalls
  && previous.map.terrainMaterials === next.map.terrainMaterials);

function InstancedTiles({
  positions,
  color,
  height,
  y,
  scale = 0.98,
  castShadow = false,
}: {
  positions: readonly Position[];
  color: THREE.ColorRepresentation;
  height: number;
  y: number;
  scale?: number;
  castShadow?: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach((tile, index) => {
      matrix.makeTranslation(tile.x + 0.5, y, tile.y + 0.5);
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [positions, y]);
  if (!positions.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={[scale, height, scale]} />
      <meshStandardMaterial color={color} roughness={0.92} />
    </instancedMesh>
  );
}

function WaterTiles({ positions }: { positions: readonly Position[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: "#277789",
    emissive: "#16424d",
    emissiveIntensity: 0.08,
    metalness: 0.05,
    roughness: 0.2,
    transparent: true,
    opacity: 0.86,
  }), []);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    positions.forEach((tile, index) => {
      matrix.compose(
        new THREE.Vector3(tile.x + 0.5, 0.015, tile.y + 0.5),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(1.02, 1.02, 1),
      );
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [positions]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const wave = Math.sin(clock.elapsedTime * 1.15) * 0.035;
    material.roughness = 0.2 + wave;
    material.emissiveIntensity = 0.08 + wave;
  });
  if (!positions.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]} receiveShadow>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}

const Structures = memo(function Structures({ map, input, floor }: { map: NonNullable<WorldState["map"]>; input: InputController; floor: number }) {
  const buildings = map.buildings.filter((entry) => entry.floor === floor);
  return (
    <group>
      {buildings.map((building) => <Building key={building.id} building={building} doors={map.doors} windows={map.windows} input={input} />)}
      <ConnectedWalls positions={map.castleWalls.filter((tile) => tile.z === floor)} castle />
      {map.trees.filter((tile) => tile.z === floor).map((tile) => <Tree key={tileKey(tile)} position={tile} />)}
      {map.torches.filter((tile) => tile.z === floor).map((tile) => <Torch key={tileKey(tile)} position={tile} />)}
      {map.doors.filter((door) => door.position.z === floor && !insideAnyBuilding(door.position, buildings)).map((door) => <Door key={door.id} door={door} input={input} />)}
    </group>
  );
});

function Building({ building, doors, windows, input }: { building: BuildingView; doors: readonly DoorView[]; windows: readonly WindowView[]; input: InputController }) {
  const height = building.kind === "keep" ? CASTLE_HEIGHT : WALL_HEIGHT;
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  const matchingDoors = doors.filter((door) => door.position.z === building.floor && insideBuilding(door.position, building));
  const doorKeys = new Set(matchingDoors.map((door) => `${door.position.x}:${door.position.y}`));
  const matchingWindows = windows.filter((window) => window.position.z === building.floor && insideBuilding(window.position, building));
  const windowKeys = new Set(matchingWindows.map((window) => `${window.position.x}:${window.position.y}`));
  const wallSegments: { key: string; position: [number, number, number]; size: [number, number, number]; window: boolean; door: boolean }[] = [];
  for (let x = building.x; x < maxX; x++) {
    wallSegments.push({ key: `n${x}`, position: [x + 0.5, height / 2, building.y], size: [1.04, height, 0.13], window: windowKeys.has(`${x}:${building.y}`), door: doorKeys.has(`${x}:${building.y}`) });
    wallSegments.push({ key: `s${x}`, position: [x + 0.5, height / 2, maxY], size: [1.04, height, 0.13], window: windowKeys.has(`${x}:${maxY - 1}`), door: doorKeys.has(`${x}:${maxY - 1}`) });
  }
  for (let y = building.y; y < maxY; y++) {
    wallSegments.push({ key: `w${y}`, position: [building.x, height / 2, y + 0.5], size: [0.13, height, 1.04], window: windowKeys.has(`${building.x}:${y}`), door: doorKeys.has(`${building.x}:${y}`) });
    wallSegments.push({ key: `e${y}`, position: [maxX, height / 2, y + 0.5], size: [0.13, height, 1.04], window: windowKeys.has(`${maxX - 1}:${y}`), door: doorKeys.has(`${maxX - 1}:${y}`) });
  }
  return (
    <group>
      <mesh position={[building.x + building.width / 2, 0.035, building.y + building.height / 2]} receiveShadow>
        <boxGeometry args={[Math.max(0.2, building.width - 0.18), 0.07, Math.max(0.2, building.height - 0.18)]} />
        <meshStandardMaterial color={building.kind === "keep" ? "#666763" : "#765b42"} roughness={0.96} />
      </mesh>
      <group userData={{ occluder: true }}>
        {wallSegments.map((wall) => (
          wall.door
            ? <MedievalDoorWall key={wall.key} position={wall.position} size={wall.size} keep={building.kind === "keep"} openingHeight={Math.min(height - 0.15, 1.85) + 0.1} />
            : wall.window && building.kind === "house"
            ? <MedievalWindowWall key={wall.key} position={wall.position} size={wall.size} />
            : <MedievalWall key={wall.key} position={wall.position} size={wall.size} keep={building.kind === "keep"} />
        ))}
        <GabledRoof building={building} wallHeight={height} />
        <HangingSign building={building} wallHeight={height} />
        {matchingDoors.map((door) => <Door key={door.id} door={door} building={building} input={input} tall={height} />)}
        {matchingWindows.map((window) => <ShutterWindow key={window.id} window={window} building={building} wallHeight={height} onClick={() => input.toggleWindow(window.id, window.position)} />)}
        {building.kind === "keep" && <Battlements building={building} height={height} />}
      </group>
    </group>
  );
}

function ConnectedWalls({ positions, castle }: { positions: readonly Position[]; castle: boolean }) {
  const set = new Set(positions.map(tileKey));
  const height = castle ? CASTLE_HEIGHT : WALL_HEIGHT;
  return (
    <group>
      {positions.map((tile) => {
        const arms = [
          { key: "west", present: set.has(`${tile.x - 1}:${tile.y}:${tile.z}`), position: [-0.32, height / 2, 0] as [number, number, number], size: [0.42, height, 0.18] as [number, number, number] },
          { key: "east", present: set.has(`${tile.x + 1}:${tile.y}:${tile.z}`), position: [0.32, height / 2, 0] as [number, number, number], size: [0.42, height, 0.18] as [number, number, number] },
          { key: "north", present: set.has(`${tile.x}:${tile.y - 1}:${tile.z}`), position: [0, height / 2, -0.32] as [number, number, number], size: [0.18, height, 0.42] as [number, number, number] },
          { key: "south", present: set.has(`${tile.x}:${tile.y + 1}:${tile.z}`), position: [0, height / 2, 0.32] as [number, number, number], size: [0.18, height, 0.42] as [number, number, number] },
        ];
        return (
          <group key={tileKey(tile)} position={[tile.x + 0.5, 0, tile.y + 0.5]} userData={{ occluder: true }}>
            <MedievalWall position={[0, height / 2, 0]} size={[0.24, height, 0.24]} keep={castle} />
            {arms.filter((arm) => arm.present).map((arm) => <MedievalWall key={arm.key} position={arm.position} size={arm.size} keep={castle} />)}
            {castle && <mesh position={[0, height + 0.18, 0]} castShadow><boxGeometry args={[0.25, 0.36, 0.25]} /><meshStandardMaterial color="#87908c" roughness={0.95} /></mesh>}
          </group>
        );
      })}
    </group>
  );
}

function Battlements({ building, height }: { building: BuildingView; height: number }) {
  const points: [number, number, number][] = [];
  for (let x = building.x; x <= building.x + building.width; x += 0.65) {
    points.push([x, height + 0.2, building.y], [x, height + 0.2, building.y + building.height]);
  }
  for (let y = building.y + 0.65; y < building.y + building.height; y += 0.65) {
    points.push([building.x, height + 0.2, y], [building.x + building.width, height + 0.2, y]);
  }
  return <>{points.map((point, index) => <mesh key={index} position={point} castShadow><boxGeometry args={[0.28, 0.4, 0.28]} /><meshStandardMaterial color="#87908c" roughness={0.96} /></mesh>)}</>;
}

function Door({ door, input, building, tall = WALL_HEIGHT }: { door: DoorView; input: InputController; building?: BuildingView; tall?: number }) {
  const group = useRef<THREE.Group>(null);
  const transform = doorTransform(door, building);
  const leafHeight = Math.min(tall - 0.15, 1.85);
  const modelledHouseOpening = building?.kind === "house";
  const leafWidth = modelledHouseOpening ? 0.63 : 0.88;
  const hingeX = -leafWidth / 2;
  useFrame((_, delta) => {
    if (!group.current) return;
    const target = door.open ? transform.openAngle : 0;
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, target, 12, delta);
  });
  return (
    <group position={[transform.x, 0, transform.z]} rotation={[0, transform.rotation, 0]} onPointerDown={(event) => { event.stopPropagation(); input.toggleDoor(door.id, door.position); }}>
      {!modelledHouseOpening && <>
        <mesh position={[-0.49, leafHeight / 2, 0]} castShadow><boxGeometry args={[0.1, leafHeight + 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
        <mesh position={[0.49, leafHeight / 2, 0]} castShadow><boxGeometry args={[0.1, leafHeight + 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
        <mesh position={[0, leafHeight + 0.04, 0]} castShadow><boxGeometry args={[1.08, 0.12, 0.16]} /><meshStandardMaterial color="#49301f" roughness={0.9} /></mesh>
      </>}
      <group ref={group} position={[hingeX, 0, 0]}>
        <mesh position={[leafWidth / 2, leafHeight / 2, 0]} castShadow>
          <boxGeometry args={[leafWidth, leafHeight, 0.09]} />
          <meshStandardMaterial color="#654128" roughness={0.8} />
        </mesh>
        <mesh position={[leafWidth * 0.84, leafHeight * 0.52, 0.07]}><sphereGeometry args={[0.045, 10, 8]} /><meshStandardMaterial color="#d6aa54" metalness={0.65} /></mesh>
      </group>
    </group>
  );
}

function Tree({ position }: { position: Position }) {
  const phase = stablePhase(tileKey(position));
  return (
    <group position={[position.x + 0.5, 0, position.y + 0.5]} rotation={[0, phase, 0]} userData={{ occluder: true }}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow><cylinderGeometry args={[0.14, 0.2, 1.45, 8]} /><meshStandardMaterial color="#604128" roughness={1} /></mesh>
      <mesh position={[0, 1.75, 0]} castShadow><coneGeometry args={[0.82, 1.75, 9]} /><meshStandardMaterial color="#315c38" roughness={0.95} /></mesh>
      <mesh position={[0, 2.35, 0]} castShadow><coneGeometry args={[0.61, 1.35, 9]} /><meshStandardMaterial color="#3b7043" roughness={0.95} /></mesh>
    </group>
  );
}

function Torch({ position }: { position: Position }) {
  const flame = useRef<THREE.Mesh>(null);
  const phase = stablePhase(tileKey(position));
  useFrame(({ clock }) => {
    if (!flame.current) return;
    const flicker = 1 + Math.sin(clock.elapsedTime * 10 + phase) * 0.12;
    flame.current.scale.set(flicker, 1 / flicker, flicker);
  });
  return (
    <group position={[position.x + 0.5, 0, position.y + 0.5]}>
      <mesh position={[0, 0.62, 0]} castShadow><cylinderGeometry args={[0.035, 0.055, 1.24, 7]} /><meshStandardMaterial color="#49301f" /></mesh>
      <mesh ref={flame} position={[0, 1.31, 0]}><coneGeometry args={[0.13, 0.38, 9]} /><meshStandardMaterial color="#ff8b32" emissive="#ff4d10" emissiveIntensity={3} toneMapped={false} /></mesh>
    </group>
  );
}

type ActorClick = (event: ThreeEvent<MouseEvent>) => void;

function PlayerActor({ player, local, selected, onClick }: { player: PlayerView; local: boolean; selected: boolean; onClick: ActorClick }) {
  const color = player.vocation === "mage" ? "#4d6fb5" : player.vocation === "ranger" ? "#557b45" : "#8a4135";
  return (
    <SmoothActor id={player.id} position={player.position}>
      <group onClick={onClick}>
        <SelectionRing active={selected || local} color={local ? "#65b9e8" : "#e2be65"} />
        <Humanoid color={color} local={local} />
      </group>
    </SmoothActor>
  );
}

function NpcActor({ npc, onClick }: { npc: NpcView; onClick: ActorClick }) {
  return <SmoothActor id={npc.id} position={npc.position}><group onClick={onClick}><SelectionRing active color="#d6b65e" /><Humanoid color="#836eab" /><mesh position={[0, 2.18, 0]}><octahedronGeometry args={[0.11]} /><meshStandardMaterial color="#e7c45f" emissive="#b17f23" emissiveIntensity={1.3} /></mesh></group></SmoothActor>;
}

function CreatureActor({ creature, selected, onClick }: { creature: CreatureView; selected: boolean; onClick: ActorClick }) {
  const group = useRef<THREE.Group>(null);
  const phase = stablePhase(creature.id);
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = Math.sin(clock.elapsedTime * 6 + phase) * 0.025;
  });
  const brute = creature.definitionId.includes("brute");
  return (
    <SmoothActor id={creature.id} position={creature.position}>
      <group ref={group} onClick={onClick}>
        <SelectionRing active={selected} color="#dc594c" />
        <mesh position={[0, brute ? 0.72 : 0.55, 0]} castShadow><dodecahedronGeometry args={[brute ? 0.58 : 0.43, 0]} /><meshStandardMaterial color={creature.immune ? "#8c9791" : "#506b3a"} roughness={0.9} /></mesh>
        <mesh position={[-0.2, brute ? 0.93 : 0.71, -0.34]}><sphereGeometry args={[0.045, 8, 6]} /><meshStandardMaterial color="#ff713d" emissive="#a52d15" emissiveIntensity={2} /></mesh>
        <mesh position={[0.2, brute ? 0.93 : 0.71, -0.34]}><sphereGeometry args={[0.045, 8, 6]} /><meshStandardMaterial color="#ff713d" emissive="#a52d15" emissiveIntensity={2} /></mesh>
      </group>
    </SmoothActor>
  );
}

function Humanoid({ color, local = false }: { color: string; local?: boolean }) {
  const legs = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (legs.current) legs.current.rotation.x = Math.sin(clock.elapsedTime * 7) * 0.05;
  });
  return (
    <group>
      <group ref={legs}>
        <mesh position={[-0.13, 0.34, 0]} castShadow><capsuleGeometry args={[0.1, 0.45, 4, 8]} /><meshStandardMaterial color="#282d35" /></mesh>
        <mesh position={[0.13, 0.34, 0]} castShadow><capsuleGeometry args={[0.1, 0.45, 4, 8]} /><meshStandardMaterial color="#282d35" /></mesh>
      </group>
      <mesh position={[0, 0.98, 0]} castShadow renderOrder={local ? 10 : 0}><capsuleGeometry args={[0.31, 0.62, 6, 12]} /><meshStandardMaterial color={color} roughness={0.75} emissive={local ? color : "#000000"} emissiveIntensity={local ? 0.12 : 0} /></mesh>
      <mesh position={[0, 1.58, 0]} castShadow renderOrder={local ? 10 : 0}><sphereGeometry args={[0.27, 16, 12]} /><meshStandardMaterial color="#c9976c" roughness={0.85} /></mesh>
      <mesh position={[0, 1.79, 0]} castShadow><coneGeometry args={[0.34, 0.36, 10]} /><meshStandardMaterial color="#45362a" /></mesh>
    </group>
  );
}

function SmoothActor({ id, position, children }: { id: string; position: Position; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3(position.x + 0.5, 0.05, position.y + 0.5));
  const velocity = useRef(new THREE.Vector3());
  const previousTarget = useRef(current.current.clone());
  const target = useMemo(() => new THREE.Vector3(position.x + 0.5, 0.05, position.y + 0.5), [position.x, position.y]);
  useFrame((_, delta) => {
    if (!group.current) return;
    if (!target.equals(previousTarget.current)) {
      const dx = target.x - previousTarget.current.x;
      const dz = target.z - previousTarget.current.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) group.current.rotation.y = Math.atan2(dx, dz);
      previousTarget.current.copy(target);
    }
    const frameDelta = Math.min(delta, 0.05);
    const distance = current.current.distanceTo(target);
    if (distance > 3) {
      current.current.copy(target);
      velocity.current.set(0, 0, 0);
    } else {
      const stiffness = 105;
      const damping = 17;
      velocity.current.x += ((target.x - current.current.x) * stiffness - velocity.current.x * damping) * frameDelta;
      velocity.current.z += ((target.z - current.current.z) * stiffness - velocity.current.z * damping) * frameDelta;
      const speed = Math.hypot(velocity.current.x, velocity.current.z);
      if (speed > 8.2) velocity.current.multiplyScalar(8.2 / speed);
      current.current.x += velocity.current.x * frameDelta;
      current.current.z += velocity.current.z * frameDelta;
      if (distance < 0.002 && speed < 0.02) {
        current.current.copy(target);
        velocity.current.set(0, 0, 0);
      }
    }
    group.current.position.copy(current.current);
  });
  return <group ref={group} name={id} position={current.current}>{children}</group>;
}

function SelectionRing({ active, color }: { active: boolean; color: string }) {
  if (!active) return null;
  return <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.36, 0.48, 32]} /><meshBasicMaterial color={color} transparent opacity={0.82} depthWrite={false} /></mesh>;
}

function GroundItemActor({ position, corpse, onClick }: { position: Position; corpse: boolean; onClick: ActorClick }) {
  return (
    <group position={[position.x + 0.5, 0.12, position.y + 0.5]} onClick={onClick}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
        {corpse ? <circleGeometry args={[0.34, 14]} /> : <octahedronGeometry args={[0.18]} />}
        <meshStandardMaterial color={corpse ? "#6d3029" : "#d3a84f"} roughness={0.8} />
      </mesh>
    </group>
  );
}

function FollowCamera({ target, mapWidth, mapHeight }: { target?: Position; mapWidth: number; mapHeight: number }) {
  const { camera } = useThree();
  const focus = useRef(new THREE.Vector3(target?.x ?? mapWidth / 2, 0, target?.y ?? mapHeight / 2));
  useFrame((_, delta) => {
    const next = new THREE.Vector3(target?.x ?? mapWidth / 2, 0, target?.y ?? mapHeight / 2);
    focus.current.x = THREE.MathUtils.damp(focus.current.x, next.x + 0.5, 7.5, delta);
    focus.current.z = THREE.MathUtils.damp(focus.current.z, next.z + 0.5, 7.5, delta);
    camera.position.set(focus.current.x + 12, 16, focus.current.z + 12);
    camera.lookAt(focus.current.x, 0, focus.current.z);
    camera.updateMatrixWorld();
  });
  return null;
}

function OcclusionController({ target }: { target?: Position }) {
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const faded = useRef(new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>());
  useFrame(() => {
    const roots = new Set<THREE.Object3D>();
    if (target) {
      const targetPoint = new THREE.Vector3(target.x + 0.5, 1.05, target.y + 0.5);
      const direction = targetPoint.clone().sub(camera.position);
      const targetDistance = direction.length();
      raycaster.set(camera.position, direction.normalize());
      raycaster.far = Math.max(0, targetDistance - 0.35);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        let node: THREE.Object3D | null = hit.object;
        while (node && !node.userData.occluder) node = node.parent;
        if (node?.userData.occluder) roots.add(node);
      }
    }
    const next = new Set<THREE.Material>();
    for (const root of roots) root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        next.add(material);
        if (!faded.current.has(material)) {
          faded.current.set(material, {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          });
          material.transparent = true;
          material.opacity = 0.28;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
      }
    });
    for (const [material, original] of faded.current) {
      if (next.has(material)) continue;
      material.opacity = original.opacity;
      material.transparent = original.transparent;
      material.depthWrite = original.depthWrite;
      material.needsUpdate = true;
      faded.current.delete(material);
    }
  });
  useEffect(() => () => {
    for (const [material, original] of faded.current) {
      material.opacity = original.opacity;
      material.transparent = original.transparent;
      material.depthWrite = original.depthWrite;
    }
  }, []);
  return null;
}

function Atmosphere({ torches, local }: { torches: readonly Position[]; local?: Position }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const activeTorches = useMemo(() => {
    if (!local) return torches.slice(0, 10);
    return [...torches].sort((a, b) => distanceSquared(a, local) - distanceSquared(b, local)).slice(0, 10);
  }, [torches, local?.x, local?.y]);
  useEffect(() => {
    scene.fog = new THREE.FogExp2(0x718079, 0.012);
    return () => { scene.fog = null; };
  }, [scene]);
  useFrame(({ clock }) => {
    const cycle = (clock.elapsedTime % 180) / 180;
    const daylight = (Math.cos(cycle * Math.PI * 2 - Math.PI) + 1) / 2;
    if (sun.current) sun.current.intensity = 0.18 + daylight * 2.1;
    if (ambient.current) ambient.current.intensity = 0.22 + daylight * 0.85;
    const sky = new THREE.Color().lerpColors(new THREE.Color("#101924"), new THREE.Color("#9fb7b0"), daylight);
    scene.background = sky;
  });
  return (
    <>
      <hemisphereLight ref={ambient} args={["#bfd5cb", "#172019", 0.8]} />
      <directionalLight ref={sun} position={[14, 24, 9]} intensity={1.8} color="#ffe1aa" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-near={1} shadow-camera-far={70} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} />
      {activeTorches.map((torch) => <pointLight key={tileKey(torch)} position={[torch.x + 0.5, 1.45, torch.y + 0.5]} color="#ff6a24" intensity={5} distance={5.5} decay={2} />)}
    </>
  );
}

function Weather({ local, floor }: { local?: Position; floor: number }) {
  const points = useRef<THREE.Points>(null);
  const drops = useMemo(() => {
    const values = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      values[i * 3] = (Math.random() - 0.5) * 22;
      values[i * 3 + 1] = Math.random() * 14;
      values[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    return values;
  }, []);
  useFrame(({ clock }, delta) => {
    if (!points.current || floor !== 0) return;
    const rain = Math.max(0, 1 - Math.abs(((clock.elapsedTime % 180) / 45) - 2.55) / 0.75);
    points.current.visible = rain > 0.02;
    const attribute = points.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) {
      const next = attribute.getY(i) - delta * 12;
      attribute.setY(i, next < 0 ? 14 : next);
    }
    attribute.needsUpdate = true;
    points.current.position.set(local?.x ?? 0, 0, local?.y ?? 0);
  });
  return <points ref={points} visible={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[drops, 3]} /></bufferGeometry><pointsMaterial color="#b9d7e2" size={0.045} transparent opacity={0.7} depthWrite={false} /></points>;
}

function blockedByStructure(map: NonNullable<WorldState["map"]>, tile: Position) {
  const key = `${tile.x}:${tile.y}:${tile.z}`;
  return map.water.some((entry) => tileKey(entry) === key)
    || map.trees.some((entry) => tileKey(entry) === key)
    || map.houseWalls.some((entry) => tileKey(entry) === key)
    || map.castleWalls.some((entry) => tileKey(entry) === key);
}

function insideBuilding(position: Position, building: BuildingView) {
  return position.x >= building.x && position.x < building.x + building.width
    && position.y >= building.y && position.y < building.y + building.height;
}

function insideAnyBuilding(position: Position, buildings: readonly BuildingView[]) {
  return buildings.some((building) => insideBuilding(position, building));
}

function doorTransform(door: DoorView, building?: BuildingView) {
  if (!building) return {
    x: door.position.x + 0.5,
    z: door.position.y + 0.5,
    rotation: 0,
    openAngle: Math.PI / 2,
  };
  const maxX = building.x + building.width;
  const maxY = building.y + building.height;
  if (door.position.y === building.y) return {
    x: door.position.x + 0.5,
    z: building.y,
    rotation: 0,
    openAngle: Math.PI / 2,
  };
  if (door.position.y === maxY - 1) return {
    x: door.position.x + 0.5,
    z: maxY,
    rotation: Math.PI,
    openAngle: Math.PI / 2,
  };
  if (door.position.x === building.x) return {
    x: building.x,
    z: door.position.y + 0.5,
    rotation: Math.PI / 2,
    openAngle: Math.PI / 2,
  };
  return {
    x: maxX,
    z: door.position.y + 0.5,
    rotation: -Math.PI / 2,
    openAngle: Math.PI / 2,
  };
}

function tileKey(position: Position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function distanceSquared(a: Position, b: Position) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function stablePhase(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash % 628) / 100;
}
