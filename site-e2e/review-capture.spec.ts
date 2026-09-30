import { expect, test } from "@playwright/test";

test("captures the rebuilt developer experience for review", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [name, path] of [
    ["homepage", "./"],
    ["documentation", "./docs/"],
    ["quickstart", "./docs/quickstart/"],
    ["customization", "./docs/tabs/"],
    ["starter", "./workbench/?fixture=starter"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path.includes("/docs/") && path !== "./docs/")
      await expect(page.locator(".docs-prose")).not.toBeEmpty();
    await page.evaluate(() => document.fonts.ready);
    const output = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path: output, fullPage: true });
    await testInfo.attach(name, { path: output, contentType: "image/png" });
  }
});
