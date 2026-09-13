// TIBIAGAME_V36_32_SIGNED_NATIVE_SELF_UPDATER
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
};

use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use bevy::prelude::*;
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;

use crate::version;

const NATIVE_MANIFEST_URL: &str =
    "https://github.com/Ghilea/tibiaCloneGame/releases/latest/download/native-latest.json";

// Decoded public-key payload from the committed updater.pub.
// This is a public verification key, never the signing secret.
const NATIVE_UPDATER_PUBLIC_KEY: &str = "RWR9sTpJG6Ijpt/I51dB+4MaHhjPlZP10zdfMdV+uIBTN0b1xSPEe+ng";

const ALLOWED_RELEASE_PREFIX: &str = "https://github.com/Ghilea/tibiaCloneGame/releases/download/";

#[derive(Debug, Clone, Deserialize)]
struct NativeUpdateManifest {
    version: String,
    platform: String,
    url: String,
    signature: String,
    executable: String,
    tag: String,
}

#[derive(Debug)]
enum UpdateWorkerResult {
    DevelopmentBuild,
    UpToDate {
        version: String,
    },
    Ready {
        version: String,
        staged_bundle: PathBuf,
    },
}

type PendingUpdate = Arc<Mutex<Receiver<Result<UpdateWorkerResult, String>>>>;

#[derive(Resource, Default)]
pub(crate) struct NativeUpdaterState {
    pending: Option<PendingUpdate>,
    status: String,
    completed: bool,
    hard_block: bool,
}

impl NativeUpdaterState {
    pub(crate) fn blocks_online_play(&self) -> bool {
        !self.completed || self.hard_block
    }

    pub(crate) fn gate_message(&self) -> &'static str {
        if self.hard_block {
            "A verified client update must be installed before login."
        } else {
            "Waiting for the signed client update check to finish…"
        }
    }
}

#[derive(Component)]
pub(crate) struct NativeUpdaterText;

pub(crate) fn setup(mut commands: Commands, mut state: ResMut<NativeUpdaterState>) {
    state.status = "Checking for signed updates…".into();

    commands.spawn((
        Name::new("Native updater status"),
        NativeUpdaterText,
        Text::new(state.status.clone()),
        TextFont {
            font_size: FontSize::Px(11.0),
            ..default()
        },
        TextColor(Color::srgb(0.58, 0.66, 0.60)),
        Node {
            position_type: PositionType::Absolute,
            left: px(16),
            bottom: px(12),
            ..default()
        },
    ));

    let (tx, rx) = mpsc::channel::<Result<UpdateWorkerResult, String>>();

    match thread::Builder::new()
        .name("aldoria-native-updater".into())
        .spawn(move || {
            let result = check_download_and_stage().map_err(|error| format!("{error:#}"));

            let _ = tx.send(result);
        }) {
        Ok(_) => {
            state.pending = Some(Arc::new(Mutex::new(rx)));
        }
        Err(error) => {
            state.status = format!("Update check unavailable: {error}");
            state.completed = true;
        }
    }
}

pub(crate) fn poll(
    mut state: ResMut<NativeUpdaterState>,
    mut text: Query<&mut Text, With<NativeUpdaterText>>,
) {
    if !state.completed {
        poll_worker(&mut state);
    }

    if let Ok(mut text) = text.single_mut() {
        text.0 = state.status.clone();
    }
}

