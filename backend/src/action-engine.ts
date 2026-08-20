import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { clickCursor, setCursorNormalizedPosition, typeAtCursor } from "./cursor-bridge";
import type {
  JarvisActionDecideRequest,
  JarvisActionIntent,
  JarvisActionProposeRequest,
} from "@jarvis/shared";

export type UrlOpener = (url: string) => Promise<void>;

// Called whenever an intent is proposed or its status changes, so the
// Electron renderer can react to completions (e.g. open a URL on the
// main stage) without polling. The backend runs in a separate process
// and cannot call the renderer directly, so events travel over the
// existing SSE channel (JarvisLiveEvent).
export type IntentEventListener = (intent: JarvisActionIntent) => void;

export type JarvisActionEngineOptions = {
  openUrl?: UrlOpener;
  onIntentEvent?: IntentEventListener;
};

export type JarvisActionEngine = {
  getActions(): Promise<JarvisActionIntent[]>;
  proposeAction(request: JarvisActionProposeRequest): Promise<JarvisActionIntent>;
  decideAction(request: JarvisActionDecideRequest): Promise<JarvisActionIntent>;
  cancelAll(): void;
};

export type InstalledApp = {
  name: string;
  appId: string;
};

export class DefaultJarvisActionEngine implements JarvisActionEngine {
  private intents = new Map<string, JarvisActionIntent>();
  private scratchpadNotes: Array<{ id: string; text: string; createdAt: string }> = [];
  private installedAppsCache: InstalledApp[] | null = null;
  private installedAppsLastFetched = 0;
  private activeExecutions = new Set<AbortController>();
  private openUrl?: UrlOpener;
  private onIntentEvent?: IntentEventListener;

  constructor(options?: JarvisActionEngineOptions) {
    this.openUrl = options?.openUrl;
    this.onIntentEvent = options?.onIntentEvent;
  }

  private emitIntentEvent(intent: JarvisActionIntent): void {
    try {
      this.onIntentEvent?.(intent);
    } catch (err) {
      console.warn("[action-engine] onIntentEvent listener failed:", err);
    }
  }

  cancelAll(): void {
    for (const ac of this.activeExecutions) {
      ac.abort();
    }
    this.activeExecutions.clear();
  }

