#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const PATCH = "TIBIAGAME_V36_63_0_CONNECTION_ERRORS_COPPER_VEINS";

function fail(message) {
  console.error(`\n${PATCH} FAILED: ${message}`);
  process.exit(1);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) {
    if (source.includes(after)) return source;
    fail(`Could not find expected source for ${label}. Repository is not at the expected V36.62.0 baseline.`);
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    fail(`Expected source for ${label} occurs more than once; refusing an ambiguous patch.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patchFile(relativePath, edits) {
  const path = join(root, relativePath);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${relativePath}: ${error.message}`);
  }

  let next = source;
  for (const [label, before, after] of edits) {
    next = replaceOnce(next, before, after, `${relativePath} · ${label}`);
  }

  if (!checkOnly && next !== source) {
    writeFileSync(path, next, "utf8");
  }

  return next !== source;
}

console.log(`${PATCH}`);
console.log(checkOnly ? "Mode: precheck only" : "Mode: apply");

const launcherChanged = patchFile("crates/game-client/src/native_launcher.rs", [
  [
    "version marker",
    `// TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY\n`,
    `// TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY\n// ${PATCH}\n`,
  ],
  [
    "login helper copy",
    `Text::new("Click a field or press Tab | Enter logs in"),`,
    `Text::new("Click a field or press Tab | Enter logs in | Enter retries connection errors"),`,
  ],
  [
    "error keyboard behavior",
    `        LauncherMode::Error => {\n            if keys.just_pressed(KeyCode::Enter)\n                || keys.just_pressed(KeyCode::Escape)\n                || keys.just_pressed(KeyCode::Backspace)\n            {\n                state.mode = LauncherMode::Login;\n                state.pending_login = None;\n                state.login = None;\n                state.status = "Try logging in again.".into();\n            }\n        }`,
    `        LauncherMode::Error => {\n            if keys.just_pressed(KeyCode::Enter) {\n                if updater.blocks_online_play() {\n                    state.status = updater.gate_message().into();\n                    return;\n                }\n\n                begin_login(&mut state);\n            } else if keys.just_pressed(KeyCode::Escape)\n                || keys.just_pressed(KeyCode::Backspace)\n            {\n                state.mode = LauncherMode::Login;\n                state.pending_login = None;\n                state.login = None;\n                state.status = "Edit your account details and try again.".into();\n            }\n        }`,
  ],
  [
    "focus account after error",
    `                    LauncherAction::FocusAccount => {\n                        if state.mode == LauncherMode::Login {\n                            state.field = LoginField::Account;\n                        }\n                    }`,
    `                    LauncherAction::FocusAccount => {\n                        if matches!(state.mode, LauncherMode::Login | LauncherMode::Error) {\n                            if state.mode == LauncherMode::Error {\n                                state.mode = LauncherMode::Login;\n                                state.status = "Edit your account details and try again.".into();\n                            }\n                            state.field = LoginField::Account;\n                        }\n                    }`,
  ],
  [
    "focus password after error",
    `                    LauncherAction::FocusPassword => {\n                        if state.mode == LauncherMode::Login {\n                            state.field = LoginField::Password;\n                        }\n                    }`,
    `                    LauncherAction::FocusPassword => {\n                        if matches!(state.mode, LauncherMode::Login | LauncherMode::Error) {\n                            if state.mode == LauncherMode::Error {\n                                state.mode = LauncherMode::Login;\n                                state.status = "Edit your account details and try again.".into();\n                            }\n                            state.field = LoginField::Password;\n                        }\n                    }`,
  ],
  [
    "login button retries errors",
    `                    LauncherAction::Login => {\n                        if state.mode == LauncherMode::Login {\n                            if updater.blocks_online_play() {\n                                state.status = updater.gate_message().into();\n                            } else {\n                                begin_login(&mut state);\n                            }\n                        }\n                    }`,
    `                    LauncherAction::Login => {\n                        if matches!(state.mode, LauncherMode::Login | LauncherMode::Error) {\n                            if updater.blocks_online_play() {\n                                state.status = updater.gate_message().into();\n                            } else {\n                                begin_login(&mut state);\n                            }\n                        }\n                    }`,
  ],
  [
    "keep graphical login visible on errors",
    `    let show_form = matches!(state.mode, LauncherMode::Login | LauncherMode::LoggingIn);`,
    `    let show_form = matches!(\n        state.mode,\n        LauncherMode::Login | LauncherMode::LoggingIn | LauncherMode::Error\n    );`,
  ],
  [
    "error field focus",
    `        let active = state.mode == LauncherMode::Login && frame.0 == state.field;`,
    `        let active = matches!(state.mode, LauncherMode::Login | LauncherMode::Error)\n            && frame.0 == state.field;`,
  ],
  [
    "error status color",
    `                color.0 = if state.mode == LauncherMode::LoggingIn {\n                    theme::GOLD\n                } else if state.status.to_ascii_lowercase().contains("error") {\n                    Color::srgb(0.82, 0.28, 0.22)\n                } else {\n                    theme::MUTED\n                };`,
    `                color.0 = if state.mode == LauncherMode::LoggingIn {\n                    theme::GOLD\n                } else if state.mode == LauncherMode::Error {\n                    Color::srgb(0.90, 0.36, 0.26)\n                } else {\n                    theme::MUTED\n                };`,
  ],
  [
    "friendly error classifier",
    `fn begin_login(state: &mut NativeLauncherState) {`,
    `fn launcher_login_error(error: &str) -> String {\n    let detail = error.to_ascii_lowercase();\n\n    if detail.contains("invalid_credentials")\n        || detail.contains("invalid account")\n        || detail.contains("unauthorized")\n        || detail.contains("login rejected")\n    {\n        return "LOGIN FAILED\\nThe account name or password is incorrect.\\nError code: ALD-1005".into();\n    }\n\n    if detail.contains("timed out") || detail.contains("timeout") {\n        return "CONNECTION TIMED OUT\\nThe Aldoria servers did not respond in time. Please try again.\\nError code: ALD-1002".into();\n    }\n\n    if detail.contains("connection refused")\n        || detail.contains("os error 10061")\n        || detail.contains("tcp connect")\n        || detail.contains("could not reach the login endpoint")\n        || detail.contains("failed to connect")\n    {\n        return "UNABLE TO CONNECT\\nThe Aldoria servers are currently unavailable. Please try again shortly.\\nError code: ALD-1001".into();\n    }\n\n    if detail.contains("http 5") || detail.contains("server error") {\n        return "REALM UNAVAILABLE\\nThe Aldoria realm is temporarily unavailable. Please try again shortly.\\nError code: ALD-1003".into();\n    }\n\n    "CONNECTION ERROR\\nA connection problem occurred. Please try again.\\nError code: ALD-1000".into()\n}\n\nfn begin_login(state: &mut NativeLauncherState) {`,
  ],
  [
    "hide raw login errors",
    `        Err(error) => {\n            state.mode = LauncherMode::Error;\n            state.status = error;\n        }\n    }\n}\n\nfn begin_create_character`,
    `        Err(error) => {\n            error!("ALDORIA LOGIN FAILURE · {error}");\n            state.mode = LauncherMode::Error;\n            state.status = launcher_login_error(&error);\n        }\n    }\n}\n\nfn begin_create_character`,
  ],
]);

