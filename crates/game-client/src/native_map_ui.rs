// TIBIAGAME_V36_26_1_NATIVE_MINIMAP_WORLD_MAP
use std::collections::{HashMap, HashSet};

use bevy::prelude::*;
use game_protocol::{MapView, WelcomePayload};
use game_types::Position;

use crate::{
    native_modal,
    native_ui_theme as theme,
    state::NativeGameState,
    MovementState,
};

const ATLAS_CHUNK: i32 = 4;
const MINIMAP_RADIUS: i32 = 13;
const MINIMAP_INTERVAL: f64 = 0.12;
const WORLD_MAP_HALF_WIDTH: i32 = 24;
const WORLD_MAP_HALF_HEIGHT: i32 = 14;
const WORLD_MAP_INTERVAL: f64 = 0.08;
const TEXT: Color = theme::TEXT;
const MUTED: Color = theme::MUTED;

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
    show_buildings: bool,
    show_npcs: bool,
    show_resources: bool,
    next_minimap_at: f64,
    next_world_map_at: f64,
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
            show_buildings: true,
            show_npcs: true,
            show_resources: true,
            next_minimap_at: 0.0,
            next_world_map_at: 0.0,
        }
    }
}

#[derive(Component, Clone, Copy)]
#[allow(dead_code)]
pub(crate) enum NativeMapText {
    MinimapHeader,
    #[allow(dead_code)]
    MinimapBody,
    MinimapFooter,
    WorldHeader,
    WorldBody,
    WorldFooter,
    WorldFloor,
    WorldScale,
    WorldBuildingsFilter,
    WorldNpcsFilter,
    WorldResourcesFilter,
}

#[derive(Component)]
pub(crate) struct NativeWorldMapPanel;

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeWorldMapCell {
    column: i32,
    row: i32,
}

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeWorldMapAction {
    Zone,
    World,
    Player,
    Close,
    FloorUp,
    FloorDown,
    ZoomIn,
    ZoomOut,
    ToggleBuildings,
    ToggleNpcs,
    ToggleResources,
}

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeWorldMapButton(
    pub(crate) NativeWorldMapAction,
);

#[derive(Component, Clone, Copy)]
pub(crate) struct NativeMinimapCell {
    dx: i32,
    dy: i32,
}

