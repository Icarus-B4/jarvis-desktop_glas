import { createRoot } from "react-dom/client";
import {
  DEFAULT_OLLAMA_MODEL,
  isJarvisHealthSnapshot,
  jarvisOrbStates,
  type JarvisActionIntent,
  type JarvisChatMessage,
  type JarvisChatStreamEvent,
  type JarvisHealthSnapshot,
  type JarvisLiveEvent,
  type JarvisMemoryCategory,
  type JarvisMemoryItem,
  type JarvisModelReadiness,
  type JarvisOrbState,
  type JarvisVoiceStatus,
} from "@jarvis/shared";
import { OrbHudRings } from "./components/OrbHudRings";
import { SafeVoiceOrb } from "./components/safe-voice-orb";
import { getDeterministicCalculation, getDeterministicConversion, getDeterministicTranslation } from "./deterministic-local-commands";

type TranscriptKind = "system" | "user" | "assistant" | "warning" | "action" | "info";
type TranscriptEntry = {
  id: number;
  at: Date;
  kind: TranscriptKind;
  message: string;
  actionIntent?: JarvisActionIntent;
  pending?: boolean;
};

const landingIdleLevels = [0.18, 0.34, 0.16, 0, 0, 0, 0, 0];
const stateLevels: Record<JarvisOrbState, number[]> = {
  idle: landingIdleLevels, ready: landingIdleLevels,
  listening: [0.58, 0.36, 0.2, 0.48, 0, 0, 0, 0],
  thinking: [0.24, 0.74, 0.4, 0.54, 0, 0, 0, 0],
  responding: [0.34, 0.52, 0.72, 0.62, 0, 0, 0, 0],
  "executing-approved": [0.68, 0.46, 0.3, 0.64, 0, 0, 0, 0],
  error: [0.84, 0.84, 0.84, 0.84, 0, 0, 0, 0], disconnected: [0, 0, 0, 0, 0, 0, 0, 0],
};
let activeModelMode: "cloud" | "local" = "cloud";

