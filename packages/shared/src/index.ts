export const jarvisOrbStates = [
  "idle",
  "ready",
  "listening",
  "thinking",
  "responding",
  "executing-approved",
  "error",
  "disconnected",
] as const;

export type JarvisOrbState = (typeof jarvisOrbStates)[number];

export type PurchaseStatus = "active" | "pending" | "expired";

export type DashboardPurchase = {
  id: string;
  title: string;
  description: string;
  status: PurchaseStatus;
  updatedAt: string;
};

export type DashboardSnapshot = {
  profile: {
    displayName: string;
    email: string;
  };
  purchases: DashboardPurchase[];
};

export type JarvisHealthSnapshot = {
  status: "ok";
  service: "jarvis-local-service";
  version: string;
  timestamp: string;
  startedAt: string;
  uptimeSeconds: number;
  orbState: "ready";
  eventStream: {
    transport: "sse" | "websocket";
    status: "active" | "stubbed";
    path: "/v1/events";
  };
};

export type JarvisApiError = {
  error: {
    code: string;
    message: string;
  };
};

export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b" as const;
export const jarvisChatRoles = ["user", "assistant"] as const;
export const jarvisModelReadinessStatuses = ["ready", "model-missing", "runtime-missing", "unreachable"] as const;
export type JarvisChatRole = (typeof jarvisChatRoles)[number];
export type JarvisModelReadinessStatus = (typeof jarvisModelReadinessStatuses)[number];
export type JarvisChatMessage = { role: JarvisChatRole; content: string; imageData?: string };
export type JarvisChatRequest = { requestId: string; model: string; messages: JarvisChatMessage[] };
export type JarvisModelReadiness = {
  status: JarvisModelReadinessStatus;
  provider: "ollama";
  model: string;
  ollamaUrl: string;
  message: string;
  instruction?: { command: string; detail: string };
};
export type JarvisChatStreamEvent =
  | { type: "chat.start"; requestId: string; model: string }
  | { type: "chat.delta"; requestId: string; delta: string }
  | { type: "chat.done"; requestId: string; message: JarvisChatMessage }
  | { type: "chat.cancelled"; requestId: string }
  | { type: "chat.error"; requestId: string; error: JarvisApiError["error"] };

export type JarvisPairingCodeRequest = { clientName: string };
export type JarvisPairingCodeResponse = { code: string; expiresAt?: string };
export type JarvisPairingExchangeRequest = { code: string; clientName: string };
export type JarvisPairingExchangeResponse = { token: string; expiresAt?: string };

export const jarvisAgentRoles = ["planner", "researcher", "coder", "reviewer"] as const;
export type JarvisAgentRole = (typeof jarvisAgentRoles)[number];
export type JarvisAgentTaskStatus = "pending" | "running" | "completed" | "failed";

export type JarvisSubAgentTask = {
  id: string;
  role: JarvisAgentRole;
  goal: string;
  status: JarvisAgentTaskStatus;
  output?: string;
  error?: string;
  updatedAt: string;
};

export type JarvisCollaborationRequest = {
  goal: string;
};

export type JarvisCollaborationResponse = {
  id: string;
  goal: string;
  tasks: JarvisSubAgentTask[];
  summary: string;
};

export type JarvisWorkflowStepType = "speak" | "open_url" | "open_app" | "execute_command" | "system_check";

export type JarvisWorkflowStep = {
  id: string;
  type: JarvisWorkflowStepType;
  description: string;
  params?: Record<string, unknown>;
};

export type JarvisWorkflow = {
  id: string;
  name: string;
  triggerPhrases: string[];
  description: string;
  steps: JarvisWorkflowStep[];
};

export type JarvisWorkflowRunResult = {
  workflowId: string;
  success: boolean;
  executedSteps: number;
  logs: string[];
  summary: string;
};

export type JarvisKnowledgeCategory = "code" | "architecture" | "guide" | "snippet" | "general";

export type JarvisKnowledgeItem = {
  id: string;
  title: string;
  category: JarvisKnowledgeCategory;
  tags: string[];
  content: string;
  updatedAt: string;
};

