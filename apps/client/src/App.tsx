import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { authenticate } from "./api";
import { CharacterLobby, CharacterPreview } from "./CharacterLobby";
import { MenuMusic, WorldMusic } from "./audio/WorldMusic";
import { InputController } from "./game/InputController";
import { GameMinimap } from "./game/GameMinimap";
import { ThreeWorld } from "./game/ThreeWorld";
import { NetworkClient } from "./game/NetworkClient";
import { WorldState } from "./game/WorldState";
import { isWorldTimePaused, setWorldTime, setWorldTimePaused, worldEnvironment, worldTimeLabel } from "./game/worldEnvironment";
import { PROTOCOL_VERSION, type CharacterOutfit, type GroundItem, type ItemInstance, type SecondarySkill } from "./protocol";

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
  if (!sessionToken) return <><MenuMusic /><AccountLogin onAuthenticated={authenticated} /></>;
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
    <>
      <MenuMusic />
      <CharacterLobby
        token={sessionToken}
        connecting={false}
        onPlay={(characterId) => network.connect(sessionToken, characterId)}
        onLogout={logout}
      />
    </>
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
  const [showInventoryCharacter, setShowInventoryCharacter] = useState(false);
  const [escapeMenu, setEscapeMenu] = useState(false);
  const [showPerformance, setShowPerformance] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const pendingGoldPickups = useRef(new Set<string>());
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
      if (event.code === "KeyE" && !panel && !escapeMenu && !world.trade && !world.incomingTrade && !world.activeNpcId) {
        const loot = nearbyLootGround().flatMap(lootableGroundItems);
        if (loot.length > 0) {
          event.preventDefault();
          if (!event.repeat) loot.forEach((item) => network.pickup(item.instanceId));
          return;
        }
        const localPlayer = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
        const resource = localPlayer ? [...world.resourceNodes.values()].find((node) => node.available
          && node.position.z === localPlayer.position.z
          && Math.abs(node.position.x - localPlayer.position.x) <= 1
          && Math.abs(node.position.y - localPlayer.position.y) <= 1) : null;
        if (resource) {
          event.preventDefault();
          if (!event.repeat) network.mineResource(resource.id);
          return;
        }
      }
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
        if (next === "character" && panel === "inventory") {
          setShowInventoryCharacter((current) => !current);
        } else {
          if (next === "inventory" && panel !== "inventory") setShowInventoryCharacter(panel === "character");
          setPanel((current) => (current === next ? null : next));
        }
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [emberSigil?.instanceId, escapeMenu, knowsEmberBolt, panel, world.attackTargetId]);
  const local = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  useEffect(() => {
    const collectNearbyGold = () => {
      const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      if (!player) return;
      const visibleGoldIds = new Set<string>();
      for (const ground of world.groundItems) {
        if (
          ground.position.z !== player.position.z
          || Math.abs(ground.position.x - player.position.x) > 1
          || Math.abs(ground.position.y - player.position.y) > 1
        ) continue;
        const items = ground.contents.length > 0 ? ground.contents : [ground.item];
        for (const item of items) {
          if (item.definitionId !== "gold_coin") continue;
          visibleGoldIds.add(item.instanceId);
          if (!pendingGoldPickups.current.has(item.instanceId)) {
            pendingGoldPickups.current.add(item.instanceId);
            network.pickup(item.instanceId);
          }
        }
      }
      for (const itemId of pendingGoldPickups.current) {
        if (!visibleGoldIds.has(itemId)) pendingGoldPickups.current.delete(itemId);
      }
    };
    const interval = window.setInterval(collectNearbyGold, 250);
    collectNearbyGold();
    return () => window.clearInterval(interval);
  }, []);
  const titles: Record<Panel, string> = {
    inventory: "Inventory",
    crafting: "Crafting & Production",
    character: "Character & Skills",
    help: "Controls",
    options: "Options",
  };
  return (
    <main className={`game-shell ${reducedMotion ? "reduced-motion" : ""}`}>
      <WorldMusic world={world} />
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
      <GameMinimap world={world} />
      <WorldClock />
      <section className="unit-frame">
        <div className="portrait">{local?.name.slice(0, 1)}</div>
        <div>
          <strong>{local?.name}</strong>
          <small>
            Level {local?.level} · {local?.experience} XP
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
      <NpcProximityGuard />
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
          active={panel === "character" || (panel === "inventory" && showInventoryCharacter)}
          onClick={() => {
            if (panel === "inventory") setShowInventoryCharacter((current) => !current);
            else setPanel(panel === "character" ? null : "character");
          }}
        />
        <DockButton
          hotkey="I"
          icon={"\u25a6"}
          label="Inventory"
          active={panel === "inventory"}
          onClick={() => {
            if (panel === "inventory") setPanel(null);
            else { setShowInventoryCharacter(panel === "character"); setPanel("inventory"); }
          }}
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
          onOpen={(next) => {
            setEscapeMenu(false);
            setPanel(next);
          }}
          onLeave={onLeave}
        />
      )}
      {panel === "inventory" && !escapeMenu && !world.trade && !world.incomingTrade && !world.activeNpcId && (
        <DualGearWindows
          showCharacter={showInventoryCharacter}
          onCloseCharacter={() => setShowInventoryCharacter(false)}
          onCloseInventory={() => setPanel(null)}
        />
      )}
      {panel && panel !== "inventory" && !escapeMenu && !world.trade && !world.incomingTrade && !world.activeNpcId && (
        <GameModal title={titles[panel]} kind={panel === "character" ? "character-compact" : panel} onClose={() => setPanel(null)}>
          {panel === "crafting" ? (
            <RuneCraftingPanel />
          ) : panel === "character" ? (
            <CompactCharacterPanel />
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
        ) : world.npcs.get(world.activeNpcId)?.service === "craft_trainer" ? (
          <CraftTrainerModal npcId={world.activeNpcId} />
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

function NpcProximityGuard() {
  useSyncExternalStore(subscribeWorldVisual, worldVisualSnapshot);
  const npc = world.activeNpcId ? world.npcs.get(world.activeNpcId) : null;
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  useEffect(() => {
    if (!npc || !player) return;
    const inRange = npc.position.z === player.position.z
      && Math.abs(npc.position.x - player.position.x) <= 1
      && Math.abs(npc.position.y - player.position.y) <= 1;
    if (!inRange) world.closeNpc();
  }, [npc?.id, npc?.position.x, npc?.position.y, npc?.position.z, player?.position.x, player?.position.y, player?.position.z]);
  return null;
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
  const [worldTime, setWorldTimeInput] = useState(() => worldTimeLabel(worldEnvironment()));
  const [worldTimePaused, setWorldTimePausedInput] = useState(() => isWorldTimePaused());
  const parsedWorldTime = () => {
    const [hour, minute] = worldTime.split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? { hour, minute } : null;
  };
  const changeWorldTime = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    setWorldTime(hour, minute);
    setWorldTimeInput(value);
  };
  const changeWorldTimePaused = (paused: boolean) => {
    const selectedTime = parsedWorldTime();
    const now = Date.now();
    if (paused && selectedTime) setWorldTime(selectedTime.hour, selectedTime.minute, now);
    setWorldTimePaused(paused, now);
    setWorldTimePausedInput(paused);
  };
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
      <section>
        <header><span className="option-icon">TIME</span><div><h3>World time</h3><p>Set the local preview time for lighting and weather.</p></div></header>
        <label><span><strong>Time of day</strong><small>Change the current world clock.</small></span><input type="time" value={worldTime} onChange={(event) => changeWorldTime(event.target.value)} /></label>
        <label><span><strong>Pause world clock</strong><small>Keep the selected time from advancing.</small></span><input type="checkbox" checked={worldTimePaused} onChange={(event) => changeWorldTimePaused(event.target.checked)} /></label>
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
      <GameWindow title={title} kind={kind} onClose={onClose}>{children}</GameWindow>
    </div>
  );
}

function GameWindow({ title, children, onClose, kind }: { title: string; children: ReactNode; onClose: () => void; kind?: string }) {
  const windowRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const positionKey = `aldoria.window-position.${kind ?? title.toLowerCase().replace(/\s+/g, "-")}`;
  const [position, setPosition] = useState<{ x: number; y: number; width: number } | null>(() => loadWindowPosition(positionKey));
  useEffect(() => {
    const element = windowRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      setPosition((current) => current ? {
        ...current,
        x: Math.max(8, Math.min(current.x, window.innerWidth - bounds.width - 8)),
        y: Math.max(8, Math.min(current.y, window.innerHeight - bounds.height - 8)),
      } : null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const beginWindowDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const bounds = windowRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    setPosition({ x: bounds.left, y: bounds.top, width: bounds.width });
  };
  const moveWindow = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const element = windowRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(event.clientX - drag.offsetX, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(event.clientY - drag.offsetY, window.innerHeight - bounds.height - 8)),
      width: bounds.width,
    });
  };
  const endWindowDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setPosition((current) => {
      if (current) localStorage.setItem(positionKey, JSON.stringify(current));
      return current;
    });
  };
  return (
    <section ref={windowRef} className={`game-modal movable-game-window ${kind ? `panel-${kind}` : ""}`} style={position ? { position: "fixed", left: position.x, top: position.y, width: position.width } : undefined} role="dialog" aria-label={title}>
      <header onPointerDown={beginWindowDrag} onPointerMove={moveWindow} onPointerUp={endWindowDrag} onPointerCancel={endWindowDrag}>
        <div><p className="eyebrow">Greyhaven interface</p><h2>{title}</h2></div>
        <button aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="modal-content">{children}</div>
    </section>
  );
}

