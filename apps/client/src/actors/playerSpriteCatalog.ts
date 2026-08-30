import type { LitSpriteActorDefinition } from "./spriteTypes";

/**
 * Player classes should use the same renderer as monsters.
 *
 * Keep the existing KayKit GLBs only as OFFLINE SOURCE ASSETS initially:
 * render/bake each animation from 8 isometric-relative directions into
 * albedo + normal atlases, then the runtime never loads the GLB.
 *
 * Do not delete the source GLBs until the baked sprite sets are visually signed off.
 */
export const PLAYER_SPRITE_IDS = [
  "knight",
  "ranger",
  "mage",
] as const;

export type PlayerSpriteId = (typeof PLAYER_SPRITE_IDS)[number];

export const PLAYER_REQUIRED_ANIMATIONS = [
  "idle",
  "walk",
  "run",
  "attack",
  "hit",
  "death",
] as const;

/**
 * Build-time output contract:
 *
 * /assets/characters/<id>/<id>_albedo.webp
 * /assets/characters/<id>/<id>_normal.webp
 * /assets/characters/<id>/<id>.json
 *
 * The JSON should conform to LitSpriteActorDefinition.
 */
export type PlayerSpriteDefinition = LitSpriteActorDefinition;
