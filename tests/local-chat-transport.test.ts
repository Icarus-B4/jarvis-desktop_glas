import { describe, expect, test } from "bun:test";

import {
  ChatSessionRegistry,
  forwardJarvisChatStream,
  normalizeLoopbackHttpOrigin,
} from "../src/local-chat-transport";

function streamChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("desktop local-service boundary", () => {
  test("accepts only credential-free HTTP loopback origins", () => {
    expect(normalizeLoopbackHttpOrigin("http://127.0.0.1:4317")).toBe("http://127.0.0.1:4317");
    expect(normalizeLoopbackHttpOrigin("http://localhost:4317")).toBe("http://localhost:4317");
    expect(() => normalizeLoopbackHttpOrigin("https://127.0.0.1:4317")).toThrow("HTTP loopback");
    expect(() => normalizeLoopbackHttpOrigin("http://example.com:4317")).toThrow("loopback");
    expect(() => normalizeLoopbackHttpOrigin("http://user:secret@127.0.0.1:4317")).toThrow("credential-free");
    expect(() => normalizeLoopbackHttpOrigin("http://127.0.0.1:4317/chat")).toThrow("origin");
  });

  test("forwards split SSE events and stops at one terminal event", async () => {
    const events: string[] = [];
    await forwardJarvisChatStream(streamChunks([
      "event: chat.start\ndata: {\"type\":\"chat.start\",\"requestId\":\"r1\",\"model\":\"qwen3:8b\"}\n\n",
      "data: {\"type\":\"chat.delta\",\"requestId\":\"r1\",\"del",
      "ta\":\"Hello\"}\n\ndata: {\"type\":\"chat.done\",\"requestId\":\"r1\",\"message\":{\"role\":\"assistant\",\"content\":\"Hello\"}}",
    ]), "r1", (event) => events.push(event.type));
    expect(events).toEqual(["chat.start", "chat.delta", "chat.done"]);
  });

  test("rejects malformed or terminal-less streams", async () => {
    await expect(forwardJarvisChatStream(streamChunks(["data: not-json\n\n"]), "r1", () => undefined)).rejects.toThrow();
    await expect(forwardJarvisChatStream(streamChunks([
      "data: {\"type\":\"chat.delta\",\"requestId\":\"r1\",\"delta\":\"partial\"}\n\n",
    ]), "r1", () => undefined)).rejects.toThrow("terminal event");
  });
});

describe("renderer chat ownership", () => {
  test("allows one chat per renderer and aborts exact ownership", () => {
    const registry = new ChatSessionRegistry();
    const first = registry.start(7, "request-1");
    expect(first).toBeDefined();
    expect(registry.start(7, "request-2")).toBeUndefined();
    expect(registry.cancel(7, "wrong-request")).toBe(false);
    expect(first?.signal.aborted).toBe(false);
    expect(registry.cancel(7, "request-1")).toBe(true);
    expect(first?.signal.aborted).toBe(true);
    registry.finish(7, "request-1");
    expect(registry.start(7, "request-3")).toBeDefined();
    registry.abortOwner(7);
  });
});
