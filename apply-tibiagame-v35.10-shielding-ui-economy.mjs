#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const MARKER = "TIBIAGAME_V35_10_SHIELDING_UI_ECONOMY";

const files = {
  app: "apps/client/src/App.tsx",
  inputTest: "apps/client/src/game/InputController.test.ts",
  worldTest: "apps/client/src/game/WorldState.test.ts",
  world: "crates/game-server/src/world.rs",
  items: "content/items/items.json",
  npcs: "content/npcs/npcs.json",
  recipes: "content/runes/runes.json",
};

const VENDOR_SELL_VALUES = {
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

for (const rel of Object.values(files)) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame repository root. Missing ${rel}`);
  }
}

const pending = new Map();
const eols = new Map();

function load(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}
function save(rel, text) { pending.set(rel, text); }

function replaceOnce(rel, oldText, newText, label, already = null) {
  let text = load(rel);
  if (already && text.includes(already)) {
    console.log(`  already: ${label}`);
    return false;
  }
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly one match in ${rel}, found ${count}. No files were written.`,
    );
  }
  save(rel, text.replace(oldText, newText));
  console.log(`  planned: ${label}`);
  return true;
}

function replaceAll(rel, oldText, newText, label, min = 1) {
  let text = load(rel);
  const count = text.split(oldText).length - 1;
  if (count === 0 && text.includes(newText)) {
    console.log(`  already: ${label}`);
    return 0;
  }
  if (count < min) {
    throw new Error(
      `${label}: expected at least ${min} match(es) in ${rel}, found ${count}. No files were written.`,
    );
  }
  save(rel, text.split(oldText).join(newText));
  console.log(`  planned: ${label} (${count} occurrence${count === 1 ? "" : "s"})`);
  return count;
}

function parseJson(rel) {
  try {
    return JSON.parse(load(rel));
  } catch (error) {
    throw new Error(`Could not parse ${rel}: ${error.message}. No files were written.`);
  }
}
function saveJson(rel, value) { save(rel, JSON.stringify(value, null, 2) + "\n"); }

console.log("Checking TibiaGame V35.10 Shielding UI + economy expansion...");

// ---------------------------------------------------------------------------
// A) Fix the release-blocking PlayerView test fixtures.
// ---------------------------------------------------------------------------
replaceAll(
  files.inputTest,
  `distanceSkill: 1, distanceTries: 0, fletchingSkill: 1`,
  `distanceSkill: 1, distanceTries: 0, shieldingSkill: 10, shieldingTries: 0, fletchingSkill: 1`,
  "add Shielding fields to InputController PlayerView fixtures",
  2,
);

replaceOnce(
  files.worldTest,
  `distanceSkill: 0, distanceTries: 0, fletchingSkill: 0,`,
  `distanceSkill: 0, distanceTries: 0, shieldingSkill: 10, shieldingTries: 0, fletchingSkill: 0,`,
  "add Shielding fields to WorldState PlayerView fixture",
  "shieldingSkill: 10, shieldingTries: 0",
);

// ---------------------------------------------------------------------------
// B) Guarantee Shielding is rendered by the real Skills panel.
// ---------------------------------------------------------------------------
let app = load(files.app);
if (!app.includes(MARKER)) {
  const anchor =
    app.includes("// TIBIAGAME_V35_7_CLEAN_ITEM_TOOLTIPS\n")
      ? "// TIBIAGAME_V35_7_CLEAN_ITEM_TOOLTIPS\n"
      : app.includes("// TIBIAGAME_V35_4_CHARACTER_PAPERDOLL\n")
        ? "// TIBIAGAME_V35_4_CHARACTER_PAPERDOLL\n"
        : null;
  app = anchor ? app.replace(anchor, `${anchor}// ${MARKER}\n`) : `// ${MARKER}\n${app}`;
  save(files.app, app);
  console.log("  planned: mark App.tsx V35.10");
}

app = load(files.app);
if (!app.includes('name="Shielding"')) {
  const distanceRow = `    <SkillRow name="Distance Skill" level={player.distanceSkill} tries={player.distanceTries} description="Advances when ammunition hits a creature." />`;
  if (!app.includes(distanceRow)) {
    throw new Error("Could not locate Distance Skill row. No files were written.");
  }
  app = app.replace(
    distanceRow,
    `${distanceRow}
    <SkillRow name="Shielding" level={player.shieldingSkill} tries={player.shieldingTries} description="Advances when a defensive off-hand absorbs creature attacks. Higher Shielding improves mitigation." />`,
  );
  save(files.app, app);
  console.log("  planned: show Shielding in Skills panel");
} else {
  console.log("  already: Shielding row exists in Skills panel");
}

