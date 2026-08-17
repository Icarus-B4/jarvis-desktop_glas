import { contextBridge, ipcRenderer } from "electron";
import type {
  JarvisActionDecideRequest,
  JarvisActionIntent,
  JarvisActionProposeRequest,
  JarvisChatRequest,
  JarvisChatStreamEvent,
  JarvisLiveEvent,
  JarvisMemoryAddRequest,
  JarvisMemoryItem,
  JarvisMemoryQuery,
  JarvisModelReadiness,
  JarvisPairingCodeResponse,
  JarvisSubAgentTask,
  JarvisCollaborationResponse,
  JarvisWorkflow,
  JarvisWorkflowRunResult,
  JarvisKnowledgeItem,
  JarvisKnowledgeQuery,
  JarvisKnowledgeAddRequest,
  JarvisDiagnosticsSnapshot,
  JarvisVoiceStatus,
} from "@jarvis/shared";

export type DesktopRuntimeStatus = {
  serviceBaseUrl: string;
  health: unknown;
  startupError?: string;
};

export type JarvisFileInfo = {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes?: number;
};

export type JarvisRagChunk = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  score: number;
};

export type JarvisWebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type JarvisWebPageContent = {
  url: string;
  title: string;
  content: string;
};

export type JarvisDesktopBridge = {
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>;
  getModelReadiness(): Promise<JarvisModelReadiness>;
  getPairingCode(): Promise<JarvisPairingCodeResponse>;
  getVoiceStatus(): Promise<JarvisVoiceStatus>;
  setVoiceMute(muted: boolean): Promise<JarvisVoiceStatus>;
  getMemoryItems(query?: JarvisMemoryQuery): Promise<JarvisMemoryItem[]>;
  addMemoryItem(request: JarvisMemoryAddRequest): Promise<JarvisMemoryItem>;
  deleteMemoryItem(id: string): Promise<boolean>;
  clearMemory(): Promise<void>;
  getActions(): Promise<JarvisActionIntent[]>;
  proposeAction(request: JarvisActionProposeRequest): Promise<JarvisActionIntent>;
  decideAction(intentId: string, decision: "approve" | "reject"): Promise<JarvisActionIntent>;
  executeTerminalCommand(command: string): Promise<{ exitCode: number; output: string }>;
  captureScreenshot(): Promise<string>;
  listProjectFiles(dir?: string): Promise<JarvisFileInfo[]>;
  readFileContent(path: string): Promise<{ path: string; content: string }>;
  queryDocumentRag(query: string, limit?: number): Promise<{ query: string; chunks: JarvisRagChunk[] }>;
  fetchWebPage(url: string): Promise<JarvisWebPageContent>;
  searchWeb(query: string, limit?: number): Promise<{ query: string; results: JarvisWebSearchResult[] }>;
  getAgentTasks(): Promise<JarvisSubAgentTask[]>;
  startAgentCollaboration(goal: string): Promise<JarvisCollaborationResponse>;
  getWorkflows(): Promise<JarvisWorkflow[]>;
  runWorkflow(idOrTrigger: string): Promise<JarvisWorkflowRunResult>;
  getKnowledgeItems(query?: JarvisKnowledgeQuery): Promise<JarvisKnowledgeItem[]>;
  addKnowledgeItem(request: JarvisKnowledgeAddRequest): Promise<JarvisKnowledgeItem>;
  deleteKnowledgeItem(id: string): Promise<boolean>;
  getDiagnostics(): Promise<JarvisDiagnosticsSnapshot>;
  startChat(request: JarvisChatRequest): void;
  cancelChat(requestId: string): void;
  onChatEvent(listener: (event: JarvisChatStreamEvent) => void): () => void;
  onLiveEvent(listener: (event: JarvisLiveEvent) => void): () => void;
  onTerminalOutput(listener: (data: string) => void): () => void;
  onDictateShortcut(listener: () => void): () => void;
  writeClipboard(text: string): Promise<boolean>;
  /** xAI STT: Audiodaten transkribieren */
  transcribeAudio(payload: { audioData: number[]; mimeType: string; language?: string }): Promise<{ text: string }>;
  /** xAI TTS: Text in MP3-Audio umwandeln (als number[]-Array) */
  synthesizeSpeech(payload: { text: string; voice?: string; language?: string }): Promise<number[]>;
  getConfig(): Promise<any>;
  updateConfig(config: any): Promise<{ success: boolean; message: string }>;
  ensureOllama(): Promise<{ started: boolean; message: string }>;
};

