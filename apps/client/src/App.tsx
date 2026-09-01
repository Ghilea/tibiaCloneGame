import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { authenticate } from "./api";
import { CharacterLobby, CharacterPreview } from "./CharacterLobby";
import { InputController } from "./game/InputController";
import { ThreeWorld } from "./game/ThreeWorld";
import { NetworkClient } from "./game/NetworkClient";
import { WorldState } from "./game/WorldState";
import { PROTOCOL_VERSION, type GroundItem, type ItemInstance } from "./protocol";
import { canCraftSigils, vocationName } from "./vocations";

const world = new WorldState();
const network = new NetworkClient(world);
const input = new InputController(world, network);
const subscribeWorldVisual = (listener: () => void) => world.subscribeVisual(listener);
const worldVisualSnapshot = () => world.visualRevision;

export default function App() {
  const [sessionToken, setSessionToken] = useState(
    () => localStorage.getItem("sessionToken") ?? "",
  );
  useSyncExternalStore(
    (callback) => world.subscribe(callback),
    () => world.revision,
  );
  useEffect(() => input.attach(), []);
  const authenticated = (token: string) => {
    localStorage.setItem("sessionToken", token);
    setSessionToken(token);
  };
  const logout = useCallback(() => {
    network.disconnect();
    localStorage.removeItem("sessionToken");
    setSessionToken("");
  }, []);
  if (world.connection === "online" && world.localPlayerId)
    return <Game onLeave={() => network.disconnect()} />;
  if (!sessionToken) return <AccountLogin onAuthenticated={authenticated} />;
  if (world.connection === "connecting") {
    return (
      <main className="game-shell loading-shell">
        <section className="viewport">
          <WorldLoadingScreen />
        </section>
      </main>
    );
  }
  return (
    <CharacterLobby
      token={sessionToken}
      connecting={false}
      onPlay={(characterId) => network.connect(sessionToken, characterId)}
      onLogout={logout}
    />
  );
}

