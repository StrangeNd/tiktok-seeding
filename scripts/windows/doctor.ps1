<<<<<<< C:/Users/Stephen Strange/CascadeProjects/tiktok-seeding/scripts/windows/doctor.ps1
# scripts/windows/doctor.ps1 - pre-flight check for local Windows operator.
# Verifies: Node, pnpm, .env, Postgres, Redis, GPM Login, port 7000 free, schema migrated.
#
# Usage:  pnpm doctor      (or)   powershell -ExecutionPolicy Bypass -File scripts\windows\doctor.ps1
#
# Exits 0 if every required check passes, 1 otherwise.

. "$PSScriptRoot\_common.ps1"

Write-Step 'Doctor - local Windows operator pre-flight'

$envMap   = Get-EnvMap
$port     = Get-MasterPort
$failures = @()

function Check {
  param([string]$Name, [scriptblock]$Test, [scriptblock]$OnFail = $null)
  try {
    $msg = & $Test
    Write-Ok "$Name - $msg"
  } catch {
    Write-Fail "$Name - $_"
    $script:failures += $Name
    if ($OnFail) { & $OnFail }
  }
}

# -- Toolchain -------------------------------------------------------
Check 'Node.js >= 20' {
  $v = (& node --version) 2>$null
  if (-not $v) { throw 'node not on PATH' }
  $maj = [int]($v -replace 'v','' -split '\.' | Select-Object -First 1)
  if ($maj -lt 20) { throw "node $v is too old (need >= 20)" }
  return $v
}

Check 'pnpm available' {
  $p = Get-PnpmExe
  $v = (& pnpm --version) 2>$null
  return "pnpm $v ($p)"
}

# -- .env ------------------------------------------------------------
Check '.env exists' {
  if (-not (Test-Path $script:EnvPath)) {
    throw '.env missing at repo root. Run `Copy-Item .env.example .env` and fill it in.'
  }
  return $script:EnvPath
}

Check '.env has required vars' {
  $required = @('DATABASE_URL','REDIS_URL','GPM_ENDPOINT','GPM_API_PREFIX','MASTER_API_KEY','MASTER_PORT','WORKER_NAME','CONCURRENCY','CREDENTIALS_ENCRYPTION_KEY')
  $missing = @()
  foreach ($k in $required) { if (-not $envMap.ContainsKey($k) -or -not $envMap[$k]) { $missing += $k } }
  if ($missing.Count -gt 0) { throw "missing keys: $($missing -join ', ')" }
  return "$($required.Count) keys present"
}

$configWarnings = Get-OperatorConfigWarnings
foreach ($w in $configWarnings) {
  Write-Warn2 $w
}

# -- Postgres --------------------------------------------------------
Check 'PostgreSQL reachable' {
  $url = $envMap['DATABASE_URL']
  if (-not $url) { throw 'DATABASE_URL not set' }
  # Parse: postgres://user:pass@host:port/db
  if ($url -notmatch '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') {
    throw 'DATABASE_URL not parseable'
  }
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $tcp = Test-NetConnection -ComputerName $pgHost -Port ([int]$pgPort) -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $tcp) { throw ("TCP " + $pgHost + ':' + $pgPort + ' not reachable') }
  $env:PGPASSWORD = $pgPass
  $out = & psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc 'SELECT 1' 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($out -ne '1') { throw "auth/db check failed (got '$out')" }
  return ('{0}:{1}/{2} OK' -f $pgHost,$pgPort,$pgDb)
}

Check 'Schema migrated (dashboard/operator tables)' {
  $url = $envMap['DATABASE_URL']
  if ($url -notmatch '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') { throw 'DATABASE_URL unparseable' }
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $env:PGPASSWORD = $pgPass
  $tables = & psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc "SELECT string_agg(tablename,',') FROM pg_tables WHERE schemaname='public'" 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $expected = @('accounts','jobs','orders','profiles','proxies','workers')
  $actual = ($tables -split ',') | Where-Object { $_ }
  $missing = $expected | Where-Object { $_ -notin $actual }
  if ($missing) { throw ("missing tables: " + ($missing -join ', ') + " - run 'pnpm db:migrate'") }
  return "$($actual.Count) tables OK"
}

# -- Redis -----------------------------------------------------------
Check 'Redis/Memurai reachable' {
  $url = $envMap['REDIS_URL']
  if (-not $url) { throw 'REDIS_URL not set' }
  if ($url -notmatch '^redis:\/\/([^:\/]+):(\d+)') { throw "REDIS_URL not parseable: $url" }
  $rHost=$matches[1]; $rPort=$matches[2]
  $tcp = Test-NetConnection -ComputerName $rHost -Port ([int]$rPort) -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $tcp) { throw ("TCP " + $rHost + ':' + $rPort + ' not reachable') }
  return ('{0}:{1} OK' -f $rHost,$rPort)
}