app = load(files.app);
if (
  app.includes(`["Distance", player.distanceSkill],`)
  && !app.includes(`["Shielding", player.shieldingSkill],`)
) {
  app = app.replace(
    `    ["Distance", player.distanceSkill],
    ["Fletching", player.fletchingSkill],`,
    `    ["Distance", player.distanceSkill],
    ["Shielding", player.shieldingSkill],
    ["Fletching", player.fletchingSkill],`,
  );
  save(files.app, app);
  console.log("  planned: include Shielding in character skill summary");
}

// ---------------------------------------------------------------------------
// C) Intentional vendor sell values. This replaces the old weight fallback.
// Keep one mirrored table client/server until the economy gets its own
// server-sent catalog in a later milestone.
// ---------------------------------------------------------------------------
app = load(files.app);
if (!app.includes("const NPC_VENDOR_SELL_PRICES: Record<string, number>")) {
  const npcShopAnchor = `function NpcShop({ npcId }: { npcId: string }) {`;
  if (!app.includes(npcShopAnchor)) {
    throw new Error("Could not locate NpcShop. No files were written.");
  }
  const clientMap = `const NPC_VENDOR_SELL_PRICES: Record<string, number> = ${JSON.stringify(VENDOR_SELL_VALUES, null, 2)};

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

`;
  app = app.replace(npcShopAnchor, `${clientMap}${npcShopAnchor}`);
  save(files.app, app);
  console.log(`  planned: add ${Object.keys(VENDOR_SELL_VALUES).length} explicit client vendor values`);
}

replaceOnce(
  files.app,
  `  const sellableItems = world.inventory.filter((item) =>
    !item.equippedSlot
    && item.definitionId !== "gold_coin"
    && !world.inventory.some((child) => child.containerId === item.instanceId),
  );`,
  `  const sellableItems = world.inventory.filter((item) =>
    !item.equippedSlot
    && item.definitionId !== "gold_coin"
    && !world.inventory.some((child) => child.containerId === item.instanceId)
    && npcSellUnitPrice(npc, world.itemDefinitions.get(item.definitionId)) > 0,
  );`,
  "only list items the NPC actually buys",
  "npcSellUnitPrice(npc, world.itemDefinitions.get(item.definitionId)) > 0",
);

replaceOnce(
  files.app,
  `            const matchingOffer = npc.offers.find((offer) => offer.itemDefinitionId === item.definitionId);
            const sellPrice = Math.max(1, Math.floor(matchingOffer ? matchingOffer.price / 2 : Math.ceil(definition?.weight ?? 0)));
            const totalPrice = sellPrice * quantity;`,
  `            const sellPrice = npcSellUnitPrice(npc, definition);
            const totalPrice = sellPrice * quantity;`,
  "display the same explicit vendor price used by the server",
  "const sellPrice = npcSellUnitPrice(npc, definition);",
);

