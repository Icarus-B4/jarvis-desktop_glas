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
};
