import { describe, expect, it } from "vitest";
import type { PlayerView, Position } from "../protocol";
import { WorldState } from "./WorldState";

const position = (x: number, y: number): Position => ({ x, y, z: 7 });

function player(at: Position): PlayerView {
  return {
    id: "local", name: "Traveler", outfit: "knight", secondarySkills: [], position: at,
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

describe("server message batching", () => {
  it("coalesces a creature movement burst into one visual update", () => {
    const world = new WorldState();
    world.creatures.set("rat-a", { id: "rat-a", definitionId: "castle_rat", name: "Rat A", position: position(1, 1), health: 10, maxHealth: 10, state: "idle", immune: false });
    world.creatures.set("rat-b", { id: "rat-b", definitionId: "castle_rat", name: "Rat B", position: position(2, 1), health: 10, maxHealth: 10, state: "idle", immune: false });
    let visualUpdates = 0;
    world.subscribeVisual(() => { visualUpdates += 1; });

    world.applyBatch([
      { type: "creature_moved", creature_id: "rat-a", position: position(1, 2) },
      { type: "creature_moved", creature_id: "rat-b", position: position(2, 2) },
    ]);

    expect(visualUpdates).toBe(1);
    expect(world.creatures.get("rat-a")?.position).toEqual(position(1, 2));
    expect(world.creatures.get("rat-b")?.position).toEqual(position(2, 2));
  });

  it("invalidates the rendered scene when a streamed world region arrives", () => {
    const world = new WorldState();
    let visualUpdates = 0;
    world.subscribeVisual(() => { visualUpdates += 1; });
    const map = {
      width: 35_000, height: 35_000, floor: 7, blocked: [position(100, 100)],
      water: [], bridges: [], trees: [], roads: [], floors: [], houseWalls: [],
      castleWalls: [], windows: [], torches: [], terrainMaterials: [], objects: [],
      buildings: [], doors: [], stairs: [],
    };

    world.applyBatch([{
      type: "world_region", map, ground_items: [], creatures: [], npcs: [], resource_nodes: [],
    }]);

    expect(world.map).toBe(map);
    expect(world.isMapTileBlocked(position(100, 100))).toBe(true);
    expect(visualUpdates).toBe(1);
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

describe("food status", () => {
  it("tracks the server-authoritative nourishment duration", () => {
    const world = new WorldState(); world.localPlayerId = "local";
    world.apply({ type: "food_status", player_id: "local", remaining_ms: 60_000 });
    expect(world.nourishmentDurationMs).toBe(60_000);
    expect(world.nourishmentUntil).toBeGreaterThan(Date.now() + 59_000);
  });
});

describe("secondary skills", () => {
  it("applies the server-authoritative profession selection", () => {
    const world = new WorldState();
    world.players.set("local", player(position(10, 8)));

    world.apply({ type: "player_secondary_skills_changed", player_id: "local", skills: ["alchemy", "cooking"] });

    expect(world.players.get("local")?.secondarySkills).toEqual(["alchemy", "cooking"]);
  });
});

describe("diegetic discovery feedback", () => {
  it("anchors the text to the object and exposes a separate item receipt", () => {
    const world = new WorldState();
    world.localPlayerId = "local";

    world.apply({
      type: "discovery_changed",
      player_id: "local",
      discovery_id: "mire_eastward_slick",
      text: "The black water moves against the wind.",
      reward_item_definition_id: "bog_ichor",
    });

    expect(world.worldObjectCallout).toMatchObject({ objectId: "mire_eastward_slick", text: "The black water moves against the wind." });
    expect(world.receivedItemNotice).toMatchObject({ definitionId: "bog_ichor", quantity: 1 });
    expect(world.chat).toHaveLength(0);
  });
});
