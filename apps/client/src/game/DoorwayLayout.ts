/**
 * The single source of truth for a house doorway.  A house wall occupies one
 * gameplay tile, so its visual opening intentionally stays within that same
 * tile: the grid collision and the rendered passage refer to the same space.
 */
export type DoorwayLayout = Readonly<{
  collisionWidthTiles: 1;
  openingWidth: number;
  openingHeight: number;
  openingBottom: number;
  openingTop: number;
  frameThickness: number;
  frameDepth: number;
  leafWidth: number;
  leafHeight: number;
  leafDepth: number;
  thresholdHeight: number;
  plinthHeight: number;
  wallSideWidth: number;
  wallTopHeight: number;
}>;

const PLAYER_VISUAL_WIDTH = 0.58;
const PLAYER_CLEARANCE = 0.18;
const DOOR_LEAF_VISUAL_WIDTH = 0.86;
const WALL_TILE_WIDTH = 1.04;

export function createHouseDoorwayLayout(wallHeight: number, wallLength = WALL_TILE_WIDTH): DoorwayLayout {
  // This is deliberately calculated from the leaf and player silhouette, not
  // from the old door-wall model's opening.
  const requiredInnerWidth = Math.max(
    DOOR_LEAF_VISUAL_WIDTH,
    PLAYER_VISUAL_WIDTH + PLAYER_CLEARANCE * 2,
  );
  // One doorway is one passable map tile. Keep a tiny structural shoulder at
  // either end rather than letting frame geometry spill into neighbouring tiles.
  const openingWidth = Math.min(requiredInnerWidth, wallLength - 0.1);
  const thresholdHeight = 0.12;
  const openingHeight = Math.min(2.56, wallHeight - 0.24);
  const openingBottom = thresholdHeight;
  const openingTop = openingBottom + openingHeight;
  return {
    collisionWidthTiles: 1,
    openingWidth,
    openingHeight,
    openingBottom,
    openingTop,
    frameThickness: 0.07,
    frameDepth: 0.2,
    leafWidth: openingWidth - 0.08,
    leafHeight: openingHeight - 0.08,
    leafDepth: 0.09,
    thresholdHeight,
    plinthHeight: 0.54,
    wallSideWidth: Math.max(0, (wallLength - openingWidth) / 2),
    wallTopHeight: Math.max(0, wallHeight - openingTop),
  };
}
