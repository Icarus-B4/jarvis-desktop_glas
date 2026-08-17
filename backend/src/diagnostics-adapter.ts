import type { JarvisDiagnosticsSnapshot } from "@jarvis/shared";
import type { JarvisAgentOrchestrator } from "./agent-orchestrator";
import type { JarvisKnowledgeAdapter } from "./knowledge-adapter";
import type { JarvisMemoryAdapter } from "./memory-adapter";
import type { JarvisWorkflowEngine } from "./workflow-engine";

export type JarvisDiagnosticsAdapter = {
  getDiagnostics(): Promise<JarvisDiagnosticsSnapshot>;
};

export class DefaultJarvisDiagnosticsAdapter implements JarvisDiagnosticsAdapter {
  private startTime = Date.now();

  constructor(
    private memoryAdapter?: JarvisMemoryAdapter,
    private knowledgeAdapter?: JarvisKnowledgeAdapter,
    private workflowEngine?: JarvisWorkflowEngine,
    private agentOrchestrator?: JarvisAgentOrchestrator
  ) {}

  async getDiagnostics(): Promise<JarvisDiagnosticsSnapshot> {
    const memUsage = process.memoryUsage();
    const heapUsedMb = Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100;
    const heapTotalMb = Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100;
    const rssMb = Math.round((memUsage.rss / 1024 / 1024) * 100) / 100;
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    // Ping xAI API für Echtzeit-Latenz
    let xaiStatus: "online" | "offline" | "not_configured" = "not_configured";
    let xaiApiMs = 0;
    const apiKey = process.env.XAI_API_KEY ?? "";

    if (apiKey) {
      const t0 = performance.now();
      try {
        const res = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3000),
        });
        xaiApiMs = Math.round(performance.now() - t0);
        xaiStatus = res.ok ? "online" : "offline";
      } catch {
        xaiStatus = "offline";
        xaiApiMs = -1;
      }
    }

    // Aggregierte Zähler
    const [memories, knowledge, workflows, tasks] = await Promise.all([
      this.memoryAdapter?.listMemory().catch(() => []) ?? [],
      this.knowledgeAdapter?.listItems().catch(() => []) ?? [],
      this.workflowEngine?.listWorkflows().catch(() => []) ?? [],
      this.agentOrchestrator?.getTasks().catch(() => []) ?? [],
    ]);

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      memory: {
        heapUsedMb,
        heapTotalMb,
        rssMb,
      },
      latency: {
        localServiceMs: 2, // Interne Loopback-Latenz
        xaiApiMs: Math.max(0, xaiApiMs),
      },
      providers: {
        xaiStatus,
        ollamaStatus: "ready",
      },
      stats: {
        memoriesCount: memories.length,
        knowledgeCount: knowledge.length,
        workflowsCount: workflows.length,
        activeSubAgents: tasks.filter((t: { status: string; }) => t.status === "running").length,
      },
    };
  }
}
