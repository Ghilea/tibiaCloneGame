use bevy::{
    image::{ImageAddressMode, ImageLoaderSettings, ImageSampler},
    math::Affine2,
    prelude::*,
};

const GRASS: &str = "world/greyhaven-grass.png";
const ROAD: &str = "world/greyhaven-cobble.png";
const PACKED_EARTH: &str = "world/aldoria-packed-earth-v1.png";
const MOSS_STONE: &str = "world/aldoria-moss-stone-v1.png";
const SANDSTONE: &str = "world/aldoria-sandstone-v1.png";
const MUD: &str = "world/aldoria-mud-v1.png";
const GRAVEL: &str = "world/aldoria-gravel-v1.png";
const CRYPT_STONE: &str = "world/aldoria-crypt-stone-v1.png";
const WOOD_PLANKS: &str = "world/aldoria-wood-planks-floor-v1.png";
const MARSH_GRASS: &str = "world/aldoria-marsh-grass-v1.png";
const ASH_SOIL: &str = "world/aldoria-ash-soil-v1.png";
const WATER: &str = "world/aldoria-water-v1.png";
const BRIDGE: &str = "world/aldoria-bridge-planks-v1.png";
const CASTLE_STONE: &str = "world/aldoria-castle-stone-v2.png";
const TIMBER_PLASTER: &str = "world/aldoria-timber-plaster-v1.png";
const ROOF_TILES: &str = "world/aldoria-roof-tiles-v1.png";

const GROUND_CHUNK_TEXTURE_REPEAT: f32 = 16.0;

#[derive(Clone)]
pub struct WorldMaterialSet {
    pub floor: Handle<StandardMaterial>,
    pub ground_underlay: Handle<StandardMaterial>,
    pub road: Handle<StandardMaterial>,
    pub water: Handle<StandardMaterial>,
    pub bridge: Handle<StandardMaterial>,
    pub house_wall: Handle<StandardMaterial>,
    pub castle_wall: Handle<StandardMaterial>,
    pub building_floor: Handle<StandardMaterial>,
    pub roof: Handle<StandardMaterial>,
    pub packed_earth: Handle<StandardMaterial>,
    pub moss_stone: Handle<StandardMaterial>,
    pub sandstone: Handle<StandardMaterial>,
    pub mud: Handle<StandardMaterial>,
    pub gravel: Handle<StandardMaterial>,
    pub crypt_stone: Handle<StandardMaterial>,
    pub wood_planks: Handle<StandardMaterial>,
    pub marsh_grass: Handle<StandardMaterial>,
    pub ash_soil: Handle<StandardMaterial>,
}

impl WorldMaterialSet {
    pub fn terrain(&self, material: &str) -> Handle<StandardMaterial> {
        match material {
            "packed_earth" => self.packed_earth.clone(),
            "moss_stone" => self.moss_stone.clone(),
            "sandstone" => self.sandstone.clone(),
            "mud" => self.mud.clone(),
            "gravel" => self.gravel.clone(),
            "crypt_stone" => self.crypt_stone.clone(),
            "wood_planks" => self.wood_planks.clone(),
            "marsh_grass" => self.marsh_grass.clone(),
            "ash_soil" => self.ash_soil.clone(),
            _ => self.floor.clone(),
        }
    }
}

