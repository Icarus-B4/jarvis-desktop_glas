$exe = Join-Path $env:LOCALAPPDATA "Programs\Jarvis-Glas\J.A.R.V.I.S.exe"
if (Test-Path $exe) {
  $p = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 10
  if (-not $p.HasExited) { Write-Host "PASS: app launched" } else { Write-Host "FAIL: exited" }
  $p | Stop-Process -Force -ErrorAction SilentlyContinue
} else { Write-Host "EXE not at $exe" }