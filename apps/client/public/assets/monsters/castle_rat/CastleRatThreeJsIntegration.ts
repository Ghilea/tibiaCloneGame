import * as THREE from "three";

// Castle Rat v1 atlas layout:
// - one atlas per animation
// - rows = N, NE, E, SE, S, SW, W, NW
// - columns = animation frames
// - frame size = 256x256
// - foot anchor in source frame = (128, 240)
//
// Use MeshStandardMaterial so dynamic Three.js lights remain active.
export function createCastleRatMaterial(
  albedo: THREE.Texture,
  normal: THREE.Texture,
) {
  albedo.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    roughness: 0.9,
    metalness: 0,
    alphaTest: 0.35,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });

  material.normalScale.set(0.9, 0.9);
  material.alphaToCoverage = true;
  return material;
}