export type JarvisKnowledgeQuery = {
  query?: string;
  category?: JarvisKnowledgeCategory;
};

export type JarvisKnowledgeAddRequest = {
  title: string;
  category: JarvisKnowledgeCategory;
  tags: string[];
  content: string;
};

export type JarvisDiagnosticsSnapshot = {
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
  latency: {
    localServiceMs: number;
    xaiApiMs: number;
  };
  providers: {
    xaiStatus: "online" | "offline" | "not_configured";
    ollamaStatus: "ready" | "model-missing" | "runtime-missing" | "unreachable";
  };
  stats: {
    memoriesCount: number;
    knowledgeCount: number;
    workflowsCount: number;
    activeSubAgents: number;
  };
};

export type JarvisVoiceEngineStatus = {
  provider: string;
  status: "ready" | "disabled" | "unavailable";
};

export type JarvisVoiceStatus = {
  muted: boolean;
  micPermission: "granted" | "denied" | "prompt" | "unknown";
  wakewordEngine: JarvisVoiceEngineStatus;
  sttEngine: JarvisVoiceEngineStatus;
  ttsEngine: JarvisVoiceEngineStatus;
};

export type JarvisVoiceMuteRequest = {
  muted: boolean;
};

export const jarvisMemoryCategories = [
  "operator_preference",
  "structured_fact",
  "semantic_document",
] as const;

export type JarvisMemoryCategory = (typeof jarvisMemoryCategories)[number];

export type JarvisMemoryItem = {
  id: string;
  category: JarvisMemoryCategory;
  key: string;
  value: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
};

export type JarvisMemoryQuery = {
  category?: JarvisMemoryCategory;
  search?: string;
};

export type JarvisMemoryAddRequest = {
  category: JarvisMemoryCategory;
  key: string;
  value: string;
  provenance?: string;
};

export const jarvisActionStatuses = [
  "proposed",
  "approved",
  "rejected",
  "executing",
  "completed",
  "failed",
] as const;

export type JarvisActionStatus = (typeof jarvisActionStatuses)[number];

