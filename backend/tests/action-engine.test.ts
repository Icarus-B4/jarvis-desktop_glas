import { describe, expect, test } from "bun:test";
import { DefaultJarvisActionEngine } from "../src/action-engine";

describe("DefaultJarvisActionEngine web/app safety", () => {
  test("routes app.open_url as an in-app stage result without external execution", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "app.open_url",
      title: "Webstark öffnen",
      description: "Open on main stage",
      params: { url: "webstark.org" },
    });

    const decided = await engine.decideAction({ intentId: intent.id, decision: "approve" });

    expect(decided.status).toBe("completed");
    expect(decided.result).toEqual({
      success: true,
      openedUrl: "https://webstark.org",
      stageView: "web",
      message: "URL 'https://webstark.org' auf der Hauptbühne geöffnet.",
    });
  });

  test("blocks Wikipedia when misclassified as a Windows app", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "app.open_app",
      title: "Wikipedia starten",
      description: "Incorrect app classification",
      params: { name: "Wikipedia" },
    });

    const decided = await engine.decideAction({ intentId: intent.id, decision: "approve" });

    expect(decided.status).toBe("failed");
    expect(decided.error).toContain("ist eine Webseite");
  });

  test("blocks domains when misclassified as a Windows app", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "app.open_app",
      title: "Domain starten",
      description: "Incorrect app classification",
      params: { name: "example.org" },
    });

    const decided = await engine.decideAction({ intentId: intent.id, decision: "approve" });

    expect(decided.status).toBe("failed");
    expect(decided.error).toContain("Nutze app.open_url");
  });

  test("rejects arbitrary folder paths outside the allowlist", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "system.open_folder",
      title: "Arbitrary folder",
      description: "Must be rejected",
      params: { folder: "C:\\Windows\\System32" },
    });

    const decided = await engine.decideAction({ intentId: intent.id, decision: "approve" });

    expect(decided.status).toBe("failed");
    expect(decided.error).toContain("sicheren Allowlist");
  });

  test("keeps shutdown proposed until explicit user approval", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "system.shutdown",
      title: "PC herunterfahren",
      description: "Requires explicit approval",
      params: {},
    });

    expect(intent.status).toBe("proposed");
    expect(intent.result).toBeUndefined();
  });

  test("keeps vision cursor actions proposed until explicit approval", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "system.cursor_click",
      title: "Vision click",
      description: "Requires explicit approval",
      params: { x: 500, y: 500, target: "Send button" },
    });
    expect(intent.status).toBe("proposed");
    expect(intent.result).toBeUndefined();
  });

  test("keeps app close actions proposed until explicit approval", async () => {
    const engine = new DefaultJarvisActionEngine();
    const intent = await engine.proposeAction({
      capability: "app.close",
      title: "Close Brave",
      description: "Requires explicit approval",
      params: { name: "brave" },
    });
    expect(intent.status).toBe("proposed");
    expect(intent.result).toBeUndefined();
  });
});
