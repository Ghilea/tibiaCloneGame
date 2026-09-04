import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WorldState } from "../game/WorldState";
import { effectiveMusicVolume, getAudioSettings, subscribeAudioSettings } from "./audioSettings";

type MusicMood = "menu" | "town" | "wilderness" | "swamp" | "battle";

const TRACK_BY_MOOD: Record<MusicMood, string> = {
  menu: "/assets/audio/music/medieval-minstrel-dance.mp3",
  town: "/assets/audio/music/medieval-harvest-season.mp3",
  wilderness: "/assets/audio/music/medieval-exploration.mp3",
  swamp: "/assets/audio/music/swamp-theme-loop.ogg",
  battle: "/assets/audio/music/battle-theme.mp3",
};

function MusicPlayer({ mood }: { mood: MusicMood }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const started = useRef(false);
  const track = TRACK_BY_MOOD[mood];
  const settings = useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
  const volume = effectiveMusicVolume(settings);

  useEffect(() => {
    const element = new Audio();
    element.preload = "metadata";
    element.volume = volume;
    element.loop = mood === "swamp";
    audio.current = element;
    const start = () => {
      if (started.current) return;
      started.current = true;
      element.play().catch(() => {});
    };
    element.src = track;
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      element.pause();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const element = audio.current;
    if (!element || element.src.endsWith(track)) return;
    element.pause();
    element.src = track;
    element.loop = mood === "swamp";
    if (started.current) void element.play().catch(() => {});
  }, [mood, track]);

  return null;
}

export function MenuMusic() {
  return <MusicPlayer mood="menu" />;
}

export function WorldMusic({ world }: { world: WorldState }) {
  useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => world.revision + world.visualRevision,
  );

  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  const isInTown = player && (
    [...world.npcs.values()].some((npc) => npc.position.z === player.position.z
      && Math.abs(npc.position.x - player.position.x) <= 14
      && Math.abs(npc.position.y - player.position.y) <= 14)
    || world.buildingsNear(player.position).some((building) =>
      player.position.x >= building.x - 5
      && player.position.x < building.x + building.width + 5
      && player.position.y >= building.y - 5
      && player.position.y < building.y + building.height + 5)
  );
  const isInSwamp = player && [...world.creatures.values()].some((creature) =>
    creature.position.z === player.position.z
    && ["mireling", "mire_skulker", "reed_stalker", "fen_brute"].includes(creature.definitionId)
    && Math.abs(creature.position.x - player.position.x) <= 18
    && Math.abs(creature.position.y - player.position.y) <= 18
  );
  const mood: MusicMood = world.attackTargetId
    ? "battle"
    : isInSwamp
      ? "swamp"
      : isInTown
        ? "town"
        : "wilderness";

  return <MusicPlayer mood={mood} />;
}
