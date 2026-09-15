// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
// TIBIAGAME_V36_81_CAST_USE_GATHERING_ACTIONS
use bevy::{camera::visibility::NoFrustumCulling, prelude::*};
use game_types::{EntityId, Position};

use crate::{
    LocalIdentity, MainCamera, MovementState,
    actor_sprites::{
        ActorAnimation, ActorSpriteAssets, ActorSpriteDefinition, SpriteDirection, atlas_uv,
        billboard_rotation, face_direction,
    },
    state::NativeGameState,
};

const PLAYER_MANIFEST: &str = "actors/players/default/actor.json";

#[derive(Component)]
pub struct LocalPlayerSprite {
    direction: SpriteDirection,
    animation: ActorAnimation,
    animation_started_at: f64,
    last_combat_sequence: u64,
    last_ability_sequence: u64,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: ActorAnimation,
    material: Handle<StandardMaterial>,
}

#[derive(Resource)]
pub struct PlayerSpriteCatalog {
    quad: Handle<Mesh>,
    actor: ActorSpriteAssets,
}

impl PlayerSpriteCatalog {
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA PLAYER SPRITE · tangent generation failed: {error}");
        }

        Self {
            quad: meshes.add(quad),
            actor: ActorSpriteAssets::load(asset_server, PLAYER_MANIFEST),
        }
    }
}

