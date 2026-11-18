$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 't081-acceptance-installer.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors.Message -join '; ') }
# Function definitions only: no source/profile/build operations are executed.
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) { Invoke-Expression $statement.Extent.Text }
}
$previousVersion = $env:T081_VERSION
$env:T081_VERSION = '0.1.811'
$script:count = 0
function Pass([scriptblock]$Check) { & $Check; $script:count++ }
function Reject([scriptblock]$Check) {
  $rejected = $false
  try { & $Check | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Unsafe synthetic variant was accepted.' }
  $script:count++
}
try {
  $config = @{
    version='0.1.811'; productName='Stride Plan T08.1 Test'; identifier='com.strideplan.t081test'; mainBinaryName='stride-plan-t081-test'
    app=@{windows=@(@{title='Stride Plan T08.1 Test'})}
    build=@{beforeBuildCommand='';frontendDist='../dist'}
    bundle=@{targets=@('nsis');windows=@{nsis=@{installMode='currentUser'};webviewInstallMode=@{type='skip'}}}
  }
  Pass { Assert-TestConfiguration $config }
  foreach ($change in @(
    @{property='version';value='0.1.810'},
    @{property='productName';value='Stride Plan'},
    @{property='identifier';value='com.strideplan.desktop'},
    @{property='mainBinaryName';value='stride-plan'},
    @{property='identifier';value='com.strideplan.t07test'}
  )) {
    $copy = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
    $copy[$change.property] = $change.value
    Reject { Assert-TestConfiguration $copy }
  }
  $copy = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
  $copy.app.windows[0].dataDirectory = 'C:\foreign'
  Reject { Assert-TestConfiguration $copy }
  $copy = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
  $copy.bundle.windows.nsis.installMode = 'perMachine'
  Reject { Assert-TestConfiguration $copy }
  $copy = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
  $copy.bundle.windows.webviewInstallMode.type = 'downloadBootstrapper'
  Reject { Assert-TestConfiguration $copy }
  $scriptText = @'
!define PRODUCTNAME "Stride Plan T08.1 Test"
!define BUNDLEID "com.strideplan.t081test"
!define MAINBINARYNAME "stride-plan-t081-test"
!define INSTALLMODE "currentUser"
!define ARCH "x64"
!define INSTALLWEBVIEW2MODE "skip"
!define MINIMUMWEBVIEW2VERSION ""
!define MAINBINARYSRCPATH "C:\synthetic\stride-plan-t081-test.exe"
!define VERSION "0.1.811"
RequestExecutionLevel user
StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString"
DeleteRegKey HKCU "${UNINSTKEY}"
SetShellVarContext current
RmDir /r "$APPDATA\${BUNDLEID}"
RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
'@
  Pass { Assert-InstallerScript $scriptText | Out-Null }
  foreach ($pair in @(
    @('Stride Plan T08.1 Test','Stride Plan'),
    @('com.strideplan.t081test','com.strideplan.desktop'),
    @('stride-plan-t081-test','stride-plan'),
    @('currentUser','perMachine'),
    @('RequestExecutionLevel user','RequestExecutionLevel admin'),
    @('INSTALLWEBVIEW2MODE "skip"','INSTALLWEBVIEW2MODE "downloadBootstrapper"')
  )) {
    $unsafe = $scriptText.Replace($pair[0],$pair[1])
    Reject { Assert-InstallerScript $unsafe }
  }
  Reject { Assert-InstallerScript ($scriptText + "`n!define BUNDLEID `"com.strideplan.t081test`"") }
  "Passed $script:count installer/configuration guard checks without building or launching an app."
}
finally { $env:T081_VERSION = $previousVersion }
