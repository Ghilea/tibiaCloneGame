import { direction8FromVector } from "./direction8";
import type { Direction8 } from "./spriteTypes";

export const MOVEMENT_EPSILON = 0.001;

export type ActorMotionState = {
  moving: boolean;
  direction: Direction8;
  /** Visual world-units travelled per second. */
  speed: number;
};

export function createActorMotionState(direction: Direction8 = "s"): ActorMotionState {
  return { moving: false, direction, speed: 0 };
}

export function sampleActorMotion(
  motion: ActorMotionState,
  dx: number,
  dz: number,
  deltaSeconds: number,
): ActorMotionState {
  const distance = Math.hypot(dx, dz);
  if (distance <= MOVEMENT_EPSILON) {
    motion.moving = false;
    motion.speed = 0;
    return motion;
  }
  motion.moving = true;
  motion.direction = direction8FromVector(dx, dz, motion.direction);
  motion.speed = distance / Math.max(deltaSeconds, 1 / 240);
  return motion;
}
