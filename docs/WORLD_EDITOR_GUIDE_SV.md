# World editor guide

This guide matches the current editor and server. The game world is 35 000 x 35 000 tiles, but it is sparse: only painted content is saved. Build one connected region at a time, for example 96 x 96 or 128 x 128 tiles.

## Start and save

1. Run npm run editor.
2. Set World settings to 35 000 x 35 000.
3. Pan to the region you are building, for example X=0 and Y=0.
4. Save the JSON file in worlds.
5. Run cargo run -p game-server to load worlds/northwest-first-marches.world.json.

Right or middle mouse button, or Space plus left mouse button, pans. Select moves or removes objects. Ctrl+Z and Ctrl+Y undo and redo.

## Editor tools

### Terrain

| Tool | JSON field | Use |
| --- | --- | --- |
| Road | roads | Walkable cobblestone road. |
| Floor | floors | Building floors and walkable tiles on upper/lower floors. |
| Water | water | Water with automatic shore or cliff edges. |
| Bridge | bridges | Walkable wooden bridge; it must be placed on water. |
| Collision | blocked | Invisible impassable terrain. |
| Packed earth | terrainMaterials | Yards, paths and worn ground. |
| Moss stone | terrainMaterials | Ruins, crypts and old stone. |
| Sandstone | terrainMaterials | Warm plazas, temples and desert places. |

### Buildings

| Tool | JSON field | Use |
| --- | --- | --- |
| House | buildings, floors, houseWalls | Complete timber and plaster house. |
| Keep | buildings, floors, castleWalls | Complete fortified stone building. |
| House wall / Castle wall | houseWalls / castleWalls | Individual wall sections. |
| Door | doors | Door on a non-corner outer wall. |
| Window | windows | House window on a non-corner wall, never on a door. |
| Torch | torches | Fire and local light. |
| Stairs | stairs | Connects two floors at the same X/Y. |

### Objects

Objects use the objects field. The allowed kinds are:

    chair, table, bench, well, barrel,
    mountain_wall, forest_tree, pine_tree, snowy_pine,
    dirt_path, snow_ground, snow_bank

Table, well, mountain_wall, all tree objects and snow_bank block movement. Chair, bench, barrel, dirt_path and snow_ground do not. The Oak tree tool uses the trees field.

### Life

| Tool | JSON field | Allowed values |
| --- | --- | --- |
| Player start | playerSpawn | Exactly one free tile. |
| NPC | npcs | shop, depot, spell_trainer, craft_trainer |
| Creature | spawns | castle_rat, mireling, mire_skulker, reed_stalker, fen_brute, crypt_guard, bone_acolyte, cellar_warden |
| Copper vein | resourceNodes | copper_vein, Mining level 0 to 100 |

## Rules that must always be followed

- Every position must be inside the map. Normal surface is z=7.
- A bridge is in both water and bridges, but not blocked.
- Player start, NPCs, creature spawns and resource nodes use separate walkable tiles.
- Buildings are at least 3 x 3 and must not overlap.
- Never put trees inside or in the walls of a building.
- Doors and windows belong on an outer wall, never at a corner. A door and window cannot share a tile.
- Never place water, trees, walls or collision on a door tile.
- NPC and resource IDs use lowercase letters, numbers and underscores. Every ID is unique.
- Build a walkable route from the player start to town, NPCs, bridges and the first hunting zone.

## JSON structure

Every file contains all these top-level fields:

    {
      "version": 1,
      "name": "English region name",
      "width": 35000,
      "height": 35000,
      "floor": 7,
      "blocked": [],
      "water": [],
      "bridges": [],
      "trees": [],
      "roads": [],
      "floors": [],
      "houseWalls": [],
      "castleWalls": [],
      "windows": [],
      "torches": [],
      "terrainMaterials": [],
      "objects": [],
      "buildings": [],
      "doors": [],
      "stairs": [],
      "spawns": [],
      "resourceNodes": [],
      "playerSpawn": { "x": 10, "y": 10, "z": 7 },
      "npcs": []
    }

