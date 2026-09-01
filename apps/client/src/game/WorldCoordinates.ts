export const WORLD_TILE_SIZE = 1;

export function tileCenter(value: number): number {
  return (value + 0.5) * WORLD_TILE_SIZE;
}

export function worldToTile(value: number): number {
  return Math.floor(value / WORLD_TILE_SIZE);
}
