import type { BuildingView, CreatureView, DoorView, GroundItem, ItemDefinition, ItemInstance, MapView, NpcView, PlayerView, Position, ProfessionSkillView, ResourceNodeView, RuneRecipe, ServerMessage, SpellDefinition, WindowView } from "../protocol";
import { playerFacingFromMovement, type PlayerFacing } from "./PlayerFacing";

export type WorldListener = () => void;
export type ChatLine = { id: string; speaker: string; text: string };
export type CombatEffectView = { id: string; sourceId: string; targetId: string; effectId: string; damage: number; position: Position; createdAt: number };
export type AreaWarningView = { id: string; sourceId: string; position: Position; effectId: string; radius: number; durationMs: number; createdAt: number };
export type IncomingTrade = { tradeId: string; requester: PlayerView };
export type TradeStateView = { tradeId: string; partner: PlayerView; yourOffer: ItemInstance[]; theirOffer: ItemInstance[]; youConfirmed: boolean; partnerConfirmed: boolean; status: "pending" | "active" };
export type WorldObjectCallout = { objectId: string; text: string; key: number };
export type ReceivedItemNotice = { definitionId: string; quantity: number; key: number };

const MAP_INDEX_CHUNK_SIZE = 16;

export class WorldState {
  readonly players = new Map<string, PlayerView>();
  readonly chat: ChatLine[] = [];
  readonly itemDefinitions = new Map<string, ItemDefinition>();
  readonly creatures = new Map<string, CreatureView>();
  readonly runeRecipes = new Map<string, RuneRecipe>();
  readonly npcs = new Map<string, NpcView>();
  readonly spells = new Map<string, SpellDefinition>();
  readonly learnedSpellIds = new Set<string>();
  readonly learnedRecipeIds = new Set<string>();
  readonly resourceNodes = new Map<string, ResourceNodeView>();
  readonly professionSkills = new Map<string, ProfessionSkillView>();
  readonly discoveredKnowledgeIds = new Set<string>();
  readonly combatEffects: CombatEffectView[] = [];
  readonly areaWarnings: AreaWarningView[] = [];
  worldObjectCallout: WorldObjectCallout | null = null;
  receivedItemNotice: ReceivedItemNotice | null = null;
  inventory: ItemInstance[] = [];
  depot: ItemInstance[] = [];
  groundItems: GroundItem[] = [];
  inventoryWeight = 0;
  maxCapacity = 0;
  map: MapView | null = null;
  localPlayerId: string | null = null;
  localPlayerFacing: PlayerFacing = 4;
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
  nourishmentUntil = 0;
  nourishmentDurationMs = 0;
  incomingTrade: IncomingTrade | null = null;
  trade: TradeStateView | null = null;
  connection: "offline" | "connecting" | "online" | "error" = "offline";
  ping = 0;
  revision = 0;
  visualRevision = 0;
  // TIBIAGAME_STREAMING_FIX_V2
  // Do not use MapView object identity as a static-scene revision. Region
  // packets are cache fills; only real structure-state changes need a rebuild.
  dynamicMapRevision = 0;
  // TIBIAGAME_STREAMING_FIX_V4
  // Advances whenever a fresh streamed MapView is installed. ThreeWorld uses
  // this as a deferred data-freshness signal, separate from movement.
  streamRegionRevision = 0;
  localCorrectionRevision = 0;
  private listeners = new Set<WorldListener>();
  private visualListeners = new Set<WorldListener>();
  private batchDepth = 0;
  private pendingWorldNotification = false;
  private pendingVisualNotification = false;
  private pendingLocalMoves = new Map<number, Position>();
  private blockedTiles = new Set<string>();
  private doorsByTile = new Map<string, DoorView>();
  private windowsByTile = new Map<string, WindowView>();
  private npcsByTile = new Map<string, NpcView>();
  private buildingBuckets = new Map<string, BuildingView[]>();

