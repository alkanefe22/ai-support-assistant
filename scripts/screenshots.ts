/**
 * Captures the README screenshots against a running server (demo mode).
 * Uses an installed Chrome/Edge through playwright-core, so no browser download is needed.
 *
 *   npm run build && npm start            # in one terminal
 *   BASE_URL=http://localhost:3000 npm run screenshots
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/screenshots");
const CHANNEL = (process.env.BROWSER_CHANNEL ?? "chrome") as "chrome" | "msedge";

async function ask(page: Page, question: string) {
  const input = page.locator("[data-ai-support-assistant] textarea");
  await input.fill(question);
  await input.press("Enter");
  // wait until the typing indicator is gone
  await page.waitForFunction(
    () => !document.querySelector("[data-ai-support-assistant]")?.shadowRoot?.querySelector(".typing"),
  );
  await page.waitForTimeout(250);
}

async function openWidget(page: Page) {
  await page.locator("[data-ai-support-assistant] .launcher").click();
  await page.locator("[data-ai-support-assistant] .panel.open").waitFor();
  await page.waitForTimeout(300);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: CHANNEL });
  const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  // 1. Landing
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(`${BASE}/`);
  await shot(desktop, "01-landing");

  // 2. Demo site: answered question with its source expanded
  await desktop.goto(`${BASE}/demo`);
  await openWidget(desktop);
  await ask(desktop, "Diş beyazlatma ne kadar?");
  await desktop.locator("[data-ai-support-assistant] details summary").last().click();
  await shot(desktop, "02-demo-answer-with-source");

  // 3. Unknown question → hand-off + lead form
  await ask(desktop, "Göz muayenesi yapıyor musunuz?");
  const w = desktop.locator("[data-ai-support-assistant]");
  await w.locator("form.lead input[type=text]").nth(0).fill("Ayşe Demir");
  await w.locator("form.lead input[type=text]").nth(1).fill("ayse@example.com");
  await w.locator("form.lead input[type=checkbox]").check();
  await shot(desktop, "03-demo-handoff-lead-form");
  await w.locator("form.lead button").click();
  await desktop.waitForTimeout(500);

  // 4. Mobile, English
  const mobile = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  await mobile.goto(`${BASE}/demo?lang=en`);
  await shot(mobile, "04-mobile-demo-en");
  await openWidget(mobile);
  await ask(mobile, "Can I pay in installments?");
  await shot(mobile, "05-mobile-widget-en");

  // 5. Admin panel
  for (const [route, name] of [
    ["/admin", "06-admin-overview"],
    ["/admin/knowledge", "07-admin-knowledge"],
    ["/admin/unanswered", "08-admin-unanswered"],
    ["/admin/conversations", "09-admin-conversations"],
    ["/admin/leads", "10-admin-leads"],
    ["/admin/settings", "11-admin-settings"],
  ] as const) {
    await desktop.goto(`${BASE}${route}`);
    if (route === "/admin/conversations") await desktop.locator("details summary").first().click();
    await shot(desktop, name);
  }

  await browser.close();
  console.log(`Saved screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
