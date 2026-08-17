import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OLLAMA_NUM_PREDICT,
  createOllamaClient,
  normalizeOllamaUrl,
} from "../src/index";
import { DEFAULT_OLLAMA_MODEL, type JarvisChatRequest, type JarvisChatStreamEvent } from "@jarvis/shared";

const request: JarvisChatRequest = {
  requestId: "request-1",
  model: DEFAULT_OLLAMA_MODEL,
  messages: [{ role: "user", content: "Hello" }],
};

async function collect(stream: AsyncIterable<JarvisChatStreamEvent>): Promise<JarvisChatStreamEvent[]> {
  const events: JarvisChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200 });
}

describe("Ollama loopback adapter", () => {
  test("rejects every non-loopback or credentialed base URL", () => {
    expect(normalizeOllamaUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(() => normalizeOllamaUrl("https://127.0.0.1:11434")).toThrow("HTTP loopback");
    expect(() => normalizeOllamaUrl("http://example.com:11434")).toThrow("loopback");
    expect(() => normalizeOllamaUrl("http://user:secret@127.0.0.1:11434")).toThrow("credential-free");
  });

  test("distinguishes exact model readiness, missing model, missing runtime, and unreachable runtime", async () => {
    const ready = createOllamaClient({ fetcher: (async () => Response.json({ models: [{ name: DEFAULT_OLLAMA_MODEL }] })) as unknown as typeof fetch });
    const modelMissing = createOllamaClient({ fetcher: (async () => Response.json({ models: [{ name: "qwen3:4b" }] })) as unknown as typeof fetch });
    const runtimeMissing = createOllamaClient({ fetcher: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, runtimeAvailable: () => false });
    const unreachable = createOllamaClient({ fetcher: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, runtimeAvailable: () => true });

    expect((await ready.getReadiness()).status).toBe("ready");
    const missing = await modelMissing.getReadiness();
    expect(missing.status).toBe("model-missing");
    expect(missing.instruction?.command).toBe(`ollama pull ${DEFAULT_OLLAMA_MODEL}`);
    expect((await runtimeMissing.getReadiness()).status).toBe("runtime-missing");
    expect((await unreachable.getReadiness()).status).toBe("unreachable");
  });

  test("parses split and final NDJSON records while requiring explicit completion", async () => {
    const fetcher = (async () => chunkedResponse([
      '{"message":{"content":"Hel"},"done":false}\n{"message":{"cont',
      'ent":"lo"},"done":false}\n{"message":{"content":""},"done":true}',
    ])) as unknown as typeof fetch;
    const events = await collect(createOllamaClient({ fetcher }).streamChat(request, new AbortController().signal));
    expect(events.map((event) => event.type)).toEqual(["chat.start", "chat.delta", "chat.delta", "chat.done"]);
    expect(events.at(-1)).toEqual({ type: "chat.done", requestId: "request-1", message: { role: "assistant", content: "Hello" } });
  });

  test("normalizes truncated, malformed, upstream-error, and empty streams", async () => {
    const fixtures = [
      ['{"message":{"content":"partial"},"done":false}\n'],
      ["not-json\n"],
      ['{"error":"raw private upstream detail","done":true}\n'],
      ['{"message":{"content":""},"done":true}\n'],
    ];
    for (const chunks of fixtures) {
      const events = await collect(createOllamaClient({ fetcher: (async () => chunkedResponse(chunks)) as unknown as typeof fetch }).streamChat(request, new AbortController().signal));
      expect(events.at(-1)?.type).toBe("chat.error");
      expect(JSON.stringify(events)).not.toContain("raw private upstream detail");
      expect(events.filter((event) => ["chat.done", "chat.cancelled", "chat.error"].includes(event.type))).toHaveLength(1);
    }
  });

  test("sends only bounded text generation configuration and forbids redirect following", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input); capturedInit = init;
      return chunkedResponse(['{"message":{"content":"Okay"},"done":true}\n']);
    }) as typeof fetch;
    await collect(createOllamaClient({ fetcher }).streamChat(request, new AbortController().signal));
    expect(capturedUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(capturedInit?.redirect).toBe("error");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: DEFAULT_OLLAMA_MODEL, messages: request.messages, stream: true, think: false, options: { num_predict: DEFAULT_OLLAMA_NUM_PREDICT } });
    expect(body).not.toHaveProperty("tools");
  });

  test("propagates cancellation and emits one cancelled terminal event", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw init?.signal?.reason;
    }) as unknown as typeof fetch;
    const events = await collect(createOllamaClient({ fetcher }).streamChat(request, controller.signal));
    expect(events).toEqual([{ type: "chat.cancelled", requestId: "request-1" }]);
  });
});
