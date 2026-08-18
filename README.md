<div align="center">

# J.A.R.V.I.S. DESKTOP GLAS

### Private AI Control Room · Voice · Vision · Automation · Bare-Hand Interaction

[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL--3.0--or--later-7fffd4?style=for-the-badge&labelColor=07110f)](./LICENSE)
![Platform](https://img.shields.io/badge/Platform-Windows_11-78e6d0?style=for-the-badge&labelColor=07110f)
![Runtime](https://img.shields.io/badge/Runtime-Bun-f3f3f3?style=for-the-badge&labelColor=07110f)
![Desktop](https://img.shields.io/badge/Desktop-Electron-9fe7ff?style=for-the-badge&labelColor=07110f)
![Status](https://img.shields.io/badge/Status-Alpha-ffcc66?style=for-the-badge&labelColor=07110f)

**[English](#english)** · **[Deutsch](#deutsch)** · **[Command reference](./JARVIS_Commandes.txt)** · **[License](./LICENSE)**

> A local-first, Windows-native AI control room that turns typed or spoken intent into visible, validated desktop actions.

</div>

---

<a id="english"></a>

# English

## Overview

**J.A.R.V.I.S. Desktop Glas** is a Windows-first AI desktop application built with Electron, Bun, React, TypeScript and Three.js. It combines a cinematic control-room interface with local system capabilities, cloud or local language models, voice interaction, visual analysis, workflow automation, persistent memory and webcam-based hand tracking.

The application is designed around one rule: **actions must be real, visible and bounded**. Read-only questions can be answered immediately. Sensitive or destructive operations—such as closing applications, vision-directed clicks or shutting down Windows—are represented as action proposals and require explicit user approval.

This repository is currently an **alpha-stage developer project**. It is suitable for experimentation and collaborative development, but it is not yet a hardened production release.

## What the application can do

### AI and conversation

- Cloud conversation and vision through **xAI Grok** when `XAI_API_KEY` is configured.
- Local text conversation through **Ollama / Qwen**.
- Bounded tool loop with duplicate-call protection and typed tool results.
- German-first assistant identity and configurable silent-butler behavior through `SOUL.md`.
- Streaming responses over a local loopback service.

### Voice

- Continuous microphone mode with hard mute/unmute.
- xAI speech-to-text and text-to-speech integration.
- Immediate interruption commands such as `Stop`, `Stopp`, `Abbrechen` and `Halt`.
- Deterministic Iron-Man mode commands:
  - `Aktiviere den Iron-Man-Modus`
  - `Deaktiviere den Iron-Man-Modus`

### Internal main stage

- Opens websites inside the application’s **main stage**, not in an uncontrolled external browser.
- Uses an Electron `<webview>` for sites that block ordinary iframe embedding.
- Deterministic URL and domain recognition.
- Internal views for camera, screenshots, action approvals, code, weather briefing and Barehands.

### Spotify and media

- Opens the user’s Brave Spotify PWA through `%USERPROFILE%\Desktop\Spotify.lnk`.
- Reuses an already running Spotify PWA instead of opening duplicate windows.
- Searches for a title or artist and starts playback through Windows UI Automation.
- Supports play, pause, stop, next, previous, mute and system volume controls.
- Opens YouTube title searches inside the main stage.

### Windows and desktop automation

- Opens safe user folders through an allowlist: Desktop, Documents, Downloads, Pictures, Videos and Music.
- Starts approved applications through exact shortcuts or installation paths.
- Reads system-wide battery, CPU, RAM and Windows uptime information.
- Saves desktop screenshots as PNG files and displays them on the main stage.
- Can propose application closing and Windows shutdown actions.
- Windows shutdown uses a 30-second delay and requires explicit approval.
- Advanced typed terminal commands remain a trusted-local-user feature and must not be exposed to untrusted input.

### Deterministic local commands

- Local time, date, month and year.
- Age calculation from exactly one persistently stored birth date.
- Arithmetic: addition, subtraction, multiplication, division, powers, squares and square roots.
- Distance and temperature conversions.
- Live EUR/USD conversion with a dated Frankfurter/ECB rate.
- Small offline dictionary for common German, English and Spanish words.
- Current weather for Biel/Bienne through Open-Meteo.
- Sports result/table searches with visible web sources.

### Memory, knowledge and files

- Persistent local memory with add, search, list and delete operations.
- Safe deletion: ambiguous memory matches are not removed automatically.
- Project file browsing and text retrieval.
- Knowledge and RAG surfaces for developer-oriented local context.

### Workflows

- Deterministic work mode:
  - Antigravity IDE
  - Proton Mail
  - Brave
  - Spotify PWA
- Individual workflow steps report actual success or failure.
- Missing applications are reported honestly instead of being guessed through fuzzy shell matching.

### Vision and camera

- Screen and camera frames can be sent to Grok Vision when explicitly requested.
- Natural camera requests such as “How am I dressed?” or “Identify this object” capture a real frame before analysis.
- No camera frame means no invented visual description.
- Vision-directed click and text insertion use this flow:
  1. capture current screen;
  2. ask Grok Vision for normalized target coordinates;
  3. create a visible action proposal;
  4. move/click/type only after explicit approval.
- Screenshot text is treated as untrusted data and is explicitly excluded from the vision instruction channel.

### Barehands and system cursor

The integrated Barehands stage turns a webcam into a hand-tracked interface.

Normal Barehands mode controls cards, notes, media and 3D objects inside the stage. System-cursor mode is deliberately separate:

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

### Google Workspace

Without Google API credentials, Jarvis can use the authenticated web session on the internal stage:

- create a new Google Doc via `docs.new`;
- create a new Google Sheet via `sheets.new`;
- open Gmail;
- open Google Calendar;
- open today’s calendar view.

Structured Gmail and Calendar reading requires a separate Google OAuth authorization and is intentionally disabled until the repository owner selects the required scopes.

## Architecture

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

### Authority boundaries

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
│   │   ├── workflow-engine.ts     # deterministic workflows
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

## Requirements

### Required

- Windows 11 (the project is Windows-first)
- Git
- [Bun](https://bun.sh/) 1.3 or newer
- A webcam for camera and Barehands features

### Optional

- [Ollama](https://ollama.com/) with a Qwen model for local chat
- xAI API key for Grok chat, STT, TTS and vision
- Tavily API key for enhanced web search
- Brave plus a Spotify PWA desktop shortcut for deterministic Spotify control

## Installation

```bash
git clone <your-repository-url>
cd jarvis-desktop_glas
bun install
bun run check
bun run start
```

No public Git remote is configured in this working copy. Replace `<your-repository-url>` with the URL of the repository or fork you publish.

## Configuration

Create a local `.env` file or define environment variables in your shell. Never commit secrets.

```dotenv
# Cloud AI, voice and vision
XAI_API_KEY=

# Optional enhanced web search
TAVILY_API_KEY=

# Optional local model endpoint
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Local service defaults
JARVIS_SERVICE_PORT=4320
JARVIS_SERVICE_HOST=127.0.0.1
```

Additional settings are stored in Electron’s user-data directory, not in the repository.

### Spotify setup

1. Install Brave.
2. Open Spotify Web and sign in.
3. Install the page as a Brave app/PWA.
4. Create or copy its shortcut to:

```text
%USERPROFILE%\Desktop\Spotify.lnk
```

Jarvis never stores Spotify credentials and does not require Spotify Web API credentials.

### Ollama setup

Install Ollama and make the configured local model available. The current project defaults to a Qwen-family model where supported. Verify availability through the model readiness panel before selecting local mode.

## Running and quality checks

```bash
# Build all Electron bundles
bun run build

# TypeScript validation
bun run typecheck

# Full test suite
bun test

# Typecheck and tests
bun run check

# Build and start Electron
bun run start

# Start the already-built preview
bun run preview
```

At the time this README was generated, the verified baseline was:

```text
66 tests passed
0 tests failed
228 assertions
```

Treat this as a historical baseline, not a permanent badge. Run `bun run check` on every new checkout.

## How to use the application

1. Start with `bun run start`.
2. Confirm that the local service reports online.
3. Choose Cloud/Grok or Local/Ollama mode.
4. Type into the command field or enable voice mode.
5. Use the right-side capability buttons to open Memory, Files/RAG, Knowledge, Workflows, Telemetry or Settings.
6. Use the main stage for websites, camera, screenshots, action approvals and Barehands.
7. Review every action proposal before approving it.
8. Use `JARVIS_Commandes.txt` as the complete operator command reference.

Example commands:

```text
Öffne webstark.org
Öffne Spotify
Spiele Don't Let It Go To Your Head
Wie ist das Wetter?
Berechne 150 geteilt durch 3
Öffne meine Downloads
Jarvis, an die Arbeit!
Mache einen Screenshot
Schau auf meinen Bildschirm
Aktiviere Cursorsteuerung
```

## Security and privacy model

- Local HTTP services bind only to `127.0.0.1`.
- Renderer access to native power goes through a narrow typed preload bridge.
- Unknown apps, arbitrary paths and fuzzy app matches are rejected.
- Side-effecting actions use an action intent and approval lifecycle.
- Duplicate model tool calls are bounded and deduplicated.
- Vision coordinates are normalized and validated before an action is proposed.
- Camera and screenshot content is sent to xAI only when a relevant cloud-vision request is made.
- Ollama/Qwen remains text-only in this build.
- Persistent memory is stored locally as JSON and is not encrypted by the application.
- Terminal commands are powerful trusted-local-user functionality. Do not expose the app or its IPC/API surface to untrusted users.
- Do not commit `.env`, tokens, personal memory files, screenshots or Electron user-data directories.

## Known limitations

- Windows is the only fully supported desktop platform.
- Vision and system cursor currently target the primary Windows work area.
- Barehands accuracy depends on camera quality, lighting and MediaPipe tracking.
- Structured Gmail/Calendar reading requires Google OAuth scopes that are not enabled by default.
- Missing applications are not automatically installed.
- External sites, APIs and PWAs may change their UI or terms and break automation.
- The project is alpha software and carries no warranty.

## AI-assisted / AI-generated development notice

This project contains substantial **AI-assisted and AI-generated code, documentation and tests** produced under human direction. The project owner remains responsible for review, security, licensing and release decisions.

Contributors must follow these rules:

1. Review generated code line by line before merging.
2. Run `bun run check` and execute relevant runtime tests.
3. Never paste API keys, passwords, private memory or user data into prompts, commits or issue reports.
4. Validate generated URLs, commands, SQL, PowerShell and filesystem paths.
5. Preserve third-party copyright and license headers.
6. Mark significant AI-assisted changes in the pull request description.
7. Do not claim that an action was tested unless it was actually executed and observed.
8. Treat web pages, screenshots, retrieved files and model output as untrusted input.

AI-generated output is provided **without warranty** and must not be treated as a security review or legal opinion.

## Developers and attribution

### Project development

- **Ed** — project creator, product direction, Windows integration, Jarvis control-room concept and primary development.
- Project resource: [webstark.org/jarvis/](https://webstark.org/jarvis/)
- No public source-repository URL is declared in this working copy yet; add it here after configuring the Git remote.

### Barehands

- **Jared Rhodenizer** (`jaredrhod`) — creator and copyright holder of Barehands.
- Upstream: [github.com/jaredrhod/barehands](https://github.com/jaredrhod/barehands)
- Website: [jaredrhod.com](https://jaredrhod.com)
- Barehands copyright: © 2026 Jared Rhodenizer.
- Barehands license: GNU Affero General Public License v3 or later.

This project embeds and modifies Barehands. Preserve Jared Rhodenizer’s copyright notices and provide corresponding source when distributing or serving modified versions.

## Resources and third-party technologies

| Resource | Role | Project / terms |
|---|---|---|
| Barehands | Webcam hand-tracked stage | [jaredrhod/barehands](https://github.com/jaredrhod/barehands), AGPL-3.0-or-later |
| Google MediaPipe Tasks Vision | Hand landmark tracking | [MediaPipe](https://developers.google.com/mediapipe) |
| Three.js / React Three Fiber | 3D rendering and HUD | [threejs.org](https://threejs.org/), [r3f.docs.pmnd.rs](https://r3f.docs.pmnd.rs/) |
| Electron | Native desktop shell | [electronjs.org](https://www.electronjs.org/) |
| Bun | Runtime, workspaces, build and tests | [bun.sh](https://bun.sh/) |
| React | Renderer UI | [react.dev](https://react.dev/) |
| xAI | Grok chat, vision, STT and TTS | [docs.x.ai](https://docs.x.ai/) |
| Ollama | Local model runtime | [ollama.com](https://ollama.com/) |
| Open-Meteo | Weather data | [open-meteo.com](https://open-meteo.com/) |
| Frankfurter / ECB data | Currency conversion | [frankfurter.app](https://frankfurter.app/) |
| Spotify Web / Brave PWA | Music playback UI | Subject to Spotify and Brave terms |
| Google Workspace | Docs, Sheets, Gmail and Calendar web session | Subject to Google terms and OAuth scopes |
| YouTube | Internal title search | Subject to YouTube terms |

Spotify, YouTube, Google, Microsoft, Windows, Brave, xAI and other product names are trademarks of their respective owners. This project is not endorsed by or affiliated with those companies unless explicitly stated.

## License and reuse

The repository is distributed under the **GNU Affero General Public License v3 or later (`AGPL-3.0-or-later`)**. See [`LICENSE`](./LICENSE).

In practical terms, you may:

- use the software privately;
- study and modify it;
- redistribute source or binaries;
- use it commercially;
- charge for installation, development or support.

When you distribute the software—or provide a modified version for users over a network—you must comply with the AGPL, including preserving notices and making the complete corresponding source available under the same license.

For a closed-source commercial product containing Barehands, contact Jared Rhodenizer at `license@jaredrhod.com` for a separate license.

> This section is a practical summary, not legal advice. Read the full license and obtain qualified legal advice for commercial distribution.

## Contributing

1. Fork the repository and create a focused branch.
2. Read `AGENTS.md`, `CONTEXT.md` and `DESIGN.md` before editing.
3. Preserve the Controller → Service → Repository separation in backend features.
4. Validate every input at IPC and HTTP boundaries.
5. Keep native capabilities narrow; never add a generic renderer-to-shell escape hatch.
6. Add tests before or alongside behavior changes.
7. Run `bun run check`.
8. Verify Electron runtime behavior, not only the build.
9. Document security, privacy and license effects in the pull request.

Suggested commit style:

```text
feat: add deterministic command routing
fix: prevent duplicate Spotify PWA launches
test: cover action approval boundary
docs: document Barehands attribution
```

## Responsible use

This application can interact with the operating system, camera, microphone, files, applications and cloud AI providers. Run it only on systems and accounts you are authorized to control. Never use automation to bypass access controls, consent, platform rules or applicable law.

---

<a id="deutsch"></a>

# Deutsch

## Übersicht

**J.A.R.V.I.S. Desktop Glas** ist eine Windows-orientierte KI-Desktop-Anwendung auf Basis von Electron, Bun, React, TypeScript und Three.js. Sie verbindet eine filmische Control-Room-Oberfläche mit lokalen Systemfunktionen, Cloud- oder lokalen Sprachmodellen, Spracheingabe, Bildanalyse, Workflow-Automatisierung, persistentem Gedächtnis und kamerabasiertem Handtracking.

Die zentrale Regel lautet: **Aktionen müssen real, sichtbar und begrenzt sein.** Reine Informationsanfragen können direkt beantwortet werden. Sensible oder destruktive Eingriffe – etwa das Beenden von Anwendungen, Vision-Klicks oder das Herunterfahren von Windows – werden als Action-Vorschlag angezeigt und benötigen eine ausdrückliche Freigabe.

Das Projekt befindet sich im **Alpha-Stadium**. Es eignet sich für Experimente und gemeinsame Entwicklung, ist aber noch keine gehärtete Produktionssoftware.

## Was kann die App?

### KI und Konversation

- xAI Grok für Cloud-Chat und Vision mit konfiguriertem `XAI_API_KEY`.
- Ollama/Qwen für lokalen Textchat.
- Begrenzter Tool-Loop mit Deduplizierung wiederholter Aufrufe.
- Deutsche Jarvis-Identität und Butler-Verhalten über `SOUL.md`.
- Streaming-Antworten über einen lokalen Loopback-Service.

### Sprache

- Dauerhafte Mikrofonerkennung mit Hard-Mute.
- xAI Speech-to-Text und Text-to-Speech.
- Sofortiger Abbruch über `Stop`, `Stopp`, `Abbrechen` oder `Halt`.
- Iron-Man-Modus über eindeutige Sprachbefehle.

### Interne Hauptbühne

- Webseiten werden standardmäßig innerhalb der App geöffnet.
- Electron-Webview statt gewöhnlichem iframe für Seiten mit Einbettungsschutz.
- Eigene Ansichten für Kamera, Screenshots, Code, Freigaben, Wetter und Barehands.

### Spotify und Medien

- Start der Brave-Spotify-PWA über `%USERPROFILE%\Desktop\Spotify.lnk`.
- Keine zweite Spotify-Instanz, wenn die PWA bereits läuft.
- Suche und Wiedergabe von Titeln/Künstlern über Windows UI Automation.
- Play, Pause, Stop, Weiter, Zurück, Stumm und Systemlautstärke.
- YouTube-Suche auf der internen Hauptbühne.

### Windows-Automatisierung

- Sichere Ordner-Allowlist für Desktop, Dokumente, Downloads, Bilder, Videos und Musik.
- App-Start nur über exakte Verknüpfungen oder geprüfte Installationspfade.
- Batterie-, CPU-, RAM- und Windows-Uptime-Abfragen.
- Screenshot als PNG auf dem Desktop und Anzeige in der App.
- Bestätigungspflichtiges Beenden von Anwendungen.
- Bestätigungspflichtiges Herunterfahren mit 30 Sekunden Verzögerung.

### Lokale Befehle

- Uhrzeit, Datum, Monat und Jahr.
- Altersberechnung aus genau einem gespeicherten Geburtsdatum.
- Rechnen ohne LLM.
- Temperatur- und Distanzumrechnung.
- Aktuelle EUR/USD-Umrechnung mit Kursdatum.
- Kleines Offline-Wörterbuch Deutsch/Englisch/Spanisch.
- Wetter für Biel/Bienne über Open-Meteo.
- Sportrecherche mit sichtbaren Quellen.

### Gedächtnis, Wissen und Dateien

- Persistentes lokales Gedächtnis.
- Kein automatisches Löschen bei mehrdeutigen Treffern.
- Projektdateien, Knowledge-Ansicht und RAG-Oberfläche.

### Arbeitsmodus

`Jarvis, an die Arbeit!` startet – sofern vorhanden – Antigravity IDE, Proton Mail, Brave und Spotify. Jeder Schritt erhält einen echten Erfolgs- oder Fehlerstatus.

### Vision und Kamera

- Bildschirm- und Kamerabilder werden nur bei passenden Vision-Anfragen übertragen.
- Natürliche Anfragen wie `Wie bin ich angezogen?` erzeugen zuerst einen echten Kameraframe.
- Ohne Bild keine erfundene Beschreibung.
- `Klicke auf [Element]` und `Schreibe [Text] in [Feld]` nutzen Grok Vision zur Zielerkennung und erzeugen anschließend einen sichtbaren, bestätigungspflichtigen Action-Vorschlag.

### Barehands und Cursorsteuerung

Normaler Barehands-Modus bedient die interne Bühne. Der Systemcursor-Modus wird ausdrücklich aktiviert:

```text
Aktiviere Cursorsteuerung
```

| Geste | Ergebnis |
|---|---|
| Erste erkannte Hand bewegen | Windows-Cursor bewegen |
| Kurzer Pinch | Linksklick |
| Pinch mindestens 0,9 Sekunden halten und lösen | Rechtsklick |
| `Deaktiviere Cursorsteuerung` | Zurück zur internen Bühne |

## Installation

```bash
git clone <deine-repository-url>
cd jarvis-desktop_glas
bun install
bun run check
bun run start
```

In dieser Arbeitskopie ist noch kein öffentlicher Git-Remote eingetragen. Ersetze den Platzhalter durch die URL des veröffentlichten Repositories oder Forks.

## Konfiguration

```dotenv
XAI_API_KEY=
TAVILY_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434
JARVIS_SERVICE_PORT=4320
JARVIS_SERVICE_HOST=127.0.0.1
```

Keine Secrets committen. Spotify benötigt die Desktop-Verknüpfung:

```text
%USERPROFILE%\Desktop\Spotify.lnk
```

## Bedienung

1. `bun run start` ausführen.
2. Prüfen, ob der lokale Service online ist.
3. Cloud/Grok oder Lokal/Ollama auswählen.
4. Befehl tippen oder Spracheingabe aktivieren.
5. Module rechts über Memory, Files/RAG, Knowledge, Workflows, Telemetry oder Settings öffnen.
6. Die Hauptbühne für Webseiten, Kamera, Screenshots, Barehands und Freigaben nutzen.
7. Action-Vorschläge vor der Freigabe lesen.
8. Vollständige Befehlsliste in `JARVIS_Commandes.txt` verwenden.

Beispiele:

```text
Öffne webstark.org
Öffne Spotify
Spiele Brand Nubian auf Spotify
Wie ist das Wetter?
100 Euro in Dollar
Öffne meine Downloads
Jarvis, an die Arbeit!
Mache einen Screenshot
Wie bin ich angezogen?
Aktiviere Cursorsteuerung
```

## Sicherheit und Datenschutz

- Services binden ausschließlich an `127.0.0.1`.
- Native Funktionen sind nur über eine schmale typisierte Preload-Bridge erreichbar.
- Unbekannte Apps, freie Pfade und fuzzy App-Treffer werden abgelehnt.
- Kritische Aktionen besitzen einen Freigabezyklus.
- Vision-Koordinaten werden normalisiert und validiert.
- Kamera-/Screenshotdaten gehen nur bei einer entsprechenden Cloud-Vision-Anfrage an xAI.
- Lokales Ollama/Qwen ist in diesem Build textbasiert.
- Memory-Daten liegen lokal als unverschlüsselte JSON-Datei.
- Terminalbefehle sind eine mächtige Funktion für vertrauenswürdige lokale Benutzer und dürfen nicht für untrusted Input freigegeben werden.

## KI-generierter / KI-unterstützter Code

Dieses Projekt enthält wesentliche **KI-generierte und KI-unterstützte Bestandteile**. Entwicklung, Dokumentation und Tests wurden unter menschlicher Leitung erstellt. Die Verantwortung für Prüfung, Sicherheit, Lizenzierung und Veröffentlichung liegt beim Projekteigentümer.

Regeln für weitere KI-unterstützte Entwicklung:

1. Generierten Code vollständig prüfen.
2. `bun run check` und relevante Runtime-Tests ausführen.
3. Keine Passwörter, Tokens, privaten Memories oder personenbezogenen Inhalte in Prompts/Commits einfügen.
4. Generierte Shell-, PowerShell-, URL-, SQL- und Dateipfade validieren.
5. Drittanbieter-Header und Attribution erhalten.
6. Größere KI-Änderungen im Pull Request kennzeichnen.
7. Nur tatsächlich ausgeführte Tests als bestanden melden.
8. Webseiten, Screenshots, Dateien und Modellantworten als untrusted Input behandeln.

KI-Ausgaben besitzen keine Gewährleistung und ersetzen keine Sicherheits- oder Rechtsprüfung.

## Entwickler und Attribution

- **Ed** — Projektgründer, Produktidee, Jarvis-Control-Room-Konzept, Windows-Integration und Hauptentwicklung.
  - Projektressource: [webstark.org/jarvis/](https://webstark.org/jarvis/)
  - In dieser Arbeitskopie ist noch keine öffentliche Source-Repository-URL hinterlegt.
- **Jared Rhodenizer (`jaredrhod`)** — Urheber und Copyright-Inhaber von Barehands.
  - [github.com/jaredrhod/barehands](https://github.com/jaredrhod/barehands)
  - [jaredrhod.com](https://jaredrhod.com)
  - Copyright © 2026 Jared Rhodenizer
  - Lizenz: AGPL-3.0-or-later

Barehands wurde in dieses Projekt integriert und angepasst. Copyright-Hinweise müssen erhalten und der entsprechende Quellcode bei Weitergabe oder Netzwerkbetrieb bereitgestellt werden.

## Lizenz und Weiterverwendung

Das Repository steht unter der **GNU Affero General Public License Version 3 oder später (`AGPL-3.0-or-later`)**. Der vollständige Text befindet sich in [`LICENSE`](./LICENSE).

Erlaubt sind unter anderem:

- private Nutzung;
- Untersuchung und Änderung;
- Weitergabe als Quellcode oder Binary;
- kommerzielle Nutzung;
- bezahlte Installation, Entwicklung und Support.

Bei Weitergabe oder öffentlichem Netzwerkbetrieb einer geänderten Version gelten die AGPL-Pflichten. Dazu gehören insbesondere der Erhalt der Hinweise und die Bereitstellung des vollständigen korrespondierenden Quellcodes unter derselben Lizenz.

Für eine proprietäre Closed-Source-Nutzung von Barehands ist eine separate Lizenz von Jared Rhodenizer erforderlich: `license@jaredrhod.com`.

Diese Zusammenfassung ist keine Rechtsberatung.

## Beiträge

1. Repository forken und fokussierten Branch erstellen.
2. `AGENTS.md`, `CONTEXT.md` und `DESIGN.md` lesen.
3. Bestehende Architekturgrenzen erhalten.
4. Eingaben an HTTP- und IPC-Grenzen validieren.
5. Keine generische Renderer-zu-Shell-Hintertür ergänzen.
6. Tests hinzufügen.
7. `bun run check` ausführen.
8. Electron-Runtime real testen.
9. Sicherheits-, Datenschutz- und Lizenzfolgen dokumentieren.

## Verantwortungsvolle Nutzung

Die Anwendung kann Betriebssystem, Kamera, Mikrofon, Dateien, Anwendungen und Cloud-KI-Dienste ansprechen. Sie darf nur auf Geräten, Konten und Daten eingesetzt werden, für die eine Berechtigung vorliegt. Automatisierung darf keine Zugriffskontrollen, Einwilligungen, Plattformregeln oder Gesetze umgehen.

---

<div align="center">

**Built under the direction of Ed · Barehands by Jared Rhodenizer · AI-assisted, human-reviewed**

</div>
