# scripts/windows/reset-profiles.ps1 --- release profiles stuck in 'in_use'.
# Calls master /admin/reset-stuck-profiles (idempotent, safe even with active jobs).
#
# Usage:  pnpm reset:profiles

. "$PSScriptRoot\_common.ps1"

Write-Step 'Calling /admin/reset-stuck-profiles'
try {
  $r = Invoke-MasterApi -Path '/admin/reset-stuck-profiles' -Method 'POST' -Body '{}'
  if ($r.released -gt 0) {
    Write-Ok "Released $($r.released) stuck profile(s):"
    foreach ($id in $r.ids) { Write-Host "    - $id" }
  } else {
    Write-Ok 'No stuck profiles found.'
  }
} catch {
  Write-Fail "Reset failed: $_"
  Write-Host '  (Is the master running?  pnpm status)'
  exit 1
}
