# Features

All capabilities come from the application's current build. Sensitive or destructive operations are *action proposals* that require explicit approval.

## AI and conversation

- Cloud conversation and vision through **xAI Grok** when `XAI_API_KEY` is configured.
- Local text conversation through **Ollama / Qwen**.
- Bounded tool loop with duplicate-call protection and typed tool results.
- German-first assistant identity and configurable silent-butler behavior through `SOUL.md`.
- Streaming responses over a local loopback service.

## Voice

- Continuous microphone mode with hard mute/unmute.
- xAI speech-to-text and text-to-speech integration.
- Immediate interruption commands: `Stop`, `Stopp`, `Abbrechen`, `Halt`.
- Deterministic Iron-Man mode commands:
  - `Aktiviere den Iron-Man-Modus`
  - `Deaktiviere den Iron-Man-Modus`

## Internal main stage

- Opens websites inside the application's **main stage**, not an uncontrolled external browser.
- Uses an Electron `<webview>` for sites that block ordinary iframe embedding.
- Deterministic URL and domain recognition.
- Internal views for camera, screenshots, action approvals, code, weather briefing and Barehands.

## Spotify and media

- Opens the user's Brave Spotify PWA through `%USERPROFILE%\Desktop\Spotify.lnk`.
- Reuses an already running Spotify PWA instead of opening duplicate windows.
- Searches for a title or artist and starts playback through Windows UI Automation.
- Supports play, pause, stop, next, previous, mute and system volume controls.
- Opens YouTube title searches inside the main stage.

## Windows and desktop automation

- Opens safe user folders through an allowlist: Desktop, Documents, Downloads, Pictures, Videos, Music.
- Starts approved applications through exact shortcuts or installation paths.
- Reads system-wide battery, CPU, RAM and Windows uptime information.
- Saves desktop screenshots as PNG files and displays them on the main stage.
- Can propose application closing and Windows shutdown actions (shutdown uses a 30-second delay and requires explicit approval).
- Advanced typed terminal commands remain a trusted-local-user feature and must not be exposed to untrusted input.

## Deterministic local commands

- Local time, date, month and year.
- Age calculation from exactly one persistently stored birth date.
- Arithmetic: addition, subtraction, multiplication, division, powers, squares and square roots.
- Distance and temperature conversions.
- Live EUR/USD conversion with a dated Frankfurter/ECB rate.
- Small offline dictionary for common German, English and Spanish words.
- Current weather for Biel/Bienne through Open-Meteo.
- Sports result/table searches with visible web sources.

## Memory, knowledge and files

- Persistent local memory with add, search, list and delete operations.
- Safe deletion: ambiguous memory matches are not removed automatically.
- Project file browsing and text retrieval.
- Knowledge and RAG surfaces for developer-oriented local context.

## Workflows

- Deterministic work mode:
  - Antigravity IDE
  - Proton Mail
  - Brave
  - Spotify PWA
- Individual workflow steps report actual success or failure.
- Missing applications are reported honestly instead of being guessed through fuzzy shell matching.

## Vision and camera

- Screen and camera frames can be sent to Grok Vision when explicitly requested.
- Natural camera requests ("How am I dressed?", "Identify this object") capture a real frame before analysis.
- No camera frame means no invented visual description.
- Vision-directed click and text insertion flow:
  1. capture current screen;
  2. ask Grok Vision for normalized target coordinates;
  3. create a visible action proposal;
  4. move/click/type only after explicit approval.
- Screenshot text is treated as untrusted data and explicitly excluded from the vision instruction channel.

## Barehands and system cursor

The integrated Barehands stage turns a webcam into a hand-tracked interface. Normal Barehands mode controls cards, notes, media and 3D objects inside the stage. System-cursor mode is separate:

```text
Aktiviere Cursorsteuerung
```

| Gesture | Result |
|---|---|
| Move the first detected hand | Move the Windows cursor |
| Short pinch and release | Left click |
| Hold pinch for at least 0.9 seconds, then release | Right click |
| `Deaktiviere Cursorsteuerung` | Return to internal Barehands mode |

The Barehands service is loopback-only at `http://127.0.0.1:8794`.

## Google Workspace

Without Google API credentials, Jarvis can use the authenticated web session on the internal stage:

- create a new Google Doc via `docs.new`;
- create a new Google Sheet via `sheets.new`;
- open Gmail;
- open Google Calendar;
- open today's calendar view.

Structured Gmail and Calendar reading requires a separate Google OAuth authorization and is intentionally disabled until the repository owner selects the required scopes.
