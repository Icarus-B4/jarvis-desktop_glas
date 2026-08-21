# J.A.R.V.I.S. Desktop - Bootstrap Installer Script
#
# Driven by the Tauri bootstrap installer (J.A.R.V.I.S Setup).
# Copies the bundled Electron win-unpacked build into the install directory and
# creates a Start Menu shortcut. The desktop app is then launched by the installer.
#
# Parameters:
#   -InstallRoot     Target install directory (e.g. %LOCALAPPDATA%\Programs\Jarvis-Glas)
#   -SourceUnpacked  Path to the Electron win-unpacked build (bundled by Tauri resources)
#
# Stage markers: the script writes "[stage:NAME] <msg>" lines to stdout so the
# Rust installer can translate them into granular progress stages (like Hermes).

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [string]$SourceUnpacked = "win-unpacked"
)

$ErrorActionPreference = "Stop"

# Write the log file next to the installed app (same folder as the destination),
# so "Open logs" reveals it in the install directory.
$logDir = $InstallRoot
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "bootstrap-installer.log"
Start-Transcript -Path $logFile -Force | Out-Null

function Log($msg) {
    Write-Output "[jarvis-install] $msg"
}

function Stage($name, $msg) {
    Write-Output "[stage:$name] $msg"
}

Log "Installing J.A.R.V.I.S. Desktop to: $InstallRoot"

# Resolve the source build. When bundled, Tauri places it under the installer's
# resources as `win-unpacked`. If -SourceUnpacked is a relative path, resolve it
# relative to this script's directory.
$rawPath = $null
if (Test-Path variable:PSCommandPath) { $rawPath = $PSCommandPath }
if (-not $rawPath) { $rawPath = $MyInvocation.MyCommand.Path }
if (-not $rawPath) { $rawPath = $MyInvocation.MyCommand.Definition }
if (-not $rawPath) { $rawPath = $PSScriptRoot }
# Strip the \\?\ long-path prefix if present (breaks Split-Path on some PS builds).
if ($rawPath -like '\\?\*') { $rawPath = $rawPath.Substring(4) }
$scriptDir = Split-Path -Parent $rawPath
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

# Stage 1: prepare
Stage "prepare" "Vorbereiten des Installationsverzeichnisses..."
if (-not (Test-Path $InstallRoot)) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}
Log "Install directory ready: $InstallRoot"

# Stage 2: copy
Stage "copy" "Kopiere Anwendungsdateien..."
# Robocopy for resilient copy (handles long paths, large trees).
& robocopy.exe "$src" "$InstallRoot" /E /NFL /NDL /NJH /NJS /nc /ns /np
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
    Write-Error "robocopy failed with exit code $robocopyExit"
    exit $robocopyExit
}
Log "Application files copied."

# Stage 3: shortcut
Stage "shortcut" "Erstelle Startmenu-Verknuepfung..."
$startMenu = [System.Environment]::GetFolderPath('StartMenu')
$programsDir = Join-Path $startMenu "Programs"
$shortcutPath = Join-Path $programsDir "Jarvis-Glas.lnk"
$exePath = Join-Path $InstallRoot "J.A.R.V.I.S.exe"

$WScriptShell = New-Object -ComObject WScript.Shell

# Start Menu shortcut
$startMenu = [System.Environment]::GetFolderPath('StartMenu')
$programsDir = Join-Path $startMenu "Programs"
$shortcutPath = Join-Path $programsDir "Jarvis-Glas.lnk"
$shortcut = $WScriptShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = "J.A.R.V.I.S. Desktop - Private Control Room"
$shortcut.Save()
Log "Start Menu shortcut created: $shortcutPath"

# Desktop shortcut (exactly one, alongside the Start Menu link)
$desktopDir = [System.Environment]::GetFolderPath('Desktop')
$desktopShortcutPath = Join-Path $desktopDir "Jarvis-Glas.lnk"
$desktopShortcut = $WScriptShell.CreateShortcut($desktopShortcutPath)
$desktopShortcut.TargetPath = $exePath
$desktopShortcut.WorkingDirectory = $InstallRoot
$desktopShortcut.Description = "J.A.R.V.I.S. Desktop - Private Control Room"
$desktopShortcut.Save()
Log "Desktop shortcut created: $desktopShortcutPath"

# Stage 4: LifeOS Brain installieren (lokal im User-Home via bun) — NON-FATAL
Stage "lifeos" "Installiere LifeOS Brain (lokal)..."
try {
    $lifeosRoot = Join-Path $env:USERPROFILE "LifeOS"
    $lifeosRepo = Join-Path $lifeosRoot "LifeOS"
    $bunExe = Join-Path $InstallRoot "resources\bun\bun.exe"

    if (-not (Test-Path $bunExe)) {
        Log "Warnung: bun.exe nicht gefunden unter $bunExe - ueberspringe LifeOS-Clone."
    } else {
        if (-not (Test-Path $lifeosRoot)) {
            New-Item -ItemType Directory -Path $lifeosRoot -Force | Out-Null
        }
        if (Test-Path $lifeosRepo) {
            Log "LifeOS repo bereits vorhanden: $lifeosRepo"
        } else {
            Log "Clone LifeOS repo nach $lifeosRepo ..."
            & git clone --depth 1 "https://github.com/danielmiessler/LifeOS.git" "$lifeosRepo" 2>&1 | Out-Null
            if (Test-Path $lifeosRepo) {
                Log "LifeOS repo geklont."
                Push-Location $lifeosRepo
                try {
                    & $bunExe install 2>&1 | Out-Null
                    Log "LifeOS bun install abgeschlossen."
                } catch {
                    Log "Warnung: bun install fehlgeschlagen - $($_.Exception.Message)"
                } finally {
                    Pop-Location
                }
            } else {
                Log "Warnung: git clone fehlgeschlagen - LifeOS manuell ueber die App einrichten."
            }
        }
    }
} catch {
    Log "Warnung: LifeOS-Installation uebersprungen (nicht kritisch) - $($_.Exception.Message)"
}

# Stage 4: finalize
Stage "finalize" "Schliesse Installation ab..."
Log "Installation complete."
exit 0
