// TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY
use std::{
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
};

use anyhow::{Context, Result};
use bevy::{
    asset::AssetPlugin,
    image::{ImageLoaderSettings, ImageSampler},
    input::{ButtonState, keyboard::KeyboardInput},
    prelude::*,
    window::WindowResolution,
};

use crate::{
    native_modal, native_ui_theme as theme,
    network::{self, NativeLoginResult},
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

type PendingLogin = Arc<Mutex<Receiver<Result<NativeLoginResult, String>>>>;

type PendingGameSession = Arc<Mutex<Receiver<Result<network::NativeSession, String>>>>;

type PendingCharacterCreate = Arc<Mutex<Receiver<Result<game_protocol::CharacterSummary, String>>>>;

#[derive(Resource)]
pub(crate) struct NativeLauncherState {
    mode: LauncherMode,
    field: LoginField,
    username: String,
    password: String,
    character_name: String,
    character_name_active: bool,
    selected_character: usize,
    login: Option<NativeLoginResult>,
    pending_login: Option<PendingLogin>,
    pending_character_create: Option<PendingCharacterCreate>,
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
            character_name: String::new(),
            character_name_active: false,
            selected_character: 0,
            login: None,
            pending_login: None,
            pending_character_create: None,
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

#[derive(Component)]
struct LauncherCharacterLobbySummary;

#[derive(Component)]
struct LauncherCharacterNameFrame;

#[derive(Component)]
struct LauncherCharacterNameText;

#[derive(Component)]
struct LauncherModalActionButton;

#[derive(Component)]
struct LauncherModalPrimaryButton;

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
    FocusCharacterName,
    CreateCharacter,
    PreviousCharacter,
    NextCharacter,
    EnterWorld,
    Back,
}

pub fn run() -> Result<()> {
    App::new()
        .insert_resource(ClearColor(Color::srgb(0.055, 0.045, 0.035)))
        .init_resource::<NativeLauncherState>()
        .init_resource::<crate::native_updater::NativeUpdaterState>()
        .add_plugins(
            DefaultPlugins
                .set(crate::native_render_plugin())
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: format!(
                            "Embers of Aldoria - Native Launcher V{}",
                            crate::version::MIGRATION_VERSION,
                        ),
                        resolution: WindowResolution::new(960, 660),
                        resize_constraints: bevy::window::WindowResizeConstraints {
                            min_width: 640.0,
                            min_height: 480.0,
                            ..default()
                        },
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
        .add_systems(Startup, (setup, crate::native_updater::setup.after(setup)))
        .add_systems(
            Update,
            (
                crate::native_updater::poll,
                poll_login_worker.after(crate::native_updater::poll),
                poll_character_create_worker.after(poll_login_worker),
                poll_game_session_worker.after(poll_character_create_worker),
                update_world_loading_overlay.after(poll_game_session_worker),
                update_adaptive_ui_scale.after(update_world_loading_overlay),
                handle_launcher_text_input.after(update_adaptive_ui_scale),
                handle_keyboard.after(handle_launcher_text_input),
                handle_launcher_buttons.after(handle_keyboard),
                handle_character_card_buttons.after(handle_launcher_buttons),
                update_launcher_controls.after(handle_character_card_buttons),
                update_login_form.after(handle_character_card_buttons),
                update_character_lobby.after(update_login_form),
                tick_launch_handoff.after(update_character_lobby),
                update_screen.after(tick_launch_handoff),
                enforce_gameplay_launcher_ui_hidden.after(update_screen),
            ),
        )
        .run();

    Ok(())
}

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    info!(
        "ALDORIA LAUNCHER ASSET ROOT · {}",
        crate::native_asset_root(),
    );

    // Bevy UI and ImageNode content require an active UI camera target.
    // V36.43 replaced the old setup() block and accidentally removed this.
    commands.spawn((
        Name::new("Native launcher UI camera"),
        Camera2d,
        Camera {
            order: 100,
            clear_color: bevy::camera::ClearColorConfig::None,
            ..default()
        },
        bevy::ui::IsDefaultUiCamera,
    ));
    spawn_launcher_background(&mut commands, &asset_server);
    spawn_launcher_world_loading_overlay(&mut commands, &asset_server);
    spawn_launcher_legacy_panel(&mut commands);
    spawn_launcher_controls(&mut commands);
    spawn_launcher_login_form(&mut commands);
    spawn_launcher_character_lobby(&mut commands);
}

fn spawn_launcher_background(commands: &mut Commands, asset_server: &AssetServer) {
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
        ImageNode::new(load_launcher_background(asset_server))
            .with_mode(bevy::ui::widget::NodeImageMode::Stretch),
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

fn load_launcher_background(asset_server: &AssetServer) -> Handle<Image> {
    asset_server
        .load_builder()
        .with_settings::<ImageLoaderSettings>(|settings| {
            settings.sampler = ImageSampler::linear();
        })
        .load("ui/launcher/aldoria_launcher_background.png")
}

fn spawn_launcher_world_loading_overlay(commands: &mut Commands, asset_server: &AssetServer) {
    commands
        .spawn((
            Name::new("Native enter-world loading overlay"),
            LauncherWorldLoadingOverlay,
            GlobalZIndex(10_000),
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
            BackgroundColor(Color::srgb(0.015, 0.02, 0.018)),
            ImageNode::new(load_launcher_background(asset_server))
                .with_mode(bevy::ui::widget::NodeImageMode::Stretch),
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
                BackgroundColor(Color::srgba(0.015, 0.02, 0.018, 0.42)),
            ));

            root.spawn((
                ZIndex(10_010),
                Node {
                    width: Val::Percent(88.0),
                    max_width: px(640),
                    min_height: px(270),
                    padding: UiRect::all(px(30)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    row_gap: px(15),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.03, 0.04, 0.035, 0.96)),
                BorderColor::all(theme::GOLD_DARK),
            ))
            .with_children(|card| {
                card.spawn((
                    Text::new("EMBERS OF ALDORIA"),
                    TextFont {
                        font_size: FontSize::Px(28.0),
                        ..default()
                    },
                    TextColor(theme::GOLD_BRIGHT),
                ));

                card.spawn((
                    Text::new("ENTERING THE WORLD"),
                    TextFont {
                        font_size: FontSize::Px(13.0),
                        ..default()
                    },
                    TextColor(theme::GOLD),
                ));

                card.spawn((
                    LauncherWorldLoadingStatus,
                    Text::new("Connecting to the realm..."),
                    TextFont {
                        font_size: FontSize::Px(15.0),
                        ..default()
                    },
                    TextColor(theme::TEXT),
                ));

                card.spawn((
                    Node {
                        width: Val::Percent(100.0),
                        max_width: px(520),
                        height: px(12),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(4)),
                        ..default()
                    },
                    BackgroundColor(theme::PANEL_BG_SOFT),
                    BorderColor::all(theme::GOLD_DARK),
                ))
                .with_child((
                    LauncherWorldLoadingProgress,
                    Node {
                        width: Val::Percent(12.0),
                        height: Val::Percent(100.0),
                        border_radius: BorderRadius::all(px(3)),
                        ..default()
                    },
                    BackgroundColor(theme::GOLD),
                ));

                card.spawn((
                    Text::new("Connection | world | actors | models | renderer"),
                    TextFont {
                        font_size: FontSize::Px(10.5),
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

fn spawn_launcher_button(parent: &mut ChildSpawnerCommands, action: LauncherAction, label: &str) {
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

fn spawn_modal_action_button(
    parent: &mut ChildSpawnerCommands,
    action: LauncherAction,
    label: &str,
    primary: bool,
) {
    let background = if primary {
        theme::BUTTON_HOVER
    } else {
        theme::BUTTON_BG
    };

    let border = if primary {
        theme::GOLD
    } else {
        theme::BUTTON_BORDER
    };

    let mut button = parent.spawn((
        Button,
        action,
        LauncherModalActionButton,
        native_modal::action_button_node(),
        BackgroundColor(background),
        BorderColor::all(border),
    ));

    if primary {
        button.insert(LauncherModalPrimaryButton);
    }

    button.with_child((
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
            spawn_launcher_button(parent, LauncherAction::PreviousCharacter, "< PREV");
            spawn_launcher_button(parent, LauncherAction::NextCharacter, "NEXT >");
            spawn_launcher_button(parent, LauncherAction::EnterWorld, "ENTER WORLD");
            spawn_launcher_button(parent, LauncherAction::Back, "BACK");
        });
}

fn update_adaptive_ui_scale(
    windows: Query<&Window, With<bevy::window::PrimaryWindow>>,
    mut ui_scale: ResMut<UiScale>,
) {
    let Ok(window) = windows.single() else {
        return;
    };

    let width = window.resolution.width().max(1.0);
    let height = window.resolution.height().max(1.0);

    // Let the launcher continue shrinking on genuinely small windows. The old
    // 0.58 floor could make a panel taller or wider than the available view.
    let target = (width / 1280.0).min(height / 800.0).clamp(0.40, 1.0);

    if (ui_scale.0 - target).abs() > 0.005 {
        ui_scale.0 = target;
    }
}

fn handle_launcher_text_input(
    mut keyboard: MessageReader<KeyboardInput>,
    mut state: ResMut<NativeLauncherState>,
) {
    let editing_login = state.mode == LauncherMode::Login;
    let editing_character = state.mode == LauncherMode::Characters
        && state.character_name_active
        && state.pending_character_create.is_none();

    if !editing_login && !editing_character {
        for _ in keyboard.read() {}
        return;
    }

    for event in keyboard.read() {
        if event.state != ButtonState::Pressed {
            continue;
        }

        match event.key_code {
            KeyCode::Backspace => {
                if editing_character {
                    state.character_name.pop();
                } else {
                    match state.field {
                        LoginField::Account => {
                            state.username.pop();
                        }
                        LoginField::Password => {
                            state.password.pop();
                        }
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

            if editing_character {
                if (character.is_alphabetic() || character == ' ')
                    && state.character_name.chars().count() < 20
                {
                    state.character_name.push(character);
                }
                continue;
            }

            match state.field {
                LoginField::Account => {
                    if character.is_whitespace() || state.username.chars().count() >= 64 {
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
            min_width: px(0),
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
                        min_width: px(0),
                        height: px(48),
                        padding: UiRect::horizontal(px(14)),
                        border: UiRect::all(px(1)),
                        border_radius: BorderRadius::all(px(7)),
                        align_items: AlignItems::Center,
                        overflow: Overflow::clip(),
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
                    bottom: px(70),
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
                    min_width: px(0),
                    max_width: px(780),
                    min_height: px(460),
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
                    Text::new("Click a field or press Tab | Enter logs in"),
                    TextFont {
                        font_size: FontSize::Px(10.5),
                        ..default()
                    },
                    TextColor(theme::MUTED),
                ));

                form.spawn(Node {
                    width: Val::Percent(100.0),
                    flex_direction: FlexDirection::Row,
                    justify_content: JustifyContent::FlexEnd,
                    ..default()
                })
                .with_children(|actions| {
                    spawn_modal_action_button(actions, LauncherAction::Login, "LOG IN", true);
                });
            });
        });
}

fn spawn_launcher_character_lobby(commands: &mut Commands) {
    commands
        .spawn((
            Name::new("Native modal · character lobby"),
            LauncherCharacterLobby,
            native_modal::NativeModalRoot,
            GlobalZIndex(120),
            Visibility::Hidden,
            native_modal::root_node(),
            native_modal::backdrop(),
        ))
        .with_children(|root| {
            root.spawn((
                Name::new("Native modal surface · character lobby"),
                native_modal::NativeModalSurface,
                native_modal::panel_node(900.0, 520.0),
                native_modal::surface(),
                native_modal::surface_border(),
            ))
            .with_children(|panel| {
                panel
                    .spawn((native_modal::header_node(), native_modal::divider_border()))
                    .with_children(|header| {
                        header
                            .spawn(native_modal::header_copy_node())
                            .with_children(|copy| {
                                copy.spawn((
                                    Text::new("SELECT CHARACTER"),
                                    TextFont {
                                        font_size: FontSize::Px(24.0),
                                        ..default()
                                    },
                                    TextColor(theme::GOLD_BRIGHT),
                                ));

                                copy.spawn((
                                    Text::new("Choose who enters Greyhaven"),
                                    TextFont {
                                        font_size: FontSize::Px(11.5),
                                        ..default()
                                    },
                                    TextColor(theme::MUTED),
                                ));
                            });

                        header.spawn((
                            Text::new("EMBERS OF ALDORIA  |  GREYHAVEN"),
                            TextFont {
                                font_size: FontSize::Px(10.5),
                                ..default()
                            },
                            TextColor(theme::GOLD),
                        ));
                    });

                panel
                    .spawn(native_modal::body_node())
                    .with_children(|body| {
                        body.spawn((
                            LauncherCharacterLobbySummary,
                            Text::new("Loading characters..."),
                            TextFont {
                                font_size: FontSize::Px(11.5),
                                ..default()
                            },
                            TextColor(theme::MUTED),
                        ));

                        body.spawn(native_modal::two_column_node())
                            .with_children(|columns| {
                                columns
                                    .spawn(native_modal::card_column_node())
                                    .with_children(|left| {
                                        for index in 0..6usize {
                                            left.spawn((
                                                Button,
                                                LauncherCharacterCard(index),
                                                Visibility::Hidden,
                                                native_modal::card_node(),
                                                BackgroundColor(theme::BUTTON_BG),
                                                BorderColor::all(theme::BUTTON_BORDER),
                                            ))
                                            .with_child((
                                                LauncherCharacterCardText(index),
                                                Text::new(""),
                                                TextFont {
                                                    font_size: FontSize::Px(12.0),
                                                    ..default()
                                                },
                                                TextColor(theme::TEXT),
                                            ));
                                        }
                                    });

                                columns
                                    .spawn(native_modal::card_column_node())
                                    .with_children(|right| {
                                        for index in 6..12usize {
                                            right
                                                .spawn((
                                                    Button,
                                                    LauncherCharacterCard(index),
                                                    Visibility::Hidden,
                                                    native_modal::card_node(),
                                                    BackgroundColor(theme::BUTTON_BG),
                                                    BorderColor::all(theme::BUTTON_BORDER),
                                                ))
                                                .with_child((
                                                    LauncherCharacterCardText(index),
                                                    Text::new(""),
                                                    TextFont {
                                                        font_size: FontSize::Px(12.0),
                                                        ..default()
                                                    },
                                                    TextColor(theme::TEXT),
                                                ));
                                        }
                                    });
                            });

                        body.spawn(Node {
                            width: Val::Percent(100.0),
                            min_width: px(0),
                            flex_direction: FlexDirection::Row,
                            flex_wrap: FlexWrap::Wrap,
                            column_gap: px(8),
                            row_gap: px(8),
                            align_items: AlignItems::Center,
                            ..default()
                        })
                        .with_children(|create| {
                            create
                                .spawn((
                                    Button,
                                    LauncherAction::FocusCharacterName,
                                    LauncherModalActionButton,
                                    LauncherCharacterNameFrame,
                                    Node {
                                        min_width: px(180),
                                        height: px(42),
                                        flex_grow: 1.0,
                                        flex_shrink: 1.0,
                                        padding: UiRect::horizontal(px(12)),
                                        border: UiRect::all(px(1)),
                                        border_radius: BorderRadius::all(px(6)),
                                        align_items: AlignItems::Center,
                                        overflow: Overflow::clip(),
                                        ..default()
                                    },
                                    BackgroundColor(theme::PANEL_BG_SOFT),
                                    BorderColor::all(theme::BUTTON_BORDER),
                                ))
                                .with_child((
                                    LauncherCharacterNameText,
                                    Text::new("New character name"),
                                    TextFont {
                                        font_size: FontSize::Px(12.0),
                                        ..default()
                                    },
                                    TextColor(theme::MUTED),
                                ));

                            spawn_modal_action_button(
                                create,
                                LauncherAction::CreateCharacter,
                                "CREATE CHARACTER",
                                false,
                            );
                        });
                    });

                panel
                    .spawn((native_modal::footer_node(), native_modal::divider_border()))
                    .with_children(|footer| {
                        footer.spawn((
                            Text::new("Arrow keys select  |  Enter plays  |  Esc returns"),
                            TextFont {
                                font_size: FontSize::Px(10.0),
                                ..default()
                            },
                            TextColor(theme::MUTED),
                        ));

                        footer
                            .spawn(native_modal::footer_actions_node())
                            .with_children(|actions| {
                                spawn_modal_action_button(
                                    actions,
                                    LauncherAction::Back,
                                    "BACK",
                                    false,
                                );

                                spawn_modal_action_button(
                                    actions,
                                    LauncherAction::EnterWorld,
                                    "ENTER WORLD",
                                    true,
                                );
                            });
                    });
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
                    state.status = updater.gate_message().into();
                    return;
                }

                begin_login(&mut state);
            }
        }
        LauncherMode::LoggingIn => {}
        LauncherMode::Characters => {
            if state.character_name_active {
                if keys.just_pressed(KeyCode::Escape) {
                    state.character_name_active = false;
                    state.status = "Character creation cancelled.".into();
                } else if keys.just_pressed(KeyCode::Enter) {
                    begin_create_character(&mut state);
                }
                return;
            }

            let count = state
                .login
                .as_ref()
                .map(|login| login.characters.len())
                .unwrap_or(0);

            if keys.just_pressed(KeyCode::ArrowDown) {
                step_character(&mut state, 1);
            }

            if keys.just_pressed(KeyCode::ArrowUp) {
                step_character(&mut state, -1);
            }

            if keys.just_pressed(KeyCode::Backspace) || keys.just_pressed(KeyCode::Escape) {
                state.mode = LauncherMode::Login;
                state.login = None;
                state.selected_character = 0;
                state.status = "Returned to account login.".into();
                return;
            }

            if keys.just_pressed(KeyCode::Enter) && count > 0 {
                if updater.blocks_online_play() {
                    state.status = updater.gate_message().into();
                    return;
                }

                if let Err(error) = launch_selected_character(&mut state) {
                    state.mode = LauncherMode::Error;
                    state.status = format!("Could not start game: {error:#}");
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
                state.status = "Try logging in again.".into();
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
            Option<&LauncherModalPrimaryButton>,
            &mut BackgroundColor,
            &mut BorderColor,
        ),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (interaction, action, primary, mut background, mut border) in &mut buttons {
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
                                state.status = updater.gate_message().into();
                            } else {
                                begin_login(&mut state);
                            }
                        }
                    }
                    LauncherAction::FocusCharacterName => {
                        if state.mode == LauncherMode::Characters
                            && state.pending_character_create.is_none()
                        {
                            state.character_name_active = true;
                            state.status = "Enter a name with 2-20 letters.".into();
                        }
                    }
                    LauncherAction::CreateCharacter => {
                        if state.mode == LauncherMode::Characters {
                            state.character_name_active = true;
                            begin_create_character(&mut state);
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
                                state.status = updater.gate_message().into();
                            } else if let Err(error) = launch_selected_character(&mut state) {
                                state.mode = LauncherMode::Error;
                                state.status = format!("Could not start game: {error:#}");
                            }
                        }
                    }
                    LauncherAction::Back => {
                        if matches!(state.mode, LauncherMode::Characters | LauncherMode::Error) {
                            state.mode = LauncherMode::Login;
                            state.pending_login = None;
                            state.pending_character_create = None;
                            state.login = None;
                            state.character_name.clear();
                            state.character_name_active = false;
                            state.selected_character = 0;
                            state.status = "Returned to account login.".into();
                        }
                    }
                }
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {
                background.0 = if primary.is_some() {
                    theme::BUTTON_HOVER
                } else {
                    theme::BUTTON_BG
                };

                *border = BorderColor::all(if primary.is_some() {
                    theme::GOLD
                } else {
                    theme::BUTTON_BORDER
                });
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

    for (interaction, card, mut background, mut border) in &mut cards {
        if card.0 >= count {
            continue;
        }

        match *interaction {
            Interaction::Pressed => {
                state.selected_character = card.0;
                background.0 = theme::BUTTON_PRESSED;
                *border = BorderColor::all(theme::GOLD_BRIGHT);
            }
            Interaction::Hovered => {
                background.0 = theme::BUTTON_HOVER;
                *border = BorderColor::all(theme::GOLD);
            }
            Interaction::None => {}
        }
    }
}

fn update_character_lobby(
    state: Res<NativeLauncherState>,
    mut lobby: Query<&mut Visibility, With<LauncherCharacterLobby>>,
    mut legacy_panels: Query<
        &mut Visibility,
        (With<LauncherLegacyPanel>, Without<LauncherCharacterLobby>),
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
            Without<LauncherCharacterNameFrame>,
        ),
    >,
    mut character_name_frame: Query<
        &mut BorderColor,
        (
            With<LauncherCharacterNameFrame>,
            Without<LauncherCharacterCard>,
        ),
    >,
    mut text_queries: ParamSet<(
        Query<(&LauncherCharacterCardText, &mut Text, &mut TextColor)>,
        Query<&mut Text, With<LauncherCharacterLobbySummary>>,
        Query<(&mut Text, &mut TextColor), With<LauncherCharacterNameText>>,
    )>,
) {
    let show = state.mode == LauncherMode::Characters;

    for mut visibility in &mut lobby {
        *visibility = if show {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if !show {
        for (_, mut visibility, _, _) in &mut cards {
            *visibility = Visibility::Hidden;
        }

        for (_, mut text, _) in &mut text_queries.p0() {
            text.0.clear();
        }

        return;
    }

    for mut visibility in &mut legacy_panels {
        *visibility = Visibility::Hidden;
    }

    let characters = state
        .login
        .as_ref()
        .map(|login| login.characters.as_slice())
        .unwrap_or(&[]);

    let selected_name = characters
        .get(state.selected_character)
        .map(|character| character.name.as_str())
        .unwrap_or("None");

    for mut text in &mut text_queries.p1() {
        text.0 = format!(
            "{} character{} available  |  Selected: {}\n{}",
            characters.len(),
            if characters.len() == 1 { "" } else { "s" },
            selected_name,
            state.status,
        );
    }

    for mut border in &mut character_name_frame {
        *border = BorderColor::all(if state.character_name_active {
            theme::GOLD_BRIGHT
        } else {
            theme::BUTTON_BORDER
        });
    }

    for (mut text, mut color) in &mut text_queries.p2() {
        text.0 = if state.character_name.is_empty() {
            "New character name".into()
        } else {
            format!(
                "{}{}",
                state.character_name,
                if state.character_name_active { "_" } else { "" }
            )
        };
        color.0 = if state.character_name.is_empty() {
            theme::MUTED
        } else {
            theme::TEXT
        };
    }

    for (card, mut visibility, mut background, mut border) in &mut cards {
        let Some(_) = characters.get(card.0) else {
            *visibility = Visibility::Hidden;
            continue;
        };

        *visibility = Visibility::Visible;

        let selected = card.0 == state.selected_character;

        background.0 = if selected {
            theme::BUTTON_HOVER
        } else {
            theme::BUTTON_BG
        };

        *border = BorderColor::all(if selected {
            theme::GOLD_BRIGHT
        } else {
            theme::BUTTON_BORDER
        });
    }

    for (slot, mut text, mut color) in &mut text_queries.p0() {
        let Some(character) = characters.get(slot.0) else {
            text.0.clear();
            continue;
        };

        let selected = slot.0 == state.selected_character;

        text.0 = format!(
            "{}\nLevel {}  |  Position {}:{}:{}{}",
            character.name,
            character.level,
            character.position.x,
            character.position.y,
            character.position.z,
            if selected { "  |  SELECTED" } else { "" },
        );

        color.0 = if selected {
            theme::GOLD_BRIGHT
        } else {
            theme::TEXT
        };
    }
}

fn update_login_form(
    state: Res<NativeLauncherState>,
    mut form: Query<&mut Visibility, With<LauncherLoginForm>>,
    mut legacy_panels: Query<
        &mut Visibility,
        (With<LauncherLegacyPanel>, Without<LauncherLoginForm>),
    >,
    mut fields: Query<(&LauncherFieldFrame, &mut BorderColor)>,
    mut login_text: Query<(&LauncherLoginText, &mut Text, &mut TextColor)>,
) {
    let show_form = matches!(state.mode, LauncherMode::Login | LauncherMode::LoggingIn);

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
        let active = state.mode == LauncherMode::Login && frame.0 == state.field;

        *border = BorderColor::all(if active {
            theme::GOLD_BRIGHT
        } else {
            theme::BUTTON_BORDER
        });
    }

    let password = "*".repeat(state.password.chars().count());

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
    mut buttons: Query<(&LauncherAction, &mut Visibility), Without<LauncherModalActionButton>>,
) {
    for (action, mut visibility) in &mut buttons {
        let shown = match state.mode {
            LauncherMode::Login => {
                matches!(
                    action,
                    LauncherAction::FocusAccount
                        | LauncherAction::FocusPassword
                        | LauncherAction::Login
                )
            }
            LauncherMode::Characters => false,
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

fn step_character(state: &mut NativeLauncherState, delta: isize) {
    let count = state
        .login
        .as_ref()
        .map(|login| login.characters.len())
        .unwrap_or(0);

    if count == 0 {
        return;
    }

    state.selected_character =
        (state.selected_character as isize + delta).rem_euclid(count as isize) as usize;
}

fn tick_launch_handoff(time: Res<Time>, mut state: ResMut<NativeLauncherState>) {
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
        state.status = "Account name must contain at least 3 characters.".into();
        return;
    }

    if state.password.is_empty() {
        state.status = "Enter your password.".into();
        return;
    }

    let password = state.password.clone();
    let (tx, rx) = mpsc::channel::<Result<NativeLoginResult, String>>();

    match thread::Builder::new()
        .name("aldoria-launcher-login".into())
        .spawn(move || {
            let result = network::login_and_list_characters(username, password)
                .map_err(|error| format!("{error:#}"));

            let _ = tx.send(result);
        }) {
        Ok(_) => {
            state.pending_login = Some(Arc::new(Mutex::new(rx)));
            state.mode = LauncherMode::LoggingIn;
            state.status = "Authenticating and loading characters...".into();
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status = format!("Could not start login worker: {error}");
        }
    }
}

fn poll_login_worker(mut state: ResMut<NativeLauncherState>) {
    if state.mode != LauncherMode::LoggingIn {
        return;
    }

    let Some(receiver) = state.pending_login.as_ref().cloned() else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.mode = LauncherMode::Error;
            state.status = "Login worker lock failed.".into();
            return;
        };

        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.mode = LauncherMode::Error;
                state.status = "Login worker stopped unexpectedly.".into();
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
            let empty = login.characters.is_empty();
            state.login = Some(login);
            state.selected_character = 0;
            state.mode = LauncherMode::Characters;
            state.character_name_active = empty;
            state.status = if empty {
                "No characters yet. Enter a name to create one.".into()
            } else {
                "Choose a character and press Enter.".into()
            };
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status = error;
        }
    }
}

fn begin_create_character(state: &mut NativeLauncherState) {
    if state.pending_character_create.is_some() {
        return;
    }

    let name = state.character_name.trim().to_owned();
    if !(2..=20).contains(&name.chars().count())
        || !name
            .chars()
            .all(|character| character.is_alphabetic() || character == ' ')
    {
        state.status = "Character names must contain 2-20 letters.".into();
        return;
    }

    let Some(login) = state.login.as_ref() else {
        state.status = "The authenticated account is unavailable.".into();
        return;
    };
    if login.characters.len() >= 4 {
        state.status = "This account already has four characters.".into();
        return;
    }

    let api_url = login.api_url.clone();
    let session_token = login.session_token.clone();
    let (tx, rx) = mpsc::channel::<Result<game_protocol::CharacterSummary, String>>();

    match thread::Builder::new()
        .name("aldoria-create-character".into())
        .spawn(move || {
            let result = network::create_character(api_url, session_token, name)
                .map_err(|error| format!("{error:#}"));
            let _ = tx.send(result);
        }) {
        Ok(_) => {
            state.pending_character_create = Some(Arc::new(Mutex::new(rx)));
            state.character_name_active = false;
            state.status = "Creating character...".into();
        }
        Err(error) => {
            state.status = format!("Could not start character creation: {error}");
        }
    }
}

fn poll_character_create_worker(mut state: ResMut<NativeLauncherState>) {
    let Some(receiver) = state.pending_character_create.as_ref().cloned() else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.pending_character_create = None;
            state.status = "Character creation worker lock failed.".into();
            return;
        };
        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.pending_character_create = None;
                state.status = "Character creation stopped unexpectedly.".into();
                return;
            }
        }
    };

    let Some(result) = result else {
        return;
    };
    state.pending_character_create = None;

    match result {
        Ok(character) => {
            let created_name = character.name.clone();
            if let Some(login) = state.login.as_mut() {
                login.characters.push(character);
                state.selected_character = login.characters.len().saturating_sub(1);
            }
            state.character_name.clear();
            state.character_name_active = false;
            state.status = format!("{created_name} created and selected.");
        }
        Err(error) => {
            state.character_name_active = true;
            state.status = error;
        }
    }
}

fn poll_game_session_worker(mut commands: Commands, mut state: ResMut<NativeLauncherState>) {
    if state.mode != LauncherMode::Launching {
        return;
    }

    let Some(receiver) = state.pending_game_session.as_ref().cloned() else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.pending_game_session = None;
            state.mode = LauncherMode::Error;
            state.status = "Enter-world worker lock failed.".into();
            return;
        };

        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.pending_game_session = None;
                state.mode = LauncherMode::Error;
                state.status = "Enter-world worker stopped unexpectedly.".into();
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
            state.status = "World session ready. Loading world...".into();

            crate::install_single_window_session(&mut commands, session);
        }
        Err(error) => {
            state.mode = LauncherMode::Error;
            state.status = error;
        }
    }
}

fn launch_selected_character(state: &mut NativeLauncherState) -> Result<()> {
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

    let (tx, rx) = mpsc::channel::<Result<network::NativeSession, String>>();

    thread::Builder::new()
        .name("aldoria-enter-world".into())
        .spawn(move || {
            let result = network::connect_selected_character(ws_url, session_token, character_id)
                .map_err(|error| format!("{error:#}"));

            let _ = tx.send(result);
        })
        .context("could not start enter-world network worker")?;

    state.pending_game_session = Some(Arc::new(Mutex::new(rx)));
    state.launch_exit_timer = None;
    state.mode = LauncherMode::Launching;
    state.status = format!("Connecting to the realm as {character_name}...");

    Ok(())
}

fn enforce_gameplay_launcher_ui_hidden(
    state: Res<NativeLauncherState>,
    mut transient_roots: Query<
        &mut Visibility,
        Or<(
            With<LauncherLegacyPanel>,
            With<LauncherLoginForm>,
            With<LauncherCharacterLobby>,
            With<LauncherCharacterCard>,
        )>,
    >,
) {
    if !matches!(
        state.mode,
        LauncherMode::Launching | LauncherMode::GameLoading
    ) {
        return;
    }

    for mut visibility in &mut transient_roots {
        *visibility = Visibility::Hidden;
    }
}

fn update_screen(state: Res<NativeLauncherState>, mut text: Query<&mut Text, With<LauncherText>>) {
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
    let account_marker = if state.field == LoginField::Account {
        ">"
    } else {
        " "
    };

    let password_marker = if state.field == LoginField::Password {
        ">"
    } else {
        " "
    };

    let masked = "*".repeat(state.password.chars().count());

    [
        "EMBERS OF ALDORIA".to_owned(),
        "A world shaped by its people".to_owned(),
        String::new(),
        "ACCOUNT LOGIN".to_owned(),
        String::new(),
        format!("{account_marker} Account   {}", state.username,),
        format!("{password_marker} Password  {masked}",),
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

fn render_characters(state: &NativeLauncherState) -> String {
    let Some(login) = state.login.as_ref() else {
        return "Character list unavailable.".into();
    };

    let mut lines = vec![
        "EMBERS OF ALDORIA".into(),
        "CHARACTER LOBBY".into(),
        String::new(),
    ];

    for (index, character) in login.characters.iter().enumerate() {
        let marker = if index == state.selected_character {
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
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    time: Res<Time>,
    state: Res<NativeLauncherState>,
    loading: Option<Res<crate::native_loading::NativeLoadingState>>,
    mut overlay: Query<&mut Visibility, With<LauncherWorldLoadingOverlay>>,
    mut status: Query<&mut Text, With<LauncherWorldLoadingStatus>>,
    mut progress: Query<&mut Node, With<LauncherWorldLoadingProgress>>,
    mut last_show: Local<Option<bool>>,
    mut ready_grace_seconds: Local<f32>,
) {
    const POST_READY_GRACE_SECONDS: f32 = 2.0;

    let loading_active = loading
        .as_ref()
        .map(|loading| loading.active())
        .unwrap_or(false);

    let connecting = state.mode == LauncherMode::Launching;

    let game_loading = state.mode == LauncherMode::GameLoading;

    let authoritative_loading = if game_loading {
        loading
            .as_ref()
            .map(|loading| loading.active())
            .unwrap_or(true)
    } else {
        false
    };

    if connecting || authoritative_loading {
        *ready_grace_seconds = 0.0;
    } else if game_loading && loading.is_some() {
        *ready_grace_seconds += time.delta().as_secs_f32();
    } else {
        *ready_grace_seconds = 0.0;
    }

    let post_ready_grace = game_loading
        && loading.is_some()
        && !loading_active
        && *ready_grace_seconds < POST_READY_GRACE_SECONDS;

    let show = connecting || authoritative_loading || post_ready_grace;

    let overlay_count = overlay.iter_mut().count();

    if show && overlay_count == 0 {
        warn!("ALDORIA LOADING COVER · missing root while active; respawning");

        spawn_launcher_world_loading_overlay(&mut commands, &asset_server);
    }

    for mut visibility in &mut overlay {
        *visibility = if show {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }

    if *last_show != Some(show) {
        info!(
            "ALDORIA LOADING COVER · show={} · mode={:?} · native_loading={} · post_ready={:.2}/{:.2}s · roots={}",
            show,
            state.mode,
            loading_active,
            *ready_grace_seconds,
            POST_READY_GRACE_SECONDS,
            overlay_count,
        );

        *last_show = Some(show);
    }

    if !show {
        return;
    }

    let (label, width) = if connecting {
        (state.status.clone(), 18.0)
    } else if authoritative_loading {
        if let Some(loading) = loading.as_ref() {
            (loading.stage_label().to_owned(), loading.progress_percent())
        } else {
            ("Preparing world session...".to_owned(), 24.0)
        }
    } else {
        ("Presenting world...".to_owned(), 100.0)
    };

    for mut text in &mut status {
        text.0 = label.clone();
    }

    for mut node in &mut progress {
        node.width = Val::Percent(width);
    }
}

pub(crate) fn sync_single_window_shell(
    launcher: Option<Res<NativeLauncherState>>,
    loading: Option<Res<crate::native_loading::NativeLoadingState>>,
    mut backdrop: Query<&mut Visibility, With<LauncherBackdrop>>,
    mut tint: Query<&mut Visibility, (With<LauncherBackdropTint>, Without<LauncherBackdrop>)>,
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
                || (state.mode == LauncherMode::GameLoading && loading_active)
        })
        .unwrap_or(false);

    let shell_visibility = if launcher_loading || loading_active {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    if let Ok(mut visibility) = backdrop.single_mut() {
        *visibility = shell_visibility;
    }

    if let Ok(mut visibility) = tint.single_mut() {
        *visibility = shell_visibility;
    }

    if let Ok(mut visibility) = updater.single_mut() {
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

    let shift = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);

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

        target.push(if shift {
            value.to_ascii_uppercase()
        } else {
            value
        });

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
        target.push(if shift && !account_field { '_' } else { '-' });
    }

    if keys.just_pressed(KeyCode::Period) && !account_field {
        target.push('.');
    }

    if keys.just_pressed(KeyCode::Equal) && !account_field {
        target.push(if shift { '+' } else { '=' });
    }

    if keys.just_pressed(KeyCode::Slash) && !account_field {
        target.push('/');
    }

    target.truncate(max_len);
    target
}
