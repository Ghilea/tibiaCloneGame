param(
    [string]$OutputDirectory = "dist\Embers-of-Aldoria"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = Join-Path $repoRoot $OutputDirectory

Push-Location $repoRoot
try {
    cargo build -p game-client --bin game-client --release
    if ($LASTEXITCODE -ne 0) {
        throw "Native client build failed with exit code $LASTEXITCODE"
    }

    New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
    Copy-Item "target\release\game-client.exe" (Join-Path $resolvedOutput "EmbersOfAldoria.exe") -Force
    Copy-Item "assets" (Join-Path $resolvedOutput "assets") -Recurse -Force
} finally {
    Pop-Location
}

Write-Host "Native client package created at $resolvedOutput" -ForegroundColor Green
