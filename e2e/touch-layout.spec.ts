import { expect, test, type Page } from "@playwright/test";
import { beginTouch, endTouch, moveTouch, touchPanelDrop, visibleBox } from "./touch-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const tab = (page: Page, id: string) => page.locator(`[data-workspace-panel-tab="${id}"]`);
const group = (page: Page, id: string) => page.locator(`[data-workspace-group="${id}"]`);
const overlay = (page: Page) => page.locator("[data-workspace-panel-drag]");
const revision = async (page: Page) =>
  Number(await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"));
const owner = (page: Page, id: string) =>
  tab(page, id).evaluate(
    (element) =>
      element.closest<HTMLElement>("[data-workspace-group]")?.dataset.workspaceGroup ?? "",
  );

async function open(page: Page) {
  await page.goto("/?fixture=code");
  await expect(page.locator(".demo-workspace")).toHaveAttribute(
    "data-responsive-projection",
    "full-layout",
  );
  await expect(page.locator(".pf-group")).toHaveCount(4);
  await expect(tab(page, "map-canvas").locator(".pf-tab-drag-handle")).toBeVisible();
  // Observe real input so a mouse-based drag cannot accidentally satisfy this suite.
  await page.evaluate(() =>
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch" && event.isTrusted)
          document.documentElement.dataset.trustedTouch = "true";
      },
      { capture: true },
    ),
  );
}

async function samePreview(
  page: Page,
  id: string,
  preview: { x: number; y: number; width: number; height: number },
) {
  const result = group(page, await owner(page, id));
  await expect
    .poll(async () => {
      const actual = await visibleBox(result);
      return Math.max(
        ...(["x", "y", "width", "height"] as const).map((key) =>
          Math.abs(actual[key] - preview[key]),
        ),
      );
    })
    .toBeLessThanOrEqual(2);
  await expect(page.locator(".demo-workspace")).toHaveAttribute("data-panel-drag-state", "idle");
  await expect(page.locator("html")).toHaveAttribute("data-trusted-touch", "true");
}

for (const direction of ["ltr", "rtl"] as const) {
  test(`native touch docks between groups in ${direction}, preserving the host and one undo step`, async ({
    page,
  }) => {
    await open(page);
    if (direction === "rtl") {
      await page.getByRole("button", { name: "Workspace appearance", exact: true }).tap();
      const settings = page.getByRole("dialog", { name: "Workspace appearance", exact: true });
      await settings.getByRole("combobox", { name: "Direction", exact: true }).selectOption("rtl");
      await settings.getByRole("button", { name: "Close appearance settings", exact: true }).tap();
    }
    await tab(page, "notes").tap();
    const editor = page.getByRole("textbox", { name: "workspace.ts editor", exact: true });
    await editor.fill("Keep this text through a real touch move.");
    const host = page.locator('[data-workspace-panel-host="notes"]');
    const hostId = await host.getAttribute("id");
    if (hostId === null) throw new Error("Expected a stable panel host ID");
    const before = await revision(page);
    const preview = await touchPanelDrop(
      page,
      tab(page, "notes"),
      group(page, "navigation"),
      overlay(page),
      "center",
    );
    await expect.poll(() => owner(page, "notes")).toBe("navigation");
    await samePreview(page, "notes", preview);
    expect(await revision(page)).toBe(before + 1);
    await expect(host).toHaveAttribute("id", hostId);
    await expect(editor).toHaveValue("Keep this text through a real touch move.");
    await page.getByRole("button", { name: "Undo layout change", exact: true }).tap();
    await expect.poll(() => owner(page, "notes")).toBe("primary");
    await expect(editor).toHaveValue("Keep this text through a real touch move.");
    await expect(page.locator(".demo-health")).toHaveAttribute("data-valid", "true");
  });
}

