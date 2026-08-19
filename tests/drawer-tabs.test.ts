/**
 * Reproduces the real openDrawer() logic for the WORKSPACE / AUTOMATION tabs
 * (Memory, Files, Knowledge, Browser, Agents, Workflows, LifeOS) which all go
 * through openDrawer(tabKey). Mirrors the exact code in src/renderer.tsx so we
 * can see whether clicking one of these tabs actually reveals its panel.
 */
import { JSDOM } from "jsdom";
import { test, expect } from "bun:test";

const html = `
<!DOCTYPE html>
<html>
<body>
  <button class="shell-nav-item" data-toggle-memory-panel><b>Memory</b></button>
  <button class="shell-nav-item" data-toggle-files-panel><b>Files</b></button>
  <button class="shell-nav-item" data-toggle-knowledge-panel><b>Knowledge</b></button>
  <button class="shell-nav-item" data-toggle-browser-panel><b>Browser</b></button>
  <button class="shell-nav-item" data-toggle-agents-panel><b>Agents</b></button>
  <button class="shell-nav-item" data-toggle-workflows-panel><b>Workflows</b></button>
  <button class="shell-nav-item" data-toggle-lifeos-panel><b>LifeOS</b></button>

  <div class="control-grid" data-sidebar-collapsed="true"></div>

  <div class="hud-drawer-overlay" data-hud-drawer hidden>
    <section class="hud-panel memory-panel" data-memory-panel hidden></section>
    <section class="hud-panel files-panel" data-files-panel hidden></section>
    <section class="hud-panel knowledge-panel" data-knowledge-panel hidden></section>
    <section class="hud-panel browser-panel" data-browser-panel hidden></section>
    <section class="hud-panel agents-panel" data-agents-panel hidden></section>
    <section class="hud-panel workflows-panel" data-workflows-panel hidden></section>
    <section class="hud-panel lifeos-panel" data-lifeos-panel hidden></section>
  </div>
</body>
</html>`;

type DrawerTabKey = "lifeos" | "settings" | "memory" | "files" | "browser" | "agents" | "workflows" | "knowledge";

function makeDom() {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const root = doc.body;

  const optionalElement = <T extends Element = HTMLElement>(sel: string) =>
    root.querySelector<T>(sel) ?? undefined;

  const controlGrid = optionalElement<HTMLElement>(".control-grid");
  const sidebarExpandBtn = undefined as undefined | HTMLElement;
  const hudDrawerEl = optionalElement<HTMLElement>("[data-hud-drawer]");
  const confirmModalEl = undefined as undefined | HTMLElement;

  const drawerTabMap: Record<string, { key: string; panel: HTMLElement | undefined; loadFn?: () => void }> = {
    lifeos: { key: "lifeos", panel: optionalElement<HTMLElement>("[data-lifeos-panel]") },
    memory: { key: "memory", panel: optionalElement<HTMLElement>("[data-memory-panel]") },
    files: { key: "files", panel: optionalElement<HTMLElement>("[data-files-panel]") },
    browser: { key: "browser", panel: optionalElement<HTMLElement>("[data-browser-panel]") },
    agents: { key: "agents", panel: optionalElement<HTMLElement>("[data-agents-panel]") },
    workflows: { key: "workflows", panel: optionalElement<HTMLElement>("[data-workflows-panel]") },
    knowledge: { key: "knowledge", panel: optionalElement<HTMLElement>("[data-knowledge-panel]") },
  };

  let lastDrawerKey: string | null = null;
  let hasUnsavedSettings = false;

  function closeDrawer(): void {
    if (!hudDrawerEl) return;
    if (hasUnsavedSettings) {
      if (confirmModalEl) confirmModalEl.hidden = false;
      return;
    }
    forceCloseDrawer();
  }

  function forceCloseDrawer(): void {
    if (!hudDrawerEl) return;
    if (confirmModalEl) confirmModalEl.hidden = true;
    hudDrawerEl.hidden = true;
    delete hudDrawerEl.dataset.activeTab;
    lastDrawerKey = null;
  }

  function syncPillStates(activeKey: string | null): void {
    const isDrawerOpen = hudDrawerEl !== null && hudDrawerEl !== undefined && !hudDrawerEl.hidden;
    const isSameKey = activeKey === lastDrawerKey;
    if (isDrawerOpen && isSameKey && activeKey !== null) {
      forceCloseDrawer();
      return;
    }
    if (activeKey !== null) lastDrawerKey = activeKey;
    root.querySelectorAll<HTMLElement>(".shell-nav-item").forEach((item) => {
      item.dataset.active = "false";
    });
  }

  // --- EXACT copy of the current openDrawer() from renderer.tsx ---
  function openDrawer(tabKey: DrawerTabKey): void {
    if (!hudDrawerEl) return;
    const target = drawerTabMap[tabKey];
    if (!target) return;

    if (controlGrid) controlGrid.dataset.sidebarCollapsed = "false";
    if (sidebarExpandBtn) sidebarExpandBtn.hidden = true;

    hudDrawerEl.hidden = false;
    hudDrawerEl.dataset.activeTab = tabKey;
    if (confirmModalEl) confirmModalEl.hidden = true;

    (Object.keys(drawerTabMap) as DrawerTabKey[]).forEach((key) => {
      const item = drawerTabMap[key];
      if (item && item.panel) {
        item.panel.hidden = key !== tabKey;
      }
    });

    document.querySelectorAll<HTMLElement>("[data-drawer-tab]").forEach((btn) => {
      btn.dataset.active = String(btn.dataset.drawerTab === tabKey);
    });

    syncPillStates(tabKey);

    if (target.loadFn) {
      target.loadFn();
    }
  }

  // --- Listeners (mirrors renderer.tsx registration) ---
  const bind = (sel: string, key: DrawerTabKey) => {
    optionalElement<HTMLButtonElement>(sel)!.addEventListener("click", () => openDrawer(key));
  };
  bind("[data-toggle-memory-panel]", "memory");
  bind("[data-toggle-files-panel]", "files");
  bind("[data-toggle-knowledge-panel]", "knowledge");
  bind("[data-toggle-browser-panel]", "browser");
  bind("[data-toggle-agents-panel]", "agents");
  bind("[data-toggle-workflows-panel]", "workflows");
  bind("[data-toggle-lifeos-panel]", "lifeos");

  const fire = (el: Element) => el.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

  return {
    fire,
    memoryBtn: optionalElement<HTMLButtonElement>("[data-toggle-memory-panel]")!,
    memoryPanel: optionalElement<HTMLElement>("[data-memory-panel]")!,
    hudDrawerEl: hudDrawerEl!,
    controlGrid: controlGrid!,
    get drawerVisible() { return !hudDrawerEl!.hidden; },
    get memoryVisible() { return !optionalElement<HTMLElement>("[data-memory-panel]")!.hidden; },
    get collapsed() { return controlGrid!.dataset.sidebarCollapsed; },
  };
}

test("Memory tab reveals its panel in the drawer overlay", () => {
  const d = makeDom();
  expect(d.drawerVisible).toBe(false);
  expect(d.memoryVisible).toBe(false);

  d.fire(d.memoryBtn);

  // After clicking Memory: drawer overlay must be visible AND the memory panel shown.
  console.log("drawerVisible =", d.drawerVisible);
  console.log("memoryVisible =", d.memoryVisible);
  console.log("collapsed =", d.collapsed);

  expect(d.drawerVisible).toBe(true);
  expect(d.memoryVisible).toBe(true);
});
