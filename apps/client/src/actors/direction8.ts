import type { CardinalDirection, Direction8 } from "./spriteTypes";

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

/**
 * Gameplay keeps all eight directions while sprite art only needs four.
 * The previous cardinal facing breaks diagonal ties, so interpolation noise
 * cannot alternate the selected atlas row every frame.
 */
export function cardinalFacingFromVector(
  x: number,
  z: number,
  previous: CardinalDirection = "south",
): CardinalDirection {
  const absX = Math.abs(x);
  const absZ = Math.abs(z);
  if (absX < 1e-6 && absZ < 1e-6) return previous;
  // A small hysteresis band absorbs sub-pixel interpolation differences on a
  // diagonal. Facing changes only when one axis is clearly dominant.
  if (absX > absZ * 1.15) return x > 0 ? "east" : "west";
  if (absZ > absX * 1.15) return z > 0 ? "south" : "north";
  if ((previous === "east" && x > 0) || (previous === "west" && x < 0)) return previous;
  if ((previous === "south" && z > 0) || (previous === "north" && z < 0)) return previous;
  // A newly pressed axis is represented by the latest sampled component in
  // callers that know input order. Motion interpolation has no such history,
  // so vertical is the deterministic initial tie-break.
  return z > 0 ? "south" : "north";
}
