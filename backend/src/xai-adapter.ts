/**
 * xAI Grok Chat-Adapter
 * Implementiert JarvisModelAdapter über die OpenAI-kompatible xAI-API.
 * Streaming via Server-Sent Events (text/event-stream).
 *
 * Hinweis: Die shared-Typen (JarvisModelReadiness, JarvisChatRequest) sind
 * historisch auf Ollama fixiert (provider "ollama", model "qwen3:8b").
 * Wir nutzen type-Casts an den Grenzen, da der Adapter provider-neutral
 * hinter JarvisModelAdapter sitzt.
 */

import {
  DEFAULT_OLLAMA_MODEL,
  type JarvisChatRequest,
  type JarvisChatStreamEvent,
  type JarvisModelReadiness,
} from "@jarvis/shared";

import type { JarvisModelAdapter } from "./model-adapter";

// Standardmodell für Chat (schnelles 500ms non-reasoning Modell für Echtzeit-Interaktion)
export const DEFAULT_XAI_MODEL = "grok-4.20-non-reasoning";
export const XAI_BASE_URL = "https://api.x.ai/v1";

export type XaiAdapterOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
};

/** Liest xAI SSE-Stream und gibt rohe Daten-Strings als AsyncIterable zurück */
async function* readOpenAiSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      // Nur SSE-Zeilen mit "data: " verarbeiten
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      if (data) yield data;
    }
  }

  // Restpuffer verarbeiten
  if (buffer.startsWith("data: ")) {
    const data = buffer.slice(6).trim();
    if (data && data !== "[DONE]") yield data;
  }
}

/** Extrahiert das Content-Delta oder Reasoning-Delta aus einem geparsten OpenAI/xAI-SSE-Chunk */
function extractDelta(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const obj = raw as { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }> };
  const delta = obj.choices?.[0]?.delta;
  if (!delta) return "";
  if (typeof delta.content === "string") return delta.content;
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  return "";
}

/**
 * Erstellt ein JarvisModelReadiness-Objekt für xAI.
 * Wir nutzen DEFAULT_OLLAMA_MODEL und "ollama" als provider,
 * damit der Renderer-Validator isJarvisModelReadiness() besteht.
 * Das ist ein bewusster Kompromiss — der Adapter ist provider-neutral,
 * aber der shared-Typ kennt noch nur Ollama.
 */
function makeReadiness(
  status: JarvisModelReadiness["status"],
  message: string,
  instruction?: { command: string; detail: string },
): JarvisModelReadiness {
  // status "ready" darf keine instruction haben (Validator-Regel)
  if (status === "ready") {
    return {
      status,
      provider: "ollama",
      model: DEFAULT_OLLAMA_MODEL,
      ollamaUrl: XAI_BASE_URL,
      message,
    };
  }
  return {
    status,
    provider: "ollama",
    model: DEFAULT_OLLAMA_MODEL,
    ollamaUrl: XAI_BASE_URL,
    message,
    instruction: instruction ?? {
      command: "XAI_API_KEY=xai-... setzen",
      detail: "API-Key unter https://console.x.ai abrufen und als Umgebungsvariable setzen.",
    },
  };
}