pub fn setup(mut commands: Commands) {
    commands
        .spawn((
            Name::new("Native minimap"),
            Node {
                position_type: PositionType::Absolute,
                top: px(18),
                right: px(18),
                width: px(250),
                height: px(270),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                row_gap: px(5),
                ..default()
            },
            BackgroundColor(Color::NONE),
            GlobalZIndex(172),
        ))
        .with_children(|parent| {
            parent
                .spawn((
                    Node {
                        width: px(220),
                        height: px(220),
                        padding: UiRect::all(px(8)),
                        border: UiRect::all(px(3)),
                        border_radius: BorderRadius::all(px(110)),
                        overflow: Overflow::clip(),
                        align_items: AlignItems::Center,
                        justify_content: JustifyContent::Center,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.015, 0.019, 0.016, 0.98)),
                    BorderColor::all(theme::GOLD),
                    Outline::new(px(2), px(1), Color::srgb(0.22, 0.13, 0.03)),
                ))
                .with_children(|ring| {
                    spawn_native_minimap_grid(ring);
                });

            parent
                .spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        top: px(-7),
                        left: px(108),
                        width: px(34),
                        height: px(34),
                        border: UiRect::all(px(2)),
                        border_radius: BorderRadius::all(px(17)),
                        align_items: AlignItems::Center,
                        justify_content: JustifyContent::Center,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.025, 0.022, 0.014, 0.98)),
                    BorderColor::all(theme::GOLD),
                ))
                .with_child((
                    Text::new("N"),
                    TextFont {
                        font_size: FontSize::Px(12.0),
                        ..default()
                    },
                    TextColor(theme::GOLD_BRIGHT),
                ));

            parent.spawn(map_text(
                "",
                NativeMapText::MinimapHeader,
                9.0,
                theme::GOLD_BRIGHT,
            ));
            parent.spawn(map_text(
                "M  WORLD MAP",
                NativeMapText::MinimapFooter,
                7.5,
                MUTED,
            ));
        });

    commands
        .spawn((
            Name::new("Native world map · Greyhaven reference"),
            NativeWorldMapPanel,
            native_modal::NativeModalRoot,
            GlobalZIndex(188),
            Visibility::Hidden,
            native_modal::root_node(),
            native_modal::backdrop(),
        ))
        .with_children(|root| {
            root
                .spawn((
                    Name::new("Greyhaven World Map interface"),
                    native_modal::NativeModalSurface,
                    native_modal::NativeDraggableSurface(
                        native_modal::NativeModalWindow::WorldMap,
                    ),
                    world_map_surface_node(),
                    native_modal::surface(),
                    native_modal::surface_border(),
                ))
                .with_children(|panel| {
                    panel
                        .spawn((
                            world_map_header_node(),
                            native_modal::divider_border(),
                        ))
                        .with_children(|header| {
                            header
                                .spawn((
                                    Button,
                                    native_modal::NativeDragHandle(
                                        native_modal::NativeModalWindow::WorldMap,
                                    ),
                                    Node {
                                        flex_grow: 1.0,
                                        flex_direction: FlexDirection::Column,
                                        align_items: AlignItems::FlexStart,
                                        justify_content: JustifyContent::Center,
                                        row_gap: px(2),
                                        ..default()
                                    },
                                ))
                                .with_children(|copy| {
                                    copy.spawn((
                                        Text::new("WORLD MAP"),
                                        TextFont {
                                            font_size: FontSize::Px(8.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD),
                                    ));

                                    copy.spawn((
                                        Text::new("THE FIRST MARCHES"),
                                        TextFont {
                                            font_size: FontSize::Px(17.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD_BRIGHT),
                                    ));
                                });

                            header
                                .spawn(Node {
                                    flex_direction: FlexDirection::Row,
                                    align_items: AlignItems::Center,
                                    column_gap: px(5),
                                    ..default()
                                })
                                .with_children(|actions| {
                                    spawn_world_map_button(
                                        actions,
                                        NativeWorldMapAction::Zone,
                                        "ZONE",
                                        56.0,
                                    );
                                    spawn_world_map_button(
                                        actions,
                                        NativeWorldMapAction::World,
                                        "WORLD",
                                        60.0,
                                    );
                                    spawn_world_map_button(
                                        actions,
                                        NativeWorldMapAction::Player,
                                        "PLAYER",
                                        64.0,
                                    );
                                    spawn_world_map_button(
                                        actions,
                                        NativeWorldMapAction::Close,
                                        "X",
                                        38.0,
                                    );
                                });
                        });

                    panel
                        .spawn(Node {
                            width: Val::Percent(100.0),
                            flex_grow: 1.0,
                            flex_direction: FlexDirection::Row,
                            column_gap: px(8),
                            ..default()
                        })
                        .with_children(|body| {
                            body
                                .spawn((
                                    Node {
                                        width: px(128),
                                        height: Val::Percent(100.0),
                                        min_height: px(470),
                                        padding: UiRect::all(px(10)),
                                        border: UiRect::all(px(1)),
                                        flex_direction: FlexDirection::Column,
                                        row_gap: px(10),
                                        ..default()
                                    },
                                    BackgroundColor(
                                        Color::srgba(
                                            0.012,
                                            0.027,
                                            0.020,
                                            0.98,
                                        ),
                                    ),
                                    BorderColor::all(theme::BUTTON_BORDER),
                                ))
                                .with_children(|sidebar| {
                                    sidebar.spawn((
                                        Text::new("FLOOR"),
                                        TextFont {
                                            font_size: FontSize::Px(8.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD),
                                    ));

                                    sidebar
                                        .spawn(Node {
                                            width: Val::Percent(100.0),
                                            flex_direction: FlexDirection::Row,
                                            align_items: AlignItems::Center,
                                            justify_content: JustifyContent::SpaceBetween,
                                            ..default()
                                        })
                                        .with_children(|floor| {
                                            spawn_world_map_button(
                                                floor,
                                                NativeWorldMapAction::FloorUp,
                                                "▲",
                                                34.0,
                                            );

                                            floor.spawn(map_text(
                                                "z7",
                                                NativeMapText::WorldFloor,
                                                9.5,
                                                theme::GOLD_BRIGHT,
                                            ));

                                            spawn_world_map_button(
                                                floor,
                                                NativeWorldMapAction::FloorDown,
                                                "▼",
                                                34.0,
                                            );
                                        });

                                    sidebar.spawn((
                                        Text::new("MAP FILTERS"),
                                        TextFont {
                                            font_size: FontSize::Px(8.0),
                                            ..default()
                                        },
                                        TextColor(theme::GOLD),
                                    ));

                                    spawn_world_map_filter(
                                        sidebar,
                                        NativeWorldMapAction::ToggleBuildings,
                                        NativeMapText::WorldBuildingsFilter,
                                    );

                                    spawn_world_map_filter(
                                        sidebar,
                                        NativeWorldMapAction::ToggleNpcs,
                                        NativeMapText::WorldNpcsFilter,
                                    );

                                    spawn_world_map_filter(
                                        sidebar,
                                        NativeWorldMapAction::ToggleResources,
                                        NativeMapText::WorldResourcesFilter,
                                    );

                                    sidebar.spawn((
                                        Node {
                                            width: Val::Percent(100.0),
                                            height: px(1),
                                            margin: UiRect::vertical(px(4)),
                                            ..default()
                                        },
                                        BackgroundColor(theme::GOLD_DARK),
                                    ));

                                    sidebar.spawn((
                                        Text::new(
                                            "Gold  Player\nGreen NPC\nCyan  Resource",
                                        ),
                                        TextFont {
                                            font_size: FontSize::Px(7.5),
                                            ..default()
                                        },
                                        TextColor(MUTED),
                                    ));
                                });

                            body
                                .spawn((
                                    Node {
                                        flex_grow: 1.0,
                                        height: Val::Percent(100.0),
                                        min_height: px(470),
                                        border: UiRect::all(px(1)),
                                        flex_direction: FlexDirection::Column,
                                        ..default()
                                    },
                                    BackgroundColor(
                                        Color::srgb(
                                            0.008,
                                            0.018,
                                            0.013,
                                        ),
                                    ),
                                    BorderColor::all(theme::GOLD_DARK),
                                ))
                                .with_children(|viewport| {
                                    viewport
                                        .spawn(Node {
                                            width: Val::Percent(100.0),
                                            height: px(36),
                                            padding: UiRect::horizontal(px(8)),
                                            flex_direction: FlexDirection::Row,
                                            align_items: AlignItems::Center,
                                            justify_content: JustifyContent::SpaceBetween,
                                            ..default()
                                        })
                                        .with_children(|toolbar| {
                                            toolbar.spawn(map_text(
                                                "",
                                                NativeMapText::WorldHeader,
                                                8.0,
                                                MUTED,
                                            ));

                                            toolbar
                                                .spawn(Node {
                                                    flex_direction: FlexDirection::Row,
                                                    column_gap: px(4),
                                                    ..default()
                                                })
                                                .with_children(|zoom| {
                                                    spawn_world_map_button(
                                                        zoom,
                                                        NativeWorldMapAction::ZoomIn,
                                                        "+",
                                                        34.0,
                                                    );
                                                    spawn_world_map_button(
                                                        zoom,
                                                        NativeWorldMapAction::ZoomOut,
                                                        "−",
                                                        34.0,
                                                    );
                                                });
                                        });

                                    spawn_native_world_map_grid(viewport);
                                });
                        });

                    panel
                        .spawn((
                            world_map_footer_node(),
                            native_modal::divider_border(),
                        ))
                        .with_children(|footer| {
                            footer.spawn(map_text(
                                "Drag title · Arrows pan · M/Esc close",
                                NativeMapText::WorldFooter,
                                8.0,
                                MUTED,
                            ));

                            footer.spawn(map_text(
                                "",
                                NativeMapText::WorldScale,
                                8.0,
                                theme::GOLD,
                            ));
                        });
                });
        });
}

fn world_map_surface_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        max_width: px(1280),
        height: Val::Percent(100.0),
        min_height: px(560),
        padding: UiRect::all(px(10)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(8)),
        flex_direction: FlexDirection::Column,
        row_gap: px(8),
        ..default()
    }
}

