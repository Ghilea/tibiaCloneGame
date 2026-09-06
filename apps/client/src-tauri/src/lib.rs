// TIBIAGAME_FRIEND_UPDATER_V33
// TIBIAGAME_V34_FIXSET_1
#[cfg(feature = "friend-updater")]
use serde_json::{Value, json};
#[cfg(feature = "friend-updater")]
use tauri::Manager;
#[cfg(feature = "friend-updater")]
use tauri_plugin_updater::UpdaterExt;

#[cfg(feature = "friend-updater")]
fn emit_updater_status(handle: &tauri::AppHandle, payload: Value) {
    let Some(window) = handle.get_webview_window("main") else {
        return;
    };

    let payload = payload.to_string();
    let script = format!(
        "window.__ALDORIA_UPDATER_STATUS__={payload};\
         window.dispatchEvent(new CustomEvent('aldoria-updater-status',{{detail:{payload}}}));"
    );
    let _ = window.eval(&script);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "friend-updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                emit_updater_status(&handle, json!({ "phase": "checking" }));

                let updater = match handle.updater() {
                    Ok(updater) => updater,
                    Err(error) => {
                        emit_updater_status(&handle, json!({
                            "phase": "error",
                            "message": format!("Updater setup failed: {error}")
                        }));
                        return;
                    }
                };

                match updater.check().await {
                    Ok(Some(update)) => {
                        let current_version = update.current_version.to_string();
                        let version = update.version.to_string();

                        emit_updater_status(&handle, json!({
                            "phase": "available",
                            "currentVersion": current_version,
                            "version": version
                        }));

                        let progress_handle = handle.clone();
                        let install_handle = handle.clone();
                        let mut downloaded = 0_u64;

                        match update
                            .download_and_install(
                                move |chunk_length, content_length| {
                                    downloaded = downloaded.saturating_add(chunk_length as u64);
                                    let total = content_length.unwrap_or(0);
                                    let progress = if total > 0 {
                                        (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
                                    } else {
                                        0.0
                                    };

                                    emit_updater_status(&progress_handle, json!({
                                        "phase": "downloading",
                                        "downloaded": downloaded,
                                        "total": total,
                                        "progress": progress
                                    }));
                                },
                                move || {
                                    emit_updater_status(&install_handle, json!({
                                        "phase": "installing"
                                    }));
                                },
                            )
                            .await
                        {
                            Ok(()) => {
                                emit_updater_status(&handle, json!({
                                    "phase": "restarting"
                                }));
                                handle.restart();
                            }
                            Err(error) => {
                                emit_updater_status(&handle, json!({
                                    "phase": "error",
                                    "message": format!("Update install failed: {error}")
                                }));
                            }
                        }
                    }
                    Ok(None) => {
                        emit_updater_status(&handle, json!({
                            "phase": "up_to_date"
                        }));
                    }
                    Err(error) => {
                        emit_updater_status(&handle, json!({
                            "phase": "error",
                            "message": format!("Update check failed: {error}")
                        }));
                    }
                }
            });

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running the desktop client");
}
