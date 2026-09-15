// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
// TIBIAGAME_V36_89_NPC_SERVICE_VARIANTS
use std::collections::HashMap;

use bevy::{camera::visibility::NoFrustumCulling, prelude::*};
use game_types::{NpcView, Position};

use crate::{
    MainCamera, MovementState, NpcActor,
    actor_sprites::{
        ActorAnimation, ActorSpriteAssets, SpriteDirection, atlas_uv, billboard_rotation,
        face_direction, load_actor_index,
    },
    state::NativeGameState,
};

const NPC_INDEX: &str = "actors/npcs/index.json";
const NPC_FALLBACK_MANIFEST: &str = "actors/npcs/default/actor.json";

#[derive(Component)]
pub struct NpcSprite {
    logical_position: Position,
    direction: SpriteDirection,
    animation: ActorAnimation,
    animation_started_at: f64,
    actor_key: String,
    last_actor_key: String,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: ActorAnimation,
    material: Handle<StandardMaterial>,
}

#[derive(Resource)]
pub struct NpcSpriteCatalog {
    quad: Handle<Mesh>,
    fallback: ActorSpriteAssets,
    actors: HashMap<String, ActorSpriteAssets>,
}

impl NpcSpriteCatalog {
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA NPC SPRITE · tangent generation failed: {error}");
        }

        let mut actors = HashMap::new();
        for entry in load_actor_index(NPC_INDEX) {
            let service = entry.game_definition_id;
            let actor = ActorSpriteAssets::load(asset_server, &entry.manifest);
            actors.insert(service, actor);
        }

        info!(
            "ALDORIA NPC SPRITES · {} service variants · fallback={}",
            actors.len(),
            NPC_FALLBACK_MANIFEST,
        );

        Self {
            quad: meshes.add(quad),
            fallback: ActorSpriteAssets::load(asset_server, NPC_FALLBACK_MANIFEST),
            actors,
        }
    }

    fn actor_for(&self, service: &str) -> (&ActorSpriteAssets, bool) {
        if let Some(actor) = self.actors.get(service) {
            (actor, true)
        } else {
            (&self.fallback, false)
        }
    }
}

