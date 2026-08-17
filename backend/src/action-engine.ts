import { exec } from "node:child_process";
import type {
  JarvisActionDecideRequest,
  JarvisActionIntent,
  JarvisActionProposeRequest,
} from "@jarvis/shared";

export type JarvisActionEngine = {
  getActions(): Promise<JarvisActionIntent[]>;
  proposeAction(request: JarvisActionProposeRequest): Promise<JarvisActionIntent>;
  decideAction(request: JarvisActionDecideRequest): Promise<JarvisActionIntent>;
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

    // 1. Exakte Namensübereinstimmung
    const exact = apps.find((a) => a.name.toLowerCase() === cleanQuery);
    if (exact) return exact;

    // 2. Namensanfang oder Teil-String Übereinstimmung (z.B. "codex" -> "ChatGPT" mit AppID "OpenAI.Codex_...")
    const partial = apps.find(
      (a) =>
        a.name.toLowerCase().includes(cleanQuery) ||
        cleanQuery.includes(a.name.toLowerCase()) ||
        a.appId.toLowerCase().includes(cleanQuery),
    );
    if (partial) return partial;

    // 3. Worteil-Treffer (z.B. "chatgpt" -> "ChatGPT")
    const wordMatch = apps.find((a) => {
      const words = a.name.toLowerCase().split(/\s+/);
      return words.some((w) => w.startsWith(cleanQuery) || cleanQuery.startsWith(w));
    });
    if (wordMatch) return wordMatch;

    return null;
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
      return updated;
    }

    // Explicit User Approval -> executing-approved lifecycle
    const executing: JarvisActionIntent = {
      ...intent,
      status: "executing",
      updatedAt: now,
    };
    this.intents.set(intent.id, executing);

    try {
      const result = await this.executeCapability(intent.capability, intent.params);
      const completed: JarvisActionIntent = {
        ...executing,
        status: "completed",
        result,
        updatedAt: new Date().toISOString(),
      };
      this.intents.set(intent.id, completed);
      return completed;
    } catch (err) {
      const failed: JarvisActionIntent = {
        ...executing,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      };
      this.intents.set(intent.id, failed);
      return failed;
    }
  }

  private async executeCapability(capability: string, params: Record<string, unknown>): Promise<unknown> {
    // 1. Webseiten im Browser öffnen
    if (capability === "app.open_url" || capability === "browser.open") {
      const rawUrl = String(params.url ?? params.link ?? params.target ?? "").trim();
      if (!rawUrl) throw new Error("Keine Ziel-URL angegeben.");
      const safeUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

      await new Promise<void>((resolve, reject) => {
        exec(`start "" "${safeUrl.replace(/"/g, '\\"')}"`, { shell: "cmd.exe" }, (err) => {
          if (err) reject(new Error(`Fehler beim Öffnen der URL: ${err.message}`));
          else resolve();
        });
      });

      return { success: true, openedUrl: safeUrl, message: `URL '${safeUrl}' im Standardbrowser geöffnet.` };
    }

    // 2. Windows-Programme starten (Dynamisch via Get-StartApps Index & Fallback)
    if (capability === "app.open_app" || capability === "system.open_app" || capability === "media.open") {
      const rawName = String(params.name ?? params.app ?? params.target ?? "").trim();
      if (!rawName) throw new Error("Kein Anwendungsname angegeben.");

      const cleanQuery = rawName.replace(/[\.\,\!]/g, "").trim();

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

      // Fallback auf statische Aliase oder direkten start Befehl
      let cmd = cleanQuery.toLowerCase();
      if (cmd.includes("rechner") || cmd.includes("calc")) cmd = "calc.exe";
      else if (cmd.includes("notepad") || cmd.includes("editor")) cmd = "notepad.exe";
      else if (cmd.includes("media player") || cmd.includes("wmplayer") || cmd.includes("musik player") || cmd.includes("windows media")) cmd = "wmplayer.exe";
      else if (cmd.includes("spotify")) cmd = "spotify";
      else if (cmd.includes("vlc")) cmd = "vlc";
      else if (cmd.includes("paint") || cmd.includes("malen")) cmd = "mspaint.exe";
      else if (cmd.includes("task") || cmd.includes("taskmgr") || cmd.includes("taskmanager")) cmd = "taskmgr.exe";
      else if (cmd.includes("vscode") || cmd === "code") cmd = "code";
      else if (cmd.includes("chrome")) cmd = "start chrome";
      else if (cmd.includes("edge")) cmd = "start msedge";
      else if (cmd.includes("explorer") || cmd.includes("dateimanager")) cmd = "explorer.exe";
      else if (cmd.includes("terminal") || cmd.includes("powershell")) cmd = "powershell.exe";
      else if (cmd.includes("cmd") || cmd.includes("eingabeaufforderung")) cmd = "cmd.exe";
      else if (cmd.includes("systemsteuerung") || cmd.includes("control panel")) cmd = "control.exe";
      else if (cmd.includes("word")) cmd = "winword";
      else if (cmd.includes("excel")) cmd = "excel";
      else if (cmd.includes("powerpoint")) cmd = "powerpnt";
      else if (cmd.includes("discord")) cmd = "discord";

      await new Promise<void>((resolve, reject) => {
        exec(`start "" "${cmd}"`, { shell: "cmd.exe", timeout: 4000 }, (err) => {
          if (err) {
            exec(`start ${cmd}`, { shell: "cmd.exe", timeout: 4000 }, (err2) => {
              if (err2) reject(new Error(`Anwendung '${rawName}' konnte nicht gestartet werden.`));
              else resolve();
            });
          } else resolve();
        });
      });

      return { success: true, app: rawName, message: `Anwendung '${rawName}' gestartet.` };
    }

    // 3. Medien-Steuerung (Media Keys: Play, Pause, Next, Prev, Stop, Volume + Track Search)
    if (capability === "media.control" || capability === "system.media_control") {
      const action = String(params.action ?? params.command ?? params.type ?? "play").toLowerCase().trim();
      const trackQuery = String(params.query ?? params.song ?? params.track ?? params.artist ?? "").trim();

      // Wenn ein konkreter Song/Künstler genannt wurde -> YouTube/Browser Suche zum Abspielen öffnen
      if (trackQuery) {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(trackQuery)}`;
        await new Promise<void>((resolve, reject) => {
          exec(`start "" "${searchUrl.replace(/"/g, '\\"')}"`, { shell: "cmd.exe" }, (err) => {
            if (err) reject(new Error(`Fehler beim Suchen des Songs: ${err.message}`));
            else resolve();
          });
        });
        return { success: true, action: "search_play", query: trackQuery, openedUrl: searchUrl, message: `Titel '${trackQuery}' auf YouTube aufgerufen.` };
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

    // 4. Konsolen-Befehl ausführen
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

    // 5. Scratchpad Notizen
    if (capability === "scratchpad.write" || capability === "system.echo") {
      const text = String(params.text ?? params.note ?? params.message ?? "Scratchpad entry");
      const note = { id: `note-${crypto.randomUUID()}`, text, createdAt: new Date().toISOString() };
      this.scratchpadNotes.unshift(note);
      return { note, totalNotes: this.scratchpadNotes.length };
    }

    // 6. Desktop Screenshot
    if (capability === "system.take_screenshot" || capability === "system.screenshot") {
      return { success: true, action: "take_screenshot", message: "Desktop Screenshot wird auf der Hauptbühne angezeigt." };
    }

    // 7. Live Kamera Feed
    if (capability === "camera.open" || capability === "camera.capture" || capability === "camera.capture_photo") {
      return { success: true, action: "open_camera", message: "Live-Kamera Feed wird auf der Hauptbühne aktiviert." };
    }

    throw new Error(`Capability '${capability}' wird aktuell nicht unterstützt.`);
  }
}
