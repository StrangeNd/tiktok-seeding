[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"

$script:Candidates = @{}
$script:Killed = @()
$script:Skipped = @()
$script:Failed = @()
$script:PidFilesRemoved = @()

Write-Step 'Hard close TikTok Seeding runtime'

function Stop-ProcessTreeQuietly {
  param([Parameter(Mandatory)][int]$ProcessId)
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      $process.Kill()
      $null = $process.WaitForExit(500)
    }
  } catch { }
  if (-not (Test-ProcessRunning $ProcessId)) { return }
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    if (-not (Test-Path $taskkill)) { $taskkill = 'taskkill.exe' }
    $killer = Start-Process -FilePath $taskkill `
      -ArgumentList @('/F', '/T', '/PID', "$ProcessId") `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile
    if (-not $killer.WaitForExit(2000)) {
      try { $killer.Kill() } catch { }
    }
  } catch { } finally {
    Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Test-RepoOwnedRuntimeCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine) { return $false }
  $cmd = $CommandLine.ToLowerInvariant()
  $root = $script:RepoRoot.ToLowerInvariant()
  if (-not $cmd.Contains($root)) { return $false }
  foreach ($marker in @(
    'apps\master',
    'apps\worker',
    'apps/master',
    'apps/worker',
    'dist\index.js',
    'dist/index.js',
    'tsx src/index.ts'
  )) {
    if ($cmd.Contains($marker)) { return $true }
  }
  return $false
}

function Get-ProcessCommandLineWithTimeout {
  param([Parameter(Mandatory)][int]$ProcessId, [int]$TimeoutSec = 2)
  $name = 'unknown'
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
      return [pscustomobject]@{ Name = 'not running'; CommandLine = $null; Available = $false; Reason = 'process not running' }
    }
    $name = "$($process.ProcessName).exe"
  } catch {
    return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = $_.Exception.Message }
  }

  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $lookupScript = @"
`$id = $ProcessId
`$timeoutSec = $TimeoutSec
try {
  Add-Type -AssemblyName System.Management -ErrorAction SilentlyContinue
  `$options = New-Object System.Management.EnumerationOptions
  `$options.Timeout = [TimeSpan]::FromSeconds(`$timeoutSec)
  `$options.ReturnImmediately = `$true
  `$scope = New-Object System.Management.ManagementScope('\\.\root\cimv2')
  `$query = New-Object System.Management.ObjectQuery("SELECT Name, CommandLine FROM Win32_Process WHERE ProcessId = `$id")
  `$searcher = New-Object System.Management.ManagementObjectSearcher(`$scope, `$query, `$options)
  try {
    `$rows = @(`$searcher.Get())
    if (`$rows) {
      `$row = `$rows[0]
      [pscustomobject]@{ Name = [string]`$row.Name; CommandLine = [string]`$row.CommandLine; Error = `$null } | ConvertTo-Json -Compress
    } else {
      [pscustomobject]@{ Name = `$null; CommandLine = `$null; Error = 'process not found' } | ConvertTo-Json -Compress
    }
  } finally {
    if (`$searcher) { `$searcher.Dispose() }
  }
} catch {
  `$reason = `$_.Exception.Message
  if (`$_.Exception.InnerException -and `$_.Exception.InnerException.Message) { `$reason = `$_.Exception.InnerException.Message }
  [pscustomobject]@{ Name = `$null; CommandLine = `$null; Error = `$reason } | ConvertTo-Json -Compress
  exit 1
}
"@
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($lookupScript))
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path $powershell)) { $powershell = 'powershell.exe' }
    $lookupProcess = Start-Process -FilePath $powershell `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile
    if (-not $lookupProcess.WaitForExit([Math]::Max(1, $TimeoutSec) * 1000)) {
      Stop-ProcessTreeQuietly -ProcessId ([int]$lookupProcess.Id)
      return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = 'command line lookup timed out' }
    }
    $output = ''
    $errorText = ''
    if (Test-Path $outFile) { $output = Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $errFile) { $errorText = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue }
    $result = $null
    if ($output) {
      $result = $output | ConvertFrom-Json -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($result) {
      if ($result.Name) { $name = $result.Name }
      if ($result.CommandLine) {
        return [pscustomobject]@{ Name = $name; CommandLine = $result.CommandLine; Available = $true; Reason = $null }
      }
      if ($result.Error) {
        $reason = $result.Error
        if ($reason -match 'Access is denied') { $reason = 'access denied' }
        if ($reason -match 'timed out|timeout') { $reason = 'command line lookup timed out' }
        return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = $reason }
      }
    }
    if ($errorText) {
      $reason = $errorText.Trim()
      if ($reason -match 'Access is denied') { $reason = 'access denied' }
      if ($reason -match 'timed out|timeout') { $reason = 'command line lookup timed out' }
      return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = $reason }
    }
    return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = 'empty command line' }
  } catch {
    $reason = $_.Exception.Message
    if ($_.Exception.InnerException -and $_.Exception.InnerException.Message) { $reason = $_.Exception.InnerException.Message }
    if ($reason -match 'Access is denied') { $reason = 'access denied' }
    if ($reason -match 'timed out|timeout') { $reason = 'command line lookup timed out' }
    return [pscustomobject]@{ Name = $name; CommandLine = $null; Available = $false; Reason = $reason }
  } finally {
    Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Add-RepoOwnedCandidate {
  param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Source
  )
  $key = "$ProcessId"
  if ($script:Candidates.ContainsKey($key)) {
    $script:Candidates[$key].Sources = @($script:Candidates[$key].Sources) + $Source
    return
  }
  $script:Candidates[$key] = [pscustomobject]@{
    ProcessId = $ProcessId
    Name = $Name
    Sources = @($Source)
  }
  Write-Ok "queued repo-owned PID $ProcessId ($Name) from $Source"
}

