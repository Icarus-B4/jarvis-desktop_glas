# Beitragen zu Jarvis-Glas 👌🏽

Danke für dein Interesse, das Projekt mitzugestalten! Dieses Dokument erklärt, wie du dich einbringen kannst.

## 🚀 Schnellstart für Contributor

```bash
# 1. Fork + Clone
git clone https://github.com/<dein-user>/jarvis-desktop_glas.git
cd jarvis-desktop_glas

# 2. Abhängigkeiten (Windows)
#  - Node/Bun: https://bun.sh
#  - Rust + Tauri: https://tauri.app
#  - PowerShell 5+

# 3. Branch erstellen
git checkout -b feature/<kurzbeschreibung>

# 4. Build (Electron + Bootstrap)
bun install
bun run build
bunx electron-builder --win --config
robocopy release/win-unpacked apps/bootstrap-installer/src-tauri/resources/win-unpacked /E /IS /IT
cd apps/bootstrap-installer/src-tauri && cargo tauri build

# 5. Installer finden
#    apps/bootstrap-installer/src-tauri/target/release/bundle/.../jarvis-bootstrap-setup.exe
```

## 📋 Issue-Workflow

- **Neues Feature/Bug?** Issue anlegen (Template nutzen)
- **Milestones:** `v0.1.3` (Stabilität), `v0.2.0` (Features)
- **Labels:**
  - `priority/P0`–`P2` (Dringlichkeit)
  - `size/XS`–`XL` (Aufwandsschätzung)
  - `good first issue`, `help wanted` (für Einsteiger)
- **Project Board:** https://github.com/users/Icarus-B4/projects/5 — Status immer aktuell halten (Backlog → In progress → In review → Done)

## 🔧 Coding-Richtlinien

- **Sprache:** TypeScript (Electron/Renderer), Rust (Tauri/Bootstrap), PowerShell (Install-Skripte)
- **Commits:** `type(scope): beschreibung` (z.B. `fix(ota): einheitlicher pfad`)
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- **PRs:** Immer gegen `main` (default branch), Issue referenzieren (`Closes #123`)
- **Keine Secrets:** API-Keys niemals committen (`.env` ist gitignored)
- **Build vor Push:** Immer lokal bauen + testen, kein "toter" Code

## 🏗️ Architektur (Kurz)

| Komponente | Pfad | Tech |
|-----------|------|------|
| Desktop-App | `src/` | Electron + React + Three.js |
| Backend-Service | `backend/` | Bun + TypeScript |
| Barehands (Handtracking) | `backend/src/barehands/` | Python (Port 8794) |
| Bootstrap-Installer | `apps/bootstrap-installer/` | Tauri + Rust + PowerShell |

## ✅ PR-Checkliste

- [ ] Issue verknüpft
- [ ] Build läuft lokal
- [ ] Labels + Milestone gesetzt
- [ ] CHANGELOG-Eintrag (falls user-sichtbar)
- [ ] Keine Secrets in Diff

## 📞 Fragen?

Issue mit Label `help wanted` oder direkt im Project Board kommentieren.

**Willkommen im Team!** 🤝
