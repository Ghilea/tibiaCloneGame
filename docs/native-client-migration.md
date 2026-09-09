# Native client migration


<!-- TIBIAGAME_V36_11_1_INTERACTION_VISIBILITY_HOTFIX -->

V36.11.1 fixes Bevy system registration visibility for the native interaction target indicator and HUD marker components. This is a compile-only hotfix; interaction behavior from V36.11 is unchanged.

Status: **V36.14 medieval facade consistency + creature texture warmup in progress**

The production desktop client is moving from React/Tauri/WebView2 world rendering to a native Rust + Bevy client. The current React/Tauri client remains available as a reference and fallback during the migration. The web-based world editor stays in React.

## Why

The current Three.js world renderer is not CPU-bound. Desktop traces repeatedly show roughly 2–5 ms of game/render work followed by 28–47 ms outside the renderer on missed frames. Browser `npm run dev` is smoother than embedded WebView2, and the issue survives WebView2 152, a no-vsync diagnostic run, and Fixed WebView2 149.

The native client must own the complete gameplay presentation chain:

input -> prediction/simulation -> interpolation -> animation -> wgpu -> DX12 present

No Chromium/WebView2 layer should sit between the game renderer and the desktop swapchain.

## Current checkpoint — V36.14

<!-- TIBIAGAME_V36_14_MEDIEVAL_FACADE_CREATURE_WARMUP -->

V36.14 keeps the V36.13 boundary fix but replaces the house facade rendering
with a consistent medieval half-timber treatment. House wall panels now use one
uniform plaster infill material with regular timber studs and beams, instead of
mixed-looking facade tiles that could appear visually different from segment to
segment. Gable fill uses the same plaster material so short ends match the long
walls.

Creature spawning remains actor-first, but the client now eagerly scans the
native asset root for creature textures at startup and retains strong Bevy image
handles. That starts IO/GPU upload before the player ever descends to the first
cellar floor. The streaming spawn budget is also raised so first-time floor
transitions consume fewer staged frames once the authoritative region arrives.

## Current checkpoint — V36.13

<!-- TIBIAGAME_V36_13_WORLD_BOUNDARY_FLOOR_PRELOAD -->

V36.13 fixes the coordinate convention used by native house rendering. Building
perimeter positions are logical inside tiles; collision blocks crossings at the
outer +/-0.5 tile edge. Native rendering previously placed every horizontal wall
on the north edge and every vertical wall on the west edge, so south/east walls,
doors and windows were one tile inward from collision. House walls/openings now
derive North/South/West/East from BuildingView and render on that exact boundary.

Door frames no longer mirror one support below ground/across the tile. Door and
window leaves rotate around explicit hinges, so opening them does not move the
visual center away from the wall opening. Building floors are expanded to the
inner wall faces, and stepped gable fill is generated to the full roof rise on
the short end walls.

On WorldRegion floor swaps, creatures/NPCs/resources are now the first SpawnSpecs,
before floor/terrain/building tiles. Creature assets are already retained by the
native CreatureSpriteCatalog from startup; prioritizing actor entity creation
prevents authoritative combat from running for many staged frames before the
first visible creature exists.

## Current checkpoint — V36.12

V36.12 corrects two visible regressions from the first native interaction and
architecture passes.

Interaction picking now compares the cursor against projected screen-space
positions instead of projecting the cursor ray down to the ground plane. This
matches what is actually visible with the elevated isometric camera. Creatures,
doors, resources, NPCs and world props use short vertical pick segments, and
doors/resources/NPCs/props can be activated with either mouse button. Creature
clicks select and send AttackRequest as before.

Building gables are now placed on the short end walls perpendicular to the roof
ridge instead of along the long eaves. Dual-axis wall tiles trim their shared
corner before an exact-size corner join is inserted, preventing the two full
wall cuboids from visibly passing through each other.

## Current checkpoint — V36.11

V36.11 turns the V36.10 gameplay mirror into an interactive native client.
Mouse cursor projection is handled directly in Bevy without WebView IPC. Left
click selects a creature and sends `AttackRequest`; right click performs the
first native context actions for creatures, resource nodes, doors, NPCs and
inspectable world objects.

The selected battle target now lives in `NativeGameState`, receives a pulsing
world-space highlight and a small target HUD. Resource and door actions perform
a local one-tile reach check before sending authoritative protocol messages.
The native message feed is visible on screen and consumes the V36.10 chat,
loot, experience, combat, discovery and error events.

NPC focus is retained in native state as the boundary for the upcoming dialogue,
shop and depot UI; no new duplicate gameplay protocol has been introduced.

## Current checkpoint — V36.10

V36.10 establishes the native gameplay-state boundary before the remaining UI
and interactions are ported. The Bevy client now mirrors authoritative server
messages into one persistent `NativeGameState` instead of letting unhandled
protocol events disappear.

The state includes players, inventory/depot, item definitions, learned spells
and recipes, profession skills, resources, ground items, creatures, NPCs,
crafting, trade, discoveries, food state, combat events and a bounded message
feed. Gold gains and creature-kill experience are written to that feed so the
future native chat panel has one canonical source.

Native client versioning is centralized in `version.rs`; patch scripts must not
rewrite already-versioned strings.

## Architecture

Existing shared Rust crates are the migration boundary:

- `game-types`: canonical gameplay data and identifiers.
- `game-protocol`: canonical client/server messages.
- `game-server`: authoritative server and persistence.
- `game-client`: new native Bevy client.
- `apps/client`: legacy/reference React client plus the web editor during migration.

Do not duplicate protocol or gameplay DTO definitions inside Bevy. Extend the shared Rust crates instead.

## Migration rules

1. The server remains authoritative.
2. Keep the classless character design.
3. Preserve the 35,000 x 35,000 sparse streamed world.
4. Preserve multi-floor positions and streamed region semantics.
5. Native movement interpolation and animation run locally every frame.
6. Network state changes are events/snapshots, never per-frame IPC.
7. Reuse existing GLB, texture, sprite and audio assets from `apps/client/public/assets`.
8. Do not remove the React/Tauri client until native parity is verified.
9. Keep the editor web-based unless there is a separate reason to port it.
10. Pin Bevy versions and upgrade intentionally because Bevy releases can contain breaking API changes.

