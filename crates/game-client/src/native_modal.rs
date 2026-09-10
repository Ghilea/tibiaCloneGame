// TIBIAGAME_V36_46_0_NATIVE_MODAL_FRAMEWORK
use bevy::prelude::*;

use crate::native_ui_theme as theme;

#[derive(Component)]
pub(crate) struct NativeModalRoot;

#[derive(Component)]
pub(crate) struct NativeModalSurface;

pub(crate) fn root_node() -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(0),
        right: px(0),
        top: px(0),
        bottom: px(0),
        width: Val::Percent(100.0),
        height: Val::Percent(100.0),
        padding: UiRect {
            left: px(28),
            right: px(28),
            top: px(48),
            bottom: px(72),
        },
        align_items: AlignItems::Center,
        justify_content: JustifyContent::Center,
        ..default()
    }
}

pub(crate) fn panel_node(
    max_width: f32,
    min_height: f32,
) -> Node {
    Node {
        width: Val::Percent(100.0),
        max_width: px(max_width),
        min_height: px(min_height),
        padding: UiRect::all(px(24)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(10)),
        flex_direction: FlexDirection::Column,
        align_items: AlignItems::Stretch,
        row_gap: px(14),
        ..default()
    }
}

pub(crate) fn header_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(68),
        padding: UiRect {
            left: px(2),
            right: px(2),
            top: px(2),
            bottom: px(10),
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
        column_gap: px(20),
        ..default()
    }
}

pub(crate) fn header_copy_node() -> Node {
    Node {
        flex_direction: FlexDirection::Column,
        row_gap: px(4),
        ..default()
    }
}

pub(crate) fn body_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        flex_grow: 1.0,
        flex_direction: FlexDirection::Column,
        row_gap: px(10),
        ..default()
    }
}

pub(crate) fn two_column_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::FlexStart,
        justify_content: JustifyContent::SpaceBetween,
        column_gap: px(12),
        ..default()
    }
}

pub(crate) fn card_column_node() -> Node {
    Node {
        width: Val::Percent(49.0),
        flex_direction: FlexDirection::Column,
        row_gap: px(8),
        ..default()
    }
}

pub(crate) fn card_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(64),
        padding: UiRect {
            left: px(14),
            right: px(14),
            top: px(10),
            bottom: px(10),
        },
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(7)),
        align_items: AlignItems::Center,
        ..default()
    }
}

pub(crate) fn footer_node() -> Node {
    Node {
        width: Val::Percent(100.0),
        min_height: px(54),
        padding: UiRect {
            left: px(0),
            right: px(0),
            top: px(12),
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
        column_gap: px(12),
        ..default()
    }
}

pub(crate) fn footer_actions_node() -> Node {
    Node {
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        column_gap: px(8),
        ..default()
    }
}

pub(crate) fn action_button_node() -> Node {
    Node {
        min_width: px(138),
        height: px(42),
        padding: UiRect::horizontal(px(16)),
        border: UiRect::all(px(1)),
        border_radius: BorderRadius::all(px(6)),
        align_items: AlignItems::Center,
        justify_content: JustifyContent::Center,
        ..default()
    }
}

pub(crate) fn backdrop() -> BackgroundColor {
    BackgroundColor(
        Color::srgba(0.01, 0.015, 0.012, 0.34),
    )
}

pub(crate) fn surface() -> BackgroundColor {
    BackgroundColor(
        Color::srgba(0.025, 0.035, 0.03, 0.94),
    )
}

pub(crate) fn surface_border() -> BorderColor {
    BorderColor::all(theme::GOLD_DARK)
}

pub(crate) fn divider_border() -> BorderColor {
    BorderColor::all(
        Color::srgba(0.47, 0.39, 0.24, 0.52),
    )
}
