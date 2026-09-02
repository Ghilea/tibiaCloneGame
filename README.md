# Embers of Aldoria

An early playable technical slice for a social, tile-based MMORPG. The world and names are original; classic MMORPG design inspires the systems, not the content.

## Getting started

Requirements: Node.js 22+, stable Rust, and Docker.

```powershell
npm install --prefix apps/client
docker compose up -d postgres
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/aldoria"
cargo run -p game-server
```

Start the client in a second terminal:

```bash
npm run dev
```

Use `npm run desktop` for the Tauri desktop client. Open `http://localhost:1420`, create an account, and enter Greyhaven.

## World editor

Start the standalone browser editor with:

```bash
npm run editor
```

It opens at `http://localhost:1421/editor.html`. The editor uses a straight top-down square grid, while map coordinates, movement, collision, and exported JSON remain tile-based. World dimensions can be resized from 8 x 8 up to 16,384 x 16,384 tiles. The editor renders a movable 40 x 28 tile window instead of creating browser elements for the entire world, and stores only authored terrain, so large sparse maps remain responsive. Tools are grouped into Select, Terrain, Build, and Life categories; only settings relevant to the active tool are shown. Pan is always available with the right or middle mouse button, or Space plus the left button. Existing objects are always draggable regardless of the paint tool, with a translucent destination preview; use Ctrl+Z/Y for undo and redo or navigate directly with viewport X/Y. Shrinking warns before removing anything outside the new bounds. Paint terrain, three additional ground materials, collision, walls, bridges, oak trees, shuttered house windows, animated light-producing torches, doors, stairs, creature spawns, copper resource nodes, NPCs, and the authoritative Player start across floors 6-9. Clicking an existing NPC selects it and opens its inspector for stable ID, name, title, dialogue, service, shop inventory, prices, quantities, and teachable spells. House and Keep tools create complete rectangular buildings with walls, collision, interior floors, and renderer roof metadata; placing a door cuts a valid opening automatically. Dragging paints continuously as one undo operation; zoom, automatic local saving, and JSON import/export are included. Water, wall, and tree brushes automatically add collision. Water boundaries are auto-tiled in both the editor and game: open land creates a sandy shore, blocked terrain or the edge of the world creates a rocky cliff, and adjacent water tiles join without internal seams. Paint the Bridge tool over existing water to create a wooden, server-authoritative crossing that players and creatures can use. Exported `.world.json` files remain backwards compatible: authored window positions receive stable multiplayer IDs when the server loads the document.

To generate a compatible world draft with ChatGPT, use the copy-ready schema, content IDs, building rules, and validation checklist in [`docs/WORLD_JSON_CHATGPT_PROMPT.md`](docs/WORLD_JSON_CHATGPT_PROMPT.md).

Walls, doors, house roofs, and keeps retain distinct elevated faces in the editor's top-down view.

To run an exported world, stop the server and set `WORLD_FILE` to its full path before restarting:

```powershell
$env:WORLD_FILE="D:\maps\my-region.world.json"
cargo run -p game-server
```

The server validates the document before opening its socket. Invalid dimensions, out-of-bounds tiles, duplicate spawn IDs, unknown creature IDs, and spawns placed on blocked tiles stop startup with a precise error. The loaded document authoritatively controls terrain, collision, line of sight, creature pathfinding, doors, stairs, and creature spawns. If `WORLD_FILE` is unset, the built-in Greyhaven world remains active. Existing character positions that do not fit the selected world are moved to its first safe starting tile.

NPCs in a world file are server-authoritative and replace the built-in set completely. Their positions, identities, profiles, services, offers, item references, and spell references are validated at startup. Greyhaven's fallback NPC content is data-driven in `content/npcs/npcs.json`; NPC profiles and dialogue are no longer compiled into Rust.

Character creation includes four persistent vocations. Warriors have the highest health, capacity, and Sword training rate. Rangers begin with an equipped Ashwood Bow and 100 physical Rough Arrows, attack up to six tiles away with clear line of sight, and train Distance twice as quickly. Mages and Druids have larger mana pools, faster Magic training, and can produce sigils. Every vocation can equip distance weapons or buy, trade, carry, and use sigils, but vocation starting skills and training rates preserve specialization.

Movement is keyboard-first and screen-relative to the fixed isometric camera: W always moves visually upward, A left, S down, and D right. Hold keys continuously and combine two directions for visual diagonals; arrow keys use the same mapping. Movement remains server-authoritative at a deliberate 150 ms cadence, while client-side acceleration and braking blend confirmed tiles into continuous motion. Click creatures to attack and right-click another player for social actions. Press 1 to use an Ember Sigil or 2 to cast a learned Ember Bolt on the selected target, C for character and skills, I for inventory, K for crafting and production, H for help, and Escape to close a modal.

