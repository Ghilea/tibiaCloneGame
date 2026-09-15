// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
// TIBIAGAME_V36_85_MIRE_CREATURE_EXPANSION
// TIBIAGAME_V36_86_SWAMP_CREATURE_EXPANSION
// TIBIAGAME_V36_87_CRYPT_CREATURE_EXPANSION
// TIBIAGAME_V36_88_CELLAR_WARDEN_AREA_TELEGRAPH
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use bevy::{camera::visibility::NoFrustumCulling, math::Affine2, prelude::*};
use game_types::{CreatureView, Position};

use crate::{
    CreatureActor, MainCamera, MovementState,
    actor_sprites::{
        ActorAnimation, ActorSpriteAssets, ActorSpriteDefinition, atlas_uv, billboard_rotation,
        load_actor_index,
    },
    state::NativeGameState,
};

const CARDINAL_MOVE_SECONDS: f64 = 0.165;
const DIAGONAL_FACTOR: f64 = std::f64::consts::SQRT_2;
const CREATURE_INDEX: &str = "actors/creatures/index.json";
const PLACEHOLDER_TEXTURE: &str = "monsters/native_sprite_placeholder_v36_7.png";

pub use crate::actor_sprites::SpriteDirection;

type SpriteAnimation = ActorAnimation;

#[derive(Component)]
pub struct PersistentCreatureVisual;

#[derive(Component)]
pub struct CreatureSprite {
    definition_id: String,
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
    actors: HashMap<String, ActorSpriteAssets>,
    missing_manifest_warnings: Mutex<HashSet<String>>,
}

impl CreatureSpriteCatalog {
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA SPRITE QUAD · tangent generation failed: {error}");
        }

        let mut actors = HashMap::new();
        for entry in load_actor_index(CREATURE_INDEX) {
            let assets = ActorSpriteAssets::load(asset_server, &entry.manifest);
            if actors
                .insert(entry.game_definition_id.clone(), assets)
                .is_some()
            {
                panic!(
                    "ALDORIA CREATURE MANIFEST DUPLICATE · {}",
                    entry.game_definition_id,
                );
            }
        }

        info!(
            "ALDORIA CREATURE MANIFEST CATALOG · {} registered definitions · {}",
            actors.len(),
            CREATURE_INDEX,
        );

        Self {
            quad: meshes.add(quad),
            placeholder: asset_server.load(PLACEHOLDER_TEXTURE),
            actors,
            missing_manifest_warnings: Mutex::new(HashSet::new()),
        }
    }

    fn actor(&self, definition_id: &str) -> Option<&ActorSpriteAssets> {
        self.actors.get(definition_id)
    }

    fn actor_or_warn(&self, definition_id: &str) -> Option<&ActorSpriteAssets> {
        let actor = self.actor(definition_id);
        if actor.is_none()
            && let Ok(mut warned) = self.missing_manifest_warnings.lock()
            && warned.insert(definition_id.to_owned())
        {
            warn!(
                "ALDORIA CREATURE SPRITE FALLBACK · no actor manifest registered for definition_id='{}' · using solid billboard fallback",
                definition_id,
            );
        }
        actor
    }
}

pub fn spawn_creature_render_warmup(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &CreatureSpriteCatalog,
) {
    let mut probe_index = 0usize;

    for (game_definition_id, actor) in &catalog.actors {
        for animation in ActorAnimation::ALL {
            let Some(spec) = actor.definition.spec(animation) else {
                continue;
            };
            let Some(texture) = actor.texture(animation) else {
                continue;
            };

            let material = materials.add(StandardMaterial {
                base_color: Color::WHITE,
                base_color_texture: Some(texture.clone()),
                normal_map_texture: actor.normal(animation).cloned(),
                uv_transform: atlas_uv(
                    spec.columns,
                    actor.definition.atlas_rows,
                    0,
                    SpriteDirection::South.atlas_row(actor.definition.authored_directions),
                ),
                perceptual_roughness: 0.9,
                metallic: 0.0,
                unlit: true,
                alpha_mode: AlphaMode::Mask(0.05),
                double_sided: true,
                cull_mode: None,
                ..default()
            });

            commands.spawn((
                Name::new(format!(
                    "Creature GPU warmup · {} · {}",
                    game_definition_id,
                    animation.as_str(),
                )),
                NoFrustumCulling,
                Mesh3d(catalog.quad.clone()),
                MeshMaterial3d(material),
                Transform::from_xyz(
                    -10_000.0 - probe_index as f32 * 2.0,
                    -10_000.0,
                    -10_000.0,
                ),
                Visibility::default(),
            ));
            probe_index += 1;
        }
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
        "ALDORIA CREATURE GPU WARMUP · {} manifest animation probes + placeholder queued",
        probe_index,
    );
}

pub fn floor_transition_creature_assets_ready(
    asset_server: &AssetServer,
    catalog: &CreatureSpriteCatalog,
) -> bool {
    asset_server.is_loaded_with_dependencies(catalog.placeholder.id())
        && catalog
            .actors
            .values()
            .all(|actor| actor.is_loaded(asset_server))
}

