param(
  [Parameter(Mandatory)][ValidateSet('Inspect', 'Prepare', 'Verify')][string]$Mode,
  [Parameter(Mandatory)][string]$SourceDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function File-Hash([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Assert-CleanSource {
  $state = @(git status --porcelain)
  Require ($LASTEXITCODE -eq 0 -and $state.Count -eq 0) 'Reviewed source checkout is not clean.'
}
function Save-Environment([string]$Name, [string]$Value) {
  "$Name=$Value" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
}
function Assert-TestConfiguration([System.Collections.IDictionary]$Config) {
  Require ($Config['productName'] -ceq 'Stride Plan T07 Test') 'Incorrect product name.'
  Require ($Config['identifier'] -ceq 'com.strideplan.t07test') 'Incorrect app identifier.'
  Require ($Config['mainBinaryName'] -ceq 'stride-plan-t07-test') 'Incorrect executable name.'
  $app = $Config['app']
  Require (@($app['windows']).Count -eq 1) 'Expected exactly one WebView window.'
  $window = $app['windows'][0]
  Require ($window['title'] -ceq 'Stride Plan T07 Test') 'Incorrect window identity.'
  Require (-not $window['dataDirectory'] -and -not $app['appDirectoriesOverride']) 'Explicit storage overrides are not allowed.'
  Require ($Config['build']['beforeBuildCommand'] -ceq '') 'Frontend must be built by the verified CI stage.'
  Require ($Config['build']['frontendDist'] -ceq '../dist') 'Unexpected frontend build location.'
  Require (@($Config['bundle']['targets']).Count -eq 1 -and $Config['bundle']['targets'][0] -ceq 'nsis') 'Only NSIS is allowed.'
  $windows = $Config['bundle']['windows']
  Require ($windows['nsis']['installMode'] -ceq 'currentUser') 'Installer must be current-user only.'
  Require (-not $windows['nsis']['template'] -and -not $windows['nsis']['installerHooks']) 'Custom installer logic is not allowed.'
  Require ($windows['webviewInstallMode']['type'] -ceq 'skip' -and -not $windows['minimumWebview2Version'] -and -not $windows['nsis']['minimumWebview2Version']) 'Shared WebView2 installation or update must be disabled.'
}
function Assert-InstallerScript([string]$Script) {
  function Read-Define([string]$Name) {
    $definitionMatches = [regex]::Matches($Script, '(?m)^!define ' + [regex]::Escape($Name) + ' "([^"]*)"\r?$')
    Require ($definitionMatches.Count -eq 1) "Missing or ambiguous installer define: $Name"
    $definitionMatches[0].Groups[1].Value
  }
  $defines = [ordered]@{}
  $expected = @{
    PRODUCTNAME = 'Stride Plan T07 Test'
    BUNDLEID = 'com.strideplan.t07test'
    MAINBINARYNAME = 'stride-plan-t07-test'
    INSTALLMODE = 'currentUser'
    ARCH = 'x64'
  }
  foreach ($name in $expected.Keys) {
    $defines[$name] = Read-Define $name
    Require ($defines[$name] -ceq $expected[$name]) "Incorrect effective installer define: $name"
  }
  $defines['INSTALLWEBVIEW2MODE'] = Read-Define 'INSTALLWEBVIEW2MODE'
  $defines['MAINBINARYSRCPATH'] = Read-Define 'MAINBINARYSRCPATH'
  $defines['VERSION'] = Read-Define 'VERSION'
  Require ($defines['INSTALLWEBVIEW2MODE'] -cin @('skip', '') -and -not (Read-Define 'MINIMUMWEBVIEW2VERSION')) 'Generated installer could install or update shared WebView2.'
  foreach ($required in @(
    'RequestExecutionLevel user',
    'StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"',
    '!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"',
    'WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString"',
    'DeleteRegKey HKCU "${UNINSTKEY}"',
    'SetShellVarContext current',
    'RmDir /r "$APPDATA\${BUNDLEID}"',
    'RmDir /r "$LOCALAPPDATA\${BUNDLEID}"'
  )) {
    Require ($Script.Contains($required)) "Generated install/uninstall layout changed: $required"
  }
  foreach ($forbidden in @('com.strideplan.desktop', 'Stride Plan T06 Test', 'com.strideplan.t06test')) {
    Require (-not $Script.Contains($forbidden)) "Generated installer references another installation: $forbidden"
  }
  $defines
}

$sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path
$workflowRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Require ($sourceRoot -cne $workflowRoot) 'Source and workflow checkouts must be separate.'
Require ($env:T07_SOURCE_SHA -cmatch '^[0-9a-f]{40}$' -and $env:T07_SOURCE_SHA -ne ('0' * 40)) 'An approved full source commit is required.'
foreach ($item in @{
  T07_PRODUCT = 'Stride Plan T07 Test'
  T07_IDENTIFIER = 'com.strideplan.t07test'
  T07_BINARY = 'stride-plan-t07-test'
  T07_CREDENTIAL = 'com.strideplan.t07test/garmin-personal-api/v1'
}.GetEnumerator()) {
  Require ([Environment]::GetEnvironmentVariable($item.Key) -ceq $item.Value) "Unexpected isolation setting: $($item.Key)"
}
$workflowCommit = (git -C $workflowRoot rev-parse HEAD).Trim()
Require ($LASTEXITCODE -eq 0 -and $workflowCommit -ceq $env:GITHUB_SHA) 'Workflow/script checkout is not the triggering workflow commit.'

Push-Location -LiteralPath $sourceRoot
try {
  $commit = (git rev-parse HEAD).Trim()
  Require ($LASTEXITCODE -eq 0 -and $commit -ceq $env:T07_SOURCE_SHA) 'Source is not the exact reviewed commit.'
  Require (-not $env:TAURI_CONFIG) 'An external Tauri configuration override is not allowed.'
  # The only configuration layers are the reviewed JSON and our full CLI override.
  $configs = @(Get-ChildItem -LiteralPath src-tauri -File | Where-Object {
    $_.Name -match '^(tauri.*\.conf\.(json|json5)|Tauri.*\.toml)$' -and
    $_.Name -cnotin @('tauri.conf.json', 'tauri.t07test.conf.json')
  })
  Require ($configs.Count -eq 0) 'Additional platform/Tauri configuration needs separate review.'
  $configPath = 'src-tauri/tauri.t07test.conf.json'
  $credentialPath = 'src-tauri/src/garmin_credentials.rs'

  switch ($Mode) {
    Inspect {
      Assert-CleanSource
      $checks = @{
        'src-tauri/src/plan_draft_commands.rs' = @('.app_config_dir()', '.join("stride-plan.db")', '.app_local_data_dir()')
        'src-tauri/src/fit_source_commands.rs' = @('.app_local_data_dir()')
        'src-tauri/src/garmin_commands.rs' = @('.app_local_data_dir()')
        'src-tauri/src/plan_conversion_commands.rs' = @('.app_config_dir()', '.app_local_data_dir()', 'save_plan_conversion_file')
        'src-tauri/src/lib.rs' = @('plan_conversion_commands::save_plan_conversion_file')
        'src/data/repository.ts' = @('Database.load("sqlite:stride-plan.db")', '? new SqliteRepository()')
      }
      foreach ($path in $checks.Keys) {
        $text = Get-Content -LiteralPath $path -Raw
        foreach ($required in $checks[$path]) { Require ($text.Contains($required)) "Storage/native boundary changed: $path" }
      }
      $rootPackage = Get-Content -LiteralPath (Join-Path $workflowRoot 'package.json') -Raw | ConvertFrom-Json
      $sourcePackage = Get-Content package.json -Raw | ConvertFrom-Json
      Require ($rootPackage.packageManager -ceq $sourcePackage.packageManager) 'pnpm setup would select a different package manager.'
      Save-Environment 'T07_PRODUCTION_CONFIG_HASH' (File-Hash 'src-tauri/tauri.conf.json')
    }
    Prepare {
      Assert-CleanSource
      Require ($env:T07_FRONTEND_VERIFIED -ceq 'true' -and $env:T07_NATIVE_VERIFIED -ceq 'true') 'Both frontend and native verification must pass first.'
      Require ((File-Hash 'src-tauri/tauri.conf.json') -ceq $env:T07_PRODUCTION_CONFIG_HASH) 'Production configuration changed.'
      $config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json -AsHashtable
      $config['productName'] = $env:T07_PRODUCT
      $config['identifier'] = $env:T07_IDENTIFIER
      $config['mainBinaryName'] = $env:T07_BINARY
      $config['app']['windows'][0]['title'] = $env:T07_PRODUCT
      # The production frontend has already been checked and built, without pnpm
      # script/dependency refresh. Never change the production config/package files.
      $config['build']['beforeBuildCommand'] = ''
      $config['bundle']['targets'] = @('nsis')
      $config['bundle']['windows'] = @{
        nsis = @{ installMode = 'currentUser' }
        webviewInstallMode = @{ type = 'skip' }
        minimumWebview2Version = $null
      }
      Assert-TestConfiguration $config
      $utf8 = [Text.UTF8Encoding]::new($false)
      [IO.File]::WriteAllText((Join-Path $sourceRoot $configPath), ($config | ConvertTo-Json -Depth 40), $utf8)
      $original = 'com.strideplan.desktop/garmin-personal-api/v1'
      $text = Get-Content -LiteralPath $credentialPath -Raw
      Require ([regex]::Matches($text, [regex]::Escape($original)).Count -eq 1) 'Expected exactly one production credential target.'
      [IO.File]::WriteAllText((Join-Path $sourceRoot $credentialPath), $text.Replace($original, $env:T07_CREDENTIAL), $utf8)
      Save-Environment 'T07_CREDENTIAL_SOURCE_HASH' (File-Hash $credentialPath)
      Save-Environment 'T07_EFFECTIVE_CONFIG_HASH' (File-Hash $configPath)
    }
    Verify {
      Require ($env:T07_FRONTEND_VERIFIED -ceq 'true' -and $env:T07_NATIVE_VERIFIED -ceq 'true') 'Verification evidence missing.'
      Require ((File-Hash 'src-tauri/tauri.conf.json') -ceq $env:T07_PRODUCTION_CONFIG_HASH) 'Production configuration changed.'
      Require ((File-Hash $credentialPath) -ceq $env:T07_CREDENTIAL_SOURCE_HASH) 'Credential identity changed after isolation.'
      Require ((File-Hash $configPath) -ceq $env:T07_EFFECTIVE_CONFIG_HASH) 'Build override changed.'
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
      Assert-TestConfiguration $config
      $changed = @(git diff --name-only)
      Require ($LASTEXITCODE -eq 0) 'Could not inspect changed source.'
      $untracked = @(git ls-files --others --exclude-standard)
      Require ($LASTEXITCODE -eq 0) 'Could not inspect generated source.'
      Require ($changed.Count -eq 1 -and $changed[0] -ceq $credentialPath -and $untracked.Count -eq 1 -and $untracked[0] -ceq $configPath) 'Unexpected source/dependency/security/configuration modifications.'
      $scriptPath = 'src-tauri/target/release/nsis/x64/installer.nsi'
      $defines = Assert-InstallerScript (Get-Content -LiteralPath $scriptPath -Raw)
      $binary = Get-Item -LiteralPath "src-tauri/target/release/$($env:T07_BINARY).exe"
      Require (([IO.Path]::GetFullPath($defines['MAINBINARYSRCPATH'])) -ieq $binary.FullName) 'Installer embeds a different executable.'
      Require ($defines['VERSION'] -ceq $config['version']) 'Installer and effective configuration versions differ.'
      $installers = @(Get-ChildItem src-tauri/target/release/bundle/nsis -Filter *.exe -File)
      $expectedName = "$($env:T07_PRODUCT)_$($config['version'])_x64-setup.exe"
      Require ($installers.Count -eq 1 -and $installers[0].Name -ceq $expectedName) 'Expected exactly one distinctly named T07 installer.'
      $installer = $installers[0]
      foreach ($file in @($binary, $installer)) {
        Require ($file.VersionInfo.ProductName -ceq $env:T07_PRODUCT) "Incorrect compiled product metadata: $($file.Name)"
      }
      $bytes = [IO.File]::ReadAllBytes($binary.FullName)
      $ascii = [Text.Encoding]::UTF8.GetString($bytes)
      $wide = [Text.Encoding]::Unicode.GetString($bytes)
      Require ($ascii.Contains($env:T07_CREDENTIAL) -or $wide.Contains($env:T07_CREDENTIAL)) 'Isolated credential target missing from compiled binary.'
      foreach ($other in @('desktop', 't04test', 't05test', 't06test')) {
        $forbidden = "com.strideplan.$other/garmin-personal-api/v1"
        Require (-not $ascii.Contains($forbidden) -and -not $wide.Contains($forbidden)) 'Compiled binary contains another installation credential target.'
      }
      $artifact = Join-Path $env:RUNNER_TEMP 't07-verified-installer'
      New-Item -ItemType Directory -Path $artifact -ErrorAction Stop | Out-Null
      Copy-Item -LiteralPath $installer.FullName -Destination $artifact
      $installerHash = File-Hash $installer.FullName
      Require ((File-Hash (Join-Path $artifact $installer.Name)) -ceq $installerHash) 'Staged installer hash does not match the verified build.'
      $manifest = [ordered]@{
        sourceCommit = $commit
        sourceBranch = 'codex/t07-guided-conversion'
        workflowCommit = $workflowCommit
        runId = $env:GITHUB_RUN_ID
        runAttempt = $env:GITHUB_RUN_ATTEMPT
        productName = $env:T07_PRODUCT
        identifier = $env:T07_IDENTIFIER
        executable = $binary.Name
        credentialTarget = $env:T07_CREDENTIAL
        databaseAndPreferences = '%APPDATA%\com.strideplan.t07test\stride-plan.db'
        localDataWebViewAndSources = '%LOCALAPPDATA%\com.strideplan.t07test'
        defaultInstallDirectory = '%LOCALAPPDATA%\Stride Plan T07 Test'
        uninstallRegistryKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stride Plan T07 Test'
        installer = $installer.Name
        installerSha256 = $installerHash
        executableSha256 = File-Hash $binary.FullName
        generatedInstallerScriptSha256 = File-Hash $scriptPath
        productionConfigSha256 = $env:T07_PRODUCTION_CONFIG_HASH
        isolatedCredentialSourceSha256 = $env:T07_CREDENTIAL_SOURCE_HASH
        effectiveConfigurationSha256 = $env:T07_EFFECTIVE_CONFIG_HASH
        effectiveConfiguration = $config
        installerDefines = $defines
        frontendChecksPassed = $true
        nativeTestsPassed = $true
        applicationInstalledOrLaunched = $false
        acceptanceInputs = 'Synthetic fixtures only. No user profile or credentials included.'
      }
      $manifest | ConvertTo-Json -Depth 45 | Set-Content -LiteralPath (Join-Path $artifact 'build-manifest.json') -Encoding utf8
      $files = @(Get-ChildItem -LiteralPath $artifact -File)
      Require ($files.Count -eq 2) 'Only the installer and manifest may be published.'
      "## Verified isolated T07 acceptance installer" >> $env:GITHUB_STEP_SUMMARY
      "Source: $commit; workflow: $workflowCommit" >> $env:GITHUB_STEP_SUMMARY
      "Installer: $($installer.Name); SHA-256: $installerHash" >> $env:GITHUB_STEP_SUMMARY
    }
  }
}
finally { Pop-Location }