function getStateCopy(state: JarvisOrbState): { label: string; detail: string } {
  const isCloud = activeModelMode === "cloud";
  const copies: Record<JarvisOrbState, { label: string; detail: string }> = {
    idle: { label: "Idle", detail: "Core initialisiert; warte auf Service-Probe." },
    ready: {
      label: isCloud ? "Ready (Cloud)" : "Ready (Local)",
      detail: isCloud ? "Grok (xAI) ist einsatzbereit für Cloud-Chat." : "Lokales Ollama Qwen Modul ist einsatzbereit für Local-Chat."
    },
    listening: { label: "Listening", detail: "Mikrofon aktiv. Spracheingabe via STT." },
    thinking: {
      label: "Thinking",
      detail: isCloud ? "Grok (xAI) verarbeitet deine Anfrage..." : "Lokales Ollama Qwen Modul verarbeitet deine Anfrage..."
    },
    responding: {
      label: "Responding",
      detail: isCloud ? "Grok streamt eine Antwort. TTS-Ausgabe aktiv." : "Ollama streamt eine Antwort. TTS-Ausgabe aktiv."
    },
    "executing-approved": { label: "Executing / approved", detail: "Aktion genehmigt. Bounded Capability wird ausgeführt." },
    error: { label: "Error", detail: "Chat-Loop benötigt Eingriff." },
    disconnected: {
      label: "Disconnected",
      detail: isCloud ? "xAI API oder lokaler Service nicht erreichbar." : "Lokaler Ollama Service (127.0.0.1:11434) nicht erreichbar."
    },
  };
  return copies[state];
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Control Room element: ${selector}`);
  return element;
}

function optionalElement<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

const entries: TranscriptEntry[] = [];
const messages: JarvisChatMessage[] = [];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let nextId = 1;
let liveState: JarvisOrbState = "idle";
let previewState: JarvisOrbState | undefined;
let readiness: JarvisModelReadiness | undefined;
let voiceStatus: JarvisVoiceStatus | undefined;
let memoryItems: JarvisMemoryItem[] = [];
let actionIntents: JarvisActionIntent[] = [];
let activeRequestId: string | undefined;
let activeAssistantEntry: TranscriptEntry | undefined;
let chatSafetyTimer: ReturnType<typeof setTimeout> | undefined;
let feedFilter: "all" | "chat" | "system" = "all";

// Local Web Audio Seam, Speech-to-Text & Text-to-Speech Engine
let audioContext: AudioContext | undefined;
let audioAnalyser: AnalyserNode | undefined;
let audioAnimFrame: number | undefined;
let speechRecognition: any = undefined;
let isSpeechRecognitionActive = false;
let autoSendSilenceTimer: ReturnType<typeof setTimeout> | undefined;

const voiceSampleQueries = [
  "Hallo J.A.R.V.I.S., wie ist dein aktueller Status?",
  "Führe eine lokale Systemanalyse durch.",
  "Welche Erinnerungen sind im Speicher hinterlegt?",
  "Zeige mir die Readiness des lokalen Qwen Modells.",
];
let sampleIndex = 0;

let lastVoiceTranscript = "";

// MediaRecorder & VAD für xAI Whisper STT
let mediaRecorder: MediaRecorder | undefined;
let recordingChunks: Blob[] = [];
let isTtsPlaying = false;
let isExternalMediaPlaying = false;
let activeTtsContext: AudioContext | undefined;
let activeTtsSource: AudioBufferSourceNode | undefined;
let stopRequested = false;
let isPaused = false;
let lastSpokenText = "";

function stopTtsPlayback(): void {
  isTtsPlaying = false;
  if (activeTtsSource) {
    try { activeTtsSource.stop(); } catch {}
    activeTtsSource = undefined;
  }
  if (activeTtsContext) {
    try { void activeTtsContext.close(); } catch {}
    activeTtsContext = undefined;
  }
}

/** bricht laufendes TTS oder aktive KI-Generierung sofort ab */
function stopConversation(): void {
  stopRequested = true;
  isPaused = false;
  stopTtsPlayback();
  const reqId = activeRequestId;
  clearChatState();
  if (reqId) {
    window.jarvisDesktop.cancelChat(reqId);
  }
  // Sofort auch Medienwiedergabe (YouTube, Spotify, etc.) stoppen
  try {
    void window.jarvisDesktop.proposeAction({
      capability: "media.control",
      title: "Medien stoppen",
      description: "Stoppt jede laufende Medienwiedergabe",
      params: { action: "stop" },
    });
  } catch {}
  if (voiceStatus && !voiceStatus.muted) {
    setLiveState("listening");
  } else {
    setLiveState(readiness?.status === "ready" ? "ready" : "idle");
  }
  setTimeout(() => { stopRequested = false; }, 500);
}

/**
 * Pausiert die TTS-Ausgabe: stoppt die laufende AudioBufferSourceNode sofort
 * (Web Audio hat kein echtes Pause) und merkt den zuletzt gesprochenen Text,
 * damit "weiter"/"resume" ihn erneut synthetisieren kann.
 */
function pauseConversation(): void {
  stopRequested = true;
  isPaused = true;
  stopTtsPlayback();
  const reqId = activeRequestId;
  clearChatState();
  if (reqId) {
    try { window.jarvisDesktop.cancelChat(reqId); } catch {}
  }
  if (voiceStatus && !voiceStatus.muted) {
    setLiveState("listening");
  } else {
    setLiveState(readiness?.status === "ready" ? "ready" : "idle");
  }
  setTimeout(() => { stopRequested = false; }, 500);
}

/** Setzt nach einer Pause die Ausgabe mit dem zuletzt gesprochenen Text fort. */
function resumeConversation(): void {
  if (!isPaused) return;
  isPaused = false;
  stopRequested = false;
  if (lastSpokenText) {
    void speakJarvisResponse(lastSpokenText);
  }
}

/**
 * Startet den Audio-Seam:
 * 1. Web Audio API für VAD (Voice Activity Detection)
 * 2. MediaRecorder → xAI Whisper STT
 */
function startLocalAudioSeam(stream: MediaStream): void {
  try {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    recordingChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };

function isNoiseOrHallucination(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[.,!?:;]/g, "");
  if (!t || t.length < 2) return true;
  const hallucinations = [
    "vielen dank",
    "danke",
    "vielen dank fürs zuschauen",
    "untertitel",
    "untertitelung",
    "amaraorg",
    "amara",
    "bye",
    "tschüss",
    "ja",
    "so",
    "oh",
    "ah",
  ];
  return hallucinations.includes(t);
}

// Detects explicit user commands that must always reach the assistant, even
// while external media (Spotify PWA) is playing. Used to keep the mic live
// during playback instead of hard-blocking everything.
function looksLikeCommand(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  if (t.includes("jarvis")) return true;
  if (/^(?:öffne|oeffne|open|starte|spiele|spiel|zeige|zeig|suche|schließe|schliesse|close|stoppe|stopp|pause|halte|halt|weiter|lauter|leiser|lautstärke|lautstaerke|mache|mach|sage|sag|wie|was|wer|wo)\b/.test(t)) return true;
  return false;
}

// Heuristic for song lyrics / background music chatter that should be dropped
// during external media playback (not real commands). Looks for typical lyric
// filler words and repetitive short phrases rather than command vocabulary.
function looksLikeLyrics(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t || t.length < 2) return false;
  // A recognized command is never lyrics.
  if (looksLikeCommand(t)) return false;
  const lyricWords = [
    "one more", "oh oh", "oh oh oh", "na na", "la la", "yeah", "yea", "yuh",
    "uh huh", "mmm", "woo", "hey hey", "doo doo", "sha la", "bom bom",
    "dont", "don't", "fuck", "shit", "ass", "baby", "girl", "boy", "love",
    "heart", "night", "tonight", "dance", "groove", "rhythm", "beat", "flow",
    "mic", "microphone", "spotlight", "stage", "crowd", "hands up", "put your",
    "get down", "turn up", "light it", "fire", "higher", " louder", "wow",
    "howd", "how'd", "like me", "with me", "for me", "on me", "in the", "all night",
  ];
  const words = t.split(/\s+/);
  let hits = 0;
  for (const w of lyricWords) {
    if (t.includes(w)) hits++;
  }
  // Very short filler or several lyric markers => lyrics.
  if (words.length <= 3 && hits >= 1) return true;
  if (hits >= 2) return true;
  // Long run-on without any command keyword and lots of short words is
  // typically sung/background chatter.
  if (words.length >= 8 && hits >= 1) return true;
  return false;
}

    // Wenn Aufnahme gestoppt → an xAI Whisper senden und SOFORT absenden
    mediaRecorder.onstop = async () => {
      if (recordingChunks.length === 0) return;
      const blob = new Blob(recordingChunks, { type: mimeType });
      recordingChunks = [];

      const arrayBuffer = await blob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      try {
        setLiveState("thinking");
        const result = await window.jarvisDesktop.transcribeAudio({
          audioData,
          mimeType,
          language: "de",
        });
        const text = result.text.trim();
        if (text && !isNoiseOrHallucination(text)) {
          const lower = text.toLowerCase().replace(/[.!?+]+$/,"").trim();
          // "with no hands" / Varianten aktiviert den systemweiten Cursor-Modus
          if (
            lower === "with no hands" ||
            lower === "no hands" ||
            lower === "cursor mode" ||
            lower === "mouse mode" ||
            lower === "hands mode" ||
            lower.includes("no hands") ||
            lower.includes("cursor mode") ||
            lower.includes("mouse mode")
          ) {
            if (stageBarehandsViewEl && stageBarehandsViewEl.hidden) {
              try { await window.jarvisDesktop.ensureBarehands(); } catch {}
              setStageView("barehands");
            }
            sendToBarehands("jarvis:cursor-mode", { on: true });
            return;
          }
          if (
            lower === "hands off" ||
            lower === "back to normal" ||
            lower === "disable cursor" ||
            lower === "hands off" ||
            lower.includes("hands off") ||
            lower.includes("back to normal") ||
            lower.includes("disable cursor") ||
            lower.includes("turn off cursor")
          ) {
            sendToBarehands("jarvis:cursor-mode", { on: false });
            return;
          }
          // "stop", "stopp", "abbrechen", "halt", "ruhe" = SOFORT ABBRECHEN (Stop)
          if (
            lower === "stop" ||
            lower === "stopp" ||
            lower === "abbrechen" ||
            lower === "halt" ||
            lower === "ruhe" ||
            lower.includes("jarvis stop") ||
            lower.includes("jarvis stopp")
          ) {
            // Ed may be stopping external media (Spotify PWA) by voice — drop
            // the gate immediately so the stop command is honored even if the
            // playback-completion event has not arrived yet.
            isExternalMediaPlaying = false;
            stopConversation();
            return;
          }
          // "pause" = TTS pausieren (nicht komplett abbrechen)
          if (lower === "pause") {
            isExternalMediaPlaying = false;
            pauseConversation();
            return;
          }
          // "weiter"/"resume"/"fortsetzen" = nach einer Pause die Ausgabe fortsetzen
          if (
            isPaused &&
            (lower === "weiter" || lower === "resume" || lower === "fortsetzen" || lower.includes("weiter machen"))
          ) {
            isExternalMediaPlaying = false;
            resumeConversation();
            return;
          }

          // Wenn KI bereits antwortet oder denkt: Hintergrund-Geräusche /
          // Tastaturklicks nicht als Abbruch werten. Wakeword-/Stopp-Kommandos
          // wurden oben bereits vor diesem Gate ausgewertet.
          // NOTE: external media playback (isExternalMediaPlaying) is NOT a
          // hard block here — that would make Ed unable to issue any command
          // while music plays. Instead, lyrics are filtered softly below.
          if (activeRequestId !== undefined || isTtsPlaying) {
            if (voiceStatus && !voiceStatus.muted) {
              setLiveState(isTtsPlaying ? "responding" : "thinking");
            }
            return;
          }

          // Soft gate while external media (Spotify PWA) plays: drop spoken
          // song lyrics / background chatter, but let real commands through
          // so Ed can keep controlling Jarvis hands-free during playback.
          if (isExternalMediaPlaying && !looksLikeCommand(text) && looksLikeLyrics(text)) {
            if (voiceStatus && !voiceStatus.muted) {
              setLiveState("listening");
            }
            return;
          }

          // Spracheingabe DIREKT an Jarvis senden (ohne ins Textfeld zu kopieren)
          submitCurrentMessage(text);
        } else {
          if (voiceStatus && !voiceStatus.muted) {
            setLiveState(isTtsPlaying ? "responding" : activeRequestId ? "thinking" : "listening");
          } else {
            setLiveState(readiness?.status === "ready" ? "ready" : "idle");
          }
        }
      } catch (err) {
        addEntry("warning", `STT-Fehler: ${err instanceof Error ? err.message : String(err)}`);
        if (voiceStatus && !voiceStatus.muted) setLiveState("listening");
        else setLiveState(readiness?.status === "ready" ? "ready" : "idle");
      }
    };
  } catch (err) {
    console.warn("MediaRecorder nicht verfügbar:", err);
  }

  // Web Audio VAD: Lautstärke-Analyse zur Spracherkennung (Full-Duplex für Instant Stop)
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 64;
    source.connect(audioAnalyser);

    const buffer = new Uint8Array(audioAnalyser.frequencyBinCount);
    let isSpeaking = false;
    let silenceFrames = 0;
    let maxRecordingTimer: ReturnType<typeof setTimeout> | undefined;
    const SPEECH_THRESHOLD = 22;   // Realistischer Pegel (Sprechen = 40-120, Raumgeräusch = 5-15)
    const SILENCE_FRAMES_MAX = 16; // ~500ms Stille nach dem Sprechen

    const checkAudio = () => {
      if (!audioAnalyser) return;
      audioAnalyser.getByteFrequencyData(buffer);
      const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;

      // Sprache erkennen
      if (avg > SPEECH_THRESHOLD && voiceStatus && !voiceStatus.muted) {
        if (!isTtsPlaying && activeRequestId === undefined) setLiveState("listening");
        if (!isSpeaking) {
          isSpeaking = true;
          silenceFrames = 0;
          if (mediaRecorder && mediaRecorder.state === "inactive") {
            recordingChunks = [];
            mediaRecorder.start();

            // Sicherheits-Timer: Nach maximal 7s automatisch stoppen & absenden
            if (maxRecordingTimer) clearTimeout(maxRecordingTimer);
            maxRecordingTimer = setTimeout(() => {
              if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
              }
            }, 7000);
          }
        }
        silenceFrames = 0;
      } else if (isSpeaking) {
        silenceFrames++;
        if (silenceFrames >= SILENCE_FRAMES_MAX) {
          isSpeaking = false;
          silenceFrames = 0;
          if (maxRecordingTimer) {
            clearTimeout(maxRecordingTimer);
            maxRecordingTimer = undefined;
          }
          if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
          }
        }
      }

      audioAnimFrame = requestAnimationFrame(checkAudio);
    };
    checkAudio();
  } catch (err) {
    console.warn("Web Audio VAD fehlgeschlagen:", err);
  }
}

function stopLocalAudioSeam(): void {
  if (autoSendSilenceTimer) clearTimeout(autoSendSilenceTimer);
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch {}
  }
  mediaRecorder = undefined;
  recordingChunks = [];
  if (audioAnimFrame) cancelAnimationFrame(audioAnimFrame);
  if (audioContext) {
    void audioContext.close();
    audioContext = undefined;
  }
  audioAnalyser = undefined;
}

/**
 * TTS: Antworttext via xAI in Sprache umwandeln und abspielen.
 */
async function speakJarvisResponse(text: string): Promise<void> {
  stopTtsPlayback();

  const cleanText = text
    .replace(/```[\s\S]*?```/g, " Code-Block. ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " Link. ")
    .replace(/[*_~>#|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();

  if (!cleanText || cleanText.length < 3) return;

  const ttsText = cleanText.length > 600 ? cleanText.slice(0, 600) + "..." : cleanText;
  lastSpokenText = ttsText;

  try {
    isTtsPlaying = true;
    stopRequested = false;
    setLiveState("responding");

    const audioBytes = await window.jarvisDesktop.synthesizeSpeech({
      text: ttsText,
      voice: "zenith",
      language: "de",
    });

    if (!audioBytes || audioBytes.length === 0 || !isTtsPlaying || stopRequested) {
      stopTtsPlayback();
      if (voiceStatus && !voiceStatus.muted) setLiveState("listening");
      else if (readiness?.status === "ready") setLiveState("ready");
      return;
    }

    const u8 = new Uint8Array(audioBytes);
    activeTtsContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await activeTtsContext.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);
    activeTtsSource = activeTtsContext.createBufferSource();
    activeTtsSource.buffer = audioBuffer;
    activeTtsSource.connect(activeTtsContext.destination);
    activeTtsSource.onended = () => {
      isTtsPlaying = false;
      activeTtsSource = undefined;
      if (!stopRequested && readiness?.status === "ready" && activeRequestId === undefined) {
        setLiveState(voiceStatus && !voiceStatus.muted ? "listening" : "ready");
      }
    };
    activeTtsSource.start();
  } catch (err) {
    stopTtsPlayback();
    if (!stopRequested) {
      addEntry("warning", `TTS-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const documentRoot = document.documentElement;
const orbStateLabel = requiredElement<HTMLElement>("[data-orb-state-label]");
const orbStateDetail = requiredElement<HTMLElement>("[data-orb-state-detail]");
const serviceBadge = requiredElement<HTMLElement>("[data-service-badge]");
const serviceEndpoint = requiredElement<HTMLElement>("[data-service-endpoint]");
const serviceUptime = requiredElement<HTMLElement>("[data-service-uptime]");
const telemetryVoice = requiredElement<HTMLElement>("[data-telemetry-voice]");
const telemetryActions = requiredElement<HTMLElement>("[data-telemetry-actions]");
const capVoice = optionalElement<HTMLElement>("[data-cap-voice]");
const capMemory = optionalElement<HTMLElement>("[data-cap-memory]");
const capAction = optionalElement<HTMLElement>("[data-cap-action]");
const voiceMuteBtn = optionalElement<HTMLButtonElement>("[data-toggle-voice-mute]");
const feed = optionalElement<HTMLOListElement>("[data-activity-feed]");
const form = optionalElement<HTMLFormElement>("[data-command-form]");
const input = optionalElement<HTMLInputElement>("[data-command-input]");
const sendButton = optionalElement<HTMLButtonElement>("[data-send-chat]");
const cancelButton = optionalElement<HTMLButtonElement>("[data-cancel-chat]");
const modelStatus = optionalElement<HTMLElement>("[data-model-status]");
const modelMessage = optionalElement<HTMLElement>("[data-model-message]");
const modelInstruction = optionalElement<HTMLElement>("[data-model-instruction]");
const modelCommand = optionalElement<HTMLElement>("[data-model-command]");
const modelCopyStatus = optionalElement<HTMLElement>("[data-model-copy-status]");
const memoryListEl = optionalElement<HTMLUListElement>("[data-memory-list]");
const memorySearchInput = optionalElement<HTMLInputElement>("[data-memory-search]");
const addMemoryForm = optionalElement<HTMLFormElement>("[data-add-memory-form]");
const memoryPanelBox = optionalElement<HTMLElement>("[data-memory-panel]");
let memorySearchTerm = "";

const fileListEl = optionalElement<HTMLUListElement>("[data-file-list]");
const ragResultsEl = optionalElement<HTMLDivElement>("[data-rag-results]");
const ragSearchInput = optionalElement<HTMLInputElement>("[data-rag-search]");
const filesPanelBox = optionalElement<HTMLElement>("[data-files-panel]");
const filePreviewBox = optionalElement<HTMLElement>("[data-file-preview-box]");
const filePreviewTitle = optionalElement<HTMLElement>("[data-file-preview-title]");
const filePreviewCode = optionalElement<HTMLElement>("[data-file-preview-code]");
const closeFilePreviewBtn = optionalElement<HTMLButtonElement>("[data-close-file-preview]");

const browserPanelBox = optionalElement<HTMLElement>("[data-browser-panel]");
const webSearchForm = optionalElement<HTMLFormElement>("[data-web-search-form]");
const webSearchInput = optionalElement<HTMLInputElement>("[data-web-search-input]");
const webFetchForm = optionalElement<HTMLFormElement>("[data-web-fetch-form]");
const webUrlInput = optionalElement<HTMLInputElement>("[data-web-url-input]");
const browserResultsBox = optionalElement<HTMLDivElement>("[data-browser-results]");

const hudDrawerEl = optionalElement<HTMLElement>("[data-hud-drawer]");
const drawerActiveTitleEl = optionalElement<HTMLElement>("[data-drawer-active-title]");

const settingsPanelBox = optionalElement<HTMLElement>("[data-settings-panel]");
const agentsPanelBox = optionalElement<HTMLElement>("[data-agents-panel]");
const workflowsPanelBox = optionalElement<HTMLElement>("[data-workflows-panel]");
const knowledgePanelBox = optionalElement<HTMLElement>("[data-knowledge-panel]");
const diagnosticsPanelBox = optionalElement<HTMLElement>("[data-diagnostics-panel]");

async function loadMemoryItems(): Promise<void> {
  try {
    memoryItems = await window.jarvisDesktop.getMemoryItems();
    if (capMemory) capMemory.textContent = `ONLINE (${memoryItems.length} ITEMS)`;
    renderMemoryList();
  } catch (err) {
    console.warn("Fehler beim Laden von Memory:", err);
  }
}

const landingOrbRoot = createRoot(requiredElement<HTMLElement>("[data-landing-orb]"));

function renderLandingOrb(state: JarvisOrbState): void {
  landingOrbRoot.render(<div className="voice-orb-hud desktop-landing-orb"><SafeVoiceOrb levels={stateLevels[state]} paused={reduceMotion.matches || state === "disconnected"} className="voice-orb-canvas" /><OrbHudRings /></div>);
}
function applyOrbState(state: JarvisOrbState): void {
  documentRoot.dataset.orbState = state;
  const copy = getStateCopy(state);
  orbStateLabel.textContent = previewState ? `${copy.label} / preview` : copy.label;
  orbStateDetail.textContent = copy.detail;
  renderLandingOrb(state);
  document.querySelectorAll<HTMLButtonElement>("[data-state-preview]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.statePreview === state && Boolean(previewState))));
}
function setLiveState(state: JarvisOrbState): void { liveState = state; if (!previewState) applyOrbState(state); }

const orbStageEl = requiredElement<HTMLElement>(".orb-stage");
const stageActionHudEl = requiredElement<HTMLElement>(".stage-action-hud");
const stageActionTitleEl = requiredElement<HTMLElement>("[data-stage-action-title]");
const stageActionDescEl = requiredElement<HTMLElement>("[data-stage-action-desc]");
const stageActionParamsEl = requiredElement<HTMLElement>("[data-stage-action-params]");
const stageApproveBtn = requiredElement<HTMLButtonElement>("[data-stage-approve]");
const stageRejectBtn = requiredElement<HTMLButtonElement>("[data-stage-reject]");

const stageCameraViewEl = requiredElement<HTMLElement>(".stage-camera-view");
const stageCameraVideoEl = requiredElement<HTMLVideoElement>(".stage-camera-video");
const stageCameraCanvasEl = requiredElement<HTMLCanvasElement>(".stage-camera-canvas");

const stageWebViewEl = optionalElement<HTMLElement>(".stage-web-view");
const stageWebFrameEl = optionalElement<HTMLElement>("[data-web-frame]");
const stageWebUrlInputEl = optionalElement<HTMLInputElement>("[data-web-url-input]");

const stageScreenshotViewEl = requiredElement<HTMLElement>(".stage-screenshot-view");
const stageScreenshotImgEl = requiredElement<HTMLImageElement>(".stage-screenshot-img");

const stageCodeViewEl = requiredElement<HTMLElement>(".stage-code-view");
const stageCodeContentEl = requiredElement<HTMLElement>(".stage-code-content");

const stageMorningBriefViewEl = optionalElement<HTMLElement>(".stage-morning-brief-view");
const stageBarehandsViewEl = optionalElement<HTMLElement>(".stage-barehands-view");
const stageBarehandsFrameEl = optionalElement<HTMLIFrameElement>("[data-barehands-frame]");
const weather7DayGridEl = optionalElement<HTMLElement>("[data-weather-7day-grid]");
const weatherTodayTempEl = optionalElement<HTMLElement>("[data-weather-today-temp]");
const weatherTodayIconEl = optionalElement<HTMLElement>("[data-weather-today-icon]");
const weatherTodayDescEl = optionalElement<HTMLElement>("[data-weather-today-desc]");
const morningTaskListEl = optionalElement<HTMLElement>("[data-morning-task-list]");
const morningAiSuggestionsEl = optionalElement<HTMLElement>("[data-morning-ai-suggestions]");
const newsFeedGridEl = optionalElement<HTMLElement>("[data-news-feed-grid]");

let activeCameraStream: MediaStream | null = null;

function normalizeWebUrl(raw: string): string {
  const value = raw
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .replace(/^(?:die\s+)?(?:webseite|website|seite)\s+/i, "")
    .replace(/\s+(?:punkt\s+)?(com|org|net|de|ch|io|ai)\b/gi, ".$1")
    .replace(/\s+/g, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const lower = value.toLowerCase();
  const known: Record<string, string> = {
    wikipedia: "https://www.wikipedia.org",
    wiki: "https://www.wikipedia.org",
    webstark: "https://webstark.org",
    google: "https://www.google.com",
    youtube: "https://www.youtube.com",
  };
  if (known[lower]) return known[lower];
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function getDeterministicLocalAnswer(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[.!?]+$/, "").trim();
  const now = new Date();
  if (value.includes("wie spät") || value === "uhrzeit" || value === "wie viel uhr ist es") {
    return `Es ist ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`;
  }
  if (value.includes("welcher tag ist heute") || value.includes("welches datum") || value === "datum") {
    return `Heute ist ${now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}.`;
  }
  if (value.includes("welcher monat")) {
    return `Wir haben ${now.toLocaleDateString("de-DE", { month: "long" })}.`;
  }
  if (value.includes("welches jahr")) {
    return `Wir haben das Jahr ${now.getFullYear()}.`;
  }
  return undefined;
}

function parseDeterministicFolderCommand(text: string): string | undefined {
  const match = text.match(/^(?:öffne|oeffne|open|zeige)\s+(?:(?:meinen|meine|mein|den|die|das)\s+)?(.+?)[.!?]*$/i);
  if (!match?.[1]) return undefined;
  const target = match[1].toLowerCase().trim();
  if (target === "desktop") return "desktop";
  if (target === "dokumente" || target === "documents") return "dokumente";
  if (target === "downloads") return "downloads";
  if (target === "bilder" || target === "pictures") return "bilder";
  if (target === "videos") return "videos";
  if (target === "musikordner" || target === "musik ordner" || target === "music folder") return "musik";
  return undefined;
}

function parseDeterministicAppCommand(text: string): string | undefined {
  const match = text.match(/^(?:öffne|oeffne|open|starte)\s+(?:den\s+|die\s+|das\s+)?(.+?)[.!?]*$/i);
  if (!match?.[1]) return undefined;
  const target = match[1].toLowerCase().trim();
  if (/^(?:taschenrechner|rechner|calculator|calc)$/.test(target)) return "calc";
  if (/^(?:editor|notepad|texteditor)$/.test(target)) return "notepad";
  if (/^(?:paint|microsoft paint)$/.test(target)) return "paint";
  if (/^(?:task-manager|taskmanager|task manager|taskmgr)$/.test(target)) return "taskmgr";
  if (/^(?:explorer|dateimanager|datei-explorer|windows explorer)$/.test(target)) return "explorer";
  if (target === "steam") return "steam";
  if (/^(?:brave|brave browser)$/.test(target)) return "brave";
  if (/^(?:chrome|google chrome)$/.test(target)) return "chrome";
  if (/^(?:firefox|mozilla firefox)$/.test(target)) return "firefox";
  if (/^(?:edge|microsoft edge)$/.test(target)) return "edge";
  if (/^(?:opera|opera gx)$/.test(target)) return target;
  if (/^(?:origin|ea|ea app)$/.test(target)) return target;
  if (/^(?:antigravity|antigravity ide)$/.test(target)) return "antigravity";
  if (/^(?:proton|proton mail)$/.test(target)) return "proton mail";
  return undefined;
}

function parseDeterministicCloseAppCommand(text: string): string | undefined {
  const match = text.match(/^(?:schließe|schliesse|beende)\s+(.+?)[.!?]*$/i);
  if (!match?.[1]) return undefined;
  const target = match[1].toLowerCase().trim();
  const aliases: Record<string, string> = {
    steam: "steam", brave: "brave", "brave browser": "brave", chrome: "chrome", "google chrome": "chrome",
    firefox: "firefox", "mozilla firefox": "firefox", edge: "edge", "microsoft edge": "edge",
    opera: "opera", "opera gx": "opera gx", origin: "origin", ea: "ea", "ea app": "ea app",
    antigravity: "antigravity", "antigravity ide": "antigravity", proton: "proton mail", "proton mail": "proton mail",
  };
  return aliases[target];
}

function parseDeterministicMediaAction(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[.!?+]+$/, "").trim();
  if (/^(?:pausiere|pause)\s+(?:die\s+)?(?:musik|spotify)$/.test(value)) return "pause";
  if (/^(?:stoppe|stopp)\s+(?:die\s+)?(?:musik|spotify)$/.test(value)) return "stop";
  if (/^(?:musik|wiedergabe)\s+fortsetzen$/.test(value) || value === "weiter abspielen") return "play";
  if (/^(?:nächster|naechster)\s+(?:song|titel)$/.test(value) || value === "weiter") return "next";
  if (/^(?:vorheriger|voriger)\s+(?:song|titel)$/.test(value) || value === "zurück") return "prev";
  if (/^(?:lautstärke|lautstaerke)\s+hoch$/.test(value) || value === "ton lauter" || value === "lauter") return "volup";
  if (/^(?:lautstärke|lautstaerke)\s+(?:runter|niedriger)$/.test(value) || value === "ton leiser" || value === "leiser") return "voldown";
  if (value === "ton aus" || value === "stumm") return "mute";
  return undefined;
}

function parseMainStageWebCommand(text: string): string | undefined {
  const explicitStage = text.match(/(?:öffne|oeffne|open|lade|zeige)\s+(.+?)\s+(?:auf|in)\s+der\s+(?:haupt|haubt)bühne\b/i);
  if (explicitStage?.[1]) {
    const target = explicitStage[1].replace(/^(?:die\s+)?(?:webseite|website|seite)\s+/i, "").trim();
    return target || undefined;
  }

  const simpleOpen = text.match(/^(?:öffne|oeffne|open|lade|zeige)\s+(.+?)[.!?]*$/i);
  if (!simpleOpen?.[1]) return undefined;
  const target = simpleOpen[1].replace(/^(?:die\s+)?(?:webseite|website|seite)\s+/i, "").trim();
  const lower = target.toLowerCase();
  const isKnownWebsite = /\b(?:webstark|wikipedia|wiki|google|youtube)\b/.test(lower);
  const hasDomain = /[a-z0-9-]+\.(?:com|org|net|de|ch|io|ai)\b/i.test(target);
  return isKnownWebsite || hasDomain ? target : undefined;
}

function coerceWebProposal(proposal: { capability: string; title?: string; description?: string; params?: Record<string, unknown> }): { capability: string; title?: string; description?: string; params?: Record<string, unknown> } {
  if (proposal.capability !== "app.open_app" && proposal.capability !== "system.open_app") return proposal;
  const target = String(proposal.params?.url ?? proposal.params?.link ?? proposal.params?.target ?? proposal.params?.name ?? "").trim();
  const text = `${proposal.title ?? ""} ${proposal.description ?? ""} ${target}`.toLowerCase();
  const looksLikeWeb = text.includes("webseite") || text.includes("hauptbühne") || text.includes("haubtbühne") || text.includes("browser") || text.includes("wikipedia") || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(target);
  if (!target || !looksLikeWeb) return proposal;
  const url = normalizeWebUrl(target);
  return {
    capability: "app.open_url",
    title: proposal.title || `${target} auf der Hauptbühne öffnen`,
    description: "Öffnet die angeforderte Webseite in der Jarvis-Hauptbühne.",
    params: { url },
  };
}

let barehandsSystemCursorMode = false;

function setStageView(view: "action" | "camera" | "screenshot" | "code" | "morning-brief" | "barehands" | "web" | "lifeos" | "settings" | "knowledge" | "workflows" | "agents" | "memory" | "files" | "browser" | null, data?: any): void {
  const allStageViews = Array.from(document.querySelectorAll<HTMLElement>("[data-stage-view]"));

  if (!view) {
    orbStageEl.dataset.stageMode = "hero";
    allStageViews.forEach((el) => { el.hidden = true; });
    stageActionHudEl.hidden = true;
    stageCameraViewEl.hidden = true;
    stageScreenshotViewEl.hidden = true;
    stageCodeViewEl.hidden = true;
    if (stageWebViewEl) stageWebViewEl.hidden = true;
    if (stageMorningBriefViewEl) stageMorningBriefViewEl.hidden = true;
    if (stageBarehandsViewEl) {
      stageBarehandsViewEl.hidden = true;
      sendToBarehands("jarvis:release-camera");
    }
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((t) => t.stop());
      activeCameraStream = null;
    }
    return;
  }

  // Orb in Mini-Modus unten rechts verschieben
  orbStageEl.dataset.stageMode = "mini";
  allStageViews.forEach((el) => { el.hidden = el.dataset.stageView !== view; });
  stageActionHudEl.hidden = view !== "action";
  stageCameraViewEl.hidden = view !== "camera";
  stageScreenshotViewEl.hidden = view !== "screenshot";
  stageCodeViewEl.hidden = view !== "code";
  if (stageWebViewEl) stageWebViewEl.hidden = view !== "web";
  if (stageMorningBriefViewEl) stageMorningBriefViewEl.hidden = view !== "morning-brief";
  if (stageBarehandsViewEl) stageBarehandsViewEl.hidden = view !== "barehands";

  if (view === "morning-brief") {
    void loadMorningBriefingData();
  }

  if (view === "barehands" && stageBarehandsFrameEl) {
    stageBarehandsFrameEl.src = "about:blank";
    setTimeout(() => {
      if (stageBarehandsFrameEl) {
        const suffix = barehandsSystemCursorMode ? "?systemCursor=1" : "";
        stageBarehandsFrameEl.src = `http://127.0.0.1:8794/stage.html${suffix}`;
      }
    }, 100);
  }

  if (view === "web" && stageWebFrameEl) {
    const url = normalizeWebUrl(typeof data === "string" && data.trim() ? data.trim() : "https://webstark.org");
    stageWebFrameEl.setAttribute("src", url);
    if (stageWebUrlInputEl) stageWebUrlInputEl.value = url;
  }

  if (view === "action" && data) {
    const intent: JarvisActionIntent = data;
    stageActionTitleEl.textContent = intent.title || `Capability: ${intent.capability}`;
    stageActionDescEl.textContent = intent.description || "Systemaktion wartet auf deine Freigabe.";
    stageActionParamsEl.textContent = JSON.stringify(intent.params, null, 2);

    stageApproveBtn.onclick = async () => {
      setStageView(null);
      await handleActionDecision(intent.id, "approve");
    };
    stageRejectBtn.onclick = async () => {
      setStageView(null);
      await handleActionDecision(intent.id, "reject");
    };
  }

  if (view === "camera") {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((t) => t.stop());
      activeCameraStream = null;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        activeCameraStream = stream;
        stageCameraVideoEl.srcObject = stream;
      })
      .catch((err) => {
        addEntry("warning", `Kamera konnte nicht geöffnet werden: ${err.message}`);
        setStageView(null);
      });
  }

  if (view === "screenshot" && typeof data === "string") {
    stageScreenshotImgEl.src = data;
  }

  if (view === "code" && typeof data === "string") {
    stageCodeContentEl.textContent = data;
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-stage-close-media]").forEach((btn) => {
  btn.addEventListener("click", () => setStageView(null));
});

