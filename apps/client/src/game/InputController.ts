import type { BuildingView, Position } from "../protocol";
import { NetworkClient } from "./NetworkClient";
import { WorldState } from "./WorldState";

// Stay comfortably above the server's 150 ms movement cooldown. Browser
// interval jitter must never turn a held key into alternating accepts/rejects.
export const CLIENT_STEP_MS = 158;

export class InputController {
  private lastMove = 0;
  private heldKeys = new Set<string>();
  private movementTimer: number | null = null;
  constructor(private world: WorldState, private network: NetworkClient) { }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearHeldKeys);
    window.addEventListener("focusin", this.onFocusIn);
    // Poll held input independently of the movement cadence. A cadence-sized
    // interval can miss the first eligible step depending on when a key was
    // pressed, producing a random pause of almost one extra tile duration.
    this.movementTimer = window.setInterval(this.flushMovement, 16);
    return () => {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.clearHeldKeys);
      window.removeEventListener("focusin", this.onFocusIn);
      if (this.movementTimer !== null) window.clearInterval(this.movementTimer);
      this.movementTimer = null;
      this.heldKeys.clear();
    };
  }

  releaseAll() { this.heldKeys.clear(); }

  targetCreature(creatureId: string) { this.world.closePlayerContext(); this.network.attack(creatureId); }
  interactPlayer(playerId: string, x: number, y: number) { this.world.openPlayerContext(playerId, x, y); }
  interactNpc(npcId: string) {
    const npc = this.world.npcs.get(npcId);
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!npc || !player) return;
    const nearby = npc.position.z === player.position.z
      && Math.abs(npc.position.x - player.position.x) <= 1
      && Math.abs(npc.position.y - player.position.y) <= 1;
    if (!nearby) {
      this.world.addSystemMessage(`Move closer to speak with ${npc.name}.`);
      return;
    }
    this.world.openNpc(npcId);
  }

  interactAt(target: Position) {
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!player) return;
    const door = this.world.map?.doors.find((entry) => entry.position.x === target.x && entry.position.y === target.y && entry.position.z === target.z);
    if (door) {
      const nearby = Math.abs(player.position.x - target.x) <= 1 && Math.abs(player.position.y - target.y) <= 1;
      if (nearby) this.network.toggleDoor(door.id);
      else this.world.addSystemMessage("Move closer to use that door.");
      return;
    }
    const window = this.world.map?.windows.find((entry) => samePosition(entry.position, target));
    if (window) {
      const nearby = Math.abs(player.position.x - target.x) <= 1 && Math.abs(player.position.y - target.y) <= 1;
      if (nearby) this.network.toggleWindow(window.id);
      else this.world.addSystemMessage("Move closer to use those shutters.");
      return;
    }
    const creature = [...this.world.creatures.values()].find((entry) => entry.position.x === target.x && entry.position.y === target.y && entry.position.z === target.z);
    if (creature) {
      this.network.attack(creature.id);
      return;
    }
    const item = this.world.groundItems.find((entry) => entry.position.x === target.x && entry.position.y === target.y && entry.position.z === target.z);
    if (item && Math.abs(player.position.x - target.x) <= 1 && Math.abs(player.position.y - target.y) <= 1) {
      const loot = item.contents[0];
      if (loot) this.network.pickup(loot.instanceId);
      else if (this.world.itemDefinitions.get(item.item.definitionId)?.pickupable) this.network.pickup(item.item.instanceId);
      return;
    }
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (!this.isMovementKey(key)) return;
    event.preventDefault();
    const wasHeld = this.heldKeys.has(key);
    this.heldKeys.add(key);
    if (!wasHeld) this.flushMovement();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.heldKeys.delete(event.key.toLowerCase());
  };

  private clearHeldKeys = () => this.heldKeys.clear();
  private onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) this.heldKeys.clear();
  };

  private flushMovement = () => {
    const delta = movementDelta(this.heldKeys);
    if (delta) this.requestMove(...delta);
  };

  private isMovementKey(key: string) {
    return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key);
  }

  private requestMove(dx: number, dy: number) {
    const now = performance.now();
    if (now - this.lastMove < CLIENT_STEP_MS || !this.world.localPlayerId) return;
    const player = this.world.players.get(this.world.localPlayerId);
    if (!player) return;
    const buildings = this.world.map?.buildings ?? [];
    const blocked = (position: Position) => this.world.map?.blocked.some((tile) => tile.x === position.x && tile.y === position.y && tile.z === position.z)
      || this.world.map?.doors.some((door) => !door.open && samePosition(door.position, position) && !isHouseWallAnchor(door.position, buildings))
      || [...this.world.npcs.values()].some((npc) => npc.position.x === position.x && npc.position.y === position.y && npc.position.z === position.z);
    const wallBlocked = (from: Position, to: Position) => {
      const anchor = houseWallDoorAnchor(from, to, buildings);
      return Boolean(anchor && !this.world.map?.doors.some((door) => door.open && samePosition(door.position, anchor)));
    };
    const target = resolveMovementTarget(player.position, dx, dy, blocked, wallBlocked);
    if (!target) return;
    this.lastMove = now;
    this.network.move(target);
  }
}

