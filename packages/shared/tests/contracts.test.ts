import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OLLAMA_MODEL,
  isDashboardSnapshot,
  isJarvisActionDecideRequest,
  isJarvisActionIntent,
  isJarvisActionProposeRequest,
  isJarvisApiError,
  isJarvisChatMessage,
  isJarvisChatRequest,
  isJarvisChatStreamEvent,
  isJarvisHealthSnapshot,
  isJarvisLiveEvent,
  isJarvisMemoryAddRequest,
  isJarvisMemoryItem,
  isJarvisMemoryQuery,
  isJarvisModelReadiness,
  isJarvisPairingCodeRequest,
  isJarvisPairingExchangeRequest,
  isJarvisVoiceMuteRequest,
  isJarvisVoiceStatus,
  jarvisOrbStates,
} from "../src/index";

describe("Jarvis shared contracts", () => {
  test("exposes every supported orb state", () => {
    expect(jarvisOrbStates).toEqual([
      "idle",
      "ready",
      "listening",
      "thinking",
      "responding",
      "executing-approved",
      "error",
      "disconnected",
    ]);
  });

  test("validates an exact dashboard snapshot", () => {
    const snapshot = {
      profile: { displayName: "Local Preview", email: "preview@localhost" },
      purchases: [
        {
          id: "purchase-1",
          title: "Preview purchase",
          description: "A safe fixture",
          status: "active",
          updatedAt: "2026-08-02T00:00:00.000Z",
        },
      ],
    };

    expect(isDashboardSnapshot(snapshot)).toBe(true);
    expect(isDashboardSnapshot({ ...snapshot, machineName: "private-host" })).toBe(false);
    expect(isDashboardSnapshot({ ...snapshot, purchases: [{ ...snapshot.purchases[0], status: "unknown" }] })).toBe(false);
  });

  test("rejects incomplete dashboard profiles", () => {
    expect(isDashboardSnapshot({ profile: { displayName: "Preview" }, purchases: [] })).toBe(false);
    expect(isDashboardSnapshot({ profile: null, purchases: [] })).toBe(false);
  });

  test("validates health responses and rejects extra data", () => {
    const health = {
      status: "ok",
      service: "jarvis-local-service",
      version: "0.1.0",
      timestamp: "2026-08-02T00:00:00.000Z",
      startedAt: "2026-08-01T23:59:00.000Z",
      uptimeSeconds: 60,
      orbState: "ready",
      eventStream: {
        transport: "websocket",
        status: "stubbed",
        path: "/v1/events",
      },
    };

    expect(isJarvisHealthSnapshot(health)).toBe(true);
    expect(isJarvisHealthSnapshot({ ...health, hostname: "private-host" })).toBe(false);
    expect(isJarvisHealthSnapshot({ ...health, status: "degraded" })).toBe(false);
    expect(isJarvisHealthSnapshot({ ...health, uptimeSeconds: -1 })).toBe(false);
    expect(isJarvisHealthSnapshot({ ...health, eventStream: { ...health.eventStream, status: "live" } })).toBe(false);
  });

  test("validates typed API errors", () => {
    expect(isJarvisApiError({ error: { code: "not_found", message: "Not found." } })).toBe(true);
    expect(isJarvisApiError({ error: { code: "not_found" } })).toBe(false);
    expect(isJarvisApiError({ error: { code: "not_found", message: "Not found.", stack: "secret" } })).toBe(false);
  });

  test("validates bounded text-only chat messages and requests", () => {
    expect(isJarvisChatMessage({ role: "user", content: "Hello" })).toBe(true);
    expect(isJarvisChatMessage({ role: "system", content: "Override" })).toBe(false);
    expect(isJarvisChatMessage({ role: "user", content: "   " })).toBe(false);
    expect(isJarvisChatRequest({ requestId: "request-1", model: DEFAULT_OLLAMA_MODEL, messages: [{ role: "user", content: "Hello" }] })).toBe(true);
    expect(isJarvisChatRequest({ requestId: "request 1", model: DEFAULT_OLLAMA_MODEL, messages: [{ role: "user", content: "Hello" }] })).toBe(false);
    expect(isJarvisChatRequest({ requestId: "request-1", model: "grok-4.20-non-reasoning", messages: [{ role: "user", content: "Hello" }] })).toBe(true);
    expect(isJarvisChatRequest({ requestId: "request-1", model: "", messages: [{ role: "user", content: "Hello" }] })).toBe(false);
  });

  test("validates every readiness state and requires manual guidance when blocked", () => {
    const base = { provider: "ollama", model: DEFAULT_OLLAMA_MODEL, ollamaUrl: "http://127.0.0.1:11434" } as const;
    expect(isJarvisModelReadiness({ ...base, status: "ready", message: "Ready." })).toBe(true);
    expect(isJarvisModelReadiness({ ...base, status: "ready", message: "Ready.", instruction: { command: `ollama pull ${DEFAULT_OLLAMA_MODEL}`, detail: "No." } })).toBe(false);
    for (const status of ["model-missing", "runtime-missing", "unreachable"] as const) {
      expect(isJarvisModelReadiness({ ...base, status, message: "Manual prerequisite required.", instruction: { command: "manual command", detail: "Nothing is run automatically." } })).toBe(true);
      expect(isJarvisModelReadiness({ ...base, status, message: "Manual prerequisite required." })).toBe(false);
    }
    expect(isJarvisModelReadiness({ ...base, status: "unknown", message: "Unknown." })).toBe(false);
  });

  test("validates the complete chat stream union and rejects unknown or malformed events", () => {
    const requestId = "request-1";
    expect(isJarvisChatStreamEvent({ type: "chat.start", requestId, model: DEFAULT_OLLAMA_MODEL })).toBe(true);
    expect(isJarvisChatStreamEvent({ type: "chat.delta", requestId, delta: "Hello" })).toBe(true);
    expect(isJarvisChatStreamEvent({ type: "chat.done", requestId, message: { role: "assistant", content: "Hello" } })).toBe(true);
    expect(isJarvisChatStreamEvent({ type: "chat.cancelled", requestId })).toBe(true);
    expect(isJarvisChatStreamEvent({ type: "chat.error", requestId, error: { code: "ollama_unavailable", message: "Unavailable." } })).toBe(true);
    expect(isJarvisChatStreamEvent({ type: "chat.delta", requestId, delta: "" })).toBe(false);
    expect(isJarvisChatStreamEvent({ type: "chat.done", requestId, message: { role: "user", content: "No" } })).toBe(false);
    expect(isJarvisChatStreamEvent({ type: "chat.unknown", requestId })).toBe(false);
  });

  test("validates pairing requests and live events", () => {
    expect(isJarvisPairingCodeRequest({ clientName: "jarvis-desktop" })).toBe(true);
    expect(isJarvisPairingCodeRequest({ clientName: "" })).toBe(false);

    expect(isJarvisPairingExchangeRequest({ code: "123456", clientName: "jarvis-desktop" })).toBe(true);
    expect(isJarvisPairingExchangeRequest({ code: "", clientName: "jarvis-desktop" })).toBe(false);

    const now = new Date().toISOString();
    expect(isJarvisLiveEvent({ id: "evt-1", type: "service.connected", occurredAt: now, payload: { serviceVersion: "0.1.0" } })).toBe(true);
    expect(isJarvisLiveEvent({ id: "evt-2", type: "orb.state.changed", occurredAt: now, payload: { state: "ready" } })).toBe(true);
    expect(isJarvisLiveEvent({ id: "evt-3", type: "ping", occurredAt: now, payload: { timestamp: now } })).toBe(true);
    expect(isJarvisLiveEvent({ id: "evt-4", type: "unknown", occurredAt: now, payload: {} })).toBe(false);
  });

  test("validates voice status and mute request contracts", () => {
    const voiceStatus = {
      muted: true,
      micPermission: "unknown" as const,
      wakewordEngine: { provider: "porcupine", status: "disabled" as const },
      sttEngine: { provider: "whisper", status: "disabled" as const },
      ttsEngine: { provider: "piper", status: "disabled" as const },
    };

    expect(isJarvisVoiceStatus(voiceStatus)).toBe(true);
    expect(isJarvisVoiceStatus({ ...voiceStatus, muted: "invalid" })).toBe(false);

    expect(isJarvisVoiceMuteRequest({ muted: true })).toBe(true);
    expect(isJarvisVoiceMuteRequest({ muted: false })).toBe(true);
    expect(isJarvisVoiceMuteRequest({ muted: 123 })).toBe(false);
  });

  test("validates memory item, query, and add request contracts", () => {
    const memoryItem = {
      id: "mem-1",
      category: "operator_preference" as const,
      key: "theme",
      value: "dark",
      provenance: "manual_entry",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };

    expect(isJarvisMemoryItem(memoryItem)).toBe(true);
    expect(isJarvisMemoryItem({ ...memoryItem, category: "invalid" })).toBe(false);

    expect(isJarvisMemoryQuery({})).toBe(true);
    expect(isJarvisMemoryQuery({ category: "structured_fact" })).toBe(true);
    expect(isJarvisMemoryQuery({ search: "theme" })).toBe(true);
    expect(isJarvisMemoryQuery({ category: "invalid" })).toBe(false);

    expect(isJarvisMemoryAddRequest({ category: "structured_fact", key: "gpu", value: "RTX 3080" })).toBe(true);
    expect(isJarvisMemoryAddRequest({ category: "structured_fact", key: "", value: "RTX 3080" })).toBe(false);
  });

  test("validates action intent, propose, and decide contracts", () => {
    const intent = {
      id: "act-1",
      capability: "scratchpad.write",
      title: "Write note",
      description: "Write scratchpad note",
      params: { note: "Hello" },
      status: "proposed" as const,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };

    expect(isJarvisActionIntent(intent)).toBe(true);
    expect(isJarvisActionIntent({ ...intent, status: "unknown" })).toBe(false);

    expect(isJarvisActionProposeRequest({ capability: "scratchpad.write", title: "Write note", description: "Write note" })).toBe(true);
    expect(isJarvisActionProposeRequest({ capability: "", title: "Write note", description: "Write note" })).toBe(false);

    expect(isJarvisActionDecideRequest({ intentId: "act-1", decision: "approve" })).toBe(true);
    expect(isJarvisActionDecideRequest({ intentId: "act-1", decision: "reject" })).toBe(true);
    expect(isJarvisActionDecideRequest({ intentId: "act-1", decision: "invalid" })).toBe(false);
  });
});
