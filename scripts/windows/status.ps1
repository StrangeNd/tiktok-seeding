# scripts/windows/status.ps1 --- show health of master, worker, queue, and profile pool.
#
# Usage:  pnpm status

. "$PSScriptRoot\_common.ps1"

Write-Step 'Status --- local Windows operator'

$envMap = Get-EnvMap
$port   = Get-MasterPort

# ------ Master ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host '------ master ---------------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
$mpid = Read-PidFromFile 'master'
$portOwner = Get-PortOwner $port
$portStatus = if ($portOwner) { "owned by PID $portOwner" } else { 'free' }
Write-Host "  PID file: $mpid"
Write-Host "  Port :$port  $portStatus"
if ($portOwner) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health/deep" -UseBasicParsing -TimeoutSec 5 -Headers @{'X-API-Key'=(Get-MasterApiKey)}
    $body = ($r.Content | ConvertFrom-Json)
    Write-Host "  /health/deep: $($r.StatusCode) --- postgres=$($body.checks.postgres.ok) redis=$($body.checks.redis.ok)"
  } catch {
    Write-Host "  /health/deep: ERROR $_"
  }
}

# ------ Worker ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host '------ worker ---------------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
$wpid = Read-PidFromFile 'worker'
Write-Host "  PID file: $wpid"

# Find live tsx-loaded worker process(es)
$workerProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $c = $_.CommandLine
    $c -and $c.Contains($script:RepoRoot) -and $c.Contains('apps\worker')
  }
if ($workerProcs) {
  foreach ($p in $workerProcs) {
    Write-Host "  live node.exe PID=$($p.ProcessId)"
  }
} else {
  Write-Host "  no live node.exe matching this worktree's worker"
}

# Worker heartbeat from DB
if ($portOwner) {
  try {
    $w = Invoke-MasterApi -Path '/workers'
    foreach ($entry in $w.workers) {
      $age = if ($entry.lastSeenAt) {
        $diff = (Get-Date) - [datetime]$entry.lastSeenAt
        "$([int]$diff.TotalSeconds)s ago"
      } else { 'never' }
      Write-Host "  heartbeat[$($entry.name)]: lastSeen=$age load=$($entry.currentLoad)/$($entry.capacity) v=$($entry.version)"
    }
  } catch {
    Write-Host "  heartbeat: ERROR $_"
  }
}

# ------ Queue + Profile Pool (Postgres) ---------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host '------ profile pool & orders ------------------------------------------------------------------------------------' -ForegroundColor Cyan
$dbUrl = $envMap['DATABASE_URL']
if ($dbUrl -match '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') {
  $u=$matches[1]; $pw=$matches[2]; $h=$matches[3]; $pgPort=$matches[4]; $d=$matches[5]
  $env:PGPASSWORD = $pw
  $profCounts = & psql -h $h -p $pgPort -U $u -d $d -tAc "SELECT status||':'||count(*) FROM profiles GROUP BY status ORDER BY status" 2>$null
  Write-Host "  profiles: $($profCounts -join '  ')"
  $orderCounts = & psql -h $h -p $pgPort -U $u -d $d -tAc "SELECT status||':'||count(*) FROM orders GROUP BY status ORDER BY status" 2>$null
  if ($orderCounts) { Write-Host "  orders:   $($orderCounts -join '  ')" } else { Write-Host '  orders:   (none)' }
  $jobCounts = & psql -h $h -p $pgPort -U $u -d $d -tAc "SELECT status||':'||count(*) FROM jobs GROUP BY status ORDER BY status" 2>$null
  if ($jobCounts) { Write-Host "  jobs:     $($jobCounts -join '  ')" } else { Write-Host '  jobs:     (none)' }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
} else {
  Write-Host "  DATABASE_URL unparseable; skipping DB stats"
}

# ------ Recent log tail ---------------------------------------------------------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host '------ recent logs ------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
foreach ($name in 'master','worker') {
  $log = Get-LogFile $name 'out'
  if (Test-Path $log) {
    Write-Host "  ${name} (tail 5 from ${log}):"
    Get-Content $log -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
  } else {
    Write-Host "  ${name}: no log yet"
  }
}

Write-Host ''
