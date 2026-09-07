# Native client migration

Status: **V36.0 foundation started**

The production desktop client is moving from React/Tauri/WebView2 world rendering to a native Rust + Bevy client. The current React/Tauri client remains available as a reference and fallback during the migration. The web-based world editor stays in React.

## Why

The current Three.js world renderer is not CPU-bound. Desktop traces repeatedly show roughly 2–5 ms of game/render work followed by 28–47 ms outside the renderer on missed frames. Browser `npm run dev` is smoother than embedded WebView2, and the issue survives WebView2 152, a no-vsync diagnostic run, and Fixed WebView2 149.

The native client must own the complete gameplay presentation chain:

input -> prediction/simulation -> interpolation -> animation -> wgpu -> DX12 present

No Chromium/WebView2 layer should sit between the game renderer and the desktop swapchain.

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