function AccountLogin({
  onAuthenticated,
}: {
  onAuthenticated: (token: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAuthenticated(
        (await authenticate(mode, username, password)).sessionToken,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not reach the server",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">A world shaped by its people</p>
        <h1>Embers of Aldoria</h1>
        <p className="intro">
          {mode === "login"
            ? "Return to Greyhaven and continue your journey."
            : "Create an account for this development realm."}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="username">Account name</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            minLength={3}
            maxLength={24}
            autoFocus
            autoComplete="username"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            maxLength={128}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
          <button disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already have an account? Log in"}
        </button>
        <p className="version">Development realm · Protocol {PROTOCOL_VERSION}</p>
      </section>
    </main>
  );
}

type Panel = "inventory" | "crafting" | "character" | "help" | "options";

function Game({ onLeave }: { onLeave: () => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [escapeMenu, setEscapeMenu] = useState(false);
  const [showPerformance, setShowPerformance] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const emberSigil = world.inventory.find(
    (item) => item.definitionId === "ember_rune" && (item.charges ?? 0) > 0,
  );
  const emberCharges = world.inventory
    .filter((item) => item.definitionId === "ember_rune")
    .reduce((sum, item) => sum + (item.charges ?? 0), 0);
  const useEmberSigil = () => {
    if (emberSigil) network.useItem(emberSigil.instanceId);
    else world.addSystemMessage("You do not have a charged Ember Sigil.");
  };
  const emberBolt = world.spells.get("ember_bolt");
  const knowsEmberBolt = world.learnedSpellIds.has("ember_bolt");
  const castEmberBolt = () => {
    if (knowsEmberBolt) network.castSpell("ember_bolt");
    else
      world.addSystemMessage(
        "Learn Ember Bolt from Seraphine in Greyhaven first.",
      );
  };
  useEffect(() => {
    if (panel || escapeMenu || world.trade || world.incomingTrade || world.activeNpcId)
      input.releaseAll();
  }, [
    panel,
    escapeMenu,
    Boolean(world.trade),
    Boolean(world.incomingTrade),
    world.activeNpcId,
  ]);
  useEffect(() => {
    const hotkeys: Record<string, Panel> = {
      i: "inventory",
      k: "crafting",
      c: "character",
      h: "help",
    };
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (panel) {
          setPanel(null);
          return;
        }
        setEscapeMenu((current) => !current);
        world.closePlayerContext();
        world.closeNpc();
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.code === "Digit1") {
        event.preventDefault();
        useEmberSigil();
        return;
      }
      if (event.code === "Digit2") {
        event.preventDefault();
        castEmberBolt();
        return;
      }
      const next = hotkeys[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        world.closeNpc();
        setEscapeMenu(false);
        setPanel((current) => (current === next ? null : next));
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [emberSigil?.instanceId, knowsEmberBolt, panel, world.attackTargetId]);
  const local = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  const titles: Record<Panel, string> = {
    inventory: "Inventory & Equipment",
    crafting: "Crafting & Production",
    character: "Character & Skills",
    help: "Controls",
    options: "Options",
  };
  return (
    <main className={`game-shell ${reducedMotion ? "reduced-motion" : ""}`}>
      <section className="viewport">
        <ThreeWorld world={world} input={input} showDebug={showPerformance} onReady={() => setSceneReady(true)} />
        {!sceneReady && <WorldLoadingScreen />}
      </section>
      <header className="world-header">
        <strong>Embers of Aldoria</strong>
        <span>
          Greyhaven · {world.players.size} online · {world.ping} ms
        </span>
      </header>
      <section className="unit-frame">
        <div className="portrait">{local?.name.slice(0, 1)}</div>
        <div>
          <strong>{local?.name}</strong>
          <small>
            Level {local?.level} {vocationName(local?.vocation ?? "")} ·{" "}
            {local?.experience} XP
          </small>
          <ResourceBar
            kind="health"
            value={local?.health ?? 0}
            max={local?.maxHealth ?? 1}
            label={`${local?.health} / ${local?.maxHealth}`}
          />
          <ResourceBar
            kind="mana"
            value={local?.mana ?? 0}
            max={local?.maxMana ?? 1}
            label={`${local?.mana} / ${local?.maxMana}`}
          />
          <NourishmentBar />
        </div>
      </section>
      {(world.attackTargetId || world.selectedPlayerId) && <TargetFrame />}
      {world.playerContext && <PlayerContextMenu />}
      <NearbyLootWindow />
      <Chat />
      <nav className="action-dock" aria-label="Combat hotbar">
        <button
          className="ability-slot ember-sigil"
          disabled={!emberSigil || !world.attackTargetId}
          onClick={useEmberSigil}
          title="Deal 12 fire damage to your selected target"
        >
          {world.combatItemCooldownUntil > Date.now() && (
            <i
              key={world.combatItemCooldownUntil}
              className="cooldown-sweep"
              style={{ animationDuration: `${world.combatItemCooldownMs}ms` }}
            />
          )}
          <kbd>1</kbd>
          <span className="ability-glyph">ES</span>
          <small>{emberCharges}</small>
        </button>
        <button
          className="ability-slot ember-bolt"
          disabled={
            !knowsEmberBolt ||
            !world.attackTargetId ||
            (local?.mana ?? 0) < (emberBolt?.manaCost ?? 0)
          }
          onClick={castEmberBolt}
          title={
            knowsEmberBolt
              ? "Cast a mana-powered bolt at your selected target"
              : "Learn this spell from Seraphine"
          }
        >
          {world.spellCooldownUntil > Date.now() && (
            <i
              key={world.spellCooldownUntil}
              className="cooldown-sweep"
              style={{ animationDuration: `${world.spellCooldownMs}ms` }}
            />
          )}
          <kbd>2</kbd>
          <span className="ability-glyph">EB</span>
          <small>{knowsEmberBolt ? emberBolt?.manaCost ?? 0 : "—"}</small>
        </button>
        {[3, 4, 5, 6, 7, 8].map((slot) => (
          <button className="ability-slot empty-ability" key={slot} disabled title="Empty action slot">
            <kbd>{slot}</kbd>
            <span>+</span>
          </button>
        ))}
      </nav>
      <nav className="panel-dock" aria-label="Character panels">
        <DockButton
          hotkey="C"
          icon={"\u2659"}
          label="Character"
          active={panel === "character"}
          onClick={() => setPanel(panel === "character" ? null : "character")}
        />
        <DockButton
          hotkey="I"
          icon={"\u25a6"}
          label="Inventory"
          active={panel === "inventory"}
          onClick={() => setPanel(panel === "inventory" ? null : "inventory")}
        />
        <DockButton
          hotkey="K"
          icon={"\u2692"}
          label="Crafting"
          active={panel === "crafting"}
          onClick={() => setPanel(panel === "crafting" ? null : "crafting")}
        />
      </nav>
      {escapeMenu && !world.trade && !world.incomingTrade && !world.activeNpcId && (
        <EscapeMenu
          onResume={() => setEscapeMenu(false)}
          onOpen={(next) => { setEscapeMenu(false); setPanel(next); }}
          onLeave={onLeave}
        />
      )}
      {panel && !escapeMenu && !world.trade && !world.incomingTrade && !world.activeNpcId && (
        <GameModal title={titles[panel]} kind={panel} onClose={() => setPanel(null)}>
          {panel === "inventory" ? (
            <InventoryPanel />
          ) : panel === "crafting" ? (
            <RuneCraftingPanel />
          ) : panel === "character" ? (
            <CharacterPanel />
          ) : panel === "help" ? (
            <HelpPanel />
          ) : (
            <OptionsPanel
              showPerformance={showPerformance}
              reducedMotion={reducedMotion}
              onShowPerformance={setShowPerformance}
              onReducedMotion={setReducedMotion}
            />
          )}
        </GameModal>
      )}
      {world.activeNpcId &&
        !world.trade &&
        !world.incomingTrade &&
        (world.npcs.get(world.activeNpcId)?.service === "depot" ? (
          <DepotModal npcId={world.activeNpcId} />
        ) : world.npcs.get(world.activeNpcId)?.service === "spell_trainer" ? (
          <SpellTrainerModal npcId={world.activeNpcId} />
        ) : (
          <NpcShop npcId={world.activeNpcId} />
        ))}
      {world.incomingTrade && !world.trade && <TradeRequestModal />}
      {world.trade && (
        <GameModal
          title={`Trade with ${world.trade.partner.name}`}
          onClose={() => network.cancelTrade(world.trade!.tradeId)}
        >
          <TradePanel />
        </GameModal>
      )}
    </main>
  );
}

function WorldLoadingScreen() {
  return (
    <div className="world-loading" role="status" aria-live="polite">
      <div className="world-loading-emblem"><i /><i /><i /></div>
      <p>Entering Aldoria</p>
      <h2>Preparing the world around you</h2>
      <span>Only nearby terrain is prepared for rendering so even vast maps stay responsive.</span>
      <div className="world-loading-track"><b /></div>
    </div>
  );
}

function ResourceBar({
  kind,
  value,
  max,
  label,
}: {
  kind: "health" | "mana";
  value: number;
  max: number;
  label: string;
}) {
  return (
    <div className={`resource-bar ${kind}`}>
      <span style={{ width: `${(value / max) * 100}%` }} />
      <small>{label}</small>
    </div>
  );
}

function NourishmentBar() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (world.nourishmentUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [world.nourishmentUntil]);
  const remaining = Math.max(0, world.nourishmentUntil - now);
  const percent = world.nourishmentDurationMs > 0 ? remaining / world.nourishmentDurationMs * 100 : 0;
  return <div className="resource-bar nourishment" title="Food restores health and mana every two seconds while nourished">
    <span style={{ width: `${percent}%` }} />
    <small>{remaining > 0 ? `Nourished · ${Math.ceil(remaining / 1000)}s` : "Hungry"}</small>
  </div>;
}
function TargetFrame() {
  const creature = world.attackTargetId
    ? world.creatures.get(world.attackTargetId)
    : null;
  const player = world.selectedPlayerId
    ? world.players.get(world.selectedPlayerId)
    : null;
  const target = creature ?? player;
  if (!target) return null;
  const close = () => {
    if (creature) network.clearAttackTarget();
    world.selectedPlayerId = null;
    world.closePlayerContext();
  };
  return (
    <section className={`target-frame ${creature?.immune ? "immune" : ""}`}>
      <div>
        <strong>{target.name}</strong>
        <small>
          {creature
            ? creature.immune
              ? "Evading · Immune"
              : "Hostile creature"
            : `Level ${player?.level} traveler`}
        </small>
      </div>
      <ResourceBar
        kind="health"
        value={target.health}
        max={target.maxHealth}
        label={`${target.health} / ${target.maxHealth}`}
      />
      <button onClick={close}>×</button>
    </section>
  );
}
function DockButton({
  hotkey,
  icon,
  label,
  active,
  onClick,
}: {
  hotkey: string;
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`panel-button ${active ? "active" : ""}`} onClick={onClick} title={`${label} (${hotkey})`} aria-label={`${label} (${hotkey})`}>
      <span className="panel-icon" aria-hidden="true">{icon}</span>
      <kbd>{hotkey}</kbd>
    </button>
  );
}

function EscapeMenu({ onResume, onOpen, onLeave }: { onResume: () => void; onOpen: (panel: "options" | "help") => void; onLeave: () => void }) {
  return (
    <div className="pause-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onResume(); }}>
      <section className="pause-menu" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <header>
          <span>Embers of Aldoria</span>
          <h2 id="pause-title">Game Menu</h2>
        </header>
        <button className="pause-primary" onClick={onResume}>Return to game <kbd>Esc</kbd></button>
        <button onClick={() => onOpen("options")}><span>Options</span><small>Interface and accessibility</small></button>
        <button onClick={() => onOpen("help")}><span>Help & Controls</span><small>Movement, combat and shortcuts</small></button>
        <button className="pause-exit" onClick={onLeave}><span>Exit game</span><small>Return to character selection</small></button>
      </section>
    </div>
  );
}

function OptionsPanel({ showPerformance, reducedMotion, onShowPerformance, onReducedMotion }: { showPerformance: boolean; reducedMotion: boolean; onShowPerformance: (value: boolean) => void; onReducedMotion: (value: boolean) => void }) {
  return (
    <div className="options-panel">
      <section>
        <header><span className="option-icon">UI</span><div><h3>Interface</h3><p>Choose which diagnostic information is visible while playing.</p></div></header>
        <label><span><strong>Performance display</strong><small>Show position, FPS and draw calls.</small></span><input type="checkbox" checked={showPerformance} onChange={(event) => onShowPerformance(event.target.checked)} /></label>
      </section>
      <section>
        <header><span className="option-icon">FX</span><div><h3>Accessibility</h3><p>Reduce non-essential interface movement.</p></div></header>
        <label><span><strong>Reduced interface motion</strong><small>Disable sweeping and pulsing UI animations.</small></span><input type="checkbox" checked={reducedMotion} onChange={(event) => onReducedMotion(event.target.checked)} /></label>
      </section>
      <p className="options-note">Gameplay shortcuts remain active: C for Character, I for Inventory, K for Crafting and H for Help.</p>
    </div>
  );
}

function GameModal({
  title,
  children,
  onClose,
  kind,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  kind?: string;
}) {
  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`game-modal ${kind ? `panel-${kind}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p className="eyebrow">Greyhaven interface</p>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

const itemSpriteOrder = [
  "blank_rune",
  "ember_rune",
  "traveler_blade",
  "ashwood_bow",
  "rough_arrow",
  "field_backpack",
  "mire_fiber",
  "gold_coin",
  "mireling_remains",
  "bog_ichor",
  "reed_hide",
  "fen_tusk",
  "mire_skulker_remains",
  "reed_stalker_remains",
  "fen_brute_remains",
];
function ItemIcon({ definitionId }: { definitionId: string }) {
  if (definitionId === "field_bread") return <i className="item-icon food-icon">🥖</i>;
  if (definitionId === "smoked_mire_meat") return <i className="item-icon food-icon">🍖</i>;
  const index = itemSpriteOrder.indexOf(definitionId);
  if (index < 0) return <i className="item-icon fallback" />;
  const column = index % 4;
  const row = Math.floor(index / 4);
  return (
    <i
      className="item-icon"
      style={{
        backgroundPosition: `${(column * 100) / 3}% ${(row * 100) / 3}%`,
      }}
    />
  );
}

function NpcShop({ npcId }: { npcId: string }) {
  const npc = world.npcs.get(npcId);
  const [quantity, setQuantity] = useState(1);
  if (!npc) return null;
  const gold = world.inventory
    .filter((item) => item.definitionId === "gold_coin")
    .reduce((sum, item) => sum + item.quantity, 0);
  return (
    <GameModal title={npc.name} onClose={() => world.closeNpc()}>
      <div className="npc-shop">
        <section className="npc-dialogue">
          <div className="npc-portrait">{npc.name.slice(0, 1)}</div>
          <span>
            <h3>{npc.title}</h3>
            <p>“{npc.dialogue}”</p>
          </span>
          <b>{gold} Gold Coins</b>
        </section>
        <div className="shop-offers">
          {npc.offers.map((offer) => {
            const item = world.itemDefinitions.get(offer.itemDefinitionId);
            const totalPrice = offer.price * quantity;
            return (
              <article key={offer.id}>
                <ItemIcon definitionId={offer.itemDefinitionId} />
                <span>
                  <strong>{item?.name ?? offer.itemDefinitionId}</strong>
                  <small>
                    {offer.quantity} per bundle ·{" "}
                    {(item?.weight ?? 0) * offer.quantity} oz
                  </small>
                </span>
                <b>{offer.price} gold</b>
                <div>
                  <input
                    aria-label="Shop bundles"
                    type="number"
                    min={1}
                    max={20}
                    value={quantity}
                    onChange={(event) =>
                      setQuantity(
                        Math.max(
                          1,
                          Math.min(20, Number(event.target.value) || 1),
                        ),
                      )
                    }
                  />
                  <button
                    disabled={gold < totalPrice}
                    onClick={() =>
                      network.buyFromNpc(npc.id, offer.id, quantity)
                    }
                  >
                    Buy for {totalPrice}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </GameModal>
  );
}

function SpellTrainerModal({ npcId }: { npcId: string }) {
  const npc = world.npcs.get(npcId);
  const player = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  if (!npc || !player) return null;
  const gold = world.inventory
    .filter((item) => item.definitionId === "gold_coin")
    .reduce((sum, item) => sum + item.quantity, 0);
  return (
    <GameModal title={npc.name} onClose={() => world.closeNpc()}>
      <div className="npc-shop spell-trainer">
        <section className="npc-dialogue">
          <div className="npc-portrait">{npc.name.slice(0, 1)}</div>
          <span>
            <h3>{npc.title}</h3>
            <p>“{npc.dialogue}”</p>
          </span>
          <b>{gold} Gold Coins</b>
        </section>
        <div className="spell-lessons">
          {npc.spellIds.map((spellId) => {
            const spell = world.spells.get(spellId);
            if (!spell) return null;
            const learned = world.learnedSpellIds.has(spell.id);
            const eligible = spell.vocations.includes(player.vocation);
            return (
              <article
                className={learned ? "learned" : !eligible ? "locked" : ""}
                key={spell.id}
              >
                <span className="spell-glyph">✦</span>
                <span>
                  <strong>{spell.name}</strong>
                  <p>{spell.description}</p>
                  <small>
                    {spell.manaCost} mana · {spell.damage} base damage · range{" "}
                    {spell.range} · {(spell.cooldownMs / 1000).toFixed(1)} sec
                    cooldown
                  </small>
                </span>
                <div>
                  <b>{spell.price} gold</b>
                  <button
                    disabled={learned || !eligible || gold < spell.price}
                    onClick={() => network.learnSpell(npc.id, spell.id)}
                  >
                    {learned
                      ? "Learned"
                      : !eligible
                        ? "Wrong vocation"
                        : "Learn spell"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </GameModal>
  );
}

function DepotModal({ npcId }: { npcId: string }) {
  const npc = world.npcs.get(npcId);
  const [search, setSearch] = useState("");
  if (!npc) return null;
  const matches = (item: ItemInstance) =>
    (world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId)
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  const inventory = world.inventory.filter(
    (item) => !item.containerId && !item.equippedSlot && matches(item),
  );
  const depot = world.depot.filter(
    (item) => !item.containerId && matches(item),
  );
  const children = (rootId: string, items: ItemInstance[]) =>
    items.filter((item) => item.containerId === rootId).length;
  const row = (item: ItemInstance, action: "deposit" | "withdraw") => {
    const definition = world.itemDefinitions.get(item.definitionId);
    const contained = children(
      item.instanceId,
      action === "deposit" ? world.inventory : world.depot,
    );
    return (
      <article key={item.instanceId}>
        <ItemIcon definitionId={item.definitionId} />
        <span>
          <strong>{definition?.name ?? item.definitionId}</strong>
          <small>
            {item.quantity > 1 ? `×${item.quantity} · ` : ""}
            {((definition?.weight ?? 0) * item.quantity).toFixed(1)} oz
            {contained ? ` · ${contained} contained items` : ""}
          </small>
        </span>
        <button
          onClick={() =>
            action === "deposit"
              ? network.depositItem(npc.id, item.instanceId)
              : network.withdrawItem(npc.id, item.instanceId)
          }
        >
          {action === "deposit" ? "Store" : "Withdraw"}
        </button>
      </article>
    );
  };
  return (
    <GameModal title="Greyhaven Depot" onClose={() => world.closeNpc()}>
      <div className="depot-panel">
        <section className="npc-dialogue">
          <div className="npc-portrait">{npc.name.slice(0, 1)}</div>
          <span>
            <h3>{npc.title}</h3>
            <p>“{npc.dialogue}”</p>
          </span>
          <b>
            {world.depot.filter((item) => !item.containerId).length} / 200 slots
          </b>
        </section>
        <input
          className="depot-search"
          aria-label="Search depot"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search inventory and depot…"
        />
        <div className="depot-columns">
          <section>
            <header>
              <h3>Carried items</h3>
              <small>
                {world.inventoryWeight.toFixed(1)} /{" "}
                {world.maxCapacity.toFixed(1)} oz
              </small>
            </header>
            {inventory.length ? (
              inventory.map((item) => row(item, "deposit"))
            ) : (
              <p className="empty-state">
                No matching items available to store.
              </p>
            )}
          </section>
          <section>
            <header>
              <h3>Greyhaven vault</h3>
              <small>Persistent character storage</small>
            </header>
            {depot.length ? (
              depot.map((item) => row(item, "withdraw"))
            ) : (
              <p className="empty-state">No matching items stored here.</p>
            )}
          </section>
        </div>
      </div>
    </GameModal>
  );
}

function PlayerContextMenu() {
  const context = world.playerContext;
  const player = context ? world.players.get(context.playerId) : null;
  if (!context || !player) return null;
  return (
    <div className="player-context" style={{ left: context.x, top: context.y }}>
      <header>
        <strong>{player.name}</strong>
        <small>Level {player.level} traveler</small>
      </header>
      <button
        onClick={() => {
          network.requestTrade(player.id);
          world.closePlayerContext();
        }}
      >
        Trade
      </button>
      <button disabled>
        Invite to party <small>Coming later</small>
      </button>
      <button onClick={() => world.closePlayerContext()}>Close</button>
    </div>
  );
}

function CharacterPanel() {
  const player = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  if (!player) return null;
  const equipped = world.inventory.filter((item) => item.equippedSlot);
  const equipmentLayout = [
    { id: "helmet", label: "Helmet", aliases: ["helmet", "head"] },
    { id: "back", label: "Back", aliases: ["back", "cape"] },
    { id: "amulet", label: "Amulet", aliases: ["amulet", "neck"] },
    { id: "left-hand", label: "Left hand", aliases: ["left_hand", "offhand", "shield"] },
    { id: "right-hand", label: "Right hand", aliases: ["right_hand", "mainhand", "weapon"] },
    { id: "ring-left", label: "Ring", aliases: ["ring_left", "ring1"] },
    { id: "ring-right", label: "Ring", aliases: ["ring_right", "ring2"] },
    { id: "legs", label: "Legs", aliases: ["legs"] },
    { id: "shoes", label: "Shoes", aliases: ["shoes", "feet", "boots"] },
    { id: "backpack", label: "Backpack", aliases: ["backpack", "bag"] },
  ];
  const skillRanks: [string, number][] = [
    ["Sword", player.swordSkill],
    ["Distance", player.distanceSkill],
    ["Fletching", player.fletchingSkill],
    ["Magic", player.magicLevel],
  ];
  const strongestSkill = skillRanks.reduce((best, current) => current[1] > best[1] ? current : best);
  return (
    <div className="character-panel">
      <section className="character-sheet">
        <header className="character-identity">
          <div className="character-portrait">{player.name.slice(0, 1)}</div>
          <span><small>Level {player.level}</small><h3>{player.name}</h3><b>{vocationName(player.vocation)}</b></span>
        </header>
        <h4>Equipment</h4>
        <div className="equipment-paperdoll">
          <div className="character-model-preview" aria-label={`${player.name} character preview`}>
            <CharacterPreview vocation={player.vocation} />
            <span>{player.name}</span>
          </div>
          {equipmentLayout.map(({ id, label, aliases }) => {
            const item = equipped.find((entry) => entry.equippedSlot && aliases.includes(entry.equippedSlot));
            const itemName = item ? world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId : label;
            return (
              <div className={`equipment-slot slot-${id} ${item ? "filled" : ""}`} key={id} title={itemName}>
                {item ? <ItemIcon definitionId={item.definitionId} /> : <span aria-hidden="true">{equipmentSlotGlyph(id)}</span>}
                <small>{itemName}</small>
              </div>
            );
          })}
        </div>
        <p className="vocation-perk">
          {player.vocation === "ranger"
            ? "Excels with distance weapons and ammunition."
            : canCraftSigils(player.vocation)
              ? "Can craft and use sigils."
              : "Can use traded sigils; crafting requires a Mage or Druid."}
        </p>
      </section>
      <section className="skills-sheet">
        <header><span><small>Progression</small><h3>Skills & Mastery</h3></span><b>{player.level}</b></header>
        <SkillRow
          name="Sword Skill"
          level={player.swordSkill}
          tries={player.swordTries}
          description="Advances through successful melee hits."
        />
        <SkillRow
          name="Distance Skill"
          level={player.distanceSkill}
          tries={player.distanceTries}
          description="Advances when ammunition hits a creature."
        />
        <SkillRow
          name="Fletching Skill"
          level={player.fletchingSkill}
          tries={player.fletchingTries}
          description="Advances by producing physical ammunition."
        />
        <SkillRow
          name="Magic Level"
          level={player.magicLevel}
          tries={player.magicTries}
          description="Advances through sigil crafting and magic use."
        />
        <p className="skill-note">
          Each level takes more legitimate uses than the last. Skills improve
          their matching damage type or production discipline.
        </p>
      </section>
      <section className="stats-sheet">
        <header><span><small>Overview</small><h3>Character Stats</h3></span></header>
        <div className="character-resources">
          <span className="health-stat"><small>Health</small><strong>{player.health}<i>/ {player.maxHealth}</i></strong><em><i style={{ width: `${Math.min(100, player.health / Math.max(1, player.maxHealth) * 100)}%` }} /></em></span>
          <span className="mana-stat"><small>Mana</small><strong>{player.mana}<i>/ {player.maxMana}</i></strong><em><i style={{ width: `${Math.min(100, player.mana / Math.max(1, player.maxMana) * 100)}%` }} /></em></span>
          <span><small>Experience</small><strong>{player.experience}</strong></span>
          <span><small>Capacity</small><strong>{world.inventoryWeight.toFixed(1)}<i>/ {world.maxCapacity.toFixed(1)}</i></strong><em><i style={{ width: `${Math.min(100, world.inventoryWeight / Math.max(1, world.maxCapacity) * 100)}%` }} /></em></span>
        </div>
        <dl className="character-facts">
          <div><dt>Level</dt><dd>{player.level}</dd></div>
          <div><dt>Vocation</dt><dd>{vocationName(player.vocation)}</dd></div>
          <div><dt>Highest mastery</dt><dd>{strongestSkill[0]} <b>{strongestSkill[1]}</b></dd></div>
          <div><dt>Equipped</dt><dd>{equipped.length} / {equipmentLayout.length}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function equipmentSlotGlyph(slot: string) {
  const glyphs: Record<string, string> = {
    helmet: "\u25b2",
    back: "\u25a5",
    amulet: "\u25c7",
    "left-hand": "L",
    "right-hand": "R",
    "ring-left": "\u25cb",
    "ring-right": "\u25cb",
    legs: "\u2161",
    shoes: "\u2304",
    backpack: "\u25a6",
  };
  return glyphs[slot] ?? "\u00b7";
}

function SkillRow({
  name,
  level,
  tries,
  description,
}: {
  name: string;
  level: number;
  tries: number;
  description: string;
}) {
  const required = 5 + level * 2;
  const progress = Math.min(100, (tries / required) * 100);
  return (
    <div className="skill-row">
      <header>
        <strong>{name}</strong>
        <b>{level}</b>
      </header>
      <div className="skill-meter">
        <i style={{ width: `${progress}%` }} />
      </div>
      <small>
        {tries} / {required} uses · {description}
      </small>
    </div>
  );
}

function TradeRequestModal() {
  const request = world.incomingTrade;
  if (!request) return null;
  return (
    <GameModal
      title="Trade request"
      onClose={() => network.respondTrade(request.tradeId, false)}
    >
      <div className="trade-request">
        <div className="portrait">{request.requester.name.slice(0, 1)}</div>
        <span>
          <strong>{request.requester.name}</strong>
          <small>
            Level {request.requester.level} traveler wants to trade with you.
          </small>
        </span>
        <div>
          <button
            className="secondary"
            onClick={() => network.respondTrade(request.tradeId, false)}
          >
            Decline
          </button>
          <button onClick={() => network.respondTrade(request.tradeId, true)}>
            Accept trade
          </button>
        </div>
      </div>
    </GameModal>
  );
}

function TradePanel() {
  const trade = world.trade;
  if (!trade) return null;
  if (trade.status === "pending")
    return (
      <div className="trade-pending">
        <p>Waiting for {trade.partner.name} to accept your trade request.</p>
        <button onClick={() => network.cancelTrade(trade.tradeId)}>
          Cancel request
        </button>
      </div>
    );
  const offered = new Set(trade.yourOffer.map((item) => item.instanceId));
  const eligible = world.inventory.filter(
    (item) =>
      !item.containerId &&
      !item.equippedSlot &&
      !world.inventory.some((child) => child.containerId === item.instanceId),
  );
  const toggle = (itemId: string) =>
    network.setTradeOffer(
      trade.tradeId,
      offered.has(itemId)
        ? [...offered].filter((id) => id !== itemId)
        : [...offered, itemId],
    );
  return (
    <div className="trade-panel">
      <div className="trade-columns">
        <section>
          <header>
            <h3>Your offer</h3>
            <span className={trade.youConfirmed ? "confirmed" : "reviewing"}>
              {trade.youConfirmed ? "Confirmed" : "Reviewing"}
            </span>
          </header>
          <div className="trade-offer-list">
            {trade.yourOffer.length === 0 && (
              <p className="empty-state">Nothing offered yet.</p>
            )}
            {trade.yourOffer.map((item) => (
              <TradeItem item={item} key={item.instanceId} />
            ))}
          </div>
          <h3>Your available items</h3>
          <div className="trade-inventory">
            {eligible.map((item) => (
              <button
                className={offered.has(item.instanceId) ? "selected" : ""}
                onClick={() => toggle(item.instanceId)}
                key={item.instanceId}
              >
                <TradeItem item={item} />
              </button>
            ))}
          </div>
        </section>
        <section>
          <header>
            <h3>{trade.partner.name}'s offer</h3>
            <span
              className={trade.partnerConfirmed ? "confirmed" : "reviewing"}
            >
              {trade.partnerConfirmed ? "Confirmed" : "Reviewing"}
            </span>
          </header>
          <div className="trade-offer-list">
            {trade.theirOffer.length === 0 && (
              <p className="empty-state">Nothing offered yet.</p>
            )}
            {trade.theirOffer.map((item) => (
              <TradeItem item={item} key={item.instanceId} />
            ))}
          </div>
          <p className="trade-warning">
            Confirm only after reviewing both sides. Any offer change resets
            both confirmations.
          </p>
        </section>
      </div>
      <footer>
        <button
          className="secondary"
          onClick={() => network.cancelTrade(trade.tradeId)}
        >
          Cancel trade
        </button>
        <button
          disabled={trade.youConfirmed}
          onClick={() => network.confirmTrade(trade.tradeId)}
        >
          {trade.youConfirmed ? "Waiting for partner…" : "Confirm offer"}
        </button>
      </footer>
    </div>
  );
}

function TradeItem({ item }: { item: ItemInstance }) {
  const definition = world.itemDefinitions.get(item.definitionId);
  return (
    <span className="trade-item">
      <ItemIcon definitionId={item.definitionId} />
      <span>
        <strong>{definition?.name ?? item.definitionId}</strong>
        <small>
          {item.quantity > 1
            ? `×${item.quantity}`
            : item.charges
              ? `${item.charges} charges`
              : "1 item"}
        </small>
      </span>
    </span>
  );
}
function NearbyLootWindow() {
  useSyncExternalStore(subscribeWorldVisual, worldVisualSnapshot);
  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!local) return null;
  const corpses = world.groundItems.filter(
    (ground) => ground.contents.length > 0
      && ground.position.z === local.position.z
      && Math.abs(ground.position.x - local.position.x) <= 1
      && Math.abs(ground.position.y - local.position.y) <= 1,
  );
  return corpses.length > 0 ? <LootWindow corpses={corpses} /> : null;
}

function LootWindow({ corpses }: { corpses: GroundItem[] }) {
  return (
    <section className="loot-window">
      <header>
        <span>Nearby loot</span>
        <small>Click an item to collect</small>
      </header>
      {corpses.map((corpse) => (
        <div className="corpse" key={corpse.item.instanceId}>
          <strong>
            {world.itemDefinitions.get(corpse.item.definitionId)?.name ??
              "Corpse"}
          </strong>
          {corpse.contents.map((item) => (
            <button
              key={item.instanceId}
              onClick={() => network.pickup(item.instanceId)}
            >
              <ItemIcon definitionId={item.definitionId} />
              <span>
                {world.itemDefinitions.get(item.definitionId)?.name ??
                  item.definitionId}
              </span>
              <small>{item.quantity > 1 ? `×${item.quantity}` : "Loot"}</small>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
function HelpPanel() {
  return (
    <div className="help-grid">
      <section>
        <kbd>WASD</kbd>
        <strong>Screen-relative movement</strong>
        <p>
          W always moves up the isometric screen. Hold two keys for seamless
          visual diagonals.
        </p>
      </section>
      <section>
        <kbd>Arrows</kbd>
        <strong>Alternative movement</strong>
        <p>
          The arrow keys follow the same screen-relative isometric directions.
        </p>
      </section>
      <section>
        <kbd>Mouse</kbd>
        <strong>Interact and target</strong>
        <p>
          Click creatures to attack. Right-click another player for social
          actions such as Trade.
        </p>
      </section>
      <section>
        <kbd>Drag</kbd>
        <strong>Move inventory items</strong>
        <p>
          Drag items between equipment, your main inventory, containers, or the
          ground drop area.
        </p>
      </section>
      <section>
        <kbd>1</kbd>
        <strong>Use Ember Sigil</strong>
        <p>
          Deals ranged fire damage to your selected target and consumes one
          charge.
        </p>
      </section>
      <section>
        <kbd>2</kbd>
        <strong>Cast Ember Bolt</strong>
        <p>
          After learning it from Seraphine, cast the spell using mana and no
          physical supply.
        </p>
      </section>
      <section>
        <kbd>C I K H</kbd>
        <strong>Open panels</strong>
        <p>Character, inventory, crafting, and this help window.</p>
      </section>
    </div>
  );
}

function RuneCraftingPanel() {
  const [quantity, setQuantity] = useState(1);
  const active = world.craftingRecipeId
    ? world.runeRecipes.get(world.craftingRecipeId)
    : null;
  const player = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  const status: Record<string, string> = {
    queued: "Preparing",
    crafted: "One batch completed",
    waiting_mana: "Waiting for mana",
    mana_regenerated: "Mana is recovering",
    food_regenerated: "Food is restoring health and mana",
    paused_combat: "Paused during combat",
    complete: "Queue completed",
    missing_material: "Materials ran out",
    cancelled: "Cancelled",
    idle: "No active production queue",
  };
  return (
    <div className="rune-panel">
      {active && (
        <div className="craft-active">
          <span>
            <strong>{active.name}</strong>
            <small>
              {status[world.craftingStatus] ?? world.craftingStatus} ·{" "}
              {world.craftingRemaining} batches remaining
            </small>
          </span>
          <button onClick={() => network.cancelRuneCrafting()}>
            Cancel queue
          </button>
        </div>
      )}
      {!active && (
        <p className="empty-state">
          {status[world.craftingStatus] ?? status.idle}
        </p>
      )}
      {[...world.runeRecipes.values()].map((recipe) => {
        const material = world.inventory
          .filter((item) => item.definitionId === recipe.inputDefinitionId)
          .reduce((sum, item) => sum + item.quantity, 0);
        const locked =
          recipe.craftKind === "sigils" && !canCraftSigils(player?.vocation);
        const input =
          world.itemDefinitions.get(recipe.inputDefinitionId)?.name ??
          recipe.inputDefinitionId;
        const output =
          world.itemDefinitions.get(recipe.outputDefinitionId)?.name ??
          recipe.outputDefinitionId;
        return (
          <div
            className={`recipe-row ${locked ? "locked" : ""}`}
            key={recipe.id}
          >
            <span>
              <b className="recipe-kind">
                {recipe.craftKind === "sigils"
                  ? "Magical production"
                  : "Fletching"}
              </b>
              <strong>{recipe.name}</strong>
              <small>
                {recipe.inputQuantity} {input} → {recipe.outputQuantity}{" "}
                {output} ·{" "}
                {recipe.manaCost > 0 ? `${recipe.manaCost} mana · ` : ""}
                {material} available · {(recipe.craftTimeMs / 1000).toFixed(1)}{" "}
                sec
              </small>
              {locked && <em>Requires Mage or Druid</em>}
            </span>
            <div>
              <input
                aria-label="Production batches"
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(event) =>
                  setQuantity(
                    Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                  )
                }
              />
              <button
                disabled={
                  locked ||
                  material < quantity * recipe.inputQuantity ||
                  Boolean(active)
                }
                onClick={() => network.startRuneCrafting(recipe.id, quantity)}
              >
                Start queue
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chat() {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) network.say(text);
    setText("");
  };
  return (
    <section className="chat">
      <div className="chat-log">
        {world.chat.length === 0 && (
          <p className="muted">Local Say channel. Click below to chat.</p>
        )}
        {world.chat.map((line) => (
          <p key={line.id}>
            <strong>{line.speaker}:</strong> {line.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit}>
        <span>Say</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a message…"
          maxLength={160}
        />
      </form>
    </section>
  );
}

function InventoryPanel() {
  const [query, setQuery] = useState("");
  const rootItems = world.inventory.filter(
    (item) => !item.containerId && !item.equippedSlot,
  ).filter((item) => (world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId).toLowerCase().includes(query.trim().toLowerCase()));
  const equipped = world.inventory.filter((item) => item.equippedSlot);
  const primaryContainer = world.inventory.find(
    (item) => world.itemDefinitions.get(item.definitionId)?.containerSlots,
  );
  const drop = (
    event: DragEvent,
    destination: "root" | "ground" | "equipment",
  ) => {
    event.preventDefault();
    const itemId = draggedItemId(event);
    if (!itemId) return;
    if (destination === "root") network.moveToRoot(itemId);
    else if (destination === "ground") network.drop(itemId);
    else {
      const item = world.inventory.find((entry) => entry.instanceId === itemId);
      const slot = item
        ? world.itemDefinitions.get(item.definitionId)?.equipmentSlot
        : undefined;
      if (slot) network.equip(itemId, slot);
    }
  };
  return (
    <div className="inventory-panel">
      <header className="inventory-toolbar">
        <span><small>Backpack</small><strong>{world.inventory.length} items carried</strong></span>
        <label><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory" aria-label="Search inventory" /></label>
      </header>
      <div className="inventory-summary">
        <span>
          <strong>Carrying capacity</strong>
          <small>
            {world.inventoryWeight.toFixed(1)} / {world.maxCapacity.toFixed(1)}{" "}
            oz
          </small>
        </span>
        <div className="capacity-meter">
          <i
            style={{
              width: `${Math.min(100, (world.inventoryWeight / world.maxCapacity) * 100)}%`,
            }}
          />
        </div>
      </div>
      <p className="drag-hint">
        Drag items between equipment, inventory, and containers.
      </p>
      <div className="inventory-columns">
        <section
          className="inventory-drop-zone"
          onDragOver={allowItemDrop}
          onDrop={(event) => drop(event, "equipment")}
        >
          <header className="inventory-section-title"><span><small>Loadout</small><h3>Equipment</h3></span><b>{equipped.length}</b></header>
          {equipped.length === 0 && (
            <p className="empty-state">Drop compatible equipment here.</p>
          )}
          <div className="equipment-inventory-list">
            {equipped.map((item) => (
              <InventoryEntry item={item} key={item.instanceId} primaryContainerId={primaryContainer?.instanceId} />
            ))}
          </div>
        </section>
        <section
          className="inventory-drop-zone"
          onDragOver={allowItemDrop}
          onDrop={(event) => drop(event, "root")}
        >
          <header className="inventory-section-title"><span><small>Storage</small><h3>Backpack & Inventory</h3></span><b>{rootItems.length}</b></header>
          {rootItems.length === 0 && (
            <p className="empty-state">{query ? "No items match your search." : "Drop items here to unpack them."}</p>
          )}
          {rootItems.map((item) => (
            <InventoryEntry
              item={item}
              key={item.instanceId}
              primaryContainerId={primaryContainer?.instanceId}
            />
          ))}
        </section>
      </div>
      <div
        className="ground-drop-zone"
        onDragOver={allowItemDrop}
        onDrop={(event) => drop(event, "ground")}
      >
        Drop item on the ground at your feet
      </div>
    </div>
  );
}
function InventoryEntry({
  item,
  primaryContainerId,
  depth = 0,
}: {
  item: ItemInstance;
  primaryContainerId?: string;
  depth?: number;
}) {
  const definition = world.itemDefinitions.get(item.definitionId);
  const children = world.inventory.filter(
    (child) => child.containerId === item.instanceId,
  );
  const receive = (event: DragEvent) => {
    if (!definition?.containerSlots) return;
    event.preventDefault();
    event.stopPropagation();
    const itemId = draggedItemId(event);
    if (itemId && itemId !== item.instanceId)
      network.moveToContainer(itemId, item.instanceId);
  };
  return (
    <div className="inventory-node" style={{ marginLeft: depth * 12 }}>
      <div
        draggable
        className={`inventory-row ${definition?.containerSlots ? "container-drop-target" : ""}`}
        onDragStart={(event) => startItemDrag(event, item.instanceId)}
        onDragOver={definition?.containerSlots ? allowItemDrop : undefined}
        onDrop={receive}
        onContextMenu={(event) => { if (!definition?.foodEffect) return; event.preventDefault(); network.eat(item.instanceId); }}
        title={definition?.foodEffect ? "Right-click to eat · drag to move" : "Drag to move this item"}
      >
        <ItemIcon definitionId={item.definitionId} />
        <span>
          <strong>{definition?.name ?? item.definitionId}</strong>
          <small>
            {item.equippedSlot ? `${item.equippedSlot} · ` : ""}
            {item.quantity > 1 ? `×${item.quantity} · ` : ""}
            {((definition?.weight ?? 0) * item.quantity).toFixed(1)} oz
            {definition?.containerSlots
              ? ` · ${children.length}/${definition.containerSlots} slots`
              : ""}
            {definition?.distanceWeapon
              ? ` · range ${definition.distanceWeapon.range}`
              : ""}
          </small>
        </span>
        <div className="item-actions">
          {definition?.foodEffect && <button onClick={() => network.eat(item.instanceId)}>Eat</button>}
          {definition?.equipmentSlot && !item.equippedSlot && (
            <button
              onClick={() =>
                network.equip(item.instanceId, definition.equipmentSlot!)
              }
            >
              Equip
            </button>
          )}
          {item.equippedSlot && (
            <button onClick={() => network.moveToRoot(item.instanceId)}>
              Unequip
            </button>
          )}
          {item.containerId && (
            <button onClick={() => network.moveToRoot(item.instanceId)}>
              Remove
            </button>
          )}
          {!item.containerId &&
            !item.equippedSlot &&
            primaryContainerId &&
            item.instanceId !== primaryContainerId && (
              <button
                onClick={() =>
                  network.moveToContainer(item.instanceId, primaryContainerId)
                }
              >
                Pack
              </button>
            )}
          {item.quantity > 1 && (
            <button
              onClick={() =>
                network.split(item.instanceId, Math.floor(item.quantity / 2))
              }
            >
              Split
            </button>
          )}
          {!item.containerId && !item.equippedSlot && (
            <button onClick={() => network.drop(item.instanceId)}>Drop</button>
          )}
        </div>
      </div>
      {children.map((child) => (
        <InventoryEntry
          item={child}
          key={child.instanceId}
          primaryContainerId={primaryContainerId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
const ITEM_DRAG_TYPE = "application/x-aldoria-item";
function startItemDrag(event: DragEvent, itemId: string) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(ITEM_DRAG_TYPE, itemId);
  event.dataTransfer.setData("text/plain", itemId);
}
function draggedItemId(event: DragEvent) {
  return (
    event.dataTransfer.getData(ITEM_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain")
  );
}
function allowItemDrop(event: DragEvent) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}
