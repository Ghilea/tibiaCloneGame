// TIBIAGAME_V36_88_CELLAR_WARDEN_AREA_TELEGRAPH
// TIBIAGAME_V36_88_1_TELEGRAPH_VISIBILITY_FIX
use bevy::prelude::*;

use crate::{
    CreatureActor, MovementState,
    creature_sprites::{self, CreatureSprite},
    state::NativeGameState,
};

#[derive(Component)]
pub(crate) struct AreaTelegraphTile {
    expires_at: f64,
}

#[derive(Default)]
pub(crate) struct TelegraphVisualRuntime {
    last_sequence: u64,
    tile_mesh: Option<Handle<Mesh>>,
    warning_material: Option<Handle<StandardMaterial>>,
}

pub(crate) fn update(
    mut commands: Commands,
    time: Res<Time>,
    game_state: Res<NativeGameState>,
    movement: Res<MovementState>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut runtime: Local<TelegraphVisualRuntime>,
    mut creatures: Query<(&CreatureActor, &mut CreatureSprite)>,
    active_tiles: Query<(Entity, &AreaTelegraphTile)>,
) {
    let now = time.elapsed_secs_f64();

    for (entity, tile) in &active_tiles {
        if now >= tile.expires_at {
            commands.entity(entity).despawn();
        }
    }

    let Some(telegraph) = game_state.last_telegraph.as_ref() else {
        return;
    };
    if telegraph.sequence <= runtime.last_sequence {
        return;
    }
    runtime.last_sequence = telegraph.sequence;

    for (actor, mut sprite) in &mut creatures {
        if actor.0 == telegraph.source_id {
            creature_sprites::trigger_telegraphed_attack(
                &mut sprite,
                telegraph.position,
                now,
            );
            break;
        }
    }

    if telegraph.position.z != movement.logical.z {
        return;
    }

    let tile_mesh = runtime
        .tile_mesh
        .get_or_insert_with(|| {
            let mesh = Rectangle::new(0.92, 0.92).mesh().build();
            meshes.add(mesh)
        })
        .clone();

    let warning_material = runtime
        .warning_material
        .get_or_insert_with(|| {
            materials.add(StandardMaterial {
                base_color: Color::srgba(0.96, 0.19, 0.08, 0.38),
                perceptual_roughness: 1.0,
                metallic: 0.0,
                unlit: true,
                alpha_mode: AlphaMode::Blend,
                double_sided: true,
                cull_mode: None,
                ..default()
            })
        })
        .clone();

    let radius = i32::from(telegraph.radius.min(6));
    let expires_at = now + telegraph.duration_ms.max(1) as f64 / 1000.0;

    for y_offset in -radius..=radius {
        for x_offset in -radius..=radius {
            commands.spawn((
                Name::new(format!(
                    "Area Telegraph · {} · seq {}",
                    telegraph.effect_id, telegraph.sequence
                )),
                AreaTelegraphTile { expires_at },
                Mesh3d(tile_mesh.clone()),
                MeshMaterial3d(warning_material.clone()),
                Transform {
                    translation: Vec3::new(
                        (telegraph.position.x + x_offset) as f32,
                        0.105,
                        (telegraph.position.y + y_offset) as f32,
                    ),
                    rotation: Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2),
                    ..default()
                },
                Visibility::default(),
            ));
        }
    }

    info!(
        "ALDORIA AREA TELEGRAPH · effect={} · seq={} · center={}:{}:{} · radius={} · duration={}ms",
        telegraph.effect_id,
        telegraph.sequence,
        telegraph.position.x,
        telegraph.position.y,
        telegraph.position.z,
        telegraph.radius,
        telegraph.duration_ms,
    );
}