  subscribe(listener: WorldListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeVisual(listener: WorldListener) {
    this.visualListeners.add(listener);
    return () => { this.visualListeners.delete(listener); };
  }

  notify() {
    if (this.batchDepth > 0) {
      this.pendingWorldNotification = true;
      return;
    }
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  notifyVisual() {
    if (this.batchDepth > 0) {
      this.pendingVisualNotification = true;
      return;
    }
    this.visualRevision += 1;
    for (const listener of this.visualListeners) listener();
  }

  prepareForConnection() {
    this.players.clear();
    this.localPlayerId = null;
    this.attackTargetId = null;
    this.selectedPlayerId = null;
    this.playerContext = null;
    this.activeNpcId = null;
    this.incomingTrade = null;
    this.trade = null;
    this.pendingLocalMoves.clear();
  }

  applyBatch(messages: readonly ServerMessage[]) {
    this.batchDepth += 1;
    try {
      for (const message of messages) this.apply(message);
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) {
        const notifyWorld = this.pendingWorldNotification;
        const notifyVisual = this.pendingVisualNotification;
        this.pendingWorldNotification = false;
        this.pendingVisualNotification = false;
        if (notifyWorld) this.notify();
        if (notifyVisual) this.notifyVisual();
      }
    }
  }

  apply(message: ServerMessage) {
    let notification: "world" | "visual" | "none" = "world";
    switch (message.type) {
      case "welcome":
        this.players.clear();
        this.combatEffects.length = 0;
        this.areaWarnings.length = 0;
        this.worldObjectCallout = null;
        this.receivedItemNotice = null;
        this.combatItemCooldownUntil = 0;
        this.combatItemCooldownMs = 0;
        this.spellCooldownUntil = 0;
        this.spellCooldownMs = 0;
        this.nourishmentUntil = 0;
        this.nourishmentDurationMs = 0;
        this.incomingTrade = null;
        this.trade = null;
        this.pendingLocalMoves.clear();
        this.localCorrectionRevision = 0;
        this.localPlayerFacing = 4;
        for (const player of [...message.players, message.player]) this.players.set(player.id, player);
        this.localPlayerId = message.player.id;
        this.selectedPlayerId = null;
        this.playerContext = null;
        this.activeNpcId = null;
        this.map = message.map;
        this.dynamicMapRevision += 1;
        this.streamRegionRevision += 1;
        this.rebuildMapIndexes();
        this.itemDefinitions.clear();
        for (const definition of message.item_definitions) this.itemDefinitions.set(definition.id, definition);
        this.runeRecipes.clear();
        for (const recipe of message.rune_recipes) this.runeRecipes.set(recipe.id, recipe);
        this.spells.clear();
        for (const spell of message.spells) this.spells.set(spell.id, spell);
        this.learnedSpellIds.clear();
        for (const spellId of message.learned_spell_ids) this.learnedSpellIds.add(spellId);
        this.learnedRecipeIds.clear();
        for (const recipeId of message.learned_recipe_ids) this.learnedRecipeIds.add(recipeId);
        this.resourceNodes.clear();
        for (const node of message.resource_nodes) this.resourceNodes.set(node.id, node);
        this.professionSkills.clear();
        for (const skill of message.profession_skills) this.professionSkills.set(skill.id, skill);
        this.discoveredKnowledgeIds.clear();
        for (const discoveryId of message.discovered_knowledge_ids) this.discoveredKnowledgeIds.add(discoveryId);
        this.npcs.clear();
        this.npcsByTile.clear();
        for (const npc of message.npcs) {
          this.npcs.set(npc.id, npc);
          this.npcsByTile.set(positionKey(npc.position), npc);
        }
        this.inventory = message.inventory;
        this.depot = message.depot;
        this.inventoryWeight = message.inventory_weight;
        this.maxCapacity = message.max_capacity;
        this.groundItems = message.ground_items;
        this.creatures.clear();
        for (const creature of message.creatures) this.creatures.set(creature.id, creature);
        this.connection = "online";
        break;
      case "world_region":
        this.map = message.map;
        this.streamRegionRevision += 1;
        this.rebuildMapIndexes();
        this.groundItems = message.ground_items;
        this.creatures.clear();
        for (const creature of message.creatures) this.creatures.set(creature.id, creature);
        this.npcs.clear();
        this.npcsByTile.clear();
        for (const npc of message.npcs) {
          this.npcs.set(npc.id, npc);
          this.npcsByTile.set(positionKey(npc.position), npc);
        }
        this.resourceNodes.clear();
        for (const node of message.resource_nodes) this.resourceNodes.set(node.id, node);
        // Static terrain is rendered by a dedicated visual subscription. A
        // region swap must invalidate that scene directly; a normal UI update
        // alone can leave ThreeWorld displaying the initial payload.
        this.notifyVisual();
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
        notification = "none";
        const player = this.players.get(message.player_id);
        if (player) {
          if (message.player_id === this.localPlayerId) {
            for (const sequence of this.pendingLocalMoves.keys()) if (sequence <= message.sequence) this.pendingLocalMoves.delete(sequence);
            const latestPrediction = [...this.pendingLocalMoves.entries()].sort(([left], [right]) => left - right).at(-1)?.[1];
            const nextPosition = latestPrediction ?? message.position;
            if (!samePosition(player.position, nextPosition)) {
              this.players.set(player.id, { ...player, position: nextPosition });
              notification = "visual";
            }
          } else {
            if (!samePosition(player.position, message.position)) {
              this.players.set(player.id, { ...player, position: message.position });
              notification = "visual";
            }
          }
        }
        break;
      }
      case "move_rejected": {
        notification = "none";
        if (this.localPlayerId === message.player_id) {
          this.localCorrectionRevision += 1;
          this.pendingLocalMoves.clear();
          const player = this.players.get(this.localPlayerId);
          if (player && !samePosition(player.position, message.position)) {
            this.players.set(player.id, { ...player, position: message.position });
            notification = "visual";
          }
        }
        break;
      }
      case "door_changed":
        if (this.map) {
          this.map = { ...this.map, doors: this.map.doors.map((door) => door.id === message.door.id ? message.door : door) };
          this.doorsByTile.set(positionKey(message.door.position), message.door);
          this.dynamicMapRevision += 1;
          notification = "visual";
        }
        break;
      case "window_changed":
        if (this.map) {
          this.map = { ...this.map, windows: this.map.windows.map((window) => window.id === message.window.id ? message.window : window) };
          this.windowsByTile.set(positionKey(message.window.position), message.window);
          this.dynamicMapRevision += 1;
          notification = "visual";
        }
        break;
      case "spoken":
        this.chat.push({ id: crypto.randomUUID(), speaker: message.player_name, text: message.text });
        if (this.chat.length > 100) this.chat.shift();
        break;
      case "pong":
        if (this.localPlayerId === message.player_id) this.ping = Date.now() - message.sent_at;
        break;
      case "player_outfit_changed": {
        const player = this.players.get(message.player_id);
        if (player) this.players.set(player.id, { ...player, outfit: message.outfit });
        break;
      }
      case "player_secondary_skills_changed": {
        const player = this.players.get(message.player_id);
        if (player) this.players.set(player.id, { ...player, secondarySkills: message.skills });
        break;
      }
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
      case "recipes_changed":
        if (this.localPlayerId === message.player_id) {
          this.learnedRecipeIds.clear();
          for (const recipeId of message.learned_recipe_ids) this.learnedRecipeIds.add(recipeId);
        }
        break;
      case "resource_nodes_changed":
        for (const node of message.resource_nodes) this.resourceNodes.set(node.id, node);
        break;
      case "profession_skills_changed":
        if (this.localPlayerId === message.player_id) {
          this.professionSkills.clear();
          for (const skill of message.skills) this.professionSkills.set(skill.id, skill);
        }
        break;
      case "discovery_changed":
        if (this.localPlayerId === message.player_id) {
          this.discoveredKnowledgeIds.add(message.discovery_id);
          const key = Date.now();
          this.worldObjectCallout = { objectId: message.discovery_id, text: message.text, key };
          this.receivedItemNotice = message.reward_item_definition_id
            ? { definitionId: message.reward_item_definition_id, quantity: 1, key }
            : null;
        }
        break;
      case "ground_items_changed":
        this.groundItems = message.ground_items;
        break;
      case "food_status":
        if (message.player_id === this.localPlayerId) {
          this.nourishmentDurationMs = message.remaining_ms;
          this.nourishmentUntil = Date.now() + message.remaining_ms;
        }
        break;
      case "combat_effect":
        this.combatEffects.push({
          id: crypto.randomUUID(), sourceId: message.source_id, targetId: message.target_id,
          effectId: message.effect_id, damage: message.damage,
          position: { ...(this.players.get(message.target_id)?.position ?? this.creatures.get(message.target_id)?.position ?? { x: 0, y: 0, z: -999 }) },
          createdAt: performance.now(),
        });
        if (this.combatEffects.length > 50) this.combatEffects.shift();
        if (message.source_id === this.localPlayerId && message.effect_id !== "melee_hit") {
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
        notification = "none";
        const creature = this.creatures.get(message.creature_id);
        if (creature && !samePosition(creature.position, message.position)) {
          this.creatures.set(creature.id, { ...creature, position: message.position });
          notification = "visual";
        }
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
        if (message.player_id === this.localPlayerId) this.maxCapacity = message.max_capacity;
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
    if (notification === "world") this.notify();
    else if (notification === "visual") this.notifyVisual();
  }

  isMapTileBlocked(position: Position) {
    return this.blockedTiles.has(positionKey(position));
  }

  doorAt(position: Position) {
    return this.doorsByTile.get(positionKey(position));
  }

  windowAt(position: Position) {
    return this.windowsByTile.get(positionKey(position));
  }

  npcAt(position: Position) {
    return this.npcsByTile.get(positionKey(position));
  }

  buildingsNear(position: Position) {
    const chunkX = Math.floor(position.x / MAP_INDEX_CHUNK_SIZE);
    const chunkY = Math.floor(position.y / MAP_INDEX_CHUNK_SIZE);
    const found = new Map<string, BuildingView>();
    for (let y = chunkY - 1; y <= chunkY + 1; y += 1) {
      for (let x = chunkX - 1; x <= chunkX + 1; x += 1) {
        for (const building of this.buildingBuckets.get(`${position.z}:${x}:${y}`) ?? []) found.set(building.id, building);
      }
    }
    return [...found.values()];
  }

  private rebuildMapIndexes() {
    this.blockedTiles.clear();
    this.doorsByTile.clear();
    this.windowsByTile.clear();
    this.buildingBuckets.clear();
    if (!this.map) return;
    for (const tile of this.map.blocked) this.blockedTiles.add(positionKey(tile));
    for (const door of this.map.doors) this.doorsByTile.set(positionKey(door.position), door);
    for (const window of this.map.windows) this.windowsByTile.set(positionKey(window.position), window);
    for (const building of this.map.buildings) {
      const minChunkX = Math.floor(building.x / MAP_INDEX_CHUNK_SIZE);
      const maxChunkX = Math.floor((building.x + building.width - 1) / MAP_INDEX_CHUNK_SIZE);
      const minChunkY = Math.floor(building.y / MAP_INDEX_CHUNK_SIZE);
      const maxChunkY = Math.floor((building.y + building.height - 1) / MAP_INDEX_CHUNK_SIZE);
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
          const key = `${building.floor}:${chunkX}:${chunkY}`;
          const entries = this.buildingBuckets.get(key);
          if (entries) entries.push(building);
          else this.buildingBuckets.set(key, [building]);
        }
      }
    }
  }

