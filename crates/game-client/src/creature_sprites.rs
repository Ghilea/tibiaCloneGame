use std::collections::HashSet;

use bevy::{
    camera::visibility::NoFrustumCulling, image::ImageLoaderSettings, math::Affine2, prelude::*,
};
use game_types::{CreatureView, Position};

use crate::{
    CreatureActor, MainCamera, MovementState,
    actor_sprites::{
        ActorAnimation, ActorSpriteDefinition, AnimationSpec, atlas_uv, billboard_rotation,
    },
    state::NativeGameState,
};

const CARDINAL_MOVE_SECONDS: f64 = 0.165;
const DIAGONAL_FACTOR: f64 = std::f64::consts::SQRT_2;

const CASTLE_RAT_IDLE_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_idle_albedo_8dir_v36_79.png";
const CASTLE_RAT_IDLE_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_idle_normal_8dir_v36_79.png";
const CASTLE_RAT_WALK_ALBEDO: &str = "monsters/castle_rat/atlases/castle_rat_walk_albedo_8dir_v36_79.png";
const CASTLE_RAT_WALK_NORMAL: &str = "monsters/castle_rat/atlases/castle_rat_walk_normal_8dir_v36_79.png";
const CASTLE_RAT_ATTACK_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_attack_albedo_8dir_v36_79.png";
const CASTLE_RAT_ATTACK_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_attack_normal_8dir_v36_79.png";
const CASTLE_RAT_HIT_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_hit_albedo_8dir_v36_79.png";
const CASTLE_RAT_HIT_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_hit_normal_8dir_v36_79.png";
const CASTLE_RAT_DEATH_ALBEDO: &str =
    "monsters/castle_rat/atlases/castle_rat_death_albedo_8dir_v36_79.png";
const CASTLE_RAT_DEATH_NORMAL: &str =
    "monsters/castle_rat/atlases/castle_rat_death_normal_8dir_v36_79.png";
const PLACEHOLDER_TEXTURE: &str = "monsters/native_sprite_placeholder_v36_7.png";

const CASTLE_RAT_SPRITE_DEFINITION: ActorSpriteDefinition = ActorSpriteDefinition {
    id: "creature.castle_rat",
    authored_directions: 8,
    atlas_rows: 8,
    render_width: 0.95,
    render_height: 1.05,
    idle: AnimationSpec::looping(12, 12, 10.0),
    walk: Some(AnimationSpec::looping(8, 8, 12.0)),
    attack: Some(AnimationSpec::once(8, 8, 14.0)),
    hit: Some(AnimationSpec::once(5, 5, 14.0)),
    death: Some(AnimationSpec::terminal(10, 10, 10.0)),
    cast: None,
    use_action: None,
};

const PLACEHOLDER_SPRITE_DEFINITION: ActorSpriteDefinition = ActorSpriteDefinition {
    id: "creature.placeholder",
    authored_directions: 1,
    atlas_rows: 1,
    render_width: 0.95,
    render_height: 1.15,
    idle: AnimationSpec::looping(1, 1, 1.0),
    walk: None,
    attack: None,
    hit: None,
    death: None,
    cast: None,
    use_action: None,
};

pub use crate::actor_sprites::SpriteDirection;

type SpriteAnimation = ActorAnimation;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreatureSpriteKind {
    CastleRat,
    Placeholder,
}

impl CreatureSpriteKind {
    fn definition(self) -> &'static ActorSpriteDefinition {
        match self {
            Self::CastleRat => &CASTLE_RAT_SPRITE_DEFINITION,
            Self::Placeholder => &PLACEHOLDER_SPRITE_DEFINITION,
        }
    }
}

#[derive(Component)]
pub struct PersistentCreatureVisual;