function Test-ProcessIdForRepoRuntime {
  param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][string]$Source,
    [switch]$WarnWhenNotRepoOwned
  )
  if ($ProcessId -le 0) { return }
  $details = Get-ProcessCommandLineWithTimeout -ProcessId $ProcessId
  if ($details.Reason -eq 'process not running') {
    if ($WarnWhenNotRepoOwned) { Write-Warn2 "$Source PID $ProcessId is not running; left alone" }
    $script:Skipped += "$Source PID $ProcessId not running"
    return
  }
  if (-not $details.Available) {
    Write-Warn2 "Command line unavailable for $Source PID $ProcessId ($($details.Name)): $($details.Reason); left alone"
    $script:Skipped += "$Source PID $ProcessId command line unavailable"
    return
  }
  if (Test-RepoOwnedRuntimeCommandLine $details.CommandLine) {
    Add-RepoOwnedCandidate -ProcessId $ProcessId -Name $details.Name -Source $Source
    return
  }
  if ($WarnWhenNotRepoOwned) {
    Write-Warn2 "$Source PID $ProcessId ($($details.Name)) is not repo-owned; left alone"
  }
  $script:Skipped += "$Source PID $ProcessId not repo-owned"
}

function Get-ExecutableCommandLinesWithTimeout {
  param(
    [Parameter(Mandatory)][string]$ExecutableName,
    [int]$TimeoutSec = 8
  )
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $safeName = $ExecutableName.Replace("'", "''")
    $lookupScript = @"
`$exe = '$safeName'
try {
  Add-Type -AssemblyName System.Management -ErrorAction SilentlyContinue
  `$options = New-Object System.Management.EnumerationOptions
  `$options.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
  `$options.ReturnImmediately = `$true
  `$scope = New-Object System.Management.ManagementScope('\\.\root\cimv2')
  `$query = New-Object System.Management.ObjectQuery("SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE Name = '`$exe'")
  `$searcher = New-Object System.Management.ManagementObjectSearcher(`$scope, `$query, `$options)
  try {
    `$rows = @()
    foreach (`$row in `$searcher.Get()) {
      `$rows += [pscustomobject]@{
        ProcessId = [int]`$row.ProcessId
        Name = [string]`$row.Name
        CommandLine = [string]`$row.CommandLine
      }
    }
    [pscustomobject]@{ Error = `$null; Rows = @(`$rows) } | ConvertTo-Json -Compress -Depth 4
  } finally {
    if (`$searcher) { `$searcher.Dispose() }
  }
} catch {
  `$reason = `$_.Exception.Message
  if (`$_.Exception.InnerException -and `$_.Exception.InnerException.Message) { `$reason = `$_.Exception.InnerException.Message }
  [pscustomobject]@{ Error = `$reason; Rows = @() } | ConvertTo-Json -Compress -Depth 4
  exit 1
}
"@
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($lookupScript))
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path $powershell)) { $powershell = 'powershell.exe' }
    $lookupProcess = Start-Process -FilePath $powershell `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile
    if (-not $lookupProcess.WaitForExit([Math]::Max(1, $TimeoutSec) * 1000)) {
      Stop-ProcessTreeQuietly -ProcessId ([int]$lookupProcess.Id)
      return [pscustomobject]@{ TimedOut = $true; Error = 'command line scan timed out'; Rows = @() }
    }
    $output = ''
    $errorText = ''
    if (Test-Path $outFile) { $output = Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $errFile) { $errorText = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue }
    if ($output) {
      $payload = $output | ConvertFrom-Json -ErrorAction SilentlyContinue
      if ($payload) {
        $reason = $payload.Error
        if ($reason -match 'Access is denied') { $reason = 'access denied' }
        if ($reason -match 'timed out|timeout') { $reason = 'command line scan timed out' }
        return [pscustomobject]@{ TimedOut = $false; Error = $reason; Rows = @($payload.Rows) }
      }
    }
    if ($errorText) {
      $reason = $errorText.Trim()
      if ($reason -match 'Access is denied') { $reason = 'access denied' }
      if ($reason -match 'timed out|timeout') { $reason = 'command line scan timed out' }
      return [pscustomobject]@{ TimedOut = $false; Error = $reason; Rows = @() }
    }
    return [pscustomobject]@{ TimedOut = $false; Error = 'empty command line scan output'; Rows = @() }
  } catch {
    $reason = $_.Exception.Message
    if ($_.Exception.InnerException -and $_.Exception.InnerException.Message) { $reason = $_.Exception.InnerException.Message }
    if ($reason -match 'Access is denied') { $reason = 'access denied' }
    if ($reason -match 'timed out|timeout') { $reason = 'command line scan timed out' }
    return [pscustomobject]@{ TimedOut = $false; Error = $reason; Rows = @() }
  } finally {
    Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Find-ProcessNameCandidates {
  param(
    [Parameter(Mandatory)][string]$ExecutableName,
    [int]$ScanBudgetSec = 15
  )
  Write-Step "Scanning $ExecutableName"
  $scan = Get-ExecutableCommandLinesWithTimeout -ExecutableName $ExecutableName -TimeoutSec $ScanBudgetSec
  if ($scan.TimedOut) {
    Write-Warn2 "$ExecutableName command line scan timed out after ${ScanBudgetSec}s; left scan targets alone"
    $script:Skipped += "$ExecutableName scan timed out"
    return
  }
  if ($scan.Error) {
    Write-Warn2 "$ExecutableName command line scan unavailable: $($scan.Error); left scan targets alone"
    $script:Skipped += "$ExecutableName scan unavailable"
    return
  }
  $processes = @($scan.Rows | Sort-Object ProcessId)
  if (-not $processes) {
    Write-Host "  no $ExecutableName processes found"
    return
  }
  Write-Host "  found $($processes.Count) $ExecutableName process(es)"
  $unavailable = @()
  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    if (-not $process.CommandLine) {
      $unavailable += $processId
      $script:Skipped += "$ExecutableName scan PID $processId command line unavailable"
      continue
    }
    if (Test-RepoOwnedRuntimeCommandLine $process.CommandLine) {
      Add-RepoOwnedCandidate -ProcessId $processId -Name $process.Name -Source "$ExecutableName scan"
    } else {
      $script:Skipped += "$ExecutableName scan PID $processId not repo-owned"
    }
  }
  if ($unavailable) {
    $sample = @($unavailable | Select-Object -First 10) -join ', '
    $suffix = if ($unavailable.Count -gt 10) { " and $($unavailable.Count - 10) more" } else { '' }
    Write-Warn2 "$ExecutableName command line unavailable for PID(s): $sample$suffix; left alone"
  }
}

function Invoke-TaskkillWithTimeout {
  param([Parameter(Mandatory)][int]$ProcessId, [int]$TimeoutSec = 5)
  $result = [pscustomobject]@{ TimedOut = $false; Output = ''; Error = $null }
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    if (-not (Test-Path $taskkill)) { $taskkill = 'taskkill.exe' }
    $process = Start-Process -FilePath $taskkill `
      -ArgumentList @('/F', '/T', '/PID', "$ProcessId") `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile
    if (-not $process.WaitForExit($TimeoutSec * 1000)) {
      $result.TimedOut = $true
      try { $process.Kill() } catch { }
    }
    $chunks = @()
    if (Test-Path $outFile) { $chunks += Get-Content $outFile -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $errFile) { $chunks += Get-Content $errFile -Raw -ErrorAction SilentlyContinue }
    $result.Output = ($chunks -join "`n")
  } catch {
    $result.Error = $_.Exception.Message
  } finally {
    Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
  return $result
}

