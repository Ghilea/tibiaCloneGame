import type { MutableRefObject } from "react";
import type { ActorMotionState } from "./actorMotion";
import { SpriteCreatureRenderer } from "./SpriteCreatureRenderer";

export function CastleRatSprite({ motion, state, health, immune }: {
  motion: MutableRefObject<ActorMotionState>;
  state: string;
  health: number;
  immune?: boolean;
}) {
  return <SpriteCreatureRenderer definitionId="castle_rat" motion={motion} state={state} health={health} immune={immune} />;
}
