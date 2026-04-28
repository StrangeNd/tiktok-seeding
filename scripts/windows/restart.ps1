# scripts/windows/restart.ps1 --- stop + start, all in one.
#
# Usage:  pnpm restart:all
#   -SkipDoctor   forwarded to start.ps1
#   -Force        force-kill on stop

[CmdletBinding()]
param(
  [switch]$SkipDoctor,
  [switch]$Force
)

. "$PSScriptRoot\_common.ps1"

Write-Step 'Restart: stopping...'
& "$PSScriptRoot\stop.ps1" -Force:$Force

Start-Sleep -Seconds 1

Write-Step 'Restart: starting...'
$startArgs = @()
if ($SkipDoctor) { $startArgs += '-SkipDoctor' }
& "$PSScriptRoot\start.ps1" @startArgs
exit $LASTEXITCODE
