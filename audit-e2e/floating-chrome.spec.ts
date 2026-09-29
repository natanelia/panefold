import { expect, test, type Locator } from "@playwright/test";

async function press(control: Locator) {
  if (test.info().project.use.hasTouch) await control.tap();
  else await control.click();
}

test("floating tabs keep their names visible beside touch-sized window controls", async ({
  page,
}, info) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("./?fixture=touch");
    await expect(page.locator(".tp-workspace")).toBeVisible();
    // Each viewport uses the existing saved state, so dock again before the next case.
    await press(page.getByRole("button", { name: "Actions for Notes", exact: true }));
    await press(page.getByRole("menuitem", { name: "Float Notes", exact: true }));
    const frame = page.locator(".pf-floating-surface");
    await expect(frame).toBeVisible();
    const title = frame.locator('[data-workspace-panel-tab="notes"] .pf-tab-title');
    await expect(title).toBeVisible();
    const geometry = await title.evaluate((element) => {
      const list = element.closest(".pf-tab-list");
      if (!list) throw new Error("Floating tab list missing");
      const text = document.createRange();
      text.selectNodeContents(element);
      return {
        text: text.getBoundingClientRect().toJSON(),
        list: list.getBoundingClientRect().toJSON(),
      };
    });
    expect(geometry.text.width).toBeGreaterThan(20);
    expect(geometry.text.x).toBeGreaterThanOrEqual(geometry.list.x);
    expect(geometry.text.right).toBeLessThanOrEqual(geometry.list.right + 1);
    await page.screenshot({ path: info.outputPath(`floating-title-${viewport.width}.png`) });
    await press(frame.getByRole("button", { name: /^Dock Notes/ }));
    await expect(frame).toHaveCount(0);
    await expect(page.locator(".tp-save")).toContainText("Layout saved");
  }
});
