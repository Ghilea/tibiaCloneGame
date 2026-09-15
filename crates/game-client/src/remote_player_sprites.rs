// TIBIAGAME_V36_91_REMOTE_PLAYER_SPRITES
// TIBIAGAME_V36_92_REMOTE_EQUIPMENT_REPLICATION
use std::collections::HashSet;

use bevy::{camera::visibility::NoFrustumCulling, prelude::*};
use game_types::{EntityId, Position};

use crate::{
    MainCamera, MovementState,
    actor_sprites::{ActorAnimation, SpriteDirection, atlas_uv, billboard_rotation, face_direction},
    player_sprites::{self, PlayerSpriteCatalog},
    state::NativeGameState,
};

const REMOTE_TILE_STEP_SECONDS: f64 = 0.165;
const REMOTE_DIAGONAL_FACTOR: f64 = std::f64::consts::SQRT_2;

const REMOTE_EQUIPMENT_LAYER_ORDER: [&str; 12] = [
    "back",
    "backpack",
    "chest",
    "legs",
    "feet",
    "helmet",
    "amulet",
    "ring",
    "weapon_melee",
    "weapon_ranged",
    "offhand_guard",
    "offhand_light",
];

#[derive(Component)]
pub(crate) struct RemotePlayerSprite {
    player_id: EntityId,
    logical_position: Position,
    direction: SpriteDirection,
    animation: ActorAnimation,
    animation_started_at: f64,
    move_from: Vec3,
    move_to: Vec3,
    move_started_at: f64,
    move_duration: f64,
    last_combat_sequence: u64,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: ActorAnimation,
    outfit: String,
    material: Handle<StandardMaterial>,
}

#[derive(Component)]
pub(crate) struct RemotePlayerEquipmentLayer {
    player_id: EntityId,
    key: String,
    material: Handle<StandardMaterial>,
}

