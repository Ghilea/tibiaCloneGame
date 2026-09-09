// TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY
use std::{
    sync::{
        Arc,
        Mutex,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
};

use anyhow::{Context, Result};
use bevy::{
    asset::AssetPlugin,
    input::{ButtonState, keyboard::KeyboardInput},
    prelude::*,
    window::WindowResolution,
};

use crate::{
    native_ui_theme as theme,
    network::{
        self,
        NativeLoginResult,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LauncherMode {
    Login,
    LoggingIn,
    Characters,
    Launching,
        GameLoading,
Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoginField {
    Account,
    Password,
}

type PendingLogin =
    Arc<Mutex<Receiver<Result<NativeLoginResult, String>>>>;


type PendingGameSession = Arc<
    Mutex<
        Receiver<
            Result<network::NativeSession, String>,
        >,
    >,
>;

#[derive(Resource)]
pub(crate) struct NativeLauncherState {
    mode: LauncherMode,
    field: LoginField,
    username: String,
    password: String,
    selected_character: usize,
    login: Option<NativeLoginResult>,
    pending_login: Option<PendingLogin>,
    pending_game_session: Option<PendingGameSession>,
    launch_exit_timer: Option<Timer>,
    status: String,
}

impl Default for NativeLauncherState {
    fn default() -> Self {
        Self {
            mode: LauncherMode::Login,
            field: LoginField::Account,
            username: String::new(),
            password: String::new(),
            selected_character: 0,
            login: None,
            pending_login: None,
            pending_game_session: None,
            launch_exit_timer: None,
            status: "Enter your account credentials.".into(),
        }
    }
}

#[derive(Component)]
struct LauncherText;

#[derive(Component)]
struct LauncherLegacyPanel;

#[derive(Component)]
pub(crate) struct LauncherBackdrop;

#[derive(Component)]
pub(crate) struct LauncherBackdropTint;

#[derive(Component)]
struct LauncherWorldLoadingOverlay;

#[derive(Component)]
struct LauncherWorldLoadingStatus;

#[derive(Component)]
struct LauncherWorldLoadingProgress;

#[derive(Component)]
struct LauncherLoginForm;


#[derive(Component)]
struct LauncherCharacterLobby;

#[derive(Component, Clone, Copy)]
struct LauncherCharacterCard(usize);

#[derive(Component, Clone, Copy)]
struct LauncherCharacterCardText(usize);

#[derive(Component, Clone, Copy)]
struct LauncherFieldFrame(LoginField);

#[derive(Component, Clone, Copy)]
enum LauncherLoginText {
    AccountValue,
    PasswordValue,
    Status,
}

#[derive(Component, Clone, Copy)]
enum LauncherAction {
    FocusAccount,
    FocusPassword,
    Login,
    PreviousCharacter,
    NextCharacter,
    EnterWorld,
    Back,
}

pub fn run() -> Result<()> {
    App::new()
        .insert_resource(ClearColor(
            Color::srgb(0.055, 0.045, 0.035),
        ))
        .init_resource::<NativeLauncherState>()
        .init_resource::<crate::native_updater::NativeUpdaterState>()
        .add_plugins(
            DefaultPlugins
                .set(crate::native_render_plugin())
                .set(WindowPlugin {
                primary_window: Some(Window {
                    title:
                        format!(
                            "Embers of Aldoria - Native Launcher V{}",
                            crate::version::MIGRATION_VERSION,
                        ),
                    resolution:
                        WindowResolution::new(960, 660),
                    resizable: true,
                    ..default()
                }),
                ..default()
            })
            .set(AssetPlugin {
                file_path: crate::native_asset_root(),
                ..default()
            }),
        )
        .add_plugins(crate::SingleWindowGameplayPlugin)
        .add_systems(
            Startup,
            (
                setup,
                crate::native_updater::setup.after(setup),
            ),
        )
        .add_systems(
            Update,
            (
                crate::native_updater::poll,
                poll_login_worker.after(crate::native_updater::poll),
                poll_game_session_worker.after(poll_login_worker),
                update_world_loading_overlay.after(poll_game_session_worker),
                handle_launcher_text_input.after(update_world_loading_overlay),
                handle_keyboard.after(handle_launcher_text_input),
                handle_launcher_buttons.after(handle_keyboard),
                handle_character_card_buttons.after(handle_launcher_buttons),
                update_launcher_controls.after(handle_character_card_buttons),
                update_login_form.after(handle_character_card_buttons),
                update_character_lobby.after(update_login_form),
                tick_launch_handoff.after(update_character_lobby),
                update_screen.after(tick_launch_handoff),
            ),
        )
        .run();

    Ok(())
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    info!(
        "ALDORIA LAUNCHER ASSET ROOT · {}",
        crate::native_asset_root(),
    );

    // Bevy UI and ImageNode content require an active UI camera target.
    // V36.43 replaced the old setup() block and accidentally removed this.
    commands.spawn((
        Name::new("Native launcher UI camera"),
        Camera2d,
    ));
    spawn_launcher_background(&mut commands, &asset_server);
    spawn_launcher_world_loading_overlay(&mut commands, &asset_server);
    spawn_launcher_legacy_panel(&mut commands);
    spawn_launcher_controls(&mut commands);
    spawn_launcher_login_form(&mut commands);
    spawn_launcher_character_lobby(&mut commands);
}

fn spawn_launcher_background(
    commands: &mut Commands,
    asset_server: &AssetServer,
) {
    commands.spawn((
        Name::new("Native launcher background"),
        LauncherBackdrop,
        ZIndex(-100),
        Node {
            position_type: PositionType::Absolute,
            left: px(0),
            right: px(0),
            top: px(0),
            bottom: px(0),
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            ..default()
        },
        ImageNode::new(
            asset_server.load(
                "ui/launcher/aldoria_launcher_background.png",
            ),
        )
        .with_mode(
            bevy::ui::widget::NodeImageMode::Stretch,
        ),
    ));

    commands.spawn((
        Name::new("Native launcher background tint"),
        LauncherBackdropTint,
        ZIndex(-90),
        Node {
            position_type: PositionType::Absolute,
            left: px(0),
            right: px(0),
            top: px(0),
            bottom: px(0),
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            ..default()
        },
        BackgroundColor(Color::srgba(0.02, 0.03, 0.04, 0.28)),
    ));
}

fn spawn_launcher_world_loading_overlay(
    commands: &mut Commands,
    asset_server: &AssetServer,
) {
    commands
        .spawn((
            Name::new("Native enter-world loading overlay"),
            LauncherWorldLoadingOverlay,
            ZIndex(10_000),
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                left: px(0),
                right: px(0),
                top: px(0),
                bottom: px(0),
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(
                Color::srgb(0.015, 0.02, 0.018),
            ),
            ImageNode::new(
                asset_server.load(
                    "ui/launcher/aldoria_launcher_background.png",
                ),
            )
            .with_mode(
                bevy::ui::widget::NodeImageMode::Stretch,
            ),
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(0),
                    right: px(0),
                    top: px(0),
                    bottom: px(0),
                    width: Val::Percent(100.0),
                    height: Val::Percent(100.0),
                    ..default()
                },
                BackgroundColor(
                    Color::srgba(0.015, 0.02, 0.018, 0.42),
                ),
            ));

            root
                .spawn((
                    ZIndex(10_010),
                    Node {
                        width: Val::Percent(88.0),
                        max_width: px(640),
                        min_height: px(270),
                        padding: UiRect::all(px(30)),
                        border: UiRect::all(px(1)),
                        border_radius:
                            BorderRadius::all(px(10)),
                        flex_direction:
                            FlexDirection::Column,
                        align_items:
                            AlignItems::Center,
                        justify_content:
                            JustifyContent::Center,
                        row_gap: px(15),
                        ..default()
                    },
                    BackgroundColor(
                        Color::srgba(
                            0.03,
                            0.04,
                            0.035,
                            0.96,
                        ),
                    ),
                    BorderColor::all(
                        theme::GOLD_DARK,
                    ),
                ))
                .with_children(|card| {
                    card.spawn((
                        Text::new("EMBERS OF ALDORIA"),
                        TextFont {
                            font_size:
                                FontSize::Px(28.0),
                            ..default()
                        },
                        TextColor(theme::GOLD_BRIGHT),
                    ));

                    card.spawn((
                        Text::new("ENTERING THE WORLD"),
                        TextFont {
                            font_size:
                                FontSize::Px(13.0),
                            ..default()
                        },
                        TextColor(theme::GOLD),
                    ));

                    card.spawn((
                        LauncherWorldLoadingStatus,
                        Text::new(
                            "Connecting to the realm...",
                        ),
                        TextFont {
                            font_size:
                                FontSize::Px(15.0),
                            ..default()
                        },
                        TextColor(theme::TEXT),
                    ));

                    card
                        .spawn((
                            Node {
                                width:
                                    Val::Percent(100.0),
                                max_width: px(520),
                                height: px(12),
                                border:
                                    UiRect::all(px(1)),
                                border_radius:
                                    BorderRadius::all(px(4)),
                                ..default()
                            },
                            BackgroundColor(
                                theme::PANEL_BG_SOFT,
                            ),
                            BorderColor::all(
                                theme::GOLD_DARK,
                            ),
                        ))
                        .with_child((
                            LauncherWorldLoadingProgress,
                            Node {
                                width:
                                    Val::Percent(12.0),
                                height:
                                    Val::Percent(100.0),
                                border_radius:
                                    BorderRadius::all(px(3)),
                                ..default()
                            },
                            BackgroundColor(theme::GOLD),
                        ));

                    card.spawn((
                        Text::new(
                            "Connection | world | actors | models | renderer",
                        ),
                        TextFont {
                            font_size:
                                FontSize::Px(10.5),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));
                });
        });
}

fn spawn_launcher_legacy_panel(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native launcher legacy panel"),
            LauncherLegacyPanel,
            ZIndex(20),
            Node {
                position_type: PositionType::Absolute,
                left: px(0),
                right: px(0),
                top: px(0),
                bottom: px(0),
                padding: UiRect {
                    left: px(48),
                    right: px(48),
                    top: px(70),
                    bottom: px(128),
                },
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    width: Val::Percent(100.0),
                    max_width: px(940),
                    min_height: px(460),
                    padding: UiRect::all(px(30)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Stretch,
                    row_gap: px(12),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.03, 0.04, 0.05, 0.72)),
                BorderColor::all(theme::GOLD_DARK),
            ))
            .with_children(|panel| {
                panel.spawn((
                    LauncherText,
                    Text::new(""),
                    TextFont {
                        font_size: FontSize::Px(19.0),
                        ..default()
                    },
                    TextColor(theme::TEXT),
                ));
            });
        });
}

