#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const VERSION = "36.35";

const UI = "crates/game-client/src/native_ui.rs";
const VERSION_FILE = "crates/game-client/src/version.rs";
const DOC = "docs/native-client-migration.md";

for (const rel of [UI, VERSION_FILE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`Run from tibiaCloneGame root after V36.34.1. Missing ${rel}`);
  }
}

console.log(`Checking TibiaGame V${VERSION} native crafting parity polish...`);

const pending = new Map();
const eols = new Map();

function read(rel) {
  if (pending.has(rel)) return pending.get(rel);
  const target = path.join(ROOT, rel);
  const raw = fs.readFileSync(target, "utf8");
  eols.set(rel, raw.includes("\r\n") ? "\r\n" : "\n");
  const text = raw.replace(/\r\n/g, "\n");
  pending.set(rel, text);
  return text;
}

function save(rel, text) {
  pending.set(rel, text);
}

function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) {
    throw new Error(`${label}: expected source anchor not found. No files were written.`);
  }
  return text.replace(before, after);
}

function replaceRange(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`${label}: start marker not found. No files were written.`);
  }

  const end = text.indexOf(endMarker, start);
  if (end < 0) {
    throw new Error(`${label}: end marker not found. No files were written.`);
  }

  return text.slice(0, start) + replacement + text.slice(end);
}

let ui = read(UI);

// ---------------------------------------------------------------------------
// NativePanelState: crafting category + requested quantity.
// ---------------------------------------------------------------------------
if (!ui.includes("pub crafting_category: usize,")) {
  ui = replaceOnce(
    ui,
    `    pub selected_recipe_id: Option<String>,
`,
    `    pub selected_recipe_id: Option<String>,
    pub crafting_category: usize,
    pub crafting_quantity: u16,
`,
    "crafting panel state",
  );
}

// ---------------------------------------------------------------------------
// Opening crafting initializes quantity and keeps selected category valid.
// ---------------------------------------------------------------------------
if (!ui.includes("normalize_crafting_category(&game_state, &mut panels);")) {
  ui = replaceOnce(
    ui,
    `    if keys.just_pressed(KeyCode::KeyB) {
        panels.crafting_open = !panels.crafting_open;
        panels.npc_open = false;
        if panels.crafting_open {
            panels.spells_open = false;
            ensure_recipe_selection(&game_state, &mut panels);
        }
    }`,
    `    if keys.just_pressed(KeyCode::KeyB) {
        panels.crafting_open = !panels.crafting_open;
        panels.npc_open = false;
        if panels.crafting_open {
            panels.spells_open = false;
            panels.crafting_quantity = panels.crafting_quantity.max(1);
            normalize_crafting_category(&game_state, &mut panels);
            ensure_recipe_selection(&game_state, &mut panels);
        }
    }`,
    "crafting panel open initialization",
  );
}

// ---------------------------------------------------------------------------
// Crafting input: category tabs + quantity + existing select/craft/cancel.
// ---------------------------------------------------------------------------
const oldCraftInput = `    if panels.crafting_open {
        ensure_recipe_selection(&game_state, &mut panels);

        if keys.just_pressed(KeyCode::ArrowDown) {
            step_recipe_selection(&game_state, &mut panels, 1);
        }
        if keys.just_pressed(KeyCode::ArrowUp) {
            step_recipe_selection(&game_state, &mut panels, -1);
        }

        if keys.just_pressed(KeyCode::KeyF) {
            craft_selected_recipe(
                &network,
                &mut game_state,
                &panels,
            );
        }

        if keys.just_pressed(KeyCode::KeyX) {
            if network
                .outbound
                .send(ClientMessage::CancelRuneCrafting)
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message("Cancel crafting requested.");
            }
        }
    }`;