fn poll_worker(state: &mut NativeUpdaterState) {
    let Some(receiver) = state.pending.as_ref().cloned() else {
        return;
    };

    let result = {
        let Ok(receiver) = receiver.lock() else {
            state.status = "Update check failed: worker lock poisoned.".into();
            state.completed = true;
            state.pending = None;
            return;
        };

        match receiver.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                state.status = "Update check failed: worker stopped.".into();
                state.completed = true;
                state.pending = None;
                return;
            }
        }
    };

    let Some(result) = result else {
        return;
    };

    state.pending = None;
    state.completed = true;

    match result {
        Ok(UpdateWorkerResult::DevelopmentBuild) => {
            state.status = "Development build · automatic updates disabled.".into();
        }
        Ok(UpdateWorkerResult::UpToDate { version }) => {
            state.status = format!("Native client v{version} · up to date");
        }
        Ok(UpdateWorkerResult::Ready {
            version,
            staged_bundle,
        }) => {
            // Once a newer executable has been downloaded and verified, do not
            // allow the old client to enter the world if replacement fails.
            state.hard_block = true;
            state.status = format!("Installing signed update v{version}…");

            match schedule_replace_and_restart(&staged_bundle) {
                Ok(()) => {
                    // Windows updater helper is now waiting for this process
                    // to exit before replacing the executable.
                    std::process::exit(0);
                }
                Err(error) => {
                    state.status =
                        format!("Update v{version} verified but could not install: {error:#}");
                }
            }
        }
        Err(error) => {
            state.status = format!("Update check failed: {error}");
        }
    }
}

fn check_download_and_stage() -> Result<UpdateWorkerResult> {
    let current = version::native_release_version();

    if current == "dev" {
        return Ok(UpdateWorkerResult::DevelopmentBuild);
    }

    let current_version = parse_semver(current)
        .with_context(|| format!("native release version '{current}' is invalid"))?;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create native updater runtime")?;

    runtime.block_on(async move {
        let client = reqwest::Client::builder()
            .user_agent("Embers-of-Aldoria-Native-Updater/36.32")
            .build()
            .context("failed to create native updater HTTP client")?;

        let manifest_response = client
            .get(NATIVE_MANIFEST_URL)
            .send()
            .await
            .context("could not reach native update manifest")?
            .error_for_status()
            .context("native update manifest returned an error")?;

        let manifest = manifest_response
            .json::<NativeUpdateManifest>()
            .await
            .context("native update manifest is invalid")?;

        validate_manifest(&manifest)?;

        let available = parse_semver(&manifest.version)
            .with_context(|| format!("update version '{}' is invalid", manifest.version,))?;

        if available <= current_version {
            return Ok(UpdateWorkerResult::UpToDate {
                version: current.to_owned(),
            });
        }

        let payload = client
            .get(&manifest.url)
            .send()
            .await
            .context("could not download native update")?
            .error_for_status()
            .context("native update download returned an error")?
            .bytes()
            .await
            .context("could not read native update payload")?;

        verify_payload(&payload, &manifest.signature)?;

        let staged = stage_verified_bundle(&manifest.version, &payload)?;

        Ok(UpdateWorkerResult::Ready {
            version: manifest.version,
            staged_bundle: staged,
        })
    })
}

fn validate_manifest(manifest: &NativeUpdateManifest) -> Result<()> {
    if manifest.platform != "windows-x86_64" {
        bail!("unsupported native update platform '{}'", manifest.platform,);
    }

    if manifest.executable != "EmbersOfAldoria.exe" {
        bail!("unexpected native executable '{}'", manifest.executable,);
    }

    if !manifest.url.starts_with(ALLOWED_RELEASE_PREFIX) {
        bail!("native update URL is outside the trusted GitHub release origin",);
    }

    let expected_tag = format!("client-v{}", manifest.version);

    if manifest.tag != expected_tag {
        bail!(
            "native update tag '{}' does not match version '{}'",
            manifest.tag,
            manifest.version,
        );
    }

    if !manifest.url.contains(&format!(
        "/{}/Embers-of-Aldoria-Native-windows-x86_64.zip",
        manifest.tag,
    )) {
        bail!("native update URL does not match the signed release tag",);
    }

    Ok(())
}

