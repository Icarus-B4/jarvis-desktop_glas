import { chromium } from "playwright";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function runScrollTest() {
  console.log("🚀 Starte Playwright UI-Scroll-Test für Jarvis Desktop...");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"],
  });
  // Setze verkleinerte Fenstergröße (z.B. 1280 x 600px), um Fenster-Minimierung zu simulieren
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });

  const htmlPath = resolve(process.cwd(), "dist", "index.html");
  console.log(`📄 Lade HTML: file://${htmlPath}`);
  await page.goto(`file://${htmlPath}`);

  // Warte bis das UI bereit ist
  await page.waitForSelector("[data-toggle-lifeos-panel]");

  // Klick auf den LifeOS Button
  console.log("🖱️ Klicke auf [data-toggle-lifeos-panel]...");
  await page.click("[data-toggle-lifeos-panel]");

  await page.waitForTimeout(500);

  // Analysiere das DOM & CSS
  const scrollMetrics = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>("[data-hud-drawer]");
    const drawerBody = document.querySelector<HTMLElement>(".drawer-body");
    const lifeosPanel = document.querySelector<HTMLElement>("[data-lifeos-panel]");
    const lifeosContent = document.querySelector<HTMLElement>(".lifeos-content");
    const controlStack = document.querySelector<HTMLElement>(".control-stack");

    return {
      controlStack: controlStack ? {
        height: controlStack.clientHeight,
        offsetHeight: controlStack.offsetHeight,
        computedHeight: window.getComputedStyle(controlStack).height,
        position: window.getComputedStyle(controlStack).position,
      } : null,
      overlay: overlay ? {
        hidden: overlay.hidden,
        clientHeight: overlay.clientHeight,
        scrollHeight: overlay.scrollHeight,
        computedHeight: window.getComputedStyle(overlay).height,
        position: window.getComputedStyle(overlay).position,
      } : null,
      drawerBody: drawerBody ? {
        clientHeight: drawerBody.clientHeight,
        scrollHeight: drawerBody.scrollHeight,
        overflowY: window.getComputedStyle(drawerBody).overflowY,
      } : null,
      lifeosPanel: lifeosPanel ? {
        hidden: lifeosPanel.hidden,
        clientHeight: lifeosPanel.clientHeight,
        scrollHeight: lifeosPanel.scrollHeight,
        overflowY: window.getComputedStyle(lifeosPanel).overflowY,
      } : null,
      lifeosContent: lifeosContent ? {
        clientHeight: lifeosContent.clientHeight,
        scrollHeight: lifeosContent.scrollHeight,
      } : null,
    };
  });

  console.log("\n📊 Playwright Scroll-Metriken (bei Viewport-Höhe 600px):");
  console.log(JSON.stringify(scrollMetrics, null, 2));

  // Versuche nach unten zu scrollen via echten Mausrad-Events
  console.log("\n🖱️ Bewege Maus über .drawer-body und simuliere Mausrad-Scrollen (500px)...");
  await page.hover(".drawer-body");
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);

  const scrolledAfterWheel = await page.evaluate(() => document.querySelector(".drawer-body")?.scrollTop);
  console.log(`📜 ScrollTop nach Mausrad-Wheel Event: ${scrolledAfterWheel}px`);

  // Screenshot nach dem Scrollen speichern
  const screenshotPath = resolve(process.cwd(), "..", "..", ".tmp", "playwright-scroll-test.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Screenshot gespeichert unter: ${screenshotPath}`);

  await browser.close();
}

runScrollTest().catch((err) => {
  console.error("❌ Test fehlgeschlagen:", err);
  process.exit(1);
});