const worldDetailsChanged = patchFile("crates/game-client/src/world_details.rs", [
  [
    "version marker",
    `use std::collections::HashMap;\n`,
    `// ${PATCH}\nuse std::collections::HashMap;\n`,
  ],
  [
    "copper accent component",
    `#[derive(Component)]\npub struct WorldObjectActor {`,
    `#[derive(Component)]\npub struct WorldResourceCopperAccent {\n    pub id: String,\n}\n\n#[derive(Component)]\npub struct WorldObjectActor {`,
  ],
  [
    "copper material handle",
    `    flame: Handle<StandardMaterial>,\n    facade_plaster: Handle<StandardMaterial>,`,
    `    flame: Handle<StandardMaterial>,\n    copper_ore: Handle<StandardMaterial>,\n    facade_plaster: Handle<StandardMaterial>,`,
  ],
  [
    "copper material",
    `            flame: materials.add(StandardMaterial {\n                base_color: Color::srgb(1.0, 0.46, 0.08),\n                perceptual_roughness: 0.42,\n                ..default()\n            }),\n            facade_plaster: materials.add(StandardMaterial {`,
    `            flame: materials.add(StandardMaterial {\n                base_color: Color::srgb(1.0, 0.46, 0.08),\n                perceptual_roughness: 0.42,\n                ..default()\n            }),\n            copper_ore: materials.add(StandardMaterial {\n                base_color: Color::srgb(0.92, 0.36, 0.09),\n                metallic: 0.48,\n                perceptual_roughness: 0.31,\n                ..default()\n            }),\n            facade_plaster: materials.add(StandardMaterial {`,
  ],
  [
    "resource scene helper",
    `    fn prop_scene(&self, kind: &str) -> Option<Handle<WorldAsset>> {\n        self.prop_scenes.get(kind).cloned()\n    }\n}`,
    `    fn prop_scene(&self, kind: &str) -> Option<Handle<WorldAsset>> {\n        self.prop_scenes.get(kind).cloned()\n    }\n\n    pub fn resource_scene(&self, available: bool) -> Handle<WorldAsset> {\n        if available {\n            self.copper_vein.clone()\n        } else {\n            self.copper_vein_depleted.clone()\n        }\n    }\n}`,
  ],
  [
    "active copper vein appearance",
    `pub fn spawn_resource(\n    commands: &mut Commands,\n    catalog: &WorldDetailCatalog,\n    resource: &ResourceNodeView,\n) -> Entity {\n    let scene = if resource.available {\n        catalog.copper_vein.clone()\n    } else {\n        catalog.copper_vein_depleted.clone()\n    };\n\n    commands\n        .spawn((\n            Name::new(format!(\n                "Resource Model · {} · {}",\n                resource.kind, resource.id\n            )),\n            ResourceActor,\n            WorldResource {\n                id: resource.id.clone(),\n                position: resource.position,\n            },\n            WorldAssetRoot(scene),\n            Transform::from_xyz(resource.position.x as f32, 0.02, resource.position.y as f32)\n                .with_scale(Vec3::splat(0.86)),\n            Visibility::default(),\n        ))\n        .id()\n}`,
    `pub fn spawn_resource(\n    commands: &mut Commands,\n    catalog: &WorldDetailCatalog,\n    resource: &ResourceNodeView,\n) -> Entity {\n    let scene = catalog.resource_scene(resource.available);\n\n    commands\n        .spawn((\n            Name::new(format!(\n                "Resource Model · {} · {}",\n                resource.kind, resource.id\n            )),\n            ResourceActor,\n            WorldResource {\n                id: resource.id.clone(),\n                position: resource.position,\n            },\n            WorldAssetRoot(scene),\n            Transform::from_xyz(resource.position.x as f32, 0.02, resource.position.y as f32)\n                .with_scale(Vec3::splat(0.86)),\n            Visibility::default(),\n        ))\n        .with_children(|parent| {\n            // The authored GLB has a CopperGlow mesh, but at the gameplay camera\n            // angle it can disappear into the stone. These small ore outcrops\n            // deliberately read from above and from both diagonal camera sides.\n            for (index, (translation, scale)) in [\n                (Vec3::new(-0.18, 0.46, -0.08), Vec3::new(0.18, 0.10, 0.13)),\n                (Vec3::new(0.12, 0.49, 0.05), Vec3::new(0.15, 0.09, 0.12)),\n                (Vec3::new(0.27, 0.31, -0.13), Vec3::new(0.12, 0.08, 0.10)),\n                (Vec3::new(-0.28, 0.29, 0.14), Vec3::new(0.13, 0.08, 0.11)),\n                (Vec3::new(0.02, 0.36, 0.25), Vec3::new(0.11, 0.07, 0.10)),\n            ]\n            .into_iter()\n            .enumerate()\n            {\n                parent.spawn((\n                    Name::new(format!("Copper ore accent · {} · {index}", resource.id)),\n                    WorldResourceCopperAccent {\n                        id: resource.id.clone(),\n                    },\n                    Mesh3d(catalog.rock_mesh.clone()),\n                    MeshMaterial3d(catalog.copper_ore.clone()),\n                    Transform {\n                        translation,\n                        rotation: Quat::from_rotation_y(index as f32 * 0.73),\n                        scale,\n                    },\n                    if resource.available {\n                        Visibility::Visible\n                    } else {\n                        Visibility::Hidden\n                    },\n                ));\n            }\n        })\n        .id()\n}`,
  ],
]);

