export const WORLD_DAY_DURATION_MS = 180_000;

let worldTimeOffsetMs = 0;
let pausedWorldTimeMs: number | null = null;

function controlledNow(realNow: number) {
  return pausedWorldTimeMs ?? realNow + worldTimeOffsetMs;
}

export function setWorldTime(hour: number, minute: number, realNow = Date.now()) {
  const current = controlledNow(realNow);
  const dayStart = Math.floor(current / WORLD_DAY_DURATION_MS) * WORLD_DAY_DURATION_MS;
  const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.floor(hour) * 60 + Math.floor(minute)));
  const next = dayStart + (minutes / (24 * 60)) * WORLD_DAY_DURATION_MS;
  worldTimeOffsetMs += next - current;
  if (pausedWorldTimeMs !== null) pausedWorldTimeMs = next;
}

export function setWorldTimePaused(paused: boolean, realNow = Date.now()) {
  if (paused === (pausedWorldTimeMs !== null)) return;
  if (paused) pausedWorldTimeMs = controlledNow(realNow);
  else {
    worldTimeOffsetMs = pausedWorldTimeMs! - realNow;
    pausedWorldTimeMs = null;
  }
}

export function isWorldTimePaused() {
  return pausedWorldTimeMs !== null;
}

export type WorldWeather = "clear" | "rain";

export type WorldEnvironment = {
  day: number;
  hour: number;
  minute: number;
  daylight: number;
  period: "Dawn" | "Day" | "Dusk" | "Night";
  weather: WorldWeather;
};

export function worldEnvironment(now?: number): WorldEnvironment {
  const elapsedDays = controlledNow(now ?? Date.now()) / WORLD_DAY_DURATION_MS;
  const dayProgress = elapsedDays % 1;
  const totalMinutes = Math.floor(dayProgress * 24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const daylight = (Math.cos(dayProgress * Math.PI * 2 - Math.PI) + 1) / 2;
  const period = hour >= 5 && hour < 7
    ? "Dawn"
    : hour >= 7 && hour < 18
      ? "Day"
      : hour >= 18 && hour < 20
        ? "Dusk"
        : "Night";

  // Deterministic for now, so every client sees the same conditions. This is
  // also the single hook future spawn tables and weather debuffs can consume.
  const weather: WorldWeather = dayProgress >= 0.64 && dayProgress < 0.84 ? "rain" : "clear";
  return { day: (Math.floor(elapsedDays) % 365) + 1, hour, minute, daylight, period, weather };
}

export function worldTimeLabel(environment: WorldEnvironment) {
  return `${String(environment.hour).padStart(2, "0")}:${String(environment.minute).padStart(2, "0")}`;
}
