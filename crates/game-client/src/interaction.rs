// TIBIAGAME_V36_11_NATIVE_INTERACTION_FOUNDATION
// TIBIAGAME_V36_12_INTERACTION_ARCHITECTURE_FIX
use bevy::prelude::*;
use game_protocol::ClientMessage;
use game_types::{EntityId, Position};

use crate::{
    CreatureActor, MainCamera, MovementState, NativeNetwork, NpcActor,
    native_ui::NativePanelState,
    state::{NativeGameState, NativeMessageKind},
    world_details::{WorldDoor, WorldObjectActor, WorldResource},
};

// Screen-space radii are intentional. Projecting an isometric cursor ray to
// y=0 made clicks miss elevated sprites, doors and props even when the cursor
// was visually on top of them.
const CREATURE_PICK_RADIUS_PX: f32 = 42.0;
const RESOURCE_PICK_RADIUS_PX: f32 = 38.0;
const DOOR_PICK_RADIUS_PX: f32 = 38.0;
const NPC_PICK_RADIUS_PX: f32 = 38.0;
const OBJECT_PICK_RADIUS_PX: f32 = 36.0;
const ATTACK_REPEAT_SECONDS: f64 = 0.150;
const MINING_DURATION_SECONDS: f32 = 1.6;
const MINING_RESULT_SECONDS: f32 = 2.8;

#[derive(Default)]
pub(crate) struct AttackRepeatState {
    target_id: Option<EntityId>,
    next_send_at: f64,
}

#[derive(Component)]
pub(crate) struct TargetIndicator;

#[derive(Component)]
pub(crate) struct NativeTargetHud;

#[derive(Component)]
pub(crate) struct NativeFeedHud;

#[derive(Component)]
pub(crate) struct MiningProgressHud;

#[derive(Component)]
pub(crate) struct MiningProgressFill;

#[derive(Component)]
pub(crate) struct MiningProgressText;

#[derive(Component)]
pub(crate) struct WorldHoverTooltip;

#[derive(Component)]
pub(crate) struct WorldHoverTooltipText;

#[derive(Resource)]
pub(crate) struct MiningAction {
    node_id: Option<String>,
    node_position: Option<Position>,
    timer: Timer,
    result_timer: Timer,
    result_text: Option<String>,
}

impl Default for MiningAction {
    fn default() -> Self {
        Self {
            node_id: None,
            node_position: None,
            timer: Timer::from_seconds(MINING_DURATION_SECONDS, TimerMode::Once),
            result_timer: Timer::from_seconds(MINING_RESULT_SECONDS, TimerMode::Once),
            result_text: None,
        }
    }
}

