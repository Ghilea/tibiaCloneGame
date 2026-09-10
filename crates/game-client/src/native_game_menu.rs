// TIBIAGAME_V36_48_0_NATIVE_GAME_MENU_MODAL
use bevy::prelude::*;

use crate::{
    native_map_ui::NativeMapUiState,
    native_modal,
    native_settings::NativeSettingsState,
    native_ui::NativePanelState,
    native_ui_theme as theme,
    state::NativeGameState,
};

#[derive(Resource, Default)]
pub(crate) struct NativeGameMenuState {
    pub(crate) open: bool,
}

#[derive(Component)]
pub(crate) struct NativeGameMenuRoot;

#[derive(Component)]
pub(crate) struct NativeGameMenuContext;

#[derive(Component, Clone, Copy)]
pub(crate) enum NativeGameMenuAction {
    Resume,
    Options,
}

pub(crate) fn setup(
    mut commands: Commands,
) {
    commands.insert_resource(
        NativeGameMenuState::default(),
    );

    commands
        .spawn((
            Name::new("Native modal · game menu"),
            NativeGameMenuRoot,
            native_modal::NativeModalRoot,
            GlobalZIndex(240),
            Visibility::Hidden,
            native_modal::root_node(),
            native_modal::backdrop(),
        ))
        .with_children(|root| {
            root
                .spawn((
                    Name::new(
                        "Native modal surface · game menu",
                    ),
                    native_modal::NativeModalSurface,
                    native_modal::panel_node(
                        620.0,
                        430.0,
                    ),
                    native_modal::surface(),
                    native_modal::surface_border(),
                ))
                .with_children(|panel| {
                    panel
                        .spawn((
                            native_modal::header_node(),
                            native_modal::divider_border(),
                        ))
                        .with_children(|header| {
                            header
                                .spawn(
                                    native_modal::header_copy_node(),
                                )
                                .with_children(|copy| {
                                    copy.spawn((
                                        Text::new(
                                            "GAME MENU",
                                        ),
                                        TextFont {
                                            font_size:
                                                FontSize::Px(
                                                    24.0,
                                                ),
                                            ..default()
                                        },
                                        TextColor(
                                            theme::GOLD_BRIGHT,
                                        ),
                                    ));

                                    copy.spawn((
                                        Text::new(
                                            "Embers of Aldoria",
                                        ),
                                        TextFont {
                                            font_size:
                                                FontSize::Px(
                                                    11.0,
                                                ),
                                            ..default()
                                        },
                                        TextColor(
                                            theme::MUTED,
                                        ),
                                    ));
                                });

                            header.spawn((
                                NativeGameMenuContext,
                                Text::new("Greyhaven"),
                                TextFont {
                                    font_size:
                                        FontSize::Px(
                                            10.5,
                                        ),
                                    ..default()
                                },
                                TextColor(theme::GOLD),
                            ));
                        });

                    panel
                        .spawn(
                            native_modal::body_node(),
                        )
                        .with_children(|body| {
                            spawn_menu_button(
                                body,
                                NativeGameMenuAction::Resume,
                                "RESUME",
                                "Return to Greyhaven",
                                true,
                            );

                            spawn_menu_button(
                                body,
                                NativeGameMenuAction::Options,
                                "OPTIONS",
                                "Audio, accessibility and performance",
                                false,
                            );

                            body.spawn((
                                Node {
                                    width:
                                        Val::Percent(
                                            100.0,
                                        ),
                                    min_height:
                                        px(84),
                                    margin:
                                        UiRect::top(
                                            px(4),
                                        ),
                                    padding:
                                        UiRect::all(
                                            px(12),
                                        ),
                                    border:
                                        UiRect::all(
                                            px(1),
                                        ),
                                    border_radius:
                                        BorderRadius::all(
                                            px(7),
                                        ),
                                    flex_direction:
                                        FlexDirection::Column,
                                    row_gap: px(5),
                                    ..default()
                                },
                                BackgroundColor(
                                    theme::PANEL_BG_SOFT,
                                ),
                                BorderColor::all(
                                    theme::BUTTON_BORDER,
                                ),
                            ))
                            .with_children(|info| {
                                info.spawn((
                                    Text::new(
                                        "QUICK KEYS",
                                    ),
                                    TextFont {
                                        font_size:
                                            FontSize::Px(
                                                10.5,
                                            ),
                                        ..default()
                                    },
                                    TextColor(
                                        theme::GOLD,
                                    ),
                                ));

                                info.spawn((
                                    Text::new(
                                        "I Inventory   K Skills   P Spells   B Crafting   F10 Options",
                                    ),
                                    TextFont {
                                        font_size:
                                            FontSize::Px(
                                                9.5,
                                            ),
                                        ..default()
                                    },
                                    TextColor(
                                        theme::MUTED,
                                    ),
                                ));
                            });
                        });

                    panel
                        .spawn((
                            native_modal::footer_node(),
                            native_modal::divider_border(),
                        ))
                        .with_children(|footer| {
                            footer.spawn((
                                Text::new(
                                    "Esc resumes  |  Online world continues while this menu is open",
                                ),
                                TextFont {
                                    font_size:
                                        FontSize::Px(
                                            9.5,
                                        ),
                                    ..default()
                                },
                                TextColor(theme::MUTED),
                            ));
                        });
                });
        });
}

