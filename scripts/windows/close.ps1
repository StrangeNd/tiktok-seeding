[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"

$failed = @()
$killed = @()

Write-Step 'Hard close TikTok Seeding runtime'

foreach ($proc in Get-RepoRuntimeProcesses) {
  if (Stop-RepoRuntimeProcess $proc) {
    $killed += "$($proc.Name) PID $($proc.ProcessId)"
  } else {
    $failed += "$($proc.Name) PID $($proc.ProcessId)"
  }
}

foreach ($port in Get-RuntimePorts) {
  foreach ($row in @(Get-PortReport $port)) {
    if ($row.RepoOwned) {
      $proc = Get-ProcessInfo $row.ProcessId
      if (Stop-RepoRuntimeProcess $proc) {
        $killed += "port :$port PID $($row.ProcessId)"
      } else {
        $failed += "port :$port PID $($row.ProcessId)"
      }
    } else {
      Write-Warn2 "Port :$port held by foreign PID $($row.ProcessId); left alone"
    }
  }
}

Get-ChildItem -Path $script:RuntimeDir -Filter '*.pid' -File -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '------ close summary ------' -ForegroundColor Cyan
if ($killed) { $killed | Sort-Object -Unique | ForEach-Object { Write-Ok "killed $_" } } else { Write-Ok 'no repo-owned runtime process found' }
Write-Ok 'removed .runtime PID files'
foreach ($port in Get-RuntimePorts) {
  $remaining = @(Get-PortReport $port)
  if (-not $remaining) {
    Write-Ok "port :$port free"
  } else {
    foreach ($row in $remaining) {
      if ($row.RepoOwned) {
        Write-Fail "port :$port still held by repo-owned PID $($row.ProcessId)"
        $failed += "port :$port PID $($row.ProcessId)"
      } else {
        Write-Warn2 "port :$port held by foreign PID $($row.ProcessId)"
      }
    }
  }
}
if ($failed) {
  $failed | Sort-Object -Unique | ForEach-Object { Write-Fail "failed $_" }
  exit 1
}

Write-Host ''
Write-Host '==> Close complete.' -ForegroundColor Green
