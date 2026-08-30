import type { Direction8, DirectionalAnimationDef, LitSpriteActorDefinition, SpriteAnimationDef } from "./spriteTypes";

const DIRS: Direction8[] = ["n","ne","e","se","s","sw","w","nw"];

function directional(
  startFrame: number,
  framesPerDirection: number,
  fps: number,
  playback: "loop" | "once",
  eventFrame?: number,
): DirectionalAnimationDef {
  const result = {} as DirectionalAnimationDef;

  DIRS.forEach((direction, dirIndex) => {
    const start = startFrame + dirIndex * framesPerDirection;
    const frames = Array.from({ length: framesPerDirection }, (_, i) => start + i);
    const def: SpriteAnimationDef = { frames, fps, playback };
    if (eventFrame !== undefined) def.eventFrame = eventFrame;
    result[direction] = def;
  });

  return result;
}

function defineMonster(
  id: string,
  displayName: string,
  scale: number,
  width: number,
  height: number,
  animations: Record<string, DirectionalAnimationDef>,
): LitSpriteActorDefinition {
  const columns = 16;
  const highestFrame = Math.max(
    ...Object.values(animations).flatMap((directions) =>
      DIRS.flatMap((direction) => directions[direction].frames),
    ),
  );

  return {
    id,
    displayName,
    atlas: {
      image: `/assets/monsters/${id}/${id}_albedo.webp`,
      normalMap: `/assets/monsters/${id}/${id}_normal.webp`,
      frameWidth: 256,
      frameHeight: 256,
      columns,
      rows: Math.ceil((highestFrame + 1) / columns),
      anchorX: 128,
      anchorY: 235,
    },
    worldWidth: width,
    worldHeight: height,
    scale,
    animations,
    shadow: {
      width: width * scale * 0.72,
      depth: width * scale * 0.34,
      opacity: 0.22,
    },
    material: {
      roughness: 0.9,
      normalStrength: 0.9,
      alphaTest: 0.35,
    },
  };
}

export const MONSTER_SPRITES: Record<string, LitSpriteActorDefinition> = {
  castle_rat: defineMonster("castle_rat", "Castle Rat", 1.0, 0.95, 1.05, {
    idle:   directional(0,   12, 10, "loop"),
    walk:   directional(96,   8, 12, "loop"),
    run:    directional(160,  8, 16, "loop"),
    bite:   directional(224,  8, 14, "once", 4),
    attack: directional(288,  8, 14, "once", 4),
    hit:    directional(352,  5, 14, "once"),
    death:  directional(392, 10, 10, "once"),
    alert:  directional(472,  6, 10, "once"),
    eat:    directional(520,  8, 10, "loop"),
  }),

  mireling: defineMonster("mireling", "Mireling", 0.92, 0.85, 0.90, {
    idle:       directional(0,   10, 10, "loop"),
    walk:       directional(80,   8, 12, "loop"),
    run:        directional(144,  8, 16, "loop"),
    attack:     directional(208,  8, 14, "once", 4),
    leapAttack: directional(272, 10, 16, "once", 6),
    hit:        directional(352,  5, 14, "once"),
    death:      directional(392,  9, 10, "once"),
    alert:      directional(464,  6, 10, "once"),
  }),

  mire_skulker: defineMonster("mire_skulker", "Mire Skulker", 1.0, 1.05, 1.05, {
    idle:   directional(0,   10, 10, "loop"),
    walk:   directional(80,   8, 12, "loop"),
    run:    directional(144,  8, 17, "loop"),
    attack: directional(208,  8, 15, "once", 4),
    lunge:  directional(272, 10, 17, "once", 6),
    hit:    directional(352,  5, 14, "once"),
    death:  directional(392,  9, 10, "once"),
    alert:  directional(464,  6, 10, "once"),
  }),

  reed_stalker: defineMonster("reed_stalker", "Reed Stalker", 1.0, 0.95, 1.55, {
    idle:       directional(0,   12, 9, "loop"),
    walk:       directional(96,   8, 11, "loop"),
    run:        directional(160,  8, 15, "loop"),
    attack:     directional(224,  9, 13, "once", 5),
    rootAttack: directional(296, 12, 12, "once", 7),
    hit:        directional(392,  5, 14, "once"),
    death:      directional(432, 10, 10, "once"),
    alert:      directional(512,  7, 10, "once"),
  }),

  fen_brute: defineMonster("fen_brute", "Fen Brute", 1.0, 1.45, 1.75, {
    idle:       directional(0,   12, 8, "loop"),
    walk:       directional(96,   8, 10, "loop"),
    run:        directional(160,  8, 13, "loop"),
    attack:     directional(224, 10, 12, "once", 6),
    groundSlam: directional(304, 14, 12, "once", 9),
    roar:       directional(416, 12, 10, "once"),
    hit:        directional(512,  6, 12, "once"),
    death:      directional(560, 12, 9, "once"),
  }),

  crypt_guard: defineMonster("crypt_guard", "Crypt Guard", 1.0, 1.05, 1.55, {
    idle:       directional(0,   10, 9, "loop"),
    walk:       directional(80,   8, 11, "loop"),
    run:        directional(144,  8, 14, "loop"),
    attack:     directional(208, 10, 13, "once", 6),
    shieldBash: directional(288,  9, 13, "once", 5),
    hit:        directional(360,  5, 13, "once"),
    death:      directional(400, 11, 9, "once"),
    alert:      directional(488,  7, 9, "once"),
  }),

  bone_acolyte: defineMonster("bone_acolyte", "Bone Acolyte", 1.0, 1.00, 1.50, {
    idle:      directional(0,   12, 9, "loop"),
    walk:      directional(96,   8, 10, "loop"),
    run:       directional(160,  8, 14, "loop"),
    cast:      directional(224, 12, 12, "once", 8),
    raiseDead: directional(320, 14, 11, "once", 10),
    hit:       directional(432,  5, 13, "once"),
    death:     directional(472, 11, 9, "once"),
    alert:     directional(560,  7, 9, "once"),
  }),

  cellar_warden: defineMonster("cellar_warden", "Cellar Warden", 1.0, 1.65, 2.00, {
    idle:        directional(0,   12, 8, "loop"),
    walk:        directional(96,   8, 9, "loop"),
    run:         directional(160,  8, 12, "loop"),
    heavyAttack: directional(224, 12, 11, "once", 8),
    groundSlam:  directional(320, 14, 11, "once", 9),
    roar:        directional(432, 12, 9, "once"),
    hit:         directional(528,  6, 12, "once"),
    death:       directional(576, 14, 8, "once"),
  }),
};

export type MonsterSpriteId = keyof typeof MONSTER_SPRITES;

export function monsterSpriteDefinition(id: string): LitSpriteActorDefinition | undefined {
  return MONSTER_SPRITES[id];
}