function Stop-RepoOwnedCandidate {
  param([Parameter(Mandatory)]$Candidate)
  $processId = [int]$Candidate.ProcessId
  if (-not (Test-ProcessRunning $processId)) {
    $script:Skipped += "PID $processId already stopped"
    return
  }
  Write-Warn2 "Killing repo-owned runtime PID=$processId name=$($Candidate.Name) sources=$(@($Candidate.Sources) -join ', ')"
  $taskkill = Invoke-TaskkillWithTimeout -ProcessId $processId
  Start-Sleep -Milliseconds 300
  if (-not (Test-ProcessRunning $processId)) {
    $script:Killed += "$($Candidate.Name) PID $processId"
    return
  }
  if ($taskkill.TimedOut) {
    Write-Fail "taskkill timed out for PID $processId"
  } elseif ($taskkill.Output -match 'Access is denied') {
    Write-Fail "Access denied killing PID $processId"
  } elseif ($taskkill.Error) {
    Write-Fail "taskkill failed for PID ${processId}: $($taskkill.Error)"
  } else {
    Write-Fail "PID $processId is still running after taskkill"
  }
  Write-Host "  recommended admin command: taskkill /F /T /PID $processId" -ForegroundColor Yellow
  $script:Failed += "$($Candidate.Name) PID $processId"
}