fn verify_payload(payload: &[u8], signature_text: &str) -> Result<()> {
    let public_key = PublicKey::from_base64(NATIVE_UPDATER_PUBLIC_KEY)
        .map_err(|error| anyhow!("embedded updater public key is invalid: {error:?}"))?;

    let decoded_signature = decode_signature_envelope(signature_text)?;
    let signature = Signature::decode(&decoded_signature)
        .map_err(|error| anyhow!("native updater signature is invalid: {error:?}"))?;

    public_key
        .verify(payload, &signature, false)
        .map_err(|error| anyhow!("native updater signature verification failed: {error:?}"))?;

    Ok(())
}

fn decode_signature_envelope(signature_text: &str) -> Result<String> {
    let signature_text = signature_text.trim();

    // Tauri's updater signer stores the complete four-line Minisign document
    // inside a Base64 envelope. Accept a plain Minisign document as well so a
    // future publishing-tool change does not strand existing installations.
    if signature_text.starts_with("untrusted comment:") {
        return Ok(signature_text.to_owned());
    }

    let decoded = BASE64_STANDARD
        .decode(signature_text)
        .context("native updater signature envelope is not valid base64")?;
    String::from_utf8(decoded).context("native updater signature envelope is not UTF-8")
}

fn stage_verified_bundle(version: &str, payload: &[u8]) -> Result<PathBuf> {
    if payload.len() < 1024 * 1024 {
        bail!("native update payload is unexpectedly small",);
    }

    let directory = update_directory();

    fs::create_dir_all(&directory)
        .with_context(|| format!("could not create updater directory {}", directory.display(),))?;

    let destination = directory.join(format!("Embers-of-Aldoria-{version}.zip",));

    fs::write(&destination, payload).with_context(|| {
        format!(
            "could not stage verified updater payload {}",
            destination.display(),
        )
    })?;

    Ok(destination)
}

fn update_directory() -> PathBuf {
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data)
            .join("Embers of Aldoria")
            .join("updates");
    }

    std::env::temp_dir()
        .join("Embers of Aldoria")
        .join("updates")
}

#[cfg(target_os = "windows")]
fn schedule_replace_and_restart(staged_bundle: &Path) -> Result<()> {
    let current = std::env::current_exe().context("could not locate running native executable")?;

    let pid = std::process::id();

    let staged = powershell_literal(staged_bundle);
    let destination = powershell_literal(&current);
    let install_directory = current
        .parent()
        .context("native executable has no install directory")?;
    let install_directory = powershell_literal(install_directory);

    let script = format!(
        concat!(
            "$ErrorActionPreference='Stop'; ",
            "Wait-Process -Id {pid}; ",
            "Start-Sleep -Milliseconds 350; ",
            "$extract='{staged}.contents'; ",
            "Expand-Archive -LiteralPath '{staged}' -DestinationPath $extract -Force; ",
            "$sourceExe=Join-Path $extract 'EmbersOfAldoria.exe'; ",
            "$sourceAssets=Join-Path $extract 'assets'; ",
            "if (!(Test-Path -LiteralPath $sourceExe)) {{ throw 'Update bundle has no executable.' }}; ",
            "if (!(Test-Path -LiteralPath $sourceAssets)) {{ throw 'Update bundle has no assets.' }}; ",
            "Copy-Item -LiteralPath $sourceExe -Destination '{destination}' -Force; ",
            "$assetsDestination=Join-Path '{install_directory}' 'assets'; ",
            "New-Item -ItemType Directory -Path $assetsDestination -Force | Out-Null; ",
            "Copy-Item -Path (Join-Path $sourceAssets '*') -Destination $assetsDestination -Recurse -Force; ",
            "Start-Process -FilePath '{destination}'; ",
            "Remove-Item -LiteralPath '{staged}' -Force -ErrorAction SilentlyContinue; ",
            "Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue;"
        ),
        pid = pid,
        staged = staged,
        destination = destination,
        install_directory = install_directory,
    );

    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .spawn()
        .context("could not start native updater replacement helper")?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn schedule_replace_and_restart(_staged_bundle: &Path) -> Result<()> {
    bail!("automatic native replacement is only implemented on Windows",)
}

fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('\'', "''")
}

