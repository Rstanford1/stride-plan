$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "A local installer build requires Rust and the Visual Studio C++ build tools." -ForegroundColor Red
    Write-Host "You can instead run the GitHub 'Build Windows installer' workflow." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    & pnpm install --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Checking the app before packaging..." -ForegroundColor Cyan
& pnpm verify
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Building the Windows installers..." -ForegroundColor Cyan
& pnpm tauri build
exit $LASTEXITCODE
