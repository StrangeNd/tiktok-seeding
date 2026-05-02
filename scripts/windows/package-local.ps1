[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"
Set-Location $script:RepoRoot

function Copy-RequiredItem {
  param(
    [Parameter(Mandatory)][string]$RelativePath,
    [Parameter(Mandatory)][string]$DestinationRoot
  )
  $src = Join-Path $script:RepoRoot $RelativePath
  if (-not (Test-Path $src)) { throw "Required release input missing: $RelativePath" }
  $dst = Join-Path $DestinationRoot $RelativePath
  $parent = Split-Path -Parent $dst
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -Path $src -Destination $dst -Recurse -Force
}

function Assert-ReleaseDoesNotContain {
  param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string[]]$RelativePaths
  )
  foreach ($rel in $RelativePaths) {
    if (Test-Path (Join-Path $ReleasePath $rel)) {
      throw "Release package contains forbidden path: $rel"
    }
  }
}

Write-Step 'Building local release artifacts'
pnpm build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$releaseRoot = Join-Path $script:RepoRoot '.releases'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releasePath = Join-Path $releaseRoot "tiktok-seeding-$stamp"
if (Test-Path $releasePath) { throw "Release path already exists: $releasePath" }
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null

$requiredItems = @(
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.env.example',
  'apps\master\package.json',
  'apps\master\dist',
  'apps\worker\package.json',
  'apps\worker\dist',
  'apps\dashboard\package.json',
  'apps\dashboard\dist',
  'packages\shared\package.json',
  'packages\shared\dist',
  'packages\gpm-client\package.json',
  'packages\gpm-client\dist',
  'packages\tiktok-actions\package.json',
  'packages\tiktok-actions\dist',
  'scripts\windows',
  'ecosystem.config.cjs',
  'ecosystem.master.config.cjs',
  'ecosystem.worker.config.cjs',
  'docs\PRODUCT_RUNBOOK.md',
  'docs\DASHBOARD.md',
  'docs\RUNBOOK_WINDOWS.md'
)

foreach ($item in $requiredItems) {
  Copy-RequiredItem -RelativePath $item -DestinationRoot $releasePath
}

$schemaDoc = Join-Path $script:RepoRoot 'docs\SCHEMA.md'
if (Test-Path $schemaDoc) {
  Copy-RequiredItem -RelativePath 'docs\SCHEMA.md' -DestinationRoot $releasePath
}

New-Item -ItemType Directory -Force -Path (Join-Path $releasePath '.secrets') | Out-Null
if (Test-Path (Join-Path $script:RepoRoot '.secrets\README.md')) {
  Copy-RequiredItem -RelativePath '.secrets\README.md' -DestinationRoot $releasePath
}
Get-ChildItem -Path (Join-Path $script:RepoRoot '.secrets') -Filter '*.example.txt' -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    Copy-RequiredItem -RelativePath (Join-Path '.secrets' $_.Name) -DestinationRoot $releasePath
  }

$forbidden = @(
  '.git',
  '.env',
  '.env.local',
  '.runtime',
  '.backups',
  '.local-backup',
  'node_modules',
  '.secrets\accounts.txt',
  '.secrets\proxies.txt',
  'apps\master\src',
  'apps\worker\src',
  'apps\dashboard\src',
  'packages\shared\src',
  'packages\gpm-client\src',
  'packages\tiktok-actions\src'
)
Assert-ReleaseDoesNotContain -ReleasePath $releasePath -RelativePaths $forbidden

$secretFiles = Get-ChildItem -Path (Join-Path $releasePath '.secrets') -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne 'README.md' -and $_.Name -notlike '*.example.txt' }
if ($secretFiles) {
  throw 'Release package contains non-example .secrets files'
}

$manifest = [ordered]@{
  createdAt = (Get-Date).ToString('o')
  name = Split-Path -Leaf $releasePath
  runtime = 'compiled node dist'
  dashboard = 'apps/dashboard/dist'
  master = 'apps/master/dist'
  worker = 'apps/worker/dist'
  excludes = $forbidden
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $releasePath 'release-manifest.json') -Encoding utf8

Write-Host ''
Write-Host "==> Local release package written: $releasePath" -ForegroundColor Green
Write-Host 'Install dependencies inside the release folder, copy .env.example to .env, edit secrets locally, then run pnpm start:all.'
