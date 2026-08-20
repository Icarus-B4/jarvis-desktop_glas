/**
 * xAI Voice-Adapter (STT + TTS)
 * STT: POST https://api.x.ai/v1/stt  — Whisper-kompatibles Endpoint
 * TTS: POST https://api.x.ai/v1/tts  — liefert MP3-Audio
 */

import type { JarvisVoiceStatus } from "@jarvis/shared";

export type JarvisVoiceAdapter = {
  getStatus(): JarvisVoiceStatus;
  setMute(muted: boolean): JarvisVoiceStatus;
};

/** Einfacher Standard-Adapter (kein echtes STT/TTS) */
export class DefaultJarvisVoiceAdapter implements JarvisVoiceAdapter {
  private muted = false;

  getStatus(): JarvisVoiceStatus {
    return {
      muted: this.muted,
      micPermission: "granted",
      wakewordEngine: { provider: "openwakeword", status: "disabled" },
      sttEngine: { provider: "xai_whisper", status: "ready" },
      ttsEngine: { provider: "xai_tts", status: "ready" },
    };
  }

  setMute(muted: boolean): JarvisVoiceStatus {
    this.muted = muted;
    return this.getStatus();
  }
}

/** xAI STT-Anfrage: Audiodaten (WAV/WebM) → Text */
// STT is hard-pinned to German. The prompt biases xAI Whisper strongly
// toward German transcription even when the audio is noisy or contains
// proper nouns / website names (e.g. "Webstark", "Wikipedia"), which
// Whisper otherwise misreads as other languages (Danish, Kauderwelsch).
const XAI_STT_PROMPT = "Transkribiere ausschließlich auf Deutsch. Erkenne deutsche Befehle, Webseiten-Namen (z. B. Webstark, Wikipedia) und Eigennamen korrekt. Gib nur den gesprochenen Text zurück.";

export async function transcribeWithXai(
  audioData: ArrayBuffer,
  mimeType: string,
  apiKey: string,
  language: string = "de-DE",
): Promise<string> {
  const XAI_STT_URL = "https://api.x.ai/v1/stt";

  // Multipart-FormData aufbauen
  const form = new FormData();
  const blob = new Blob([audioData], { type: mimeType });
  form.append("file", blob, mimeType.includes("webm") ? "audio.webm" : "audio.wav");
  form.append("language", language);
  form.append("prompt", XAI_STT_PROMPT);
  form.append("response_format", "json");

  const response = await fetch(XAI_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`xAI STT Fehler ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as { text?: string; transcript?: string };
  return result.text ?? result.transcript ?? "";
}

/** xAI TTS-Anfrage: Text → MP3-ArrayBuffer */
export async function synthesizeWithXai(
  text: string,
  apiKey: string,
  voice = "zenith",
  language = "de",
): Promise<ArrayBuffer> {
  const XAI_TTS_URL = "https://api.x.ai/v1/tts";

  const response = await fetch(XAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      language,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`xAI TTS Fehler ${response.status}: ${errorText}`);
  }

  return response.arrayBuffer();
}

/** Fish Audio TTS-Anfrage: Text → MP3-ArrayBuffer */
export async function synthesizeWithFishAudio(
  text: string,
  apiKey: string,
  referenceId = "5906764e120a4c608a524f351a5fe5be",
  format = "mp3",
): Promise<ArrayBuffer> {
  const FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts";

  const response = await fetch(FISH_AUDIO_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reference_id: referenceId,
      format,
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let msg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.message) msg = parsed.message;
    } catch {}
    throw new Error(`Fish Audio TTS (HTTP ${response.status}): ${msg}`);
  }

  return response.arrayBuffer();
}