const newCraftInput = `    if panels.crafting_open {
        normalize_crafting_category(&game_state, &mut panels);
        ensure_recipe_selection(&game_state, &mut panels);
        panels.crafting_quantity = panels.crafting_quantity.max(1);

        if keys.just_pressed(KeyCode::Tab) {
            cycle_crafting_category(&game_state, &mut panels);
            ensure_recipe_selection(&game_state, &mut panels);
        }

        if keys.just_pressed(KeyCode::ArrowDown) {
            step_recipe_selection(&game_state, &mut panels, 1);
        }
        if keys.just_pressed(KeyCode::ArrowUp) {
            step_recipe_selection(&game_state, &mut panels, -1);
        }

        if keys.just_pressed(KeyCode::ArrowLeft) {
            panels.crafting_quantity =
                panels.crafting_quantity.saturating_sub(1).max(1);
        }
        if keys.just_pressed(KeyCode::ArrowRight) {
            panels.crafting_quantity =
                panels.crafting_quantity.saturating_add(1).min(99);
        }

        if keys.just_pressed(KeyCode::KeyF) {
            craft_selected_recipe(
                &network,
                &mut game_state,
                &panels,
            );
        }

        if keys.just_pressed(KeyCode::KeyX) {
            if network
                .outbound
                .send(ClientMessage::CancelRuneCrafting)
                .is_err()
            {
                game_state.push_system_message("The game connection is offline.");
            } else {
                game_state.push_system_message("Cancel crafting requested.");
            }
        }

        // Crafting owns arrows/Tab/F/X while open.
        return;
    }`;

if (!ui.includes("cycle_crafting_category(&game_state, &mut panels);")) {
  const startMarker =
    "    if panels.crafting_open {\n        ensure_recipe_selection(&game_state, &mut panels);";
  const endMarker =
    "\n    if !panels.inventory_open {";

  const start = ui.indexOf(startMarker);
  if (start < 0) {
    throw new Error(
      "crafting input parity: crafting block start not found. No files were written.",
    );
  }

  const end = ui.indexOf(endMarker, start);
  if (end < 0) {
    throw new Error(
      "crafting input parity: inventory block boundary not found. No files were written.",
    );
  }

  ui =
    ui.slice(0, start)
    + newCraftInput
    + ui.slice(end);
}

// ---------------------------------------------------------------------------
// Replace recipe list/selection/craft helpers with category-aware variants.
// ---------------------------------------------------------------------------
const craftingHelpers = `fn crafting_categories(
    game_state: &NativeGameState,
) -> Vec<String> {
    let mut categories = vec!["all".to_owned()];

    let mut kinds: Vec<_> = game_state
        .rune_recipes
        .values()
        .map(|recipe| recipe.craft_kind.trim().to_ascii_lowercase())
        .filter(|kind| !kind.is_empty())
        .collect();

    kinds.sort();
    kinds.dedup();

    categories.extend(kinds);
    categories
}

fn normalize_crafting_category(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let categories = crafting_categories(game_state);

    if categories.is_empty() {
        panels.crafting_category = 0;
        return;
    }

    panels.crafting_category %= categories.len();
}

fn cycle_crafting_category(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let categories = crafting_categories(game_state);

    if categories.is_empty() {
        panels.crafting_category = 0;
        panels.selected_recipe_id = None;
        return;
    }

    panels.crafting_category =
        (panels.crafting_category + 1) % categories.len();
    panels.selected_recipe_id = None;
}

fn current_crafting_category<'a>(
    game_state: &'a NativeGameState,
    panels: &NativePanelState,
) -> String {
    let categories = crafting_categories(game_state);

    categories
        .get(panels.crafting_category.min(categories.len().saturating_sub(1)))
        .cloned()
        .unwrap_or_else(|| "all".into())
}

fn recipes_sorted(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> Vec<(String, String)> {
    let category =
        current_crafting_category(game_state, panels);

    let mut recipes: Vec<_> = game_state
        .rune_recipes
        .values()
        .filter(|recipe| {
            category == "all"
                || recipe
                    .craft_kind
                    .trim()
                    .eq_ignore_ascii_case(&category)
        })
        .map(|recipe| {
            (recipe.id.clone(), recipe.name.clone())
        })
        .collect();

    recipes.sort_by(|left, right| left.1.cmp(&right.1));
    recipes
}

fn ensure_recipe_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
) {
    let recipes = recipes_sorted(game_state, panels);

    if recipes.is_empty() {
        panels.selected_recipe_id = None;
        return;
    }

    if panels
        .selected_recipe_id
        .as_ref()
        .is_some_and(|selected| {
            recipes.iter().any(|(id, _)| id == selected)
        })
    {
        return;
    }

    let first_learned = recipes
        .iter()
        .find(|(id, _)| {
            game_state.learned_recipe_ids.contains(id)
        })
        .or_else(|| recipes.first());

    panels.selected_recipe_id =
        first_learned.map(|(id, _)| id.clone());
}

fn step_recipe_selection(
    game_state: &NativeGameState,
    panels: &mut NativePanelState,
    delta: isize,
) {
    let recipes = recipes_sorted(game_state, panels);

    if recipes.is_empty() {
        panels.selected_recipe_id = None;
        return;
    }

    let current = panels
        .selected_recipe_id
        .as_ref()
        .and_then(|selected| {
            recipes
                .iter()
                .position(|(id, _)| id == selected)
        })
        .unwrap_or(0) as isize;

    let len = recipes.len() as isize;
    let next =
        (current + delta).rem_euclid(len) as usize;

    panels.selected_recipe_id =
        Some(recipes[next].0.clone());
}

fn craft_selected_recipe(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    panels: &NativePanelState,
) {
    let Some(recipe_id) =
        panels.selected_recipe_id.clone()
    else {
        game_state.push_system_message(
            "No recipe selected.",
        );
        return;
    };

    if !game_state
        .learned_recipe_ids
        .contains(&recipe_id)
    {
        game_state.push_system_message(
            "That recipe has not been learned.",
        );
        return;
    }

    let Some(recipe) =
        game_state.rune_recipes.get(&recipe_id)
    else {
        game_state.push_system_message(
            "Unknown recipe.",
        );
        return;
    };

    let quantity =
        panels.crafting_quantity.max(1);

    let recipe_name = recipe.name.clone();
    let input_definition_id =
        recipe.input_definition_id.clone();
    let input_quantity = recipe.input_quantity;
    let mana_cost = recipe.mana_cost;

    let required_items =
        u64::from(input_quantity)
            .saturating_mul(u64::from(quantity));

    let carried =
        inventory_definition_quantity(
            game_state,
            &input_definition_id,
        );

    if carried < required_items {
        game_state.push_system_message(format!(
            "Not enough materials for {quantity} × {recipe_name}.",
        ));
        return;
    }

    let required_mana =
        u64::from(mana_cost)
            .saturating_mul(u64::from(quantity));

    let mana = game_state
        .local_player()
        .map(|player| u64::from(player.mana))
        .unwrap_or(0);

    if mana < required_mana {
        game_state.push_system_message(format!(
            "Not enough mana for {quantity} × {recipe_name}.",
        ));
        return;
    }

    if network
        .outbound
        .send(ClientMessage::StartRuneCrafting {
            recipe_id,
            quantity,
        })
        .is_err()
    {
        game_state.push_system_message(
            "The game connection is offline.",
        );
    } else {
        game_state.push_system_message(format!(
            "Crafting {quantity} × {recipe_name}.",
        ));
    }
}

`;