fn spawn_launcher_button(
    parent: &mut ChildSpawnerCommands,
    action: LauncherAction,
    label: &str,
) {
    parent
        .spawn((
            Button,
            action,
            Visibility::Hidden,
            Node {
                min_width: px(94),
                height: px(40),
                padding: UiRect::horizontal(px(12)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(6)),
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
                font_size: FontSize::Px(12.0),
                ..default()
            },
            TextColor(theme::TEXT),
        ));
}

fn spawn_launcher_controls(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native launcher controls"),
            ZIndex(40),
            Node {
                position_type: PositionType::Absolute,
                left: Val::Percent(50.0),
                bottom: px(30),
                width: px(780),
                min_height: px(50),
                margin: UiRect::left(px(-390)),
                column_gap: px(8),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
        ))
        .with_children(|parent| {
            spawn_launcher_button(
                parent,
                LauncherAction::Login,
                "LOG IN",
            );
            spawn_launcher_button(
                parent,
                LauncherAction::PreviousCharacter,
                "< PREV",
            );
            spawn_launcher_button(
                parent,
                LauncherAction::NextCharacter,
                "NEXT >",
            );
            spawn_launcher_button(
                parent,
                LauncherAction::EnterWorld,
                "ENTER WORLD",
            );
            spawn_launcher_button(
                parent,
                LauncherAction::Back,
                "BACK",
            );
        });
}