pub fn local_player_sprite_bundle(
    materials: &mut Assets<StandardMaterial>,
    catalog: &PlayerSpriteCatalog,
    outfit: &str,
) -> impl Bundle {
    let definition = &catalog.actor.definition;
    let idle = definition
        .spec(ActorAnimation::Idle)
        .expect("validated player manifest must define idle");
    let idle_texture = catalog
        .actor
        .texture(ActorAnimation::Idle)
        .expect("validated player manifest must load idle texture");

    let material = materials.add(StandardMaterial {
        base_color: outfit_tint(outfit),
        base_color_texture: Some(idle_texture.clone()),
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

    (
        Name::new("Local Player 2D Sprite"),
        NoFrustumCulling,
        LocalPlayerSprite {
            direction: SpriteDirection::South,
            animation: ActorAnimation::Idle,
            animation_started_at: 0.0,
            last_combat_sequence: 0,
            last_ability_sequence: 0,
            last_frame: usize::MAX,
            last_direction: SpriteDirection::North,
            last_animation: ActorAnimation::Death,
            material: material.clone(),
        },
        Mesh3d(catalog.quad.clone()),
        MeshMaterial3d(material),
        Transform {
            translation: Vec3::new(0.0, 0.10, 0.0),
            rotation: Quat::from_rotation_y(std::f32::consts::PI),
            scale: Vec3::new(definition.render_width, definition.render_height, 1.0),
        },
        Visibility::default(),
    )
}

pub fn update_local_player_sprite(
    time: Res<Time>,
    movement: Res<MovementState>,
    game_state: Res<NativeGameState>,
    mining: Res<crate::interaction::MiningAction>,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut sprites: Query<&mut LocalPlayerSprite>,
) {
    let now = time.elapsed_secs_f64();
    let delta = movement.to - movement.from;
    let moving = delta.x.abs() >= 0.001 || delta.z.abs() >= 0.001;
    let actively_moving = moving && now < movement.started_at + movement.duration + 0.045;
    let local_dead = game_state
        .local_player()
        .is_some_and(|player| player.health == 0);
    let definition = &catalog.actor.definition;

    for mut sprite in &mut sprites {
        if local_dead {
            sprite.last_combat_sequence = game_state.combat_visual_sequence;
            if sprite.animation != ActorAnimation::Death
                && definition.spec(ActorAnimation::Death).is_some()
            {
                set_animation(&mut sprite, ActorAnimation::Death, now);
            }
        } else {
            if sprite.animation == ActorAnimation::Death {
                set_animation(&mut sprite, ActorAnimation::Idle, now);
            }

            if let Some(ability) = game_state.last_ability.as_ref()
                && ability.sequence > sprite.last_ability_sequence
            {
                sprite.last_ability_sequence = ability.sequence;
                if definition.spec(ActorAnimation::Use).is_some() {
                    trigger_animation(&mut sprite, ActorAnimation::Use, now);
                }
            }

            let previous_combat_sequence = sprite.last_combat_sequence;
            let mut newest_combat_sequence = previous_combat_sequence;
            for combat in game_state
                .combat_visuals
                .iter()
                .filter(|combat| combat.sequence > previous_combat_sequence)
            {
                newest_combat_sequence = newest_combat_sequence.max(combat.sequence);

                if combat.source_id == game_state.local_player_id {
                    if let Some(target) = entity_position(&game_state, combat.target_id) {
                        sprite.direction = face_direction(movement.logical, target, sprite.direction);
                    }

                    let requested = if game_state.spells.contains_key(&combat.effect_id) {
                        ActorAnimation::Cast
                    } else {
                        ActorAnimation::Attack
                    };
                    let animation = if definition.spec(requested).is_some() {
                        requested
                    } else {
                        ActorAnimation::Idle
                    };
                    trigger_animation(&mut sprite, animation, now);
                } else if combat.target_id == game_state.local_player_id {
                    if let Some(source) = entity_position(&game_state, combat.source_id) {
                        sprite.direction = face_direction(movement.logical, source, sprite.direction);
                    }
                    if definition.spec(ActorAnimation::Hit).is_some() {
                        trigger_animation(&mut sprite, ActorAnimation::Hit, now);
                    }
                }
            }
            sprite.last_combat_sequence = newest_combat_sequence;

            if !animation_locked(&sprite, definition, now) {
                if let Some(target) = mining.active_target_position()
                    && definition.spec(ActorAnimation::Use).is_some()
                {
                    sprite.direction = face_direction(movement.logical, target, sprite.direction);

                    if sprite.animation == ActorAnimation::Use {
                        trigger_animation(&mut sprite, ActorAnimation::Use, now);
                    } else {
                        set_animation(&mut sprite, ActorAnimation::Use, now);
                    }
                } else {
                    if actively_moving {
                        sprite.direction = SpriteDirection::from_delta(
                            delta.x.round() as i32,
                            delta.z.round() as i32,
                            sprite.direction,
                        );
                    } else if let Some(target_id) = game_state.attack_target_id
                        && let Some(target) = entity_position(&game_state, target_id)
                    {
                        sprite.direction = face_direction(movement.logical, target, sprite.direction);
                    }

                    let desired = if actively_moving && definition.spec(ActorAnimation::Walk).is_some()
                    {
                        ActorAnimation::Walk
                    } else {
                        ActorAnimation::Idle
                    };
                    if sprite.animation != desired {
                        set_animation(&mut sprite, desired, now);
                    }
                }
            }
        }

        let animation = if definition.spec(sprite.animation).is_some()
            && catalog.actor.texture(sprite.animation).is_some()
        {
            sprite.animation
        } else {
            set_animation(&mut sprite, ActorAnimation::Idle, now);
            ActorAnimation::Idle
        };
        let spec = definition
            .spec(animation)
            .expect("validated player manifest must define idle");
        let texture = catalog
            .actor
            .texture(animation)
            .expect("validated player manifest texture missing");

        let elapsed = (now - sprite.animation_started_at).max(0.0);
        let frame = spec.frame_at(elapsed);
        let direction = sprite.direction;

        if sprite.last_frame == frame
            && sprite.last_direction == direction
            && sprite.last_animation == sprite.animation
        {
            continue;
        }

        let Some(mut material) = materials.get_mut(&sprite.material) else {
            continue;
        };
        material.base_color_texture = Some(texture.clone());
        material.normal_map_texture = catalog.actor.normal(animation).cloned();
        material.uv_transform = atlas_uv(
            spec.columns,
            definition.atlas_rows,
            frame,
            direction.atlas_row(definition.authored_directions),
        );

        sprite.last_frame = frame;
        sprite.last_direction = direction;
        sprite.last_animation = sprite.animation;
    }
}

fn animation_locked(
    sprite: &LocalPlayerSprite,
    definition: &ActorSpriteDefinition,
    now: f64,
) -> bool {
    let elapsed = (now - sprite.animation_started_at).max(0.0);
    definition.animation_locked(sprite.animation, elapsed)
}

fn set_animation(sprite: &mut LocalPlayerSprite, animation: ActorAnimation, now: f64) {
    if sprite.animation == animation {
        return;
    }

    trigger_animation(sprite, animation, now);
}

fn trigger_animation(sprite: &mut LocalPlayerSprite, animation: ActorAnimation, now: f64) {
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

pub fn face_local_player_sprite_to_camera(
    camera: Query<&GlobalTransform, With<MainCamera>>,
    mut sprites: Query<(&GlobalTransform, &mut Transform), With<LocalPlayerSprite>>,
) {
    let Some(camera_transform) = camera.iter().next() else {
        return;
    };
    let camera_position = camera_transform.translation();

    for (global, mut transform) in &mut sprites {
        if let Some(rotation) = billboard_rotation(global.translation(), camera_position) {
            transform.rotation = rotation;
        }
    }
}

pub fn sync_local_player_outfit(
    game_state: Res<NativeGameState>,
    mut identity: ResMut<LocalIdentity>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    sprites: Query<&LocalPlayerSprite>,
) {
    let Some(player) = game_state.local_player() else {
        return;
    };
    if player.outfit == identity.outfit {
        return;
    }

    identity.outfit = player.outfit.clone();
    let tint = outfit_tint(&identity.outfit);
    for sprite in &sprites {
        if let Some(mut material) = materials.get_mut(&sprite.material) {
            material.base_color = tint;
        }
    }

    info!(
        "ALDORIA PLAYER SPRITE OUTFIT · {} · 2D tint updated",
        identity.outfit,
    );
}

fn outfit_tint(outfit: &str) -> Color {
    match outfit {
        "mage" => Color::srgb(0.72, 0.78, 1.0),
        "ranger" => Color::srgb(0.72, 0.92, 0.70),
        "rogue" => Color::srgb(0.78, 0.76, 0.86),
        _ => Color::WHITE,
    }
}

pub fn describe_catalog() {
    info!(
        "ALDORIA PLAYER SPRITE · manifest={} · data-driven idle/walk/attack/hit/death/cast/use",
        PLAYER_MANIFEST,
    );
}
