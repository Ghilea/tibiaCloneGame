import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { createLitSpriteMaterial } from "../rendering/createLitSpriteMaterial";
import type { Direction8 } from "./spriteTypes";

const ROOT = "/assets/monsters/castle_rat/atlases";
const DIRECTIONS: Direction8[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

// The source art names rows in screen-facing orientation (E points left in the
// image). Convert world directions through the fixed SE isometric camera so the
// rat visibly faces the direction in which its ground position moves.
const ATLAS_DIRECTION_BY_WORLD: Record<Direction8, Direction8> = {
  n: "nw",
  ne: "w",
  e: "sw",
  se: "s",
  s: "se",
  sw: "e",
  w: "ne",
  nw: "n",
};

const ANIMATIONS = {
  idle: { columns: 12, fps: 10, playback: "loop" },
  walk: { columns: 8, fps: 12, playback: "loop" },
  run: { columns: 8, fps: 16, playback: "loop" },
  bite: { columns: 8, fps: 14, playback: "once" },
  attack: { columns: 8, fps: 14, playback: "once" },
  hit: { columns: 5, fps: 14, playback: "once" },
  death: { columns: 10, fps: 10, playback: "once" },
  alert: { columns: 6, fps: 10, playback: "once" },
  eat: { columns: 8, fps: 10, playback: "loop" },
} as const;

type AnimationName = keyof typeof ANIMATIONS;
type Playback = (typeof ANIMATIONS)[AnimationName]["playback"];

const textureLoader = new THREE.TextureLoader();
const loadedAnimationTextures = new Map<AnimationName, Promise<readonly [THREE.Texture, THREE.Texture]>>();

function animationUrls(name: AnimationName): readonly [string, string] {
  return [
    `${ROOT}/castle_rat_${name}_albedo.webp`,
    `${ROOT}/castle_rat_${name}_normal.webp`,
  ];
}

function configureAtlasTexture(texture: THREE.Texture) {
  // These atlases have no gutters. Mipmaps sample neighbouring frames and make
  // fragments of another direction appear around the cutout.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}

function loadAnimationTextures(name: AnimationName) {
  const cached = loadedAnimationTextures.get(name);
  if (cached) return cached;
  const urls = animationUrls(name);
  const loading = Promise.all(urls.map((url) => textureLoader.loadAsync(url))).then((textures) => {
    configureAtlasTexture(textures[0]);
    configureAtlasTexture(textures[1]);
    return textures as unknown as readonly [THREE.Texture, THREE.Texture];
  });
  loadedAnimationTextures.set(name, loading);
  return loading;
}

type CastleRatSpriteProps = {
  direction: MutableRefObject<Direction8>;
  moving: MutableRefObject<boolean>;
  state: string;
  health: number;
};

export function CastleRatSprite({ direction, moving, state, health }: CastleRatSpriteProps) {
  // Only idle is needed to mount. Other large atlases load on first use instead
  // of allocating every Castle Rat animation on the GPU at game startup.
  const idleTextures = useLoader(
    THREE.TextureLoader,
    [...animationUrls("idle")],
  ) as THREE.Texture[];
  const mesh = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);
  const previousHealth = useRef(health);
  const requestedOneShot = useRef<AnimationName | null>(null);
  const active = useRef<AnimationName>("idle");
  const frame = useRef(0);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const desiredAnimation = useRef<AnimationName>("idle");
  const loadingAnimation = useRef<AnimationName | null>(null);
  const lastDirection = useRef<Direction8>(direction.current);
  const cameraWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);

  const geometry = useMemo(() => {
    const width = 0.95;
    const height = 1.05;
    const result = new THREE.PlaneGeometry(width, height);
    // Metadata anchor is (128, 240) in a 256x256 frame.
    result.translate(0, (240 / 256 - 0.5) * height, 0);
    // PlaneGeometry otherwise shows the entire atlas until the first tick.
    applyFrame(result, "idle", direction.current, 0);
    return result;
  }, [direction]);

  const material = useMemo(() => {
    configureAtlasTexture(idleTextures[0]);
    configureAtlasTexture(idleTextures[1]);
    const idlePair = idleTextures as unknown as readonly [THREE.Texture, THREE.Texture];
    loadedAnimationTextures.set("idle", Promise.resolve(idlePair));
    return createLitSpriteMaterial(idleTextures[0], idleTextures[1], 0.9, 0.35, 0.9);
  }, [idleTextures]);

  useEffect(() => {
    if (health < previousHealth.current && health > 0) requestedOneShot.current = "hit";
    if (health <= 0) requestedOneShot.current = "death";
    previousHealth.current = health;
  }, [health]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ camera }, delta) => {
    const actor = mesh.current;
    if (!actor) return;

    camera.getWorldQuaternion(cameraWorldQuaternion);
    actor.parent?.getWorldQuaternion(parentWorldQuaternion);
    actor.quaternion.copy(parentWorldQuaternion).invert().multiply(cameraWorldQuaternion);

    let desired: AnimationName;
    if (requestedOneShot.current) desired = requestedOneShot.current;
    else if (state === "attacking") desired = "bite";
    else if (moving.current) desired = state === "returning" ? "run" : "walk";
    else desired = "idle";
    desiredAnimation.current = desired;

    if (desired !== active.current) {
      if (loadingAnimation.current !== desired) {
        loadingAnimation.current = desired;
        void loadAnimationTextures(desired).then(([albedo, normal]) => {
          if (!mesh.current || desiredAnimation.current !== desired) {
            if (loadingAnimation.current === desired) loadingAnimation.current = null;
            return;
          }
          material.map = albedo;
          material.normalMap = normal;
          // Both maps stay present, so changing the texture does not require a
          // shader recompile (`material.needsUpdate`) during gameplay.
          active.current = desired;
          loadingAnimation.current = null;
          frame.current = 0;
          elapsed.current = 0;
          finished.current = false;
          applyFrame(mesh.current.geometry, desired, direction.current, 0);
        });
      }
    }

    if (direction.current !== lastDirection.current) {
      lastDirection.current = direction.current;
      applyFrame(actor.geometry, active.current, direction.current, frame.current);
    }

    const definition = ANIMATIONS[active.current] as { columns: number; fps: number; playback: Playback };
    if (finished.current) {
      requestedOneShot.current = null;
      return;
    }

    elapsed.current += Math.min(delta, 0.1);
    const secondsPerFrame = 1 / definition.fps;
    while (elapsed.current >= secondsPerFrame) {
      elapsed.current -= secondsPerFrame;
      if (frame.current + 1 >= definition.columns) {
        if (definition.playback === "loop") frame.current = 0;
        else {
          frame.current = definition.columns - 1;
          finished.current = true;
        }
      } else frame.current += 1;
      applyFrame(actor.geometry, active.current, direction.current, frame.current);
    }
  });

  return (
    <group>
      <mesh ref={mesh} geometry={geometry} material={material} />
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.68, 0.32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} depthTest depthWrite={false} />
      </mesh>
    </group>
  );
}

function applyFrame(
  geometry: THREE.PlaneGeometry,
  animation: AnimationName,
  direction: Direction8,
  frame: number,
) {
  const columns = ANIMATIONS[animation].columns;
  const atlasDirection = castleRatAtlasDirection(direction);
  const row = DIRECTIONS.indexOf(atlasDirection);
  // Stay half a texel inside the 256px cell to avoid bilinear sampling across
  // atlas boundaries. Albedo and normal use the exact same rectangle.
  const frameSize = 256;
  const atlasWidth = columns * frameSize;
  const atlasHeight = DIRECTIONS.length * frameSize;
  const u0 = (frame * frameSize + 0.5) / atlasWidth;
  const u1 = ((frame + 1) * frameSize - 0.5) / atlasWidth;
  const vTop = 1 - (row * frameSize + 0.5) / atlasHeight;
  const vBottom = 1 - ((row + 1) * frameSize - 0.5) / atlasHeight;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, u0, vTop);
  uv.setXY(1, u1, vTop);
  uv.setXY(2, u0, vBottom);
  uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
}

export function castleRatAtlasDirection(worldDirection: Direction8): Direction8 {
  return ATLAS_DIRECTION_BY_WORLD[worldDirection];
}
