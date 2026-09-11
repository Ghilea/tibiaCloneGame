// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE
// TIBIAGAME_V36_63_0_CONNECTION_ERRORS_COPPER_VEINS
pub const MIGRATION_VERSION: &str = "36.63.0";

#[allow(dead_code)]
pub fn client_version() -> String {
    format!(
        "{}-native-v{}",
        env!("CARGO_PKG_VERSION"),
        MIGRATION_VERSION,
    )
}

pub fn window_title() -> String {
    format!(
        "Embers of Aldoria — Native V{} Live World",
        MIGRATION_VERSION,
    )
}

pub fn native_release_version() -> &'static str {
    option_env!("ALDORIA_NATIVE_RELEASE_VERSION").unwrap_or("dev")
}
