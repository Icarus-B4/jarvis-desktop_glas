import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const html = readFileSync(join(projectRoot, "src", "index.html"), "utf8");
const css = readFileSync(join(projectRoot, "src", "renderer.css"), "utf8");
const main = readFileSync(join(projectRoot, "src", "main.ts"), "utf8");

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("Hermes-style JARVIS shell invariants", () => {
  test("keeps one home for settings, conversation, and the composer", () => {
    expect(occurrences(html, "data-toggle-settings-panel")).toBe(1);
    expect(occurrences(html, "data-activity-feed")).toBe(1);
    expect(occurrences(html, "data-command-form")).toBe(1);
  });

  test("places conversation in the right context rail and composer below the stage", () => {
    const workspaceStart = html.indexOf('<div class="workspace-stack">');
    const commandDock = html.indexOf('<section class="command-dock"');
    const contextRail = html.indexOf('<div class="control-stack">');
    const conversation = html.indexOf('<section class="hud-panel conversation-panel"');

    expect(workspaceStart).toBeGreaterThan(-1);
    expect(commandDock).toBeGreaterThan(workspaceStart);
    expect(commandDock).toBeLessThan(contextRail);
    expect(conversation).toBeGreaterThan(contextRail);
  });

  test("does not render duplicate module or drawer navigation", () => {
    expect(html).not.toContain('class="module-controls-bar"');
    expect(html).not.toContain('class="drawer-tabs"');
  });

  test("uses a compact custom titlebar without whole-window opacity", () => {
    expect(main).toContain('titleBarStyle: "hidden"');
    expect(main).toContain("autoHideMenuBar: true");
    expect(main).not.toContain("opacity: 0.95");
    expect(css).toContain("--shell-titlebar-height: 38px");
  });

  test("renders route destinations as central stage pages, not side-overlay cards", () => {
    // Tab panels live inside the central stage-view-wrapper as stage-view-item.
    expect(html).toContain('data-stage-view="lifeos"');
    expect(html).toContain('data-stage-view="settings"');
    expect(html).toContain('data-stage-view="memory"');
    expect(html).toContain('data-stage-view="files"');
    expect(html).toContain('data-stage-view="knowledge"');
    expect(html).toContain('data-stage-view="browser"');
    expect(html).toContain('data-stage-view="agents"');
    expect(html).toContain('data-stage-view="workflows"');
    // Exactly one stage-view-wrapper and no leftover drawer overlay around the tabs.
    expect(occurrences(html, "stage-view-wrapper")).toBe(1);
  });
});
