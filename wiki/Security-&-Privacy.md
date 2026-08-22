# Security & Privacy

## Model

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

## Action approval lifecycle

Sensitive or destructive operations are never executed directly. They follow this flow:

1. An action intent is created (e.g. close app, vision-directed click, Windows shutdown).
2. A visible action proposal is shown to the user.
3. The action runs only after explicit approval.

Windows shutdown additionally uses a 30-second delay and requires explicit approval.

## Known limitations

- Windows is the only fully supported desktop platform.
- Vision and system cursor currently target the primary Windows work area.
- Barehands accuracy depends on camera quality, lighting and MediaPipe tracking.
- Structured Gmail/Calendar reading requires Google OAuth scopes that are not enabled by default.
- Missing applications are not automatically installed.
- External sites, APIs and PWAs may change their UI or terms and break automation.
- The project is alpha software and carries no warranty.

## AI-assisted development notice

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

## Responsible use

This application can interact with the operating system, camera, microphone, files, applications and cloud AI providers. Run it only on systems and accounts you are authorized to control. Never use automation to bypass access controls, consent, platform rules or applicable law.
