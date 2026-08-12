import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/site/public/media/social-card.png");
await mkdir(resolve(root, "apps/site/public/media"), { recursive: true });

const preview = spawn(
  "pnpm",
  ["--filter", "@panefold/site", "preview", "--host", "127.0.0.1", "--port", "4318"],
  { cwd: root, stdio: "ignore" },
);

try {
  await waitForUrl("http://127.0.0.1:4318/panefold/");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/tmp/chromium";
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-webgl"],
  });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:4318/panefold/social-card", { waitUntil: "networkidle" });
  await page.screenshot({ path: output, animations: "disabled" });
  await browser.close();
  process.stdout.write("Captured apps/site/public/media/social-card.png\n");
} finally {
  preview.kill("SIGTERM");
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