fn handle_launcher_text_input(
    mut keyboard: MessageReader<KeyboardInput>,
    mut state: ResMut<NativeLauncherState>,
) {
    if state.mode != LauncherMode::Login {
        for _ in keyboard.read() {}
        return;
    }

    for event in keyboard.read() {
        if event.state != ButtonState::Pressed {
            continue;
        }

        match event.key_code {
            KeyCode::Backspace => {
                match state.field {
                    LoginField::Account => {
                        state.username.pop();
                    }
                    LoginField::Password => {
                        state.password.pop();
                    }
                }
                continue;
            }
            KeyCode::Tab | KeyCode::Enter | KeyCode::Escape => {
                continue;
            }
            _ => {}
        }

        let Some(input) = event.text.as_ref() else {
            continue;
        };

        for character in input.chars() {
            if character.is_control() {
                continue;
            }

            match state.field {
                LoginField::Account => {
                    if character.is_whitespace()
                        || state.username.chars().count() >= 64
                    {
                        continue;
                    }
                    state.username.push(character);
                }
                LoginField::Password => {
                    if state.password.chars().count() >= 128 {
                        continue;
                    }
                    state.password.push(character);
                }
            }
        }
    }
}

fn spawn_login_field(
    parent: &mut ChildSpawnerCommands,
    field: LoginField,
    action: LauncherAction,
    label: &str,
    text_kind: LauncherLoginText,
) {
    parent
        .spawn(Node {
            width: Val::Percent(100.0),
            flex_direction: FlexDirection::Column,
            row_gap: px(6),
            ..default()
        })
        .with_children(|field_root| {
            field_root.spawn((
                Text::new(label),
                TextFont {
                    font_size: FontSize::Px(11.0),
                    ..default()
                },
                TextColor(theme::MUTED),
            ));

            field_root
                .spawn((
                    Button,
                    action,
                    LauncherFieldFrame(field),
                    Node {
                        width: Val::Percent(100.0),
                        height: px(48),
                        padding: UiRect::horizontal(px(14)),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(7)),
                        align_items: AlignItems::Center,
                        ..default()
                    },
                    BackgroundColor(theme::PANEL_BG_SOFT),
                    BorderColor::all(theme::BUTTON_BORDER),
                ))
                .with_child((
                    text_kind,
                    Text::new(""),
                    TextFont {
                        font_size: FontSize::Px(15.0),
                        ..default()
                    },
                    TextColor(theme::TEXT),
                ));
        });
}

fn spawn_launcher_login_form(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native graphical login root"),
            LauncherLoginForm,
            ZIndex(30),
            Node {
                position_type: PositionType::Absolute,
                left: px(0),
                right: px(0),
                top: px(0),
                bottom: px(0),
                padding: UiRect {
                    left: px(48),
                    right: px(48),
                    top: px(70),
                    bottom: px(128),
                },
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    width: Val::Percent(100.0),
                    max_width: px(980),
                    min_height: px(520),
                    padding: UiRect::all(px(34)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Stretch,
                    row_gap: px(14),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.03, 0.04, 0.05, 0.78)),
                BorderColor::all(theme::GOLD_DARK),
            ))
            .with_children(|form| {
                form.spawn((
                    Text::new("EMBERS OF ALDORIA"),
                    TextFont {
                        font_size: FontSize::Px(30.0),
                        ..default()
                    },
                    TextColor(theme::GOLD_BRIGHT),
                ));

                form.spawn((
                    Text::new("A world shaped by its people"),
                    TextFont {
                        font_size: FontSize::Px(12.0),
                        ..default()
                    },
                    TextColor(theme::MUTED),
                ));

                form.spawn(Node {
                    width: Val::Percent(100.0),
                    height: px(1),
                    margin: UiRect::vertical(px(4)),
                    ..default()
                })
                .insert(BackgroundColor(theme::GOLD_DARK));

                form.spawn((
                    Text::new("ACCOUNT LOGIN"),
                    TextFont {
                        font_size: FontSize::Px(15.0),
                        ..default()
                    },
                    TextColor(theme::GOLD),
                ));

                spawn_login_field(
                    form,
                    LoginField::Account,
                    LauncherAction::FocusAccount,
                    "ACCOUNT",
                    LauncherLoginText::AccountValue,
                );

                spawn_login_field(
                    form,
                    LoginField::Password,
                    LauncherAction::FocusPassword,
                    "PASSWORD",
                    LauncherLoginText::PasswordValue,
                );

                form.spawn((
                    LauncherLoginText::Status,
                    Text::new(""),
                    TextFont {
                        font_size: FontSize::Px(12.0),
                        ..default()
                    },
                    TextColor(theme::MUTED),
                ));

                form.spawn((
                    Text::new(
                        "Click a field or press Tab | Enter logs in",
                    ),
                    TextFont {
                        font_size: FontSize::Px(10.5),
                        ..default()
                    },
                    TextColor(theme::MUTED),
                ));
            });
        });
}