fn parse_semver(value: &str) -> Result<[u64; 3]> {
    let mut parts = value.split('.');

    let major = parts
        .next()
        .context("missing major version")?
        .parse::<u64>()
        .context("invalid major version")?;

    let minor = parts
        .next()
        .context("missing minor version")?
        .parse::<u64>()
        .context("invalid minor version")?;

    let patch = parts
        .next()
        .context("missing patch version")?
        .parse::<u64>()
        .context("invalid patch version")?;

    if parts.next().is_some() {
        bail!("version contains too many components");
    }

    Ok([major, minor, patch])
}

#[cfg(test)]
mod tests {
    use super::{
        NativeUpdateManifest, decode_signature_envelope, parse_semver, validate_manifest,
        verify_payload,
    };

    const TAURI_SIGNATURE_ENVELOPE: &str = concat!(
        "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
        "UlVSOXNUcEpHNklqcHJLSHhnZkdzb0pSYmxPU0Zua3JWVnNOOVRCdVlXbCtNN2pxakNG",
        "d2s4Q0lNWWhoMGhTNHpLdWtBaDViZkZoMTdidUh5d2NKeU5PcmlvVUlKN2VzYXdZPQp0",
        "cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5Mjc5NjYyCWZpbGU6RW1iZXJzLW9m",
        "LUFsZG9yaWEtTmF0aXZlLXdpbmRvd3MteDg2XzY0LnppcApJNlRXUEtqUU5ydnZTWXZB",
        "UzRHcGRtWnpzWm11UmdUK1V5a2dyU05va3o2a1lLOWZPaHF2TnBWS1dZdzBmcCt5UWxS",
        "b21HREM3b084WDI0aEdESU5Ddz09Cg==",
    );

    #[test]
    fn compares_release_versions() {
        assert!(parse_semver("0.1.10").unwrap() > parse_semver("0.1.9").unwrap());
    }

    #[test]
    fn decodes_tauri_wrapped_minisign_document() {
        let decoded = decode_signature_envelope(TAURI_SIGNATURE_ENVELOPE).unwrap();

        assert!(decoded.starts_with("untrusted comment: signature from tauri secret key\n"));
        assert!(decoded.contains("trusted comment: timestamp:"));
        minisign_verify::Signature::decode(&decoded).unwrap();
    }

    #[test]
    fn published_signature_reaches_cryptographic_verification() {
        let error = verify_payload(b"deliberately not the published bundle", TAURI_SIGNATURE_ENVELOPE)
            .unwrap_err()
            .to_string();

        assert!(error.contains("signature verification failed"));
        assert!(!error.contains("signature is invalid"));
    }

    #[test]
    fn accepts_versioned_native_bundle_url() {
        let manifest = NativeUpdateManifest {
            version: "0.1.10".into(),
            platform: "windows-x86_64".into(),
            url: "https://github.com/Ghilea/tibiaCloneGame/releases/download/client-v0.1.10/Embers-of-Aldoria-Native-windows-x86_64.zip".into(),
            signature: "test".into(),
            executable: "EmbersOfAldoria.exe".into(),
            tag: "client-v0.1.10".into(),
        };

        validate_manifest(&manifest).unwrap();
    }

    #[test]
    fn rejects_executable_only_update_url() {
        let manifest = NativeUpdateManifest {
            version: "0.1.10".into(),
            platform: "windows-x86_64".into(),
            url: "https://github.com/Ghilea/tibiaCloneGame/releases/download/client-v0.1.10/EmbersOfAldoria.exe".into(),
            signature: "test".into(),
            executable: "EmbersOfAldoria.exe".into(),
            tag: "client-v0.1.10".into(),
        };

        assert!(validate_manifest(&manifest).is_err());
    }
}
