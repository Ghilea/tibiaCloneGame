import { describe, expect, it } from "vitest";
import { projectWorld, unprojectWorld } from "./CameraProjection";

describe("camera projection", () => {
  it("round-trips isometric screen coordinates", () => {
    const screen = projectWorld(624.5, 311.25);
    const world = unprojectWorld(screen.x, screen.y);
    expect(world.x).toBeCloseTo(624.5, 8);
    expect(world.y).toBeCloseTo(311.25, 8);
  });
});