fn spawn_launcher_character_lobby(
    commands: &mut Commands,
) {
    commands
        .spawn((
            Name::new("Native graphical character lobby"),
            LauncherCharacterLobby,
            ZIndex(30),
            Visibility::Hidden,
            Node {
                position_type: PositionType::Absolute,
                left: px(0),
                right: px(0),
                top: px(0),
                bottom: px(0),
                padding: UiRect {
                    left: px(64),
                    right: px(64),
                    top: px(70),
                    bottom: px(128),
                },
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
        ))
        .with_children(|root| {
            root
                .spawn((
                    Node {
                        width: Val::Percent(100.0),
                        max_width: px(820),
                        min_height: px(520),
                        padding: UiRect::all(px(30)),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(10)),
                        flex_direction: FlexDirection::Column,
                        align_items: AlignItems::Stretch,
                        row_gap: px(12),
                        ..default()
                    },
                    BackgroundColor(
                        Color::srgba(0.03, 0.04, 0.05, 0.82),
                    ),
                    BorderColor::all(theme::GOLD_DARK),
                ))
                .with_children(|panel| {
                    panel.spawn((
                        Text::new("EMBERS OF ALDORIA"),
                        TextFont {
                            font_size: FontSize::Px(27.0),
                            ..default()
                        },
                        TextColor(theme::GOLD_BRIGHT),
                    ));

                    panel.spawn((
                        Text::new("CHARACTER LOBBY"),
                        TextFont {
                            font_size: FontSize::Px(14.0),
                            ..default()
                        },
                        TextColor(theme::GOLD),
                    ));

                    panel.spawn((
                        Text::new(
                            "Choose a character to enter the realm",
                        ),
                        TextFont {
                            font_size: FontSize::Px(11.0),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));

                    panel.spawn((
                        Node {
                            width: Val::Percent(100.0),
                            height: px(1),
                            margin: UiRect::vertical(px(5)),
                            ..default()
                        },
                        BackgroundColor(theme::GOLD_DARK),
                    ));

                    panel
                        .spawn(Node {
                            width: Val::Percent(100.0),
                            flex_direction: FlexDirection::Column,
                            row_gap: px(7),
                            ..default()
                        })
                        .with_children(|list| {
                            for index in 0..12usize {
                                list
                                    .spawn((
                                        Button,
                                        LauncherCharacterCard(index),
                                        Visibility::Hidden,
                                        Node {
                                            width:
                                                Val::Percent(100.0),
                                            min_height: px(48),
                                            padding:
                                                UiRect::horizontal(
                                                    px(14),
                                                ),
                                            border:
                                                UiRect::all(px(1)),
                                            border_radius:
                                                BorderRadius::all(
                                                    px(6),
                                                ),
                                            align_items:
                                                AlignItems::Center,
                                            ..default()
                                        },
                                        BackgroundColor(
                                            theme::BUTTON_BG,
                                        ),
                                        BorderColor::all(
                                            theme::BUTTON_BORDER,
                                        ),
                                    ))
                                    .with_child((
                                        LauncherCharacterCardText(
                                            index,
                                        ),
                                        Text::new(""),
                                        TextFont {
                                            font_size:
                                                FontSize::Px(13.0),
                                            ..default()
                                        },
                                        TextColor(theme::TEXT),
                                    ));
                            }
                        });

                    panel.spawn((
                        Text::new(
                            "Click a character | Arrow keys select | Enter enters world | Esc returns",
                        ),
                        TextFont {
                            font_size: FontSize::Px(10.0),
                            ..default()
                        },
                        TextColor(theme::MUTED),
                    ));
                });
        });
}

fn handle_keyboard(
    keys: Res<ButtonInput<KeyCode>>,
    updater: Res<crate::native_updater::NativeUpdaterState>,
    mut state: ResMut<NativeLauncherState>,
) {
    match state.mode {
        LauncherMode::Login => {
            if keys.just_pressed(KeyCode::Tab) {
                state.field = match state.field {
                    LoginField::Account => LoginField::Password,
                    LoginField::Password => LoginField::Account,
                };
                return;
            }

            if keys.just_pressed(KeyCode::Enter) {
                if updater.blocks_online_play() {
                    state.status =
                        updater.gate_message().into();
                    return;
                }

                begin_login(&mut state);
            }
        }
        LauncherMode::LoggingIn => {}
        LauncherMode::Characters => {
            let count = state
                .login
                .as_ref()
                .map(|login| login.characters.len())
                .unwrap_or(0);

            if count == 0 {
                state.mode = LauncherMode::Error;
                state.status =
                    "This account has no characters.".into();
                return;
            }

            if keys.just_pressed(KeyCode::ArrowDown) {
                step_character(&mut state, 1);
            }

            if keys.just_pressed(KeyCode::ArrowUp) {
                step_character(&mut state, -1);
            }

            if keys.just_pressed(KeyCode::Backspace)
                || keys.just_pressed(KeyCode::Escape)
            {
                state.mode = LauncherMode::Login;
                state.login = None;
                state.selected_character = 0;
                state.status =
                    "Returned to account login.".into();
                return;
            }

            if keys.just_pressed(KeyCode::Enter) {
                if updater.blocks_online_play() {
                    state.status =
                        updater.gate_message().into();
                    return;
                }

                if let Err(error) =
                    launch_selected_character(&mut state)
                {
                    state.mode = LauncherMode::Error;
                    state.status =
                        format!("Could not start game: {error:#}");
                }
            }
        }
        LauncherMode::Launching | LauncherMode::GameLoading => {}
        LauncherMode::Error => {
            if keys.just_pressed(KeyCode::Enter)
                || keys.just_pressed(KeyCode::Escape)
                || keys.just_pressed(KeyCode::Backspace)
            {
                state.mode = LauncherMode::Login;
                state.pending_login = None;
                state.login = None;
                state.status =
                    "Try logging in again.".into();
            }
        }
    }
}

fn handle_launcher_buttons(
    updater: Res<crate::native_updater::NativeUpdaterState>,
    mut state: ResMut<NativeLauncherState>,
    mut buttons: Query<
        (
            &Interaction,
            &LauncherAction,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (interaction, action, mut background, mut border) in &mut buttons {
        match *interaction {
            Interaction::Pressed => {
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);

                match action {
                    LauncherAction::FocusAccount => {
                        if state.mode == LauncherMode::Login {
                            state.field = LoginField::Account;
                        }
                    }
                    LauncherAction::FocusPassword => {
                        if state.mode == LauncherMode::Login {
                            state.field = LoginField::Password;
                        }
                    }
                    LauncherAction::Login => {
                        if state.mode == LauncherMode::Login {
                            if updater.blocks_online_play() {
                                state.status =
                                    updater.gate_message().into();
                            } else {
                                begin_login(&mut state);
                            }
                        }
                    }
                    LauncherAction::PreviousCharacter => {
                        if state.mode == LauncherMode::Characters {
                            step_character(&mut state, -1);
                        }
                    }
                    LauncherAction::NextCharacter => {
                        if state.mode == LauncherMode::Characters {
                            step_character(&mut state, 1);
                        }
                    }
                    LauncherAction::EnterWorld => {
                        if state.mode == LauncherMode::Characters {
                            if updater.blocks_online_play() {
                                state.status =
                                    updater.gate_message().into();
                            } else if let Err(error) =
                                launch_selected_character(&mut state)
                            {
                                state.mode = LauncherMode::Error;
                                state.status = format!(
                                    "Could not start game: {error:#}"
                                );
                            }
                        }
                    }
                    LauncherAction::Back => {
                        if matches!(
                            state.mode,
                            LauncherMode::Characters | LauncherMode::Error
                        ) {
                            state.mode = LauncherMode::Login;
                            state.pending_login = None;
                            state.login = None;
                            state.selected_character = 0;
                            state.status =
                                "Returned to account login.".into();
                        }
                    }
                }
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = theme::BUTTON_BG;
                *border = BorderColor::all(theme::BUTTON_BORDER);
            }
        }
    }
}

fn handle_character_card_buttons(
    mut state: ResMut<NativeLauncherState>,
    mut cards: Query<
        (
            &Interaction,
            &LauncherCharacterCard,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
) {
    if state.mode != LauncherMode::Characters {
        return;
    }

    let count = state
        .login
        .as_ref()
        .map(|login| login.characters.len())
        .unwrap_or(0);

    for (interaction, card, mut background, mut border)
        in &mut cards
    {
        if card.0 >= count {
            continue;
        }

        match *interaction {
            Interaction::Pressed => {
                state.selected_character = card.0;
                background.0 = theme::BUTTON_PRESSED;
                *border =
                    BorderColor::all(theme::GOLD_BRIGHT);
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border =
                    BorderColor::all(theme::GOLD);
            }
            Interaction::None => {}
        }
    }
}

fn update_character_lobby(
    state: Res<NativeLauncherState>,
    mut lobby: Query<
        &mut Visibility,
        With<LauncherCharacterLobby>,
    >,
    mut legacy_panels: Query<
        &mut Visibility,
        (
            With<LauncherLegacyPanel>,
            Without<LauncherCharacterLobby>,
        ),
    >,
    mut cards: Query<
        (
            &LauncherCharacterCard,
            &mut Visibility,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (
            Without<LauncherCharacterLobby>,
            Without<LauncherLegacyPanel>,
        ),
    >,
    mut card_texts: Query<
        (&LauncherCharacterCardText, &mut Text),
    >,
) {
    let show =
        state.mode == LauncherMode::Characters;

    if let Ok(mut visibility) = lobby.single_mut() {
        *visibility = if show {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if !show {
        return;
    }

    if let Ok(mut visibility) =
        legacy_panels.single_mut()
    {
        *visibility = Visibility::Hidden;
    }

    let characters = state
        .login
        .as_ref()
        .map(|login| login.characters.as_slice())
        .unwrap_or(&[]);

    for (card, mut visibility, mut background, mut border)
        in &mut cards
    {
        if characters.get(card.0).is_none() {
            *visibility = Visibility::Hidden;
            continue;
        }

        *visibility = Visibility::Visible;

        let selected =
            card.0 == state.selected_character;

        background.0 = if selected {
            theme::BUTTON_HOVER
        } else {
            theme::BUTTON_BG
        };

        *border = BorderColor::all(
            if selected {
                theme::GOLD_BRIGHT
            } else {
                theme::BUTTON_BORDER
            },
        );
    }

    for (slot, mut text) in &mut card_texts {
        let Some(character) =
            characters.get(slot.0)
        else {
            text.0.clear();
            continue;
        };

        let marker =
            if slot.0 == state.selected_character {
                ">"
            } else {
                " "
            };

        text.0 = format!(
            "{marker} {:<28}  Level {:>3}     Position {}:{}:{}",
            character.name,
            character.level,
            character.position.x,
            character.position.y,
            character.position.z,
        );
    }
}

fn update_login_form(
    state: Res<NativeLauncherState>,
    mut form: Query<
        &mut Visibility,
        With<LauncherLoginForm>,
    >,
    mut legacy_panels: Query<
        &mut Visibility,
        (
            With<LauncherLegacyPanel>,
            Without<LauncherLoginForm>,
        ),
    >,
    mut fields: Query<
        (&LauncherFieldFrame, &mut BorderColor),
    >,
    mut login_text: Query<
        (&LauncherLoginText, &mut Text, &mut TextColor),
    >,
) {
    let show_form = matches!(
        state.mode,
        LauncherMode::Login | LauncherMode::LoggingIn
    );

    if let Ok(mut visibility) = form.single_mut() {
        *visibility = if show_form {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if let Ok(mut visibility) = legacy_panels.single_mut() {
        *visibility = if show_form {
            Visibility::Hidden
        } else if state.mode == LauncherMode::GameLoading {
            Visibility::Hidden
        } else {
            Visibility::Visible
        };
    }

    if !show_form {
        return;
    }

    for (frame, mut border) in &mut fields {
        let active =
            state.mode == LauncherMode::Login
                && frame.0 == state.field;

        *border = BorderColor::all(
            if active {
                theme::GOLD_BRIGHT
            } else {
                theme::BUTTON_BORDER
            },
        );
    }

    let password =
        "*".repeat(state.password.chars().count());

    for (kind, mut text, mut color) in &mut login_text {
        match kind {
            LauncherLoginText::AccountValue => {
                text.0 = if state.username.is_empty() {
                    "Account name".into()
                } else {
                    state.username.clone()
                };

                color.0 = if state.username.is_empty() {
                    theme::MUTED
                } else {
                    theme::TEXT
                };
            }
            LauncherLoginText::PasswordValue => {
                text.0 = if password.is_empty() {
                    "Password".into()
                } else {
                    password.clone()
                };

                color.0 = if password.is_empty() {
                    theme::MUTED
                } else {
                    theme::TEXT
                };
            }
            LauncherLoginText::Status => {
                text.0 = if state.mode == LauncherMode::LoggingIn {
                    format!("Signing in... {}", state.status)
                } else {
                    state.status.clone()
                };

                color.0 = if state.mode == LauncherMode::LoggingIn {
                    theme::GOLD
                } else if state.status.to_ascii_lowercase().contains("error") {
                    Color::srgb(0.82, 0.28, 0.22)
                } else {
                    theme::MUTED
                };
            }
        }
    }
}

fn update_launcher_controls(
    state: Res<NativeLauncherState>,
    mut buttons: Query<(&LauncherAction, &mut Visibility)>,
) {
    for (action, mut visibility) in &mut buttons {
        let shown = match state.mode {
            LauncherMode::Login => matches!(
                action,
                LauncherAction::FocusAccount
                    | LauncherAction::FocusPassword
                    | LauncherAction::Login
            ),
            LauncherMode::Characters => matches!(
                action,
                LauncherAction::PreviousCharacter
                    | LauncherAction::NextCharacter
                    | LauncherAction::EnterWorld
                    | LauncherAction::Back
            ),
            LauncherMode::Error => {
                matches!(action, LauncherAction::Back)
            }
            LauncherMode::LoggingIn | LauncherMode::Launching | LauncherMode::GameLoading => false,
        };

        *visibility = if shown {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }
}

fn step_character(
    state: &mut NativeLauncherState,
    delta: isize,
) {
    let count = state
        .login
        .as_ref()
        .map(|login| login.characters.len())
        .unwrap_or(0);

    if count == 0 {
        return;
    }

    state.selected_character =
        (state.selected_character as isize + delta)
            .rem_euclid(count as isize) as usize;
}

fn tick_launch_handoff(
    time: Res<Time>,
    mut state: ResMut<NativeLauncherState>,
) {
    if state.mode != LauncherMode::Launching {
        return;
    }

    let Some(timer) = state.launch_exit_timer.as_mut() else {
        return;
    };

    timer.tick(time.delta());

    if timer.just_finished() {
        std::process::exit(0);
    }
}

fn begin_login(state: &mut NativeLauncherState) {
    let username = state.username.trim().to_owned();

    if username.len() < 3 {
        state.status =
            "Account name must contain at least 3 characters."
                .into();
        return;
    }

    if state.password.is_empty() {
        state.status =
            "Enter your password.".into();
        return;
    }

    let password = state.password.clone();
    let (tx, rx) =
        mpsc::channel::<Result<NativeLoginResult, String>>();

    match thread::Builder::new()
        .name("aldoria-launcher-login".into())
        .spawn(move || {
            let result =
                network::login_and_list_characters(
                    username,
                    password,
                )
                .map_err(|error| format!("{error:#}"));

            let _ = tx.send(result);
        })
    {
        Ok(_) => {
            state.pending_login =
                Some(Arc::new(Mutex::new(rx)));
            state.mode = LauncherMode::LoggingIn;
            state.status =
                "Authenticating and loading characters..."
                    .into();
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status =
                format!("Could not start login worker: {error}");
        }
    }
}

fn poll_login_worker(
    mut state: ResMut<NativeLauncherState>,
) {
    if state.mode != LauncherMode::LoggingIn {
        return;
    }

    let Some(receiver) =
        state.pending_login.as_ref().cloned()
    else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.mode = LauncherMode::Error;
            state.status =
                "Login worker lock failed.".into();
            return;
        };

        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.mode = LauncherMode::Error;
                state.status =
                    "Login worker stopped unexpectedly."
                        .into();
                return;
            }
        }
    };

    let Some(result) = result else {
        return;
    };

    state.pending_login = None;

    match result {
        Ok(login) => {
            if login.characters.is_empty() {
                state.mode = LauncherMode::Error;
                state.status =
                    "This account has no characters."
                        .into();
                return;
            }

            state.login = Some(login);
            state.selected_character = 0;
            state.mode = LauncherMode::Characters;
            state.status =
                "Choose a character and press Enter."
                    .into();
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status = error;
        }
    }
}

fn poll_game_session_worker(
    mut commands: Commands,
    mut state: ResMut<NativeLauncherState>,
) {
    if state.mode != LauncherMode::Launching {
        return;
    }

    let Some(receiver) =
        state.pending_game_session
            .as_ref()
            .cloned()
    else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.pending_game_session = None;
            state.mode = LauncherMode::Error;
            state.status =
                "Enter-world worker lock failed.".into();
            return;
        };

        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.pending_game_session = None;
                state.mode = LauncherMode::Error;
                state.status =
                    "Enter-world worker stopped unexpectedly."
                        .into();
                return;
            }
        }
    };

    let Some(result) = result else {
        return;
    };

    state.pending_game_session = None;

    match result {
        Ok(session) => {
            state.mode = LauncherMode::GameLoading;
            state.status =
                "World session ready. Loading world..."
                    .into();

            crate::install_single_window_session(
                &mut commands,
                session,
            );
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status = error;
        }
    }
}

