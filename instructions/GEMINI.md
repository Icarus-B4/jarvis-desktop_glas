# GEMINI / Agent Rules — Jarvis Desktop Glas

## Richtlinien & Prinzipien
1. **Sprache:** Dokumentation, Code-Kommentare und Debug-Ausgaben bevorzugt in **Deutsch**.
2. **Saubere Trennung:**
   - **Electron (Main):** Maschinenkontrolle, IPC, System-Tray, Fensterverwaltung.
   - **Renderer:** Presentation, React-Komponenten, Web Audio API, Canvas 3D Orb.
   - **Backend Service:** Agent-Workflows, RAG, Ollama / xAI Anbindung.
3. **Arbeitsbereich & Module:**
   - Typen, Interfaces und gemeinsame Hilfsfunktionen gehören in `@jarvis/shared` (`packages/shared/src/index.ts`).
   - Keine relativen Imports außerhalb des Repository-Pfads.
4. **Verifikation:**
   - Vor dem Abschluss jeder Aufgabe zwingend `bun run check` oder `bun run build` zur Absicherung ausführen.
5. **Memory Updates:**
   - Jede relevante Änderung am Ende in `.agent/CONVERSATION_MEMORY.md` protokollieren.
