// TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use bevy::{image::ImageLoaderSettings, math::Affine2, prelude::*};
use game_types::Position;
use serde::Deserialize;

pub const ACTOR_MANIFEST_SCHEMA: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActorAnimation {
    Idle,
    Walk,
    Attack,
    Hit,
    Death,
    Cast,
    Use,
}

impl ActorAnimation {
    pub const ALL: [Self; 7] = [
        Self::Idle,
        Self::Walk,
        Self::Attack,
        Self::Hit,
        Self::Death,
        Self::Cast,
        Self::Use,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Walk => "walk",
            Self::Attack => "attack",
            Self::Hit => "hit",
            Self::Death => "death",
            Self::Cast => "cast",
            Self::Use => "use",
        }
    }

    fn from_key(value: &str) -> Option<Self> {
        match value {
            "idle" => Some(Self::Idle),
            "walk" => Some(Self::Walk),
            "attack" => Some(Self::Attack),
            "hit" => Some(Self::Hit),
            "death" => Some(Self::Death),
            "cast" => Some(Self::Cast),
            "use" => Some(Self::Use),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AnimationSpec {
    pub columns: usize,
    pub frames: usize,
    pub fps: f64,
    pub looping: bool,
    pub lock_until_complete: bool,
    pub terminal: bool,
}

impl AnimationSpec {
    pub fn duration_secs(self) -> f64 {
        if self.fps <= f64::EPSILON {
            0.0
        } else {
            self.frames.max(1) as f64 / self.fps
        }
    }

    pub fn frame_at(self, elapsed: f64) -> usize {
        let frames = self.frames.max(1);
        let raw = (elapsed.max(0.0) * self.fps.max(0.0)).floor() as usize;
        if self.looping {
            raw % frames
        } else {
            raw.min(frames - 1)
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActorAnimationDefinition {
    pub texture: String,
    #[serde(default)]
    pub normal: Option<String>,
    pub columns: usize,
    pub frames: usize,
    pub fps: f64,
    pub looping: bool,
    pub lock_until_complete: bool,
    pub terminal: bool,
}

impl ActorAnimationDefinition {
    pub fn spec(&self) -> AnimationSpec {
        AnimationSpec {
            columns: self.columns,
            frames: self.frames,
            fps: self.fps,
            looping: self.looping,
            lock_until_complete: self.lock_until_complete,
            terminal: self.terminal,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActorSpriteDefinition {
    pub schema: u32,
    pub id: String,
    pub authored_directions: usize,
    pub atlas_rows: usize,
    pub render_width: f32,
    pub render_height: f32,
    pub frame_width: u32,
    pub frame_height: u32,
    pub animations: HashMap<String, ActorAnimationDefinition>,
}

impl ActorSpriteDefinition {
    pub fn animation(&self, animation: ActorAnimation) -> Option<&ActorAnimationDefinition> {
        self.animations.get(animation.as_str())
    }

    pub fn spec(&self, animation: ActorAnimation) -> Option<AnimationSpec> {
        self.animation(animation).map(ActorAnimationDefinition::spec)
    }

    pub fn animation_locked(&self, animation: ActorAnimation, elapsed: f64) -> bool {
        self.spec(animation).is_some_and(|spec| {
            spec.terminal || (spec.lock_until_complete && elapsed < spec.duration_secs())
        })
    }

    fn validate(&self, manifest_path: &str) -> Result<()> {
        if self.schema != ACTOR_MANIFEST_SCHEMA {
            bail!(
                "{manifest_path}: unsupported actor manifest schema {} (expected {})",
                self.schema,
                ACTOR_MANIFEST_SCHEMA,
            );
        }
        if self.id.trim().is_empty() {
            bail!("{manifest_path}: id must not be empty");
        }
        if !matches!(self.authored_directions, 1 | 4 | 8) {
            bail!(
                "{manifest_path}: authored_directions must be 1, 4 or 8; got {}",
                self.authored_directions,
            );
        }
        let minimum_rows = match self.authored_directions {
            1 => 1,
            // Historical four-direction sheets use cardinal rows 0/2/4/6.
            4 => 8,
            8 => 8,
            _ => unreachable!(),
        };
        if self.atlas_rows < minimum_rows {
            bail!(
                "{manifest_path}: atlas_rows={} is too small for {} authored directions (need at least {minimum_rows})",
                self.atlas_rows,
                self.authored_directions,
            );
        }
        if self.render_width <= 0.0 || !self.render_width.is_finite() {
            bail!("{manifest_path}: render_width must be finite and > 0");
        }
        if self.render_height <= 0.0 || !self.render_height.is_finite() {
            bail!("{manifest_path}: render_height must be finite and > 0");
        }
        if self.frame_width == 0 || self.frame_height == 0 {
            bail!("{manifest_path}: frame_width/frame_height must be > 0");
        }
        if self.animation(ActorAnimation::Idle).is_none() {
            bail!("{manifest_path}: every actor must define animations.idle");
        }

        for (key, animation) in &self.animations {
            let Some(kind) = ActorAnimation::from_key(key) else {
                bail!("{manifest_path}: unsupported animation key '{key}'");
            };
            if animation.columns == 0 || animation.frames == 0 {
                bail!(
                    "{manifest_path}: animation '{}' columns/frames must be > 0",
                    kind.as_str(),
                );
            }
            if animation.frames > animation.columns {
                bail!(
                    "{manifest_path}: animation '{}' has frames={} > columns={}",
                    kind.as_str(),
                    animation.frames,
                    animation.columns,
                );
            }
            if animation.fps <= 0.0 || !animation.fps.is_finite() {
                bail!(
                    "{manifest_path}: animation '{}' fps must be finite and > 0",
                    kind.as_str(),
                );
            }
            if animation.looping && (animation.lock_until_complete || animation.terminal) {
                bail!(
                    "{manifest_path}: looping animation '{}' cannot be locked or terminal",
                    kind.as_str(),
                );
            }
            if animation.terminal && !animation.lock_until_complete {
                bail!(
                    "{manifest_path}: terminal animation '{}' must set lock_until_complete=true",
                    kind.as_str(),
                );
            }

            validate_asset_reference(&animation.texture, manifest_path)
                .with_context(|| format!("animation '{}': texture", kind.as_str()))?;
            validate_png_atlas_dimensions(
                &animation.texture,
                animation.columns,
                self.atlas_rows,
                self.frame_width,
                self.frame_height,
                manifest_path,
            )?;

            if let Some(normal) = animation.normal.as_deref() {
                validate_asset_reference(normal, manifest_path)
                    .with_context(|| format!("animation '{}': normal", kind.as_str()))?;
                validate_png_atlas_dimensions(
                    normal,
                    animation.columns,
                    self.atlas_rows,
                    self.frame_width,
                    self.frame_height,
                    manifest_path,
                )?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActorManifestIndexEntry {
    pub game_definition_id: String,
    pub manifest: String,
}

#[derive(Debug, Deserialize)]
struct ActorManifestIndex {
    schema: u32,
    actors: Vec<ActorManifestIndexEntry>,
}

pub fn load_actor_definition(manifest_path: &str) -> ActorSpriteDefinition {
    load_actor_definition_result(manifest_path).unwrap_or_else(|error| {
        panic!("ALDORIA ACTOR MANIFEST INVALID · {manifest_path} · {error:#}")
    })
}

fn load_actor_definition_result(manifest_path: &str) -> Result<ActorSpriteDefinition> {
    let absolute = resolve_asset_path(manifest_path)?;
    let source = fs::read_to_string(&absolute)
        .with_context(|| format!("failed to read {}", absolute.display()))?;
    let definition: ActorSpriteDefinition = serde_json::from_str(&source)
        .with_context(|| format!("failed to parse actor manifest {manifest_path}"))?;
    definition.validate(manifest_path)?;
    Ok(definition)
}

pub fn load_actor_index(index_path: &str) -> Vec<ActorManifestIndexEntry> {
    load_actor_index_result(index_path)
        .unwrap_or_else(|error| panic!("ALDORIA ACTOR INDEX INVALID · {index_path} · {error:#}"))
}

fn load_actor_index_result(index_path: &str) -> Result<Vec<ActorManifestIndexEntry>> {
    let absolute = resolve_asset_path(index_path)?;
    let source = fs::read_to_string(&absolute)
        .with_context(|| format!("failed to read {}", absolute.display()))?;
    let index: ActorManifestIndex = serde_json::from_str(&source)
        .with_context(|| format!("failed to parse actor index {index_path}"))?;

    if index.schema != ACTOR_MANIFEST_SCHEMA {
        bail!(
            "{index_path}: unsupported schema {} (expected {})",
            index.schema,
            ACTOR_MANIFEST_SCHEMA,
        );
    }

    let mut game_ids = HashSet::new();
    let mut manifests = HashSet::new();
    for entry in &index.actors {
        if entry.game_definition_id.trim().is_empty() {
            bail!("{index_path}: game_definition_id must not be empty");
        }
        if !game_ids.insert(entry.game_definition_id.clone()) {
            bail!(
                "{index_path}: duplicate game_definition_id '{}'",
                entry.game_definition_id,
            );
        }
        if !manifests.insert(entry.manifest.clone()) {
            bail!("{index_path}: duplicate manifest '{}'", entry.manifest);
        }
        validate_asset_reference(&entry.manifest, index_path)?;
        // Parse now so malformed manifests fail before the first world frame.
        let _ = load_actor_definition_result(&entry.manifest)?;
    }

    Ok(index.actors)
}

pub struct ActorSpriteAssets {
    pub definition: ActorSpriteDefinition,
    textures: HashMap<ActorAnimation, Handle<Image>>,
    normals: HashMap<ActorAnimation, Handle<Image>>,
}

impl ActorSpriteAssets {
    pub fn load(asset_server: &AssetServer, manifest_path: &str) -> Self {
        let definition = load_actor_definition(manifest_path);
        let mut textures = HashMap::new();
        let mut normals = HashMap::new();

        for animation in ActorAnimation::ALL {
            let Some(authored) = definition.animation(animation) else {
                continue;
            };
            textures.insert(animation, asset_server.load(authored.texture.clone()));
            if let Some(normal) = authored.normal.as_ref() {
                normals.insert(animation, load_linear_image(asset_server, normal.clone()));
            }
        }

        info!(
            "ALDORIA ACTOR MANIFEST · {} · {} dirs · {} animations · {}",
            definition.id,
            definition.authored_directions,
            definition.animations.len(),
            manifest_path,
        );

        Self {
            definition,
            textures,
            normals,
        }
    }

    pub fn texture(&self, animation: ActorAnimation) -> Option<&Handle<Image>> {
        self.textures.get(&animation)
    }

    pub fn normal(&self, animation: ActorAnimation) -> Option<&Handle<Image>> {
        self.normals.get(&animation)
    }

    pub fn is_loaded(&self, asset_server: &AssetServer) -> bool {
        self.textures
            .values()
            .chain(self.normals.values())
            .all(|handle| asset_server.is_loaded_with_dependencies(handle.id()))
    }
}

fn load_linear_image(asset_server: &AssetServer, path: String) -> Handle<Image> {
    asset_server
        .load_builder()
        .with_settings(|settings: &mut ImageLoaderSettings| {
            settings.is_srgb = false;
        })
        .load(path)
}

fn validate_asset_reference(asset_path: &str, owner_path: &str) -> Result<PathBuf> {
    let absolute = resolve_asset_path(asset_path)
        .with_context(|| format!("{owner_path}: invalid asset path '{asset_path}'"))?;
    if !absolute.is_file() {
        bail!(
            "{owner_path}: referenced asset '{}' does not exist at {}",
            asset_path,
            absolute.display(),
        );
    }
    Ok(absolute)
}

fn resolve_asset_path(relative: &str) -> Result<PathBuf> {
    if relative.trim().is_empty() {
        bail!("asset path is empty");
    }
    if relative.contains('\\') {
        bail!("asset paths must use forward slashes: '{relative}'");
    }

    let relative_path = Path::new(relative);
    if relative_path.is_absolute() {
        bail!("absolute asset paths are not allowed: '{relative}'");
    }
    for component in relative_path.components() {
        if !matches!(component, Component::Normal(_)) {
            bail!("asset path traversal is not allowed: '{relative}'");
        }
    }

    Ok(PathBuf::from(crate::native_asset_root()).join(relative_path))
}

fn validate_png_atlas_dimensions(
    asset_path: &str,
    columns: usize,
    rows: usize,
    frame_width: u32,
    frame_height: u32,
    manifest_path: &str,
) -> Result<()> {
    if !asset_path.to_ascii_lowercase().ends_with(".png") {
        // Structural and existence validation still applies to other formats.
        // PNG gets exact dimensions because all production actor sheets are PNG.
        return Ok(());
    }

    let absolute = resolve_asset_path(asset_path)?;
    let bytes = fs::read(&absolute)
        .with_context(|| format!("failed to read PNG atlas {}", absolute.display()))?;
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        bail!("{manifest_path}: '{}' is not a valid PNG atlas", asset_path);
    }

    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("PNG width slice"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("PNG height slice"));
    let expected_width = frame_width
        .checked_mul(columns as u32)
        .context("atlas width overflow")?;
    let expected_height = frame_height
        .checked_mul(rows as u32)
        .context("atlas height overflow")?;

    if width != expected_width || height != expected_height {
        bail!(
            "{manifest_path}: atlas '{}' is {}x{}, expected {}x{} ({} columns x {} rows of {}x{} frames)",
            asset_path,
            width,
            height,
            expected_width,
            expected_height,
            columns,
            rows,
            frame_width,
            frame_height,
        );
    }

    Ok(())
}

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
    pub fn from_delta(dx: i32, dy: i32, fallback: Self) -> Self {
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

    pub fn atlas_row(self, authored_directions: usize) -> usize {
        match authored_directions {
            0 | 1 => 0,
            8.. => self.index8(),
            _ => match self {
                Self::North => 0,
                Self::NorthEast | Self::East | Self::SouthEast => 2,
                Self::South => 4,
                Self::SouthWest | Self::West | Self::NorthWest => 6,
            },
        }
    }

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

pub fn face_direction(
    origin: Position,
    target: Position,
    fallback: SpriteDirection,
) -> SpriteDirection {
    if origin.z != target.z {
        return fallback;
    }

    SpriteDirection::from_delta(target.x - origin.x, target.y - origin.y, fallback)
}

pub fn atlas_uv(columns: usize, rows: usize, frame: usize, row: usize) -> Affine2 {
    let columns = columns.max(1) as f32;
    let rows = rows.max(1) as f32;

    Affine2::from_scale_angle_translation(
        Vec2::new(1.0 / columns, 1.0 / rows),
        0.0,
        Vec2::new(frame as f32 / columns, row as f32 / rows),
    )
}

pub fn billboard_rotation(sprite_position: Vec3, camera_position: Vec3) -> Option<Quat> {
    let to_camera = camera_position - sprite_position;
    if to_camera.x.abs() < 0.0001 && to_camera.z.abs() < 0.0001 {
        return None;
    }

    Some(Quat::from_rotation_y(to_camera.x.atan2(to_camera.z)))
}

pub fn describe() {
    info!(
        "ALDORIA ACTOR SPRITES · V36.83 JSON manifests · runtime validation · data-driven textures/timing/size · 8-dir ready"
    );
}
