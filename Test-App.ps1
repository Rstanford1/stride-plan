$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "pnpm is required. Install Node.js 22, then run: corepack enable" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    & pnpm install --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Checking formatting, types, tests, and the production build..." -ForegroundColor Cyan
& pnpm verify
if ($LASTEXITCODE -ne 0) {
    Write-Host "Checks failed. Review the messages above." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit $LASTEXITCODE
}

Write-Host "All checks passed." -ForegroundColor Green
Read-Host "Press Enter to close"
