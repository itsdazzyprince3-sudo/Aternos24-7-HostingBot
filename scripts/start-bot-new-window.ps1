param(
  [switch]$ProtocolDebug
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $projectRoot 'settings.json'
$port = 5000

if ($env:PORT -match '^\d+$') {
  $port = [int]$env:PORT
}
$dashboardPorts = @($port, $port + 1)

if (-not (Test-Path -LiteralPath $settingsPath)) {
  throw "Missing settings.json. Copy settings.example.json to settings.json and configure the bot first."
}

foreach ($candidatePort in $dashboardPorts) {
  $existingUrl = "http://127.0.0.1:$candidatePort"
  try {
    $health = Invoke-RestMethod -Uri "$existingUrl/health" -TimeoutSec 2
    if ($null -ne $health.reconnectAttempts -and $null -ne $health.lastActivity) {
      Start-Process $existingUrl
      Write-Host "An instance of this bot is already running. Opened its dashboard at $existingUrl."
      return
    }
  } catch {
    continue
  }
}

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (Test-Path -LiteralPath $windowsPowerShell) {
  $powerShellExecutable = $windowsPowerShell
} else {
  $powerShellExecutable = (Get-Command pwsh.exe -ErrorAction Stop).Source
}

$escapedRoot = $projectRoot.Replace("'", "''")
$childCommand = "`$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath '$escapedRoot';"
if ($ProtocolDebug) {
  $childCommand += " `$env:MINECRAFT_PROTOCOL_DEBUG_FRAMES = '1';"
}
$childCommand += " Write-Host 'Starting Minecraft bot. Keep this window open.'; npm.cmd start"
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))

Start-Process -FilePath $powerShellExecutable -ArgumentList @(
  '-NoExit',
  '-EncodedCommand',
  $encodedCommand
) | Out-Null

$dashboardUrl = $null
$dashboardReady = $false

for ($attempt = 0; $attempt -lt 30; $attempt++) {
  foreach ($candidatePort in $dashboardPorts) {
    $candidateUrl = "http://127.0.0.1:$candidatePort"
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$candidateUrl/ping" -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $health = Invoke-RestMethod -Uri "$candidateUrl/health" -TimeoutSec 2
        if ($null -eq $health.reconnectAttempts -or $null -eq $health.lastActivity) {
          continue
        }
        $dashboardUrl = $candidateUrl
        $dashboardReady = $true
        break
      }
    } catch {
      continue
    }
  }
  if ($dashboardReady) {
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $dashboardReady) {
  throw "The bot dashboard did not become ready on port $port or $($port + 1). Check the new PowerShell window for startup errors."
}

Start-Process $dashboardUrl
Write-Host "Bot started in a new PowerShell window."
Write-Host "Dashboard opened at $dashboardUrl. Enter the dashboard control token to submit an AI instruction."
if ($ProtocolDebug) {
  Write-Host "Protocol debug is enabled in the bot window; failed packets up to 512 bytes include frameHex."
}
