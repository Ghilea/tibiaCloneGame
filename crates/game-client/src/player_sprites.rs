// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
// TIBIAGAME_V36_81_CAST_USE_GATHERING_ACTIONS
// TIBIAGAME_V36_90_PLAYER_EQUIPMENT_LAYERS
// TIBIAGAME_V36_91_REMOTE_PLAYER_SPRITES
// TIBIAGAME_V36_92_REMOTE_EQUIPMENT_REPLICATION
// TIBIAGAME_V36_93_CHARACTER_APPEARANCE_COMPOSER
// TIBIAGAME_V36_94_CHARACTER_CUSTOMIZATION_UI
// TIBIAGAME_V36_94_1_CHARACTER_CUSTOMIZATION_RECOVERY
// TIBIAGAME_V36_95_AUTHORITATIVE_APPEARANCE
use std::collections::HashMap;

use bevy::{camera::visibility::NoFrustumCulling, prelude::*};
use game_types::{CharacterAppearance, EntityId, ItemInstance, Position};

use crate::{
    LocalIdentity, MainCamera, MovementState,
    actor_sprites::{
        ActorAnimation, ActorSpriteAssets, ActorSpriteDefinition, SpriteDirection, atlas_uv,
        billboard_rotation, face_direction, load_actor_index,
    },
    state::NativeGameState,
};

const PLAYER_MANIFEST: &str = "actors/players/default/actor.json";
const PLAYER_EQUIPMENT_INDEX: &str = "actors/players/equipment/index.json";

const PLAYER_APPEARANCE_INDEX: &str = "actors/players/appearance/index.json";
const APPEARANCE_LAYER_CATEGORIES: [&str; 7] =
    ["head", "face", "hair", "facial_hair", "torso", "legs", "feet"];

#[derive(Resource, Clone)]
pub(crate) struct LocalCharacterAppearance {
    pub(crate) body: String,
    pub(crate) head: String,
    pub(crate) face: String,
    pub(crate) hair: String,
    pub(crate) facial_hair: Option<String>,
    pub(crate) torso: String,
    pub(crate) legs: String,
    pub(crate) feet: String,
    pub(crate) skin_tone: String,
    pub(crate) hair_color: String,
    pub(crate) torso_color: String,
    pub(crate) legs_color: String,
    pub(crate) feet_color: String,
    pub(crate) customized: bool,
    last_legacy_outfit: String,
}

impl LocalCharacterAppearance {
    fn legacy_preset(outfit: &str) -> Self {
        let mut value = match outfit {
            "mage" => Self {
                body: "body_01".to_owned(),
                head: "head_03".to_owned(),
                face: "face_03".to_owned(),
                hair: "hair_04".to_owned(),
                facial_hair: None,
                torso: "torso_03".to_owned(),
                legs: "legs_03".to_owned(),
                feet: "feet_01".to_owned(),
                skin_tone: "skin_light".to_owned(),
                hair_color: "hair_black".to_owned(),
                torso_color: "cloth_violet".to_owned(),
                legs_color: "cloth_navy".to_owned(),
                feet_color: "leather_dark".to_owned(),
                customized: false,
                last_legacy_outfit: String::new(),
            },
            "ranger" => Self {
                body: "body_01".to_owned(),
                head: "head_02".to_owned(),
                face: "face_02".to_owned(),
                hair: "hair_03".to_owned(),
                facial_hair: Some("beard_02".to_owned()),
                torso: "torso_01".to_owned(),
                legs: "legs_01".to_owned(),
                feet: "feet_02".to_owned(),
                skin_tone: "skin_tan".to_owned(),
                hair_color: "hair_auburn".to_owned(),
                torso_color: "cloth_forest".to_owned(),
                legs_color: "cloth_earth".to_owned(),
                feet_color: "leather_brown".to_owned(),
                customized: false,
                last_legacy_outfit: String::new(),
            },
            "rogue" => Self {
                body: "body_01".to_owned(),
                head: "head_02".to_owned(),
                face: "face_02".to_owned(),
                hair: "hair_01".to_owned(),
                facial_hair: None,
                torso: "torso_02".to_owned(),
                legs: "legs_03".to_owned(),
                feet: "feet_01".to_owned(),
                skin_tone: "skin_warm".to_owned(),
                hair_color: "hair_black".to_owned(),
                torso_color: "cloth_charcoal".to_owned(),
                legs_color: "cloth_charcoal".to_owned(),
                feet_color: "leather_dark".to_owned(),
                customized: false,
                last_legacy_outfit: String::new(),
            },
            _ => Self {
                body: "body_02".to_owned(),
                head: "head_01".to_owned(),
                face: "face_01".to_owned(),
                hair: "hair_02".to_owned(),
                facial_hair: Some("beard_01".to_owned()),
                torso: "torso_02".to_owned(),
                legs: "legs_02".to_owned(),
                feet: "feet_02".to_owned(),
                skin_tone: "skin_warm".to_owned(),
                hair_color: "hair_brown".to_owned(),
                torso_color: "cloth_burgundy".to_owned(),
                legs_color: "cloth_charcoal".to_owned(),
                feet_color: "leather_brown".to_owned(),
                customized: false,
                last_legacy_outfit: String::new(),
            },
        };
        value.last_legacy_outfit = outfit.to_owned();
        value
    }