test("native touch creates a split, nests an orthogonal split, resizes it and restores it after reload", async ({
  page,
}, info) => {
  await open(page);
  await page.screenshot({ path: info.outputPath("phone-full-layout.png") });
  const before = await revision(page);
  const first = await touchPanelDrop(
    page,
    tab(page, "notes"),
    group(page, "primary"),
    overlay(page),
    "block-end",
  );
  const child = await owner(page, "notes");
  expect(child).not.toBe("primary");
  await expect(page.locator(".pf-group")).toHaveCount(5);
  await samePreview(page, "notes", first);
  expect(await revision(page)).toBe(before + 1);
  // The second drop splits the newly created subpanel, not the workspace root.
  const second = await touchPanelDrop(
    page,
    tab(page, "layers"),
    group(page, child),
    overlay(page),
    "inline-end",
  );
  await expect(page.locator(".pf-group")).toHaveCount(6);
  await samePreview(page, "layers", second);
  expect(await revision(page)).toBe(before + 2);
  const nested = group(page, child).locator("xpath=..").locator("xpath=..");
  const splitter = nested.getByRole("separator").first();
  const sizeBefore = (await visibleBox(group(page, child))).width;
  const drag = await beginTouch(page, splitter);
  await moveTouch(page, drag.cdp, drag.from, { x: drag.from.x + 14, y: drag.from.y });
  await endTouch(drag.cdp);
  await expect
    .poll(async () => Math.abs((await visibleBox(group(page, child))).width - sizeBefore))
    .toBeGreaterThan(3);
  expect(await revision(page)).toBe(before + 3);
  const owners = await Promise.all([owner(page, "notes"), owner(page, "layers")]);
  const sizes = await Promise.all(
    owners.map(async (id) => (await visibleBox(group(page, id))).width),
  );
  await page.screenshot({ path: info.outputPath("phone-nested-splits.png") });
  await expect(page.locator("[data-persistence-state]")).toHaveAttribute(
    "data-persistence-state",
    "saved",
  );
  await page.reload();
  await expect(page.locator(".pf-group")).toHaveCount(6);
  expect(await Promise.all([owner(page, "notes"), owner(page, "layers")])).toEqual(owners);
  for (const [i, id] of owners.entries()) {
    const size = sizes[i];
    if (size === undefined) throw new Error("Missing stored panel size");
    expect(Math.abs((await visibleBox(group(page, id))).width - size)).toBeLessThanOrEqual(2);
  }
  await expect(page.locator(".demo-health")).toHaveAttribute("data-valid", "true");
});

test("native touch reorders tabs in the full landscape layout", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await open(page);
  const before = await revision(page);
  const target = await visibleBox(tab(page, "map-canvas"));
  const drag = await beginTouch(page, tab(page, "notes").locator(".pf-tab-drag-handle"));
  await moveTouch(page, drag.cdp, drag.from, { x: target.x + 3, y: target.y + target.height / 2 });
  await expect(overlay(page)).toHaveAttribute("data-workspace-drop-kind", "reorder");
  await endTouch(drag.cdp);
  await expect(group(page, "primary").getByRole("tab").first()).toHaveAttribute(
    "data-workspace-panel-tab",
    "notes",
  );
  expect(await revision(page)).toBe(before + 1);
});

test("native touch moves a whole container into another container", async ({ page }) => {
  await open(page);
  const before = await revision(page);
  const target = await visibleBox(group(page, "primary").locator(".pf-panel-slot"));
  const drag = await beginTouch(
    page,
    group(page, "navigation").locator("[data-workspace-group-drag-handle]"),
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
  await expect.poll(() => owner(page, "route-explorer")).toBe("primary");
  expect(await owner(page, "layers")).toBe("primary");
  expect(await revision(page)).toBe(before + 1);
});

for (const cancellation of ["touchCancel", "rotation"] as const) {
  test(`${cancellation} cancels a real touch drag and releases capture without a layout change`, async ({
    page,
  }) => {
    await open(page);
    const before = await revision(page);
    const target = await visibleBox(group(page, "navigation").locator(".pf-panel-slot"));
    const drag = await beginTouch(page, tab(page, "notes").locator(".pf-tab-drag-handle"));
    await moveTouch(page, drag.cdp, drag.from, {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    });
    await expect(page.locator(".demo-workspace")).toHaveAttribute(
      "data-panel-drag-state",
      "dragging",
    );
    if (cancellation === "rotation") await page.setViewportSize({ width: 844, height: 390 });
    await endTouch(drag.cdp, cancellation === "touchCancel");
    await expect(page.locator(".demo-workspace")).toHaveAttribute("data-panel-drag-state", "idle");
    expect(await revision(page)).toBe(before);
    expect(await owner(page, "notes")).toBe("primary");
    await touchPanelDrop(
      page,
      tab(page, "notes"),
      group(page, "navigation"),
      overlay(page),
      "center",
    );
    await expect.poll(() => owner(page, "notes")).toBe("navigation");
  });
}
