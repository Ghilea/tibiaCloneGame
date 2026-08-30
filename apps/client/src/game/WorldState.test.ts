import { describe, expect, it } from "vitest";
import type { PlayerView, Position } from "../protocol";
import { WorldState } from "./WorldState";

const position = (x: number, y: number): Position => ({ x, y, z: 7 });

function player(at: Position): PlayerView {
  return {
    id: "local", name: "Traveler", vocation: "adventurer", position: at,
    health: 100, maxHealth: 100, level: 1, experience: 0,
    mana: 20, maxMana: 20, swordSkill: 0, swordTries: 0,
    distanceSkill: 0, distanceTries: 0, fletchingSkill: 0,
    fletchingTries: 0, magicLevel: 0, magicTries: 0,
  };
}

describe("local movement reconciliation", () => {
  it("does not roll a newer prediction back when an older step is confirmed", () => {
    const world = new WorldState();
    world.localPlayerId = "local";
    world.players.set("local", player(position(10, 8)));

    world.predictLocalMove(position(11, 8), 1);
    world.predictLocalMove(position(12, 8), 2);
    world.apply({ type: "player_moved", player_id: "local", position: position(11, 8), sequence: 1 });

    expect(world.players.get("local")?.position).toEqual(position(12, 8));
  });

  it("clears dependent predictions after a rejected move", () => {
    const world = new WorldState();
    world.localPlayerId = "local";
    world.players.set("local", player(position(10, 8)));

    world.predictLocalMove(position(11, 8), 1);
    world.predictLocalMove(position(12, 8), 2);
    world.apply({ type: "move_rejected", player_id: "local", position: position(10, 8), sequence: 1, reason: "blocked" });

    expect(world.players.get("local")?.position).toEqual(position(10, 8));
  });

  it("keeps movement off the global UI render path and ignores an identical acknowledgement", () => {
    const world = new WorldState();
    world.localPlayerId = "local";
    world.players.set("local", player(position(10, 8)));
    let worldUpdates = 0;
    let visualUpdates = 0;
    world.subscribe(() => { worldUpdates += 1; });
    world.subscribeVisual(() => { visualUpdates += 1; });

    world.predictLocalMove(position(11, 8), 1);
    expect({ worldUpdates, visualUpdates }).toEqual({ worldUpdates: 0, visualUpdates: 1 });

    world.apply({ type: "player_moved", player_id: "local", position: position(11, 8), sequence: 1 });
    expect({ worldUpdates, visualUpdates }).toEqual({ worldUpdates: 0, visualUpdates: 1 });
  });
});

describe("authored shutter synchronization", () => {
  it("applies the server state to a window id generated from an editor position", () => {
    const world = new WorldState();
    world.map = {
      width: 4, height: 4, floor: 7, blocked: [], water: [], bridges: [], trees: [],
      roads: [], floors: [], houseWalls: [], castleWalls: [], torches: [],
      terrainMaterials: [], buildings: [], doors: [], stairs: [],
      windows: [{ id: "window_7_1_0", position: position(1, 0), open: false }],
    };

    world.predictWindowToggle("window_7_1_0");
    expect(world.map.windows[0].open).toBe(true);

    world.apply({
      type: "window_changed",
      window: { id: "window_7_1_0", position: position(1, 0), open: true },
    });

    expect(world.map.windows[0].open).toBe(true);
  });
});

describe("combat feedback", () => {
  it("anchors confirmed melee damage to its target without starting an item cooldown", () => {
    const world = new WorldState();
    world.localPlayerId = "local";
    world.players.set("local", player(position(10, 8)));

    world.apply({ type: "combat_effect", source_id: "creature", target_id: "local", effect_id: "melee_hit", damage: 7, cooldown_ms: 1200 });

    expect(world.combatEffects.at(-1)).toMatchObject({ targetId: "local", damage: 7, position: position(10, 8) });
    expect(world.combatItemCooldownUntil).toBe(0);
  });
});
