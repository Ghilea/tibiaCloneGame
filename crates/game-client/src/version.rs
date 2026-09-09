// TIBIAGAME_V36_10_NATIVE_GAMEPLAY_CORE
pub const MIGRATION_VERSION: &str = "36.28.3";

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
