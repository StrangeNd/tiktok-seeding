. "$PSScriptRoot\_common.ps1"

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host 'PM2 is not installed. Install it explicitly with: npm install -g pm2'
  exit 1
}
Push-Location $RepoRoot
try {
  pnpm build
  pm2 start ecosystem.config.cjs
  pm2 save
} finally {
  Pop-Location
}
