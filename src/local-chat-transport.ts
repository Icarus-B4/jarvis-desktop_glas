import {
  isJarvisChatStreamEvent,
  type JarvisChatStreamEvent,
} from "@jarvis/shared";

const terminalEventTypes = new Set<JarvisChatStreamEvent["type"]>([
  "chat.done",
  "chat.cancelled",
  "chat.error",
]);

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") return true;

  const segments = normalized.split(".");
  return segments.length === 4
    && segments.every((segment) => /^\d{1,3}$/.test(segment) && Number(segment) <= 255)
    && Number(segments[0]) === 127;
}

export function normalizeLoopbackHttpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("JARVIS local service URL must be a valid HTTP loopback origin.");
  }

  if (
    url.protocol !== "http:"
    || !isLoopbackHostname(url.hostname)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new TypeError("JARVIS local service URL must be a credential-free HTTP loopback origin.");
  }

  return url.origin;
}

function parseEventBlock(block: string): unknown {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (data === "") return undefined;
  return JSON.parse(data) as unknown;
}

export async function forwardJarvisChatStream(
  body: ReadableStream<Uint8Array>,
  requestId: string,
  onEvent: (event: JarvisChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalSeen = false;

  const consume = (flush: boolean): void => {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const blocks = normalized.split("\n\n");
    buffer = flush ? "" : (blocks.pop() ?? "");
    if (flush && blocks.at(-1) === "") blocks.pop();

    for (const block of blocks) {
      if (block.trim() === "" || terminalSeen) continue;
      const payload = parseEventBlock(block);
      if (!isJarvisChatStreamEvent(payload) || payload.requestId !== requestId) {
        throw new Error("Local chat stream returned an invalid event.");
      }
      onEvent(payload);
      if (terminalEventTypes.has(payload.type)) terminalSeen = true;
    }
  };

  while (!terminalSeen) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    consume(false);
  }

  buffer += decoder.decode();
  if (!terminalSeen && buffer.trim() !== "") {
    buffer += "\n\n";
    consume(true);
  }

  if (!terminalSeen) throw new Error("Local chat stream ended without a terminal event.");
  await reader.cancel().catch(() => undefined);
}

export class ChatSessionRegistry {
  readonly #sessions = new Map<number, { requestId: string; controller: AbortController }>();

  start(ownerId: number, requestId: string): AbortController | undefined {
    if (this.#sessions.has(ownerId)) return undefined;
    const controller = new AbortController();
    this.#sessions.set(ownerId, { requestId, controller });
    return controller;
  }

  cancel(ownerId: number, requestId: string): boolean {
    const session = this.#sessions.get(ownerId);
    if (!session || session.requestId !== requestId) return false;
    session.controller.abort();
    return true;
  }

  finish(ownerId: number, requestId: string): void {
    if (this.#sessions.get(ownerId)?.requestId === requestId) this.#sessions.delete(ownerId);
  }

  abortOwner(ownerId: number): void {
    this.#sessions.get(ownerId)?.controller.abort();
    this.#sessions.delete(ownerId);
  }

  abortAll(): void {
    for (const session of this.#sessions.values()) session.controller.abort();
    this.#sessions.clear();
  }
}
