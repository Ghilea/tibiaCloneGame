import { describe, expect, it } from "vitest";
import { CreatureAnimationController } from "./CreatureAnimationController";
import type { CreatureAnimationDefinition, SpriteCreatureDefinition } from "./spriteTypes";

const animation = (loop: boolean, priority: number, framesPerDirection = 3): CreatureAnimationDefinition => ({
  albedo: "atlas.webp", columns: framesPerDirection, rows: 4, frameWidth: 64, frameHeight: 64,
  directionRows: { north: 0, south: 1, east: 2, west: 3 },
  framesPerDirection, fps: 10, loop, priority,
});

const definition: SpriteCreatureDefinition = {
  id: "test", type: "spriteCreature", directions: ["north", "south", "east", "west"],
  renderSize: { width: 1, height: 1.5 }, collisionSize: { width: 1, height: 1 },
  anchor: { x: 0.5, y: 0.05 }, mirrorEastFromWest: false,
  material: { roughness: 1, normalStrength: 1, alphaTest: 0.35 },
  shadow: { width: 0.7, depth: 0.3, opacity: 0.2 },
  animations: {
    idle: animation(true, 10), walk: animation(true, 20), attack: { ...animation(false, 60), events: [{ frame: 1, event: "impact" }] },
    hit: animation(false, 80), death: animation(false, 100),
  },
};

describe("creature animation controller", () => {
  it("does not let locomotion interrupt a one-shot attack", () => {
    const controller = new CreatureAnimationController(definition);
    expect(controller.play("attack")).toBe(true);
    expect(controller.play("walk")).toBe(false);
    expect(controller.currentAnimation).toBe("attack");
  });

  it("emits event frames and permits a higher-priority hit", () => {
    const controller = new CreatureAnimationController(definition);
    controller.play("attack");
    expect(controller.update(0.11)).toEqual([{ animation: "attack", event: "impact" }]);
    expect(controller.play("hit")).toBe(true);
  });

  it("holds the final death frame permanently", () => {
    const controller = new CreatureAnimationController(definition);
    controller.play("death");
    controller.update(0.1); controller.update(0.1); controller.update(0.1);
    expect(controller.isFinished).toBe(true);
    expect(controller.currentFrame).toBe(2);
    expect(controller.play("idle")).toBe(false);
  });
});
