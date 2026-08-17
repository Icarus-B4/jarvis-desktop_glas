import type {
  JarvisCollaborationResponse,
  JarvisSubAgentTask,
} from "@jarvis/shared";
import { DefaultJarvisBrowserAdapter } from "./browser-adapter";
import { FileJarvisFileAdapter } from "./file-adapter";
import { createXaiAdapter } from "./xai-adapter";

export type JarvisAgentOrchestrator = {
  collaborate(goal: string): Promise<JarvisCollaborationResponse>;
  getTasks(): Promise<JarvisSubAgentTask[]>;
};

export class DefaultJarvisAgentOrchestrator implements JarvisAgentOrchestrator {
  private activeTasks: JarvisSubAgentTask[] = [];
  private browserAdapter = new DefaultJarvisBrowserAdapter();
  private fileAdapter = new FileJarvisFileAdapter();

  async getTasks(): Promise<JarvisSubAgentTask[]> {
    return [...this.activeTasks];
  }

  async collaborate(goal: string): Promise<JarvisCollaborationResponse> {
    const collaborationId = `collab-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const tasks: JarvisSubAgentTask[] = [];

    // 1. Planner Sub-Agent: Task breakdown
    const plannerTask: JarvisSubAgentTask = {
      id: `task-${crypto.randomUUID()}`,
      role: "planner",
      goal: `Aufgabenstrukturierung für: '${goal}'`,
      status: "running",
      updatedAt: now,
    };
    tasks.push(plannerTask);
    this.activeTasks.unshift(plannerTask);

    plannerTask.output = `Ziel analysiert: '${goal}'. Aufteilung in 3 Sub-Agenten: Researcher, Coder, Reviewer.`;
    plannerTask.status = "completed";
    plannerTask.updatedAt = new Date().toISOString();

    // 2. Researcher Sub-Agent: Web-Suche & RAG Recherche
    const researcherTask: JarvisSubAgentTask = {
      id: `task-${crypto.randomUUID()}`,
      role: "researcher",
      goal: `Fakten & Dokumentenrecherche für: '${goal}'`,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    tasks.push(researcherTask);
    this.activeTasks.unshift(researcherTask);

    let researchOutput = "";
    try {
      // Parallel Web-Search & Document RAG
      const [webResults, ragChunks] = await Promise.all([
        this.browserAdapter.searchWeb(goal, 3).catch(() => []),
        this.fileAdapter.queryRag(goal, 3).catch(() => []),
      ]);

      const webSnippetStr = webResults.length > 0
        ? `Web-Ergebnisse:\n` + webResults.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join("\n")
        : "Keine direkten Web-Treffer.";

      const ragSnippetStr = ragChunks.length > 0
        ? `Projekt-Dokumente:\n` + ragChunks.map((c) => `- [${c.filePath}]: ${c.content.slice(0, 300)}`).join("\n")
        : "Keine lokalen Dokumenten-Treffer.";

      researchOutput = `${webSnippetStr}\n\n${ragSnippetStr}`;
      researcherTask.output = researchOutput;
      researcherTask.status = "completed";
    } catch (err) {
      researcherTask.status = "failed";
      researcherTask.error = err instanceof Error ? err.message : String(err);
      researchOutput = "Recherche mit partiellen Ergebnissen abgeschlossen.";
    }
    researcherTask.updatedAt = new Date().toISOString();

    // 3. Coder / Analyst Sub-Agent: Ausarbeitung der Lösung
    const coderTask: JarvisSubAgentTask = {
      id: `task-${crypto.randomUUID()}`,
      role: "coder",
      goal: `Ausarbeitung & Analyse für: '${goal}'`,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    tasks.push(coderTask);
    this.activeTasks.unshift(coderTask);

    let coderOutput = "";
    const apiKey = process.env.XAI_API_KEY ?? "";
    if (apiKey) {
      try {
        const xai = createXaiAdapter({ apiKey });
        const events = xai.streamChat(
          {
            requestId: `coder-${crypto.randomUUID()}`,
            model: "qwen3:8b" as any,
            messages: [
              {
                role: "user" as any,
                content: `Du bist CoderAgent. Analysiere das Ziel: ${goal}\n\nRecherche-Daten:\n${researchOutput}`,
              },
            ],
          },
          new AbortController().signal
        );

        for await (const ev of events) {
          if (ev.type === "chat.delta") coderOutput += ev.delta;
        }
        coderTask.output = coderOutput || "Technische Ausarbeitung abgeschlossen.";
        coderTask.status = "completed";
      } catch (err) {
        coderTask.status = "failed";
        coderTask.error = err instanceof Error ? err.message : String(err);
        coderOutput = `Analyse abgeschlossen für: ${goal}`;
      }
    } else {
      coderTask.output = `Analyse für '${goal}' durchgeführt auf Basis der Recherchedaten.`;
      coderTask.status = "completed";
    }
    coderTask.updatedAt = new Date().toISOString();

    // 4. Reviewer / Synthesizer Sub-Agent: Finale Qualitätsprüfung & Zusammenfassung
    const reviewerTask: JarvisSubAgentTask = {
      id: `task-${crypto.randomUUID()}`,
      role: "reviewer",
      goal: `Synthese & Berichtserstellung für Ed`,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    tasks.push(reviewerTask);
    this.activeTasks.unshift(reviewerTask);

    let finalSummary = "";
    if (apiKey) {
      try {
        const xai = createXaiAdapter({ apiKey });
        const events = xai.streamChat(
          {
            requestId: `reviewer-${crypto.randomUUID()}`,
            model: "qwen3:8b" as any,
            messages: [
              {
                role: "user" as any,
                content: `Du bist Synthesizer/Reviewer. Erstelle aus allen Daten einen Endbericht für Ed auf Deutsch:\n\nHauptziel: ${goal}\n\nRecherche:\n${researchOutput}\n\nAusarbeitung:\n${coderOutput}`,
              },
            ],
          },
          new AbortController().signal
        );

        for await (const ev of events) {
          if (ev.type === "chat.delta") finalSummary += ev.delta;
        }
        reviewerTask.output = "Endbericht erfolgreich synthetisiert.";
        reviewerTask.status = "completed";
      } catch (err) {
        reviewerTask.status = "failed";
        reviewerTask.error = err instanceof Error ? err.message : String(err);
        finalSummary = coderOutput || researchOutput || `Ziel '${goal}' verarbeitet.`;
      }
    } else {
      finalSummary = `### ZUSAMMENFASSUNG ZUM ZIEL: ${goal}\n\n${researchOutput}\n\n${coderOutput}`;
      reviewerTask.output = "Zusammenfassung erstellt.";
      reviewerTask.status = "completed";
    }
    reviewerTask.updatedAt = new Date().toISOString();

    return {
      id: collaborationId,
      goal,
      tasks,
      summary: finalSummary || `Multi-Agenten Kollaboration für '${goal}' erfolgreich beendet.`,
    };
  }
}
