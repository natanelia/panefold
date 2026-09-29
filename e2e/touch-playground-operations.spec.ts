import { expect, test, type Page } from "@playwright/test";
import { beginTouch, endTouch, moveTouch, visibleBox } from "./touch-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const group = (page: Page, id: string) => page.locator(`[data-workspace-group="${id}"]`);
const revision = async (page: Page) =>
  Number(await page.locator(".touch-playground").getAttribute("data-workspace-revision"));

test.beforeEach(async ({ page }) => {
  await page.goto("/?fixture=touch");
  await expect(page.locator(".tp-workspace")).toBeVisible();
  await page.evaluate(() =>
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.isTrusted && event.pointerType === "touch")
          document.documentElement.dataset.nativeAuditTouch = "true";
      },
      { capture: true },
    ),
  );
});

test("touch moves a whole playground container with one undo step", async ({ page }) => {
  await page.getByRole("button", { name: "Arrange", exact: true }).tap();
  await expect(page.locator(".touch-playground")).toHaveAttribute("data-arranging", "true");
  const before = await revision(page);
  const target = await visibleBox(group(page, "secondary").locator(".pf-panel-slot"));
  const drag = await beginTouch(
    page,
    group(page, "primary").locator("[data-workspace-group-drag-handle]"),
  );
  await moveTouch(page, drag.cdp, drag.from, {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  await expect(page.locator("[data-workspace-group-drag]")).toHaveAttribute(
    "data-workspace-drop-kind",
    "merge",
  );
  await endTouch(drag.cdp);
  await expect(page.locator(".pf-group")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(4);
  expect(await revision(page)).toBe(before + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(page.locator(".pf-group")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-native-audit-touch", "true");
});

test("touch reorders playground tabs and cancellation leaves the order unchanged", async ({
  page,
}) => {
  const titles = group(page, "primary").locator(".pf-tab-title");
  const notes = page.locator('[data-workspace-panel-tab="notes"] .pf-tab-drag-handle');
  const target = await visibleBox(page.locator('[data-workspace-panel-tab="checklist"]'));
  for (const cancel of [true, false]) {
    const before = await revision(page);
    const drag = await beginTouch(page, notes);
    await moveTouch(page, drag.cdp, drag.from, {
      x: target.x + target.width - 5,
      y: target.y + target.height / 2,
    });
    await endTouch(drag.cdp, cancel);
    await expect(titles).toHaveText(cancel ? ["Notes", "Checklist"] : ["Checklist", "Notes"]);
    expect(await revision(page)).toBe(before + (cancel ? 0 : 1));
  }
  await expect(page.locator("html")).toHaveAttribute("data-native-audit-touch", "true");
});

test("touch floating move and resize commit only on release, cancel safely, and retain editor text", async ({
  page,
}, info) => {
  const note = page.getByRole("textbox", { name: "Your working note" });
  await note.fill("Keep this text during floating gestures.");
  await note.blur();
  await page.getByRole("button", { name: "Actions for Notes", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Float Notes", exact: true }).tap();
  const frame = page.locator(".pf-floating-surface");
  await expect(frame).toBeVisible();
  for (const mode of ["move", "resize"] as const) {
    const handle = frame.locator(
      mode === "move" ? ".pf-floating-header-drag-region" : '[data-resize-edge="bottom"]',
    );
    for (const cancel of [true, false]) {
      const beforeRevision = await revision(page);
      const before = await visibleBox(frame);
      const drag = await beginTouch(page, handle);
      await moveTouch(page, drag.cdp, drag.from, { x: drag.from.x, y: drag.from.y + 36 });
      expect(await revision(page)).toBe(beforeRevision);
      await endTouch(drag.cdp, cancel);
      await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
      await expect.poll(() => revision(page)).toBe(beforeRevision + (cancel ? 0 : 1));
      const after = await visibleBox(frame);
      const dimension = mode === "move" ? "y" : "height";
      if (cancel) expect(after[dimension]).toBeCloseTo(before[dimension], 0);
      else expect(after[dimension]).toBeGreaterThan(before[dimension] + 20);
      await expect(note).toHaveValue("Keep this text during floating gestures.");
    }
  }
  await expect(page.locator("html")).toHaveAttribute("data-native-audit-touch", "true");
  await page.screenshot({ path: info.outputPath("floating-native-touch.png") });
});
