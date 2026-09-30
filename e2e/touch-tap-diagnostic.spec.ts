import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { beginTouch, moveTouch, endTouch, visibleBox } from "./touch-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("records the toolbar event sequence after a native panel move", async ({ page }, info) => {
  await page.goto("/?fixture=touch");
  const arrange = page.getByRole("button", { name: "Arrange", exact: true });
  await expect(arrange).toBeVisible();
  const note = page.getByRole("textbox", { name: "Your working note" });
  await note.fill("Keep this note when the layout changes.");
  await note.blur();
  await arrange.evaluate((button) => {
    for (const type of ["pointerdown", "pointerup", "click", "touchstart", "touchend"]) {
      button.addEventListener(type, () => {
        const count = Number(button.getAttribute(`data-test-${type}`) ?? "0");
        button.setAttribute(`data-test-${type}`, String(count + 1));
      });
    }
  });
  const grip = page.locator('[data-workspace-panel-tab="notes"] .pf-tab-drag-handle');
  const target = await visibleBox(
    page.locator('[data-workspace-group="secondary"] .pf-panel-slot'),
  );
  const drag = await beginTouch(page, grip);
  await moveTouch(page, drag.cdp, drag.from, {
    x: target.x + target.width * 0.75,
    y: target.y + target.height / 2,
  });
  await endTouch(drag.cdp);
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await arrange.tap();
  await page.waitForTimeout(500);
  const button = page.locator(".tp-toolbar button").nth(1);
  const state = await button.evaluate((element) => ({
    attributes: Object.fromEntries(
      Array.from(element.attributes, (item) => [item.name, item.value]),
    ),
    touchAction: getComputedStyle(element).touchAction,
    active: document.activeElement?.tagName,
    viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale },
  }));
  const path = info.outputPath("toolbar-event-sequence.json");
  await writeFile(path, JSON.stringify(state, null, 2));
  await info.attach("toolbar-event-sequence", { path, contentType: "application/json" });
  expect(state.attributes["aria-pressed"], JSON.stringify(state)).toBe("true");
});
