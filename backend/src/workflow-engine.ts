import type {
  JarvisWorkflow,
  JarvisWorkflowRunResult,
} from "@jarvis/shared";
import type { JarvisActionEngine } from "./action-engine";

export type JarvisWorkflowEngine = {
  listWorkflows(): Promise<JarvisWorkflow[]>;
  runWorkflow(idOrTrigger: string): Promise<JarvisWorkflowRunResult>;
};

export class DefaultJarvisWorkflowEngine implements JarvisWorkflowEngine {
  private workflows: JarvisWorkflow[] = [
    {
      id: "morning-routine",
      name: "Morgen-Routine",
      triggerPhrases: ["guten morgen", "morgen routine", "starte morgen routine", "guten morgen jarvis"],
      description: "Begrüßung, öffnet wichtigste Webseiten (WebStark, Google) & prüft den System-Status.",
      steps: [
        { id: "step-1", type: "speak", description: "Guten Morgen Ed! Ich starte deine Morgen-Routine und öffne deine Arbeitsseiten.", params: { text: "Guten Morgen Ed! Ich starte deine Morgen-Routine." } },
        { id: "step-2", type: "open_url", description: "WebStark öffnen", params: { url: "https://webstark.org" } },
        { id: "step-3", type: "open_url", description: "Google öffnen", params: { url: "https://google.com" } },
        { id: "step-4", type: "system_check", description: "Systemdiagnose durchführen" },
      ],
    },
    {
      id: "dev-environment",
      name: "Dev-Environment Starten",
      triggerPhrases: ["dev environment", "starte dev environment", "dev start", "entwicklungsumgebung"],
      description: "Startet VS Code und Chrome für deine Programmier-Session.",
      steps: [
        { id: "step-1", type: "speak", description: "Starte deine Entwicklungsumgebung.", params: { text: "Starte deine Entwicklungsumgebung, Ed." } },
        { id: "step-2", type: "open_app", description: "VS Code starten", params: { name: "code" } },
        { id: "step-3", type: "open_app", description: "Chrome Browser starten", params: { name: "chrome" } },
      ],
    },
    {
      id: "work-mode",
      name: "Jarvis Arbeitsmodus",
      triggerPhrases: ["jarvis an die arbeit", "wir arbeiten", "arbeitsmodus", "starte arbeitsmodus"],
      description: "Startet Antigravity IDE, Proton Mail, Brave und die vorhandene Spotify-PWA.",
      steps: [
        { id: "step-1", type: "open_app", description: "Antigravity IDE starten", params: { name: "antigravity" } },
        { id: "step-2", type: "open_app", description: "Proton Mail starten", params: { name: "proton mail" } },
        { id: "step-3", type: "open_app", description: "Brave starten", params: { name: "brave" } },
        { id: "step-4", type: "open_app", description: "Spotify-PWA bereitstellen", params: { name: "spotify" } },
      ],
    },
    {
      id: "system-check",
      name: "Vollständiger System-Check",
      triggerPhrases: ["system check", "führe system check aus", "systemdiagnose", "prüfe status"],
      description: "Führt eine vollständige Diagnose der KI-Engine, des Speichers und des Mikrofons durch.",
      steps: [
        { id: "step-1", type: "speak", description: "Führe vollständige Systemdiagnose durch.", params: { text: "Führe Systemdiagnose durch." } },
        { id: "step-2", type: "system_check", description: "System-Diagnose ausführen" },
      ],
    },
  ];

  constructor(private actionEngine?: JarvisActionEngine) {}

  async listWorkflows(): Promise<JarvisWorkflow[]> {
    return [...this.workflows];
  }

  async runWorkflow(idOrTrigger: string): Promise<JarvisWorkflowRunResult> {
    const query = idOrTrigger.toLowerCase().trim();
    const wf = this.workflows.find(
      (w) => w.id === query || w.name.toLowerCase() === query || w.triggerPhrases.some((tp) => query.includes(tp))
    );

    if (!wf) {
      throw new Error(`Kein Workflow für '${idOrTrigger}' gefunden.`);
    }

    const logs: string[] = [];
    let executedSteps = 0;

    for (const step of wf.steps) {
      logs.push(`[${step.type.toUpperCase()}] ${step.description}`);
      try {
        let stepExecuted = false;
        if (step.type === "open_url" && step.params?.url && this.actionEngine) {
          const intent = await this.actionEngine.proposeAction({
            capability: "app.open_url",
            title: `Workflow: ${step.description}`,
            description: step.description,
            params: { url: String(step.params.url) },
          });
          const decided = await this.actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
          stepExecuted = decided.status === "completed";
          if (!stepExecuted) logs.push(`[ERROR] ${decided.error ?? "URL-Aktion fehlgeschlagen."}`);
        } else if (step.type === "open_app" && step.params?.name && this.actionEngine) {
          const intent = await this.actionEngine.proposeAction({
            capability: "app.open_app",
            title: `Workflow: ${step.description}`,
            description: step.description,
            params: { name: String(step.params.name) },
          });
          const decided = await this.actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
          stepExecuted = decided.status === "completed";
          if (!stepExecuted) logs.push(`[ERROR] ${decided.error ?? "App-Aktion fehlgeschlagen."}`);
        } else {
          logs.push(`[SKIPPED] Schritt-Typ '${step.type}' besitzt in diesem Workflow keine ausführbare Implementierung.`);
        }
        if (stepExecuted) executedSteps++;
      } catch (err) {
        logs.push(`[ERROR] Fehler in Schritt '${step.id}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const success = executedSteps === wf.steps.length;
    return {
      workflowId: wf.id,
      success,
      executedSteps,
      logs,
      summary: `Workflow '${wf.name}' mit ${executedSteps}/${wf.steps.length} Schritten ${success ? "erfolgreich ausgeführt" : "nur teilweise ausgeführt"}.`,
    };
  }
}
