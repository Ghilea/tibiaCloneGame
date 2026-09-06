param(
    [string]$KeyPath = (Join-Path $HOME ".tauri\aldoria-updater.key")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$clientDir = Join-Path $repoRoot "apps\client"
$templatePath = Join-Path $clientDir "src-tauri\tauri.friend.conf.json"
$generatedPath = Join-Path $clientDir "src-tauri\tauri.friend.generated.json"
$publicKeyPath = Join-Path $clientDir "src-tauri\updater.pub"

if (-not (Test-Path $publicKeyPath)) {
    throw "Missing updater.pub. Run: npm run client:updater:setup"
}
if (-not (Test-Path $KeyPath)) {
    throw "Missing private updater key at $KeyPath"
}

$publicKey = (Get-Content -Raw $publicKeyPath).Trim()
$template = Get-Content -Raw $templatePath
$publicKeyJson = $publicKey | ConvertTo-Json -Compress
$generated = $template.Replace(
    '"__ALDORIA_UPDATER_PUBKEY__"',
    $publicKeyJson
)
Set-Content -Path $generatedPath -Value $generated -Encoding UTF8

$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath

Write-Host ""
Write-Host "Building friend release client..." -ForegroundColor Cyan
Write-Host "  API: http://213.65.167.85:4000/api"
Write-Host "  WS : ws://213.65.167.85:4000/ws"
Write-Host "  Updater: GitHub Releases latest.json"
Write-Host ""
Write-Host 'If the private key has a password, set $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD first.'
Write-Host ""

Push-Location $clientDir
try {
    npm exec -- tauri build --features friend-updater --config src-tauri/tauri.friend.generated.json
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri friend build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Friend client build complete." -ForegroundColor Green
Write-Host "Installer folder:"
Write-Host "  apps\client\src-tauri\target\release\bundle\nsis\"
