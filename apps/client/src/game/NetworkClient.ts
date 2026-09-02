import { CLIENT_VERSION, PROTOCOL_VERSION, type CharacterOutfit, type ClientMessage, type Position, type SecondarySkill, type ServerMessage } from "../protocol";
import { WorldState } from "./WorldState";

export class NetworkClient {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pingTimer: number | null = null;
  private attackTimer: number | null = null;
  private incomingFrame: number | null = null;
  private incomingMessages: ServerMessage[] = [];

  constructor(private world: WorldState) { }

  connect(sessionToken: string, characterId: string) {
    this.disconnect();
    this.world.connection = "connecting";
    this.world.notify();
    const url = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://127.0.0.1:4000/ws";
    this.socket = new WebSocket(url);
    this.socket.addEventListener("open", () => {
      this.send({ type: "hello", protocol_version: PROTOCOL_VERSION, client_version: CLIENT_VERSION, session_token: sessionToken, character_id: characterId });
      this.pingTimer = window.setInterval(() => this.send({ type: "ping", sent_at: Date.now() }), 3000);
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        this.incomingMessages.push(message);
        if (this.incomingFrame === null) {
          this.incomingFrame = window.requestAnimationFrame(() => this.flushIncomingMessages());
        }
      }
      catch { this.world.connection = "error"; this.world.notify(); }
    });
    this.socket.addEventListener("close", () => {
      if (this.pingTimer) window.clearInterval(this.pingTimer);
      this.stopAttackTimer();
      this.world.attackTargetId = null;
      this.world.connection = "offline";
      this.world.notify();
    });
    this.socket.addEventListener("error", () => { this.world.connection = "error"; this.world.notify(); });
  }

  move(position: Position) {
    const sequence = ++this.sequence;
    this.world.predictLocalMove(position, sequence);
    this.send({ type: "move_request", sequence, position });
  }

  toggleDoor(doorId: string) { this.send({ type: "toggle_door", door_id: doorId }); }
  toggleWindow(windowId: string) { this.send({ type: "toggle_window", window_id: windowId }); }
  say(text: string) { this.send({ type: "say", text }); }
  setOutfit(outfit: CharacterOutfit) { this.send({ type: "set_outfit", outfit }); }
  setSecondarySkills(skills: SecondarySkill[]) { this.send({ type: "set_secondary_skills", skills }); }
  pickup(instanceId: string) { this.send({ type: "pickup_item", instance_id: instanceId }); }
  eat(instanceId: string) { this.send({ type: "eat_item", instance_id: instanceId }); }
  drop(instanceId: string) { this.send({ type: "drop_item", instance_id: instanceId }); }
  moveToRoot(instanceId: string) { this.send({ type: "move_item", instance_id: instanceId, destination: { kind: "root" } }); }
  moveToContainer(instanceId: string, containerId: string) { this.send({ type: "move_item", instance_id: instanceId, destination: { kind: "container", container_id: containerId } }); }
  equip(instanceId: string, slot: string) { this.send({ type: "move_item", instance_id: instanceId, destination: { kind: "equipment", slot } }); }
  split(instanceId: string, quantity: number) { this.send({ type: "split_item", instance_id: instanceId, quantity }); }
  startRuneCrafting(recipeId: string, quantity: number) { this.send({ type: "start_rune_crafting", recipe_id: recipeId, quantity }); }
  cancelRuneCrafting() { this.send({ type: "cancel_rune_crafting" }); }
  requestTrade(targetId: string) { this.send({ type: "request_trade", target_id: targetId }); }
  respondTrade(tradeId: string, accept: boolean) { this.send({ type: "respond_trade", trade_id: tradeId, accept }); }
  setTradeOffer(tradeId: string, itemIds: string[]) { this.send({ type: "set_trade_offer", trade_id: tradeId, item_ids: itemIds }); }
  confirmTrade(tradeId: string) { this.send({ type: "confirm_trade", trade_id: tradeId }); }
  cancelTrade(tradeId: string) { this.send({ type: "cancel_trade", trade_id: tradeId }); }
  buyFromNpc(npcId: string, offerId: string, quantity: number) { this.send({ type: "buy_from_npc", npc_id: npcId, offer_id: offerId, quantity }); }
  learnSpell(npcId: string, spellId: string) { this.send({ type: "learn_spell", npc_id: npcId, spell_id: spellId }); }
  learnRecipeFromNpc(npcId: string, recipeId: string) { this.send({ type: "learn_recipe_from_npc", npc_id: npcId, recipe_id: recipeId }); }
  learnRecipeFromItem(instanceId: string) { this.send({ type: "learn_recipe_from_item", instance_id: instanceId }); }
  castSpell(spellId: string) { if (this.world.attackTargetId) this.send({ type: "cast_spell", spell_id: spellId, target_id: this.world.attackTargetId }); }
  depositItem(npcId: string, instanceId: string) { this.send({ type: "deposit_item", npc_id: npcId, instance_id: instanceId }); }
  withdrawItem(npcId: string, instanceId: string) { this.send({ type: "withdraw_item", npc_id: npcId, instance_id: instanceId }); }
  useItem(instanceId: string) {
    if (!this.world.attackTargetId) {
      this.world.addSystemMessage("Select a living target before using a sigil.");
      return;
    }
    if (Date.now() < this.world.combatItemCooldownUntil) return;
    this.send({ type: "use_item", instance_id: instanceId, target_id: this.world.attackTargetId });
  }
  attack(targetId: string) {
    if (this.world.attackTargetId === targetId) {
      // Repeated pointer events must never toggle a valid target off.
      // Clearing the target remains an explicit UI/Escape action.
      this.sendAttackIntent();
      return;
    }
    this.world.setAttackTarget(targetId);
    this.sendAttackIntent();
    this.stopAttackTimer();
    this.attackTimer = window.setInterval(() => this.sendAttackIntent(), 150);
  }

  clearAttackTarget() {
    this.stopAttackTimer();
    this.world.setAttackTarget(null);
  }

  disconnect() {
    this.clearAttackTarget();
    if (this.incomingFrame !== null) window.cancelAnimationFrame(this.incomingFrame);
    this.incomingFrame = null;
    this.incomingMessages.length = 0;
    this.socket?.close();
    this.socket = null;
  }

  private flushIncomingMessages() {
    this.incomingFrame = null;
    const messages = this.incomingMessages.splice(0);
    if (messages.length === 0) return;
    const previousFloor = this.world.localPlayerId
      ? this.world.players.get(this.world.localPlayerId)?.position.z
      : undefined;
    this.world.applyBatch(messages);
    const currentFloor = this.world.localPlayerId
      ? this.world.players.get(this.world.localPlayerId)?.position.z
      : undefined;
    if (previousFloor !== undefined && currentFloor !== previousFloor) this.clearAttackTarget();
    if (messages.some((message) => message.type === "creature_died") && this.world.attackTargetId === null) {
      this.stopAttackTimer();
    }
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendAttackIntent() {
    if (this.world.attackTargetId) this.send({ type: "attack_request", target_id: this.world.attackTargetId });
  }

  private stopAttackTimer() {
    if (this.attackTimer !== null) window.clearInterval(this.attackTimer);
    this.attackTimer = null;
  }
}