## Milestones

### M0 — Native frame-pacing proof (V36.0)

- Bevy 0.19.1 workspace crate.
- Native wgpu renderer.
- DX12 forced on Windows.
- Orthographic 2.5D test scene.
- Tile movement and camera follow.
- Native frame-pacing diagnostics.
- V toggles `AutoVsync` / `AutoNoVsync`.
- Shared `game-types` and `game-protocol` linked.
- Existing asset root configured for reuse.

Acceptance target: hold movement for at least 30 seconds. Frame pacing should remain visually smooth and should not show the recurring embedded-WebView2 33.3 ms pattern.

### M1 — Native connection and character entry

- HTTP login/session flow.
- Character list/select/create.
- Native WebSocket connection.
- `Hello` / `Welcome` using `game-protocol`.
- Server connection status and reconnect handling.
- No duplicated JSON protocol structs.

### M2 — Authoritative streamed world

- Render `MapView`.
- Apply `WorldRegion`.
- Ground/terrain/roads/floors/water/bridges.
- Doors/windows/stairs/buildings.
- Stream prefetch and region replacement without visible stalls.
- Multi-floor loading before floor transitions.

### M3 — Actors and assets

- Load existing player GLBs.
- Idle/walk/attack animation graph.
- Player prediction/reconciliation.
- Other players/NPCs/creatures.
- Replace every placeholder enemy, including:
  - castle_rat
  - mireling
  - mire_skulker
  - reed_stalker
  - fen_brute
  - crypt_guard
  - bone_acolyte
  - cellar_warden

### M4 — World visuals

- Dynamic lights.
- Day/night atmosphere.
- Roof cutaway and indoor fade.
- Occlusion handling.
- Props/resources.
- Particles/projectiles/combat effects.
- Asset warmup and background streaming.

### M5 — Interaction/combat

- Targeting.
- Right-click/context interaction.
- NPC dialogue choices (no typed keyword chat).
- Gathering.
- Doors/windows/loot.
- Abilities/spells/runes.
- Trade.

### M6 — Native gameplay UI

Port only gameplay UI that needs to ship in the native client:

- status bars
- hotbar
- inventory/equipment
- battle list
- skills/professions
- NPC/shop/depot
- chat
- minimap/world map
- settings

The web editor remains separate.

### M7 — Production cutover

- Native updater/launcher strategy.
- Release packaging.
- GPU/device-loss handling.
- Crash logs.
- Performance budgets.
- Remove Tauri gameplay runtime only after parity.
- Keep a migration tag/branch for the old client.

## Commands

From repository root:

```powershell
npm run native:check
npm run native
npm run native:release
```

First Bevy compilation is expected to take considerably longer than later runs.

During V36.0:

- WASD / arrow keys: move.
- V: toggle native present mode.
- Watch console lines beginning with `ALDORIA NATIVE PERF`.

<!-- TIBIAGAME_V36_14_1_CREATURE_WARMUP_ESCAPE_HOTFIX -->

V36.14.1 fixes the Rust backslash character literal used when normalizing creature asset paths on Windows. No gameplay or rendering behavior is changed.

<!-- TIBIAGAME_V36_14_2_ARCHITECTURE_DELIMITER_HOTFIX -->

V36.14.2 removes a duplicated Rust function delimiter introduced by the V36.14 facade patch around ground_chunk_centers. No rendering/gameplay behavior changes.


<!-- TIBIAGAME_V36_15_1_OPENING_FACADE_RAT_GPU_PREWARM -->

V36.15.1 replaces the failed V36.15 precheck. Door/window infill now uses the
same plaster and timber material values as V36.14 house walls. Castle-rat atlas
handles were already requested by CreatureSpriteCatalog at startup; the client
now also creates permanent off-camera render probes for the rat's
idle/walk/attack/hit/death materials so GPU texture/material/pipeline preparation
happens before the first cellar visit. The live monsters/ directory is included
in the diagnostic asset scan as well.

<!-- TIBIAGAME_V36_15_2_WORLD_DETAILS_RESTORE -->

V36.15.2 restores spawn_torch and spawn_stair after the V36.15.1 door/window replacement accidentally removed the functions that were located between spawn_window and apply_door_change.


<!-- TIBIAGAME_V36_16_1_FLOOR_PRELOAD_GATE -->

V36.16.1 replaces the failed V36.16 precheck. The client now prevents a local
floor-transition MoveRequest from being sent until the Castle Rat atlas set and
placeholder image report loaded through Bevy AssetServer. V36.15.1's startup GPU
warmup probes remain in place, so both image loading and render preparation begin
before the transition. This prevents the server from placing the player on a
hostile destination floor while creature visuals are still unavailable.

Opening tiles also receive smaller timber subdivisions above doors and
above/below windows, while gables gain a timber tie beam and center post.

<!-- TIBIAGAME_V36_16_2_WALL_MATERIAL_SIGNATURE_HOTFIX -->

V36.16.2 corrects the wall-material parameter names after V36.16.1: spawn_building keeps wall_material because it forwards it to gable calls, while spawn_gable_fill marks its now-unused parameter as _wall_material.


<!-- TIBIAGAME_V36_17_ATOMIC_FLOOR_CACHE -->

V36.17 changes floor streaming from "construct after the player has already
changed z" to a hidden adjacent-floor cache. WorldRegion/Welcome payloads already
carry region_floor_radius; the native client now builds every supplied z layer,
keeps non-current layers hidden, and commits them as one generation. A floor
MoveRequest is withheld until the destination z is present in the committed
cache and creature images are loaded. The visual floor switch is therefore an
atomic Visibility change instead of a multi-frame rebuild.

This also keeps cached hidden entities out of manual mouse picking.

<!-- TIBIAGAME_V36_17_1_ATOMIC_FLOOR_COMPILE_HOTFIX -->

