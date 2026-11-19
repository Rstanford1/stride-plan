$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/integrity.ps1"
$token = [StrideQaToken]::Describe($PID)
"medium-launch pid=$PID $token" | Set-Content -LiteralPath 'native-qa-results/medium-integrity.log'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:STRIDE_QA_STAGE -ne 'launch' -or $token -ne 'integrity=8192 elevated=0') {
  throw 'Medium-integrity hosted launch prerequisites not verified; refusing to launch.'
}
node native-qa/preflight.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node native-qa/seed.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot/run-wdio.ps1"
exit $LASTEXITCODE
