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
  foreach ($k in @(
    'NODE_ENV',
    'LOG_LEVEL',
    'MASTER_PORT',
    'MASTER_API_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'GPM_MODE',
    'GPM_ENDPOINT',
    'GPM_API_PREFIX',
    'GPM_API_KEY',
    'WORKER_NAME',
    'CONCURRENCY',
    'DASHBOARD_PORT',
    'CREDENTIALS_ENCRYPTION_KEY',
    'PROXY_TEST_URL',
    'PROXY_TEST_TIMEOUT_MS',
    'MAIL_PROVIDER',
    'MAIL_CODE_LOOKBACK_MINUTES',
    'MAIL_CODE_MAX_RESULTS',
    'MAIL_CODE_ALLOWED_SENDERS',
    'MAIL_CODE_SUBJECT_HINTS',
    'MAIL_CODE_REQUEST_COOLDOWN_SECONDS',
    'AUTH_SESSION_SECRET',
    'AUTH_ALLOW_SELF_REGISTER',
    'AUTH_REQUIRE_ADMIN_APPROVAL',
    'USER_CAN_IMPORT_PROXIES'
  )) {
    $processValue = [Environment]::GetEnvironmentVariable($k, 'Process')
    if ($null -ne $processValue -and $processValue -ne '') {
      $map[$k] = $processValue
    }
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
  return (@(Get-PortOwners $Port).Count -gt 0)
}

function Get-PortOwner {
  param([Parameter(Mandatory)][int]$Port)
  @(Get-PortOwners $Port) | Select-Object -First 1
}

function Get-PortOwners {
  param([Parameter(Mandatory)][int]$Port)
  $owners = @()
  try {
    $lines = & netstat.exe -ano 2>$null
  } catch {
    return @()
  }
  foreach ($line in $lines) {
    $parts = ([string]$line).Trim() -split '\s+'
    if ($parts.Count -lt 5) { continue }
    if ($parts[0] -ne 'TCP') { continue }
    $localAddress = $parts[1]
    $state = $parts[$parts.Count - 2]
    if ($state -ne 'LISTENING') { continue }
    if (-not $localAddress.EndsWith(":$Port")) { continue }
    $pidText = $parts[$parts.Count - 1]
    $parsedPid = 0
    if ([int]::TryParse($pidText, [ref]$parsedPid)) { $owners += $parsedPid }
  }
  return @($owners | Where-Object { $_ } | Sort-Object -Unique)
}

function Get-ProcessInfo {
  param([Parameter(Mandatory)][int]$ProcessId)
  Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Test-RepoOwnedRuntimeProcess {
  param($Process)
  if (-not $Process) { return $false }
  $name = [string]$Process.Name
  if ($name -notin @('node.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe')) { return $false }
  $cmd = [string]$Process.CommandLine
  if (-not $cmd) { return $false }
  if (-not $cmd.Contains($script:RepoRoot)) { return $false }
  foreach ($marker in @(
    'apps\master',
    'apps\worker',
    'apps/master',
    'apps/worker',
    'dist\index.js',
    'dist/index.js',
    'tsx src/index.ts'
  )) {
    if ($cmd.Contains($marker)) { return $true }
  }
  return $false
}

function Get-RepoRuntimeProcesses {
  $names = @("Name='node.exe'", "Name='cmd.exe'", "Name='powershell.exe'", "Name='pwsh.exe'")
  $found = @()
  foreach ($filter in $names) {
    $found += Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue |
      Where-Object { Test-RepoOwnedRuntimeProcess $_ }
  }
  return @($found | Sort-Object ProcessId -Unique)
}

function Stop-RepoRuntimeProcess {
  param([Parameter(Mandatory)]$Process)
  if (-not (Test-RepoOwnedRuntimeProcess $Process)) { return $false }
  Write-Warn2 "Killing repo-owned runtime process PID=$($Process.ProcessId) name=$($Process.Name)"
  & taskkill.exe /F /T /PID $Process.ProcessId 2>&1 | Out-Null
  Start-Sleep -Milliseconds 500
  return -not (Test-ProcessRunning ([int]$Process.ProcessId))
}

function Get-RuntimePorts {
  $ports = @((Get-MasterPort), 7000, 7101)
  $portFile = Join-Path $script:RuntimeDir 'ports.txt'
  if (Test-Path $portFile) {
    foreach ($line in Get-Content $portFile -ErrorAction SilentlyContinue) {
      $port = 0
      if ([int]::TryParse($line.Trim(), [ref]$port)) { $ports += $port }
    }
  }
  return @($ports | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Save-RuntimePort {
  param([Parameter(Mandatory)][int]$Port)
  $ports = @(Get-RuntimePorts) + $Port
  $ports | Sort-Object -Unique | Set-Content -Path (Join-Path $script:RuntimeDir 'ports.txt') -Encoding ascii
}

function Get-PortReport {
  param([Parameter(Mandatory)][int]$Port)
  $rows = @()
  foreach ($owner in Get-PortOwners $Port) {
    $proc = Get-ProcessInfo $owner
    $rows += [pscustomobject]@{
      Port = $Port
      ProcessId = $owner
      Name = if ($proc) { $proc.Name } else { $null }
      CommandLine = if ($proc) { $proc.CommandLine } else { $null }
      RepoOwned = Test-RepoOwnedRuntimeProcess $proc
    }
  }
  return $rows
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