if (!ui.includes("fn crafting_categories(")) {
  ui = replaceRange(
    ui,
    "fn recipes_sorted(",
    "fn crafting_panel_text(",
    craftingHelpers,
    "crafting category/selection helpers",
  );
}

// ---------------------------------------------------------------------------
// Crafting panel/detail: category tabs, quantity, authoritative progress.
// ---------------------------------------------------------------------------
const craftingPanelFn = `fn crafting_panel_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let categories =
        crafting_categories(game_state);
    let category =
        current_crafting_category(game_state, panels);

    let recipes =
        recipes_sorted(game_state, panels);

    let learned = game_state
        .rune_recipes
        .keys()
        .filter(|id| {
            game_state.learned_recipe_ids.contains(*id)
        })
        .count();

    let category_tabs = categories
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let label =
                if value == "all" {
                    "All".into()
                } else {
                    title_case(value)
                };

            if index == panels.crafting_category {
                format!("[{label}]")
            } else {
                label
            }
        })
        .collect::<Vec<_>>()
        .join("  ·  ");

    let mut lines = vec![
        format!(
            "CRAFTING   ·   Learned {} / {}",
            learned,
            game_state.rune_recipes.len(),
        ),
        format!("Categories: {category_tabs}"),
        format!(
            "Category: {}   ·   Quantity ×{}",
            if category == "all" {
                "All".into()
            } else {
                title_case(&category)
            },
            panels.crafting_quantity.max(1),
        ),
        String::new(),
    ];

    if recipes.is_empty() {
        lines.push(
            "No recipes in this category.".into(),
        );
    } else {
        for (id, name) in recipes {
            let Some(recipe) =
                game_state.rune_recipes.get(&id)
            else {
                continue;
            };

            let marker =
                if panels
                    .selected_recipe_id
                    .as_deref()
                    == Some(id.as_str())
                {
                    "▶"
                } else {
                    " "
                };

            let learned_marker =
                if game_state
                    .learned_recipe_ids
                    .contains(&id)
                {
                    "✓"
                } else {
                    "×"
                };

            let input_name = game_state
                .item_definitions
                .get(&recipe.input_definition_id)
                .map(|definition| {
                    definition.name.as_str()
                })
                .unwrap_or(
                    recipe.input_definition_id.as_str(),
                );

            let output_name = game_state
                .item_definitions
                .get(&recipe.output_definition_id)
                .map(|definition| {
                    definition.name.as_str()
                })
                .unwrap_or(
                    recipe.output_definition_id.as_str(),
                );

            lines.push(format!(
                "{marker} {learned_marker} {:<19}  {}× {} → {}× {}",
                name,
                recipe.input_quantity,
                input_name,
                recipe.output_quantity,
                output_name,
            ));
        }
    }

    if let Some(crafting) =
        game_state.crafting.as_ref()
    {
        lines.push(String::new());

        let recipe_name = crafting
            .recipe_id
            .as_ref()
            .and_then(|id| {
                game_state.rune_recipes.get(id)
            })
            .map(|recipe| recipe.name.clone())
            .unwrap_or_else(|| {
                crafting
                    .recipe_id
                    .clone()
                    .unwrap_or_else(|| "Crafting".into())
            });

        lines.push(format!(
            "ACTIVE: {}   ·   remaining {}   ·   {}",
            recipe_name,
            crafting.remaining,
            title_case(&crafting.status),
        ));
    }

    lines.push(String::new());
    lines.push(
        "Tab Category   ·   ↑/↓ Recipe   ·   ←/→ Quantity"
            .into(),
    );
    lines.push(
        "F Craft selected quantity   ·   X Cancel"
            .into(),
    );
    lines.push("B Crafting   ·   Esc Close".into());

    lines.join("\\n")
}

`;

