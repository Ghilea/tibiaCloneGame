import * as THREE from "three";

/**
 * Keep Three.js. We are changing the actor representation, not the world renderer.
 */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * Recommended sprite-lighting setup:
 *
 * - Albedo atlas: final painted color, SRGB.
 * - Normal atlas: same exact frame packing, tangent-space normal map.
 * - Use MeshStandardMaterial on camera-facing PlaneGeometry.
 * - World PointLight/SpotLight/DirectionalLight then affect actors.
 * - Keep a cheap ground blob shadow for readability.
 *
 * If a sprite is generated from 3D (for KayKit player characters), bake a proper
 * normal pass from the source model.
 *
 * If a monster is painted/generated directly in 2D, generate a normal-map pass
 * from the approved sprite art. A height-to-normal approximation is acceptable
 * as a fallback, but a deliberately authored/baked normal map is preferable.
 */
export const SPRITE_LIGHTING_NOTES = true;
