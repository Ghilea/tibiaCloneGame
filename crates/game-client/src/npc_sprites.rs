// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
use bevy::{camera::visibility::NoFrustumCulling, prelude::*};
use game_types::{NpcView, Position};

use crate::{
    MainCamera, MovementState, NpcActor,
    actor_sprites::{
        ActorAnimation, ActorSpriteAssets, SpriteDirection, atlas_uv, billboard_rotation,
        face_direction,
    },
    state::NativeGameState,
};

const NPC_MANIFEST: &str = "actors/npcs/default/actor.json";

#[derive(Component)]
pub struct NpcSprite {
    logical_position: Position,
    direction: SpriteDirection,
    animation: ActorAnimation,
    animation_started_at: f64,
    last_frame: usize,
    last_direction: SpriteDirection,
    last_animation: ActorAnimation,
    material: Handle<StandardMaterial>,
}

#[derive(Resource)]
pub struct NpcSpriteCatalog {
    quad: Handle<Mesh>,
    actor: ActorSpriteAssets,
}

impl NpcSpriteCatalog {
    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA NPC SPRITE · tangent generation failed: {error}");
        }

        Self {
            quad: meshes.add(quad),
            actor: ActorSpriteAssets::load(asset_server, NPC_MANIFEST),
        }
    }
}

pub fn spawn_npc_sprite(
    commands: &mut Commands,
    materials: &mut Assets<StandardMaterial>,
    catalog: &NpcSpriteCatalog,
    npc: &NpcView,
) -> Entity {
    let definition = &catalog.actor.definition;
    let idle = definition
        .spec(ActorAnimation::Idle)
        .expect("validated NPC manifest must define idle");
    let idle_texture = catalog
        .actor
        .texture(ActorAnimation::Idle)
        .expect("validated NPC manifest must load idle texture");

    let material = materials.add(StandardMaterial {
        base_color: npc_tint(npc),
        base_color_texture: Some(idle_texture.clone()),
        normal_map_texture: catalog.actor.normal(ActorAnimation::Idle).cloned(),
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
            Name::new(format!("NPC Sprite · {}", npc.name)),
            NpcActor(npc.id.clone()),
            NpcSprite {
                logical_position: npc.position,
                direction: SpriteDirection::South,
                animation: ActorAnimation::Idle,
                animation_started_at: 0.0,
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
    let definition = &catalog.actor.definition;
    let spec = definition
        .spec(ActorAnimation::Idle)
        .expect("validated NPC manifest must define idle");
    let idle_texture = catalog
        .actor
        .texture(ActorAnimation::Idle)
        .expect("validated NPC manifest must load idle texture");

    for (actor, mut sprite, mut transform) in &mut npcs {
        if let Some(npc) = game_state.npcs.get(&actor.0) {
            if sprite.logical_position != npc.position {
                sprite.logical_position = npc.position;
                transform.translation = sprite_world_position(npc.position, definition.render_height);
            }

            if npc.position.z == movement.logical.z {
                sprite.direction = face_direction(npc.position, movement.logical, sprite.direction);
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

        if sprite.last_frame == frame
            && sprite.last_direction == direction
            && sprite.last_animation == sprite.animation
        {
            continue;
        }

        let Some(mut material) = materials.get_mut(&sprite.material) else {
            continue;
        };
        material.base_color_texture = Some(idle_texture.clone());
        material.normal_map_texture = catalog.actor.normal(ActorAnimation::Idle).cloned();
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
        "ALDORIA NPC SPRITES · manifest={} · data-driven 8-direction presentation",
        NPC_MANIFEST,
    );
}
