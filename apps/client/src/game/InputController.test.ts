import { describe, expect, it, vi } from "vitest";
import type { Position } from "../protocol";
import { CLIENT_STEP_MS, houseWallDoorAnchor, InputController, isHouseWallAnchor, movementDelta, movementStepMs, resolveMovementTarget } from "./InputController";
import { NetworkClient } from "./NetworkClient";
import { WorldState } from "./WorldState";

describe("held-key movement", () => {
  it("maps WASD directly to the top-down world axes", () => {
    expect(movementDelta(new Set(["w"]))).toEqual([0, -1]);
    expect(movementDelta(new Set(["a"]))).toEqual([-1, 0]);
    expect(movementDelta(new Set(["s"]))).toEqual([0, 1]);
    expect(movementDelta(new Set(["d"]))).toEqual([1, 0]);
  });

  it("combines two keys into a visual diagonal", () => {
    expect(movementDelta(new Set(["w", "d"]))).toEqual([1, -1]);
  });

  it("supports arrows and cancels opposing directions", () => {
    expect(movementDelta(new Set(["arrowup", "arrowleft"]))).toEqual([-1, -1]);
    expect(movementDelta(new Set(["a", "d"]))).toBeNull();
  });

  it("normalizes tile speed by taking sqrt(2) longer for diagonal steps", () => {
    expect(movementStepMs(1, 0)).toBe(CLIENT_STEP_MS);
    expect(movementStepMs(1, 1)).toBeCloseTo(CLIENT_STEP_MS * Math.SQRT2);
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

describe("world pointer interactions", () => {
  it("keeps an already selected creature targeted when duplicate pointer events arrive", () => {
    const world = new WorldState(); const network = new NetworkClient(world);
    world.attackTargetId = "creature";
    network.attack("creature");
    expect(world.attackTargetId).toBe("creature");
  });

  it("takes loot from a non-empty corpse even when an empty corpse is first on the tile", () => {
    const world = new WorldState(); const network = new NetworkClient(world); const input = new InputController(world, network);
    const tile = { x: 4, y: 5, z: 7 };
    world.localPlayerId = "player";
    world.players.set("player", { id: "player", name: "Hero", vocation: "warrior", position: { x: 4, y: 4, z: 7 }, health: 100, maxHealth: 100, level: 1, experience: 0, mana: 0, maxMana: 0, swordSkill: 1, swordTries: 0, distanceSkill: 1, distanceTries: 0, fletchingSkill: 1, fletchingTries: 0, magicLevel: 0, magicTries: 0 });
    world.groundItems = [
      { item: { instanceId: "empty-corpse", definitionId: "corpse", quantity: 1 }, position: tile, contents: [] },
      { item: { instanceId: "full-corpse", definitionId: "corpse", quantity: 1 }, position: tile, contents: [{ instanceId: "loot", definitionId: "gold_coin", quantity: 3, containerId: "full-corpse" }] },
    ];
    const pickup = vi.spyOn(network, "pickup").mockImplementation(() => undefined);
    input.lootAt(tile);
    expect(pickup).toHaveBeenCalledWith("loot");
  });
});
