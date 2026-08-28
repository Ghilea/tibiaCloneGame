import { describe, expect, it } from "vitest";
import { movementDelta } from "./InputController";

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