pub(crate) fn sync_remote_player_sprites(
    mut commands: Commands,
    time: Res<Time>,
    movement: Res<MovementState>,
    game_state: Res<NativeGameState>,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut remotes: Query<(
        Entity,
        &mut RemotePlayerSprite,
        &mut Transform,
        &mut Visibility,
    )>,
) {
    let now = time.elapsed_secs_f64();
    let mut existing = HashSet::new();

    for (entity, mut sprite, mut transform, mut visibility) in &mut remotes {
        if sprite.player_id == game_state.local_player_id {
            commands.entity(entity).despawn();
            continue;
        }

        let Some(player) = game_state.players.get(&sprite.player_id) else {
            commands.entity(entity).despawn();
            continue;
        };
        existing.insert(sprite.player_id);

        *visibility = if player.position.z == movement.logical.z {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

        if sprite.outfit != player.outfit {
            sprite.outfit = player.outfit.clone();
            if let Some(mut material) = materials.get_mut(&sprite.material) {
                material.base_color = player_sprites::outfit_tint(&sprite.outfit);
            }
        }

        if sprite.logical_position != player.position {
            let previous = sprite.logical_position;
            sprite.logical_position = player.position;
            sprite.move_from = transform.translation;
            sprite.move_to = remote_world_position(
                player.position,
                catalog.body_actor().definition.render_height,
            );
            sprite.move_started_at = now;

            let dx = player.position.x - previous.x;
            let dy = player.position.y - previous.y;
            sprite.move_duration = if dx != 0 && dy != 0 {
                REMOTE_TILE_STEP_SECONDS * REMOTE_DIAGONAL_FACTOR
            } else {
                REMOTE_TILE_STEP_SECONDS
            };
            sprite.direction = SpriteDirection::from_delta(dx, dy, sprite.direction);

            if !animation_locked(&sprite, &catalog, now)
                && catalog
                    .body_actor()
                    .definition
                    .spec(ActorAnimation::Walk)
                    .is_some()
            {
                set_animation(&mut sprite, ActorAnimation::Walk, now);
            }
        }

        let progress = if sprite.move_duration <= f64::EPSILON {
            1.0
        } else {
            ((now - sprite.move_started_at) / sprite.move_duration).clamp(0.0, 1.0)
        };
        transform.translation = sprite.move_from.lerp(sprite.move_to, progress as f32);

        let dead = player.health == 0;
        if dead {
            sprite.last_combat_sequence = game_state.combat_visual_sequence;
            if sprite.animation != ActorAnimation::Death
                && catalog
                    .body_actor()
                    .definition
                    .spec(ActorAnimation::Death)
                    .is_some()
            {
                set_animation(&mut sprite, ActorAnimation::Death, now);
            }
        } else {
            if sprite.animation == ActorAnimation::Death {
                set_animation(&mut sprite, ActorAnimation::Idle, now);
            }

            let previous_sequence = sprite.last_combat_sequence;
            let mut newest_sequence = previous_sequence;

            for combat in game_state
                .combat_visuals
                .iter()
                .filter(|combat| combat.sequence > previous_sequence)
            {
                newest_sequence = newest_sequence.max(combat.sequence);

                if combat.source_id == sprite.player_id {
                    if let Some(target) = entity_position(&game_state, combat.target_id) {
                        sprite.direction =
                            face_direction(sprite.logical_position, target, sprite.direction);
                    }

                    let requested = if game_state.spells.contains_key(&combat.effect_id) {
                        ActorAnimation::Cast
                    } else {
                        ActorAnimation::Attack
                    };
                    if catalog.body_actor().definition.spec(requested).is_some() {
                        trigger_animation(&mut sprite, requested, now);
                    }
                } else if combat.target_id == sprite.player_id {
                    if let Some(source) = entity_position(&game_state, combat.source_id) {
                        sprite.direction =
                            face_direction(sprite.logical_position, source, sprite.direction);
                    }

                    if catalog
                        .body_actor()
                        .definition
                        .spec(ActorAnimation::Hit)
                        .is_some()
                    {
                        trigger_animation(&mut sprite, ActorAnimation::Hit, now);
                    }
                }
            }
            sprite.last_combat_sequence = newest_sequence;

            if progress >= 1.0 && !animation_locked(&sprite, &catalog, now) {
                if sprite.animation != ActorAnimation::Idle {
                    set_animation(&mut sprite, ActorAnimation::Idle, now);
                }
            }
        }

        update_material(&mut sprite, &catalog, &mut materials, now);
    }

    for player in game_state.players.values() {
        if player.id == game_state.local_player_id || existing.contains(&player.id) {
            continue;
        }

        spawn_remote_player(
            &mut commands,
            &catalog,
            &mut materials,
            player.id,
            &player.outfit,
            player.position,
            player.position.z == movement.logical.z,
            now,
        );
    }
}

pub(crate) fn sync_remote_player_equipment_layers(
    time: Res<Time>,
    game_state: Res<NativeGameState>,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    bodies: Query<&RemotePlayerSprite>,
    mut layers: Query<(&RemotePlayerEquipmentLayer, &mut Visibility)>,
) {
    let now = time.elapsed_secs_f64();

    for (layer, mut visibility) in &mut layers {
        let Some(body) = bodies
            .iter()
            .find(|body| body.player_id == layer.player_id)
        else {
            *visibility = Visibility::Hidden;
            continue;
        };

        let active = game_state
            .player_equipment_visuals
            .get(&layer.player_id)
            .is_some_and(|keys| keys.iter().any(|key| key == &layer.key));

        *visibility = if active {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

        if !active {
            continue;
        }

        let Some(actor) = catalog.equipment_actor(&layer.key) else {
            continue;
        };
        let definition = &actor.definition;

        let animation = if definition.spec(body.animation).is_some()
            && actor.texture(body.animation).is_some()
        {
            body.animation
        } else {
            ActorAnimation::Idle
        };

        let Some(spec) = definition.spec(animation) else {
            continue;
        };
        let Some(texture) = actor.texture(animation) else {
            continue;
        };

        let frame = spec.frame_at((now - body.animation_started_at).max(0.0));
        let Some(mut material) = materials.get_mut(&layer.material) else {
            continue;
        };

        material.base_color_texture = Some(texture.clone());
        material.normal_map_texture = actor.normal(animation).cloned();
        material.uv_transform = atlas_uv(
            spec.columns,
            definition.atlas_rows,
            frame,
            body.direction.atlas_row(definition.authored_directions),
        );
    }
}

fn spawn_remote_player(
    commands: &mut Commands,
    catalog: &PlayerSpriteCatalog,
    materials: &mut Assets<StandardMaterial>,
    player_id: EntityId,
    outfit: &str,
    position: Position,
    visible_on_floor: bool,
    now: f64,
) {
    let actor = catalog.body_actor();
    let definition = &actor.definition;
    let idle = definition
        .spec(ActorAnimation::Idle)
        .expect("validated player actor must define idle");
    let idle_texture = actor
        .texture(ActorAnimation::Idle)
        .expect("validated player actor must load idle texture");

    let material = materials.add(StandardMaterial {
        base_color: player_sprites::outfit_tint(outfit),
        base_color_texture: Some(idle_texture.clone()),
        normal_map_texture: actor.normal(ActorAnimation::Idle).cloned(),
        uv_transform: atlas_uv(
            idle.columns,
            definition.atlas_rows,
            0,
            SpriteDirection::South.atlas_row(definition.authored_directions),
        ),
        perceptual_roughness: 0.9,
        metallic: 0.0,
        unlit: true,
        alpha_mode: AlphaMode::Mask(0.05),
        double_sided: true,
        cull_mode: None,
        ..default()
    });

    let world_position = remote_world_position(position, definition.render_height);

    let root = commands
        .spawn((
            Name::new(format!("Remote Player Sprite · {player_id}")),
            RemotePlayerSprite {
                player_id,
                logical_position: position,
                direction: SpriteDirection::South,
                animation: ActorAnimation::Idle,
                animation_started_at: now,
                move_from: world_position,
                move_to: world_position,
                move_started_at: now,
                move_duration: 0.0,
                last_combat_sequence: 0,
                last_frame: usize::MAX,
                last_direction: SpriteDirection::North,
                last_animation: ActorAnimation::Death,
                outfit: outfit.to_owned(),
                material: material.clone(),
            },
            NoFrustumCulling,
            Mesh3d(catalog.body_quad()),
            MeshMaterial3d(material),
            Transform {
                translation: world_position,
                rotation: Quat::from_rotation_y(std::f32::consts::PI),
                scale: Vec3::new(definition.render_width, definition.render_height, 1.0),
            },
            if visible_on_floor {
                Visibility::Visible
            } else {
                Visibility::Hidden
            },
        ))
        .id();

    spawn_remote_equipment_layers(commands, catalog, materials, root, player_id);
}

fn spawn_remote_equipment_layers(
    commands: &mut Commands,
    catalog: &PlayerSpriteCatalog,
    materials: &mut Assets<StandardMaterial>,
    root: Entity,
    player_id: EntityId,
) {
    for key in REMOTE_EQUIPMENT_LAYER_ORDER {
        let Some(actor) = catalog.equipment_actor(key) else {
            warn!("ALDORIA REMOTE EQUIPMENT · missing actor key={key}");
            continue;
        };
        let definition = &actor.definition;
        let idle = definition
            .spec(ActorAnimation::Idle)
            .expect("validated equipment actor must define idle");
        let idle_texture = actor
            .texture(ActorAnimation::Idle)
            .expect("validated equipment actor must load idle texture");

        let material = materials.add(StandardMaterial {
            base_color: Color::WHITE,
            base_color_texture: Some(idle_texture.clone()),
            normal_map_texture: actor.normal(ActorAnimation::Idle).cloned(),
            uv_transform: atlas_uv(
                idle.columns,
                definition.atlas_rows,
                0,
                SpriteDirection::South.atlas_row(definition.authored_directions),
            ),
            perceptual_roughness: 0.9,
            metallic: 0.0,
            unlit: true,
            alpha_mode: AlphaMode::Mask(0.05),
            double_sided: true,
            cull_mode: None,
            depth_bias: player_sprites::equipment_layer_depth_bias(key),
            ..default()
        });

        commands.spawn((
            Name::new(format!("Remote Player Equipment · {player_id} · {key}")),
            RemotePlayerEquipmentLayer {
                player_id,
                key: key.to_owned(),
                material: material.clone(),
            },
            NoFrustumCulling,
            ChildOf(root),
            Mesh3d(catalog.body_quad()),
            MeshMaterial3d(material),
            Transform::default(),
            Visibility::Hidden,
        ));
    }
}

fn update_material(
    sprite: &mut RemotePlayerSprite,
    catalog: &PlayerSpriteCatalog,
    materials: &mut Assets<StandardMaterial>,
    now: f64,
) {
    let actor = catalog.body_actor();
    let definition = &actor.definition;

    let animation = if definition.spec(sprite.animation).is_some()
        && actor.texture(sprite.animation).is_some()
    {
        sprite.animation
    } else {
        set_animation(sprite, ActorAnimation::Idle, now);
        ActorAnimation::Idle
    };

    let spec = definition
        .spec(animation)
        .expect("validated player actor must define idle");
    let texture = actor
        .texture(animation)
        .expect("validated player actor texture missing");

    let elapsed = (now - sprite.animation_started_at).max(0.0);
    let frame = spec.frame_at(elapsed);

    if sprite.last_frame == frame
        && sprite.last_direction == sprite.direction
        && sprite.last_animation == sprite.animation
    {
        return;
    }

    let Some(mut material) = materials.get_mut(&sprite.material) else {
        return;
    };
    material.base_color_texture = Some(texture.clone());
    material.normal_map_texture = actor.normal(animation).cloned();
    material.uv_transform = atlas_uv(
        spec.columns,
        definition.atlas_rows,
        frame,
        sprite.direction.atlas_row(definition.authored_directions),
    );

    sprite.last_frame = frame;
    sprite.last_direction = sprite.direction;
    sprite.last_animation = sprite.animation;
}

fn animation_locked(
    sprite: &RemotePlayerSprite,
    catalog: &PlayerSpriteCatalog,
    now: f64,
) -> bool {
    let elapsed = (now - sprite.animation_started_at).max(0.0);
    catalog
        .body_actor()
        .definition
        .animation_locked(sprite.animation, elapsed)
}

fn set_animation(sprite: &mut RemotePlayerSprite, animation: ActorAnimation, now: f64) {
    if sprite.animation == animation {
        return;
    }
    trigger_animation(sprite, animation, now);
}

fn trigger_animation(sprite: &mut RemotePlayerSprite, animation: ActorAnimation, now: f64) {
    sprite.animation = animation;
    sprite.animation_started_at = now;
    sprite.last_frame = usize::MAX;
}

fn entity_position(game_state: &NativeGameState, entity_id: EntityId) -> Option<Position> {
    game_state
        .players
        .get(&entity_id)
        .map(|player| player.position)
        .or_else(|| {
            game_state
                .creatures
                .get(&entity_id)
                .map(|creature| creature.position)
        })
}

fn remote_world_position(position: Position, render_height: f32) -> Vec3 {
    Vec3::new(
        position.x as f32,
        render_height * 0.5 + 0.025,
        position.y as f32,
    )
}

pub(crate) fn face_remote_player_sprites_to_camera(
    camera: Query<&GlobalTransform, With<MainCamera>>,
    mut players: Query<(&GlobalTransform, &mut Transform), With<RemotePlayerSprite>>,
) {
    let Some(camera_transform) = camera.iter().next() else {
        return;
    };
    let camera_position = camera_transform.translation();

    for (global, mut transform) in &mut players {
        if let Some(rotation) = billboard_rotation(global.translation(), camera_position) {
            transform.rotation = rotation;
        }
    }
}
