[CmdletBinding()]
param(
  [string]$Branch = 'main',
  [switch]$SkipBackup
)

. "$PSScriptRoot\_common.ps1"
Set-Location $script:RepoRoot

if (-not $SkipBackup) {
  Write-Step 'Pre-update backup'
  & "$PSScriptRoot\backup.ps1"
  if ($LASTEXITCODE -ne 0) { Write-Warn2 'Backup failed; continuing only if operator explicitly reruns with -SkipBackup'; exit $LASTEXITCODE }
}

Write-Step 'Fetching latest code'
git fetch origin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$current = (git branch --show-current).Trim()
if ($current -ne $Branch) {
  Write-Fail "Current branch is '$current', expected '$Branch'. Switch branches manually before updating."
  exit 1
}

Write-Step "Fast-forwarding $Branch from origin/$Branch"
git pull --ff-only origin $Branch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Installing dependencies'
pnpm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Building dashboard and server packages'
pnpm build:dashboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm build:server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Applying migrations'
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host '==> Update complete. Run pnpm restart:all when ready.' -ForegroundColor Green