fn spawn_menu_button(
    parent: &mut ChildSpawnerCommands,
    action: NativeGameMenuAction,
    title: &str,
    detail: &str,
    primary: bool,
) {
    let background =
        if primary {
            theme::BUTTON_HOVER
        } else {
            theme::BUTTON_BG
        };

    let border =
        if primary {
            theme::GOLD
        } else {
            theme::BUTTON_BORDER
        };

    parent
        .spawn((
            Button,
            action,
            Node {
                width: Val::Percent(100.0),
                min_height: px(68),
                padding: UiRect {
                    left: px(16),
                    right: px(16),
                    top: px(10),
                    bottom: px(10),
                },
                border:
                    UiRect::all(px(1)),
                border_radius:
                    BorderRadius::all(px(7)),
                flex_direction:
                    FlexDirection::Column,
                align_items:
                    AlignItems::FlexStart,
                justify_content:
                    JustifyContent::Center,
                row_gap: px(3),
                ..default()
            },
            BackgroundColor(background),
            BorderColor::all(border),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(title),
                TextFont {
                    font_size:
                        FontSize::Px(13.0),
                    ..default()
                },
                TextColor(
                    if primary {
                        theme::GOLD_BRIGHT
                    } else {
                        theme::TEXT
                    },
                ),
            ));

            button.spawn((
                Text::new(detail),
                TextFont {
                    font_size:
                        FontSize::Px(9.5),
                    ..default()
                },
                TextColor(theme::MUTED),
            ));
        });
}

pub(crate) fn handle_input(
    keys: Res<ButtonInput<KeyCode>>,
    settings: Res<NativeSettingsState>,
    panels: Res<NativePanelState>,
    map_ui: Res<NativeMapUiState>,
    game_state: Res<NativeGameState>,
    mut menu: ResMut<NativeGameMenuState>,
) {
    if !keys.just_pressed(KeyCode::Escape) {
        return;
    }

    if menu.open {
        menu.open = false;
        return;
    }

    // Escape should close the currently active gameplay modal first.
    // This system runs before those panel handlers, so it sees their state
    // before they process the same Escape press.
    let another_modal_open =
        settings.options_open
            || map_ui.world_map_open
            || panels.inventory_open
            || panels.character_open
            || panels.skills_open
            || panels.spells_open
            || panels.crafting_open
            || panels.npc_open
            || game_state.trade.is_some();

    if another_modal_open {
        return;
    }

    menu.open = true;
}

pub(crate) fn handle_buttons(
    mut menu:
        ResMut<NativeGameMenuState>,
    mut settings:
        ResMut<NativeSettingsState>,
    mut buttons: Query<
        (
            &Interaction,
            &NativeGameMenuAction,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (
            Changed<Interaction>,
            With<Button>,
        ),
    >,
) {
    for (
        interaction,
        action,
        mut background,
        mut border,
    ) in &mut buttons
    {
        match *interaction {
            Interaction::Hovered => {
                background.0 =
                    theme::BUTTON_HOVER;
                *border =
                    BorderColor::all(
                        theme::GOLD,
                    );
            }
            Interaction::None => {
                background.0 =
                    theme::BUTTON_BG;
                *border =
                    BorderColor::all(
                        theme::BUTTON_BORDER,
                    );
            }
            Interaction::Pressed => {
                background.0 =
                    theme::BUTTON_PRESSED;
                *border =
                    BorderColor::all(
                        theme::GOLD_BRIGHT,
                    );

                if !menu.open {
                    continue;
                }

                match *action {
                    NativeGameMenuAction::Resume => {
                        menu.open = false;
                    }
                    NativeGameMenuAction::Options => {
                        menu.open = false;
                        settings.options_open = true;
                    }
                }
            }
        }
    }
}

pub(crate) fn update_ui(
    menu: Res<NativeGameMenuState>,
    game_state: Res<NativeGameState>,
    mut roots: Query<
        &mut Visibility,
        With<NativeGameMenuRoot>,
    >,
    mut context: Query<
        &mut Text,
        With<NativeGameMenuContext>,
    >,
) {
    for mut visibility in &mut roots {
        *visibility =
            if menu.open {
                Visibility::Visible
            } else {
                Visibility::Hidden
            };
    }

    if !menu.open {
        return;
    }

    let value =
        if let Some(player) =
            game_state.local_player()
        {
            format!(
                "{}  |  Level {}  |  {}:{}:{}",
                player.name,
                player.level,
                player.position.x,
                player.position.y,
                player.position.z,
            )
        } else {
            "Greyhaven".to_owned()
        };

    for mut text in &mut context {
        text.0 = value.clone();
    }
}

pub(crate) fn menu_closed(
    menu: Option<Res<NativeGameMenuState>>,
) -> bool {
    match menu {
        Some(menu) => !menu.open,
        None => true,
    }
}
