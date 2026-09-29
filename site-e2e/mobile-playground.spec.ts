import { expect, test } from "@playwright/test";
import { touchPanelDrop } from "../e2e/touch-helpers";

test.describe("embedded phone playground", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("uses the readable touch example and retains actual docking inside the frame", async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./demo/");
    await expect(page.getByRole("link", { name: "Open alone", exact: true })).toBeVisible();
    const iframe = page.locator('iframe[title="Panefold Code live workbench demo"]');
    const workbench = page.frameLocator('iframe[title="Panefold Code live workbench demo"]');
    await expect(workbench.locator(".tp-workspace")).toHaveAttribute(
      "data-responsive-projection",
      "full-layout",
    );
    await expect(workbench.locator(".pf-group")).toHaveCount(2);
    const bounds = await iframe.boundingBox();
    if (!bounds) throw new Error("Expected workbench");
    expect(bounds.height).toBeGreaterThan(700);
    const scroll = await page.evaluate(() => scrollY);
    await touchPanelDrop(
      page,
      workbench.locator('[data-workspace-panel-tab="notes"]'),
      workbench.locator('[data-workspace-group="secondary"]'),
      workbench.locator("[data-workspace-panel-drag]"),
      "inline-end",
    );
    await expect(workbench.locator(".pf-group")).toHaveCount(3);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.screenshot({ path: info.outputPath("phone-embedded.png") });
    await workbench.getByRole("button", { name: "Move", exact: true }).tap();
    await expect(workbench.getByRole("dialog", { name: "Move or split a panel" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-embedded-move.png") });
    expect(errors).toEqual([]);
  });
});
