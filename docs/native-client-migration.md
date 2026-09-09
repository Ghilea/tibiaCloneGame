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
