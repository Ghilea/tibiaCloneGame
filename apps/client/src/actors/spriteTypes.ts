export const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Direction8 = (typeof DIRECTIONS)[number];
export const CARDINAL_DIRECTIONS = ["north", "south", "east", "west"] as const;
export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

export type AnimationPlayback = "loop" | "once";

export type CreatureAnimationEvent = {
  frame: number;
  event: string;
};

export type CreatureAnimationDefinition = {
  albedo: string;
  normal?: string;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  directionRows: Partial<Record<CardinalDirection, number>>;
  framesPerDirection: number;
  fps: number;
  loop: boolean;
  priority: number;
  events?: CreatureAnimationEvent[];
};

export type SpriteCreatureDefinition = {
  id: string;
  type: "spriteCreature";
  directions: CardinalDirection[];
  renderSize: { width: number; height: number };
  collisionSize: { width: number; height: number };
  /** Normalized from the frame's bottom-left corner. */
  anchor: { x: number; y: number };
  mirrorEastFromWest: boolean;
  material: { roughness: number; normalStrength: number; alphaTest: number };
  shadow: { width: number; depth: number; opacity: number };
  animations: Record<string, CreatureAnimationDefinition>;
};

export interface SpriteAnimationDef {
  /** Atlas frame indices in playback order. */
  frames: number[];
  fps: number;
  playback: AnimationPlayback;
  /** Optional frame that should trigger the gameplay hit/event. */
  eventFrame?: number;
}

export interface DirectionalAnimationDef {
  n: SpriteAnimationDef;
  ne: SpriteAnimationDef;
  e: SpriteAnimationDef;
  se: SpriteAnimationDef;
  s: SpriteAnimationDef;
  sw: SpriteAnimationDef;
  w: SpriteAnimationDef;
  nw: SpriteAnimationDef;
}

export interface SpriteAtlasDef {
  image: string;
  normalMap: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  /** Pixel anchor measured from frame top-left. Usually center between feet. */
  anchorX: number;
  anchorY: number;
}

export interface LitSpriteActorDefinition {
  id: string;
  displayName: string;
  atlas: SpriteAtlasDef;
  worldHeight: number;
  worldWidth: number;
  /** Visual scale multiplier only. Collision stays in gameplay data. */
  scale: number;
  animations: Record<string, DirectionalAnimationDef>;
  shadow: {
    width: number;
    depth: number;
    opacity: number;
  };
  material: {
    roughness: number;
    normalStrength: number;
    alphaTest: number;
  };
}
