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
import { ApiFailure, authenticate, checkServer, listCharacters } from "./api";
import { CharacterLobby } from "./CharacterLobby";
import { MenuMusic, WorldMusic } from "./audio/WorldMusic";
import { getAudioSettings, subscribeAudioSettings, updateAudioSettings } from "./audio/audioSettings";
import { InputController } from "./game/InputController";
// TIBIAGAME_GATHER_CANCEL_V31_C_1_1
import { GameMinimap } from "./game/GameMinimap";
import { WorldMap } from "./game/WorldMap";
import { ThreeWorld } from "./game/ThreeWorld";
import { NativeWorldRenderer } from "./game/NativeWorldRenderer";
import { NetworkClient } from "./game/NetworkClient";
import { WorldState } from "./game/WorldState";
import { isWorldTimePaused, setWorldTime, setWorldTimePaused, worldEnvironment, worldTimeLabel } from "./game/worldEnvironment";
import { PROTOCOL_VERSION, type BuildingView, type CharacterOutfit, type GroundItem, type ItemDefinition, type ItemInstance, type PlayerView, type Position, type SecondarySkill } from "./protocol";
// TIBIAGAME_V34_FIXSET_1
// TIBIAGAME_V35_4_CHARACTER_PAPERDOLL
// TIBIAGAME_V35_5_NETWORK_FRAME_BUDGET
// TIBIAGAME_V35_2_MAINTHREAD_OPTIMIZATION
// TIBIAGAME_V35_3_IDLE_MAINTHREAD_FIXES
// TIBIAGAME_V35_1_COMBAT_UI_FIXES

const world = new WorldState();
const network = new NetworkClient(world);
const input = new InputController(world, network);
const subscribeWorldVisual = (listener: () => void) => world.subscribeVisual(listener);
const worldVisualSnapshot = () => world.visualRevision;

export default function App() {
  const [sessionToken, setSessionToken] = useState(
    () => localStorage.getItem("sessionToken") ?? "",
  );
  const [sessionStatus, setSessionStatus] = useState<"ready" | "checking">(
    () => (localStorage.getItem("sessionToken") ? "checking" : "ready"),
  );
  const [loginNotice, setLoginNotice] = useState("");
  const wasInGame = useRef(false);
  const leavingGame = useRef(false);
  const worldRevision = useSyncExternalStore(
    (callback) => world.subscribe(callback),
    () => world.revision,
  );
  useEffect(() => input.attach(), []);
  const authenticated = (token: string) => {
    localStorage.setItem("sessionToken", token);
    setSessionToken(token);
    setLoginNotice("");
  };
  const logout = useCallback(() => {
    network.disconnect();
    localStorage.removeItem("sessionToken");
    setSessionToken("");
    setSessionStatus("ready");
  }, []);
  useEffect(() => {
    if (world.connection === "online" && world.localPlayerId) {
      wasInGame.current = true;
      return;
    }
    if (!wasInGame.current || leavingGame.current || !["offline", "error"].includes(world.connection)) return;
    wasInGame.current = false;
    localStorage.removeItem("sessionToken");
    setSessionToken("");
    setSessionStatus("ready");
    setLoginNotice("The connection to the game server was lost. Please log in again.");
    network.disconnect();
  }, [worldRevision]);
  useEffect(() => {
    if (!sessionToken) {
      setSessionStatus("ready");
      return;
    }

    let active = true;
    setSessionStatus("checking");
    void listCharacters(sessionToken)
      .then(() => {
        if (active) setSessionStatus("ready");
      })
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof ApiFailure && [401, 403].includes(failure.status)) {
          logout();
          return;
        }
        logout();
      });
    return () => {
      active = false;
    };
  }, [sessionToken, logout]);
  const leaveGame = useCallback(() => {
    leavingGame.current = true;
    wasInGame.current = false;
    network.disconnect();
  }, []);
  const enterGame = useCallback((characterId: string) => {
    leavingGame.current = false;
    network.connect(sessionToken, characterId);
  }, [sessionToken]);
  if (world.connection === "online" && world.localPlayerId)
    return <Game onLeave={leaveGame} />;
  if (!sessionToken) return <><MenuMusic /><AccountLogin onAuthenticated={authenticated} notice={loginNotice} /></>;
  if (sessionStatus === "checking") return <><MenuMusic /><AccountLogin onAuthenticated={authenticated} notice={loginNotice} /></>;
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
        onPlay={enterGame}
        onLogout={logout}
      />
    </>
  );
}

