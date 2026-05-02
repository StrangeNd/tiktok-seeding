[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"
Set-Location $script:RepoRoot

Write-Step 'Release check: package.json'
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Release check: conflict markers'
git grep -n -E "^(<<<<<<<|=======|>>>>>>>)" -- . ":!node_modules"
if ($LASTEXITCODE -eq 0) {
  Write-Fail 'Conflict markers found'
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

Write-Host ''
Write-Host '==> Release check passed.' -ForegroundColor Green
