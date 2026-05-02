[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$BackupPath,
  [switch]$RestoreEnv,
  [switch]$RestoreSecrets,
  [switch]$RestoreDatabase
)

. "$PSScriptRoot\_common.ps1"

$resolved = (Resolve-Path $BackupPath).Path
Write-Step "Restore source: $resolved"

if (-not ($RestoreEnv -or $RestoreSecrets -or $RestoreDatabase)) {
  Write-Fail 'Choose at least one restore option: -RestoreEnv, -RestoreSecrets, or -RestoreDatabase.'
  exit 1
}

if ($RestoreEnv) {
  $src = Join-Path $resolved '.env'
  if (-not (Test-Path $src)) { Write-Fail '.env not found in backup'; exit 1 }
  if (Test-Path $script:EnvPath) {
    Copy-Item $script:EnvPath "$script:EnvPath.before-restore" -Force
    Write-Warn2 'Existing .env copied to .env.before-restore'
  }
  Copy-Item $src $script:EnvPath -Force
  Write-Ok '.env restored (contents not printed)'
}

if ($RestoreSecrets) {
  $src = Join-Path $resolved '.secrets'
  $dest = Join-Path $script:RepoRoot '.secrets'
  if (-not (Test-Path $src)) { Write-Fail '.secrets not found in backup'; exit 1 }
  if (Test-Path $dest) {
    $safeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item $dest "$dest.before-restore-$safeStamp" -Recurse -Force
    Write-Warn2 "Existing .secrets copied to .secrets.before-restore-$safeStamp"
  }
  Copy-Item $src $dest -Recurse -Force
  Write-Ok '.secrets restored (contents not printed)'
}

if ($RestoreDatabase) {
  $dump = Join-Path $resolved 'postgres.dump'
  if (-not (Test-Path $dump)) { Write-Fail 'postgres.dump not found in backup'; exit 1 }
  $envMap = Get-EnvMap
  if (-not ($envMap.ContainsKey('DATABASE_URL') -and $envMap['DATABASE_URL'] -match '^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(\S+?)(?:\?.*)?$')) {
    Write-Fail 'DATABASE_URL missing or unparseable; cannot restore database'
    exit 1
  }
  $pgUser=$matches[1]; $pgPass=$matches[2]; $pgHost=$matches[3]; $pgPort=$matches[4]; $pgDb=$matches[5]
  $env:PGPASSWORD = $pgPass
  & pg_restore -h $pgHost -p $pgPort -U $pgUser -d $pgDb --clean --if-exists $dump
  $restoreExit = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($restoreExit -ne 0) { Write-Fail 'pg_restore failed'; exit $restoreExit }
  Write-Ok 'Postgres database restored from postgres.dump'
}

Write-Host ''
Write-Host '==> Restore complete.' -ForegroundColor Green