export type JarvisActionIntent = {
  id: string;
  capability: string;
  title: string;
  description: string;
  params: Record<string, unknown>;
  status: JarvisActionStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type JarvisActionProposeRequest = {
  capability: string;
  title: string;
  description: string;
  params?: Record<string, unknown>;
};

export type JarvisActionDecideRequest = {
  intentId: string;
  decision: "approve" | "reject";
};

export type JarvisLiveEventEnvelope<
  TType extends string,
  TPayload,
> = {
  id: string;
  type: TType;
  occurredAt: string;
  payload: TPayload;
};

export type JarvisLiveEvent =
  | JarvisLiveEventEnvelope<
      "service.connected",
      { serviceVersion: string }
    >
  | JarvisLiveEventEnvelope<
      "orb.state.changed",
      { state: JarvisOrbState }
    >
  | JarvisLiveEventEnvelope<
      "diagnostics.updated",
      any
    >
  | JarvisLiveEventEnvelope<
      "dashboard.snapshot",
      { snapshot: DashboardSnapshot }
    >
  | JarvisLiveEventEnvelope<
      "service.error",
      { error: JarvisApiError }
    >
  | JarvisLiveEventEnvelope<
      "voice.status.changed",
      { voiceStatus: JarvisVoiceStatus }
    >
  | JarvisLiveEventEnvelope<
      "memory.changed",
      { items: JarvisMemoryItem[] }
    >
  | JarvisLiveEventEnvelope<
      "action.intent.proposed",
      { intent: JarvisActionIntent }
    >
  | JarvisLiveEventEnvelope<
      "action.intent.updated",
      { intent: JarvisActionIntent }
    >
  | JarvisLiveEventEnvelope<
      "ping",
      { timestamp: string }
    >;

const purchaseStatuses: ReadonlySet<PurchaseStatus> = new Set([
  "active",
  "pending",
  "expired",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maximumLength;
}

function isChatRole(value: unknown): value is JarvisChatRole {
  return typeof value === "string" && (value === "user" || value === "assistant");
}

export function isJarvisChatMessage(value: unknown): value is JarvisChatMessage {
  if (!isRecord(value) || !isChatRole(value.role) || !isNonEmptyString(value.content) || value.content.length > 500_000) return false;
  if (!hasOnlyKeys(value, ["role", "content"]) && !hasOnlyKeys(value, ["role", "content", "imageData"])) return false;
  if (value.imageData !== undefined && (typeof value.imageData !== "string" || value.imageData.length > 10_000_000)) return false;
  return true;
}

export function isJarvisChatRequest(value: unknown): value is JarvisChatRequest {
  return isRecord(value) && hasOnlyKeys(value, ["requestId", "model", "messages"])
    && isBoundedString(value.requestId, 128) && /^[A-Za-z0-9._:-]+$/.test(value.requestId)
    && value.model === DEFAULT_OLLAMA_MODEL && Array.isArray(value.messages)
    && value.messages.length > 0 && value.messages.length <= 100
    && value.messages.every(isJarvisChatMessage);
}

export function isJarvisModelReadiness(value: unknown): value is JarvisModelReadiness {
  if (!isRecord(value) || (!hasOnlyKeys(value, ["status", "provider", "model", "ollamaUrl", "message"])
    && !hasOnlyKeys(value, ["status", "provider", "model", "ollamaUrl", "message", "instruction"]))) return false;
  if (!isBoundedString(value.message, 320) || value.provider !== "ollama"
    || value.model !== DEFAULT_OLLAMA_MODEL || !isBoundedString(value.ollamaUrl, 256)
    || !jarvisModelReadinessStatuses.includes(value.status as JarvisModelReadinessStatus)) return false;
  if (value.status === "ready") return value.instruction === undefined;
  return isRecord(value.instruction) && hasOnlyKeys(value.instruction, ["command", "detail"])
    && isBoundedString(value.instruction.command, 256) && isBoundedString(value.instruction.detail, 320);
}

export function isJarvisChatStreamEvent(value: unknown): value is JarvisChatStreamEvent {
  if (!isRecord(value) || !isNonEmptyString(value.type) || !isBoundedString(value.requestId, 128)) return false;
  if (value.type === "chat.start") return hasOnlyKeys(value, ["type", "requestId", "model"]) && isBoundedString(value.model, 128);
  if (value.type === "chat.delta") return hasOnlyKeys(value, ["type", "requestId", "delta"]) && typeof value.delta === "string" && value.delta.length > 0 && value.delta.length <= 32_000;
  if (value.type === "chat.done") return hasOnlyKeys(value, ["type", "requestId", "message"]) && isJarvisChatMessage(value.message) && value.message.role === "assistant";
  if (value.type === "chat.cancelled") return hasOnlyKeys(value, ["type", "requestId"]);
  return value.type === "chat.error" && hasOnlyKeys(value, ["type", "requestId", "error"])
    && isRecord(value.error) && hasOnlyKeys(value.error, ["code", "message"])
    && isBoundedString(value.error.code, 64) && /^[a-z0-9_]+$/.test(value.error.code)
    && isBoundedString(value.error.message, 320);
}

function isPurchaseStatus(value: unknown): value is PurchaseStatus {
  return typeof value === "string" && purchaseStatuses.has(value as PurchaseStatus);
}

function isDashboardPurchase(value: unknown): value is DashboardPurchase {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "title", "description", "status", "updatedAt"])) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    isPurchaseStatus(value.status) &&
    isNonEmptyString(value.updatedAt)
  );
}

export function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, ["profile", "purchases"])) {
    return false;
  }

  const { profile, purchases } = value;
  return (
    isRecord(profile) &&
    hasOnlyKeys(profile, ["displayName", "email"]) &&
    isNonEmptyString(profile.displayName) &&
    isNonEmptyString(profile.email) &&
    Array.isArray(purchases) &&
    purchases.every(isDashboardPurchase)
  );
}