function loadWindowPosition(storageKey: string): { x: number; y: number; width: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.width) && value.width > 0 ? value : null;
  } catch {
    return null;
  }
}

function DualGearWindows({ showCharacter, onCloseCharacter, onCloseInventory }: { showCharacter: boolean; onCloseCharacter: () => void; onCloseInventory: () => void }) {
  return (
    <div className={`modal-layer dual-gear-layer ${showCharacter ? "has-character" : ""}`}>
      {showCharacter && <GameWindow title="Character" kind="character-compact" onClose={onCloseCharacter}><CompactCharacterPanel /></GameWindow>}
      <GameWindow title="Inventory" kind="inventory" onClose={onCloseInventory}><InventoryPanel /></GameWindow>
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
  if (definitionId === "iron_pickaxe") return <i className="item-icon food-icon">⛏</i>;
  if (definitionId === "worn_cap") return <i className="item-icon food-icon">🧢</i>;
  if (definitionId === "patched_tunic") return <i className="item-icon food-icon">🥋</i>;
  if (definitionId === "frayed_trousers") return <i className="item-icon food-icon">👖</i>;
  if (definitionId === "work_boots") return <i className="item-icon food-icon">🥾</i>;
  if (definitionId === "wooden_buckler") return <i className="item-icon food-icon">🛡️</i>;
  if (definitionId === "copper_ore") return <i className="item-icon food-icon">◆</i>;
  if (definitionId === "ember_sigil_formula") return <i className="item-icon food-icon">📜</i>;
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
            const eligible = player.magicLevel >= spell.requiredMagicLevel;
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
                    Magic {spell.requiredMagicLevel} · {spell.manaCost} mana · {spell.damage} base damage · range{" "}
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
                        ? `Requires Magic ${spell.requiredMagicLevel}`
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

function CraftTrainerModal({ npcId }: { npcId: string }) {
  const npc = world.npcs.get(npcId);
  if (!npc) return null;
  const gold = world.inventory.filter((item) => item.definitionId === "gold_coin").reduce((sum, item) => sum + item.quantity, 0);
  return (
    <GameModal title={npc.name} onClose={() => world.closeNpc()}>
      <div className="npc-shop spell-trainer">
        <section className="npc-dialogue">
          <div className="npc-portrait">{npc.name.slice(0, 1)}</div>
          <span><h3>{npc.title}</h3><p>“{npc.dialogue}”</p></span>
          <b>{gold} Gold Coins</b>
        </section>
        <div className="spell-lessons">
          {npc.recipeIds.map((recipeId) => {
            const recipe = world.runeRecipes.get(recipeId);
            if (!recipe) return null;
            const learned = world.learnedRecipeIds.has(recipe.id);
            return <article className={learned ? "learned" : ""} key={recipe.id}>
              <ItemIcon definitionId={recipe.outputDefinitionId} />
              <span><strong>{recipe.name}</strong><p>Unlock this recipe permanently for this character.</p><small>{recipe.inputQuantity} material → {recipe.outputQuantity} output · {(recipe.craftTimeMs / 1000).toFixed(1)} sec</small></span>
              <div><b>{recipe.learnPrice} gold</b><button disabled={learned || gold < recipe.learnPrice} onClick={() => network.learnRecipeFromNpc(npc.id, recipe.id)}>{learned ? "Learned" : "Learn recipe"}</button></div>
            </article>;
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

const equipmentLayout = [
  { id: "helmet", label: "Helmet", aliases: ["helmet", "head"] },
  { id: "chest", label: "Chest", aliases: ["chest", "torso", "body"] },
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

const professionToolLayout = [
  { id: "mining_tool", label: "Mining tool", glyph: "⛏" },
];

function CompactCharacterPanel() {
  const [showDetails, setShowDetails] = useState(false);
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!player) return null;
  return (
    <div className={`compact-character-panel ${showDetails ? "skills-open" : ""}`}>
      <div className="compact-character-main">
        <header className="character-identity">
          <div className="character-portrait">{player.name.slice(0, 1)}</div>
          <span><small>Level {player.level}</small><h3>{player.name}</h3><b>Drag equipment between windows</b></span>
        </header>
        <EquipmentPaperdoll interactive />
        <OutfitPicker outfit={player.outfit} />
      </div>
      <button className="character-details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}>
        <span>{showDetails ? "Hide" : "Skills"}</span><b>{showDetails ? "‹" : "›"}</b>
      </button>
      {showDetails && (
        <aside className="character-skills-drawer">
          <header><span><small>Progression</small><h3>Skills</h3></span><button aria-label="Hide skills" onClick={() => setShowDetails(false)}>×</button></header>
          <section className="character-skills-view">
            <small className="skill-group-label">Primary skills</small>
            <div className="compact-character-details" aria-label="Primary character skills">
              <CompactSkill name="Melee" level={player.swordSkill} description="Swords, axes, clubs and other close-combat weapons" />
              <CompactSkill name="Distance" level={player.distanceSkill} description="Bows and future ranged weapons" />
              <CompactSkill name="Magic" level={player.magicLevel} description="Spells, sigils and magical disciplines" />
              <CompactSkill name="Fletching" level={player.fletchingSkill} description="Crafting arrows and ranged supplies" />
              <CompactSkill name="Defense" description="Blocking, shields and armor control" />
            </div>
            <SecondarySkillsPicker selected={player.secondarySkills} />
          </section>
        </aside>
      )}
    </div>
  );
}

function CompactSkill({ name, level, description }: { name: string; level?: number; description: string }) {
  const learned = level !== undefined;
  return (
    <span className={learned ? "learned" : "untrained"} title={description}>
      <small>{name}</small>
      <strong>{learned ? level : "Untrained"}</strong>
    </span>
  );
}

const secondarySkillOptions: { id: SecondarySkill; name: string; description: string }[] = [
  { id: "alchemy", name: "Alchemy", description: "Potions, extracts and reagents" },
  { id: "mining", name: "Mining", description: "Ore, stone and rare minerals" },
  { id: "woodcutting", name: "Woodcutting", description: "Timber and uncommon woods" },
  { id: "fishing", name: "Fishing", description: "Fish and aquatic resources" },
  { id: "cooking", name: "Cooking", description: "Meals with restorative effects" },
];

function SecondarySkillsPicker({ selected }: { selected: SecondarySkill[] }) {
  const [pending, setPending] = useState<SecondarySkill[]>(selected);
  useEffect(() => setPending(selected), [selected.join("|")]);
  const toggle = (skill: SecondarySkill) => {
    const next = pending.includes(skill)
      ? pending.filter((entry) => entry !== skill)
      : pending.length < 2
        ? [...pending, skill]
        : pending;
    if (next === pending) {
      world.addSystemMessage("You can only have two secondary skills at the same time.");
      return;
    }
    setPending(next);
    network.setSecondarySkills(next);
  };
  return (
    <section className="secondary-skills-picker" aria-label="Secondary skills">
      <header><span><small>Secondary skills</small><strong>Choose two professions</strong></span><b>{pending.length} / 2</b></header>
      <div>{secondarySkillOptions.map((skill) => {
        const active = pending.includes(skill.id);
        const unavailable = !active && pending.length >= 2;
        const progress = world.professionSkills.get(skill.id);
        return <button key={skill.id} className={active ? "selected" : ""} aria-pressed={active} disabled={unavailable} title={skill.description} onClick={() => toggle(skill.id)}><span>{skill.name}</span><small>{active ? `Level ${progress?.level ?? 0} · ${progress?.tries ?? 0} tries` : unavailable ? "Two selected" : skill.description}</small></button>;
      })}</div>
    </section>
  );
}

const outfitOptions: { id: CharacterOutfit; label: string }[] = [
  { id: "knight", label: "Armored" },
  { id: "ranger", label: "Wayfarer" },
  { id: "mage", label: "Mystic" },
  { id: "rogue", label: "Shadow" },
];

function OutfitPicker({ outfit }: { outfit: CharacterOutfit }) {
  return (
    <section className="outfit-picker" aria-label="Character outfit">
      <small>Outfit</small>
      <div>{outfitOptions.map((option) => <button key={option.id} className={option.id === outfit ? "selected" : ""} onClick={() => network.setOutfit(option.id)}>{option.label}</button>)}</div>
    </section>
  );
}

function EquipmentPaperdoll({ interactive }: { interactive: boolean }) {
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!player) return null;
  const equipped = world.inventory.filter((item) => item.equippedSlot);
  return <>
    <div className={`equipment-paperdoll ${interactive ? "interactive-paperdoll" : ""}`} data-inventory-drop="equipment">
      <div className="character-model-preview" aria-label={`${player.name} character preview`}>
        <CharacterPreview outfit={player.outfit} />
        <span>{player.name}</span>
      </div>
      {equipmentLayout.map(({ id, label, aliases }) => {
        const item = equipped.find((entry) => entry.equippedSlot && aliases.includes(entry.equippedSlot));
        const itemName = item ? world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId : label;
        return (
          <div
            className={`equipment-slot slot-${id} ${item ? "filled" : ""}`}
            data-inventory-drop="equipment"
            key={id}
            title={itemName}
            onDoubleClick={interactive && item ? () => network.moveToRoot(item.instanceId) : undefined}
            onPointerDown={interactive && item ? (event) => beginPointerItemDrag(event, item.instanceId) : undefined}
            onPointerMove={interactive && item ? movePointerItemDrag : undefined}
            onPointerUp={interactive && item ? (event) => endPointerItemDrag(event, routeEquipmentPointerDrop) : undefined}
            onPointerCancel={interactive && item ? cancelPointerItemDrag : undefined}
          >
            {item ? <ItemIcon definitionId={item.definitionId} /> : <span aria-hidden="true">{equipmentSlotGlyph(id)}</span>}
            <small>{itemName}</small>
          </div>
        );
      })}
    </div>
    <section className={`profession-tool-slots ${interactive ? "interactive-profession-tools" : ""}`} aria-label="Profession tools" data-inventory-drop="equipment">
      <header><small>Profession slots</small><strong>Tools do not use backpack space</strong></header>
      <div>
        {professionToolLayout.map(({ id, label, glyph }) => {
          const item = equipped.find((entry) => entry.equippedSlot === id);
          const itemName = item ? world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId : label;
          return <button type="button" className={`profession-tool-slot ${item ? "filled" : ""}`} data-inventory-drop="equipment" data-equipment-slot={id} key={id} title={itemName}
            onDoubleClick={interactive && item ? () => network.moveToRoot(item.instanceId) : undefined}
            onPointerDown={interactive && item ? (event) => beginPointerItemDrag(event, item.instanceId) : undefined}
            onPointerMove={interactive && item ? movePointerItemDrag : undefined}
            onPointerUp={interactive && item ? (event) => endPointerItemDrag(event, routeEquipmentPointerDrop) : undefined}
            onPointerCancel={interactive && item ? cancelPointerItemDrag : undefined}
          >
            {item ? <ItemIcon definitionId={item.definitionId} /> : <span aria-hidden="true">{glyph}</span>}
            <small>{itemName}</small>
          </button>;
        })}
      </div>
    </section>
  </>;
}

function moveEquippedItem(itemId: string, target: HTMLElement | null) {
  const destination = target?.dataset.inventoryDrop;
  if (destination === "root") network.moveToRoot(itemId);
  else if (destination === "ground") network.drop(itemId);
  else if (destination === "container") {
    const containerId = target?.dataset.containerId;
    if (containerId && containerId !== itemId) network.moveToContainer(itemId, containerId);
  }
}

let currentInventoryPointerDrop: ((itemId: string, target: HTMLElement | null) => void) | null = null;
function routeEquipmentPointerDrop(itemId: string, target: HTMLElement | null) {
  if (currentInventoryPointerDrop) currentInventoryPointerDrop(itemId, target);
  else moveEquippedItem(itemId, target);
}

function CharacterPanel() {
  const player = world.localPlayerId
    ? world.players.get(world.localPlayerId)
    : null;
  if (!player) return null;
  const equipped = world.inventory.filter((item) => item.equippedSlot);
  const skillRanks: [string, number][] = [
    ["Melee", player.swordSkill],
    ["Distance", player.distanceSkill],
    ["Fletching", player.fletchingSkill],
    ["Magic", player.magicLevel],
  ];
  const strongestSkill = skillRanks.reduce((best, current) => current[1] > best[1] ? current : best);
  const masteryUsed = skillRanks.reduce((sum, [, level]) => sum + skillMasteryCost(level), 0);
  return (
    <div className="character-panel">
      <section className="character-sheet">
        <header className="character-identity">
          <div className="character-portrait">{player.name.slice(0, 1)}</div>
          <span><small>Level {player.level}</small><h3>{player.name}</h3><b>Defined by your skills</b></span>
        </header>
        <EquipmentPaperdoll interactive={false} />
      </section>
      <section className="skills-sheet">
        <header><span><small>Progression</small><h3>Skills & Mastery</h3></span><b>{masteryUsed} / 100</b></header>
        <SkillRow
          name="Melee Skill"
          level={player.swordSkill}
          tries={player.swordTries}
          description="Advances through successful hits with any melee weapon."
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
        <UntrainedSkillRow name="Defense" description="Blocking, shields and armor control." />
        <SecondarySkillsPicker selected={player.secondarySkills} />
        <p className="skill-note">
          Levels 1–50 are free specialization. Levels above 50 consume the shared
          mastery budget; higher tiers cost increasingly more. Every skill caps at 100.
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
          <div><dt>Current focus</dt><dd>{strongestSkill[0]}</dd></div>
          <div><dt>Highest mastery</dt><dd>{strongestSkill[0]} <b>{strongestSkill[1]}</b></dd></div>
          <div><dt>Equipped</dt><dd>{equipped.length} / {equipmentLayout.length}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function UntrainedSkillRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="skill-row untrained-skill-row">
      <header><strong>{name}</strong><b>0</b></header>
      <div className="skill-meter"><i style={{ width: "0%" }} /></div>
      <small>Untrained · {description}</small>
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

function skillMasteryCost(level: number) {
  const capped = Math.min(100, Math.max(0, level));
  return Math.min(25, Math.max(0, capped - 50))
    + Math.min(15, Math.max(0, capped - 75)) * 2
    + Math.max(0, capped - 90) * 4;
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
  const groundItems = nearbyLootGround();
  return groundItems.length > 0 ? <LootWindow groundItems={groundItems} onLootAll={() => groundItems.flatMap(lootableGroundItems).forEach((item) => network.pickup(item.instanceId))} /> : null;
}

function nearbyLootGround() {
  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!local) return [];
  return world.groundItems.filter(
    (ground) => lootableGroundItems(ground).length > 0
      && ground.position.z === local.position.z
      && Math.abs(ground.position.x - local.position.x) <= 1
      && Math.abs(ground.position.y - local.position.y) <= 1,
  );
}

function lootableGroundItems(ground: GroundItem) {
  if (ground.contents.length > 0) return ground.contents.filter((item) => item.definitionId !== "gold_coin");
  if (ground.item.definitionId === "gold_coin") return [];
  return world.itemDefinitions.get(ground.item.definitionId)?.pickupable ? [ground.item] : [];
}

function LootWindow({ groundItems, onLootAll }: { groundItems: GroundItem[]; onLootAll: () => void }) {
  const itemCount = groundItems.reduce((count, ground) => count + lootableGroundItems(ground).length, 0);
  return (
    <section className="loot-window">
      <header>
        <span>Nearby loot</span>
        <small>Within reach</small>
      </header>
      {groundItems.map((ground) => (
        <div className="corpse" key={ground.item.instanceId}>
          <strong>
            {ground.contents.length > 0
              ? world.itemDefinitions.get(ground.item.definitionId)?.name ?? "Corpse"
              : "On the ground"}
          </strong>
          {lootableGroundItems(ground).map((item) => (
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
      <footer><button className="loot-all-button" onClick={onLootAll}><kbd>E</kbd><span>Loot all</span><small>{itemCount} {itemCount === 1 ? "item" : "items"}</small></button></footer>
    </section>
  );
}

function WorldClock() {
  const [environment, setEnvironment] = useState(() => worldEnvironment());
  useEffect(() => {
    const timer = window.setInterval(() => setEnvironment(worldEnvironment()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="world-clock" data-period={environment.period.toLowerCase()} data-weather={environment.weather}>
      <span aria-hidden="true">{environment.period === "Night" ? "☾" : environment.weather === "rain" ? "☂" : "☀"}</span>
      <div><strong>{worldTimeLabel(environment)}</strong><small>Day {environment.day} · {environment.period} · {environment.weather === "rain" ? "Rain" : "Clear"}</small></div>
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
        <kbd>E</kbd>
        <strong>Loot nearby items</strong>
        <p>When the nearby-loot window is visible, collect all listed items at once.</p>
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
  const [category, setCategory] = useState<string>("all");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const active = world.craftingRecipeId ? world.runeRecipes.get(world.craftingRecipeId) : null;
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  const recipes = [...world.runeRecipes.values()].filter((recipe) => world.learnedRecipeIds.has(recipe.id));
  const visibleRecipes = category === "all" ? recipes : recipes.filter((recipe) => recipe.craftKind === category);
  const selectedRecipe = visibleRecipes.find((recipe) => recipe.id === selectedRecipeId) ?? visibleRecipes[0] ?? null;
  const status: Record<string, string> = {
    queued: "Preparing", crafted: "One batch completed", waiting_mana: "Waiting for mana",
    mana_regenerated: "Mana is recovering", food_regenerated: "Food is restoring health and mana",
    paused_combat: "Paused during combat", complete: "Queue completed",
    missing_material: "Materials ran out", cancelled: "Cancelled", idle: "No active production queue",
  };
  const chooseCategory = (next: string) => { setCategory(next); setSelectedRecipeId(null); };
  const material = selectedRecipe ? world.inventory.filter((item) => item.definitionId === selectedRecipe.inputDefinitionId).reduce((sum, item) => sum + item.quantity, 0) : 0;
  const inputName = selectedRecipe ? world.itemDefinitions.get(selectedRecipe.inputDefinitionId)?.name ?? selectedRecipe.inputDefinitionId : "";
  const outputName = selectedRecipe ? world.itemDefinitions.get(selectedRecipe.outputDefinitionId)?.name ?? selectedRecipe.outputDefinitionId : "";
  const skillLevel = (craftKind: string) => craftKind === "fletching"
    ? player?.fletchingSkill ?? 0
    : craftKind === "sigils"
      ? player?.magicLevel ?? 0
      : world.professionSkills.get(craftKind)?.level ?? 0;
  const skillName = (craftKind: string) => craftKind === "sigils"
    ? "Magic"
    : secondarySkillOptions.find((entry) => entry.id === craftKind)?.name ?? (craftKind === "fletching" ? "Fletching" : craftKind);
  const selectedSkill = selectedRecipe ? skillLevel(selectedRecipe.craftKind) : 0;
  const locked = Boolean(selectedRecipe && selectedSkill < selectedRecipe.requiredSkillLevel);
  const possibleBatches = selectedRecipe ? Math.floor(material / Math.max(1, selectedRecipe.inputQuantity)) : 0;
  const categoryName = category === "all" ? "All disciplines" : secondarySkillOptions.find((entry) => entry.id === category)?.name ?? (category === "sigils" ? "Sigilcraft" : "Fletching");
  return (
    <div className="crafting-workbench">
      <header className={`crafting-queue ${active ? "active" : "idle"}`}>
        <i aria-hidden="true">{active ? "◆" : "◇"}</i>
        <span><small>Production queue</small><strong>{active?.name ?? "Workshop ready"}</strong><p>{active ? `${status[world.craftingStatus] ?? world.craftingStatus} · ${world.craftingRemaining} batches remaining` : status[world.craftingStatus] ?? status.idle}</p></span>
        {active && <button onClick={() => network.cancelRuneCrafting()}>Cancel</button>}
      </header>
      <div className="crafting-layout">
        <aside className="crafting-disciplines">
          <header><small>Disciplines</small><strong>Recipe book</strong></header>
          <CraftingCategoryButton label="All recipes" count={recipes.length} selected={category === "all"} onClick={() => chooseCategory("all")} />
          <CraftingCategoryButton label="Sigilcraft" count={recipes.filter((recipe) => recipe.craftKind === "sigils").length} selected={category === "sigils"} onClick={() => chooseCategory("sigils")} />
          <CraftingCategoryButton label="Fletching" count={recipes.filter((recipe) => recipe.craftKind === "fletching").length} selected={category === "fletching"} onClick={() => chooseCategory("fletching")} />
          {player?.secondarySkills.length ? <small className="crafting-secondary-label">Secondary skills</small> : null}
          {player?.secondarySkills.map((skill) => <CraftingCategoryButton key={skill} label={secondarySkillOptions.find((entry) => entry.id === skill)?.name ?? skill} count={recipes.filter((recipe) => recipe.craftKind === skill).length} selected={category === skill} onClick={() => chooseCategory(skill)} />)}
        </aside>
        <section className="crafting-browser">
          <header><span><small>{categoryName}</small><strong>Available recipes</strong></span><b>{visibleRecipes.length}</b></header>
          <div className="crafting-recipe-list">
            {visibleRecipes.map((recipe) => {
              const available = world.inventory.filter((item) => item.definitionId === recipe.inputDefinitionId).reduce((sum, item) => sum + item.quantity, 0);
              const recipeSkill = skillLevel(recipe.craftKind);
              const recipeLocked = recipeSkill < recipe.requiredSkillLevel;
              return <button key={recipe.id} className={`${recipe.id === selectedRecipe?.id ? "selected" : ""} ${recipeLocked ? "locked" : ""}`} onClick={() => setSelectedRecipeId(recipe.id)}><ItemIcon definitionId={recipe.outputDefinitionId} /><span><strong>{recipe.name}</strong><small>{recipe.outputQuantity} output · {available} materials</small></span><i aria-hidden="true">›</i></button>;
            })}
            {visibleRecipes.length === 0 && <CraftingEmpty message="Learn recipes from artisans or recipe scrolls found as loot." />}
          </div>
        </section>
        <section className="crafting-recipe-detail">
          {selectedRecipe ? <>
            <header><span><small>{selectedRecipe.craftKind === "sigils" ? "Sigilcraft" : skillName(selectedRecipe.craftKind)}</small><h3>{selectedRecipe.name}</h3></span><ItemIcon definitionId={selectedRecipe.outputDefinitionId} /></header>
            <div className="crafting-conversion"><span><ItemIcon definitionId={selectedRecipe.inputDefinitionId} /><small>{selectedRecipe.inputQuantity} ×</small><strong>{inputName}</strong></span><b>→</b><span><ItemIcon definitionId={selectedRecipe.outputDefinitionId} /><small>{selectedRecipe.outputQuantity} ×</small><strong>{outputName}</strong></span></div>
            <dl className="crafting-costs"><div><dt>Available material</dt><dd className={possibleBatches < quantity ? "missing" : ""}>{material}</dd></div><div><dt>Possible batches</dt><dd>{possibleBatches}</dd></div><div><dt>Mana per batch</dt><dd>{selectedRecipe.manaCost}</dd></div><div><dt>Crafting time</dt><dd>{(selectedRecipe.craftTimeMs / 1000).toFixed(1)} sec</dd></div></dl>
            {locked && <p className="crafting-requirement">Requires {skillName(selectedRecipe.craftKind)} {selectedRecipe.requiredSkillLevel}.</p>}
            <footer><label><small>Batches</small><span><button onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button><input aria-label="Production batches" type="number" min={1} max={20} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /><button onClick={() => setQuantity((current) => Math.min(20, current + 1))}>+</button></span></label><button className="crafting-start" disabled={locked || possibleBatches < quantity || Boolean(active)} onClick={() => network.startRuneCrafting(selectedRecipe.id, quantity)}>{active ? "Queue busy" : possibleBatches < quantity ? "Missing materials" : `Craft ${quantity}`}</button></footer>
          </> : <CraftingEmpty message="Choose a learned recipe from the recipe book." />}
        </section>
      </div>
    </div>
  );
}

function CraftingCategoryButton({ label, count, selected, onClick }: { label: string; count: number; selected: boolean; onClick: () => void }) {
  return <button className={selected ? "selected" : ""} onClick={onClick}><span>{label}</span><b>{count}</b></button>;
}

function CraftingEmpty({ message }: { message: string }) {
  return <div className="crafting-empty"><span>◇</span><strong>No recipes learned</strong><small>{message}</small></div>;
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
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [splitRequest, setSplitRequest] = useState<{ itemId: string; quantity: number; max: number; x: number; y: number } | null>(null);
  const inventoryLayoutKey = `aldoria.inventory-layout.${world.localPlayerId ?? "local"}`;
  const [backpackLayout, setBackpackLayout] = useState<(string | null)[]>(() => loadInventoryLayout(inventoryLayoutKey));
  const gold = world.inventory
    .filter((item) => item.definitionId === "gold_coin")
    .reduce((sum, item) => sum + item.quantity, 0);
  const carriedItems = world.inventory.filter(
    (item) => !item.equippedSlot && item.definitionId !== "gold_coin",
  );
  const matchingItemIds = new Set(carriedItems
    .filter((item) => (world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId).toLowerCase().includes(query.trim().toLowerCase()))
    .map((item) => item.instanceId));
  const equippedBackpack = world.inventory.find((item) => item.equippedSlot === "backpack");
  const equippedBackpackDefinition = equippedBackpack ? world.itemDefinitions.get(equippedBackpack.definitionId) : undefined;
  const contextItem = contextMenu ? world.inventory.find((item) => item.instanceId === contextMenu.itemId) : undefined;
  const backpackSlots = equippedBackpackDefinition?.containerSlots ?? 0;
  useEffect(() => {
    setBackpackLayout((current) => reconcileInventoryLayout(current, carriedItems.map((item) => item.instanceId), backpackSlots));
  }, [world.revision, backpackSlots]);
  useEffect(() => {
    localStorage.setItem(inventoryLayoutKey, JSON.stringify(backpackLayout));
  }, [backpackLayout, inventoryLayoutKey]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".inventory-context-menu")) setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);
  const drop = (
    event: DragEvent,
    destination: "root" | "ground" | "equipment",
    backpackIndex?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const itemId = draggedItemId(event);
    if (!itemId) return;
    if (destination === "root") {
      const item = world.inventory.find((entry) => entry.instanceId === itemId);
      if (item?.containerId || item?.equippedSlot) network.moveToRoot(itemId);
      if (backpackIndex !== undefined) {
        setBackpackLayout((current) => moveInventoryItem(current, itemId, backpackIndex, backpackSlots));
      }
    }
    else if (destination === "ground") network.drop(itemId);
    else {
      const item = world.inventory.find((entry) => entry.instanceId === itemId);
      const slot = item
        ? world.itemDefinitions.get(item.definitionId)?.equipmentSlot
        : undefined;
      if (slot) network.equip(itemId, slot);
    }
  };
  const openContextMenu = (event: MouseEvent, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ itemId, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 260) });
  };
  const pointerDrop = (itemId: string, target: HTMLElement | null) => {
    const destination = target?.dataset.inventoryDrop;
    if (!destination) {
      if (!target?.closest(".game-modal")) network.drop(itemId);
      return;
    }
    const targetItemId = target?.dataset.itemId;
    if (targetItemId && targetItemId !== itemId) {
      const sourceItem = world.inventory.find((item) => item.instanceId === itemId);
      const targetItem = world.inventory.find((item) => item.instanceId === targetItemId);
      const definition = sourceItem ? world.itemDefinitions.get(sourceItem.definitionId) : undefined;
      const canStack = sourceItem && targetItem
        && sourceItem.definitionId === targetItem.definitionId
        && sourceItem.charges === targetItem.charges
        && definition?.stackable
        && sourceItem.quantity + targetItem.quantity <= (definition.maxStack ?? 1);
      if (canStack) {
        if (targetItem.containerId) network.moveToContainer(itemId, targetItem.containerId);
        else network.moveToRoot(itemId);
        return;
      }
    }
    if (destination === "container") {
      const containerId = target?.dataset.containerId;
      if (containerId && containerId !== itemId) network.moveToContainer(itemId, containerId);
      return;
    }
    if (destination === "root") {
      const item = world.inventory.find((entry) => entry.instanceId === itemId);
      if (item?.containerId || item?.equippedSlot) network.moveToRoot(itemId);
      const targetIndex = Number(target?.dataset.backpackIndex);
      if (Number.isInteger(targetIndex)) {
        setBackpackLayout((current) => moveInventoryItem(current, itemId, targetIndex, backpackSlots));
      }
      return;
    }
    if (destination === "equipment") {
      const item = world.inventory.find((entry) => entry.instanceId === itemId);
      const slot = item ? world.itemDefinitions.get(item.definitionId)?.equipmentSlot : undefined;
      if (slot) network.equip(itemId, slot);
      return;
    }
    if (destination === "ground") network.drop(itemId);
  };
  useEffect(() => {
    currentInventoryPointerDrop = pointerDrop;
    return () => {
      if (currentInventoryPointerDrop === pointerDrop) currentInventoryPointerDrop = null;
    };
  }, [pointerDrop]);
  return (
    <div className="inventory-panel">
      <header className="inventory-toolbar">
        <span><small>{equippedBackpackDefinition?.name ?? "No backpack equipped"}</small><strong>{carriedItems.length} / {backpackSlots} slots used</strong></span>
        <label><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory" aria-label="Search inventory" /></label>
      </header>
      <div className="inventory-summary">
        <span>
          <strong>{equippedBackpackDefinition ? `${backpackSlots} inventory slots` : "Equip a backpack to carry items"}</strong>
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
      <div className="inventory-workspace">
      <div className="inventory-columns">
        <section
          className="inventory-drop-zone"
          data-inventory-drop="root"
          onDragOver={allowItemDrop}
          onDrop={(event) => drop(event, "root")}
        >
          <header className="inventory-section-title"><span><small>Storage</small><h3>Backpack</h3></span><b>{carriedItems.length} / {backpackSlots}</b></header>
          {matchingItemIds.size === 0 && (
            <p className="empty-state">{query ? "No items match your search." : backpackSlots === 0 ? "You have no inventory slots. Equip a backpack in the Character window." : "Your backpack is empty."}</p>
          )}
          <div className="inventory-slot-grid backpack-slot-grid">
            {backpackLayout.map((itemId, index) => {
              const item = itemId && matchingItemIds.has(itemId)
                ? carriedItems.find((entry) => entry.instanceId === itemId)
                : undefined;
              return item
                ? <InventorySlot item={item} onOpenContextMenu={openContextMenu} onPointerDrop={pointerDrop} dropKind="root" dropIndex={index} onDropToArea={(event) => drop(event, "root", index)} key={`backpack-${index}-${item.instanceId}`} />
                : <div className="inventory-grid-slot empty" data-inventory-drop="root" data-backpack-index={index} onDragOver={allowItemDrop} onDrop={(event) => drop(event, "root", index)} key={`backpack-empty-${index}`} />;
            })}
          </div>
          <div className="inventory-currency" aria-label={`${gold} Gold Coins`}>
            <ItemIcon definitionId="gold_coin" />
            <span>
              <small>Currency</small>
              <strong>{gold.toLocaleString()} Gold Coins</strong>
            </span>
          </div>
        </section>
      </div>
      </div>
      {contextItem && contextMenu && <InventoryDetails item={contextItem} position={contextMenu} onClose={() => setContextMenu(null)} onSplit={() => setSplitRequest({ itemId: contextItem.instanceId, quantity: Math.max(1, Math.floor(contextItem.quantity / 2)), max: contextItem.quantity - 1, x: contextMenu.x, y: contextMenu.y })} />}
      {splitRequest && (
        <form className="split-stack-dialog" style={{ left: splitRequest.x, top: splitRequest.y }} onSubmit={(event) => { event.preventDefault(); network.split(splitRequest.itemId, splitRequest.quantity); setSplitRequest(null); }}>
          <span><small>Split stack</small><strong>Choose amount</strong></span>
          <input autoFocus type="number" min={1} max={splitRequest.max} value={splitRequest.quantity} onChange={(event) => setSplitRequest((current) => current ? { ...current, quantity: Math.max(1, Math.min(current.max, Number(event.target.value) || 1)) } : null)} />
          <div><button type="button" onClick={() => setSplitRequest(null)}>Cancel</button><button type="submit">Create stack</button></div>
        </form>
      )}
    </div>
  );
}

function InventorySlot({ item, onOpenContextMenu, onPointerDrop, dropKind, dropIndex, onDropToArea }: { item: ItemInstance; onOpenContextMenu: (event: MouseEvent, itemId: string) => void; onPointerDrop: (itemId: string, target: HTMLElement | null) => void; dropKind: "root" | "equipment"; dropIndex?: number; onDropToArea: (event: DragEvent) => void }) {
  const definition = world.itemDefinitions.get(item.definitionId);
  const children = world.inventory.filter((child) => child.containerId === item.instanceId);
  const receive = (event: DragEvent) => {
    if (!definition?.containerSlots) return;
    event.preventDefault();
    event.stopPropagation();
    const itemId = draggedItemId(event);
    if (itemId && itemId !== item.instanceId) network.moveToContainer(itemId, item.instanceId);
  };
  return (
    <button
      draggable={false}
      data-inventory-drop={definition?.containerSlots ? "container" : dropKind}
      data-container-id={definition?.containerSlots ? item.instanceId : undefined}
      data-item-id={item.instanceId}
      data-backpack-index={dropKind === "root" ? dropIndex : undefined}
      className={`inventory-grid-slot filled ${definition?.containerSlots ? "container-drop-target" : ""}`}
      onDoubleClick={() => {
        if (definition?.foodEffect) network.eat(item.instanceId);
        else if (definition?.equipmentSlot && !item.equippedSlot) network.equip(item.instanceId, definition.equipmentSlot);
      }}
      onPointerDown={(event) => beginPointerItemDrag(event, item.instanceId)}
      onPointerMove={movePointerItemDrag}
      onPointerUp={(event) => endPointerItemDrag(event, onPointerDrop)}
      onPointerCancel={cancelPointerItemDrag}
      onDragOver={allowItemDrop}
      onDrop={definition?.containerSlots ? receive : onDropToArea}
      onContextMenu={(event) => onOpenContextMenu(event, item.instanceId)}
      title={`${definition?.name ?? item.definitionId}${definition?.containerSlots ? ` · ${children.length}/${definition.containerSlots} slots` : ""}`}
    >
      <ItemIcon definitionId={item.definitionId} />
      <small className="inventory-slot-name">{definition?.name ?? item.definitionId}</small>
      {item.quantity > 1 && <b>{item.quantity}</b>}
      {item.charges !== undefined && <b>{item.charges}</b>}
      {item.equippedSlot && <i className="inventory-slot-state">{item.equippedSlot}</i>}
      {item.containerId && <i className="inventory-slot-state">packed</i>}
    </button>
  );
}

function InventoryDetails({ item, position, onClose, onSplit }: { item: ItemInstance; position: { x: number; y: number }; onClose: () => void; onSplit: () => void }) {
  const definition = world.itemDefinitions.get(item.definitionId);
  const children = world.inventory.filter((child) => child.containerId === item.instanceId);
  return <section className="inventory-item-details inventory-context-menu" style={{ left: position.x, top: position.y }} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) onClose(); }}>
    <ItemIcon definitionId={item.definitionId} />
    <span><small>{item.equippedSlot ? "Equipped" : item.containerId ? "Inside backpack" : "Inventory item"}</small><strong>{definition?.name ?? item.definitionId}</strong><p>{((definition?.weight ?? 0) * item.quantity).toFixed(1)} oz{definition?.containerSlots ? ` · ${children.length}/${definition.containerSlots} slots` : ""}{definition?.distanceWeapon ? ` · range ${definition.distanceWeapon.range}` : ""}</p></span>
    <div className="item-actions">
      {definition?.foodEffect && <button onClick={() => network.eat(item.instanceId)}>Eat</button>}
      {definition?.teachesRecipeId && <button disabled={world.learnedRecipeIds.has(definition.teachesRecipeId)} onClick={() => network.learnRecipeFromItem(item.instanceId)}>{world.learnedRecipeIds.has(definition.teachesRecipeId) ? "Recipe learned" : "Learn recipe"}</button>}
      {definition?.equipmentSlot && !item.equippedSlot && <button onClick={() => network.equip(item.instanceId, definition.equipmentSlot!)}>Equip</button>}
      {item.equippedSlot && <button onClick={() => network.moveToRoot(item.instanceId)}>Unequip</button>}
      {item.containerId && <button onClick={() => network.moveToRoot(item.instanceId)}>Unpack</button>}
      {item.quantity > 1 && <button onClick={onSplit}>Split stack…</button>}
    </div>
  </section>;
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
let activeDraggedItemId: string | null = null;
function startItemDrag(event: DragEvent, itemId: string) {
  activeDraggedItemId = itemId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(ITEM_DRAG_TYPE, itemId);
  event.dataTransfer.setData("text/plain", itemId);
}
function finishItemDrag() {
  activeDraggedItemId = null;
}
function draggedItemId(event: DragEvent) {
  return (
    event.dataTransfer.getData(ITEM_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain") ||
    activeDraggedItemId ||
    ""
  );
}
function allowItemDrop(event: DragEvent) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

type PointerItemDrag = {
  itemId: string;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  moved: boolean;
  previewTarget: HTMLElement | null;
  previewIcon: HTMLElement | null;
  groundGhost: HTMLElement | null;
};
let pointerItemDrag: PointerItemDrag | null = null;

function beginPointerItemDrag(event: PointerEvent<HTMLElement>, itemId: string) {
  if (event.button !== 0) return;
  pointerItemDrag = {
    itemId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    source: event.currentTarget,
    moved: false,
    previewTarget: null,
    previewIcon: null,
    groundGhost: null,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function movePointerItemDrag(event: PointerEvent<HTMLElement>) {
  const drag = pointerItemDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) {
    drag.moved = true;
    drag.source.classList.add("pointer-dragging");
    document.body.classList.add("inventory-pointer-dragging");
  }
  if (drag.moved) {
    event.preventDefault();
    updatePointerDropPreview(event.clientX, event.clientY);
  }
}

function endPointerItemDrag(event: PointerEvent<HTMLElement>, onDrop: (itemId: string, target: HTMLElement | null) => void) {
  const drag = pointerItemDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  if (drag.moved) {
    event.preventDefault();
    const hovered = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = hovered?.closest<HTMLElement>("[data-inventory-drop]") ?? hovered;
    onDrop(drag.itemId, target);
  }
  clearPointerItemDrag();
}

function cancelPointerItemDrag(event: PointerEvent<HTMLElement>) {
  if (pointerItemDrag?.pointerId !== event.pointerId) return;
  clearPointerItemDrag();
}

function clearPointerItemDrag() {
  clearPointerDropPreview();
  pointerItemDrag?.source.classList.remove("pointer-dragging");
  document.body.classList.remove("inventory-pointer-dragging");
  pointerItemDrag = null;
}

function updatePointerDropPreview(clientX: number, clientY: number) {
  const drag = pointerItemDrag;
  if (!drag) return;
  const hoveredElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const hovered = hoveredElement?.closest<HTMLElement>("[data-inventory-drop]") ?? null;
  const target = hovered?.closest<HTMLElement>(".inventory-grid-slot, .equipment-slot") ?? null;
  if (target !== drag.previewTarget) {
    clearPointerSlotPreview();
    if (target && target !== drag.source) {
      const sourceIcon = drag.source.querySelector<HTMLElement>(".item-icon");
      if (sourceIcon) {
        const previewIcon = sourceIcon.cloneNode(true) as HTMLElement;
        previewIcon.classList.add("inventory-drop-ghost");
        previewIcon.setAttribute("aria-hidden", "true");
        target.classList.add("pointer-drop-preview");
        target.appendChild(previewIcon);
        drag.previewTarget = target;
        drag.previewIcon = previewIcon;
      }
    }
  }
  updateGroundDropGhost(clientX, clientY, !hoveredElement?.closest(".game-modal"));
}

function clearPointerDropPreview() {
  const drag = pointerItemDrag;
  if (!drag) return;
  clearPointerSlotPreview();
  drag.groundGhost?.remove();
  drag.groundGhost = null;
}

function clearPointerSlotPreview() {
  const drag = pointerItemDrag;
  if (!drag) return;
  drag.previewTarget?.classList.remove("pointer-drop-preview");
  drag.previewIcon?.remove();
  drag.previewTarget = null;
  drag.previewIcon = null;
}

function updateGroundDropGhost(clientX: number, clientY: number, visible: boolean) {
  const drag = pointerItemDrag;
  if (!drag) return;
  if (!visible) {
    drag.groundGhost?.remove();
    drag.groundGhost = null;
    return;
  }
  if (!drag.groundGhost) {
    const sourceIcon = drag.source.querySelector<HTMLElement>(".item-icon");
    if (!sourceIcon) return;
    const ghost = document.createElement("div");
    ghost.className = "inventory-ground-drop-ghost";
    const icon = sourceIcon.cloneNode(true) as HTMLElement;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("small");
    label.textContent = "Drop on ground";
    ghost.append(icon, label);
    document.body.appendChild(ghost);
    drag.groundGhost = ghost;
  }
  drag.groundGhost.style.left = `${clientX}px`;
  drag.groundGhost.style.top = `${clientY}px`;
}

function reconcileInventoryLayout(current: (string | null)[], itemIds: string[], slotCount: number) {
  const validIds = new Set(itemIds);
  const next = Array.from({ length: slotCount }, (_, index) => {
    const itemId = current[index];
    return itemId && validIds.delete(itemId) ? itemId : null;
  });
  for (const itemId of itemIds) {
    if (!validIds.has(itemId)) continue;
    const emptyIndex = next.indexOf(null);
    if (emptyIndex >= 0) next[emptyIndex] = itemId;
    else next.push(itemId);
  }
  return next;
}

function loadInventoryLayout(storageKey: string): (string | null)[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(stored)
      ? stored.map((entry) => typeof entry === "string" ? entry : null)
      : [];
  } catch {
    return [];
  }
}

function moveInventoryItem(current: (string | null)[], itemId: string, targetIndex: number, slotCount: number) {
  const next = reconcileInventoryLayout(current, [
    ...current.filter((entry): entry is string => Boolean(entry)),
    itemId,
  ], Math.max(slotCount, targetIndex + 1));
  const sourceIndex = next.indexOf(itemId);
  if (sourceIndex === targetIndex) return next;
  const displaced = next[targetIndex] ?? null;
  next[targetIndex] = itemId;
  if (sourceIndex >= 0) next[sourceIndex] = displaced;
  return next;
}