// --- HUD Morning Briefing Functions ---

const mockNews = {
  schweiz: [
    { title: "SRF News: Schweizer Wirtschaft zeigt sich stabil im neuen Quartal", tag: "🇨🇭 SCHWEIZ", link: "https://www.srf.ch/news" },
    { title: "Schweizer Alpen: Neue Nachhaltigkeits-Initiative für den Bergtourismus", tag: "🇨🇭 SCHWEIZ", link: "https://www.srf.ch/news" },
    { title: "Innovationsstandort Schweiz: Ausbau von KI & IoT in Forschungsprojekten", tag: "🇨🇭 SCHWEIZ", link: "https://www.srf.ch/news" },
  ],
  telebiel: [
    { title: "TeleBielingue: Umbau am Zentralplatz in Biel beginnt nächsten Monat", tag: "⛵ BIEL/BIENNE", link: "https://www.telebielingue.ch" },
    { title: "Bieler Seeland: Rekordbesucherzahlen am Bielersee-Strandbad gemeldet", tag: "⛵ BIEL/BIENNE", link: "https://www.telebielingue.ch" },
  ],
  welt: [
    { title: "Weltpolitik: Neue Klimaziele beim internationalen Gipfel verhandelt", tag: "🌐 WELT", link: "https://www.welt.de" },
    { title: "Raumfahrt: Mars-Rover findet neue Hinweise auf früheres Vorkommen von Wasser", tag: "🌐 WELT", link: "https://www.welt.de" },
  ]
};

function getWeatherInfo(code: number) {
  if (code === 0)
    return { icon: "☀️", desc: "Sonnig & Klar" };
  if (code >= 1 && code <= 3)
    return { icon: "⛅", desc: "Teilweise bewölkt" };
  if (code >= 45 && code <= 48)
    return { icon: "🌫️", desc: "Nebel" };
  if (code >= 51 && code <= 55)
    return { icon: "🌦️", desc: "Nieselregen" };
  if (code >= 61 && code <= 65)
    return { icon: "🌧️", desc: "Regen" };
  if (code >= 71 && code <= 77)
    return { icon: "❄️", desc: "Schneefall" };
  if (code >= 80 && code <= 82)
    return { icon: "🌧️", desc: "Regenschauer" };
  if (code >= 95)
    return { icon: "⛈️", desc: "Gewitter" };
  return { icon: "🌤️", desc: "Wechselhaft" };
}

let latestWeatherSummary = "";

async function fetchWeatherForecast(): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=47.1368&longitude=7.2468&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&current_weather=true&timezone=Europe%2FZurich");
    const data = await res.json();
    if (!data || !data.daily)
      return undefined;
    if (data.daily.weathercode?.[0] !== undefined && data.current_weather) {
      const info = getWeatherInfo(data.daily.weathercode[0]);
      const maxT = Math.round(data.daily.temperature_2m_max[0]);
      const minT = Math.round(data.daily.temperature_2m_min[0]);
      const rainProb = data.daily.precipitation_probability_max?.[0] ?? 0;
      latestWeatherSummary = `In Biel sind es aktuell ${Math.round(data.current_weather.temperature)} Grad. ${info.desc}. Höchsttemperatur ${maxT} Grad, Tiefsttemperatur ${minT} Grad, Regenwahrscheinlichkeit ${rainProb} Prozent.`;
    }
    if (weatherTodayTempEl && data.current_weather) {
      weatherTodayTempEl.textContent = `${Math.round(data.current_weather.temperature)}°C`;
    }
    if (data.daily.weathercode?.[0] !== undefined) {
      const info = getWeatherInfo(data.daily.weathercode[0]);
      if (weatherTodayDescEl) {
        weatherTodayDescEl.textContent = `${info.desc} • Max ${Math.round(data.daily.temperature_2m_max[0])}°C / Min ${Math.round(data.daily.temperature_2m_min[0])}°C`;
      }
      if (weatherTodayIconEl) {
        weatherTodayIconEl.textContent = info.icon;
      }
    }
    const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    if (weather7DayGridEl) {
      weather7DayGridEl.replaceChildren();
      data.daily.time.slice(0, 7).forEach((timeStr: string, idx: number) => {
        const date = new Date(timeStr);
        const dayName = idx === 0 ? "Heute" : dayNames[date.getDay()];
        const code = data.daily.weathercode[idx];
        const maxT = Math.round(data.daily.temperature_2m_max[idx]);
        const minT = Math.round(data.daily.temperature_2m_min[idx]);
        const rainProb = data.daily.precipitation_probability_max?.[idx] ?? 0;
        const info = getWeatherInfo(code);
        const card = document.createElement("div");
        card.className = "hud-weather-day";
        card.innerHTML = `
          <span class="hud-weather-day-name">${dayName}</span>
          <span class="hud-weather-day-icon">${info.icon}</span>
          <span class="hud-weather-day-temp">${maxT}° / ${minT}°</span>
          <span class="hud-weather-day-rain">💧 ${rainProb}%</span>
        `;
        weather7DayGridEl.appendChild(card);
      });
    }
    return latestWeatherSummary || undefined;
  } catch (err) {
    console.warn("Wetter konnte nicht geladen werden:", err);
    return undefined;
  }
}

function renderNewsFeed() {
  if (!newsFeedGridEl)
    return;
  newsFeedGridEl.replaceChildren();
  const mixedNews = [
    mockNews.schweiz[0],
    mockNews.telebiel[0],
    mockNews.welt[0],
    mockNews.schweiz[1]
  ];
  mixedNews.forEach((item) => {
    const card = document.createElement("div");
    card.className = "hud-news-card";
    card.innerHTML = `
      <span class="hud-news-source">${item.tag}</span>
      <h3 class="hud-news-title">${item.title}</h3>
    `;
    newsFeedGridEl.appendChild(card);
  });
}

async function loadMorningBriefingTasks() {
  if (!morningTaskListEl || !morningAiSuggestionsEl)
    return;
  try {
    morningTaskListEl.innerHTML = `
      <li class="hud-task-item">✅ LifeOS HUD Dashboard Integration</li>
      <li class="hud-task-item">⏳ Morning Briefing & TTS System</li>
      <li class="hud-task-item">⏳ ESP32 Sensorik & Lilygo Anbindung</li>
    `;
    morningAiSuggestionsEl.innerHTML = `<strong>Ed, Systemsouveränität auf OPTIMIZED (Grok + Ollama).</strong><br>Empfohlener nächster Schritt: PlatformIO im Atelier aufrufen.`;
  } catch (err) {
    console.warn("Morning Tasks konnten nicht geladen werden:", err);
  }
}

async function speakMorningBriefing() {
  const ttsIndicator = document.querySelector("[data-tts-indicator]");
  if (ttsIndicator)
    ttsIndicator.textContent = "🔊 SPEAKING";
  const hour = new Date().getHours();
  let greeting = "Guten Tag";
  if (hour >= 5 && hour < 12)
    greeting = "Guten Morgen";
  else if (hour >= 18 || hour < 5)
    greeting = "Guten Abend";
  const weatherText = latestWeatherSummary || "Die aktuellen Wetterdaten konnten nicht geladen werden.";
  const text = `${greeting} Master. ${weatherText} Dein Fokus liegt auf der HUD Integration und den ESP32 Sensoren. Systeme optimiert.`;
  await speakJarvisResponse(text);
  if (ttsIndicator) {
    const checkInterval = setInterval(() => {
      if (!isTtsPlaying) {
        ttsIndicator.textContent = "🔊 READY";
        clearInterval(checkInterval);
      }
    }, 500);
  }
}

async function loadMorningBriefingData() {
  await Promise.all([fetchWeatherForecast(), loadMorningBriefingTasks()]);
  renderNewsFeed();
  await speakMorningBriefing();
}

// Bind events for Morning Briefing
document.querySelectorAll<HTMLButtonElement>("[data-toggle-morning-brief]").forEach((btn) => {
  btn.addEventListener("click", () => setStageView("morning-brief"));
});
document.querySelectorAll<HTMLButtonElement>("[data-refresh-morning-brief]").forEach((btn) => {
  btn.addEventListener("click", () => void loadMorningBriefingData());
});

// Bind events for Barehands Stage
document.querySelectorAll<HTMLButtonElement>("[data-toggle-barehands]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const isBarehandsActive = stageBarehandsViewEl && !stageBarehandsViewEl.hidden;
    if (isBarehandsActive) {
      sendToBarehands("jarvis:release-camera");
      if (stageBarehandsFrameEl) {
        stageBarehandsFrameEl.src = "about:blank";
      }
      setTimeout(() => setStageView(null), 100);
      return;
    }
    // Kamera-Berechtigung vor Barehands-Start prüfen und User informieren
    // (besonders wichtig auf macOS: systemPreferences.askForMediaAccess wird
    // vom Main Process ausgelöst, hier nur UX-Hinweis)
    if (navigator.permissions) {
      try {
        const camPerm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (camPerm.state === "denied") {
          addEntry("warning", "Kameraberechtigung verweigert. Barehands funktioniert nur mit Kamerazugriff. Bitte in den Systemeinstellungen aktivieren.");
        } else if (camPerm.state === "prompt") {
          addEntry("info", "Barehands wird gleich nach Kamerazugriff fragen — bitte erlauben.");
        }
      } catch (permErr) {
        console.warn("[barehands] permission check failed:", permErr);
      }
    }

    try {
      await window.jarvisDesktop.ensureBarehands();
    } catch {
      addEntry("warning", "Barehands service could not be started.");
    }
    setStageView("barehands");
  });
});

function sendToBarehands(type: string, payload: Record<string, unknown> = {}): void {
  const frame = document.querySelector<HTMLIFrameElement>("[data-barehands-frame]");
  if (frame?.contentWindow) {
    frame.contentWindow.postMessage({ source: "jarvis-barehands-bridge", type, payload }, "http://127.0.0.1:8794");
  }
}