export function isJarvisHealthSnapshot(value: unknown): value is JarvisHealthSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "status",
      "service",
      "version",
      "timestamp",
      "startedAt",
      "uptimeSeconds",
      "orbState",
      "eventStream",
    ])
  ) {
    return false;
  }

  return (
    value.status === "ok" &&
    value.service === "jarvis-local-service" &&
    isNonEmptyString(value.version) &&
    isNonEmptyString(value.timestamp) &&
    isNonEmptyString(value.startedAt) &&
    typeof value.uptimeSeconds === "number" &&
    Number.isFinite(value.uptimeSeconds) &&
    value.uptimeSeconds >= 0 &&
    value.orbState === "ready" &&
    isRecord(value.eventStream) &&
    hasOnlyKeys(value.eventStream, ["transport", "status", "path"]) &&
    (value.eventStream.transport === "sse" || value.eventStream.transport === "websocket") &&
    (value.eventStream.status === "active" || value.eventStream.status === "stubbed") &&
    value.eventStream.path === "/v1/events"
  );
}

export function isJarvisApiError(value: unknown): value is JarvisApiError {
  if (!isRecord(value) || !hasOnlyKeys(value, ["error"]) || !isRecord(value.error)) {
    return false;
  }

  return (
    hasOnlyKeys(value.error, ["code", "message"]) &&
    isNonEmptyString(value.error.code) &&
    isNonEmptyString(value.error.message)
  );
}

export function isJarvisPairingCodeRequest(value: unknown): value is JarvisPairingCodeRequest {
  return isRecord(value) && hasOnlyKeys(value, ["clientName"]) && isBoundedString(value.clientName, 64);
}

export function isJarvisPairingExchangeRequest(value: unknown): value is JarvisPairingExchangeRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["code", "clientName"]) &&
    isBoundedString(value.code, 16) &&
    isBoundedString(value.clientName, 64)
  );
}

export function isJarvisLiveEvent(value: unknown): value is JarvisLiveEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "type", "occurredAt", "payload"])) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.type) || !isNonEmptyString(value.occurredAt) || !isRecord(value.payload)) return false;

  if (value.type === "service.connected") {
    return isNonEmptyString(value.payload.serviceVersion);
  }
  if (value.type === "orb.state.changed") {
    return typeof value.payload.state === "string" && jarvisOrbStates.includes(value.payload.state as JarvisOrbState);
  }
  if (value.type === "dashboard.snapshot") {
    return isDashboardSnapshot(value.payload.snapshot);
  }
  if (value.type === "service.error") {
    return isJarvisApiError(value.payload.error);
  }
  if (value.type === "voice.status.changed") {
    return isJarvisVoiceStatus(value.payload.voiceStatus);
  }
  if (value.type === "memory.changed") {
    return Array.isArray(value.payload.items) && value.payload.items.every(isJarvisMemoryItem);
  }
  if (value.type === "action.intent.proposed" || value.type === "action.intent.updated") {
    return isJarvisActionIntent(value.payload.intent);
  }
  if (value.type === "ping") {
    return isNonEmptyString(value.payload.timestamp);
  }

  return false;
}

export function isJarvisVoiceStatus(value: unknown): value is JarvisVoiceStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, ["muted", "micPermission", "wakewordEngine", "sttEngine", "ttsEngine"])) {
    return false;
  }
  if (typeof value.muted !== "boolean") return false;
  if (!["granted", "denied", "prompt", "unknown"].includes(value.micPermission as string)) return false;

  const validEngine = (eng: unknown): boolean =>
    isRecord(eng) &&
    hasOnlyKeys(eng, ["provider", "status"]) &&
    isNonEmptyString(eng.provider) &&
    ["ready", "disabled", "unavailable"].includes(eng.status as string);

  return validEngine(value.wakewordEngine) && validEngine(value.sttEngine) && validEngine(value.ttsEngine);
}

