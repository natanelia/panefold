import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.locator(".demo-workspace")).toHaveAttribute(
    "data-responsive-projection",
    "full-layout",
  );
  await expect(page.getByRole("tab", { name: "App.tsx", exact: true })).toBeVisible();
}

async function insideViewport(page: Page, target: Locator) {
  const bounds = await target.boundingBox();
  if (bounds === null) throw new Error("Expected a visible control");
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function revision(page: Page) {
  return page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision");
}

test("fits small phones, portrait, landscape and touch tablets without overlapping controls", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await openWorkspace(page);
    for (const target of [
      page.getByRole("button", { name: "Open Command Palette", exact: true }),
      page.getByRole("button", { name: "Undo layout change", exact: true }),
      page.getByRole("button", { name: "Redo layout change", exact: true }),
      page.getByRole("button", { name: "Workspace appearance", exact: true }),
      page.getByRole("button", { name: "Layout", exact: true }),
    ]) {
      await insideViewport(page, target);
      const size = await target.boundingBox();
      if (size === null) throw new Error("Expected a visible touch target");
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
    await insideViewport(page, page.locator(".demo-topbar"));
    await insideViewport(page, page.locator(".demo-statusbar"));
    const main = await page.locator(".demo-main").boundingBox();
    const toolbar = await page.locator(".demo-topbar").boundingBox();
    if (toolbar === null || main === null) throw new Error("Workbench did not render");
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(main.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("bottom navigation reveals the activated panel instead of leaving another region visible", async ({
  page,
}) => {
  await openWorkspace(page);
  const navigation = page.locator(".demo-activity-bar");
  for (const [button, panel] of [
    ["Search", "layers"],
    ["Terminal", "problems"],
    ["Explorer", "route-explorer"],
    ["Editor", "map-canvas"],
  ] as const) {
    await navigation.getByRole("button", { name: button, exact: true }).tap();
    await expect(page.locator(`[data-workspace-panel-tab="${panel}"]`)).toBeVisible();
    await expect(page.locator(`[data-workspace-panel-tab="${panel}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
});

test("the panel picker reveals an already-active panel after a view-only region change", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  const region = page.getByRole("combobox", { name: "Current workspace region" });
  const before = await revision(page);
  await region.selectOption("navigation");
  expect(await revision(page)).toBe(before);
  await page.getByRole("button", { name: "Open Command Palette", exact: true }).tap();
  const picker = page.getByRole("dialog", { name: "Command Palette", exact: true });
  await expect(picker).toBeFocused();
  await expect(picker.getByRole("textbox")).not.toBeFocused();
  await picker.getByRole("button", { name: "App.tsx Focus panel", exact: true }).tap();
  await expect(region).toHaveValue("primary");
  await expect(page.getByRole("tab", { name: "App.tsx", exact: true })).toBeVisible();
});

test("appearance settings stay inside a short viewport in both directions and can be dismissed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openWorkspace(page);
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  const trigger = page.getByRole("button", { name: "Workspace appearance", exact: true });
  await trigger.tap();
  const settings = page.getByRole("dialog", { name: "Workspace appearance", exact: true });
  await insideViewport(page, settings);
  await settings.getByRole("combobox", { name: "Direction", exact: true }).selectOption("rtl");
  await insideViewport(page, settings);
  await settings
    .getByRole("combobox", { name: "Tab rail", exact: true })
    .selectOption("inline-start");
  await settings
    .getByRole("combobox", { name: "Tab labels", exact: true })
    .selectOption("icon-only");
  await settings.getByRole("button", { name: "Close appearance settings", exact: true }).tap();
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const tab = page.getByRole("tab", { name: "App.tsx", exact: true });
  await insideViewport(page, tab);
  await trigger.tap();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
});

test("touch menus can split and undo without losing editor content", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  await page.getByRole("tab", { name: "workspace.ts", exact: true }).tap();
  const editor = page.getByRole("textbox", { name: "workspace.ts editor", exact: true });
  await editor.fill("A phone edit must survive layout changes.");
  const before = await revision(page);
  await page.getByRole("button", { name: "Actions for workspace.ts", exact: true }).tap();
  const menu = page.getByRole("menu", { name: "workspace.ts actions", exact: true });
  await insideViewport(page, menu);
  const split = menu.getByRole("menuitem", { name: "Split right", exact: true });
  await split.tap();
  await expect.poll(() => revision(page)).not.toBe(before);
  await expect(page.getByRole("combobox", { name: "Current workspace region" })).not.toHaveValue(
    "primary",
  );
  await expect(editor).toHaveValue("A phone edit must survive layout changes.");
  await page.getByRole("button", { name: "Undo layout change", exact: true }).tap();
  await expect(page.getByRole("combobox", { name: "Current workspace region" })).toHaveValue(
    "primary",
  );
  await expect(editor).toHaveValue("A phone edit must survive layout changes.");
});

test("rotation and region browsing preserve the layout revision and live note", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  await page.getByRole("tab", { name: "workspace.ts", exact: true }).tap();
  const editor = page.getByRole("textbox", { name: "workspace.ts editor", exact: true });
  await editor.fill("Keep this note after rotation.");
  const before = await revision(page);
  const region = page.getByRole("combobox", { name: "Current workspace region" });
  await region.selectOption("navigation");
  await page.setViewportSize({ width: 844, height: 390 });
  await region.selectOption("primary");
  await expect(editor).toHaveValue("Keep this note after rotation.");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toHaveValue("Keep this note after rotation.");
  expect(await revision(page)).toBe(before);
});

test("the command dialog traps keyboard focus and has a visible touch close control", async ({
  page,
}) => {
  await openWorkspace(page);
  const trigger = page.getByRole("button", { name: "Open Command Palette", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Command Palette", exact: true });
  await dialog.getByRole("button", { name: "Close Command Palette", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close Command Palette", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Close Command Palette", exact: true }).tap();
  await expect(trigger).toBeFocused();
});

test("the phone workbench and settings pass automated accessibility checks", async ({ page }) => {
  await openWorkspace(page);
  for (const settingsOpen of [false, true]) {
    if (settingsOpen)
      await page.getByRole("button", { name: "Workspace appearance", exact: true }).tap();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});

test("native touch scrolling reveals overflow tabs without committing a drag", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openWorkspace(page);
  const tabs = page.locator('[data-workspace-group="primary"] .pf-tab-list');
  await expect
    .poll(() => tabs.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeGreaterThan(0);
  const box = await tabs.boundingBox();
  if (box === null) throw new Error("Tab strip is missing");
  const before = await revision(page);
  const cdp = await page.context().newCDPSession(page);
  const from = box.x + box.width - 12;
  const to = box.x + 12;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from + ((to - from) * step) / 10, y }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => tabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await revision(page)).toBe(before);
  await expect(page.locator(".demo-workspace")).toHaveAttribute("data-panel-drag-state", "idle");
  await cdp.detach();
});
