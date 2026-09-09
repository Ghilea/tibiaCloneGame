// TIBIAGAME_V36_30_NATIVE_LOGIN_CHARACTER_LOBBY
use std::{
    process::Command,
    sync::{
        Arc,
        Mutex,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
};

use anyhow::{Context, Result, bail};
use bevy::{
    prelude::*,
    window::WindowResolution,
};

use crate::network::{
    self,
    NativeLoginResult,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LauncherMode {
    Login,
    LoggingIn,
    Characters,
    Launching,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoginField {
    Account,
    Password,
}

type PendingLogin =
    Arc<Mutex<Receiver<Result<NativeLoginResult, String>>>>;

#[derive(Resource)]
struct NativeLauncherState {
    mode: LauncherMode,
    field: LoginField,
    username: String,
    password: String,
    selected_character: usize,
    login: Option<NativeLoginResult>,
    pending_login: Option<PendingLogin>,
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
            status: "Enter your account credentials.".into(),
        }
    }
}

#[derive(Component)]
struct LauncherText;

pub fn run() -> Result<()> {
    App::new()
        .insert_resource(ClearColor(
            Color::srgb(0.018, 0.028, 0.023),
        ))
        .init_resource::<NativeLauncherState>()
        .init_resource::<crate::native_updater::NativeUpdaterState>()
        .add_plugins(
            DefaultPlugins.set(WindowPlugin {
                primary_window: Some(Window {
                    title:
                        "Embers of Aldoria — Native Launcher V36.30"
                            .into(),
                    resolution:
                        WindowResolution::new(960, 660),
                    resizable: false,
                    ..default()
                }),
                ..default()
            }),
        )
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
                handle_keyboard.after(poll_login_worker),
                update_screen.after(handle_keyboard),
            ),
        )
        .run();

    Ok(())
}

fn setup(mut commands: Commands) {
    // Bevy UI needs an active camera target. Without this the launcher window
    // opens, but the login/lobby UI tree is never rendered.
    commands.spawn((
        Name::new("Native launcher UI camera"),
        Camera2d,
    ));

    commands
        .spawn(Node {
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            align_items: AlignItems::Center,
            justify_content: JustifyContent::Center,
            ..default()
        })
        .with_children(|root| {
            root.spawn((
                Node {
                    width: px(650),
                    min_height: px(500),
                    padding: UiRect::all(px(26)),
                    flex_direction: FlexDirection::Column,
                    ..default()
                },
                BackgroundColor(
                    Color::srgba(
                        0.035,
                        0.050,
                        0.042,
                        0.98,
                    ),
                ),
            ))
            .with_child((
                LauncherText,
                Text::new(""),
                TextFont {
                    font_size: FontSize::Px(18.0),
                    ..default()
                },
                TextColor(
                    Color::srgb(0.88, 0.90, 0.84),
                ),
            ));
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

            if keys.just_pressed(KeyCode::Backspace) {
                match state.field {
                    LoginField::Account => {
                        state.username.pop();
                    }
                    LoginField::Password => {
                        state.password.pop();
                    }
                }
            }

            match state.field {
                LoginField::Account => {
                    let current = state.username.clone();
                    state.username = append_text_input(
                        &keys,
                        current,
                        24,
                        true,
                    );
                }
                LoginField::Password => {
                    let current = state.password.clone();
                    state.password = append_text_input(
                        &keys,
                        current,
                        128,
                        false,
                    );
                }
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
                state.selected_character =
                    (state.selected_character + 1) % count;
            }

            if keys.just_pressed(KeyCode::ArrowUp) {
                state.selected_character =
                    if state.selected_character == 0 {
                        count - 1
                    } else {
                        state.selected_character - 1
                    };
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
        LauncherMode::Launching => {}
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

fn begin_login(state: &mut NativeLauncherState) {
    let username = state.username.trim().to_owned();

    if username.len() < 3 {
        state.status =
            "Account name must contain at least 3 characters."
                .into();
        return;
    }

    if state.password.len() < 10 {
        state.status =
            "Password must contain at least 10 characters."
                .into();
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
                "Authenticating and loading characters…"
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

    let executable = std::env::current_exe()
        .context("could not locate native game executable")?;

    let child = Command::new(executable)
        .env("ALDORIA_NATIVE_GAME_SESSION", "1")
        .env(
            "ALDORIA_SESSION_TOKEN",
            &login.session_token,
        )
        .env(
            "ALDORIA_CHARACTER_ID",
            character.id.to_string(),
        )
        .env("ALDORIA_API_URL", &login.api_url)
        .env("ALDORIA_WS_URL", &login.ws_url)
        .spawn()
        .context("could not start native game process")?;

    if child.id() == 0 {
        bail!("native game process did not start");
    }

    state.mode = LauncherMode::Launching;
    state.status =
        format!("Entering the world as {}…", character.name);

    // A fresh process gives winit exactly one EventLoop per process.
    // The password is never forwarded to the gameplay process.
    std::process::exit(0);
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
            "Signing in…".to_owned(),
            String::new(),
            state.status.clone(),
        ]
        .join("\n"),
        LauncherMode::Characters => render_characters(&state),
        LauncherMode::Launching => [
            "EMBERS OF ALDORIA".to_owned(),
            String::new(),
            state.status.clone(),
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
            "▶"
        } else {
            " "
        };

    let password_marker =
        if state.field == LoginField::Password {
            "▶"
        } else {
            " "
        };

    let masked =
        "•".repeat(state.password.chars().count());

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
        "Development realm · Native V36.30"
            .to_owned(),
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
                "▶"
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
