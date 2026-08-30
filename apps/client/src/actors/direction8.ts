import type { Direction8 } from "./spriteTypes";

const OCTANTS: Direction8[] = ["e", "ne", "n", "nw", "w", "sw", "s", "se"];

// The authored sprite rows describe screen-facing directions (E points left in
// the artwork). Convert semantic world direction through the fixed SE camera.
const ISOMETRIC_ATLAS_DIRECTION: Record<Direction8, Direction8> = {
  n: "nw",
  ne: "w",
  e: "sw",
  se: "s",
  s: "se",
  sw: "e",
  w: "ne",
  nw: "n",
};

/**
 * Quantize a world-space horizontal direction into 8 directions.
 * Assumes +X east/right and +Z south/down. If your project uses the inverse
 * Z convention, swap n/s here once instead of fixing every actor.
 */
export function direction8FromVector(x: number, z: number, fallback: Direction8 = "s"): Direction8 {
  if (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6) return fallback;

  // atan2 is measured from +X. We negate Z because north is -Z.
  const angle = Math.atan2(-z, x);
  const octant = Math.round(angle / (Math.PI / 4));
  const normalized = (octant + 8) % 8;
  return OCTANTS[normalized];
}

export function isometricAtlasDirection(worldDirection: Direction8): Direction8 {
  return ISOMETRIC_ATLAS_DIRECTION[worldDirection];
}