// Server mirror.
let world = load(files.world);
if (!world.includes("fn npc_vendor_sell_price(definition_id: &str) -> Option<u32>")) {
  const anchors = ["fn within_reach(", "fn tile_distance("];
  const anchor = anchors.find((candidate) => world.includes(candidate));
  if (!anchor) throw new Error("Could not locate world helper anchor. No files were written.");
  const rustHelper = `// ${MARKER}
fn npc_vendor_sell_price(definition_id: &str) -> Option<u32> {
    Some(match definition_id {
        "blank_rune" => 1,
        "traveler_blade" => 12,
        "ashwood_bow" => 24,
        "field_backpack" => 18,
        "mire_fiber" => 1,
        "field_bread" => 1,
        "smoked_mire_meat" => 3,
        "bog_ichor" => 5,
        "reed_hide" => 3,
        "fen_tusk" => 6,
        "worn_cap" => 2,
        "patched_tunic" => 5,
        "frayed_trousers" => 3,
        "work_boots" => 3,
        "wooden_buckler" => 5,
        "iron_pickaxe" => 14,
        "copper_ore" => 2,
        "iron_ore" => 4,
        "coal_chunk" => 2,
        "healing_herbs" => 2,
        "rope_bundle" => 2,
        "shovel" => 7,
        "leather_satchel" => 7,
        "iron_short_sword" => 32,
        "red_apple" => 1,
        "iron_battle_axe" => 42,
        "iron_war_hammer" => 55,
        "ironbound_shield" => 45,
        "iron_helmet" => 34,
        "studded_armor" => 44,
        "reinforced_boots" => 18,
        "emerald_ring" => 18,
        "ember_amulet" => 20,
        "mana_tonic" => 5,
        "iron_dagger" => 12,
        "rusty_mace" => 8,
        "hunting_spear" => 9,
        "woodsman_hatchet" => 9,
        "oak_staff" => 8,
        "traveler_cloak" => 7,
        "chain_coif" => 14,
        "leather_jerkin" => 26,
        "stitched_leggings" => 21,
        "round_kite_shield" => 16,
        "bronze_ring" => 4,
        "bone_amulet" => 6,
        "health_tonic" => 5,
        "antidote_vial" => 4,
        "bandage_roll" => 3,
        "dried_rations" => 2,
        "tin_ore" => 3,
        "copper_ingot" => 5,
        "tin_ingot" => 6,
        "iron_ingot" => 9,
        "beast_claw" => 4,
        "spider_silk" => 4,
        "mandrake_root" => 5,
        "wolf_pelt" => 6,
        "lantern_oil" => 2,
        "raw_hide" => 4,
        "duelist_blade" => 15,
        "parrying_dagger" => 8,
        "corsair_cutlass" => 21,
        "stiletto" => 5,
        "raider_hatchet" => 18,
        "hook_sabre" => 20,
        "fishing_rod" => 8,
        "miner_pickhammer" => 12,
        "smith_tongs" => 5,
        "skinning_knife" => 5,
        "grappling_hook" => 8,
        "hooded_lantern" => 7,
        "rope_coil" => 5,
        "repair_kit" => 6,
        "whetstone" => 2,
        "rat_tail" => 1,
        "rat_pelt" => 2,
        "mire_gland" => 3,
        "mire_spore_cluster" => 2,
        "skulker_venom_sac" => 7,
        "skulker_scale" => 3,
        "reed_sinew" => 3,
        "stalker_claw" => 7,
        "fen_brute_hide" => 8,
        "fen_brute_bone" => 7,
        "crypt_bone_shard" => 5,
        "grave_dust" => 4,
        "acolyte_focus_shard" => 9,
        "warden_core" => 30,
        "warden_plate_fragment" => 16,
        "mire_recovery_tonic" => 7,
        "purifying_tonic" => 9,
        "fen_marrow_stew" => 8,
        "graveward_tonic" => 12,
        "focus_draught" => 14,
        "warden_glow_charm" => 42,
        "rat_pelt_cap" => 9,
        "mireweave_cloak" => 18,
        "skulker_scale_vest" => 36,
        "fenhide_leggings" => 30,
        "fenhide_boots" => 24,
        "cryptbone_buckler" => 40,
        "warden_plate_helmet" => 95,
        "warden_plate_armor" => 200,
        "warden_plate_shield" => 150,
        "stalker_claw_blade" => 38,
        "fenbone_maul" => 52,
        "reed_sinew_bow" => 48,
        "acolyte_focus_amulet" => 45,
        "warden_core_hammer" => 110,
        _ => return None,
    })
}

`;
  world = world.replace(anchor, `${rustHelper}${anchor}`);
  save(files.world, world);
  console.log(`  planned: add ${Object.keys(VENDOR_SELL_VALUES).length} explicit server vendor values`);
}

replaceOnce(
  files.world,
  `        let unit_price = npc
            .offers
            .iter()
            .find(|offer| offer.item_definition_id == item.definition_id)
            .map(|offer| u32::from(offer.price) / 2)
            .unwrap_or_else(|| (definition.weight.ceil() as u32).max(1));
        let total = unit_price.saturating_mul(u32::from(quantity)).max(1);`,
  `        let unit_price = npc_vendor_sell_price(&item.definition_id)
            .or_else(|| {
                npc.offers
                    .iter()
                    .find(|offer| {
                        offer.item_definition_id == item.definition_id
                            && offer.quantity == 1
                            && offer.price >= 3
                    })
                    .map(|offer| (u32::from(offer.price) * 2 / 5).max(1))
            })
            .ok_or("item_not_sellable")?;
        let total = unit_price.saturating_mul(u32::from(quantity));`,
  "replace server weight-based sell pricing",
  'npc_vendor_sell_price(&item.definition_id)',
);

