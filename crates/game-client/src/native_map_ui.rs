// TIBIAGAME_V36_26_1_NATIVE_MINIMAP_WORLD_MAP
use std::collections::{HashMap, HashSet};

use bevy::prelude::*;
use game_protocol::{MapView, WelcomePayload};
use game_types::Position;

use crate::{
    state::NativeGameState,
    MovementState,
};

const ATLAS_CHUNK: i32 = 4;
const MINIMAP_RADIUS: i32 = 13;
const MINIMAP_INTERVAL: f64 = 0.12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MapTone {
    Ground,
    Floor,
    Road,
    Bridge,
    Water,
    Tree,
    Wall,
}

#[derive(Default)]
struct MapLookup {
    blocked: HashSet<Position>,
    floors: HashSet<Position>,
    roads: HashSet<Position>,
    water: HashSet<Position>,
    bridges: HashSet<Position>,
    trees: HashSet<Position>,
    house_walls: HashSet<Position>,
    castle_walls: HashSet<Position>,
}

impl MapLookup {
    fn from_map(map: &MapView) -> Self {
        Self {
            blocked: map.blocked.iter().copied().collect(),
            floors: map.floors.iter().copied().collect(),
            roads: map.roads.iter().copied().collect(),
            water: map.water.iter().copied().collect(),
            bridges: map.bridges.iter().copied().collect(),
            trees: map.trees.iter().copied().collect(),
            house_walls: map.house_walls.iter().copied().collect(),
            castle_walls: map.castle_walls.iter().copied().collect(),
        }
    }

    fn tone(&self, position: Position) -> MapTone {
        if self.house_walls.contains(&position)
            || self.castle_walls.contains(&position)
            || self.blocked.contains(&position)
        {
            MapTone::Wall
        } else if self.trees.contains(&position) {
            MapTone::Tree
        } else if self.water.contains(&position) {
            MapTone::Water
        } else if self.bridges.contains(&position) {
            MapTone::Bridge
        } else if self.roads.contains(&position) {
            MapTone::Road
        } else if self.floors.contains(&position) {
            MapTone::Floor
        } else {
            MapTone::Ground
        }
    }
}

#[derive(Resource)]
pub(crate) struct NativeMapState {
    map: Box<MapView>,
    region_center: Position,
    region_radius: i32,
    region_floor_radius: i16,
    lookup: MapLookup,
    atlas: HashMap<(i16, i32, i32), MapTone>,
}

impl NativeMapState {
    pub(crate) fn from_welcome(welcome: &WelcomePayload) -> Self {
        let mut result = Self {
            map: welcome.map.clone(),
            region_center: welcome.region_center,
            region_radius: welcome.region_radius,
            region_floor_radius: welcome.region_floor_radius,
            lookup: MapLookup::from_map(welcome.map.as_ref()),
            atlas: HashMap::new(),
        };
        result.capture_region();
        result
    }

    pub(crate) fn replace_region(
        &mut self,
        map: Box<MapView>,
        region_center: Position,
        region_radius: i32,
        region_floor_radius: i16,
    ) {
        self.lookup = MapLookup::from_map(map.as_ref());
        self.map = map;
        self.region_center = region_center;
        self.region_radius = region_radius;
        self.region_floor_radius = region_floor_radius;
        self.capture_region();
    }

    fn capture_region(&mut self) {
        let min_x = (self.region_center.x - self.region_radius)
            .div_euclid(ATLAS_CHUNK);
        let max_x = (self.region_center.x + self.region_radius)
            .div_euclid(ATLAS_CHUNK);
        let min_y = (self.region_center.y - self.region_radius)
            .div_euclid(ATLAS_CHUNK);
        let max_y = (self.region_center.y + self.region_radius)
            .div_euclid(ATLAS_CHUNK);

        let min_z = self
            .region_center
            .z
            .saturating_sub(self.region_floor_radius);
        let max_z = self
            .region_center
            .z
            .saturating_add(self.region_floor_radius);

        for z in min_z..=max_z {
            for chunk_y in min_y..=max_y {
                for chunk_x in min_x..=max_x {
                    self.atlas
                        .entry((z, chunk_x, chunk_y))
                        .or_insert(MapTone::Ground);
                }
            }
        }

        for position in &self.map.floors {
            Self::capture_position(&mut self.atlas, *position, MapTone::Floor);
        }
        for position in &self.map.roads {
            Self::capture_position(&mut self.atlas, *position, MapTone::Road);
        }
        for position in &self.map.bridges {
            Self::capture_position(&mut self.atlas, *position, MapTone::Bridge);
        }
        for position in &self.map.water {
            Self::capture_position(&mut self.atlas, *position, MapTone::Water);
        }
        for position in &self.map.trees {
            Self::capture_position(&mut self.atlas, *position, MapTone::Tree);
        }
        for position in &self.map.blocked {
            Self::capture_position(&mut self.atlas, *position, MapTone::Wall);
        }
        for position in &self.map.house_walls {
            Self::capture_position(&mut self.atlas, *position, MapTone::Wall);
        }
        for position in &self.map.castle_walls {
            Self::capture_position(&mut self.atlas, *position, MapTone::Wall);
        }
    }

