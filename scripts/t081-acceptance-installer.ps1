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
  Require ($Config['version'] -ceq $env:T081_VERSION) 'Unexpected test package version.'
  Require ($Config['productName'] -ceq 'Stride Plan T08.1 Test') 'Incorrect product name.'
  Require ($Config['identifier'] -ceq 'com.strideplan.t081test') 'Incorrect app identifier.'
  Require ($Config['mainBinaryName'] -ceq 'stride-plan-t081-test') 'Incorrect executable name.'
  $app = $Config['app']
  Require (@($app['windows']).Count -eq 1) 'Expected exactly one WebView window.'
  $window = $app['windows'][0]
  Require ($window['title'] -ceq 'Stride Plan T08.1 Test') 'Incorrect window identity.'
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
    PRODUCTNAME = 'Stride Plan T08.1 Test'
    BUNDLEID = 'com.strideplan.t081test'
    MAINBINARYNAME = 'stride-plan-t081-test'
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
  foreach ($forbidden in @('com.strideplan.desktop', 'Stride Plan T06 Test', 'com.strideplan.t06test', 'Stride Plan T07 Test', 'com.strideplan.t07test')) {
    Require (-not $Script.Contains($forbidden)) "Generated installer references another installation: $forbidden"
  }
  $defines
}

$sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path
$workflowRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Require ($sourceRoot -cne $workflowRoot) 'Source and workflow checkouts must be separate.'
Require ($env:T081_SOURCE_SHA -cmatch '^[0-9a-f]{40}$' -and $env:T081_SOURCE_SHA -ne ('0' * 40)) 'An approved full source commit is required.'
foreach ($item in @{
  T081_PRODUCT = 'Stride Plan T08.1 Test'
  T081_IDENTIFIER = 'com.strideplan.t081test'
  T081_BINARY = 'stride-plan-t081-test'
  T081_CREDENTIAL = 'com.strideplan.t081test/garmin-personal-api/v1'
}.GetEnumerator()) {
  Require ([Environment]::GetEnvironmentVariable($item.Key) -ceq $item.Value) "Unexpected isolation setting: $($item.Key)"
}
$workflowCommit = (git -C $workflowRoot rev-parse HEAD).Trim()
Require ($LASTEXITCODE -eq 0 -and $workflowCommit -ceq $env:GITHUB_SHA) 'Workflow/script checkout is not the triggering workflow commit.'

