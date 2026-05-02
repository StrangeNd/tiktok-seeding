[CmdletBinding()]
param(
  [switch]$Force
)

. "$PSScriptRoot\_common.ps1"

Write-Step 'Cleaning runtime files'

$live = @()
foreach ($name in 'master','worker') {
  $procId = Read-PidFromFile $name
  if ($procId -and (Test-ProcessRunning $procId)) { $live += "$name PID $procId" }
}

if ($live.Count -gt 0 -and -not $Force) {
  Write-Fail "Services appear to be running: $($live -join ', '). Run pnpm stop:all first or pass -Force."
  exit 1
}

if (Test-Path $script:RuntimeDir) {
  Get-ChildItem $script:RuntimeDir -Force | Remove-Item -Recurse -Force
  Write-Ok ".runtime contents removed"
} else {
  Write-Ok '.runtime does not exist'
}