pub fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.insert_resource(MiningAction::default());

    let indicator_mesh = meshes.add(Circle::new(0.76));
    let indicator_material = materials.add(StandardMaterial {
        base_color: Color::srgba(0.98, 0.07, 0.03, 0.56),
        alpha_mode: AlphaMode::Blend,
        double_sided: true,
        cull_mode: None,
        perceptual_roughness: 1.0,
        ..default()
    });

    commands.spawn((
        Name::new("Native attack target indicator"),
        TargetIndicator,
        Mesh3d(indicator_mesh),
        MeshMaterial3d(indicator_material),
        Transform::from_rotation(Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2))
            .with_translation(Vec3::new(0.0, 0.075, 0.0)),
        Visibility::Hidden,
    ));

    commands.spawn((
        Name::new("Native target HUD"),
        NativeTargetHud,
        Visibility::Hidden,
        Text::new(""),
        TextFont {
            font_size: FontSize::Px(18.0),
            ..default()
        },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            top: px(12),
            right: px(12),
            ..default()
        },
    ));

    commands.spawn((
        Name::new("Native message feed"),
        NativeFeedHud,
        Visibility::Hidden,
        Text::new(""),
        TextFont {
            font_size: FontSize::Px(16.0),
            ..default()
        },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            bottom: px(14),
            left: px(14),
            ..default()
        },
    ));

    commands
        .spawn((
            Name::new("Mining progress"),
            MiningProgressHud,
            GlobalZIndex(700),
            Node {
                position_type: PositionType::Absolute,
                left: percent(50.0),
                bottom: px(150),
                width: px(320),
                height: px(48),
                margin: UiRect::left(px(-160)),
                padding: UiRect::all(px(7)),
                border: UiRect::all(px(1)),
                flex_direction: FlexDirection::Column,
                row_gap: px(5),
                ..default()
            },
            BackgroundColor(Color::srgba(0.015, 0.025, 0.018, 0.95)),
            BorderColor::all(Color::srgb(0.72, 0.54, 0.16)),
            Visibility::Hidden,
        ))
        .with_children(|panel| {
            panel.spawn((
                MiningProgressText,
                Text::new("MINING"),
                TextFont {
                    font_size: FontSize::Px(11.0),
                    ..default()
                },
                TextColor(Color::srgb(0.95, 0.78, 0.34)),
            ));
            panel
                .spawn((
                    Node {
                        width: percent(100.0),
                        height: px(11),
                        border: UiRect::all(px(1)),
                        ..default()
                    },
                    BackgroundColor(Color::srgb(0.035, 0.06, 0.045)),
                    BorderColor::all(Color::srgb(0.34, 0.43, 0.35)),
                ))
                .with_child((
                    MiningProgressFill,
                    Node {
                        width: percent(0.0),
                        height: percent(100.0),
                        ..default()
                    },
                    BackgroundColor(Color::srgb(0.76, 0.39, 0.10)),
                ));
        });

    commands
        .spawn((
            Name::new("World hover tooltip"),
            WorldHoverTooltip,
            GlobalZIndex(850),
            Node {
                position_type: PositionType::Absolute,
                width: px(238),
                padding: UiRect::all(px(8)),
                border: UiRect::all(px(1)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.012, 0.022, 0.016, 0.96)),
            BorderColor::all(Color::srgb(0.72, 0.54, 0.16)),
            Visibility::Hidden,
        ))
        .with_child((
            WorldHoverTooltipText,
            Text::new(""),
            TextFont {
                font_size: FontSize::Px(10.0),
                ..default()
            },
            TextColor(Color::srgb(0.90, 0.88, 0.78)),
        ));
}

pub fn handle_pointer_interactions(
    buttons: Res<ButtonInput<MouseButton>>,
    window: Single<&Window>,
    camera_query: Query<(&Camera, &GlobalTransform), With<MainCamera>>,
    creatures: Query<
        (&CreatureActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    resources: Query<
        (&WorldResource, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    doors: Query<
        (&WorldDoor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    npcs: Query<
        (&NpcActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    objects: Query<
        (&WorldObjectActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    movement: Res<MovementState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut panels: ResMut<NativePanelState>,
    mut mining: ResMut<MiningAction>,
) {
    let left_click = buttons.just_pressed(MouseButton::Left);
    let right_click = buttons.just_pressed(MouseButton::Right);
    if !left_click && !right_click {
        return;
    }

    let Some((camera, camera_transform)) = camera_query.iter().next() else {
        return;
    };
    let Some(cursor) = window.cursor_position() else {
        return;
    };

    // world_to_viewport and Window::cursor_position both use logical viewport
    // coordinates. Scale the tolerance with the window height because the
    // orthographic world itself becomes larger in pixels when the window grows.
    let pick_scale = (window.height() / 800.0).clamp(0.72, 2.40);

    let creature_id = nearest_screen(
        cursor,
        camera,
        camera_transform,
        CREATURE_PICK_RADIUS_PX * pick_scale,
        creatures
            .iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(actor, transform, _)| (actor.0, transform.translation(), 0.42)),
    );

    // Creatures always win an overlapping pick. Both mouse buttons select and
    // attack for now; a proper context menu can be layered on later.
    if let Some(target_id) = creature_id {
        select_and_attack(&network, &mut game_state, target_id);
        return;
    }

    // Make the first native interaction pass intuitive: doors, resources,
    // NPCs and inspectable props work with either left or right click.
    if let Some(resource_id) = nearest_screen(
        cursor,
        camera,
        camera_transform,
        RESOURCE_PICK_RADIUS_PX * pick_scale,
        resources
            .iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(resource, transform, _)| {
                (
                    resource.id.clone(),
                    transform.translation() + Vec3::Y * 0.38,
                    0.38,
                )
            }),
    ) {
        interact_resource(&movement, &mut game_state, &mut mining, &resource_id);
        return;
    }

    if let Some((door_id, door_position)) = nearest_screen(
        cursor,
        camera,
        camera_transform,
        DOOR_PICK_RADIUS_PX * pick_scale,
        doors
            .iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(door, transform, _)| {
                (
                    (door.id.clone(), door.position),
                    transform.translation(),
                    0.44,
                )
            }),
    ) {
        interact_door(
            &network,
            &movement,
            &mut game_state,
            &door_id,
            door_position,
        );
        return;
    }

    if let Some(npc_id) = nearest_screen(
        cursor,
        camera,
        camera_transform,
        NPC_PICK_RADIUS_PX * pick_scale,
        npcs.iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(npc, transform, _)| (npc.0.clone(), transform.translation(), 0.44)),
    ) {
        interact_npc(&movement, &mut game_state, &mut panels, &npc_id);
        return;
    }

    if let Some((object_id, object_position)) = nearest_screen(
        cursor,
        camera,
        camera_transform,
        OBJECT_PICK_RADIUS_PX * pick_scale,
        objects
            .iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(object, transform, _)| {
                (
                    (object.id.clone(), object.position),
                    transform.translation() + Vec3::Y * 0.34,
                    0.34,
                )
            }),
    ) {
        interact_world_object(
            &network,
            &movement,
            &mut game_state,
            &object_id,
            object_position,
        );
        return;
    }

    if left_click {
        game_state.set_attack_target(None);
    } else {
        game_state.push_system_message("Nothing interactable under the cursor.");
    }
}

