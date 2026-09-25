import { expect, test, type Locator, type Page } from "@playwright/test";

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error("Expected visible drag geometry");
  return rect;
}
async function revision(page: Page) {
  return Number(
    await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"),
  );
}
async function start(page: Page, selector = '[data-workspace-panel-tab="notes"]') {
  const source = page.locator(selector);
  await source.scrollIntoViewIfNeeded();
  const rect = await box(source);
  await page.mouse.move(rect.x + Math.min(30, rect.width / 2), rect.y + rect.height / 2);
  await page.mouse.down();
}
async function appearance(page: Page, mode: "ltr" | "rtl" | "vertical") {
  if (mode === "ltr") return;
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace appearance" });
  if (mode === "rtl") await dialog.getByRole("combobox", { name: "Direction" }).selectOption("rtl");
  else await dialog.getByRole("combobox", { name: "Tab rail" }).selectOption("inline-start");
  await page.getByRole("button", { name: "Workspace appearance" }).click();
}

for (const mode of ["ltr", "rtl", "vertical"] as const)
  for (const relation of ["before", "after"] as const) {
    test(`inserts a foreign tab ${relation} in ${mode}, preserves its host, and undoes once`, async ({
      page,
    }) => {
      await page.goto("/");
      await page.getByLabel("Panefold Code workbench").waitFor();
      await appearance(page, mode);
      const host = page.locator('[data-workspace-panel-host="notes"]');
      const hostId = await host.getAttribute("id");
      const target = page.locator(
        `[data-workspace-panel-tab="${relation === "before" ? "feature-inspector" : "validation"}"]`,
      );
      await target.scrollIntoViewIfNeeded();
      const targetBox = await box(target);
      const initial = await revision(page);
      await start(page);
      const physicalStart = mode !== "rtl" ? relation === "before" : relation === "after";
      await page.mouse.move(
        mode === "vertical"
          ? targetBox.x + targetBox.width / 2
          : physicalStart
            ? targetBox.x + 3
            : targetBox.x + targetBox.width - 3,
        mode === "vertical"
          ? relation === "before"
            ? targetBox.y + 3
            : targetBox.y + targetBox.height - 3
          : targetBox.y + targetBox.height / 2,
        { steps: 12 },
      );
      const overlay = page.locator("[data-workspace-panel-drag]");
      await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "tab-insert");
      await expect(overlay.locator(".pf-tab-reorder-indicator")).toBeVisible();
      await expect(overlay.locator(".pf-panel-drop-preview")).toBeHidden();
      await page.mouse.up();
      await expect.poll(() => revision(page)).toBe(initial + 1);
      await expect
        .poll(() =>
          page
            .locator('[data-workspace-group="inspector"] [role="tab"]')
            .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
        )
        .toEqual(
          relation === "before"
            ? ["notes", "feature-inspector", "validation"]
            : ["feature-inspector", "validation", "notes"],
        );
      await expect(host).toHaveAttribute("id", hostId ?? "");
      await page.getByRole("button", { name: "Undo layout change" }).click();
      await expect(
        page.locator('[data-workspace-group="primary"] [data-workspace-panel-tab="notes"]'),
      ).toBeVisible();
      await expect(page.locator("[data-workspace-panel-drag]")).toHaveCount(0);
    });
  }

for (const platform of ["Linux x86_64", "MacIntel"]) {
  test(`changes edge/center with a stationary split modifier on ${platform}`, async ({ page }) => {
    await page.addInitScript(
      (value) => Object.defineProperty(navigator, "platform", { get: () => value }),
      platform,
    );
    await page.goto("/");
    await page.getByLabel("Panefold Code workbench").waitFor();
    const initial = await revision(page);
    const rect = await box(page.locator('[data-workspace-group="inspector"] .pf-panel-slot'));
    await start(page);
    await page.mouse.move(rect.x + 3, rect.y + rect.height / 2, { steps: 12 });
    const overlay = page.locator("[data-workspace-panel-drag]");
    await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "edge");
    const key = platform === "MacIntel" ? "Shift" : "Alt";
    await page.keyboard.down(key);
    await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "center");
    await page.keyboard.up(key);
    await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "edge");
    await page.keyboard.down(key);
    await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "center");
    await page.mouse.up();
    await page.keyboard.up(key);
    await expect.poll(() => revision(page)).toBe(initial + 1);
    await expect(
      page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="notes"]'),
    ).toBeVisible();
  });
}

test("merges a whole group at the center in one undoable command", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Panefold Code workbench").waitFor();
  const host = page.locator('[data-workspace-panel-host="map-canvas"]');
  const id = await host.getAttribute("id");
  const initial = await revision(page);
  const target = await box(page.locator('[data-workspace-group="inspector"] .pf-panel-slot'));
  await start(page, '[data-workspace-group-drag-handle="primary"]');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  const overlay = page.locator("[data-workspace-group-drag]");
  await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "merge");
  await page.waitForTimeout(100);
  const preview = await box(overlay.locator(".pf-panel-drop-preview"));
  await page.mouse.up();
  await expect.poll(() => revision(page)).toBe(initial + 1);
  await expect(page.locator('[data-workspace-group="primary"]')).toHaveCount(0);
  const result = page.locator('[data-workspace-group="inspector"]');
  await expect
    .poll(() =>
      result
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["feature-inspector", "validation", "map-canvas", "notes"]);
  await expect(host).toHaveAttribute("id", id ?? "");
  await expect
    .poll(async () => {
      const r = await box(result);
      return Math.max(
        Math.abs(r.x - preview.x),
        Math.abs(r.y - preview.y),
        Math.abs(r.width - preview.width),
        Math.abs(r.height - preview.height),
      );
    })
    .toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(page.locator('[data-workspace-group="primary"]')).toBeVisible();
});

test("Escape and window blur clear drag feedback without a command", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Panefold Code workbench").waitFor();
  const initial = await revision(page);
  for (const cancel of ["escape", "blur"]) {
    const target = await box(page.locator('[data-workspace-panel-tab="feature-inspector"]'));
    await start(page);
    await page.mouse.move(target.x + 3, target.y + target.height / 2, { steps: 12 });
    await expect(page.locator("[data-workspace-panel-drag]")).toBeVisible();
    if (cancel === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await expect(page.locator("[data-workspace-panel-drag]")).toHaveCount(0);
    await expect.poll(() => revision(page)).toBe(initial);
  }
});
