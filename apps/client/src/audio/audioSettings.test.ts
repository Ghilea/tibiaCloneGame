import { describe, expect, it } from "vitest";
import { effectiveEffectsVolume, effectiveMusicVolume, normalizeAudioSettings } from "./audioSettings";

describe("audio settings", () => {
  it("clamps persisted values and combines master and channel volume", () => {
    const settings = normalizeAudioSettings({ masterVolume: 50, musicVolume: 40, effectsVolume: 150, muted: false });
    expect(settings.effectsVolume).toBe(100);
    expect(effectiveMusicVolume(settings)).toBeCloseTo(0.2);
    expect(effectiveEffectsVolume(settings)).toBeCloseTo(0.5);
    expect(effectiveMusicVolume({ ...settings, muted: true })).toBe(0);
  });
});
