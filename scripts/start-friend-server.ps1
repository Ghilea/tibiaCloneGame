param(
    [string]$ExpectedPublicIp = "213.65.167.85"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host ""
Write-Host "=== Embers of Aldoria - Friend Server ===" -ForegroundColor Cyan

$route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -AddressFamily IPv4 |
    Sort-Object RouteMetric, InterfaceMetric |
    Select-Object -First 1

$localIp = $null
if ($route) {
    $localIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
        Where-Object {
            $_.IPAddress -notlike "169.254.*" -and
            $_.IPAddress -ne "127.0.0.1"
        } |
        Select-Object -First 1 -ExpandProperty IPAddress
}

$detectedPublicIp = $null
try {
    $detectedPublicIp = (
        Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5
    ).Trim()
} catch {
    Write-Warning "Could not auto-detect public IP. Using configured address $ExpectedPublicIp."
}

Write-Host "Bind address : 0.0.0.0:4000"
# TIBIAGAME_V33_1_POWERSHELL_51
$localIpDisplay = if ($localIp) { $localIp } else { "<not detected>" }
Write-Host "Local IPv4   : $localIpDisplay"
Write-Host "Expected WAN : $ExpectedPublicIp"

if ($detectedPublicIp) {
    Write-Host "Detected WAN : $detectedPublicIp"
    if ($detectedPublicIp -ne $ExpectedPublicIp) {
        Write-Warning "Public IP changed. Friend clients still point to $ExpectedPublicIp."
        Write-Warning "Update the native release endpoint variables in .github/workflows/release-friend-client.yml and publish a new client."
    }
}

if ($localIp) {
    Write-Host ""
    Write-Host "Router port-forward required:" -ForegroundColor Yellow
    Write-Host ("  TCP 4000 -> {0}:4000" -f $localIp)
}

Write-Host ""
Write-Host "Windows firewall:" -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if ($isAdmin) {
    $existingRule = Get-NetFirewallRule -DisplayName "Aldoria Game Server 4000" -ErrorAction SilentlyContinue
    if (-not $existingRule) {
        try {
            New-NetFirewallRule `
                -DisplayName "Aldoria Game Server 4000" `
                -Direction Inbound `
                -Protocol TCP `
                -LocalPort 4000 `
                -Action Allow | Out-Null
            Write-Host "  Firewall rule created automatically." -ForegroundColor Green
        } catch {
            Write-Warning "Could not create firewall rule automatically: $($_.Exception.Message)"
        }
    } else {
        Write-Host "  Firewall rule already exists." -ForegroundColor Green
    }
} else {
    Write-Host "  This terminal is not running as Administrator."
    Write-Host "  If friends cannot connect, open PowerShell as Administrator and run:"
    Write-Host '    New-NetFirewallRule -DisplayName "Aldoria Game Server 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow'
}
Write-Host ""
Write-Host "Friend endpoints:"
Write-Host ("  API: http://{0}:4000/api" -f $ExpectedPublicIp)
Write-Host ("  WS : ws://{0}:4000/ws" -f $ExpectedPublicIp)
Write-Host ""
Write-Warning "Initial internet-test transport is plain HTTP/WS. Use test-only passwords until HTTPS/WSS is configured."
Write-Host ""

$env:GAME_SERVER_ADDR = "0.0.0.0:4000"
if (-not $env:RUST_LOG) {
    $env:RUST_LOG = "game_server=debug,tower_http=info"
}

cargo run -p game-server
exit $LASTEXITCODE
