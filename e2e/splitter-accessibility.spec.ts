import { expect, test } from "@playwright/test";

test("identifies the primary pane and lets Escape cancel a pointer resize", async ({ page }) => {
  await page.goto("/?fixture=starter");
  const workspace = page.getByLabel("Starter workspace", { exact: true });
  await expect(workspace).toHaveAttribute("data-geometry-mode", "model");
  const splitter = workspace.locator("[data-workspace-splitter]").first();
  const primaryId = await splitter.getAttribute("aria-controls");
  expect(primaryId).toBeTruthy();
  const primary = page.locator(`[id="${String(primaryId)}"]`);
  const readPrimaryWidth = async () => (await primary.boundingBox())?.width ?? 0;
  const before = await readPrimaryWidth();
  const followingWidth = await workspace
    .locator('[data-workspace-split-child="inspector-node"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  const percent = Math.round((before / (before + followingWidth)) * 10_000) / 100;
  await expect(splitter).toHaveAttribute("aria-valuenow", String(percent));
  await primary.locator("textarea").focus();
  const box = await splitter.boundingBox();
  if (box === null) throw new Error("Expected a visible splitter");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(splitter).toBeFocused();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await expect.poll(readPrimaryWidth).toBe(before + 40);
  await page.keyboard.press("Escape");
  await expect.poll(readPrimaryWidth).toBe(before);
  await expect(splitter).toHaveAttribute("aria-valuenow", String(percent));
  await page.mouse.up();
  await expect(splitter).toBeFocused();
});

test("F6 cycles keyboard focus through workspace dividers", async ({ page }) => {
  await page.goto("/?fixture=code");
  const workspace = page.getByLabel("Panefold Code workbench", { exact: true });
  const splitters = workspace.locator('[data-workspace-splitter]:not([aria-disabled="true"])');
  await expect.poll(() => splitters.count()).toBeGreaterThan(1);
  const first = splitters.first();
  const second = splitters.nth(1);
  const last = splitters.last();
  await first.focus();
  await first.press("F6");
  await expect(second).toBeFocused();
  await second.press("Shift+F6");
  await expect(first).toBeFocused();
  await first.press("Shift+F6");
  await expect(last).toBeFocused();
  await last.press("F6");
  await expect(first).toBeFocused();
});

for (const coarse of [false, true]) {
  test.describe(`${coarse ? "coarse" : "fine"} divider targets`, () => {
    test.use({ hasTouch: coarse });

    test("enlarges the grab area independently of the visible gutter", async ({ page }) => {
      await page.goto("/?fixture=starter");
      const workspace = page.getByLabel("Starter workspace", { exact: true });
      const splitter = workspace.locator("[data-workspace-splitter]").first();
      await expect(splitter).toBeVisible();
      expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(coarse);
      const targetWidth = () =>
        splitter.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element, "::before").width),
        );
      expect(await targetWidth()).toBe(coarse ? 44 : 24);

      await workspace.evaluate((element) => {
        const workspaceElement = element as HTMLElement;
        workspaceElement.style.setProperty("--pf-splitter-hit-target-fine", "32px");
        workspaceElement.style.setProperty("--pf-splitter-hit-target-coarse", "52px");
      });
      expect(await targetWidth()).toBe(coarse ? 52 : 32);
      const box = await splitter.boundingBox();
      if (box === null) throw new Error("Expected a visible splitter");
      expect(box.width).toBe(6);
      const start = { x: box.x + box.width / 2 + 12, y: box.y + box.height / 2 };
      expect(
        await page.evaluate(
          ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest("[data-workspace-splitter]")),
          start,
        ),
      ).toBe(true);
      const primary = workspace.locator('[data-workspace-split-child="primary-node"]');
      const before = (await primary.boundingBox())?.width ?? 0;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 40, start.y, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await primary.boundingBox())?.width ?? 0).toBe(before + 40);
      expect((await splitter.boundingBox())?.width).toBe(6);
    });
  });
}