const craftingDetailFn = `fn crafting_detail_text(
    game_state: &NativeGameState,
    panels: &NativePanelState,
) -> String {
    let Some(recipe_id) =
        panels.selected_recipe_id.as_deref()
    else {
        return String::new();
    };

    let Some(recipe) =
        game_state.rune_recipes.get(recipe_id)
    else {
        return String::new();
    };

    let quantity =
        panels.crafting_quantity.max(1);

    let input_name = game_state
        .item_definitions
        .get(&recipe.input_definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| {
            recipe.input_definition_id.clone()
        });

    let output_name = game_state
        .item_definitions
        .get(&recipe.output_definition_id)
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| {
            recipe.output_definition_id.clone()
        });

    let carried =
        inventory_definition_quantity(
            game_state,
            &recipe.input_definition_id,
        );

    let required_items =
        u64::from(recipe.input_quantity)
            .saturating_mul(u64::from(quantity));

    let required_mana =
        u64::from(recipe.mana_cost)
            .saturating_mul(u64::from(quantity));

    let total_output =
        u64::from(recipe.output_quantity)
            .saturating_mul(u64::from(quantity));

    let learned =
        game_state
            .learned_recipe_ids
            .contains(recipe_id);

    format!(
        "{}\\n{}\\nBatch ×{}\\nInput: {} × {}   ·   carried {}   ·   required {}\\nOutput total: {} × {}\\nMana total {}   ·   time/craft {:.2}s   ·   required skill {}   ·   {}",
        recipe.name,
        title_case(&recipe.craft_kind),
        quantity,
        recipe.input_quantity,
        input_name,
        carried,
        required_items,
        total_output,
        output_name,
        required_mana,
        recipe.craft_time_ms as f32 / 1000.0,
        recipe.required_skill_level,
        if learned {
            "Learned"
        } else {
            "Not learned"
        },
    )
}

`;

if (!ui.includes("Categories: {category_tabs}")) {
  // V36.34.1 still has old signature.
  ui = replaceRange(
    ui,
    "fn crafting_panel_text(",
    "fn crafting_detail_text(",
    craftingPanelFn,
    "crafting panel renderer",
  );
}

if (!ui.includes("Batch ×{}")) {
  ui = replaceRange(
    ui,
    "fn crafting_detail_text(",
    "fn inventory_definition_quantity(",
    craftingDetailFn,
    "crafting detail renderer",
  );
}

