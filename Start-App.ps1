$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "pnpm is required. Install Node.js 22, then run: corepack enable" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Preparing Stride Plan for the first run..." -ForegroundColor Cyan
    & pnpm install --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting Stride Plan..." -ForegroundColor Green
Write-Host "Keep this window open while using the app." -ForegroundColor DarkGray
& pnpm dev
exit $LASTEXITCODE
