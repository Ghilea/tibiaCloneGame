import { describe, expect, it } from "vitest";
import { createActorMotionState, sampleActorMotion } from "./actorMotion";

describe("actor motion sampling", () => {
  it.each([
    [0, -0.1, "n"], [0.1, -0.1, "ne"], [0.1, 0, "e"], [0.1, 0.1, "se"],
    [0, 0.1, "s"], [-0.1, 0.1, "sw"], [-0.1, 0, "w"], [-0.1, -0.1, "nw"],
  ] as const)("maps interpolated movement (%s, %s) to %s", (dx, dz, expected) => {
    const motion = sampleActorMotion(createActorMotionState(), dx, dz, 0.02);
    expect(motion.moving).toBe(true);
    expect(motion.direction).toBe(expected);
    expect(motion.speed).toBeGreaterThan(0);
  });

  it("keeps the last direction after interpolation stops", () => {
    const motion = createActorMotionState();
    sampleActorMotion(motion, 0.1, -0.1, 0.02);
    sampleActorMotion(motion, 0.0001, 0, 0.02);
    expect(motion).toEqual({ moving: false, direction: "ne", facing: "north", speed: 0 });
  });

  it("keeps a stable cardinal facing throughout diagonal movement", () => {
    const motion = createActorMotionState();
    sampleActorMotion(motion, 0.1, -0.1, 0.02);
    expect(motion.facing).toBe("north");
    sampleActorMotion(motion, 0.10001, -0.1, 0.02);
    sampleActorMotion(motion, 0.1, -0.10001, 0.02);
    expect(motion.facing).toBe("north");
  });
});