const mainChanged = patchFile("crates/game-client/src/main.rs", [
  [
    "pump marker",
    `// TIBIAGAME_V36_8_4_PUMP_NETWORK_PARAMSET_FIX\n// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE\nfn pump_network(`,
    `// TIBIAGAME_V36_8_4_PUMP_NETWORK_PARAMSET_FIX\n// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE\n// ${PATCH}\nfn pump_network(`,
  ],
  [
    "world detail catalog system param",
    `    mut collision: ResMut<collision::LocalCollision>,\n    mut movement: ResMut<MovementState>,\n    mut actor_queries: ParamSet<(`,
    `    mut collision: ResMut<collision::LocalCollision>,\n    mut movement: ResMut<MovementState>,\n    world_detail_catalog: Res<world_details::WorldDetailCatalog>,\n    mut actor_queries: ParamSet<(`,
  ],
  [
    "resource visual queries",
    `        Query<&mut world_details::WorldDoor>,\n    )>,`,
    `        Query<&mut world_details::WorldDoor>,\n        Query<(&world_details::WorldResource, &mut WorldAssetRoot)>,\n        Query<(&world_details::WorldResourceCopperAccent, &mut Visibility)>,\n    )>,`,
  ],
  [
    "resource state visual synchronization",
    `            ServerMessage::WindowChanged { window } => {\n                let mut windows = actor_queries.p1();\n                world_details::apply_window_change(&window, &mut windows);\n            }\n            ServerMessage::CombatEffect { source_id, .. } => {`,
    `            ServerMessage::WindowChanged { window } => {\n                let mut windows = actor_queries.p1();\n                world_details::apply_window_change(&window, &mut windows);\n            }\n            ServerMessage::ResourceNodesChanged { resource_nodes } => {\n                {\n                    let mut roots = actor_queries.p4();\n                    for (resource, mut root) in &mut roots {\n                        let Some(node) = resource_nodes\n                            .iter()\n                            .find(|node| node.id == resource.id)\n                        else {\n                            continue;\n                        };\n\n                        root.0 = world_detail_catalog.resource_scene(node.available);\n                    }\n                }\n\n                {\n                    let mut accents = actor_queries.p5();\n                    for (accent, mut visibility) in &mut accents {\n                        let Some(node) = resource_nodes\n                            .iter()\n                            .find(|node| node.id == accent.id)\n                        else {\n                            continue;\n                        };\n\n                        *visibility = if node.available {\n                            Visibility::Visible\n                        } else {\n                            Visibility::Hidden\n                        };\n                    }\n                }\n            }\n            ServerMessage::CombatEffect { source_id, .. } => {`,
  ],
]);

const versionChanged = patchFile("crates/game-client/src/version.rs", [
  [
    "migration version",
    `// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE\npub const MIGRATION_VERSION: &str = "36.62.0";`,
    `// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE\n// ${PATCH}\npub const MIGRATION_VERSION: &str = "36.63.0";`,
  ],
]);

const changed = [launcherChanged, worldDetailsChanged, mainChanged, versionChanged].filter(Boolean).length;
console.log(`Files ${checkOnly ? "that would change" : "changed"}: ${changed}`);
console.log("Fixes:");
console.log("  - Friendly MMO-style login connection errors; raw reqwest/TCP details stay in logs.");
console.log("  - Error state remains on the graphical login form and Enter retries.");
console.log("  - Active copper veins get clearly visible copper ore accents.");
console.log("  - ResourceNodesChanged now swaps full/depleted models and accent visibility immediately.");
console.log("  - Native migration version -> 36.63.0.");
console.log(checkOnly ? "\nPATCH PRECHECK OK" : "\nPATCH APPLY OK");