export function isJarvisVoiceMuteRequest(value: unknown): value is JarvisVoiceMuteRequest {
  return isRecord(value) && hasOnlyKeys(value, ["muted"]) && typeof value.muted === "boolean";
}

export function isJarvisMemoryItem(value: unknown): value is JarvisMemoryItem {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "category", "key", "value", "provenance", "createdAt", "updatedAt"])) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.category === "string" &&
    jarvisMemoryCategories.includes(value.category as JarvisMemoryCategory) &&
    isNonEmptyString(value.key) &&
    typeof value.value === "string" &&
    typeof value.provenance === "string" &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

export function isJarvisMemoryQuery(value: unknown): value is JarvisMemoryQuery {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((k) => ["category", "search"].includes(k))) return false;
  if (value.category !== undefined && (typeof value.category !== "string" || !jarvisMemoryCategories.includes(value.category as JarvisMemoryCategory))) return false;
  if (value.search !== undefined && typeof value.search !== "string") return false;
  return true;
}

export function isJarvisMemoryAddRequest(value: unknown): value is JarvisMemoryAddRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((k) => ["category", "key", "value", "provenance"].includes(k))) return false;
  if (!keys.includes("category") || !keys.includes("key") || !keys.includes("value")) return false;
  if (typeof value.category !== "string" || !jarvisMemoryCategories.includes(value.category as JarvisMemoryCategory)) return false;
  if (!isNonEmptyString(value.key) || typeof value.value !== "string") return false;
  if (value.provenance !== undefined && typeof value.provenance !== "string") return false;
  return true;
}

export function isJarvisActionIntent(value: unknown): value is JarvisActionIntent {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((k) => ["id", "capability", "title", "description", "params", "status", "result", "error", "createdAt", "updatedAt"].includes(k))) return false;
  if (!keys.includes("id") || !keys.includes("capability") || !keys.includes("title") || !keys.includes("description") || !keys.includes("params") || !keys.includes("status")) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.capability) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    isRecord(value.params) &&
    typeof value.status === "string" &&
    jarvisActionStatuses.includes(value.status as JarvisActionStatus) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

export function isJarvisActionProposeRequest(value: unknown): value is JarvisActionProposeRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((k) => ["capability", "title", "description", "params"].includes(k))) return false;
  if (!keys.includes("capability") || !keys.includes("title") || !keys.includes("description")) return false;
  if (!isNonEmptyString(value.capability) || !isNonEmptyString(value.title) || typeof value.description !== "string") return false;
  if (value.params !== undefined && !isRecord(value.params)) return false;
  return true;
}

export function isJarvisActionDecideRequest(value: unknown): value is JarvisActionDecideRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["intentId", "decision"])) return false;
  return isNonEmptyString(value.intentId) && ["approve", "reject"].includes(value.decision as string);
}

export type JarvisConfig = {
  xaiApiKey?: string;
  tavilyApiKey?: string;
  ollamaUrl?: string;
  autoApproveActions: boolean;
  ttsVoice: string;
  sttLanguage: string;
  enabledModules: {
    memory: boolean;
    files: boolean;
    browser: boolean;
    agents: boolean;
    workflows: boolean;
    knowledge: boolean;
    diagnostics: boolean;
    barehands: boolean;
  };
};

export function isJarvisConfig(value: unknown): value is JarvisConfig {
  if (!isRecord(value)) return false;
  if (typeof value.autoApproveActions !== "boolean" || typeof value.ttsVoice !== "string" || typeof value.sttLanguage !== "string") return false;
  if (!isRecord(value.enabledModules)) return false;
  return (
    typeof value.enabledModules.memory === "boolean" &&
    typeof value.enabledModules.files === "boolean" &&
    typeof value.enabledModules.browser === "boolean" &&
    typeof value.enabledModules.agents === "boolean" &&
    typeof value.enabledModules.workflows === "boolean" &&
    typeof value.enabledModules.knowledge === "boolean" &&
    typeof value.enabledModules.diagnostics === "boolean" &&
    typeof value.enabledModules.barehands === "boolean"
  );
}