export function createXaiAdapter(options: XaiAdapterOptions = {}): JarvisModelAdapter {
  const apiKey = options.apiKey ?? process.env.XAI_API_KEY ?? "";
  const model = options.model ?? DEFAULT_XAI_MODEL;
  const fetcher = options.fetcher ?? fetch;

  async function completeChat(request: {
    messages: Array<{ role: string; content?: string; imageData?: string; tool_calls?: unknown; tool_call_id?: string }>;
    tools?: Array<Record<string, unknown>>;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }> {
    if (!apiKey) {
      throw new Error("XAI_API_KEY nicht konfiguriert.");
    }

    const hasImages = request.messages.some((m) => Boolean(m.imageData));
    const activeModel = hasImages ? "grok-2-vision-latest" : (request.model ?? model);
    const messages = request.messages.map((m) => {
      const normalized: Record<string, unknown> = {
        role: m.role,
        content: m.imageData
          ? [
              { type: "text", text: m.content || "Analysiere dieses Bild:" },
              { type: "image_url", image_url: { url: m.imageData } },
            ]
          : (m.content ?? ""),
      };
      if (m.tool_calls !== undefined) normalized.tool_calls = m.tool_calls;
      if (m.tool_call_id !== undefined) normalized.tool_call_id = m.tool_call_id;
      return normalized;
    });

    const body: Record<string, unknown> = {
      model: activeModel,
      messages,
      stream: false,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = "auto";
    }

    const response = await fetcher(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      redirect: "error",
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`xAI completeChat Fehler: HTTP ${response.status} - ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choice = (data as { choices?: Array<{ message?: Record<string, unknown> }> }).choices?.[0];
    const message = choice?.message ?? {};
    const content = typeof message.content === "string" ? message.content : "";

    const toolCalls = Array.isArray((message as Record<string, unknown>).tool_calls)
      ? ((message as { tool_calls: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> }).tool_calls).map((tc) => ({
          id: String(tc.id ?? `call-${crypto.randomUUID()}`),
          name: String(tc.function?.name ?? ""),
          arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
        }))
      : undefined;

    if (!content && !toolCalls?.length) {
      return { content: "" };
    }

    return { content, toolCalls };
  }

  return {
    providerName: "xai",
    completeChat,

    async getReadiness(signal?: AbortSignal): Promise<JarvisModelReadiness> {
      if (!apiKey) {
        return makeReadiness(
          "runtime-missing",
          "Kein XAI_API_KEY konfiguriert. Bitte als Umgebungsvariable setzen.",
          {
            command: "XAI_API_KEY=xai-... (Umgebungsvariable setzen)",
            detail: "Den API-Key unter https://console.x.ai abrufen und als XAI_API_KEY setzen.",
          },
        );
      }

      try {
        // Validierung: Modell-Liste abrufen um Key zu prüfen
        const response = await fetcher(`${XAI_BASE_URL}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          redirect: "error",
          ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
          return makeReadiness(
            "unreachable",
            `xAI API antwortet mit Status ${response.status}. API-Key prüfen.`,
            {
              command: "XAI_API_KEY prüfen",
              detail: "Sicherstellen, dass der Key gültig ist: https://console.x.ai",
            },
          );
        }

        return makeReadiness("ready", `${model} ist über xAI API einsatzbereit.`);
      } catch {
        return makeReadiness(
          "unreachable",
          "xAI API nicht erreichbar. Netzwerk und API-Key prüfen.",
          {
            command: "Netzwerkverbindung prüfen",
            detail: "Sicherstellen, dass https://api.x.ai erreichbar ist.",
          },
        );
      }
    },

    async *streamChat(request: JarvisChatRequest, signal: AbortSignal): AsyncIterable<JarvisChatStreamEvent> {
      if (!apiKey) {
        yield {
          type: "chat.error",
          requestId: request.requestId,
          error: { code: "xai_no_api_key", message: "XAI_API_KEY nicht konfiguriert." },
        };
        return;
      }

      // System-Prompt nur hinzufügen wenn keine System-Message vorhanden
      const JARVIS_SYSTEM_INSTRUCTION =
        "Du bist J.A.R.V.I.S. — der persönliche KI-Assistent von Ed.\n" +
        "Du unterstützt Ed auf Deutsch bei allen Fragen, beim Programmieren, bei der Websuche (KI-News, aktuelle Themen) und bei der vollständigen Steuerung seines Windows-Systems.\n\n" +
        "Du besitzt Zugriff auf das Windows-System von Ed. Wenn Ed dich auffordert, eine Webseite zu öffnen, ein beliebiges Programm zu starten (z. B. Windows Media Player, Spotify, VLC, Rechner, VS Code, Chrome, etc.) oder Musik/Medien zu steuern, antworte direkt, freundlich und hilfsbereit auf Deutsch. Erstelle dafür am Ende deiner Antwort ein Action Proposal JSON:\n\n" +
        "```action_proposal\n" +
        "{\n" +
        '  "capability": "app.open_app",\n' +
        '  "title": "Windows Media Player starten",\n' +
        '  "description": "Startet Windows Media Player auf Eds PC",\n' +
        '  "params": { "name": "windows media player" }\n' +
        "}\n" +
        "```\n\n" +
        "Verfügbare Capabilities:\n" +
        "- app.open_url (Params: { \"url\": \"https://...\" }) — WICHTIG: Nutze diese Capability NICHT als Tool-Call, sondern erstelle am Ende deiner Antwort IMMER ein action_proposal JSON-Block mit capability \"app.open_url\" und dem url-Parameter. Die Webseite wird dann automatisch auf der Hauptbühne im Desktop geöffnet.\n" +
        "- app.open_app (Params: { \"name\": \"<beliebige_windows_app>\" } — z. B. \"windows media player\", \"spotify\", \"vlc\", \"calc\", \"notepad\", \"code\", \"chrome\", \"edge\", \"explorer\", etc.)\n" +
        "- media.control (Params: { \"action\": \"play\" | \"pause\" | \"next\" | \"prev\" | \"stop\", \"query\": \"<optional_song_oder_künstler_name>\" })\n" +
        "- system.take_screenshot (Erstellt einen Screenshot von Eds Bildschirm und zeigt ihn auf der Hauptbühne an)\n" +
        "- camera.open (Öffnet den Kamera-Feed auf der Hauptbühne)\n" +
        "- system.execute_command ist nur für explizit eingegebene Terminalbefehle vorgesehen und darf nicht selbstständig vorgeschlagen werden.\n" +
        "- scratchpad.write (Params: { \"text\": \"...\" })\n\n" +
        "Wichtig bei Musikwünschen:\n" +
        "- Wenn Ed einen spezifischen Song, Titel oder Künstler nennt (z. B. 'Spiele Lead-Up von Boris Brejcha'), gib in media.control zwingend den 'query'-Parameter mit (z. B. { \"action\": \"play\", \"query\": \"Boris Brejcha Lead-Up\" }), damit die KI den Song direkt sucht und abspielt!\n\n" +
        "STRIKTE REGEL FÜR KAMERA & BILD-ANALYSE:\n" +
        "- Du hast NUR DANN ein Bild vor dir, wenn in der Benutzernachricht explizit ein Bild als Vision-Input mitgesendet wurde.\n" +
        "- Wenn der Nutzer fragt 'Was siehst du auf meiner Kamera?', 'Was ist auf dem Foto?' oder ähnlich, aber KEIN Bild in der Nachricht vorhanden ist, darfst du NIEMALS frei erfinden oder halluzinieren, was im Raum steht!\n" +
        "- Antworte in diesem Fall ehrlich: 'Ich sehe aktuell kein Kamerabild. Bitte klicke bei der Kamera auf der Hauptbühne auf 🧠 VON JARVIS ANALYSIEREN LASSEN, um ein Foto deiner Kamera an mich zur Analyse zu senden.'\n\n" +
        "Falls dir bereits Live-Web-Ergebnisse oder RAG-Kontexte im System-Prompt bereitgestellt werden, nutze diese Informationen aktiv für deine Antwort. Antworte stets auf Deutsch, präzise und hilfsbereit.";

      const firstMsg = request.messages[0];
      const hasSystemMessage = firstMsg !== undefined && (firstMsg as { role: string }).role === "system";
      const rawMessages = hasSystemMessage && firstMsg
        ? [
            {
              role: "system" as const,
              content: `${JARVIS_SYSTEM_INSTRUCTION}\n\n${firstMsg.content}`,
            },
            ...request.messages.slice(1),
          ]
        : [
            {
              role: "system" as const,
              content: JARVIS_SYSTEM_INSTRUCTION,
            },
            ...request.messages,
          ];

      const hasImages = rawMessages.some((m: any) => Boolean(m.imageData));
      const activeModel = hasImages ? "grok-2-vision-latest" : model;

      const messages = rawMessages.map((m: any) => {
        if (m.imageData) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content || "Analysiere dieses Bild:" },
              { type: "image_url", image_url: { url: m.imageData } },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

      let response: Response;
      try {
        response = await fetcher(`${XAI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          redirect: "error",
          signal,
          body: JSON.stringify({
            model: activeModel,
            messages,
            stream: true,
          }),
        });
      } catch {
        if (signal.aborted) {
          yield { type: "chat.cancelled", requestId: request.requestId };
        } else {
          yield {
            type: "chat.error",
            requestId: request.requestId,
            error: { code: "xai_connection_failed", message: "Verbindung zur xAI API fehlgeschlagen." },
          };
        }
        return;
      }

      if (!response.ok || response.body === null) {
        yield {
          type: "chat.error",
          requestId: request.requestId,
          error: { code: "xai_api_error", message: `xAI API Fehler: HTTP ${response.status}` },
        };
        return;
      }

      // chat.start: model muss DEFAULT_OLLAMA_MODEL sein (Validator-Constraint)
      yield { type: "chat.start", requestId: request.requestId, model: DEFAULT_OLLAMA_MODEL };

      let accumulatedContent = "";
      try {
        for await (const rawData of readOpenAiSse(response.body)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            continue;
          }

          const delta = extractDelta(parsed);
          if (delta) {
            accumulatedContent += delta;
            yield { type: "chat.delta", requestId: request.requestId, delta };
          }
        }

        if (accumulatedContent.trim() === "") {
          yield {
            type: "chat.error",
            requestId: request.requestId,
            error: { code: "xai_empty_response", message: "xAI hat keine Antwort geliefert." },
          };
        } else {
          yield {
            type: "chat.done",
            requestId: request.requestId,
            message: { role: "assistant", content: accumulatedContent },
          };
        }
      } catch {
        if (signal.aborted) {
          yield { type: "chat.cancelled", requestId: request.requestId };
        } else {
          yield {
            type: "chat.error",
            requestId: request.requestId,
            error: { code: "xai_stream_error", message: "xAI Stream-Fehler während der Antwort." },
          };
        }
      }
    },
  };
}
