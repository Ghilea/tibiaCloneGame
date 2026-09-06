param(
    [string]$KeyPath = (Join-Path $HOME ".tauri\aldoria-updater.key")
)

$ErrorActionPreference = "Stop"

function Fail-And-Restore {
    param(
        [string]$Message,
        [string]$BackupDir,
        [string]$RepoPublicKey,
        [string]$RepoPublicKeyBackup
    )

    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    Write-Host "Restoring previous updater key material..." -ForegroundColor Yellow

    try {
        if (Test-Path $KeyPath) {
            Remove-Item $KeyPath -Force
        }
        if (Test-Path "$KeyPath.pub") {
            Remove-Item "$KeyPath.pub" -Force
        }

        $oldPrivate = Join-Path $BackupDir "aldoria-updater.key"
        $oldPublic = Join-Path $BackupDir "aldoria-updater.key.pub"

        if (Test-Path $oldPrivate) {
            Copy-Item $oldPrivate $KeyPath -Force
        }
        if (Test-Path $oldPublic) {
            Copy-Item $oldPublic "$KeyPath.pub" -Force
        }

        if (Test-Path $RepoPublicKeyBackup) {
            Copy-Item $RepoPublicKeyBackup $RepoPublicKey -Force
        }
    } catch {
        Write-Warning "Automatic restore encountered an error: $($_.Exception.Message)"
        Write-Warning "Your backup remains at: $BackupDir"
    }

    throw $Message
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = Join-Path $repoRoot "apps\client"
$repoPublicKey = Join-Path $clientDir "src-tauri\updater.pub"

if (-not (Test-Path (Join-Path $clientDir "package.json"))) {
    throw "Run this script from the repository root. Expected: apps\client\package.json"
}

$keyDir = Split-Path -Parent $KeyPath
New-Item -ItemType Directory -Path $keyDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $keyDir ("aldoria-updater-backup-" + $timestamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$repoPublicKeyBackup = Join-Path $backupDir "repo-updater.pub"

Write-Host ""
Write-Host "Aldoria updater key rotation" -ForegroundColor Cyan
Write-Host "============================"
Write-Host ""
Write-Host "This will generate a NEW updater signing key with an empty password."
Write-Host "The old key will be backed up first."
Write-Host ""
Write-Host "Private key:"
Write-Host "  $KeyPath"
Write-Host "Backup:"
Write-Host "  $backupDir"
Write-Host ""

if (Test-Path $KeyPath) {
    Copy-Item $KeyPath (Join-Path $backupDir "aldoria-updater.key") -Force
}
if (Test-Path "$KeyPath.pub") {
    Copy-Item "$KeyPath.pub" (Join-Path $backupDir "aldoria-updater.key.pub") -Force
}
if (Test-Path $repoPublicKey) {
    Copy-Item $repoPublicKey $repoPublicKeyBackup -Force
}

Write-Host "Backups created." -ForegroundColor Green

# Remove current files only after the backup exists.
if (Test-Path $KeyPath) {
    Remove-Item $KeyPath -Force
}
if (Test-Path "$KeyPath.pub") {
    Remove-Item "$KeyPath.pub" -Force
}

Push-Location $clientDir
try {
    Write-Host ""
    Write-Host "Generating new key with the current Tauri CLI..." -ForegroundColor Cyan

    # --ci makes signer generation non-interactive and uses an empty password.
    npm exec -- tauri signer generate --ci -w "$KeyPath"
    if ($LASTEXITCODE -ne 0) {
        Fail-And-Restore `
            -Message "Tauri signer generate failed with exit code $LASTEXITCODE." `
            -BackupDir $backupDir `
            -RepoPublicKey $repoPublicKey `
            -RepoPublicKeyBackup $repoPublicKeyBackup
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $KeyPath)) {
    Fail-And-Restore `
        -Message "New private key was not created." `
        -BackupDir $backupDir `
        -RepoPublicKey $repoPublicKey `
        -RepoPublicKeyBackup $repoPublicKeyBackup
}
if (-not (Test-Path "$KeyPath.pub")) {
    Fail-And-Restore `
        -Message "New public key was not created." `
        -BackupDir $backupDir `
        -RepoPublicKey $repoPublicKey `
        -RepoPublicKeyBackup $repoPublicKeyBackup
}

# Validate the exact failure mode BEFORE updating the repository.
$probe = Join-Path $env:TEMP ("aldoria-updater-key-probe-" + $timestamp + ".txt")
[IO.File]::WriteAllText(
    $probe,
    "aldoria-updater-key-rotation-probe",
    [Text.UTF8Encoding]::new($false)
)

Push-Location $clientDir
try {
    Write-Host ""
    Write-Host "Testing the new private key immediately..." -ForegroundColor Cyan

    npm exec -- tauri signer sign --private-key-path "$KeyPath" "--password=" "$probe"
    if ($LASTEXITCODE -ne 0) {
        Fail-And-Restore `
            -Message "New key could not sign a test file. The old key has been restored." `
            -BackupDir $backupDir `
            -RepoPublicKey $repoPublicKey `
            -RepoPublicKeyBackup $repoPublicKeyBackup
    }
} finally {
    Pop-Location
}

$probeSig = "$probe.sig"
if (-not (Test-Path $probeSig)) {
    Fail-And-Restore `
        -Message "Signer returned success but no .sig file was created. The old key has been restored." `
        -BackupDir $backupDir `
        -RepoPublicKey $repoPublicKey `
        -RepoPublicKeyBackup $repoPublicKeyBackup
}

Remove-Item $probe, $probeSig -Force -ErrorAction SilentlyContinue

# Update the public key embedded into future friend clients only after validation.
Copy-Item "$KeyPath.pub" $repoPublicKey -Force

Write-Host ""
Write-Host "NEW UPDATER KEY VALIDATED SUCCESSFULLY." -ForegroundColor Green
Write-Host ""
Write-Host "New public key copied to:"
Write-Host "  $repoPublicKey"
Write-Host ""
Write-Host "Old key backup kept at:"
Write-Host "  $backupDir"
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "Existing 0.1.0 installations trust the OLD public key."
Write-Host "Your friend must manually install the first client built with this NEW key."
Write-Host "After that, automatic updates can use this key normally."
Write-Host ""
Write-Host "Next GitHub step:"
Write-Host "1. Replace repository secret TAURI_SIGNING_PRIVATE_KEY with the FULL contents of:"
Write-Host "   $KeyPath"
Write-Host "2. Do not create TAURI_SIGNING_PRIVATE_KEY_PASSWORD."
Write-Host ""
Write-Host "To copy the private key safely to your Windows clipboard, run:"
Write-Host ('  Get-Content -Raw "' + $KeyPath + '" | Set-Clipboard')
Write-Host ""
Write-Host "Never commit the private key."