window.addEventListener("message", async (event: MessageEvent) => {
  const frame = document.querySelector<HTMLIFrameElement>("[data-barehands-frame]");
  if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== "http://127.0.0.1:8794") return;
  const data = event.data;
  if (!data || data.source !== "jarvis-barehands-bridge") return;

  const type = String(data.type ?? "");
  const payload = data.payload ?? {};

  if (type === "barehands:chat") {
    const text = String(payload.text ?? "").trim();
    if (text) {
      submitCurrentMessage(text);
    }
  } else if (type === "barehands:action") {
    if (payload.intentId && (payload.decision === "approve" || payload.decision === "reject")) {
      await window.jarvisDesktop.decideAction(String(payload.intentId), payload.decision);
    }
  } else if (type === "barehands:open-note") {
    sendToBarehands("note-opened", { file: payload.file, content: payload.content });
  } else if (type === "barehands:cursor") {
    const action = String(payload.action ?? "").trim();
    if (action) void window.jarvisDesktop.barehandsCursor(action, payload);
  } else {
    await window.jarvisDesktop.barehandsPushEvent(type, payload);
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-stage-toggle]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = btn.dataset.stageToggle as "web" | "camera" | "screenshot" | "barehands";
    const isSameActive = (target === "web" && stageWebViewEl && !stageWebViewEl.hidden)
      || (target === "camera" && stageCameraViewEl && !stageCameraViewEl.hidden)
      || (target === "screenshot" && stageScreenshotViewEl && !stageScreenshotViewEl.hidden)
      || (target === "barehands" && stageBarehandsViewEl && !stageBarehandsViewEl.hidden);
    if (isSameActive) {
      setStageView(null);
      document.querySelectorAll("[data-stage-toggle]").forEach(b => b.classList.remove("active"));
    } else if (target === "web") {
      setStageView("web");
      document.querySelectorAll("[data-stage-toggle]").forEach(b => b.classList.toggle("active", b === btn));
    } else if (target === "camera") {
      setStageView("camera");
      document.querySelectorAll("[data-stage-toggle]").forEach(b => b.classList.toggle("active", b === btn));
    } else if (target === "screenshot") {
      try {
        const dataUrl = await window.jarvisDesktop.captureScreenshot();
        if (dataUrl) setStageView("screenshot", dataUrl);
        else addEntry("warning", "Screenshot konnte nicht erstellt werden.");
      } catch (err) {
        addEntry("warning", `Screenshot-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      }
      document.querySelectorAll("[data-stage-toggle]").forEach(b => b.classList.toggle("active", b === btn));
    } else if (target === "barehands") {
      setStageView("barehands");
      document.querySelectorAll("[data-stage-toggle]").forEach(b => b.classList.toggle("active", b === btn));
    }
  });
});

// Web-Navigation
document.querySelectorAll<HTMLFormElement>("[data-web-nav-form]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>("[data-web-url-input]");
    if (input) {
      let url = input.value.trim();
      if (url && !url.startsWith("http")) url = "https://" + url;
      if (url && stageWebFrameEl) {
        stageWebFrameEl.setAttribute("src", normalizeWebUrl(url));
      }
    }
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-analyze-vision]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const type = btn.dataset.analyzeVision;
    if (type === "screenshot") {
      const src = stageScreenshotImgEl.src;
      if (src && src.startsWith("data:image")) {
        submitCurrentMessage("Analysiere diesen Bildschirm-Screenshot im Detail auf Deutsch:", src);
      } else {
        try {
          const dataUrl = await window.jarvisDesktop.captureScreenshot();
          setStageView("screenshot", dataUrl);
          submitCurrentMessage("Analysiere diesen Bildschirm-Screenshot im Detail auf Deutsch:", dataUrl);
        } catch (err) {
          addEntry("warning", `Screenshot-Analyse Fehler: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (type === "camera") {
      try {
        const ctx = stageCameraCanvasEl.getContext("2d");
        stageCameraCanvasEl.width = stageCameraVideoEl.videoWidth || 640;
        stageCameraCanvasEl.height = stageCameraVideoEl.videoHeight || 480;
        ctx?.drawImage(stageCameraVideoEl, 0, 0);
        const dataUrl = stageCameraCanvasEl.toDataURL("image/png");
        submitCurrentMessage("Analysiere dieses Foto von der Kamera im Detail auf Deutsch:", dataUrl);
      } catch (err) {
        addEntry("warning", `Kamera-Analyse Fehler: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
});

// Globaler & Lokaler Diktieren-Shortcut Event-Listener
if (window.jarvisDesktop.onDictateShortcut) {
  window.jarvisDesktop.onDictateShortcut(() => void triggerDictationFlow());
}

// Tastatur-Shortcut (Ctrl+Alt+D) lokal abfangen
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    void triggerDictationFlow();
  }
});

async function triggerDictationFlow(): Promise<void> {
  addEntry("system", "🎙️ Diktat gestartet... Bitte sprich jetzt (Aufnahme läuft)...");
  setLiveState("listening");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (chunks.length === 0) {
        if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      try {
        setLiveState("thinking");
        const result = await window.jarvisDesktop.transcribeAudio({
          audioData,
          mimeType,
          language: "de",
        });
        const text = result.text.trim();
        if (text) {
          const dictTargetEl = optionalElement<HTMLSelectElement>("[data-config-key='dictationTarget']");
          const target = dictTargetEl?.value || "clipboard";

          if (target === "chat_input" && input) {
            input.value = text;
            input.focus();
            addEntry("system", `🎙️ Diktat in Chat-Textfeld eingefügt.`);
          } else {
            await window.jarvisDesktop.writeClipboard(text);
            addEntry("system", `🎙️ Diktat erfolgreich in die Zwischenablage kopiert:\n"${text}"`);
          }
        } else {
          addEntry("system", "🎙️ Keine Sprache beim Diktieren erkannt.");
        }
      } catch (err) {
        addEntry("warning", `Diktat-Fehler: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
      }
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 4000);
  } catch (err) {
    addEntry("warning", `Diktat Mikrofon-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
  }
}

async function handleActionDecision(intentId: string, decision: "approve" | "reject"): Promise<void> {
  try {
    if (decision === "approve") setLiveState("executing-approved");
    const updated = await window.jarvisDesktop.decideAction(intentId, decision);
    if (updated.status === "failed") {
      addEntry("warning", `Action '${updated.title}' fehlgeschlagen: ${updated.error ?? "Unbekannter Fehler"}`);
    } else if (updated.status === "rejected" || decision === "reject") {
      addEntry("system", `Action proposal '${updated.title}' REJECTED.`);
    } else if (updated.status === "completed") {
      addEntry("system", `Action proposal '${updated.title}' APPROVED and executed.`);
    } else {
      addEntry("system", `Action proposal '${updated.title}' Status: ${updated.status}.`);
    }
    await refreshRuntimeStatus();

    // Spezial-Handhabung für Kamera & Screenshot Capabilities
    if (decision === "approve" && updated.status === "completed") {
      if (updated.capability === "system.take_screenshot" || updated.capability === "system.screenshot") {
        const dataUrl = await window.jarvisDesktop.captureScreenshot();
        setStageView("screenshot", dataUrl);
      } else if (updated.capability === "camera.open" || updated.capability === "camera.capture" || updated.capability === "camera.capture_photo") {
        setStageView("camera");
      } else if (updated.capability === "barehands.open" || updated.capability === "app.open_barehands") {
        try {
          await window.jarvisDesktop.ensureBarehands();
        } catch {}
        setStageView("barehands");
      } else if (updated.capability === "app.open_url" || updated.capability === "browser.open") {
        const url = String(updated.params?.url ?? updated.params?.link ?? updated.params?.target ?? "");
        if (url) setStageView("web", url);
      } else if (updated.capability === "media.control") {
        // Toggle the mic gate so song lyrics during external playback
        // (Spotify PWA) are not transcribed as commands.
        const action = String(updated.params?.action ?? "");
        const hasQuery = Boolean(updated.params?.query);
        if (action === "play" || hasQuery) {
          isExternalMediaPlaying = true;
        } else if (action === "pause" || action === "stop") {
          isExternalMediaPlaying = false;
        }
      }
    }
  } catch (err) {
    addEntry("warning", `Action decision failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
  }
}

function renderTranscript(): void {
  if (!feed) return;
  feed.replaceChildren();
  const filtered = entries.filter((item) => {
    if (item.kind === "action") return false; // Action Proposals werden NUR auf der Hauptbühne angezeigt!
    if (feedFilter === "chat") return item.kind === "user" || item.kind === "assistant";
    if (feedFilter === "system") return item.kind === "system" || item.kind === "warning" || item.kind === "info";
    return true;
  });

  for (const item of filtered) {
    const card = document.createElement("li");
    card.className = `chat-card chat-card--${item.kind}`;

    const header = document.createElement("div");
    header.className = "chat-card__header";

    const meta = document.createElement("div");
    meta.className = "chat-card__meta";

    const badge = document.createElement("span");
    badge.className = "chat-card__badge";
    badge.textContent = item.kind === "user" ? "YOU" : item.kind === "assistant" ? "J.A.R.V.I.S." : item.kind === "action" ? "ACTION PROPOSAL" : item.kind.toUpperCase();

    const time = document.createElement("time");
    time.className = "chat-card__time";
    time.dateTime = item.at.toISOString();
    time.textContent = item.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    meta.append(badge, time);
    header.append(meta);

    const body = document.createElement("div");
    body.className = "chat-card__body";
    if (item.pending) body.dataset.pending = "true";
    body.textContent = item.message;

    card.append(header, body);

    if (item.kind === "action" && item.actionIntent && item.actionIntent.status === "proposed") {
      const proposal = document.createElement("div");
      proposal.className = "action-proposal";

      const title = document.createElement("div");
      title.className = "action-proposal__title";
      title.textContent = `Capability: ${item.actionIntent.capability}`;

      const desc = document.createElement("div");
      desc.className = "action-proposal__desc";
      desc.textContent = item.actionIntent.description ?? "";

      const params = document.createElement("pre");
      params.className = "action-proposal__params";
      params.textContent = JSON.stringify(item.actionIntent.params, null, 2);

      const controls = document.createElement("div");
      controls.className = "action-proposal__controls";

      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "action-btn action-btn--approve";
      approveBtn.textContent = "▶ Approve";
      approveBtn.addEventListener("click", () => void handleActionDecision(item.actionIntent!.id, "approve"));

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "action-btn action-btn--reject";
      rejectBtn.textContent = "✖ Reject";
      rejectBtn.addEventListener("click", () => void handleActionDecision(item.actionIntent!.id, "reject"));

      controls.append(approveBtn, rejectBtn);
      proposal.append(title, desc, params, controls);
      card.append(proposal);
    }

    feed.append(card);
  }
  feed.scrollTop = feed.scrollHeight;
}

function addEntry(kind: TranscriptKind, message: string, pending = false, actionIntent?: JarvisActionIntent): TranscriptEntry {
  const entry = { id: nextId++, at: new Date(), kind, message, pending, actionIntent }; entries.push(entry);
  if (entries.length > 24) entries.splice(0, entries.length - 24);
  renderTranscript();
  if (kind === "action" && actionIntent && actionIntent.status === "proposed") {
    setStageView("action", actionIntent);
  }
  return entry;
}
function renderReadiness(value: JarvisModelReadiness): void {
  readiness = value;
  if (modelStatus) modelStatus.textContent = value.status.replace("-", " ").toUpperCase();
  if (modelMessage) modelMessage.textContent = value.message ?? "";
  if (modelInstruction) modelInstruction.hidden = (value as any).instruction === undefined;
  if ((value as any).instruction && modelCommand) modelCommand.textContent = (value as any).instruction.command;
  if (sendButton) sendButton.disabled = activeRequestId !== undefined;
  if (input) {
    input.disabled = activeRequestId !== undefined;
    input.placeholder = value.status === "ready" 
      ? "Ask a question or type > command (e.g. > ollama status)…" 
      : "Type > command (e.g. > ollama pull qwen3:8b) or run above…";
  }
  if (value.status !== "ready" && activeRequestId === undefined) setLiveState("disconnected");
}

optionalElement<HTMLButtonElement>("[data-start-ollama-btn]")?.addEventListener("click", async () => {
  addEntry("system", "⚡ Prüfe & Starte lokalen Ollama Server im Hintergrund...");
  const res = await window.jarvisDesktop.ensureOllama();
  addEntry("system", `⚡ ${res.message}`);
  await refreshRuntimeStatus();
});

let isServicePoweredOn = true;
const powerBtn = requiredElement<HTMLButtonElement>("[data-toggle-service]");

async function toggleServicePower(): Promise<void> {
  isServicePoweredOn = !isServicePoweredOn;
  powerBtn.dataset.servicePower = isServicePoweredOn ? "on" : "off";
  powerBtn.textContent = isServicePoweredOn ? "⏽ ON" : "⏻ OFF";

  if (isServicePoweredOn) {
    addEntry("system", "App Service powering ON... Re-establishing local loopback link.");
    await refreshRuntimeStatus();
    setLiveState(readiness?.status === "ready" ? "ready" : "idle");
  } else {
    serviceBadge.dataset.status = "offline";
    serviceBadge.textContent = "Service standby";
    serviceUptime.textContent = "—";
    setLiveState("disconnected");
    addEntry("system", "App Service powered OFF. Standby mode active.");
  }
}

let initialUnmuteDone = false;

async function refreshRuntimeStatus(): Promise<void> {
  if (!isServicePoweredOn) return;
  try {
    const runtime = await window.jarvisDesktop.getRuntimeStatus(); serviceEndpoint.textContent = runtime.serviceBaseUrl.replace(/^https?:\/\//, "");
    if (!isJarvisHealthSnapshot(runtime.health)) throw new Error(runtime.startupError ?? "Health payload failed validation");
    const health: JarvisHealthSnapshot = runtime.health; serviceBadge.dataset.status = "online"; serviceBadge.textContent = "Service online"; serviceUptime.textContent = `${Math.floor(health.uptimeSeconds)}s`;
    const model = await window.jarvisDesktop.getModelReadiness();
    renderReadiness(model);

    // Dynamic Capability & Telemetry updates
    try {
      voiceStatus = await window.jarvisDesktop.getVoiceStatus();

      // Einmaliges Initial-Unmute beim ersten App-Start
      if (!initialUnmuteDone) {
        initialUnmuteDone = true;
        if (voiceStatus.muted) {
          voiceStatus = await window.jarvisDesktop.setVoiceMute(false);
        }
      }

      telemetryVoice.dataset.muted = String(voiceStatus.muted);
      telemetryVoice.textContent = `VOICE / ${voiceStatus.muted ? "MUTED (HARD)" : "ACTIVE / UNMUTED"}`;
      if (capVoice) {
        capVoice.dataset.muted = String(voiceStatus.muted);
        capVoice.textContent = voiceStatus.muted ? "MUTED (HARD)" : "ONLINE (LISTENING)";
      }
      if (voiceMuteBtn) {
        voiceMuteBtn.dataset.muted = String(voiceStatus.muted);
        const isTitlebarControl = voiceMuteBtn.classList.contains("titlebar-voice-action");
        voiceMuteBtn.textContent = isTitlebarControl ? (voiceStatus.muted ? "○" : "●") : (voiceStatus.muted ? "🎙️ Mic Muted" : "🎙️ Mic Active");
        voiceMuteBtn.setAttribute("aria-label", voiceStatus.muted ? "Mikrofon aktivieren" : "Mikrofon stummschalten");
      }

      if (!voiceStatus.muted) {
        void ensureMicrophoneActive();
      }
    } catch {
      telemetryVoice.dataset.muted = "true";
      telemetryVoice.textContent = "VOICE / OFFLINE";
      if (capVoice) {
        capVoice.dataset.muted = "true";
        capVoice.textContent = "OFFLINE";
      }
    }

    try {
      memoryItems = await window.jarvisDesktop.getMemoryItems();
      if (capMemory) capMemory.textContent = `ONLINE (${memoryItems.length} ITEMS)`;
      renderMemoryList();
    } catch {
      if (capMemory) capMemory.textContent = "OFFLINE";
    }

    try {
      actionIntents = await window.jarvisDesktop.getActions();
      const pendingCount = actionIntents.filter((a) => a.status === "proposed").length;
      if (telemetryActions) telemetryActions.textContent = `ACTIONS / ${pendingCount > 0 ? `${pendingCount} PENDING` : "HUMAN-IN-LOOP"}`;
      if (capAction) capAction.textContent = `HUMAN-IN-LOOP (${actionIntents.length} INTENTS)`;
    } catch {
      if (telemetryActions) telemetryActions.textContent = "ACTIONS / DISABLED";
      if (capAction) capAction.textContent = "DISABLED";
    }

    // State nur anpassen wenn kein Chat/TTS läuft
    if (model.status === "ready" && activeRequestId === undefined && !isTtsPlaying) {
      if (voiceStatus && !voiceStatus.muted) {
        setLiveState("listening");
      } else {
        setLiveState("ready");
      }
    }
  } catch {
    serviceBadge.dataset.status = "offline"; serviceBadge.textContent = "Service disconnected"; serviceUptime.textContent = "—"; setLiveState("disconnected");
  }
}

let activeAudioStream: MediaStream | undefined;
let micRetryInterval: ReturnType<typeof setInterval> | undefined;

async function ensureMicrophoneActive(): Promise<void> {
  if (activeAudioStream || voiceStatus?.muted) return;
  try {
    activeAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startLocalAudioSeam(activeAudioStream);
    setLiveState("listening");
    addEntry("system", "Mikrofon ist aktiv (Dauerhafte Spracherkennung ohne Klick aktiv). TTS Sprachausgabe bereit.");
    if (micRetryInterval) {
      clearInterval(micRetryInterval);
      micRetryInterval = undefined;
    }
  } catch (err) {
    if (!micRetryInterval && !voiceStatus?.muted) {
      micRetryInterval = setInterval(() => {
        if (!activeAudioStream && !voiceStatus?.muted) {
          void ensureMicrophoneActive();
        } else if (micRetryInterval) {
          clearInterval(micRetryInterval);
          micRetryInterval = undefined;
        }
      }, 1500);
    }
  }
}

// Auto-Mic Activation Event Listeners
window.addEventListener("focus", () => { void ensureMicrophoneActive(); });
window.addEventListener("click", () => { void ensureMicrophoneActive(); }, { once: true });

async function setVoiceMuteState(muted: boolean): Promise<void> {
  const next = await window.jarvisDesktop.setVoiceMute(muted);
  voiceStatus = next;
  if (!next.muted) {
    await ensureMicrophoneActive();
    setLiveState("listening");
    addEntry("system", "Iron-Man-Modus aktiv: Mikrofon und dauerhafte Spracherkennung sind eingeschaltet.");
  } else {
    stopLocalAudioSeam();
    if (activeAudioStream) {
      activeAudioStream.getTracks().forEach((track) => track.stop());
      activeAudioStream = undefined;
    }
    setLiveState(readiness?.status === "ready" ? "ready" : "idle");
    addEntry("system", "Iron-Man-Modus deaktiviert: Hard-Mute ist aktiv.");
  }
  await refreshRuntimeStatus();
}

async function toggleVoiceMute(): Promise<void> {
  try {
    // Wenn KI gerade spricht oder denkt → Klick bricht sofort ab/stoppt Unterhaltung!
    if (isTtsPlaying || activeRequestId) {
      stopConversation();
      return;
    }

    const isMuted = voiceStatus?.muted ?? false;
    await setVoiceMuteState(!isMuted);
  } catch (err) {
    addEntry("warning", `Failed to toggle voice mute: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function submitCurrentMessage(textParam?: string, imageDataParam?: string): Promise<void> {
  let text = (textParam ?? input?.value ?? "").trim();
  if (!text || activeRequestId) return;
  if (!textParam && input) input.value = "";
  if (text.startsWith(">") || text.startsWith("$") || text.startsWith("/")) {
    const cmd = text.replace(/^[\>\$\/]\s*/, "");
    void runTerminalCommand(cmd);
    return;
  }

  const lower = text.toLowerCase().replace(/[.!?+]+$/, "").trim();
  if (
    lower === "stop" ||
    lower === "stopp" ||
    lower === "abbrechen" ||
    lower === "halt" ||
    lower === "pause" ||
    lower === "ruhe"
  ) {
    stopConversation();
    return;
  }

  const visionTypeMatch = text.match(/^schreibe\s+(.+?)\s+in\s+(?:das\s+|den\s+|die\s+)?(.+?)[.!?]*$/i);
  const visionClickMatch = text.match(/^klicke\s+auf\s+(?:das\s+|den\s+|die\s+)?(.+?)[.!?]*$/i);
  if (visionTypeMatch || visionClickMatch) {
    const target = (visionTypeMatch?.[2] ?? visionClickMatch?.[1] ?? "").trim();
    const insertText = visionTypeMatch?.[1]?.trim();
    addEntry("user", text);
    try {
      setLiveState("thinking");
      const located = await window.jarvisDesktop.locateScreenTarget(target);
      if (!located.found || located.x === undefined || located.y === undefined) {
        addEntry("warning", `Vision-Ziel „${target}“ wurde nicht sicher gefunden: ${located.reason ?? "kein Treffer"}`);
        return;
      }
      const capability = insertText ? "system.cursor_type" : "system.cursor_click";
      const intent = await window.jarvisDesktop.proposeAction({
        capability,
        title: insertText ? `Text in „${target}“ einfügen` : `Auf „${target}“ klicken`,
        description: `Grok Vision lokalisierte das Ziel bei (${Math.round(located.x)}, ${Math.round(located.y)}) mit ${Math.round((located.confidence ?? 0) * 100)}% Konfidenz. Ausführung erst nach manueller Freigabe.`,
        params: { x: located.x, y: located.y, target, ...(insertText ? { text: insertText } : {}) },
      });
      addEntry("action", `Vision-Aktion bestätigen: ${intent.title}`, true, intent);
    } catch (err) {
      addEntry("warning", `Vision-Zielerkennung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
    }
    return;
  }

  const activateCursorMode = /^(?:aktiviere|starte|schalte)\s+(?:die\s+)?(?:cursorsteuerung|cursor-steuerung|maussteuerung)(?:\s+ein)?$/i.test(lower);
  const deactivateCursorMode = /^(?:deaktiviere|beende|schalte)\s+(?:die\s+)?(?:cursorsteuerung|cursor-steuerung|maussteuerung)(?:\s+aus)?$/i.test(lower);
  if (activateCursorMode || deactivateCursorMode) {
    addEntry("user", text);
    barehandsSystemCursorMode = activateCursorMode;
    if (activateCursorMode) {
      try {
        await window.jarvisDesktop.ensureBarehands();
        setStageView("barehands");
        addEntry("assistant", "Cursorsteuerung aktiv. Bewege die Hand, um den Systemcursor zu führen. Kurzer Pinch: Linksklick. Pinch mindestens 0,9 Sekunden halten und lösen: Rechtsklick. Sage „Deaktiviere Cursorsteuerung“, um zur normalen Barehands-Bühne zurückzukehren.");
      } catch (err) {
        barehandsSystemCursorMode = false;
        addEntry("warning", `Cursorsteuerung konnte nicht gestartet werden: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      setStageView("barehands");
      addEntry("assistant", "Cursorsteuerung deaktiviert. Barehands bedient wieder nur die interne Bühne.");
    }
    return;
  }

  const activateIronMan = /^(?:aktiviere|starte|schalte)\s+(?:den\s+)?iron[- ]man[- ]modus(?:\s+ein)?$/i.test(lower);
  const deactivateIronMan = /^(?:deaktiviere|beende|schalte)\s+(?:den\s+)?iron[- ]man[- ]modus(?:\s+aus)?$/i.test(lower);
  if (activateIronMan || deactivateIronMan) {
    addEntry("user", text);
    try {
      await setVoiceMuteState(deactivateIronMan);
    } catch (err) {
      addEntry("warning", `Iron-Man-Modus konnte nicht geändert werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^wie alt bin ich[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const candidates = await window.jarvisDesktop.getMemoryItems({ search: "geburt" });
      const parsed = candidates
        .map((item) => ({ item, match: item.value.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/) }))
        .filter((entry) => entry.match !== null);
      if (parsed.length !== 1 || !parsed[0].match) {
        addEntry("assistant", "Ich kann dein Alter erst berechnen, wenn genau ein Geburtsdatum im persistenten Speicher hinterlegt ist, zum Beispiel: Merke dir, dass mein Geburtsdatum 01.01.1980 ist.");
      } else {
        const [, dayText, monthText, yearText] = parsed[0].match;
        const birth = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
        const response = `Du bist ${age} Jahre alt.`;
        addEntry("assistant", response);
        void speakJarvisResponse(response);
      }
    } catch (err) {
      addEntry("warning", `Alter konnte nicht berechnet werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const rememberMatch = text.match(/^(?:merke dir|denk daran),?\s+dass\s+(.+?)[.!?]*$/i);
  if (rememberMatch?.[1]) {
    const value = rememberMatch[1].trim();
    addEntry("user", text);
    try {
      const item = await window.jarvisDesktop.addMemoryItem({
        category: "operator_preference",
        key: `voice_memory_${Date.now()}`,
        value,
        provenance: "voice_command",
      });
      memoryItems.unshift(item);
      const response = `Gespeichert: ${value}`;
      addEntry("assistant", response);
      void speakJarvisResponse(response);
    } catch (err) {
      addEntry("warning", `Erinnerung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const forgetMatch = text.match(/^vergiss\s+(.+?)[.!?]*$/i);
  if (forgetMatch?.[1]) {
    const search = forgetMatch[1].trim();
    addEntry("user", text);
    try {
      const matches = await window.jarvisDesktop.getMemoryItems({ search });
      if (matches.length === 1) {
        await window.jarvisDesktop.deleteMemoryItem(matches[0].id);
        memoryItems = memoryItems.filter((item) => item.id !== matches[0].id);
        addEntry("assistant", `Erinnerung entfernt: ${matches[0].value}`);
      } else if (matches.length === 0) {
        addEntry("assistant", `Keine passende Erinnerung für „${search}“ gefunden.`);
      } else {
        addEntry("warning", `Mehrere Erinnerungen passen zu „${search}“. Bitte im Memory-Panel gezielt auswählen.`);
      }
    } catch (err) {
      addEntry("warning", `Erinnerung konnte nicht gelöscht werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:was weißt du über mich|liste meinen speicher auf|zeige meinen speicher)[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const items = await window.jarvisDesktop.getMemoryItems();
      memoryItems = items;
      const response = items.length === 0
        ? "Der persistente Speicher ist leer."
        : items.map((item) => `${item.key}: ${item.value}`).join("\n");
      addEntry("assistant", response);
    } catch (err) {
      addEntry("warning", `Speicher konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:jarvis,?\s+an die arbeit|wir arbeiten|arbeitsmodus|starte (?:den )?arbeitsmodus)[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const result = await window.jarvisDesktop.runWorkflow("work-mode");
      addEntry(result.success ? "assistant" : "warning", result.summary);
      if (result.logs.length > 0) addEntry("info", result.logs.join("\n"));
    } catch (err) {
      addEntry("warning", `Arbeitsmodus konnte nicht gestartet werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:batterie|ladezustand|wie voll ist (?:der )?akku|cpu|prozessorauslastung|ram|arbeitsspeicher|seit wann ist der pc an|systemstatus)[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const info = await window.jarvisDesktop.getSystemInfo();
      const uptimeHours = Math.floor(info.uptimeSeconds / 3600);
      const uptimeMinutes = Math.floor((info.uptimeSeconds % 3600) / 60);
      const usedGiB = info.memory.usedBytes / 1024 ** 3;
      const totalGiB = info.memory.totalBytes / 1024 ** 3;
      let response: string;
      if (/batterie|ladezustand|akku/i.test(text)) {
        response = info.battery.available
          ? `Der Akku steht bei ${info.battery.percent} Prozent und wird ${info.battery.charging ? "geladen" : "nicht geladen"}.`
          : "Auf diesem PC wurde keine auslesbare Batterie gefunden.";
      } else if (/cpu|prozessorauslastung/i.test(text)) {
        response = `Die gesamte CPU-Auslastung liegt aktuell bei ${info.cpuPercent} Prozent.`;
      } else if (/ram|arbeitsspeicher/i.test(text)) {
        response = `Der PC verwendet ${usedGiB.toFixed(1)} von ${totalGiB.toFixed(1)} Gigabyte RAM, also ${info.memory.percent} Prozent.`;
      } else if (/seit wann|uptime/i.test(text)) {
        response = `Der PC läuft seit ${uptimeHours} Stunden und ${uptimeMinutes} Minuten.`;
      } else {
        const battery = info.battery.available ? ` Akku ${info.battery.percent} Prozent.` : " Keine Batterie erkannt.";
        response = `CPU ${info.cpuPercent} Prozent. RAM ${info.memory.percent} Prozent. Uptime ${uptimeHours} Stunden und ${uptimeMinutes} Minuten.${battery}`;
      }
      addEntry("assistant", response);
      void speakJarvisResponse(response);
    } catch (err) {
      addEntry("warning", `Systemstatus konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:mache |erstelle |speichere )?(?:einen )?(?:screenshot|bildschirmaufnahme)[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const saved = await window.jarvisDesktop.saveScreenshot();
      setStageView("screenshot", saved.dataUrl);
      addEntry("assistant", `Screenshot gespeichert: ${saved.path}`);
    } catch (err) {
      addEntry("warning", `Screenshot konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:schalte|fahre)\s+(?:den\s+)?pc\s+(?:aus|herunter)|^herunterfahren[.!?]*$/i.test(text)) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "system.shutdown",
        title: "PC herunterfahren",
        description: "Plant nach ausdrücklicher Freigabe das Windows-Herunterfahren mit 30 Sekunden Verzögerung.",
        params: {},
      });
      addEntry("action", "Bestätigung erforderlich: PC in 30 Sekunden herunterfahren?", true, intent);
    } catch (err) {
      addEntry("warning", `Herunterfahren konnte nicht vorgeschlagen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const googleDocMatch = text.match(/^erstelle\s+(?:ein\s+)?google\s+doc(?:ument)?(?:\s+(.+?))?[.!?]*$/i);
  if (googleDocMatch) {
    addEntry("user", text);
    setStageView("web", "https://docs.new");
    addEntry("assistant", `Neues Google-Dokument auf der Hauptbühne geöffnet${googleDocMatch[1] ? `. Gewünschter Titel: ${googleDocMatch[1].trim()}` : ""}.`);
    return;
  }

  const googleSheetMatch = text.match(/^erstelle\s+(?:ein\s+)?google\s+sheet(?:\s+(.+?))?[.!?]*$/i);
  if (googleSheetMatch) {
    addEntry("user", text);
    setStageView("web", "https://sheets.new");
    addEntry("assistant", `Neue Google-Tabelle auf der Hauptbühne geöffnet${googleSheetMatch[1] ? `. Gewünschter Titel: ${googleSheetMatch[1].trim()}` : ""}.`);
    return;
  }

  if (/^(?:lies|zeige|öffne)\s+(?:meine\s+)?e-?mails[.!?]*$/i.test(text)) {
    addEntry("user", text);
    setStageView("web", "https://mail.google.com/mail/u/0/#inbox");
    addEntry("assistant", "Gmail-Posteingang auf der Hauptbühne geöffnet. Strukturiertes Vorlesen benötigt noch Google-OAuth.");
    return;
  }

  if (/^(?:zeige|öffne)\s+(?:meinen\s+)?kalender[.!?]*$/i.test(text)) {
    addEntry("user", text);
    setStageView("web", "https://calendar.google.com/calendar/u/0/r");
    addEntry("assistant", "Google Kalender auf der Hauptbühne geöffnet.");
    return;
  }

  if (/^(?:gibt es|habe ich)\s+heute\s+geburtstage[.!?]*$/i.test(text)) {
    addEntry("user", text);
    setStageView("web", "https://calendar.google.com/calendar/u/0/r/day");
    addEntry("assistant", "Heutige Kalenderansicht geöffnet. Eine automatische Geburtstagsauswertung benötigt Google-OAuth.");
    return;
  }

  const sportMatch = text.match(/^(?:(?:zeige|suche)\s+)?(?:die\s+)?(ergebnisse|tabelle|live-ergebnisse)\s+(?:der\s+|von\s+)?(.+?)[.!?]*$/i);
  if (sportMatch?.[2]) {
    const subject = sportMatch[2].trim();
    const kind = sportMatch[1].toLowerCase();
    addEntry("user", text);
    try {
      const date = new Date().toLocaleDateString("de-CH");
      const result = await window.jarvisDesktop.searchWeb(`${kind} ${subject} ${date}`, 5);
      if (result.results.length === 0) {
        addEntry("warning", `Keine aktuellen Sportquellen für „${subject}“ gefunden.`);
      } else {
        const summary = result.results.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`).join("\n");
        addEntry("assistant", `Aktuelle Quellen für ${kind} ${subject}:\n${summary}`);
        setStageView("web", result.results[0].url);
      }
    } catch (err) {
      addEntry("warning", `Sportrecherche fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (/^(?:wie ist das wetter|wie wird das wetter|wird es regnen|wie hoch ist die außentemperatur|wie hoch ist die aussentemperatur)(?:\s+(?:heute|in biel))?[.!?]*$/i.test(text)) {
    addEntry("user", text);
    const weather = await fetchWeatherForecast();
    const response = weather ?? "Die aktuellen Wetterdaten für Biel konnten nicht geladen werden.";
    addEntry(weather ? "assistant" : "warning", response);
    if (weather) void speakJarvisResponse(response);
    return;
  }

  const currencyMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*(euro|eur|dollar|usd)\s+(?:in|zu)\s+(euro|eur|dollar|usd)[.!?]*$/i);
  if (currencyMatch) {
    const amount = Number(currencyMatch[1].replace(",", "."));
    const source = /euro|eur/i.test(currencyMatch[2]) ? "EUR" : "USD";
    const target = /euro|eur/i.test(currencyMatch[3]) ? "EUR" : "USD";
    addEntry("user", text);
    if (source === target) {
      addEntry("assistant", `${amount.toLocaleString("de-DE")} ${source} entsprechen ${amount.toLocaleString("de-DE")} ${target}.`);
      return;
    }
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?amount=${encodeURIComponent(String(amount))}&from=${source}&to=${target}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { date?: string; rates?: Record<string, number> };
      const converted = data.rates?.[target];
      if (typeof converted !== "number") throw new Error("Kein Kurs geliefert.");
      const answer = `${amount.toLocaleString("de-DE")} ${source} entsprechen ${converted.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${target}. Kursdatum: ${data.date ?? "unbekannt"}.`;
      addEntry("assistant", answer);
      void speakJarvisResponse(answer);
    } catch (err) {
      addEntry("warning", `Währungsumrechnung konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const deterministicResult = getDeterministicCalculation(text) ?? getDeterministicConversion(text) ?? getDeterministicTranslation(text);
  if (deterministicResult) {
    const userMessage: JarvisChatMessage = { role: "user", content: text };
    const assistantMessage: JarvisChatMessage = { role: "assistant", content: deterministicResult };
    messages.push(userMessage, assistantMessage);
    addEntry("user", text);
    addEntry("assistant", deterministicResult);
    void speakJarvisResponse(deterministicResult);
    return;
  }

  const localAnswer = getDeterministicLocalAnswer(text);
  if (localAnswer) {
    const userMessage: JarvisChatMessage = { role: "user", content: text };
    const assistantMessage: JarvisChatMessage = { role: "assistant", content: localAnswer };
    messages.push(userMessage, assistantMessage);
    addEntry("user", text);
    addEntry("assistant", localAnswer);
    void speakJarvisResponse(localAnswer);
    return;
  }

  // Deterministic desktop shortcut command. Spotify must always use the user's
  // Desktop shortcut and must never enter the LLM tool loop or Microsoft Store.
  if (/^(?:öffne|oeffne|open|starte)\s+spotify\b/i.test(text)) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "app.open_app",
        title: "Spotify öffnen",
        description: "Startet die Spotify-Web-App über die Desktop-Verknüpfung.",
        params: { name: "Spotify" },
      });
      await handleActionDecision(intent.id, "approve");
    } catch (err) {
      addEntry("warning", `Spotify konnte nicht geöffnet werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Combined command like "Öffne Spotify und spiele Ol Dirty Bastard":
    // extract the song part and let the lower Spotify-song block (which calls
    // media.control + handleActionDecision, setting isExternalMediaPlaying)
    // handle it. Without this, "und spiele X" was dropped and media.control
    // never ran, so the mic gate stayed open and lyrics flooded the chat.
    const songPart = text.match(/\b(?:und\s+)?spiel(?:e|)\b\s+(.+)$/i);
    if (songPart?.[1]) {
      text = `spiele ${songPart[1].trim()}`;
    } else {
      return;
    }
  }

  const deterministicFolder = parseDeterministicFolderCommand(text);
  if (deterministicFolder) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "system.open_folder",
        title: `${deterministicFolder} öffnen`,
        description: "Öffnet einen sicheren Benutzerordner im Windows Explorer.",
        params: { folder: deterministicFolder },
      });
      await handleActionDecision(intent.id, "approve");
    } catch (err) {
      addEntry("warning", `Ordner konnte nicht geöffnet werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const deterministicCloseApp = parseDeterministicCloseAppCommand(text);
  if (deterministicCloseApp) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "app.close",
        title: `${deterministicCloseApp} beenden`,
        description: "Beendet nach manueller Bestätigung ausschließlich Prozesse aus der festen Allowlist.",
        params: { name: deterministicCloseApp },
      });
      addEntry("action", `Bestätigung erforderlich: ${deterministicCloseApp} beenden?`, true, intent);
    } catch (err) {
      addEntry("warning", `Anwendung konnte nicht zum Beenden vorgeschlagen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const deterministicApp = parseDeterministicAppCommand(text);
  if (deterministicApp) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "app.open_app",
        title: `${deterministicApp} öffnen`,
        description: "Startet eine explizit erlaubte lokale Windows-Anwendung.",
        params: { name: deterministicApp },
      });
      await handleActionDecision(intent.id, "approve");
    } catch (err) {
      addEntry("warning", `Anwendung konnte nicht geöffnet werden: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const deterministicMediaAction = parseDeterministicMediaAction(text);
  if (deterministicMediaAction) {
    addEntry("user", text);
    try {
      const intent = await window.jarvisDesktop.proposeAction({
        capability: "media.control",
        title: `Spotify: ${deterministicMediaAction}`,
        description: `Führt die Medienaktion '${deterministicMediaAction}' aus.`,
        params: { action: deterministicMediaAction },
      });
      await handleActionDecision(intent.id, "approve");
    } catch (err) {
      addEntry("warning", `Mediensteuerung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const youtubeMatch = text.match(/^(?:starte|spiele|suche)\s+(.+?)\s+(?:auf|bei)\s+youtube[.!?]*$/i);
  if (youtubeMatch?.[1]) {
    const query = youtubeMatch[1].trim();
    addEntry("user", text);
    setStageView("web", `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    addEntry("assistant", `YouTube-Suche für „${query}“ auf der Hauptbühne geöffnet.`);
    return;
  }

  // Deterministic Spotify song command. A concrete title/artist bypasses the
  // LLM loop and is searched and played through the Spotify PWA controller.
  const spotifySongMatch = text.match(/^(?:spiele|spiel|play|starte)\s+(.+?)[.!?]*$/i);
  if (spotifySongMatch?.[1] && !/youtube/i.test(text)) {
    const query = spotifySongMatch[1].replace(/\s+(?:auf|mit)\s+spotify$/i, "").trim();
    if (query && !/^spotify$/i.test(query)) {
      addEntry("user", text);
      try {
        const intent = await window.jarvisDesktop.proposeAction({
          capability: "media.control",
          title: `${query} auf Spotify abspielen`,
          description: "Sucht den Titel in der Spotify-Web-App und startet die Wiedergabe.",
          params: /^musik$/i.test(query) ? { action: "play" } : { action: "play", query },
        });
        await handleActionDecision(intent.id, "approve");
      } catch (err) {
        addEntry("warning", `Spotify-Wiedergabe fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
  }

  // Deterministic main-stage browser command. This path intentionally bypasses
  // the LLM and every action/tool loop to guarantee one in-app navigation only.
  const mainStageTarget = parseMainStageWebCommand(text);
  if (mainStageTarget) {
    const url = normalizeWebUrl(mainStageTarget);
    const userMessage: JarvisChatMessage = { role: "user", content: text };
    const assistantMessage: JarvisChatMessage = { role: "assistant", content: `Öffne ${url} auf der Hauptbühne.` };
    messages.push(userMessage, assistantMessage);
    addEntry("user", text);
    setStageView("web", url);
    addEntry("assistant", `🌐 ${url} wurde auf der Hauptbühne geöffnet.`);
    setLiveState(readiness?.status === "ready" ? "ready" : "idle");
    return;
  }

  // 1. Kamera-Snapshot für explizite Kamera-/Outfit-/Objektfragen.
  if (!imageDataParam) {
    const camQuery = text.toLowerCase();
    const cameraAnalysisIntent = /kamera|webcam|kamerafoto|schau mich an|analysiere mich|wie bin ich angezogen|was habe ich an|mein outfit|identifiziere (?:dieses|das) objekt|was ist das/.test(camQuery);
    if (cameraAnalysisIntent) {
      if (!stageCameraViewEl || stageCameraViewEl.hidden || !stageCameraVideoEl || stageCameraVideoEl.videoWidth <= 0) {
        setStageView("camera");
        for (let attempt = 0; attempt < 20 && stageCameraVideoEl.videoWidth <= 0; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      if (stageCameraVideoEl.videoWidth > 0) {
        try {
          const ctx = stageCameraCanvasEl.getContext("2d");
          stageCameraCanvasEl.width = stageCameraVideoEl.videoWidth || 640;
          stageCameraCanvasEl.height = stageCameraVideoEl.videoHeight || 480;
          ctx?.drawImage(stageCameraVideoEl, 0, 0);
          imageDataParam = stageCameraCanvasEl.toDataURL("image/png");
        } catch (err) {
          console.warn("Auto Kamera Capture fehlgeschlagen:", err);
        }
      } else {
        addEntry("warning", "Für diese Bildfrage konnte kein Kameraframe aufgenommen werden. Es wird keine Bildbeschreibung erfunden.");
        return;
      }
    }
  }

  // 2. Automatischer Bildschirm-Screenshot wenn Nutzer nach Screen, App-Inhalt, Bildschirm oder 'was siehst du' fragt
  if (!imageDataParam) {
    const screenQuery = text.toLowerCase();
    if (
      screenQuery.includes("screen") ||
      screenQuery.includes("bildschirm") ||
      screenQuery.includes("in der app") ||
      screenQuery.includes("auf meinem screen") ||
      screenQuery.includes("auf dem bildschirm") ||
      screenQuery.includes("was siehst du")
    ) {
      try {
        const dataUrl = await window.jarvisDesktop.captureScreenshot();
        if (dataUrl) {
          imageDataParam = dataUrl;
          setStageView("screenshot", dataUrl);
        }
      } catch (err) {
        console.warn("Auto Screen Screenshot fehlgeschlagen:", err);
      }
    }
  }

  previewState = undefined;
  const userMessage: JarvisChatMessage = { role: "user", content: text, imageData: imageDataParam };
  messages.push(userMessage);
  addEntry("user", imageDataParam ? `[🖼️ BILD-ANALYSE] ${text}` : text);
  const thinkingText = activeModelMode === "cloud" ? "Grok (xAI) denkt..." : "Ollama (Qwen) denkt...";
  activeAssistantEntry = addEntry("assistant", imageDataParam ? "Grok Vision analysiert Bild..." : thinkingText, true);
  activeRequestId = crypto.randomUUID();
  stopRequested = false;
  isPaused = false;
  if (cancelButton) cancelButton.hidden = false;
  if (sendButton) sendButton.disabled = true;
  if (input) input.disabled = true;
  setLiveState("thinking");
  
  if (chatSafetyTimer) clearTimeout(chatSafetyTimer);
  chatSafetyTimer = setTimeout(() => {
    if (activeRequestId) {
      console.warn("Safety timeout hit: KI response took too long.");
      addEntry("warning", "Zeitüberschreitung bei der KI-Antwort (45s Fallback). Bitte erneut versuchen.");
      stopConversation();
    }
  }, 45000);

  const targetModel = activeModelMode === "local" ? "qwen3:8b" : "grok-4.20-non-reasoning";
  window.jarvisDesktop.startChat({ requestId: activeRequestId, model: targetModel, messages: messages.slice(-24) });
}

function clearChatState(): void {
  activeRequestId = undefined; activeAssistantEntry = undefined;
  if (chatSafetyTimer) {
    clearTimeout(chatSafetyTimer);
    chatSafetyTimer = undefined;
  }
  if (cancelButton) { cancelButton.hidden = true; cancelButton.disabled = false; cancelButton.textContent = "Cancel"; }
  if (sendButton) sendButton.disabled = false;
  if (input) { input.disabled = false; input.focus(); }
}
async function runTerminalCommand(cmd: string): Promise<void> {
  addEntry("user", `> ${cmd}`);
  const systemEntry = addEntry("system", `Executing command: ${cmd}...`, true);
  let activeOutput = "";
  const removeListener = window.jarvisDesktop.onTerminalOutput((chunk) => {
    activeOutput += chunk;
    systemEntry.message = `Executing: ${cmd}\n${activeOutput.slice(-300)}`;
    renderTranscript();
  });

  try {
    const res = await window.jarvisDesktop.executeTerminalCommand(cmd);
    systemEntry.pending = false;
    systemEntry.message = res.exitCode === 0
      ? `Command completed successfully: ${cmd}`
      : `Command exited with code ${res.exitCode}:\n${res.output.slice(-300)}`;
    renderTranscript();
    await refreshRuntimeStatus();
  } catch (err) {
    systemEntry.pending = false;
    systemEntry.kind = "warning";
    systemEntry.message = `Failed to execute: ${err instanceof Error ? err.message : String(err)}`;
    renderTranscript();
  } finally {
    removeListener();
  }
}
function handleChatEvent(event: JarvisChatStreamEvent): void {
  if (event.requestId !== activeRequestId) return;
  // Stop/Pause angefordert: verzögerte delta/done-Events dürfen die TTS-Ausgabe
  // nach dem Abbruch nicht erneut reaktivieren. (chat.cancelled bleibt erlaubt.)
  if (stopRequested && event.type !== "chat.cancelled") return;
  if (isPaused && event.type !== "chat.cancelled") return;
  if (event.type === "chat.start") { setLiveState("thinking"); return; }
  if (event.type === "chat.delta") {
    if (chatSafetyTimer) {
      clearTimeout(chatSafetyTimer);
      chatSafetyTimer = undefined;
    }
    setLiveState("responding");
    if (activeAssistantEntry) {
      activeAssistantEntry.message = activeAssistantEntry.pending ? (event.delta ?? "") : activeAssistantEntry.message + (event.delta ?? "");
      activeAssistantEntry.pending = false;
      renderTranscript();
    }
    return;
  }
  if (event.type === "chat.done") {
    if (activeAssistantEntry?.pending) activeAssistantEntry.message = event.message.content;
    if (activeAssistantEntry) activeAssistantEntry.pending = false;
    messages.push(event.message);
    renderTranscript();
    clearChatState();

    const messageContent = event.message.content;
    // Prioritize explicit action_proposal code blocks, then any fenced JSON,
    // then a bare inline {"capability":...} object. Robust against the model
    // emitting ```json``` instead of ```action_proposal```.
    const proposalBlockMatch = messageContent.match(/```(?:action_proposal|action|json)\s*([\s\S]*?)```/i);
    const inlineJsonMatch = messageContent.match(/\{[^{}]*"capability"\s*:\s*"app\.open_url"[^{}]*\}/i)
      ?? messageContent.match(/\{[^{}]*"capability"\s*:[^{}]*\}/i);
    const rawJsonText = (proposalBlockMatch?.[1] ?? inlineJsonMatch?.[0] ?? "").trim();

    if (rawJsonText) {
      try {
        const parsedProposal = JSON.parse(rawJsonText) as { capability: string; title: string; description: string; params?: Record<string, unknown> };
        const proposal = coerceWebProposal(parsedProposal);
        if (proposal.capability) {
          void window.jarvisDesktop.proposeAction({
            capability: proposal.capability,
            title: proposal.title || `Aktion: ${proposal.capability}`,
            description: proposal.description || `Führe ${proposal.capability} aus`,
            params: proposal.params,
          }).then(async (intent) => {
            addEntry("action", intent.title ?? `Aktion: ${intent.capability}`, false, intent);
            await refreshRuntimeStatus();

            // Webseiten: direkt auf der Hauptbühne öffnen
            if (
              intent.capability === "app.open_url" ||
              intent.capability === "browser.open"
            ) {
              const url = String(intent.params?.url ?? intent.params?.link ?? intent.params?.target ?? "");
              if (url) {
                setStageView("web", url);
                addEntry("action", `🌐 "${url}" wird auf der Hauptbühne geöffnet.`);
              }
            } else if (
              intent.capability === "app.open_app" ||
              intent.capability === "system.open_app"
            ) {
              await handleActionDecision(intent.id, "approve");
            }
          });
        }
      } catch (err) {
        console.warn("Fehler beim Parsen der Action Proposal:", err);
      }
    }

    const spokenText = event.message.content.replace(/```action_proposal[\s\S]*?```/gi, "").trim();
    void speakJarvisResponse(spokenText || event.message.content);
    return;
  }
  if (event.type === "chat.cancelled") {
    if (activeAssistantEntry) { activeAssistantEntry.kind = "warning"; activeAssistantEntry.message = "Local response cancelled. Nothing was executed."; activeAssistantEntry.pending = false; renderTranscript(); }
    clearChatState(); setLiveState(readiness?.status === "ready" ? "ready" : "disconnected"); return;
  }
  if (activeAssistantEntry) { activeAssistantEntry.kind = "warning"; activeAssistantEntry.message = event.error?.message ?? "An error occurred"; activeAssistantEntry.pending = false; renderTranscript(); }
  clearChatState(); setLiveState("error");
}
function handleLiveEvent(event: JarvisLiveEvent): void {
  if (event.type === "service.connected") {
    addEntry("system", `Live event stream connected (service v${event.payload.serviceVersion}).`);
  } else if (event.type === "orb.state.changed") {
    if (activeRequestId === undefined) setLiveState(event.payload.state);
  } else if (event.type === "diagnostics.updated") {
    const snap = (event.payload ?? {}) as any;
    const set = (sel: string, value: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) el.textContent = value;
    };
    const fmtUptime = (s: number): string => {
      if (typeof s !== "number" || !Number.isFinite(s)) return "—";
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
    };
    const xai = snap?.providers?.xaiStatus ?? "n/a";
    const mem = snap?.stats?.memoriesCount ?? "—";
    const actions = snap?.stats
      ? `QUEUED: ${snap.stats.queued ?? 0} | EXEC: ${snap.stats.executing ?? 0} | FAIL: ${snap.stats.failed ?? 0}`
      : "—";
    set("[data-diagnostics-service]", xai === "online" ? "ONLINE" : xai.toUpperCase());
    set("[data-diagnostics-uptime]", fmtUptime(snap?.uptimeSeconds));
    set("[data-diagnostics-mode]", voiceStatus?.muted ? "MUTED" : "ACTIVE");
    set("[data-diagnostics-voice]", voiceStatus ? `STT:${voiceStatus.sttEngine.status} TTS:${voiceStatus.ttsEngine.status}` : "—");
    set("[data-diagnostics-memory]", String(mem));
    if (telemetryActions) telemetryActions.textContent = actions;
    set("[data-diagnostics-actions]", actions);
    set("[data-diagnostics-api-latency]", `${snap?.latency?.xaiApiMs ?? "—"}ms (${xai})`);
    set("[data-diagnostics-ram]", `${snap?.memory?.rssMb ?? "—"} MB`);
    set("[data-diagnostics-knowledge-base]", String(snap?.stats?.knowledgeCount ?? "—"));
    set("[data-diagnostics-workflows]", String(snap?.stats?.workflowsCount ?? "—"));
    if (telemetryVoice) telemetryVoice.textContent = `VOICE / ${voiceStatus?.muted ? "MUTED" : "ACTIVE"} | ${xai.toUpperCase()}`;
  } else if (event.type === "voice.status.changed") {
    voiceStatus = event.payload.voiceStatus;
    void refreshRuntimeStatus();
  } else if (event.type === "memory.changed") {
    memoryItems = event.payload.items;
    void refreshRuntimeStatus();
  } else if (event.type === "action.intent.proposed") {
    actionIntents.unshift(event.payload.intent);
    addEntry("action", `Action proposal: ${event.payload.intent.title}`, false, event.payload.intent);
    void refreshRuntimeStatus();
  } else if (event.type === "action.intent.updated") {
    const intent = (event.payload as { intent?: JarvisActionIntent }).intent;
    // Backend-completed actions that target the main stage (e.g. opening a
    // URL) arrive here via the SSE live-event channel. The backend runs in
    // a separate process, so this is the only path that triggers the stage
    // view for voice-driven intents (no manual Approve click involved).
    if (intent && intent.status === "completed" && (intent.capability === "app.open_url" || intent.capability === "browser.open")) {
      const url = String(intent.params?.url ?? intent.params?.link ?? intent.params?.target ?? "");
      if (url) {
        setStageView("web", url);
        addEntry("action", `🌐 "${url}" wird auf der Hauptbühne geöffnet.`);
      }
    }
    // External media playback (Spotify PWA etc.) toggles the mic gate so
    // song lyrics are not transcribed as commands. Set on play/query,
    // clear on pause/stop — matches the backend media.control contract.
    if (intent && intent.status === "completed" && intent.capability === "media.control") {
      const action = String(intent.params?.action ?? "");
      const hasQuery = Boolean(intent.params?.query);
      if (action === "play" || hasQuery) {
        isExternalMediaPlaying = true;
      } else if (action === "pause" || action === "stop") {
        isExternalMediaPlaying = false;
      }
    }
    void refreshRuntimeStatus();
  } else if (event.type === "service.error") {
    addEntry("warning", `Service reported error: ${event.payload.error.error.message}`);
  }
}

for (const state of jarvisOrbStates) requiredElement<HTMLButtonElement>(`[data-state-preview="${state}"]`).addEventListener("click", () => { previewState = state; applyOrbState(state); addEntry("system", `Orb mapping previewed: ${state}. Visual simulation only.`); });
requiredElement<HTMLButtonElement>("[data-return-live]").addEventListener("click", () => { previewState = undefined; applyOrbState(liveState); });
const toggleLegendBtn = optionalElement<HTMLButtonElement>("[data-toggle-legend]");
const statePreviewBox = optionalElement<HTMLElement>(".state-preview");
toggleLegendBtn?.addEventListener("click", () => {
  if (!statePreviewBox) return;
  const isCollapsed = statePreviewBox.dataset.collapsed === "true";
  statePreviewBox.dataset.collapsed = String(!isCollapsed);
  if (toggleLegendBtn) toggleLegendBtn.textContent = !isCollapsed ? "⇱ Ausklappen" : "⇲ Einklappen";
});

const shellBody = optionalElement<HTMLElement>("[data-shell-body]");
const controlGrid = optionalElement<HTMLElement>(".control-grid");
const sidebarExpandBtn = optionalElement<HTMLButtonElement>(".sidebar-expand-btn");
const panelResizer = optionalElement<HTMLElement>("[data-panel-resizer]");

const savedShellNavState = localStorage.getItem("jarvis_shell_nav_collapsed");
if (shellBody) shellBody.dataset.navCollapsed = savedShellNavState === "true" ? "true" : "false";
let lastSurfaceNav = optionalElement<HTMLElement>("[data-shell-home]");
let lastDrawerKey: DrawerTabKey | null = null;

const diagnosticsPanelEl = optionalElement<HTMLElement>("[data-diagnostics-panel]");
let servicePanelEl: HTMLElement | undefined;

function selectShellSurface(item: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".shell-nav-item").forEach((navItem) => {
    navItem.dataset.active = String(navItem === item);
  });
  lastSurfaceNav = item;
}

function showTelemetryPanel(): void {
  if (servicePanelEl) servicePanelEl.hidden = true;
  if (diagnosticsPanelEl) diagnosticsPanelEl.hidden = false;
  document.querySelectorAll<HTMLElement>(".shell-nav-item").forEach((navItem) => {
    navItem.dataset.active = String(navItem === optionalElement<HTMLElement>("[data-toggle-diagnostics-panel]"));
  });
  lastSurfaceNav = optionalElement<HTMLElement>("[data-toggle-diagnostics-panel]");
  void refreshDiagnostics();
}

function showServicePanel(): void {
  if (servicePanelEl) servicePanelEl.hidden = false;
  if (diagnosticsPanelEl) diagnosticsPanelEl.hidden = true;
  document.querySelectorAll<HTMLElement>(".shell-nav-item").forEach((navItem) => {
    navItem.dataset.active = String(navItem === lastSurfaceNav);
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-shell-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!shellBody) return;
    const nextCollapsed = shellBody.dataset.navCollapsed !== "true";
    shellBody.dataset.navCollapsed = String(nextCollapsed);
    localStorage.setItem("jarvis_shell_nav_collapsed", String(nextCollapsed));
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-diagnostics-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    selectShellSurface(button);
    void showTelemetryPanel();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-shell-home]").forEach((button) => {
  button.addEventListener("click", () => {
    selectShellSurface(button);
    closeDrawer();
    setStageView(null);
    void showServicePanel();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-shell-chat]").forEach((button) => {
  button.addEventListener("click", () => {
    selectShellSurface(button);
    closeDrawer();
    input?.focus();
    feed?.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-morning-brief], [data-toggle-barehands]").forEach((button) => {
  button.addEventListener("click", () => selectShellSurface(button));
});

// Vorherige Sidebar-Breite aus Speicher laden
const savedSidebarWidth = localStorage.getItem("jarvis_sidebar_width");
if (savedSidebarWidth && controlGrid) {
  controlGrid.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
}

// Drag & Drop Resizer-Logik für den linken Rand des rechten Panels
if (panelResizer && controlGrid) {
  let isResizing = false;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    isResizing = true;
    controlGrid.dataset.isResizing = "true";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const gridRect = controlGrid.getBoundingClientRect();
    const rightMargin = gridRect.right - e.clientX - 14;
    const minWidth = 300;
    const maxWidth = Math.floor(gridRect.width - 420);
    const clampedWidth = Math.min(Math.max(rightMargin, minWidth), maxWidth);

    controlGrid.style.setProperty("--sidebar-width", `${clampedWidth}px`);
    localStorage.setItem("jarvis_sidebar_width", String(clampedWidth));
  };

  const onMouseUp = () => {
    if (!isResizing) return;
    isResizing = false;
    controlGrid.dataset.isResizing = "false";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  panelResizer.addEventListener("mousedown", onMouseDown);

  // Doppelklick setzt die Standardbreite zurück
  panelResizer.addEventListener("dblclick", () => {
    controlGrid.style.removeProperty("--sidebar-width");
    localStorage.removeItem("jarvis_sidebar_width");
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-sidebar]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!controlGrid) return;
    const isCollapsed = controlGrid.dataset.sidebarCollapsed === "true";
    controlGrid.dataset.sidebarCollapsed = String(!isCollapsed);
    if (sidebarExpandBtn) sidebarExpandBtn.hidden = isCollapsed;
  });
});
optionalElement<HTMLButtonElement>("[data-refresh-status]")?.addEventListener("click", () => void refreshRuntimeStatus());
powerBtn.addEventListener("click", () => void toggleServicePower());
voiceMuteBtn?.addEventListener("click", () => void toggleVoiceMute());
function renderMemoryList(): void {
  if (!memoryListEl) return;
  memoryListEl.replaceChildren();

  const term = memorySearchTerm.toLowerCase().trim();
  const filtered = memoryItems.filter((item) => {
    if (!term) return true;
    return (
      (item.key ?? "").toLowerCase().includes(term) ||
      String(item.value ?? "").toLowerCase().includes(term) ||
      (item.category ?? "").toLowerCase().includes(term) ||
      (item.content ?? "").toLowerCase().includes(term)
    );
  });

  if (filtered.length === 0) {
    const emptyCard = document.createElement("li");
    emptyCard.className = "memory-card";
    emptyCard.style.opacity = "0.6";
    emptyCard.textContent = memorySearchTerm ? "Keine passenden Erinnerungen gefunden." : "Keine Erinnerungen vorhanden.";
    memoryListEl.append(emptyCard);
    return;
  }

  for (const item of filtered) {
    const card = document.createElement("li");
    card.className = "memory-card";

    const info = document.createElement("div");
    info.className = "memory-card__info";

    const badge = document.createElement("span");
    badge.className = "memory-card__badge";
    badge.textContent = item.category === "operator_preference" ? "Präferenz" : item.category === "structured_fact" ? "Fakt" : "Dokument";

    const text = document.createElement("span");
    text.className = "memory-card__text";
    text.innerHTML = `<strong>${item.key}:</strong> ${item.value}`;

    info.append(badge, text);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "memory-card__del";
    delBtn.title = "Erinnerung löschen";
    delBtn.textContent = "✖";
    delBtn.addEventListener("click", async () => {
      try {
        await window.jarvisDesktop.deleteMemoryItem(item.id);
        addEntry("system", `Erinnerung '${item.key}' gelöscht.`);
        await refreshRuntimeStatus();
      } catch (err) {
        addEntry("warning", `Fehler beim Löschen der Erinnerung: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    card.append(info, delBtn);
    memoryListEl.append(card);
  }
}

memorySearchInput?.addEventListener("input", (e) => {
  memorySearchTerm = (e.target as HTMLInputElement).value;
  renderMemoryList();
});

// System Settings Panel UI & Event Handling
const settingsForm = optionalElement<HTMLFormElement>("[data-settings-form]");
const confirmModalEl = optionalElement<HTMLElement>("[data-settings-confirm-modal]");
let hasUnsavedSettings = false;

async function loadSettings(): Promise<void> {
  try {
    const config = (await window.jarvisDesktop.getConfig()) as any;
    const xaiInput = optionalElement<HTMLInputElement>("[data-config-key='xaiApiKey']");
    const tavilyInput = optionalElement<HTMLInputElement>("[data-config-key='tavilyApiKey']");
    const ollamaInput = optionalElement<HTMLInputElement>("[data-config-key='ollamaUrl']");
    const autoApproveInput = optionalElement<HTMLInputElement>("[data-config-key='autoApproveActions']");
    const providerSelect = optionalElement<HTMLSelectElement>("[data-config-key='ttsProvider']");
    const fishKeyInput = optionalElement<HTMLInputElement>("[data-config-key='fishAudioApiKey']");
    const fishModelInput = optionalElement<HTMLInputElement>("[data-config-key='fishAudioModelId']");
    const voiceSelect = optionalElement<HTMLSelectElement>("[data-config-key='ttsVoice']");
    const langInput = optionalElement<HTMLInputElement>("[data-config-key='sttLanguage']");
    const dictationSelect = optionalElement<HTMLSelectElement>("[data-config-key='dictationTarget']");
    const minimizeToTrayInput = optionalElement<HTMLInputElement>("[data-config-key='minimizeToTray']");
    const closeToTrayInput = optionalElement<HTMLInputElement>("[data-config-key='closeToTray']");

    if (xaiInput && config.xaiApiKey !== undefined) xaiInput.value = config.xaiApiKey;
    if (tavilyInput && config.tavilyApiKey !== undefined) tavilyInput.value = config.tavilyApiKey;
    if (ollamaInput && config.ollamaUrl !== undefined) ollamaInput.value = config.ollamaUrl;
    if (autoApproveInput && config.autoApproveActions !== undefined) autoApproveInput.checked = Boolean(config.autoApproveActions);
    if (providerSelect && config.ttsProvider !== undefined) providerSelect.value = config.ttsProvider;
    if (fishKeyInput && config.fishAudioApiKey !== undefined) fishKeyInput.value = config.fishAudioApiKey;
    if (fishModelInput && config.fishAudioModelId !== undefined) fishModelInput.value = config.fishAudioModelId;
    if (voiceSelect && config.ttsVoice !== undefined) voiceSelect.value = config.ttsVoice;
    if (langInput && config.sttLanguage !== undefined) langInput.value = config.sttLanguage;
    if (dictationSelect && config.dictationTarget !== undefined) dictationSelect.value = config.dictationTarget;
    if (minimizeToTrayInput && config.minimizeToTray !== undefined) minimizeToTrayInput.checked = Boolean(config.minimizeToTray);
    if (closeToTrayInput && config.closeToTray !== undefined) closeToTrayInput.checked = Boolean(config.closeToTray);

    if (config.enabledModules && typeof config.enabledModules === "object") {
      document.querySelectorAll<HTMLInputElement>("[data-config-module]").forEach((cb) => {
        const modName = cb.dataset.configModule;
        if (modName && config.enabledModules[modName] !== undefined) {
          cb.checked = Boolean(config.enabledModules[modName]);
        }
      });
    }

    hasUnsavedSettings = false;
  } catch (err) {
    console.warn("Fehler beim Laden der Einstellungen:", err);
  }
}

async function saveAllSettings(): Promise<boolean> {
  const xaiInput = optionalElement<HTMLInputElement>("[data-config-key='xaiApiKey']");
  const tavilyInput = optionalElement<HTMLInputElement>("[data-config-key='tavilyApiKey']");
  const ollamaInput = optionalElement<HTMLInputElement>("[data-config-key='ollamaUrl']");
  const autoApproveInput = optionalElement<HTMLInputElement>("[data-config-key='autoApproveActions']");
  const providerSelect = optionalElement<HTMLSelectElement>("[data-config-key='ttsProvider']");
  const fishKeyInput = optionalElement<HTMLInputElement>("[data-config-key='fishAudioApiKey']");
  const fishModelInput = optionalElement<HTMLInputElement>("[data-config-key='fishAudioModelId']");
  const voiceSelect = optionalElement<HTMLSelectElement>("[data-config-key='ttsVoice']");
  const langInput = optionalElement<HTMLInputElement>("[data-config-key='sttLanguage']");
  const dictationSelect = optionalElement<HTMLSelectElement>("[data-config-key='dictationTarget']");
  const minimizeToTrayInput = optionalElement<HTMLInputElement>("[data-config-key='minimizeToTray']");
  const closeToTrayInput = optionalElement<HTMLInputElement>("[data-config-key='closeToTray']");

  try {
    const payload: Record<string, unknown> = {};

    if (xaiInput) payload.xaiApiKey = xaiInput.value.trim();
    if (tavilyInput) payload.tavilyApiKey = tavilyInput.value.trim();
    if (ollamaInput) payload.ollamaUrl = ollamaInput.value.trim();
    if (autoApproveInput) payload.autoApproveActions = autoApproveInput.checked;
    if (providerSelect) payload.ttsProvider = providerSelect.value;
    if (fishKeyInput) payload.fishAudioApiKey = fishKeyInput.value.trim();
    if (fishModelInput) payload.fishAudioModelId = fishModelInput.value.trim();
    if (voiceSelect) payload.ttsVoice = voiceSelect.value;
    if (langInput) payload.sttLanguage = langInput.value.trim();
    if (dictationSelect) payload.dictationTarget = dictationSelect.value;
    if (minimizeToTrayInput) payload.minimizeToTray = minimizeToTrayInput.checked;
    if (closeToTrayInput) payload.closeToTray = closeToTrayInput.checked;

    const enabledModules: Record<string, boolean> = {};
    document.querySelectorAll<HTMLInputElement>("[data-config-module]").forEach((cb) => {
      const modName = cb.dataset.configModule;
      if (modName) enabledModules[modName] = cb.checked;
    });
    payload.enabledModules = enabledModules;

    const res = (await window.jarvisDesktop.updateConfig(payload)) as { message: string };
    hasUnsavedSettings = false;

    const statusEl = optionalElement<HTMLElement>("[data-settings-status-msg]");
    if (statusEl) {
      statusEl.textContent = "✅ Einstellungen erfolgreich auf Festplatte gespeichert!";
      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 4000);
    }

    addEntry("system", `⚙️ ${res.message}`);
    await refreshRuntimeStatus();
    return true;
  } catch (err) {
    addEntry("warning", `Fehler beim Speichern der Einstellungen: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Bei jeder Änderung in den Einstellungen merken wir uns ungespeicherte Änderungen
settingsForm?.addEventListener("input", () => {
  hasUnsavedSettings = true;
});
settingsForm?.addEventListener("change", () => {
  hasUnsavedSettings = true;
});

settingsForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveAllSettings();
});

// The global SPEICHERN button sits OUTSIDE the <form> element in index.html,
// so a plain type="submit" never fires the form's submit event. Bind it directly.
optionalElement<HTMLButtonElement>("[data-save-settings-btn]")?.addEventListener("click", async () => {
  await saveAllSettings();
});

// Confirm Modal Handler
optionalElement<HTMLButtonElement>("[data-confirm-save-close]")?.addEventListener("click", async () => {
  if (confirmModalEl) confirmModalEl.hidden = true;
  const saved = await saveAllSettings();
  if (saved) {
    forceCloseDrawer();
  }
});

optionalElement<HTMLButtonElement>("[data-confirm-discard-close]")?.addEventListener("click", async () => {
  if (confirmModalEl) confirmModalEl.hidden = true;
  await loadSettings();
  hasUnsavedSettings = false;
  forceCloseDrawer();
});

optionalElement<HTMLButtonElement>("[data-confirm-cancel]")?.addEventListener("click", () => {
  if (confirmModalEl) confirmModalEl.hidden = true;
});

document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const sectionKey = btn.dataset.settingsTab;
    if (!sectionKey) return;

    document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((b) => {
      b.classList.toggle("settings-tab--active", b.dataset.settingsTab === sectionKey);
    });

    document.querySelectorAll<HTMLElement>("[data-settings-section]").forEach((sec) => {
      sec.hidden = sec.dataset.settingsSection !== sectionKey;
    });
  });
});

const lifeosPanelBox = optionalElement<HTMLElement>("[data-lifeos-panel]");
const lifeosMissionEl = optionalElement<HTMLElement>("[data-lifeos-mission]");
const lifeosValuesEl = optionalElement<HTMLElement>("[data-lifeos-values]");
const lifeosCurrentStateEl = optionalElement<HTMLElement>("[data-lifeos-current-state]");
const refreshLifeosBtn = optionalElement<HTMLButtonElement>("[data-refresh-lifeos]");

type DrawerTabKey = "lifeos" | "settings" | "memory" | "files" | "browser" | "agents" | "workflows" | "knowledge";

interface DrawerTarget {
  key: DrawerTabKey;
  title: string;
  panel: HTMLElement | null;
  loadFn?: () => void | Promise<void>;
}

async function loadLifeOSData(): Promise<void> {
  try {
    if (lifeosMissionEl) {
      try {
        const file = await window.jarvisDesktop.readFileContent(".agent/telos/MISSION.md");
        lifeosMissionEl.textContent = file.content;
      } catch {
        lifeosMissionEl.textContent = "🎯 MISSION\n• Jarvis Souveränes AI OS\n• Rich Aesthetics & Modernes Webdesign\n• Modulare & Zuverlässige Systemarchitektur";
      }
    }
    if (lifeosValuesEl) {
      try {
        const file = await window.jarvisDesktop.readFileContent(".agent/telos/VALUES.md");
        lifeosValuesEl.textContent = file.content;
      } catch {
        lifeosValuesEl.textContent = "💎 CORE VALUES\n• Plain-Text First & Ripgrep\n• Rich Aesthetics & Visual Excellence\n• Modularität & Clean Code";
      }
    }
    if (lifeosCurrentStateEl) {
      try {
        const file = await window.jarvisDesktop.readFileContent(".agent/telos/CURRENT_STATE.md");
        lifeosCurrentStateEl.textContent = file.content;
      } catch {
        lifeosCurrentStateEl.textContent = "📊 CURRENT STATE\n• Jarvis Desktop UI aktiv\n• LifeOS Integration in Arbeit";
      }
    }
  } catch (err) {
    console.warn("Fehler beim Laden der LifeOS Daten:", err);
  }
}

refreshLifeosBtn?.addEventListener("click", () => void loadLifeOSData());

const drawerTabMap: Record<DrawerTabKey, DrawerTarget> = {
  lifeos: { key: "lifeos", title: "🎯 LIFEOS & TELOS GOVERNANCE DASHBOARD", panel: lifeosPanelBox, loadFn: loadLifeOSData },
  settings: { key: "settings", title: "⚙️ SYSTEM SETTINGS & CONFIGURATION", panel: settingsPanelBox, loadFn: loadSettings },
  memory: { key: "memory", title: "🧠 LONG-TERM MEMORY INSPECTOR", panel: memoryPanelBox, loadFn: loadMemoryItems },
  files: { key: "files", title: "📁 FILE MANAGEMENT & DOCUMENT RAG", panel: filesPanelBox, loadFn: () => { void loadProjectFiles(); void performRagSearch(""); } },
  browser: { key: "browser", title: "🌐 BROWSER AUTOMATION & WEB GATHERING", panel: browserPanelBox },
  agents: { key: "agents", title: "🤖 SUB-AGENT COLLABORATION TEAM", panel: agentsPanelBox },
  workflows: { key: "workflows", title: "⚡ WORKFLOW AUTOMATION & ROUTINES", panel: workflowsPanelBox, loadFn: loadWorkflows },
  knowledge: { key: "knowledge", title: "📚 SECOND BRAIN KNOWLEDGE BASE", panel: knowledgePanelBox, loadFn: () => loadKnowledgeItems("") },
};

function openDrawer(tabKey: DrawerTabKey): void {
  const target = drawerTabMap[tabKey];
  if (!target) return;

  // Tab panels now live in the central stage (like Core/Chat), not a side drawer.
  setStageView(tabKey);

  if (tabKey === "settings") {
    document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((b) => {
      b.classList.toggle("settings-tab--active", b.dataset.settingsTab === "keys");
    });
    document.querySelectorAll<HTMLElement>("[data-settings-section]").forEach((sec) => {
      sec.hidden = sec.dataset.settingsSection !== "keys";
    });
  }

  if (target.loadFn) {
    void target.loadFn();
  }
}

function forceCloseDrawer(): void {
  if (!hudDrawerEl) return;
  if (confirmModalEl) confirmModalEl.hidden = true;
  hudDrawerEl.hidden = true;
  delete hudDrawerEl.dataset.activeTab;
  syncPillStates(null);
}

function closeDrawer(): void {
  if (hudDrawerEl) {
    if (hasUnsavedSettings) {
      if (confirmModalEl) confirmModalEl.hidden = false;
      return;
    }
    forceCloseDrawer();
    return;
  }
  // No overlay drawer anymore — tab panels live in the central stage.
  if (hasUnsavedSettings) {
    if (confirmModalEl) confirmModalEl.hidden = false;
    return;
  }
  setStageView(null);
}

function syncPillStates(activeKey: DrawerTabKey | null): void {
  const selectorMap: Record<DrawerTabKey, string> = {
    lifeos: "[data-toggle-lifeos-panel]",
    settings: "[data-toggle-settings-panel]",
    memory: "[data-toggle-memory-panel]",
    files: "[data-toggle-files-panel]",
    browser: "[data-toggle-browser-panel]",
    agents: "[data-toggle-agents-panel]",
    workflows: "[data-toggle-workflows-panel]",
    knowledge: "[data-toggle-knowledge-panel]",
  };

  const isDrawerOpen = hudDrawerEl !== null && !hudDrawerEl.hidden;
  const isSameKey = activeKey === lastDrawerKey;
  if (isDrawerOpen && isSameKey && activeKey !== null) {
    forceCloseDrawer();
    return;
  }
  if (activeKey !== null) lastDrawerKey = activeKey;

  document.querySelectorAll<HTMLElement>(".shell-nav-item").forEach((item) => {
    item.dataset.active = "false";
  });

  (Object.keys(selectorMap) as DrawerTabKey[]).forEach((key) => {
    const sel = selectorMap[key];
    const isCurrentActive = activeKey !== null && activeKey === key && hudDrawerEl !== null && !hudDrawerEl.hidden;
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      el.dataset.active = String(isCurrentActive);
    });
  });

  if (activeKey === null && lastSurfaceNav) {
    lastSurfaceNav.dataset.active = "true";
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-close-drawer]").forEach((btn) => {
  btn.addEventListener("click", closeDrawer);
});

document.addEventListener("mousedown", (e) => {
  if (!hudDrawerEl || hudDrawerEl.hidden) return;
  const target = e.target as Node;
  const isInsideOverlay = hudDrawerEl.contains(target);
  const isPillClick = target instanceof Element && target.closest("[data-toggle-lifeos-panel], [data-toggle-settings-panel], [data-toggle-memory-panel], [data-toggle-files-panel], [data-toggle-browser-panel], [data-toggle-agents-panel], [data-toggle-workflows-panel], [data-toggle-knowledge-panel], [data-toggle-diagnostics-panel]");
  if (!isInsideOverlay && !isPillClick) {
    closeDrawer();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && hudDrawerEl && !hudDrawerEl.hidden) {
    closeDrawer();
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-drawer-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabKey = btn.dataset.drawerTab as DrawerTabKey | undefined;
    if (tabKey) openDrawer(tabKey);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-lifeos-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("lifeos"));
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-settings-panel]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.stage === "active") {
      setStageView(null); // back to home
      delete btn.dataset.stage;
    } else {
      openDrawer("settings");
      btn.dataset.stage = "active";
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-memory-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("memory"));
});

// 🌐 Local ↔ Cloud Mode Switcher Handler
const modeSwitchBtn = optionalElement<HTMLButtonElement>("[data-toggle-model-mode]");
const modeSwitchIcon = optionalElement<HTMLElement>("[data-model-mode-icon]");
const modeSwitchText = optionalElement<HTMLElement>("[data-model-mode-text]");

function updateModelModeUI(mode: "cloud" | "local"): void {
  activeModelMode = mode;
  if (modeSwitchBtn) modeSwitchBtn.dataset.mode = mode;
  if (modeSwitchIcon) modeSwitchIcon.textContent = mode === "cloud" ? "🌐" : "🏠";
  if (modeSwitchText) modeSwitchText.textContent = mode === "cloud" ? "CLOUD (GROK)" : "LOCAL (OLLAMA)";

  applyOrbState(previewState ?? liveState);

  if (input) {
    input.placeholder = mode === "cloud"
      ? "Frag J.A.R.V.I.S. (Cloud Grok) oder tippe > Befehl..."
      : "Frag J.A.R.V.I.S. (Local Ollama Qwen) oder tippe > Befehl...";
  }

  if (mode === "local") {
    void window.jarvisDesktop.ensureOllama().then((res) => {
      if (res.message) addEntry("system", `⚡ ${res.message}`);
      void refreshRuntimeStatus();
    });
  }
}

modeSwitchBtn?.addEventListener("click", () => {
  const newMode = activeModelMode === "cloud" ? "local" : "cloud";
  updateModelModeUI(newMode);
  addEntry("system", `🔄 KI-Modell-Modus gewechselt zu: ${newMode === "cloud" ? "Cloud xAI Grok API" : "Lokales Ollama Qwen Modul (127.0.0.1:11434)"}`);
});

addMemoryForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const catInput = optionalElement<HTMLSelectElement>("[data-memory-cat-input]");
  const keyInput = optionalElement<HTMLInputElement>("[data-memory-key-input]");
  const valInput = optionalElement<HTMLInputElement>("[data-memory-val-input]");

  const category = (catInput?.value as JarvisMemoryCategory) || "operator_preference";
  const key = keyInput?.value.trim() ?? "";
  const value = valInput?.value.trim() ?? "";

  if (!key || !value) return;

  try {
    const newItem = await window.jarvisDesktop.addMemoryItem({
      category,
      key,
      value,
      provenance: "manual_entry",
    });
    if (keyInput) keyInput.value = "";
    if (valInput) valInput.value = "";
    addEntry("system", `Neue Erinnerung gespeichert: ${newItem.key} = ${newItem.value}`);
    await refreshRuntimeStatus();
  } catch (err) {
    addEntry("warning", `Fehler beim Speichern der Erinnerung: ${err instanceof Error ? err.message : String(err)}`);
  }
});

async function loadProjectFiles(dir = ""): Promise<void> {
  if (!fileListEl) return;
  fileListEl.replaceChildren();

  try {
    const files = await window.jarvisDesktop.listProjectFiles(dir);
    if (files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "file-item";
      empty.textContent = "Ordner ist leer.";
      fileListEl.append(empty);
      return;
    }

    for (const item of files) {
      const li = document.createElement("li");
      li.className = "file-item";

      const name = document.createElement("span");
      name.className = "file-item__name";
      name.textContent = `${item.isDirectory ? "📁" : "📄"} ${item.name}`;

      const size = document.createElement("span");
      size.className = "file-item__size";
      size.textContent = item.sizeBytes !== undefined ? `${(item.sizeBytes / 1024).toFixed(1)} KB` : "";

      li.append(name, size);

      li.addEventListener("click", async () => {
        if (item.isDirectory) {
          void loadProjectFiles(item.path);
        } else {
          try {
            const fileData = await window.jarvisDesktop.readFileContent(item.path);
            if (filePreviewTitle) filePreviewTitle.textContent = `📄 ${fileData.path}`;
            if (filePreviewCode) filePreviewCode.textContent = fileData.content;
            if (filePreviewBox) filePreviewBox.hidden = false;
          } catch (err) {
            addEntry("warning", `Fehler beim Lesen der Datei: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      });

      fileListEl.append(li);
    }
  } catch (err) {
    console.warn("Fehler beim Auflisten der Dateien:", err);
  }
}

async function performRagSearch(query: string): Promise<void> {
  if (!ragResultsEl) return;
  ragResultsEl.replaceChildren();

  if (!query.trim()) {
    const hint = document.createElement("div");
    hint.className = "rag-card";
    hint.style.opacity = "0.6";
    hint.textContent = "Tippe einen Suchbegriff ein (z.B. 'Design' oder 'TTS').";
    ragResultsEl.append(hint);
    return;
  }

  try {
    const res = await window.jarvisDesktop.queryDocumentRag(query.trim(), 5);
    if (res.chunks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rag-card";
      empty.style.opacity = "0.6";
      empty.textContent = `Keine Treffer für '${query}' in Projekt-Dokumenten gefunden.`;
      ragResultsEl.append(empty);
      return;
    }

    for (const chunk of res.chunks) {
      const card = document.createElement("div");
      card.className = "rag-card";

      const header = document.createElement("div");
      header.className = "rag-card__header";

      const fileInfo = document.createElement("span");
      fileInfo.textContent = `📄 ${chunk.filePath} (L${chunk.lineStart}-${chunk.lineEnd})`;

      const scoreInfo = document.createElement("span");
      scoreInfo.textContent = `Score: ${chunk.score}`;

      header.append(fileInfo, scoreInfo);

      const body = document.createElement("div");
      body.className = "rag-card__body";
      body.textContent = chunk.content;

      card.append(header, body);
      ragResultsEl.append(card);
    }
  } catch (err) {
    console.warn("RAG Suchfehler:", err);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-files-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("files"));
});

ragSearchInput?.addEventListener("input", (e) => {
  void performRagSearch((e.target as HTMLInputElement).value);
});

closeFilePreviewBtn?.addEventListener("click", () => {
  if (filePreviewBox) filePreviewBox.hidden = true;
});

async function handleWebSearch(query: string): Promise<void> {
  if (!browserResultsBox || !query.trim()) return;
  browserResultsBox.replaceChildren();

  const loading = document.createElement("div");
  loading.className = "web-card";
  loading.style.opacity = "0.7";
  loading.textContent = `🔍 Durchsuche Web nach '${query}'...`;
  browserResultsBox.append(loading);

  try {
    const res = await window.jarvisDesktop.searchWeb(query.trim(), 4);
    browserResultsBox.replaceChildren();

    if (res.results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "web-card";
      empty.textContent = "Keine Web-Ergebnisse gefunden.";
      browserResultsBox.append(empty);
      return;
    }

    for (const item of res.results) {
      const card = document.createElement("div");
      card.className = "web-card";

      const titleLink = document.createElement("a");
      titleLink.className = "web-card__title";
      titleLink.href = item.url;
      titleLink.target = "_blank";
      titleLink.rel = "noreferrer";
      titleLink.textContent = item.title;

      const urlSpan = document.createElement("span");
      urlSpan.className = "web-card__url";
      urlSpan.textContent = item.url;

      const snippet = document.createElement("div");
      snippet.className = "web-card__snippet";
      snippet.textContent = item.snippet;

      const attachBtn = document.createElement("button");
      attachBtn.type = "button";
      attachBtn.className = "web-card__attach";
      attachBtn.textContent = "+ An Chat anheften";
      attachBtn.addEventListener("click", () => {
        if (input) {
          input.value = `Web-Recherche [${item.title}](${item.url}): ${item.snippet}`;
          input.focus();
        }
      });

      card.append(titleLink, urlSpan, snippet, attachBtn);
      browserResultsBox.append(card);
    }
  } catch (err) {
    browserResultsBox.replaceChildren();
    addEntry("warning", `Websuche-Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleWebFetch(urlStr: string): Promise<void> {
  if (!browserResultsBox || !urlStr.trim()) return;
  browserResultsBox.replaceChildren();

  const loading = document.createElement("div");
  loading.className = "web-card";
  loading.style.opacity = "0.7";
  loading.textContent = `⚡ Rufe Webseite '${urlStr}' ab...`;
  browserResultsBox.append(loading);

  try {
    const page = await window.jarvisDesktop.fetchWebPage(urlStr.trim());
    browserResultsBox.replaceChildren();

    const card = document.createElement("div");
    card.className = "web-card";

    const titleLink = document.createElement("a");
    titleLink.className = "web-card__title";
    titleLink.href = page.url;
    titleLink.target = "_blank";
    titleLink.rel = "noreferrer";
    titleLink.textContent = `📄 ${page.title}`;

    const urlSpan = document.createElement("span");
    urlSpan.className = "web-card__url";
    urlSpan.textContent = page.url;

    const contentBox = document.createElement("div");
    contentBox.className = "web-card__snippet";
    contentBox.style.maxHeight = "120px";
    contentBox.textContent = page.content;

    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "web-card__attach";
    attachBtn.textContent = "+ An Chat anheften";
    attachBtn.addEventListener("click", () => {
      if (input) {
        input.value = `Webseiten-Inhalt von ${page.url}:\n${page.content.slice(0, 1500)}`;
        input.focus();
      }
    });

    card.append(titleLink, urlSpan, contentBox, attachBtn);
    browserResultsBox.append(card);
  } catch (err) {
    browserResultsBox.replaceChildren();
    addEntry("warning", `Webseiten-Abruf-Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-browser-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("browser"));
});

// Real-Time Diagnostics UI & Event Handling
const diagXaiLatency = optionalElement<HTMLElement>("[data-diag-xai-latency]");
const diagRam = optionalElement<HTMLElement>("[data-diag-ram]");
const diagUptime = optionalElement<HTMLElement>("[data-diag-uptime]");
const diagMemories = optionalElement<HTMLElement>("[data-diag-memories]");
const diagKnowledge = optionalElement<HTMLElement>("[data-diag-knowledge]");
const diagWorkflows = optionalElement<HTMLElement>("[data-diag-workflows]");

async function refreshDiagnostics(): Promise<void> {
  try {
    const data = await window.jarvisDesktop.getDiagnostics();
    if (diagXaiLatency) diagXaiLatency.textContent = data.latency.xaiApiMs > 0 ? `${data.latency.xaiApiMs} ms` : "OFFLINE";
    if (diagRam) diagRam.textContent = `${data.memory.heapUsedMb} / ${data.memory.rssMb} MB`;
    if (diagUptime) diagUptime.textContent = `${data.uptimeSeconds}s`;
    if (diagMemories) diagMemories.textContent = String(data.stats.memoriesCount);
    if (diagKnowledge) diagKnowledge.textContent = String(data.stats.knowledgeCount);
    if (diagWorkflows) diagWorkflows.textContent = String(data.stats.workflowsCount);
  } catch (err) {
    console.warn("Fehler beim Abrufen der Diagnose:", err);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-diagnostics-panel]").forEach((btn) => {
  btn.addEventListener("click", () => showTelemetryPanel());
});

setInterval(() => void refreshDiagnostics(), 5_000);

// Personal Knowledge Base UI & Event Handling
const knowledgeSearchInput = optionalElement<HTMLInputElement>("[data-knowledge-search]");
const knowledgeListEl = optionalElement<HTMLElement>("[data-knowledge-list]");
const knowledgeForm = optionalElement<HTMLFormElement>("[data-knowledge-form]");
const knowledgeTitleInput = optionalElement<HTMLInputElement>("[data-knowledge-title-input]");
const knowledgeCategorySelect = optionalElement<HTMLSelectElement>("[data-knowledge-category-select]");
const knowledgeTagsInput = optionalElement<HTMLInputElement>("[data-knowledge-tags-input]");
const knowledgeContentInput = optionalElement<HTMLTextAreaElement>("[data-knowledge-content-input]");

async function loadKnowledgeItems(queryStr = ""): Promise<void> {
  if (!knowledgeListEl) return;
  try {
    const items = await window.jarvisDesktop.getKnowledgeItems({ query: queryStr });
    knowledgeListEl.replaceChildren();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "knowledge-card";
      empty.style.opacity = "0.6";
      empty.textContent = "Keine Notizen in Eds Second Brain gefunden.";
      knowledgeListEl.append(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "knowledge-card";

      const header = document.createElement("div");
      header.className = "knowledge-card__header";

      const title = document.createElement("span");
      title.className = "knowledge-card__title";
      title.textContent = `📚 ${item.title}`;

      const cat = document.createElement("span");
      cat.className = "knowledge-card__category";
      cat.textContent = (item as any).category ?? "";

      header.append(title, cat);

      const body = document.createElement("div");
      body.className = "knowledge-card__body";
      body.textContent = item.content;

      const footer = document.createElement("div");
      footer.className = "knowledge-card__footer";

      const tags = document.createElement("span");
      tags.className = "knowledge-card__tags";
      tags.textContent = item.tags && item.tags.length > 0 ? `Tags: #${item.tags.join(" #")}` : "";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "knowledge-card__del";
      delBtn.textContent = "✖ Löschen";
      delBtn.addEventListener("click", async () => {
        await window.jarvisDesktop.deleteKnowledgeItem(item.id);
        void loadKnowledgeItems(knowledgeSearchInput?.value ?? "");
      });

      footer.append(tags, delBtn);
      card.append(header, body, footer);
      knowledgeListEl.append(card);
    }
  } catch (err) {
    console.warn("Fehler beim Laden der Knowledge Base:", err);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-knowledge-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("knowledge"));
});

knowledgeSearchInput?.addEventListener("input", (e) => {
  void loadKnowledgeItems((e.target as HTMLInputElement).value);
});

knowledgeForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!knowledgeTitleInput || !knowledgeCategorySelect || !knowledgeContentInput) return;
  const title = knowledgeTitleInput.value.trim();
  const category = knowledgeCategorySelect.value as any;
  const tags = knowledgeTagsInput ? knowledgeTagsInput.value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const content = knowledgeContentInput.value.trim();

  if (!title || !content) return;

  try {
    await window.jarvisDesktop.addKnowledgeItem({ title, category, tags, content });
    knowledgeTitleInput.value = "";
    if (knowledgeTagsInput) knowledgeTagsInput.value = "";
    knowledgeContentInput.value = "";
    void loadKnowledgeItems(knowledgeSearchInput?.value ?? "");
    addEntry("system", `📚 Wissen '${title}' erfolgreich im Second Brain gespeichert!`);
  } catch (err) {
    addEntry("warning", `Knowledge Speichern Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Workflow Automation UI & Event Handling
const workflowsListEl = optionalElement<HTMLElement>("[data-workflows-list]");

async function loadWorkflows(): Promise<void> {
  if (!workflowsListEl) return;
  try {
    const list = await window.jarvisDesktop.getWorkflows();
    workflowsListEl.replaceChildren();
    for (const wf of list) {
      const card = document.createElement("div");
      card.className = "workflow-card";

      const info = document.createElement("div");
      info.className = "workflow-info";

      const title = document.createElement("span");
      title.className = "workflow-title";
      title.textContent = `⚡ ${wf.name}`;

      const desc = document.createElement("span");
      desc.className = "workflow-desc";
      desc.textContent = wf.description ?? "";

      const triggers = document.createElement("span");
      triggers.className = "workflow-triggers";
      triggers.textContent = `Trigger: "${Array.isArray(wf.triggerPhrases) ? wf.triggerPhrases.join('", "') : ""}"`;

      info.append(title, desc, triggers);

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "workflow-run-btn";
      runBtn.textContent = "▶ Ausführen";
      runBtn.addEventListener("click", () => void handleRunWorkflow(wf.id));

      card.append(info, runBtn);
      workflowsListEl.append(card);
    }
  } catch (err) {
    console.warn("Fehler beim Laden der Workflows:", err);
  }
}

async function handleRunWorkflow(idOrTrigger: string): Promise<void> {
  addEntry("system", `⚡ Starte Workflow-Routine: '${idOrTrigger}'...`);
  setLiveState("executing-approved");
  try {
    const res = await window.jarvisDesktop.runWorkflow(idOrTrigger);
    const summaryMsg = (res as any).summary ?? "Workflow abgeschlossen";
    addEntry("system", `✅ ${summaryMsg}`);
    void speakJarvisResponse(summaryMsg);
  } catch (err) {
    addEntry("warning", `Workflow Fehler: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-toggle-workflows-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("workflows"));
});

// AI Agents Sub-System UI & Event Handling
const agentsForm = optionalElement<HTMLFormElement>("[data-agents-form]");
const agentsGoalInput = optionalElement<HTMLInputElement>("[data-agents-goal-input]");
const agentsTaskList = optionalElement<HTMLUListElement>("[data-agents-task-list]");

document.querySelectorAll<HTMLButtonElement>("[data-toggle-agents-panel]").forEach((btn) => {
  btn.addEventListener("click", () => openDrawer("agents"));
});

async function handleAgentCollaboration(goal: string): Promise<void> {
  if (!goal.trim()) return;
  addEntry("system", `🚀 Sub-Agenten Team gestartet für Ziel: '${goal}'...`);
  setLiveState("thinking");

  ["planner", "researcher", "coder", "reviewer"].forEach((role) => {
    const el = optionalElement<HTMLElement>(`[data-agent-status="${role}"]`);
    if (el) {
      el.dataset.agentStatus = "running";
      el.textContent = "RUNNING";
    }
  });

  try {
    const res = await window.jarvisDesktop.startAgentCollaboration(goal.trim());

    if (Array.isArray(res.tasks)) {
      res.tasks.forEach((task: any) => {
        const el = optionalElement<HTMLElement>(`[data-agent-status="${task.role}"]`);
        if (el) {
          el.dataset.agentStatus = task.status;
          el.textContent = String(task.status).toUpperCase();
        }
      });

      if (agentsTaskList) {
        agentsTaskList.replaceChildren();
        for (const t of res.tasks) {
          const item = document.createElement("li");
          item.style.fontSize = "0.58rem";
          item.style.padding = "4px 8px";
          item.style.background = "rgba(0,0,0,0.3)";
          item.style.borderRadius = "3px";
          item.style.border = "1px solid rgba(84,230,255,0.1)";
          item.textContent = `[${String(t.role).toUpperCase()}] ${t.goal} → ${t.output?.slice(0, 150) ?? t.error ?? "Done"}`;
          agentsTaskList.append(item);
        }
      }
    }

    addEntry("assistant", `### MULTI-AGENTEN BERICHT ZU: ${res.goal}\n\n${res.summary}`);
    void speakJarvisResponse(`Multi-Agenten Analyse für ${res.goal} erfolgreich abgeschlossen.`);
  } catch (err) {
    addEntry("warning", `Sub-Agenten Fehler: ${err instanceof Error ? err.message : String(err)}`);
    ["planner", "researcher", "coder", "reviewer"].forEach((role) => {
      const el = optionalElement<HTMLElement>(`[data-agent-status="${role}"]`);
      if (el) {
        el.dataset.agentStatus = "failed";
        el.textContent = "FAILED";
      }
    });
  } finally {
    if (readiness?.status === "ready" && activeRequestId === undefined) setLiveState("ready");
  }
}

agentsForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (agentsGoalInput && agentsGoalInput.value.trim()) {
    const goal = agentsGoalInput.value.trim();
    agentsGoalInput.value = "";
    void handleAgentCollaboration(goal);
  }
});

webSearchForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (webSearchInput) void handleWebSearch(webSearchInput.value);
});

webFetchForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (webUrlInput) void handleWebFetch(webUrlInput.value);
});

// Mic-Button in der Chat-Form (data-mic-toggle)
optionalElement<HTMLButtonElement>("[data-mic-toggle]")?.addEventListener("click", () => void toggleVoiceMute());
document.querySelectorAll<HTMLButtonElement>("[data-feed-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-feed-filter]").forEach((b) => b.classList.remove("feed-tab--active"));
    btn.classList.add("feed-tab--active");
    feedFilter = (btn.dataset.feedFilter as "all" | "chat" | "system") || "all";
    renderTranscript();
  });
});

const copyCmdBtn = optionalElement<HTMLButtonElement>("[data-copy-model-command]");
copyCmdBtn?.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(modelCommand?.textContent ?? `ollama pull ${DEFAULT_OLLAMA_MODEL}`);
    if (modelCopyStatus) modelCopyStatus.textContent = "Command copied. Nothing was run.";
  } catch {
    if (modelCopyStatus) modelCopyStatus.textContent = "Copy failed. Select the command and copy it manually.";
  }
});
const runModelBtn = optionalElement<HTMLButtonElement>("[data-run-model-command]");
runModelBtn?.addEventListener("click", () => {
  const cmd = modelCommand?.textContent ?? `ollama pull ${DEFAULT_OLLAMA_MODEL}`;
  void runTerminalCommand(cmd);
});
cancelButton?.addEventListener("click", () => {
  stopConversation();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    stopConversation();
  }
});
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCurrentMessage();
});
reduceMotion.addEventListener("change", () => applyOrbState(previewState ?? liveState));
window.jarvisDesktop.onChatEvent(handleChatEvent);
window.jarvisDesktop.onLiveEvent(handleLiveEvent);