Write-Step 'Reading PID files'
foreach ($name in 'master', 'worker') {
  $pidFromFile = Read-PidFromFile $name
  if ($pidFromFile) {
    Write-Host "  $name PID file: $pidFromFile"
    Test-ProcessIdForRepoRuntime -ProcessId ([int]$pidFromFile) -Source "$name PID file" -WarnWhenNotRepoOwned
  } else {
    Write-Host "  $name PID file: none"
  }
}

Find-ProcessNameCandidates 'node.exe' -ScanBudgetSec 20
Find-ProcessNameCandidates 'cmd.exe' -ScanBudgetSec 10
Find-ProcessNameCandidates 'powershell.exe' -ScanBudgetSec 10
Find-ProcessNameCandidates 'pwsh.exe' -ScanBudgetSec 10

Write-Step 'Checking ports'
foreach ($port in Get-RuntimePorts) {
  $owners = @(Get-PortOwners $port)
  if (-not $owners) {
    Write-Host "  :$port no listener"
    continue
  }
  foreach ($owner in $owners) {
    Write-Host "  :$port listener PID $owner"
    Test-ProcessIdForRepoRuntime -ProcessId ([int]$owner) -Source "port :$port" -WarnWhenNotRepoOwned
  }
}

Write-Step 'Stopping repo-owned runtime candidates'
if ($script:Candidates.Count -eq 0) {
  Write-Ok 'no repo-owned runtime process found'
} else {
  foreach ($candidate in $script:Candidates.Values) {
    Stop-RepoOwnedCandidate $candidate
  }
}

Write-Step 'Cleaning PID files'
$pidFiles = @(Get-ChildItem -Path $script:RuntimeDir -Filter '*.pid' -File -ErrorAction SilentlyContinue)
if (-not $pidFiles) {
  Write-Host '  no PID files found'
} else {
  foreach ($file in $pidFiles) {
    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    $script:PidFilesRemoved += $file.Name
    Write-Ok "removed $($file.Name)"
  }
}

Write-Step 'Checking ports after close'
foreach ($port in Get-RuntimePorts) {
  $owners = @(Get-PortOwners $port)
  if (-not $owners) {
    Write-Ok "port :$port free"
    continue
  }
  foreach ($owner in $owners) {
    $details = Get-ProcessCommandLineWithTimeout -ProcessId ([int]$owner)
    if ($details.Available -and (Test-RepoOwnedRuntimeCommandLine $details.CommandLine)) {
      Write-Fail "port :$port still held by repo-owned PID $owner"
      Write-Host "  recommended admin command: taskkill /F /T /PID $owner" -ForegroundColor Yellow
      $script:Failed += "port :$port PID $owner"
    } else {
      $reason = if ($details.Available) { 'foreign process' } else { "command line unavailable: $($details.Reason)" }
      Write-Warn2 "port :$port held by PID $owner ($reason); left alone"
    }
  }
}

Write-Host ''
Write-Host '------ close summary ------' -ForegroundColor Cyan
if ($script:Killed) { $script:Killed | Sort-Object -Unique | ForEach-Object { Write-Ok "killed $_" } } else { Write-Ok 'no processes killed' }
if ($script:PidFilesRemoved) { $script:PidFilesRemoved | Sort-Object -Unique | ForEach-Object { Write-Ok "removed PID file $_" } } else { Write-Ok 'no PID files removed' }
if ($script:Skipped) { $script:Skipped | Sort-Object -Unique | ForEach-Object { Write-Warn2 "skipped $_" } }
if ($script:Failed) {
  $script:Failed | Sort-Object -Unique | ForEach-Object { Write-Fail "failed $_" }
  Write-Host ''
  Write-Host '==> Close completed with failures.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '==> Close complete.' -ForegroundColor Green
exit 0
