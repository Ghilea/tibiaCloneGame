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
    const loading = (async () => {
      // TIBIAGAME_STREAMING_FIX_V5
      // Avoid decoding a large albedo and normal WebP at exactly the same time.
      const albedo = await this.loadTexture(`${root}${animation.albedo}`, true);
      const normal = animation.normal
        ? await this.loadTexture(`${root}${animation.normal}`, false)
        : null;
      return { albedo, normal };
    })();
    this.atlases.set(key, loading);
    return loading;
  }

  async preload(id: string): Promise<void> {
    const definition = await this.load(id);
    // TIBIAGAME_STREAMING_FIX_V5
    // Decode/upload at most one animation atlas pair per idle window.
    for (const animation of Object.values(definition.animations)) {
      await waitForTextureIdle();
      await this.loadAnimation(id, animation);
    }
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

// The castle rat is currently the sprite-creature path. Warm its JSON, WebP
// decode and Three.js texture cache while the player is still entering the
// world instead of paying that cost at the first on-screen encounter.
if (typeof window !== "undefined") {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  const preload = () => {
    void creatureAssetManager.preload("castle_rat").catch((error) => {
      console.warn("sprite creature preload failed", error);
    });
  };
  // TIBIAGAME_STREAMING_FIX_V5
  // No timeout: a timeout forces heavy WebP decode even during active movement.
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(preload);
  else window.setTimeout(preload, 64);
}


// TIBIAGAME_STREAMING_FIX_V5
function waitForTextureIdle(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(resolve);
    else window.setTimeout(resolve, 32);
  });
}