// ---------------------------------------------------------------------------
// D) Validate item ids used by the economy.
// ---------------------------------------------------------------------------
const items = parseJson(files.items);
if (!Array.isArray(items)) throw new Error("items.json must contain an array.");
const itemById = new Map(items.map((item) => [item.id, item]));
for (const id of Object.keys(VENDOR_SELL_VALUES)) {
  if (!itemById.has(id)) {
    throw new Error(`Vendor economy references missing item ${id}. No files were written.`);
  }
}
console.log(`  verified: all ${Object.keys(VENDOR_SELL_VALUES).length} vendor-priced item ids exist`);

// ---------------------------------------------------------------------------
// E) Rebalance Mara and widen the useful NPC stock.
// Better gear remains expensive enough that crafting/player trade has value.
// ---------------------------------------------------------------------------
const npcs = parseJson(files.npcs);
if (!Array.isArray(npcs)) throw new Error("npcs.json must contain an array.");
const mara = npcs.find((npc) => npc.id === "mara_quartermaster");
if (!mara || !Array.isArray(mara.offers)) {
  throw new Error("Mara quartermaster shop not found. No files were written.");
}

const buyPrices = {
  blank_rune: 3,
  rough_arrow: 6,
  field_bread: 4,
  worn_cap: 6,
  patched_tunic: 12,
  frayed_trousers: 9,
  work_boots: 9,
  wooden_buckler: 12,
  iron_pickaxe: 30,
  health_tonic: 12,
  antidote_vial: 10,
  bandage_roll: 8,
  dried_rations: 6,
  iron_dagger: 16,
  hunting_spear: 22,
  woodsman_hatchet: 22,
  oak_staff: 20,
  traveler_cloak: 18,
  leather_jerkin: 34,
  stitched_leggings: 24,
  round_kite_shield: 36,
  chain_coif: 30,
  bronze_ring: 12,
  bone_amulet: 18,
  lantern_oil: 5,
  fishhook_bundle: 4,
  lockpick_set: 20,
  duelist_blade: 36,
  parrying_dagger: 20,
  corsair_cutlass: 50,
  stiletto: 14,
  raider_hatchet: 42,
  hook_sabre: 48,
  fishing_rod: 24,
  tackle_box: 20,
  bait_bucket: 12,
  miner_pickhammer: 34,
  smith_tongs: 16,
  skinning_knife: 14,
  flint_and_steel: 6,
  grappling_hook: 24,
  hand_torch: 8,
  hooded_lantern: 18,
  rope_coil: 14,
  repair_kit: 18,
  whetstone: 7,
  bedroll: 14,
  waterskin: 9,
  candle_bundle: 5,
};

for (const offer of mara.offers) {
  const price = buyPrices[offer.itemDefinitionId];
  if (price !== undefined) offer.price = price;
}

const addedOffers = [
  ["field_backpack", 1, 28],
  ["mana_tonic", 1, 12],
  ["shovel", 1, 18],
  ["leather_satchel", 1, 16],
  ["traveler_blade", 1, 26],
  ["ashwood_bow", 1, 48],
  ["iron_short_sword", 1, 46],
  ["iron_battle_axe", 1, 64],
  ["iron_war_hammer", 1, 82],
  ["ironbound_shield", 1, 66],
  ["iron_helmet", 1, 50],
  ["studded_armor", 1, 88],
  ["reinforced_boots", 1, 36],
  ["red_apple", 3, 4],
  ["smoked_mire_meat", 1, 7],
];

for (const [itemDefinitionId, quantity, price] of addedOffers) {
  if (!itemById.has(itemDefinitionId)) {
    throw new Error(`Shop expansion references missing item ${itemDefinitionId}. No files were written.`);
  }
  if (!mara.offers.some((offer) => offer.itemDefinitionId === itemDefinitionId)) {
    mara.offers.push({
      id: `v3510_${itemDefinitionId}`,
      itemDefinitionId,
      quantity,
      price,
    });
  }
}
saveJson(files.npcs, npcs);
console.log(`  planned: rebalance Mara + add ${addedOffers.length} existing items to buy`);