fn select_and_attack(
    network: &NativeNetwork,
    game_state: &mut NativeGameState,
    target_id: EntityId,
) {
    let Some(creature) = game_state.creatures.get(&target_id).cloned() else {
        game_state.push_system_message("That creature is no longer here.");
        game_state.set_attack_target(None);
        return;
    };

    if creature.health == 0 || creature.state == "dead" {
        game_state.push_system_message(format!("{} is already dead.", creature.name));
        game_state.set_attack_target(None);
        return;
    }

    let changed = game_state.attack_target_id != Some(target_id);
    game_state.set_attack_target(Some(target_id));
    game_state.focus_npc(None);

    if changed {
        game_state.push_system_message(format!("Targeting {}.", creature.name));
    }

    send(
        network,
        game_state,
        ClientMessage::AttackRequest { target_id },
    );
}

pub fn repeat_attack_intent(
    time: Res<Time>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut repeat: Local<AttackRepeatState>,
) {
    let now = time.elapsed_secs_f64();
    let target_id = game_state.attack_target_id;

    if repeat.target_id != target_id {
        repeat.target_id = target_id;
        repeat.next_send_at = now + ATTACK_REPEAT_SECONDS;
        return;
    }

    let Some(target_id) = target_id else {
        repeat.next_send_at = 0.0;
        return;
    };

    let alive = game_state
        .creatures
        .get(&target_id)
        .is_some_and(|creature| creature.health > 0 && creature.state != "dead");

    if !alive {
        game_state.set_attack_target(None);
        repeat.target_id = None;
        repeat.next_send_at = 0.0;
        return;
    }

    if now < repeat.next_send_at {
        return;
    }

    repeat.next_send_at = now + ATTACK_REPEAT_SECONDS;
    send(
        &network,
        &mut game_state,
        ClientMessage::AttackRequest { target_id },
    );
}

fn interact_resource(
    movement: &MovementState,
    game_state: &mut NativeGameState,
    mining: &mut MiningAction,
    resource_id: &str,
) {
    let Some(resource) = game_state.resource_nodes.get(resource_id).cloned() else {
        game_state.push_system_message("That resource is no longer available.");
        return;
    };

    if !resource.available {
        game_state.push_system_message("That resource is depleted.");
        return;
    }

    if !within_one_tile(movement.logical, resource.position) {
        game_state.push_system_message("That resource is too far away.");
        return;
    }

    let mining_selected = game_state.local_player().is_some_and(|player| {
        player
            .secondary_skills
            .iter()
            .any(|skill| skill == "mining")
    });
    if resource.kind.contains("ore")
        || resource.kind.contains("vein")
        || resource.kind.contains("copper")
    {
        if !mining_selected {
            game_state.push_system_message("Mining is not selected as a profession.");
            return;
        }
    }

    if mining.node_id.is_some() {
        game_state.push_system_message("You are already mining.");
        return;
    }

    game_state.focus_npc(None);
    mining.node_id = Some(resource.id);
    mining.node_position = Some(resource.position);
    mining.result_text = None;
    mining.timer.reset();
    game_state.push_system_message("Mining started.");
}

