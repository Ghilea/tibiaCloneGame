import type { CreatureAnimationDefinition, SpriteCreatureDefinition } from "./spriteTypes";

export type AnimationFrameEvent = { animation: string; event: string };

export class CreatureAnimationController {
  private animation = "idle";
  private frame = 0;
  private elapsed = 0;
  private finished = false;

  constructor(private readonly definition: SpriteCreatureDefinition) {
    if (!definition.animations.idle) throw new Error(`${definition.id}: idle animation is required`);
  }

  get currentAnimation(): string { return this.animation; }
  get currentFrame(): number { return this.frame; }
  get isFinished(): boolean { return this.finished; }

  play(name: string, restart = false): boolean {
    const next = this.required(name);
    const current = this.required(this.animation);
    if (!restart && name === this.animation) return false;
    if (!this.finished && !current.loop && next.priority < current.priority) return false;
    if (this.animation === "death" && this.finished) return false;
    this.animation = name;
    this.frame = 0;
    this.elapsed = 0;
    this.finished = false;
    return true;
  }

  update(seconds: number): AnimationFrameEvent[] {
    const animation = this.required(this.animation);
    if (this.finished || animation.framesPerDirection <= 1) return [];
    const events: AnimationFrameEvent[] = [];
    this.elapsed += Math.min(seconds, 0.1);
    const frameDuration = 1 / animation.fps;
    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      if (this.frame + 1 >= animation.framesPerDirection) {
        if (animation.loop) this.frame = 0;
        else {
          this.frame = animation.framesPerDirection - 1;
          this.finished = true;
        }
      } else this.frame += 1;
      for (const event of animation.events ?? []) {
        if (event.frame === this.frame) events.push({ animation: this.animation, event: event.event });
      }
    }
    return events;
  }

  private required(name: string): CreatureAnimationDefinition {
    const animation = this.definition.animations[name];
    if (!animation) throw new Error(`${this.definition.id}: unknown animation "${name}"`);
    return animation;
  }
}