  predictLocalMove(position: Position, sequence: number) {
    if (!this.localPlayerId) return;
    const player = this.players.get(this.localPlayerId);
    if (player) {
      this.localPlayerFacing = playerFacingFromMovement(
        position.x - player.position.x,
        position.y - player.position.y,
        this.localPlayerFacing,
      );
      this.pendingLocalMoves.set(sequence, position);
      this.players.set(player.id, { ...player, position });
      this.notifyVisual();
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

  clearWorldObjectCallout(key: number) {
    if (this.worldObjectCallout?.key !== key) return;
    this.worldObjectCallout = null;
    this.notify();
  }

  clearReceivedItemNotice(key: number) {
    if (this.receivedItemNotice?.key !== key) return;
    this.receivedItemNotice = null;
    this.notify();
  }

  predictWindowToggle(windowId: string) {
    if (!this.map) return;
    const window = this.map.windows.find((entry) => entry.id === windowId);
    if (!window) return;
    this.map = {
      ...this.map,
      windows: this.map.windows.map((entry) => entry.id === windowId
        ? { ...entry, open: !entry.open }
        : entry),
    };
    const predicted = this.map.windows.find((entry) => entry.id === windowId);
    if (predicted) this.windowsByTile.set(positionKey(predicted.position), predicted);
    this.notify();
  }
}

function positionKey(position: Position) {
  return `${position.x}:${position.y}:${position.z}`;
}

function samePosition(left: Position, right: Position) {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function tradeCloseMessage(reason: string) {
  switch (reason) {
    case "completed": return "Trade completed successfully.";
    case "declined": return "The trade request was declined.";
    case "partner_disconnected": return "Trade cancelled because the other player disconnected.";
    default: return "Trade cancelled.";
  }
}
