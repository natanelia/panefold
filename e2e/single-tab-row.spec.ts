import { expect, test, type Locator, type Page } from "@playwright/test";

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a rendered drag target");
  return box;
}

async function dragTabToGroup(page: Page, tab: Locator, target: string | Locator) {
  await tab.scrollIntoViewIfNeeded();
  const sourceBox = await requiredBox(tab);
  const targetGroup =
    typeof target === "string" ? page.locator(`[data-workspace-group="${target}"]`) : target;
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

test("shows a discoverable docked drag grip without restoring the tab row", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const workspaceTab = page.getByRole("tab", { name: "workspace.ts" });
  await workspaceTab.click();
  await workspaceTab.locator('[data-workspace-tab-close="notes"]').click();

  const primaryGroup = page.locator('[data-workspace-group="primary"]');
  const appTab = primaryGroup.locator('[data-workspace-panel-tab="map-canvas"]');
  const tabStrip = primaryGroup.locator(":scope > .pf-tab-strip");
  const affordance = tabStrip.locator(".pf-single-tab-drag-affordance");

  await expect(tabStrip).toHaveAttribute("data-header-location", "docked");
  await expect(tabStrip).toHaveAttribute("data-single-panel", "true");
  await expect(appTab).toHaveCSS("opacity", "0");
  await expect(affordance).toHaveCSS("cursor", "grab");
  await expect(affordance).toBeVisible();
  await expect(affordance).toHaveAttribute("data-tooltip", "Drag to move App.tsx");
  expect((await requiredBox(tabStrip)).height).toBeLessThanOrEqual(12);

  await tabStrip.hover({ position: { x: 80, y: 6 } });
  await expect
    .poll(() => primaryGroup.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe("none");
  await page.waitForTimeout(750);
  expect(await affordance.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe(
    "1",
  );
  expect(
    await affordance.evaluate((element) => getComputedStyle(element, "::after").content),
  ).toContain("Drag to move App.tsx");

  await dragTabToGroup(page, appTab, "inspector");

  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="map-canvas"]'),
  ).toHaveCount(1);
});

test("uses a single floating tab as the persistent window title", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await floatWorkspacePanel(page);

  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const headerStrip = frame.locator(".pf-floating-header-slot > .pf-tab-strip");
  const floatingTab = headerStrip.locator('[data-workspace-panel-tab="notes"]');

  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("data-integrated-header", "true");
  await expect(headerStrip).toHaveAttribute("data-header-location", "floating");
  await expect(headerStrip).toHaveAttribute("data-header-variant", "title");
  await expect(floatingTab).toHaveCSS("opacity", "1");
  await expect(floatingTab).toHaveCSS("border-bottom-style", "none");
  await expect(floatingTab.getByText("workspace.ts")).toBeVisible();
  await expect(frame.locator(".pf-floating-header-drag-grip")).toBeVisible();

  await frame.locator('.pf-floating-controls button[aria-label^="Minimize "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await expect(floatingTab).toBeVisible();
  await expect(frame.locator(".pf-floating-content")).toBeHidden();

  await frame.locator('.pf-floating-controls button[aria-label^="Restore "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "false");
  await dragTabToGroup(page, floatingTab, "inspector");

  await expect(frame).toHaveCount(0);
  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="notes"]'),
  ).toHaveCount(1);
});

test("keeps multiple floating tabs in the titlebar while minimized", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await floatWorkspacePanel(page);

  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const floatingGroup = frame.locator(".pf-floating-content [data-workspace-group]").first();
  const appTab = page.locator(
    '[data-workspace-group="primary"] [data-workspace-panel-tab="map-canvas"]',
  );

  await dragTabToGroup(page, appTab, floatingGroup);

  const headerStrip = frame.locator(".pf-floating-header-slot > .pf-tab-strip");
  await expect(headerStrip).toHaveAttribute("data-header-variant", "tabs");
  await expect(headerStrip.getByRole("tab")).toHaveCount(2);

  await frame.locator('.pf-floating-controls button[aria-label^="Minimize "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await expect(headerStrip.getByRole("tab")).toHaveCount(2);
  await headerStrip.getByRole("tab", { name: "App.tsx" }).click();
  await expect(headerStrip.getByRole("tab", { name: "App.tsx" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await frame.locator('.pf-floating-controls button[aria-label^="Restore "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "false");
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