pub fn spawn_creature_sprite(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &CreatureSpriteCatalog,
    creature: &CreatureView,
) -> Entity {
    let authored = catalog.actor_or_warn(&creature.definition_id);
    let (render_width, render_height, tint) = if let Some(actor) = authored {
        (
            actor.definition.render_width,
            actor.definition.render_height,
            Color::WHITE,
        )
    } else {
        creature_visual_style(&creature.definition_id)
    };

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

    if let Some(actor) = authored {
        let idle = actor
            .definition
            .spec(ActorAnimation::Idle)
            .expect("validated creature manifest must define idle");
        let idle_texture = actor
            .texture(ActorAnimation::Idle)
            .expect("validated creature manifest must load idle texture");
        material.base_color = Color::WHITE;
        material.base_color_texture = Some(idle_texture.clone());
        material.normal_map_texture = actor.normal(ActorAnimation::Idle).cloned();
        material.uv_transform = atlas_uv(
            idle.columns,
            actor.definition.atlas_rows,
            0,
            SpriteDirection::South.atlas_row(actor.definition.authored_directions),
        );
    } else {
        // Unregistered server creatures remain visible as opaque tinted
        // billboards. Adding production art requires only actor.json + index.json.
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
                definition_id: creature.definition_id.clone(),
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
        let Some(creature) = game_state.creatures.get(&actor.0) else {
            commands.entity(entity).despawn();
            continue;
        };

        if sprite.definition_id != creature.definition_id {
            commands.entity(entity).despawn();
            continue;
        }

        if !existing_ids.insert(actor.0) {
            commands.entity(entity).despawn();
            continue;
        }

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
            "ALDORIA CREATURE VISUAL CACHE · spawned {} · {} · floor {} · hidden={} · manifest={}",
            creature.id,
            creature.definition_id,
            creature.position.z,
            creature.position.z != visible_floor,
            catalog.actor(&creature.definition_id).is_some(),
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

    if let Some(actor) = catalog.actor(&sprite.definition_id) {
        let idle = actor
            .definition
            .spec(ActorAnimation::Idle)
            .expect("validated creature manifest must define idle");
        material.base_color = Color::WHITE;
        material.base_color_texture = actor.texture(ActorAnimation::Idle).cloned();
        material.normal_map_texture = actor.normal(ActorAnimation::Idle).cloned();
        material.uv_transform = atlas_uv(
            idle.columns,
            actor.definition.atlas_rows,
            0,
            SpriteDirection::South.atlas_row(actor.definition.authored_directions),
        );
        material.alpha_mode = AlphaMode::Mask(0.05);
    } else {
        let (_, _, tint) = creature_visual_style(&creature.definition_id);
        material.base_color = tint;
        material.base_color_texture = None;
        material.normal_map_texture = None;
        material.uv_transform = Affine2::IDENTITY;
        material.alpha_mode = AlphaMode::Opaque;
    }

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
        SpriteAnimation::Attack
            | SpriteAnimation::Hit
            | SpriteAnimation::Death
            | SpriteAnimation::Cast
            | SpriteAnimation::Use
    ) {
        set_animation(sprite, SpriteAnimation::Walk, now);
    }
}

pub fn trigger_attack(sprite: &mut CreatureSprite, now: f64) {
    if sprite.animation != SpriteAnimation::Death {
        set_animation(sprite, SpriteAnimation::Attack, now);
    }
}

pub fn trigger_telegraphed_attack(
    sprite: &mut CreatureSprite,
    target: Position,
    now: f64,
) {
    if sprite.animation == SpriteAnimation::Death {
        return;
    }

    sprite.direction = SpriteDirection::from_delta(
        target.x - sprite.logical_position.x,
        target.y - sprite.logical_position.y,
        sprite.direction,
    );
    set_animation(sprite, SpriteAnimation::Attack, now);
}

pub fn trigger_hit(sprite: &mut CreatureSprite, now: f64) {
    if sprite.animation != SpriteAnimation::Death {
        set_animation(sprite, SpriteAnimation::Hit, now);
    }
}

pub fn trigger_death(sprite: &mut CreatureSprite, now: f64) {
    set_animation(sprite, SpriteAnimation::Death, now);
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
        let Some(actor_assets) = catalog.actor(&sprite.definition_id) else {
            if sprite.animation != SpriteAnimation::Death {
                let desired = if now < sprite.walk_until {
                    SpriteAnimation::Walk
                } else {
                    SpriteAnimation::Idle
                };
                if sprite.animation != desired {
                    set_animation(&mut sprite, desired, now);
                }
            }
            continue;
        };
        let definition = &actor_assets.definition;

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

        advance_animation_state(&mut sprite, definition, now);

        if definition.spec(sprite.animation).is_none()
            || actor_assets.texture(sprite.animation).is_none()
        {
            set_animation(&mut sprite, SpriteAnimation::Idle, now);
        }

        let animation = sprite.animation;
        let spec = definition
            .spec(animation)
            .expect("validated creature manifest must define idle");
        let texture = actor_assets
            .texture(animation)
            .expect("validated creature manifest texture missing");

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

        material.base_color = Color::WHITE;
        material.base_color_texture = Some(texture.clone());
        material.normal_map_texture = actor_assets.normal(animation).cloned();
        material.alpha_mode = AlphaMode::Mask(0.05);
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

fn advance_animation_state(
    sprite: &mut CreatureSprite,
    definition: &ActorSpriteDefinition,
    now: f64,
) {
    let elapsed = (now - sprite.animation_started_at).max(0.0);

    if definition.animation_locked(sprite.animation, elapsed) {
        return;
    }

    let desired = if now < sprite.walk_until && definition.spec(SpriteAnimation::Walk).is_some() {
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
        _ => (0.95, 1.15, Color::srgb(0.68, 0.32, 0.38)),
    }
}

pub fn describe_catalog() {
    info!(
        "ALDORIA SPRITE CREATURES · manifest index={} · add creatures with JSON + sprite sheets, no Rust registration",
        CREATURE_INDEX,
    );
}
