# J.A.R.V.I.S Desktop — Bootstrap Installer Script
#
# Driven by the Tauri bootstrap installer (J.A.R.V.I.S Setup).
# Copies the bundled Electron win-unpacked build into the install directory and
# creates a Start Menu shortcut. The desktop app is then launched by the installer.
#
# Parameters:
#   -InstallRoot     Target install directory (e.g. %LOCALAPPDATA%\Programs\@jarvisdesktop\J.A.R.V.I.S)
#   -SourceUnpacked  Path to the Electron win-unpacked build (bundled by Tauri extraResources)

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [string]$SourceUnpacked = "win-unpacked"
)

$ErrorActionPreference = "Stop"

function Log($msg) {
    Write-Output "[jarvis-install] $msg"
}

Log "Installing J.A.R.V.I.S Desktop to: $InstallRoot"

# Resolve the source build. When bundled, Tauri places it under the installer's
# resources as `win-unpacked`. If -SourceUnpacked is a relative path, resolve it
# relative to this script's directory.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if ([System.IO.Path]::IsPathRooted($SourceUnpacked)) {
    $src = $SourceUnpacked
} else {
    $src = Join-Path $scriptDir $SourceUnpacked
}

if (-not (Test-Path $src)) {
    # Fallback: also check the repo release dir during local dev.
    $localRelease = Join-Path (Split-Path -Parent $scriptDir) "release\win-unpacked"
    if (Test-Path $localRelease) { $src = $localRelease }
}

if (-not (Test-Path $src)) {
    Write-Error "Source build not found: $src"
    exit 1
}

Log "Source build: $src"

# Create the install directory.
if (-not (Test-Path $InstallRoot)) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}

Log "Copying application files..."
# Robocopy for resilient copy (handles long paths, large trees).
$robocopy = & robocopy.exe "$src" "$InstallRoot" /E /NFL /NDL /NJH /NJS /nc /ns /np
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# Create Start Menu shortcut.
$startMenu = [System.Environment]::GetFolderPath('StartMenu')
$programsDir = Join-Path $startMenu "Programs"
$shortcutPath = Join-Path $programsDir "Jarvis-Glas.lnk"
$exePath = Join-Path $InstallRoot "Jarvis-Glas.exe"

Log "Creating Start Menu shortcut: $shortcutPath"
$WScriptShell = New-Object -ComObject WScript.Shell
$shortcut = $WScriptShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = "J.A.R.V.I.S. Desktop — Private Control Room"
$shortcut.Save()

Log "Installation complete."
exit 0