function AccountLogin({
  onAuthenticated,
  notice,
}: {
  onAuthenticated: (token: string) => void;
  notice?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const updateServerStatus = async () => {
      const online = await checkServer();
      if (active) setServerOnline(online);
    };
    void updateServerStatus();
    const timer = window.setInterval(() => void updateServerStatus(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
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
        <ServerStatusIndicator online={serverOnline} />
        <UpdaterStatusPanel />
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
        {(notice || error) && <p className="error">{notice || error}</p>}
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

type UpdaterStatus = {
  phase:
    | "checking"
    | "up_to_date"
    | "available"
    | "downloading"
    | "installing"
    | "restarting"
    | "error";
  currentVersion?: string;
  version?: string;
  downloaded?: number;
  total?: number;
  progress?: number;
  message?: string;
};

type UpdaterWindow = Window & {
  __ALDORIA_UPDATER_STATUS__?: UpdaterStatus;
};

function formatUpdateBytes(value: number | undefined) {
  if (!value || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

function UpdaterStatusPanel() {
  const [status, setStatus] = useState<UpdaterStatus | null>(
    () => (window as UpdaterWindow).__ALDORIA_UPDATER_STATUS__ ?? null,
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const next = (event as CustomEvent<UpdaterStatus>).detail;
      if (next) setStatus(next);
    };
    window.addEventListener("aldoria-updater-status", listener);
    setStatus((window as UpdaterWindow).__ALDORIA_UPDATER_STATUS__ ?? null);
    return () => window.removeEventListener("aldoria-updater-status", listener);
  }, []);

  if (!status || status.phase === "up_to_date") return null;

  const percent = Math.max(
    0,
    Math.min(
      100,
      status.total && status.downloaded
        ? status.downloaded / status.total * 100
        : status.progress ?? 0,
    ),
  );

  const label = {
    checking: "Checking for client update…",
    available: status.version
      ? `Updating to ${status.version}…`
      : "Client update available…",
    downloading: "Downloading client update…",
    installing: "Verifying and installing update…",
    restarting: "Update installed. Restarting…",
    error: status.message ?? "Could not update the client.",
    up_to_date: "",
  }[status.phase];

  return (
    <section className={`updater-status updater-${status.phase}`} aria-live="polite">
      <header>
        <span><small>Client updater</small><strong>{label}</strong></span>
        {status.phase === "downloading" && <b>{Math.round(percent)}%</b>}
      </header>
      {["available", "downloading", "installing"].includes(status.phase) && (
        <div className="updater-progress" aria-label={`Update ${Math.round(percent)} percent`}>
          <i style={{ width: `${status.phase === "downloading" ? percent : status.phase === "installing" ? 100 : 2}%` }} />
        </div>
      )}
      {status.phase === "downloading" && (
        <footer>
          <span>{formatUpdateBytes(status.downloaded)} / {formatUpdateBytes(status.total)}</span>
          {status.currentVersion && status.version && <span>{status.currentVersion} → {status.version}</span>}
        </footer>
      )}
    </section>
  );
}

function ServerStatusIndicator({ online }: { online: boolean | null }) {
  const label = online === null ? "Checking server" : online ? "Server online" : "Server offline";
  return <div className={`server-status ${online === true ? "online" : online === false ? "offline" : "checking"}`}><i aria-hidden="true" />{label}</div>;
}

function WorldPing() {
  const [ping, setPing] = useState(() => world.ping);
  useEffect(() => {
    const refresh = () => {
      const next = world.ping;
      setPing((current) => current === next ? current : next);
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{ping} ms</>;
}

type Panel = "inventory" | "crafting" | "skills" | "character" | "help" | "options";

function Game({ onLeave }: { onLeave: () => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [showInventoryCharacter, setShowInventoryCharacter] = useState(false);
  const [escapeMenu, setEscapeMenu] = useState(false);
  const [showPerformance, setShowPerformance] = useState(() => loadStoredBoolean("aldoria.show-performance", false));
  const [reducedMotion, setReducedMotion] = useState(() => loadStoredBoolean("aldoria.reduced-motion", false));
  const [sceneReady, setSceneReady] = useState(false);
  // TIBIAGAME_NATIVE_RENDERER_EXPERIMENT_V22
  // TIBIAGAME_NATIVE_RENDERER_V23_DEFAULT
  // Native raw Three.js is now the default world renderer. Keep the old R3F
  // path only as a temporary A/B fallback with ?renderer=r3f.
  const nativeWorldRenderer =
    new URLSearchParams(window.location.search).get("renderer") !== "r3f";
  const handleSceneReady = useCallback(() => setSceneReady(true), []);
  const actionSkillsStorageKey = `aldoria.action-skills.${world.localPlayerId ?? "unknown"}`;
  const [actionSkills, setActionSkills] = useState<Record<number, string | null>>(
    () => loadActionSkills(world.localPlayerId),
  );
  const pendingGoldPickups = useRef(new Set<string>());
  // TIBIAGAME_V35A_UI_COMBAT
  // Charged stacks keep one active partially-used sigil plus full sigils behind it.
  const emberDefinition = world.itemDefinitions.get("ember_rune");
  const emberSigil = world.inventory
    .filter((item) => item.definitionId === "ember_rune" && (item.charges ?? 0) > 0)
    .sort((left, right) => (left.charges ?? 0) - (right.charges ?? 0))[0];
  const emberCharges = world.inventory
    .filter((item) => item.definitionId === "ember_rune")
    .reduce((sum, item) => sum + chargedStackUses(item, emberDefinition), 0);
  const useEmberSigil = () => {
    if (emberSigil) network.useItem(emberSigil.instanceId);
    else world.addSystemMessage("You do not have a charged Ember Sigil.");
  };
  const activateActionSlot = (slot: number) => {
    const actionId = actionSkills[slot];
    if (!actionId) return;
    if (actionId === "ember_sigil") {
      useEmberSigil();
      return;
    }
    if (actionId === "basic_attack") {
      if (world.attackTargetId) network.attack(world.attackTargetId);
      else world.addSystemMessage("Select a living target first.");
      return;
    }
    if (actionId === "second_wind" || actionId === "shield_guard") {
      network.useAbility(actionId);
      return;
    }
    if (world.learnedSpellIds.has(actionId) && world.spells.has(actionId)) {
      network.castSpell(actionId);
    }
  };
  const assignActionSkill = (slot: number, skillId: string) => {
    setActionSkills((current) => ({ ...current, [slot]: skillId }));
  };
  const clearActionSkill = (slot: number) => {
    setActionSkills((current) => ({ ...current, [slot]: null }));
  };
  actionSkillDragHandlers = { assign: assignActionSkill, clear: clearActionSkill };
  useEffect(() => {
    localStorage.setItem(actionSkillsStorageKey, JSON.stringify(actionSkills));
  }, [actionSkills, actionSkillsStorageKey]);
  useEffect(() => localStorage.setItem("aldoria.show-performance", String(showPerformance)), [showPerformance]);
  useEffect(() => localStorage.setItem("aldoria.reduced-motion", String(reducedMotion)), [reducedMotion]);
  useEffect(() => {
    if (panel || worldMapOpen || escapeMenu || world.trade || world.incomingTrade || world.activeNpcId)
      input.releaseAll();
  }, [
    panel,
    worldMapOpen,
    escapeMenu,
    Boolean(world.trade),
    Boolean(world.incomingTrade),
    world.activeNpcId,
  ]);
  useEffect(() => {
    const hotkeys: Record<string, Panel> = {
      i: "inventory",
      k: "skills",
      r: "crafting",
      c: "character",
      h: "help",
    };
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (worldMapOpen) {
          setWorldMapOpen(false);
          return;
        }
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
        event.key === "Enter"
        && !(event.target instanceof HTMLInputElement)
        && !(event.target instanceof HTMLTextAreaElement)
        && !panel
        && !escapeMenu
        && !world.trade
        && !world.incomingTrade
        && !world.activeNpcId
      ) {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new Event("aldoria-focus-chat"));
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
          if (!event.repeat) input.interactAt(resource.position);
          return;
        }
      }
      if (
        event.code === "KeyM"
        && !escapeMenu
        && !world.trade
        && !world.incomingTrade
        && !world.activeNpcId
      ) {
        event.preventDefault();
        event.stopPropagation();
        setPanel(null);
        setWorldMapOpen((current) => !current);
        return;
      }

      const actionHotkey = /^Digit([1-8])$/.exec(event.code);
      if (actionHotkey) {
        event.preventDefault();
        if (!event.repeat) activateActionSlot(Number(actionHotkey[1]));
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
  }, [actionSkills, emberSigil?.instanceId, escapeMenu, panel, world.attackTargetId, worldMapOpen]);
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
    skills: "Skills",
    character: "Character",
    help: "Controls",
    options: "Options",
  };
  return (
    <main className={`game-shell ${reducedMotion ? "reduced-motion" : ""}`}>
      <WorldMusic world={world} />
      <section className="viewport">
        {nativeWorldRenderer ? (
          <NativeWorldRenderer
            world={world}
            input={input}
            showDebug={showPerformance}
            onReady={handleSceneReady}
          />
        ) : (
          <ThreeWorld
            world={world}
            input={input}
            showDebug={showPerformance}
            onReady={handleSceneReady}
          />
        )}
        {!sceneReady && <WorldLoadingScreen />}
      </section>
      <AreaTransition world={world} />
      <ReceivedItemToast />
      <ItemHoverTooltip />
      <header className="world-header">
        <strong>Embers of Aldoria</strong>
        <span>
          Greyhaven · {world.players.size} online · <WorldPing />
        </span>
      </header>
      <GameMinimap world={world} />
      {worldMapOpen && <WorldMap world={world} onClose={() => setWorldMapOpen(false)} />}
      <BattleList />
      <section className="unit-frame">
        <div className="portrait">{local?.name.slice(0, 1)}</div>
        <div>
          <strong>{local?.name}</strong>
          <small>
            Level {local?.level} · {local?.experience} XP
          </small>
          {local && <PlayerProgress player={local} />}
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
        {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => {
          const actionId = actionSkills[slot];
          const action = actionId ? actionBarDefinition(actionId) : null;
          const isSigil = actionId === "ember_sigil";
          const spell = actionId ? world.spells.get(actionId) : undefined;
          const isSpell = Boolean(
            actionId
            && spell
            && world.learnedSpellIds.has(actionId),
          );
          const abilityCooldown = actionId ? world.abilityCooldowns.get(actionId) : undefined;
          const isCoreAbility = Boolean(actionId && actionSkillDefinition(actionId));
          const unavailable = isSigil
            ? !emberSigil || !world.attackTargetId
            : isSpell
              ? !world.attackTargetId || (local?.mana ?? 0) < (spell?.manaCost ?? 0)
              : isCoreAbility
                ? !actionSkillAvailable(actionId!, local) || Boolean(abilityCooldown && abilityCooldown.until > Date.now())
                : false;
          const detail = isSigil
            ? emberCharges
            : isSpell
              ? `${spell?.manaCost ?? 0} mana`
              : action?.name;
          return <button
            className={`ability-slot ${isSigil ? "ember-sigil" : isSpell ? "spell-action" : action ? "skill-ability" : "empty-ability"} ${unavailable ? "unavailable" : ""}`}
            key={slot}
            data-action-slot={slot}
            draggable={false}
            aria-disabled={unavailable}
            title={action ? `${action.name} · Drag out or right-click to remove` : "Drop a skill here"}
            onClick={() => action && Date.now() >= suppressActionSkillClickUntil && activateActionSlot(slot)}
            onContextMenu={(event) => { event.preventDefault(); clearActionSkill(slot); }}
            onPointerDown={(event) => { if (actionId) beginSkillPointerDrag(event, actionId, slot); }}
            onDragStart={(event) => { if (!actionId) { event.preventDefault(); return; } event.dataTransfer.setData("application/x-aldoria-skill", actionId); event.dataTransfer.setData("text/plain", actionId); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const skillValue = event.dataTransfer.getData("application/x-aldoria-skill") || event.dataTransfer.getData("text/plain"); if (skillValue && actionBarDefinition(skillValue)) assignActionSkill(slot, skillValue); }}
          >
            {isSigil && world.combatItemCooldownUntil > Date.now() && <i key={world.combatItemCooldownUntil} className="cooldown-sweep" style={{ animationDuration: `${world.combatItemCooldownMs}ms` }} />}
            {isSpell && world.spellCooldownUntil > Date.now() && <i key={world.spellCooldownUntil} className="cooldown-sweep" style={{ animationDuration: `${world.spellCooldownMs}ms` }} />}
            {isCoreAbility && abilityCooldown && abilityCooldown.until > Date.now() && <i key={abilityCooldown.until} className="cooldown-sweep" style={{ animationDuration: `${abilityCooldown.durationMs}ms` }} />}
            <kbd>{slot}</kbd>
            {action ? <><span className="ability-glyph">{action.glyph}</span><small>{detail}</small></> : <span>+</span>}
          </button>;
        })}
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
          icon={"\u2605"}
          label="Skills"
          active={panel === "skills"}
          onClick={() => setPanel(panel === "skills" ? null : "skills")}
        />
        <DockButton
          hotkey="R"
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
          ) : panel === "skills" ? (
            <SkillPanel />
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

const settlementPrefixes: [string, string][] = [
  ["rivercross", "Rivercross"], ["greenshade", "Greenshade"], ["westwood", "Westwood"],
  ["reedmere", "Reedmere"], ["greyford", "Greyford"], ["east_", "East March"],
  ["deepwood", "Deepwood"], ["mossford", "Mossford"], ["fenwatch", "Fenwatch"],
  ["southroad", "Southroad"], ["stonebrook", "Stonebrook"], ["blackfen", "Blackfen"],
  ["pinewatch", "Pinewatch"], ["highpass", "Highpass"], ["ravenmoor", "Ravenmoor"],
  ["old_march", "Old March"], ["ravenmere", "Ravenmere"], ["ironvale", "Ironvale"],
  ["veilwatch", "Veilwatch"],
];

function AreaTransition({ world: gameWorld }: { world: WorldState }) {
  useSyncExternalStore(
    (listener) => {
      const stopWorld = gameWorld.subscribe(listener);
      const stopVisual = gameWorld.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => {
      const current = gameWorld.localPlayerId
        ? gameWorld.players.get(gameWorld.localPlayerId)
        : null;
      return current
        ? `${current.id}:${current.position.x}:${current.position.y}:${current.position.z}:${gameWorld.streamRegionRevision}`
        : `none:${gameWorld.streamRegionRevision}`;
    },
  );
  const player = gameWorld.localPlayerId ? gameWorld.players.get(gameWorld.localPlayerId) : null;
  const area = player && gameWorld.map ? resolveArea(player.position, gameWorld.map.buildings) : null;
  const lastArea = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: number; title: string; subtitle: string } | null>(null);

  useEffect(() => {
    if (!area || area.id === lastArea.current) return;
    lastArea.current = area.id;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setAnnouncement({ key: Date.now(), title: area.title, subtitle: area.subtitle });
    timer.current = window.setTimeout(() => setAnnouncement(null), 4_200);
  }, [area?.id]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  if (!announcement) return null;
  return <section className="area-transition" key={announcement.key} aria-live="polite">
    <small>{announcement.subtitle}</small>
    <strong>{announcement.title}</strong>
    <i />
  </section>;
}

function ReceivedItemToast() {
  const notice = world.receivedItemNotice;
  if (!notice) return null;
  const name = world.itemDefinitions.get(notice.definitionId)?.name ?? notice.definitionId.replaceAll("_", " ");
  return <section className="item-received-toast" key={notice.key} aria-live="polite" onAnimationEnd={() => world.clearReceivedItemNotice(notice.key)}>
    <span aria-hidden="true">◆</span>
    <div><small>Found</small><strong>{name}</strong><p>Added to your backpack</p></div>
  </section>;
}

function resolveArea(position: Position, buildings: readonly BuildingView[]) {
  if (position.z !== 7) return position.z > 7
    ? { id: `depth-${position.z}`, title: `Depth ${position.z}`, subtitle: "Beneath the First Marches" }
    : { id: `height-${position.z}`, title: `Upper Floor ${position.z}`, subtitle: "The First Marches" };
  const inside = buildings.find((building) => building.floor === position.z && pointInsideBuilding(position, building));
  if (inside) {
    const settlement = settlementName(inside);
    return { id: `building:${inside.id}`, title: inside.name, subtitle: settlement ?? "Interior" };
  }
  let nearest: { building: BuildingView; distance: number } | null = null;
  for (const building of buildings) {
    if (building.floor !== position.z || !settlementName(building)) continue;
    const distance = distanceToBuilding(position, building);
    if (!nearest || distance < nearest.distance) nearest = { building, distance };
  }
  if (nearest && nearest.distance <= 36) {
    const settlement = settlementName(nearest.building)!;
    return { id: `settlement:${settlement}`, title: settlement, subtitle: "The First Marches" };
  }
  return { id: "first-marches", title: "The First Marches", subtitle: "Northwestern Aldoria" };
}

function settlementName(building: BuildingView) {
  const id = building.id.toLowerCase();
  return settlementPrefixes.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}

function pointInsideBuilding(position: Position, building: BuildingView) {
  return position.x >= building.x && position.x < building.x + building.width
    && position.y >= building.y && position.y < building.y + building.height;
}

function distanceToBuilding(position: Position, building: BuildingView) {
  const dx = Math.max(building.x - position.x, 0, position.x - (building.x + building.width - 1));
  const dy = Math.max(building.y - position.y, 0, position.y - (building.y + building.height - 1));
  return Math.hypot(dx, dy);
}

function NpcProximityGuard() {
  useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => {
      const currentNpc = world.activeNpcId ? world.npcs.get(world.activeNpcId) : null;
      const currentPlayer = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      return [
        currentNpc?.id ?? "",
        currentNpc?.position.x ?? -1,
        currentNpc?.position.y ?? -1,
        currentNpc?.position.z ?? -1,
        currentPlayer?.position.x ?? -1,
        currentPlayer?.position.y ?? -1,
        currentPlayer?.position.z ?? -1,
      ].join(":");
    },
  );
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

function PlayerProgress({ player }: { player: PlayerView }) {
  const currentLevelExperience = Math.max(0, player.level - 1) ** 2 * 100;
  const nextLevelExperience = player.level ** 2 * 100;
  const earnedExperience = Math.max(0, player.experience - currentLevelExperience);
  const requiredExperience = Math.max(1, nextLevelExperience - currentLevelExperience);
  const remainingExperience = Math.max(0, nextLevelExperience - player.experience);
  return <div className="player-progression">
    <ProgressBar className="experience" label={`XP · ${remainingExperience.toLocaleString()} to level ${player.level + 1}`} value={earnedExperience} max={requiredExperience} detail={`${earnedExperience.toLocaleString()} / ${requiredExperience.toLocaleString()} XP`} />
  </div>;
}

function ProgressBar({ className, label, value, max, detail }: { className: "experience" | "skill"; label: string; value: number; max: number; detail: string }) {
  const progress = Math.min(100, Math.max(0, value / Math.max(1, max) * 100));
  return <div className={`player-progress-bar ${className}`} title={`${label}: ${detail}`}>
    <span><b>{label}</b><small>{detail}</small></span>
    <i><em style={{ width: `${progress}%` }} /></i>
  </div>;
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
  useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => {
      const creature = world.attackTargetId ? world.creatures.get(world.attackTargetId) : null;
      const player = world.selectedPlayerId ? world.players.get(world.selectedPlayerId) : null;
      const target = creature ?? player;
      return target
        ? [target.id, target.health, target.maxHealth, creature?.state ?? "player", creature?.immune ?? false].join(":")
        : "none";
    },
  );
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
  const audio = useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
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
        <header><span className="option-icon">VOL</span><div><h3>Audio</h3><p>Set overall, music and future game-effect volume.</p></div></header>
        <AudioSlider label="Master volume" description="Controls every sound in the game." value={audio.masterVolume} onChange={(masterVolume) => updateAudioSettings({ masterVolume })} />
        <AudioSlider label="Music volume" description="Controls menu, exploration and battle music." value={audio.musicVolume} onChange={(musicVolume) => updateAudioSettings({ musicVolume })} />
        <AudioSlider label="Effects volume" description="Saved for combat, creatures and interface sounds." value={audio.effectsVolume} onChange={(effectsVolume) => updateAudioSettings({ effectsVolume })} />
        <label><span><strong>Mute all audio</strong><small>Keep the volume levels but silence playback.</small></span><input type="checkbox" checked={audio.muted} onChange={(event) => updateAudioSettings({ muted: event.target.checked })} /></label>
      </section>
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
      <p className="options-note">Gameplay shortcuts remain active: C for Character, I for Inventory, K for Skills, R for Crafting and H for Help.</p>
    </div>
  );
}

function AudioSlider({ label, description, value, onChange }: { label: string; description: string; value: number; onChange: (value: number) => void }) {
  return <label className="audio-option"><span><strong>{label}</strong><small>{description}</small></span><div><input type="range" min="0" max="100" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /><output>{value}%</output></div></label>;
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
const standaloneItemSpriteIds = new Set(["iron_ore", "coal_chunk", "healing_herbs", "rope_bundle", "rusty_key", "shovel", "leather_satchel", "torch_bundle", "iron_short_sword", "red_apple", "blank_rune", "ember_rune", "traveler_blade", "ashwood_bow", "rough_arrow", "frost_rune", "venom_rune", "iron_battle_axe", "iron_war_hammer", "ironbound_shield", "iron_helmet", "studded_armor", "reinforced_boots", "emerald_ring", "ember_amulet", "mana_tonic", "copper_ore", "mire_fiber", "bog_ichor", "gold_coin", "reed_hide", "fen_tusk", "field_bread", "smoked_mire_meat", "field_backpack", "ember_sigil_formula", "iron_pickaxe", "wooden_buckler", "worn_cap", "patched_tunic", "frayed_trousers", "work_boots", "mireling_remains", "mire_skulker_remains", "reed_stalker_remains", "fen_brute_remains", "castle_rat_remains", "crypt_guard_remains", "bone_acolyte_remains", "cellar_warden_remains", "iron_dagger", "rusty_mace", "hunting_spear", "woodsman_hatchet", "oak_staff", "traveler_cloak", "chain_coif", "leather_jerkin", "stitched_leggings", "round_kite_shield", "bronze_ring", "bone_amulet", "spark_rune", "stone_rune", "storm_rune", "shadow_rune", "health_tonic", "antidote_vial", "bandage_roll", "dried_rations", "tin_ore", "iron_ingot", "beast_claw", "spider_silk", "mandrake_root", "wolf_pelt", "lantern_oil", "lockpick_set", "fishhook_bundle", "raw_hide", "duelist_blade", "parrying_dagger", "corsair_cutlass", "stiletto", "raider_hatchet", "hook_sabre", "fishing_rod", "tackle_box", "bait_bucket", "miner_pickhammer", "smith_tongs", "skinning_knife", "flint_and_steel", "grappling_hook", "hand_torch", "hooded_lantern", "rope_coil", "repair_kit", "whetstone", "bedroll", "waterskin", "candle_bundle", "offhand_stiletto", "twinfang_blades", "paired_hatchets", "rat_tail", "rat_pelt", "mire_gland", "mire_spore_cluster", "skulker_venom_sac", "skulker_scale", "reed_sinew", "stalker_claw", "fen_brute_hide", "fen_brute_bone", "crypt_bone_shard", "grave_dust", "acolyte_focus_shard", "warden_core", "warden_plate_fragment", "mire_recovery_tonic", "purifying_tonic", "fen_marrow_stew", "graveward_tonic", "focus_draught", "warden_glow_charm", "rat_pelt_cap", "mireweave_cloak", "skulker_scale_vest", "fenhide_leggings", "fenhide_boots", "cryptbone_buckler", "warden_plate_helmet", "warden_plate_armor", "warden_plate_shield", "stalker_claw_blade", "fenbone_maul", "reed_sinew_bow", "acolyte_focus_amulet", "warden_core_hammer"]);
function ItemIcon({ definitionId }: { definitionId: string }) {
  return (
    <span className="item-icon-tooltip-target" data-item-definition-id={definitionId}>
      <ItemIconArtwork definitionId={definitionId} />
    </span>
  );
}

function ItemIconArtwork({ definitionId }: { definitionId: string }) {
  // TIBIAGAME_V34_FRIEND_FEEDBACK: reuse the existing iron-ingot art until dedicated bar art lands.
  if (definitionId === "copper_ingot" || definitionId === "tin_ingot") {
    const filter = definitionId === "copper_ingot"
      ? "sepia(1) saturate(1.8) hue-rotate(330deg) brightness(.9) drop-shadow(0 3px 3px #0009)"
      : "grayscale(.8) brightness(1.25) drop-shadow(0 3px 3px #0009)";
    return <i className="item-icon" style={{ backgroundImage: "url('/assets/sprites/items/iron_ingot.png')", backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat", filter }} />;
  }
  if (standaloneItemSpriteIds.has(definitionId)) return <i className="item-icon" style={{ backgroundImage: `url('/assets/sprites/items/${definitionId}.png')`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }} />;
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

const NPC_VENDOR_SELL_PRICES: Record<string, number> = {
  "blank_rune": 1,
  "traveler_blade": 12,
  "ashwood_bow": 24,
  "field_backpack": 18,
  "mire_fiber": 1,
  "field_bread": 1,
  "smoked_mire_meat": 3,
  "bog_ichor": 5,
  "reed_hide": 3,
  "fen_tusk": 6,
  "worn_cap": 2,
  "patched_tunic": 5,
  "frayed_trousers": 3,
  "work_boots": 3,
  "wooden_buckler": 5,
  "iron_pickaxe": 14,
  "copper_ore": 2,
  "iron_ore": 4,
  "coal_chunk": 2,
  "healing_herbs": 2,
  "rope_bundle": 2,
  "shovel": 7,
  "leather_satchel": 7,
  "iron_short_sword": 32,
  "red_apple": 1,
  "iron_battle_axe": 42,
  "iron_war_hammer": 55,
  "ironbound_shield": 45,
  "iron_helmet": 34,
  "studded_armor": 44,
  "reinforced_boots": 18,
  "emerald_ring": 18,
  "ember_amulet": 20,
  "mana_tonic": 5,
  "iron_dagger": 12,
  "rusty_mace": 8,
  "hunting_spear": 9,
  "woodsman_hatchet": 9,
  "oak_staff": 8,
  "traveler_cloak": 7,
  "chain_coif": 14,
  "leather_jerkin": 26,
  "stitched_leggings": 21,
  "round_kite_shield": 16,
  "bronze_ring": 4,
  "bone_amulet": 6,
  "health_tonic": 5,
  "antidote_vial": 4,
  "bandage_roll": 3,
  "dried_rations": 2,
  "tin_ore": 3,
  "copper_ingot": 5,
  "tin_ingot": 6,
  "iron_ingot": 9,
  "beast_claw": 4,
  "spider_silk": 4,
  "mandrake_root": 5,
  "wolf_pelt": 6,
  "lantern_oil": 2,
  "raw_hide": 4,
  "duelist_blade": 15,
  "parrying_dagger": 8,
  "corsair_cutlass": 21,
  "stiletto": 5,
  "raider_hatchet": 18,
  "hook_sabre": 20,
  "fishing_rod": 8,
  "miner_pickhammer": 12,
  "smith_tongs": 5,
  "skinning_knife": 5,
  "grappling_hook": 8,
  "hooded_lantern": 7,
  "rope_coil": 5,
  "repair_kit": 6,
  "whetstone": 2,
  "rat_tail": 1,
  "rat_pelt": 2,
  "mire_gland": 3,
  "mire_spore_cluster": 2,
  "skulker_venom_sac": 7,
  "skulker_scale": 3,
  "reed_sinew": 3,
  "stalker_claw": 7,
  "fen_brute_hide": 8,
  "fen_brute_bone": 7,
  "crypt_bone_shard": 5,
  "grave_dust": 4,
  "acolyte_focus_shard": 9,
  "warden_core": 30,
  "warden_plate_fragment": 16,
  "mire_recovery_tonic": 7,
  "purifying_tonic": 9,
  "fen_marrow_stew": 8,
  "graveward_tonic": 12,
  "focus_draught": 14,
  "warden_glow_charm": 42,
  "rat_pelt_cap": 9,
  "mireweave_cloak": 18,
  "skulker_scale_vest": 36,
  "fenhide_leggings": 30,
  "fenhide_boots": 24,
  "cryptbone_buckler": 40,
  "warden_plate_helmet": 95,
  "warden_plate_armor": 200,
  "warden_plate_shield": 150,
  "stalker_claw_blade": 38,
  "fenbone_maul": 52,
  "reed_sinew_bow": 48,
  "acolyte_focus_amulet": 45,
  "warden_core_hammer": 110
};

function npcSellUnitPrice(
  npc: { offers: { itemDefinitionId: string; quantity: number; price: number }[] },
  definition: ItemDefinition | undefined,
) {
  if (!definition) return 0;
  const explicit = NPC_VENDOR_SELL_PRICES[definition.id] ?? 0;
  if (explicit > 0) return explicit;
  const offer = npc.offers.find(
    (entry) =>
      entry.itemDefinitionId === definition.id
      && entry.quantity === 1
      && entry.price >= 3,
  );
  return offer ? Math.max(1, Math.floor(offer.price * 0.4)) : 0;
}

function NpcShop({ npcId }: { npcId: string }) {
  const npc = world.npcs.get(npcId);
  const [buyQuantities, setBuyQuantities] = useState<Record<string, number>>({});
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<ShopCategory>("all");
  const [shopMode, setShopMode] = useState<"buy" | "sell">("buy");
  if (!npc) return null;
  const sellableItems = world.inventory.filter((item) =>
    !item.equippedSlot
    && item.definitionId !== "gold_coin"
    && !world.inventory.some((child) => child.containerId === item.instanceId)
    && npcSellUnitPrice(npc, world.itemDefinitions.get(item.definitionId)) > 0,
  );
  const categories = ["all", ...SHOP_CATEGORIES.filter((entry) => (shopMode === "buy"
    ? npc.offers.some((offer) => shopCategory(world.itemDefinitions.get(offer.itemDefinitionId)) === entry)
    : sellableItems.some((item) => shopCategory(world.itemDefinitions.get(item.definitionId)) === entry)))] as ShopCategory[];
  const visibleOffers = npc.offers.filter((offer) => category === "all" || shopCategory(world.itemDefinitions.get(offer.itemDefinitionId)) === category);
  const visibleSellableItems = sellableItems.filter((item) => category === "all" || shopCategory(world.itemDefinitions.get(item.definitionId)) === category);
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
        <div className="shop-browser">
          <nav className="shop-mode" aria-label="Shop action">
            <button className={shopMode === "buy" ? "selected" : ""} onClick={() => { setShopMode("buy"); setCategory("all"); }}>Buy</button>
            <button className={shopMode === "sell" ? "selected" : ""} onClick={() => { setShopMode("sell"); setCategory("all"); }}>Sell</button>
          </nav>
          <nav className="shop-categories" aria-label="Shop categories">
            {categories.map((entry) => (
              <button key={entry} className={category === entry ? "selected" : ""} onClick={() => setCategory(entry)}>
                {SHOP_CATEGORY_LABELS[entry]}
                <b>{entry === "all" ? (shopMode === "buy" ? npc.offers.length : sellableItems.length) : (shopMode === "buy" ? npc.offers.filter((offer) => shopCategory(world.itemDefinitions.get(offer.itemDefinitionId)) === entry).length : sellableItems.filter((item) => shopCategory(world.itemDefinitions.get(item.definitionId)) === entry).length)}</b>
              </button>
            ))}
          </nav>
          <div className="shop-offers">
          {shopMode === "buy" && visibleOffers.map((offer) => {
            const item = world.itemDefinitions.get(offer.itemDefinitionId);
            const quantity = buyQuantities[offer.id] ?? 1;
            const totalPrice = offer.price * quantity;
            return (
              <article key={offer.id} data-item-definition-id={offer.itemDefinitionId}>
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
                    onChange={(event) => setBuyQuantities((current) => ({ ...current, [offer.id]: Math.max(1, Math.min(20, Number(event.target.value) || 1)) }))}
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
          {shopMode === "sell" && visibleSellableItems.map((item) => {
            const quantity = Math.min(sellQuantities[item.instanceId] ?? 1, item.quantity);
            const definition = world.itemDefinitions.get(item.definitionId);
            const sellPrice = npcSellUnitPrice(npc, definition);
            const totalPrice = sellPrice * quantity;
            return <article key={item.instanceId} data-item-definition-id={item.definitionId} data-item-instance-id={item.instanceId}>
              <ItemIcon definitionId={item.definitionId} />
              <span><strong>{definition?.name ?? item.definitionId}</strong><small>{item.quantity} available · {sellPrice} gold each</small></span>
              <b>{totalPrice} gold</b>
              <div><input aria-label="Items to sell" type="number" min={1} max={Math.min(20, item.quantity)} value={Math.min(quantity, item.quantity)} onChange={(event) => setSellQuantities((current) => ({ ...current, [item.instanceId]: Math.max(1, Math.min(20, item.quantity, Number(event.target.value) || 1)) }))} /><button onClick={() => network.sellToNpc(npc.id, item.instanceId, Math.min(quantity, item.quantity))}>Sell for {totalPrice}</button></div>
            </article>;
          })}
          {((shopMode === "buy" && visibleOffers.length === 0) || (shopMode === "sell" && visibleSellableItems.length === 0)) && <p className="shop-empty">No items in this category.</p>}
          </div>
        </div>
      </div>
    </GameModal>
  );
}

type ShopCategory = "all" | "weapons" | "armor" | "consumables" | "tools" | "materials" | "other";
const SHOP_CATEGORIES: ShopCategory[] = ["weapons", "armor", "consumables", "tools", "materials", "other"];
const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  all: "All",
  weapons: "Weapons",
  armor: "Armor",
  consumables: "Consumables",
  tools: "Tools",
  materials: "Materials",
  other: "Other",
};

function shopCategory(item: ReturnType<WorldState["itemDefinitions"]["get"]>): ShopCategory {
  if (!item) return "other";
  if (item.equipmentSlot === "weapon") return "weapons";
  if (["helmet", "chest", "back", "legs", "shoes", "amulet", "ring", "ring1", "ring2", "shield", "offhand", "backpack"].includes(item.equipmentSlot ?? "")) return "armor";
  if (item.foodEffect || item.charges || item.id.includes("potion") || item.id.includes("tonic")) return "consumables";
  if (item.equipmentSlot?.endsWith("_tool") || ["mining_tool", "fishing_tool", "woodcutting_tool"].includes(item.equipmentSlot ?? "")) return "tools";
  if (item.id.includes("ore") || item.id.includes("fiber") || item.id.includes("hide") || item.id.includes("coal") || item.id.includes("herb")) return "materials";
  return "other";
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
  const [withdrawQuantities, setWithdrawQuantities] = useState<Record<string, number>>({});
  if (!npc) return null;

  const matches = (item: ItemInstance) =>
    (world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId)
      .toLowerCase()
      .includes(search.trim().toLowerCase());

  // Gold is purse currency: weightless and intentionally absent from storage.
  const inventory = world.inventory.filter(
    (item) =>
      item.definitionId !== "gold_coin"
      && !item.containerId
      && !item.equippedSlot
      && matches(item),
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
    const canChooseQuantity =
      action === "withdraw"
      && Boolean(definition?.stackable)
      && item.quantity > 1;
    const requestedQuantity = Math.max(
      1,
      Math.min(
        item.quantity,
        withdrawQuantities[item.instanceId] ?? item.quantity,
      ),
    );

    return (
      <article key={item.instanceId}>
        <ItemIcon definitionId={item.definitionId} />
        <span>
          <strong>{definition?.name ?? item.definitionId}</strong>
          <small>
            {item.quantity > 1 ? "×" + item.quantity + " · " : ""}
            {((definition?.weight ?? 0) * item.quantity).toFixed(1)} oz
            {contained ? " · " + contained + " contained items" : ""}
          </small>
        </span>
        <div className="depot-row-actions">
          {canChooseQuantity && (
            <label>
              <small>Qty</small>
              <input
                type="number"
                min={1}
                max={item.quantity}
                value={requestedQuantity}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  const next = Number.isFinite(parsed)
                    ? Math.max(1, Math.min(item.quantity, parsed))
                    : 1;
                  setWithdrawQuantities((current) => ({
                    ...current,
                    [item.instanceId]: next,
                  }));
                }}
              />
            </label>
          )}
          <button
            onClick={() =>
              action === "deposit"
                ? network.depositItem(npc.id, item.instanceId)
                : network.withdrawItem(npc.id, item.instanceId, requestedQuantity)
            }
          >
            {action === "deposit" ? "Store" : "Withdraw"}
          </button>
        </div>
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
  { id: "fishing_tool", label: "Fishing rod", glyph: "🎣" },
  { id: "smithing_tool", label: "Smithing tool", glyph: "⚒" },
  { id: "leatherworking_tool", label: "Leatherworking tool", glyph: "✂" },
];

function CompactCharacterPanel() {
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!player) return null;
  return (
    <div className="compact-character-panel">
      <div className="compact-character-main">
        <header className="character-identity">
          <div className="character-portrait">{player.name.slice(0, 1)}</div>
          <span><small>Level {player.level}</small><h3>{player.name}</h3><b>Drag equipment between windows</b></span>
        </header>
        <EquipmentPaperdoll interactive />
        <OutfitPicker outfit={player.outfit} />
      </div>
    </div>
  );
}

function SkillPanel() {
  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!player) return null;
  return <div className="standalone-skills-panel">
    <p className="drag-hint">Drag a learned ability to action bar slots 1–8. Drag it out of the bar or right-click to remove it.</p>
    <ActionSkillList />
    <SkillRow name="Melee Skill" level={player.swordSkill} tries={player.swordTries} description="Advances through successful hits with any melee weapon." />
    <SkillRow name="Distance Skill" level={player.distanceSkill} tries={player.distanceTries} description="Advances when ammunition hits a creature." />
    <SkillRow name="Fletching Skill" level={player.fletchingSkill} tries={player.fletchingTries} description="Advances by producing physical ammunition." />
    <SkillRow name="Magic Level" level={player.magicLevel} tries={player.magicTries} description="Advances through sigil crafting and magic use." />
    <SecondarySkillsPicker selected={player.secondarySkills} />
    {player.secondarySkills.map((id) => {
      const skill = world.professionSkills.get(id);
      const definition = secondarySkillOptions.find((entry) => entry.id === id);
      return <SkillRow key={id} name={definition?.name ?? id} level={skill?.level ?? 0} tries={skill?.tries ?? 0} description={definition?.description ?? "Profession skill."} />;
    })}
  </div>;
}

type ActionSkill = { id: string; name: string; glyph: string; description: string };
const actionSkillDefinitions: ActionSkill[] = [
  { id: "basic_attack", name: "Attack", glyph: "AT", description: "Start attacking the selected target with your equipped weapon." },
  { id: "second_wind", name: "Second Wind", glyph: "SW", description: "Recover 20% of maximum health · 45s cooldown." },
  { id: "shield_guard", name: "Shield Guard", glyph: "SG", description: "Reduce incoming damage by 35% for 4s · requires a defensive off-hand · 12s cooldown." },
];
const fixedActionDefinitions: ActionSkill[] = [
  { id: "ember_sigil", name: "Ember Sigil", glyph: "ES", description: "Deal fire damage to the selected target" },
];

function spellGlyph(name: string) {
  const glyph = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return glyph || "✦";
}

function learnedSpellActionDefinition(id: string): ActionSkill | undefined {
  if (!world.learnedSpellIds.has(id)) return undefined;
  const spell = world.spells.get(id);
  if (!spell) return undefined;
  return {
    id: spell.id,
    name: spell.name,
    glyph: spellGlyph(spell.name),
    description: `${spell.description} · ${spell.manaCost} mana · range ${spell.range} · ${(spell.cooldownMs / 1000).toFixed(1)}s cooldown`,
  };
}

function hasDefensiveOffhand() {
  return world.inventory.some((item) => {
    if (item.equippedSlot !== "offhand") return false;
    return (world.itemDefinitions.get(item.definitionId)?.defense ?? 0) > 0;
  });
}

function actionSkillAvailable(id: string, player?: PlayerView | null) {
  if (id === "basic_attack") return Boolean(world.attackTargetId);
  if (id === "second_wind") return Boolean(player && player.health < player.maxHealth);
  if (id === "shield_guard") return hasDefensiveOffhand();
  return true;
}

function availableActionDefinitions() {
  const actions: ActionSkill[] = [];
  if (world.inventory.some((item) => item.definitionId === "ember_rune")) {
    actions.push(...fixedActionDefinitions);
  }
  for (const spellId of world.learnedSpellIds) {
    const action = learnedSpellActionDefinition(spellId);
    if (action) actions.push(action);
  }
  actions.push(...actionSkillDefinitions);
  return actions;
}
let actionSkillDragHandlers: { assign: (slot: number, skillId: string) => void; clear: (slot: number) => void } | null = null;
let suppressActionSkillClickUntil = 0;

function beginSkillPointerDrag(event: PointerEvent<HTMLElement>, skillId: string, sourceSlot?: number) {
  if (event.button !== 0) return;
  event.preventDefault();
  const source = event.currentTarget;
  const skill = actionBarDefinition(skillId);
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let dropTarget: HTMLElement | null = null;

  const setDropTarget = (next: HTMLElement | null) => {
    if (dropTarget === next) return;
    dropTarget?.classList.remove("skill-drop-target");
    dropTarget = next;
    dropTarget?.classList.add("skill-drop-target");
  };
  const move = (pointer: globalThis.PointerEvent) => {
    if (!dragging && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 5) return;
    if (!dragging) {
      dragging = true;
      source.classList.add("skill-dragging");
      ghost = document.createElement("div");
      ghost.className = "skill-drag-ghost";
      const glyph = document.createElement("i");
      glyph.textContent = skill?.glyph ?? "?";
      const label = document.createElement("span");
      label.textContent = skill?.name ?? skillId;
      ghost.append(glyph, label);
      document.body.append(ghost);
    }
    ghost?.style.setProperty("transform", `translate3d(${pointer.clientX + 14}px, ${pointer.clientY + 14}px, 0)`);
    const candidate = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>("[data-action-slot]") ?? null;
    const slot = Number(candidate?.dataset.actionSlot);
    setDropTarget(candidate && Number.isInteger(slot) && slot >= 1 && slot <= 8 ? candidate : null);
  };
  const cleanup = () => {
    source.classList.remove("skill-dragging");
    setDropTarget(null);
    ghost?.remove();
    ghost = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
  };
  const finish = (release: globalThis.PointerEvent) => {
    const target = document.elementFromPoint(release.clientX, release.clientY)?.closest<HTMLElement>("[data-action-slot]");
    const slot = Number(target?.dataset.actionSlot);
    if (dragging) {
      suppressActionSkillClickUntil = Date.now() + 250;
      if (target && Number.isInteger(slot) && slot >= 1 && slot <= 8) {
        actionSkillDragHandlers?.assign(slot, skillId);
        if (sourceSlot !== undefined && sourceSlot !== slot) actionSkillDragHandlers?.clear(sourceSlot);
      } else if (sourceSlot !== undefined) {
        actionSkillDragHandlers?.clear(sourceSlot);
      }
    }
    cleanup();
  };
  const cancel = () => {
    cleanup();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
}

function actionSkillDefinition(id: string, _player?: PlayerView | null) {
  return actionSkillDefinitions.find((skill) => skill.id === id);
}

function actionBarDefinition(id: string) {
  return fixedActionDefinitions.find((action) => action.id === id)
    ?? learnedSpellActionDefinition(id)
    ?? actionSkillDefinition(id);
}

function ActionSkillList() {
  const actions = availableActionDefinitions();
  return <section className="action-skill-list">
    <header><small>Abilities</small><span>Only learned/usable actions can be placed on slots 1–8</span></header>
    {actions.length > 0 ? (
      <div>{actions.map((action) => <div
        key={action.id}
        className="action-skill-source"
        draggable={false}
        title={action.description}
        onPointerDown={(event) => beginSkillPointerDrag(event, action.id)}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-aldoria-skill", action.id); event.dataTransfer.setData("text/plain", action.id); event.dataTransfer.effectAllowed = "copy"; }}
      >
        <i>{action.glyph}</i><span><strong>{action.name}</strong><small>{action.description}</small></span>
        <b>{world.spells.get(action.id)?.manaCost ?? "item"}</b>
      </div>)}</div>
    ) : (
      <p className="action-skill-empty">You have not learned any action-bar abilities yet.</p>
    )}
  </section>;
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

type SecondarySkillCategory = "gathering" | "crafting";
const secondarySkillOptions: {
  id: SecondarySkill;
  name: string;
  description: string;
  category: SecondarySkillCategory;
}[] = [
  { id: "mining", name: "Mining", description: "Ore, stone and rare minerals", category: "gathering" },
  { id: "woodcutting", name: "Woodcutting", description: "Timber and uncommon woods", category: "gathering" },
  { id: "fishing", name: "Fishing", description: "Fish and aquatic resources", category: "gathering" },
  { id: "alchemy", name: "Alchemy", description: "Potions, extracts and reagents", category: "crafting" },
  { id: "cooking", name: "Cooking", description: "Meals with restorative effects", category: "crafting" },
  { id: "smithing", name: "Smithing", description: "Weapons, armor and metalwork", category: "crafting" },
  { id: "leatherworking", name: "Leatherworking", description: "Hide, scale and flexible armor", category: "crafting" },
];

function SecondarySkillsPicker({ selected }: { selected: SecondarySkill[] }) {
  const [pending, setPending] = useState<SecondarySkill[]>(selected);
  useEffect(() => setPending(selected), [selected.join("|")]);

  const categoryOf = (skill: SecondarySkill) =>
    secondarySkillOptions.find((option) => option.id === skill)?.category;

  const categoryCount = (category: SecondarySkillCategory) =>
    pending.filter((skill) => categoryOf(skill) === category).length;

  const toggle = (skill: SecondarySkill) => {
    if (pending.includes(skill)) {
      const next = pending.filter((entry) => entry !== skill);
      setPending(next);
      network.setSecondarySkills(next);
      return;
    }

    const category = categoryOf(skill);
    if (!category) return;
    if (categoryCount(category) >= 2) {
      world.addSystemMessage(
        category === "gathering"
          ? "You can choose at most two gathering skills."
          : "You can choose at most two crafting skills.",
      );
      return;
    }

    const next = [...pending, skill];
    setPending(next);
    network.setSecondarySkills(next);
  };

  const renderSkill = (skill: (typeof secondarySkillOptions)[number]) => {
    const active = pending.includes(skill.id);
    const unavailable = !active && categoryCount(skill.category) >= 2;
    const progress = world.professionSkills.get(skill.id);
    const level = progress?.level ?? 0;
    const tries = progress?.tries ?? 0;
    const required = 5 + level * 2;
    const percent = Math.min(100, tries / required * 100);

    return (
      <button
        key={skill.id}
        className={active ? "selected" : ""}
        aria-pressed={active}
        disabled={unavailable}
        title={skill.description}
        onClick={() => toggle(skill.id)}
      >
        <span>{skill.name}</span>
        <small>
          {active
            ? "Level " + level + " · " + Math.max(0, required - tries) + " left"
            : unavailable
              ? "Two " + skill.category + " skills selected"
              : skill.description}
        </small>
        {active && (
          <i
            className="secondary-skill-meter"
            aria-label={tries + " of " + required + " uses"}
          >
            <em style={{ width: percent + "%" }} />
          </i>
        )}
      </button>
    );
  };

  const gatheringCount = categoryCount("gathering");
  const craftingCount = categoryCount("crafting");

  return (
    <section className="secondary-skills-picker" aria-label="Secondary skills">
      <header>
        <span>
          <small>Secondary skills</small>
          <strong>Choose up to two gathering and two crafting skills</strong>
        </span>
        <b>G {gatheringCount}/2 · C {craftingCount}/2</b>
      </header>

      <section className="secondary-skill-group">
        <h4>Gathering <small>{gatheringCount} / 2</small></h4>
        <div>
          {secondarySkillOptions
            .filter((skill) => skill.category === "gathering")
            .map(renderSkill)}
        </div>
      </section>

      <section className="secondary-skill-group">
        <h4>Crafting <small>{craftingCount} / 2</small></h4>
        <div>
          {secondarySkillOptions
            .filter((skill) => skill.category === "crafting")
            .map(renderSkill)}
        </div>
      </section>
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
            <div className="character-model-preview character-paperdoll-silhouette" aria-label={`${player.name} equipment silhouette`}>
        <svg viewBox="0 0 180 320" aria-hidden="true" focusable="false">
          <ellipse className="paperdoll-aura" cx="90" cy="296" rx="52" ry="13" />
          <path className="paperdoll-backplate" d="M45 101 Q90 74 135 101 L145 214 Q90 246 35 214 Z" />
          <circle className="paperdoll-part paperdoll-head" cx="90" cy="47" r="21" />
          <path className="paperdoll-part paperdoll-neck" d="M80 65 H100 L105 84 H75 Z" />
          <path className="paperdoll-part paperdoll-torso" d="M61 84 Q90 75 119 84 L130 174 Q90 188 50 174 Z" />
          <path className="paperdoll-part paperdoll-arm paperdoll-arm-left" d="M60 91 Q43 94 34 112 L21 190 Q26 198 35 194 L52 131 Z" />
          <path className="paperdoll-part paperdoll-arm paperdoll-arm-right" d="M120 91 Q137 94 146 112 L159 190 Q154 198 145 194 L128 131 Z" />
          <circle className="paperdoll-part paperdoll-hand paperdoll-hand-left" cx="27" cy="202" r="10" />
          <circle className="paperdoll-part paperdoll-hand paperdoll-hand-right" cx="153" cy="202" r="10" />
          <path className="paperdoll-part paperdoll-leg paperdoll-leg-left" d="M55 169 Q72 176 88 174 L84 276 H55 L48 208 Z" />
          <path className="paperdoll-part paperdoll-leg paperdoll-leg-right" d="M92 174 Q108 176 125 169 L132 208 L125 276 H96 Z" />
          <path className="paperdoll-part paperdoll-foot paperdoll-foot-left" d="M53 273 H84 L82 294 H43 Q40 284 53 273 Z" />
          <path className="paperdoll-part paperdoll-foot paperdoll-foot-right" d="M96 273 H127 Q140 284 137 294 H98 Z" />
          <path className="paperdoll-detail" d="M72 108 H108 M69 132 H111 M66 156 H114" />
          <path className="paperdoll-detail paperdoll-amulet-mark" d="M90 82 V109 M83 104 L90 112 L97 104" />
          <circle className="paperdoll-anchor paperdoll-anchor-head" cx="90" cy="23" r="2.5" />
          <circle className="paperdoll-anchor paperdoll-anchor-chest" cx="90" cy="126" r="2.5" />
          <circle className="paperdoll-anchor paperdoll-anchor-left" cx="26" cy="154" r="2.5" />
          <circle className="paperdoll-anchor paperdoll-anchor-right" cx="154" cy="154" r="2.5" />
          <circle className="paperdoll-anchor paperdoll-anchor-legs" cx="90" cy="229" r="2.5" />
        </svg>
        <span className="paperdoll-caption"><b>{player.name}</b><small>{player.outfit}</small></span>
      </div>
      {equipmentLayout.map(({ id, label, aliases }) => {
        const item = equipped.find((entry) => entry.equippedSlot && aliases.includes(entry.equippedSlot));
        const itemName = item ? world.itemDefinitions.get(item.definitionId)?.name ?? item.definitionId : label;
        return (
          <div
            className={`equipment-slot slot-${id} ${item ? "filled" : ""}`}
            data-inventory-drop="equipment"
            data-equipment-slot={id === "left-hand" ? "offhand" : id === "right-hand" ? "weapon" : aliases[0]}
            data-item-definition-id={item?.definitionId}
            data-item-instance-id={item?.instanceId}
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
          return <button type="button" className={`profession-tool-slot ${item ? "filled" : ""}`} data-inventory-drop="equipment" data-equipment-slot={id} data-item-definition-id={item?.definitionId} data-item-instance-id={item?.instanceId} key={id} title={itemName}
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
  if (!destination) {
    if (!target?.closest(".game-modal")) network.drop(itemId);
    return;
  }
  if (destination === "root") network.moveToRoot(itemId);
  else if (destination === "ground") network.drop(itemId);
  else if (destination === "container") {
    const containerId = target?.dataset.containerId;
    if (containerId && containerId !== itemId) network.moveToContainer(itemId, containerId);
  }
  else if (destination === "equipment") {
    const item = world.inventory.find((entry) => entry.instanceId === itemId);
    const defaultSlot = item ? world.itemDefinitions.get(item.definitionId)?.equipmentSlot : undefined;
    const slot = target?.dataset.equipmentSlot ?? defaultSlot;
    if (slot) network.equip(itemId, slot);
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
    ["Shielding", player.shieldingSkill],
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
        <SkillRow
          name="Shielding"
          level={player.shieldingSkill}
          tries={player.shieldingTries}
          description="Advances when a defensive off-hand absorbs creature attacks. Higher Shielding improves mitigation."
        />
        <SecondarySkillsPicker selected={player.secondarySkills} />
        {player.secondarySkills.map((id) => {
          const skill = world.professionSkills.get(id);
          const definition = secondarySkillOptions.find((entry) => entry.id === id);
          return <SkillRow key={id} name={definition?.name ?? id} level={skill?.level ?? 0} tries={skill?.tries ?? 0} description={definition?.description ?? "Profession skill."} />;
        })}
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
  useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => {
      const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
      if (!player) return "none";
      const nearby = world.groundItems
        .filter((entry) =>
          entry.position.z === player.position.z
          && Math.abs(entry.position.x - player.position.x) <= 1
          && Math.abs(entry.position.y - player.position.y) <= 1
        )
        .map((entry) => [
          entry.item.instanceId,
          entry.item.quantity,
          entry.contents.length,
          entry.position.x,
          entry.position.y,
        ].join(":"))
        .join(";");
      return `${player.position.x}:${player.position.y}:${player.position.z}|${nearby}`;
    },
  );
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


function loadBattleListPosition() {
  try {
    const raw = localStorage.getItem("aldoria.battle-list-position");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (
      typeof parsed.x !== "number"
      || typeof parsed.y !== "number"
      || !Number.isFinite(parsed.x)
      || !Number.isFinite(parsed.y)
    ) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

function BattleList() {
  useSyncExternalStore(
    (listener) => {
      const stopWorld = world.subscribe(listener);
      const stopVisual = world.subscribeVisual(listener);
      return () => { stopWorld(); stopVisual(); };
    },
    () => `${world.revision}:${world.visualRevision}`,
  );
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [battlePosition, setBattlePosition] = useState<{ x: number; y: number } | null>(
    () => loadBattleListPosition(),
  );
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const resized = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  const local = world.localPlayerId ? world.players.get(world.localPlayerId) : null;
  if (!local) return null;

  // NativeWorldRenderer uses an orthographic camera at zoom 90. Match its
  // actual screen footprint instead of the old 18-tile simulation radius, so
  // Battle does not reveal actors before they enter the visible viewport.
  const visibleHalfX = viewport.width / (2 * 90) + 0.35;
  const visibleHalfY = viewport.height / (2 * 90 * 0.8944) + 0.35;
  const visibleOnScreen = (position: Position) =>
    position.z === local.position.z
    && Math.abs(position.x - local.position.x) <= visibleHalfX
    && Math.abs(position.y - local.position.y) <= visibleHalfY;

  const distance = (position: Position) =>
    Math.max(
      Math.abs(position.x - local.position.x),
      Math.abs(position.y - local.position.y),
    );

  const creatures = [...world.creatures.values()]
    .filter((entry) => visibleOnScreen(entry.position))
    .sort((left, right) => distance(left.position) - distance(right.position));

  const players = [...world.players.values()]
    .filter((entry) =>
      entry.id !== world.localPlayerId
      && visibleOnScreen(entry.position)
    )
    .sort((left, right) => distance(left.position) - distance(right.position));

  if (creatures.length === 0 && players.length === 0) return null;

  const percent = (health: number, maxHealth: number) =>
    Math.max(0, Math.min(100, health / Math.max(1, maxHealth) * 100));

  const nextDragPosition = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    return {
      x: Math.max(8, Math.min(event.clientX - drag.offsetX, window.innerWidth - drag.width - 8)),
      y: Math.max(8, Math.min(event.clientY - drag.offsetY, window.innerHeight - drag.height - 8)),
    };
  };

  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const windowElement = event.currentTarget.parentElement;
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const next = nextDragPosition(event);
    if (!next) return;
    setBattlePosition(next);
  };

  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const next = nextDragPosition(event);
    if (next) {
      setBattlePosition(next);
      localStorage.setItem("aldoria.battle-list-position", JSON.stringify(next));
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <section
      className={`battle-list ${battlePosition ? "battle-list-moved" : ""}`}
      aria-label="Battle list"
      style={battlePosition ? { left: battlePosition.x, top: battlePosition.y, right: "auto" } : undefined}
    >
      <header
        title="Drag to move Battle"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <strong>Battle</strong><small>{creatures.length + players.length}</small>
      </header>
      <div>
        {creatures.map((creature) => {
          const health = percent(creature.health, creature.maxHealth);
          const targeted = world.attackTargetId === creature.id;
          return (
            <button
              type="button"
              className={`battle-entry hostile ${targeted ? "targeted" : ""}`}
              key={creature.id}
              onClick={() => input.targetCreature(creature.id)}
            >
              <span><strong>{creature.name}</strong><small>{creature.immune ? "Evading" : "Creature"}</small></span>
              <i className="battle-health"><em style={{ width: `${health}%` }} /></i>
              <b>{Math.ceil(health)}%</b>
            </button>
          );
        })}
        {players.map((player) => {
          const health = percent(player.health, player.maxHealth);
          const selected = world.selectedPlayerId === player.id;
          return (
            <button
              type="button"
              className={`battle-entry player ${selected ? "selected" : ""}`}
              key={player.id}
              onClick={() => {
                world.selectedPlayerId = player.id;
                world.closePlayerContext();
                world.notify();
              }}
            >
              <span><strong>{player.name}</strong><small>Player · Lv {player.level}</small></span>
              <i className="battle-health"><em style={{ width: `${health}%` }} /></i>
              <b>{Math.ceil(health)}%</b>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Chat() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("aldoria-focus-chat", focus);
    return () => window.removeEventListener("aldoria-focus-chat", focus);
  }, []);
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
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
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
      const defaultSlot = item ? world.itemDefinitions.get(item.definitionId)?.equipmentSlot : undefined;
      const slot = target?.dataset.equipmentSlot ?? defaultSlot;
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
      data-item-definition-id={item.definitionId}
      data-item-instance-id={item.instanceId}
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
      onContextMenu={(event) => {
        if (definition?.foodEffect) {
          event.preventDefault();
          event.stopPropagation();
          network.eat(item.instanceId);
          return;
        }
        onOpenContextMenu(event, item.instanceId);
      }}
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


function chargedStackUses(item: ItemInstance, definition?: ItemDefinition) {
  const current = item.charges ?? definition?.charges ?? 0;
  if (current <= 0) return 0;
  const full = definition?.charges ?? current;
  return current + Math.max(0, item.quantity - 1) * full;
}

function itemDetailSummary(
  definition: ItemDefinition | undefined,
  item: ItemInstance,
  containedItems = 0,
) {
  if (!definition) return `${item.quantity} item${item.quantity === 1 ? "" : "s"}`;
  const details: string[] = [
    `${(definition.weight * item.quantity).toFixed(1)} oz`,
  ];
  if (definition.attack !== undefined) details.push(`Attack ${definition.attack}`);
  if (definition.defense !== undefined) details.push(`Defense ${definition.defense}`);
  if (definition.combatEffect) {
    details.push(`Damage ${definition.combatEffect.damage}`);
    details.push(`Range ${definition.combatEffect.range}`);
    details.push(`${(definition.combatEffect.cooldownMs / 1000).toFixed(2)}s cooldown`);
  }
  if (definition.distanceWeapon) {
    details.push(`Damage +${definition.distanceWeapon.damage}`);
    details.push(`Range ${definition.distanceWeapon.range}`);
    const ammo = world.itemDefinitions.get(definition.distanceWeapon.ammunitionId);
    details.push(`Ammo: ${ammo?.name ?? definition.distanceWeapon.ammunitionId}`);
  }
  if (definition.foodEffect) {
    if (definition.foodEffect.healthPerTick) details.push(`HP regen +${definition.foodEffect.healthPerTick}/tick`);
    if (definition.foodEffect.manaPerTick) details.push(`Mana regen +${definition.foodEffect.manaPerTick}/tick`);
    details.push(`Nourishment ${definition.foodEffect.durationSeconds}s`);
  }
  if (definition.charges !== undefined || item.charges !== undefined) {
    details.push(`${chargedStackUses(item, definition)} uses total`);
  }
  if (definition.containerSlots) details.push(`${containedItems}/${definition.containerSlots} slots`);
  if (definition.lightSource) details.push(`Light radius ${definition.lightSource.radius}`);
  return details.join(" · ");
}

type ItemTooltipTarget = {
  definitionId: string;
  instanceId?: string;
  x: number;
  y: number;
};

function itemTooltipSlotLabel(slot: string | undefined) {
  if (!slot) return "Item";
  return slot
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// TIBIAGAME_V35_7_CLEAN_ITEM_TOOLTIPS
// TIBIAGAME_V35_10_SHIELDING_UI_ECONOMY
function ItemHoverTooltip() {
  const [target, setTarget] = useState<ItemTooltipTarget | null>(null);
  const tooltipRef = useRef<HTMLElement>(null);
  const activeKeyRef = useRef("");

  useEffect(() => {
    const tooltipPosition = (event: globalThis.PointerEvent) => {
      const width = 292;
      const x = Math.max(8, Math.min(event.clientX + 18, window.innerWidth - width - 8));
      const y = event.clientY > window.innerHeight * 0.62
        ? Math.max(8, event.clientY - 250)
        : Math.min(window.innerHeight - 80, event.clientY + 18);
      return { x, y };
    };

    const hide = () => {
      if (!activeKeyRef.current) return;
      activeKeyRef.current = "";
      setTarget(null);
    };

    const move = (event: globalThis.PointerEvent) => {
      const source = event.target instanceof Element ? event.target : null;
      const instanceNode = source?.closest<HTMLElement>("[data-item-instance-id]") ?? null;
      const definitionNode = instanceNode
        ?? source?.closest<HTMLElement>("[data-item-definition-id]")
        ?? null;
      const definitionId = definitionNode?.dataset.itemDefinitionId;
      if (!definitionId) {
        hide();
        return;
      }

      const instanceId = instanceNode?.dataset.itemInstanceId;
      const key = `${definitionId}:${instanceId ?? ""}`;
      const point = tooltipPosition(event);
      if (activeKeyRef.current !== key) {
        activeKeyRef.current = key;
        setTarget({ definitionId, instanceId, ...point });
      } else if (tooltipRef.current) {
        tooltipRef.current.style.transform =
          `translate3d(${point.x}px, ${point.y}px, 0)`;
      }
    };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!target) return null;
  const definition = world.itemDefinitions.get(target.definitionId);
  if (!definition) return null;
  const item = target.instanceId
    ? world.inventory.find((entry) => entry.instanceId === target.instanceId)
      ?? world.depot.find((entry) => entry.instanceId === target.instanceId)
    : undefined;
  const quantity = item?.quantity ?? 1;
  const rows: Array<[string, string, string?]> = [];

  if ((definition.attack ?? 0) > 0) rows.push(["Attack", String(definition.attack), "positive"]);
  if ((definition.defense ?? 0) > 0) rows.push(["Defense", String(definition.defense), "positive"]);
  if (definition.combatEffect) {
    if ((definition.combatEffect.damage ?? 0) > 0) {
      rows.push(["Damage", String(definition.combatEffect.damage), "damage"]);
    }
    if ((definition.combatEffect.range ?? 0) > 0) {
      rows.push(["Range", String(definition.combatEffect.range)]);
    }
    if ((definition.combatEffect.cooldownMs ?? 0) > 0) {
      rows.push(["Cooldown", `${(definition.combatEffect.cooldownMs / 1000).toFixed(2)} sec`]);
    }
  }
  if (definition.distanceWeapon) {
    if ((definition.distanceWeapon.damage ?? 0) > 0) {
      rows.push(["Damage", `+${definition.distanceWeapon.damage}`, "damage"]);
    }
    if ((definition.distanceWeapon.range ?? 0) > 0) {
      rows.push(["Range", String(definition.distanceWeapon.range)]);
    }
    if ((definition.distanceWeapon.cooldownMs ?? 0) > 0) {
      rows.push(["Attack speed", `${(definition.distanceWeapon.cooldownMs / 1000).toFixed(2)} sec`]);
    }
    if (definition.distanceWeapon.ammunitionId) {
      const ammunition = world.itemDefinitions.get(definition.distanceWeapon.ammunitionId);
      rows.push(["Ammunition", ammunition?.name ?? definition.distanceWeapon.ammunitionId]);
    }
  }
  if (definition.foodEffect) {
    if (definition.foodEffect.healthPerTick) {
      rows.push(["Health regen", `+${definition.foodEffect.healthPerTick} / tick`, "positive"]);
    }
    if (definition.foodEffect.manaPerTick) {
      rows.push(["Mana regen", `+${definition.foodEffect.manaPerTick} / tick`, "mana"]);
    }
    if ((definition.foodEffect.durationSeconds ?? 0) > 0) {
      if ((definition.foodEffect.durationSeconds ?? 0) > 0) {
      rows.push(["Nourishment", `${definition.foodEffect.durationSeconds} sec`]);
    }
    }
  }
  if ((definition.charges ?? 0) > 0 || (item?.charges ?? 0) > 0) {
    const tooltipItem: ItemInstance = item ?? {
      instanceId: "tooltip",
      definitionId: definition.id,
      quantity: 1,
      charges: definition.charges,
    };
    const uses = chargedStackUses(tooltipItem, definition);
    if (uses > 0) rows.push(["Uses", String(uses)]);
  }
  if ((definition.containerSlots ?? 0) > 0) {
    const used = item
      ? world.inventory.filter((entry) => entry.containerId === item.instanceId).length
      : 0;
    rows.push(["Container", item ? `${used} / ${definition.containerSlots} slots` : `${definition.containerSlots} slots`]);
  }
  if ((definition.lightSource?.radius ?? 0) > 0) {
    rows.push(["Light radius", String(definition.lightSource!.radius)]);
  }
  if (definition.teachesRecipeId?.trim()) {
    rows.push(["Teaches recipe", definition.teachesRecipeId.replaceAll("_", " ")]);
  }
  if (definition.stackable && (definition.maxStack ?? 0) > 1) {
    rows.push(["Stack limit", String(definition.maxStack)]);
  }

  const hasWeight = Number.isFinite(definition.weight) && definition.weight > 0;
  const unitWeight = hasWeight ? definition.weight.toFixed(1) : "";
  const totalWeight = hasWeight ? (definition.weight * quantity).toFixed(1) : "";

  return (
    <aside
      ref={tooltipRef}
      className="item-hover-tooltip"
      style={{ transform: `translate3d(${target.x}px, ${target.y}px, 0)` }}
      aria-hidden="true"
    >
      <header>
        <ItemIcon definitionId={definition.id} />
        <span>
          <strong>{definition.name}</strong>
          <small>{itemTooltipSlotLabel(definition.equipmentSlot)}</small>
        </span>
      </header>
      {rows.length > 0 && (
        <dl>
          {rows.map(([label, value, tone], index) => (
            <div key={`${label}-${index}`} className={tone ? `tooltip-${tone}` : ""}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hasWeight && (
        <footer>
          <span>Weight</span>
          <b>{quantity > 1 ? `${unitWeight} oz each · ${totalWeight} oz total` : `${unitWeight} oz`}</b>
        </footer>
      )}
      {quantity > 1 && <small className="tooltip-stack">Stack ×{quantity}</small>}
    </aside>
  );
}

function InventoryDetails({ item, position, onClose, onSplit }: { item: ItemInstance; position: { x: number; y: number }; onClose: () => void; onSplit: () => void }) {
  const definition = world.itemDefinitions.get(item.definitionId);
  const children = world.inventory.filter((child) => child.containerId === item.instanceId);
  return <section className="inventory-item-details inventory-context-menu" style={{ left: position.x, top: position.y }} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) onClose(); }}>
    <ItemIcon definitionId={item.definitionId} />
    <span><small>{item.equippedSlot ? "Equipped" : item.containerId ? "Inside backpack" : "Inventory item"}</small><strong>{definition?.name ?? item.definitionId}</strong><p>{itemDetailSummary(definition, item, children.length)}</p></span>
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
        data-item-definition-id={item.definitionId}
        data-item-instance-id={item.instanceId}
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

function emptyActionSkills(): Record<number, string | null> {
  return { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null };
}

function loadActionSkills(characterId: string | null): Record<number, string | null> {
  const empty = emptyActionSkills();
  if (!characterId) return empty;
  try {
    const value = JSON.parse(
      localStorage.getItem(`aldoria.action-skills.${characterId}`) ?? "{}",
    );
    if (!value || typeof value !== "object") return empty;
    return {
      ...empty,
      ...Object.fromEntries(Object.entries(value).filter(([slot, action]) =>
        /^[1-8]$/.test(slot)
        && (
          action === null
          || (
            typeof action === "string"
            && Boolean(actionBarDefinition(action))
          )
        ),
      )),
    } as Record<number, string | null>;
  } catch {
    return empty;
  }
}

function loadStoredBoolean(key: string, fallback: boolean) {
  const value = localStorage.getItem(key);
  return value === "true" ? true : value === "false" ? false : fallback;
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
