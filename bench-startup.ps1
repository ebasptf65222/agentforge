# bench-startup.ps1 - Measure AgentForge startup time (process start -> main window shown)
# Usage: powershell -ExecutionPolicy Bypass -File "d:\ai\agentforge\bench-startup.ps1" [-Runs 3]
param([int]$Runs = 3)

$exe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) {
  Write-Error "electron.exe not found: $exe (run pnpm install first)"
  exit 1
}

# Single-instance lock: a second instance exits immediately, which breaks timing
$running = Get-Process electron -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning "An Electron instance is already running. Close it before measuring:"
  $running | Select-Object Id, ProcessName, MainWindowTitle | Format-Table
  exit 1
}

Write-Output "Measuring $Runs runs (timer stops when main window appears)..."
$results = @()
for ($i = 1; $i -le $Runs; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $exe -ArgumentList "." -WorkingDirectory $PSScriptRoot -PassThru
  $shown = $false
  while ($sw.Elapsed.TotalSeconds -lt 90) {
    $p.Refresh()
    if ($p.HasExited) { break }
    if ($p.MainWindowHandle -ne 0) { $shown = $true; break }
    Start-Sleep -Milliseconds 40
  }
  $ms = [math]::Round($sw.Elapsed.TotalMilliseconds)
  $results += $ms
  Write-Output ("run {0}: {1} ms (window_shown={2}, exited_early={3})" -f $i, $ms, $shown, ($p.HasExited -and -not $shown))
  Start-Sleep -Milliseconds 500
  taskkill /PID $p.Id /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 800
}

$sorted = $results | Sort-Object
$median = $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
$avg = [math]::Round(($results | Measure-Object -Average).Average)
Write-Output ("results_ms: {0}" -f ($results -join ", "))
Write-Output ("median: {0} ms | avg: {1} ms" -f $median, $avg)