# -- GPM Login (only when GPM_MODE != mock) -------------------------
$gpmMode = if ($envMap.ContainsKey('GPM_MODE')) { $envMap['GPM_MODE'] } else { 'live' }
if ($gpmMode -eq 'mock') {
  Write-Warn2 "GPM_MODE=mock - skipping GPM Login probe"
} else {
  Check 'GPM Login reachable' {
    $endpoint = $envMap['GPM_ENDPOINT']
    if (-not $endpoint) { throw 'GPM_ENDPOINT not set' }
    $prefix = if ($envMap.ContainsKey('GPM_API_PREFIX')) { $envMap['GPM_API_PREFIX'] } else { '/api/v1' }
    $probe = "$endpoint$prefix/profiles?page=1&per_page=1"
    $r = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    $body = ([System.Text.Encoding]::UTF8.GetString($r.Content) | ConvertFrom-Json)
    if (-not $body.success) { throw 'GPM responded but success=false' }
    return "$endpoint OK ($($body.data.total) profiles)"
  }
}

# -- Port :7000 free (or owned by our PID file) ---------------------
Check "Port :$port free or ours" {
  $owner = Get-PortOwner $port
  if (-not $owner) { return "free" }
  $ourPid = Read-PidFromFile 'master'
  if ($ourPid -and $owner -eq $ourPid) { return "owned by our master (PID $owner)" }
  throw ("occupied by foreign PID " + $owner + ". Run pnpm stop:all or kill it manually.")
}

Check 'Production dashboard build available' {
  $index = Join-Path $script:RepoRoot 'apps\dashboard\dist\index.html'
  if (-not (Test-Path $index)) { throw 'dashboard dist missing; run pnpm build:dashboard' }
  return $index
}

# -- Summary ---------------------------------------------------------
Write-Host ''
if ($failures.Count -eq 0) {
  Write-Host '==> Doctor: ALL CHECKS PASSED' -ForegroundColor Green
  exit 0
} else {
  Write-Host "==> Doctor: $($failures.Count) FAILURE(S): $($failures -join ', ')" -ForegroundColor Red
  exit 1
}

=======
# scripts/windows/doctor.ps1 - pre-flight check for local Windows operator.
# Verifies: Node, pnpm, .env, Postgres, Redis, GPM Login, port 7000 free, schema migrated.
#
# Usage:  pnpm doctor      (or)   powershell -ExecutionPolicy Bypass -File scripts\windows\doctor.ps1
#
# Exits 0 if every required check passes, 1 otherwise.

. "$PSScriptRoot\_common.ps1"

Write-Step 'Doctor - local Windows operator pre-flight'

$envMap   = Get-EnvMap
$port     = Get-MasterPort
$failures = @()

function Check {
  param([string]$Name, [scriptblock]$Test, [scriptblock]$OnFail = $null)
  try {
    $msg = & $Test
    Write-Ok "$Name - $msg"
  } catch {
    Write-Fail "$Name - $_"
    $script:failures += $Name
    if ($OnFail) { & $OnFail }
  }
}

# -- Toolchain -------------------------------------------------------
Check 'Node.js >= 20' {
  $v = (& node --version) 2>$null
  if (-not $v) { throw 'node not on PATH' }
  $maj = [int]($v -replace 'v','' -split '\.' | Select-Object -First 1)
  if ($maj -lt 20) { throw "node $v is too old (need >= 20)" }
  return $v
}

Check 'pnpm available' {
  $p = Get-PnpmExe
  $v = (& pnpm --version) 2>$null
  return "pnpm $v ($p)"
}

# -- .env ------------------------------------------------------------
Check '.env exists' {
  if (-not (Test-Path $script:EnvPath)) {
    throw '.env missing at repo root. Run `Copy-Item .env.example .env` and fill it in.'
  }
  return $script:EnvPath
}

Check '.env has required vars' {
  $required = @('DATABASE_URL','REDIS_URL','GPM_ENDPOINT','GPM_API_PREFIX','MASTER_API_KEY','MASTER_PORT','WORKER_NAME','CONCURRENCY','CREDENTIALS_ENCRYPTION_KEY')
  $missing = @()
  foreach ($k in $required) { if (-not $envMap.ContainsKey($k) -or -not $envMap[$k]) { $missing += $k } }
  if ($missing.Count -gt 0) { throw "missing keys: $($missing -join ', ')" }
  return "$($required.Count) keys present"
}

