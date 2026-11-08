import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1600, height: 1000 } });

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected a visible element");
  return box;
}

async function prepare(page: Page, direction: "ltr" | "rtl" = "ltr") {
  await page.addInitScript((direction) => {
    localStorage.setItem("panefold.atlas.view.v1", JSON.stringify({ direction, motion: "off" }));
  }, direction);
  await page.goto("/?fixture=code");
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page.getByRole("combobox", { name: "Resize preview" }).selectOption("separator");
  await page.getByRole("button", { name: "Close appearance settings" }).click();
  await page.addStyleTag({
    content: ".pf-workspace { inline-size: 1100px !important; block-size: 640px !important; }",
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.getByLabel("Panefold Code workbench");
}

async function revisionOf(page: Page) {
  return Number(
    await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"),
  );
}

async function dragDeferred(page: Page, splitter: Locator, cancel = false) {
  const before = await boxOf(splitter);
  const axis = (await splitter.getAttribute("aria-orientation")) === "vertical" ? "x" : "y";
  const revision = await revisionOf(page);
  const child = splitter.locator("xpath=preceding-sibling::*[1]");
  const childBefore = await boxOf(child);
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const end = { ...start, [axis]: start[axis] + 24 };
  const marker = page.locator("[data-workspace-resize-preview]");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect(marker).toBeVisible();
  expect(await boxOf(child)).toEqual(childBefore);
  expect(await boxOf(splitter)).toEqual(before);
  expect(await revisionOf(page)).toBe(revision);
  await expect
    .poll(async () => Math.abs((await boxOf(marker))[axis] - before[axis] - 24))
    .toBeLessThanOrEqual(2);
  const preview = await boxOf(marker);
  if (cancel) {
    await splitter.press("Escape");
    await page.mouse.up();
    await expect(marker).toBeHidden();
    expect(await boxOf(child)).toEqual(childBefore);
    expect(await revisionOf(page)).toBe(revision);
  } else {
    await page.mouse.up();
    await expect(marker).toBeHidden();
    await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    await expect
      .poll(async () => Math.abs((await boxOf(splitter))[axis] - preview[axis]))
      .toBeLessThanOrEqual(2);
  }
}

for (const direction of ["ltr", "rtl"] as const) {
  test(`divider-only previews preserve content on both axes in ${direction}`, async ({ page }) => {
    const workspace = await prepare(page, direction);
    for (const orientation of ["vertical", "horizontal"]) {
      const splitter = workspace
        .locator(`[role="separator"][aria-orientation="${orientation}"]`)
        .first();
      await dragDeferred(page, splitter, true);
      await dragDeferred(page, splitter);
    }
  });
}

test("divider-only preview aligns with a nested floating split", async ({ page }) => {
  await prepare(page);
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
  await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const header = await boxOf(frame.locator(".pf-floating-header-drag-region"));
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2 + 300, {
    steps: 5,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "Actions for App.tsx" }).click();
  await page.getByRole("menuitem", { name: "Move to primary", exact: true }).click();
  await frame.getByRole("button", { name: "Actions for App.tsx" }).click();
  await frame.getByRole("menuitem", { name: "Split right", exact: true }).click();
  await frame.getByRole("button", { name: /^Maximize / }).click();
  await dragDeferred(page, frame.locator("[data-workspace-splitter]"));
});