The game world is rendered as a real Three.js scene through React Three Fiber while retaining a close, fixed orthographic isometric camera and server-authoritative tile rules. Terrain and water are GPU-instanced; houses, thin walls, centred gabled roofs, chimneys, hanging signs, animated doors, wooden shutters, crenellated castle walls, bridges, trees, items, players, NPCs, and creatures are real 3D meshes that receive lighting and depth. House walls combine rough plaster with structural timber, while keeps use visible masonry courses. Windows deliberately contain no glass: two braced wooden leaves rotate on hinges and their open state is range-checked by the server and synchronized to every player through protocol 19. A synchronized three-minute atmosphere cycle drives the sun, night ambience, exponential fog, and rain. Authored torches have emissive flames and nearby dynamic point lights, while a shadow-casting directional sun provides the main world shadows. Only nearby torch lights are active to keep the light budget predictable. House collision still uses thin footprint edges: tiles on both sides remain walkable, crossing an actual wall edge is blocked, and an open door replaces exactly one edge section. Server pathfinding and client prediction share this rule.

World actors now use animated 3D mesh placeholders and smoothly interpolate between confirmed server positions without changing authoritative hitboxes. The scene is ready for authored glTF character, creature, prop, and environment models; the existing item artwork remains shared by inventory, shops, depot, loot, and direct trade UI until those assets receive model equivalents.

New characters receive a 12-slot Field Backpack. Inventory supports containers, stack splitting, equipment, ground items, weight, and physical corpse loot. Mirelings can be found east of the starting area and are targeted directly in the world.

Food is physical, stackable content with server-authoritative effects. Right-click food in inventory to consume one unit and extend Nourishment (up to ten minutes); while nourished, health and mana regenerate every two seconds. Mara sells basic Field Bread, while Mirelings can drop the stronger health-oriented Smoked Mire Meat.

Greyhaven Mire now extends east and south across a 56x38 world into a first tiered hunting zone. Mirelings occupy the outskirts, Mire Skulkers patrol the shallow bog, Reed Stalkers guard the dense pools, and Fen Brutes wait in the deepest reaches. Server-authoritative water creates winding routes, the eastern wilds contain additional hunting spawns, and each creature has its own health, damage, experience, corpse, resource loot, and visual silhouette.

Mara, Greyhaven's quartermaster, stands beside the arrival point. Click her in the world to open a modern dialogue and shop modal. She sells only basic Unmarked Sigils and Rough Arrow bundles for physical Gold Coins; distance, capacity, ownership, and the complete purchase are validated and persisted by the server.

Aldren, Greyhaven's vaultkeeper, operates the character's first city-specific depot from a physical location west of the arrival point. Click him while nearby to search the vault and atomically store or withdraw root items. Containers retain their contents and stable item identities, storage ignores carried weight, and withdrawals still require sufficient capacity.

Seraphine, Greyhaven's arcanist, teaches the first persistent combat spell from her physical place north of the arrival point. Mages and Druids can pay 15 physical Gold Coins to learn Ember Bolt. The lesson, payment, vocation requirement, range, line of sight, mana cost, cooldown, damage, and Magic training are all server-authoritative. Once learned, Ember Bolt occupies hotbar slot 2 and remains available after reconnecting.

Right-click a nearby player and choose Trade to start a direct exchange. Both players see the exact offers, any change resets both confirmations, and the server commits both inventories in one database transaction. Gold Coin stacks are traded like other physical items.

Progression is usage-based alongside character level. Successful melee hits train Sword Skill, successful ammunition hits train Distance Skill, producing arrows trains Fletching Skill, and crafting or using sigils trains Magic Level. Requirements grow with every skill level, and all skills persist with the character.

Mire Fiber from hunting is a physical production material. Any vocation can queue batches that turn one fiber into ten Rough Arrows while the character remains online and out of combat. The resulting stack can be used or sold to Rangers through direct trade.

As a Mage or Druid, pick up Unmarked Sigils near the starting point and use the Sigil Crafting modal. Crafting creates Ember Sigils while mana is available and the character is out of combat. Each charged Ember Sigil is a ranged combat resource for every vocation: select a creature, move within five tiles, and use hotbar slot 1.

## Development commands

```bash
cargo test --workspace
npm run check
npm run build
```

The server listens on `127.0.0.1:4000`. `GET /health` provides a health check and game sessions connect through `/ws`.
