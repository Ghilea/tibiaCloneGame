import { describe, expect, it } from "vitest";
import { WORLD_DAY_DURATION_MS, worldEnvironment, worldTimeLabel } from "./worldEnvironment";

describe("world environment", () => {
  it("turns one shared cycle into readable world time and light", () => {
    const midnight = worldEnvironment(0);
    const noon = worldEnvironment(WORLD_DAY_DURATION_MS / 2);

    expect(worldTimeLabel(midnight)).toBe("00:00");
    expect(midnight.period).toBe("Night");
    expect(midnight.daylight).toBeCloseTo(0);
    expect(worldTimeLabel(noon)).toBe("12:00");
    expect(noon.period).toBe("Day");
    expect(noon.daylight).toBeCloseTo(1);
  });

  it("exposes deterministic weather for future gameplay rules", () => {
    expect(worldEnvironment(WORLD_DAY_DURATION_MS * 0.5).weather).toBe("clear");
    expect(worldEnvironment(WORLD_DAY_DURATION_MS * 0.7).weather).toBe("rain");
  });
});
