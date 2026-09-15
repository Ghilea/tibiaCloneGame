// TIBIAGAME_V36_79_EIGHT_DIRECTION_COMBAT_SPRITES
use bevy::{
    camera::visibility::NoFrustumCulling,
    math::Affine2,
    prelude::*,
};
use game_types::{EntityId, Position};

use crate::{
    LocalIdentity, MainCamera, MovementState,
    creature_sprites::SpriteDirection,
    state::NativeGameState,
};

const PLAYER_IDLE_ATLAS: &str = "players/default/atlases/player_idle_8dir_v1.png";
const PLAYER_WALK_ATLAS: &str = "players/default/atlases/player_walk_8dir_v1.png";
const PLAYER_ATTACK_ATLAS: &str = "players/default/atlases/player_attack_8dir_v1.png";
const PLAYER_HIT_ATLAS: &str = "players/default/atlases/player_hit_8dir_v1.png";
const PLAYER_DEATH_ATLAS: &str = "players/default/atlases/player_death_8dir_v1.png";

const PLAYER_RENDER_WIDTH: f32 = 1.02;
const PLAYER_RENDER_HEIGHT: f32 = 1.36;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlayerSpriteAnimation {
    Idle,
    Walk,
    Attack,
    Hit,
    Death,
}

#[derive(Component)]
pub struct LocalPlayerSprite {
    direction: SpriteDirection,
    animation: PlayerSpriteAnimation,
    animation_started_at: f64,
    last_combat_sequence: u64,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: PlayerSpriteAnimation,
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
        uv_transform: atlas_uv(4, 8, 0, SpriteDirection::South.index8()),
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
            animation: PlayerSpriteAnimation::Idle,
            animation_started_at: 0.0,
            last_combat_sequence: 0,
            last_frame: usize::MAX,
            last_direction: SpriteDirection::North,
            last_animation: PlayerSpriteAnimation::Death,
            material: material.clone(),
        },
        Mesh3d(catalog.quad.clone()),
        MeshMaterial3d(material),
        Transform {
            translation: Vec3::new(0.0, 0.10, 0.0),
            rotation: Quat::from_rotation_y(std::f32::consts::PI),
            scale: Vec3::new(PLAYER_RENDER_WIDTH, PLAYER_RENDER_HEIGHT, 1.0),
        },
        Visibility::default(),
    )
}

pub fn update_local_player_sprite(
    time: Res<Time>,
    movement: Res<MovementState>,
    game_state: Res<NativeGameState>,
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
            if sprite.animation != PlayerSpriteAnimation::Death {
                set_animation(&mut sprite, PlayerSpriteAnimation::Death, now);
            }
        } else {
            if sprite.animation == PlayerSpriteAnimation::Death {
                set_animation(&mut sprite, PlayerSpriteAnimation::Idle, now);
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
                        face_position(&mut sprite, movement.logical, target);
                    }
                    trigger_animation(&mut sprite, PlayerSpriteAnimation::Attack, now);
                } else if combat.target_id == game_state.local_player_id {
                    if let Some(source) = entity_position(&game_state, combat.source_id) {
                        face_position(&mut sprite, movement.logical, source);
                    }
                    trigger_animation(&mut sprite, PlayerSpriteAnimation::Hit, now);
                }
            }
            sprite.last_combat_sequence = newest_combat_sequence;

            let locked = animation_locked(&sprite, now);
            if !locked {
                if actively_moving {
                    sprite.direction = SpriteDirection::from_delta(
                        delta.x.round() as i32,
                        delta.z.round() as i32,
                        sprite.direction,
                    );
                } else if let Some(target_id) = game_state.attack_target_id
                    && let Some(target) = entity_position(&game_state, target_id)
                {
                    face_position(&mut sprite, movement.logical, target);
                }

                let desired = if actively_moving {
                    PlayerSpriteAnimation::Walk
                } else {
                    PlayerSpriteAnimation::Idle
                };
                if sprite.animation != desired {
                    set_animation(&mut sprite, desired, now);
                }
            }
        }

        let (texture, columns, frames, fps, looping) = match sprite.animation {
            PlayerSpriteAnimation::Idle => (&catalog.idle, 4usize, 4usize, 5.0f64, true),
            PlayerSpriteAnimation::Walk => (&catalog.walk, 8usize, 8usize, 12.0f64, true),
            PlayerSpriteAnimation::Attack => (&catalog.attack, 6usize, 6usize, 12.0f64, false),
            PlayerSpriteAnimation::Hit => (&catalog.hit, 4usize, 4usize, 12.0f64, false),
            PlayerSpriteAnimation::Death => (&catalog.death, 8usize, 8usize, 8.0f64, false),
        };

        let elapsed = (now - sprite.animation_started_at).max(0.0);
        let raw_frame = (elapsed * fps).floor() as usize;
        let frame = if looping {
            raw_frame % frames
        } else {
            raw_frame.min(frames - 1)
        };
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
        material.uv_transform = atlas_uv(columns, 8, frame, direction.index8());

        sprite.last_frame = frame;
        sprite.last_direction = direction;
        sprite.last_animation = sprite.animation;
    }
}

fn animation_locked(sprite: &LocalPlayerSprite, now: f64) -> bool {
    let elapsed = (now - sprite.animation_started_at).max(0.0);
    match sprite.animation {
        PlayerSpriteAnimation::Attack => elapsed < 6.0 / 12.0,
        PlayerSpriteAnimation::Hit => elapsed < 4.0 / 12.0,
        PlayerSpriteAnimation::Death => true,
        PlayerSpriteAnimation::Idle | PlayerSpriteAnimation::Walk => false,
    }
}

fn set_animation(sprite: &mut LocalPlayerSprite, animation: PlayerSpriteAnimation, now: f64) {
    if sprite.animation == animation {
        return;
    }

    trigger_animation(sprite, animation, now);
}

fn trigger_animation(sprite: &mut LocalPlayerSprite, animation: PlayerSpriteAnimation, now: f64) {
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

fn face_position(sprite: &mut LocalPlayerSprite, origin: Position, target: Position) {
    if origin.z != target.z {
        return;
    }

    sprite.direction = SpriteDirection::from_delta(
        target.x - origin.x,
        target.y - origin.y,
        sprite.direction,
    );
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
        let to_camera = camera_position - global.translation();
        if to_camera.x.abs() < 0.0001 && to_camera.z.abs() < 0.0001 {
            continue;
        }
        transform.rotation = Quat::from_rotation_y(to_camera.x.atan2(to_camera.z));
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

fn atlas_uv(columns: usize, rows: usize, frame: usize, row: usize) -> Affine2 {
    let columns = columns.max(1) as f32;
    let rows = rows.max(1) as f32;

    Affine2::from_scale_angle_translation(
        Vec2::new(1.0 / columns, 1.0 / rows),
        0.0,
        Vec2::new(frame as f32 / columns, row as f32 / rows),
    )
}

pub fn describe_catalog() {
    info!(
        "ALDORIA PLAYER SPRITE · 8-direction native 2D · idle/walk/attack/hit/death"
    );
}