    pub(crate) fn customization_default(outfit: &str) -> Self {
        let mut value = Self::legacy_preset(outfit);
        value.body = "body_01".to_owned();
        value.head = "head_01".to_owned();
        value.face = "face_01".to_owned();
        value.hair = "hair_01".to_owned();
        value.facial_hair = None;
        value.torso = "torso_01".to_owned();
        value.legs = "legs_01".to_owned();
        value.feet = "feet_01".to_owned();
        value.skin_tone = "skin_warm".to_owned();
        value.hair_color = "hair_brown".to_owned();
        value.torso_color = "cloth_burgundy".to_owned();
        value.legs_color = "cloth_charcoal".to_owned();
        value.feet_color = "leather_brown".to_owned();
        value.customized = true;
        value
    }
}


pub(crate) fn local_appearance_from_authoritative(
    value: &CharacterAppearance,
    outfit: &str,
) -> LocalCharacterAppearance {
    LocalCharacterAppearance {
        body: value.body.clone(),
        head: value.head.clone(),
        face: value.face.clone(),
        hair: value.hair.clone(),
        facial_hair: value.facial_hair.clone(),
        torso: value.torso.clone(),
        legs: value.legs.clone(),
        feet: value.feet.clone(),
        skin_tone: value.skin_tone.clone(),
        hair_color: value.hair_color.clone(),
        torso_color: value.torso_color.clone(),
        legs_color: value.legs_color.clone(),
        feet_color: value.feet_color.clone(),
        customized: true,
        last_legacy_outfit: outfit.to_owned(),
    }
}

pub(crate) fn authoritative_appearance_from_local(
    value: &LocalCharacterAppearance,
) -> CharacterAppearance {
    CharacterAppearance {
        body: value.body.clone(),
        head: value.head.clone(),
        face: value.face.clone(),
        hair: value.hair.clone(),
        facial_hair: value.facial_hair.clone(),
        torso: value.torso.clone(),
        legs: value.legs.clone(),
        feet: value.feet.clone(),
        skin_tone: value.skin_tone.clone(),
        hair_color: value.hair_color.clone(),
        torso_color: value.torso_color.clone(),
        legs_color: value.legs_color.clone(),
        feet_color: value.feet_color.clone(),
    }
}

#[derive(Component)]
pub(crate) struct PlayerAppearanceLayer {
    category: String,
    material: Handle<StandardMaterial>,
}

#[derive(Component)]
pub(crate) struct PlayerAppearanceLayersReady;


const EQUIPMENT_LAYER_ORDER: [&str; 12] = ["back","backpack","chest","legs","feet","helmet","amulet","ring","weapon_melee","weapon_ranged","offhand_guard","offhand_light"];

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
impl LocalPlayerSprite {
    pub(crate) fn set_preview_direction(&mut self, direction: SpriteDirection) {
        self.direction = direction;
    }
}



#[derive(Component)]
pub(crate) struct PlayerEquipmentLayer {
    key: String,
    material: Handle<StandardMaterial>,
}

#[derive(Component)]
pub(crate) struct PlayerEquipmentLayersReady;

#[derive(Resource)]
pub struct PlayerSpriteCatalog {
    quad: Handle<Mesh>,
    actor: ActorSpriteAssets,
    equipment: HashMap<String, ActorSpriteAssets>,
    appearance: HashMap<String, ActorSpriteAssets>,
}

impl PlayerSpriteCatalog {
    pub(crate) fn body_actor(&self) -> &ActorSpriteAssets {
        &self.actor
    }

