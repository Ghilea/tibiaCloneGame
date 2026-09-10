import { describe, expect, it } from "vitest";
import { waterEdgesAt } from "./WaterEdges";

describe("water edge autotiling", () => {
  it("does not draw internal edges between water tiles", () => {
    const water = new Set(["1:1", "1:0", "2:1", "1:2", "0:1"]);
    expect(waterEdgesAt(1, 1, 4, 4, (x, y) => water.has(`${x}:${y}`), () => false)).toEqual([]);
  });

  it("uses beaches against open land and cliffs against blocked land or the world boundary", () => {
    const water = new Set(["0:1"]);
    const blocked = new Set(["1:1"]);
    expect(waterEdgesAt(0, 1, 4, 4, (x, y) => water.has(`${x}:${y}`), (x, y) => blocked.has(`${x}:${y}`))).toEqual([
      { side: "north", kind: "shore" },
      { side: "east", kind: "cliff" },
      { side: "south", kind: "shore" },
      { side: "west", kind: "cliff" },
    ]);
  });
});
