import type { BuildingView, Position } from "../protocol";
import { NetworkClient } from "./NetworkClient";
import { WorldState } from "./WorldState";

// The server accepts a little scheduling/network jitter below this cadence.
// A held key is scheduled directly at the next eligible instant.
export const CLIENT_STEP_MS = 165;
export const MOVEMENT_CHORD_GRACE_MS = 30;

export class InputController {
  private lastMove = 0;
  private heldKeys = new Set<string>();
  private movementTimer: number | null = null;
  private attached = false;
  constructor(private world: WorldState, private network: NetworkClient) { }

  attach() {
    if (this.attached) return () => undefined;
    this.attached = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearHeldKeys);
    window.addEventListener("focusin", this.onFocusIn);
    return () => {
      if (!this.attached) return;
      this.attached = false;
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.clearHeldKeys);
      window.removeEventListener("focusin", this.onFocusIn);
      this.cancelScheduledMovement();
      this.heldKeys.clear();
    };
  }

  releaseAll() {
    this.heldKeys.clear();
    this.cancelScheduledMovement();
  }

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

  toggleDoor(doorId: string, position: Position) {
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!player) return;
    const nearby = Math.abs(player.position.x - position.x) <= 1
      && Math.abs(player.position.y - position.y) <= 1
      && player.position.z === position.z;
    if (nearby) this.network.toggleDoor(doorId);
    else this.world.addSystemMessage("Move closer to use that door.");
  }

  toggleWindow(windowId: string, position: Position) {
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!player) return;
    const nearby = Math.abs(player.position.x - position.x) <= 1
      && Math.abs(player.position.y - position.y) <= 1
      && player.position.z === position.z;
    if (nearby) {
      this.world.predictWindowToggle(windowId);
      this.network.toggleWindow(windowId);
    }
    else this.world.addSystemMessage("Move closer to use those shutters.");
  }

  interactAt(target: Position) {
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!player) return;
    const door = this.world.doorAt(target);
    if (door) {
      this.toggleDoor(door.id, door.position);
      return;
    }
    const window = this.world.windowAt(target);
    if (window) {
      this.toggleWindow(window.id, window.position);
      return;
    }
    const creature = [...this.world.creatures.values()].find((entry) => entry.position.x === target.x && entry.position.y === target.y && entry.position.z === target.z);
    if (creature) {
      this.network.attack(creature.id);
      return;
    }
    if (this.world.groundItems.some((entry) => samePosition(entry.position, target))) this.lootAt(target);
  }

  lootAt(target: Position) {
    const player = this.world.localPlayerId ? this.world.players.get(this.world.localPlayerId) : null;
    if (!player) return;
    const stack = this.world.groundItems.filter((entry) => samePosition(entry.position, target));
    if (!stack.length) return;
    const nearby = player.position.z === target.z
      && Math.abs(player.position.x - target.x) <= 1
      && Math.abs(player.position.y - target.y) <= 1;
    if (!nearby) { this.world.addSystemMessage("Move closer to pick that up."); return; }
    const containedLoot = stack.find((entry) => entry.contents.length > 0)?.contents[0];
    if (containedLoot) { this.network.pickup(containedLoot.instanceId); return; }
    const looseItem = stack.find((entry) => this.world.itemDefinitions.get(entry.item.definitionId)?.pickupable);
    if (looseItem) { this.network.pickup(looseItem.item.instanceId); return; }
    this.world.addSystemMessage("There is nothing left to take.");
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (!this.isMovementKey(key)) return;
    event.preventDefault();
    const startingFromRest = this.heldKeys.size === 0;
    const wasHeld = this.heldKeys.has(key);
    this.heldKeys.add(key);
    if (!wasHeld && this.movementTimer === null) {
      // Keydown events for a two-key diagonal do not arrive simultaneously.
      // Briefly collect the initial chord so its first tile already travels
      // in the intended direction instead of turning one full step later.
      if (startingFromRest) {
        this.movementTimer = window.setTimeout(this.flushMovement, MOVEMENT_CHORD_GRACE_MS);
      } else {
        this.flushMovement();
      }
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.heldKeys.delete(event.key.toLowerCase());
    if (this.heldKeys.size === 0) this.cancelScheduledMovement();
  };

  private clearHeldKeys = () => this.releaseAll();
  private onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) this.releaseAll();
  };

  private flushMovement = () => {
    this.movementTimer = null;
    const delta = movementDelta(this.heldKeys);
    if (!delta) return;
    const sent = this.requestMove(...delta);
    if (this.heldKeys.size === 0) return;
    const remainingCooldown = Math.max(0, CLIENT_STEP_MS - (performance.now() - this.lastMove));
    const delay = sent || remainingCooldown > 0 ? Math.max(1, remainingCooldown) : 16;
    this.movementTimer = window.setTimeout(this.flushMovement, delay);
  };

  private cancelScheduledMovement() {
    if (this.movementTimer !== null) window.clearTimeout(this.movementTimer);
    this.movementTimer = null;
  }

  private isMovementKey(key: string) {
    return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key);
  }

  private requestMove(dx: number, dy: number) {
    const now = performance.now();
    if (now - this.lastMove < CLIENT_STEP_MS || !this.world.localPlayerId) return false;
    const player = this.world.players.get(this.world.localPlayerId);
    if (!player) return false;
    const buildings = this.world.buildingsNear(player.position);
    const blocked = (position: Position) => {
      const door = this.world.doorAt(position);
      return this.world.isMapTileBlocked(position)
        || Boolean(door && !door.open && !isHouseWallAnchor(position, buildings))
        || Boolean(this.world.npcAt(position));
    };
    const wallBlocked = (from: Position, to: Position) => {
      const anchor = houseWallDoorAnchor(from, to, buildings);
      return Boolean(anchor && !this.world.doorAt(anchor)?.open);
    };
    const target = resolveMovementTarget(player.position, dx, dy, blocked, wallBlocked);
    if (!target) return false;
    this.lastMove = now;
    this.network.move(target);
    return true;
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
