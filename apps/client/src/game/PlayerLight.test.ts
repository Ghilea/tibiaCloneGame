import { describe, expect, it } from "vitest";
import type { ItemDefinition, ItemInstance } from "../protocol";
import { BASE_PLAYER_LIGHT, playerLightProfile } from "./PlayerLight";

const torchDefinition: ItemDefinition = {
  id: "torch",
  name: "Torch",
  weight: 1,
  stackable: false,
  maxStack: 1,
  equipmentSlot: "offhand",
  pickupable: true,
  lightSource: { radius: 46, intensity: 10 },
};

describe("player light", () => {
  it("always provides a base light and only upgrades it for equipped light sources", () => {
    const definitions = new Map([[torchDefinition.id, torchDefinition]]);
    const carried: ItemInstance = { instanceId: "torch-1", definitionId: "torch", quantity: 1 };
    expect(playerLightProfile([carried], definitions)).toEqual(BASE_PLAYER_LIGHT);
    expect(playerLightProfile([{ ...carried, equippedSlot: "offhand" }], definitions)).toEqual({ radius: 46, intensity: 10 });
  });
});
