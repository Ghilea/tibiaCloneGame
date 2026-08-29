import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Position } from "../protocol";

const MODEL_ROOT = "/assets/models/kaykit-adventurers";
const characterFiles = {
  knight: "Knight.glb",
  mage: "Mage.glb",
  ranger: "Ranger.glb",
  rogue: "Rogue_Hooded.glb",
} as const;
const characterScale: Record<keyof typeof characterFiles, number> = {
  knight: 0.727,
  mage: 0.697,
  ranger: 0.814,
  rogue: 0.852,
};

export type CharacterKind = keyof typeof characterFiles;

export function AnimatedCharacter({ kind, position, moving }: { kind: CharacterKind; position: Position; moving?: MutableRefObject<boolean> }) {
  const character = useLoader(GLTFLoader, `${MODEL_ROOT}/${characterFiles[kind]}`);
  const general = useLoader(GLTFLoader, `${MODEL_ROOT}/Rig_Medium_General.glb`);
  const movement = useLoader(GLTFLoader, `${MODEL_ROOT}/Rig_Medium_MovementBasic.glb`);
  const model = useMemo(() => {
    const cloned = cloneSkeleton(character.scene);
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
    });
    return cloned;
  }, [character.scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const clips = useMemo(() => ({
    idle: requiredClip(general.animations, "Idle_A"),
    walk: requiredClip(movement.animations, "Walking_A"),
  }), [general.animations, movement.animations]);
  const actions = useMemo(() => ({
    idle: mixer.clipAction(clips.idle),
    walk: mixer.clipAction(clips.walk),
  }), [clips, mixer]);
  const active = useRef<"idle" | "walk">("idle");
  const movingUntil = useRef(0);
  const previousPosition = useRef({ x: position.x, y: position.y });

  useEffect(() => {
    if (position.x !== previousPosition.current.x || position.y !== previousPosition.current.y) {
      movingUntil.current = performance.now() + 230;
      previousPosition.current = { x: position.x, y: position.y };
    }
  }, [position.x, position.y]);

  useEffect(() => {
    actions.idle.reset().play();
    actions.walk.timeScale = 1.08;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [actions, mixer, model]);

  useFrame((_, delta) => {
    const next = (moving?.current ?? performance.now() < movingUntil.current) ? "walk" : "idle";
    if (next !== active.current) {
      actions[active.current].fadeOut(0.14);
      actions[next].reset().fadeIn(0.14).play();
      active.current = next;
    }
    mixer.update(Math.min(delta, 0.05));
  });

  return <primitive object={model} scale={characterScale[kind]} />;
}

function requiredClip(clips: THREE.AnimationClip[], name: string) {
  const clip = THREE.AnimationClip.findByName(clips, name);
  if (!clip) throw new Error(`Missing KayKit character animation: ${name}`);
  return clip;
}

Object.values(characterFiles).forEach((file) => useLoader.preload(GLTFLoader, `${MODEL_ROOT}/${file}`));
useLoader.preload(GLTFLoader, `${MODEL_ROOT}/Rig_Medium_General.glb`);
useLoader.preload(GLTFLoader, `${MODEL_ROOT}/Rig_Medium_MovementBasic.glb`);
