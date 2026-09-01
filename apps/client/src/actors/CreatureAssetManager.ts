import * as THREE from "three";
import type { CreatureAnimationDefinition, SpriteCreatureDefinition } from "./spriteTypes";

export type CreatureAtlasPair = { albedo: THREE.Texture; normal: THREE.Texture | null };

export class CreatureAssetManager {
  private readonly definitions = new Map<string, Promise<SpriteCreatureDefinition>>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly atlases = new Map<string, Promise<CreatureAtlasPair>>();
  private readonly loader = new THREE.TextureLoader();

  load(id: string): Promise<SpriteCreatureDefinition> {
    const cached = this.definitions.get(id);
    if (cached) return cached;
    const loading = fetch(`/assets/monsters/${id}/${id}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load sprite creature ${id}: ${response.status}`);
      const definition = await response.json() as SpriteCreatureDefinition;
      if (definition.id !== id || definition.type !== "spriteCreature") {
        throw new Error(`Invalid sprite creature definition for ${id}`);
      }
      return definition;
    });
    this.definitions.set(id, loading);
    return loading;
  }

  loadAnimation(id: string, animation: CreatureAnimationDefinition): Promise<CreatureAtlasPair> {
    const root = `/assets/monsters/${id}/`;
    const key = `${root}${animation.albedo}|${animation.normal ?? ""}`;
    const cached = this.atlases.get(key);
    if (cached) return cached;
    const loading = Promise.all([
      this.loadTexture(`${root}${animation.albedo}`, true),
      animation.normal ? this.loadTexture(`${root}${animation.normal}`, false) : Promise.resolve(null),
    ]).then(([albedo, normal]) => ({ albedo, normal }));
    this.atlases.set(key, loading);
    return loading;
  }

  /** Dispose the app-lifetime cache when the entire Three.js world is torn down. */
  dispose(): void {
    for (const texture of this.textures.values()) void texture.then((loaded) => loaded.dispose());
    this.definitions.clear();
    this.textures.clear();
    this.atlases.clear();
  }

  private loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    const cached = this.textures.get(url);
    if (cached) return cached;
    const loading = this.loader.loadAsync(url).then((texture) => {
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    });
    this.textures.set(url, loading);
    return loading;
  }
}

export const creatureAssetManager = new CreatureAssetManager();