$configWarnings = Get-OperatorConfigWarnings
foreach ($w in $configWarnings) {
  Write-Warn2 $w
}

# -- Postgres --------------------------------------------------------
Check 'PostgreSQL reachable' {
  $url = $envMap['DATABASE_URL']
  if (-not $url) { throw 'DATABASE_URL not set' }
  # Parse: postgres://user:pass@host:port/db
  if ($url -notmatch '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') {
    throw 'DATABASE_URL not parseable'
  }
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $tcp = Test-NetConnection -ComputerName $pgHost -Port ([int]$pgPort) -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $tcp) { throw ("TCP " + $pgHost + ':' + $pgPort + ' not reachable') }
  $env:PGPASSWORD = $pgPass
  $out = & psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc 'SELECT 1' 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($out -ne '1') { throw "auth/db check failed (got '$out')" }
  return ('{0}:{1}/{2} OK' -f $pgHost,$pgPort,$pgDb)
}

Check 'Schema migrated (dashboard/operator tables)' {
  $url = $envMap['DATABASE_URL']
  if ($url -notmatch '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') { throw 'DATABASE_URL unparseable' }
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $env:PGPASSWORD = $pgPass
  $tables = & psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc "SELECT string_agg(tablename,',') FROM pg_tables WHERE schemaname='public'" 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $expected = @('accounts','jobs','orders','profiles','proxies','workers')
  $actual = ($tables -split ',') | Where-Object { $_ }
  $missing = $expected | Where-Object { $_ -notin $actual }
  if ($missing) { throw ("missing tables: " + ($missing -join ', ') + " - run 'pnpm db:migrate'") }
  return "$($actual.Count) tables OK"
}

# -- Redis -----------------------------------------------------------
Check 'Redis/Memurai reachable' {
  $url = $envMap['REDIS_URL']
  if (-not $url) { throw 'REDIS_URL not set' }
  if ($url -notmatch '^redis:\/\/([^:\/]+):(\d+)') { throw "REDIS_URL not parseable: $url" }
  $rHost=$matches[1]; $rPort=$matches[2]
  $tcp = Test-NetConnection -ComputerName $rHost -Port ([int]$rPort) -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $tcp) { throw ("TCP " + $rHost + ':' + $rPort + ' not reachable') }
  return ('{0}:{1} OK' -f $rHost,$rPort)
}

# -- GPM Login (only when GPM_MODE != mock) -------------------------
$gpmMode = if ($envMap.ContainsKey('GPM_MODE')) { $envMap['GPM_MODE'] } else { 'live' }
if ($gpmMode -eq 'mock') {
  Write-Warn2 "GPM_MODE=mock - skipping GPM Login probe"
} else {
  Check 'GPM Login reachable' {
    $endpoint = $envMap['GPM_ENDPOINT']
    if (-not $endpoint) { throw 'GPM_ENDPOINT not set' }
    $prefix = if ($envMap.ContainsKey('GPM_API_PREFIX')) { $envMap['GPM_API_PREFIX'] } else { '/api/v1' }
    $probe = "$endpoint$prefix/profiles?page=1&per_page=1"
    $r = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    $body = ([System.Text.Encoding]::UTF8.GetString($r.Content) | ConvertFrom-Json)
    if (-not $body.success) { throw 'GPM responded but success=false' }
    return "$endpoint OK ($($body.data.total) profiles)"
  }
}

# -- Port :7000 free (or owned by our PID file) ---------------------
Check "Port :$port free or ours" {
  $owner = Get-PortOwner $port
  if (-not $owner) { return "free" }
  $ourPid = Read-PidFromFile 'master'
  if ($ourPid -and $owner -eq $ourPid) { return "owned by our master (PID $owner)" }
  throw ("occupied by foreign PID " + $owner + ". Run pnpm stop:all or kill it manually.")
}

Check 'Production dashboard build available' {
  $index = Join-Path $script:RepoRoot 'apps\dashboard\dist\index.html'
  if (-not (Test-Path $index)) { throw 'dashboard dist missing; run pnpm build:dashboard' }
  return $index
}

# -- Summary ---------------------------------------------------------
Write-Host ''
if ($failures.Count -eq 0) {
  Write-Host '==> Doctor: ALL CHECKS PASSED' -ForegroundColor Green
  exit 0
} else {
  Write-Host "==> Doctor: $($failures.Count) FAILURE(S): $($failures -join ', ')" -ForegroundColor Red
  exit 1
}

>>>>>>> C:/Users/Stephen Strange/.windsurf/worktrees/tiktok-seeding/tiktok-seeding-3c3dd21a/scripts/windows/doctor.ps1
