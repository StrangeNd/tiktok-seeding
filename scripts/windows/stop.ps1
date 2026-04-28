# scripts/windows/stop.ps1 --- gracefully stop master + worker for this worktree.
#
# Usage:  pnpm stop:all
#   -OnlyMaster      stop only master
#   -OnlyWorker      stop only worker
#   -Force           skip graceful SIGINT, taskkill /F /T immediately
#
# Behavior:
#   - Reads PID from .runtime\<name>.pid.
#   - taskkill /T /PID <pid> kills the wrapper AND its children (pnpm --- tsx --- node).
#   - Falls back to scanning for orphan node.exe processes whose CommandLine
#     references this worktree path AND the relevant app, in case PID file is stale.
#   - Removes PID files when done.

[CmdletBinding()]
param(
  [switch]$OnlyMaster,
  [switch]$OnlyWorker,
  [switch]$Force
)

. "$PSScriptRoot\_common.ps1"

function Stop-AppByPidFile {
  param([Parameter(Mandatory)][ValidateSet('master','worker')][string]$Name)

  $procId = Read-PidFromFile $Name
  $killed = $false
  if ($procId) {
    if (Test-ProcessRunning $procId) {
      Write-Step "Stopping $Name tree (PID $procId)"
      # Use Stop-Process -Force to kill the tree (more reliable than taskkill /T)
      try {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
      } catch {
        # Ignore errors - process may already be gone
      }
      if (Test-ProcessRunning $procId) {
        Write-Warn2 "$Name PID $procId still alive; orphan scan will handle it"
      } else {
        Write-Ok "$Name PID $procId stopped"
        $killed = $true
      }
    } else {
      Write-Warn2 "$Name PID file pointed at PID $procId which is not running (stale)"
    }
    Remove-PidFile $Name
  } else {
    Write-Warn2 "$Name PID file not found"
  }
  return $killed
}

function Stop-OrphanByCmdline {
  <#
  .SYNOPSIS Kill leftover node.exe processes from this worktree.
  Useful when cmd.exe wrapper exited but its tsx-loaded node child kept running.
  #>
  param([Parameter(Mandatory)][ValidateSet('master','worker')][string]$Name)

  $marker = "apps\$Name"
  $worktreeMarker = $script:RepoRoot

  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $cmd = $_.CommandLine
      $cmd -and $cmd.Contains($worktreeMarker) -and $cmd.Contains($marker)
    }

  foreach ($p in $procs) {
    Write-Warn2 "Orphan $Name node.exe found PID=$($p.ProcessId); killing tree"
    & taskkill.exe /F /T /PID $p.ProcessId 2>&1 | Out-Null
  }
  if ($procs) { Start-Sleep -Seconds 1 }
}

if (-not $OnlyWorker) {
  Stop-AppByPidFile 'master'
  Stop-OrphanByCmdline 'master'
  # Final: anything still on :7000 owned by us?
  $port = Get-MasterPort
  $owner = Get-PortOwner $port
  if ($owner) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    $cmd = if ($proc) { $proc.CommandLine } else { '' }
    if ($cmd -and $cmd.Contains($script:RepoRoot)) {
      Write-Warn2 "Port :$port still held by our worktree PID $owner; killing"
      & taskkill.exe /F /T /PID $owner 2>&1 | Out-Null
    } else {
      Write-Warn2 "Port :$port held by foreign PID $owner --- left alone"
    }
  }
}

if (-not $OnlyMaster) {
  Stop-AppByPidFile 'worker'
  Stop-OrphanByCmdline 'worker'
}

Write-Host ''
Write-Host '==> Stop complete.' -ForegroundColor Green