#[derive(Component)]
pub struct CreatureSprite {
    // TIBIAGAME_V36_7_2_UNUSED_DEFINITION_ID_CLEANUP
    // TIBIAGAME_V36_15_1_OPENING_FACADE_RAT_GPU_PREWARM
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
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
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

pub fn spawn_creature_render_warmup(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &CreatureSpriteCatalog,
) {
    let probes: [(&str, &Handle<Image>, &Handle<Image>); 5] = [
        (
            "idle",
            &catalog.castle_rat_idle_albedo,
            &catalog.castle_rat_idle_normal,
        ),
        (
            "walk",
            &catalog.castle_rat_walk_albedo,
            &catalog.castle_rat_walk_normal,
        ),
        (
            "attack",
            &catalog.castle_rat_attack_albedo,
            &catalog.castle_rat_attack_normal,
        ),
        (
            "hit",
            &catalog.castle_rat_hit_albedo,
            &catalog.castle_rat_hit_normal,
        ),
        (
            "death",
            &catalog.castle_rat_death_albedo,
            &catalog.castle_rat_death_normal,
        ),
    ];

    for (index, (label, albedo, normal)) in probes.into_iter().enumerate() {
        let material = materials.add(StandardMaterial {
            base_color: Color::WHITE,
            base_color_texture: Some(albedo.clone()),
            normal_map_texture: Some(normal.clone()),
            uv_transform: atlas_uv(12, 8, 0, 4),
            perceptual_roughness: 0.9,
            metallic: 0.0,
            unlit: true,
            alpha_mode: AlphaMode::Mask(0.05),
            double_sided: true,
            cull_mode: None,
            ..default()
        });

        // Do not mark these as CreatureActor/WorldStatic. They are permanent
        // off-camera render probes and must not enter combat, interaction or
        // streamed-region cleanup queries.
        commands.spawn((
            Name::new(format!("Castle rat GPU warmup · {label}")),
            NoFrustumCulling,
            Mesh3d(catalog.quad.clone()),
            MeshMaterial3d(material),
            Transform::from_xyz(-10_000.0 - index as f32 * 2.0, -10_000.0, -10_000.0),
            Visibility::default(),
        ));
    }

    let placeholder_material = materials.add(StandardMaterial {
        base_color: Color::WHITE,
        base_color_texture: Some(catalog.placeholder.clone()),
        perceptual_roughness: 0.9,
        unlit: true,
        alpha_mode: AlphaMode::Mask(0.05),
        double_sided: true,
        cull_mode: None,
        ..default()
    });

    commands.spawn((
        Name::new("Creature placeholder GPU warmup"),
        NoFrustumCulling,
        Mesh3d(catalog.quad.clone()),
        MeshMaterial3d(placeholder_material),
        Transform::from_xyz(-10_020.0, -10_000.0, -10_000.0),
        Visibility::default(),
    ));

    info!(
        "ALDORIA CREATURE GPU WARMUP · castle rat idle/walk/attack/hit/death + placeholder probes queued"
    );
}

fn load_linear_image(asset_server: &AssetServer, path: &'static str) -> Handle<Image> {
    asset_server
        .load_builder()
        .with_settings(|settings: &mut ImageLoaderSettings| {
            settings.is_srgb = false;
        })
        .load(path)
}

pub fn floor_transition_creature_assets_ready(
    asset_server: &AssetServer,
    catalog: &CreatureSpriteCatalog,
) -> bool {
    [
        &catalog.placeholder,
        &catalog.castle_rat_idle_albedo,
        &catalog.castle_rat_idle_normal,
        &catalog.castle_rat_walk_albedo,
        &catalog.castle_rat_walk_normal,
        &catalog.castle_rat_attack_albedo,
        &catalog.castle_rat_attack_normal,
        &catalog.castle_rat_hit_albedo,
        &catalog.castle_rat_hit_normal,
        &catalog.castle_rat_death_albedo,
        &catalog.castle_rat_death_normal,
    ]
    .into_iter()
    .all(|handle| asset_server.is_loaded_with_dependencies(handle.id()))
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

    let (render_width, render_height, tint) = creature_visual_style(&creature.definition_id);

    let mut material = StandardMaterial {
        base_color: tint,
        perceptual_roughness: 0.9,
        metallic: 0.0,
        unlit: true,
        alpha_mode: AlphaMode::Mask(0.05),
        double_sided: true,
        cull_mode: None,
        ..default()
    };

    if kind == CreatureSpriteKind::CastleRat {
        material.base_color = Color::WHITE;
        material.base_color_texture = Some(catalog.castle_rat_idle_albedo.clone());
        material.normal_map_texture = Some(catalog.castle_rat_idle_normal.clone());
        material.uv_transform = atlas_uv(12, 8, 0, 4);
    } else {
        // V36.19: an authoritative hostile must never be visually transparent.
        // The remaining production sprite sheets are not authored yet, so use
        // the per-definition tint as a solid billboard fallback.
        material.base_color_texture = None;
        material.normal_map_texture = None;
        material.alpha_mode = AlphaMode::Opaque;
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
            PersistentCreatureVisual,
            NoFrustumCulling,
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

pub fn reconcile_creature_visuals(
    mut commands: Commands,
    game_state: Res<NativeGameState>,
    movement: Res<MovementState>,
    catalog: Res<CreatureSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut visuals: Query<
        (
            Entity,
            &CreatureActor,
            &mut CreatureSprite,
            &mut CreatureMotion,
            &mut Transform,
            &mut Visibility,
        ),
        With<PersistentCreatureVisual>,
    >,
    mut last_report: Local<Option<(i16, usize, usize)>>,
    mut last_visible_floor: Local<Option<i16>>,
) {
    let visible_floor = movement.logical.z;
    let floor_changed = *last_visible_floor != Some(visible_floor);
    let mut existing_ids = HashSet::new();

    for (entity, actor, mut sprite, mut motion, mut transform, mut visibility) in &mut visuals {
        if !existing_ids.insert(actor.0) {
            commands.entity(entity).despawn();
            continue;
        }

        let Some(creature) = game_state.creatures.get(&actor.0) else {
            commands.entity(entity).despawn();
            continue;
        };

        if sprite.logical_position != creature.position {
            let world = sprite_world_position(creature.position, sprite.render_height);
            sprite.logical_position = creature.position;
            motion.from = world;
            motion.to = world;
            motion.started_at = 0.0;
            motion.duration = 0.0;
            transform.translation = world;
        }

        if creature.position.z == visible_floor {
            // Explicit Visible is deliberate. These actors may have spent many
            // seconds cached as Hidden on an adjacent floor. Reassert the
            // active render state instead of relying on inherited visibility.
            *visibility = Visibility::Visible;

            if floor_changed {
                refresh_creature_material(&mut sprite, creature, &catalog, &mut materials);
            }
        } else {
            *visibility = Visibility::Hidden;
        }
    }

    for creature in game_state.creatures.values() {
        if existing_ids.contains(&creature.id) {
            continue;
        }

        let entity = spawn_creature_sprite(&mut commands, &mut materials, &catalog, creature);

        commands
            .entity(entity)
            .insert(if creature.position.z == visible_floor {
                Visibility::Visible
            } else {
                Visibility::Hidden
            });

        existing_ids.insert(creature.id);
        info!(
            "ALDORIA CREATURE VISUAL CACHE · spawned {} · {} · floor {} · hidden={}",
            creature.id,
            creature.definition_id,
            creature.position.z,
            creature.position.z != visible_floor,
        );
    }

    let authoritative = game_state
        .creatures
        .values()
        .filter(|creature| creature.position.z == visible_floor && creature.health > 0)
        .count();
    let cached = game_state
        .creatures
        .values()
        .filter(|creature| {
            creature.position.z == visible_floor
                && creature.health > 0
                && existing_ids.contains(&creature.id)
        })
        .count();

    if floor_changed {
        info!(
            "ALDORIA CREATURE FLOOR REVEAL · floor {} · force-visible + material rebind · actors={}/{}",
            visible_floor, cached, authoritative,
        );
    }
    *last_visible_floor = Some(visible_floor);

    let report = (visible_floor, authoritative, cached);
    if last_report.as_ref() != Some(&report) {
        info!(
            "ALDORIA CREATURE CACHE · floor {} · authoritative={} · cached={}",
            visible_floor, authoritative, cached,
        );
        *last_report = Some(report);
    }
}

fn refresh_creature_material(
    sprite: &mut CreatureSprite,
    creature: &CreatureView,
    catalog: &CreatureSpriteCatalog,
    materials: &mut Assets<StandardMaterial>,
) {
    let Some(mut material) = materials.get_mut(&sprite.material) else {
        return;
    };

    material.unlit = true;

    match sprite.kind {
        CreatureSpriteKind::CastleRat => {
            material.base_color = Color::WHITE;
            material.base_color_texture = Some(catalog.castle_rat_idle_albedo.clone());
            material.normal_map_texture = Some(catalog.castle_rat_idle_normal.clone());
            material.uv_transform = atlas_uv(12, 8, 0, 4);
            material.alpha_mode = AlphaMode::Mask(0.05);
        }
        CreatureSpriteKind::Placeholder => {
            let (_, _, tint) = creature_visual_style(&creature.definition_id);
            material.base_color = tint;
            material.base_color_texture = None;
            material.normal_map_texture = None;
            material.uv_transform = Affine2::IDENTITY;
            material.alpha_mode = AlphaMode::Opaque;
        }
    }

    // animate_creature_sprites will bind the exact current animation frame on
    // this update because the cache key is deliberately invalidated.
    sprite.last_frame = usize::MAX;
    sprite.last_direction = SpriteDirection::North;
    sprite.last_animation = SpriteAnimation::Death;
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
    let duration = CARDINAL_MOVE_SECONDS * if diagonal { DIAGONAL_FACTOR } else { 1.0 };

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
    if sprite.kind == CreatureSpriteKind::CastleRat && sprite.animation != SpriteAnimation::Death {
        set_animation(sprite, SpriteAnimation::Attack, now);
    }
}

pub fn trigger_hit(sprite: &mut CreatureSprite, now: f64) {
    if sprite.kind == CreatureSpriteKind::CastleRat && sprite.animation != SpriteAnimation::Death {
        set_animation(sprite, SpriteAnimation::Hit, now);
    }
}

pub fn trigger_death(sprite: &mut CreatureSprite, now: f64) {
    if sprite.kind == CreatureSpriteKind::CastleRat {
        set_animation(sprite, SpriteAnimation::Death, now);
    }
}

pub fn report_creature_render_visibility(
    time: Res<Time>,
    movement: Res<MovementState>,
    creatures: Query<
        (
            &CreatureActor,
            &CreatureSprite,
            &Visibility,
            &InheritedVisibility,
            &ViewVisibility,
        ),
        With<PersistentCreatureVisual>,
    >,
    mut last_floor: Local<Option<i16>>,
    mut reports_remaining: Local<u8>,
    mut next_report_at: Local<f64>,
) {
    let now = time.elapsed_secs_f64();
    let floor = movement.logical.z;

    if *last_floor != Some(floor) {
        *last_floor = Some(floor);
        *reports_remaining = 12;
        *next_report_at = now;
    }

    if *reports_remaining == 0 || now < *next_report_at {
        return;
    }

    let mut entities = 0usize;
    let mut user_visible = 0usize;
    let mut inherited_visible = 0usize;
    let mut view_visible = 0usize;

    for (_actor, sprite, visibility, inherited, view) in &creatures {
        if sprite.logical_position.z != floor {
            continue;
        }

        entities += 1;
        if *visibility != Visibility::Hidden {
            user_visible += 1;
        }
        if inherited.get() {
            inherited_visible += 1;
        }
        if view.get() {
            view_visible += 1;
        }
    }

    info!(
        "ALDORIA CREATURE RENDER CHECK · floor {} · entities={} · visibility={} · inherited={} · view={}",
        floor, entities, user_visible, inherited_visible, view_visible,
    );

    *reports_remaining -= 1;
    *next_report_at = now + 0.25;
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

        let t = ((now - motion.started_at) / motion.duration).clamp(0.0, 1.0) as f32;
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
        if let Some(rotation) = billboard_rotation(transform.translation, camera_position) {
            transform.rotation = rotation;
        }
    }
}

pub fn animate_creature_sprites(
    time: Res<Time>,
    game_state: Res<NativeGameState>,
    catalog: Res<CreatureSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut creatures: Query<(&CreatureActor, &mut CreatureSprite)>,
) {
    let now = time.elapsed_secs_f64();

    for (actor, mut sprite) in &mut creatures {
        if sprite.kind != CreatureSpriteKind::CastleRat {
            continue;
        }

        // V36.79: the authoritative network path already starts the creature
        // attack/hit clip. Use the newest matching combat event only for
        // facing, so diagonal combat also uses the correct authored row.
        let animation = sprite.animation;
        let actor_id = actor.0;
        let combat = game_state.combat_visuals.iter().rev().find(|combat| {
            (animation == SpriteAnimation::Attack && combat.source_id == actor_id)
                || (animation == SpriteAnimation::Hit && combat.target_id == actor_id)
        });
        if let Some(combat) = combat {
            let opponent_id = if animation == SpriteAnimation::Attack {
                combat.target_id
            } else {
                combat.source_id
            };
            if let Some(opponent) = combat_entity_position(&game_state, opponent_id) {
                sprite.direction = SpriteDirection::from_delta(
                    opponent.x - sprite.logical_position.x,
                    opponent.y - sprite.logical_position.y,
                    sprite.direction,
                );
            }
        }

        advance_animation_state(&mut sprite, now);

        let (albedo, normal) = match sprite.animation {
            SpriteAnimation::Idle => (
                &catalog.castle_rat_idle_albedo,
                &catalog.castle_rat_idle_normal,
            ),
            SpriteAnimation::Walk => (
                &catalog.castle_rat_walk_albedo,
                &catalog.castle_rat_walk_normal,
            ),
            SpriteAnimation::Attack => (
                &catalog.castle_rat_attack_albedo,
                &catalog.castle_rat_attack_normal,
            ),
            SpriteAnimation::Hit => (
                &catalog.castle_rat_hit_albedo,
                &catalog.castle_rat_hit_normal,
            ),
            SpriteAnimation::Death => (
                &catalog.castle_rat_death_albedo,
                &catalog.castle_rat_death_normal,
            ),
            SpriteAnimation::Cast | SpriteAnimation::Use => continue,
        };
        let definition = *sprite.kind.definition();
        let Some(spec) = definition.spec(sprite.animation) else {
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

        // TIBIAGAME_V36_7_1_SPRITE_MATERIAL_MUT_FIX
        let Some(mut material) = materials.get_mut(&sprite.material) else {
            continue;
        };

        material.base_color_texture = Some(albedo.clone());
        material.normal_map_texture = Some(normal.clone());
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

fn combat_entity_position(
    game_state: &NativeGameState,
    entity_id: game_types::EntityId,
) -> Option<Position> {
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

fn advance_animation_state(sprite: &mut CreatureSprite, now: f64) {
    let elapsed = (now - sprite.animation_started_at).max(0.0);

    if sprite.animation == SpriteAnimation::Death {
        return;
    }

    let definition = *sprite.kind.definition();
    if definition.animation_locked(sprite.animation, elapsed) {
        return;
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

fn set_animation(sprite: &mut CreatureSprite, animation: SpriteAnimation, now: f64) {
    if sprite.animation == animation {
        return;
    }

    sprite.animation = animation;
    sprite.animation_started_at = now;
    sprite.last_frame = usize::MAX;
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
        "castle_rat" => (
            CASTLE_RAT_SPRITE_DEFINITION.render_width,
            CASTLE_RAT_SPRITE_DEFINITION.render_height,
            Color::WHITE,
        ),
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
        "ALDORIA SPRITE CREATURES · shared ActorSpriteDefinition · castle_rat=8dir idle/walk/attack/hit/death · remaining monsters=2D fallback billboards"
    );
}
