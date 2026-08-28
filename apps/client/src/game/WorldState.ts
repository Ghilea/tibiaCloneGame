import type { CreatureView, GroundItem, ItemDefinition, ItemInstance, MapView, NpcView, PlayerView, Position, RuneRecipe, ServerMessage, SpellDefinition } from "../protocol";

export type WorldListener = () => void;
export type ChatLine = { id: string; speaker: string; text: string };
export type CombatEffectView = { id: string; sourceId: string; targetId: string; effectId: string; damage: number; createdAt: number };
export type AreaWarningView = { id: string; sourceId: string; position: Position; effectId: string; radius: number; durationMs: number; createdAt: number };
export type IncomingTrade = { tradeId: string; requester: PlayerView };
export type TradeStateView = { tradeId: string; partner: PlayerView; yourOffer: ItemInstance[]; theirOffer: ItemInstance[]; youConfirmed: boolean; partnerConfirmed: boolean; status: "pending" | "active" };

export class WorldState {
  readonly players = new Map<string, PlayerView>();
  readonly chat: ChatLine[] = [];
  readonly itemDefinitions = new Map<string, ItemDefinition>();
  readonly creatures = new Map<string, CreatureView>();
  readonly runeRecipes = new Map<string, RuneRecipe>();
  readonly npcs = new Map<string, NpcView>();
  readonly spells = new Map<string, SpellDefinition>();
  readonly learnedSpellIds = new Set<string>();
  readonly combatEffects: CombatEffectView[] = [];
  readonly areaWarnings: AreaWarningView[] = [];
  inventory: ItemInstance[] = [];
  depot: ItemInstance[] = [];
  groundItems: GroundItem[] = [];
  inventoryWeight = 0;
  maxCapacity = 0;
  map: MapView | null = null;
  localPlayerId: string | null = null;
  attackTargetId: string | null = null;
  selectedPlayerId: string | null = null;
  playerContext: { playerId: string; x: number; y: number } | null = null;
  activeNpcId: string | null = null;
  craftingRecipeId: string | null = null;
  craftingRemaining = 0;
  craftingStatus = "idle";
  combatItemCooldownUntil = 0;
  combatItemCooldownMs = 0;
  spellCooldownUntil = 0;
  spellCooldownMs = 0;
  incomingTrade: IncomingTrade | null = null;
  trade: TradeStateView | null = null;
  connection: "offline" | "connecting" | "online" | "error" = "offline";
  ping = 0;
  revision = 0;
  private listeners = new Set<WorldListener>();
  private pendingLocalMoves = new Map<number, Position>();