fn launch_selected_character(
    state: &mut NativeLauncherState,
) -> Result<()> {
    let login = state
        .login
        .as_ref()
        .context("authenticated launcher state is missing")?;

    let character = login
        .characters
        .get(state.selected_character)
        .context("selected character is unavailable")?;

    let ws_url = login.ws_url.clone();
    let session_token = login.session_token.clone();
    let character_id = character.id;
    let character_name = character.name.clone();

    let (tx, rx) =
        mpsc::channel::<
            Result<network::NativeSession, String>
        >();

    thread::Builder::new()
        .name("aldoria-enter-world".into())
        .spawn(move || {
            let result =
                network::connect_selected_character(
                    ws_url,
                    session_token,
                    character_id,
                )
                .map_err(|error| format!("{error:#}"));

            let _ = tx.send(result);
        })
        .context(
            "could not start enter-world network worker",
        )?;

    state.pending_game_session =
        Some(Arc::new(Mutex::new(rx)));
    state.launch_exit_timer = None;
    state.mode = LauncherMode::Launching;
    state.status =
        format!(
            "Connecting to the realm as {character_name}..."
        );

    Ok(())
}

fn update_screen(
    state: Res<NativeLauncherState>,
    mut text: Query<&mut Text, With<LauncherText>>,
) {
    let Ok(mut text) = text.single_mut() else {
        return;
    };

    text.0 = match state.mode {
        LauncherMode::Login => render_login(&state),
        LauncherMode::LoggingIn => [
            "EMBERS OF ALDORIA".to_owned(),
            "Native client".to_owned(),
            String::new(),
            "Signing in...".to_owned(),
            String::new(),
            state.status.clone(),
        ]
        .join("\n"),
        LauncherMode::Characters => render_characters(&state),
        LauncherMode::Launching | LauncherMode::GameLoading => [
            "EMBERS OF ALDORIA".to_owned(),
            "ENTERING THE WORLD".to_owned(),
            String::new(),
            state.status.clone(),
            String::new(),
            "Starting world renderer...".to_owned(),
            "Preparing terrain, actors and interface...".to_owned(),
        ]
        .join("\n"),
        LauncherMode::Error => [
            "EMBERS OF ALDORIA".to_owned(),
            "Login error".to_owned(),
            String::new(),
            state.status.clone(),
            String::new(),
            "Enter / Esc   Back to login".to_owned(),
        ]
        .join("\n"),
    };
}

