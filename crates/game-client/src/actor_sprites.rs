// TIBIAGAME_V36_80_UNIFIED_ACTOR_SPRITE_SYSTEM
use bevy::{math::Affine2, prelude::*};
use game_types::Position;

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
    pub const fn looping(columns: usize, frames: usize, fps: f64) -> Self {
        Self {
            columns,
            frames,
            fps,
            looping: true,
            lock_until_complete: false,
            terminal: false,
        }
    }

    pub const fn once(columns: usize, frames: usize, fps: f64) -> Self {
        Self {
            columns,
            frames,
            fps,
            looping: false,
            lock_until_complete: true,
            terminal: false,
        }
    }

    pub const fn terminal(columns: usize, frames: usize, fps: f64) -> Self {
        Self {
            columns,
            frames,
            fps,
            looping: false,
            lock_until_complete: true,
            terminal: true,
        }
    }

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

#[derive(Debug, Clone, Copy)]
pub struct ActorSpriteDefinition {
    pub id: &'static str,
    pub authored_directions: usize,
    pub atlas_rows: usize,
    pub render_width: f32,
    pub render_height: f32,
    pub idle: AnimationSpec,
    pub walk: Option<AnimationSpec>,
    pub attack: Option<AnimationSpec>,
    pub hit: Option<AnimationSpec>,
    pub death: Option<AnimationSpec>,
    pub cast: Option<AnimationSpec>,
    pub use_action: Option<AnimationSpec>,
}

impl ActorSpriteDefinition {
    pub const fn spec(self, animation: ActorAnimation) -> Option<AnimationSpec> {
        match animation {
            ActorAnimation::Idle => Some(self.idle),
            ActorAnimation::Walk => self.walk,
            ActorAnimation::Attack => self.attack,
            ActorAnimation::Hit => self.hit,
            ActorAnimation::Death => self.death,
            ActorAnimation::Cast => self.cast,
            ActorAnimation::Use => self.use_action,
        }
    }

    pub fn animation_locked(self, animation: ActorAnimation, elapsed: f64) -> bool {
        self.spec(animation).is_some_and(|spec| {
            spec.terminal || (spec.lock_until_complete && elapsed < spec.duration_secs())
        })
    }
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

pub fn face_direction(origin: Position, target: Position, fallback: SpriteDirection) -> SpriteDirection {
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
        "ALDORIA ACTOR SPRITES · unified definition/runtime contract · 8-dir ready · idle/walk/attack/hit/death/cast/use"
    );
}
