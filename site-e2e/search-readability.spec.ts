import { expect, test } from "@playwright/test";

test("phone documentation search keeps readable text and allows user zoom", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("./docs/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Browse documentation pages" }).click();
    const input = page.getByRole("searchbox", { name: "Search documentation" });
    await input.focus();
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
});
