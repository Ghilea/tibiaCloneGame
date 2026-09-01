import * as THREE from "three";

/**
 * A camera-facing sprite plane that can still react to Three.js lights.
 *
 * Important implementation choices:
 * - MeshStandardMaterial keeps Three.js dynamic lights, fog and tone mapping.
 * - Per-frame normal maps make a flat plane appear to have 3D surface normals.
 * - alphaTest + depthWrite avoids most transparent-sprite sorting artifacts.
 * - UV frame selection is done on geometry UVs per actor, so texture objects can
 *   remain shared and do not need offset/repeat mutation.
 */
export function createLitSpriteMaterial(
  albedo: THREE.Texture,
  normal: THREE.Texture | null,
  roughness = 0.9,
  alphaTest = 0.35,
  normalStrength = 1.0,
): THREE.MeshStandardMaterial {
  albedo.colorSpace = THREE.SRGBColorSpace;

  albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
  if (normal) normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  albedo.magFilter = THREE.LinearFilter;
  albedo.minFilter = THREE.LinearFilter;
  if (normal) {
    normal.magFilter = THREE.LinearFilter;
    normal.minFilter = THREE.LinearFilter;
  }

  const material = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    roughness,
    metalness: 0,
    transparent: false,
    alphaTest,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  material.normalScale.set(normalStrength, normalStrength);

  // Helps cutout sprites under MSAA without turning the whole material into
  // blend-sorted transparency.
  material.alphaToCoverage = true;

  return material;
}