// ── Auto-Update Anzeige (Sidebar, unter "Gateway ready") ──
// Backend sendet `jarvis:updater-state` (s. main.ts). Wir zeigen ein
// dezentes Badge + "Neu starten"-Button, sobald ein Update da ist.
function setupUpdaterBanner(): void {
  const banner = document.getElementById("updater-banner");
  const text = document.getElementById("updater-text");
  const installBtn = document.getElementById("updater-install-btn");
  if (!banner || !text || !installBtn) return;

  // Nur anzeigen, wenn wir in einem gepackten Build laufen (Dev hat keinen updater).
  const tryShow = (state: { status: string; info?: unknown; progress?: number } | null): void => {
    if (!state) return;
    const status = state.status;
    if (status === "available" || status === "downloading" || status === "downloaded") {
      banner.hidden = false;
      if (status === "downloading") {
        const pct = typeof state.progress === "number" ? ` (${state.progress}%)` : "";
        text.textContent = `Update wird geladen${pct}`;
        installBtn.hidden = true;
      } else if (status === "downloaded") {
        text.textContent = "Update bereit — neu starten?";
        installBtn.hidden = false;
      } else {
        text.textContent = "Update verfügbar";
        installBtn.hidden = false;
      }
    } else if (status === "not-available" || status === "idle" || status === "error") {
      banner.hidden = true;
    }
  };

  tryShow((window as any).__updaterState ?? null);

  if (window.jarvisDesktop.onUpdaterState) {
    window.jarvisDesktop.onUpdaterState((state) => {
      (window as any).__updaterState = state;
      tryShow(state);
    });
  }

  installBtn.addEventListener("click", () => {
    void window.jarvisDesktop.quitAndInstall?.();
  });
}

setupUpdaterBanner();
addEntry("system", "Private Control Room initialized. Voice STT (Auto-Send) & High-Quality TTS ready.");
void loadSettings();
applyOrbState("idle"); void refreshRuntimeStatus().then(() => addEntry(readiness?.status === "ready" ? "system" : "warning", readiness?.status === "ready" ? "Local Qwen3 8B chat is ready." : "Local model guidance is available; no download was started."));
setInterval(() => void refreshRuntimeStatus(), 10_000);

// App-Start: Kamera-Berechtigung aktiv anfordern (triggert den OS-Dialog).
// Auf Windows/Linux ist getUserMedia der einzige Weg; auf macOS ergänzt
// systemPreferences.askForMediaAccess (s. main.ts). Stream wird nach dem
// Dialog sofort freigegeben — Barehands holt sich seinen eigenen Stream.
async function requestCameraOnStartup(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    addEntry("system", "Kameraberechtigung erteilt — Barehands ist bereit.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addEntry("warning", `Kameraberechtigung fehlgeschlagen: ${msg} — Barehands benötigt Kamerazugriff (Systemeinstellungen prüfen).`);
  }
}
void requestCameraOnStartup();
