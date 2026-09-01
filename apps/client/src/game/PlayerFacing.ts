export type PlayerFacing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function playerFacingFromMovement(dx: number, dy: number, fallback: PlayerFacing): PlayerFacing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  const sector = Math.round(Math.atan2(dx, dy) / (Math.PI / 4));
  return ((sector + 8) % 8) as PlayerFacing;
}