    fn capture_position(
        atlas: &mut HashMap<(i16, i32, i32), MapTone>,
        position: Position,
        tone: MapTone,
    ) {
        let key = (
            position.z,
            position.x.div_euclid(ATLAS_CHUNK),
            position.y.div_euclid(ATLAS_CHUNK),
        );

        let entry = atlas.entry(key).or_insert(MapTone::Ground);
        if tone > *entry {
            *entry = tone;
        }
    }
}

#[derive(Resource)]
pub(crate) struct NativeMapUiState {
    pub(crate) world_map_open: bool,
    center_x: i32,
    center_y: i32,
    floor: i16,
    zoom: i32,
    initialized: bool,
    next_minimap_at: f64,
}

impl Default for NativeMapUiState {
    fn default() -> Self {
        Self {
            world_map_open: false,
            center_x: 0,
            center_y: 0,
            floor: 7,
            zoom: 1,
            initialized: false,
            next_minimap_at: 0.0,
        }
    }
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeMapText {
    MinimapHeader,
    MinimapBody,
    MinimapFooter,
    WorldHeader,
    WorldBody,
    WorldFooter,
}

#[derive(Component)]
pub(crate) struct NativeWorldMapPanel;

pub fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native minimap"),
            Node {
                position_type: PositionType::Absolute,
                top: px(104),
                right: px(14),
                width: px(275),
                padding: UiRect::all(px(9)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgba(0.025, 0.035, 0.032, 0.88)),
        ))
        .with_children(|parent| {
            parent.spawn(map_text(
                "MINIMAP",
                NativeMapText::MinimapHeader,
                13.0,
                Color::srgb(0.92, 0.93, 0.88),
            ));
            parent.spawn(map_text(
                "",
                NativeMapText::MinimapBody,
                8.0,
                Color::srgb(0.76, 0.82, 0.77),
            ));
            parent.spawn(map_text(
                "",
                NativeMapText::MinimapFooter,
                11.0,
                Color::srgb(0.64, 0.69, 0.65),
            ));
        });

    commands
        .spawn((
            Name::new("Native world map"),
            NativeWorldMapPanel,
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(7.0),
                left: Val::Percent(50.0),
                width: px(850),
                min_height: px(610),
                max_height: Val::Percent(86.0),
                margin: UiRect::left(px(-425)),
                padding: UiRect::all(px(16)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgba(0.018, 0.026, 0.023, 0.97)),
        ))
        .with_children(|parent| {
            parent.spawn(map_text(
                "",
                NativeMapText::WorldHeader,
                18.0,
                Color::srgb(0.94, 0.91, 0.77),
            ));
            parent.spawn(map_text(
                "",
                NativeMapText::WorldBody,
                9.0,
                Color::srgb(0.78, 0.84, 0.78),
            ));
            parent.spawn(map_text(
                "",
                NativeMapText::WorldFooter,
                12.0,
                Color::srgb(0.64, 0.69, 0.65),
            ));
        });
}

fn map_text(
    value: impl Into<String>,
    kind: NativeMapText,
    size: f32,
    color: Color,
) -> impl Bundle {
    (
        kind,
        Text::new(value),
        TextFont {
            font_size: FontSize::Px(size),
            ..default()
        },
        TextColor(color),
    )
}

