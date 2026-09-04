$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AllArgs = @($args)
$DryRun = $AllArgs -contains "--dry-run"

$ExplicitZip = $null
foreach ($arg in $AllArgs) {
    if (-not $arg.StartsWith("--") -and $arg.ToLowerInvariant().EndsWith(".zip")) {
        $ExplicitZip = $arg
        break
    }
}
$ForwardArgs = @($AllArgs | Where-Object { $_ -ne $ExplicitZip })

if ($ExplicitZip) {
    $Zip = Get-Item -LiteralPath (if ([System.IO.Path]::IsPathRooted($ExplicitZip)) { $ExplicitZip } else { Join-Path $RepoRoot $ExplicitZip })
} else {
    $Zip = Get-ChildItem -LiteralPath $RepoRoot -File -Filter "aldoria_update_*.zip" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

if (-not $Zip) {
    Write-Host "No Aldoria update ZIP found in $RepoRoot" -ForegroundColor Yellow
    Write-Host "Put the new aldoria_update_*.zip in the repository root and run: npm run content:update"
    exit 1
}

$TempRoot = Join-Path $RepoRoot ".aldoria-update-temp"
$TempDir = Join-Path $TempRoot ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    Write-Host "Extracting $($Zip.Name)..."
    Expand-Archive -LiteralPath $Zip.FullName -DestinationPath $TempDir -Force
    $ManifestFile = Get-ChildItem -LiteralPath $TempDir -Recurse -File -Filter "aldoria-update-package.json" | Select-Object -First 1
    if (-not $ManifestFile) { throw "The ZIP does not contain aldoria-update-package.json." }
    $Manifest = Get-Content -LiteralPath $ManifestFile.FullName -Raw | ConvertFrom-Json
    if (-not $Manifest.entrypoint) { throw "Update manifest is missing entrypoint." }
    $PackageRoot = $ManifestFile.Directory.FullName
    $Entrypoint = Join-Path $PackageRoot $Manifest.entrypoint
    if (-not (Test-Path -LiteralPath $Entrypoint)) { throw "Update entrypoint not found: $Entrypoint" }

    & node $Entrypoint --repo $RepoRoot --package-root $PackageRoot @ForwardArgs
    $Code = $LASTEXITCODE
    if ($Code -ne 0) { throw "Updater exited with code $Code." }

    if (-not $DryRun) {
        Remove-Item -LiteralPath $Zip.FullName -Force
        Write-Host "Update succeeded. Removed $($Zip.Name)." -ForegroundColor Green
    } else {
        Write-Host "Dry run succeeded. ZIP was kept." -ForegroundColor Green
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "The ZIP was kept so you can retry after fixing the problem." -ForegroundColor Yellow
    exit 1
} finally {
    if (Test-Path -LiteralPath $TempDir) { Remove-Item -LiteralPath $TempDir -Recurse -Force }
    if ((Test-Path -LiteralPath $TempRoot) -and -not (Get-ChildItem -LiteralPath $TempRoot -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $TempRoot -Force
    }
}
