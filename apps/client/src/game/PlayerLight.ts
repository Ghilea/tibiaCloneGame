import type { ItemDefinition, ItemInstance } from "../protocol";

export type PlayerLightProfile = { radius: number; intensity: number };

export const BASE_PLAYER_LIGHT: PlayerLightProfile = { radius: 5.25, intensity: 3.4 };

export function playerLightProfile(
  inventory: readonly ItemInstance[],
  definitions: ReadonlyMap<string, ItemDefinition>,
): PlayerLightProfile {
  return inventory.reduce<PlayerLightProfile>((profile, item) => {
    if (!item.equippedSlot) return profile;
    const light = definitions.get(item.definitionId)?.lightSource;
    if (!light) return profile;
    return {
      radius: Math.max(profile.radius, light.radius),
      intensity: Math.max(profile.intensity, light.intensity),
    };
  }, BASE_PLAYER_LIGHT);
}
