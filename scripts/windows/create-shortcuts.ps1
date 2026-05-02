. "$PSScriptRoot\_common.ps1"

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-OperatorShortcut {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Command
  )
  $path = Join-Path $desktop "$Name.lnk"
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location -LiteralPath '$RepoRoot'; $Command`""
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.IconLocation = 'powershell.exe,0'
  $shortcut.Save()
  Write-Host "Created $path"
}

New-OperatorShortcut -Name 'Start TikTok Seeding' -Command 'pnpm start:all; pause'
New-OperatorShortcut -Name 'Stop TikTok Seeding' -Command 'pnpm stop:all; pause'
New-OperatorShortcut -Name 'Restart TikTok Seeding' -Command 'pnpm restart:all; pause'
New-OperatorShortcut -Name 'TikTok Seeding Logs' -Command 'pnpm logs; pause'
New-OperatorShortcut -Name 'TikTok Seeding Backup' -Command 'pnpm backup; pause'

$dashboard = Join-Path $desktop 'Open TikTok Seeding Dashboard.lnk'
$url = Get-MasterBaseUrl
$shortcut = $shell.CreateShortcut($dashboard)
$shortcut.TargetPath = "$env:SystemRoot\System32\cmd.exe"
$shortcut.Arguments = "/c start $url/dashboard/"
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.Save()
Write-Host "Created $dashboard"
Write-Host 'Shortcuts created. No secrets were embedded.'