fn world_map_header_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(52),
        padding: UiRect {
            left: px(2),
            right: px(2),
            top: px(0),
            bottom: px(7),
        },
        border: UiRect {
            left: px(0),
            right: px(0),
            top: px(0),
            bottom: px(1),
        },
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        justify_content: JustifyContent::SpaceBetween,
        column_gap: px(12),
        ..default()
    }
}

fn world_map_footer_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(30),
        padding: UiRect {
            left: px(3),
            right: px(3),
            top: px(7),
            bottom: px(0),
        },
        border: UiRect {
            left: px(0),
            right: px(0),
            top: px(1),
            bottom: px(0),
        },
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        justify_content: JustifyContent::SpaceBetween,
        ..default()
    }
}

fn spawn_world_map_button(
    parent: &mut ChildSpawnerCommands,
    action: NativeWorldMapAction,
    label: &str,
    width: f32,
) {
    parent
        .spawn((
            Button,
            NativeWorldMapButton(action),
            Node {
                width: px(width),
                height: px(30),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(5)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(theme::BUTTON_BG),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_child((
            Text::new(label),
            TextFont {
                font_size: FontSize::Px(7.5),
                ..default()
            },
            TextColor(TEXT),
        ));
}

fn spawn_world_map_filter(
    parent: &mut ChildSpawnerCommands,
    action: NativeWorldMapAction,
    text_kind: NativeMapText,
) {
    parent
        .spawn((
            Button,
            NativeWorldMapButton(action),
            Node {
                width: Val::Percent(100.0),
                height: px(28),
                padding: UiRect::horizontal(px(5)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(4)),
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(theme::BUTTON_BG),
            BorderColor::all(theme::BUTTON_BORDER),
        ))
        .with_child(map_text(
            "",
            text_kind,
            7.5,
            TEXT,
        ));
}

fn spawn_native_world_map_grid(
    parent: &mut ChildSpawnerCommands,
) {
    parent
        .spawn((
            Name::new("Native graphical world map grid"),
            Node {
                width: Val::Percent(100.0),
                flex_grow: 1.0,
                padding: UiRect::all(px(2)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(
                Color::srgb(
                    0.006,
                    0.014,
                    0.010,
                ),
            ),
        ))
        .with_children(|grid| {
            for row in
                -WORLD_MAP_HALF_HEIGHT
                    ..=WORLD_MAP_HALF_HEIGHT
            {
                grid
                    .spawn(Node {
                        width: Val::Percent(100.0),
                        flex_grow: 1.0,
                        flex_direction: FlexDirection::Row,
                        ..default()
                    })
                    .with_children(|line| {
                        for column in
                            -WORLD_MAP_HALF_WIDTH
                                ..=WORLD_MAP_HALF_WIDTH
                        {
                            line.spawn((
                                NativeWorldMapCell {
                                    column,
                                    row,
                                },
                                Node {
                                    flex_grow: 1.0,
                                    height: Val::Percent(100.0),
                                    ..default()
                                },
                                BackgroundColor(
                                    Color::srgb(
                                        0.01,
                                        0.02,
                                        0.015,
                                    ),
                                ),
                            ));
                        }
                    });
            }
        });
}

fn spawn_native_minimap_grid(
    parent: &mut ChildSpawnerCommands,
) {
    parent
        .spawn((
            Name::new("Native minimap grid"),
            Node {
                width: px(198),
                height: px(198),
                border_radius: BorderRadius::all(px(99)),
                overflow: Overflow::clip(),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgb(0.020, 0.027, 0.023)),
        ))
        .with_children(|grid| {
            for dy in -MINIMAP_RADIUS..=MINIMAP_RADIUS {
                grid
                    .spawn(Node {
                        width: Val::Percent(100.0),
                        flex_grow: 1.0,
                        flex_direction: FlexDirection::Row,
                        ..default()
                    })
                    .with_children(|row| {
                        for dx in -MINIMAP_RADIUS..=MINIMAP_RADIUS {
                            row.spawn((
                                NativeMinimapCell { dx, dy },
                                Node {
                                    flex_grow: 1.0,
                                    height: Val::Percent(100.0),
                                    ..default()
                                },
                                BackgroundColor(Color::srgb(
                                    0.055,
                                    0.075,
                                    0.063,
                                )),
                            ));
                        }
                    });
            }
        });
}


fn minimap_tone_color(tone: MapTone) -> Color {
    match tone {
        MapTone::Ground => Color::srgb(0.16, 0.20, 0.14),
        MapTone::Floor => Color::srgb(0.38, 0.32, 0.23),
        MapTone::Road => Color::srgb(0.46, 0.43, 0.36),
        MapTone::Bridge => Color::srgb(0.49, 0.34, 0.20),
        MapTone::Water => Color::srgb(0.12, 0.30, 0.48),
        MapTone::Tree => Color::srgb(0.12, 0.33, 0.16),
        MapTone::Wall => Color::srgb(0.48, 0.43, 0.35),
    }
}

fn minimap_cell_color(
    map_state: &NativeMapState,
    game_state: &NativeGameState,
    center: Position,
    position: Position,
) -> Color {
    if position == center {
        return Color::srgb(0.95, 0.79, 0.25);
    }

    if game_state
        .creatures
        .values()
        .any(|creature| {
            creature.position == position
                && creature.health > 0
        })
    {
        return Color::srgb(0.88, 0.18, 0.14);
    }

    if game_state
        .npcs
        .values()
        .any(|npc| npc.position == position)
    {
        return Color::srgb(0.20, 0.78, 0.40);
    }

    if game_state
        .resource_nodes
        .values()
        .any(|resource| {
            resource.position == position
                && resource.available
        })
    {
        return Color::srgb(0.22, 0.72, 0.78);
    }

    minimap_tone_color(
        map_state.lookup.tone(position),
    )
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

pub fn handle_buttons(
    movement: Res<MovementState>,
    mut state: ResMut<NativeMapUiState>,
    mut buttons: Query<
        (
            &Interaction,
            &NativeWorldMapButton,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (
            Changed<Interaction>,
            With<Button>,
        ),
    >,
) {
    if !state.world_map_open {
        return;
    }

    for (
        interaction,
        button,
        mut background,
        mut border,
    ) in &mut buttons
    {
        match *interaction {
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                match button.0 {
                    NativeWorldMapAction::Zone => {
                        recenter(&movement, &mut state);
                        state.zoom = 1;
                    }
                    NativeWorldMapAction::World => {
                        recenter(&movement, &mut state);
                        state.zoom = 4;
                    }
                    NativeWorldMapAction::Player => {
                        recenter(&movement, &mut state);
                    }
                    NativeWorldMapAction::Close => {
                        state.world_map_open = false;
                    }
                    NativeWorldMapAction::FloorUp => {
                        state.floor =
                            state.floor.saturating_sub(1);
                    }
                    NativeWorldMapAction::FloorDown => {
                        state.floor =
                            state.floor.saturating_add(1);
                    }
                    NativeWorldMapAction::ZoomIn => {
                        state.zoom =
                            (state.zoom / 2).max(1);
                    }
                    NativeWorldMapAction::ZoomOut => {
                        state.zoom =
                            (state.zoom * 2).min(8);
                    }
                    NativeWorldMapAction::ToggleBuildings => {
                        state.show_buildings =
                            !state.show_buildings;
                    }
                    NativeWorldMapAction::ToggleNpcs => {
                        state.show_npcs =
                            !state.show_npcs;
                    }
                    NativeWorldMapAction::ToggleResources => {
                        state.show_resources =
                            !state.show_resources;
                    }
                }

                // Make the next graphical refresh immediate.
                state.next_world_map_at = 0.0;
            }
        }
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
    mut cell_queries: ParamSet<(
        Query<
            (
                &NativeMinimapCell,
                &mut BackgroundColor,
            ),
        >,
        Query<
            (
                &NativeWorldMapCell,
                &mut BackgroundColor,
            ),
        >,
    )>,
    mut world_panel: Query<
        &mut Visibility,
        With<NativeWorldMapPanel>,
    >,
) {
    if !ui_state.initialized {
        recenter(&movement, &mut ui_state);
    }

    if let Ok(mut visibility) =
        world_panel.single_mut()
    {
        *visibility =
            if ui_state.world_map_open {
                Visibility::Visible
            } else {
                Visibility::Hidden
            };
    }

    let now = time.elapsed_secs_f64();

    let refresh_minimap =
        now >= ui_state.next_minimap_at;

    if refresh_minimap {
        ui_state.next_minimap_at =
            now + MINIMAP_INTERVAL;

        let center = movement.logical;

        for (
            cell,
            mut background,
        ) in &mut cell_queries.p0()
        {
            if cell.dx * cell.dx + cell.dy * cell.dy
                > MINIMAP_RADIUS * MINIMAP_RADIUS
            {
                background.0 = Color::NONE;
                continue;
            }

            let position = Position {
                x: center.x + cell.dx,
                y: center.y + cell.dy,
                z: center.z,
            };

            background.0 =
                minimap_cell_color(
                    &map_state,
                    &game_state,
                    center,
                    position,
                );
        }
    }

    let refresh_world =
        ui_state.world_map_open
            && now >= ui_state.next_world_map_at;

    if refresh_world {
        ui_state.next_world_map_at =
            now + WORLD_MAP_INTERVAL;

        for (
            cell,
            mut background,
        ) in &mut cell_queries.p1()
        {
            background.0 =
                world_map_cell_color(
                    &map_state,
                    &game_state,
                    &ui_state,
                    movement.logical,
                    *cell,
                );
        }
    }

    for (kind, mut text) in &mut texts {
        match kind {
            NativeMapText::MinimapHeader => {
                text.0 = format!(
                    "{}:{}:{}",
                    movement.logical.x,
                    movement.logical.y,
                    movement.logical.z,
                );
            }
            NativeMapText::MinimapBody => {}
            NativeMapText::MinimapFooter => {
                text.0 = "M  WORLD MAP".into();
            }
            NativeMapText::WorldHeader => {
                text.0 = format!(
                    "CENTER {},{}  ·  floor z{}",
                    ui_state.center_x,
                    ui_state.center_y,
                    ui_state.floor,
                );
            }
            NativeMapText::WorldBody => {}
            NativeMapText::WorldFooter => {
                text.0 =
                    "Drag title  ·  Arrows pan  ·  M/Esc close"
                        .into();
            }
            NativeMapText::WorldFloor => {
                text.0 =
                    format!("z{}", ui_state.floor);
            }
            NativeMapText::WorldScale => {
                text.0 = format!(
                    "{}, {}, z{}   ·   {}x sample",
                    ui_state.center_x,
                    ui_state.center_y,
                    ui_state.floor,
                    ui_state.zoom,
                );
            }
            NativeMapText::WorldBuildingsFilter => {
                text.0 = format!(
                    "{} Buildings",
                    if ui_state.show_buildings {
                        "[x]"
                    } else {
                        "[ ]"
                    },
                );
            }
            NativeMapText::WorldNpcsFilter => {
                text.0 = format!(
                    "{} NPCs",
                    if ui_state.show_npcs {
                        "[x]"
                    } else {
                        "[ ]"
                    },
                );
            }
            NativeMapText::WorldResourcesFilter => {
                text.0 = format!(
                    "{} Resources",
                    if ui_state.show_resources {
                        "[x]"
                    } else {
                        "[ ]"
                    },
                );
            }
        }
    }
}

fn world_map_cell_color(
    map_state: &NativeMapState,
    game_state: &NativeGameState,
    ui: &NativeMapUiState,
    player: Position,
    cell: NativeWorldMapCell,
) -> Color {
    let sample = ui.zoom.max(1);
    let center_chunk_x =
        ui.center_x.div_euclid(ATLAS_CHUNK);
    let center_chunk_y =
        ui.center_y.div_euclid(ATLAS_CHUNK);

    let chunk_x =
        center_chunk_x + cell.column * sample;
    let chunk_y =
        center_chunk_y + cell.row * sample;

    let contains = |position: Position| {
        position.z == ui.floor
            && position.x.div_euclid(ATLAS_CHUNK)
                >= chunk_x
            && position.x.div_euclid(ATLAS_CHUNK)
                < chunk_x + sample
            && position.y.div_euclid(ATLAS_CHUNK)
                >= chunk_y
            && position.y.div_euclid(ATLAS_CHUNK)
                < chunk_y + sample
    };

    if contains(player) {
        return Color::srgb(
            0.95,
            0.79,
            0.25,
        );
    }

    if ui.show_npcs
        && game_state
            .npcs
            .values()
            .any(|npc| contains(npc.position))
    {
        return Color::srgb(
            0.36,
            0.72,
            0.49,
        );
    }

    if ui.show_resources
        && game_state
            .resource_nodes
            .values()
            .any(|resource| {
                resource.available
                    && contains(resource.position)
            })
    {
        return Color::srgb(
            0.20,
            0.68,
            0.74,
        );
    }

    let Some(mut tone) =
        atlas_tone(
            map_state,
            ui.floor,
            chunk_x,
            chunk_y,
            sample,
        )
    else {
        return Color::srgb(
            0.006,
            0.014,
            0.010,
        );
    };

    if !ui.show_buildings
        && tone == MapTone::Wall
    {
        tone = MapTone::Ground;
    }

    minimap_tone_color(tone)
}

fn atlas_tone(
    map_state: &NativeMapState,
    floor: i16,
    chunk_x: i32,
    chunk_y: i32,
    sample: i32,
) -> Option<MapTone> {
    let mut tone = None;

    for dy in 0..sample {
        for dx in 0..sample {
            let Some(candidate) =
                map_state
                    .atlas
                    .get(&(
                        floor,
                        chunk_x + dx,
                        chunk_y + dy,
                    ))
            else {
                continue;
            };

            tone = Some(
                tone.map_or(
                    *candidate,
                    |current: MapTone| {
                        current.max(*candidate)
                    },
                ),
            );
        }
    }

    tone
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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
