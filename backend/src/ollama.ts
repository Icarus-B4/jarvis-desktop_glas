import {
  DEFAULT_OLLAMA_MODEL,
  type JarvisChatRequest,
  type JarvisChatStreamEvent,
  type JarvisModelReadiness,
} from "@jarvis/shared";

import { isLoopbackHostname } from "./config";
import type { JarvisModelAdapter } from "./model-adapter";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_NUM_PREDICT = 1_024;

export type OllamaClient = JarvisModelAdapter & {
  readonly providerName: "ollama";
  getReadiness(signal?: AbortSignal): Promise<JarvisModelReadiness>;
  streamChat(request: JarvisChatRequest, signal: AbortSignal): AsyncIterable<JarvisChatStreamEvent>;
};

export type OllamaClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
  runtimeAvailable?: () => boolean;
};

export function normalizeOllamaUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || !isLoopbackHostname(url.hostname)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new TypeError("Jarvis Ollama URL must be a credential-free HTTP loopback origin.");
  }
  return url.origin;
}

function modelMissing(url: string): JarvisModelReadiness {
  return {
    status: "model-missing",
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    ollamaUrl: url,
    message: `Ollama is online, but ${DEFAULT_OLLAMA_MODEL} is not installed locally.`,
    instruction: {
      command: `ollama pull ${DEFAULT_OLLAMA_MODEL}`,
      detail: "Run this yourself in a terminal. JARVIS will not download the model automatically.",
    },
  };
}

function runtimeMissing(url: string): JarvisModelReadiness {
  return {
    status: "runtime-missing",
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    ollamaUrl: url,
    message: "Ollama is not installed or is not available on this computer.",
    instruction: {
      command: "https://ollama.com/download",
      detail: "Open this address yourself to install Ollama, then start it locally. JARVIS will not install anything.",
    },
  };
}

function unreachable(url: string): JarvisModelReadiness {
  return {
    status: "unreachable",
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    ollamaUrl: url,
    message: "Ollama is installed but is not reachable on its local loopback address.",
    instruction: {
      command: "ollama serve",
      detail: "Run this yourself in a terminal, then refresh. JARVIS will not start or install Ollama automatically.",
    },
  };
}

function defaultRuntimeAvailable(): boolean {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: { which(command: string): string | null } }).Bun;
  return bunRuntime?.which("ollama") !== null && bunRuntime?.which("ollama") !== undefined;
}

async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") yield JSON.parse(line) as unknown;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim() !== "") yield JSON.parse(buffer) as unknown;
}

function readRecord(value: unknown): { delta: string; done: boolean; error?: boolean } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Ollama stream record");
  const record = value as { message?: { content?: unknown }; done?: unknown; error?: unknown };
  if (typeof record.error === "string" && record.error.trim() !== "") return { delta: "", done: true, error: true };
  const delta = typeof record.message?.content === "string" ? record.message.content : "";
  return { delta, done: record.done === true };
}

function timeoutWasTriggered(signal: AbortSignal): boolean {
  return signal.aborted
    && signal.reason instanceof DOMException
    && signal.reason.name === "TimeoutError";
}