    pub(crate) fn body_quad(&self) -> Handle<Mesh> {
        self.quad.clone()
    }

    pub(crate) fn equipment_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {
        self.equipment.get(key)
    }

    pub(crate) fn appearance_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {
        self.appearance.get(key)
    }

    pub fn new(asset_server: &AssetServer, meshes: &mut Assets<Mesh>) -> Self {
        let mut quad = Rectangle::new(1.0, 1.0).mesh().build();
        if let Err(error) = quad.generate_tangents() {
            warn!("ALDORIA PLAYER SPRITE · tangent generation failed: {error}");
        }

        let mut appearance = HashMap::new();
        for entry in load_actor_index(PLAYER_APPEARANCE_INDEX) {
            let key = entry.game_definition_id;
            let actor = ActorSpriteAssets::load(asset_server, &entry.manifest);
            appearance.insert(key, actor);
        }

        info!(
            "ALDORIA CHARACTER APPEARANCE · {} composable actor variants · index={}",
            appearance.len(),
            PLAYER_APPEARANCE_INDEX,
        );

        let mut equipment = HashMap::new();
        for entry in load_actor_index(PLAYER_EQUIPMENT_INDEX) {
            let key = entry.game_definition_id;
            let actor = ActorSpriteAssets::load(asset_server, &entry.manifest);
            equipment.insert(key, actor);
        }

        info!(
            "ALDORIA PLAYER EQUIPMENT · {} synchronized layers · index={}",
            equipment.len(),
            PLAYER_EQUIPMENT_INDEX,
        );

        Self {
            quad: meshes.add(quad),
            actor: ActorSpriteAssets::load(asset_server, PLAYER_MANIFEST),
            equipment,
            appearance,
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



pub(crate) fn sync_local_character_appearance_resource(
    mut commands: Commands,
    identity: Res<LocalIdentity>,
    game_state: Res<NativeGameState>,
    appearance: Option<ResMut<LocalCharacterAppearance>>,
) {
    let Some(player) = game_state.local_player() else {
        return;
    };

    if appearance.is_none() {
        commands.insert_resource(local_appearance_from_authoritative(
            &player.appearance,
            &identity.outfit,
        ));
    }
}

pub(crate) fn ensure_local_player_appearance_layers(
    mut commands: Commands,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    roots: Query<Entity, (With<LocalPlayerSprite>, Without<PlayerAppearanceLayersReady>)>,
) {
    for root in &roots {
        for category in APPEARANCE_LAYER_CATEGORIES {
            let material = materials.add(StandardMaterial {
                base_color: Color::WHITE,
                perceptual_roughness: 0.9,
                metallic: 0.0,
                unlit: true,
                alpha_mode: AlphaMode::Mask(0.05),
                double_sided: true,
                cull_mode: None,
                depth_bias: appearance_layer_depth_bias(category),
                ..default()
            });

            commands.spawn((
                Name::new(format!("Player Appearance Layer · {category}")),
                PlayerAppearanceLayer {
                    category: category.to_owned(),
                    material: material.clone(),
                },
                NoFrustumCulling,
                ChildOf(root),
                Mesh3d(catalog.quad.clone()),
                MeshMaterial3d(material),
                Transform::default(),
                Visibility::Hidden,
            ));
        }
        commands.entity(root).insert(PlayerAppearanceLayersReady);
    }
}

pub(crate) fn sync_local_player_appearance_layers(
    time: Res<Time>,
    appearance: Option<Res<LocalCharacterAppearance>>,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    bodies: Query<&LocalPlayerSprite>,
    mut layers: Query<(&PlayerAppearanceLayer, &mut Visibility)>,
) {
    let Some(appearance) = appearance else {
        return;
    };
    let Some(body) = bodies.iter().next() else {
        return;
    };

    let now = time.elapsed_secs_f64();

    if let Some(actor) = catalog.appearance_actor(&appearance.body) {
        if let (Some(spec), Some(texture)) = (
            actor.definition.spec(body.animation),
            actor.texture(body.animation),
        ) {
            if let Some(mut material) = materials.get_mut(&body.material) {
                let frame = spec.frame_at((now - body.animation_started_at).max(0.0));
                material.base_color = appearance_color(&appearance.skin_tone);
                material.base_color_texture = Some(texture.clone());
                material.normal_map_texture = actor.normal(body.animation).cloned();
                material.uv_transform = atlas_uv(
                    spec.columns,
                    actor.definition.atlas_rows,
                    frame,
                    body.direction
                        .atlas_row(actor.definition.authored_directions),
                );
            }
        }
    }

    for (layer, mut visibility) in &mut layers {
        let Some(variant) = appearance_variant(&appearance, &layer.category) else {
            *visibility = Visibility::Hidden;
            continue;
        };
        let Some(actor) = catalog.appearance_actor(variant) else {
            *visibility = Visibility::Hidden;
            continue;
        };

        let animation = if actor.definition.spec(body.animation).is_some()
            && actor.texture(body.animation).is_some()
        {
            body.animation
        } else {
            ActorAnimation::Idle
        };

        let Some(spec) = actor.definition.spec(animation) else {
            *visibility = Visibility::Hidden;
            continue;
        };
        let Some(texture) = actor.texture(animation) else {
            *visibility = Visibility::Hidden;
            continue;
        };

        let frame = spec.frame_at((now - body.animation_started_at).max(0.0));
        let Some(mut material) = materials.get_mut(&layer.material) else {
            continue;
        };

        material.base_color = appearance_layer_color(&appearance, &layer.category);
        material.base_color_texture = Some(texture.clone());
        material.normal_map_texture = actor.normal(animation).cloned();
        material.uv_transform = atlas_uv(
            spec.columns,
            actor.definition.atlas_rows,
            frame,
            body.direction
                .atlas_row(actor.definition.authored_directions),
        );
        *visibility = Visibility::Visible;
    }
}

fn appearance_variant<'a>(
    appearance: &'a LocalCharacterAppearance,
    category: &str,
) -> Option<&'a str> {
    match category {
        "head" => Some(&appearance.head),
        "face" => Some(&appearance.face),
        "hair" => Some(&appearance.hair),
        "facial_hair" => appearance.facial_hair.as_deref(),
        "torso" => Some(&appearance.torso),
        "legs" => Some(&appearance.legs),
        "feet" => Some(&appearance.feet),
        _ => None,
    }
}

fn appearance_layer_color(
    appearance: &LocalCharacterAppearance,
    category: &str,
) -> Color {
    match category {
        "head" => appearance_color(&appearance.skin_tone),
        "face" => Color::WHITE,
        "hair" | "facial_hair" => appearance_color(&appearance.hair_color),
        "torso" => appearance_color(&appearance.torso_color),
        "legs" => appearance_color(&appearance.legs_color),
        "feet" => appearance_color(&appearance.feet_color),
        _ => Color::WHITE,
    }
}

pub(crate) fn appearance_color(id: &str) -> Color {
    match id {
        "skin_light" => Color::srgb(1.00, 0.82, 0.69),
        "skin_warm" => Color::srgb(0.88, 0.66, 0.50),
        "skin_tan" => Color::srgb(0.72, 0.50, 0.35),
        "skin_deep" => Color::srgb(0.48, 0.31, 0.23),

        "hair_black" => Color::srgb(0.18, 0.16, 0.17),
        "hair_brown" => Color::srgb(0.39, 0.25, 0.17),
        "hair_auburn" => Color::srgb(0.52, 0.24, 0.15),
        "hair_blonde" => Color::srgb(0.78, 0.66, 0.40),
        "hair_gray" => Color::srgb(0.55, 0.55, 0.55),

        "cloth_burgundy" => Color::srgb(0.52, 0.20, 0.25),
        "cloth_forest" => Color::srgb(0.25, 0.42, 0.25),
        "cloth_violet" => Color::srgb(0.39, 0.27, 0.53),
        "cloth_charcoal" => Color::srgb(0.25, 0.25, 0.28),
        "cloth_navy" => Color::srgb(0.22, 0.30, 0.43),
        "cloth_earth" => Color::srgb(0.42, 0.33, 0.24),
        "cloth_cream" => Color::srgb(0.75, 0.70, 0.58),

        "leather_brown" => Color::srgb(0.39, 0.26, 0.17),
        "leather_dark" => Color::srgb(0.21, 0.17, 0.15),
        "leather_tan" => Color::srgb(0.55, 0.39, 0.23),
        _ => Color::WHITE,
    }
}

pub(crate) fn appearance_layer_depth_bias(category: &str) -> f32 {
    match category {
        "torso" => 2.0,
        "legs" => 3.0,
        "feet" => 4.0,
        "head" => 5.0,
        "face" => 6.0,
        "hair" => 7.0,
        "facial_hair" => 8.0,
        _ => 1.0,
    }
}

pub(crate) fn ensure_local_player_equipment_layers(
    mut commands: Commands,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    roots: Query<Entity, (With<LocalPlayerSprite>, Without<PlayerEquipmentLayersReady>)>,
) {
    for root in &roots {
        for key in EQUIPMENT_LAYER_ORDER {
            let actor = catalog
                .equipment
                .get(key)
                .unwrap_or_else(|| panic!("validated player equipment catalog missing '{key}'"));
            let definition = &actor.definition;
            let idle = definition
                .spec(ActorAnimation::Idle)
                .expect("validated equipment layer must define idle");
            let idle_texture = actor
                .texture(ActorAnimation::Idle)
                .expect("validated equipment layer must load idle texture");

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
                depth_bias: equipment_layer_depth_bias(key),
                ..default()
            });

            commands.spawn((
                Name::new(format!("Player Equipment Layer · {key}")),
                PlayerEquipmentLayer {
                    key: key.to_owned(),
                    material: material.clone(),
                },
                NoFrustumCulling,
                ChildOf(root),
                Mesh3d(catalog.quad.clone()),
                MeshMaterial3d(material),
                Transform::default(),
                Visibility::Hidden,
            ));
        }
        commands.entity(root).insert(PlayerEquipmentLayersReady);
    }
}

