# J.A.R.V.I.S. Desktop Glas — Wiki Home

**Private AI Control Room · Voice · Vision · Automation · Bare-Hand Interaction**

A local-first, Windows-native AI control room that turns typed or spoken intent into visible, validated desktop actions.

> ⚠️ This repository is **alpha-stage** developer software. Suitable for experimentation and collaborative development, not yet a hardened production release.

## What it is

J.A.R.V.I.S. Desktop Glas is a Windows-first AI desktop application built with **Electron, Bun, React, TypeScript and Three.js**. It combines a cinematic control-room interface with local system capabilities, cloud or local language models, voice interaction, visual analysis, workflow automation, persistent memory and webcam-based hand tracking.

**Core rule:** actions must be real, visible and bounded. Read-only questions are answered immediately. Sensitive or destructive operations (closing apps, vision-directed clicks, shutting down Windows) are represented as *action proposals* and require explicit user approval.

## Quick links

- [Architecture](Architecture) — process model, authority boundaries, repository layout
- [Features](Features) — voice, vision, Barehands, automation, memory, workflows
- [Setup & Development](Setup-&-Development) — install, configure, build, test
- [Security & Privacy](Security-&-Privacy) — local-only bindings, approval lifecycle, known limits

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Runtime / build / tests | Bun |
| Renderer UI | React + Three.js / React Three Fiber |
| Local service | Bun (HTTP/SSE loopback) |
| Cloud model | xAI Grok (chat, vision, STT, TTS) |
| Local model | Ollama / Qwen |
| Hand tracking | Barehands + Google MediaPipe Tasks Vision |

## License

GNU Affero General Public License v3 or later (`AGPL-3.0-or-later`). See `LICENSE` in the main repository.
