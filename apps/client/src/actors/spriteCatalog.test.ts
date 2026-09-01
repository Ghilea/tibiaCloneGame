import { describe, expect, it } from "vitest";
import { cardinalFacingFromVector, direction8FromVector, isometricAtlasDirection } from "./direction8";
import { MONSTER_SPRITES, monsterSpriteDefinition } from "./monsterSpriteCatalog";
import { DIRECTIONS } from "./spriteTypes";

const REQUIRED_IDS = [
  "castle_rat",
  "mireling",
  "mire_skulker",
  "reed_stalker",
  "fen_brute",
  "crypt_guard",
  "bone_acolyte",
  "cellar_warden",
] as const;

describe("monster sprite catalog", () => {
  it("maps every creature by its exact id", () => {
    expect(Object.keys(MONSTER_SPRITES).sort()).toEqual([...REQUIRED_IDS].sort());
    for (const id of REQUIRED_IDS) expect(monsterSpriteDefinition(id)?.id).toBe(id);
    expect(monsterSpriteDefinition("unknown_creature")).toBeUndefined();
  });

  it("keeps every animation frame inside its atlas", () => {
    for (const definition of Object.values(MONSTER_SPRITES)) {
      const frameCapacity = definition.atlas.columns * definition.atlas.rows;
      for (const directional of Object.values(definition.animations)) {
        for (const direction of DIRECTIONS) {
          expect(directional[direction].frames.length).toBeGreaterThan(0);
          for (const frame of directional[direction].frames) {
            expect(frame).toBeGreaterThanOrEqual(0);
            expect(frame).toBeLessThan(frameCapacity);
          }
        }
      }
    }
  });
});

describe("direction8FromVector", () => {
  it.each([
    [0, -1, "n"],
    [1, -1, "ne"],
    [1, 0, "e"],
    [1, 1, "se"],
    [0, 1, "s"],
    [-1, 1, "sw"],
    [-1, 0, "w"],
    [-1, -1, "nw"],
  ] as const)("maps (%s, %s) to %s", (x, z, expected) => {
    expect(direction8FromVector(x, z)).toBe(expected);
  });

  it("keeps the previous direction while stationary", () => {
    expect(direction8FromVector(0, 0, "nw")).toBe("nw");
  });
});

describe("isometric atlas direction", () => {
  it.each([
    ["n", "nw"], ["ne", "w"], ["e", "sw"], ["se", "s"],
    ["s", "se"], ["sw", "e"], ["w", "ne"], ["nw", "n"],
  ] as const)("maps world %s to camera-facing atlas row %s", (world, atlas) => {
    expect(isometricAtlasDirection(world)).toBe(atlas);
  });
});

describe("four-direction sprite facing", () => {
  it("uses only cardinal art for all eight gameplay directions", () => {
    expect(cardinalFacingFromVector(0, -1)).toBe("north");
    expect(cardinalFacingFromVector(1, -1)).toBe("north");
    expect(cardinalFacingFromVector(1, 0)).toBe("east");
    expect(cardinalFacingFromVector(1, 1)).toBe("south");
    expect(cardinalFacingFromVector(0, 1)).toBe("south");
    expect(cardinalFacingFromVector(-1, 1)).toBe("south");
    expect(cardinalFacingFromVector(-1, 0)).toBe("west");
    expect(cardinalFacingFromVector(-1, -1)).toBe("north");
  });

  it("uses previous cardinal facing as a diagonal tie-break", () => {
    expect(cardinalFacingFromVector(1, -1, "east")).toBe("east");
    expect(cardinalFacingFromVector(-1, 1, "west")).toBe("west");
  });
});
