. "$PSScriptRoot\_common.ps1"

Write-Step 'Status --- local Windows operator'

$port = Get-MasterPort
$baseUrl = "http://127.0.0.1:$port"

function Test-HttpStatus {
  param([Parameter(Mandatory)][string]$Url, [hashtable]$Headers = @{})
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -Headers $Headers
    return "$($response.StatusCode)"
  } catch {
    return "ERROR $($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host '------ master ---------------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
$mpid = Read-PidFromFile 'master'
Write-Host "  PID file: $mpid"
Write-Host "  Dashboard: $baseUrl/dashboard/"
$reports = @(Get-PortReport $port)
if (-not $reports) {
  Write-Host "  Port :$port free"
} else {
  foreach ($row in $reports) {
    Write-Host "  Port :$port PID=$($row.ProcessId) repoOwned=$($row.RepoOwned)"
    Write-Host "  Command: $($row.CommandLine)"
  }
  $healthStatus = Test-HttpStatus -Url "$baseUrl/health"
  $deepStatus = Test-HttpStatus -Url "$baseUrl/health/deep" -Headers @{'X-API-Key' = (Get-MasterApiKey)}
  Write-Host "  /health: $healthStatus"
  Write-Host "  /health/deep: $deepStatus"
}

Write-Host ''
Write-Host '------ worker ---------------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
$wpid = Read-PidFromFile 'worker'
Write-Host "  PID file: $wpid"
$workerProcs = Get-RepoRuntimeProcesses | Where-Object {
  $cmd = [string]$_.CommandLine
  $cmd.Contains('apps\worker') -or $cmd.Contains('apps/worker')
}
if ($workerProcs) {
  foreach ($p in $workerProcs) {
    Write-Host "  live PID=$($p.ProcessId) name=$($p.Name)"
    Write-Host "  Command: $($p.CommandLine)"
  }
} else {
  Write-Host "  no live worker process matching this repo"
}

if ($reports) {
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

Write-Host ''
Write-Host '------ ports ----------------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
foreach ($runtimePort in Get-RuntimePorts) {
  $runtimeReports = @(Get-PortReport $runtimePort)
  if (-not $runtimeReports) {
    Write-Host "  :$runtimePort free"
    continue
  }
  foreach ($row in $runtimeReports) {
    $action = if ($row.RepoOwned) { 'safe to kill via pnpm close:all' } else { 'foreign process; left alone' }
    Write-Host "  :$runtimePort PID=$($row.ProcessId) repoOwned=$($row.RepoOwned) action=$action"
  }
}

Write-Host ''
Write-Host '------ recent logs ----------------------------------------------------------------------------------------------------------------------------' -ForegroundColor Cyan
foreach ($name in 'master', 'worker') {
  $log = Get-LogFile $name 'out'
  if (Test-Path $log) {
    Write-Host "  ${name} (tail 5 from ${log}):"
    Get-Content $log -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
  } else {
    Write-Host "  ${name}: no log yet"
  }
}

Write-Host ''
