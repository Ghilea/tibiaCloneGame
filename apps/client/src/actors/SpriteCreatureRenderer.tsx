import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { createLitSpriteMaterial } from "../rendering/createLitSpriteMaterial";
import type { ActorMotionState } from "./actorMotion";
import { CreatureAnimationController } from "./CreatureAnimationController";
import { creatureAssetManager, type CreatureAtlasPair } from "./CreatureAssetManager";
import type { CardinalDirection, CreatureAnimationDefinition, SpriteCreatureDefinition } from "./spriteTypes";

const REQUIRED_ANIMATIONS = ["idle", "walk", "attack", "hit", "death"] as const;

type SpriteCreatureRendererProps = {
  definitionId: string;
  motion: MutableRefObject<ActorMotionState>;
  state: string;
  health: number;
  immune?: boolean;
  onAnimationEvent?: (event: string) => void;
};

type LoadedCreature = { definition: SpriteCreatureDefinition; atlases: Map<string, CreatureAtlasPair> };

export function SpriteCreatureRenderer(props: SpriteCreatureRendererProps) {
  const [loaded, setLoaded] = useState<LoadedCreature | null>(null);
  useEffect(() => {
    let cancelled = false;
    // TIBIAGAME_STREAMING_FIX_V5
    // Never decode every atlas at once. Make the creature visible after idle
    // is ready, then warm remaining animations one-at-a-time in idle windows.
    void (async () => {
      const definition = await creatureAssetManager.load(props.definitionId);
      const names = REQUIRED_ANIMATIONS.filter((name) => definition.animations[name]);
      const atlases = new Map<string, CreatureAtlasPair>();

      for (let index = 0; index < names.length; index += 1) {
        if (index > 0) await waitForAssetIdle();
        if (cancelled) return;
        const name = names[index];
        const pair = await creatureAssetManager.loadAnimation(
          definition.id,
          definition.animations[name],
        );
        if (cancelled) return;
        atlases.set(name, pair);
        setLoaded({ definition, atlases: new Map(atlases) });
      }
    })().catch((error) => {
      console.warn(`sprite creature load failed: ${props.definitionId}`, error);
    });
    return () => { cancelled = true; };
  }, [props.definitionId]);
  return loaded ? <LoadedSpriteCreature {...props} loaded={loaded} /> : null;
}

