export type AudioSettings = {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 100,
  musicVolume: 18,
  effectsVolume: 80,
  muted: false,
};

const STORAGE_KEY = "aldoria.audio-settings";
const listeners = new Set<() => void>();
let current = loadAudioSettings();

export function getAudioSettings() {
  return current;
}

export function subscribeAudioSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAudioSettings(update: Partial<AudioSettings>) {
  current = normalizeAudioSettings({ ...current, ...update });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* Storage can be unavailable. */ }
  for (const listener of listeners) listener();
}

export function effectiveMusicVolume(settings = current) {
  return settings.muted ? 0 : settings.masterVolume / 100 * settings.musicVolume / 100;
}

export function effectiveEffectsVolume(settings = current) {
  return settings.muted ? 0 : settings.masterVolume / 100 * settings.effectsVolume / 100;
}

export function normalizeAudioSettings(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    masterVolume: volume(value?.masterVolume, DEFAULT_AUDIO_SETTINGS.masterVolume),
    musicVolume: volume(value?.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
    effectsVolume: volume(value?.effectsVolume, DEFAULT_AUDIO_SETTINGS.effectsVolume),
    muted: typeof value?.muted === "boolean" ? value.muted : DEFAULT_AUDIO_SETTINGS.muted,
  };
}

function loadAudioSettings() {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_AUDIO_SETTINGS;
    return normalizeAudioSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

function volume(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(100, value)))
    : fallback;
}
