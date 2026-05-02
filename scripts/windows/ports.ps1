[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"

function Get-ListeningPids {
  param([Parameter(Mandatory)][int]$Port)
  $owners = @()
  try {
    $lines = & netstat.exe -ano 2>$null
  } catch {
    return @()
  }
  foreach ($line in $lines) {
    $parts = ([string]$line).Trim() -split '\s+'
    if ($parts.Count -lt 5) { continue }
    if ($parts[0] -ne 'TCP') { continue }
    $localAddress = $parts[1]
    $state = $parts[$parts.Count - 2]
    if ($state -ne 'LISTENING') { continue }
    if (-not $localAddress.EndsWith(":$Port")) { continue }
    $pidText = $parts[$parts.Count - 1]
    $parsedPid = 0
    if ([int]::TryParse($pidText, [ref]$parsedPid)) { $owners += $parsedPid }
  }
  return @($owners | Sort-Object -Unique)
}

function Get-ProcessDetails {
  param([Parameter(Mandatory)][int]$ProcessId)
  $details = [pscustomobject]@{
    Name = 'unavailable'
    CommandLine = 'unavailable'
  }
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) { $details.Name = "$($process.ProcessName).exe" }
  } catch {
  }
  $job = $null
  try {
    $job = Start-Job -ScriptBlock {
      param([int]$Id)
      Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -Property Name, CommandLine
    } -ArgumentList $ProcessId
    if (Wait-Job $job -Timeout 2) {
      $result = Receive-Job $job -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($result) {
        if ($result.Name) { $details.Name = $result.Name }
        if ($result.CommandLine) { $details.CommandLine = $result.CommandLine }
      }
    } else {
      Stop-Job $job -ErrorAction SilentlyContinue
    }
  } catch {
  } finally {
    if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
  }
  return $details
}

function Test-RepoOwnedCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine -or $CommandLine -eq 'unavailable') { return $false }
  if (-not $CommandLine.Contains($script:RepoRoot)) { return $false }
  foreach ($marker in @(
    'apps\master',
    'apps\worker',
    'apps/master',
    'apps/worker',
    'dist\index.js',
    'dist/index.js',
    'tsx src/index.ts'
  )) {
    if ($CommandLine.Contains($marker)) { return $true }
  }
  return $false
}

function Format-SafeCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine) { return 'unavailable' }
  $safe = $CommandLine
  foreach ($name in @(
    'MASTER_API_KEY',
    'AUTH_SESSION_SECRET',
    'CREDENTIALS_ENCRYPTION_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'GPM_API_KEY'
  )) {
    $safe = [regex]::Replace($safe, "(?i)\b$name\s*=\s*(`"[^`"]*`"|'[^']*'|\S+)", "$name=<redacted>")
  }
  return $safe
}

Write-Step 'Runtime port diagnostics'
foreach ($port in Get-RuntimePorts) {
  Write-Host ''
  Write-Host "------ port :$port ------" -ForegroundColor Cyan
  $owners = @(Get-ListeningPids $port)
  if (-not $owners) {
    Write-Host '  no listener'
    continue
  }
  foreach ($owner in $owners) {
    $details = Get-ProcessDetails $owner
    $repoOwned = Test-RepoOwnedCommandLine $details.CommandLine
    $repoOwnedText = if ($repoOwned) { 'yes' } else { 'no' }
    Write-Host "  listener PID: $owner"
    Write-Host "  name: $($details.Name)"
    Write-Host "  repo-owned: $repoOwnedText"
    Write-Host "  command: $(Format-SafeCommandLine $details.CommandLine)"
    if ($repoOwned) {
      Write-Host '  recommended action: safe to kill via pnpm close:all' -ForegroundColor Yellow
    } else {
      Write-Host '  recommended action: foreign process; left alone' -ForegroundColor Yellow
    }
  }
}

exit 0
