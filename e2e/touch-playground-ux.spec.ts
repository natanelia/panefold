import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { beginTouch, endTouch, moveTouch, visibleBox } from "./touch-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const tab = (page: Page, id: string) => page.locator(`[data-workspace-panel-tab="${id}"]`);
const group = (page: Page, id: string) => page.locator(`[data-workspace-group="${id}"]`);
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Panefold Playground" })).toBeVisible();
  await expect(page.locator(".tp-workspace")).toHaveAttribute(
    "data-responsive-projection",
    "full-layout",
  );
}
async function owner(page: Page, id: string) {
  return tab(page, id).evaluate(
    (element) =>
      element.closest("[data-workspace-group]")?.getAttribute("data-workspace-group") ?? "",
  );
}
async function drop(
  page: Page,
  source: Locator,
  destination: Locator,
  edge: "inline-end" | "block-end" | "center",
  wholeTab = false,
) {
  const rect = await visibleBox(destination.locator(".pf-panel-slot"));
  // A quarter of the way from the edge, not a four-pixel precision target.
  const to = {
    x: rect.x + rect.width * (edge === "inline-end" ? 0.75 : 0.5),
    y: rect.y + rect.height * (edge === "block-end" ? 0.75 : 0.5),
  };
  const { cdp, from } = await beginTouch(
    page,
    wholeTab ? source : source.locator(".pf-tab-drag-handle"),
  );
  try {
    await moveTouch(page, cdp, from, to);
    const overlay = page.locator("[data-workspace-panel-drag]");
    await expect(overlay).toHaveAttribute(
      "data-workspace-drop-kind",
      edge === "center" ? "center" : "edge",
    );
    if (edge !== "center") await expect(overlay).toHaveAttribute("data-workspace-drop-edge", edge);
    await expect(destination.locator(".tp-drop-guide").first()).toBeVisible();
    const label = await visibleBox(page.locator(".pf-panel-drag-ghost"));
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(390);
    await endTouch(cdp);
  } catch (error) {
    await endTouch(cdp, true).catch(() => undefined);
    throw error;
  }
}

test("starts with readable content and one control row per pane", async ({ page }, info) => {
  await open(page);
  await expect(page.locator(".pf-group")).toHaveCount(2);
  for (const node of await page.locator(".pf-group").all()) {
    const rect = await visibleBox(node);
    expect(rect.width).toBeGreaterThan(350);
    expect(rect.height).toBeGreaterThanOrEqual(208);
    expect((await visibleBox(node.locator(".pf-tab-strip"))).height).toBeLessThanOrEqual(53);
  }
  const note = page.getByRole("textbox", { name: "Your working note" });
  expect(await note.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBe(16);
  for (const button of await page.locator(".tp-toolbar button").all()) {
    const rect = await visibleBox(button);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath("phone-start.png") });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".touch-playground")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const pane of await page.locator(".pf-group").all())
      expect((await visibleBox(pane)).height).toBeGreaterThanOrEqual(208);
  }
});

test("uses broad touch targets for nested splits and keeps panel content", async ({
  page,
}, info) => {
  await open(page);
  const note = page.getByRole("textbox", { name: "Your working note" });
  await note.fill("Keep this note when the layout changes.");
  await note.blur();
  await drop(page, tab(page, "notes"), group(page, "secondary"), "inline-end");
  const notesGroup = await owner(page, "notes");
  expect(notesGroup).not.toBe("primary");
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await page.getByRole("button", { name: "Arrange", exact: true }).tap();
  await drop(page, tab(page, "checklist"), group(page, notesGroup), "block-end", true);
  expect(await owner(page, "checklist")).not.toBe(notesGroup);
  // The empty old source is removed, not left as another unusable pane.
  await expect(page.locator('.pf-group[data-empty="true"]')).toHaveCount(0);
  await expect(note).toHaveValue("Keep this note when the layout changes.");
  for (const pane of await page.locator(".pf-group").all()) {
    const rect = await visibleBox(pane);
    expect(rect.width).toBeGreaterThanOrEqual(176);
    expect(rect.height).toBeGreaterThanOrEqual(208);
  }
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.screenshot({ path: info.outputPath("phone-nested.png") });
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(note).toHaveValue("Keep this note when the layout changes.");
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
});

test("offers a previewed tap-to-place operation and durable restoration", async ({
  page,
}, info) => {
  await open(page);
  const revision = await page.locator(".touch-playground").getAttribute("data-workspace-revision");
  await page.getByRole("button", { name: "Move", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Move or split a panel" });
  await sheet.getByRole("combobox", { name: "Panel", exact: true }).selectOption("checklist");
  await sheet
    .getByRole("combobox", { name: "Destination pane", exact: true })
    .selectOption("secondary");
  await sheet.getByRole("button", { name: "Right", exact: true }).tap();
  await expect(sheet.getByRole("img", { name: /Layout preview/ })).toBeVisible();
  expect(await page.locator(".touch-playground").getAttribute("data-workspace-revision")).toBe(
    revision,
  );
  await page.screenshot({ path: info.outputPath("phone-move-sheet.png") });
  await sheet.getByRole("button", { name: "Apply move" }).tap();
  await expect(sheet).toHaveCount(0);
  const destination = await owner(page, "checklist");
  expect(destination).not.toBe("primary");
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
  await page.reload();
  await expect(page.locator(".pf-group")).toHaveCount(3);
  expect(await owner(page, "checklist")).toBe(destination);
});

test("cancels a touch drag and a move sheet without committing", async ({ page }) => {
  await open(page);
  const revision = await page.locator(".touch-playground").getAttribute("data-workspace-revision");
  const drag = await beginTouch(page, tab(page, "notes").locator(".pf-tab-drag-handle"));
  await moveTouch(page, drag.cdp, drag.from, { x: 200, y: 500 });
  await endTouch(drag.cdp, true);
  expect(await page.locator(".touch-playground").getAttribute("data-workspace-revision")).toBe(
    revision,
  );
  await page.getByRole("button", { name: "Move", exact: true }).tap();
  await page.getByRole("button", { name: "Close panel sheet" }).tap();
  expect(await page.locator(".touch-playground").getAttribute("data-workspace-revision")).toBe(
    revision,
  );
  await expect(page.getByRole("button", { name: "Move", exact: true })).toBeFocused();
});

test("resizes a pane with touch instead of shrinking text", async ({ page }) => {
  await open(page);
  const before = await visibleBox(group(page, "primary"));
  const drag = await beginTouch(page, page.getByRole("separator").first());
  await moveTouch(page, drag.cdp, drag.from, { x: drag.from.x, y: drag.from.y + 35 });
  await endTouch(drag.cdp);
  await expect
    .poll(async () => (await visibleBox(group(page, "primary"))).height)
    .toBeGreaterThan(before.height + 10);
});

test("passes automatic accessibility checks on the phone and the move sheet", async ({ page }) => {
  await open(page);
  for (const sheet of [false, true]) {
    if (sheet) await page.getByRole("button", { name: "Move", exact: true }).tap();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});