V36.17.1 fixes two compile issues in the atomic floor-cache patch: setup() now receives RegionStream in the scope where the initial Welcome cache is queued, and NPC screen picking destructures the Visibility-aware three-element Bevy query correctly.


<!-- TIBIAGAME_V36_18_AUTHORITATIVE_CREATURE_VISUAL_CACHE -->

V36.18 separates creature visual lifecycle from static RegionStream staging.
NativeGameState is already populated from the server's multi-floor
Welcome/WorldRegion creature payloads. A dedicated reconciliation system now
maintains one persistent render actor per authoritative creature, including
hidden actors on adjacent cached floors.

Floor transition readiness now checks three independent layers before sending
the z-changing MoveRequest: image assets, committed static destination floor,
and actual persistent CreatureActor entities for every living authoritative
creature on that destination floor. A short 300 ms settle window follows actor
completion so deferred Bevy entity/material extraction can finish before the
server is allowed to move the player.

RegionStream no longer creates or destroys CreatureActor visuals.


<!-- TIBIAGAME_V36_19_FLOOR_REVEAL_BUILDING_OCCLUSION -->

V36.19 follows the V36.18 runtime proof: the destination-floor authoritative
creature cache can be complete (actors=N/N) while the actual visual is still
missing. Floor changes now explicitly reveal cached actors and invalidate their
material animation cache so Castle Rat textures are rebound immediately.
Unfinished monster asset families no longer use transparent placeholders; they
render as solid per-definition tinted billboards until their production sprite
sheets are authored.

The V36.17 atomic floor visibility system previously ran after roof cutaway and
therefore restored current-floor roofs every frame. Roof and house-wall roots
now own their own floor visibility. Every building receives independent
Blend-capable roof and gable materials. The roof fades when the player is inside
the building or the building lies on the camera-to-player sight segment, while
nearby obstructing house-wall segments use a local cutaway.

<!-- TIBIAGAME_V36_19_1_FOLLOW_CAMERA_DELIMITER_HOTFIX -->