  subscribe(listener: WorldListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  notify() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  apply(message: ServerMessage) {
    switch (message.type) {
      case "welcome":
        this.players.clear();
        this.combatEffects.length = 0;
        this.areaWarnings.length = 0;
        this.combatItemCooldownUntil = 0;
        this.combatItemCooldownMs = 0;
        this.spellCooldownUntil = 0;
        this.spellCooldownMs = 0;
        this.incomingTrade = null;
        this.trade = null;
        this.pendingLocalMoves.clear();
        for (const player of [...message.players, message.player]) this.players.set(player.id, player);
        this.localPlayerId = message.player.id;
        this.selectedPlayerId = null;
        this.playerContext = null;
        this.activeNpcId = null;
        this.map = message.map;
        this.itemDefinitions.clear();
        for (const definition of message.item_definitions) this.itemDefinitions.set(definition.id, definition);
        this.runeRecipes.clear();
        for (const recipe of message.rune_recipes) this.runeRecipes.set(recipe.id, recipe);
        this.spells.clear();
        for (const spell of message.spells) this.spells.set(spell.id, spell);
        this.learnedSpellIds.clear();
        for (const spellId of message.learned_spell_ids) this.learnedSpellIds.add(spellId);
        this.npcs.clear();
        for (const npc of message.npcs) this.npcs.set(npc.id, npc);
        this.inventory = message.inventory;
        this.depot = message.depot;
        this.inventoryWeight = message.inventory_weight;
        this.maxCapacity = message.max_capacity;
        this.groundItems = message.ground_items;
        this.creatures.clear();
        for (const creature of message.creatures) this.creatures.set(creature.id, creature);
        this.connection = "online";
        break;
      case "player_joined":
        this.players.set(message.player.id, message.player);
        break;
      case "player_left":
        this.players.delete(message.player_id);
        if (this.selectedPlayerId === message.player_id) this.selectedPlayerId = null;
        if (this.playerContext?.playerId === message.player_id) this.playerContext = null;
        break;
      case "player_moved": {
        const player = this.players.get(message.player_id);
        if (player) {
          if (message.player_id === this.localPlayerId) {
            for (const sequence of this.pendingLocalMoves.keys()) if (sequence <= message.sequence) this.pendingLocalMoves.delete(sequence);
            const latestPrediction = [...this.pendingLocalMoves.entries()].sort(([left], [right]) => left - right).at(-1)?.[1];
            this.players.set(player.id, { ...player, position: latestPrediction ?? message.position });
          } else {
            this.players.set(player.id, { ...player, position: message.position });
          }
        }
        break;
      }
      case "move_rejected": {
        if (this.localPlayerId === message.player_id) {
          this.pendingLocalMoves.clear();
          const player = this.players.get(this.localPlayerId);
          if (player) this.players.set(player.id, { ...player, position: message.position });
        }
        break;
      }
      case "door_changed":
        if (this.map) this.map = { ...this.map, doors: this.map.doors.map((door) => door.id === message.door.id ? message.door : door) };
        break;
      case "spoken":
        this.chat.push({ id: crypto.randomUUID(), speaker: message.player_name, text: message.text });
        if (this.chat.length > 100) this.chat.shift();
        break;
      case "pong":
        if (this.localPlayerId === message.player_id) this.ping = Date.now() - message.sent_at;
        break;
      case "inventory_changed":
        if (this.localPlayerId === message.player_id) {
          this.inventory = message.inventory;
          this.inventoryWeight = message.inventory_weight;
          this.maxCapacity = message.max_capacity;
        }
        break;
      case "depot_changed":
        if (this.localPlayerId === message.player_id) this.depot = message.depot;
        break;
      case "spells_changed":
        if (this.localPlayerId === message.player_id) {
          this.learnedSpellIds.clear();
          for (const spellId of message.learned_spell_ids) this.learnedSpellIds.add(spellId);
        }
        break;
      case "ground_items_changed":
        this.groundItems = message.ground_items;
        break;
      case "combat_effect":
        this.combatEffects.push({ id: crypto.randomUUID(), sourceId: message.source_id, targetId: message.target_id, effectId: message.effect_id, damage: message.damage, createdAt: performance.now() });
        if (this.combatEffects.length > 50) this.combatEffects.shift();
        if (message.source_id === this.localPlayerId) {
          if (this.spells.has(message.effect_id)) {
            this.spellCooldownMs = message.cooldown_ms;
            this.spellCooldownUntil = Date.now() + message.cooldown_ms;
          } else {
            this.combatItemCooldownMs = message.cooldown_ms;
            this.combatItemCooldownUntil = Date.now() + message.cooldown_ms;
          }
        }
        break;
      case "area_telegraph":
        this.areaWarnings.push({ id: crypto.randomUUID(), sourceId: message.source_id, position: message.position, effectId: message.effect_id, radius: message.radius, durationMs: message.duration_ms, createdAt: performance.now() });
        if (this.areaWarnings.length > 20) this.areaWarnings.shift();
        break;
      case "trade_requested":
        this.incomingTrade = { tradeId: message.trade_id, requester: message.requester };
        break;
      case "trade_state":
        this.incomingTrade = null;
        this.trade = { tradeId: message.trade_id, partner: message.partner, yourOffer: message.your_offer, theirOffer: message.their_offer, youConfirmed: message.you_confirmed, partnerConfirmed: message.partner_confirmed, status: message.status };
        break;
      case "trade_closed":
        if (this.incomingTrade?.tradeId === message.trade_id) this.incomingTrade = null;
        if (this.trade?.tradeId === message.trade_id) this.trade = null;
        this.chat.push({ id: crypto.randomUUID(), speaker: "Trade", text: tradeCloseMessage(message.reason) });
        break;
      case "creature_spawned":
        this.creatures.set(message.creature.id, message.creature);
        break;
      case "creature_moved": {
        const creature = this.creatures.get(message.creature_id);
        if (creature) this.creatures.set(creature.id, { ...creature, position: message.position });
        break;
      }
      case "creature_state_changed": {
        const creature = this.creatures.get(message.creature_id);
        if (creature) this.creatures.set(creature.id, { ...creature, state: message.state, immune: message.immune, health: message.health, maxHealth: message.max_health });
        break;
      }
      case "creature_damaged": {
        const creature = this.creatures.get(message.creature_id);
        if (creature) this.creatures.set(creature.id, { ...creature, health: message.health, maxHealth: message.max_health });
        break;
      }
      case "creature_died":
        this.creatures.delete(message.creature_id);
        if (this.attackTargetId === message.creature_id) this.attackTargetId = null;
        if (message.killer_id === this.localPlayerId) this.chat.push({ id: crypto.randomUUID(), speaker: "Hunt", text: `You gained ${message.experience} XP.` });
        break;
      case "player_stats_changed": {
        const player = this.players.get(message.player_id);
        if (player) this.players.set(player.id, { ...player, health: message.health, maxHealth: message.max_health, level: message.level, experience: message.experience, mana: message.mana, maxMana: message.max_mana, swordSkill: message.sword_skill, swordTries: message.sword_tries, distanceSkill: message.distance_skill, distanceTries: message.distance_tries, fletchingSkill: message.fletching_skill, fletchingTries: message.fletching_tries, magicLevel: message.magic_level, magicTries: message.magic_tries });
        break;
      }
      case "rune_crafting_changed":
        if (message.player_id === this.localPlayerId) {
          this.craftingRecipeId = message.recipe_id ?? null;
          this.craftingRemaining = message.remaining;
          this.craftingStatus = message.status;
        }
        break;
      case "player_died":
        this.chat.push({ id: crypto.randomUUID(), speaker: "World", text: message.player_id === this.localPlayerId ? "You were defeated and awoke in Greyhaven." : "A traveler was defeated." });
        break;
      case "error":
        if (["protocol_mismatch", "authentication_required", "invalid_session", "character_online"].includes(message.code)) this.connection = "error";
        this.chat.push({ id: crypto.randomUUID(), speaker: "Server", text: message.message });
        break;
    }
    this.notify();
  }

  predictLocalMove(position: Position, sequence: number) {
    if (!this.localPlayerId) return;
    const player = this.players.get(this.localPlayerId);
    if (player) {
      this.pendingLocalMoves.set(sequence, position);
      this.players.set(player.id, { ...player, position });
      this.notify();
    }
  }

  setAttackTarget(targetId: string | null) {
    this.attackTargetId = targetId;
    if (targetId) {
      this.selectedPlayerId = null;
      this.playerContext = null;
    }
    this.notify();
  }

  openPlayerContext(playerId: string, x: number, y: number) {
    this.attackTargetId = null;
    this.selectedPlayerId = playerId;
    this.playerContext = { playerId, x: Math.min(x, window.innerWidth - 190), y: Math.min(y, window.innerHeight - 150) };
    this.notify();
  }

  closePlayerContext() {
    this.playerContext = null;
    this.notify();
  }

  openNpc(npcId: string) {
    this.attackTargetId = null;
    this.selectedPlayerId = null;
    this.playerContext = null;
    this.activeNpcId = npcId;
    this.notify();
  }

  closeNpc() {
    this.activeNpcId = null;
    this.notify();
  }

  addSystemMessage(text: string) {
    this.chat.push({ id: crypto.randomUUID(), speaker: "Combat", text });
    if (this.chat.length > 100) this.chat.shift();
    this.notify();
  }
}

function tradeCloseMessage(reason: string) {
  switch (reason) {
    case "completed": return "Trade completed successfully.";
    case "declined": return "The trade request was declined.";
    case "partner_disconnected": return "Trade cancelled because the other player disconnected.";
    default: return "Trade cancelled.";
  }
}
