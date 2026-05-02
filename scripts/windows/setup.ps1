[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipMigrate
)

. "$PSScriptRoot\_common.ps1"

Write-Step 'Windows operator setup'
Set-Location $script:RepoRoot

if (-not (Test-Path $script:EnvPath)) {
  Copy-Item (Join-Path $script:RepoRoot '.env.example') $script:EnvPath
  Write-Warn2 '.env created from .env.example. Edit secrets before production use.'
} else {
  Write-Ok '.env already exists; leaving it unchanged'
}

if (-not $SkipInstall) {
  Write-Step 'Installing dependencies'
  & pnpm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Step 'Building dashboard and server packages'
& pnpm build:dashboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& pnpm build:server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipMigrate) {
  Write-Step 'Applying database migrations'
  & pnpm db:migrate
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Step 'Running doctor'
& pnpm doctor
exit $LASTEXITCODE