A position is always:

    { "x": 24, "y": 48, "z": 7 }

Example terrain material:

    {
      "position": { "x": 24, "y": 48, "z": 7 },
      "material": "packed_earth"
    }

Example object:

    {
      "id": "village_well_01",
      "kind": "well",
      "position": { "x": 24, "y": 48, "z": 7 }
    }

Example creature spawn:

    {
      "id": "marsh_mireling_01",
      "definitionId": "mireling",
      "position": { "x": 68, "y": 52, "z": 7 }
    }

Example copper vein:

    {
      "id": "north_copper_01",
      "kind": "copper_vein",
      "position": { "x": 14, "y": 24, "z": 7 },
      "respawnMs": 45000,
      "requiredSkillLevel": 1
    }

For a house or keep, prefer placing the building in the editor. If an AI generates the JSON, it must list every tile in the building rectangle in floors, list the correct outer walls and collision, and leave the door tile free.

## NPCs

A shop NPC has this shape:

    {
      "id": "mara_quartermaster",
      "name": "Mara",
      "title": "Greyhaven Quartermaster",
      "service": "shop",
      "dialogue": "Fresh supplies for the road.",
      "position": { "x": 24, "y": 46, "z": 7 },
      "offers": [
        {
          "id": "rough_arrows",
          "itemDefinitionId": "rough_arrow",
          "quantity": 10,
          "price": 3
        }
      ],
      "spellIds": [],
      "recipeIds": []
    }

A shop uses offers. A depot has empty offers, spellIds and recipeIds. A spell trainer can teach ember_bolt. A craft trainer can teach mark_ember_sigil, fletch_rough_arrows and forge_copper_blade.

Allowed shop items:

    blank_rune, ember_rune, traveler_blade, ashwood_bow, rough_arrow,
    field_backpack, mire_fiber, gold_coin, field_bread, smoked_mire_meat,
    bog_ichor, reed_hide, fen_tusk, worn_cap, patched_tunic, frayed_trousers,
    work_boots, wooden_buckler, iron_pickaxe, copper_ore

## Prompt for image-assisted world design

Upload a hand-drawn map, reference image or editor screenshot. First ask ChatGPT for a plan, not JSON:

    You are a world designer for Embers of Aldoria, an isometric medieval MMORPG.
    I attached an image that should inspire the next region.

    Analyse the image and create a short, concrete building plan only, not JSON.
    The region uses X=[SET RANGE], Y=[SET RANGE], Z=7 in the north-west part
    of a 35000 x 35000 world.

    Describe geography, water, forest and elevation; roads and settlements;
    a safe starting route and three danger levels; buildings, NPCs, resources
    and monsters; and which natural routes should continue into future regions.

    Absolute rules: no trees inside buildings; no doors or windows on corners;
    doors and windows only on outer walls; water and trees never block doors;
    bridges cross water; no NPC, spawn, resource or player start on a blocked
    tile. All names and in-game text must be English.

After approving the plan, send this:

    Create an importable world JSON from the approved plan.
    Reply with valid JSON only, with no Markdown or comments.

    Use exactly these top-level fields:
    version, name, width, height, floor, blocked, water, bridges, trees, roads,
    floors, houseWalls, castleWalls, windows, torches, terrainMaterials, objects,
    buildings, doors, stairs, spawns, resourceNodes, playerSpawn, npcs.

    The world is 35000 x 35000, but only write explicit tiles within
    X=[SET RANGE], Y=[SET RANGE]. Use z=7 unless it is stairs or an upper/lower
    floor. Use only the IDs listed in the guide and validate every rule before
    replying.

Ask for no more than roughly a 128 x 128 region in one JSON response. Import it,
inspect it in the editor, then expand from the natural roads, rivers and passes.
