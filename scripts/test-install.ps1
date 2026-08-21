# Local E2E install test for jarvis-bootstrap-setup.exe
# Verifies: install dir created, Jarvis-Glas.exe present, Start Menu + Desktop
# shortcuts created, app actually launches.

$exe = "C:\c\temp\jarvis-bootstrap-target\release\jarvis-bootstrap-setup.exe"
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\Jarvis-Glas"
$startMenuLnk = Join-Path ([System.Environment]::GetFolderPath('StartMenu')) "Programs\Jarvis-Glas.lnk"
$desktopLnk = Join-Path ([System.Environment]::GetFolderPath('Desktop')) "Jarvis-Glas.lnk"

Write-Host "=== Pre-clean ==="
if (Test-Path $installRoot) { Remove-Item -Recurse -Force $installRoot }
if (Test-Path $startMenuLnk) { Remove-Item -Force $startMenuLnk }
if (Test-Path $desktopLnk) { Remove-Item -Force $desktopLnk }

Write-Host "=== Launch bootstrap ==="
$proc = Start-Process -FilePath $exe -PassThru
Write-Host ("PID: " + $proc.Id)
$proc.WaitForExit(120000)
Write-Host ("Exit code: " + $proc.ExitCode)

Write-Host "=== Verify ==="
$ok = $true
if (Test-Path (Join-Path $installRoot "Jarvis-Glas.exe")) { Write-Host "PASS: Jarvis-Glas.exe installed" } else { Write-Host "FAIL: Jarvis-Glas.exe missing"; $ok = $false }
if (Test-Path $startMenuLnk) { Write-Host "PASS: Start Menu shortcut" } else { Write-Host "FAIL: Start Menu shortcut missing"; $ok = $false }
if (Test-Path $desktopLnk) { Write-Host "PASS: Desktop shortcut" } else { Write-Host "FAIL: Desktop shortcut missing"; $ok = $false }

Write-Host "=== Launch app ==="
$appExe = Join-Path $installRoot "Jarvis-Glas.exe"
if (Test-Path $appExe) {
  $appProc = Start-Process -FilePath $appExe -PassThru
  Start-Sleep -Seconds 5
  if (-not $appProc.HasExited) { Write-Host "PASS: app process running (PID $($appProc.Id))" } else { Write-Host "FAIL: app exited immediately" }
  $appProc | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($ok) { Write-Host "=== RESULT: INSTALL OK ===" } else { Write-Host "=== RESULT: INSTALL FAILED ===" }