// ---------------------------------------------------------------------------
// F) More useful recipes using current assets.
// The current recipe schema supports one material type per recipe.
// ---------------------------------------------------------------------------
const recipes = parseJson(files.recipes);
if (!Array.isArray(recipes)) throw new Error("runes.json must contain an array.");

const newRecipes = [
  { id: "forge_iron_dagger", name: "Forge Iron Dagger", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 1, outputDefinitionId: "iron_dagger", outputQuantity: 1, manaCost: 0, craftTimeMs: 1600, learnPrice: 8, requiredSkillLevel: 0 },
  { id: "forge_iron_short_sword", name: "Forge Iron Short Sword", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 3, outputDefinitionId: "iron_short_sword", outputQuantity: 1, manaCost: 0, craftTimeMs: 2300, learnPrice: 18, requiredSkillLevel: 4 },
  { id: "forge_iron_helmet", name: "Forge Iron Helmet", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 3, outputDefinitionId: "iron_helmet", outputQuantity: 1, manaCost: 0, craftTimeMs: 2400, learnPrice: 20, requiredSkillLevel: 6 },
  { id: "forge_iron_battle_axe", name: "Forge Iron Battle Axe", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 4, outputDefinitionId: "iron_battle_axe", outputQuantity: 1, manaCost: 0, craftTimeMs: 2800, learnPrice: 28, requiredSkillLevel: 8 },
  { id: "forge_ironbound_shield", name: "Forge Ironbound Shield", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 4, outputDefinitionId: "ironbound_shield", outputQuantity: 1, manaCost: 0, craftTimeMs: 2900, learnPrice: 30, requiredSkillLevel: 10 },
  { id: "forge_iron_war_hammer", name: "Forge Iron War Hammer", craftKind: "smithing", inputDefinitionId: "iron_ingot", inputQuantity: 5, outputDefinitionId: "iron_war_hammer", outputQuantity: 1, manaCost: 0, craftTimeMs: 3300, learnPrice: 36, requiredSkillLevel: 12 },
  { id: "stitch_leather_jerkin", name: "Stitch Leather Jerkin", craftKind: "leatherworking", inputDefinitionId: "raw_hide", inputQuantity: 5, outputDefinitionId: "leather_jerkin", outputQuantity: 1, manaCost: 0, craftTimeMs: 2100, learnPrice: 14, requiredSkillLevel: 4 },
  { id: "stitch_work_leggings", name: "Stitch Work Leggings", craftKind: "leatherworking", inputDefinitionId: "raw_hide", inputQuantity: 4, outputDefinitionId: "stitched_leggings", outputQuantity: 1, manaCost: 0, craftTimeMs: 2000, learnPrice: 16, requiredSkillLevel: 5 },
  { id: "stitch_reinforced_boots", name: "Stitch Reinforced Boots", craftKind: "leatherworking", inputDefinitionId: "raw_hide", inputQuantity: 3, outputDefinitionId: "reinforced_boots", outputQuantity: 1, manaCost: 0, craftTimeMs: 1900, learnPrice: 18, requiredSkillLevel: 7 },
  { id: "stitch_field_backpack", name: "Stitch Field Backpack", craftKind: "leatherworking", inputDefinitionId: "raw_hide", inputQuantity: 6, outputDefinitionId: "field_backpack", outputQuantity: 1, manaCost: 0, craftTimeMs: 2600, learnPrice: 24, requiredSkillLevel: 10 },
  { id: "brew_health_tonic", name: "Brew Health Tonic", craftKind: "alchemy", inputDefinitionId: "healing_herbs", inputQuantity: 3, outputDefinitionId: "health_tonic", outputQuantity: 1, manaCost: 0, craftTimeMs: 1500, learnPrice: 10, requiredSkillLevel: 0 },
  { id: "brew_mana_tonic", name: "Brew Mana Tonic", craftKind: "alchemy", inputDefinitionId: "mandrake_root", inputQuantity: 2, outputDefinitionId: "mana_tonic", outputQuantity: 1, manaCost: 0, craftTimeMs: 1800, learnPrice: 16, requiredSkillLevel: 5 },
  { id: "cook_dried_rations", name: "Prepare Dried Rations", craftKind: "cooking", inputDefinitionId: "smoked_mire_meat", inputQuantity: 1, outputDefinitionId: "dried_rations", outputQuantity: 2, manaCost: 0, craftTimeMs: 1400, learnPrice: 8, requiredSkillLevel: 0 },
];

