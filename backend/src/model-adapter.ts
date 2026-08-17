import type {
  JarvisChatRequest,
  JarvisChatStreamEvent,
  JarvisModelReadiness,
} from "@jarvis/shared";

export type JarvisModelAdapter = {
  readonly providerName: string;
  getReadiness(signal?: AbortSignal): Promise<JarvisModelReadiness>;
  streamChat(
    request: JarvisChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<JarvisChatStreamEvent>;
  completeChat(request: {
    messages: Array<{ role: string; content?: string }>;
    tools?: Array<Record<string, unknown>>;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>;
};
