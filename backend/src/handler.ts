import type {
  DashboardSnapshot,
  JarvisApiError,
  JarvisChatRequest,
  JarvisChatStreamEvent,
  JarvisHealthSnapshot,
  JarvisLiveEvent,
  JarvisKnowledgeQuery,
} from "@jarvis/shared";
import {
  isJarvisActionDecideRequest,
  isJarvisActionProposeRequest,
  isJarvisChatRequest,
  isJarvisChatStreamEvent,
  isJarvisMemoryAddRequest,
  isJarvisPairingCodeRequest,
  isJarvisPairingExchangeRequest,
  isJarvisVoiceMuteRequest,
  type JarvisMemoryCategory,
  type JarvisMemoryQuery,
} from "@jarvis/shared";

import { DefaultJarvisActionEngine, type JarvisActionEngine } from "./action-engine";
import { DefaultJarvisAgentOrchestrator, type JarvisAgentOrchestrator } from "./agent-orchestrator";
import { DefaultJarvisWorkflowEngine, type JarvisWorkflowEngine } from "./workflow-engine";
import {
  DEFAULT_ALLOWED_ORIGINS,
  normalizeAllowedOrigins,
} from "./config";
import { DefaultJarvisBrowserAdapter, type JarvisBrowserAdapter } from "./browser-adapter";
import { DefaultJarvisDiagnosticsAdapter, type JarvisDiagnosticsAdapter } from "./diagnostics-adapter";
import { FileJarvisFileAdapter, type JarvisFileAdapter } from "./file-adapter";
import { FileJarvisKnowledgeAdapter, type JarvisKnowledgeAdapter } from "./knowledge-adapter";
import {
  FileJarvisMemoryAdapter,
  type JarvisMemoryAdapter,
} from "./memory-adapter";
import type { JarvisModelAdapter } from "./model-adapter";
import { createOllamaClient, type OllamaClient } from "./ollama";
import { PairingManager } from "./pairing";
import {
  DefaultJarvisVoiceAdapter,
  transcribeWithXai,
  synthesizeWithXai,
  type JarvisVoiceAdapter,
} from "./voice-adapter";
import { createXaiAdapter } from "./xai-adapter";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_VERSION = "0.1.0";

// Load SOUL.md (agent identity core) from project root and inject into system prompt.
function loadSoulPrompt(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "..", "..", "..", "SOUL.md"),
      join(here, "..", "..", "SOUL.md"),
      join(process.cwd(), "SOUL.md"),
      join(process.cwd(), "jarvis-desktop_glas", "SOUL.md"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const content = readFileSync(p, "utf-8").trim();
        if (content) return content;
      }
    }
  } catch (err) {
    console.warn("[handler] SOUL.md load failed:", err);
  }
  return "";
}

const SOUL_PROMPT = loadSoulPrompt();

const dashboardFixture = {
  profile: {
    displayName: "Local Preview",
    email: "preview@localhost",
  },
  purchases: [],
} satisfies DashboardSnapshot;

export type JarvisRequestHandlerOptions = {
  allowedOrigins?: readonly string[];
  now?: () => Date;
  startedAt?: Date;
  modelAdapter?: JarvisModelAdapter;
  ollamaClient?: OllamaClient;
  voiceAdapter?: JarvisVoiceAdapter;
  memoryAdapter?: JarvisMemoryAdapter;
  fileAdapter?: JarvisFileAdapter;
  browserAdapter?: JarvisBrowserAdapter;
  actionEngine?: JarvisActionEngine;
  agentOrchestrator?: JarvisAgentOrchestrator;
  workflowEngine?: JarvisWorkflowEngine;
  knowledgeAdapter?: JarvisKnowledgeAdapter;
  diagnosticsAdapter?: JarvisDiagnosticsAdapter;
  chatTimeoutMs?: number;
  pairingManager?: PairingManager;
  /** xAI API-Key — wenn gesetzt, wird xAI statt Ollama als Chat-Provider verwendet */
  xaiApiKey?: string;
};

export type JarvisRequestHandler = (request: Request) => Response | Promise<Response>;

