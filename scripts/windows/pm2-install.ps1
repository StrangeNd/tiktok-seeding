. "$PSScriptRoot\_common.ps1"

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host 'PM2 is not installed. Install it explicitly with: npm install -g pm2'
  exit 1
}
Write-Host 'PM2 is available. To configure startup manually, review PM2 documentation and run pm2 startup from an elevated shell if desired.'
pm2 --version
