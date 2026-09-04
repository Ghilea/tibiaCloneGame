$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageRoot = Join-Path $ScriptDir "content-packs\aldoria-item-restyle-v3"
node (Join-Path $PackageRoot "install.mjs") --repo (Get-Location).Path --package-root $PackageRoot @args