function sse(event: JarvisChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function liveSse(event: JarvisLiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isTerminal(event: JarvisChatStreamEvent): boolean {
  return event.type === "chat.done" || event.type === "chat.cancelled" || event.type === "chat.error";
}

function chatStream(events: AsyncIterable<JarvisChatStreamEvent>, requestId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let terminalSeen = false;
      try {
        for await (const event of events) {
          if (terminalSeen) continue;
          if (!isJarvisChatStreamEvent(event) || event.requestId !== requestId) {
            controller.enqueue(encoder.encode(sse({ type: "chat.error", requestId, error: { code: "invalid_stream_event", message: "The local model adapter returned an invalid event." } })));
            terminalSeen = true;
            continue;
          }
          controller.enqueue(encoder.encode(sse(event)));
          terminalSeen = isTerminal(event);
        }
      } catch {
        if (!terminalSeen) {
          controller.enqueue(encoder.encode(sse({ type: "chat.error", requestId, error: { code: "local_stream_error", message: "The local model stream failed unexpectedly." } })));
          terminalSeen = true;
        }
      } finally {
        if (!terminalSeen) controller.enqueue(encoder.encode(sse({ type: "chat.error", requestId, error: { code: "incomplete_local_stream", message: "The local model stream ended before completion." } })));
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

const TOOL_DEFINITIONS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "memory.search",
      description: "Durchsucht das Langzeitgedächtnis nach relevanten Informationen über Ed.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Suchbegriff" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "files.list",
      description: "Listet Dateien und Ordner im Projektverzeichnis auf.",
      parameters: { type: "object", properties: { dir: { type: "string", description: "Unterordner (optional)" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "files.read",
      description: "Liest den Inhalt einer Datei aus dem Projekt.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Relativer Pfad zur Datei" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "web.search",
      description: "Führt eine Websuche durch und gibt aktuelle Ergebnisse zurück.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Suchbegriff" }, limit: { type: "number", description: "Maximale Ergebnisse" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "knowledge.query",
      description: "Durchsucht die Wissensdatenbank.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Suchbegriff" }, category: { type: "string", description: "Kategorie (optional)" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "media.control",
      description: "Steuert Medienwiedergabe (Play, Pause, Next, Prev, Stop, Volume).",
      parameters: { type: "object", properties: { action: { type: "string", description: "play, pause, next, prev, stop, mute, volup, voldown" }, query: { type: "string", description: "Song/Interpret für direkte Wiedergabe" } }, required: ["action"] },
    },
  },
  {
    type: "function",
    function: {
      name: "system.take_screenshot",
      description: "Erstellt einen Screenshot des Bildschirms.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "camera.open",
      description: "Öffnet den Kamera-Feed.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "barehands.toggle",
      description: "Aktiviert oder deaktiviert den Barehands- bzw. No-Hands-Modus.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", description: "Modus: 'stage' für die Stage-Bedienung oder 'cursor' für die systemweite Maussteuerung." },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "barehands.cursor",
      description: "Sendet Cursor-Bewegungen oder Klicks im systemweiten No-Hands-Modus.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "Bewegung oder Klick: move, click, right_click, scroll_up, scroll_down" },
          dx: { type: "number", description: "Delta X in Pixeln für move." },
          dy: { type: "number", description: "Delta Y in Pixeln für move." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scratchpad.write",
      description: "Schreibt eine Notiz ins Scratchpad.",
      parameters: { type: "object", properties: { text: { type: "string", description: "Der Notiztext" } }, required: ["text"] },
    },
  },
];

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  actionEngine: JarvisActionEngine,
  memoryAdapter: JarvisMemoryAdapter,
  fileAdapter: JarvisFileAdapter,
  browserAdapter: JarvisBrowserAdapter,
  knowledgeAdapter: JarvisKnowledgeAdapter,
): Promise<string> {
  switch (name) {
    case "memory.search": {
      const query = String(args.query ?? args.q ?? "").trim();
      if (!query) return JSON.stringify({ error: "query parameter required" });
      try {
        const items = await memoryAdapter.listMemory({ search: query });
        return JSON.stringify({ ok: true, items: items.slice(0, 10), count: items.length });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "files.list": {
      const dir = String(args.dir ?? "").trim();
      try {
        const files = await fileAdapter.listDirectory(dir);
        return JSON.stringify({ ok: true, files: files.slice(0, 50), count: files.length });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "files.read": {
      const path = String(args.path ?? "").trim();
      if (!path) return JSON.stringify({ error: "path parameter required" });
      try {
        const content = await fileAdapter.readFile(path);
        return JSON.stringify({ ok: true, path, content: content.slice(0, 5000) });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "web.search": {
      const query = String(args.query ?? "").trim();
      const limit = Number(args.limit ?? 4);
      if (!query) return JSON.stringify({ error: "query parameter required" });
      try {
        const results = await browserAdapter.searchWeb(query, limit);
        return JSON.stringify({ ok: true, results, count: results.length });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "knowledge.query": {
      const query = String(args.query ?? "").trim();
      const categoryParam = String(args.category ?? "").trim() || undefined;
      if (!query) return JSON.stringify({ error: "query parameter required" });
      try {
        const items = await knowledgeAdapter.listItems({ query, category: categoryParam as any });
        return JSON.stringify({ ok: true, items: items.slice(0, 10), count: items.length });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "app.open_url": {
      const url = String(args.url ?? "").trim();
      if (!url) return JSON.stringify({ error: "url parameter required" });
      try {
        const intent = await actionEngine.proposeAction({
          capability: "app.open_url",
          title: `${url} öffnen`,
          description: `Öffnet ${url} im Standard-Browser`,
          params: { url },
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "app.open_url", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "app.open_app": {
      const name = String(args.name ?? "").trim();
      if (!name) return JSON.stringify({ error: "name parameter required" });
      try {
        const intent = await actionEngine.proposeAction({
          capability: "app.open_app",
          title: `${name} starten`,
          description: `Startet ${name} auf dem PC`,
          params: { name },
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "app.open_app", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "media.control": {
      const action = String(args.action ?? "").trim();
      const query = String(args.query ?? "").trim();
      if (!action) return JSON.stringify({ error: "action parameter required" });
      try {
        const intent = await actionEngine.proposeAction({
          capability: "media.control",
          title: `Mediensteuerung: ${action}`,
          description: query ? `Spielt ${query}` : `Führt ${action} aus`,
          params: { action, query: query || undefined },
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "media.control", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "system.execute_command": {
      const command = String(args.command ?? "").trim();
      if (!command) return JSON.stringify({ error: "command parameter required" });
      try {
        const intent = await actionEngine.proposeAction({
          capability: "system.execute_command",
          title: "Befehl ausführen",
          description: `Führt Shell-Befehl aus: ${command}`,
          params: { command },
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "system.execute_command", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "system.take_screenshot": {
      try {
        const intent = await actionEngine.proposeAction({
          capability: "system.take_screenshot",
          title: "Screenshot erstellen",
          description: "Erstellt einen Screenshot des Bildschirms",
          params: {},
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "system.take_screenshot", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "camera.open": {
      try {
        const intent = await actionEngine.proposeAction({
          capability: "camera.open",
          title: "Kamera öffnen",
          description: "Öffnet den Kamera-Feed auf der Hauptbühne",
          params: {},
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "camera.open", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "scratchpad.write": {
      const text = String(args.text ?? args.note ?? args.message ?? "").trim();
      if (!text) return JSON.stringify({ error: "text parameter required" });
      try {
        const intent = await actionEngine.proposeAction({
          capability: "scratchpad.write",
          title: "Notiz schreiben",
          description: `Schreibt Notiz ins Scratchpad: ${text.slice(0, 100)}`,
          params: { text },
        });
        const updated = await actionEngine.decideAction({ intentId: intent.id, decision: "approve" });
        return JSON.stringify({ ok: true, capability: "scratchpad.write", intent: updated });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    case "barehands.toggle": {
      const mode = String(args.mode ?? "").trim();
      if (!mode) return JSON.stringify({ error: "mode parameter required" });
      return JSON.stringify({ ok: true, capability: "barehands.toggle", mode, message: `Barehands-Modus '${mode}' angefordert. Steuerung erfolgt über die Desktop-Bridge.` });
    }
    case "barehands.cursor": {
      const action = String(args.action ?? "").trim();
      if (!action) return JSON.stringify({ error: "action parameter required" });
      return JSON.stringify({ ok: true, capability: "barehands.cursor", action, message: `Cursor-Aktion '${action}' angefordert.` });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

const JARVIS_TOOL_SYSTEM_PROMPT = `Du bist J.A.R.V.I.S., der persönliche Assistent von Ed.
Nutze die verfügbaren Tools, um Informationen zu beschaffen oder Aktionen auszuführen.
Wenn keine Aktion mehr nötig ist, antworte kurz und direkt auf Deutsch.
Bei Medienwünschen gib in media.control zwingend den query-Parameter mit, wenn Song/Künstler genannt wird.
Antworte präzise, hilfsbereit und auf Deutsch.`;

async function* runToolLoopChat(
  chatReq: JarvisChatRequest,
  signal: AbortSignal,
  xaiAdapter: { completeChat(request: { messages: Array<{ role: string; content?: string; imageData?: string; tool_calls?: unknown; tool_call_id?: string }>; tools?: Array<Record<string, unknown>>; model?: string; signal?: AbortSignal }): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }> },
  actionEngine: JarvisActionEngine,
  memoryAdapter: JarvisMemoryAdapter,
  fileAdapter: JarvisFileAdapter,
  browserAdapter: JarvisBrowserAdapter,
  knowledgeAdapter: JarvisKnowledgeAdapter,
): AsyncIterable<JarvisChatStreamEvent> {
  try {
    const systemPrompt = `${JARVIS_TOOL_SYSTEM_PROMPT}\n\n${SOUL_PROMPT ? `=== AGENT IDENTITY (SOUL.md) ===\n${SOUL_PROMPT}\n=== END IDENTITY ===\n\n` : ""}Du hast Zugriff auf folgende Tools:\n- memory.search: Suche im Langzeitgedächtnis\n- files.list: Dateien auflisten\n- files.read: Datei lesen\n- web.search: Websuche\n- knowledge.query: Wissensdatenbank durchsuchen\n- app.open_url: URL auf der Hauptbühne (im Desktop) öffnen, NICHT extern\n- app.open_app: Windows-App per Action Proposal starten (nicht als Tool-Call)\n- media.control: Medien steuern\n- system.execute_command: Nur explizite Benutzereingabe mit >, $ oder /; nicht als LLM-Tool\n- system.take_screenshot: Screenshot erstellen\n- camera.open: Kamera öffnen\n- scratchpad.write: Notiz schreiben\n- barehands.toggle: Barehands-/No-Hands-Modus umschalten\n- barehands.cursor: Cursor-Bewegung/Klick/Scroll senden`;

    let messages: Array<{ role: string; content?: string; imageData?: string; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: "system", content: systemPrompt },
      ...chatReq.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.imageData ? { imageData: m.imageData } : {}),
      })),
    ];

    const maxTurns = 6;
    const seenToolCalls = new Set<string>();
    let finalContent = "";

    toolLoop: for (let turn = 0; turn < maxTurns; turn++) {
      const result = await xaiAdapter.completeChat({
        messages,
        tools: TOOL_DEFINITIONS,
        model: chatReq.model,
        signal,
      });

      if (!result.toolCalls || result.toolCalls.length === 0) {
        finalContent = result.content || "";
        break;
      }

      const assistantMessage: Record<string, unknown> = {
        role: "assistant",
        content: result.content || "",
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages.push(assistantMessage as any);

      for (const toolCall of result.toolCalls) {
        // Hard cap on distinct tool calls — now coupled to maxTurns so a
        // realistic chain (e.g. web.search then app.open_url) is not cut off
        // after only 3 calls.
        if (seenToolCalls.size >= maxTurns) {
          finalContent = "Die Werkzeugkette wurde nach der maximalen Anzahl Aufrufe sicher beendet.";
          break toolLoop;
        }
        const fingerprint = `${toolCall.name}:${toolCall.arguments || "{}"}`;
        if (seenToolCalls.has(fingerprint)) {
          // Skip the duplicate instead of aborting the whole loop. Returning a
          // tool result with a hint lets the model self-correct (e.g. retry
          // with a fixed argument) rather than killing the chain.
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Dieser Werkzeugaufruf ist identisch mit einem bereits ausgeführten. Bitte korrigiere die Argumente oder fahre mit einem anderen Schritt fort.",
          } as any);
          continue;
        }
        seenToolCalls.add(fingerprint);

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.arguments || "{}");
        } catch {
          // keep empty
        }
        const toolResult = await executeTool(toolCall.name, parsedArgs, actionEngine, memoryAdapter, fileAdapter, browserAdapter, knowledgeAdapter);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        } as any);
      }
    }

    if (!finalContent) {
      yield { type: "chat.error", requestId: chatReq.requestId, error: { code: "max_tool_turns", message: "Maximale Tool-Runden erreicht." } };
      return;
    }

    yield { type: "chat.start", requestId: chatReq.requestId, model: chatReq.model ?? "grok-4.1-fast" };
    yield { type: "chat.delta", requestId: chatReq.requestId, delta: finalContent };
    yield { type: "chat.done", requestId: chatReq.requestId, message: { role: "assistant", content: finalContent } };
  } catch (err) {
    if (signal.aborted) {
      yield { type: "chat.cancelled", requestId: chatReq.requestId };
    } else {
      yield { type: "chat.error", requestId: chatReq.requestId, error: { code: "tool_loop_failed", message: err instanceof Error ? err.message : "Tool-Loop fehlgeschlagen." } };
    }
  }
}

function apiError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  const body: JarvisApiError = { error: { code, message } };
  return Response.json(body, headers === undefined ? { status } : { status, headers });
}

function corsHeaders(origin: string | null, isAllowed: boolean): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (origin !== null && isAllowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export function createJarvisRequestHandler(
  options: JarvisRequestHandlerOptions = {},
): JarvisRequestHandler {
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();
  const startedAtTimestamp = startedAt.toISOString();

  // Modul-Adapter für xAI Cloud und Ollama Local dynamisch vorhalten
  const getXaiApiKey = (): string => options.xaiApiKey ?? process.env.XAI_API_KEY ?? "";
  const ollamaAdapter: JarvisModelAdapter = options.ollamaClient ?? createOllamaClient();
  const getXaiAdapter = (): JarvisModelAdapter | null => {
    const apiKey = getXaiApiKey();
    return apiKey ? (options.modelAdapter ?? createXaiAdapter({ apiKey })) : null;
  };
  const getDefaultAdapter = (): JarvisModelAdapter => getXaiAdapter() ?? ollamaAdapter;

  const pairingManager = options.pairingManager ?? new PairingManager();
  const voiceAdapter = options.voiceAdapter ?? new DefaultJarvisVoiceAdapter();
  const memoryAdapter = options.memoryAdapter ?? new FileJarvisMemoryAdapter();
  const fileAdapter = options.fileAdapter ?? new FileJarvisFileAdapter();
  const browserAdapter = options.browserAdapter ?? new DefaultJarvisBrowserAdapter();
  // SSE fan-out for live events (JarvisLiveEvent). The renderer subscribes
  // to /v1/events and reacts to action.intent.* events (e.g. opening a
  // URL on the main stage when an app.open_url action completes). The
  // backend runs in a separate process from the Electron renderer, so this
  // is the only push channel back to the UI.
  const liveEventSubscribers = new Set<(event: JarvisLiveEvent) => void>();
  const publishLiveEvent = (event: JarvisLiveEvent): void => {
    for (const subscriber of liveEventSubscribers) {
      try {
        subscriber(event);
      } catch (err) {
        console.warn("[handler] live event subscriber failed:", err);
      }
    }
  };
  const actionEngine = options.actionEngine ?? new DefaultJarvisActionEngine({
    onIntentEvent: (intent) => {
      publishLiveEvent({
        id: crypto.randomUUID(),
        type: "action.intent.updated",
        occurredAt: new Date().toISOString(),
        payload: { intent },
      });
    },
  });
  const agentOrchestrator = options.agentOrchestrator ?? new DefaultJarvisAgentOrchestrator();
  const workflowEngine = options.workflowEngine ?? new DefaultJarvisWorkflowEngine(actionEngine);
  const knowledgeAdapter = options.knowledgeAdapter ?? new FileJarvisKnowledgeAdapter();
  const diagnosticsAdapter = options.diagnosticsAdapter ?? new DefaultJarvisDiagnosticsAdapter(memoryAdapter, knowledgeAdapter, workflowEngine, agentOrchestrator);
  const chatTimeoutMs = options.chatTimeoutMs ?? 45_000;
  if (!Number.isFinite(chatTimeoutMs) || chatTimeoutMs <= 0) throw new TypeError("Jarvis chat timeout must be a positive finite number.");

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const originAllowed = origin === null || allowedOrigins.has(origin);
    const { pathname } = new URL(request.url);

    if (!originAllowed) {
      return apiError(403, "origin_forbidden", "This browser origin is not allowed to access the Jarvis local service.");
    }

    if (pathname === "/v1/chat" && origin !== null) {
      return apiError(403, "chat_origin_forbidden", "Local chat is available only to the private desktop shell.");
    }

    const headers = corsHeaders(origin, originAllowed);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (pathname === "/v1/pairing/code" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_pairing_request", "A valid pairing code request is required.", headers); }
      if (!isJarvisPairingCodeRequest(body)) return apiError(400, "invalid_pairing_request", "A valid pairing code request is required.", headers);
      const payload = pairingManager.generateCode(body.clientName);
      return Response.json(payload, { status: 200, headers });
    }

    if (pathname === "/v1/pairing/exchange" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_exchange_request", "A valid pairing exchange request is required.", headers); }
      if (!isJarvisPairingExchangeRequest(body)) return apiError(400, "invalid_exchange_request", "A valid pairing exchange request is required.", headers);
      const payload = pairingManager.exchangeCode(body.code, body.clientName);
      if (!payload) return apiError(401, "invalid_pairing_code", "The pairing code is invalid or has expired.", headers);
      return Response.json(payload, { status: 200, headers });
    }

    if (pathname === "/v1/voice/mute" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_voice_mute_request", "A valid voice mute request is required.", headers); }
      if (!isJarvisVoiceMuteRequest(body)) return apiError(400, "invalid_voice_mute_request", "A valid voice mute request is required.", headers);
      const updatedStatus = voiceAdapter.setMute(body.muted);
      return Response.json(updatedStatus, { status: 200, headers });
    }

    if (pathname === "/v1/voice/status") {
      return Response.json(voiceAdapter.getStatus(), { status: 200, headers });
    }

    // --- xAI STT: Audio-Blob → Text-Transkript ---
    if (pathname === "/v1/voice/stt" && request.method === "POST") {
      const xaiApiKey = getXaiApiKey();
      if (!xaiApiKey) return apiError(503, "stt_not_configured", "XAI_API_KEY nicht konfiguriert.", headers);
      try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const language = (formData.get("language") as string | null) ?? "de";
        if (!file) return apiError(400, "stt_missing_audio", "Kein Audio-File im Formular.", headers);
        const audioBuffer = await file.arrayBuffer();
        const transcript = await transcribeWithXai(audioBuffer, file.type || "audio/webm", xaiApiKey, language);
        return Response.json({ text: transcript }, { status: 200, headers });
      } catch (err) {
        return apiError(500, "stt_failed", err instanceof Error ? err.message : "STT-Fehler", headers);
      }
    }

    // --- xAI TTS: Text → MP3-Audio ---
    if (pathname === "/v1/voice/tts" && request.method === "POST") {
      const xaiApiKey = getXaiApiKey();
      if (!xaiApiKey) return apiError(503, "tts_not_configured", "XAI_API_KEY nicht konfiguriert.", headers);
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "tts_invalid_request", "Gültiges JSON erforderlich.", headers); }
      const { text, voice, language } = body as { text?: string; voice?: string; language?: string };
      if (!text || typeof text !== "string" || text.trim() === "") {
        return apiError(400, "tts_missing_text", "Kein Text für TTS angegeben.", headers);
      }
      try {
        const audioBuffer = await synthesizeWithXai(
          text.slice(0, 4096),
          xaiApiKey,
          voice ?? "zenith",
          language ?? "de",
        );
        const audioHeaders = new Headers(headers);
        audioHeaders.set("Content-Type", "audio/mpeg");
        audioHeaders.set("Content-Length", String(audioBuffer.byteLength));
        return new Response(audioBuffer, { status: 200, headers: audioHeaders });
      } catch (err) {
        return apiError(500, "tts_failed", err instanceof Error ? err.message : "TTS-Fehler", headers);
      }
    }

    if (pathname === "/v1/memory" && request.method === "GET") {
      const url = new URL(request.url);
      const categoryParam = url.searchParams.get("category");
      const searchParam = url.searchParams.get("search");
      const query: JarvisMemoryQuery = {};
      if (categoryParam) query.category = categoryParam as JarvisMemoryCategory;
      if (searchParam) query.search = searchParam;
      const items = await memoryAdapter.listMemory(query);
      return Response.json(items, { status: 200, headers });
    }

    if (pathname === "/v1/memory" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_memory_request", "A valid memory item request is required.", headers); }
      if (!isJarvisMemoryAddRequest(body)) return apiError(400, "invalid_memory_request", "A valid memory item request is required.", headers);
      const created = await memoryAdapter.addMemoryItem(body);
      return Response.json(created, { status: 201, headers });
    }

    if (pathname.startsWith("/v1/memory") && request.method === "DELETE") {
      const sub = pathname.replace(/^\/v1\/memory\/?/, "");
      if (sub.length > 0) {
        const deleted = await memoryAdapter.deleteMemoryItem(sub);
        if (!deleted) return apiError(404, "memory_not_found", "The specified memory item was not found.", headers);
        return Response.json({ success: true, id: sub }, { status: 200, headers });
      }
      await memoryAdapter.clearMemory();
      return Response.json({ success: true, cleared: true }, { status: 200, headers });
    }

    if (pathname === "/v1/actions" && request.method === "GET") {
      const actions = await actionEngine.getActions();
      return Response.json(actions, { status: 200, headers });
    }

    if (pathname === "/v1/actions/propose" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_action_propose_request", "A valid action proposal request is required.", headers); }
      if (!isJarvisActionProposeRequest(body)) return apiError(400, "invalid_action_propose_request", "A valid action proposal request is required.", headers);
      const intent = await actionEngine.proposeAction(body);
      return Response.json(intent, { status: 201, headers });
    }

    if (pathname === "/v1/actions/decide" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_action_decide_request", "A valid action decision request is required.", headers); }
      if (!isJarvisActionDecideRequest(body)) return apiError(400, "invalid_action_decide_request", "A valid action decision request is required.", headers);
      try {
        const updated = await actionEngine.decideAction(body);
        return Response.json(updated, { status: 200, headers });
      } catch (err) {
        return apiError(400, "action_decision_failed", err instanceof Error ? err.message : String(err), headers);
      }
    }

    // --- Sub-Agent Orchestrator Endpoints ---
    if (pathname === "/v1/agents/list" && request.method === "GET") {
      const tasks = await agentOrchestrator.getTasks();
      return Response.json(tasks, { status: 200, headers });
    }

    if (pathname === "/v1/agents/collaborate" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_collaboration_request", "A valid collaboration request is required.", headers); }
      const { goal } = body as { goal?: string };
      if (!goal || typeof goal !== "string" || !goal.trim()) {
        return apiError(400, "missing_agent_goal", "Ein Ziel (goal) für die Sub-Agenten ist erforderlich.", headers);
      }
      try {
        const result = await agentOrchestrator.collaborate(goal.trim());
        return Response.json(result, { status: 200, headers });
      } catch (err) {
        return apiError(500, "agent_collaboration_failed", err instanceof Error ? err.message : "Multi-Agenten Kollaboration fehlgeschlagen.", headers);
      }
    }

    // --- Workflow Automation Endpoints ---
    if (pathname === "/v1/workflows/list" && request.method === "GET") {
      const workflows = await workflowEngine.listWorkflows();
      return Response.json(workflows, { status: 200, headers });
    }

    if (pathname === "/v1/workflows/run" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_workflow_run_request", "Gültiges JSON erforderlich.", headers); }
      const { idOrTrigger } = body as { idOrTrigger?: string };
      if (!idOrTrigger || typeof idOrTrigger !== "string" || !idOrTrigger.trim()) {
        return apiError(400, "missing_workflow_id", "Workflow ID oder Trigger-Satz erforderlich.", headers);
      }
      try {
        const result = await workflowEngine.runWorkflow(idOrTrigger.trim());
        return Response.json(result, { status: 200, headers });
      } catch (err) {
        return apiError(400, "workflow_execution_failed", err instanceof Error ? err.message : "Workflow Ausführung fehlgeschlagen.", headers);
      }
    }

    // --- Personal Knowledge Base Endpoints ---
    if (pathname === "/v1/knowledge/list" && request.method === "GET") {
      const url = new URL(request.url);
      const queryParam = url.searchParams.get("query");
      const categoryParam = url.searchParams.get("category");
      const knowledgeQuery: JarvisKnowledgeQuery = {};
      if (queryParam) knowledgeQuery.query = queryParam;
      if (categoryParam) knowledgeQuery.category = categoryParam as any;
      const items = await knowledgeAdapter.listItems(knowledgeQuery);
      return Response.json(items, { status: 200, headers });
    }

    if (pathname === "/v1/knowledge/add" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_knowledge_add_request", "Gültiges JSON erforderlich.", headers); }
      const { title, category, tags, content } = body as { title?: string; category?: string; tags?: string[]; content?: string };
      if (!title || !content || !category) {
        return apiError(400, "missing_knowledge_fields", "Titel, Kategorie und Inhalt erforderlich.", headers);
      }
      try {
        const newItem = await knowledgeAdapter.addItem({
          title,
          category: category as any,
          tags: Array.isArray(tags) ? tags : [],
          content,
        });
        return Response.json(newItem, { status: 201, headers });
      } catch (err) {
        return apiError(400, "knowledge_add_failed", err instanceof Error ? err.message : "Fehler beim Hinzufügen", headers);
      }
    }

    if (pathname === "/v1/knowledge/delete" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_knowledge_delete_request", "Gültiges JSON erforderlich.", headers); }
      const { id } = body as { id?: string };
      if (!id) return apiError(400, "missing_knowledge_id", "ID erforderlich.", headers);
      const deleted = await knowledgeAdapter.deleteItem(id);
      return Response.json({ success: deleted }, { status: 200, headers });
    }

    // --- Real-Time Diagnostics Endpoints ---
    if (pathname === "/v1/diagnostics" && request.method === "GET") {
      const snapshot = await diagnosticsAdapter.getDiagnostics();
      return Response.json(snapshot, { status: 200, headers });
    }

    // --- System Configuration Endpoints ---
    if (pathname === "/v1/config" && request.method === "GET") {
      const xaiApiKey = getXaiApiKey();
      const config = {
        xaiApiKey: xaiApiKey ? `${xaiApiKey.slice(0, 7)}...` : "",
        hasXaiApiKey: Boolean(xaiApiKey),
        autoApproveActions: process.env.JARVIS_AUTO_APPROVE === "true",
        ttsVoice: "zenith",
        sttLanguage: "de",
        enabledModules: {
          memory: true,
          files: true,
          browser: true,
          agents: true,
          workflows: true,
          knowledge: true,
          diagnostics: true,
        },
      };
      return Response.json(config, { status: 200, headers });
    }

    if (pathname === "/v1/config" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_config_request", "Gültiges JSON erforderlich.", headers); }
      const { xaiApiKey: newKey, autoApproveActions } = body as { xaiApiKey?: string; autoApproveActions?: boolean };
      if (typeof newKey === "string" && newKey.trim().length > 0) {
        process.env.XAI_API_KEY = newKey.trim();
      }
      if (typeof autoApproveActions === "boolean") {
        process.env.JARVIS_AUTO_APPROVE = String(autoApproveActions);
      }
      return Response.json({ success: true, message: "Einstellungen erfolgreich aktualisiert." }, { status: 200, headers });
    }

    // --- File Management & RAG Endpoints ---
    if (pathname === "/v1/files/list" && request.method === "GET") {
      const url = new URL(request.url);
      const dir = url.searchParams.get("dir") ?? "";
      try {
        const files = await fileAdapter.listDirectory(dir);
        return Response.json(files, { status: 200, headers });
      } catch (err) {
        return apiError(400, "file_list_failed", err instanceof Error ? err.message : "Fehler beim Auflisten", headers);
      }
    }

    if (pathname === "/v1/files/read" && request.method === "GET") {
      const url = new URL(request.url);
      const pathParam = url.searchParams.get("path") ?? "";
      if (!pathParam) return apiError(400, "missing_path", "Pfad-Parameter erforderlich.", headers);
      try {
        const content = await fileAdapter.readFile(pathParam);
        return Response.json({ path: pathParam, content }, { status: 200, headers });
      } catch (err) {
        return apiError(400, "file_read_failed", err instanceof Error ? err.message : "Fehler beim Lesen", headers);
      }
    }

    if (pathname === "/v1/files/rag" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_rag_request", "Gültiges JSON erforderlich.", headers); }
      const { query, limit } = body as { query?: string; limit?: number };
      if (!query || typeof query !== "string") return apiError(400, "missing_rag_query", "Kein Suchbegriff für RAG angegeben.", headers);
      try {
        const chunks = await fileAdapter.queryRag(query, limit ?? 5);
        return Response.json({ query, chunks }, { status: 200, headers });
      } catch (err) {
        return apiError(500, "rag_failed", err instanceof Error ? err.message : "RAG-Fehler", headers);
      }
    }

    // --- Browser Automation & Web Search Endpoints ---
    if (pathname === "/v1/browser/fetch" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_fetch_request", "Gültiges JSON erforderlich.", headers); }
      const { url } = body as { url?: string };
      if (!url || typeof url !== "string") return apiError(400, "missing_url", "URL ist erforderlich.", headers);
      try {
        const pageData = await browserAdapter.fetchPageContent(url);
        return Response.json(pageData, { status: 200, headers });
      } catch (err) {
        return apiError(400, "fetch_failed", err instanceof Error ? err.message : "Fehler beim Aufrufen der Webseite", headers);
      }
    }

    if (pathname === "/v1/browser/search" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_search_request", "Gültiges JSON erforderlich.", headers); }
      const { query, limit } = body as { query?: string; limit?: number };
      if (!query || typeof query !== "string") return apiError(400, "missing_query", "Suchbegriff erforderlich.", headers);
      try {
        const results = await browserAdapter.searchWeb(query, limit ?? 4);
        return Response.json({ query, results }, { status: 200, headers });
      } catch (err) {
        return apiError(500, "search_failed", err instanceof Error ? err.message : "Fehler bei der Websuche", headers);
      }
    }

    if (pathname === "/v1/chat" && request.method === "POST") {
      let body: unknown;
      try { body = await request.json(); } catch { return apiError(400, "invalid_chat_request", "A valid local chat request is required.", headers); }
      if (!isJarvisChatRequest(body)) return apiError(400, "invalid_chat_request", "A valid local chat request is required.", headers);
      
      const chatReq = body as JarvisChatRequest;

      const xaiAdapter = getXaiAdapter();
      const isLocalModel = chatReq.model?.toLowerCase().includes("qwen") || chatReq.model?.toLowerCase().includes("ollama") || !xaiAdapter;
      const supportsToolLoop = !isLocalModel && typeof (xaiAdapter as unknown as Record<string, unknown>)?.completeChat === "function";
      const targetAdapter = options.modelAdapter ?? (isLocalModel ? ollamaAdapter : xaiAdapter!);

      const timeout = AbortSignal.timeout(chatTimeoutMs);
      const signal = typeof (AbortSignal as any).any === "function"
        ? (AbortSignal as any).any([request.signal, timeout])
        : timeout;

      if (supportsToolLoop) {
        const toolLoopAdapter = xaiAdapter as unknown as {
          completeChat(request: { messages: Array<{ role: string; content?: string; imageData?: string; tool_calls?: unknown; tool_call_id?: string }>; tools?: Array<Record<string, unknown>>; model?: string; signal?: AbortSignal }): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>;
        };
        return chatStream(runToolLoopChat(chatReq, signal as AbortSignal, toolLoopAdapter, actionEngine, memoryAdapter, fileAdapter, browserAdapter, knowledgeAdapter), chatReq.requestId);
      }

      // Fallback: Legacy-Stream
      return chatStream(targetAdapter.streamChat(chatReq, signal), chatReq.requestId);
    }

    if (request.method !== "GET") {
      headers.set("Allow", "GET, POST, OPTIONS");
      return apiError(405, "method_not_allowed", "This local-service route does not allow that method.", headers);
    }

    if (pathname === "/health") {
      const timestamp = now();
      const health: JarvisHealthSnapshot = {
        status: "ok",
        service: "jarvis-local-service",
        version: SERVICE_VERSION,
        timestamp: timestamp.toISOString(),
        startedAt: startedAtTimestamp,
        uptimeSeconds: Math.max(0, Math.floor((timestamp.getTime() - startedAt.getTime()) / 1_000)),
        orbState: "ready",
        eventStream: {
          transport: "sse",
          status: "active",
          path: "/v1/events",
        },
      };
      return Response.json(health, { status: 200, headers });
    }

    if (pathname === "/v1/dashboard") {
      return Response.json(dashboardFixture, { status: 200, headers });
    }

    if (pathname === "/v1/model/readiness") {
      const readiness = await getDefaultAdapter().getReadiness(AbortSignal.timeout(2_500));
      return Response.json(readiness, { status: 200, headers });
    }

    if (pathname === "/v1/events") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const connectedEvent: JarvisLiveEvent = {
            id: crypto.randomUUID(),
            type: "service.connected",
            occurredAt: now().toISOString(),
            payload: { serviceVersion: SERVICE_VERSION },
          };
          controller.enqueue(encoder.encode(liveSse(connectedEvent)));

          const subscriber = (event: JarvisLiveEvent) => {
            try {
              controller.enqueue(encoder.encode(liveSse(event)));
            } catch {
              // Controller already closed; the abort handler below cleans up.
            }
          };
          liveEventSubscribers.add(subscriber);

          const interval = setInterval(() => {
            try {
              const pingEvent: JarvisLiveEvent = {
                id: crypto.randomUUID(),
                type: "ping",
                occurredAt: now().toISOString(),
                payload: { timestamp: now().toISOString() },
              };
              controller.enqueue(encoder.encode(liveSse(pingEvent)));
            } catch {
              clearInterval(interval);
            }
          }, 5_000);

          request.signal.addEventListener("abort", () => {
            clearInterval(interval);
            liveEventSubscribers.delete(subscriber);
            try { controller.close(); } catch {}
          });
        },
      });

      const sseHeaders = new Headers(headers);
      sseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
      sseHeaders.set("Cache-Control", "no-cache");
      sseHeaders.set("Connection", "keep-alive");

      return new Response(stream, { status: 200, headers: sseHeaders });
    }

    return apiError(404, "not_found", "The requested Jarvis local-service route does not exist.", headers);
  };
}
