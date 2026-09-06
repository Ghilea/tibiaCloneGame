param(
    [string]$KeyPath = (Join-Path $HOME ".tauri\aldoria-updater.key")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$clientDir = Join-Path $repoRoot "apps\client"
$publicKeyTarget = Join-Path $clientDir "src-tauri\updater.pub"

$keyDir = Split-Path -Parent $KeyPath
New-Item -ItemType Directory -Path $keyDir -Force | Out-Null

if (Test-Path $KeyPath) {
    throw "Private updater key already exists at $KeyPath. Refusing to overwrite it."
}

Write-Host ""
Write-Host "Generating Tauri updater signing key..." -ForegroundColor Cyan
Write-Host "Private key stays OUTSIDE the repository:"
Write-Host "  $KeyPath"
Write-Host ""

Push-Location $clientDir
try {
    npm exec -- tauri signer generate -w $KeyPath
    if ($LASTEXITCODE -ne 0) {
        throw "tauri signer generate failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

$publicKeyPath = "$KeyPath.pub"
if (-not (Test-Path $publicKeyPath)) {
    throw "Expected public key was not created at $publicKeyPath"
}

Copy-Item $publicKeyPath $publicKeyTarget -Force

Write-Host ""
Write-Host "Updater keys created." -ForegroundColor Green
Write-Host "Public key copied to:"
Write-Host "  $publicKeyTarget"
Write-Host ""
Write-Host "KEEP PRIVATE:" -ForegroundColor Yellow
Write-Host "  $KeyPath"
Write-Host "If this key is lost, installed clients cannot trust future updates."
Write-Host ""
Write-Host "GitHub Actions needs secret:"
Write-Host "  TAURI_SIGNING_PRIVATE_KEY"
Write-Host "and, if used:"
Write-Host "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
Write-Host ""
Write-Host ('GitHub CLI: Get-Content -Raw "' + $KeyPath + '" | gh secret set TAURI_SIGNING_PRIVATE_KEY')
Write-Host ""
Write-Host "Commit updater.pub only. Never commit the private key."
