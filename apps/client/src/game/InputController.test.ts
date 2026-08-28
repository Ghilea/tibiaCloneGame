import { describe, expect, it } from "vitest";
import type { Position } from "../protocol";
import { houseWallDoorAnchor, isHouseWallAnchor, movementDelta, resolveMovementTarget } from "./InputController";

describe("held-key movement", () => {
  it("maps WASD to the fixed isometric screen axes", () => {
    expect(movementDelta(new Set(["w"]))).toEqual([-1, -1]);
    expect(movementDelta(new Set(["a"]))).toEqual([-1, 1]);
    expect(movementDelta(new Set(["s"]))).toEqual([1, 1]);
    expect(movementDelta(new Set(["d"]))).toEqual([1, -1]);
  });

  it("combines two keys into a visual diagonal", () => {
    expect(movementDelta(new Set(["w", "d"]))).toEqual([0, -1]);
  });

  it("supports arrows and cancels opposing directions", () => {
    expect(movementDelta(new Set(["arrowup", "arrowleft"]))).toEqual([-1, 0]);
    expect(movementDelta(new Set(["a", "d"]))).toBeNull();
  });
});

describe("isometric wall sliding", () => {
  const origin = { x: 5, y: 5, z: 7 };
  const key = (position: { x: number; y: number }) => `${position.x}:${position.y}`;

  it("keeps a clear diagonal unchanged", () => {
    expect(resolveMovementTarget(origin, -1, -1, () => false)).toEqual({ x: 4, y: 4, z: 7 });
  });

  it("slides along the free side when an indoor wall blocks one corner", () => {
    const blocked = new Set(["4:5"]);
    expect(resolveMovementTarget(origin, -1, -1, (position) => blocked.has(key(position)))).toEqual({ x: 5, y: 4, z: 7 });
  });

  it("stops when both sides of a diagonal are blocked", () => {
    const blocked = new Set(["4:5", "5:4"]);
    expect(resolveMovementTarget(origin, -1, -1, (position) => blocked.has(key(position)))).toBeNull();
  });
});

describe("thin house-wall collision", () => {
  const buildings = [{ id: "house", name: "House", kind: "house" as const, x: 10, y: 10, width: 4, height: 4, floor: 7 }];

  it("keeps tiles on both sides walkable but detects crossing the wall edge", () => {
    expect(houseWallDoorAnchor({ x: 11, y: 9, z: 7 }, { x: 11, y: 10, z: 7 }, buildings)).toEqual({ x: 11, y: 10, z: 7 });
    expect(houseWallDoorAnchor({ x: 11, y: 10, z: 7 }, { x: 12, y: 10, z: 7 }, buildings)).toBeNull();
    expect(isHouseWallAnchor({ x: 11, y: 10, z: 7 }, buildings)).toBe(true);
    expect(isHouseWallAnchor({ x: 11, y: 11, z: 7 }, buildings)).toBe(false);
  });

  it("lets movement slide along a wall without treating its tile as a block", () => {
    const edgeBlocked = (from: Position, to: Position) => Boolean(houseWallDoorAnchor(from, to, buildings));
    expect(resolveMovementTarget({ x: 11, y: 9, z: 7 }, 1, 1, () => false, edgeBlocked)).toEqual({ x: 12, y: 9, z: 7 });
  });

  it("cannot enter an exact house corner diagonally from outside", () => {
    const edgeBlocked = (from: Position, to: Position) => Boolean(houseWallDoorAnchor(from, to, buildings));
    expect(resolveMovementTarget({ x: 9, y: 9, z: 7 }, 1, 1, () => false, edgeBlocked)).toEqual({ x: 10, y: 9, z: 7 });
  });
});
