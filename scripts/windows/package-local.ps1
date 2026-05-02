[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"
Set-Location $script:RepoRoot

Write-Step 'Building local release artifacts'
pnpm build:dashboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm build:server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$releaseRoot = Join-Path $script:RepoRoot '.releases'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$manifestPath = Join-Path $releaseRoot "local-package-$stamp.json"

$manifest = [ordered]@{
  createdAt = (Get-Date).ToString('o')
  dashboard = 'apps/dashboard/dist'
  master = 'apps/master/dist'
  worker = 'apps/worker/dist'
  note = 'Source checkout plus built artifacts. Do not distribute .env or .secrets.'
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding utf8

Write-Host ''
Write-Host "==> Local package manifest written: $manifestPath" -ForegroundColor Green
Write-Host 'Use this checkout with pnpm setup:win/start:all; .env and .secrets remain local and are not packaged.'
