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
  formatMemoryContext,
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

const SERVICE_VERSION = "0.1.0";

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
  const actionEngine = options.actionEngine ?? new DefaultJarvisActionEngine();
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
      const categoryParam = url.searchParams.get("category") as any;
      const knowledgeQuery: JarvisKnowledgeQuery = {};
      if (queryParam) knowledgeQuery.query = queryParam;
      if (categoryParam) knowledgeQuery.category = categoryParam;
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

      // 0. Globales System-Mandat für Tool Use & Action Proposals (Sowohl für Cloud als auch für Lokale Modelle)
      const TOOL_USE_MANDATE = `Du bist J.A.R.V.I.S., das souveräne KI-Betriebssystem.
Du hast Zugriff auf lokale Tool-Capabilities auf dem PC des Nutzers.
Wenn der Nutzer dich bittet, Webseiten zu öffnen, Windows-Apps/Programme zu starten, Medien zu steuern oder Systembefehle auszuführen, antworte kurz auf Deutsch und generiere am Ende deiner Antwort einen action_proposal Codeblock:

\`\`\`action_proposal
{
  "capability": "app.open_url",
  "title": "Aktionstitel",
  "description": "Kurzbeschreibung",
  "params": { "url": "https://beispiel.de" }
}
\`\`\`

Unterstützte Capabilities:
- "app.open_url" mit params: { "url": "https://..." }
- "app.open_app" mit params: { "name": "rechner" | "notepad" | "cmd" | "chrome" | "explorer" | "vscode" | string }
- "media.control" mit params: { "action": "play" | "pause" | "next" | "prev" }`;

      try {
        const msgs = [...chatReq.messages];
        const firstMsg = msgs[0];
        if (firstMsg && (firstMsg as { role: string }).role === "system") {
          msgs[0] = { role: "system" as any, content: `${TOOL_USE_MANDATE}\n\n${firstMsg.content}` };
        } else {
          msgs.unshift({ role: "system" as any, content: TOOL_USE_MANDATE });
        }
        chatReq.messages = msgs;
      } catch {
        // Ignorieren falls System-Mandate Einschub fehlschlägt
      }

      // 1. Langzeit-Gedächtnis injizieren
      try {
        const memories = await memoryAdapter.listMemory();
        const memContextStr = formatMemoryContext(memories);
        if (memContextStr) {
          const msgs = [...chatReq.messages];
          const firstMsg = msgs[0];
          if (firstMsg && (firstMsg as { role: string }).role === "system") {
            msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${memContextStr}` };
          } else {
            msgs.unshift({ role: "system" as any, content: memContextStr });
          }
          chatReq.messages = msgs;
        }
      } catch {
        // Ignorieren falls Memory-Laden fehlschlägt
      }

      // 2. Automatischer Projekt-RAG Kontexteinschub für die Benutzeranfrage
      try {
        const lastUserMsg = [...chatReq.messages].reverse().find((m) => m.role === "user")?.content ?? "";
        if (lastUserMsg && lastUserMsg.length > 4) {
          const ragChunks = await withTimeout(fileAdapter.queryRag(lastUserMsg, 3), 1500, []);
          if (ragChunks.length > 0) {
            const ragStr = "### RELEVANTE PROJEKT-DOKUMENTE & CODE (RAG-KONTEXT):\n" +
              ragChunks.map((c) => `- [${c.filePath}:${c.lineStart}-${c.lineEnd}]\n${c.content}`).join("\n\n");
            
            const msgs = [...chatReq.messages];
            const firstMsg = msgs[0];
            if (firstMsg && (firstMsg as { role: string }).role === "system") {
              msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${ragStr}` };
            } else {
              msgs.unshift({ role: "system" as any, content: ragStr });
            }
            chatReq.messages = msgs;
          }

          // 3. Automatischer Web-Search Trigger bei expliziter Suchanfrage oder News/Nachrichten-Fragen
          const lowerMsg = lastUserMsg.toLowerCase();
          const isNewsQuery = lowerMsg.includes("news") || lowerMsg.includes("nachrichten") || lowerMsg.includes("aktuell") || lowerMsg.includes("wetter") || lowerMsg.includes("wer ist") || lowerMsg.includes("was ist");
          const isWebSearchExplicit = lowerMsg.includes("suche im web") || lowerMsg.includes("web-suche") || lowerMsg.includes("search web") || lowerMsg.includes("recherchiere") || lowerMsg.startsWith("http");

          if (isWebSearchExplicit || isNewsQuery) {
            const searchTerms = lastUserMsg
              .replace(/^(suche im web|web-suche|search web|recherchiere|was sind die neuesten|was gibt es neues zu|was sind die|zeig mir die)\s*/i, "")
              .trim();

            if (searchTerms.startsWith("http")) {
              const pageData = await withTimeout(browserAdapter.fetchPageContent(searchTerms), 3000, null);
              if (pageData) {
                const webStr = `### EXTRAHIERTER WEBSEITEN-INHALT VON ${pageData.url} (${pageData.title}):\n${pageData.content.slice(0, 3000)}`;
                const msgs = [...chatReq.messages];
                const firstMsg = msgs[0];
                if (firstMsg && (firstMsg as { role: string }).role === "system") {
                  msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${webStr}` };
                } else {
                  msgs.unshift({ role: "system" as any, content: webStr });
                }
                chatReq.messages = msgs;
              }
            } else if (searchTerms.length > 2) {
              const queryToSearch = searchTerms.length < 5 ? lastUserMsg : searchTerms;
              const webResults = await withTimeout(browserAdapter.searchWeb(queryToSearch, 4), 3000, []);
              if (webResults.length > 0) {
                const webStr = "### RELEVANTE LIVE-WEB-RECHERCHE ERGEBNISSE (ECHTZEIT-NEWS & RECHERCHE):\n" +
                  webResults.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join("\n");
                const msgs = [...chatReq.messages];
                const firstMsg = msgs[0];
                if (firstMsg && (firstMsg as { role: string }).role === "system") {
                  msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${webStr}` };
                } else {
                  msgs.unshift({ role: "system" as any, content: webStr });
                }
                chatReq.messages = msgs;
              }
            }
          }
        }
      } catch {
        // Ignorieren falls RAG/Web-Search fehlschlägt
      }

      // 4. Intent Detector & System Mandate für direkte System-Befehle (Browser & Apps & Medien)
      try {
        const lastMsgText = [...chatReq.messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const lowerMsg = lastMsgText.toLowerCase().trim();

        // 0. Negative Antworten / Rejections ("Nein", "Nine", "Stop", "Abbrechen") nicht als App-Namen interpretieren!
        const isNegative = /^(nein|nine|no|stop|abbrechen|nein danke|nicht öffnen)[\.\!\?]?$/i.test(lowerMsg);

        if (!isNegative) {
          const urlMatch = lastMsgText.match(/(?:öffne|starte|gehe zu|besuche)\s+(https?:\/\/[^\s]+|[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)/i);
          const appMatch = lastMsgText.match(/(?:öffne|starte|starte die app|öffne die app|spiele|hüfne)\s+(?:die app\s+)?(rechner|calculator|notepad|editor|vscode|code|chrome|edge|explorer|windows media player|media player|wmplayer|spotify|vlc|paint|taskmanager|taskmgr|terminal|powershell|cmd|word|excel|powerpoint|discord|[a-z0-9äöüß.-]+(?:\s+[a-z0-9äöüß.-]+)?)/i);
          const mediaMatch = lastMsgText.match(/(?:spiele einen song|nächster song|nächstes lied|vorheriger song|pausiere|stoppe die musik|musik abspielen|play music|next track|pause music)/i);

          const isBarehandsPhonetic = lowerMsg.includes("bear head") || lowerMsg.includes("bearhead") || lowerMsg.includes("bear hand") || lowerMsg.includes("barehand") || lowerMsg.includes("bare hand") || lowerMsg.includes("hüfne hans") || lowerMsg.includes("öffne hand");

          if (isBarehandsPhonetic) {
            const mandate = `Kontext: Der Nutzer möchte das Barehands 3D Interaktions-Interface öffnen. Antworte kurz auf Deutsch und erstelle am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "barehands.open",\n  "title": "Barehands Stage öffnen",\n  "description": "Öffnet die 3D Barehands Bühne",\n  "params": {}\n}\n\`\`\``;
            const msgs = [...chatReq.messages];
            const firstMsg = msgs[0];
            if (firstMsg && (firstMsg as { role: string }).role === "system") {
              msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
            } else {
              msgs.unshift({ role: "system" as any, content: mandate });
            }
            chatReq.messages = msgs;
          } else if (urlMatch && urlMatch[1]) {
            const targetUrl = urlMatch[1].startsWith("http") ? urlMatch[1] : `https://${urlMatch[1]}`;
            const mandate = `Kontext: Der Nutzer möchte die Webseite '${targetUrl}' öffnen. Antworte kurz auf Deutsch und erstelle dafür am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "app.open_url",\n  "title": "${targetUrl} öffnen",\n  "description": "Öffnet ${targetUrl} im Standardbrowser",\n  "params": { "url": "${targetUrl}" }\n}\n\`\`\``;
            const msgs = [...chatReq.messages];
            const firstMsg = msgs[0];
            if (firstMsg && (firstMsg as { role: string }).role === "system") {
              msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
            } else {
              msgs.unshift({ role: "system" as any, content: mandate });
            }
            chatReq.messages = msgs;
          } else if (appMatch && appMatch[1] && !urlMatch) {
            const rawTarget = appMatch[1].toLowerCase().trim();
            if (rawTarget === "kamera" || rawTarget === "die kamera" || rawTarget === "webcam") {
              const mandate = `Kontext: Der Nutzer möchte die Kamera auf der Hauptbühne öffnen. Antworte kurz auf Deutsch und erstelle am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "camera.open",\n  "title": "Kamera öffnen",\n  "description": "Öffnet den Kamera-Feed auf der Hauptbühne",\n  "params": {}\n}\n\`\`\``;
              const msgs = [...chatReq.messages];
              const firstMsg = msgs[0];
              if (firstMsg && (firstMsg as { role: string }).role === "system") {
                msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
              } else {
                msgs.unshift({ role: "system" as any, content: mandate });
              }
              chatReq.messages = msgs;
            } else if (rawTarget === "hands" || rawTarget === "hand" || rawTarget === "hans" || rawTarget === "barehands" || rawTarget === "bare hands" || rawTarget.includes("bear head")) {
              const mandate = `Kontext: Der Nutzer möchte das Barehands 3D Interaktions-Interface öffnen. Antworte kurz auf Deutsch und erstelle am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "barehands.open",\n  "title": "Barehands Stage öffnen",\n  "description": "Öffnet die 3D Barehands Bühne",\n  "params": {}\n}\n\`\`\``;
              const msgs = [...chatReq.messages];
              const firstMsg = msgs[0];
              if (firstMsg && (firstMsg as { role: string }).role === "system") {
                msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
              } else {
                msgs.unshift({ role: "system" as any, content: mandate });
              }
              chatReq.messages = msgs;
            } else if (rawTarget.length > 1 && !["einen", "eine", "das", "die", "der", "im", "in", "nein", "nine", "no"].includes(rawTarget)) {
              const mandate = `Kontext: Der Nutzer möchte die Anwendung '${rawTarget}' auf seinem Windows PC öffnen/starten. Antworte direkt auf Deutsch und erstelle dafür am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "app.open_app",\n  "title": "${rawTarget} starten",\n  "description": "Startet ${rawTarget} auf dem PC",\n  "params": { "name": "${rawTarget}" }\n}\n\`\`\``;
              const msgs = [...chatReq.messages];
              const firstMsg = msgs[0];
              if (firstMsg && (firstMsg as { role: string }).role === "system") {
                msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
              } else {
                msgs.unshift({ role: "system" as any, content: mandate });
              }
              chatReq.messages = msgs;
            }
          }
        } else if (mediaMatch) {
          const mediaText = mediaMatch[0].toLowerCase();
          const mediaAction = mediaText.includes("nächst") ? "next" : mediaText.includes("vorherig") ? "prev" : mediaText.includes("pause") || mediaText.includes("stopp") ? "pause" : "play";
          const mandate = `Kontext: Der Nutzer möchte Medien-Steuerung '${mediaAction}' ausführen. Antworte kurz auf Deutsch und erstelle dafür am Ende deiner Antwort einen Action-Proposal Block:\n\`\`\`action_proposal\n{\n  "capability": "media.control",\n  "title": "Medien-Steuerung: ${mediaAction}",\n  "description": "Führt ${mediaAction} per Windows Media Keys aus",\n  "params": { "action": "${mediaAction}" }\n}\n\`\`\``;
          const msgs = [...chatReq.messages];
          const firstMsg = msgs[0];
          if (firstMsg && (firstMsg as { role: string }).role === "system") {
            msgs[0] = { role: "system" as any, content: `${firstMsg.content}\n\n${mandate}` };
          } else {
            msgs.unshift({ role: "system" as any, content: mandate });
          }
          chatReq.messages = msgs;
        }
      } catch {
        // Ignorieren falls Intent-Detector fehlschlägt
      }

      const xaiAdapter = getXaiAdapter();
      const isLocalModel = chatReq.model?.toLowerCase().includes("qwen") || chatReq.model?.toLowerCase().includes("ollama") || !xaiAdapter;
      const targetAdapter = options.modelAdapter ?? (isLocalModel ? ollamaAdapter : xaiAdapter!);

      const timeout = AbortSignal.timeout(chatTimeoutMs);
      const signal = typeof (AbortSignal as any).any === "function"
        ? (AbortSignal as any).any([request.signal, timeout])
        : request.signal;
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