fn render_login(state: &NativeLauncherState) -> String {
    let account_marker =
        if state.field == LoginField::Account {
            ">"
        } else {
            " "
        };

    let password_marker =
        if state.field == LoginField::Password {
            ">"
        } else {
            " "
        };

    let masked =
        "*".repeat(state.password.chars().count());

    [
        "EMBERS OF ALDORIA".to_owned(),
        "A world shaped by its people".to_owned(),
        String::new(),
        "ACCOUNT LOGIN".to_owned(),
        String::new(),
        format!(
            "{account_marker} Account   {}",
            state.username,
        ),
        format!(
            "{password_marker} Password  {masked}",
        ),
        String::new(),
        state.status.clone(),
        String::new(),
        "Tab          Switch field".to_owned(),
        "Backspace    Delete".to_owned(),
        "Enter        Log in".to_owned(),
        String::new(),
        format!(
            "Development realm | Native V{}",
            crate::version::MIGRATION_VERSION,
        ),
    ]
    .join("\n")
}

fn render_characters(
    state: &NativeLauncherState,
) -> String {
    let Some(login) = state.login.as_ref() else {
        return "Character list unavailable.".into();
    };

    let mut lines = vec![
        "EMBERS OF ALDORIA".into(),
        "CHARACTER LOBBY".into(),
        String::new(),
    ];

    for (index, character) in
        login.characters.iter().enumerate()
    {
        let marker =
            if index == state.selected_character {
                ">"
            } else {
                " "
            };

        lines.push(format!(
            "{marker} {:<24} Level {:>3}   {}:{}:{}",
            character.name,
            character.level,
            character.position.x,
            character.position.y,
            character.position.z,
        ));
    }

    lines.extend([
        String::new(),
        state.status.clone(),
        String::new(),
        "↑ / ↓       Select character".into(),
        "Enter       Enter world".into(),
        "Esc         Back to login".into(),
    ]);

    lines.join("\n")
}