function LoadedSpriteCreature({ loaded, motion, state, health, immune = false, onAnimationEvent }: SpriteCreatureRendererProps & { loaded: LoadedCreature }) {
  const { definition, atlases } = loaded;
  const mesh = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);
  const controller = useMemo(() => new CreatureAnimationController(definition), [definition]);
  const previousHealth = useRef(health);
  const previousState = useRef(state);
  const requestedOneShot = useRef<string | null>(state === "attacking" ? "attack" : null);
  const dead = useRef(health <= 0);
  const lastAnimation = useRef(controller.currentAnimation);
  const lastFrame = useRef(-1);
  const lastFacing = useRef<CardinalDirection>(motion.current.facing);
  const cameraQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const idleAtlas = atlases.get("idle");
  if (!idleAtlas) throw new Error(`${definition.id}: idle atlas was not loaded`);

  const geometry = useMemo(() => {
    const { width, height } = definition.renderSize;
    const result = new THREE.PlaneGeometry(width, height);
    result.translate((0.5 - definition.anchor.x) * width, (0.5 - definition.anchor.y) * height, 0);
    applyFrame(result, definition.animations.idle, motion.current.facing, 0, definition.mirrorEastFromWest);
    return result;
  }, [definition, motion]);
  const material = useMemo(() => createLitSpriteMaterial(idleAtlas.albedo, idleAtlas.normal, definition.material.roughness, definition.material.alphaTest, definition.material.normalStrength), [definition, idleAtlas]);
  useEffect(() => {
    material.color.set(immune ? "#87938e" : "#ffffff");
  }, [immune, material]);

  useEffect(() => {
    if (health <= 0) { dead.current = true; requestedOneShot.current = "death"; }
    else if (health < previousHealth.current) requestedOneShot.current = "hit";
    else if (state === "attacking" && previousState.current !== "attacking") requestedOneShot.current = "attack";
    previousHealth.current = health;
    previousState.current = state;
  }, [health, state]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(({ camera }, delta) => {
    const actor = mesh.current;
    if (!actor) return;
    camera.getWorldQuaternion(cameraQuaternion);
    actor.parent?.getWorldQuaternion(parentQuaternion);
    actor.quaternion.copy(parentQuaternion).invert().multiply(cameraQuaternion);
    const requested = dead.current ? "death" : requestedOneShot.current ? requestedOneShot.current : motion.current.moving ? "walk" : "idle";
    // TIBIAGAME_STREAMING_FIX_V5
    // Optional atlases arrive incrementally. Until then use walk/idle instead
    // of stalling or throwing.
    const desired = atlases.has(requested)
      ? requested
      : motion.current.moving && atlases.has("walk") ? "walk" : "idle";
    controller.play(desired);
    for (const event of controller.update(delta)) onAnimationEvent?.(event.event);
    if (controller.isFinished && controller.currentAnimation !== "death") requestedOneShot.current = null;

    const animationName = controller.currentAnimation;
    const facing = motion.current.facing;
    const frame = controller.currentFrame;
    const animationChanged = animationName !== lastAnimation.current;
    if (animationChanged) {
      const atlas = atlases.get(animationName);
      if (!atlas) throw new Error(`${definition.id}: atlas for ${animationName} was not loaded`);
      const shaderShapeChanged = Boolean(material.normalMap) !== Boolean(atlas.normal);
      material.map = atlas.albedo;
      material.normalMap = atlas.normal;
      // TIBIAGAME_STREAMING_FIX_V5
      // Swapping one non-null map/normalMap for another only changes uniforms.
      // needsUpdate recompiles the shader and was causing animation-transition
      // stalls for every individual creature material.
      if (shaderShapeChanged) material.needsUpdate = true;
      lastAnimation.current = animationName;
    }
    if (frame !== lastFrame.current || facing !== lastFacing.current || animationChanged) {
      applyFrame(actor.geometry, definition.animations[animationName], facing, frame, definition.mirrorEastFromWest);
      lastFrame.current = frame;
      lastFacing.current = facing;
    }
  });

  return <group>
    <mesh ref={mesh} geometry={geometry} material={material} />
    <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[definition.shadow.width, definition.shadow.depth]} />
      <meshBasicMaterial color="#000000" transparent opacity={definition.shadow.opacity} depthTest depthWrite={false} />
    </mesh>
  </group>;
}

export function applyFrame(geometry: THREE.PlaneGeometry, animation: CreatureAnimationDefinition, requestedDirection: CardinalDirection, frame: number, mirrorEastFromWest: boolean) {
  const mirrored = requestedDirection === "east" && mirrorEastFromWest;
  const direction = mirrored ? "west" : requestedDirection;
  const row = animation.directionRows[direction];
  if (row === undefined) throw new Error(`Animation is missing direction ${direction}`);
  const atlasWidth = animation.columns * animation.frameWidth;
  const atlasHeight = animation.rows * animation.frameHeight;
  const column = Math.min(frame, animation.framesPerDirection - 1);
  let u0 = (column * animation.frameWidth + 0.5) / atlasWidth;
  let u1 = ((column + 1) * animation.frameWidth - 0.5) / atlasWidth;
  if (mirrored) [u0, u1] = [u1, u0];
  const vTop = 1 - (row * animation.frameHeight + 0.5) / atlasHeight;
  const vBottom = 1 - ((row + 1) * animation.frameHeight - 0.5) / atlasHeight;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, u0, vTop); uv.setXY(1, u1, vTop); uv.setXY(2, u0, vBottom); uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
}


// TIBIAGAME_STREAMING_FIX_V5
function waitForAssetIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(resolve);
    else window.setTimeout(resolve, 32);
  });
}