Push-Location -LiteralPath $sourceRoot
try {
  $commit = (git rev-parse HEAD).Trim()
  Require ($LASTEXITCODE -eq 0 -and $commit -ceq $env:T081_SOURCE_SHA) 'Source is not the exact reviewed commit.'
  Require (-not $env:TAURI_CONFIG) 'An external Tauri configuration override is not allowed.'
  # The only configuration layers are the reviewed JSON and our full CLI override.
  $configs = @(Get-ChildItem -LiteralPath src-tauri -File | Where-Object {
    $_.Name -match '^(tauri.*\.conf\.(json|json5)|Tauri.*\.toml)$' -and
    $_.Name -cnotin @('tauri.conf.json', 'tauri.t081test.conf.json')
  })
  Require ($configs.Count -eq 0) 'Additional platform/Tauri configuration needs separate review.'
  $expectedBuild = @{
    baseline = @{ source = 'fb7ff13ce64378e7b63a7c39b6df634971029da4'; version = '0.1.810' }
    upgrade = @{ source = 'ff18ad0f7d9875ae0253d2623a292ae0e465abc9'; version = '0.1.811' }
  }
  Require ($env:T081_BUILD_KIND -cin @('baseline','upgrade')) 'Unknown build stage.'
  Require ($env:T081_SOURCE_SHA -ceq $expectedBuild[$env:T081_BUILD_KIND].source -and $env:T081_VERSION -ceq $expectedBuild[$env:T081_BUILD_KIND].version) 'Source/version differs from the approved fixed pair.'
  $configPath = 'src-tauri/tauri.t081test.conf.json'
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
      Save-Environment 'T081_PRODUCTION_CONFIG_HASH' (File-Hash 'src-tauri/tauri.conf.json')
    }
    Prepare {
      Assert-CleanSource
      Require ($env:T081_FRONTEND_VERIFIED -ceq 'true' -and $env:T081_NATIVE_VERIFIED -ceq 'true') 'Both frontend and native verification must pass first.'
      Require ((File-Hash 'src-tauri/tauri.conf.json') -ceq $env:T081_PRODUCTION_CONFIG_HASH) 'Production configuration changed.'
      $config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json -AsHashtable
      $config['version'] = $env:T081_VERSION
      $config['productName'] = $env:T081_PRODUCT
      $config['identifier'] = $env:T081_IDENTIFIER
      $config['mainBinaryName'] = $env:T081_BINARY
      $config['app']['windows'][0]['title'] = $env:T081_PRODUCT
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
      [IO.File]::WriteAllText((Join-Path $sourceRoot $credentialPath), $text.Replace($original, $env:T081_CREDENTIAL), $utf8)
      Save-Environment 'T081_CREDENTIAL_SOURCE_HASH' (File-Hash $credentialPath)
      Save-Environment 'T081_EFFECTIVE_CONFIG_HASH' (File-Hash $configPath)
    }
    Verify {
      Require ($env:T081_FRONTEND_VERIFIED -ceq 'true' -and $env:T081_NATIVE_VERIFIED -ceq 'true') 'Verification evidence missing.'
      Require ((File-Hash 'src-tauri/tauri.conf.json') -ceq $env:T081_PRODUCTION_CONFIG_HASH) 'Production configuration changed.'
      Require ((File-Hash $credentialPath) -ceq $env:T081_CREDENTIAL_SOURCE_HASH) 'Credential identity changed after isolation.'
      Require ((File-Hash $configPath) -ceq $env:T081_EFFECTIVE_CONFIG_HASH) 'Build override changed.'
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
      Assert-TestConfiguration $config
      $changed = @(git diff --name-only)
      Require ($LASTEXITCODE -eq 0) 'Could not inspect changed source.'
      $untracked = @(git ls-files --others --exclude-standard)
      Require ($LASTEXITCODE -eq 0) 'Could not inspect generated source.'
      Require ($changed.Count -eq 1 -and $changed[0] -ceq $credentialPath -and $untracked.Count -eq 1 -and $untracked[0] -ceq $configPath) 'Unexpected source/dependency/security/configuration modifications.'
      $scriptPath = 'src-tauri/target/release/nsis/x64/installer.nsi'
      $defines = Assert-InstallerScript (Get-Content -LiteralPath $scriptPath -Raw)
      $binary = Get-Item -LiteralPath "src-tauri/target/release/$($env:T081_BINARY).exe"
      Require (([IO.Path]::GetFullPath($defines['MAINBINARYSRCPATH'])) -ieq $binary.FullName) 'Installer embeds a different executable.'
      Require ($defines['VERSION'] -ceq $env:T081_VERSION) 'Installer and effective configuration versions differ.'
      $installers = @(Get-ChildItem src-tauri/target/release/bundle/nsis -Filter *.exe -File)
      $expectedName = "$($env:T081_PRODUCT)_$($config['version'])_x64-setup.exe"
      Require ($installers.Count -eq 1 -and $installers[0].Name -ceq $expectedName) 'Expected exactly one distinctly named T081 installer.'
      $installer = $installers[0]
      foreach ($file in @($binary, $installer)) {
        Require ($file.VersionInfo.ProductName -ceq $env:T081_PRODUCT) "Incorrect compiled product metadata: $($file.Name)"
      }
      $bytes = [IO.File]::ReadAllBytes($binary.FullName)
      $ascii = [Text.Encoding]::UTF8.GetString($bytes)
      $wide = [Text.Encoding]::Unicode.GetString($bytes)
      Require ($ascii.Contains($env:T081_CREDENTIAL) -or $wide.Contains($env:T081_CREDENTIAL)) 'Isolated credential target missing from compiled binary.'
      foreach ($other in @('desktop', 't04test', 't05test', 't06test', 't07test')) {
        $forbidden = "com.strideplan.$other/garmin-personal-api/v1"
        Require (-not $ascii.Contains($forbidden) -and -not $wide.Contains($forbidden)) 'Compiled binary contains another installation credential target.'
      }
      $artifact = Join-Path $env:RUNNER_TEMP "t081-$($env:T081_BUILD_KIND)-verified-installer"
      New-Item -ItemType Directory -Path $artifact -ErrorAction Stop | Out-Null
      Copy-Item -LiteralPath $installer.FullName -Destination $artifact
      $installerHash = File-Hash $installer.FullName
      Require ((File-Hash (Join-Path $artifact $installer.Name)) -ceq $installerHash) 'Staged installer hash does not match the verified build.'
      $manifest = [ordered]@{
        sourceCommit = $commit
        sourceRole = $env:T081_BUILD_KIND
        baselineSourceCommit = 'fb7ff13ce64378e7b63a7c39b6df634971029da4'
        upgradeSourceCommit = 'ff18ad0f7d9875ae0253d2623a292ae0e465abc9'
        packageVersion = $env:T081_VERSION
        acceptanceToolDoesNotModifyProfiles = $true
        workflowCommit = $workflowCommit
        runId = $env:GITHUB_RUN_ID
        runAttempt = $env:GITHUB_RUN_ATTEMPT
        productName = $env:T081_PRODUCT
        identifier = $env:T081_IDENTIFIER
        executable = $binary.Name
        credentialTarget = $env:T081_CREDENTIAL
        databaseAndPreferences = '%APPDATA%\com.strideplan.t081test\stride-plan.db'
        localDataWebViewAndSources = '%LOCALAPPDATA%\com.strideplan.t081test'
        defaultInstallDirectory = '%LOCALAPPDATA%\Stride Plan T08.1 Test'
        uninstallRegistryKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stride Plan T08.1 Test'
        installer = $installer.Name
        installerSha256 = $installerHash
        executableSha256 = File-Hash $binary.FullName
        generatedInstallerScriptSha256 = File-Hash $scriptPath
        productionConfigSha256 = $env:T081_PRODUCTION_CONFIG_HASH
        isolatedCredentialSourceSha256 = $env:T081_CREDENTIAL_SOURCE_HASH
        effectiveConfigurationSha256 = $env:T081_EFFECTIVE_CONFIG_HASH
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
      "## Verified isolated T081 acceptance installer" >> $env:GITHUB_STEP_SUMMARY
      "Source: $commit; workflow: $workflowCommit" >> $env:GITHUB_STEP_SUMMARY
      "Installer: $($installer.Name); SHA-256: $installerHash" >> $env:GITHUB_STEP_SUMMARY
    }
  }
}
finally { Pop-Location }