// update_ui calls now pass panel state.
ui = replaceOnce(
  ui,
  `    let crafting_text =
        crafting_panel_text(&game_state, panel_state.selected_recipe_id.as_deref());
    let crafting_detail =
        crafting_detail_text(&game_state, panel_state.selected_recipe_id.as_deref());`,
  `    let crafting_text =
        crafting_panel_text(&game_state, &panel_state);
    let crafting_detail =
        crafting_detail_text(&game_state, &panel_state);`,
  "crafting update_ui state",
);

save(UI, ui);

// ---------------------------------------------------------------------------
// Version/docs.
// ---------------------------------------------------------------------------
let versionFile = read(VERSION_FILE);

if (versionFile.includes(
  'pub const MIGRATION_VERSION: &str = "36.35";'
)) {
  // already applied
} else if (versionFile.includes(
  'pub const MIGRATION_VERSION: &str = "36.34.1";'
)) {
  versionFile = versionFile.replace(
    'pub const MIGRATION_VERSION: &str = "36.34.1";',
    'pub const MIGRATION_VERSION: &str = "36.35";',
  );
} else {
  throw new Error(
    `${VERSION_FILE} is not on V36.34.1. No files were written.`,
  );
}

save(VERSION_FILE, versionFile);

if (fs.existsSync(path.join(ROOT, DOC))) {
  let doc = read(DOC);
  const marker =
    "<!-- TIBIAGAME_V36_35_NATIVE_CRAFTING_PARITY_POLISH -->";

  if (!doc.includes(marker)) {
    doc += `

${marker}

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
`;
    save(DOC, doc);
  }
}

// ---------------------------------------------------------------------------
// Structural checks.
// ---------------------------------------------------------------------------
const finalUi = read(UI);
const finalVersion = read(VERSION_FILE);

const checks = [
  [
    finalUi.includes("pub crafting_category: usize,"),
    "crafting category state missing",
  ],
  [
    finalUi.includes("pub crafting_quantity: u16,"),
    "crafting quantity state missing",
  ],
  [
    finalUi.includes("fn crafting_categories("),
    "crafting categories helper missing",
  ],
  [
    finalUi.includes("cycle_crafting_category(&game_state, &mut panels);"),
    "crafting category input missing",
  ],
  [
    finalUi.includes("panels.crafting_quantity.saturating_add(1).min(99)"),
    "crafting quantity increment missing",
  ],
  [
    finalUi.includes("quantity,"),
    "StartRuneCrafting quantity integration missing",
  ],
  [
    finalUi.includes("required_items"),
    "batch material preflight missing",
  ],
  [
    finalUi.includes("required_mana"),
    "batch mana preflight missing",
  ],
  [
    finalUi.includes("crafting.remaining")
      && finalUi.includes("crafting.status"),
    "authoritative crafting progress display missing",
  ],
  [
    finalUi.includes("crafting.remaining"),
    "crafting remaining count display missing",
  ],
  [
    finalUi.includes("crafting.status"),
    "crafting status display missing",
  ],
  [
    finalVersion.includes(
      'pub const MIGRATION_VERSION: &str = "36.35";'
    ),
    "version is not V36.35",
  ],
];

for (const [ok, message] of checks) {
  if (!ok) {
    throw new Error(
      `Post-check failed: ${message}. No files were written.`,
    );
  }
}

if (CHECK) {
  console.log("\nCHECK PASSED. No files were written.");
  console.log("- dynamic crafting categories");
  console.log("- Tab category cycle");
  console.log("- Left/Right batch quantity 1..99");
  console.log("- authoritative StartRuneCrafting quantity");
  console.log("- batch material + mana preflight");
  console.log("- active crafting progress/status");
  console.log("- no world/floor/creature safety changes");
  process.exit(0);
}

for (const [rel, normalized] of pending) {
  const target = path.join(ROOT, rel);

  const original = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : "";

  const eol = eols.get(rel) ?? "\n";

  const clean = normalized
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "\n");

  const output =
    eol === "\r\n"
      ? clean.replace(/\n/g, "\r\n")
      : clean;

  if (output !== original) {
    fs.writeFileSync(target, output, "utf8");
  }
}

console.log(`\nV${VERSION} applied successfully.`);
console.log("- Native crafting category/quantity/progress polish added.");