fn interact_door(
    network: &NativeNetwork,
    movement: &MovementState,
    game_state: &mut NativeGameState,
    door_id: &str,
    position: Position,
) {
    if !within_one_tile(movement.logical, position) {
        game_state.push_system_message("That door is too far away.");
        return;
    }

    game_state.focus_npc(None);
    send(
        network,
        game_state,
        ClientMessage::ToggleDoor {
            door_id: door_id.to_owned(),
        },
    );
}

fn interact_npc(
    movement: &MovementState,
    game_state: &mut NativeGameState,
    panels: &mut NativePanelState,
    npc_id: &str,
) {
    let Some(npc) = game_state.npcs.get(npc_id).cloned() else {
        game_state.push_system_message("That NPC is no longer here.");
        return;
    };

    if !within_one_tile(movement.logical, npc.position) {
        game_state.push_system_message(format!("{} is too far away.", npc.name));
        return;
    }

    game_state.set_attack_target(None);
    game_state.focus_npc(Some(npc.id.clone()));
    crate::native_ui::open_npc_panel(game_state, panels, npc.id.clone());
    game_state.push_system_message(format!("{} — {}: {}", npc.name, npc.title, npc.dialogue,));
}

fn interact_world_object(
    network: &NativeNetwork,
    movement: &MovementState,
    game_state: &mut NativeGameState,
    object_id: &str,
    position: Position,
) {
    if !within_one_tile(movement.logical, position) {
        game_state.push_system_message("That object is too far away.");
        return;
    }

    game_state.focus_npc(None);
    send(
        network,
        game_state,
        ClientMessage::InspectWorldObject {
            object_id: object_id.to_owned(),
        },
    );
}

