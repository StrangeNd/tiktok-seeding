# Shared helpers for Windows operator scripts.
# Dot-source this from each script:  . "$PSScriptRoot\_common.ps1"
#
# Conventions:
#   - $RepoRoot   --- absolute path to repo root (the worktree)
#   - $RuntimeDir --- $RepoRoot\.runtime (gitignored; PID files + logs land here)
#   - $EnvPath    --- $RepoRoot\.env
#   - PID files:    $RuntimeDir\master.pid, worker.pid
#   - Log files:    $RuntimeDir\master.log + master.err.log, same for worker
#
# Each script should be safe to run from any CWD; scripts re-anchor to repo root.

$ErrorActionPreference = 'Stop'
# Suppress noisy progress bars (Test-NetConnection, Invoke-WebRequest, etc.).
$ProgressPreference = 'SilentlyContinue'

$script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:RuntimeDir = Join-Path $RepoRoot '.runtime'
$script:BackupsDir = Join-Path $RepoRoot '.backups'
$script:EnvPath    = Join-Path $RepoRoot '.env'

if (-not (Test-Path $RuntimeDir)) {
  New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
}

function Get-EnvMap {
  <# .SYNOPSIS Reads $RepoRoot\.env into a hashtable. Returns @{} if missing. #>
  $map = @{}
  if (-not (Test-Path $script:EnvPath)) { return $map }
  foreach ($line in Get-Content $script:EnvPath) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith('#')) { continue }
    $idx = $trim.IndexOf('=')
    if ($idx -lt 1) { continue }
    $k = $trim.Substring(0, $idx).Trim()
    $v = $trim.Substring($idx + 1).Trim()
    # Strip optional quotes
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
  return $map
}

function Get-EnvValue {
  param([string]$Key, [string]$Default = '')
  $map = Get-EnvMap
  if ($map.ContainsKey($Key)) { return $map[$Key] }
  return $Default
}

function Get-MasterPort { [int](Get-EnvValue 'MASTER_PORT' '7000') }
function Get-MasterApiKey { Get-EnvValue 'MASTER_API_KEY' 'dev-key-change-me' }
function Get-MasterBaseUrl { "http://127.0.0.1:$(Get-MasterPort)" }
function Get-BackupRoot { $script:BackupsDir }

function Get-OperatorConfigWarnings {
  $map = Get-EnvMap
  $warnings = @()
  $apiKey = if ($map.ContainsKey('MASTER_API_KEY')) { $map['MASTER_API_KEY'] } else { 'dev-key-change-me' }
  $secretKey = if ($map.ContainsKey('CREDENTIALS_ENCRYPTION_KEY')) { $map['CREDENTIALS_ENCRYPTION_KEY'] } else { '' }
  $nodeEnv = if ($map.ContainsKey('NODE_ENV')) { $map['NODE_ENV'] } else { 'development' }
  if ($apiKey -eq 'dev-key-change-me') { $warnings += 'MASTER_API_KEY is using the default development value' }
  if (-not $secretKey -or $secretKey -eq 'dev-credentials-key-change-me-please-32+ch' -or $secretKey.Length -lt 32) {
    $warnings += 'CREDENTIALS_ENCRYPTION_KEY is missing/default/shorter than 32 characters'
  }
  if ($nodeEnv -eq 'production' -and $warnings.Count -gt 0) {
    $warnings += 'NODE_ENV=production is running with unsafe operator secrets'
  }
  return $warnings
}

function Get-PidFile {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  Join-Path $script:RuntimeDir "$Name.pid"
}

function Get-LogFile {
  param(
    [Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name,
    [Parameter()][ValidateSet('out', 'err')][string]$Stream = 'out'
  )
  $suffix = if ($Stream -eq 'err') { '.err.log' } else { '.log' }
  Join-Path $script:RuntimeDir "$Name$suffix"
}

function Save-Pid {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name,
        [Parameter(Mandatory)][int]$ProcessId)
  Set-Content -Path (Get-PidFile $Name) -Value $ProcessId -Encoding ascii
}

function Read-PidFromFile {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  $f = Get-PidFile $Name
  if (-not (Test-Path $f)) { return $null }
  $val = (Get-Content $f -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $val) { return $null }
  $intVal = 0
  if ([int]::TryParse($val.Trim(), [ref]$intVal)) { return $intVal }
  return $null
}

function Remove-PidFile {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  $f = Get-PidFile $Name
  if (Test-Path $f) { Remove-Item -Force $f }
}

function Test-ProcessRunning {
  param([Parameter(Mandatory)][int]$ProcessId)
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-PortListening {
  param([Parameter(Mandatory)][int]$Port)
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

function Get-PortOwner {
  param([Parameter(Mandatory)][int]$Port)
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  return [int]$c.OwningProcess
}

function Stop-ProcessTree {
  <#
    .SYNOPSIS Kill a process and all its children.
    Tries Stop-Process first, falls back to taskkill /F /T.
    Returns $true if process is gone (or was never running), $false otherwise.
  #>
  param([Parameter(Mandatory)][int]$ProcessId, [int]$TimeoutSec = 10)
  if (-not (Test-ProcessRunning $ProcessId)) { return $true }

  # Graceful first
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt $TimeoutSec; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Test-ProcessRunning $ProcessId)) { return $true }
  }
  # Force tree
  & taskkill.exe /F /T /PID $ProcessId 2>&1 | Out-Null
  Start-Sleep -Seconds 1
  return -not (Test-ProcessRunning $ProcessId)
}

function Wait-HttpOk {
  param(
    [Parameter(Mandatory)][string]$Url,
    [int]$TimeoutSec = 30,
    [hashtable]$Headers = @{}
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers $Headers
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch {
      # not ready yet
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Invoke-MasterApi {
  <# .SYNOPSIS Helper that adds X-API-Key + Content-Type. Returns parsed JSON or throws. #>
  param(
    [Parameter(Mandatory)][string]$Path,
    [string]$Method = 'GET',
    [string]$Body = $null
  )
  $headers = @{ 'X-API-Key' = (Get-MasterApiKey); 'Content-Type' = 'application/json' }
  $url = "$(Get-MasterBaseUrl)$Path"
  $reqArgs = @{ Uri = $url; Method = $Method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 15 }
  if ($PSBoundParameters.ContainsKey('Body') -and $Body) { $reqArgs['Body'] = $Body }
  $resp = Invoke-WebRequest @reqArgs
  if ($resp.Content) { return ($resp.Content | ConvertFrom-Json) }
  return $null
}

function Get-PnpmExe {
  $cmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'pnpm not found on PATH. Install via corepack enable or npm i -g pnpm.' }
  return $cmd.Source
}

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    OK   $Msg" -ForegroundColor Green }
function Write-Warn2{ param([string]$Msg) Write-Host "    WARN $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "    FAIL $Msg" -ForegroundColor Red }