pub fn create_materials(
    asset_server: &AssetServer,
    materials: &mut Assets<StandardMaterial>,
) -> WorldMaterialSet {
    let floor = add_textured(
        asset_server,
        materials,
        GRASS,
        Color::WHITE,
        0.98,
    );

    // V36.9.3: this is not the old flat-green "lawn skirt".
    // It is the real grass texture with a repeating linear sampler, placed
    // below authored floor/terrain/road/water tiles.
    let ground_underlay = materials.add(StandardMaterial {
        base_color: Color::WHITE,
        base_color_texture: Some(load_repeating(asset_server, GRASS)),
        perceptual_roughness: 0.98,
        uv_transform: Affine2::from_scale(Vec2::splat(
            GROUND_CHUNK_TEXTURE_REPEAT,
        )),
        ..default()
    });

    let road = add_textured(
        asset_server,
        materials,
        ROAD,
        Color::WHITE,
        1.0,
    );
    let bridge = add_textured(
        asset_server,
        materials,
        BRIDGE,
        Color::WHITE,
        0.88,
    );
    let house_wall = add_textured(
        asset_server,
        materials,
        TIMBER_PLASTER,
        Color::WHITE,
        0.86,
    );
    let castle_wall = add_textured(
        asset_server,
        materials,
        CASTLE_STONE,
        Color::WHITE,
        0.82,
    );
    let building_floor = add_textured(
        asset_server,
        materials,
        WOOD_PLANKS,
        Color::WHITE,
        0.93,
    );
    let roof = add_textured(
        asset_server,
        materials,
        ROOF_TILES,
        Color::WHITE,
        0.90,
    );

    let water = materials.add(StandardMaterial {
        base_color: Color::srgba(0.80, 0.91, 1.0, 0.82),
        base_color_texture: Some(load_repeating(asset_server, WATER)),
        perceptual_roughness: 0.27,
        metallic: 0.04,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    WorldMaterialSet {
        floor,
        ground_underlay,
        road,
        water,
        bridge,
        house_wall,
        castle_wall,
        building_floor,
        roof,
        packed_earth: add_textured(
            asset_server,
            materials,
            PACKED_EARTH,
            Color::WHITE,
            0.98,
        ),
        moss_stone: add_textured(
            asset_server,
            materials,
            MOSS_STONE,
            Color::WHITE,
            0.92,
        ),
        sandstone: add_textured(
            asset_server,
            materials,
            SANDSTONE,
            Color::WHITE,
            0.94,
        ),
        mud: add_textured(
            asset_server,
            materials,
            MUD,
            Color::WHITE,
            1.0,
        ),
        gravel: add_textured(
            asset_server,
            materials,
            GRAVEL,
            Color::WHITE,
            1.0,
        ),
        crypt_stone: add_textured(
            asset_server,
            materials,
            CRYPT_STONE,
            Color::WHITE,
            0.92,
        ),
        wood_planks: add_textured(
            asset_server,
            materials,
            WOOD_PLANKS,
            Color::WHITE,
            0.92,
        ),
        marsh_grass: add_textured(
            asset_server,
            materials,
            MARSH_GRASS,
            Color::WHITE,
            0.98,
        ),
        ash_soil: add_textured(
            asset_server,
            materials,
            ASH_SOIL,
            Color::WHITE,
            1.0,
        ),
    }
}

fn add_textured(
    asset_server: &AssetServer,
    materials: &mut Assets<StandardMaterial>,
    path: &'static str,
    tint: Color,
    roughness: f32,
) -> Handle<StandardMaterial> {
    materials.add(StandardMaterial {
        base_color: tint,
        base_color_texture: Some(load_repeating(asset_server, path)),
        perceptual_roughness: roughness,
        ..default()
    })
}

fn load_repeating(
    asset_server: &AssetServer,
    path: &'static str,
) -> Handle<Image> {
    asset_server
        .load_builder()
        .with_settings::<ImageLoaderSettings>(|settings| {
            // Explicit linear sampling removes the crunchy/nearest-looking
            // world texture result. Repeat is needed by the 16x16 grass base.
            settings.sampler = ImageSampler::linear();
            settings
                .sampler
                .get_or_init_descriptor()
                .set_address_mode(ImageAddressMode::Repeat);
        })
        .load(path)
}

pub fn describe() {
    info!(
        "ALDORIA WORLD VISUALS · repeating linear world textures · textured grass underlay · authored terrain/roads/water/bridges/walls/floors/roofs"
    );
}
