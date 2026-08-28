import { describe, expect, it } from "vitest";
import { playerFacingFromMovement } from "./MapRenderer";

describe("eight-direction player animation", () => {
  it("selects every atlas direction from isometric world movement", () => {
    expect(playerFacingFromMovement(-1, -1, 0)).toBe(4); // N
    expect(playerFacingFromMovement(0, -1, 0)).toBe(3); // NE
    expect(playerFacingFromMovement(1, -1, 0)).toBe(2); // E
    expect(playerFacingFromMovement(1, 0, 0)).toBe(1); // SE
    expect(playerFacingFromMovement(1, 1, 0)).toBe(0); // S
    expect(playerFacingFromMovement(0, 1, 0)).toBe(7); // SW
    expect(playerFacingFromMovement(-1, 1, 0)).toBe(6); // W
    expect(playerFacingFromMovement(-1, 0, 0)).toBe(5); // NW
  });
});