  /** Lädt den Index aller auf Windows installierten Apps via Get-StartApps */
  private async getInstalledApps(): Promise<InstalledApp[]> {
    const now = Date.now();
    if (this.installedAppsCache && now - this.installedAppsLastFetched < 300_000) {
      return this.installedAppsCache;
    }

    try {
      const psCommand = `powershell.exe -NoProfile -Command "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"`;
      const output = await new Promise<string>((resolve, reject) => {
        exec(psCommand, { timeout: 10_000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });

      if (output) {
        // Suche nach dem ersten '[' oder '{' und dem letzten ']' oder '}', um PowerShell Profile-Banner zu ignorieren
        const firstBracket = output.indexOf("[");
        const firstBrace = output.indexOf("{");
        let startIdx = -1;
        if (firstBracket !== -1 && firstBrace !== -1) startIdx = Math.min(firstBracket, firstBrace);
        else if (firstBracket !== -1) startIdx = firstBracket;
        else if (firstBrace !== -1) startIdx = firstBrace;

        const lastBracket = output.lastIndexOf("]");
        const lastBrace = output.lastIndexOf("}");
        const endIdx = Math.max(lastBracket, lastBrace);

        if (startIdx !== -1 && endIdx > startIdx) {
          const cleanJson = output.slice(startIdx, endIdx + 1);
          const parsed = JSON.parse(cleanJson);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          this.installedAppsCache = list
            .filter((item: any) => item && typeof item.Name === "string" && typeof item.AppID === "string")
            .map((item: any) => ({ name: item.Name.trim(), appId: item.AppID.trim() }));
          this.installedAppsLastFetched = now;
          return this.installedAppsCache;
        }
      }
    } catch (err) {
      console.warn("Fehler beim Abrufen der installierten Windows Apps via Get-StartApps:", err);
    }

    return this.installedAppsCache ?? [];
  }

  /** Findet die am besten passende App für einen Suchbegriff */
  private async findInstalledApp(query: string): Promise<InstalledApp | null> {
    const apps = await this.getInstalledApps();
    if (apps.length === 0) return null;

    const cleanQuery = query
      .toLowerCase()
      .replace(/^(öffne|starte|die|das|der|app|application|programm)\s+/g, "")
      .replace(/[\.\,\!]/g, "")
      .trim();

    if (!cleanQuery) return null;

    return apps.find((a) => a.name.toLowerCase() === cleanQuery) ?? null;
  }

  async getActions(): Promise<JarvisActionIntent[]> {
    return Array.from(this.intents.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async proposeAction(request: JarvisActionProposeRequest): Promise<JarvisActionIntent> {
    const now = new Date().toISOString();
    const intent: JarvisActionIntent = {
      id: `act-${crypto.randomUUID()}`,
      capability: request.capability,
      title: request.title,
      description: request.description,
      params: request.params ?? {},
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    };
    this.intents.set(intent.id, intent);
    this.emitIntentEvent(intent);
    return intent;
  }

  async decideAction(request: JarvisActionDecideRequest): Promise<JarvisActionIntent> {
    const intent = this.intents.get(request.intentId);
    if (!intent) throw new Error("Action intent not found");

    if (intent.status !== "proposed") {
      // Wenn die Aktion bereits genehmigt oder abgeschlossen ist, geben wir das Intent idempotent zurück
      return intent;
    }

    const now = new Date().toISOString();

    if (request.decision === "reject") {
      const updated: JarvisActionIntent = {
        ...intent,
        status: "rejected",
        updatedAt: now,
      };
      this.intents.set(intent.id, updated);
      this.emitIntentEvent(updated);
      return updated;
    }

    // Explicit User Approval -> executing-approved lifecycle
    const executing: JarvisActionIntent = {
      ...intent,
      status: "executing",
      updatedAt: now,
    };
    this.intents.set(intent.id, executing);
    this.emitIntentEvent(executing);

    try {
      const result = await this.executeCapability(intent.capability, intent.params);
      const completed: JarvisActionIntent = {
        ...executing,
        status: "completed",
        result,
        updatedAt: new Date().toISOString(),
      };
      this.intents.set(intent.id, completed);
      this.emitIntentEvent(completed);
      return completed;
    } catch (err) {
      const failed: JarvisActionIntent = {
        ...executing,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      };
      this.intents.set(intent.id, failed);
      this.emitIntentEvent(failed);
      return failed;
    }
  }

  private async executeCapability(capability: string, params: Record<string, unknown>): Promise<unknown> {
    if (capability === "barehands.toggle") {
      const mode = String(params.mode ?? "").trim();
      return { success: true, action: "barehands.toggle", mode, message: `Barehands-Modus '${mode}' angefordert.` };
    }

    if (capability === "barehands.cursor") {
      const action = String(params.action ?? "").trim();
      const dx = typeof params.dx === "number" ? params.dx : 0;
      const dy = typeof params.dy === "number" ? params.dy : 0;
      // Cursor-Bridge is optional at runtime; we succeed logically so the chat flow
      // doesn't block on Windows-only side effects during normal API handling.
      return { success: true, action, dx, dy, message: `Cursor-Aktion '${action}' protokolliert.` };
    }

    // 1. Webseiten auf der Hauptbühne öffnen (NICHT externer Browser)
    // Die tatsächliche Anzeige erfolgt im Renderer via setStageView("web", url).
    // Hier wird nur die URL bestätigt, keine externe Ausführung getriggert.
    if (capability === "app.open_url" || capability === "browser.open") {
      const rawUrl = String(params.url ?? params.link ?? params.target ?? "").trim();
      if (!rawUrl) throw new Error("Keine Ziel-URL angegeben.");
      const safeUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      return { success: true, openedUrl: safeUrl, stageView: "web", message: `URL '${safeUrl}' auf der Hauptbühne geöffnet.` };
    }

    // 2. Windows-Programme starten (Dynamisch via Get-StartApps Index & Fallback)
    if (capability === "app.open_app" || capability === "system.open_app" || capability === "media.open") {
      const rawName = String(params.name ?? params.app ?? params.target ?? "").trim();
      if (!rawName) throw new Error("Kein Anwendungsname angegeben.");

      const cleanQuery = rawName.replace(/[\.\,\!]/g, "").trim();
      const appQuery = rawName.toLowerCase().trim();
      if (appQuery.includes("wikipedia") || appQuery.includes("webstark") || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(rawName.trim())) {
        throw new Error(`'${rawName}' ist eine Webseite und darf nicht als Windows-App gestartet werden. Nutze app.open_url für die Hauptbühne.`);
      }

      // User-created desktop shortcuts take precedence over StartApps/Store.
      const userProfile = process.env.USERPROFILE?.trim();
      const appData = process.env.APPDATA?.trim();
      const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
      const exactLaunchCandidates: Record<string, string[]> = {
        spotify: userProfile ? [join(userProfile, "Desktop", "Spotify.lnk")] : [],
        steam: [
          ...(appData ? [join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Steam", "Steam.lnk")] : []),
          join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "Steam", "Steam.lnk"),
        ],
        brave: [join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "Brave.lnk")],
        chrome: [join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "Google Chrome.lnk")],
        antigravity: appData ? [join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Antigravity", "Antigravity IDE.lnk")] : [],
        "proton mail": userProfile ? [join(userProfile, "Desktop", "Proton Mail.lnk")] : [],
        firefox: [
          "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
          "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
        ],
        edge: ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
        opera: [
          ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "Opera", "launcher.exe")] : []),
          ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "Opera GX", "launcher.exe")] : []),
        ],
        ea: [
          "C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe",
          "C:\\Program Files (x86)\\Origin\\Origin.exe",
        ],
      };
      const exactKey = appQuery.includes("proton") ? "proton mail"
        : appQuery.includes("antigravity") ? "antigravity"
          : appQuery.includes("spotify") ? "spotify"
            : appQuery.includes("steam") ? "steam"
              : appQuery.includes("brave") ? "brave"
                : appQuery.includes("chrome") ? "chrome"
                  : appQuery.includes("firefox") ? "firefox"
                    : appQuery.includes("edge") ? "edge"
                      : appQuery.includes("opera") ? "opera"
                        : appQuery.includes("origin") || /^ea(?: app)?$/.test(appQuery) ? "ea"
                          : "";
      if (exactKey) {
        if (exactKey === "spotify") {
          const alreadyRunning = await new Promise<boolean>((resolve) => {
            const script = "[bool](Get-CimInstance Win32_Process -Filter \"Name='brave.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*--app-id=pjibgclleladliembfgfagdaldikeohf*' } | Select-Object -First 1)";
            execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8_000 }, (err, stdout) => {
              resolve(!err && stdout.trim().toLowerCase() === "true");
            });
          });
          if (alreadyRunning) {
            return { success: true, app: rawName, alreadyRunning: true, message: "Die Spotify-PWA ist bereits geöffnet; es wurde kein zweites Fenster gestartet." };
          }
        }
        const target = exactLaunchCandidates[exactKey]?.find((candidate) => existsSync(candidate));
        if (!target) throw new Error(`Die explizit erlaubte Anwendung '${rawName}' wurde auf diesem PC nicht gefunden.`);
        await new Promise<void>((resolve, reject) => {
          const executable = target.toLowerCase().endsWith(".lnk") ? "explorer.exe" : target;
          const args = target.toLowerCase().endsWith(".lnk") ? [target] : [];
          execFile(executable, args, { windowsHide: false, timeout: 10_000 }, (err) => {
            if (err) reject(new Error(`Anwendung '${rawName}' konnte nicht gestartet werden: ${err.message}`));
            else resolve();
          });
        });
        return { success: true, app: rawName, target, message: `Anwendung '${rawName}' über die exakte Allowlist gestartet.` };
      }

      const shortcutName = `${rawName}.lnk`;
      const desktopShortcut = userProfile ? join(userProfile, "Desktop", shortcutName) : "";
      if (desktopShortcut && existsSync(desktopShortcut)) {
        const escapedShortcut = desktopShortcut.replace(/'/g, "''");
        await new Promise<void>((resolve, reject) => {
          exec(`Start-Process -FilePath '${escapedShortcut}'`, { shell: "powershell.exe", windowsHide: true, timeout: 10_000 }, (err) => {
            if (err) reject(new Error(`Desktop-Verknüpfung '${shortcutName}' konnte nicht gestartet werden: ${err.message}`));
            else resolve();
          });
        });
        return { success: true, app: rawName, shortcut: desktopShortcut, message: `Desktop-Verknüpfung '${shortcutName}' gestartet.` };
      }

      // Dynamische Suche nach der installierten Windows-App (StartMenü, UWP, Store, Win32)
      const matchedApp = await this.findInstalledApp(cleanQuery);

      if (matchedApp) {
        await new Promise<void>((resolve, reject) => {
          const launchCmd = `Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\\${matchedApp.appId.replace(/"/g, '`"')}"`;
          exec(launchCmd, { shell: "powershell.exe", timeout: 10_000 }, (err) => {
            if (err) reject(new Error(`Fehler beim Starten von '${matchedApp.name}': ${err.message}`));
            else resolve();
          });
        });

        return { success: true, app: matchedApp.name, appId: matchedApp.appId, message: `Anwendung '${matchedApp.name}' erfolgreich gestartet.` };
      }

      // Fallback nur für bekannte, explizit erlaubte Windows-Apps.
      // Niemals beliebige Namen mit `start "" "<name>"` ausführen: Begriffe wie
      // "Wikipedia" werden sonst vom Windows-Shell-Fallback als Datei/Suche/App
      // interpretiert und öffnen Chrome, Fehlerfenster oder fremde Tools.
      const query = cleanQuery.toLowerCase();
      const allowedCommands: Record<string, string> = {
        rechner: "calc.exe", taschenrechner: "calc.exe", calc: "calc.exe",
        notepad: "notepad.exe", editor: "notepad.exe",
        "media player": "wmplayer.exe", wmplayer: "wmplayer.exe", "windows media": "wmplayer.exe",
        paint: "mspaint.exe", task: "taskmgr.exe", taskmgr: "taskmgr.exe", taskmanager: "taskmgr.exe",
        vscode: "code", code: "code", explorer: "explorer.exe", dateimanager: "explorer.exe",
        terminal: "powershell.exe", powershell: "powershell.exe", cmd: "cmd.exe", eingabeaufforderung: "cmd.exe",
        systemsteuerung: "control.exe", "control panel": "control.exe",
        word: "winword", "microsoft word": "winword", excel: "excel", "microsoft excel": "excel",
        powerpoint: "powerpnt", "microsoft powerpoint": "powerpnt", discord: "discord",
      };
      const cmd = allowedCommands[query];

      if (!cmd) {
        throw new Error(`Unbekannte Windows-App '${rawName}' nicht gestartet. Webseiten müssen als app.open_url auf der Hauptbühne geöffnet werden.`);
      }

      await new Promise<void>((resolve, reject) => {
        exec(`start "" "${cmd.replace(/"/g, '\\"')}"`, { shell: "cmd.exe", timeout: 4000 }, (err) => {
          if (err) reject(new Error(`Anwendung '${rawName}' konnte nicht gestartet werden: ${err.message}`));
          else resolve();
        });
      });

      return { success: true, app: rawName, command: cmd, message: `Anwendung '${rawName}' gestartet.` };
    }

    if (capability === "app.close") {
      if (process.platform !== "win32") throw new Error("App-Schließen wird nur unter Windows unterstützt.");
      const rawName = String(params.name ?? params.app ?? "").toLowerCase().trim();
      const processMap: Record<string, string[]> = {
        steam: ["steam.exe", "steamwebhelper.exe"],
        brave: ["brave.exe"],
        chrome: ["chrome.exe"],
        firefox: ["firefox.exe"],
        edge: ["msedge.exe"],
        opera: ["opera.exe"],
        "opera gx": ["opera.exe"],
        origin: ["Origin.exe"],
        ea: ["EADesktop.exe"],
        "ea app": ["EADesktop.exe"],
        antigravity: ["Antigravity.exe"],
        "proton mail": ["Proton Mail.exe"],
      };
      const names = processMap[rawName];
      if (!names) throw new Error(`Anwendung '${rawName}' steht nicht auf der sicheren Schließen-Allowlist.`);
      const results: string[] = [];
      for (const imageName of names) {
        await new Promise<void>((resolve) => {
          execFile("taskkill.exe", ["/IM", imageName, "/T"], { windowsHide: true, timeout: 10_000 }, (err) => {
            results.push(err ? `${imageName}: nicht aktiv` : `${imageName}: beendet`);
            resolve();
          });
        });
      }
      return { success: true, action: "close_app", app: rawName, results, message: results.join(", ") };
    }

    // 3. Medien-Steuerung (Media Keys: Play, Pause, Next, Prev, Stop, Volume + Spotify PWA)
    if (capability === "media.control" || capability === "system.media_control") {
      const action = String(params.action ?? params.command ?? params.type ?? "play").toLowerCase().trim();
      const trackQuery = String(params.query ?? params.song ?? params.track ?? params.artist ?? "").trim();

      // A concrete title/artist is searched and played inside the user's Spotify PWA.
      if (trackQuery) {
        const scriptCandidates = [
          join(process.cwd(), "scripts", "spotify-control.ps1"),
          join(process.cwd(), "..", "scripts", "spotify-control.ps1"),
          join(process.cwd(), "..", "..", "scripts", "spotify-control.ps1"),
        ];
        const spotifyScript = scriptCandidates.find((candidate) => existsSync(candidate));
        if (!spotifyScript) throw new Error("Spotify-Steuerskript nicht gefunden.");

        const escapedScript = spotifyScript.replace(/'/g, "''");
        const escapedQuery = trackQuery.replace(/'/g, "''");
        const runSpotifyQuery = (): Promise<string> => new Promise((resolve, reject) => {
          exec(`& '${escapedScript}' -Query '${escapedQuery}'`, { shell: "powershell.exe", windowsHide: true, timeout: 20_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).trim()));
            else resolve(stdout.trim());
          });
        });

        let output: string;
        try {
          // First try the already running PWA. This avoids duplicate Spotify windows.
          output = await runSpotifyQuery();
        } catch (initialError) {
          const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
          if (!initialMessage.includes("Spotify PWA window not found")) {
            throw new Error(`Spotify konnte '${trackQuery}' nicht abspielen: ${initialMessage}`);
          }

          const userProfile = process.env.USERPROFILE?.trim();
          const spotifyShortcut = userProfile ? join(userProfile, "Desktop", "Spotify.lnk") : "";
          if (!spotifyShortcut || !existsSync(spotifyShortcut)) {
            throw new Error("Spotify-PWA ist nicht geöffnet und die Desktop-Verknüpfung wurde nicht gefunden.");
          }
          const escapedShortcut = spotifyShortcut.replace(/'/g, "''");
          await new Promise<void>((resolve, reject) => {
            exec(`Start-Process -FilePath '${escapedShortcut}'`, { shell: "powershell.exe", windowsHide: true, timeout: 10_000 }, (err) => {
              if (err) reject(new Error(`Spotify-Verknüpfung konnte nicht gestartet werden: ${err.message}`));
              else resolve();
            });
          });
          await new Promise((resolve) => setTimeout(resolve, 2200));
          try {
            output = await runSpotifyQuery();
          } catch (retryError) {
            throw new Error(`Spotify konnte '${trackQuery}' nach dem Start nicht abspielen: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
          }
        }
        return { success: true, action: "spotify_search_play", query: trackQuery, output, message: `Titel '${trackQuery}' über Spotify gestartet.` };
      }

      if (["play", "pause", "stop", "next", "prev", "mute"].includes(action)) {
        const scriptCandidates = [
          join(process.cwd(), "scripts", "spotify-control.ps1"),
          join(process.cwd(), "..", "scripts", "spotify-control.ps1"),
          join(process.cwd(), "..", "..", "scripts", "spotify-control.ps1"),
        ];
        const spotifyScript = scriptCandidates.find((candidate) => existsSync(candidate));
        if (!spotifyScript) throw new Error("Spotify-Steuerskript nicht gefunden.");
        const escapedScript = spotifyScript.replace(/'/g, "''");
        const escapedAction = action.replace(/'/g, "''");
        const output = await new Promise<string>((resolve, reject) => {
          exec(`& '${escapedScript}' -Action '${escapedAction}'`, { shell: "powershell.exe", windowsHide: true, timeout: 15_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(`Spotify-Aktion '${action}' fehlgeschlagen: ${(stderr || err.message).trim()}`));
            else resolve(stdout.trim());
          });
        });
        return { success: true, action, output, message: `Spotify-Aktion '${action}' ausgeführt.` };
      }

      let charCode = 179; // Default: Play/Pause (0xB3 / 179)
      if (action.includes("next") || action.includes("nächster") || action.includes("vorwärts")) charCode = 176;
      else if (action.includes("prev") || action.includes("zurück") || action.includes("vorheriger")) charCode = 177;
      else if (action.includes("stop") || action.includes("stopp")) charCode = 178;
      else if (action.includes("mute") || action.includes("stummschalten")) charCode = 173;
      else if (action.includes("volup") || action.includes("lauter")) charCode = 175;
      else if (action.includes("voldown") || action.includes("leiser")) charCode = 174;

      const psScript = `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]${charCode})`;

      await new Promise<void>((resolve, reject) => {
        exec(psScript, { shell: "powershell.exe" }, (err) => {
          if (err) reject(new Error(`Fehler bei der Medien-Steuerung '${action}': ${err.message}`));
          else resolve();
        });
      });

      return { success: true, action, message: `Medien-Befehl '${action}' erfolgreich ausgeführt.` };
    }

    // 4. Known user folders only (no model-provided arbitrary paths).
    if (capability === "system.open_folder") {
      const folder = String(params.folder ?? params.name ?? "").toLowerCase().trim();
      const userProfile = process.env.USERPROFILE?.trim();
      if (!userProfile) throw new Error("Windows-Benutzerprofil nicht verfügbar.");
      const knownFolders: Record<string, string> = {
        desktop: join(userProfile, "Desktop"),
        dokumente: join(userProfile, "Documents"),
        documents: join(userProfile, "Documents"),
        downloads: join(userProfile, "Downloads"),
        bilder: join(userProfile, "Pictures"),
        pictures: join(userProfile, "Pictures"),
        videos: join(userProfile, "Videos"),
        musik: join(userProfile, "Music"),
        music: join(userProfile, "Music"),
      };
      const folderPath = knownFolders[folder];
      if (!folderPath) throw new Error(`Ordner '${folder}' ist nicht in der sicheren Allowlist.`);
      if (!existsSync(folderPath)) throw new Error(`Ordner '${folderPath}' wurde nicht gefunden.`);
      await new Promise<void>((resolve, reject) => {
        execFile("explorer.exe", [folderPath], { windowsHide: true, timeout: 10_000 }, (err) => {
          if (err) reject(new Error(`Ordner '${folderPath}' konnte nicht geöffnet werden: ${err.message}`));
          else resolve();
        });
      });
      return { success: true, action: "open_folder", folder, path: folderPath };
    }

    if (capability === "system.cursor_click" || capability === "system.cursor_type") {
      const x = Number(params.x);
      const y = Number(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
        throw new Error("Vision-Zielkoordinaten müssen im Bereich 0 bis 1000 liegen.");
      }
      await setCursorNormalizedPosition(x, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await clickCursor();
      if (capability === "system.cursor_type") {
        const text = String(params.text ?? "");
        if (!text || text.length > 2_000) throw new Error("Einfügetext fehlt oder ist zu lang.");
        await new Promise((resolve) => setTimeout(resolve, 120));
        await typeAtCursor(text);
        return { success: true, action: "cursor_type", x, y, textLength: text.length };
      }
      return { success: true, action: "cursor_click", x, y };
    }

    // 5. Power action. Execution only happens after the renderer presents the
    // proposed action and the user explicitly approves it.
    if (capability === "system.shutdown") {
      if (process.platform !== "win32") throw new Error("Herunterfahren wird nur unter Windows unterstützt.");
      await new Promise<void>((resolve, reject) => {
        execFile("shutdown.exe", ["/s", "/t", "30", "/c", "Von Jarvis bestätigt. Mit shutdown /a abbrechen."], { windowsHide: true, timeout: 10_000 }, (err) => {
          if (err) reject(new Error(`Herunterfahren konnte nicht geplant werden: ${err.message}`));
          else resolve();
        });
      });
      return { success: true, action: "shutdown", delaySeconds: 30, message: "Windows wird in 30 Sekunden heruntergefahren. Abbruch mit shutdown /a." };
    }

    // 6. Konsolen-Befehl ausführen
    if (capability === "system.execute_command" || capability === "terminal.execute") {
      const command = String(params.command ?? params.cmd ?? "").trim();
      if (!command) throw new Error("Kein Befehl angegeben.");

      const output = await new Promise<string>((resolve) => {
        exec(command, { shell: "powershell.exe", timeout: 15_000 }, (err, stdout, stderr) => {
          if (err) resolve(`Fehler (Exit-Code ${err.code ?? 1}):\n${stderr || err.message}`);
          else resolve(stdout.trim() || "Befehl ohne Bildschirmausgabe ausgeführt.");
        });
      });

      return { success: true, command, output };
    }

    // 6. Scratchpad Notizen
    if (capability === "scratchpad.write" || capability === "system.echo") {
      const text = String(params.text ?? params.note ?? params.message ?? "Scratchpad entry");
      const note = { id: `note-${crypto.randomUUID()}`, text, createdAt: new Date().toISOString() };
      this.scratchpadNotes.unshift(note);
      return { note, totalNotes: this.scratchpadNotes.length };
    }

    // 7. Desktop Screenshot
    if (capability === "system.take_screenshot" || capability === "system.screenshot") {
      return { success: true, action: "take_screenshot", message: "Desktop Screenshot wird auf der Hauptbühne angezeigt." };
    }

    // 8. Live Kamera Feed
    if (capability === "camera.open" || capability === "camera.capture" || capability === "camera.capture_photo") {
      return { success: true, action: "open_camera", message: "Live-Kamera Feed wird auf der Hauptbühne aktiviert." };
    }

    throw new Error(`Capability '${capability}' wird aktuell nicht unterstützt.`);
  }
}
