// TIBIAGAME_V36_11_NATIVE_INTERACTION_FOUNDATION
// TIBIAGAME_V36_12_INTERACTION_ARCHITECTURE_FIX
use bevy::prelude::*;
use game_protocol::ClientMessage;
use game_types::{EntityId, Position};

use crate::{
    CreatureActor, MainCamera, MovementState, NativeNetwork, NpcActor,
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

pub fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
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
}

pub fn handle_pointer_interactions(
    buttons: Res<ButtonInput<MouseButton>>,
    window: Single<&Window>,
    camera_query: Query<(&Camera, &GlobalTransform), With<MainCamera>>,
    creatures: Query<(&CreatureActor, &GlobalTransform, &Visibility)>,
    resources: Query<(&WorldResource, &GlobalTransform, &Visibility)>,
    doors: Query<(&WorldDoor, &GlobalTransform, &Visibility)>,
    npcs: Query<(&NpcActor, &GlobalTransform, &Visibility)>,
    objects: Query<(&WorldObjectActor, &GlobalTransform, &Visibility)>,
    movement: Res<MovementState>,
    network: Res<NativeNetwork>,
    mut game_state: ResMut<NativeGameState>,
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
        interact_resource(&network, &movement, &mut game_state, &resource_id);
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
        interact_npc(&movement, &mut game_state, &npc_id);
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
    network: &NativeNetwork,
    movement: &MovementState,
    game_state: &mut NativeGameState,
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

    game_state.focus_npc(None);
    send(
        network,
        game_state,
        ClientMessage::MineResource {
            node_id: resource.id,
        },
    );
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

fn interact_npc(movement: &MovementState, game_state: &mut NativeGameState, npc_id: &str) {
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