pub fn spawn_npc_sprite(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &NpcSpriteCatalog,
    npc: &NpcView,
) -> Entity {
    let (actor, authored_variant) = catalog.actor_for(&npc.service);
    let definition = &actor.definition;
    let idle = definition
        .spec(ActorAnimation::Idle)
        .expect("validated NPC manifest must define idle");
    let idle_texture = actor
        .texture(ActorAnimation::Idle)
        .expect("validated NPC manifest must load idle texture");

    let material = materials.add(StandardMaterial {
        base_color: if authored_variant {
            Color::srgb(1.0, 1.0, 1.0)
        } else {
            npc_tint(npc)
        },
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

    commands
        .spawn((
            Name::new(format!("NPC Sprite · {} · {}", npc.name, npc.service)),
            NpcActor(npc.id.clone()),
            NpcSprite {
                logical_position: npc.position,
                direction: SpriteDirection::South,
                animation: ActorAnimation::Idle,
                animation_started_at: 0.0,
                actor_key: npc.service.clone(),
                last_actor_key: String::new(),
                last_frame: usize::MAX,
                last_direction: SpriteDirection::North,
                last_animation: ActorAnimation::Use,
                material: material.clone(),
            },
            NoFrustumCulling,
            Mesh3d(catalog.quad.clone()),
            MeshMaterial3d(material),
            Transform {
                translation: sprite_world_position(npc.position, definition.render_height),
                rotation: Quat::from_rotation_y(std::f32::consts::PI),
                scale: Vec3::new(definition.render_width, definition.render_height, 1.0),
            },
            Visibility::default(),
        ))
        .id()
}

pub fn animate_npc_sprites(
    time: Res<Time>,
    movement: Res<MovementState>,
    game_state: Res<NativeGameState>,
    catalog: Res<NpcSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut npcs: Query<(&NpcActor, &mut NpcSprite, &mut Transform)>,
) {
    let now = time.elapsed_secs_f64();

    for (npc_actor, mut sprite, mut transform) in &mut npcs {
        let npc = game_state.npcs.get(&npc_actor.0);

        if let Some(npc) = npc {
            if sprite.actor_key != npc.service {
                sprite.actor_key = npc.service.clone();
                sprite.last_actor_key.clear();
                sprite.last_frame = usize::MAX;
            }
        }

        let (actor, authored_variant) = catalog.actor_for(&sprite.actor_key);
        let definition = &actor.definition;
        let spec = definition
            .spec(ActorAnimation::Idle)
            .expect("validated NPC manifest must define idle");
        let idle_texture = actor
            .texture(ActorAnimation::Idle)
            .expect("validated NPC manifest must load idle texture");

        if let Some(npc) = npc {
            if sprite.logical_position != npc.position {
                sprite.logical_position = npc.position;
            }

            transform.translation =
                sprite_world_position(sprite.logical_position, definition.render_height);
            transform.scale =
                Vec3::new(definition.render_width, definition.render_height, 1.0);

            if npc.position.z == movement.logical.z {
                sprite.direction =
                    face_direction(npc.position, movement.logical, sprite.direction);
            }
        }

        if sprite.animation != ActorAnimation::Idle {
            sprite.animation = ActorAnimation::Idle;
            sprite.animation_started_at = now;
            sprite.last_frame = usize::MAX;
        }

        let elapsed = (now - sprite.animation_started_at).max(0.0);
        let frame = spec.frame_at(elapsed);
        let direction = sprite.direction;
        let actor_changed = sprite.last_actor_key != sprite.actor_key;

        if !actor_changed
            && sprite.last_frame == frame
            && sprite.last_direction == direction
            && sprite.last_animation == sprite.animation
        {
            continue;
        }

        let Some(mut material) = materials.get_mut(&sprite.material) else {
            continue;
        };

        material.base_color = if authored_variant {
            Color::srgb(1.0, 1.0, 1.0)
        } else if let Some(npc) = npc {
            npc_tint(npc)
        } else {
            Color::srgb(1.0, 1.0, 1.0)
        };
        material.base_color_texture = Some(idle_texture.clone());
        material.normal_map_texture = actor.normal(ActorAnimation::Idle).cloned();
        material.uv_transform = atlas_uv(
            spec.columns,
            definition.atlas_rows,
            frame,
            direction.atlas_row(definition.authored_directions),
        );

        sprite.last_actor_key = sprite.actor_key.clone();
        sprite.last_frame = frame;
        sprite.last_direction = direction;
        sprite.last_animation = sprite.animation;
    }
}

pub fn face_npc_sprites_to_camera(
    camera: Query<&GlobalTransform, With<MainCamera>>,
    mut npcs: Query<(&GlobalTransform, &mut Transform), With<NpcSprite>>,
) {
    let Some(camera_transform) = camera.iter().next() else {
        return;
    };
    let camera_position = camera_transform.translation();

    for (global, mut transform) in &mut npcs {
        if let Some(rotation) = billboard_rotation(global.translation(), camera_position) {
            transform.rotation = rotation;
        }
    }
}

fn sprite_world_position(position: Position, render_height: f32) -> Vec3 {
    Vec3::new(
        position.x as f32,
        render_height * 0.5 + 0.025,
        position.y as f32,
    )
}

fn npc_tint(npc: &NpcView) -> Color {
    let role = format!("{} {} {}", npc.id, npc.title, npc.service).to_ascii_lowercase();

    if role.contains("mage") || role.contains("wizard") || role.contains("healer") {
        Color::srgb(0.72, 0.78, 1.0)
    } else if role.contains("ranger") || role.contains("hunter") || role.contains("archer") {
        Color::srgb(0.72, 0.92, 0.70)
    } else if role.contains("rogue") || role.contains("thief") || role.contains("merchant") {
        Color::srgb(0.88, 0.78, 0.64)
    } else {
        match npc
            .id
            .bytes()
            .fold(0u8, |value, byte| value.wrapping_add(byte))
            % 4
        {
            0 => Color::srgb(0.92, 0.92, 0.96),
            1 => Color::srgb(0.78, 0.84, 1.0),
            2 => Color::srgb(0.78, 0.96, 0.76),
            _ => Color::srgb(0.92, 0.80, 0.68),
        }
    }
}

pub fn describe_catalog() {
    info!(
        "ALDORIA NPC SPRITES · index={} · service-driven 8-direction presentation",
        NPC_INDEX,
    );
}
