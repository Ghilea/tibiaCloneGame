import { describe, expect, it } from "vitest";
import { createHouseDoorwayLayout, createHouseWindowLayout, HOUSE_DOOR_PLACEMENT } from "./DoorwayLayout";

describe("house doorway layout", () => {
  it("derives one passage that fits the leaf and a player with clearance", () => {
    const layout = createHouseDoorwayLayout(3.2, 1.04);
    expect(layout.openingWidth).toBeGreaterThan(layout.leafWidth);
    expect(layout.openingWidth).toBeCloseTo(0.94);
    expect(layout.openingTop).toBeCloseTo(layout.openingBottom + layout.openingHeight);
    expect(layout.wallSideWidth * 2 + layout.openingWidth).toBeCloseTo(1.04);
    expect(layout.collisionWidthTiles).toBe(1);
  });

  it("keeps the opening independent of door state and below the wall top", () => {
    const layout = createHouseDoorwayLayout(3.2);
    expect(layout.openingBottom).toBeGreaterThan(0);
    expect(layout.openingTop).toBeLessThan(3.2);
    expect(layout.wallTopHeight).toBeCloseTo(3.2 - layout.openingTop);
  });

  it("gives windows their own bounded facade opening above the shared plinth", () => {
    const layout = createHouseWindowLayout(3.2);
    expect(layout.openingBottom).toBeGreaterThan(layout.plinthHeight);
    expect(layout.openingTop).toBeLessThan(3.2);
    expect(layout.wallSideWidth * 2 + layout.openingWidth).toBeCloseTo(1.04);
  });

  it("defines one fixed outward transform that does not depend on the player side", () => {
    expect(HOUSE_DOOR_PLACEMENT.hingeSide).toBe("left");
    expect(HOUSE_DOOR_PLACEMENT.closedAngle).toBe(0);
    expect(HOUSE_DOOR_PLACEMENT.outwardOpenAngle).toBe(Math.PI / 2);
  });
});
