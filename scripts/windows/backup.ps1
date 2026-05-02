[CmdletBinding()]
param(
  [switch]$IncludeLogs
)

. "$PSScriptRoot\_common.ps1"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Get-BackupRoot
$backupDir = Join-Path $backupRoot $stamp
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Step "Creating backup: $backupDir"

$manifest = [ordered]@{
  createdAt = (Get-Date).ToString('o')
  repoRoot = $script:RepoRoot
  files = @()
  database = $null
}

if (Test-Path $script:EnvPath) {
  Copy-Item $script:EnvPath (Join-Path $backupDir '.env') -Force
  $manifest.files += '.env'
  Write-Ok '.env copied to backup (contents not printed)'
} else {
  Write-Warn2 '.env not found; skipping'
}

$secretsDir = Join-Path $script:RepoRoot '.secrets'
if (Test-Path $secretsDir) {
  Copy-Item $secretsDir (Join-Path $backupDir '.secrets') -Recurse -Force
  $manifest.files += '.secrets/'
  Write-Ok '.secrets copied to backup (contents not printed)'
} else {
  Write-Warn2 '.secrets not found; skipping'
}

if ($IncludeLogs -and (Test-Path $script:RuntimeDir)) {
  Copy-Item $script:RuntimeDir (Join-Path $backupDir '.runtime') -Recurse -Force
  $manifest.files += '.runtime/'
  Write-Ok '.runtime logs copied to backup'
}

$envMap = Get-EnvMap
if ($envMap.ContainsKey('DATABASE_URL') -and $envMap['DATABASE_URL'] -match '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$') {
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $dumpPath = Join-Path $backupDir 'postgres.dump'
  $env:PGPASSWORD = $pgPass
  & pg_dump -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Fc -f $dumpPath 2>$null
  $pgExit = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($pgExit -eq 0 -and (Test-Path $dumpPath)) {
    $manifest.database = 'postgres.dump'
    Write-Ok 'Postgres database dumped to postgres.dump'
  } else {
    Write-Warn2 'pg_dump failed or is unavailable; database backup was skipped'
  }
} else {
  Write-Warn2 'DATABASE_URL missing or unparseable; database backup skipped'
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $backupDir 'manifest.json') -Encoding utf8
Write-Host ''
Write-Host "==> Backup complete: $backupDir" -ForegroundColor Green
