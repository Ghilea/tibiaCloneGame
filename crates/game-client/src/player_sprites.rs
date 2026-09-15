// TIBIAGAME_V36_81_CAST_USE_GATHERING_ACTIONS
// TIBIAGAME_V36_80_UNIFIED_ACTOR_SPRITE_SYSTEM
use bevy::{
    camera::visibility::NoFrustumCulling,
    prelude::*,
};
use game_types::{EntityId, Position};

use crate::{
    LocalIdentity, MainCamera, MovementState,
    actor_sprites::{
        ActorAnimation, ActorSpriteDefinition, AnimationSpec, SpriteDirection, atlas_uv,
        billboard_rotation, face_direction,
    },
    state::NativeGameState,
};

const PLAYER_IDLE_ATLAS: &str = "players/default/atlases/player_idle_8dir_v1.png";
const PLAYER_WALK_ATLAS: &str = "players/default/atlases/player_walk_8dir_v1.png";
const PLAYER_ATTACK_ATLAS: &str = "players/default/atlases/player_attack_8dir_v1.png";
const PLAYER_HIT_ATLAS: &str = "players/default/atlases/player_hit_8dir_v1.png";
const PLAYER_DEATH_ATLAS: &str = "players/default/atlases/player_death_8dir_v1.png";
const PLAYER_CAST_ATLAS: &str = "players/default/atlases/player_cast_8dir_v36_81.png";
const PLAYER_USE_ATLAS: &str = "players/default/atlases/player_use_8dir_v36_81.png";

pub const PLAYER_SPRITE_DEFINITION: ActorSpriteDefinition = ActorSpriteDefinition {
    id: "player.default",
    authored_directions: 8,
    atlas_rows: 8,
    render_width: 1.02,
    render_height: 1.36,
    idle: AnimationSpec::looping(4, 4, 5.0),
    walk: Some(AnimationSpec::looping(8, 8, 12.0)),
    attack: Some(AnimationSpec::once(6, 6, 12.0)),
    hit: Some(AnimationSpec::once(4, 4, 12.0)),
    death: Some(AnimationSpec::terminal(8, 8, 8.0)),
    cast: Some(AnimationSpec::once(6, 6, 10.0)),
    use_action: Some(AnimationSpec::once(6, 6, 10.0)),
};

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
    idle: Handle<Image>,
    walk: Handle<Image>,
    attack: Handle<Image>,
    hit: Handle<Image>,
    death: Handle<Image>,
    cast: Handle<Image>,
    use_action: Handle<Image>,
}

impl PlayerSpriteCatalog {
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA PLAYER SPRITE · tangent generation failed: {error}");
        }

        Self {
            quad: meshes.add(quad),
            idle: asset_server.load(PLAYER_IDLE_ATLAS),
            walk: asset_server.load(PLAYER_WALK_ATLAS),
            attack: asset_server.load(PLAYER_ATTACK_ATLAS),
            hit: asset_server.load(PLAYER_HIT_ATLAS),
            death: asset_server.load(PLAYER_DEATH_ATLAS),
            cast: asset_server.load(PLAYER_CAST_ATLAS),
            use_action: asset_server.load(PLAYER_USE_ATLAS),
        }
    }
}

