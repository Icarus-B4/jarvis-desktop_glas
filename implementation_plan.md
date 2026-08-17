# Installer & Auto-Updater für Jarvis Desktop

Da die App jetzt optisch und technisch im "Hermes-Style" läuft, ist der nächste große Schritt das Packaging (Installer) und die Auto-Update-Logik. Wir werden das so aufbauen, wie es bei modernen Electron-Apps (und Hermes) Standard ist.

## Geplante Änderungen

### 1. Abhängigkeiten (Dependencies)
- **`electron-builder`**: Das Industrie-Standard-Tool, um aus Electron-Apps fertige Installer (`.exe`, `.msi`, `.dmg`, `.AppImage`) zu bauen.
- **`electron-updater`**: Ermöglicht nahtlose "Over-The-Air" (OTA) Updates im Hintergrund.

### 2. Konfiguration in `package.json`
- **`build`-Konfiguration**: Wir fügen einen Block für `electron-builder` hinzu, der definiert:
  - Wie die Windows-Installer (NSIS) konfiguriert sind.
  - Welches Icon (z.B. `icon.ico`) genutzt wird.
  - Wo die Updates gehostet werden (Publishing Provider, standardmäßig meist `github`, damit Updates direkt aus GitHub Releases geladen werden können).
- **Scripts**: Neue Scripts wie `npm run dist:win` zum automatischen Erstellen der Installer.

### 3. Update-Logik im Backend (`main.ts`)
- Import und Konfiguration des `autoUpdater` aus `electron-updater`.
- **Ereignis-Listener**: Einbinden der Update-Lifecycle-Events:
  - `update-available` (Update gefunden)
  - `download-progress` (Ladebalken/Fortschritt)
  - `update-downloaded` (Update bereit zur Installation)
- **Automatischer Start**: Aufruf von `autoUpdater.checkForUpdatesAndNotify()` beim Start der App.

### 4. IPC-Brücke & UI-Anbindung (Optional aber empfohlen)
- Bereitstellung von IPC-Channels (`preload.ts`), damit wir später in der Benutzeroberfläche (z.B. in den Einstellungen) einen Button "Nach Updates suchen" oder eine Ladeanzeige für das Update einbauen können.
- Einen Befehl bereitstellen, um die App neu zu starten und das Update zu installieren (`autoUpdater.quitAndInstall()`).

> [!IMPORTANT]
> **Open Question an dich:** 
> Wo planst du, die fertigen Installer in Zukunft bereitzustellen (für die Auto-Updates)? 
> Üblicherweise nutzt man **GitHub Releases**. Wenn das der Plan ist, kann ich `provider: "github"` vorkonfigurieren. Falls du einen eigenen Server dafür nutzt, müssten wir `generic` als Provider eintragen.

> [!TIP]
> **Tipp für den Installer:**
> NSIS erstellt schnelle Installer, die sich mit einem Klick installieren lassen (One-Click-Install) oder optional den Nutzer den Pfad wählen lassen. Ich würde für Jarvis einen One-Click-Installer empfehlen (wie bei Discord oder Slack).

Bist du mit diesem Plan einverstanden? Sobald du dein Go (und eventuell die Info zum Update-Provider) gibst, beginne ich mit der Installation und Einrichtung!