pub fn handle_input(
    keys: Res<ButtonInput<KeyCode>>,
    movement: Res<MovementState>,
    mut state: ResMut<NativeMapUiState>,
) {
    if !state.initialized {
        recenter(&movement, &mut state);
    }

    if keys.just_pressed(KeyCode::KeyM) {
        state.world_map_open = !state.world_map_open;
        if state.world_map_open {
            recenter(&movement, &mut state);
        }
        return;
    }

    if !state.world_map_open {
        return;
    }

    if keys.just_pressed(KeyCode::Escape) {
        state.world_map_open = false;
        return;
    }

    if keys.just_pressed(KeyCode::Home) {
        recenter(&movement, &mut state);
    }

    let pan_step = ATLAS_CHUNK * state.zoom.max(1);

    if keys.just_pressed(KeyCode::ArrowLeft) {
        state.center_x -= pan_step;
    }
    if keys.just_pressed(KeyCode::ArrowRight) {
        state.center_x += pan_step;
    }
    if keys.just_pressed(KeyCode::ArrowUp) {
        state.center_y -= pan_step;
    }
    if keys.just_pressed(KeyCode::ArrowDown) {
        state.center_y += pan_step;
    }

    if keys.just_pressed(KeyCode::Equal) {
        state.zoom = (state.zoom / 2).max(1);
    }
    if keys.just_pressed(KeyCode::Minus) {
        state.zoom = (state.zoom * 2).min(8);
    }

    if keys.just_pressed(KeyCode::BracketLeft) {
        state.floor = state.floor.saturating_sub(1);
    }
    if keys.just_pressed(KeyCode::BracketRight) {
        state.floor = state.floor.saturating_add(1);
    }
}

fn recenter(
    movement: &MovementState,
    state: &mut NativeMapUiState,
) {
    state.center_x = movement.logical.x;
    state.center_y = movement.logical.y;
    state.floor = movement.logical.z;
    state.initialized = true;
}