const bridge: JarvisDesktopBridge = {
  getRuntimeStatus: (): Promise<DesktopRuntimeStatus> => ipcRenderer.invoke("jarvis:get-runtime-status"),
  getModelReadiness: (): Promise<JarvisModelReadiness> => ipcRenderer.invoke("jarvis:get-model-readiness"),
  getPairingCode: (): Promise<JarvisPairingCodeResponse> => ipcRenderer.invoke("jarvis:get-pairing-code"),
  getVoiceStatus: (): Promise<JarvisVoiceStatus> => ipcRenderer.invoke("jarvis:get-voice-status"),
  setVoiceMute: (muted: boolean): Promise<JarvisVoiceStatus> => ipcRenderer.invoke("jarvis:set-voice-mute", muted),
  getMemoryItems: (query?: JarvisMemoryQuery): Promise<JarvisMemoryItem[]> => ipcRenderer.invoke("jarvis:get-memory-items", query),
  addMemoryItem: (request: JarvisMemoryAddRequest): Promise<JarvisMemoryItem> => ipcRenderer.invoke("jarvis:add-memory-item", request),
  deleteMemoryItem: (id: string): Promise<boolean> => ipcRenderer.invoke("jarvis:delete-memory-item", id),
  clearMemory: (): Promise<void> => ipcRenderer.invoke("jarvis:clear-memory"),
  getActions: (): Promise<JarvisActionIntent[]> => ipcRenderer.invoke("jarvis:get-actions"),
  proposeAction: (request: JarvisActionProposeRequest): Promise<JarvisActionIntent> => ipcRenderer.invoke("jarvis:propose-action", request),
  decideAction: (intentId: string, decision: "approve" | "reject"): Promise<JarvisActionIntent> => ipcRenderer.invoke("jarvis:decide-action", { intentId, decision }),
  executeTerminalCommand: (command: string): Promise<{ exitCode: number; output: string }> => ipcRenderer.invoke("jarvis:execute-command", command),
  captureScreenshot: (): Promise<string> => ipcRenderer.invoke("jarvis:capture-screenshot"),
  listProjectFiles: (dir?: string): Promise<JarvisFileInfo[]> => ipcRenderer.invoke("jarvis:list-files", dir),
  readFileContent: (path: string): Promise<{ path: string; content: string }> => ipcRenderer.invoke("jarvis:read-file", path),
  queryDocumentRag: (query: string, limit?: number): Promise<{ query: string; chunks: JarvisRagChunk[] }> => ipcRenderer.invoke("jarvis:query-rag", { query, limit }),
  fetchWebPage: (url: string): Promise<JarvisWebPageContent> => ipcRenderer.invoke("jarvis:fetch-web-page", url),
  searchWeb: (query: string, limit?: number): Promise<{ query: string; results: JarvisWebSearchResult[] }> => ipcRenderer.invoke("jarvis:search-web", { query, limit }),
  getAgentTasks: (): Promise<JarvisSubAgentTask[]> => ipcRenderer.invoke("jarvis:get-agent-tasks"),
  startAgentCollaboration: (goal: string): Promise<JarvisCollaborationResponse> => ipcRenderer.invoke("jarvis:start-agent-collaboration", goal),
  getWorkflows: (): Promise<JarvisWorkflow[]> => ipcRenderer.invoke("jarvis:get-workflows"),
  runWorkflow: (idOrTrigger: string): Promise<JarvisWorkflowRunResult> => ipcRenderer.invoke("jarvis:run-workflow", idOrTrigger),
  getKnowledgeItems: (query?: JarvisKnowledgeQuery): Promise<JarvisKnowledgeItem[]> => ipcRenderer.invoke("jarvis:get-knowledge", query),
  addKnowledgeItem: (request: JarvisKnowledgeAddRequest): Promise<JarvisKnowledgeItem> => ipcRenderer.invoke("jarvis:add-knowledge", request),
  deleteKnowledgeItem: (id: string): Promise<boolean> => ipcRenderer.invoke("jarvis:delete-knowledge", id),
  getDiagnostics: (): Promise<JarvisDiagnosticsSnapshot> => ipcRenderer.invoke("jarvis:get-diagnostics"),
  startChat: (request: JarvisChatRequest): void => ipcRenderer.send("jarvis:chat-start", request),
  cancelChat: (requestId: string): void => ipcRenderer.send("jarvis:chat-cancel", requestId),
  onChatEvent(listener: (event: JarvisChatStreamEvent) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: JarvisChatStreamEvent): void => listener(payload);
    ipcRenderer.on("jarvis:chat-event", wrapped);
    return () => ipcRenderer.removeListener("jarvis:chat-event", wrapped);
  },
  onLiveEvent(listener: (event: JarvisLiveEvent) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: JarvisLiveEvent): void => listener(payload);
    ipcRenderer.on("jarvis:live-event", wrapped);
    return () => ipcRenderer.removeListener("jarvis:live-event", wrapped);
  },
  onTerminalOutput(listener: (data: string) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, data: string): void => listener(data);
    ipcRenderer.on("jarvis:terminal-output", wrapped);
    return () => ipcRenderer.removeListener("jarvis:terminal-output", wrapped);
  },
  onDictateShortcut(listener: () => void): () => void {
    const wrapped = (): void => listener();
    ipcRenderer.on("jarvis:dictate-shortcut", wrapped);
    return () => ipcRenderer.removeListener("jarvis:dictate-shortcut", wrapped);
  },
  writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke("jarvis:write-clipboard", text),
  transcribeAudio: (payload: { audioData: number[]; mimeType: string; language?: string }): Promise<{ text: string }> =>
    ipcRenderer.invoke("jarvis:transcribe-audio", payload),
  synthesizeSpeech: (payload: { text: string; voice?: string; language?: string }): Promise<number[]> =>
    ipcRenderer.invoke("jarvis:synthesize-speech", payload),
  getConfig: (): Promise<any> => ipcRenderer.invoke("jarvis:get-config"),
  updateConfig: (config: any): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke("jarvis:update-config", config),
  ensureOllama: (): Promise<{ started: boolean; message: string }> => ipcRenderer.invoke("jarvis:ensure-ollama"),
};

contextBridge.exposeInMainWorld("jarvisDesktop", bridge);
