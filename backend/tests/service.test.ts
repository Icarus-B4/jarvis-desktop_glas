import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_JARVIS_HOSTNAME,
  DEFAULT_JARVIS_PORT,
  createJarvisRequestHandler,
  isLoopbackHostname,
  startJarvisService,
  type RunningJarvisService,
} from "../src/index";
import {
  DEFAULT_OLLAMA_MODEL,
  isDashboardSnapshot,
  isJarvisActionIntent,
  isJarvisApiError,
  isJarvisChatStreamEvent,
  isJarvisHealthSnapshot,
  isJarvisMemoryItem,
  isJarvisModelReadiness,
  isJarvisVoiceStatus,
  type JarvisChatStreamEvent,
} from "@jarvis/shared";

function readSse(text: string): JarvisChatStreamEvent[] {
  return text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    if (!data) return [];
    const value: unknown = JSON.parse(data.slice(6)) as unknown;
    expect(isJarvisChatStreamEvent(value)).toBe(true);
    return [value as JarvisChatStreamEvent];
  });
}

const runningServices: RunningJarvisService[] = [];

afterEach(() => {
  for (const service of runningServices.splice(0)) service.stop();
});

describe("Jarvis request handler", () => {
  const handler = createJarvisRequestHandler({
    now: () => new Date("2026-08-02T12:00:00.000Z"),
    startedAt: new Date("2026-08-02T11:58:30.000Z"),
  });

  test("returns a valid minimal health response", async () => {
    const response = await handler(new Request("http://127.0.0.1:4317/health"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(isJarvisHealthSnapshot(body)).toBe(true);
    expect(body).toMatchObject({
      startedAt: "2026-08-02T11:58:30.000Z",
      uptimeSeconds: 90,
      orbState: "ready",
      eventStream: { transport: "sse", status: "active", path: "/v1/events" },
    });
  });

  test("returns a safe dashboard fixture", async () => {
    const response = await handler(new Request("http://127.0.0.1:4317/v1/dashboard", {
      headers: { Origin: "http://localhost:3002" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3002");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(isDashboardSnapshot(body)).toBe(true);
    expect(body).toEqual({
      profile: { displayName: "Local Preview", email: "preview@localhost" },
      purchases: [],
    });
  });

  test("supports pairing code generation and token exchange", async () => {
    const codeReq = await handler(new Request("http://127.0.0.1:4317/v1/pairing/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName: "jarvis-desktop" }),
    }));
    expect(codeReq.status).toBe(200);
    const codeRes = await codeReq.json() as { code: string };
    expect(typeof codeRes.code).toBe("string");
    expect(codeRes.code).toHaveLength(6);

    const exchangeReq = await handler(new Request("http://127.0.0.1:4317/v1/pairing/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeRes.code, clientName: "jarvis-desktop" }),
    }));
    expect(exchangeReq.status).toBe(200);
    const exchangeRes = await exchangeReq.json() as { token: string };
    expect(typeof exchangeRes.token).toBe("string");
    expect(exchangeRes.token.length).toBeGreaterThan(16);

    const invalidExchange = await handler(new Request("http://127.0.0.1:4317/v1/pairing/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000", clientName: "jarvis-desktop" }),
    }));
    expect(invalidExchange.status).toBe(401);
  });

  test("returns voice status and handles mute toggle", async () => {
    const statusReq = await handler(new Request("http://127.0.0.1:4317/v1/voice/status"));
    expect(statusReq.status).toBe(200);
    const status = await statusReq.json();
    expect(isJarvisVoiceStatus(status)).toBe(true);
    expect(status.muted).toBe(false);

    const muteReq = await handler(new Request("http://127.0.0.1:4317/v1/voice/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted: true }),
    }));
    expect(muteReq.status).toBe(200);
    const mutedStatus = await muteReq.json();
    expect(isJarvisVoiceStatus(mutedStatus)).toBe(true);
    expect(mutedStatus.muted).toBe(true);
  });

  test("supports memory CRUD operations via /v1/memory", async () => {
    const listInitial = await handler(new Request("http://127.0.0.1:4317/v1/memory"));
    expect(listInitial.status).toBe(200);
    const itemsInitial = await listInitial.json();
    expect(Array.isArray(itemsInitial)).toBe(true);

    const addReq = await handler(new Request("http://127.0.0.1:4317/v1/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "operator_preference", key: "theme", value: "dark" }),
    }));
    expect(addReq.status).toBe(201);
    const created = await addReq.json();
    expect(isJarvisMemoryItem(created)).toBe(true);
    expect(created.key).toBe("theme");

    const deleteReq = await handler(new Request(`http://127.0.0.1:4317/v1/memory/${created.id}`, {
      method: "DELETE",
    }));
    expect(deleteReq.status).toBe(200);

    const clearReq = await handler(new Request("http://127.0.0.1:4317/v1/memory", {
      method: "DELETE",
    }));
    expect(clearReq.status).toBe(200);
  });

  test("supports action proposal and explicit user decision lifecycle", async () => {
    const listInitial = await handler(new Request("http://127.0.0.1:4317/v1/actions"));
    expect(listInitial.status).toBe(200);
    const actionsInitial = await listInitial.json();
    expect(Array.isArray(actionsInitial)).toBe(true);

    const proposeReq = await handler(new Request("http://127.0.0.1:4317/v1/actions/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: "scratchpad.write",
        title: "Create scratchpad note",
        description: "Save local note to scratchpad",
        params: { text: "Test note" },
      }),
    }));
    expect(proposeReq.status).toBe(201);
    const proposed = await proposeReq.json();
    expect(isJarvisActionIntent(proposed)).toBe(true);
    expect(proposed.status).toBe("proposed");

    const decideReq = await handler(new Request("http://127.0.0.1:4317/v1/actions/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: proposed.id, decision: "approve" }),
    }));
    expect(decideReq.status).toBe(200);
    const completed = await decideReq.json();
    expect(isJarvisActionIntent(completed)).toBe(true);
    expect(completed.status).toBe("completed");
    expect(completed.result).toBeDefined();
  });

  test("streams live events over SSE on /v1/events", async () => {
    const controller = new AbortController();
    const response = await handler(new Request("http://127.0.0.1:4317/v1/events", { signal: controller.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader?.read();
    const text = new TextDecoder().decode(chunk?.value);
    expect(text).toContain("event: service.connected");
    expect(text).toContain("serviceVersion");
    controller.abort();
  });

  test("supports CORS preflight for an allowed local origin", async () => {
    const response = await handler(new Request("http://127.0.0.1:4317/v1/dashboard", {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:3002" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3002");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });

  test("rejects disallowed browser origins with a typed 403", async () => {
    const response = await handler(new Request("http://127.0.0.1:4317/health", {
      headers: { Origin: "https://example.com" },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(isJarvisApiError(await response.json())).toBe(true);
  });

  test("does not expose action methods or unknown routes", async () => {
    const actionResponse = await handler(new Request("http://127.0.0.1:4317/v1/actions/shell", { method: "POST" }));
    const unknownResponse = await handler(new Request("http://127.0.0.1:4317/private-files"));
    expect(actionResponse.status).toBe(405);
    expect(unknownResponse.status).toBe(404);
  });

  test("returns validated readiness without downloading prerequisites", async () => {
    let readinessCalls = 0;
    const chatHandler = createJarvisRequestHandler({
      modelAdapter: {
        providerName: "ollama",
        async getReadiness() {
          readinessCalls++;
          return { status: "model-missing", provider: "ollama", model: DEFAULT_OLLAMA_MODEL, ollamaUrl: "http://127.0.0.1:11434", message: "Model missing.", instruction: { command: `ollama pull ${DEFAULT_OLLAMA_MODEL}`, detail: "Run manually." } };
        },
        async *streamChat() { throw new Error("not used"); },
      },
    });
    const response = await chatHandler(new Request("http://127.0.0.1:4317/v1/model/readiness"));
    expect(response.status).toBe(200);
    expect(isJarvisModelReadiness(await response.json())).toBe(true);
    expect(readinessCalls).toBe(1);
  });

  test("rejects invalid or browser-origin chat requests", async () => {
    const invalid = await handler(new Request("http://127.0.0.1:4317/v1/chat", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    const browser = await handler(new Request("http://127.0.0.1:4317/v1/chat", { method: "POST", body: "{}", headers: { Origin: "http://localhost:3002", "Content-Type": "application/json" } }));
    expect(invalid.status).toBe(400);
    expect(isJarvisApiError(await invalid.json())).toBe(true);
    expect(browser.status).toBe(403);
  });

  test("streams one start, incremental deltas, and one done event over SSE", async () => {
    const chatHandler = createJarvisRequestHandler({
      modelAdapter: {
        providerName: "ollama",
        async getReadiness() { return { status: "ready", provider: "ollama", model: DEFAULT_OLLAMA_MODEL, ollamaUrl: "http://127.0.0.1:11434", message: "Ready." }; },
        async *streamChat(request) {
          yield { type: "chat.start", requestId: request.requestId, model: DEFAULT_OLLAMA_MODEL } as const;
          yield { type: "chat.delta", requestId: request.requestId, delta: "Hel" } as const;
          yield { type: "chat.delta", requestId: request.requestId, delta: "lo" } as const;
          yield { type: "chat.done", requestId: request.requestId, message: { role: "assistant", content: "Hello" } } as const;
          yield { type: "chat.done", requestId: request.requestId, message: { role: "assistant", content: "duplicate" } } as const;
        },
      },
    });
    const response = await chatHandler(new Request("http://127.0.0.1:4317/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "request-1", model: DEFAULT_OLLAMA_MODEL, messages: [{ role: "user", content: "Hello" }] }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = readSse(await response.text());
    expect(events.map((event) => event.type)).toEqual(["chat.start", "chat.delta", "chat.delta", "chat.done"]);
  });
});

describe("loopback-only service lifecycle", () => {
  test("uses the documented loopback host and port defaults", () => {
    expect(DEFAULT_JARVIS_HOSTNAME).toBe("127.0.0.1");
    expect(DEFAULT_JARVIS_PORT).toBe(4317);
  });

  test("recognizes loopback hosts without accepting wildcards or remote hosts", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.42.0.9")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("::")).toBe(false);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(isLoopbackHostname("*")).toBe(false);
  });

  test("rejects non-loopback bind configuration before starting", () => {
    expect(() => startJarvisService({ hostname: "0.0.0.0", port: 0 })).toThrow("loopback-only");
    expect(() => startJarvisService({ hostname: "example.com", port: 0 })).toThrow("loopback-only");
  });

  test("rejects non-local configured browser origins", () => {
    expect(() => createJarvisRequestHandler({ allowedOrigins: ["https://example.com"] })).toThrow("loopback origin");
    expect(() => createJarvisRequestHandler({ allowedOrigins: ["*"] })).toThrow("Invalid Jarvis browser origin");
  });

  test("starts on an ephemeral loopback port and stops idempotently", async () => {
    const service = startJarvisService({ port: 0 });
    runningServices.push(service);

    expect(service.hostname).toBe("127.0.0.1");
    expect(service.port).toBeGreaterThan(0);
    const response = await fetch(`${service.baseUrl}/health`);
    expect(response.status).toBe(200);

    service.stop();
    service.stop();
    runningServices.splice(runningServices.indexOf(service), 1);
  });

  test("automatically falls back to next port if port is occupied and fallback is enabled", async () => {
    const service1 = startJarvisService();
    runningServices.push(service1);
    const service2 = startJarvisService();
    runningServices.push(service2);

    expect(service2.port).toBe(service1.port + 1);
  });
});
