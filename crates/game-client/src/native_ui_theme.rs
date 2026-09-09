// TIBIAGAME_V36_37_NATIVE_ALDORIA_UI_THEME
//
// Native Bevy translation of the current React client's visual language.
// Source-of-truth palette comes from apps/client/src/styles.css:
//   root       #080c0a
//   panel      #111a16 / #090e0c
//   gold       #d2ad68
//   panel edge #706443 / #927647
//   text       #f4ead1
//   muted      #84918a
//
// Bevy does not parse CSS. These tokens let native widgets use the same
// design language without reintroducing WebView/DOM rendering.

use bevy::prelude::*;

pub(crate) const ROOT_BG: Color =
    Color::srgb(0.031, 0.047, 0.039);
pub(crate) const HEADER_BG: Color =
    Color::srgba(0.047, 0.071, 0.059, 0.96);
pub(crate) const PANEL_BG: Color =
    Color::srgba(0.067, 0.102, 0.086, 0.95);
pub(crate) const PANEL_BG_SOFT: Color =
    Color::srgba(0.035, 0.055, 0.047, 0.92);
pub(crate) const PANEL_BG_DEEP: Color =
    Color::srgba(0.024, 0.035, 0.031, 0.98);

pub(crate) const GOLD: Color =
    Color::srgb(0.824, 0.678, 0.408);
pub(crate) const GOLD_BRIGHT: Color =
    Color::srgb(0.941, 0.812, 0.518);
pub(crate) const GOLD_DARK: Color =
    Color::srgb(0.439, 0.392, 0.263);

pub(crate) const TEXT: Color =
    Color::srgb(0.957, 0.918, 0.820);
pub(crate) const MUTED: Color =
    Color::srgb(0.518, 0.569, 0.541);

pub(crate) const BUTTON_BG: Color =
    Color::srgb(0.090, 0.129, 0.110);
pub(crate) const BUTTON_HOVER: Color =
    Color::srgb(0.204, 0.169, 0.110);
pub(crate) const BUTTON_PRESSED: Color =
    Color::srgb(0.278, 0.224, 0.122);
pub(crate) const BUTTON_BORDER: Color =
    Color::srgb(0.337, 0.396, 0.361);

pub(crate) const HP: Color =
    Color::srgb(0.706, 0.188, 0.157);
pub(crate) const MANA: Color =
    Color::srgb(0.161, 0.353, 0.722);
pub(crate) const XP: Color =
    Color::srgb(0.824, 0.647, 0.267);
pub(crate) const CAP: Color =
    Color::srgb(0.329, 0.584, 0.384);
pub(crate) const TARGET_HP: Color =
    Color::srgb(0.788, 0.204, 0.165);

fn surface_style(name: &str) -> Option<(Color, Color, f32)> {
    match name {
        "Native gameplay HUD · world header" => {
            Some((HEADER_BG, GOLD_DARK, 0.0))
        }
        "Native gameplay HUD · player"
        | "Native gameplay HUD · target"
        | "Native gameplay HUD · battle list"
        | "Native minimap"
        | "Native performance HUD" => {
            Some((PANEL_BG, GOLD_DARK, 7.0))
        }
        "Native gameplay HUD · chat"
        | "Native gameplay HUD · action bar"
        | "Native gameplay HUD · panel dock" => {
            Some((PANEL_BG_SOFT, GOLD_DARK, 7.0))
        }
        "Native gameplay HUD · inventory"
        | "Native gameplay HUD · character"
        | "Native gameplay HUD · skills"
        | "Native gameplay HUD · spellbook"
        | "Native gameplay HUD · crafting"
        | "Native gameplay HUD · NPC"
        | "Native direct trade"
        | "Native options"
        | "Native world map" => {
            Some((PANEL_BG_DEEP, GOLD, 9.0))
        }
        _ => None,
    }
}

pub(crate) fn apply_once(
    mut commands: Commands,
    mut applied: Local<bool>,
    mut surfaces: Query<(
        Entity,
        &Name,
        &mut Node,
        &mut BackgroundColor,
        Option<&mut BorderColor>,
    )>,
) {
    if *applied {
        return;
    }

    let mut styled = 0usize;

    for (entity, name, mut node, mut background, border) in &mut surfaces {
        let Some((surface, border_color, radius)) =
            surface_style(name.as_str())
        else {
            continue;
        };

        node.border = UiRect::all(px(1));
        node.border_radius = if radius <= 0.0 {
            BorderRadius::ZERO
        } else {
            BorderRadius::all(px(radius))
        };

        background.0 = surface;

        if let Some(mut border) = border {
            *border = BorderColor::all(border_color);
        } else {
            commands
                .entity(entity)
                .insert(BorderColor::all(border_color));
        }

        styled += 1;
    }

    info!(
        "ALDORIA UI THEME · styled {styled} native surfaces from React CSS palette"
    );

    *applied = true;
}
