# Setup & Development

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

Create a local `.env` file or define environment variables in your shell. **Never commit secrets.**

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

Additional settings are stored in Electron's user-data directory, not in the repository.

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

Install Ollama and make the configured local model available. The project defaults to a Qwen-family model where supported. Verify availability through the model readiness panel before selecting local mode.

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

At the time the README was generated, the verified baseline was:

```text
66 tests passed
0 tests failed
228 assertions
```

Treat this as a historical baseline, not a permanent badge. Run `bun run check` on every new checkout.

## How to use

1. Start with `bun run start`.
2. Confirm the local service reports online.
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