export function resolveMovementTarget(position: Position, dx: number, dy: number, blocked: (position: Position) => boolean, edgeBlocked: (from: Position, to: Position) => boolean = () => false): Position | null {
  const target = { x: position.x + dx, y: position.y + dy, z: position.z };
  const unavailable = (candidate: Position) => blocked(candidate) || edgeBlocked(position, candidate);
  if (dx === 0 || dy === 0) return unavailable(target) ? null : target;
  const sideX = { x: position.x + dx, y: position.y, z: position.z };
  const sideY = { x: position.x, y: position.y + dy, z: position.z };
  const sideXBlocked = unavailable(sideX); const sideYBlocked = unavailable(sideY);
  // A diagonal has two possible orthogonal routes. Check both halves of both
  // routes so entering an exact building corner cannot skip its two wall edges.
  const targetBlocked = blocked(target)
    || edgeBlocked(sideX, target)
    || edgeBlocked(sideY, target);
  if (!targetBlocked && !sideXBlocked && !sideYBlocked) return target;
  // A diagonal cannot cut a blocked corner on the server. Slide along the
  // remaining free wall axis instead of dropping the held input completely.
  if (!sideXBlocked) return sideX;
  if (!sideYBlocked) return sideY;
  return null;
}

export function houseWallDoorAnchor(from: Position, to: Position, buildings: readonly BuildingView[]): Position | null {
  if (from.z !== to.z || Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) return null;
  for (const building of buildings.filter((entry) => entry.kind === "house" && entry.floor === from.z)) {
    const maxX = building.x + building.width; const maxY = building.y + building.height;
    if (from.x === to.x && from.x >= building.x && from.x < maxX) {
      if ((from.y === building.y - 1 && to.y === building.y) || (to.y === building.y - 1 && from.y === building.y)) return { x: from.x, y: building.y, z: from.z };
      if ((from.y === maxY - 1 && to.y === maxY) || (to.y === maxY - 1 && from.y === maxY)) return { x: from.x, y: maxY - 1, z: from.z };
    }
    if (from.y === to.y && from.y >= building.y && from.y < maxY) {
      if ((from.x === building.x - 1 && to.x === building.x) || (to.x === building.x - 1 && from.x === building.x)) return { x: building.x, y: from.y, z: from.z };
      if ((from.x === maxX - 1 && to.x === maxX) || (to.x === maxX - 1 && from.x === maxX)) return { x: maxX - 1, y: from.y, z: from.z };
    }
  }
  return null;
}

export function isHouseWallAnchor(position: Position, buildings: readonly BuildingView[]): boolean {
  return buildings.some((building) => {
    if (building.kind !== "house" || building.floor !== position.z) return false;
    const maxX = building.x + building.width - 1;
    const maxY = building.y + building.height - 1;
    return position.x >= building.x && position.x <= maxX
      && position.y >= building.y && position.y <= maxY
      && (position.x === building.x || position.x === maxX || position.y === building.y || position.y === maxY);
  });
}

const samePosition = (left: Position, right: Position) => left.x === right.x && left.y === right.y && left.z === right.z;

export function movementDelta(heldKeys: ReadonlySet<string>): [number, number] | null {
  const left = heldKeys.has("a") || heldKeys.has("arrowleft");
  const right = heldKeys.has("d") || heldKeys.has("arrowright");
  const up = heldKeys.has("w") || heldKeys.has("arrowup");
  const down = heldKeys.has("s") || heldKeys.has("arrowdown");
  const screenX = Number(right) - Number(left);
  const screenY = Number(down) - Number(up);
  // The camera is fixed at 45 degrees. Convert screen-relative WASD into the
  // server's unchanged world grid: W always travels visually upward, while
  // two held keys still produce the four visual diagonals.
  const delta: [number, number] = [
    Math.sign(screenX + screenY),
    Math.sign(screenY - screenX),
  ];
  return delta[0] || delta[1] ? delta : null;
}
