# Architecture

J.A.R.V.I.S. Desktop Glas uses an Electron main/renderer split with a separate Bun local service for model orchestration, plus an integrated hand-tracking stage.

## Process model

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron Main Process                                       │
│ Windows lifecycle · IPC validation · screenshots · system   │
│ information · vision target localization · native bridges   │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed preload IPC
┌──────────────────────────────▼───────────────────────────────┐
│ React Renderer                                               │
│ Control-room UI · command routing · main stage · approvals   │
│ voice state · camera · activity feed                         │
└───────────────┬──────────────────────────────┬───────────────┘
                │ HTTP/SSE loopback            │ iframe bridge
┌───────────────▼──────────────────┐  ┌────────▼──────────────┐
│ Bun Local Service :4320         │  │ Barehands :8794       │
│ chat · memory · actions · RAG   │  │ MediaPipe hand track  │
│ workflows · providers · tools   │  │ cards · gestures      │
└───────────────┬──────────────────┘  └───────────────────────┘
                │
       ┌────────▼────────┐
       │ xAI or Ollama   │
       └─────────────────┘
```

## Authority boundaries

- **Electron Main** owns machine facts and native side effects.
- **Renderer** owns presentation and ephemeral interaction state.
- **Local service** owns model orchestration, memory, workflows and action intents.
- **Shared package** owns API contracts, runtime validators and common types.

## Repository layout

```text
.
├── backend/
│   ├── src/
│   │   ├── action-engine.ts       # validated action execution
│   │   ├── handler.ts             # loopback HTTP API and tool loop
│   │   ├── workflow-engine.ts      # deterministic workflows
│   │   ├── xai-adapter.ts         # Grok chat/vision adapter
│   │   ├── ollama.ts              # local Ollama adapter
│   │   ├── cursor-bridge.ts       # Windows cursor and clipboard bridge
│   │   └── barehands/             # integrated AGPL Barehands source
│   └── tests/
├── packages/shared/               # contracts, validators and design tokens
├── scripts/
│   ├── build.ts
│   └── spotify-control.ps1        # Spotify PWA UI Automation
├── src/
│   ├── main.ts                    # Electron Main Process
│   ├── preload.ts                 # typed, narrow IPC bridge
│   ├── renderer.tsx               # deterministic command router and UI
│   ├── renderer.css
│   ├── deterministic-local-commands.ts
│   └── components/
├── tests/
├── AGENTS.md                      # engineering invariants
├── CONTEXT.md                     # project architecture context
├── DESIGN.md                      # visual contract
├── JARVIS_Commandes.txt           # complete operator command reference
├── SOUL.md                        # assistant identity and behavior
├── LICENSE                        # AGPL-3.0 text
└── README.md
```

## Local services

| Service | Port | Role |
|---|---|---|
| Bun local service | `127.0.0.1:4320` | chat, memory, actions, RAG, workflows, providers, tools |
| Barehands | `127.0.0.1:8794` | MediaPipe hand tracking, cards, gestures (loopback-only) |

## Project metadata

- Package name: `jarvis-glas`
- Version: `0.1.5`
- App ID: `org.jarvis.desktop`
- Product name: `Jarvis-Glas`
- Build target: NSIS installer (`JARVIS-Setup-${version}.${ext}`), x64, per-user
