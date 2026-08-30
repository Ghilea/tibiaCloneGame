import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { createLitSpriteMaterial } from "../rendering/createLitSpriteMaterial";
import type { ActorMotionState } from "./actorMotion";
import { isometricAtlasDirection } from "./direction8";
import type { Direction8 } from "./spriteTypes";

const ROOT = "/assets/monsters/castle_rat";
const METADATA_URL = `${ROOT}/castle_rat.json`;
const BASE_CREATURE_SPEED = 1 / 0.185;

type AnimationName = "idle" | "walk" | "run" | "bite" | "attack" | "hit" | "death" | "alert" | "eat";
type AtlasAnimation = {
  albedo: string;
  normal: string;
  columns: number;
  rows: number;
  frameWidth?: number;
  frameHeight?: number;
  directionRows: Record<Direction8, number>;
  framesPerDirection: number;
  fps: number;
  playback: "loop" | "once";
  eventFrame?: number;
};
type CastleRatMetadata = {
  frameWidth: number;
  frameHeight: number;
  anchor: { x: number; y: number };
  animations: Record<AnimationName, AtlasAnimation>;
};

const textureLoader = new THREE.TextureLoader();
const loadedTextures = new Map<string, Promise<readonly [THREE.Texture, THREE.Texture]>>();
const scheduledPrewarms = new Set<string>();
const uploadedTextures = new WeakSet<THREE.Texture>();

function assetUrl(path: string) {
  return `${ROOT}/${path}`;
}

function animationUrls(animation: AtlasAnimation): readonly [string, string] {
  return [assetUrl(animation.albedo), assetUrl(animation.normal)];
}

function configureAtlasTexture(texture: THREE.Texture) {
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}

function loadAnimationTextures(animation: AtlasAnimation) {
  const urls = animationUrls(animation);
  const key = urls.join("|");
  const cached = loadedTextures.get(key);
  if (cached) return cached;
  const loading = Promise.all(urls.map((url) => textureLoader.loadAsync(url))).then((textures) => {
    configureAtlasTexture(textures[0]);
    configureAtlasTexture(textures[1]);
    return textures as unknown as readonly [THREE.Texture, THREE.Texture];
  });
  loadedTextures.set(key, loading);
  return loading;
}

function prewarmAnimation(animation: AtlasAnimation, renderer: THREE.WebGLRenderer) {
  const key = animationUrls(animation).join("|");
  if (scheduledPrewarms.has(key)) return;
  scheduledPrewarms.add(key);
  const run = () => {
    void loadAnimationTextures(animation).then((textures) => {
      for (const texture of textures) {
        if (uploadedTextures.has(texture)) continue;
        renderer.initTexture(texture);
        uploadedTextures.add(texture);
      }
    }).catch(() => scheduledPrewarms.delete(key));
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 1_500 });
  } else {
    window.setTimeout(run, 0);
  }
}

type CastleRatSpriteProps = {
  motion: MutableRefObject<ActorMotionState>;
  state: string;
  health: number;
};

