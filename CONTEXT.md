# Jarvis Desktop Glas — Konfiguration & Architektur-Kontext

## Übersicht
**Jarvis Desktop Glas** ist eine hochmoderne, native Control-Room Desktop-Anwendung (Electron + Bun + React + Three.js / Glasmorphism design).

## Tech Stack
- **Runtime & Bundler:** Bun
- **Desktop Container:** Electron
- **Frontend & UI:** React, React Three Fiber, Vanilla CSS3 (Glasmorphic Dark Theme)
- **Voice & Audio:** Web Audio API (VAD), xAI Whisper STT, xAI Zenith / Fish Audio TTS
- **Backend Service:** Local HTTP/IPC Stream Bridge (`http://127.0.0.1:4317`) & Ollama Integration (`http://127.0.0.1:11434`)
- **Workspace Architecture:** Bun Workspaces (`@jarvis/shared` unter `packages/shared`)

## Projektstruktur
```
jarvis-desktop_glas/
├── AGENTS.md                  # Desktop Engineering Invarianten & Regeln
├── CONTEXT.md                 # Dieser Kontext-Guide
├── GEMINI.md                  # Agenten-Instruktionen & Richtlinien
├── packages/
│   └── shared/                # Workspace Package (@jarvis/shared)
│       ├── package.json
│       └── src/
│           ├── index.ts        # Schnittstellen, Typen & Type-Guards
│           └── design-tokens.css
├── scripts/
│   └── build.ts               # Bun Build-Script
├── src/
│   ├── components/            # UI-Komponenten (OrbHudRings, VoiceOrb3D)
│   ├── main.ts                # Electron Main Process
│   ├── preload.ts             # Electron Preload IPC-Bridge
│   ├── renderer.tsx           # React Control Room UI Layer
│   ├── renderer.css           # Control Room Styling & Animationen
│   ├── local-chat-transport.ts# SSE Stream Forwarding & Session Registry
│   └── index.html             # Main Window Template
├── package.json
└── tsconfig.json
```

## Befehle
- `bun install` — Installiert alle Abhängigkeiten und verlinkt den Workspace `@jarvis/shared`
- `npm run start` / `bun run start` — Baut das Projekt und startet die Electron-Desktop-App
- `npm run build` / `bun run build` — Baut den Main-, Preload- und Renderer-Bundle nach `dist/`
- `npm run check` / `bun run check` — Führt Typecheck & Tests aus
