import { describe, expect, it } from "vitest";
import { NetworkClient } from "./NetworkClient";
import { WorldState } from "./WorldState";

describe("NetworkClient", () => {
  it("returns the world to an offline lobby state on an intentional disconnect", () => {
    const world = new WorldState();
    world.connection = "online";
    world.localPlayerId = "active-character";
    world.selectedPlayerId = "another-player";
    world.activeNpcId = "shopkeeper";

    new NetworkClient(world).disconnect();

    expect(world.connection).toBe("offline");
    expect(world.localPlayerId).toBeNull();
    expect(world.selectedPlayerId).toBeNull();
    expect(world.activeNpcId).toBeNull();
  });
});
