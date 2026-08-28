export type BuildingFootprint = {
  originX: number;
  originY: number;
  width: number;
  depth: number;
  baseZ: number;
};

export type BuildingPoint = { x: number; y: number; z: number };
export type BuildingCorners = { north: BuildingPoint; east: BuildingPoint; south: BuildingPoint; west: BuildingPoint };
export type WallEdge = { side: "north" | "east" | "south" | "west"; start: BuildingPoint; end: BuildingPoint };
export type RoofGeometry = {
  eaves: BuildingCorners;
  ridgeStart: BuildingPoint;
  ridgeEnd: BuildingPoint;
  rise: number;
};
export type BuildingGeometry = {
  footprint: BuildingFootprint;
  floorTiles: BuildingPoint[];
  base: BuildingCorners;
  top: BuildingCorners;
  walls: WallEdge[];
  roof: RoofGeometry;
};

const corners = (minX: number, minY: number, maxX: number, maxY: number, z: number): BuildingCorners => ({
  north: { x: minX, y: minY, z },
  east: { x: maxX, y: minY, z },
  south: { x: maxX, y: maxY, z },
  west: { x: minX, y: maxY, z },
});

export function createBuildingGeometry(
  footprint: BuildingFootprint,
  wallHeight: number,
  roofOverhang = 0.2,
  roofRise = 46,
): BuildingGeometry {
  if (footprint.width < 1 || footprint.depth < 1) throw new Error("building footprint must be positive");
  const { originX, originY, width, depth, baseZ } = footprint;
  const maxX = originX + width; const maxY = originY + depth;
  const base = corners(originX, originY, maxX, maxY, baseZ);
  const topZ = baseZ + wallHeight;
  const top = corners(originX, originY, maxX, maxY, topZ);
  const floorTiles: BuildingPoint[] = [];
  for (let y = originY; y < maxY; y += 1) for (let x = originX; x < maxX; x += 1) floorTiles.push({ x, y, z: baseZ });
  const walls: WallEdge[] = [
    { side: "north", start: base.north, end: base.east },
    { side: "east", start: base.east, end: base.south },
    { side: "south", start: base.south, end: base.west },
    { side: "west", start: base.west, end: base.north },
  ];
  const eaves = corners(originX - roofOverhang, originY - roofOverhang, maxX + roofOverhang, maxY + roofOverhang, topZ);
  const ridgeZ = topZ + roofRise;
  const roof = width >= depth
    ? {
      eaves,
      ridgeStart: { x: eaves.north.x, y: (originY + maxY) / 2, z: ridgeZ },
      ridgeEnd: { x: eaves.east.x, y: (originY + maxY) / 2, z: ridgeZ },
      rise: roofRise,
    }
    : {
      eaves,
      ridgeStart: { x: (originX + maxX) / 2, y: eaves.north.y, z: ridgeZ },
      ridgeEnd: { x: (originX + maxX) / 2, y: eaves.west.y, z: ridgeZ },
      rise: roofRise,
    };
  return { footprint, floorTiles, base, top, walls, roof };
}

export function translateBuildingGeometry(geometry: BuildingGeometry, dx: number, dy: number) {
  return createBuildingGeometry(
    { ...geometry.footprint, originX: geometry.footprint.originX + dx, originY: geometry.footprint.originY + dy },
    geometry.top.north.z - geometry.base.north.z,
    geometry.base.north.x - geometry.roof.eaves.north.x,
    geometry.roof.rise,
  );
}
