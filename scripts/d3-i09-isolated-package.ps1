param([Parameter(Mandatory)][ValidateSet('Prepare', 'Verify')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function FileHash([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function SaveEnvironment([string]$Name, [string]$Value) {
  "$Name=$Value" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
}
function ReadDefine([string]$Script, [string]$Name) {
  $matches = [regex]::Matches($Script, '(?m)^!define ' + [regex]::Escape($Name) + ' "([^"]*)"\r?$')
  Require ($matches.Count -eq 1) "Missing or ambiguous installer define: $Name"
  $matches[0].Groups[1].Value
}

$product = 'Stride Plan D3 I09 Acceptance'
$identifier = 'com.strideplan.d3i09test'
$binaryName = 'stride-plan-d3-i09-acceptance'
$credential = 'com.strideplan.d3i09test/garmin-personal-api/v1'
$configPath = 'src-tauri/tauri.d3i09test.conf.json'
$credentialPath = 'src-tauri/src/garmin_credentials.rs'
$sourceRoot = (Resolve-Path -LiteralPath '.').Path
$commit = (git rev-parse HEAD).Trim()
Require ($LASTEXITCODE -eq 0 -and $commit -cmatch '^[0-9a-f]{40}$' -and $commit -ceq $env:D3_SOURCE_SHA) 'Checkout does not match the reviewed PR revision.'
Require (-not $env:TAURI_CONFIG) 'External Tauri configuration overrides are not allowed.'

if ($Mode -eq 'Prepare') {
  Require (@(git status --porcelain).Count -eq 0) 'The reviewed checkout is not clean.'
  $configs = @(Get-ChildItem -LiteralPath src-tauri -File | Where-Object {
    $_.Name -match '^(tauri.*\.conf\.(json|json5)|Tauri.*\.toml)$' -and $_.Name -cne 'tauri.conf.json'
  })
  Require ($configs.Count -eq 0) 'Unexpected platform configuration requires separate review.'
  $originalHash = FileHash 'src-tauri/tauri.conf.json'
  $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json -AsHashtable
  Require (@($config['app']['windows']).Count -eq 1) 'Expected one application window.'
  Require (-not $config['app']['appDirectoriesOverride'] -and -not $config['app']['windows'][0]['dataDirectory']) 'Application data overrides are not allowed.'
  $config['productName'] = $product
  $config['identifier'] = $identifier
  $config['mainBinaryName'] = $binaryName
  $config['app']['windows'][0]['title'] = $product
  $config['build']['beforeBuildCommand'] = ''
  $config['bundle']['targets'] = @('nsis')
  $config['bundle']['windows'] = @{ nsis = @{ installMode = 'currentUser' }; webviewInstallMode = @{ type = 'skip' }; minimumWebview2Version = $null }
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText((Join-Path $sourceRoot $configPath), ($config | ConvertTo-Json -Depth 40), $utf8)
  $productionCredential = 'com.strideplan.desktop/garmin-personal-api/v1'
  $source = Get-Content -LiteralPath $credentialPath -Raw
  Require ([regex]::Matches($source, [regex]::Escape($productionCredential)).Count -eq 1) 'Expected exactly one production credential target.'
  [IO.File]::WriteAllText((Join-Path $sourceRoot $credentialPath), $source.Replace($productionCredential, $credential), $utf8)
  SaveEnvironment 'D3_PRODUCTION_CONFIG_HASH' $originalHash
  SaveEnvironment 'D3_TEST_CONFIG_HASH' (FileHash $configPath)
  SaveEnvironment 'D3_TEST_CREDENTIAL_HASH' (FileHash $credentialPath)
  return
}

Require ((FileHash 'src-tauri/tauri.conf.json') -ceq $env:D3_PRODUCTION_CONFIG_HASH) 'Production configuration changed.'
Require ((FileHash $configPath) -ceq $env:D3_TEST_CONFIG_HASH) 'Test configuration changed after preparation.'
Require ((FileHash $credentialPath) -ceq $env:D3_TEST_CREDENTIAL_HASH) 'Test credential identity changed after preparation.'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
Require ($config['productName'] -ceq $product -and $config['identifier'] -ceq $identifier -and $config['mainBinaryName'] -ceq $binaryName) 'Effective application identity is incorrect.'
Require ($config['app']['windows'][0]['title'] -ceq $product -and -not $config['app']['windows'][0]['dataDirectory'] -and -not $config['app']['appDirectoriesOverride']) 'Unexpected window or data-directory configuration.'
Require ($config['build']['beforeBuildCommand'] -ceq '' -and $config['build']['frontendDist'] -ceq '../dist') 'Unexpected frontend build configuration.'
Require (@($config['bundle']['targets']).Count -eq 1 -and $config['bundle']['targets'][0] -ceq 'nsis') 'Only the isolated NSIS installer is allowed.'
Require (-not $config['bundle']['windows']['nsis']['template'] -and -not $config['bundle']['windows']['nsis']['installerHooks']) 'Custom installer logic is not allowed.'
Require ($config['bundle']['windows']['nsis']['installMode'] -ceq 'currentUser' -and $config['bundle']['windows']['webviewInstallMode']['type'] -ceq 'skip') 'Installer could alter shared Windows components.'
$changed = @(git diff --name-only)
$untracked = @(git ls-files --others --exclude-standard)
Require ($changed.Count -eq 1 -and $changed[0] -ceq $credentialPath -and $untracked.Count -eq 1 -and $untracked[0] -ceq $configPath) 'Unexpected changes were made to the reviewed checkout.'
$installerScript = Get-Content -LiteralPath 'src-tauri/target/release/nsis/x64/installer.nsi' -Raw
foreach ($entry in @{ PRODUCTNAME = $product; BUNDLEID = $identifier; MAINBINARYNAME = $binaryName; INSTALLMODE = 'currentUser'; ARCH = 'x64' }.GetEnumerator()) {
  Require ((ReadDefine $installerScript $entry.Key) -ceq $entry.Value) "Unexpected installer setting: $($entry.Key)"
}
Require ((ReadDefine $installerScript 'INSTALLWEBVIEW2MODE') -cin @('skip', '') -and -not (ReadDefine $installerScript 'MINIMUMWEBVIEW2VERSION')) 'Installer would change shared WebView2.'
foreach ($required in @('RequestExecutionLevel user', 'StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"', '!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"', 'WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString"', 'DeleteRegKey HKCU "${UNINSTKEY}"', 'SetShellVarContext current', 'RmDir /r "$APPDATA\${BUNDLEID}"', 'RmDir /r "$LOCALAPPDATA\${BUNDLEID}"')) {
  Require ($installerScript.Contains($required)) "Installer isolation check failed: $required"
}
Require (-not $installerScript.Contains('com.strideplan.desktop')) 'Installer references the normal application identity.'
$binary = Get-Item -LiteralPath "src-tauri/target/release/$binaryName.exe"
Require (([IO.Path]::GetFullPath((ReadDefine $installerScript 'MAINBINARYSRCPATH'))) -ieq $binary.FullName) 'Installer embeds a different executable.'
$installers = @(Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -Filter '*.exe' -File)
Require ($installers.Count -eq 1 -and $installers[0].Name -ceq "$product`_$($config['version'])_x64-setup.exe") 'Expected exactly one distinct installer.'
$bytes = [IO.File]::ReadAllBytes($binary.FullName)
$ascii = [Text.Encoding]::UTF8.GetString($bytes)
$wide = [Text.Encoding]::Unicode.GetString($bytes)
Require ($ascii.Contains($credential) -or $wide.Contains($credential)) 'The isolated credential target is missing.'
Require (-not $ascii.Contains('com.strideplan.desktop/garmin-personal-api/v1') -and -not $wide.Contains('com.strideplan.desktop/garmin-personal-api/v1')) 'The binary contains the normal credential target.'
$artifact = Join-Path $env:RUNNER_TEMP 'd3-i09-verified-installer'
New-Item -ItemType Directory -Path $artifact -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $installers[0].FullName -Destination $artifact
$installerHash = FileHash $installers[0].FullName
Require ((FileHash (Join-Path $artifact $installers[0].Name)) -ceq $installerHash) 'The staged installer hash does not match.'
$manifest = [ordered]@{
  sourceCommit = $commit; workflowCommit = $env:GITHUB_SHA; runId = $env:GITHUB_RUN_ID
  productName = $product; identifier = $identifier; binaryName = $binaryName; credentialTarget = $credential
  installerName = $installers[0].Name; installerSha256 = $installerHash; binarySha256 = FileHash $binary.FullName
  installation = '%LOCALAPPDATA%\Stride Plan D3 I09 Acceptance'
  configuration = '%APPDATA%\com.strideplan.d3i09test'
  localData = '%LOCALAPPDATA%\com.strideplan.d3i09test'
  note = 'Isolation overrides only; no application profile was accessed or modified by this build.'
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $artifact 'build-manifest.json') -Encoding utf8