pub fn update_ui(
    time: Res<Time>,
    movement: Res<MovementState>,
    map_state: Res<NativeMapState>,
    game_state: Res<NativeGameState>,
    mut ui_state: ResMut<NativeMapUiState>,
    mut texts: Query<(&NativeMapText, &mut Text)>,
    mut world_panel: Query<
        &mut Visibility,
        With<NativeWorldMapPanel>,
    >,
) {
    if !ui_state.initialized {
        recenter(&movement, &mut ui_state);
    }

    if let Ok(mut visibility) = world_panel.single_mut() {
        *visibility = if ui_state.world_map_open {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    let now = time.elapsed_secs_f64();
    let refresh_minimap = now >= ui_state.next_minimap_at;
    if refresh_minimap {
        ui_state.next_minimap_at = now + MINIMAP_INTERVAL;
    }

    let minimap_body = if refresh_minimap {
        Some(render_minimap(
            &map_state,
            &game_state,
            movement.logical,
        ))
    } else {
        None
    };

    let world_body = if ui_state.world_map_open {
        Some(render_world_map(
            &map_state,
            &game_state,
            &ui_state,
            movement.logical,
        ))
    } else {
        None
    };

    for (kind, mut text) in &mut texts {
        match kind {
            NativeMapText::MinimapHeader => {
                text.0 = format!(
                    "MINIMAP   ·   {}:{}:{}",
                    movement.logical.x,
                    movement.logical.y,
                    movement.logical.z,
                );
            }
            NativeMapText::MinimapBody => {
                if let Some(body) = minimap_body.as_ref() {
                    text.0 = body.clone();
                }
            }
            NativeMapText::MinimapFooter => {
                text.0 = "M World map   ·   @ You   M Monster   N NPC   R Resource".into();
            }
            NativeMapText::WorldHeader => {
                text.0 = format!(
                    "WORLD MAP   ·   floor {}   ·   center {},{}   ·   zoom {}x",
                    ui_state.floor,
                    ui_state.center_x,
                    ui_state.center_y,
                    ui_state.zoom,
                );
            }
            NativeMapText::WorldBody => {
                if let Some(body) = world_body.as_ref() {
                    text.0 = body.clone();
                }
            }
            NativeMapText::WorldFooter => {
                text.0 =
                    "M/Esc close   Arrows pan   +/- zoom   [ ] floor   Home player   @ current player"
                        .into();
            }
        }
    }
}

fn render_minimap(
    map_state: &NativeMapState,
    game_state: &NativeGameState,
    center: Position,
) -> String {
    let mut lines = Vec::new();

    for y in (center.y - MINIMAP_RADIUS)..=(center.y + MINIMAP_RADIUS) {
        let mut line = String::with_capacity((MINIMAP_RADIUS * 2 + 1) as usize);

        for x in (center.x - MINIMAP_RADIUS)..=(center.x + MINIMAP_RADIUS) {
            let position = Position {
                x,
                y,
                z: center.z,
            };

            line.push(minimap_glyph(
                map_state,
                game_state,
                center,
                position,
            ));
        }

        lines.push(line);
    }

    lines.join("\n")
}

fn minimap_glyph(
    map_state: &NativeMapState,
    game_state: &NativeGameState,
    center: Position,
    position: Position,
) -> char {
    if position == center {
        return '@';
    }

    if game_state
        .creatures
        .values()
        .any(|creature| creature.position == position && creature.health > 0)
    {
        return 'M';
    }

    if game_state
        .npcs
        .values()
        .any(|npc| npc.position == position)
    {
        return 'N';
    }

    if game_state
        .resource_nodes
        .values()
        .any(|resource| resource.position == position && resource.available)
    {
        return 'R';
    }

    tone_glyph(map_state.lookup.tone(position))
}

fn render_world_map(
    map_state: &NativeMapState,
    game_state: &NativeGameState,
    ui: &NativeMapUiState,
    player: Position,
) -> String {
    const HALF_WIDTH: i32 = 40;
    const HALF_HEIGHT: i32 = 23;

    let center_chunk_x = ui.center_x.div_euclid(ATLAS_CHUNK);
    let center_chunk_y = ui.center_y.div_euclid(ATLAS_CHUNK);
    let sample = ui.zoom.max(1);

    let mut lines = Vec::new();

    for row in -HALF_HEIGHT..=HALF_HEIGHT {
        let mut line = String::with_capacity((HALF_WIDTH * 2 + 1) as usize);

        for column in -HALF_WIDTH..=HALF_WIDTH {
            let chunk_x = center_chunk_x + column * sample;
            let chunk_y = center_chunk_y + row * sample;

            let player_chunk_x = player.x.div_euclid(ATLAS_CHUNK);
            let player_chunk_y = player.y.div_euclid(ATLAS_CHUNK);

            if player.z == ui.floor
                && (player_chunk_x - chunk_x).abs() < sample
                && (player_chunk_y - chunk_y).abs() < sample
            {
                line.push('@');
                continue;
            }

            let dynamic = world_dynamic_glyph(
                game_state,
                ui.floor,
                chunk_x,
                chunk_y,
                sample,
            );

            if let Some(glyph) = dynamic {
                line.push(glyph);
                continue;
            }

            line.push(atlas_glyph(
                map_state,
                ui.floor,
                chunk_x,
                chunk_y,
                sample,
            ));
        }

        lines.push(line);
    }

    lines.join("\n")
}

fn world_dynamic_glyph(
    game_state: &NativeGameState,
    floor: i16,
    chunk_x: i32,
    chunk_y: i32,
    sample: i32,
) -> Option<char> {
    let in_sample = |position: Position| {
        position.z == floor
            && position.x.div_euclid(ATLAS_CHUNK) >= chunk_x
            && position.x.div_euclid(ATLAS_CHUNK) < chunk_x + sample
            && position.y.div_euclid(ATLAS_CHUNK) >= chunk_y
            && position.y.div_euclid(ATLAS_CHUNK) < chunk_y + sample
    };

    if game_state
        .npcs
        .values()
        .any(|npc| in_sample(npc.position))
    {
        return Some('N');
    }

    if game_state
        .resource_nodes
        .values()
        .any(|resource| resource.available && in_sample(resource.position))
    {
        return Some('R');
    }

    None
}

fn atlas_glyph(
    map_state: &NativeMapState,
    floor: i16,
    chunk_x: i32,
    chunk_y: i32,
    sample: i32,
) -> char {
    let mut tone = None;

    for dy in 0..sample {
        for dx in 0..sample {
            let Some(candidate) =
                map_state.atlas.get(&(floor, chunk_x + dx, chunk_y + dy))
            else {
                continue;
            };

            tone = Some(tone.map_or(*candidate, |current: MapTone| {
                current.max(*candidate)
            }));
        }
    }

    tone.map(tone_glyph).unwrap_or(' ')
}

fn tone_glyph(tone: MapTone) -> char {
    match tone {
        MapTone::Ground => '.',
        MapTone::Floor => ':',
        MapTone::Road => '=',
        MapTone::Bridge => '+',
        MapTone::Water => '~',
        MapTone::Tree => 'T',
        MapTone::Wall => '#',
    }
}
