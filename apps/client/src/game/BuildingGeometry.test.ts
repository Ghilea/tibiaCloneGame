import { describe, expect, it } from "vitest";
import { createBuildingGeometry, translateBuildingGeometry } from "./BuildingGeometry";

describe("canonical building geometry", () => {
  for (const [width, depth] of [[4, 4], [6, 8], [10, 6]]) {
    it(`derives floor, walls, eaves and ridge from a ${width}x${depth} footprint`, () => {
      const geometry = createBuildingGeometry({ originX: 10, originY: 10, width, depth, baseZ: 7 }, 70, 0.25, 46);
      expect(geometry.floorTiles).toHaveLength(width * depth);
      expect(geometry.base.north).toEqual({ x: 10, y: 10, z: 7 });
      expect(geometry.base.south).toEqual({ x: 10 + width, y: 10 + depth, z: 7 });
      expect(geometry.top.north.z).toBe(77);
      expect(geometry.roof.eaves.north).toEqual({ x: 9.75, y: 9.75, z: 77 });
      expect(geometry.roof.eaves.south).toEqual({ x: 10 + width + 0.25, y: 10 + depth + 0.25, z: 77 });
      expect(geometry.roof.ridgeStart.z).toBe(123);
      expect(geometry.walls).toHaveLength(4);
    });
  }

  it("keeps every relative point identical when moved across the world", () => {
    const source = createBuildingGeometry({ originX: 0, originY: 0, width: 6, depth: 8, baseZ: 7 }, 70, 0.25, 46);
    for (const [x, y] of [[10, 10], [100, 50]]) {
      const moved = translateBuildingGeometry(source, x, y);
      expect(moved.base.south.x - moved.base.north.x).toBe(source.base.south.x - source.base.north.x);
      expect(moved.base.south.y - moved.base.north.y).toBe(source.base.south.y - source.base.north.y);
      expect(moved.roof.ridgeEnd.x - moved.roof.ridgeStart.x).toBe(source.roof.ridgeEnd.x - source.roof.ridgeStart.x);
      expect(moved.roof.ridgeEnd.y - moved.roof.ridgeStart.y).toBe(source.roof.ridgeEnd.y - source.roof.ridgeStart.y);
    }
  });
});
