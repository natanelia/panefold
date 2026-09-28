import { expect, test } from "@playwright/test";

test.describe("embedded phone playground", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("keeps the live workspace usable and offers a standalone view", async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./demo/");
    const standalone = page.getByRole("link", { name: "Open alone", exact: true });
    await expect(standalone).toBeVisible();
    const iframe = page.locator('iframe[title="Panefold Code live workbench demo"]');
    const workbench = page.frameLocator('iframe[title="Panefold Code live workbench demo"]');
    await expect(workbench.locator(".demo-workspace")).toHaveAttribute(
      "data-responsive-projection",
      "single-region",
    );
    const bounds = await iframe.boundingBox();
    if (bounds === null) throw new Error("The workbench frame did not render");
    expect(bounds.height).toBeGreaterThan(500);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    await workbench
      .locator(".demo-activity-bar")
      .getByRole("button", { name: "Search", exact: true })
      .tap();
    await expect(workbench.getByRole("tab", { name: "Search", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await workbench
      .locator(".demo-activity-bar")
      .getByRole("button", { name: "Editor", exact: true })
      .tap();
    await expect(workbench.getByRole("tab", { name: "App.tsx", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const screenshot = testInfo.outputPath("phone-playground.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("Phone playground", { path: screenshot, contentType: "image/png" });
    await workbench.getByRole("button", { name: "Workspace appearance", exact: true }).tap();
    const settingsScreenshot = testInfo.outputPath("phone-appearance.png");
    await page.screenshot({ path: settingsScreenshot });
    await testInfo.attach("Phone appearance", {
      path: settingsScreenshot,
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  });
});
