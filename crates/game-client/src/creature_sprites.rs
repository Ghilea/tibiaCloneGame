use bevy::{
    image::ImageLoaderSettings,
    math::Affine2,
    prelude::*,
};
use game_types::{CreatureView, Position};

use crate::{CreatureActor, MainCamera};

const CARDINAL_MOVE_SECONDS: f64 = 0.165;
const DIAGONAL_FACTOR: f64 = std::f64::consts::SQRT_2;

const CASTLE_RAT_IDLE_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_idle_albedo_perf_v2.webp";
const CASTLE_RAT_IDLE_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_idle_normal_perf_v2.webp";
const CASTLE_RAT_WALK_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_walk_albedo_v5.webp";
const CASTLE_RAT_WALK_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_walk_normal_v5.webp";
const CASTLE_RAT_ATTACK_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_attack_albedo_perf_v2.webp";
const CASTLE_RAT_ATTACK_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_attack_normal_perf_v2.webp";
const CASTLE_RAT_HIT_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_hit_albedo_perf_v2.webp";
const CASTLE_RAT_HIT_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_hit_normal_perf_v2.webp";
const CASTLE_RAT_DEATH_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_death_albedo_perf_v2.webp";
const CASTLE_RAT_DEATH_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_death_normal_perf_v2.webp";
const PLACEHOLDER_TEXTURE: &str =
    "monsters/native_sprite_placeholder_v36_7.png";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpriteDirection {
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    NorthWest,
}

impl SpriteDirection {
    fn from_delta(dx: i32, dy: i32, fallback: Self) -> Self {
        match (dx.signum(), dy.signum()) {
            (0, -1) => Self::North,
            (1, -1) => Self::NorthEast,
            (1, 0) => Self::East,
            (1, 1) => Self::SouthEast,
            (0, 1) => Self::South,
            (-1, 1) => Self::SouthWest,
            (-1, 0) => Self::West,
            (-1, -1) => Self::NorthWest,
            _ => fallback,
        }
    }

    // Castle rat's current production atlas contains four authored directions
    // in rows 0/2/4/6. The runtime still stores all eight directions so future
    // creature sheets can use diagonal rows without changing movement code.
    fn castle_rat_row(self) -> usize {
        match self {
            Self::North => 0,
            Self::NorthEast | Self::East | Self::SouthEast => 2,
            Self::South => 4,
            Self::SouthWest | Self::West | Self::NorthWest => 6,
        }
    }

