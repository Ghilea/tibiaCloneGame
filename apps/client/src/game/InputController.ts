import type { Position } from "../protocol";
import { NetworkClient } from "./NetworkClient";
import { WorldState } from "./WorldState";

export const CLIENT_STEP_MS = 100;

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
    this.movementTimer = window.setInterval(this.flushMovement, CLIENT_STEP_MS);
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
    if (now - this.lastMove < 90 || !this.world.localPlayerId) return;
    const player = this.world.players.get(this.world.localPlayerId);
    if (!player) return;
    const target = { x: player.position.x + dx, y: player.position.y + dy, z: player.position.z };
    const blocked = (position: Position) => this.world.map?.blocked.some((tile) => tile.x === position.x && tile.y === position.y && tile.z === position.z)
      || this.world.map?.doors.some((door) => !door.open && door.position.x === position.x && door.position.y === position.y && door.position.z === position.z)
      || [...this.world.npcs.values()].some((npc) => npc.position.x === position.x && npc.position.y === position.y && npc.position.z === position.z);
    if (blocked(target)) return;
    if (dx !== 0 && dy !== 0) {
      const sideX = { x: player.position.x + dx, y: player.position.y, z: player.position.z };
      const sideY = { x: player.position.x, y: player.position.y + dy, z: player.position.z };
      if (blocked(sideX) || blocked(sideY)) return;
    }
    this.lastMove = now;
    this.network.move(target);
  }
}

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
