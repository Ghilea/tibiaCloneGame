export type WaterEdgeSide = "north" | "east" | "south" | "west";
export type WaterEdgeKind = "shore" | "cliff";
export type WaterEdge = { side: WaterEdgeSide; kind: WaterEdgeKind };

const directions: ReadonlyArray<{ side: WaterEdgeSide; dx: number; dy: number }> = [
  { side: "north", dx: 0, dy: -1 },
  { side: "east", dx: 1, dy: 0 },
  { side: "south", dx: 0, dy: 1 },
  { side: "west", dx: -1, dy: 0 },
];

export function waterEdgesAt(
  x: number,
  y: number,
  width: number,
  height: number,
  isWater: (x: number, y: number) => boolean,
  isBlocked: (x: number, y: number) => boolean,
): WaterEdge[] {
  if (!isWater(x, y)) return [];
  const edges: WaterEdge[] = [];
  for (const direction of directions) {
    const neighbourX = x + direction.dx;
    const neighbourY = y + direction.dy;
    if (isWater(neighbourX, neighbourY)) continue;
    const outside = neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height;
    edges.push({ side: direction.side, kind: outside || isBlocked(neighbourX, neighbourY) ? "cliff" : "shore" });
  }
  return edges;
}
