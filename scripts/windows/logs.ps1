[CmdletBinding()]
param(
  [ValidateSet('master','worker','all')][string]$Service = 'all',
  [int]$Tail = 80,
  [switch]$Follow
)

. "$PSScriptRoot\_common.ps1"

$services = if ($Service -eq 'all') { @('master','worker') } else { @($Service) }
foreach ($name in $services) {
  foreach ($stream in 'out','err') {
    $path = Get-LogFile $name $stream
    $label = if ($stream -eq 'err') { "$name.err.log" } else { "$name.log" }
    Write-Host ""
    Write-Host "------ $label : $path ------" -ForegroundColor Cyan
    if (Test-Path $path) {
      if ($Follow) {
        Get-Content $path -Tail $Tail -Wait
      } else {
        Get-Content $path -Tail $Tail
      }
    } else {
      Write-Host 'No log file yet.'
    }
  }
}