export function CastleRatSprite({ motion, state, health }: CastleRatSpriteProps) {
  const renderer = useThree(({ gl }) => gl);
  const metadataSource = useLoader(THREE.FileLoader, METADATA_URL) as string;
  const metadata = useMemo(() => JSON.parse(metadataSource) as CastleRatMetadata, [metadataSource]);
  const idleAnimation = metadata.animations.idle;
  const idleTextures = useLoader(THREE.TextureLoader, [...animationUrls(idleAnimation)]) as THREE.Texture[];
  const mesh = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);
  const previousHealth = useRef(health);
  const previousState = useRef(state);
  const dead = useRef(health <= 0);
  const requestedOneShot = useRef<AnimationName | null>(state === "attacking" ? "bite" : null);
  const active = useRef<AnimationName>("idle");
  const frame = useRef(0);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const desiredAnimation = useRef<AnimationName>("idle");
  const loadingAnimation = useRef<AnimationName | null>(null);
  const lastDirection = useRef<Direction8>(motion.current.direction);
  const cameraWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentWorldQuaternion = useMemo(() => new THREE.Quaternion(), []);

  const geometry = useMemo(() => {
    const width = 0.95;
    const height = 1.05;
    const result = new THREE.PlaneGeometry(width, height);
    result.translate(
      (0.5 - metadata.anchor.x / metadata.frameWidth) * width,
      (metadata.anchor.y / metadata.frameHeight - 0.5) * height,
      0,
    );
    applyFrame(result, idleAnimation, motion.current.direction, 0, metadata);
    return result;
  }, [idleAnimation, metadata, motion]);

  const material = useMemo(() => {
    const result = createLitSpriteMaterial(idleTextures[0], idleTextures[1], 0.9, 0.35, 0.9);
    // General materials use mipmaps; atlas cells must not sample neighbours.
    configureAtlasTexture(idleTextures[0]);
    configureAtlasTexture(idleTextures[1]);
    const pair = idleTextures as unknown as readonly [THREE.Texture, THREE.Texture];
    loadedTextures.set(animationUrls(idleAnimation).join("|"), Promise.resolve(pair));
    return result;
  }, [idleAnimation, idleTextures]);

  useEffect(() => {
    // Decode and upload the common movement atlas between frames instead of
    // blocking the first frame in which a nearby rat starts walking.
    prewarmAnimation(metadata.animations.walk, renderer);
  }, [metadata, renderer]);

  useEffect(() => {
    if (health <= 0) {
      dead.current = true;
      requestedOneShot.current = "death";
    } else if (health < previousHealth.current) {
      requestedOneShot.current = "hit";
    } else if (state === "attacking" && previousState.current !== "attacking") {
      requestedOneShot.current = "bite";
    }
    previousHealth.current = health;
    previousState.current = state;
  }, [health, state]);

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
    if (dead.current) desired = "death";
    else if (requestedOneShot.current) desired = requestedOneShot.current;
    else if (motion.current.moving) desired = "walk";
    else desired = "idle";
    desiredAnimation.current = desired;

    if (desired !== active.current && loadingAnimation.current !== desired) {
      loadingAnimation.current = desired;
      const definition = metadata.animations[desired];
      void loadAnimationTextures(definition).then(([albedo, normal]) => {
        if (!mesh.current || desiredAnimation.current !== desired) {
          if (loadingAnimation.current === desired) loadingAnimation.current = null;
          return;
        }
        material.map = albedo;
        material.normalMap = normal;
        material.needsUpdate = true;
        active.current = desired;
        loadingAnimation.current = null;
        frame.current = 0;
        elapsed.current = 0;
        finished.current = false;
        applyFrame(mesh.current.geometry, definition, motion.current.direction, 0, metadata);
      });
    }

    if (motion.current.direction !== lastDirection.current) {
      lastDirection.current = motion.current.direction;
      // Direction change does not reset frame or accumulator.
      applyFrame(actor.geometry, metadata.animations[active.current], motion.current.direction, frame.current, metadata);
    }

    const definition = metadata.animations[active.current];
    if (finished.current) {
      if (active.current !== "death") requestedOneShot.current = null;
      return;
    }

    const speedMultiplier = active.current === "walk"
      ? THREE.MathUtils.clamp(motion.current.speed / BASE_CREATURE_SPEED, 0.75, 1.5)
      : 1;
    elapsed.current += Math.min(delta, 0.1);
    const secondsPerFrame = 1 / (definition.fps * speedMultiplier);
    while (elapsed.current >= secondsPerFrame) {
      elapsed.current -= secondsPerFrame;
      if (frame.current + 1 >= definition.framesPerDirection) {
        if (definition.playback === "loop") frame.current = 0;
        else {
          frame.current = definition.framesPerDirection - 1;
          finished.current = true;
        }
      } else frame.current += 1;
      applyFrame(actor.geometry, definition, motion.current.direction, frame.current, metadata);
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
  animation: AtlasAnimation,
  direction: Direction8,
  frame: number,
  metadata: CastleRatMetadata,
) {
  const row = animation.directionRows[isometricAtlasDirection(direction)];
  const frameWidth = animation.frameWidth ?? metadata.frameWidth;
  const frameHeight = animation.frameHeight ?? metadata.frameHeight;
  const atlasWidth = animation.columns * frameWidth;
  const atlasHeight = animation.rows * frameHeight;
  const u0 = (frame * frameWidth + 0.5) / atlasWidth;
  const u1 = ((frame + 1) * frameWidth - 0.5) / atlasWidth;
  const vTop = 1 - (row * frameHeight + 0.5) / atlasHeight;
  const vBottom = 1 - ((row + 1) * frameHeight - 0.5) / atlasHeight;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, u0, vTop);
  uv.setXY(1, u1, vTop);
  uv.setXY(2, u0, vBottom);
  uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
}
