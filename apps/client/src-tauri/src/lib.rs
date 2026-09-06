// TIBIAGAME_FRIEND_UPDATER_V33
#[cfg(feature = "friend-updater")]
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "friend-updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let updater = match handle.updater() {
                    Ok(updater) => updater,
                    Err(error) => {
                        eprintln!("Aldoria updater setup failed: {error}");
                        return;
                    }
                };

                match updater.check().await {
                    Ok(Some(update)) => {
                        eprintln!(
                            "Aldoria client update available: {} -> {}",
                            update.current_version,
                            update.version
                        );

                        match update
                            .download_and_install(
                                |_chunk_length, _content_length| {},
                                || {
                                    eprintln!("Aldoria client update downloaded");
                                },
                            )
                            .await
                        {
                            Ok(()) => {
                                eprintln!("Aldoria client update installed; restarting");
                                handle.restart();
                            }
                            Err(error) => {
                                eprintln!("Aldoria client update install failed: {error}");
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        eprintln!("Aldoria updater check failed: {error}");
                    }
                }
            });

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running the desktop client");
}

