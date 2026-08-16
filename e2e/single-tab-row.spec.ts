import { expect, test, type Locator, type Page } from "@playwright/test";

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a rendered drag target");
  return box;
}

async function dragTabToGroup(page: Page, tab: Locator, targetGroupId: string) {
  await tab.scrollIntoViewIfNeeded();
  const sourceBox = await requiredBox(tab);
  const targetGroup = page.locator(`[data-workspace-group="${targetGroupId}"]`);
  const targetBox = await requiredBox(targetGroup);
  const targetNodeId = await targetGroup.getAttribute("data-workspace-node");
  expect(targetNodeId).not.toBeNull();

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });

  const overlay = page.locator("[data-workspace-panel-drag]");
  await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "center");
  await expect(overlay).toHaveAttribute(
    "data-workspace-drop-target",
    `center:${String(targetNodeId)}`,
  );
  await page.mouse.up();
}

async function floatWorkspacePanel(page: Page) {
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
  await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
}

test("hides a docked single-tab row without removing pointer docking", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const workspaceTab = page.getByRole("tab", { name: "workspace.ts" });
  await workspaceTab.click();
  await workspaceTab.locator('[data-workspace-tab-close="notes"]').click();

  const primaryGroup = page.locator('[data-workspace-group="primary"]');
  const appTab = primaryGroup.locator('[data-workspace-panel-tab="map-canvas"]');
  const tabStrip = primaryGroup.locator(":scope > .pf-tab-strip");

  await expect(appTab).toHaveCSS("opacity", "0");
  expect((await requiredBox(tabStrip)).height).toBeLessThanOrEqual(12);

  await dragTabToGroup(page, appTab, "inspector");

  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="map-canvas"]'),
  ).toHaveCount(1);
});

test("hides the compact floating tab while preserving panel redocking", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await floatWorkspacePanel(page);

  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const floatingTab = frame.locator('[data-workspace-panel-tab="notes"]');
  const floatingTabList = frame.locator(".pf-floating-header-slot .pf-tab-list");

  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("data-compact-header", "true");
  await expect(floatingTab).toHaveCSS("opacity", "0");
  expect((await requiredBox(floatingTab)).width).toBeLessThanOrEqual(12);
  expect((await requiredBox(floatingTabList)).width).toBeLessThanOrEqual(12);

  await dragTabToGroup(page, floatingTab, "inspector");

  await expect(frame).toHaveCount(0);
  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="notes"]'),
  ).toHaveCount(1);
});

test("keeps the VS Code demo typography and compact header in a browser window", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Open in new window" }).click();
  const popup = await popupPromise;

  const shell = popup.locator(".demo-external-app");
  const header = popup.locator(".demo-external-header");
  await expect(header).toBeVisible();
  await expect(popup.locator('link[rel="stylesheet"]')).toHaveCount(1);
  await expect(shell).toHaveCSS("font-size", "12px");
  await expect(header).toHaveCSS("padding-top", "8px");
  await expect(header).toHaveCSS("padding-bottom", "8px");
  await expect(header.locator("strong")).toHaveCSS("font-size", "12px");
  await expect(header.getByRole("button", { name: "Return to main window" })).toHaveCSS(
    "font-size",
    "11px",
  );

  await header.getByRole("button", { name: "Return to main window" }).click();
  await expect(page.getByRole("tab", { name: "workspace.ts" })).toBeVisible();
});
