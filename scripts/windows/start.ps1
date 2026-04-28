# scripts/windows/start.ps1 --- start master + worker as detached processes.
#
# Usage:  pnpm start:all
#   -OnlyMaster   start just the master
#   -OnlyWorker   start just the worker (master must already be up)
#   -SkipDoctor   skip pre-flight checks (faster restart)
#
# Behavior:
#   - Refuses to start if PID file exists AND that PID is alive (idempotent).
#   - Cleans stale PID files for dead processes.
#   - Detects port :7000 occupied by a foreign process and aborts with guidance.
#   - Streams output into .runtime\<name>.log and .runtime\<name>.err.log.
#   - Waits for /health 200 before declaring master ready.

[CmdletBinding()]
param(
  [switch]$OnlyMaster,
  [switch]$OnlyWorker,
  [switch]$SkipDoctor
)

. "$PSScriptRoot\_common.ps1"

if (-not $SkipDoctor) {
  Write-Step 'Pre-flight (doctor)'
  & "$PSScriptRoot\doctor.ps1"
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'doctor failed; refusing to start. Use -SkipDoctor to override.'
    exit 1
  }
}

function Start-AppProcess {
  param(
    [Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name
  )

  # 1. PID file: if alive, refuse; if stale, remove.
  $existing = Read-PidFromFile $Name
  if ($existing) {
    if (Test-ProcessRunning $existing) {
      Write-Warn2 "$Name already running (PID $existing). Skipping."
      return $existing
    }
    Write-Warn2 "$Name PID file stale (PID $existing not alive); removing."
    Remove-PidFile $Name
  }

  # 2. For master: detect port collision early.
  if ($Name -eq 'master') {
    $port = Get-MasterPort
    $owner = Get-PortOwner $port
    if ($owner) {
      Write-Fail "Port :$port already occupied by foreign PID $owner. Stop it first (pnpm stop:all, or taskkill)."
      throw "port_conflict"
    }
  }

  $pkg     = "@app/$Name"
  $logOut  = Get-LogFile $Name 'out'
  $logErr  = Get-LogFile $Name 'err'
  # Truncate previous logs on startup (operator wants a clean slate per run).
  Set-Content -Path $logOut -Value '' -Encoding utf8 -ErrorAction SilentlyContinue
  Set-Content -Path $logErr -Value '' -Encoding utf8 -ErrorAction SilentlyContinue

  $cmd = "pnpm --filter $pkg run start > `"$logOut`" 2> `"$logErr`""
  Write-Step "Starting $Name : $cmd"

  # Detach via cmd.exe /c so the process tree survives PowerShell exit.
  $proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', $cmd `
    -WorkingDirectory $script:RepoRoot `
    -WindowStyle Hidden -PassThru

  Save-Pid $Name $proc.Id
  Write-Ok "$Name spawned PID=$($proc.Id) (cmd.exe wrapper)"
  return $proc.Id
}

# ------ Start master (unless -OnlyWorker) ---------------------------------------------------------------------------------------------
if (-not $OnlyWorker) {
  Start-AppProcess 'master' | Out-Null
  Write-Step 'Waiting for master /health'
  $port = Get-MasterPort
  if (Wait-HttpOk -Url "http://127.0.0.1:$port/health" -TimeoutSec 30) {
    Write-Ok "master /health responding on :$port"
  } else {
    Write-Fail "master did not become healthy in 30s. Tail the log:"
    Write-Host "  Get-Content $(Get-LogFile master out) -Tail 40"
    Write-Host "  Get-Content $(Get-LogFile master err) -Tail 40"
    exit 1
  }
}

# ------ Start worker (unless -OnlyMaster) ---------------------------------------------------------------------------------------------
if (-not $OnlyMaster) {
  Start-AppProcess 'worker' | Out-Null
  # Worker has no HTTP surface; just give it a couple seconds + verify proc alive.
  Start-Sleep -Seconds 4
  $wpid = Read-PidFromFile 'worker'
  $alive = $false
  if ($wpid) {
    # The cmd.exe wrapper will exit if the child fails immediately; check log too.
    $errLog = Get-LogFile 'worker' 'err'
    if (Test-Path $errLog) {
      $errSize = (Get-Item $errLog).Length
      if ($errSize -gt 0) {
        Write-Warn2 "worker stderr non-empty:"
        Get-Content $errLog -Tail 10 | ForEach-Object { Write-Host "      $_" }
      }
    }
    $alive = Test-ProcessRunning $wpid
  }
  if ($alive) {
    Write-Ok "worker spawned (wrapper PID $wpid). Tail: Get-Content $(Get-LogFile worker out) -Tail 20"
  } else {
    Write-Warn2 "worker wrapper exited; that's OK if the child detached. Verify with: pnpm status"
  }
}

Write-Host ''
Write-Host '==> All requested services started. Use `pnpm status` to verify.' -ForegroundColor Green
