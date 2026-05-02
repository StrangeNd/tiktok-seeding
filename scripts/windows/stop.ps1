[CmdletBinding()]
param(
  [switch]$OnlyMaster,
  [switch]$OnlyWorker,
  [switch]$Force
)

. "$PSScriptRoot\_common.ps1"

$script:Killed = @()
$script:Foreign = @()
$script:Failed = @()
$script:PidFilesRemoved = @()

function Add-Killed {
  param([string]$Kind, [int]$ProcessId)
  $script:Killed += "$Kind PID $ProcessId"
}

function Remove-RuntimePidFile {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  $path = Get-PidFile $Name
  if (Test-Path $path) {
    Remove-Item -Force $path
    $script:PidFilesRemoved += $path
  }
}

function Stop-PidFileProcess {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  $procId = Read-PidFromFile $Name
  if (-not $procId) {
    Write-Warn2 "$Name PID file not found"
    return
  }
  $proc = Get-ProcessInfo $procId
  if (-not $proc) {
    Write-Warn2 "$Name PID file pointed at stale PID $procId"
    Remove-RuntimePidFile $Name
    return
  }
  if (-not (Test-RepoOwnedRuntimeProcess $proc)) {
    Write-Warn2 "$Name PID $procId does not look repo-owned; left alone"
    $script:Foreign += "$Name PID $procId"
    return
  }
  Write-Step "Stopping $Name process tree PID $procId"
  if (Stop-RepoRuntimeProcess $proc) {
    Add-Killed $Name $procId
    Remove-RuntimePidFile $Name
  } else {
    $script:Failed += "$Name PID $procId"
  }
}

function Stop-OrphanRuntimeProcesses {
  param([Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name)
  $markerSlash = "apps/$Name"
  $markerBackslash = "apps\$Name"
  $procs = Get-RepoRuntimeProcesses | Where-Object {
    $cmd = [string]$_.CommandLine
    $cmd.Contains($markerSlash) -or $cmd.Contains($markerBackslash)
  }
  foreach ($proc in $procs) {
    Write-Step "Stopping orphan $Name runtime PID $($proc.ProcessId)"
    if (Stop-RepoRuntimeProcess $proc) {
      Add-Killed "$Name orphan" ([int]$proc.ProcessId)
    } else {
      $script:Failed += "$Name orphan PID $($proc.ProcessId)"
    }
  }
}

function Clear-RepoOwnedPort {
  param([Parameter(Mandatory)][int]$Port)
  $reports = @(Get-PortReport $Port)
  if (-not $reports) {
    Write-Ok "Port :$Port free"
    return
  }
  foreach ($row in $reports) {
    if ($row.RepoOwned) {
      $proc = Get-ProcessInfo $row.ProcessId
      Write-Step "Freeing port :$Port from repo-owned PID $($row.ProcessId)"
      if (Stop-RepoRuntimeProcess $proc) {
        Add-Killed "port :$Port" ([int]$row.ProcessId)
      } else {
        $script:Failed += "port :$Port PID $($row.ProcessId)"
      }
    } else {
      Write-Warn2 "Port :$Port held by foreign PID $($row.ProcessId); left alone"
      $script:Foreign += "port :$Port PID $($row.ProcessId)"
    }
  }
}

Write-Step 'Stopping TikTok Seeding runtime'

if (-not $OnlyWorker) {
  Stop-PidFileProcess 'master'
  Stop-OrphanRuntimeProcesses 'master'
}
if (-not $OnlyMaster) {
  Stop-PidFileProcess 'worker'
  Stop-OrphanRuntimeProcesses 'worker'
}

if (-not $OnlyWorker) {
  foreach ($port in Get-RuntimePorts) {
    Clear-RepoOwnedPort $port
  }
}

if (-not $OnlyWorker) { Remove-RuntimePidFile 'master' }
if (-not $OnlyMaster) { Remove-RuntimePidFile 'worker' }

Write-Host ''
Write-Host '------ stop summary ------' -ForegroundColor Cyan
if ($script:Killed) { $script:Killed | Sort-Object -Unique | ForEach-Object { Write-Ok "killed $_" } } else { Write-Ok 'no repo-owned runtime processes needed killing' }
if ($script:PidFilesRemoved) { $script:PidFilesRemoved | Sort-Object -Unique | ForEach-Object { Write-Ok "removed PID file $_" } } else { Write-Ok 'no PID files removed' }
foreach ($port in Get-RuntimePorts) {
  $remaining = @(Get-PortReport $port)
  if (-not $remaining) {
    Write-Ok "port :$port free"
  } else {
    foreach ($row in $remaining) {
      if ($row.RepoOwned) {
        Write-Fail "port :$port still held by repo-owned PID $($row.ProcessId)"
        $script:Failed += "port :$port PID $($row.ProcessId)"
      } else {
        Write-Warn2 "port :$port held by foreign PID $($row.ProcessId)"
      }
    }
  }
}
if ($script:Foreign) { $script:Foreign | Sort-Object -Unique | ForEach-Object { Write-Warn2 "left alone $_" } }
if ($script:Failed) {
  $script:Failed | Sort-Object -Unique | ForEach-Object { Write-Fail "failed $_" }
  exit 1
}

Write-Host ''
Write-Host '==> Stop complete.' -ForegroundColor Green