export function createOllamaClient(options: OllamaClientOptions = {}): OllamaClient {
  const baseUrl = normalizeOllamaUrl(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const fetcher = options.fetcher ?? fetch;
  const runtimeAvailable = options.runtimeAvailable ?? defaultRuntimeAvailable;

  async function completeChat(request: {
    messages: Array<{ role: string; content?: string; tool_calls?: unknown; tool_call_id?: string }>;
    tools?: Array<Record<string, unknown>>;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }> {
    const modelToUse = request.model || DEFAULT_OLLAMA_MODEL;
    const sanitizedMessages = request.messages.map((m) => ({
      role: m.role === "user" || m.role === "assistant" || m.role === "system" ? m.role : "user",
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    }));

    const body: Record<string, unknown> = {
      model: modelToUse,
      messages: sanitizedMessages,
      stream: false,
      think: false,
      options: { num_predict: DEFAULT_OLLAMA_NUM_PREDICT },
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    const response = await fetcher(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      redirect: "error",
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama completeChat Fehler: HTTP ${response.status} - ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const message = ((data as { message?: Record<string, unknown> }).message ?? {}) as Record<string, unknown>;
    const content = typeof message.content === "string" ? message.content : "";

    const toolCalls = Array.isArray(message.tool_calls)
      ? ((message as { tool_calls: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> }).tool_calls).map((tc) => ({
          id: String(tc.id ?? `call-${crypto.randomUUID()}`),
          name: String(tc.function?.name ?? ""),
          arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
        }))
      : undefined;

    return { content, toolCalls };
  }

  return {
    providerName: "ollama",
    completeChat,

    async getReadiness(signal?: AbortSignal): Promise<JarvisModelReadiness> {
      try {
        const response = await fetcher(`${baseUrl}/api/tags`, {
          headers: { Accept: "application/json" },
          redirect: "error",
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) return unreachable(baseUrl);
        const payload: unknown = await response.json();
        const names = typeof payload === "object" && payload !== null && Array.isArray((payload as { models?: unknown }).models)
          ? (payload as { models: Array<{ name?: unknown; model?: unknown }> }).models.map((model) => String(model.name ?? model.model ?? ""))
          : [];
        if (names.length === 0 || !names.includes(DEFAULT_OLLAMA_MODEL)) return modelMissing(baseUrl);
        return {
          status: "ready",
          provider: "ollama",
          model: DEFAULT_OLLAMA_MODEL,
          ollamaUrl: baseUrl,
          message: `${DEFAULT_OLLAMA_MODEL} ist bereit für den lokalen Chat (${names.length} Modelle gefunden).`,
        };
      } catch {
        return runtimeAvailable() ? unreachable(baseUrl) : runtimeMissing(baseUrl);
      }
    },

    async *streamChat(request: JarvisChatRequest, signal: AbortSignal): AsyncIterable<JarvisChatStreamEvent> {
      try {
        const sanitizedMessages = request.messages.map((m) => ({
          role: m.role === "user" || m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
        }));

        const modelToUse = request.model || DEFAULT_OLLAMA_MODEL;

        const response = await fetcher(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          redirect: "error",
          signal,
          body: JSON.stringify({
            model: modelToUse,
            messages: sanitizedMessages,
            stream: true,
            think: false,
            options: { num_predict: DEFAULT_OLLAMA_NUM_PREDICT },
          }),
        });
        if (!response.ok || response.body === null) {
          const errText = await response.text().catch(() => "");
          console.warn("[ollama-chat] HTTP", response.status, errText);
          yield { type: "chat.error", requestId: request.requestId, error: { code: "ollama_unavailable", message: `Ollama Stream-Fehler (HTTP ${response.status}): ${errText || "Lokaler Service lieferte Fehler"}` } };
          return;
        }

        yield { type: "chat.start", requestId: request.requestId, model: modelToUse };
        let content = "";
        for await (const rawRecord of readNdjson(response.body)) {
          const record = readRecord(rawRecord);
          if (record.error) {
            yield { type: "chat.error", requestId: request.requestId, error: { code: "ollama_stream_error", message: "Ollama meldet einen lokalen Generierungsfehler." } };
            return;
          }
          if (record.delta !== "") {
            content += record.delta;
            yield { type: "chat.delta", requestId: request.requestId, delta: record.delta };
          }
          if (record.done) {
            if (content.trim() === "") {
              yield { type: "chat.error", requestId: request.requestId, error: { code: "empty_model_response", message: "Ollama hat geantwortet, aber keinen Text zurückgegeben." } };
            } else {
              yield { type: "chat.done", requestId: request.requestId, message: { role: "assistant", content } };
            }
            return;
          }
        }

        yield { type: "chat.error", requestId: request.requestId, error: { code: "incomplete_ollama_stream", message: "Der lokale Modell-Stream wurde vorzeitig beendet." } };
      } catch (err) {
        if (timeoutWasTriggered(signal)) {
          yield { type: "chat.error", requestId: request.requestId, error: { code: "chat_timeout", message: "Die lokale Modell-Antwort hat das Zeitlimit überschritten." } };
        } else if (signal.aborted) {
          yield { type: "chat.cancelled", requestId: request.requestId };
        } else {
          yield { type: "chat.error", requestId: request.requestId, error: { code: "ollama_unavailable", message: "Lokaler Ollama Server (127.0.0.1:11434) ist derzeit nicht erreichbar. Starte Ollama mit 'ollama serve' oder klicke auf '▶ Ollama Server Starten'." } };
        }
      }
    },
  };
}
