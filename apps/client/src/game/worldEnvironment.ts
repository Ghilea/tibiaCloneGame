export const WORLD_DAY_DURATION_MS = 180_000;

export type WorldWeather = "clear" | "rain";

export type WorldEnvironment = {
  day: number;
  hour: number;
  minute: number;
  daylight: number;
  period: "Dawn" | "Day" | "Dusk" | "Night";
  weather: WorldWeather;
};

export function worldEnvironment(now = Date.now()): WorldEnvironment {
  const elapsedDays = now / WORLD_DAY_DURATION_MS;
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
