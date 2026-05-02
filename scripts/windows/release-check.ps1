[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"
Set-Location $script:RepoRoot

function Assert-PathExists {
  param([Parameter(Mandatory)][string]$RelativePath)
  if (-not (Test-Path (Join-Path $script:RepoRoot $RelativePath))) {
    Write-Fail "Missing required path: $RelativePath"
    exit 1
  }
}

function Assert-PathMissing {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$RelativePath
  )
  if (Test-Path (Join-Path $Root $RelativePath)) {
    Write-Fail "Forbidden path found in release package: $RelativePath"
    exit 1
  }
}

Write-Step 'Release check: package.json'
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: conflict markers'
git grep -n -E "^(<<<<<<<|=======|>>>>>>>)" -- . ":!node_modules"
if ($LASTEXITCODE -eq 0) {
  Write-Fail 'Conflict markers found'
  exit 1
}

Write-Step 'Release check: local secret files are not tracked'
$trackedSecrets = git ls-files '.env' '.env.local' '.secrets/accounts.txt' '.secrets/proxies.txt' '.runtime' '.backups' '.releases'
if ($trackedSecrets) {
  Write-Fail 'Tracked secret/runtime paths found. Remove them from git before release.'
  exit 1
}
$secretDiff = git diff --name-only -- '.env' '.env.local' '.secrets/accounts.txt' '.secrets/proxies.txt'
if ($secretDiff) {
  Write-Fail 'Working tree has changes in secret paths. Secret contents were not printed.'
  exit 1
}
$stagedSecretDiff = git diff --cached --name-only -- '.env' '.env.local' '.secrets/accounts.txt' '.secrets/proxies.txt'
if ($stagedSecretDiff) {
  Write-Fail 'Staged changes include secret paths. Secret contents were not printed.'
  exit 1
}

Write-Step 'Release check: install'
pnpm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: typecheck'
pnpm typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: lint'
pnpm lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: dashboard build'
pnpm build:dashboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: server build'
pnpm build:server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: compiled artifacts exist'
foreach ($rel in @(
  'apps\dashboard\dist\index.html',
  'apps\master\dist\index.js',
  'apps\worker\dist\index.js',
  'packages\shared\dist\index.js',
  'packages\gpm-client\dist\index.js',
  'packages\tiktok-actions\dist\index.js'
)) {
  Assert-PathExists $rel
}

Write-Step 'Release check: PM2 configs use compiled dist runtime'
foreach ($cfg in @('ecosystem.config.cjs','ecosystem.master.config.cjs','ecosystem.worker.config.cjs')) {
  $text = Get-Content (Join-Path $script:RepoRoot $cfg) -Raw
  if ($text -match 'tsx|src/index\.ts|--filter @app/.+ run start|interpreter:\s*''none''') {
    Write-Fail "$cfg still references dev/source runtime"
    exit 1
  }
  if ($text -notmatch 'dist/index\.js' -or $text -notmatch "interpreter:\s*'node'") {
    Write-Fail "$cfg does not clearly point to node dist runtime"
    exit 1
  }
}

Write-Step 'Release check: package local release'
pnpm package:local
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$latestRelease = Get-ChildItem -Path (Join-Path $script:RepoRoot '.releases') -Directory -Filter 'tiktok-seeding-*' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $latestRelease) {
  Write-Fail 'No release folder was created'
  exit 1
}

Write-Step "Release check: package exclusions ($($latestRelease.Name))"
foreach ($rel in @(
  'apps\master\drizzle\0002_magenta_manta.sql',
  'scripts\windows\create-shortcuts.ps1',
  'scripts\windows\close.ps1',
  'scripts\windows\ports.ps1',
  'scripts\windows\pm2-start.ps1',
  'scripts\windows\pm2-stop.ps1',
  'scripts\windows\pm2-status.ps1',
  'scripts\windows\pm2-logs.ps1',
  'scripts\windows\pm2-remove.ps1'
)) {
  if (-not (Test-Path (Join-Path $latestRelease.FullName $rel))) {
    Write-Fail "Release package is missing required path: $rel"
    exit 1
  }
}
foreach ($rel in @(
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
  'packages\shared\src',
  'packages\gpm-client\src',
  'packages\tiktok-actions\src'
)) {
  Assert-PathMissing -Root $latestRelease.FullName -RelativePath $rel
}

Write-Host ''
Write-Host '==> Release check passed.' -ForegroundColor Green