pub fn local_player_sprite_bundle(
    materials: &mut Assets<StandardMaterial>,
    catalog: &PlayerSpriteCatalog,
    outfit: &str,
) -> impl Bundle {
    let material = materials.add(StandardMaterial {
        base_color: outfit_tint(outfit),
        base_color_texture: Some(catalog.idle.clone()),
        uv_transform: atlas_uv(
            PLAYER_SPRITE_DEFINITION.idle.columns,
            PLAYER_SPRITE_DEFINITION.atlas_rows,
            0,
            SpriteDirection::South.atlas_row(PLAYER_SPRITE_DEFINITION.authored_directions),
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
            scale: Vec3::new(
                PLAYER_SPRITE_DEFINITION.render_width,
                PLAYER_SPRITE_DEFINITION.render_height,
                1.0,
            ),
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

    for mut sprite in &mut sprites {
        if local_dead {
            sprite.last_combat_sequence = game_state.combat_visual_sequence;
            if sprite.animation != ActorAnimation::Death {
                set_animation(&mut sprite, ActorAnimation::Death, now);
            }
        } else {
            if sprite.animation == ActorAnimation::Death {
                set_animation(&mut sprite, ActorAnimation::Idle, now);
            }

            // Server-confirmed non-combat abilities use the shared Use state.
            if let Some(ability) = game_state.last_ability.as_ref()
                && ability.sequence > sprite.last_ability_sequence
            {
                sprite.last_ability_sequence = ability.sequence;
                trigger_animation(&mut sprite, ActorAnimation::Use, now);
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
                        sprite.direction =
                            face_direction(movement.logical, target, sprite.direction);
                    }

                    // Spell CombatEffect.effect_id is the authoritative spell ID.
                    // Everything else keeps the physical Attack animation.
                    let animation = if game_state.spells.contains_key(&combat.effect_id) {
                        ActorAnimation::Cast
                    } else {
                        ActorAnimation::Attack
                    };
                    trigger_animation(&mut sprite, animation, now);
                } else if combat.target_id == game_state.local_player_id {
                    if let Some(source) = entity_position(&game_state, combat.source_id) {
                        sprite.direction =
                            face_direction(movement.logical, source, sprite.direction);
                    }
                    trigger_animation(&mut sprite, ActorAnimation::Hit, now);
                }
            }
            sprite.last_combat_sequence = newest_combat_sequence;

            if !animation_locked(&sprite, now) {
                if let Some(target) = mining.active_target_position() {
                    sprite.direction =
                        face_direction(movement.logical, target, sprite.direction);

                    // Mining lasts longer than a single Use cycle. Restart the
                    // authored action while the existing MiningAction is active.
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
                        sprite.direction =
                            face_direction(movement.logical, target, sprite.direction);
                    }

                    let desired = if actively_moving {
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

        let Some(spec) = PLAYER_SPRITE_DEFINITION.spec(sprite.animation) else {
            set_animation(&mut sprite, ActorAnimation::Idle, now);
            continue;
        };
        let Some(texture) = animation_texture(&catalog, sprite.animation) else {
            set_animation(&mut sprite, ActorAnimation::Idle, now);
            continue;
        };

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
        material.uv_transform = atlas_uv(
            spec.columns,
            PLAYER_SPRITE_DEFINITION.atlas_rows,
            frame,
            direction.atlas_row(PLAYER_SPRITE_DEFINITION.authored_directions),
        );

        sprite.last_frame = frame;
        sprite.last_direction = direction;
        sprite.last_animation = sprite.animation;
    }
}

fn animation_locked(sprite: &LocalPlayerSprite, now: f64) -> bool {
    let elapsed = (now - sprite.animation_started_at).max(0.0);
    PLAYER_SPRITE_DEFINITION.animation_locked(sprite.animation, elapsed)
}

fn animation_texture(
    catalog: &PlayerSpriteCatalog,
    animation: ActorAnimation,
) -> Option<&Handle<Image>> {
    match animation {
        ActorAnimation::Idle => Some(&catalog.idle),
        ActorAnimation::Walk => Some(&catalog.walk),
        ActorAnimation::Attack => Some(&catalog.attack),
        ActorAnimation::Hit => Some(&catalog.hit),
        ActorAnimation::Death => Some(&catalog.death),
        ActorAnimation::Cast => Some(&catalog.cast),
        ActorAnimation::Use => Some(&catalog.use_action),
    }
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
        "ALDORIA PLAYER SPRITE · definition={} · {} directions · idle/walk/attack/hit/death/cast/use · mining action facing",
        PLAYER_SPRITE_DEFINITION.id,
        PLAYER_SPRITE_DEFINITION.authored_directions,
    );
}