    #[allow(dead_code)]
    pub fn index8(self) -> usize {
        match self {
            Self::North => 0,
            Self::NorthEast => 1,
            Self::East => 2,
            Self::SouthEast => 3,
            Self::South => 4,
            Self::SouthWest => 5,
            Self::West => 6,
            Self::NorthWest => 7,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpriteAnimation {
    Idle,
    Walk,
    Attack,
    Hit,
    Death,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreatureSpriteKind {
    CastleRat,
    Placeholder,
}

#[derive(Component)]
pub struct CreatureSprite {
    // TIBIAGAME_V36_7_2_UNUSED_DEFINITION_ID_CLEANUP
    kind: CreatureSpriteKind,
    logical_position: Position,
    direction: SpriteDirection,
    animation: SpriteAnimation,
    animation_started_at: f64,
    walk_until: f64,
    render_height: f32,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: SpriteAnimation,
    material: Handle<StandardMaterial>,
}

#[derive(Component)]
pub struct CreatureMotion {
    from: Vec3,
    to: Vec3,
    started_at: f64,
    duration: f64,
}

#[derive(Resource)]
pub struct CreatureSpriteCatalog {
    quad: Handle<Mesh>,
    placeholder: Handle<Image>,
    castle_rat_idle_albedo: Handle<Image>,
    castle_rat_idle_normal: Handle<Image>,
    castle_rat_walk_albedo: Handle<Image>,
    castle_rat_walk_normal: Handle<Image>,
    castle_rat_attack_albedo: Handle<Image>,
    castle_rat_attack_normal: Handle<Image>,
    castle_rat_hit_albedo: Handle<Image>,
    castle_rat_hit_normal: Handle<Image>,
    castle_rat_death_albedo: Handle<Image>,
    castle_rat_death_normal: Handle<Image>,
}

impl CreatureSpriteCatalog {
    pub fn new(
        asset_server: &AssetServer,
        meshes: &mut Assets<Mesh>,
    ) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA SPRITE QUAD · tangent generation failed: {error}");
        }

        Self {
            quad: meshes.add(quad),
            placeholder: asset_server.load(PLACEHOLDER_TEXTURE),
            castle_rat_idle_albedo: asset_server.load(CASTLE_RAT_IDLE_ALBEDO),
            castle_rat_idle_normal: load_linear_image(asset_server, CASTLE_RAT_IDLE_NORMAL),
            castle_rat_walk_albedo: asset_server.load(CASTLE_RAT_WALK_ALBEDO),
            castle_rat_walk_normal: load_linear_image(asset_server, CASTLE_RAT_WALK_NORMAL),
            castle_rat_attack_albedo: asset_server.load(CASTLE_RAT_ATTACK_ALBEDO),
            castle_rat_attack_normal: load_linear_image(asset_server, CASTLE_RAT_ATTACK_NORMAL),
            castle_rat_hit_albedo: asset_server.load(CASTLE_RAT_HIT_ALBEDO),
            castle_rat_hit_normal: load_linear_image(asset_server, CASTLE_RAT_HIT_NORMAL),
            castle_rat_death_albedo: asset_server.load(CASTLE_RAT_DEATH_ALBEDO),
            castle_rat_death_normal: load_linear_image(asset_server, CASTLE_RAT_DEATH_NORMAL),
        }
    }
}

fn load_linear_image(
    asset_server: &AssetServer,
    path: &'static str,
) -> Handle<Image> {
    asset_server
        .load_builder()
        .with_settings(|settings: &mut ImageLoaderSettings| {
            settings.is_srgb = false;
        })
        .load(path)
}

pub fn spawn_creature_sprite(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &CreatureSpriteCatalog,
    creature: &CreatureView,
) -> Entity {
    let kind = if creature.definition_id == "castle_rat" {
        CreatureSpriteKind::CastleRat
    } else {
        CreatureSpriteKind::Placeholder
    };

    let (render_width, render_height, tint) =
        creature_visual_style(&creature.definition_id);

    let mut material = StandardMaterial {
        base_color: tint,
        perceptual_roughness: 0.9,
        metallic: 0.0,
        alpha_mode: AlphaMode::Mask(0.35),
        double_sided: true,
        cull_mode: None,
        ..default()
    };

    if kind == CreatureSpriteKind::CastleRat {
        material.base_color = Color::WHITE;
        material.base_color_texture =
            Some(catalog.castle_rat_idle_albedo.clone());
        material.normal_map_texture =
            Some(catalog.castle_rat_idle_normal.clone());
        material.uv_transform = atlas_uv(12, 8, 0, 4);
    } else {
        material.base_color_texture = Some(catalog.placeholder.clone());
    }

    let material_handle = materials.add(material);
    let translation = sprite_world_position(creature.position, render_height);

    commands
        .spawn((
            Name::new(format!(
                "Creature Sprite · {} · {}",
                creature.definition_id, creature.name
            )),
            CreatureActor(creature.id),
            CreatureSprite {
                kind,
                logical_position: creature.position,
                direction: SpriteDirection::South,
                animation: SpriteAnimation::Idle,
                animation_started_at: 0.0,
                walk_until: 0.0,
                render_height,
                last_frame: usize::MAX,
                last_direction: SpriteDirection::North,
                last_animation: SpriteAnimation::Death,
                material: material_handle.clone(),
            },
            CreatureMotion {
                from: translation,
                to: translation,
                started_at: 0.0,
                duration: 0.0,
            },
            Mesh3d(catalog.quad.clone()),
            MeshMaterial3d(material_handle),
            Transform {
                translation,
                rotation: Quat::from_rotation_y(std::f32::consts::FRAC_PI_4),
                scale: Vec3::new(render_width, render_height, 1.0),
            },
            Visibility::default(),
        ))
        .id()
}

pub fn begin_creature_move(
    sprite: &mut CreatureSprite,
    motion: &mut CreatureMotion,
    transform: &Transform,
    target: Position,
    now: f64,
) {
    let dx = target.x - sprite.logical_position.x;
    let dy = target.y - sprite.logical_position.y;
    sprite.direction = SpriteDirection::from_delta(dx, dy, sprite.direction);

    let diagonal = dx != 0 && dy != 0;
    let duration = CARDINAL_MOVE_SECONDS
        * if diagonal { DIAGONAL_FACTOR } else { 1.0 };

    motion.from = transform.translation;
    motion.to = sprite_world_position(target, sprite.render_height);
    motion.started_at = now;
    motion.duration = duration;

    sprite.logical_position = target;
    sprite.walk_until = now + duration + 0.06;

    if !matches!(
        sprite.animation,
        SpriteAnimation::Attack | SpriteAnimation::Hit | SpriteAnimation::Death
    ) {
        set_animation(sprite, SpriteAnimation::Walk, now);
    }
}

pub fn trigger_attack(sprite: &mut CreatureSprite, now: f64) {
    if sprite.kind == CreatureSpriteKind::CastleRat
        && sprite.animation != SpriteAnimation::Death
    {
        set_animation(sprite, SpriteAnimation::Attack, now);
    }
}

pub fn trigger_hit(sprite: &mut CreatureSprite, now: f64) {
    if sprite.kind == CreatureSpriteKind::CastleRat
        && sprite.animation != SpriteAnimation::Death
    {
        set_animation(sprite, SpriteAnimation::Hit, now);
    }
}

pub fn trigger_death(sprite: &mut CreatureSprite, now: f64) {
    if sprite.kind == CreatureSpriteKind::CastleRat {
        set_animation(sprite, SpriteAnimation::Death, now);
    }
}

pub fn interpolate_creature_motion(
    time: Res<Time>,
    mut creatures: Query<(&CreatureMotion, &mut Transform), With<CreatureSprite>>,
) {
    let now = time.elapsed_secs_f64();

    for (motion, mut transform) in &mut creatures {
        if motion.duration <= f64::EPSILON {
            transform.translation = motion.to;
            continue;
        }

        let t = ((now - motion.started_at) / motion.duration)
            .clamp(0.0, 1.0) as f32;
        let eased = t * t * (3.0 - 2.0 * t);
        transform.translation = motion.from.lerp(motion.to, eased);
    }
}

pub fn face_creature_sprites_to_camera(
    camera: Query<&GlobalTransform, With<MainCamera>>,
    mut creatures: Query<&mut Transform, With<CreatureSprite>>,
) {
    let Some(camera_transform) = camera.iter().next() else {
        return;
    };
    let camera_position = camera_transform.translation();

    for mut transform in &mut creatures {
        let to_camera = camera_position - transform.translation;
        if to_camera.x.abs() < 0.0001 && to_camera.z.abs() < 0.0001 {
            continue;
        }
        let yaw = to_camera.x.atan2(to_camera.z);
        transform.rotation = Quat::from_rotation_y(yaw);
    }
}

pub fn animate_creature_sprites(
    time: Res<Time>,
    catalog: Res<CreatureSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut creatures: Query<&mut CreatureSprite>,
) {
    let now = time.elapsed_secs_f64();

    for mut sprite in &mut creatures {
        if sprite.kind != CreatureSpriteKind::CastleRat {
            continue;
        }

        advance_animation_state(&mut sprite, now);

        let (
            albedo,
            normal,
            columns,
            rows,
            frames,
            fps,
        ) = match sprite.animation {
            SpriteAnimation::Idle => (
                &catalog.castle_rat_idle_albedo,
                &catalog.castle_rat_idle_normal,
                12usize,
                8usize,
                12usize,
                10.0f64,
            ),
            SpriteAnimation::Walk => (
                &catalog.castle_rat_walk_albedo,
                &catalog.castle_rat_walk_normal,
                8,
                8,
                8,
                12.0,
            ),
            SpriteAnimation::Attack => (
                &catalog.castle_rat_attack_albedo,
                &catalog.castle_rat_attack_normal,
                8,
                8,
                8,
                14.0,
            ),
            SpriteAnimation::Hit => (
                &catalog.castle_rat_hit_albedo,
                &catalog.castle_rat_hit_normal,
                5,
                8,
                5,
                14.0,
            ),
            SpriteAnimation::Death => (
                &catalog.castle_rat_death_albedo,
                &catalog.castle_rat_death_normal,
                10,
                8,
                10,
                10.0,
            ),
        };

        let elapsed = (now - sprite.animation_started_at).max(0.0);
        let raw_frame = (elapsed * fps).floor() as usize;
        let frame = if sprite.animation == SpriteAnimation::Death {
            raw_frame.min(frames - 1)
        } else {
            raw_frame % frames
        };
        let direction = sprite.direction;

        if sprite.last_frame == frame
            && sprite.last_direction == direction
            && sprite.last_animation == sprite.animation
        {
            continue;
        }

        // TIBIAGAME_V36_7_1_SPRITE_MATERIAL_MUT_FIX
        let Some(mut material) = materials.get_mut(&sprite.material) else {
            continue;
        };

        material.base_color_texture = Some(albedo.clone());
        material.normal_map_texture = Some(normal.clone());
        material.uv_transform =
            atlas_uv(columns, rows, frame, direction.castle_rat_row());

        sprite.last_frame = frame;
        sprite.last_direction = direction;
        sprite.last_animation = sprite.animation;
    }
}

fn advance_animation_state(sprite: &mut CreatureSprite, now: f64) {
    let elapsed = (now - sprite.animation_started_at).max(0.0);

    match sprite.animation {
        SpriteAnimation::Death => return,
        SpriteAnimation::Attack if elapsed < 8.0 / 14.0 => return,
        SpriteAnimation::Hit if elapsed < 5.0 / 14.0 => return,
        _ => {}
    }

    let desired = if now < sprite.walk_until {
        SpriteAnimation::Walk
    } else {
        SpriteAnimation::Idle
    };

    if sprite.animation != desired {
        set_animation(sprite, desired, now);
    }
}

fn set_animation(
    sprite: &mut CreatureSprite,
    animation: SpriteAnimation,
    now: f64,
) {
    if sprite.animation == animation {
        return;
    }

    sprite.animation = animation;
    sprite.animation_started_at = now;
    sprite.last_frame = usize::MAX;
}

fn atlas_uv(
    columns: usize,
    rows: usize,
    frame: usize,
    row: usize,
) -> Affine2 {
    let columns = columns.max(1) as f32;
    let rows = rows.max(1) as f32;

    Affine2::from_scale_angle_translation(
        Vec2::new(1.0 / columns, 1.0 / rows),
        0.0,
        Vec2::new(frame as f32 / columns, row as f32 / rows),
    )
}

fn sprite_world_position(position: Position, render_height: f32) -> Vec3 {
    Vec3::new(
        position.x as f32,
        render_height * 0.5 + 0.025,
        position.y as f32,
    )
}

fn creature_visual_style(definition_id: &str) -> (f32, f32, Color) {
    match definition_id {
        "castle_rat" => (0.95, 1.05, Color::WHITE),
        "mireling" => (0.90, 1.05, Color::srgb(0.44, 0.68, 0.35)),
        "mire_skulker" => (1.00, 1.12, Color::srgb(0.27, 0.52, 0.34)),
        "reed_stalker" => (0.95, 1.28, Color::srgb(0.48, 0.58, 0.25)),
        "fen_brute" => (1.30, 1.55, Color::srgb(0.50, 0.36, 0.23)),
        "crypt_guard" => (1.00, 1.38, Color::srgb(0.45, 0.52, 0.60)),
        "bone_acolyte" => (0.95, 1.32, Color::srgb(0.78, 0.77, 0.67)),
        "cellar_warden" => (1.15, 1.48, Color::srgb(0.43, 0.36, 0.56)),
        _ => (0.95, 1.15, Color::srgb(0.68, 0.32, 0.38)),
    }
}

pub fn describe_catalog() {
    info!(
        "ALDORIA SPRITE CREATURES · castle_rat=atlas+normal idle/walk/attack/hit/death · remaining monsters=transparent sprite placeholders"
    );
}