#[allow(dead_code)]
fn update_world_loading_overlay(
    state: Res<NativeLauncherState>,
    loading: Option<
        Res<crate::native_loading::NativeLoadingState>,
    >,
    mut overlay: Query<
        &mut Visibility,
        With<LauncherWorldLoadingOverlay>,
    >,
    mut status: Query<
        &mut Text,
        With<LauncherWorldLoadingStatus>,
    >,
    mut progress: Query<
        &mut Node,
        With<LauncherWorldLoadingProgress>,
    >,
) {
    let loading_active = loading
        .as_ref()
        .map(|loading| loading.active())
        .unwrap_or(false);

    let connecting =
        state.mode == LauncherMode::Launching;

    let world_loading =
        state.mode == LauncherMode::GameLoading
            && loading_active;

    let show = connecting || world_loading;

    if let Ok(mut visibility) = overlay.single_mut() {
        *visibility = if show {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if !show {
        return;
    }

    let (label, width) = if connecting {
        (state.status.clone(), 18.0)
    } else if let Some(loading) = loading.as_ref() {
        (
            loading.stage_label().to_owned(),
            loading.progress_percent(),
        )
    } else {
        ("Preparing world session...".to_owned(), 28.0)
    };

    if let Ok(mut text) = status.single_mut() {
        text.0 = label;
    }

    if let Ok(mut node) = progress.single_mut() {
        node.width = Val::Percent(width);
    }
}

pub(crate) fn sync_single_window_shell(
    launcher: Option<Res<NativeLauncherState>>,
    loading: Option<
        Res<crate::native_loading::NativeLoadingState>,
    >,
    mut backdrop: Query<
        &mut Visibility,
        With<LauncherBackdrop>,
    >,
    mut tint: Query<
        &mut Visibility,
        (
            With<LauncherBackdropTint>,
            Without<LauncherBackdrop>,
        ),
    >,
    mut updater: Query<
        &mut Visibility,
        (
            With<crate::native_updater::NativeUpdaterText>,
            Without<LauncherBackdrop>,
            Without<LauncherBackdropTint>,
        ),
    >,
) {
    let loading_active = loading
        .as_ref()
        .map(|state| state.active())
        .unwrap_or(false);

    let launcher_loading = launcher
        .as_ref()
        .map(|state| {
            state.mode == LauncherMode::Launching
                || (
                    state.mode == LauncherMode::GameLoading
                        && loading_active
                )
        })
        .unwrap_or(false);

    let shell_visibility =
        if launcher_loading || loading_active {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

    if let Ok(mut visibility) =
        backdrop.single_mut()
    {
        *visibility = shell_visibility;
    }

    if let Ok(mut visibility) =
        tint.single_mut()
    {
        *visibility = shell_visibility;
    }

    if let Ok(mut visibility) =
        updater.single_mut()
    {
        *visibility = Visibility::Hidden;
    }
}

#[allow(dead_code)]
fn append_text_input(
    keys: &ButtonInput<KeyCode>,
    mut target: String,
    max_len: usize,
    account_field: bool,
) -> String {
    if target.chars().count() >= max_len {
        return target;
    }

    let shift =
        keys.pressed(KeyCode::ShiftLeft)
            || keys.pressed(KeyCode::ShiftRight);

    let letters = [
        (KeyCode::KeyA, 'a'),
        (KeyCode::KeyB, 'b'),
        (KeyCode::KeyC, 'c'),
        (KeyCode::KeyD, 'd'),
        (KeyCode::KeyE, 'e'),
        (KeyCode::KeyF, 'f'),
        (KeyCode::KeyG, 'g'),
        (KeyCode::KeyH, 'h'),
        (KeyCode::KeyI, 'i'),
        (KeyCode::KeyJ, 'j'),
        (KeyCode::KeyK, 'k'),
        (KeyCode::KeyL, 'l'),
        (KeyCode::KeyM, 'm'),
        (KeyCode::KeyN, 'n'),
        (KeyCode::KeyO, 'o'),
        (KeyCode::KeyP, 'p'),
        (KeyCode::KeyQ, 'q'),
        (KeyCode::KeyR, 'r'),
        (KeyCode::KeyS, 's'),
        (KeyCode::KeyT, 't'),
        (KeyCode::KeyU, 'u'),
        (KeyCode::KeyV, 'v'),
        (KeyCode::KeyW, 'w'),
        (KeyCode::KeyX, 'x'),
        (KeyCode::KeyY, 'y'),
        (KeyCode::KeyZ, 'z'),
    ];

    for (key, value) in letters {
        if !keys.just_pressed(key) {
            continue;
        }

        target.push(
            if shift {
                value.to_ascii_uppercase()
            } else {
                value
            },
        );

        if target.chars().count() >= max_len {
            return target;
        }
    }

    let digits = [
        (KeyCode::Digit0, '0'),
        (KeyCode::Digit1, '1'),
        (KeyCode::Digit2, '2'),
        (KeyCode::Digit3, '3'),
        (KeyCode::Digit4, '4'),
        (KeyCode::Digit5, '5'),
        (KeyCode::Digit6, '6'),
        (KeyCode::Digit7, '7'),
        (KeyCode::Digit8, '8'),
        (KeyCode::Digit9, '9'),
    ];

    for (key, value) in digits {
        if keys.just_pressed(key) {
            target.push(value);

            if target.chars().count() >= max_len {
                return target;
            }
        }
    }

    if keys.just_pressed(KeyCode::Minus) {
        target.push(
            if shift && !account_field {
                '_'
            } else {
                '-'
            },
        );
    }

    if keys.just_pressed(KeyCode::Period)
        && !account_field
    {
        target.push('.');
    }

    if keys.just_pressed(KeyCode::Equal)
        && !account_field
    {
        target.push(
            if shift { '+' } else { '=' },
        );
    }

    if keys.just_pressed(KeyCode::Slash)
        && !account_field
    {
        target.push('/');
    }

    target.truncate(max_len);
    target
}
