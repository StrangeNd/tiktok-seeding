# scripts/windows/start.ps1 --- start master + worker as detached processes.
#
# Usage:  pnpm start:all
#   -OnlyMaster   start just the master
#   -OnlyWorker   start just the worker (master must already be up)
#   -SkipDoctor   skip pre-flight checks (faster restart)
#   -Dev          run tsx source runtime instead of compiled dist runtime
#
# Behavior:
#   - Refuses to start if PID file exists AND that PID is alive (idempotent).
#   - Cleans stale PID files for dead processes.
#   - Detects port :7000 occupied by a foreign process and aborts with guidance.
#   - Production/default mode runs compiled JavaScript with node.
#   - Streams output into .runtime\<name>.log and .runtime\<name>.err.log.
#   - Waits for /health 200 before declaring master ready.

[CmdletBinding()]
param(
  [switch]$OnlyMaster,
  [switch]$OnlyWorker,
  [switch]$SkipDoctor,
  [switch]$Dev
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

function Assert-RequiredBuilds {
  if ($Dev) { return }
  $required = @(
    'apps\dashboard\dist\index.html',
    'apps\master\dist\index.js',
    'apps\worker\dist\index.js',
    'packages\shared\dist\index.js',
    'packages\gpm-client\dist\index.js',
    'packages\tiktok-actions\dist\index.js'
  )
  foreach ($rel in $required) {
    $full = Join-Path $script:RepoRoot $rel
    if (-not (Test-Path $full)) {
      Write-Fail "Missing compiled runtime artifact: $rel"
      Write-Host 'Run `pnpm build` before `pnpm start:all`, or use `pnpm start:all:dev` for source/dev mode.' -ForegroundColor Yellow
      exit 1
    }
  }
}

Assert-RequiredBuilds

function Assert-PortReadyForStart {
  $port = Get-MasterPort
  Save-RuntimePort $port
  $reports = @(Get-PortReport $port)
  if (-not $reports) {
    Write-Ok "Port :$port free"
    return
  }
  foreach ($row in $reports) {
    if ($row.RepoOwned) {
      Write-Warn2 "Port :$port held by repo-owned stale PID $($row.ProcessId); clearing before start"
      $proc = Get-ProcessInfo $row.ProcessId
      Stop-RepoRuntimeProcess $proc | Out-Null
    } else {
      Write-Fail "Port :$port held by foreign PID $($row.ProcessId); refusing to start"
      Write-Host "  $($row.CommandLine)"
      exit 1
    }
  }
  Start-Sleep -Seconds 1
  $remaining = @(Get-PortReport $port)
  foreach ($row in $remaining) {
    if ($row.RepoOwned) {
      Write-Fail "Port :$port still held by repo-owned PID $($row.ProcessId) after cleanup"
      exit 1
    }
    Write-Fail "Port :$port still held by foreign PID $($row.ProcessId); refusing to start"
    Write-Host "  $($row.CommandLine)"
    exit 1
  }
  Write-Ok "Port :$port free"
}

function Assert-MasterPortOwnedByThisRuntime {
  $port = Get-MasterPort
  $reports = @(Get-PortReport $port)
  if (-not $reports) {
    Write-Fail "Port :$port is not listening after master start"
    exit 1
  }
  $repoOwners = @($reports | Where-Object { $_.RepoOwned })
  if (-not $repoOwners) {
    foreach ($row in $reports) {
      Write-Fail "Port :$port owned by foreign PID $($row.ProcessId)"
      Write-Host "  $($row.CommandLine)"
    }
    exit 1
  }
  foreach ($row in $repoOwners) {
    if ($Dev -or $row.CommandLine -match 'apps[\\/]master[\\/]dist[\\/]index\.js') {
      Write-Ok "Port :$port owner PID $($row.ProcessId) belongs to this repo"
      return
    }
  }
  foreach ($row in $repoOwners) {
    Write-Fail "Port :$port repo-owned PID $($row.ProcessId) is not the expected compiled master runtime"
    Write-Host "  $($row.CommandLine)"
  }
  exit 1
}

function Start-AppProcess {
  param(
    [Parameter(Mandatory)][ValidateSet('master', 'worker')][string]$Name
  )

  $existing = Read-PidFromFile $Name
  if ($existing) {
    if (Test-ProcessRunning $existing) {
      $proc = Get-ProcessInfo $existing
      if (Test-RepoOwnedRuntimeProcess $proc) {
        Write-Warn2 "$Name PID file points at live repo-owned PID $existing; stopping stale runtime first"
        Stop-RepoRuntimeProcess $proc | Out-Null
      } else {
        Write-Fail "$Name PID file points at live foreign PID $existing; refusing to start"
        exit 1
      }
    } else {
      Write-Warn2 "$Name PID file stale (PID $existing not alive); removing."
    }
    Remove-PidFile $Name
  }

  if ($Name -eq 'master') {
    Assert-PortReadyForStart
  }

  $logOut  = Get-LogFile $Name 'out'
  $logErr  = Get-LogFile $Name 'err'
  Set-Content -Path $logOut -Value '' -Encoding utf8 -ErrorAction SilentlyContinue
  Set-Content -Path $logErr -Value '' -Encoding utf8 -ErrorAction SilentlyContinue

  if ($Dev) {
    $pkg = "@app/$Name"
    $cmd = "pnpm --filter $pkg run start:dev > `"$logOut`" 2> `"$logErr`""
  } else {
    $entry = Join-Path $script:RepoRoot "apps\$Name\dist\index.js"
    $cmd = "set NODE_ENV=production&& node `"$entry`" > `"$logOut`" 2> `"$logErr`""
  }
  Write-Step "Starting $Name : $cmd"

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
    Assert-MasterPortOwnedByThisRuntime
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
Write-Host "==> Dashboard: http://127.0.0.1:$(Get-MasterPort)/dashboard/" -ForegroundColor Green