pub fn update_mining_progress(
    time: Res<Time>,
    movement: Res<MovementState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
    mut mining: ResMut<MiningAction>,
    mut ui: ParamSet<(
        Query<(&mut Node, &mut Visibility), With<MiningProgressHud>>,
        Query<&mut Node, With<MiningProgressFill>>,
        Query<&mut Text, With<MiningProgressText>>,
    )>,
) {
    if let Some(result) = game_state.pending_mining_result.take() {
        mining.result_text = Some(result);
        mining.result_timer.reset();
    }

    let mut visible = false;
    let mut fraction = 0.0;
    let mut label = String::new();

    if let (Some(node_id), Some(node_position)) = (mining.node_id.clone(), mining.node_position) {
        if !within_one_tile(movement.logical, node_position) {
            mining.node_id = None;
            mining.node_position = None;
            game_state.push_system_message("Mining cancelled because you moved away.");
        } else {
            mining.timer.tick(time.delta());
            fraction = (mining.timer.elapsed_secs() / MINING_DURATION_SECONDS).clamp(0.0, 1.0);
            label = format!(
                "MINING COPPER  ·  {:>3}%",
                (fraction * 100.0).round() as u32
            );
            visible = true;

            if mining.timer.just_finished() {
                mining.node_id = None;
                mining.node_position = None;
                send(
                    &network,
                    &mut game_state,
                    ClientMessage::MineResource { node_id },
                );
            }
        }
    }

    if let Some(result) = mining.result_text.clone() {
        mining.result_timer.tick(time.delta());
        label = result;
        fraction = 1.0;
        visible = true;
        if mining.result_timer.just_finished() {
            mining.result_text = None;
            visible = false;
        }
    }

    if let Ok((_, mut visibility)) = ui.p0().single_mut() {
        *visibility = if visible {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
    if let Ok(mut fill) = ui.p1().single_mut() {
        fill.width = percent(fraction * 100.0);
    }
    if let Ok(mut text) = ui.p2().single_mut() {
        text.0 = label;
    }
}

pub fn update_world_hover_tooltip(
    window: Single<&Window>,
    camera_query: Query<(&Camera, &GlobalTransform), With<MainCamera>>,
    game_state: Res<NativeGameState>,
    creatures: Query<
        (&CreatureActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    resources: Query<
        (&WorldResource, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    doors: Query<
        (&WorldDoor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    npcs: Query<
        (&NpcActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    objects: Query<
        (&WorldObjectActor, &GlobalTransform, &Visibility),
        (Without<WorldHoverTooltip>, Without<WorldHoverTooltipText>),
    >,
    mut tooltip: Query<
        (
            Option<&WorldHoverTooltip>,
            Option<&WorldHoverTooltipText>,
            &mut Node,
            Option<&mut Text>,
            &mut Visibility,
        ),
        Or<(With<WorldHoverTooltip>, With<WorldHoverTooltipText>)>,
    >,
) {
    let Some(cursor) = window.cursor_position() else {
        for (root, _, _, _, mut visibility) in &mut tooltip {
            if root.is_some() {
                *visibility = Visibility::Hidden;
            }
        }
        return;
    };
    let Some((camera, camera_transform)) = camera_query.iter().next() else {
        return;
    };
    let pick_scale = (window.height() / 800.0).clamp(0.72, 2.40);

    let text = nearest_screen(
        cursor,
        camera,
        camera_transform,
        CREATURE_PICK_RADIUS_PX * pick_scale,
        creatures
            .iter()
            .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
            .map(|(actor, transform, _)| (actor.0, transform.translation(), 0.42)),
    )
    .and_then(|id| game_state.creatures.get(&id))
    .map(|creature| {
        let immunity = if creature.immune { "  ·  IMMUNE" } else { "" };
        format!(
            "{}\nENEMY  ·  HP {}/{}\nStatus: {}{}\nClick to target and attack",
            creature.name.to_uppercase(),
            creature.health,
            creature.max_health,
            creature.state,
            immunity,
        )
    })
    .or_else(|| {
        nearest_screen(
            cursor,
            camera,
            camera_transform,
            RESOURCE_PICK_RADIUS_PX * pick_scale,
            resources
                .iter()
                .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
                .map(|(resource, transform, _)| {
                    (
                        resource.id.clone(),
                        transform.translation() + Vec3::Y * 0.38,
                        0.38,
                    )
                }),
        )
        .and_then(|id| game_state.resource_nodes.get(&id))
        .map(|resource| {
            let status = if resource.available {
                "Ready to mine"
            } else {
                "Depleted"
            };
            format!(
                "{}\nRESOURCE  ·  {}\nRequired Mining: {}\nRespawn: {}s",
                display_kind(&resource.kind),
                status,
                resource.required_skill_level,
                resource.respawn_ms / 1_000,
            )
        })
    })
    .or_else(|| {
        nearest_screen(
            cursor,
            camera,
            camera_transform,
            DOOR_PICK_RADIUS_PX * pick_scale,
            doors
                .iter()
                .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
                .map(|(door, transform, _)| (door.id.clone(), transform.translation(), 0.44)),
        )
        .and_then(|id| doors.iter().find(|(door, _, _)| door.id == id))
        .map(|(door, _, _)| {
            format!(
                "DOOR\n{}\nStatus: {}\nClick to {}",
                door.id,
                if door.open { "Open" } else { "Closed" },
                if door.open { "close" } else { "open" },
            )
        })
    })
    .or_else(|| {
        nearest_screen(
            cursor,
            camera,
            camera_transform,
            NPC_PICK_RADIUS_PX * pick_scale,
            npcs.iter()
                .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
                .map(|(npc, transform, _)| (npc.0.clone(), transform.translation(), 0.44)),
        )
        .and_then(|id| game_state.npcs.get(&id))
        .map(|npc| {
            format!(
                "{}\n{}\n{}\nClick to talk",
                npc.name.to_uppercase(),
                npc.title,
                npc.service
            )
        })
    })
    .or_else(|| {
        nearest_screen(
            cursor,
            camera,
            camera_transform,
            OBJECT_PICK_RADIUS_PX * pick_scale,
            objects
                .iter()
                .filter(|(_, _, visibility)| **visibility != Visibility::Hidden)
                .map(|(object, transform, _)| {
                    (
                        object.id.clone(),
                        transform.translation() + Vec3::Y * 0.34,
                        0.34,
                    )
                }),
        )
        .map(|id| format!("WORLD OBJECT\n{}\nClick to inspect", display_kind(&id)))
    });

    if let Some(text_value) = text {
        for (root, text_marker, mut node, text, mut visibility) in &mut tooltip {
            if root.is_some() {
                node.left = px((cursor.x + 16.0).min((window.width() - 250.0).max(8.0)));
                node.top = px((cursor.y + 16.0).min((window.height() - 120.0).max(8.0)));
                *visibility = Visibility::Inherited;
            }
            if text_marker.is_some()
                && let Some(mut text) = text
            {
                text.0 = text_value.clone();
            }
        }
    } else {
        for (root, _, _, _, mut visibility) in &mut tooltip {
            if root.is_some() {
                *visibility = Visibility::Hidden;
            }
        }
    }
}

fn display_kind(kind: &str) -> String {
    kind.split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn sync_target_visual(
    time: Res<Time>,
    game_state: Res<NativeGameState>,
    creatures: Query<(&CreatureActor, &GlobalTransform)>,
    mut indicator: Query<(&mut Transform, &mut Visibility), With<TargetIndicator>>,
) {
    let Some((mut transform, mut visibility)) = indicator.iter_mut().next() else {
        return;
    };

    let Some(target_id) = game_state.attack_target_id else {
        *visibility = Visibility::Hidden;
        return;
    };

    let Some((_, target_transform)) = creatures.iter().find(|(actor, _)| actor.0 == target_id)
    else {
        *visibility = Visibility::Hidden;
        return;
    };

    let position = target_transform.translation();
    let pulse = 1.0 + (time.elapsed_secs() * 5.0).sin() * 0.065;
    transform.translation = Vec3::new(position.x, 0.075, position.z);
    transform.rotation = Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2);
    transform.scale = Vec3::splat(pulse);
    *visibility = Visibility::Inherited;
}

pub fn update_hud(
    game_state: Res<NativeGameState>,
    mut target_hud: Query<&mut Text, With<NativeTargetHud>>,
    mut feed_hud: Query<&mut Text, (With<NativeFeedHud>, Without<NativeTargetHud>)>,
) {
    if !game_state.is_changed() {
        return;
    }

    if let Some(mut text) = target_hud.iter_mut().next() {
        text.0 = game_state
            .attack_target_id
            .and_then(|target_id| game_state.creatures.get(&target_id))
            .map(|creature| {
                format!(
                    "TARGET · {}\nHP {}/{} · {}",
                    creature.name, creature.health, creature.max_health, creature.state,
                )
            })
            .unwrap_or_default();
    }

    if let Some(mut text) = feed_hud.iter_mut().next() {
        if game_state.latest_message().is_none() {
            text.0.clear();
            return;
        }

        let mut lines: Vec<String> = game_state
            .messages
            .iter()
            .rev()
            .take(7)
            .map(|line| format!("{} {}", message_prefix(line.kind), line.text))
            .collect();
        lines.reverse();
        text.0 = lines.join("\n");
    }
}

fn send(network: &NativeNetwork, game_state: &mut NativeGameState, message: ClientMessage) -> bool {
    if network.outbound.send(message).is_ok() {
        true
    } else {
        game_state.push_system_message("The game connection is offline.");
        false
    }
}

// Screen-space selection is the important V36.12 change. Each object gets a
// short vertical pick segment so clicking the visible body works even though
// an isometric camera shifts elevated geometry away from its ground tile.
fn nearest_screen<T: Clone>(
    cursor: Vec2,
    camera: &Camera,
    camera_transform: &GlobalTransform,
    radius_px: f32,
    candidates: impl Iterator<Item = (T, Vec3, f32)>,
) -> Option<T> {
    let max_distance = radius_px * radius_px;
    let mut best: Option<(T, f32)> = None;

    for (value, center, half_height) in candidates {
        let mut candidate_distance = f32::INFINITY;

        for y_offset in [-half_height, 0.0, half_height] {
            let world_position = center + Vec3::Y * y_offset;
            let Ok(screen_position) = camera.world_to_viewport(camera_transform, world_position)
            else {
                continue;
            };

            candidate_distance = candidate_distance.min(screen_position.distance_squared(cursor));
        }

        if candidate_distance > max_distance {
            continue;
        }

        if best
            .as_ref()
            .is_none_or(|(_, current)| candidate_distance < *current)
        {
            best = Some((value, candidate_distance));
        }
    }

    best.map(|(value, _)| value)
}

fn within_one_tile(player: Position, target: Position) -> bool {
    player.z == target.z && (player.x - target.x).abs() <= 1 && (player.y - target.y).abs() <= 1
}

fn message_prefix(kind: NativeMessageKind) -> &'static str {
    match kind {
        NativeMessageKind::Chat => "[Chat]",
        NativeMessageKind::System => "[System]",
        NativeMessageKind::Loot => "[Loot]",
        NativeMessageKind::Combat => "[Combat]",
        NativeMessageKind::Discovery => "[Discovery]",
        NativeMessageKind::Error => "[Error]",
    }
}