for (const recipe of newRecipes) {
  for (const itemId of [recipe.inputDefinitionId, recipe.outputDefinitionId]) {
    if (!itemById.has(itemId)) {
      throw new Error(`Recipe ${recipe.id} references missing item ${itemId}. No files were written.`);
    }
  }
  if (!recipes.some((existing) => existing.id === recipe.id)) recipes.push(recipe);
}
saveJson(files.recipes, recipes);
console.log(`  planned: add ${newRecipes.length} low/mid-tier crafting recipes`);

const npcsUpdated = parseJson(files.npcs);
const orin = npcsUpdated.find((npc) => npc.id === "orin_artificer");
if (!orin || !Array.isArray(orin.recipeIds)) {
  throw new Error("Orin craft trainer not found. No files were written.");
}
for (const recipe of newRecipes) {
  if (!orin.recipeIds.includes(recipe.id)) orin.recipeIds.push(recipe.id);
}
saveJson(files.npcs, npcsUpdated);
console.log("  planned: teach all new recipes through Orin");

// ---------------------------------------------------------------------------
// G) Safety checks.
// ---------------------------------------------------------------------------
const appFinal = load(files.app);
const worldFinal = load(files.world);
const inputTestFinal = load(files.inputTest);
const worldTestFinal = load(files.worldTest);

const checks = [
  [appFinal.includes('name="Shielding"'), "Shielding row missing from SkillPanel"],
  [appFinal.includes("NPC_VENDOR_SELL_PRICES"), "client vendor-price table missing"],
  [appFinal.includes("npcSellUnitPrice(npc, definition)"), "shop does not use explicit sell prices"],
  [worldFinal.includes("fn npc_vendor_sell_price(definition_id: &str)"), "server vendor-price table missing"],
  [worldFinal.includes('.ok_or("item_not_sellable")?'), "server still permits implicit junk sale pricing"],
  [inputTestFinal.includes("shieldingSkill: 10, shieldingTries: 0"), "InputController fixtures still lack Shielding"],
  [worldTestFinal.includes("shieldingSkill: 10, shieldingTries: 0"), "WorldState fixture still lacks Shielding"],
];
for (const [ok, message] of checks) {
  if (!ok) throw new Error(`Post-check failed: ${message}. No files were written.`);
}

const finalRecipes = JSON.parse(load(files.recipes));
for (const recipe of newRecipes) {
  if (!finalRecipes.some((entry) => entry.id === recipe.id)) {
    throw new Error(`Post-check failed: missing recipe ${recipe.id}. No files were written.`);
  }
}
const finalNpcs = JSON.parse(load(files.npcs));
const finalOrin = finalNpcs.find((npc) => npc.id === "orin_artificer");
if (!finalOrin || !newRecipes.every((recipe) => finalOrin.recipeIds.includes(recipe.id))) {
  throw new Error("Post-check failed: Orin does not teach every new recipe. No files were written.");
}

console.log("  verified: Shielding fixtures + Skills UI");
console.log(`  verified: ${Object.keys(VENDOR_SELL_VALUES).length} intentional vendor values`);
console.log(`  verified: ${newRecipes.length} new recipes and Orin teaching list`);

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("V35.10 fixes release TS errors, Shielding visibility, and the first economy expansion.");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const filePath = path.join(ROOT, rel);
  const original = fs.readFileSync(filePath, "utf8");
  const eol = eols.get(rel) ?? "\n";
  const output = eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  if (output !== original) fs.writeFileSync(filePath, output, "utf8");
}

console.log("\nV35.10 applied successfully.");
console.log("- Release-blocking TypeScript PlayerView fixtures fixed.");
console.log("- Shielding is guaranteed visible in Skills.");
console.log("- Weight-based NPC sale pricing removed.");
console.log(`- ${Object.keys(VENDOR_SELL_VALUES).length} items have intentional sell values.`);
console.log(`- ${addedOffers.length} more existing items can be bought from Mara.`);
console.log(`- ${newRecipes.length} additional recipes are taught by Orin.`);