pub(crate) fn sync_local_player_equipment_layers(
    time: Res<Time>,
    game_state: Res<NativeGameState>,
    catalog: Res<PlayerSpriteCatalog>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    bodies: Query<&LocalPlayerSprite>,
    mut layers: Query<(&PlayerEquipmentLayer, &mut Visibility)>,
) {
    let Some(body) = bodies.iter().next() else {
        return;
    };
    let now = time.elapsed_secs_f64();

    for (layer, mut visibility) in &mut layers {
        let active = game_state.inventory.iter().any(|item| {
            equipment_visual_key_for_item(&game_state, item)
                .is_some_and(|key| key == layer.key)
        });

        *visibility = if active { Visibility::Visible } else { Visibility::Hidden };
        if !active {
            continue;
        }

        let Some(actor) = catalog.equipment.get(&layer.key) else {
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

fn equipment_visual_key_for_item(
    game_state: &NativeGameState,
    item: &ItemInstance,
) -> Option<&'static str> {
    let slot = item.equipped_slot.as_deref()?.to_ascii_lowercase();
    match slot.as_str() {
        "helmet" | "head" => Some("helmet"),
        "chest" | "armor" | "body" => Some("chest"),
        "legs" | "pants" => Some("legs"),
        "feet" | "boots" | "shoes" => Some("feet"),
        "back" | "cape" => Some("back"),
        "backpack" | "bag" => Some("backpack"),
        "amulet" | "neck" => Some("amulet"),
        "ring" | "ring1" | "ring2" => Some("ring"),
        "weapon" | "right_hand" | "righthand" | "main_hand" | "mainhand" => {
            let ranged = game_state
                .item_definitions
                .get(&item.definition_id)
                .is_some_and(|definition| definition.distance_weapon.is_some());
            Some(if ranged { "weapon_ranged" } else { "weapon_melee" })
        }
        "offhand" | "off_hand" | "left_hand" | "lefthand" => {
            let light = game_state
                .item_definitions
                .get(&item.definition_id)
                .is_some_and(|definition| definition.light_source.is_some());
            Some(if light { "offhand_light" } else { "offhand_guard" })
        }
        _ => None,
    }
}

pub(crate) fn equipment_layer_depth_bias(key: &str) -> f32 {
    match key {
        "back" => -30.0,
        "backpack" => -20.0,
        "chest" => 10.0,
        "legs" => 14.0,
        "feet" => 18.0,
        "helmet" => 22.0,
        "amulet" => 28.0,
        "ring" => 32.0,
        "weapon_melee" => 42.0,
        "weapon_ranged" => 42.0,
        "offhand_guard" => 46.0,
        "offhand_light" => 46.0,
        _ => 8.0,
    }
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
) {
    let Some(player) = game_state.local_player() else {
        return;
    };
    if player.outfit == identity.outfit {
        return;
    }

    identity.outfit = player.outfit.clone();
    info!(
        "ALDORIA CHARACTER APPEARANCE · legacy preset seed changed to {}",
        identity.outfit,
    );
}

pub(crate) fn outfit_tint(outfit: &str) -> Color {
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
