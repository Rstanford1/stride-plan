$ErrorActionPreference = 'Stop'
$stage = if ($env:STRIDE_QA_STAGE -eq 'launch') { 'launch' } elseif ($env:STRIDE_QA_VALUE -eq '132') { 'repeat' } else { 'full' }
$logPath = Join-Path (Resolve-Path 'native-qa-results').Path "processes-$stage.log"
$watch = Start-Job -ArgumentList $logPath -ScriptBlock {
  param($destination)
  # Record only known process names and IDs; omit command lines and environment.
  $seen = @{}
  for ($index = 0; $index -lt 240; $index++) {
    $stamp = [DateTime]::UtcNow.ToString('o')
    $items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -in @('tauri-driver.exe', 'msedgedriver.exe', 'stride-plan-qa-i13.exe', 'msedgewebview2.exe')
    }
    $summary = @($items | ForEach-Object { "$($_.Name):$($_.ProcessId):parent=$($_.ParentProcessId)" }) -join ' '
    "$stamp $summary" | Add-Content -LiteralPath $destination
    foreach ($item in $items | Where-Object { $_.Name -eq 'stride-plan-qa-i13.exe' }) {
      if (-not $seen.ContainsKey($item.ProcessId)) {
        try { $seen[$item.ProcessId] = Get-Process -Id $item.ProcessId -ErrorAction Stop } catch { }
      }
    }
    foreach ($id in @($seen.Keys)) {
      try {
        if ($seen[$id].HasExited) {
          "$stamp qa-exit:$id code=$($seen[$id].ExitCode)" | Add-Content -LiteralPath $destination
          $seen.Remove($id)
        }
      } catch { "$stamp qa-exit:$id code=unavailable" | Add-Content -LiteralPath $destination; $seen.Remove($id) }
    }
    Start-Sleep -Milliseconds 500
  }
}
try {
  & pnpm exec wdio run native-qa/wdio.conf.mjs
  $result = $LASTEXITCODE
} finally {
  Stop-Job -Job $watch -ErrorAction SilentlyContinue
  Remove-Job -Job $watch -ErrorAction SilentlyContinue
  # The root was checked by the preflight; only copy fixed-format QA markers.
  $tracePath = Join-Path (Resolve-Path 'native-qa-results').Path "startup-$stage.log"
  Get-ChildItem -LiteralPath $env:STRIDE_QA_ROOT -Filter 'qa-startup-*.log' -File -ErrorAction SilentlyContinue |
    Select-Object -First 20 | ForEach-Object {
      "[$($_.Name)]" | Add-Content -LiteralPath $tracePath
      Get-Content -LiteralPath $_.FullName -TotalCount 12 | Add-Content -LiteralPath $tracePath
    }
  # Only a bounded, redacted tail is copied into the uploaded evidence.
  $rawLogDir = Join-Path $env:RUNNER_TEMP 'i13-wdio-logs'
  $backendPath = Join-Path (Resolve-Path 'native-qa-results').Path "backend-$stage.log"
  if ($env:USERPROFILE -and (Test-Path -LiteralPath $rawLogDir)) {
    Get-ChildItem -LiteralPath $rawLogDir -Filter '*.log' -File -ErrorAction SilentlyContinue |
      Select-Object -First 8 | ForEach-Object {
        Get-Content -LiteralPath $_.FullName -Tail 500 | ForEach-Object {
          $line = $_ -replace [regex]::Escape($env:USERPROFILE), '<runner-profile>'
          $line = $line -replace '(?i)(authorization|token|api.?key|credential)(["'':= ]+)[^\s,]+' , '$1$2<redacted>'
          $line.Substring(0, [Math]::Min($line.Length, 2048))
        } | Add-Content -LiteralPath $backendPath
      }
  }
}
exit $result
