import * as THREE from "three";
import type { Direction8, LitSpriteActorDefinition } from "./spriteTypes";
import { createLitSpriteMaterial } from "../rendering/createLitSpriteMaterial";

export class DirectionalSpriteActor extends THREE.Group {
  readonly definition: LitSpriteActorDefinition;

  private readonly sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private animationName = "idle";
  private direction: Direction8 = "s";
  private frameCursor = 0;
  private frameAccumulator = 0;
  private finished = false;
  private readonly cameraWorldQuaternion = new THREE.Quaternion();
  private readonly parentWorldQuaternion = new THREE.Quaternion();

  constructor(
    definition: LitSpriteActorDefinition,
    albedo: THREE.Texture,
    normal: THREE.Texture,
  ) {
    super();
    this.definition = definition;

    const geometry = new THREE.PlaneGeometry(
      definition.worldWidth * definition.scale,
      definition.worldHeight * definition.scale,
      1,
      1,
    );

    // Make actor.position the atlas-defined foot position. This also supports
    // intentional transparent padding below or beside the feet.
    const anchorX = definition.atlas.anchorX / definition.atlas.frameWidth;
    const anchorY = definition.atlas.anchorY / definition.atlas.frameHeight;
    geometry.translate(
      (0.5 - anchorX) * definition.worldWidth * definition.scale,
      (anchorY - 0.5) * definition.worldHeight * definition.scale,
      0,
    );

    const material = createLitSpriteMaterial(
      albedo,
      normal,
      definition.material.roughness,
      definition.material.alphaTest,
      definition.material.normalStrength,
    );

    this.sprite = new THREE.Mesh(geometry, material);
    this.sprite.frustumCulled = true;
    this.sprite.renderOrder = 0;
    this.add(this.sprite);

    const shadowGeometry = new THREE.PlaneGeometry(
      definition.shadow.width,
      definition.shadow.depth,
    );
    shadowGeometry.rotateX(-Math.PI / 2);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: definition.shadow.opacity,
      depthWrite: false,
      depthTest: true,
    });

    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.position.y = 0.005;
    this.shadow.renderOrder = -1;
    this.add(this.shadow);

    this.applyCurrentFrame();
  }

  setDirection(direction: Direction8): void {
    if (this.direction === direction) return;
    this.direction = direction;
    this.frameCursor = 0;
    this.frameAccumulator = 0;
    this.finished = false;
    this.applyCurrentFrame();
  }

  play(animationName: string, restart = false): void {
    if (!restart && this.animationName === animationName) return;
    if (!this.definition.animations[animationName]) {
      throw new Error(`${this.definition.id}: unknown animation "${animationName}"`);
    }

    this.animationName = animationName;
    this.frameCursor = 0;
    this.frameAccumulator = 0;
    this.finished = false;
    this.applyCurrentFrame();
  }

  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Call once per frame.
   * billboardQuaternion should come from the fixed isometric camera.
   */
  update(dtSeconds: number, billboardQuaternion: THREE.Quaternion): void {
    // Plane always faces camera. Actor's gameplay direction comes from frame selection,
    // not by rotating this billboard around Y. Convert the camera's world rotation to
    // the sprite's local space so a rotated SmoothActor parent cannot skew the plane.
    this.cameraWorldQuaternion.copy(billboardQuaternion);
    this.sprite.parent?.getWorldQuaternion(this.parentWorldQuaternion);
    this.sprite.quaternion
      .copy(this.parentWorldQuaternion)
      .invert()
      .multiply(this.cameraWorldQuaternion);

    const anim = this.definition.animations[this.animationName][this.direction];
    if (this.finished || anim.frames.length <= 1) return;

    const secondsPerFrame = 1 / anim.fps;
    this.frameAccumulator += dtSeconds;

    while (this.frameAccumulator >= secondsPerFrame) {
      this.frameAccumulator -= secondsPerFrame;

      if (this.frameCursor + 1 >= anim.frames.length) {
        if (anim.playback === "loop") {
          this.frameCursor = 0;
        } else {
          this.frameCursor = anim.frames.length - 1;
          this.finished = true;
        }
      } else {
        this.frameCursor++;
      }

      this.applyCurrentFrame();
    }
  }

  private applyCurrentFrame(): void {
    const anim = this.definition.animations[this.animationName][this.direction];
    const frameIndex = anim.frames[Math.min(this.frameCursor, anim.frames.length - 1)];

    const { columns, rows } = this.definition.atlas;
    const col = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);

    const u0 = col / columns;
    const u1 = (col + 1) / columns;
    const vTop = 1 - row / rows;
    const vBottom = 1 - (row + 1) / rows;

    const uv = this.sprite.geometry.attributes.uv as THREE.BufferAttribute;

    // PlaneGeometry vertex UV order.
    uv.setXY(0, u0, vTop);
    uv.setXY(1, u1, vTop);
    uv.setXY(2, u0, vBottom);
    uv.setXY(3, u1, vBottom);
    uv.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.geometry.dispose();
    this.sprite.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
  }
}