V36.19.1 fixes a patch-generator delimiter duplication that produced fn follow_camera(fn follow_camera(. No V36.19 gameplay/render behavior is changed.

<!-- TIBIAGAME_V36_19_2_CREATURE_DELIMITER_HOTFIX -->

V36.19.2 fixes a patch-generator delimiter duplication that produced pub fn begin_creature_move(pub fn begin_creature_move(. All V36.19 floor-reveal and building-occlusion behavior is preserved.

<!-- TIBIAGAME_V36_19_3_COMPILE_HOTFIX -->

V36.19.3 fixes the remaining V36.19 compile issues: the building floor Entity no longer shadows the building z-level, Bevy Mut<StandardMaterial> bindings are mutable where materials are edited, and obsolete RegionStream CreatureActor/catalog warnings are cleaned up.


<!-- TIBIAGAME_V36_20_CREATURE_RENDER_EXTRACTION -->

V36.20 is based on the V36.19.3 runtime log, which proves floor 6 assets,
static geometry and 13/13 persistent creature actors were ready roughly 24
seconds before the player entered the cellar. The remaining delay is therefore
not asset preload or server region latency.

Creature billboards now opt out of CPU frustum culling, use an unlit sprite
material, and Castle Rat alpha-mask threshold is reduced. GPU warmup probes also
opt out of frustum culling so their meshes/materials are actually extracted even
though they are positioned far outside the gameplay world.

A short render diagnostic reports Visibility, InheritedVisibility and
ViewVisibility for the active floor after every z change.


<!-- TIBIAGAME_V36_21_NATIVE_GAMEPLAY_UI -->

V36.21 begins feature migration from the React client into native Bevy UI.

Native gameplay HUD now mirrors the old client's core combat shell: player
identity, HP, mana, XP-to-next-level, inventory capacity, ping, target health,
message/chat log and a keyboard action bar. Enter opens native chat and sends
Say through the existing protocol. Movement input is suspended while chat owns
the keyboard.

Action slot 1 resends the current basic attack target. Slots 2-9 expose the
first learned spells sorted by display name and send CastSpell against the
current attack target.

The legacy native debug HUD/feed text remains in code for diagnostics but is
hidden so the new gameplay shell owns those screen regions.

<!-- TIBIAGAME_V36_21_1_NATIVE_UI_BORROW_HOTFIX -->

V36.21.1 fixes the E0502 borrow conflict in native action-bar spell casting. The selected spell id/name are cloned before NativeGameState is mutated by push_system_message. No gameplay/UI behavior is otherwise changed.

<!-- TIBIAGAME_V36_21_2_NATIVE_UI_VISIBILITY_HOTFIX -->

V36.21.2 fixes the native_ui private-interface compile error by exposing NativeUiText and NativeUiBar as pub(crate), matching update_ui's crate-level system registration from main.rs. No gameplay behavior is changed.


<!-- TIBIAGAME_V36_22_NATIVE_INVENTORY_CHARACTER -->

V36.22 migrates the next major React-client surface to native Bevy UI:
inventory and character/equipment panels.

I toggles inventory. The inventory lists authoritative NativeGameState items,
gold, weight/capacity and equipment/container location. Arrow keys select an
item while the panel is open. E toggles equip/unequip using the item's
authoritative ItemDefinition equipment slot, R moves an item to root inventory,
and Delete sends DropItem.

C toggles a character sheet with HP/mana, XP, capacity, melee/distance/
shielding/fletching/magic skills, current equipment and selected profession
skills. The panels read the same authoritative state already maintained by the
native network core; no duplicate gameplay state is introduced.

<!-- TIBIAGAME_V36_22_1_INVENTORY_BORROW_HOTFIX -->

V36.22.1 fixes E0502 in native inventory equip handling. ItemDefinition name/equipment_slot are cloned before any NativeGameState mutation. No inventory behavior is changed.


<!-- TIBIAGAME_V36_23_NATIVE_SKILLS_SPELLBOOK -->

V36.23 migrates native skills and spellbook surfaces from the React client.

K opens Skills with combat skills, tries, selected professions and profession
mastery cost. P opens the Spellbook with learned spells, not-yet-learned spell
definitions, mana/range/requirements and a selected-spell detail pane.

Arrow keys select learned spells while the spellbook is open and F casts the
selected learned spell at the current authoritative attack target through the
existing CastSpell protocol message. Arrow-driven movement is suspended while
inventory or spellbook owns the arrow keys.


<!-- TIBIAGAME_V36_24_1_NATIVE_CRAFTING -->

V36.24.1 migrates the native crafting browser from the React client.

B toggles Crafting. The panel reads authoritative rune_recipes,
learned_recipe_ids, item definitions, inventory and local mana directly from
NativeGameState. Up/Down selects a recipe, F sends StartRuneCrafting for one
item, and X sends CancelRuneCrafting.

The panel shows learned/locked recipes, input/output item names and quantities,
carried material count, mana cost, craft time and required skill level.

No creature/floor rendering code is changed.


<!-- TIBIAGAME_V36_25_NATIVE_NPC_SERVICES -->

V36.25 migrates native NPC dialogue and service panels.

N opens the nearest NPC within two tiles on the current floor. The panel
presents the NPC dialogue plus available Shop, Spell Trainer, Recipe Trainer and
Depot tabs derived from authoritative NpcView/service state.

Tab cycles services, Up/Down selects entries, and F performs the contextual
primary action: buy one offer, learn a spell, learn a recipe or withdraw one
depot item. V sells one of the previously selected inventory item and O deposits
that selected inventory item.

All actions use the existing protocol messages: BuyFromNpc, SellToNpc,
LearnSpell, LearnRecipeFromNpc, DepositItem and WithdrawItem. Movement is
suppressed while the NPC panel owns keyboard interaction.


<!-- TIBIAGAME_V36_26_1_NATIVE_MINIMAP_WORLD_MAP -->

V36.26.1 migrates the minimap/world-map navigation surface into native Bevy UI.

The native client now retains the latest authoritative MapView in
NativeMapState and records a lightweight 4x4 discovered atlas as streamed
regions arrive. The always-visible minimap renders the current floor with player,
creature, NPC and available-resource markers.

M opens a larger session atlas. Arrows pan, +/- zoom, brackets change floor,
Home recenters the player, and M/Escape closes. The map owns movement input while
open.

The atlas deliberately stores only compact terrain categories rather than
duplicating world gameplay state. V36.20 floor/creature safety and rendering are
untouched.


<!-- TIBIAGAME_V36_26_2_MAP_ATLAS_BORROW_HOTFIX -->

V36.26.2 fixes E0502 in NativeMapState::capture_region. The region's MapView
collections are iterated immutably while only the separate atlas field is
mutated. capture_position is now a field-scoped helper that receives
&mut self.atlas rather than &mut self, allowing Rust to prove the map and atlas
borrows are disjoint.

No minimap/world-map behavior is changed.


<!-- TIBIAGAME_V36_26_3_NATIVE_MAP_UI_VISIBILITY_HOTFIX -->

V36.26.3 fixes the Bevy system-registration private-interface error in
native_map_ui. NativeMapText and NativeWorldMapPanel are now pub(crate), matching
the crate-visible native_map_ui::update_ui system that is registered from
main.rs.

No minimap/world-map behavior is changed.


<!-- TIBIAGAME_V36_27_NATIVE_DIRECT_TRADE -->

V36.27 migrates direct player trade into native Bevy UI using the existing
authoritative trade protocol.

T requests trade with the nearest other player within two tiles. Incoming
TradeRequested state is shown as a modal request; Y/Enter sends RespondTrade
accept=true and Escape/Backspace declines.

During active TradeState, Up/Down selects an eligible root inventory item,
Space sends the complete SetTradeOffer item-id set, Enter/Y sends ConfirmTrade,
and Escape/Backspace sends CancelTrade. Both authoritative offers and both
confirmation states are rendered from NativeGameState.trade.

The client never transfers inventory optimistically. Item movement and final
trade completion remain fully server-authoritative.


<!-- TIBIAGAME_V36_27_1_SYSTEM_PARAM_GROUPING -->

V36.27.1 fixes the Bevy system-conversion failure introduced when direct-trade
movement locking pushed schedule_tile_movement to 17 system parameters.

NativeMapUiState + NativeTradeUiState are now grouped behind a single derived
SystemParam, MovementUiLocks. schedule_tile_movement therefore returns to the
supported Bevy system-parameter arity while preserving the same world-map and
trade movement locks.

No gameplay semantics are changed.


<!-- TIBIAGAME_V36_28_1_NATIVE_OPTIONS_AUDIO -->

V36.28.1 migrates native options, persistent audio settings, a lightweight
performance HUD and world-music moods. F10 opens Options.

Defaults match the React client: master 100, music 18, effects 80, unmuted.
World music priority is battle, swamp, town, wilderness and uses the same legacy
audio assets. Bevy MP3 support is enabled because the old soundtrack mixes MP3
and OGG.

MovementUiLocks is extended with options_open rather than adding another
schedule_tile_movement parameter.


<!-- TIBIAGAME_V36_28_2_AUDIOPLAYER_SOURCE_HOTFIX -->

V36.28.2 fixes Bevy 0.19.1 E0283 in native_settings::sync_world_music.
AudioPlayer and AssetServer::load now explicitly use bevy::audio::AudioSource,
so the generic audio source type no longer depends on inference.

No settings, music-mood, movement, map, floor or creature behavior changes.


<!-- TIBIAGAME_V36_28_3_NATIVE_MUSIC_VISIBILITY_HOTFIX -->

V36.28.3 fixes the Bevy private-interface error for native music systems.
NativeMusic is now pub(crate), matching the crate-visible sync_world_music and
apply_audio_settings systems registered from main.rs.

No audio behavior or gameplay logic changes.


<!-- TIBIAGAME_V36_29_NATIVE_LAUNCHER_NETWORK_FOUNDATION -->

V36.29 prepares removal of the console login/character picker without changing
the live game bootstrap yet.

network.rs now exposes a native-launcher-safe account step:
login_and_list_characters(username, password) returns the authenticated session
token, configured API/WS endpoints and CharacterSummary list. The work runs on
its own Tokio runtime, so the next migration can execute it on a worker thread
without blocking Bevy's main/UI thread.

The existing connect_interactive path remains intact as a compatibility path and
now shares the same configured_api_url/configured_ws_url helpers.

No gameplay, renderer, floor gate or protocol semantics are changed.


<!-- TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY -->

V36.30 replaces the console-first startup with a native Bevy account login and
character lobby.

Authentication uses V36.29's login_and_list_characters helper on a worker
thread. Character selection starts a fresh copy of the native executable with
only the authenticated session token, selected character UUID and endpoint
configuration. The gameplay child opens its WebSocket directly and receives
Welcome. The account password is not forwarded.

A fresh process is deliberate because winit should own one native EventLoop per
process. The existing gameplay bootstrap is preserved as run_game(session).

No floor gate, creature renderer, world renderer, movement authority or server
authority semantics change.


<!-- TIBIAGAME_V36_30_1_CLIENT_VERSION_HOTFIX -->

V36.30.1 fixes E0425 in network::open_selected_session. The newly added
launcher/direct-session handshake no longer depends on a CLIENT_VERSION symbol
that is not available in the current native network module; it sends the native
V36.30 client version literal directly in ClientMessage::Hello.

No authentication, session-token, character selection, renderer, floor gate or
gameplay behavior changes.


<!-- TIBIAGAME_V36_31_NATIVE_UPDATER_RELEASE_CHANNEL -->

V36.31 establishes the signed native Bevy updater release channel before adding
self-installation logic to the launcher.

The existing client-vX.Y.Z release process stays authoritative. Its preflight
now cargo-checks game-client. GitHub Actions also builds the native release
binary with ALDORIA_NATIVE_RELEASE_VERSION from the tag, packages
EmbersOfAldoria.exe into a Windows x86_64 ZIP, signs that ZIP with the existing
Tauri updater signing key, creates native-latest.json and uploads the native
assets to the same GitHub Release.

No gameplay or floor/creature safety path changes.


<!-- TIBIAGAME_V36_31_1_LAUNCHER_UI_CAMERA_HOTFIX -->

V36.31.1 fixes the blank native launcher window. The launcher created Bevy UI
nodes but did not create a Camera2d, so the UI tree had no camera target and
nothing was rendered.

native_launcher::setup now spawns one dedicated Camera2d before creating the
login/lobby UI.

No login protocol, updater, gameplay, world renderer, floor gate or creature
logic changes.


<!-- TIBIAGAME_V36_32_SIGNED_NATIVE_SELF_UPDATER -->

V36.32 adds the native launcher's signed Windows self-update path.

Release publishing now signs the raw EmbersOfAldoria.exe while retaining the
ZIP as a manual-download artifact. native-latest.json points at that raw
executable and carries its Minisign signature.

The launcher checks native-latest.json on a worker thread. Release builds compare
the embedded client-vX.Y.Z version, constrain downloads to this repository's
GitHub Release origin, verify the executable with the committed updater public
key, stage it under the user's local app-data directory, then start a hidden
PowerShell helper that waits for the launcher to exit, atomically replaces the
running executable and restarts it.

Development builds report "dev" and do not self-update.

No gameplay, server authority, world renderer, floor gate or creature safety
logic changes.


<!-- TIBIAGAME_V36_32_1_UPDATER_FORMAT_ARGS_HOTFIX -->

V36.32.1 fixes the Rust format_args restriction in the Windows updater helper.
The PowerShell command is built from concat!(...) inside format!(...), so Rust
cannot implicitly capture pid/staged/destination from the surrounding scope.
Those values are now supplied explicitly as named format arguments.

No updater security, signature verification, install flow, gameplay, floor gate
or creature behavior changes.


<!-- TIBIAGAME_V36_33_UPDATER_LOGIN_STARTUP_GATE -->

V36.33 closes the startup race between the native updater and account login.

Credential typing remains available immediately, but Log In and Enter World are
blocked until the signed update check has completed. Update-check failures are
non-fatal and allow the existing client to continue with a visible warning.
However, once a newer executable has been downloaded and cryptographically
verified, that old client becomes hard-blocked from online play until the
verified replacement succeeds.

native_updater::poll is ordered before the login worker/input systems so launcher
input observes the current updater state in the same frame.

No protocol, gameplay, movement, renderer, floor gate or creature logic changes.


<!-- TIBIAGAME_V36_34_NATIVE_INVENTORY_INTERACTION_POLISH -->

V36.34 begins the post-migration React-parity pass with native inventory
interaction polish.

Inventory is now scoped by root/direct container contents instead of flattening
all nested stacks. Enter opens a selected container and Backspace returns to its
parent. Slash activates a native text filter over the current container.

F6 starts an authoritative stack split. Left/Right selects the split quantity,
Enter sends ClientMessage::SplitItem and F6/Escape cancels. No optimistic local
inventory mutation occurs; InventoryChanged remains authoritative.

Existing equip/unequip, move-to-root and drop requests remain server-authoritative.

No movement, world renderer, map, updater, floor gate or creature safety code is
changed.


<!-- TIBIAGAME_V36_34_1_INVENTORY_FILTER_STRING_HOTFIX -->

V36.34.1 fixes the malformed Rust format string in the native inventory filter
label. The inner quotation marks around the filter value are now escaped.

No inventory behavior, protocol, gameplay, movement, updater, renderer, floor
gate or creature safety logic changes.


<!-- TIBIAGAME_V36_35_NATIVE_CRAFTING_PARITY_POLISH -->

V36.35 continues native React-parity work in Crafting.

The crafting panel now has dynamic categories derived from authoritative
RuneRecipe::craft_kind values, with All plus each available category. Tab cycles
categories. Left/Right selects a batch quantity from 1 to 99. F sends the
existing StartRuneCrafting { recipe_id, quantity } protocol message.

Client-side preflight checks total material and mana requirements for the batch
but does not optimistically consume anything. Server state remains authoritative.

The panel also consumes NativeCraftingState so the active recipe, remaining
count and status from RuneCraftingChanged are visible.

No updater, movement, map, world renderer, floor gate or creature safety code is
changed.


<!-- TIBIAGAME_V36_36_LEGACY_CLIENT_UI_SHELL -->

V36.36 starts migrating the visible composition of the current React client into
the native Bevy client.

The native HUD now follows the same broad hierarchy as the React Game shell:
world header at the top, player unit frame and target frame below it, minimap and
battle list on the right, chat in the lower-left, action dock at the bottom
center and a character-panel dock at the bottom-right.

Native Inventory/Character/Skills/Spells/Crafting/NPC windows are repositioned
as centered floating modal-style panels rather than edge-attached debug panes.

This patch is deliberately visual/layout-first. Existing keyboard interactions
remain in place; later parity patches can replace text-only action/panel docks
with clickable icon buttons and migrate the old client artwork/assets.

No server protocol, movement, updater, world renderer, floor gate or creature
safety logic changes.


<!-- TIBIAGAME_V36_36_1_BATTLE_LIST_COMPILE_HOTFIX -->

V36.36.1 fixes E0308 in battle_list_text. Rust let...else requires the else
branch to diverge; the no-player String fallback now uses match instead.

No UI layout or gameplay behavior changes.


<!-- TIBIAGAME_V36_37_NATIVE_ALDORIA_UI_DESIGN_SYSTEM -->

V36.37 translates the current React client's CSS visual language into reusable
native Bevy UI tokens instead of attempting to parse CSS at runtime.

native_ui_theme.rs mirrors the old/current styles.css palette: #080c0a root,
#111a16/#090e0c surfaces, #d2ad68 gold, #706443 edges, #f4ead1 text and #84918a
muted text. The first native frame applies those tokens to named gameplay,
minimap, world-map, trade and options surfaces with 1px borders and rounded
corners.

The bottom-right text-only panel legend is replaced by real Bevy Buttons for
Character, Inventory, Skills, Spells and Crafting, including hover/pressed
states and click-to-toggle behavior. Existing keyboard shortcuts remain.

Player/target progress tracks receive themed borders and rounded corners.

This patch remains UI-only. It does not change server protocol, gameplay,
movement, updater, world rendering, floor gates or creature safety.


<!-- TIBIAGAME_V36_38_1_ACTIONBAR_PANEL_HEADERS -->

V36.38.1 continues the React/CSS-to-native UI migration and fixes the V36.38 precheck boundary assumption.

The old text action bar is replaced by nine real Bevy Button slots. Slot 1 is
Attack and slots 2-9 mirror learned spells in the exact same sorted order as the
existing keyboard hotkeys. Mouse clicks and number keys now call one shared
activate_action_slot path, so protocol behavior stays identical.

Inventory, Character, Skills, Spellbook, Crafting and NPC windows now have
native title bars with gold headings and X close buttons. Hover/pressed states
reuse the V36.37 Aldoria CSS-derived theme.

No gameplay authority, movement, updater, renderer, floor gate or creature
safety behavior changes.


<!-- TIBIAGAME_V36_39_GRAPHICAL_NATIVE_MINIMAP -->

V36.39 replaces the visible ASCII minimap body with a real 27x27 colored Bevy
UI tile grid while retaining NativeMapState, MapLookup and the existing 120ms
refresh cadence.

Terrain is color-coded for ground, floor, roads, bridges, water, trees and
walls. The center/player is gold, living creatures red, NPCs green and available
resource nodes cyan.

The existing render_minimap text helper remains available internally but no
MinimapBody text entity is spawned in the HUD.

Map UI separators are converted to ASCII-safe vertical bars so the default
native font no longer renders unsupported separator glyphs as boxes.

No movement, server protocol, updater, world renderer, floor-transition gate or
creature visibility/safety behavior changes.


<!-- TIBIAGAME_V36_39_1_BEVY_B0001_UI_QUERY_HOTFIX -->

V36.39.1 fixes the runtime Bevy error B0001 introduced by the clickable native
action bar.

native_ui::update_ui had two simultaneous mutable Text queries:
one for NativeUiText and one for NativeActionSlotText. Although those entities
are logically separate, Bevy cannot assume that from the original query
signatures and rejects the system at runtime.

The two queries are now explicitly disjoint with complementary Without filters:
the normal UI-text query excludes NativeActionSlotText and the action-slot query
excludes NativeUiText.

No visible UI, protocol, combat, movement, minimap, updater, world renderer,
floor gate or creature-safety behavior changes.


<!-- TIBIAGAME_V36_40_NATIVE_LAUNCHER_UX_HANDOFF -->

V36.40 starts the native launcher/menu UX pass.

Account/password input now uses Bevy KeyboardInput.text rather than the old
manual US-keyboard mapping. Mouse buttons can focus Account or Password and a
real LOG IN button uses the same updater gate and login worker as Enter.

The character lobby gets PREV, NEXT, ENTER WORLD and BACK mouse controls while
keeping keyboard navigation.

The launcher no longer exits immediately after spawning the gameplay child.
LauncherMode::Launching remains visible for 1.8 seconds so the player sees an
ENTERING THE WORLD handoff screen while the fresh gameplay process initializes.

The hardcoded local 10-character password rule is removed. The launcher only
requires a nonempty password; the auth server remains authoritative.

No game protocol, combat, movement, minimap, updater policy, world renderer,
floor gate or creature-safety behavior changes.


<!-- TIBIAGAME_V36_41_AUTHORITATIVE_STARTUP_LOADING -->

V36.41 adds the first real loading screen inside the gameplay process.

The overlay does not use a fake timer or fake percentage completion. It remains
opaque until the current floor is committed by RegionStream::floor_ready and the
creature sprite catalog reports all floor-transition assets loaded with
dependencies. Both signals must then remain ready for two consecutive update
frames before the overlay is hidden.

The existing RegionStream only marks a floor ready after the complete staged
generation build has committed; that staged build includes actors, static world,
NPCs and resources. The extra two-frame settle window prevents input from being
released on the exact deferred-spawn commit frame.

Movement, pointer interaction and action-slot combat are run-condition gated
while NativeLoadingState is active. This is an additional startup-only safety
gate and does not weaken or replace the existing later floor-transition safety
logic.

No protocol, updater, map authority or server gameplay rules change.


<!-- TIBIAGAME_V36_41_1_LOADING_COMPONENT_VISIBILITY_HOTFIX -->

V36.41.1 fixes the Rust private-interface errors from V36.41.

native_loading::update is pub(crate) because it is registered from main.rs.
Its Bevy Query signature therefore cannot expose component types that are only
private to native_loading.rs.

NativeLoadingOverlay, NativeLoadingStatus and NativeLoadingProgress are now
pub(crate). No loading readiness, input gating, floor safety, renderer or
gameplay behavior changes.


<!-- TIBIAGAME_V36_42_GRAPHICAL_NATIVE_LOGIN_FORM -->

V36.42 replaces the launcher login's text-only presentation with a graphical
native Bevy form while retaining the V36.40 login worker, updater gate and
KeyboardInput.text input path.

The login form now has two bordered input surfaces, active-field gold focus,
masked password text, live status text and a single LOG IN action below it.
The Account and Password surfaces themselves are clickable and reuse the existing
LauncherAction::FocusAccount/FocusPassword behavior.

The old LauncherText renderer remains for character selection, launching and
error states, but it is hidden while Login/LoggingIn is active.

No auth protocol, updater policy, gameplay process, loading readiness, movement,
floor gate or creature safety behavior changes.


<!-- TIBIAGAME_V36_43_LAUNCHER_BACKGROUND_RESPONSIVE_SHELL -->

V36.43 upgrades the native launcher shell from a small dark fixed panel to a
responsive full-window presentation.

Changes:
- adds a bundled painted medieval background image at
  ui/launcher/aldoria_launcher_background.png
- setup now spawns a full-bleed launcher background plus a light tint
- login form becomes a centered responsive panel with full-window margins
- non-login launcher states now render inside a matching responsive legacy panel
  so the character lobby no longer appears as a tiny floating block
- login mode hides the legacy panel and shows the graphical form; non-login
  states do the opposite

No auth/network/updater/gameplay/loading/floor/creature behavior changes.


<!-- TIBIAGAME_V36_43_1_LAUNCHER_DELIMITER_HOTFIX -->

V36.43.1 repairs three duplicated function signatures introduced by the V36.43
launcher replaceBlock helper:

- spawn_launcher_button
- handle_keyboard
- update_launcher_controls

The V36.43 medieval background image, responsive launcher shell and login/lobby
visual changes are retained unchanged.

No auth, updater, gameplay, loading, movement, floor-safety or creature-safety
behavior changes.


<!-- TIBIAGAME_V36_43_2_LAUNCHER_ERROR_COLOR_HOTFIX -->

V36.43.2 fixes the launcher compile error caused by referencing
native_ui_theme::ERROR, which does not exist. The login error-status branch now
uses an inline warm-red Color::srgb value. No behavior changes.


<!-- TIBIAGAME_V36_43_3_LAUNCHER_ASSET_ROOT_BACKGROUND_HOTFIX -->

V36.43.3 fixes the black launcher background from V36.43.

The generated medieval image was copied to apps/client/public/assets, but the
launcher App still used Bevy's default asset root. Only run_game configured
AssetPlugin.file_path to crate::native_asset_root(), so the launcher AssetServer
could not resolve ui/launcher/aldoria_launcher_background.png.

The launcher now configures the same AssetPlugin root as gameplay, re-copies the
bundled background image, enables window resizing if the old false setting is
still present, and logs the resolved launcher asset root at startup.

No auth, updater, gameplay, loading, floor or creature-safety behavior changes.


<!-- TIBIAGAME_V36_43_4_LAUNCHER_UI_CAMERA_RESTORE -->

V36.43.4 fixes the black launcher introduced when V36.43 replaced setup().

The old launcher explicitly spawned a Camera2d because Bevy UI needs an active
camera target. V36.43's setup replacement retained the UI tree and background
ImageNode but accidentally removed that camera, leaving only ClearColor visible.

The launcher now restores the Native launcher UI camera before spawning the
background and menu shells.

No asset-root, auth, updater, gameplay, loading, movement, floor or creature
behavior changes.


<!-- TIBIAGAME_V36_43_5_LAUNCHER_UI_LAYERING_HOTFIX -->

V36.43.5 fixes the launcher layering regression seen after V36.43.4.

The medieval background image and tint rendered, but they sat over the rest of
the launcher UI roots. The launcher now assigns explicit ZIndex values:

- background image: -100
- background tint: -90
- legacy / lobby panel: 20
- login form: 30
- bottom controls: 40

This keeps the background fully visible while ensuring login, lobby and control
panels render above it and remain clickable.

No auth, updater, gameplay, loading, floor or creature changes.


<!-- TIBIAGAME_V36_44_GRAPHICAL_CHARACTER_LOBBY -->

V36.44 adds a native Bevy character-card lobby over the medieval launcher
background. Twelve reusable card slots avoid dynamic hierarchy churn. Clicking a
visible card updates selected_character and the selected card uses the Aldoria
gold focus treatment. Existing launcher controls and keyboard navigation remain.

No auth/network/updater/gameplay/loading/floor/creature behavior changes.


<!-- TIBIAGAME_V36_45_SINGLE_WINDOW_CLIENT_FLOW -->

V36.45 removes the normal launcher -> child-process gameplay handoff.

The launcher App now registers SingleWindowGameplayPlugin at startup. Selecting
Enter World starts only a network connection worker. When Welcome arrives,
install_single_window_session inserts the authoritative gameplay resources into
the existing Bevy App and schedules the normal world/UI bootstrap once.

The existing launcher Camera2d and OS window survive the transition:

Login -> Characters -> Connecting -> Loading -> Gameplay.

Gameplay systems are registered from startup but guarded by
SingleWindowGameActive, so they cannot access gameplay-only resources before the
selected-character session is installed. The bootstrap setup chain runs exactly
once under SingleWindowGameBootstrap.

The V36.41 loading gate remains authoritative for player input. The medieval
launcher background remains visible while Loading is active and is hidden only
when NativeLoadingState reports the world ready. The background ImageNode uses
NodeImageMode::Stretch to eliminate the remaining client-area letterbox strip.

The legacy ALDORIA_NATIVE_GAME_SESSION child-process path remains in main.rs only
as a compatibility/debug fallback, but normal launcher Enter World no longer
spawns or exits into another executable.

No server protocol or floor/creature safety guarantees are weakened.


<!-- TIBIAGAME_V36_45_1_SYSTEM_TUPLE_ARITY_HOTFIX -->

V36.45.1 fixes the Bevy E0599 compiler failure caused by placing 21 gameplay
systems inside one system-config tuple and applying run_if to that tuple.

The group is split into two Update registrations containing 12 and 9 systems.
All existing system ordering constraints, SingleWindowGameActive gating,
NativeLoadingState gating, floor readiness and creature safety remain unchanged.

The obsolete process::Command and anyhow::bail imports in native_launcher.rs are
also removed because normal Enter World no longer spawns a child executable.


<!-- TIBIAGAME_V36_45_2_RUN_CONDITION_WARNING_CLEANUP -->

V36.45.2 fixes the single-window launcher runtime panic caused by
native_loading::gameplay_ready requiring Res<NativeLoadingState> before a
character session has installed that resource. The run condition now accepts
Option<Res<NativeLoadingState>> and returns false while the launcher has no game
session.

The 16 warnings reported after V36.45.1 are also cleaned up. Creature warmup
handles use an underscore field because retaining the handles is their purpose.
Compatibility/debug helpers, protocol state surfaces and legacy UI fallback
markers that are intentionally retained are marked with targeted allow(dead_code)
attributes instead of using a crate-wide lint suppression.

No server protocol, gameplay authority, loading readiness, floor-transition gate
or creature-visibility safety is weakened.


<!-- TIBIAGAME_V36_45_3_DUPLICATE_VISIBILITY_HOTFIX -->

V36.45.3 fixes the malformed Rust declaration introduced by V36.45.2:

  pub(crate) pub(crate) fn gameplay_ready(

It is normalized to:

  pub(crate) fn gameplay_ready(

The V36.45.2 launcher-safe Option<Res<NativeLoadingState>> run-condition logic
is retained unchanged. No gameplay, loading, floor-transition or creature-safety
behavior changes.


<!-- TIBIAGAME_V36_45_4_LOADING_GATE_AND_SHELL_HOTFIX -->

V36.45.4 keeps the single-window launcher shell visible while the native game
session is still entering the world or the gameplay loading state is active.
This gives a true loading-screen handoff instead of briefly exposing a black
world/background with gameplay UI already visible.

It also replaces grouped:

  .run_if(single_window_game_active)

with:

  .distributive_run_if(single_window_game_active)

inside the main Update system tuples so Bevy resolves them as schedule configs
instead of trying to interpret the tuple as an observer system.


<!-- TIBIAGAME_V36_45_5_LAUNCHER_STATE_VISIBILITY_HOTFIX -->

V36.45.5 fixes the single-window compiler error where the pub(crate)
sync_single_window_shell system exposed Option<Res<NativeLauncherState>> while
NativeLauncherState itself was private to native_launcher.rs.

NativeLauncherState is now pub(crate). Its fields remain private.

The final WorldResource.position dead-code warning is also handled with a
targeted field-level allow(dead_code) inside WorldResource.

No loading, gameplay, auth, movement, floor-transition or creature-safety
behavior changes.


<!-- TIBIAGAME_V36_45_6_VISIBLE_ENTER_WORLD_LOADING -->

V36.45.6 adds a launcher-owned loading overlay that already exists before a game
session is installed. It becomes visible immediately on Enter World while the
selected-character websocket is connecting, then bridges into the authoritative
NativeLoadingState stages after Welcome.

The native loading completion gate is also strengthened: current floor ready,
creature transition assets ready, two ready frames, at least 1.0 second visible
game-loading time, and at least 0.65 second continuously ready/render-settle
time.

The launcher background remains behind the loading overlay and is released only
after NativeLoadingState is no longer active.


<!-- TIBIAGAME_V36_45_7_VISUAL_READINESS_LOADING_GATE -->

V36.45.7 changes the startup loading gate from data-ready to visual-ready.

RegionStream::floor_ready proves that the streamed SpawnSpec generation has
committed, but GLTF WorldAssetRoot scenes still load asynchronously and deferred
ECS commands can materialize after that point.

Startup now waits for:
- current-floor active-generation streamed entities
- stable streamed entity count for four Update frames
- existing creature asset readiness
- at least two WorldAssetRoot entities
- recursive dependencies loaded for every WorldAssetRoot
- a WorldInstance attached to every WorldAssetRoot
- stable WorldAssetRoot count for four Update frames
- the existing final render-settle interval

This prevents map/player/world-prop pop-in after the loading screen disappears.


<!-- TIBIAGAME_V36_45_8_RENDER_VISIBILITY_LOADING_GATE -->

V36.45.8 fixes two distinct startup-presentation problems.

First, the enter-world surface is now a genuine full-window loading screen. It
uses the medieval launcher artwork itself at ZIndex 10000 instead of a
semi-transparent root with only a small card, so launcher and gameplay UI cannot
bleed through behind the loading panel.

Second, startup no longer releases presentation merely because ECS/asset data is
ready. It also waits for Bevy ViewVisibility to confirm that current-floor
streamed Mesh3d geometry is visible from a camera and that at least one Mesh3d
descendant of PlayerModelRoot is visible. Those render-visible conditions must
remain true for 12 Update frames before the final 0.85-second presentation
settle period starts.

ViewVisibility is generated by Bevy's camera visibility pipeline and indicates
that an entity should be extracted for rendering, making this a stronger gate
than AssetServer/WorldInstance readiness alone.
