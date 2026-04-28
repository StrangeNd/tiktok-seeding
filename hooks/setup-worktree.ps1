$ErrorActionPreference = "Stop"

Write-Host "[worktree] cwd = $(Get-Location)"
Write-Host "[worktree] root = $env:ROOT_WORKSPACE_PATH"

# Copy .env from root repo if missing
$rootEnv = Join-Path $env:ROOT_WORKSPACE_PATH ".env"
$worktreeEnv = Join-Path (Get-Location) ".env"

if ((Test-Path $rootEnv) -and -not (Test-Path $worktreeEnv)) {
    Copy-Item $rootEnv $worktreeEnv
    Write-Host "[worktree] copied .env"
}

# Prepare pnpm in this worktree
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
corepack enable | Out-Null
pnpm install

Write-Host "[worktree] setup done"
